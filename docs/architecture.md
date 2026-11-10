# Architecture

```text
Vercel React app ──Supabase Auth bearer token──> Fly Express API ──owner-scoped REST──> Supabase
       │                                              │
       └──────── short-lived signed R2 URLs ─────────┴──────────────> private Cloudflare R2
                                                      └─ single Machine import worker
```

The browser authenticates with Supabase and sends its access token to the API. The API validates the token against Supabase Auth before serving protected routes. User-scoped PostgREST calls carry that JWT so row-level security applies in addition to explicit `user_id` filters. The service-role credential is server-only and used for atomic worker queue claims and background job updates.

The browser uploads and downloads package bytes directly to a private R2 bucket. The API generates short-lived signed URLs only after checking package ownership. On upload completion the API streams the R2 object through SHA-256 verification before marking metadata ready. No package bytes are written to Fly's local filesystem.

The first deployment uses one Fly Machine for the HTTP API and a polling worker. Jobs are durable in Supabase, claimed with `FOR UPDATE SKIP LOCKED`, leased, and retried up to three attempts. `apps/server/src/worker` is separated from Express routing so it can move to another Machine later.

URL imports require an operator-maintained exact hostname allowlist. Each URL and redirect must use HTTPS and resolve exclusively to public IP addresses; the chosen DNS address is pinned for the TLS request. The worker does not send cookies, credentials, or bypass provider gates. Redirect count, response size and request timeout are bounded.

Package title/content metadata extraction and device/Bridge integration are not part of this baseline. The Bridge remains a separate project.
