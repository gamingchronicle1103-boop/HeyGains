# Deploy HeyGains on Azure (App Service)

HeyGains is a plain Node.js app (Express + SQLite). No build step — Azure
just runs `npm install` then `npm start` (`node server.js`).

## What you need

- An Azure subscription (an Enterprise agreement works; costs come from it).
- This repo. It is deploy-ready: `server.js` at the root, `package.json`
  with a `start` script, Node 22 (`"engines": { "node": ">=22" }`).

## Steps (Azure portal)

1. **Create a Web App**: Create → Web App → **Linux**, Runtime stack
   **Node 22**, region near your players. Pick the **Basic B1** plan
   (~$13/month) or higher — the Free F1 tier sleeps when idle and has no
   Always On, so the game would keep going down.
2. **Turn on Always On**: App → Configuration → General settings →
   Always On = On. This keeps the 24/7 auto-trader and pings running.
3. **Connect the code**: App → Deployment Center → Source = GitHub →
   pick this repo (`gamingchronicle1103-boop/HeyGains`), branch `main`.
   Every push to `main` redeploys automatically.
4. **Set the environment variables** (App → Configuration → Application
   settings). Do NOT put secrets in the repo — set them here:
   - `DISCORD_INVITE_URL` = `https://discord.gg/4qS2mYbn9g`
   - `OWNER_NAME` = `Lucas`
   - `OWNER_CLAIM_CODE` = the secret owner claim code (ask Lucas — never
     commit it or post it publicly). The first account named Lucas claims
     the owner account with this code.
   - `NODE_ENV` = `production`
   - Do NOT set `PORT` — Azure sets it, and the app listens on
     `process.env.PORT`.
   - Optional: `DONATE_URL` (Ko-fi link), SMTP settings (see `.env.example`)
     for ping / auto-trade emails, `AI_API_URL` / `AI_API_KEY` / `AI_MODEL`
     for Predictor + AUTO AI mode (without these, AI mode falls back to
     rules).
5. **Open the URL** Azure gives the app. The game is live.

## Notes

- **Fresh start**: a new deploy starts with an empty player database
  (`data/hey-gains.db` is created on first run and is git-ignored). Every
  player creates a new account. To carry existing accounts over, copy the
  `data/hey-gains.db` file from the old host into the app's `data/` folder
  (via SSH/Kudu) while the app is stopped, then start it.
- **Files persist**: App Service keeps the `/home` directory between
  restarts, so the database survives restarts and redeploys on a single
  instance. Do not scale out to multiple instances with SQLite.
- **Video**: `public/welcome-tour.mp4` is in this repo, so it deploys with
  the code.
- **Health check**: `<your-url>/api/health` should return
  `{"ok":true,"app":"HeyGains",...}`.
