# Local Mivelle development

This checkout uses the existing React dashboard and business services. Node 22.12+ runs the backend at `http://localhost:3000`; Vite runs the dashboard at `http://localhost:5173` and proxies `/api` to Node. PostgreSQL and local media files replace Netlify Database and Blobs. An explicit `MIVELLE_TEST_MODE=true` also supports a persistent local PostgreSQL-compatible PGlite database without installing a server. The backend replaces Netlify Functions; an in-process timer checks the five Africa/Accra posting slots. The timer is off unless `ENABLE_LOCAL_SCHEDULER=true`. There is no periodic DM recovery job; incoming webhooks start the existing reply worker. `server/migrations` contains the unchanged SQL migrations.

## Setup

1. Install Node 22.12+. For standard PostgreSQL, install PostgreSQL 14+ separately and create a database/user matching `DATABASE_URL`. For quick local testing, set `MIVELLE_TEST_MODE=true`, clear `DATABASE_URL`, and use `MIVELLE_TEST_DB_DIR=data/pglite`. This writes data under `data/` and survives restarts.
2. Run `npm ci` and copy `.env.example` to `.env`.
3. Set either `DATABASE_URL` or `MIVELLE_TEST_MODE=true`, plus `OWNER_EMAIL`, `SESSION_SECRET` (a long random value), and `OWNER_PASSWORD_HASH`. Generate the last value with `npm run auth:hash -- 'your-long-password'` and paste the output into `.env`. Do not commit `.env`.
4. Run `npm run db:migrate` and `npm run dev`. Open `http://localhost:5173` and sign in with the owner email/password.

## Safe tests

The default flags block Meta publishing and outgoing DMs. The scheduler may check slots but cannot publish while `ENABLE_META_PUBLISHING=false`. Product import is at Products → Import SHEIN link; review the saved product and photo in the dashboard. Importing the same product ID again updates the existing record. Images are written under `MEDIA_DIRECTORY`; `/api/media/:id` serves them. The existing importer retrieves a title and one product image; price, colours, sizes, and stock still require owner review.

`POST /api/local/post` while signed in reports the current slot in dry run mode. Enable `ENABLE_META_PUBLISHING=true` only for an authorized live test, and provide a publicly reachable `PUBLIC_BASE_URL` so Meta can fetch images. The same flag permits scheduled publishing; keep the dashboard automation switch off until ready. `ENABLE_META_DM_SEND=true` permits outgoing Meta replies. The webhook is `/api/meta/webhook`; for real delivery, temporarily expose port 3000 through a public HTTPS tunnel and configure that callback and `META_VERIFY_TOKEN` in Meta. Outbound API calls use the existing Meta and GonkaRouter services. `GONKA_API_KEY`, `GONKA_BASE_URL`, and the two rate variables are required for AI replies.

Payment evidence and owner approval remain separate dashboard actions. Approval creates a manual cart task; this repository has no implemented SHEIN add-to-cart browser automation. There is no active cart feature flag because no cart automation exists. Sign in to SHEIN manually for any later cart implementation; CAPTCHA or MFA must be handled by a person. Never use this app to check out or purchase.

## Deployment later

Host the Vite frontend, Node backend, PostgreSQL, and media storage; set the same environment variables and expose the API at `/api`. Replace the local media adapter if persistent object storage is needed. Run SQL migrations before starting the backend. A hosted scheduler can call the existing posting service. `deployment/netlify.example.toml` is only a reference and is not loaded locally. The old Netlify Identity accounts do not migrate into local login; use the local owner credentials above.

Set `CHROME_EXECUTABLE_PATH` to a locally installed Chrome or Chromium binary if SHEIN needs rendered-page extraction. `FRONTEND_BASE_URL` controls the dashboard redirect after Meta OAuth. The old seed migrations insert historical sample products and orders; review these records before using the local database for live customer work.

## Verification checklist

- Product ingestion: sign in, open Products, submit a full `https://m.shein.com/...-p-<id>.html` URL, and inspect the returned warning and review card. Submit the same URL twice; the product ID should remain one row. SHEIN may block automated extraction, so verify missing price/variants yourself.
- Media: upload a JPG to the product, then open its `/api/media/<photo-id>` URL. The image must survive a backend restart because it is stored under `MEDIA_DIRECTORY`.
- Posting: keep `ENABLE_META_PUBLISHING=false`; sign in and `POST /api/local/post` to inspect the five slots and current slot. Existing tests exercise eligible photo selection, the persistent slot claim, and duplicate prevention with a simulated Meta API. To run a live supervised post, set `ENABLE_META_PUBLISHING=true`, ensure `PUBLIC_BASE_URL` is public HTTPS, and explicitly authorize the post in the dashboard.
- Meta DMs: verify the GET handshake at `/api/meta/webhook` with your `META_VERIFY_TOKEN`; send a signed POST from Meta through a temporary HTTPS tunnel. The unique Meta message ID is stored in `webhook_events`, `messages`, and `reply_jobs`. Outgoing sends stay blocked until `ENABLE_META_DM_SEND=true`.
- GonkaRouter: configure `GONKA_API_KEY`, `GONKA_BASE_URL`, and both token rates. With automated replies enabled in the dashboard and outgoing DMs explicitly enabled, send one test DM from an authorized test account. Check its reply job, AI usage, and conversation record.
- Payment: create an approved product and customer order, add evidence, and use the owner payment decision. Confirm that a cart task appears only after approval. Never use a real payment for local tests.
- Restart: stop and restart `npm run dev`; revisit products, posts, conversations, orders, payment decisions, and media. These are stored in PostgreSQL (or the local PGlite test directory) and `MEDIA_DIRECTORY`, not process memory.

The existing tests use a PostgreSQL compatible in-process engine and mocked external calls. The PGlite test mode does not prove connectivity to an external PostgreSQL server, Meta account, GonkaRouter account, or SHEIN login. Run those real checks only after their credentials and accounts are configured.

The local test mode is for development only. For later hosting, set `DATABASE_URL` and leave `MIVELLE_TEST_MODE=false`; the backend then uses the normal PostgreSQL driver. The `dev:backend` script does not watch source files on systems with low file-watcher limits; restart `npm run dev` after backend code changes.

If SHEIN redirects product requests to `/risk/challenge`, the importer saves the product record but pauses automatic image extraction. Complete SHEIN’s check manually in your browser, then use the product library’s JPG upload and review the product details yourself. The app does not bypass CAPTCHA or other security checks.
