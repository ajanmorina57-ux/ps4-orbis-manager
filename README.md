# Orbis Manager

Orbis Manager is a private library and import queue for PlayStation package files. The app keeps account identity and metadata in Supabase and stores package bytes in a private Cloudflare R2 bucket. The API coordinates ownership, job state and short-lived storage authorization; browsers upload and download package bytes directly to R2.

The separate `orbis-manager-bridge` project is not part of this repository.

## Repository layout

```text
apps/
  web/                 React + TypeScript + Vite + Tailwind dashboard (Vercel)
  server/              Express API and single-machine import worker (Fly.io)
packages/
  contracts/           Shared Zod request and response contracts
supabase/migrations/   Database schema, ownership policies and job claim function
docs/                  Architecture, local setup and deployment notes
Dockerfile             Production API image for Fly Machines
fly.toml               Fly app, port, health check and restart configuration
```

## Local setup

Requirements: Node.js 22 LTS or newer, npm, a Supabase project and a private R2 bucket.

```sh
npm install
cp .env.example .env
# Fill the server-side values in .env. VITE_* values are public browser settings.
npm run dev
```

The web app runs at `http://localhost:5173`; the API runs at `http://localhost:8080`. Apply `supabase/migrations/202611100001_initial.sql` to the Supabase project before using the library. The API reports `/healthz` while alive and `/readyz` when its required cloud configuration exists.

## Development commands

```sh
npm run dev:web
npm run dev:server
npm run build
npm test
```

`npm test` runs the API's unit and HTTP tests. `npm run build` runs the TypeScript check and production Vite build for the dashboard.

## Environment variables

See the complete placeholder-only [.env.example](.env.example). Never put a Supabase service-role key or R2 credential in a `VITE_*` variable. Do not commit `.env` files. Vercel receives only `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`. Fly receives server-only Supabase and R2 settings through `fly secrets set`.

## Fly.io Machine deployment

The backend is designed for one always-running Machine because that process also polls the durable Supabase import queue. No separate worker Machine or volume is required for this first version. The Fly config keeps the Machine running for job processing; an always-running Machine may incur charges. No Fly app or infrastructure has been created by this repository setup.

### 1. Install the Fly CLI

Follow the current installation steps for your operating system at [Fly.io: Install flyctl](https://fly.io/docs/flyctl/install/). Verify the CLI is available:

```sh
fly version
```

### 2. Authenticate

```sh
fly auth login
fly auth whoami
```

### 3. Set the application name and create the Fly app

Edit `fly.toml`: replace `orbis-manager-api-change-me` with a globally unique app name and set `WEB_ORIGIN` to the exact Vercel origin (scheme and host, no path). Keep `internal_port = 8080`; the Express server binds to `0.0.0.0:8080`.

From this repository root, create the app without deploying:

```sh
fly launch --no-deploy
```

Review the generated/updated configuration and ensure it still uses this repository's Dockerfile and `/healthz` check.

### 4. Configure Fly secrets

Create/configure a private R2 bucket and an R2 API token scoped to that bucket. Apply the Supabase migration first. Then set secrets without putting them in source control:

```sh
fly secrets set \
  SUPABASE_URL="https://your-project.supabase.co" \
  SUPABASE_ANON_KEY="your-public-anon-key" \
  SUPABASE_SERVICE_ROLE_KEY="your-server-only-service-role-key" \
  R2_ACCOUNT_ID="your-cloudflare-account-id" \
  R2_ACCESS_KEY_ID="your-r2-access-key-id" \
  R2_SECRET_ACCESS_KEY="your-r2-secret-access-key" \
  R2_BUCKET="orbis-packages" \
  IMPORT_ALLOWED_HOSTS="downloads.example.org,cdn.example.net"
```

Use only import hostnames you reviewed and intend to support. Leave `IMPORT_ALLOWED_HOSTS` empty to disable URL imports. `WEB_ORIGIN`, `PORT`, `NODE_ENV`, `R2_REGION`, `MAX_PACKAGE_BYTES`, and `SIGNED_URL_TTL_SECONDS` are non-secret configuration in `fly.toml` or can be set as app secrets/variables when needed.

### 5. Deploy

After reviewing secrets and configuration:

```sh
fly deploy
```

This repository setup has not deployed the app.

### 6. Inspect logs and Machine status

```sh
fly logs
fly status
fly machines list
fly checks list
```

Check `https://<your-app-name>.fly.dev/healthz` for the process health endpoint and `/readyz` for cloud configuration readiness.

### 7. Connect Vercel

In Vercel, set the project root directory to `apps/web` and add:

- `VITE_API_BASE_URL=https://<your-app-name>.fly.dev`
- `VITE_SUPABASE_URL=https://your-project.supabase.co`
- `VITE_SUPABASE_ANON_KEY=<Supabase anon key>`

Redeploy the Vercel app after changing variables. Set Fly's `WEB_ORIGIN` to the exact Vercel production origin. Add preview origins only when needed; do not use `*` for credentialed CORS. Configure the R2 bucket CORS policy to allow only the relevant Vercel origin(s), `PUT` and `GET`, and required request headers. R2 remains private; browser transfers use per-object signed URLs.

### Troubleshooting

- **Machine fails its health check:** confirm `PORT=8080`, `internal_port=8080`, and that the server binds `0.0.0.0`; inspect `fly logs` for startup configuration errors.
- **`/healthz` works but `/readyz` returns 503:** configure Supabase URL/anon key and R2 account/access credentials; production also requires the Supabase service-role key for the worker.
- **Vercel requests fail with CORS errors:** set `WEB_ORIGIN` to the exact Vercel origin and redeploy the Fly app. Scheme and hostname must match.
- **Signed R2 upload fails in the browser:** confirm the bucket is private, R2 credentials are scoped to it, and R2 CORS permits the deployed Vercel origin and `PUT`.
- **URL imports fail:** use HTTPS, ensure the exact hostname is in `IMPORT_ALLOWED_HOSTS`, and confirm it resolves only to public addresses. Redirects are revalidated and capped. Login-only or CAPTCHA-protected links are not bypassed.
- **No import progress:** confirm the single app Machine is running and the service-role key is set; the worker shares that process and polls the Supabase queue.
- **Deploy build fails:** run `npm ci && npm run build && npm test` locally and inspect the Fly build logs. The Docker build context must be the repository root because the Dockerfile uses npm workspaces.

## Storage and import behavior

- Package file bytes never use the Fly Machine's local filesystem. Browser uploads use short-lived R2 `PUT` URLs; downloads use short-lived R2 `GET` URLs.
- The API checks package ownership before issuing any signed URL. Package metadata queries include the authenticated user ID and Supabase RLS enforces owner policies.
- Upload completion streams the object back from R2 to compute SHA-256 and checks the declared byte count before marking it ready.
- URL imports use an exact hostname allowlist, HTTPS only, public DNS address checks, pinned DNS resolution, bounded redirects, size limits and a three-attempt retry policy. The worker streams bounded multipart chunks directly to R2 and updates durable job progress in Supabase.
- Import URLs are private per-user job data and are never written to application logs. Provider access restrictions are respected; inaccessible, authenticated or CAPTCHA-gated links fail normally.
- Package metadata extraction is not implemented yet; title/content/version fields remain empty until a documented parser is added and validated.

## Deployment readiness

This is a fresh implementation baseline, not a migrated production system. Before production use, configure real Supabase/R2/Vercel values, apply the migration, set an app-specific Fly name and import host allowlist, configure bucket CORS, and complete the checks below. No secrets are included in the repository.
