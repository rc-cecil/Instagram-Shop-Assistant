# Mivelle shop operations

The existing React dashboard and business services now run locally with a Node backend, PostgreSQL, and configurable file storage. The default development settings block outgoing Instagram posts and DMs.

## Start locally

Use Node 22.12+. For immediate local testing, the bundled PGlite mode needs no separate PostgreSQL installation; for standard PostgreSQL use `DATABASE_URL`. Follow [docs/local-development.md](docs/local-development.md) for database, `.env`, migration, and integration setup. Then run:

```bash
npm ci
npm run db:migrate
npm run dev
```

Open `http://localhost:5173`. The backend listens at `http://localhost:3000`. Run `npm test` and `npm run build` for local verification.

Product import, Meta webhook handling, GonkaRouter replies, order and payment decisions, five Ghana-time posting slots, and deduplication retain the existing business logic. SHEIN import extracts a title and one image when available; the owner still verifies price, stock, colours, and sizes. Payment approval creates a manual SHEIN cart task. This repository does not contain working cart automation.

`deployment/` contains old hosting notes and an optional Netlify template for future review. No Netlify project is required for local use.
