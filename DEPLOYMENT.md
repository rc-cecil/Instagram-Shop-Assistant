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
functions check that flag; the recovery job processes received messages.
No Meta or GonkaRouter credentials are committed.

For local verification, run `npm ci`, `npm test`, and `npm run build`.
For a manual deploy after linking the site, run `npx netlify deploy --build --prod`.
Keep the database and Blobs store when redeploying; migrations preserve historical
records. Before changing schema, review the automatic database snapshot in Netlify.

Configure invite-only Identity, server environment variables, and supervised
external tests following SETUP.md. A successful build or migration does not verify
the Meta or GonkaRouter connections.

Database-only tracking removes the Google sync function. Existing historical sync records are retained, but no new sync jobs are created or sent.

When deploying from Windows, first install the Linux image binaries with `npm install --no-save --force @img/sharp-linux-x64@0.34.5 @img/sharp-libvips-linux-x64@1.2.4`, then run `npx netlify deploy --prod --skip-functions-cache`. Netlify-hosted builds install the Linux binaries automatically.
