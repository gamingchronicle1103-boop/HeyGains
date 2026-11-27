# HeyGains

**Created by Lucas Do.**

A paper stock trading simulator — $100,000 of virtual cash per player **by
default, or pick your own starting amount** — live real prices, paper trading
only. **No real money, no real orders.**

## Rebuild notes (Nov 26, 2026)

This build matches the original Muse sim's wording, section order and
behaviour, tab by tab:

- **Exact wording everywhere:** "REAL PRICES. FAKE MONEY. ALL YOURS TO PLAY.",
  "WHO'S PLAYING?", "NET WORTH · PAPER", "WATCHLIST · LIVE",
  "TOP MOVERS · LIVE", "YOUR TRADES", "NEWS HIGHLIGHTS · BIGGEST MOVERS",
  "AUTO TRADING · VERITY AI RUNS THE SIM", "STOCK PREDICTOR · AI",
  "BUY/SELL PINGS", "EMAIL NOTIFICATIONS", "PING FEED", "STARTING CASH",
  "DISPLAY & PRICES", "PING RULES", "AUTO TRADER", "ABOUT & DANGER ZONE",
  "WHAT'S INSIDE", "HOW IT WORKS", "THE BOARD", "THE GAME". Tabs run
  TRADE, AUTO, PREDICTOR, PINGS, SETTINGS (AUTO dot when on, red unread
  badge on PINGS).
- **Scoreboard:** NET WORTH · PAPER big figure, all-time $ and %, best
  worth, and CASH / TODAY ($ and %) / SESSION boxes, plus the
  extended-prices explainer and quotes-updated time.
- **Trade panel:** BUY/SELL toggle, quick-size buttons (buy 10%/25%/50%/MAX
  of cash, sell 25%/50%/ALL of the position), fractional shares to 4
  decimals, Est. cost/proceeds, Cash after, position line, and an
  "Ask the Predictor about \<symbol\> →" link.
- **Watchlist rows** carry a sparkline (last 40 one-minute closes from the
  live feed), a held amber dot, day % and EXT/AH/PRE %. **Positions**
  show market value, shares @ avg, unrealized $/%, STOP HIT / TARGET HIT
  chips, and "your lines: stop $… · target $…" with the −5%/+10% lines.
- **Predictor:** ticker chips, the 4 suggestion chips, ASK ABOUT
  \<symbol\>, and history cards with outlook chip, timeframe, price at
  ask, quoted question, CONFIDENCE % bar, key-points list and Risks line.
- **Pings:** BUY pings, SELL pings (warns at a −4% day drop on a holding),
  Stop/Target pings, 880 Hz double-beep sound, browser-notification
  permission state, DIP/MOMENTUM steppers (1–15%), 30-minute dedupe per
  symbol+kind, ping banner with VIEW + Dismiss, Mark all read / Clear,
  and per-ping kind chips (BUY·DIP / BUY·MOMENTUM / SELL WATCH /
  SELL·STOP / SELL·TARGET).
- **AUTO:** Credit Saver box, style picker, Auto-sell / Buy the dips /
  Buy momentum toggles, VERITY AI vs RULES ONLY, steppers for budget
  ($50–$50,000, ±$250), max positions (1–12), max trades/day (1–20) and
  check interval (30s/60s/2m/5m) — all clamped server-side too. The
  research pass covers up to 4 candidates (1 under Credit Saver) before
  any buy. Activity log entries carry symbol, shares and fill price.
- **Auth:** SIGN IN / NEW ACCOUNT toggle, PLAYERS chips (OWNER / NO PIN
  YET), and the claim flow — a PIN-less player can be claimed with
  SET PIN & CLAIM IT. Post-register email verification panel with
  VERIFY & START PLAYING, RESEND CODE and SKIP — VERIFY LATER IN PINGS.
- **Email:** queued emails are batched, max 20 per email, and only go to
  the player's own verified address.
