# Foosball League

Score tracker on Cloudflare Workers (static assets + D1). 1v1 win: +3, tournament win (3 players, first to 10): +2, team win: +1 per winner.

## Setup

1. D1 database `foosball-league` with `schema.sql` run in its Console (id is in `wrangler.toml`).
2. Workers & Pages > Create > Import a repository > this repo.
   Build command: empty. Deploy command: `npx wrangler deploy`.
3. Optional: Worker > Settings > Variables and Secrets > add secret `EDIT_PIN`.
   Viewing stays open; recording or deleting asks for the PIN once per browser.

Every push to `main` redeploys.

## Local dev

```bash
npm install
npm run db:local
npm run dev      # http://localhost:8787
```
