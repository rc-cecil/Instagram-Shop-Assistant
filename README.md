# Mivelle shop operations

React and TypeScript dashboard with Netlify Functions, Netlify Database, Netlify Blobs, official Meta Instagram Login/webhooks, and GonkaRouter replies. Automation is **off by default**. The seeded account is `_testing.account1`; WhatsApp is not part of this app.

## Local verification

```bash
npm install
npm test
npm run build
```

Use `netlify dev` after linking a Netlify site. Netlify Identity authentication requires a deployed preview; it does not currently run in local `netlify dev`. See [SETUP.md](SETUP.md) for the external connections and supervised test.

## What the app does

- Maintains products, approved photos, posts, conversations, separate orders, owner payment decisions, manual cart tasks, AI usage, and activity in durable Postgres tables.
- Receives Instagram DMs from a signed Meta webhook. Unique message IDs and an outbound send record prevent automatic duplicate replies. If Meta's reply result is uncertain, the record waits for owner review.
- Uses GonkaRouter for concise replies grounded in approved product records and shop policies. Structured order proposals must match approved variants; the customer must explicitly confirm the server-calculated amount before receiving payment instructions. AI cannot approve payment or complete an order.
- Publishes only approved, unused photos in five Ghana-time slots. A missing image or permission holds the post; uncertain publishing is never retried blindly.
- Tracks all operations in the system database. SHEIN imports extract product photos automatically, using a browser when the page loads its gallery with JavaScript. Imported photos stay pending review in Netlify Blobs; direct uploads are also supported.

The SHEIN consumer cart has no verified official integration in this implementation. Payment approval creates a **manual cart task** with the exact agreed variant and link. It does not add an item or place an order.

## Deployment

Hosted app: https://mivelle-shop-assistant.netlify.app

Repository: https://github.com/rc-cecil/Instagram-Shop-Assistant

See [DEPLOYMENT.md](DEPLOYMENT.md) for deployment configuration and [SETUP.md](SETUP.md) for the credentials and supervised rollout. Development UI review can run with `LOCAL_UI_PREVIEW=1 npm run dev`, then open `/?preview=1`. This fixture mode is disabled in production.
