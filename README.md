# Foosball League

Score tracker on Cloudflare Pages + D1. 1v1 win: +3, tournament win (3 players, first to 10): +2, team win: +1 per winner.

## Setup (dashboard + Git, no CLI)

1. Cloudflare dashboard > Storage & Databases > D1 > Create database `foosball-league`.
   Copy its Database ID into `database_id` in `wrangler.toml` and commit.
2. Open the database > Console, paste the contents of `schema.sql`, run it.
3. Push this folder to a GitHub or GitLab repo.
4. Workers & Pages > Create > Pages > Connect to Git > pick the repo.
   Framework preset: None. Build command: empty. Build output directory: `public`.
5. After the first deploy, check Settings > Bindings shows D1 `DB` > `foosball-league`.
   If it is missing, add it there and redeploy.
6. Optional: Settings > Variables and Secrets > add secret `EDIT_PIN`, redeploy.
   Viewing stays open; recording or deleting asks for the PIN once per browser.

Every push to `main` redeploys.

## Local dev

```bash
npm install
npm run db:local
npm run dev      # http://localhost:8788
```
