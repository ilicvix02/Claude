# World Pulse Pro: owner setup

The license server lives in `worker/` (Cloudflare Worker, free plan). The **Deploy Pro** workflow
(`.github/workflows/pro-deploy.yml`) deploys it, creates the KV namespace, generates the Worker's
P-256 key once (it never leaves Cloudflare), sets the Worker secrets, writes the Worker URL into
`config/site.json` → `pro.api_url` and rebuilds the site so the encrypted Pro bundle is published.

## Steps

1. Repo secrets (Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN`
   (Workers Scripts + Workers KV edit), `CLOUDFLARE_ACCOUNT_ID`, `BREVO_API_KEY`, `ADMIN_TOKEN`.
2. Actions → **Deploy Pro** → Run workflow. The run summary shows the Worker URL,
   `https://worldpulse-pro.<subdomain>.workers.dev`.
3. Ko-fi → Settings → API → **Webhook URL** = `<worker url>/kofi`.
4. Copy Ko-fi's **Verification Token** (same page) into repo secret `KOFI_VERIFICATION_TOKEN`.
5. Re-run **Deploy Pro**. Until then, Ko-fi webhooks are rejected (the run warns about it).
6. Test: Ko-fi's "Send test" on the API page should return 200; check `<worker url>/health`.

## Notes

- Brevo: the sender in `wrangler.toml` (`SENDER_EMAIL`) must be a verified Brevo sender.
- Revoke a key: `POST <worker url>/admin/revoke` with `Authorization: Bearer <ADMIN_TOKEN>`.
- Never delete the Worker secret `PRO_PRIVATE_KEY`: a new key orphans already-published bundles
  until the next site build.
- No Cloudflare secrets → the workflow skips and Pro stays dormant ("launching soon").
