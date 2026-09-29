# Deployment

- Netlify project: `mivelle-shop-assistant`
- Site ID: `2cdbff36-4cbb-4649-bc57-d5b5ea758653`
- URL: https://mivelle-shop-assistant.netlify.app
- Repository: https://github.com/rc-cecil/Instagram-Shop-Assistant
- Build: `npm run build`
- Publish directory: `dist`
- Functions: `netlify/functions`
- Database migrations: `netlify/database/migrations`
- Continuous deployment: GitHub `main`, connected and verified

The first production deploy applied nine migrations and installed eleven functions.
Both customer replies and publishing are paused in the database. The five posting
functions check that flag; recovery and tracker jobs perform infrastructure work.
No Meta, Google or GonkaRouter credentials are committed.

For local verification, run `npm ci`, `npm test`, and `npm run build`.
For a manual deploy after linking the site, run `npx netlify deploy --build --prod`.
Keep the database and Blobs store when redeploying; migrations preserve historical
records. Before changing schema, review the automatic database snapshot in Netlify.

Configure invite-only Identity, server environment variables, and supervised
external tests following SETUP.md. A successful build or migration does not verify
the Meta, Google or GonkaRouter connections.