- **Styling:** exact palette (bg #06090a, surface #0d1210/#111714, text
  #e8f0e9, dim #7d8f83, border #1e2a22, accent #2bff88, down #ff4757,
  amber #ffb02e, radius 6px), Archivo Black + JetBrains Mono from Google
  Fonts, 5 themes (Terminal #2bff88, Purple #b388ff, Ice Blue #38bdf8,
  Gold #ffb02e, Pink #ff5da2) stored in localStorage
  `verityinvest-theme`; session token `verityinvest-token`, welcome-seen
  flag `verityinvest-welcomed`.

## What it does

- **12+ tickers:** the core watchlist NVDA, TSLA, AMD, META, AMZN, GOOGL,
  MSFT, INTC, TTWO, DUOL, FANG, MCD — **plus your own picks**. Anyone can add
  up to 12 of their own stocks or crypto (type `AAPL`, or `BTC` → `BTC-USD`).
  Each add is verified against the live feed first (no live price, no add),
  then gets live quotes, trading, charts, Predictor and pings, tagged
  YOUR PICK / CRYPTO. Removal is blocked while you hold shares.
- **Welcome page** explaining what HeyGains is to a new visitor, and a
  slide-in **sidebar** (MENU button): your profile (name, owner badge, net
  worth / cash / all-time / positions, best run), quick-jump to every tab,
  quick settings, and at the bottom a **theme color picker** and a
  **feedback box**. Feedback goes to an owner-only inbox — only Lucas can
  read or clear it.
- **Settings tab** (5th tab), filled: Profile with full email preferences,
  **Starting Cash** ($100–$10M, presets $1K–$1M; applying restarts your game
  fresh at that amount, board/settings/email/theme survive), Display & Prices
  (theme, live refresh, overnight prices), Ping Rules, full Auto Trader
  controls, Feedback, and About & Danger Zone (welcome page, reset, sign
  out, Delete Account).
- **Live prices**, refreshed every 10 seconds, with a session badge that
  knows the real NYSE calendar — full-day holidays (Thanksgiving, Christmas,
  MLK Day, Good Friday, etc., with weekend observance) show
  `Closed — <holiday>`, and the day after Thanksgiving, Christmas Eve and
  July 3 close at 1pm ET. After-hours prices are shown vs the 4pm close,
  and trading is open in every session — fills are at the **live extended
  price, never the close**.
- **Overnight prices ON/OFF** (per player, sidebar + Settings): off freezes
  your whole game — board, positions, fills, pings, auto trader — at the
  4pm close outside market hours instead of chasing extended trades.
- **Chart:** Line / Candles toggle, range 1D / 5D / 1M / 3M / 6M / 1Y / 5Y,
  precise candles (up to 220 candles), prev-close line on 1D, ET labels.
  On 1D the premarket and after-hours stretches are shaded **purple**,
  with a caption explaining it.
- **Theme colors:** 5 accent themes — Terminal, Purple, Ice Blue, Gold,
  Pink — recoloring the whole app including charts, saved per device.
- **Positions** flagged at the classic −5% stop / +10% take-profit lines,
  plus your AUTO style's lines. Trade log with realised P&L.
- **Reset button** with confirmation — wipes cash back to your starting
  amount, positions, history, news, Predictor history, pings and best run.
  (The shared live-price cache survives a reset — it is every player's
  fallback when the feed is down, not part of one player's game.)
- **Predictor tab:** ask a question about a ticker; returns
  Bullish / Bearish / Neutral / Mixed + confidence, key points, risks and a
  timeframe, from live price + recent closes + fresh news. History saved,
  clearable.
- **Pings tab:** master ON/OFF, buy pings on dip (default −3%) / momentum
  (default +4%), sell pings at −5% / +10% and style stops/targets,
  adjustable thresholds, in-app banner + sound + browser notification,
  deduped feed. Pings fire overnight too, against the last extended price,
  and are scoped to each player's own board.
- **News Highlights** on the Trade tab: fresh headlines for the 6 biggest movers.
- **AUTO tab:** auto-trading toggle, style picker —
  Scalping (−2%/+3%), Day (−5%/+10%), Swing (−8%/+20%), Position (−12%/+30%) —
  which drives entries, exits and the AI briefing. Before any buy it runs a
  research pass (fresh news + trend stats), logs it as a RESEARCH entry, and
  the buy/pass cites it. Who decides: AI mode (can pass, logs why) or
  Rules-only (strongest research score). Controls: budget per buy, max
  positions, max trades/day, check interval 30s–5m, Run a Check Now, live
  status, full activity log. Auto trades land in the normal trade history.
  Auto-trader entries stay on the core 12; exits cover everything held,
  including your own picks.
- **Credit Saver** (AUTO tab, ON by default): 30-second checks, AI only
  when a real signal fires and only for the strongest one, market hours
  only (9:30 AM–4:00 PM ET), hard cap 2 auto trades/day, enforced
  server-side. **Forced ON for non-owner players only** — the server forces
  it back on whatever a player client sends. **Lucas (owner) gets the off
  switch back** in AUTO + Settings. The AI / Rules picker is available to
  everyone regardless.
- **Email verification:** when someone puts in an email, it is only saved
  as pending and a 6-digit code is emailed to it. No ping or auto-trade
  email goes out until the code is entered. Codes expire in 10 minutes,
  allow 5 tries, resends are rate-limited (max 3/hour, 60s between sends).
  At sign-up the code step comes before entering the app (skippable — the
  same step waits in Pings / Settings, where SAVE EMAIL became SEND CODE
  with a code-entry block). Existing players were auto-verified for the
  address they already had. If SMTP is not configured the app honestly
  reports "SMTP not configured" — it never fakes a sent code.
- **24/7 server auto trading:** the server runs a cycle every 2 minutes —
  refresh quotes, evaluate pings, run the auto-trade cycle — even with the
  page closed. (On a host that sleeps free dynos, use an external uptime
  pinger or a cron hitting `/api/health` to keep it awake; see Deploy below.)
- **Multi-user accounts:** anyone can create an account (name + PIN, hashed)
  or sign in. Every player gets a fully separate game — own starting cash,
  positions, trades, Predictor history, ping feed, settings and auto trader.
  Live prices are shared. **Lucas is the owner account.** Each player sets
  their own email for pings; emails go only to that player's address,
  batched so close-together events ride in one email, with toggles for
  pings/trades and a Send Test Email button.
- **Delete account:** Settings → Danger Zone, enter your PIN to permanently
  delete your account — everything is wiped and you disappear from the
  sign-in player list. A wrong PIN deletes nothing. The owner account can't
  be deleted (it runs the feedback inbox and player list) — for the owner
  the button shows disabled with that explanation.

## Tier 3 features (Nov 27, 2026)

- **Short selling:** SELL with no long position opens a short (negative
  shares, avg short price). Proceeds are credited to cash; BUY against a
  short covers it and books realised P&L (positive when the price fell).
  Covering more than the short holds is rejected — cover first, then buy
  long. The trade button reads SHORT / COVER accordingly, positions show a
  SHORT tag with flipped stop/target lines, and the auto trader covers a
  short at its style's lines instead of selling it.
- **Limit / stop orders:** `orders` table + `POST /api/orders`,
  `GET /api/orders`, `POST /api/orders/:id/cancel` (max 20 open per
  player). Fills at the target price the moment the live price touches it
  (limit buy ≤ target, stop buy ≥ target, limit sell ≥ target,
  stop sell ≤ target), evaluated on every quote refresh and every server
  cycle; a fill the account can't afford stays open and retries. Orders
  are wiped by Reset and by Delete Account.
- **Chart indicators:** volume bars (from the history `v` field, candles
  carry summed volume) along the bottom of the main chart, an MA20 toggle
  (off by default, purple line), and RSI(14) with an
  overbought/oversold/neutral label in the chart caption.
- **Predictor track record:** `GET /api/predictor/track-record` scores
  every past Bullish/Bearish call against the actual move since it was
  asked (correct / wrong / pending / unscored for Neutral/Mixed; accuracy
  % over scored calls). Shown on the Predictor tab.
- **PWA basics:** `public/manifest.json` (HeyGains, real 192/512 PNG
  icons), `public/sw.js` (app-shell cache only — `/api/*` is never
  cached), registered from `app.js` behind a `serviceWorker` guard so a
  failed registration changes nothing.

## Run locally

```bash
cd heygains
npm install
cp .env.example .env   # optional — only needed for AI / email
node server.js
# open http://localhost:3000
```

Requires Node.js 22+ (uses built-in `node:sqlite`, no native build step).
Data lives in `data/hey-gains.db` (SQLite) — or in `$DATA_DIR/hey-gains.db`
when `DATA_DIR` is set. No other setup needed. The server loads `.env`
automatically (via `dotenv`) at startup, so `SMTP_*` / `AI_*` / `OWNER_NAME`
in `.env` take effect without exporting them first.

### Claiming the owner account (Lucas)

1. Open the app and click **Create account**.
2. Create an account with the name `Lucas`. **Only** an account whose name
   matches `OWNER_NAME` (default `Lucas`, case-insensitive) is the owner —
   the first account created is *not* the owner unless it is named Lucas.
   A non-Lucas first account is just a regular player.
3. Set your PIN — that's how you sign in. Only the owner account can turn
   Credit Saver off; every other account gets it forced back on by the server.

## Deploy

### Option A — Render (free, easiest for the 24/7 server)

> **⚠️ Render free has NO persistent disk — data is lost on restart/redeploy.**
> On the free plan the SQLite database lives on Render's ephemeral
> filesystem, so every deploy, restart or sleep/wake **wipes all accounts,
> positions, trades and settings**. To keep data, attach a paid persistent
> disk (Starter instance, $7/mo): `render.yaml` already declares a 1 GB
> disk mounted at `/data` with `DATA_DIR=/data` — uncomment/keep that block
> only on a paid plan, and remove it (and the `DATA_DIR` var) on free.
> There is no free way around this on Render; a VPS (Option C) keeps its
> disk for free.

1. Push this folder to a GitHub repo (do **not** commit `.env` or `data/`).
2. In Render, New → Web Service → pick the repo. Build command:
   `npm install`, Start command: `node server.js`.
3. Set environment variables in Render → Environment:
   `OWNER_NAME=Lucas`, plus `AI_API_URL` / `AI_API_KEY` and `SMTP_*` if you
   want AI and email (see `.env.example`). Leave them unset to run without.
4. Add a **persistent disk** mounted at `/data` and set `DATA_DIR=/data`
   if you want the SQLite database to survive deploys — otherwise Render's
   ephemeral filesystem resets accounts/trades on each deploy. (Free Render
   services also sleep after inactivity; add a free uptime monitor pinging
   `https://<your-app>.onrender.com/api/health` every few minutes to keep the
   2-minute auto-trading cycle alive.)
5. Open the URL, create the Lucas owner account first (see above).

### Option B — Vercel

Vercel is serverless and does **not** suit this app as-is: the 2-minute
server cycle and the SQLite file need a long-running server with a writable
disk. If you use Vercel, host only the frontend there and host
`server.js` on Render / Railway / a VPS, pointing the frontend at its URL.
For a first deploy, use Render (Option A).

### Option C — Any VPS / Raspberry Pi

```bash
git clone <your-repo> && cd heygains
npm install
cp .env.example .env   # fill in OWNER_NAME, AI_*, SMTP_* as needed
node server.js         # or: pm2 start server.js --name heygains
```

Put it behind a reverse proxy (nginx/Caddy) with HTTPS for real users.

## Configuration (env vars)

| Var | Required? | What it does |
|---|---|---|
| `PORT` | no (default 3000) | Port to listen on |
| `DATA_DIR` | no | Where the SQLite DB lives (default `data/` next to `server.js`). Set to `/data` when a persistent disk is mounted there (Render paid plan) — see Deploy. On Render free there is no disk, so data in `data/` is lost on restart/redeploy. |
| `OWNER_NAME` | no (default `Lucas`) | Owner account name |
| `AI_API_URL`, `AI_API_KEY`, `AI_MODEL` | no | OpenAI-compatible chat endpoint for Predictor + AUTO AI mode. Azure OpenAI: `https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-02-01` with your Azure key. Without these, AI mode falls back to rules and says so. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | no | SMTP for ping / auto-trade emails and email-verification codes. Without these, emails are queued + logged and the code/test buttons honestly report "SMTP not configured". |

Never hardcode a real key. Keys live in `.env` (local) or the host's
environment settings (Render/Vercel) only.

## Honest limits

- **Live prices** come from the free Yahoo Finance chart API (no key).
  It can rate-limit or block requests; when it fails the app falls back to
  Stooq closes, then to the last cached price clearly labelled
  `simulated (feed down)`. Yahoo's 1-minute history is capped at ~400 bars,
  so the 1D chart starts mid-afternoon rather than at the 9:30 open, and
  thinly-traded tickers (DUOL, FANG) have genuinely sparse premarket /
  after-hours bars — the chart plots real bars as-is and does not invent
  bars to fill gaps. Overnight, after the 8pm ET extended close, there are
  no new trades until premarket (4am ET), so prices correctly sit at the
  last extended trade.
- **Email** needs SMTP credentials to actually deliver. Without them the app
  queues emails and tells you so; use the Send Test Email button to verify.
  Verification codes are never "sent" when SMTP is missing.
- **AI** needs an `AI_API_KEY` (OpenAI or Azure OpenAI). Without it,
  Predictor and AUTO AI mode fall back to a rules-based answer and say so
  in the output. Credit Saver exists precisely to keep AI calls cheap:
  AI runs only on a real signal, market hours only, max 2 auto trades/day.
- **Accounts** are name + PIN (hashed with SHA-256 + salt) — fine for a
  paper-trading game with friends, not bank-grade auth. Don't reuse a real
  password as a PIN.
- **24/7** only runs while the server is up. A sleeping free host pauses
  the 2-minute cycle until it wakes; see the Render notes above.
