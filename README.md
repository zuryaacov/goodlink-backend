# GoodLink Backend Cloudflare Worker

This Cloudflare Worker handles link redirects by:
1. Extracting the domain from the request hostname
2. Extracting the slug from the URL path
3. Querying Supabase for the link matching slug + domain
4. Redirecting to the target URL if found and active

## Setup

### 1. Install Dependencies

```bash
cd goodlink-backend
npm install
```

### 2. Configure Environment Variables

You need to set these environment variables in Cloudflare Workers:

- `SUPABASE_URL`: Your Supabase project URL (e.g., `https://xxxxx.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key (bypasses RLS)

**Important**: Use the **service role key**, not the anon key, because:
- The worker needs to read links without authentication
- RLS policies restrict access to authenticated users only
- Service role key bypasses RLS for server-side operations

### 3. Get Supabase Service Role Key

1. Go to your Supabase project dashboard
2. Navigate to **Settings** → **API**
3. Copy the **service_role** key (not the anon key)
4. Add it as a secret in Cloudflare Workers

### 4. Deploy

```bash
npm run deploy
```

Or set secrets manually:

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

## Supabase Policy Setup

You need to create a policy that allows public read access to links. Choose the appropriate SQL file based on whether your table has a `status` column:

### Option 1: No Status Column (Recommended for now)

If your `links` table doesn't have a `status` column, use `supabase-public-link-policy-simple.sql`:

```sql
-- Drop policy if it exists (to avoid conflicts)
DROP POLICY IF EXISTS "Public can read active links" ON links;

-- Create policy that allows public read access to all links
CREATE POLICY "Public can read active links"
  ON links FOR SELECT
  USING (true);
```

### Option 2: With Status Column

If your `links` table has a `status` column, first add it (if needed):

```sql
ALTER TABLE links ADD COLUMN IF NOT EXISTS status BOOLEAN DEFAULT true;
```

Then use `supabase-public-link-policy.sql` which checks the status column.

**Note**: The service role key can bypass RLS, so this policy is technically optional. However, it's good practice to have explicit policies for clarity and future-proofing.

## Route Configuration

The worker is configured to handle requests for:
- `goodlink.ai/*`
- `glynk.io/*`

To add more domains, update `wrangler.toml`:

```toml
[env.production]
routes = [
  { pattern = "goodlink.ai/*", zone_name = "goodlink.ai" },
  { pattern = "glynk.io/*", zone_name = "glynk.io" },
  { pattern = "yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

## Features

- **Slug Extraction**: Automatically extracts slug from URL path
- **Domain Matching**: Matches links by both slug and domain
- **Status Check**: Only redirects if link status is `true` (active)
- **UTM Parameters**: Automatically adds UTM parameters if configured
- **Query Pass-through**: Passes through query parameters if enabled
- **Error Handling**: Returns 404 for invalid/missing links, 500 for server errors

## URL Examples

- `https://goodlink.ai/abc123` → redirects to target_url
- `https://goodlink.ai/abc123?ref=twitter` → redirects with query params (if pass-through enabled)
- `https://glynk.io/xyz789` → redirects to target_url

## Development

Run locally:

```bash
npm run dev
```

View logs:

```bash
npm run tail
```

