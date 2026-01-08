/**
 * Cloudflare Worker for Link Redirect
 * 
 * This worker:
 * 1. Extracts domain from request host
 * 2. Extracts slug from URL path
 * 3. Queries Supabase for link by slug + domain
 * 4. Redirects to target_url if found and active
 * 
 * Environment Variables Required:
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY: Supabase service role key (bypasses RLS)
 * 
 * Usage:
 * GET https://goodlink.ai/abc123 -> redirects to target_url
 * GET https://glynk.io/xyz789 -> redirects to target_url
 */
/* yaaacov */
/**
 * Extract slug from URL path
 * @param {string} pathname - URL pathname (e.g., "/abc123" or "/abc123?param=value")
 * @returns {string|null} - Slug or null if invalid
 */
function extractSlug(pathname) {
  // Remove leading slash and query parameters
  const path = pathname.replace(/^\//, '').split('?')[0].split('#')[0];

  // Return null for empty paths or common paths
  if (!path || path === '' || path === 'index.html' || path.startsWith('api/')) {
    return null;
  }

  // Validate slug format (alphanumeric and hyphens, 3-30 chars)
  const slugPattern = /^[a-z0-9-]{3,30}$/i;
  if (!slugPattern.test(path)) {
    return null;
  }

  return path.toLowerCase();
}

/**
 * Build target URL with UTM parameters and query string pass-through
 * @param {string} targetUrl - Base target URL
 * @param {object} linkData - Link data from database
 * @param {URL} requestUrl - Original request URL
 * @returns {string} - Final URL with all parameters
 */
function buildTargetUrl(targetUrl, linkData, requestUrl) {
  try {
    const target = new URL(targetUrl);
    const requestParams = new URLSearchParams(requestUrl.search);

    // Add UTM parameters if configured
    if (linkData.utm_source) {
      target.searchParams.set('utm_source', linkData.utm_source);
    }
    if (linkData.utm_medium) {
      target.searchParams.set('utm_medium', linkData.utm_medium);
    }
    if (linkData.utm_campaign) {
      target.searchParams.set('utm_campaign', linkData.utm_campaign);
    }
    if (linkData.utm_content) {
      target.searchParams.set('utm_content', linkData.utm_content);
    }

    // Pass through query parameters if enabled
    if (linkData.parameter_pass_through) {
      for (const [key, value] of requestParams.entries()) {
        // Don't override UTM parameters that were just set
        if (!['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].includes(key)) {
          target.searchParams.set(key, value);
        }
      }
    }

    return target.toString();
  } catch (error) {
    // If URL parsing fails, return original target_url
    console.error('Error building target URL:', error);
    return targetUrl;
  }
}

/**
 * Query Supabase for link by slug and domain
 * @param {string} slug - Link slug
 * @param {string} domain - Domain name
 * @param {string} supabaseUrl - Supabase project URL
 * @param {string} supabaseKey - Supabase service role key
 * @returns {Promise<object|null>} - Link data or null if not found
 */
async function getLinkFromSupabase(slug, domain, supabaseUrl, supabaseKey) {
  try {
    // Use Supabase REST API directly (no client library in Workers)
    // Check if status column exists, if not, just filter by slug and domain
    const url = `${supabaseUrl}/rest/v1/links?slug=eq.${encodeURIComponent(slug)}&domain=eq.${encodeURIComponent(domain)}&select=target_url,parameter_pass_through,utm_source,utm_medium,utm_campaign,utm_content,status`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
    });

    if (!response.ok) {
      console.error('Supabase query failed:', response.status, await response.text());
      return null;
    }

    const data = await response.json();

    if (!data || data.length === 0) {
      return null;
    }

    const link = data[0];

    // Check status if column exists (some databases might not have it yet)
    if (link.status !== undefined && link.status === false) {
      return null; // Link is inactive
    }

    return link;
  } catch (error) {
    console.error('Error querying Supabase:', error);
    return null;
  }
}

/**
 * Main worker handler
 */
export default {
  async fetch(request, env) {
    try {
      // Check for required environment variables
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('Missing Supabase configuration');
        return new Response('Service configuration error', { status: 500 });
      }

      const url = new URL(request.url);
      const hostname = url.hostname;
      const pathname = url.pathname;

      // Extract slug from path
      const slug = extractSlug(pathname);

      if (!slug) {
        // No valid slug found - return 404
        return new Response('Link not found', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
          }
        });
      }

      // Extract domain from hostname
      // Remove www. prefix if present
      const domain = hostname.replace(/^www\./, '');

      console.log(`Looking up link: slug=${slug}, domain=${domain}`);

      // Query Supabase for the link
      const linkData = await getLinkFromSupabase(
        slug,
        domain,
        env.SUPABASE_URL,
        env.SUPABASE_SERVICE_ROLE_KEY
      );

      if (!linkData || !linkData.target_url) {
        // Link not found or inactive
        return new Response('Link not found', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
          }
        });
      }

      // Build final URL with UTM parameters and query string pass-through
      const finalUrl = buildTargetUrl(linkData.target_url, linkData, url);

      console.log(`Redirecting to: ${finalUrl}`);

      // Perform redirect (301 permanent redirect)
      return Response.redirect(finalUrl, 301);

    } catch (error) {
      console.error('Worker error:', error);
      return new Response('Internal server error', {
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
        }
      });
    }
  },
};

