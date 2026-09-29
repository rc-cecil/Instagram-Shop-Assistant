# Set up and verify Mivelle

## 1. Netlify

Create or connect a Netlify project for this repository. Use the build command `npm run build` and publish directory `dist`. Select a credit-based Free plan if available. Netlify Database migrations in `netlify/database/migrations` run on deploy. Enable Netlify Identity and set **Registration: Invite only**. Invite the owner email and set `OWNER_EMAIL` to that exact email. Never turn on public registration. Identity sign-in must be tested on a deployed preview because Netlify's local development does not support it.

Copy `.env.example` to a private local `.env` for development or add its values to Netlify environment variables. Add `TOKEN_ENCRYPTION_KEY` as 32 random bytes encoded in 64 hexadecimal characters. Keep Meta, Google, GonkaRouter, and token encryption secrets server-only. Never prefix them with `VITE_`. Do not enter an Instagram password in this app.

The invited owner must open the email invitation link and complete **Accept your invitation** by setting a dashboard password. Clicking the email link alone does not finish acceptance. Password recovery links open **Set a new password**. The owner enters and submits passwords themselves; never share them in chat. Keep email confirmation required.

## 2. Meta Instagram connection

Use a Meta developer app configured for **Instagram Login** and the professional account `_testing.account1`. Configure the OAuth redirect URI `https://YOUR-SITE.netlify.app/api/meta/auth/callback` and webhook callback `https://YOUR-SITE.netlify.app/api/meta/webhook`. Set `META_APP_ID`, `META_APP_SECRET`, and a random `META_VERIFY_TOKEN` in Netlify. Subscribe the app to Instagram message events and obtain the `instagram_business_basic`, `instagram_business_manage_messages`, and `instagram_business_content_publish` capabilities. Some accounts require Meta app review or a tester role before live use.

Sign into the dashboard through Netlify Identity, then use **Settings → Connect Instagram**. The callback rejects any username other than `_testing.account1`. The app encrypts the long-lived access token at rest. Confirm the dashboard shows the connected account and send one test DM. If Meta permissions, app review, webhook subscription, or token refresh is missing, keep automation paused. Renew an expired token through the secure connection flow.

## 3. Google Drive and tracker

Share only the approved folder `1egAhH0ODEbFm8fKyxpMe1aPEklf2cWhG` and tracker spreadsheet `1Cjp7kBqiDRF77eFO5KzD_XXPH513keAIAtvqbAFp5HQ` with the service account email. Add its JSON credential as the secret `GOOGLE_SERVICE_ACCOUNT_JSON`; do not commit it. The app lists JPG files from that folder only. Import each file to a specific product, review the photo, and approve it. The app appends snapshots to an `App Log` tab with unique sync IDs and leaves the existing tabs intact. Failed sync jobs remain visible under Activity for retry.

## 4. GonkaRouter

Create a GonkaRouter key in its dashboard and set `GONKA_API_KEY` on Netlify. Copy the current MiniMax-M2.7 input and output USD per million token prices into `GONKA_INPUT_USD_PER_MILLION` and `GONKA_OUTPUT_USD_PER_MILLION`. The app reserves one cent per call against a US$5 monthly cap and shows a separate token-based cost estimate. Review actual provider billing in GonkaRouter. At the cap, if rates are missing, or on an API failure, the DM waits for the owner.

## 5. Supervised launch

Both automation switches are off after deployment. Check the imported historical posts, two known image fingerprints, ten SHEIN links, and order `ORD-20260928-001`. The order remains **Awaiting payment evidence**; no cart task exists for it unless the owner explicitly verifies payment in the dashboard.

Approve one new product photo and caption. Publish one supervised post through Meta, then inspect the Instagram profile and post link. Send a sample DM and continue it through payment evidence, leaving it at **Awaiting owner verification**. Review the post, conversation, tracker, and schedule before enabling automated replies or posting. A real payment decision remains yours; approve or reject that specific order only after checking your MoMo account. Approval then creates a manual cart task.

The archived browser conversation ID `IG-114210563301570` is not necessarily Meta's Instagram-scoped sender ID. Reconcile that customer's identity through the official API before enabling automatic replies for that conversation; do not merge by display name alone.

Proposed posting times, all Africa/Accra: **08:00, 11:45, 15:30, 19:15, 23:00**. DMs are webhook-driven at all hours, subject to Meta's permitted reply window and delivery latency. No polling schedule is used for new DMs; a one-minute recovery job processes events that were durably received but not completed.

## 6. Costs and limits

Netlify's current credit-based Free plan has a 300-credit monthly hard limit. Database, functions, bandwidth, and deployments consume credits. GonkaRouter has separate model usage charges; monitor its dashboard. The app's AI budget guard stops calls before its configured cap, and Netlify's free hard limit avoids auto recharge. Review current provider terms before increasing either budget.
