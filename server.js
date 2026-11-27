// HeyGains — standalone paper trading simulator server.
// Created by Lucas Do.
// Stack: Node.js + Express + built-in SQLite (node:sqlite, Node >= 22).
// Paper trading only. No real money, no real orders.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
// Load .env first, so SMTP_*/AI_*/OWNER_NAME/DATA_DIR in a .env file
// actually reach the code below (PORT, DATA_DIR, OWNER_NAME, mailer, AI).
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(DATA_DIR, 'hey-gains.db'));

const APP_NAME = 'HeyGains';
const TICKERS = ['NVDA', 'TSLA', 'AMD', 'META', 'AMZN', 'GOOGL', 'MSFT', 'INTC', 'TTWO', 'DUOL', 'FANG', 'MCD'];
const NAMES = { NVDA: 'NVIDIA', TSLA: 'Tesla', AMD: 'Adv. Micro Devices', META: 'Meta Platforms', AMZN: 'Amazon', GOOGL: 'Alphabet', MSFT: 'Microsoft', INTC: 'Intel', TTWO: 'Take-Two Interactive', DUOL: 'Duolingo', FANG: 'Diamondback Energy', MCD: "McDonald's" };
const KNOWN_CRYPTO = new Set(['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'LTC', 'AVAX', 'LINK', 'DOT', 'MATIC', 'ATOM', 'USDT', 'USDC', 'BNB', 'TRX', 'NEAR', 'APT', 'ARB', 'OP', 'PEPE', 'SHIB']);
const STYLES = {
  scalping: { label: 'Scalping', stop: -2, target: 3, window: 'Minutes–hours', horizon: 'Minutes–hours' },
  day: { label: 'Day Trading', stop: -5, target: 10, window: 'Same day–2 days', horizon: 'Same day–2 days' },
  swing: { label: 'Swing', stop: -8, target: 20, window: 'Days–weeks', horizon: 'Days–weeks' },
  position: { label: 'Position', stop: -12, target: 30, window: 'Weeks–months', horizon: 'Weeks–months' },
};
const START_CASH = 100000;
const OWNER_NAME = (process.env.OWNER_NAME || 'Lucas').toLowerCase();
// Owner claim secret (H4): claiming — or registering with a PIN — the
// owner-named account requires OWNER_CLAIM_CODE. If the server has no code
// set, owner claims are refused outright (fail closed), so a fresh deploy
// can never be taken over by the first "Lucas" registrant. Lucas sets his
// own code as an env var; it is never committed anywhere.
const OWNER_CLAIM_CODE = (process.env.OWNER_CLAIM_CODE || '').trim();
function ownerClaimOk(code) {
  if (!OWNER_CLAIM_CODE) return { ok: false, error: 'Owner claims are locked — the server owner must set OWNER_CLAIM_CODE first (see .env.example)' };
  if (String(code || '').trim() !== OWNER_CLAIM_CODE) return { ok: false, error: 'Wrong owner claim code' };
  return { ok: true };
}
// Discord invite link for the HeyGains community server.
// Set DISCORD_INVITE_URL in the environment (or .env) to a real invite,
// e.g. https://discord.gg/xxxxxx — until then it stays empty and the
// in-app Discord buttons render as "coming soon" and link nowhere.
// Only genuine discord.gg / discord.com/invite URLs are accepted, so a
// typo or a wrong URL can never send players somewhere else.
const _discordRaw = (process.env.DISCORD_INVITE_URL || '').trim();
const DISCORD_INVITE_URL = /^https:\/\/(discord\.gg\/[A-Za-z0-9_-]+|discord\.com\/invite\/[A-Za-z0-9_-]+)\/?$/.test(_discordRaw) ? _discordRaw : '';
// Donations button: driven by DONATE_URL (e.g. the owner's Ko-fi link).
// Only a real http(s) URL is accepted; empty means the button renders as
// "DONATE — COMING SOON" and links nowhere. No donation URL is ever
// invented here — Lucas pastes his own link in the env when he's ready.
const _donateRaw = (process.env.DONATE_URL || '').trim();
const DONATE_URL = /^https?:\/\/\S+$/.test(_donateRaw) ? _donateRaw : '';

// ---------- DB ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE COLLATE NOCASE,
  pin_hash TEXT, salt TEXT, email TEXT DEFAULT '', email_verified INTEGER DEFAULT 0,
  pending_email TEXT DEFAULT '', is_owner INTEGER DEFAULT 0, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS game (user_id INTEGER PRIMARY KEY, cash REAL, best_run REAL, created_at INTEGER);
CREATE TABLE IF NOT EXISTS positions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, symbol TEXT, shares REAL, avg_cost REAL, created_at INTEGER);
CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, symbol TEXT, side TEXT, shares REAL, price REAL, total REAL, pnl REAL, session TEXT, source TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS predictor_chats (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, symbol TEXT, question TEXT, answer TEXT, outlook TEXT, confidence INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, symbol TEXT, kind TEXT, message TEXT, price REAL, created_at INTEGER, read INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS auto_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, kind TEXT, message TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS email_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, subject TEXT, body TEXT, status TEXT DEFAULT 'queued', created_at INTEGER);
CREATE TABLE IF NOT EXISTS quote_cache (symbol TEXT PRIMARY KEY, price REAL, prev_close REAL, regular_close REAL, change_pct REAL, ext_change_pct REAL, source TEXT, as_of INTEGER, last_trade_label TEXT);
CREATE TABLE IF NOT EXISTS settings (user_id INTEGER PRIMARY KEY, json TEXT);
CREATE TABLE IF NOT EXISTS custom_symbols (user_id INTEGER, symbol TEXT, kind TEXT, name TEXT, created_at INTEGER, PRIMARY KEY(user_id, symbol));
CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, message TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, symbol TEXT, message TEXT, created_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_chat_symbol_time ON chat_messages(symbol, created_at);
CREATE TABLE IF NOT EXISTS email_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, email TEXT, code_hash TEXT, salt TEXT, attempts INTEGER DEFAULT 0, created_at INTEGER, expires_at INTEGER, used INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS net_worth_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, net_worth REAL, created_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_nw_snapshots_user_time ON net_worth_snapshots(user_id, created_at);
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, symbol TEXT, side TEXT, type TEXT, target_price REAL, shares REAL, status TEXT DEFAULT 'open', created_at INTEGER, filled_at INTEGER, fill_price REAL);
CREATE TABLE IF NOT EXISTS predictor_ai_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, created_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_pred_ai_usage_user_time ON predictor_ai_usage(user_id, created_at);
CREATE TABLE IF NOT EXISTS pin_lockouts (user_id INTEGER PRIMARY KEY, count INTEGER DEFAULT 0, locked_until INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS leagues (user_id INTEGER PRIMARY KEY, tier INTEGER DEFAULT 0, week_key TEXT DEFAULT '', week_start_worth REAL, last_result TEXT DEFAULT '', last_result_kind TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS league_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS user_progress (user_id INTEGER PRIMARY KEY, xp INTEGER DEFAULT 0, streak INTEGER DEFAULT 0, last_active_date TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS challenge_claims (user_id INTEGER, date TEXT, key TEXT, xp INTEGER, created_at INTEGER, PRIMARY KEY(user_id, date, key));
CREATE TABLE IF NOT EXISTS ticker_views (user_id INTEGER, symbol TEXT, date TEXT, created_at INTEGER, PRIMARY KEY(user_id, symbol, date));
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
`);
// Migrations for v11-era DBs (old file) (same file name was hey-gains.db; also handle new columns)
try { db.exec(`ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE quote_cache ADD COLUMN spark TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE predictor_chats ADD COLUMN price_at_ask REAL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE predictor_chats ADD COLUMN timeframe TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE predictor_chats ADD COLUMN key_points TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE predictor_chats ADD COLUMN risks TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE predictor_chats ADD COLUMN mode TEXT DEFAULT 'ai'`); } catch {}
try { db.exec(`ALTER TABLE predictor_chats ADD COLUMN outlook_source TEXT DEFAULT 'rules'`); } catch {}
try { db.exec(`ALTER TABLE auto_log ADD COLUMN symbol TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE auto_log ADD COLUMN shares REAL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE auto_log ADD COLUMN price REAL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE game ADD COLUMN best_worth REAL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN pending_email TEXT DEFAULT ''`); } catch {}
// Email queue retry bookkeeping (see flushEmailQueue): attempts + next retry time.
try { db.exec(`ALTER TABLE email_queue ADD COLUMN attempts INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE email_queue ADD COLUMN next_attempt_at INTEGER DEFAULT 0`); } catch {}
// Existing players are auto-verified for the address they already had.
try { db.prepare(`UPDATE users SET email_verified=1 WHERE email<>'' AND (email_verified IS NULL OR email_verified=0)`).run(); } catch {}
try { db.prepare('UPDATE game SET best_worth=cash WHERE best_worth IS NULL OR best_worth=0').run(); } catch {}
// If an old hey-gains.db exists, leave it alone; new DB is hey-gains.db.

const DEFAULT_SETTINGS = () => ({
  dipPct: -3, momentumPct: 4, pingsOn: true, buyPings: true, sellPings: true, stopTargetPings: true, soundOn: true, browserNotify: false,
  autoSell: true, buyDips: true, buyMomentum: true,
  overnightPrices: true, liveRefresh: true, startCash: START_CASH,
  autoOn: false, autoMode: 'rules', style: 'day', budgetPerBuy: 10000, maxPositions: 10, maxTradesPerDay: 5, checkSeconds: 30,
  creditSaver: true, emailPings: true, emailTrades: true,
  savedMaxTradesPerDay: null, savedCheckSeconds: null, // owner's pre-Credit-Saver values, restored when Saver is turned off
});
function getSettings(uid) {
  const row = db.prepare('SELECT json FROM settings WHERE user_id=?').get(uid);
  if (!row) { const s = DEFAULT_SETTINGS(); db.prepare('INSERT INTO settings(user_id,json) VALUES(?,?)').run(uid, JSON.stringify(s)); return s; }
  return { ...DEFAULT_SETTINGS(), ...JSON.parse(row.json) };
}
function saveSettings(uid, s) {
  db.prepare('INSERT INTO settings(user_id,json) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET json=excluded.json').run(uid, JSON.stringify(s));
}
// Credit Saver effective settings: forced ON for non-owners only.
const CHECK_STEPS = [30, 60, 120, 300];
function effectiveSettings(uid, user) {
  const s = getSettings(uid);
  s.budgetPerBuy = Math.min(50000, Math.max(50, +s.budgetPerBuy || 10000));
  s.maxPositions = Math.min(12, Math.max(1, +s.maxPositions || 10));
  s.maxTradesPerDay = Math.min(20, Math.max(1, +s.maxTradesPerDay || 5));
  s.checkSeconds = CHECK_STEPS.reduce((a, b) => Math.abs(b - (+s.checkSeconds || 30)) < Math.abs(a - (+s.checkSeconds || 30)) ? b : a);
  // Effective-only clamp: this mutates the returned copy, never the stored
  // settings row, so the owner's own maxTradesPerDay / checkSeconds survive.
  if (!user?.is_owner) { s.creditSaver = true; s.checkSeconds = 30; s.maxTradesPerDay = 2; }
  else if (s.creditSaver) { s.checkSeconds = 30; s.maxTradesPerDay = Math.min(s.maxTradesPerDay || 2, 2); }
  return s;
}
function getGame(uid) {
  let g = db.prepare('SELECT * FROM game WHERE user_id=?').get(uid);
  if (!g) { const sc = getSettings(uid).startCash || START_CASH; db.prepare('INSERT INTO game(user_id,cash,best_run,best_worth,created_at) VALUES(?,?,?,?,?)').run(uid, sc, 0, sc, Date.now()); g = db.prepare('SELECT * FROM game WHERE user_id=?').get(uid); }
  return g;
}
// One shared starting-cash validator (M6): register and /api/settings/
// start-cash used to disagree (register floored, settings accepted
// fractions like $100.50). Both now go through here.
function validateStartCash(amount) {
  const v = Math.floor(+amount);
  if (!Number.isFinite(v) || v < 100 || v > 10000000) return { error: 'Starting cash must be $100–$10,000,000' };
  return { value: v };
}
// PIN hashing (H5): scrypt (salted, memory-hard) for new PINs. Legacy rows
// hashed with single-round SHA-256 still verify, and are upgraded to scrypt
// on the next successful login. Comparisons are constant-time. A legacy
// hash is 64 hex chars (SHA-256); a scrypt hash is 128 (64 bytes).
function scryptHash(pin, salt) { return crypto.scryptSync(String(pin), salt, 64).toString('hex'); }
function hashPin(pin, salt) { return scryptHash(pin, salt); } // new PINs: scrypt
function verifyPin(pin, user) {
  const stored = user.pin_hash || '';
  const salt = user.salt || '';
  try {
    let hex;
    if (stored.length === 64) hex = crypto.createHash('sha256').update(salt + ':' + String(pin)).digest('hex'); // legacy
    else hex = scryptHash(pin, salt);
    const a = Buffer.from(hex, 'hex'), b = Buffer.from(stored, 'hex');
    if (a.length !== b.length) return null;
    return crypto.timingSafeEqual(a, b) ? (stored.length === 64 ? 'legacy' : 'scrypt') : null;
  } catch { return null; }
}
function upgradePinHash(uid, pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET pin_hash=?, salt=? WHERE id=?').run(scryptHash(pin, salt), salt, uid);
}
function newToken() { return crypto.randomBytes(32).toString('hex'); }
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // sessions expire after 30 days
// PIN lockout: per-user failed-login tracking, persisted in SQLite so a
// restart does not reset it. 5 wrong PINs lock the account for 15 minutes;
// a successful login clears the counter.
const PIN_LOCKOUT_MAX = 5, PIN_LOCKOUT_MS = 15 * 60 * 1000;
function pinLockoutFor(uid) {
  const row = db.prepare('SELECT * FROM pin_lockouts WHERE user_id=?').get(uid);
  if (!row) return null;
  if (row.locked_until && Date.now() >= row.locked_until) { db.prepare('DELETE FROM pin_lockouts WHERE user_id=?').run(uid); return null; }
  return { count: row.count, lockedUntil: row.locked_until || 0 };
}
function recordFailedPin(uid) {
  const cur = db.prepare('SELECT * FROM pin_lockouts WHERE user_id=?').get(uid);
  const count = (cur?.count || 0) + 1;
  const lockedUntil = count >= PIN_LOCKOUT_MAX ? Date.now() + PIN_LOCKOUT_MS : 0;
  db.prepare('INSERT INTO pin_lockouts(user_id,count,locked_until) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET count=excluded.count, locked_until=excluded.locked_until').run(uid, count, lockedUntil);
  return { count, lockedUntil };
}
function clearFailedPins(uid) { db.prepare('DELETE FROM pin_lockouts WHERE user_id=?').run(uid); }
function boardSymbols(uid) {
  const custom = db.prepare('SELECT * FROM custom_symbols WHERE user_id=? ORDER BY symbol').all(uid);
  return { core: [...TICKERS], custom, all: [...TICKERS, ...custom.map(c => c.symbol)] };
}
function customName(uid, sym) {
  const r = db.prepare('SELECT name FROM custom_symbols WHERE user_id=? AND symbol=?').get(uid, sym);
  return r?.name || NAMES[sym] || sym;
}

// ---------- Time / session (ET) + NYSE holidays ----------
function etDate(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false });
  const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, weekday: p.weekday, hour: +p.hour % 24, minute: +p.minute };
}
function nthWeekday(year, month, weekday /*0=Sun*/, n) { // nth weekday of month
  const first = new Date(Date.UTC(year, month - 1, 1));
  const off = (weekday - first.getUTCDay() + 7) % 7;
  return off + 1 + (n - 1) * 7;
}
function lastWeekday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0));
  const off = (last.getUTCDay() - weekday + 7) % 7;
  return last.getUTCDate() - off;
}
function easterSunday(year) { // Anonymous Gregorian algorithm
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}
function observed(year, month, day) { // fixed-date holiday, weekend observance
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  // Jan 1 on a Saturday is observed Dec 31 of the PRIOR year — the returned
  // year can differ from the holiday's year, so callers must compare years.
  if (dow === 6) return day === 1 ? { year: year - 1, month: 12, day: 31 } : { year, month, day: day - 1 }; // Sat -> Fri before
  if (dow === 0) return { year, month, day: day + 1 }; // Sun -> Mon after
  return { year, month, day };
}
function nyseHoliday(year, month, day) {
  const eq = o => o.year === year && o.month === month && o.day === day;
  // New Year's Day: also check next year's Jan 1, whose Saturday observance
  // lands on Dec 31 of THIS year (e.g. Jan 1, 2022 was a Saturday).
  if (eq(observed(year, 1, 1)) || eq(observed(year + 1, 1, 1))) return "New Year's Day";
  if (month === 1 && day === nthWeekday(year, 1, 1, 3)) return 'MLK Day';
  if (month === 2 && day === nthWeekday(year, 2, 1, 3)) return "Presidents' Day";
  const e = easterSunday(year);
  const goodFriday = new Date(Date.UTC(year, e.month - 1, e.day - 2));
  if (month === goodFriday.getUTCMonth() + 1 && day === goodFriday.getUTCDate()) return 'Good Friday';
  if (month === 5 && day === lastWeekday(year, 5, 1)) return 'Memorial Day';
  if (eq(observed(year, 6, 19))) return 'Juneteenth';
  if (eq(observed(year, 7, 4))) return 'Independence Day';
  if (month === 9 && day === nthWeekday(year, 9, 1, 1)) return 'Labor Day';
  if (month === 11 && day === nthWeekday(year, 11, 4, 4)) return 'Thanksgiving';
  if (eq(observed(year, 12, 25))) return 'Christmas';
  return null;
}
// Convert an ET wall-clock time (year/month/day hour:minute) to epoch ms.
// Tries EST (-5) then EDT (-4) and keeps the one that formats back correctly.
function etWallToMs(year, month, day, hour, minute = 0) {
  for (const off of [5, 4]) {
    const ms = Date.UTC(year, month - 1, day, hour + off, minute);
    const p = etDate(new Date(ms));
    if (p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute) return ms;
  }
  return Date.UTC(year, month - 1, day, hour + 5, minute);
}
// [start, end) epoch ms of one ET calendar day (handles 23/25-hour DST days).
function etDayBounds(year, month, day) {
  const start = etWallToMs(year, month, day, 0, 0);
  const next = new Date(Date.UTC(year, month - 1, day) + 86400000);
  return [start, etWallToMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0)];
}
function isEarlyClose(year, month, day, weekday) {
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  // Day after Thanksgiving (4th Friday in Nov), Christmas Eve (Dec 24 weekday), July 3 (weekday, when Jul 4 is a holiday week)
  if (month === 11 && day === nthWeekday(year, 11, 5, 4)) return true;
  if (month === 12 && day === 24) return true;
  if (month === 7 && day === 3) return true;
  return false;
}
function marketSession(d = new Date()) {
  const { year, month, day, weekday, hour, minute } = etDate(d);
  const mins = hour * 60 + minute;
  const hol = nyseHoliday(year, month, day);
  if (hol) return 'Closed — ' + hol;
  if (weekday === 'Sat' || weekday === 'Sun') return 'Weekend';
  if (isEarlyClose(year, month, day, weekday)) {
    if (mins >= 570 && mins < 780) return 'Open';
    if (mins >= 780) return 'Closed — Early Close';
    if (mins >= 240 && mins < 570) return 'Premarket';
    return 'Overnight';
  }
  if (mins >= 570 && mins < 960) return 'Open';
  if (mins >= 240 && mins < 570) return 'Premarket';
  if (mins >= 960 && mins < 1200) return 'After Hours';
  return 'Overnight';
}
function isMarketHours() { return marketSession() === 'Open'; }
// Effective price for a player: overnight off => freeze at 4pm close outside Open.
function effectiveQuotesFor(uid, quotes) {
  const s = getSettings(uid);
  if (s.overnightPrices !== false) return quotes;
  if (isMarketHours()) return quotes;
  const out = {};
  for (const [sym, q] of Object.entries(quotes)) out[sym] = { ...q, price: q.regularClose ?? q.price, changePct: q.regularClose ? ((q.regularClose - q.prevClose) / q.prevClose) * 100 : q.changePct, extChangePct: 0, source: q.source, frozenAtClose: true };
  return out;
}

// ---------- Live prices ----------
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; HeyGains/1.0)' };
async function yahooChart(sym, range = '1d', interval = '1m') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=true`;
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('yahoo ' + r.status);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error('no result');
  return res;
}
// Quote cache (in-memory, ~10 s): concurrent requests share one in-flight
// Yahoo fetch, and repeat calls inside the window reuse the result instead
// of hammering the feed. The quote_cache DB table is only a fallback — it is
// read when the live feed fails, never as the primary price source.
const QUOTE_CACHE_TTL_MS = 10 * 1000;
let liveQuoteCache = { key: null, at: 0, data: null, promise: null };
async function fetchLiveQuotes(symbols = null) {
  const list = symbols || [...new Set([...TICKERS, ...db.prepare('SELECT DISTINCT symbol FROM custom_symbols').all().map(r => r.symbol)])];
  const key = [...list].sort().join(',');
  const now = Date.now();
  if (liveQuoteCache.key === key && liveQuoteCache.data && now - liveQuoteCache.at < QUOTE_CACHE_TTL_MS) return liveQuoteCache.data;
  if (liveQuoteCache.key === key && liveQuoteCache.promise) return liveQuoteCache.promise;
  const p = fetchLiveQuotesFresh(list).then(data => { liveQuoteCache = { key, at: Date.now(), data, promise: null }; return data; })
    .catch(e => { if (liveQuoteCache.key === key) liveQuoteCache.promise = null; throw e; });
  liveQuoteCache = { key, at: liveQuoteCache.at, data: liveQuoteCache.data, promise: p };
  return p;
}
async function fetchLiveQuotesFresh(symbols = null) {
  const list = symbols || [...new Set([...TICKERS, ...db.prepare('SELECT DISTINCT symbol FROM custom_symbols').all().map(r => r.symbol)])];
  const out = {};
  await Promise.all(list.map(async (sym) => {
    try {
      const res = await yahooChart(sym, '1d', '1m');
      const meta = res.meta || {};
      const ts = res.timestamp || [];
      const closes = (res.indicators?.quote?.[0]?.close || []);
      const postEndQ = meta.currentTradingPeriod?.post?.end ?? null;
      let lastBar = null;
      // Only skip bars past post-market end — do NOT filter on volume here:
      // Yahoo reports volume 0 for all after-hours bars, so that would
      // freeze the live price at the 4 PM close for every ticker.
      for (let i = ts.length - 1; i >= 0; i--) { if (closes[i] == null) continue; if (postEndQ && ts[i] > postEndQ) continue; lastBar = { t: ts[i] * 1000, price: closes[i] }; break; }
      const regEnd = meta.currentTradingPeriod?.regular?.end;
      let trueClose = null;
      if (regEnd) for (let i = ts.length - 1; i >= 0; i--) { if (ts[i] <= regEnd && closes[i] != null) { trueClose = closes[i]; break; } }
      // Sparkline = the FULL 1D session, downsampled to 40 evenly spaced
      // points (first bar = day open area, last = current price), so the
      // watchlist preview matches the main 1D chart. It used to be
      // slice(-40) — only the last 40 minutes — which looked nothing like
      // the day's move and went flat/stale after close.
      const allCloses = closes.filter(c => c != null);
      const spark = allCloses.length <= 40 ? allCloses : Array.from({ length: 40 }, (_, k) => allCloses[Math.round(k * (allCloses.length - 1) / 39)]);
      const close4pm = trueClose ?? meta.regularMarketPrice ?? meta.chartPreviousClose ?? null;
      const price = lastBar ? lastBar.price : (meta.regularMarketPrice ?? null);
      if (price == null) throw new Error('no price');
      const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
      const lastTrade = lastBar ? new Date(lastBar.t).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET' : '';
      out[sym] = { symbol: sym, price, prevClose, regularClose: close4pm ?? prevClose, changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0, extChangePct: (close4pm ?? prevClose) ? ((price - (close4pm ?? prevClose)) / (close4pm ?? prevClose)) * 100 : 0, source: 'live', asOf: Date.now(), lastTrade, spark, name: meta.longName || meta.shortName || NAMES[sym] || sym };
    } catch (e) {
      try {
        const base = sym.replace('-USD', '').toLowerCase();
        const r = await fetch(`https://stooq.com/q/l/?s=${base}.us&f=sd2t2ohlcv&h&e=csv`, { signal: AbortSignal.timeout(6000) });
        const txt = await r.text();
        const row = txt.trim().split('\n')[1]?.split(',');
        const close = row ? parseFloat(row[6]) : NaN;
        if (!isNaN(close)) { const prev = db.prepare('SELECT * FROM quote_cache WHERE symbol=?').get(sym); const pc = prev?.prev_close ?? close; out[sym] = { symbol: sym, price: close, prevClose: pc, regularClose: prev?.regular_close ?? close, changePct: pc ? ((close - pc) / pc) * 100 : 0, extChangePct: 0, source: 'stooq-close (yesterday)', asOf: Date.now(), lastTrade: '', spark: prev?.spark ? JSON.parse(prev.spark) : [], name: NAMES[sym] || sym }; return; }
        throw new Error('stooq parse');
      } catch (e2) {
        const prev = db.prepare('SELECT * FROM quote_cache WHERE symbol=?').get(sym);
        if (prev) out[sym] = { symbol: sym, price: prev.price, prevClose: prev.prev_close, regularClose: prev.regular_close, changePct: prev.change_pct, extChangePct: prev.ext_change_pct, source: 'simulated (feed down)', asOf: prev.as_of, lastTrade: prev.last_trade_label || '', spark: prev.spark ? JSON.parse(prev.spark) : [], name: NAMES[sym] || sym };
      }
    }
  }));
  const missingCore = TICKERS.filter(s => !out[s]);
  if (!Object.keys(out).length || missingCore.length) throw new Error('live feed incomplete — missing: ' + (missingCore.join(',') || 'all'));
  const now = Date.now();
  for (const sym of Object.keys(out)) {
    const q = out[sym];
    db.prepare(`INSERT INTO quote_cache(symbol,price,prev_close,regular_close,change_pct,ext_change_pct,source,as_of,last_trade_label,spark)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET price=excluded.price,prev_close=excluded.prev_close,regular_close=excluded.regular_close,change_pct=excluded.change_pct,ext_change_pct=excluded.ext_change_pct,source=excluded.source,as_of=excluded.as_of,last_trade_label=excluded.last_trade_label,spark=excluded.spark`)
      .run(sym, q.price, q.prevClose, q.regularClose, q.changePct, q.extChangePct, q.source, now, q.lastTrade, JSON.stringify(q.spark || []));
  }
  return out;
}
function cachedQuotes() {
  const rows = db.prepare('SELECT * FROM quote_cache').all();
  const out = {};
  for (const r of rows) out[r.symbol] = { symbol: r.symbol, price: r.price, prevClose: r.prev_close, regularClose: r.regular_close, changePct: r.change_pct, extChangePct: r.ext_change_pct, source: r.source, asOf: r.as_of, lastTrade: r.last_trade_label || '', spark: r.spark ? JSON.parse(r.spark) : [], name: NAMES[r.symbol] || r.symbol };
  return out;
}
// History cache (H1, in-memory, 45 s): concurrent requests share one
// in-flight Yahoo fetch; a Yahoo 429 retries with backoff; if the feed stays
// down, the last good history is served as 'stale' instead of a 502.
const HISTORY_CACHE_TTL_MS = 45 * 1000;
const historyCache = new Map(); // key -> { data, at, promise }
async function yahooChartRetry(sym, range, interval, attempts = 3) {
  let delay = 1000;
  for (let i = 0; i < attempts; i++) {
    try { return await yahooChart(sym, range, interval); }
    catch (e) {
      const is429 = /429/.test(String(e.message || ''));
      if (!is429 || i === attempts - 1) throw e;
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}
async function fetchHistory(sym, range) {
  const key = sym + '|' + range;
  const now = Date.now();
  const cached = historyCache.get(key);
  if (cached?.data && now - cached.at < HISTORY_CACHE_TTL_MS) return cached.data;
  if (cached?.promise) return cached.promise;
  const p = fetchHistoryFresh(sym, range).then(data => { historyCache.set(key, { data, at: Date.now(), promise: null }); return data; })
    .catch(e => {
      const prev = historyCache.get(key);
      historyCache.set(key, { data: prev?.data || null, at: prev?.at || 0, promise: null });
      if (prev?.data) return { ...prev.data, source: 'stale', staleAsOf: prev.at };
      throw e;
    });
  historyCache.set(key, { data: cached?.data || null, at: cached?.at || 0, promise: p });
  return p;
}
async function fetchHistoryFresh(sym, range) {
  const map = { '1D': ['1d', '1m'], '5D': ['5d', '15m'], '1M': ['1mo', '1d'], '3M': ['3mo', '1d'], '6M': ['6mo', '1wk'], '1Y': ['1y', '1wk'], '5Y': ['5y', '1mo'] };
  const [r, iv] = map[range] || map['1D'];
  const res = await yahooChartRetry(sym, r, iv);
  const ts = res.timestamp || [];
  const q = res.indicators?.quote?.[0] || {};
  // After-hours bars: Yahoo reports volume 0 for ALL extended-hours bars,
  // even liquid tickers like NVDA — so volume can NOT be used to tell a
  // real after-hours bar from a stale one (a previous fix did exactly that
  // and wiped every ticker's after-hours chart). Only drop bars past the
  // post-market end (20:00 ET), and dedupe repeated timestamps (Yahoo
  // repeats the last bar).
  const meta = res.meta || {};
  const postEnd = meta.currentTradingPeriod?.post?.end ?? null;
  const regStartMs = (meta.currentTradingPeriod?.regular?.start ?? null) != null ? meta.currentTradingPeriod.regular.start * 1000 : null;
  const regEndMs = (meta.currentTradingPeriod?.regular?.end ?? null) != null ? meta.currentTradingPeriod.regular.end * 1000 : null;
  const stepMs = range === '1D' ? 60000 : range === '5D' ? 15 * 60 * 1000 : 0;
  const pts = [];
  const seenTs = new Set();
  for (let i = ts.length - 1; i >= 0; i--) {
    if (q.close?.[i] == null) continue;
    if (postEnd && ts[i] > postEnd) continue;
    // M11: snap the bar timestamp down to its grid boundary — Yahoo's last
    // (partial) bar carries wall-clock seconds, which used to make tail
    // points land at odd seconds and the point count vary between fetches.
    const tMs = stepMs ? Math.floor(ts[i] * 1000 / stepMs) * stepMs : ts[i] * 1000;
    if (seenTs.has(tMs)) continue;
    seenTs.add(tMs);
    const v = q.volume?.[i] ?? 0;
    let o = q.open?.[i] ?? q.close[i], h = q.high?.[i] ?? q.close[i], l = q.low?.[i] ?? q.close[i];
    // C2: a zero-volume bar OUTSIDE the regular session never traded — its
    // open/high/low are quotes, not trades, and their wild wicks used to
    // inflate the Y-scale and squeeze the real session. Flatten it to its
    // close. (Regular-session zero-volume bars are left alone: a halted or
    // untraded minute inside the session is real data.)
    if ((range === '1D' || range === '5D') && v === 0 && regStartMs != null && regEndMs != null && (tMs < regStartMs || tMs >= regEndMs)) { o = h = l = q.close[i]; }
    pts.push({ t: tMs, o, h, l, c: q.close[i], v });
  }
  pts.reverse();
  // L9: drop single-bar spikes — a bar that jumps >25% from BOTH neighbours
  // and then reverts is a bad Yahoo bar, not a trade. A real move stays
  // (the next bar doesn't revert), so genuine +25% days survive.
  for (let i = pts.length - 2; i >= 1; i--) {
    const prev = pts[i - 1].c, cur = pts[i].c, next = pts[i + 1].c;
    if (prev > 0 && next > 0 && Math.abs(cur - prev) / prev > 0.25 && Math.abs(cur - next) / next > 0.25) pts.splice(i, 1);
  }
  const prevCloseFill = res.meta?.chartPreviousClose ?? res.meta?.previousClose ?? null;
  if (range === '1D' && pts.length) {
    // Fill the 1-minute grid by carrying the last traded price forward
    // (v=0, f=1) — no trades means the price didn't move, so the line goes
    // flat there instead of vanishing. This also makes the index-based X
    // axis true to time. Also fill the start: some tickers have NO
    // premarket trades at all — carry the previous close forward from the
    // 4:00 AM premarket open, so the line sits flat at yesterday's close
    // until the first trade of the day.
    const preStart = meta.currentTradingPeriod?.pre?.start ?? null;
    if (prevCloseFill != null && preStart && pts[0].t > preStart * 1000) {
      const head = [];
      for (let t = preStart * 1000; t < pts[0].t; t += 60000) head.push({ t, o: prevCloseFill, h: prevCloseFill, l: prevCloseFill, c: prevCloseFill, v: 0, f: 1 });
      pts.unshift(...head);
    }
    const filled = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = filled[filled.length - 1];
      const gapMin = Math.round((pts[i].t - prev.t) / 60000);
      for (let m = 1; m < gapMin; m++) {
        const t = prev.t + m * 60000;
        filled.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0, f: 1 });
      }
      filled.push(pts[i]);
    }
    pts.length = 0; pts.push(...filled);
    // C1: the tail used to carry the last price flat to the 8:00 PM
    // post-market close UNCONDITIONALLY — mid-morning that fabricated a
    // flat line into the future for ~half the chart. Now it only fills up
    // to right now (never a future timestamp); once the market is closed
    // for the day the cap is the 8 PM close, as before.
    const postEndFill = meta.currentTradingPeriod?.post?.end ?? null;
    if (postEndFill && pts.length) {
      const last = pts[pts.length - 1];
      const capMs = Math.min(postEndFill * 1000, Math.floor(Date.now() / 60000) * 60000);
      for (let t = last.t + 60000; t <= capMs; t += 60000) pts.push({ t, o: last.c, h: last.c, l: last.c, c: last.c, v: 0, f: 1 });
    }
  }
  if (range === '5D' && pts.length) {
    // C3: the old 5D fill-forward bridged overnight/weekend gaps, turning
    // a 57-hour weekend into a 229-bar flat line. Now gaps are filled ONLY
    // inside one ET calendar day — overnight/weekend gaps stay gaps, so the
    // line breaks there instead of faking a flat. Head-fill: start all
    // tickers at the same 4:00 AM boundary of the first day (M10).
    const step = 15 * 60 * 1000;
    const sameDay = (a, b) => { const da = etDate(new Date(a)), db2 = etDate(new Date(b)); return da.year === db2.year && da.month === db2.month && da.day === db2.day; };
    if (prevCloseFill != null) {
      const { year, month, day } = etDate(new Date(pts[0].t));
      const dayStart = etWallToMs(year, month, day, 4, 0);
      if (pts[0].t > dayStart) {
        const head = [];
        for (let t = dayStart; t < pts[0].t; t += step) head.push({ t, o: prevCloseFill, h: prevCloseFill, l: prevCloseFill, c: prevCloseFill, v: 0, f: 1 });
        pts.unshift(...head);
      }
    }
    const filled = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = filled[filled.length - 1];
      if (!sameDay(prev.t, pts[i].t)) { filled.push(pts[i]); continue; } // overnight/weekend gap: break, don't fill
      const gap = Math.round((pts[i].t - prev.t) / step);
      for (let m = 1; m < gap; m++) {
        const t = prev.t + m * step;
        filled.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0, f: 1 });
      }
      filled.push(pts[i]);
    }
    pts.length = 0; pts.push(...filled);
    // Tail, capped at now like 1D (C1) — never into the future.
    const last = pts[pts.length - 1];
    const { year, month, day } = etDate(new Date(last.t));
    const endMs = etWallToMs(year, month, day, 20, 0);
    const capMs = Math.min(endMs, Math.floor(Date.now() / step) * step);
    for (let t = last.t + step; t <= capMs; t += step) pts.push({ t, o: last.c, h: last.c, l: last.c, c: last.c, v: 0, f: 1 });
  }
  const step = Math.max(1, Math.ceil(pts.length / 220));
  const candles = [];
  for (let i = 0; i < pts.length; i += step) { const chunk = pts.slice(i, i + step); candles.push({ t: chunk[0].t, o: chunk[0].o, h: Math.max(...chunk.map(p => p.h)), l: Math.min(...chunk.map(p => p.l)), c: chunk[chunk.length - 1].c, v: chunk.reduce((a, p) => a + (p.v || 0), 0) }); }
  // M7: prevClose is only meaningful for 1D (yesterday's close). For longer
  // ranges Yahoo's chartPreviousClose is the first bar's close, not the
  // day before the range — returning it mislabels the header math.
  // regularStart/regularEnd let the frontend shade pre/after-hours from the
  // real session instead of hardcoded 9:30/16:00 (H3).
  return { symbol: sym, range, points: pts, candles, candleStep: step, prevClose: range === '1D' ? (res.meta?.chartPreviousClose ?? res.meta?.previousClose ?? null) : null, regularStart: regStartMs, regularEnd: regEndMs, source: 'live' };
}
async function fetchNews(symbols) {
  const out = [];
  try {
    const q = encodeURIComponent(symbols.slice(0, 3).map(s => s.endsWith('-USD') ? s.replace('-USD', '') + ' crypto' : s + ' stock').join(' OR '));
    const r = await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`, { headers: UA, signal: AbortSignal.timeout(8000) });
    const txt = await r.text();
    const items = [...txt.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12);
    for (const m of items) {
      const title = (m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      const link = (m[1].match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
      const pub = (m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
      if (title) out.push({ title: title.replace(/<!\[CDATA\[|\]\]>/g, ''), link, pubDate: pub });
    }
  } catch {}
  return out;
}

async function fetchNewsGrouped(symbols) {
  const groups = [];
  await Promise.all(symbols.map(async (sym) => {
    try {
      const q = encodeURIComponent(sym.endsWith('-USD') ? sym.replace('-USD', '') + ' crypto' : sym + ' stock');
      const r = await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`, { headers: UA, signal: AbortSignal.timeout(8000) });
      const txt = await r.text();
      const items = [...txt.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 3);
      const headlines = items.map(m => {
        const clean = x => (x || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/<[^>]+>/g, '').trim();
        return { title: clean((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1]), link: clean((m[1].match(/<link>([\s\S]*?)<\/link>/) || [])[1]), snippet: clean((m[1].match(/<description>([\s\S]*?)<\/description>/) || [])[1]).slice(0, 220), pubDate: clean((m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]) };
      }).filter(h => h.title);
      groups.push({ symbol: sym, headlines });
    } catch { groups.push({ symbol: sym, headlines: [] }); }
  }));
  return groups;
}

// ---------- Email ----------
let mailer = null;
function smtpConfigured() { return !!process.env.SMTP_HOST; }
function getMailer() {
  if (mailer) return mailer;
  if (!smtpConfigured()) return null;
  try { const nodemailer = require('nodemailer'); mailer = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined }); } catch { mailer = null; }
  return mailer;
}
async function sendEmail(to, subject, body) {
  const m = getMailer();
  if (!m || !to) return { sent: false, reason: !to ? 'no recipient' : 'SMTP not configured — set SMTP_HOST/SMTP_USER/SMTP_PASS in .env' };
  try { await m.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text: body }); return { sent: true }; }
  catch (e) { return { sent: false, reason: e.message }; }
}
async function flushEmailQueue() {
  // Only pick up emails whose retry time has come (attempts < 3 stay queued
  // with a next_attempt_at at least 5 min out — a send failure never
  // permanently fails an email on the first try).
  const rows = db.prepare("SELECT * FROM email_queue WHERE status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at").all(Date.now());
  const byUser = {};
  for (const r of rows) (byUser[r.user_id] ||= []).push(r);
  for (const [uid, items] of Object.entries(byUser)) {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(+uid);
    if (!user?.email || !user.email_verified) { for (const it of items) db.prepare("UPDATE email_queue SET status='not-verified' WHERE id=?").run(it.id); continue; }
    for (let i = 0; i < items.length; i += 20) { // batched, max 20 per email
      const batch = items.slice(i, i + 20);
      const subject = batch.length > 1 ? `${APP_NAME}: ${batch.length} alerts` : batch[0].subject;
      const body = batch.map(x => `• ${x.subject}\n${x.body}`).join('\n\n');
      const res = await sendEmail(user.email, subject, body);
      for (const it of batch) {
        if (res.sent) { db.prepare("UPDATE email_queue SET status='sent' WHERE id=?").run(it.id); continue; }
        const attempts = (it.attempts || 0) + 1;
        if (attempts >= 3) db.prepare('UPDATE email_queue SET status=?, attempts=? WHERE id=?').run('failed: ' + res.reason, attempts, it.id);
        else db.prepare('UPDATE email_queue SET attempts=?, next_attempt_at=? WHERE id=?').run(attempts, Date.now() + attempts * 5 * 60 * 1000, it.id); // retry in 5/10 min, still queued
      }
    }
  }
}
setInterval(() => { flushEmailQueue().catch(() => {}); }, 5 * 60 * 1000);
function queueEmail(uid, subject, body) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  if (!user?.email || !user.email_verified) return false;
  // Without SMTP no email path works at all — don't queue rows that can
  // never send and then claim "N emails queued" in the UI.
  if (!smtpConfigured()) return false;
  db.prepare('INSERT INTO email_queue(user_id,subject,body,created_at) VALUES(?,?,?,?)').run(uid, subject, body, Date.now());
  return true;
}
// Email verification: 6-digit code, 10 min expiry, 5 tries, resend rate-limited.
function makeCode() { return String(crypto.randomInt(100000, 1000000)); } // CSPRNG, not Math.random
async function sendVerificationCode(uid, email) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid email address' };
  // Save the address even when no code can be sent yet, so adding an email
  // after creating an account does not silently lose it.
  db.prepare('UPDATE users SET pending_email=? WHERE id=?').run(email, uid);
  if (!smtpConfigured()) return { ok: false, error: 'Email not configured on this server (SMTP not set up) — ask the owner to add SMTP credentials. Your email was saved, no code was sent.', smtpConfigured: false };
  const hourAgo = Date.now() - 3600 * 1000;
  const recent = db.prepare('SELECT COUNT(*) c FROM email_verifications WHERE user_id=? AND created_at>?').get(uid, hourAgo).c;
  if (recent >= 3) return { ok: false, error: 'Too many codes sent — wait a bit and try again (max 3 per hour)' };
  const last = db.prepare('SELECT created_at FROM email_verifications WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(uid);
  if (last && Date.now() - last.created_at < 60 * 1000) return { ok: false, error: 'Wait 60 seconds before requesting another code' };
  const code = makeCode();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + ':' + code).digest('hex');
  db.prepare('INSERT INTO email_verifications(user_id,email,code_hash,salt,created_at,expires_at) VALUES(?,?,?,?,?,?)').run(uid, email, hash, salt, Date.now(), Date.now() + 10 * 60 * 1000);
  db.prepare('UPDATE users SET pending_email=? WHERE id=?').run(email, uid);
  const res = await sendEmail(email, `${APP_NAME} — your verification code`, `Your ${APP_NAME} verification code is: ${code}\n\nIt expires in 10 minutes. If you didn't ask for this, ignore this email.`);
  if (!res.sent) return { ok: false, error: 'Could not send the code: ' + res.reason, smtpConfigured: true };
  return { ok: true, email, expiresInMinutes: 10 };
}
function verifyCode(uid, code) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const email = user?.pending_email || user?.email;
  if (!email) return { ok: false, error: 'No pending email — send a code first' };
  const row = db.prepare('SELECT * FROM email_verifications WHERE user_id=? AND email=? AND used=0 ORDER BY created_at DESC LIMIT 1').get(uid, email);
  if (!row) return { ok: false, error: 'No code found for that email — send a new code' };
  if (Date.now() > row.expires_at) return { ok: false, error: 'That code expired (10 minutes) — send a new code' };
  if (row.attempts >= 5) return { ok: false, error: 'Too many wrong tries — send a new code' };
  const hash = crypto.createHash('sha256').update(row.salt + ':' + String(code || '').trim()).digest('hex');
  if (hash !== row.code_hash) { db.prepare('UPDATE email_verifications SET attempts=attempts+1 WHERE id=?').run(row.id); return { ok: false, error: "That code doesn't match" }; }
  db.prepare('UPDATE email_verifications SET used=1 WHERE id=?').run(row.id);
  db.prepare('UPDATE users SET email=?, email_verified=1, pending_email=? WHERE id=?').run(email, '', uid);
  return { ok: true, email };
}

// ---------- AI ----------
function aiConfigured() { return !!(process.env.AI_API_URL && (process.env.AI_API_KEY || process.env.AZURE_OPENAI_API_KEY)); }
async function aiDecide(prompt) {
  const url = process.env.AI_API_URL; const key = process.env.AI_API_KEY || process.env.AZURE_OPENAI_API_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': key, Authorization: 'Bearer ' + key }, body: JSON.stringify({ model: process.env.AI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 400 }), signal: AbortSignal.timeout(20000) });
    const j = await r.json(); return j?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

// ---------- Trading helpers ----------
function positionsOf(uid) { return db.prepare('SELECT * FROM positions WHERE user_id=?').all(uid); }
function logAuto(uid, kind, msg, extra = {}) { db.prepare('INSERT INTO auto_log(user_id,kind,message,symbol,shares,price,created_at) VALUES(?,?,?,?,?,?,?)').run(uid, kind, msg, extra.symbol || '', extra.shares || 0, extra.price || 0, Date.now()); }
function addAlert(uid, symbol, kind, message, price) {
  // 30-minute dedupe per symbol+kind
  const dup = db.prepare('SELECT 1 FROM alerts WHERE user_id=? AND symbol=? AND kind=? AND created_at>?').get(uid, symbol, kind, Date.now() - 30 * 60 * 1000);
  if (dup) return null;
  const id = db.prepare('INSERT INTO alerts(user_id,symbol,kind,message,price,created_at) VALUES(?,?,?,?,?,?)').run(uid, symbol, kind, message, price, Date.now()).lastInsertRowid;
  const s = getSettings(uid);
  if (s.emailPings) queueEmail(uid, `${APP_NAME} ping: ${symbol} ${kind}`, `${message}\nPrice: $${price}`);
  return id;
}
// Positions are signed: shares > 0 is long, shares < 0 is SHORT (avg_cost
// is the average short price). A SELL with no long position opens or
// increases a short — proceeds are credited to cash, exactly like a normal
// sell. A BUY against a short COVERS it — cash is debited, and the realised
// P&L is (avg short price - cover price) * shares, positive when the price
// fell. Covering more shares than the short holds is rejected (cover first,
// then buy long as a separate trade); selling more than a long position
// holds is still rejected, as before. Short opens/covers are marked in the
// trade's source ('-short' / '-cover') so history can tell them apart.
function applyTrade(uid, symbol, side, shares, price, source) {
  const game = getGame(uid);
  const total = +(shares * price).toFixed(2);
  // Dust trades: a true total under $0.01 rounds to nothing — reject, don't
  // book it. (Checked on the unrounded total: $0.0055 would round up to
  // $0.01 in storage but is still dust.)
  if (shares * price < 0.01) return { error: 'Trade too small — total must be at least $0.01' };
  const session = marketSession();
  const pos = db.prepare('SELECT * FROM positions WHERE user_id=? AND symbol=?').get(uid, symbol);
  if (side === 'buy') {
    if (game.cash < total) return { error: 'Not enough cash' };
    if (pos && pos.shares < 0) {
      // Covering a short: never buy past the short size.
      const shortSize = Math.abs(pos.shares);
      if (shares > shortSize + 1e-9) return { error: `You only short ${shortSize} ${symbol} — cover that first, then buy long as a separate trade` };
      const pnl = +((pos.avg_cost - price) * shares).toFixed(2);
      db.prepare('UPDATE game SET cash=cash-? WHERE user_id=?').run(total, uid);
      if (shortSize - shares < 1e-9) db.prepare('DELETE FROM positions WHERE id=?').run(pos.id);
      else db.prepare('UPDATE positions SET shares=? WHERE id=?').run(pos.shares + shares, pos.id);
      db.prepare('INSERT INTO trades(user_id,symbol,side,shares,price,total,pnl,session,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid, symbol, 'buy', shares, price, total, pnl, session, source + '-cover', Date.now());
      const g = getGame(uid);
      if (pnl > 0 && g.best_run < pnl) db.prepare('UPDATE game SET best_run=? WHERE user_id=?').run(pnl, uid);
      touchActivity(uid); // a trade counts toward the daily streak
      return { ok: true, pnl, covered: true };
    }
    db.prepare('UPDATE game SET cash=cash-? WHERE user_id=?').run(total, uid);
    if (pos) { const ns = pos.shares + shares; const avg = (pos.shares * pos.avg_cost + total) / ns; db.prepare('UPDATE positions SET shares=?, avg_cost=? WHERE id=?').run(ns, avg, pos.id); }
    else db.prepare('INSERT INTO positions(user_id,symbol,shares,avg_cost,created_at) VALUES(?,?,?,?,?)').run(uid, symbol, shares, price, Date.now());
    db.prepare('INSERT INTO trades(user_id,symbol,side,shares,price,total,pnl,session,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid, symbol, 'buy', shares, price, total, 0, session, source, Date.now());
  } else {
    if (pos && pos.shares > 0) {
      // Long position: can only sell up to what is held (unchanged).
      if (pos.shares < shares) return { error: 'Not enough shares' };
      const pnl = +((price - pos.avg_cost) * shares).toFixed(2);
      db.prepare('UPDATE game SET cash=cash+? WHERE user_id=?').run(total, uid);
      if (pos.shares - shares < 1e-9) db.prepare('DELETE FROM positions WHERE id=?').run(pos.id);
      else db.prepare('UPDATE positions SET shares=? WHERE id=?').run(pos.shares - shares, pos.id);
      db.prepare('INSERT INTO trades(user_id,symbol,side,shares,price,total,pnl,session,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid, symbol, 'sell', shares, price, total, pnl, session, source, Date.now());
      const g = getGame(uid);
      if (pnl > 0 && g.best_run < pnl) db.prepare('UPDATE game SET best_run=? WHERE user_id=?').run(pnl, uid);
      touchActivity(uid); // a trade counts toward the daily streak
      return { ok: true, pnl };
    }
    // No position, or an existing short: open / increase the short.
    // Proceeds are credited to cash now; covering later debits them back.
    db.prepare('UPDATE game SET cash=cash+? WHERE user_id=?').run(total, uid);
    if (pos) { // existing short: weighted average short price
      const ns = pos.shares - shares; // more negative
      const avg = (Math.abs(pos.shares) * pos.avg_cost + total) / Math.abs(ns);
      db.prepare('UPDATE positions SET shares=?, avg_cost=? WHERE id=?').run(ns, avg, pos.id);
    } else db.prepare('INSERT INTO positions(user_id,symbol,shares,avg_cost,created_at) VALUES(?,?,?,?,?)').run(uid, symbol, -shares, price, Date.now());
    db.prepare('INSERT INTO trades(user_id,symbol,side,shares,price,total,pnl,session,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid, symbol, 'sell', shares, price, total, 0, session, source + '-short', Date.now());
    touchActivity(uid); // a trade counts toward the daily streak
    return { ok: true, pnl: 0, shorted: true };
  }
  touchActivity(uid); // a buy-long trade counts toward the daily streak
  return { ok: true };
}
// Limit / stop orders: evaluated against live quotes on every quote
// refresh (GET /api/quotes) and every server cycle. Fill price is the
// TARGET price OR BETTER — a limit buy at $200 fills at the live $150, not
// $200; a limit sell at $100 fills at the live $150, not $100. (C5: the old
// code filled at the target even when the live price was better, so players
// overpaid / undersold.)
//   buy  + limit → fills when price <= target (buy the dip)
//   buy  + stop  → fills when price >= target (buy the breakout)
//   sell + limit → fills when price >= target (sell into strength)
//   sell + stop  → fills when price <= target (stop-loss sell)
// A fill that applyTrade rejects (not enough cash / shares) stays open and
// retries on the next evaluation — it is never silently dropped.
function orderTouched(o, price) {
  if (o.side === 'buy') return o.type === 'limit' ? price <= o.target_price : price >= o.target_price;
  return o.type === 'limit' ? price >= o.target_price : price <= o.target_price;
}
function evaluateOrders(uid, quotes) {
  const open = db.prepare("SELECT * FROM orders WHERE user_id=? AND status='open'").all(uid);
  let anyFilled = false;
  for (const o of open) {
    const q = quotes[o.symbol];
    if (!q || !orderTouched(o, q.price)) continue;
    const fillPrice = o.side === 'buy' ? Math.min(o.target_price, q.price) : Math.max(o.target_price, q.price);
    const r = applyTrade(uid, o.symbol, o.side, o.shares, fillPrice, 'order-' + o.type);
    if (r.error) continue; // stays open, retries next cycle
    db.prepare("UPDATE orders SET status='filled', filled_at=?, fill_price=? WHERE id=?").run(Date.now(), fillPrice, o.id);
    anyFilled = true;
    const label = (o.type === 'limit' ? 'Limit' : 'Stop') + ' ' + o.side;
    logAuto(uid, 'ORDER', `${label} filled: ${o.shares} ${o.symbol} @ $${fillPrice} (target $${o.target_price})${r.pnl ? ` · realised P&L $${r.pnl.toFixed(2)}` : ''}${r.shorted ? ' · short opened' : ''}${r.covered ? ' · short covered' : ''}`, { symbol: o.symbol, shares: o.shares, price: fillPrice });
    if (getSettings(uid).emailTrades) queueEmail(uid, `${APP_NAME} ${label} order filled: ${o.symbol}`, `${label} order filled: ${o.shares} ${o.symbol} @ $${fillPrice} (target $${o.target_price}).`);
  }
  if (anyFilled) snapshotNetWorth(uid);
}
function listOrders(uid) {
  return db.prepare("SELECT * FROM orders WHERE user_id=? ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END, created_at DESC LIMIT 50").all(uid);
}
function evaluatePings(uid, quotes) {
  const s = getSettings(uid);
  if (!s.pingsOn) return;
  const board = boardSymbols(uid).all;
  if (s.buyPings !== false) for (const sym of board) {
    const q = quotes[sym]; if (!q) continue;
    if (q.changePct <= s.dipPct) addAlert(uid, sym, 'BUY·DIP', `${sym} dipped ${q.changePct.toFixed(2)}% today (dip ping at ${s.dipPct}%) — $${q.price}`, q.price);
    if (q.changePct >= s.momentumPct) addAlert(uid, sym, 'BUY·MOMENTUM', `${sym} ripped +${q.changePct.toFixed(2)}% today (momentum ping at +${s.momentumPct}%) — $${q.price}`, q.price);
  }
  for (const p of positionsOf(uid)) {
    const q = quotes[p.symbol]; if (!q) continue;
    const style = STYLES[getSettings(uid).style] || STYLES.day;
    // chg is the gain vs cost — for a short it flips: a falling price is a
    // gain, a rising price is a loss. Stop/target lines are lines on the
    // gain either way, so the same comparisons work for both.
    const isShort = p.shares < 0;
    const chg = isShort ? ((p.avg_cost - q.price) / p.avg_cost) * 100 : ((q.price - p.avg_cost) / p.avg_cost) * 100;
    const heldLabel = isShort ? `you're short ${Math.abs(p.shares)} shares` : `you're holding ${p.shares} shares`;
    if (s.sellPings !== false && !isShort && q.changePct <= -4) addAlert(uid, p.symbol, 'SELL WATCH', `${p.symbol} is down ${q.changePct.toFixed(2)}% today — watch it, ${heldLabel} — $${q.price}`, q.price);
    if (s.sellPings !== false && isShort && q.changePct >= 4) addAlert(uid, p.symbol, 'SHORT WATCH', `${p.symbol} is up ${q.changePct.toFixed(2)}% today — rising against your short, ${heldLabel} — $${q.price}`, q.price);
    if (s.stopTargetPings !== false) {
      // One line only: the style's own stop/target. The old code also fired
      // hardcoded -5%/+10% lines under the same SELL·STOP / SELL·TARGET
      // kinds, so for Swing (-8%) the -5% line fired first and the style
      // line never produced its own ping. (Day style IS -5%/+10%, so its
      // players see no change.)
      if (chg <= style.stop) addAlert(uid, p.symbol, 'SELL·STOP', `${p.symbol} hit your ${style.label} stop ${style.stop}% (${chg.toFixed(2)}% vs your cost) — $${q.price}`, q.price);
      if (chg >= style.target) addAlert(uid, p.symbol, 'SELL·TARGET', `${p.symbol} hit your ${style.label} target +${style.target}% (${chg.toFixed(2)}% vs your cost) — $${q.price}`, q.price);
    }
  }
}
async function researchPass(sym, quotes) {
  let trend = '';
  let chg5 = 0, chg20 = 0;
  try {
    const h = await fetchHistory(sym, '1M');
    const closes = h.points.map(p => p.c);
    if (closes.length >= 20) { const c5 = closes.slice(-5), c20 = closes.slice(-20); const avg = a => a.reduce((x, y) => x + y, 0) / a.length; chg5 = ((closes[closes.length - 1] - c5[0]) / c5[0]) * 100; chg20 = ((closes[closes.length - 1] - c20[0]) / c20[0]) * 100; trend = `Change over the last 5 days ${chg5 >= 0 ? '+' : ''}${chg5.toFixed(1)}% (5-day avg $${avg(c5).toFixed(2)}), change over the last 20 days ${chg20 >= 0 ? '+' : ''}${chg20.toFixed(1)}% (20-day avg $${avg(c20).toFixed(2)}), last $${closes[closes.length - 1].toFixed(2)}.`; }
  } catch { trend = 'Trend history unavailable.'; }
  const news = await fetchNews([sym]);
  const headlines = news.slice(0, 3).map(n => n.title);
  // Real research score 0–100 (M15 — the old "strongest research score"
  // was fiction, research was never scored): 5-day momentum counts double,
  // 20-day momentum once, fresh headlines add a little. 50 is flat.
  const score = Math.max(0, Math.min(100, Math.round(50 + chg5 * 2 + chg20 + Math.min(3, headlines.length) * 2)));
  return { trend, headlines, score };
}
async function runAutoCycle(uid, { manual = false, quotes: presetQuotes = null } = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  if (!user) return { ran: false };
  const s = effectiveSettings(uid, user);
  const saver = !!s.creditSaver;
  // Credit Saver blocks ALL auto trading outside market hours — including a
  // manual "Run a Check Now". The old !manual exemption let a manual run
  // trade after the early close while Saver was on, which is exactly what
  // the Saver is supposed to prevent.
  if (saver && !isMarketHours()) { logAuto(uid, 'CHECK', 'Credit Saver — market closed (' + marketSession() + '). Waiting for market hours (9:30 AM–4:00 PM ET); no auto runs while it is closed'); return { ran: true, action: 'waiting-market-hours' }; }
  const rawQuotes = presetQuotes || await fetchLiveQuotes(boardSymbols(uid).all);
  const quotes = effectiveQuotesFor(uid, rawQuotes);
  evaluatePings(uid, quotes);
  if (!s.autoOn && !manual) return { ran: true, action: 'auto-off' };
  const style = STYLES[s.style] || STYLES.day;
  let soldCount = 0;
  if (s.autoSell !== false) for (const p of positionsOf(uid)) { // Exits cover everything held, incl. custom picks
    const q = quotes[p.symbol]; if (!q) continue;
    // Gain vs cost — flipped for shorts, so the same stop/target lines
    // work: a short exits when the price rises past its stop or falls to
    // its target. Exiting a short means BUYING to cover, not selling.
    const isShort = p.shares < 0;
    const chg = isShort ? ((p.avg_cost - q.price) / p.avg_cost) * 100 : ((q.price - p.avg_cost) / p.avg_cost) * 100;
    if (chg <= style.stop || chg >= style.target) {
      if (isShort) {
        applyTrade(uid, p.symbol, 'buy', Math.abs(p.shares), q.price, 'auto-' + s.style);
        logAuto(uid, 'SELL', `Covered short ${Math.abs(p.shares)} ${p.symbol} @ $${q.price} (${chg.toFixed(1)}% vs short price, ${s.style} ${style.stop}%/${style.target}%)`, { symbol: p.symbol, shares: Math.abs(p.shares), price: q.price });
        if (s.emailTrades) queueEmail(uid, `${APP_NAME} auto-cover: ${p.symbol}`, `Covered short ${p.symbol} @ $${q.price} (${chg.toFixed(1)}%).`);
      } else {
        applyTrade(uid, p.symbol, 'sell', p.shares, q.price, 'auto-' + s.style);
        logAuto(uid, 'SELL', `Sold ${p.shares} ${p.symbol} @ $${q.price} (${chg.toFixed(1)}% vs cost, ${s.style} ${style.stop}%/${style.target}%)`, { symbol: p.symbol, shares: p.shares, price: q.price });
        if (s.emailTrades) queueEmail(uid, `${APP_NAME} auto-sell: ${p.symbol}`, `Sold ${p.symbol} @ $${q.price} (${chg.toFixed(1)}%).`);
      }
      soldCount += 1; // M16: keep going — exit EVERY position on its line this cycle, not just the first
    }
  }
  if (soldCount) return { ran: true, action: 'sold', count: soldCount }; // no buy this cycle after exits
  const et = etDate(); // day cap counts in America/New_York, not UTC
  const [dayStart, dayEnd] = etDayBounds(et.year, et.month, et.day);
  const tradesToday = db.prepare("SELECT COUNT(*) c FROM trades WHERE user_id=? AND source LIKE 'auto%' AND created_at>=? AND created_at<?").get(uid, dayStart, dayEnd).c;
  if (tradesToday >= s.maxTradesPerDay) { logAuto(uid, 'CHECK', `Checked — no trade (daily cap ${s.maxTradesPerDay} reached)`); return { ran: true, action: 'cap' }; }
  if (positionsOf(uid).length >= s.maxPositions) { logAuto(uid, 'CHECK', 'Checked — no trade (max positions reached)'); return { ran: true, action: 'max-pos' }; }
  const signals = [];
  for (const sym of TICKERS) { // Entries stay on the core 12
    const q = quotes[sym]; if (!q) continue;
    if (s.buyDips !== false && q.changePct <= s.dipPct) signals.push({ sym, score: Math.abs(q.changePct), kind: 'dip', chg: q.changePct });
    if (s.buyMomentum !== false && q.changePct >= s.momentumPct) signals.push({ sym, score: q.changePct, kind: 'momentum', chg: q.changePct });
  }
  signals.sort((a, b) => b.score - a.score);
  if (!signals.length) { logAuto(uid, 'CHECK', 'Checked — no trade (no signals)'); return { ran: true, action: 'no-signal' }; }
  // Research pass before any buy: up to 4 candidates, only 1 under Credit Saver.
  const candidates = saver ? signals.slice(0, 1) : signals.slice(0, 4);
  const researched = [];
  for (const sig of candidates) {
    const res = await researchPass(sig.sym, quotes);
    logAuto(uid, 'RESEARCH', `${sig.sym}: research score ${res.score}/100 — ${res.trend} Headlines: ${res.headlines.join(' | ') || 'none found'}`, { symbol: sig.sym });
    researched.push({ ...sig, research: res, score: res.score });
  }
  researched.sort((a, b) => b.score - a.score); // strongest research score wins, not just the biggest % move
  const best = researched[0];
  let decision = 'buy', reason = `${best.kind} signal ${best.chg.toFixed(1)}% (research score ${best.score}/100)`;
  if (s.autoMode === 'ai') {
    const q = quotes[best.sym];
    const prompt = `Paper-trading decision. Ticker ${best.sym} (${NAMES[best.sym]}), live price $${q.price}, day change ${q.changePct.toFixed(2)}%, signal ${best.kind} ${best.chg.toFixed(1)}%, style ${style.label} (${style.stop}% stop / +${style.target}% target). Trend: ${best.research.trend} Headlines: ${best.research.headlines.join('; ') || 'none'}. Answer ONLY with BUY or PASS and one short reason.`;
    const ai = await aiDecide(prompt);
    if (ai) { decision = /^\s*BUY/i.test(ai) ? 'buy' : 'pass'; reason = 'AI: ' + ai.slice(0, 200); }
    else reason = 'AI unavailable (no AI_API_KEY configured) — rules fallback: ' + reason;
  }
  if (decision === 'pass') { logAuto(uid, 'PASS', `${best.sym} passed — ${reason}`, { symbol: best.sym }); return { ran: true, action: 'pass' }; }
  const q = quotes[best.sym];
  // C6: size to what the player can actually afford — the old code sized
  // from budgetPerBuy alone, so every account with cash below the $10k
  // default budget failed every check with "Not enough cash" forever.
  const cash = getGame(uid).cash;
  const budget = Math.min(s.budgetPerBuy, cash * 0.95);
  const shares = Math.max(0.01, Math.floor((budget / q.price) * 100) / 100);
  if (shares * q.price < 0.01) { logAuto(uid, 'CHECK', `Checked — no trade (not enough cash for even 0.01 shares of ${best.sym})`); return { ran: true, action: 'error' }; }
  const r = applyTrade(uid, best.sym, 'buy', shares, q.price, 'auto-' + s.style);
  if (r.error) { logAuto(uid, 'CHECK', `Checked — no trade (${r.error})`); return { ran: true, action: 'error' }; }
  logAuto(uid, 'BUY', `Bought ${shares} ${best.sym} @ $${q.price} — ${reason}`, { symbol: best.sym, shares, price: q.price });
  if (s.emailTrades) queueEmail(uid, `${APP_NAME} auto-buy: ${best.sym}`, `Bought ${shares} ${best.sym} @ $${q.price}. ${reason}`);
  return { ran: true, action: 'bought', symbol: best.sym };
}
// H7: the cycle ticks every 30 s (the fastest check step) and each player's
// auto trader runs only when their own checkSeconds interval is due — the
// old code hardcoded a 2-minute interval and never read checkSeconds at all.
const lastCycleAt = new Map(); // userId -> ms of last auto cycle
async function serverCycle() {
  try {
    const users = db.prepare('SELECT id FROM users').all();
    if (!users.length) return;
    maybeLeagueRollover(); // weekly leagues roll over even with the page closed
    const quotes = await fetchLiveQuotes(); // shared live quotes for the whole cycle
    const now = Date.now();
    for (const u of users) {
      const s = effectiveSettings(u.id, db.prepare('SELECT * FROM users WHERE id=?').get(u.id));
      const due = now - (lastCycleAt.get(u.id) || 0) >= (s.checkSeconds || 30) * 1000;
      if (s.autoOn && due) { lastCycleAt.set(u.id, now); await runAutoCycle(u.id, { quotes }); }
      evaluatePings(u.id, effectiveQuotesFor(u.id, quotes));
      evaluateOrders(u.id, effectiveQuotesFor(u.id, quotes)); // limit/stop orders fill on touch
      snapshotNetWorth(u.id); // portfolio-over-time history, ~every cycle
      ensureLeagueRow(u.id, netWorthOf(u.id, quotes)); // league week snapshot (new players start in Bronze)
    }
    await flushEmailQueue().catch(() => {});
  } catch (e) { console.error('server cycle error', e.message); }
}
setInterval(serverCycle, 30 * 1000);

// ---------- Express ----------
const app = express();
app.disable('x-powered-by');
// M5: security headers on every response (no helmet dependency — plain
// Express headers). Sessions still live in localStorage on the client
// (documented limitation: a stored-XSS would steal them — see README);
// the headers below plus the escaped rendering are the mitigations.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// H6: global rate limiting (per IP, in-memory) on the brute-force surface:
// register / login / claim / send-code. 30 attempts per 10 minutes per IP.
const RATE_WINDOW_MS = 10 * 60 * 1000, RATE_MAX = 30;
const rateBuckets = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const b = rateBuckets.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > b.resetAt) { b.count = 0; b.resetAt = now + RATE_WINDOW_MS; }
  b.count += 1;
  rateBuckets.set(ip, b);
  if (b.count > RATE_MAX) return res.status(429).json({ error: 'Too many attempts — wait a few minutes and try again' });
  next();
}
// M5: sweep expired sessions hourly so dead tokens don't pile up in the DB.
setInterval(() => { try { db.prepare('DELETE FROM sessions WHERE created_at<?').run(Date.now() - SESSION_TTL_MS); } catch {} }, 60 * 60 * 1000);
function auth(req, res, next) {
  // Security: Bearer token only. No cookie fallback — a cookie alone must
  // never sign anyone in, or a reload would open the owner account with no PIN.
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const t = token || null;
  if (!t) return res.status(401).json({ error: 'Not signed in' });
  const sess = db.prepare('SELECT * FROM sessions WHERE token=?').get(t);
  if (!sess) return res.status(401).json({ error: 'Session expired' });
  // Sessions expire after 30 days — an old token is dead even if it is in the DB.
  if (Date.now() - sess.created_at > SESSION_TTL_MS) { db.prepare('DELETE FROM sessions WHERE token=?').run(t); return res.status(401).json({ error: 'Session expired' }); }
  req.user = db.prepare('SELECT * FROM users WHERE id=?').get(sess.user_id);
  if (!req.user) return res.status(401).json({ error: 'User not found' });
  next();
}
function publicState(uid, opts = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const game = getGame(uid);
  const s = effectiveSettings(uid, user);
  // M1: prices used to come only from the quote_cache DB table, never live,
  // and with no staleness flag. Prefer the fresh in-memory live cache when
  // it is within the 10 s TTL; otherwise fall back to the DB cache and say
  // so (quotesStale / quotesAsOf below). opts.quotesOverride forces one
  // shared quote set (the leaderboard — M2); opts.rawQuotes skips the
  // per-player overnight freeze so every player is ranked on the same prices.
  const liveFresh = liveQuoteCache.data && Date.now() - liveQuoteCache.at < QUOTE_CACHE_TTL_MS;
  const raw = opts.quotesOverride || (liveFresh ? liveQuoteCache.data : cachedQuotes());
  const quotes = opts.rawQuotes ? raw : effectiveQuotesFor(uid, raw);
  const asOfs = Object.values(raw).map(q => q.asOf || 0).filter(Boolean);
  const quotesAsOf = asOfs.length ? Math.max(...asOfs) : 0;
  const quotesStale = !quotesAsOf || Date.now() - quotesAsOf > 60 * 1000;
  const positions = positionsOf(uid).map(p => {
    const q = quotes[p.symbol]; const price = q?.price ?? p.avg_cost;
    const isShort = p.shares < 0;
    // changePct is the gain vs cost — flipped for shorts, so +5% always
    // means "you're up 5%", long or short. (Net worth and todayChange
    // already handle negative shares: price * shares is a liability.)
    return { ...p, price, isShort, changePct: isShort ? ((p.avg_cost - price) / p.avg_cost) * 100 : ((price - p.avg_cost) / p.avg_cost) * 100 };
  });
  const netWorth = game.cash + positions.reduce((a, p) => a + p.price * p.shares, 0);
  // Close balance: every position priced at its regular-session close
  // (regularClose, else prevClose, else avg_cost). The live net worth
  // above keeps moving after the bell on extended-hours prices; the close
  // balance is the frozen-at-close figure. They only differ while the
  // market is closed (or while overnight prices are on) — when overnight
  // prices are off, effectiveQuotesFor() already froze live prices at
  // regularClose, so the two match exactly. Uses the RAW quotes (before
  // the per-player freeze) so the close price is the same for everyone.
  const closePriceOf = sym => raw[sym]?.regularClose ?? raw[sym]?.prevClose ?? null;
  const closeNetWorth = game.cash + positions.reduce((a, p) => a + (closePriceOf(p.symbol) ?? p.avg_cost) * p.shares, 0);
  const closeDiff = netWorth - closeNetWorth; // live minus close
  const allTime = netWorth - (s.startCash || START_CASH);
  const allTimePct = (s.startCash || START_CASH) ? (allTime / (s.startCash || START_CASH)) * 100 : 0;
  // Today change is measured vs yesterday's close (prevClose), so buying
  // a stock today never books the move that happened before the buy, and
  // selling today only books the move since yesterday's close. Open
  // positions count (price - prevClose) * shares (negative shares for
  // shorts flip the sign), then each of today's trades adjusts for the
  // leg that opened/closed after prevClose.
  const prevCloseOf = sym => quotes[sym]?.prevClose ?? null;
  const openTodayChange = positions.reduce((a, p) => {
    const pc = prevCloseOf(p.symbol);
    return a + (pc != null ? (p.price - pc) * p.shares : 0);
  }, 0);
  const etToday = etDate();
  let todayAdjust = 0;
  for (const tr of db.prepare('SELECT symbol, side, shares, price, source, created_at FROM trades WHERE user_id=?').all(uid)) {
    const d = etDate(new Date(tr.created_at));
    if (d.year !== etToday.year || d.month !== etToday.month || d.day !== etToday.day) continue;
    const pc = prevCloseOf(tr.symbol);
    if (pc == null) continue;
    const src = String(tr.source || '');
    const isCover = src.endsWith('-cover');
    const isShort = src.endsWith('-short');
    if (tr.side === 'buy' && !isCover) todayAdjust -= (tr.price - pc) * tr.shares; // buy long: remove the pre-purchase move
    else if (tr.side === 'sell' && !isShort) todayAdjust += (tr.price - pc) * tr.shares; // sell long: keep only the move since prevClose
    else if (tr.side === 'sell' && isShort) todayAdjust += (tr.price - pc) * tr.shares; // short opened today: same correction as a buy
    else if (tr.side === 'buy' && isCover) todayAdjust += (pc - tr.price) * tr.shares; // cover: gain is prevClose falling to the cover price
  }
  const todayChange = openTodayChange + todayAdjust;
  const todayPct = (netWorth - todayChange) ? (todayChange / (netWorth - todayChange)) * 100 : 0;
  let bestWorth = game.best_worth || 0;
  // L1: a read endpoint must not write. best_worth only updates when the
  // caller says so (trade / order / snapshot paths pass updateBest: true).
  if (opts.updateBest && netWorth > bestWorth) { bestWorth = netWorth; db.prepare('UPDATE game SET best_worth=? WHERE user_id=?').run(bestWorth, uid); }
  const emailQueued = db.prepare("SELECT COUNT(*) c FROM email_queue WHERE user_id=? AND status='queued'").get(uid).c;
  // Session hours for display: on an early-close day the regular session
  // ends at 1:00 PM ET, not 4:00 PM — the old hardcoded "9:30 AM–4:00 PM"
  // label lied on those days.
  // Leagues: read-only here — the row is created/rolled over by the
  // server cycle, never by a read. Missing row => Bronze defaults.
  const leagueRow = getLeagueRow(uid);
  const leagueTier = leagueTierOf(leagueRow);
  const leagueWeeklyPct = leagueRow?.week_start_worth ? ((netWorth - leagueRow.week_start_worth) / leagueRow.week_start_worth) * 100 : 0;
  const etNow = etDate(new Date());
  const sessionHours = isEarlyClose(etNow.year, etNow.month, etNow.day, etNow.weekday) ? '9:30 AM–1:00 PM ET' : '9:30 AM–4:00 PM ET';
  return {
    user: { id: user.id, name: user.name, email: user.email || '', pendingEmail: user.pending_email || '', emailVerified: !!user.email_verified, isOwner: !!user.is_owner },
    cash: game.cash, bestRun: game.best_run, bestWorth, netWorth, closeNetWorth, closeDiff, allTime, allTimePct, todayChange, todayPct, emailQueued, quotesAsOf, quotesStale,
    positions, customSymbols: boardSymbols(uid).custom, coreTickers: TICKERS,
    trades: db.prepare('SELECT * FROM trades WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(uid),
    orders: listOrders(uid),
    alerts: db.prepare('SELECT * FROM alerts WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(uid),
    autoLog: db.prepare('SELECT * FROM auto_log WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(uid),
    predictorChats: db.prepare('SELECT * FROM predictor_chats WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(uid),
    ...predictorLimitInfo(uid, user), // predictorLimit / Used / Remaining / Unlimited (AI asks only)
    settings: s, creditSaverForced: !user.is_owner, creditSaverEffective: !!s.creditSaver, session: marketSession(), sessionHours, discordInviteUrl: DISCORD_INVITE_URL,
    league: { tier: leagueTier, tierName: LEAGUE_TIERS[leagueTier].name, tierColor: LEAGUE_TIERS[leagueTier].color, weeklyPct: Math.round(leagueWeeklyPct * 100) / 100, lastResult: leagueRow?.last_result || '', lastResultKind: leagueRow?.last_result_kind || '' }, donateUrl: DONATE_URL,
    feedback: user.is_owner ? db.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 100').all() : undefined,
    players: db.prepare('SELECT id, name, is_owner, CASE WHEN pin_hash IS NULL OR pin_hash = \'\' THEN 0 ELSE 1 END AS has_pin FROM users ORDER BY created_at').all(),
  };
}
function snapshotNetWorth(uid) {
  // (best_worth updates here — this is a write path, not a read.)
  // At most one snapshot per user per 90 s — the server cycle runs every
  // 2 min, and trades also snapshot, so this keeps the history ~2-min
  // spaced without spamming a row on every trade.
  const last = db.prepare('SELECT created_at FROM net_worth_snapshots WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(uid);
  if (last && Date.now() - last.created_at < 90 * 1000) return;
  const nw = publicState(uid, { updateBest: true }).netWorth;
  db.prepare('INSERT INTO net_worth_snapshots(user_id,net_worth,created_at) VALUES(?,?,?)').run(uid, nw, Date.now());
}

// ---------- Weekly LEAGUES (Duolingo-style) ----------
// 10 tiers, lowest to highest. Weekly competition: Monday 00:00 ET to
// Sunday 23:59 ET, ranked by WEEKLY % return (net worth now vs net worth
// at the start of the week) — not all-time. Leagues hold up to 30 players
// in the same tier; new players start in Bronze. At week end the top 10
// promote, the bottom 10 demote, the middle stays. This is a SEPARATE
// system from the % ranks (Paper Hands / Rookie / ... / Whale) — those
// are untouched. No AI involved.
const LEAGUE_TIERS = [
  { name: 'Bronze', color: '#cd7f32' },
  { name: 'Silver', color: '#c0c0c0' },
  { name: 'Gold', color: '#ffd700' },
  { name: 'Sapphire', color: '#4f8ef7' },
  { name: 'Ruby', color: '#e0115f' },
  { name: 'Emerald', color: '#50c878' },
  { name: 'Amethyst', color: '#b388ff' },
  { name: 'Pearl', color: '#f5f0dc' },
  { name: 'Obsidian', color: '#9aa3b2' },
  { name: 'Diamond', color: '#7fe7ff' },
];
const LEAGUE_SIZE = 30;
const LEAGUE_PROMOTE = 10; // of a full 30-player league
const ET_WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
// Monday (ET) that starts the week containing d, as 'YYYY-MM-DD'.
function etWeekKey(d = new Date()) {
  const p = etDate(d);
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const off = (ET_WEEKDAYS[p.weekday] + 6) % 7; // days since Monday
  base.setUTCDate(base.getUTCDate() - off);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
}
// Epoch ms of the next Monday 00:00 ET after the week starting weekKey.
function etWeekEndsAtMs(weekKey) {
  const [y, m, dd] = weekKey.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, dd + 7));
  return etWallToMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0);
}
// Net worth on ONE shared quote set (raw, no per-player overnight freeze)
// so every player in a league is ranked on the same prices (M2).
function netWorthOf(uid, quotes) {
  const game = getGame(uid);
  let nw = game.cash;
  for (const pos of positionsOf(uid)) nw += (quotes[pos.symbol]?.price ?? pos.avg_cost) * pos.shares;
  return nw;
}
function getLeagueRow(uid) { return db.prepare('SELECT * FROM leagues WHERE user_id=?').get(uid); }
function leagueTierOf(row) { return Math.min(LEAGUE_TIERS.length - 1, Math.max(0, row?.tier || 0)); }
// Promotion/demotion zone sizes for a league of n players. A full
// 30-player league promotes/demotes 10; in a smaller league the zones
// shrink to a third each so they can never overlap (with 3 players: 1 up,
// 1 down, 1 stays; with 1-2 players: nobody moves).
function leagueZoneCounts(n) {
  const c = Math.min(LEAGUE_PROMOTE, Math.floor(n / 3));
  return { promote: c, demote: c };
}
// Week rollover: promote/demote last week's leagues, snapshot everyone at
// the new week's start. Runs in the server cycle (every 30 s) and lazily
// from the leagues endpoint, so it fires even with the page closed and
// even if the server was down at the boundary. Idempotent per week via
// league_meta.last_rollover_week.
function maybeLeagueRollover(quotes) {
  const wk = etWeekKey();
  const last = db.prepare("SELECT value FROM league_meta WHERE key='last_rollover_week'").get();
  if (last?.value === wk) return false;
  const q = quotes || cachedQuotes();
  const users = db.prepare('SELECT id FROM users ORDER BY created_at').all();
  const setMeta = () => db.prepare("INSERT INTO league_meta(key,value) VALUES('last_rollover_week',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(wk);
  if (!users.length) { setMeta(); return false; }
  if (!last) {
    // First run ever: seed everyone into the current week. No promotion
    // or demotion for a week nobody played.
    for (const u of users) {
      const nw = netWorthOf(u.id, q);
      const row = getLeagueRow(u.id);
      if (!row) db.prepare('INSERT INTO leagues(user_id,tier,week_key,week_start_worth,last_result,last_result_kind) VALUES(?,?,?,?,?,?)').run(u.id, 0, wk, nw, '', '');
      else if (row.week_key !== wk) db.prepare('UPDATE leagues SET week_key=?, week_start_worth=? WHERE user_id=?').run(wk, nw, u.id);
    }
    setMeta(); return true;
  }
  // Group by tier. A player whose snapshot is older than the week that
  // just ended (joined late, or server was down) measures from now, not
  // from a stale snapshot — they didn't play last week.
  const byTier = new Map();
  for (const u of users) {
    let row = getLeagueRow(u.id);
    if (!row) { const nw = netWorthOf(u.id, q); db.prepare('INSERT INTO leagues(user_id,tier,week_key,week_start_worth,last_result,last_result_kind) VALUES(?,?,?,?,?,?)').run(u.id, 0, last.value, nw, '', ''); row = getLeagueRow(u.id); }
    const t = leagueTierOf(row);
    if (!byTier.has(t)) byTier.set(t, []);
    const nw = netWorthOf(u.id, q);
    const start = (row.week_key === last.value && row.week_start_worth) ? row.week_start_worth : nw;
    byTier.get(t).push({ uid: u.id, nw, weeklyPct: start ? ((nw - start) / start) * 100 : 0 });
  }
  for (const [tier, members] of byTier) {
    members.sort((a, b) => (b.weeklyPct - a.weeklyPct) || (b.nw - a.nw));
    const { promote, demote } = leagueZoneCounts(members.length);
    members.forEach((m, i) => {
      let newTier = tier, kind = 'stayed';
      if (i < promote && tier < LEAGUE_TIERS.length - 1) { newTier = tier + 1; kind = 'promoted'; }
      else if (i >= members.length - demote && tier > 0) { newTier = tier - 1; kind = 'demoted'; }
      const msg = kind === 'promoted' ? `Promoted to ${LEAGUE_TIERS[newTier].name}!` : kind === 'demoted' ? `Demoted to ${LEAGUE_TIERS[newTier].name}` : `Stayed in ${LEAGUE_TIERS[tier].name}`;
      db.prepare('UPDATE leagues SET tier=?, week_key=?, week_start_worth=?, last_result=?, last_result_kind=? WHERE user_id=?').run(newTier, wk, m.nw, msg, kind, m.uid);
    });
  }
  setMeta(); return true;
}
// Ensure a league row exists for a player and belongs to the current
// week. New players start in Bronze, snapshotted at their current net
// worth. If the week turned over and no rollover ran yet, roll over first
// so last week's standings still count.
function ensureLeagueRow(uid, netWorth) {
  let row = getLeagueRow(uid);
  const wk = etWeekKey();
  if (!row) {
    db.prepare('INSERT INTO leagues(user_id,tier,week_key,week_start_worth,last_result,last_result_kind) VALUES(?,?,?,?,?,?)').run(uid, 0, wk, netWorth, '', '');
    return getLeagueRow(uid);
  }
  if (row.week_key !== wk) {
    maybeLeagueRollover();
    row = getLeagueRow(uid);
    if (row.week_key !== wk) db.prepare('UPDATE leagues SET week_key=?, week_start_worth=? WHERE user_id=?').run(wk, netWorth, uid);
    row = getLeagueRow(uid);
  }
  return row;
}
// Standings for one player's league: same-tier players, chunked into
// groups of 30 by join order (stable), ranked by weekly % return.
function leagueStandings(uid, quotes) {
  const myRow = ensureLeagueRow(uid, netWorthOf(uid, quotes));
  const tier = leagueTierOf(myRow);
  const sameTier = db.prepare('SELECT u.id, u.name, u.is_owner, u.created_at FROM users u JOIN leagues l ON l.user_id=u.id WHERE l.tier=? ORDER BY u.created_at').all(tier);
  const myIdx = sameTier.findIndex(u => u.id === uid);
  const groupStart = Math.max(0, Math.floor(myIdx / LEAGUE_SIZE) * LEAGUE_SIZE);
  const group = sameTier.slice(groupStart, groupStart + LEAGUE_SIZE);
  const rows = group.map(u => {
    const row = getLeagueRow(u.id);
    const nw = netWorthOf(u.id, quotes);
    const start = row?.week_start_worth;
    const weeklyPct = start ? ((nw - start) / start) * 100 : 0;
    return { id: u.id, name: u.name, isOwner: !!u.is_owner, netWorth: Math.round(nw * 100) / 100, weeklyPct: Math.round(weeklyPct * 100) / 100 };
  });
  rows.sort((a, b) => (b.weeklyPct - a.weeklyPct) || (b.netWorth - a.netWorth) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const { promote, demote } = leagueZoneCounts(rows.length);
  return {
    tier, tierName: LEAGUE_TIERS[tier].name, tierColor: LEAGUE_TIERS[tier].color,
    leagueSize: rows.length, promoteCount: promote, demoteCount: demote,
    standings: rows.map((r, i) => ({ rank: i + 1, ...r, isYou: r.id === uid, zone: i < promote ? 'promote' : i >= rows.length - demote ? 'demote' : 'stay' })),
  };
}

// Leaderboard rows: public numbers only — name, owner flag, net worth,
// cash, today + all-time change. Never PINs, tokens, emails or salts.
function leaderboardRows() {
  const users = db.prepare('SELECT id, name, is_owner FROM users ORDER BY created_at').all();
  // M2: every player is ranked on the SAME quote set. The old code called
  // publicState() per player, and the per-player overnight freeze meant one
  // player could be ranked on the 4 PM close while another got the live
  // extended price. L20: round the numbers — float noise used to rank a
  // player #1 with +0.00000009%.
  const shared = cachedQuotes();
  const r2 = v => Math.round((v || 0) * 100) / 100;
  const rows = users.map(u => {
    const s = publicState(u.id, { quotesOverride: shared, rawQuotes: true });
    const lt = s.league?.tier ?? 0;
    return { name: u.name, isOwner: !!u.is_owner, leagueTier: lt, leagueTierName: LEAGUE_TIERS[lt].name, leagueTierColor: LEAGUE_TIERS[lt].color, netWorth: r2(s.netWorth), cash: r2(s.cash), todayChange: r2(s.todayChange), todayPct: r2(s.todayPct), allTime: r2(s.allTime), allTimePct: r2(s.allTimePct) };
  });
  // Ranked by % return (allTimePct), NOT by dollars: a player who turned
  // $1,000 into $1,050 (+5%) beats one who turned $100,000 into $100,500
  // (+0.5%), even though the second made more dollars. Ties break by net
  // worth, then by name.
  rows.sort((a, b) => (b.allTimePct - a.allTimePct) || (b.netWorth - a.netWorth) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}
function rankFor(allTimePct) {
  // Ranks are % return only — never dollars, so a small account that
  // doubles beats a big account that barely moves.
  if (allTimePct >= 25) return 'Whale';
  if (allTimePct >= 10) return 'Diamond Hands';
  if (allTimePct >= 5) return 'Trader';
  if (allTimePct >= 0) return 'Rookie';
  return 'Paper Hands';
}
// Achievements: purely computed from existing tables — no new input.
// earnedAt is the qualifying trade's time where one exists, else null.
function computeAchievements(uid) {
  const s = publicState(uid);
  const trades = db.prepare('SELECT * FROM trades WHERE user_id=? ORDER BY created_at').all(uid);
  // M3: winning exits include short COVERS (a buy with source '-cover'),
  // not just sells — a +20% short win used to earn neither +10% Winner
  // nor Stop Honoured. Cover basis is the short value (total + pnl).
  const sells = trades.filter(t => t.side === 'sell' || (t.side === 'buy' && String(t.source || '').endsWith('-cover')));
  const gainPct = t => {
    const isCover = t.side === 'buy' && String(t.source || '').endsWith('-cover');
    const basis = isCover ? (t.total || 0) + (t.pnl || 0) : (t.total || 0) - (t.pnl || 0);
    return basis > 0 ? (t.pnl / basis) * 100 : 0;
  };
  const firstBigWin = sells.find(t => gainPct(t) >= 10);
  // Stop honoured: sold at a loss no worse than ~-6% vs cost (the -5%
  // stop, plus a point of fill slippage) instead of riding it further down.
  const stopSave = sells.find(t => { const g = gainPct(t); return g < 0 && g >= -6; });
  const distinctDays = new Set(trades.map(t => { const d = etDate(new Date(t.created_at)); return `${d.year}-${d.month}-${d.day}`; })).size;
  const firstAuto = trades.find(t => (t.source || '').startsWith('auto'));
  const bestWorth = s.bestWorth || s.netWorth;
  // Achievements are % return only — never dollars. The old "$150K Club /
  // $200K Club" badges rewarded a big starting cash, not skill: with a
  // $100k start, +50% is $150k and +100% is $200k, so the badges below
  // keep those milestones as % returns and work for any starting cash.
  const startCash = s.settings.startCash || START_CASH;
  const bestReturnPct = startCash ? ((bestWorth - startCash) / startCash) * 100 : 0;
  const badges = [
    { id: 'first-trade', name: 'First Trade', desc: 'Made your first trade', earned: trades.length >= 1, earnedAt: trades[0]?.created_at || null },
    { id: 'big-win', name: '+10% Winner', desc: 'Banked +10% or more on a single sell', earned: !!firstBigWin, earnedAt: firstBigWin?.created_at || null },
    { id: 'stop-honoured', name: 'Stop Honoured', desc: 'Sold at a loss within your stop instead of riding it down', earned: !!stopSave, earnedAt: stopSave?.created_at || null },
    { id: 'streak-5', name: '5-Day Trader', desc: 'Traded on 5 different days', earned: distinctDays >= 5, earnedAt: null },
    { id: 'return-50', name: '+50% Club', desc: 'All-time return reached +50%', earned: bestReturnPct >= 50, earnedAt: null },
    { id: 'return-100', name: '+100% Club', desc: 'All-time return reached +100% — doubled your money', earned: bestReturnPct >= 100, earnedAt: null },
    { id: 'ten-trades', name: '10 Trades', desc: 'Made 10 trades in total', earned: trades.length >= 10, earnedAt: trades[9]?.created_at || null },
    { id: 'first-auto', name: 'First Auto-Trade', desc: 'The auto trader made a trade for you', earned: !!firstAuto, earnedAt: firstAuto?.created_at || null },
  ];
  return {
    rank: rankFor(s.allTimePct),
    allTimePct: s.allTimePct, netWorth: s.netWorth, bestWorth, bestReturnPct: Math.round(bestReturnPct * 100) / 100,
    tradeCount: trades.length, distinctDays,
    earnedCount: badges.filter(b => b.earned).length, totalCount: badges.length,
    badges,
  };
}
function wipeGame(uid, startCash) {
  for (const t of ['positions', 'trades', 'predictor_chats', 'alerts', 'auto_log', 'email_queue', 'orders']) db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(uid);
  db.prepare('DELETE FROM net_worth_snapshots WHERE user_id=?').run(uid); // fresh game, fresh history
  db.prepare('UPDATE game SET cash=?, best_run=0, best_worth=? WHERE user_id=?').run(startCash, startCash, uid);
  const s = getSettings(uid); s.autoOn = false; saveSettings(uid, s);
  db.prepare('UPDATE leagues SET week_start_worth=? WHERE user_id=?').run(startCash, uid); // weekly % measures from the fresh start
  snapshotNetWorth(uid); // seed the new history at the starting amount
}

app.get('/api/health', (req, res) => res.json({ ok: true, app: APP_NAME, session: marketSession(), users: db.prepare('SELECT COUNT(*) c FROM users').get().c }));
// Public config — no auth needed (the welcome screen is shown before
// sign-in). Only exposes the Discord invite URL (empty until configured)
// plus two booleans the UI uses for its banners/badges.
app.get('/api/config', (req, res) => res.json({ discordInviteUrl: DISCORD_INVITE_URL, donateUrl: DONATE_URL, smtpConfigured: smtpConfigured(), aiConfigured: aiConfigured() }));
// H6: the sign-in page needs the player list before auth, so this stays
// public — but it no longer leaks which account is the owner (that flag
// used to let anyone target the owner account for PIN attacks). has_pin
// stays: the sign-in UI needs it to tell "sign in" from "claim".
app.get('/api/session', (req, res) => res.json({ players: db.prepare("SELECT id, name, CASE WHEN pin_hash IS NULL OR pin_hash = '' THEN 0 ELSE 1 END AS has_pin FROM users ORDER BY created_at").all() }));

app.post('/api/auth/register', rateLimit, async (req, res) => {
  const { name, pin, email, startCash } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Enter your name' });
  if (String(name).trim().length > 30) return res.status(400).json({ error: 'Name is too long (max 30 characters)' }); // L5
  if (pin && String(pin).length < 6) return res.status(400).json({ error: 'PIN must be at least 6 characters' }); // H5
  // Starting cash is chosen at sign-up ($100–$10,000,000, default $100,000).
  // Validate server-side — a bad value is rejected, never silently clamped.
  const scR = (startCash == null || startCash === '') ? { value: START_CASH } : validateStartCash(startCash);
  if (scR.error) return res.status(400).json({ error: scR.error });
  const sc = scR.value;
  if (db.prepare('SELECT 1 FROM users WHERE name=?').get(name.trim())) return res.status(400).json({ error: 'Could not create an account with that name — try another name' }); // H6: generic, no name-squatting oracle
  // Owner is ONLY an exact name match with OWNER_NAME (default Lucas,
  // case-insensitive). The first registrant is never owner just for being
  // first — a non-Lucas first account stays a regular player.
  const isOwner = name.trim().toLowerCase() === OWNER_NAME ? 1 : 0;
  // H4: registering the owner name WITH a PIN proves ownership — it needs
  // the owner claim code. (Registering it PIN-less is still allowed; the
  // claim step below enforces the code then.)
  if (isOwner && pin) {
    const chk = ownerClaimOk(req.body?.claimCode);
    if (!chk.ok) return res.status(403).json({ error: chk.error });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = pin ? hashPin(String(pin), salt) : null; // no PIN yet — claim it later with SET PIN & CLAIM IT
  const id = db.prepare('INSERT INTO users(name,pin_hash,salt,email,is_owner,created_at) VALUES(?,?,?,?,?,?)').run(name.trim(), pinHash, salt, '', isOwner, Date.now()).lastInsertRowid;
  // Save the chosen starting cash BEFORE creating the game, so getGame()
  // seeds cash (and the portfolio snapshot below) at exactly that amount.
  const s0 = getSettings(id); s0.startCash = sc; saveSettings(id, s0);
  getGame(id); snapshotNetWorth(id);
  // PIN-less accounts are claim-only: no session token, no auto sign-in.
  // The player must tap their name on the sign-in page and choose SET PIN & CLAIM IT.
  if (!pinHash) return res.json({ token: null, needsClaim: true, user: { id, name: name.trim(), isOwner: !!isOwner, emailVerified: false }, needsVerification: false, codeSent: false, codeError: null, smtpConfigured: smtpConfigured() });
  const token = newToken();
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); // M5: rotate — a new sign-in revokes older tokens
  db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(token, id, Date.now());
  let codeInfo = null;
  if ((email || '').trim()) { codeInfo = await sendVerificationCode(id, email); if (!codeInfo.ok) codeInfo = { ok: false, error: codeInfo.error, smtpConfigured: codeInfo.smtpConfigured }; }
  res.json({ token, user: { id, name: name.trim(), isOwner: !!isOwner, emailVerified: false }, needsVerification: !!(email || '').trim(), codeSent: !!codeInfo?.ok, codeError: codeInfo?.ok ? null : (codeInfo?.error || null), smtpConfigured: smtpConfigured() });
});
app.post('/api/auth/claim', rateLimit, (req, res) => {
  const { name, pin } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE name=?').get((name || '').trim());
  if (!user) return res.status(404).json({ error: 'No player with that name' });
  if (user.pin_hash) return res.status(400).json({ error: 'That player already has a PIN — sign in instead' });
  if (!pin || String(pin).length < 6) return res.status(400).json({ error: 'PIN must be at least 6 characters' }); // H5
  // H4: claiming the OWNER account proves ownership — it needs the claim code.
  if (user.is_owner) {
    const chk = ownerClaimOk(req.body?.claimCode);
    if (!chk.ok) return res.status(403).json({ error: chk.error });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET pin_hash=?, salt=? WHERE id=?').run(hashPin(String(pin), salt), salt, user.id);
  const token = newToken();
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id); // M5: rotate
  db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(token, user.id, Date.now());
  res.json({ token, user: { id: user.id, name: user.name, isOwner: !!user.is_owner, emailVerified: false } });
});
app.post('/api/auth/login', rateLimit, (req, res) => {
  const { name, pin } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE name=?').get((name || '').trim());
  // H6: one generic error for every failure — the old "no PIN yet" message
  // told an attacker which accounts exist without a PIN.
  if (!user || !user.pin_hash) return res.status(401).json({ error: 'Wrong name or PIN' });
  const lock = pinLockoutFor(user.id);
  if (lock?.lockedUntil) {
    const mins = Math.ceil((lock.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many wrong PINs — this account is locked for ${mins} more minute${mins === 1 ? '' : 's'}` });
  }
  const verified = verifyPin(String(pin || ''), user); // H5: scrypt + constant-time, legacy SHA-256 still accepted
  if (!verified) {
    const e = recordFailedPin(user.id);
    if (e.lockedUntil) return res.status(429).json({ error: 'Too many wrong PINs — this account is locked for 15 minutes' });
    return res.status(401).json({ error: 'Wrong name or PIN' });
  }
  if (verified === 'legacy') upgradePinHash(user.id, String(pin || '')); // silently upgrade old hashes to scrypt
  clearFailedPins(user.id);
  const token = newToken();
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id); // M5: rotate — a new sign-in revokes older tokens
  db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(token, user.id, Date.now());
  res.json({ token, user: { id: user.id, name: user.name, isOwner: !!user.is_owner, email: user.email, emailVerified: !!user.email_verified, pendingEmail: user.pending_email } });
});
app.post('/api/auth/logout', auth, (req, res) => {
  // Logout-all: delete EVERY token for this user, not just the one in use,
  // so no other device/browser stays signed in after sign-out.
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
  // Clear any old auth cookie left over from before the security fix.
  res.setHeader('Set-Cookie', 'token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

// Email verification
app.post('/api/email/send-code', auth, rateLimit, async (req, res) => {
  const r = await sendVerificationCode(req.user.id, req.body?.email || req.user.pending_email || req.user.email);
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});
app.post('/api/email/verify-code', auth, (req, res) => {
  const r = verifyCode(req.user.id, req.body?.code);
  if (!r.ok) return res.status(400).json(r);
  res.json({ ok: true, email: r.email, state: publicState(req.user.id) });
});

// Quotes / history / news
app.get('/api/quotes', auth, async (req, res) => {
  try {
    const q = await fetchLiveQuotes(boardSymbols(req.user.id).all);
    const eff = effectiveQuotesFor(req.user.id, q);
    evaluatePings(req.user.id, eff); // H8: pings really are evaluated every ~10 s now, as the UI claims
    evaluateOrders(req.user.id, eff); // open limit/stop orders fill on touch
    const stale = Object.values(q).some(v => !v.asOf || Date.now() - v.asOf > 60 * 1000) || Object.values(q).some(v => String(v.source || '').includes('simulated'));
    res.json({ quotes: eff, session: marketSession(), updatedAt: Date.now(), stale });
  }
  catch { res.json({ quotes: effectiveQuotesFor(req.user.id, cachedQuotes()), session: marketSession(), updatedAt: Date.now(), stale: true, note: 'live feed failed, showing last cached prices' }); }
});
app.get('/api/history', auth, async (req, res) => {
  const { symbol, range } = req.query;
  if (!boardSymbols(req.user.id).all.includes(symbol)) return res.status(400).json({ error: 'Unknown ticker — add it as your own pick first' });
  const VALID_RANGES = ['1D', '5D', '1M', '3M', '6M', '1Y', '5Y'];
  const r = range || '1D';
  if (!VALID_RANGES.includes(r)) return res.status(400).json({ error: 'Unknown range — use 1D, 5D, 1M, 3M, 6M, 1Y or 5Y' });
  try { res.json(await fetchHistory(symbol, r)); } catch (e) { res.status(502).json({ error: 'History feed failed: ' + e.message }); }
});
app.get('/api/news', auth, async (req, res) => {
  try {
    const quotes = cachedQuotes();
    const moverRows = Object.values(quotes).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 6);
    const movers = moverRows.map(q => ({ symbol: q.symbol, changePct: q.changePct }));
    const syms = movers.length ? movers.map(m => m.symbol) : TICKERS.slice(0, 6);
    const groups = await fetchNewsGrouped(syms);
    const headlines = groups.flatMap(g => g.headlines.map(h => ({ ...h, symbol: g.symbol })));
    res.json({ movers, groups, headlines, searchedAt: Date.now() });
  }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// Custom stocks & crypto
app.post('/api/custom-symbols', auth, async (req, res) => {
  let { symbol, kind } = req.body || {};
  symbol = String(symbol || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!symbol) return res.status(400).json({ error: 'Enter a ticker, e.g. AAPL or BTC' });
  if (TICKERS.includes(symbol)) return res.status(400).json({ error: symbol + ' is already on the core watchlist' });
  const existing = boardSymbols(req.user.id).custom;
  if (existing.length >= 12) return res.status(400).json({ error: 'You can add up to 12 of your own picks' });
  if (existing.some(c => c.symbol === symbol)) return res.status(400).json({ error: 'Already on your board' });
  kind = kind === 'crypto' || KNOWN_CRYPTO.has(symbol) ? 'crypto' : 'stock';
  if (kind === 'crypto' && !symbol.includes('-')) symbol = symbol + '-USD';
  if (existing.some(c => c.symbol === symbol)) return res.status(400).json({ error: 'Already on your board' });
  // Verify against the live feed first — no live price, no add.
  let name = symbol, livePrice = null;
  try { const meta = (await yahooChart(symbol, '5d', '1d')).meta || {}; livePrice = meta.regularMarketPrice ?? meta.chartPreviousClose ?? null; name = meta.longName || meta.shortName || symbol; if (livePrice == null) throw new Error('no live price'); }
  catch (e) { return res.status(400).json({ error: `Couldn't find a live price for ${symbol} — check the ticker and try again` }); }
  db.prepare('INSERT INTO custom_symbols(user_id,symbol,kind,name,created_at) VALUES(?,?,?,?,?)').run(req.user.id, symbol, kind, name, Date.now());
  res.json({ ok: true, symbol, kind, name, price: livePrice, state: publicState(req.user.id) });
});
app.delete('/api/custom-symbols', auth, (req, res) => {
  const symbol = String(req.body?.symbol || '').trim().toUpperCase();
  const pos = db.prepare('SELECT * FROM positions WHERE user_id=? AND symbol=?').get(req.user.id, symbol);
  if (pos) return res.status(400).json({ error: 'Sell your ' + symbol + ' shares first — you still hold ' + pos.shares });
  db.prepare('DELETE FROM custom_symbols WHERE user_id=? AND symbol=?').run(req.user.id, symbol);
  res.json({ ok: true, state: publicState(req.user.id) });
});

// Game state + trading
app.get('/api/state', auth, (req, res) => res.json(publicState(req.user.id)));
// Leaderboard — read-only, authenticated, public numbers only.
app.get('/api/leaderboard', auth, (req, res) => res.json({ players: leaderboardRows(), you: req.user.name }));
app.get('/api/leagues', auth, (req, res) => {
  maybeLeagueRollover(); // a week boundary while the server was quiet still rolls over on first read
  const shared = cachedQuotes();
  // Make sure every player has a current-week row before grouping.
  for (const u of db.prepare('SELECT id FROM users').all()) ensureLeagueRow(u.id, netWorthOf(u.id, shared));
  const wk = etWeekKey();
  const st = leagueStandings(req.user.id, shared);
  const me = st.standings.find(r => r.isYou);
  const myRow = getLeagueRow(req.user.id);
  res.json({
    tiers: LEAGUE_TIERS, tier: st.tier, tierName: st.tierName, tierColor: st.tierColor,
    weekKey: wk, weekEndsAt: etWeekEndsAtMs(wk),
    leagueSize: st.leagueSize, promoteCount: st.promoteCount, demoteCount: st.demoteCount,
    lastResult: myRow?.last_result || '', lastResultKind: myRow?.last_result_kind || '',
    you: me || null, standings: st.standings,
  });
});
// Stock chat — a shared discussion feed for all players. Messages are
// stored verbatim (names and text exactly as sent) and MUST be escaped on
// render (frontend uses escapeHtml()); the API returns JSON, never HTML,
// so nothing stored here can execute. Newest first, latest ~100.
// ?symbol= filters to one board ticker, ?limit= caps the count (1–100).
app.get('/api/chat', auth, (req, res) => {
  const symbol = req.query.symbol ? String(req.query.symbol).trim().toUpperCase() : null;
  if (symbol && !boardSymbols(req.user.id).all.includes(symbol)) return res.status(400).json({ error: 'Unknown ticker — add it as your own pick first' });
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit)) limit = 100;
  limit = Math.min(100, Math.max(1, limit));
  const rows = symbol
    ? db.prepare('SELECT id, user_id, name, symbol, message, created_at FROM chat_messages WHERE symbol=? ORDER BY created_at DESC, id DESC LIMIT ?').all(symbol, limit)
    : db.prepare('SELECT id, user_id, name, symbol, message, created_at FROM chat_messages ORDER BY created_at DESC, id DESC LIMIT ?').all(limit);
  res.json({ messages: rows });
});
app.post('/api/chat', auth, (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  if (!message) return res.status(400).json({ error: 'Write a message first' });
  if (message.length > 500) return res.status(400).json({ error: 'Message is too long (max 500 characters)' });
  let symbol = req.body?.symbol ? String(req.body.symbol).trim().toUpperCase() : null;
  if (symbol && !boardSymbols(req.user.id).all.includes(symbol)) return res.status(400).json({ error: 'Unknown ticker — add it as your own pick first' });
  // Light anti-spam: one message per user per 3 seconds.
  const last = db.prepare('SELECT created_at FROM chat_messages WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(req.user.id);
  if (last && Date.now() - last.created_at < 3000) return res.status(429).json({ error: 'Slow down — wait a few seconds between messages' });
  const id = db.prepare('INSERT INTO chat_messages(user_id,name,symbol,message,created_at) VALUES(?,?,?,?,?)').run(req.user.id, req.user.name, symbol, message, Date.now()).lastInsertRowid;
  // Keep the table bounded: drop everything older than the newest 1000.
  db.prepare('DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY created_at DESC, id DESC LIMIT 1000)').run();
  res.json({ ok: true, message: { id, user_id: req.user.id, name: req.user.name, symbol, message, created_at: Date.now() } });
});
// Portfolio history — current user's net-worth snapshots, last 7 days, capped at 500 points.
app.get('/api/portfolio-history', auth, (req, res) => {
  snapshotNetWorth(req.user.id); // ensure at least one point exists
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const rows = db.prepare('SELECT net_worth, created_at FROM net_worth_snapshots WHERE user_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 500').all(req.user.id, weekAgo).reverse();
  res.json({ points: rows.map(r => ({ t: r.created_at, netWorth: r.net_worth })), startCash: getSettings(req.user.id).startCash || START_CASH });
});
// Achievements + rank — computed from existing trades/game data.
app.get('/api/achievements', auth, (req, res) => res.json(computeAchievements(req.user.id)));

// ---------- Daily challenges + streaks (Duolingo-style) ----------
// 3 fresh challenges every ET day, rotated deterministically from a pool
// of 6, so every player gets the same 3 on the same day. Progress is
// computed server-side from real rows (trades, Predictor chats, ticker
// views) — the client can never claim XP it did not earn. XP is awarded
// once per challenge per day (challenge_claims PK blocks double-claims).
// Streak = consecutive ET days with at least one challenge or trade;
// touchActivity() is called on trades, Predictor asks and challenge
// claims. A missed day resets the streak to 1 on the next active day.
function etDayKey(d = new Date()) { const e = etDate(d); return `${e.year}-${String(e.month).padStart(2, '0')}-${String(e.day).padStart(2, '0')}`; }
function etDayNumber(d = new Date()) { const e = etDate(d); return Math.floor(Date.UTC(e.year, e.month - 1, e.day) / 86400000); }
function dayNumberToKey(n) { const d = new Date(n * 86400000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function getProgress(uid) {
  let row = db.prepare('SELECT * FROM user_progress WHERE user_id=?').get(uid);
  if (!row) { db.prepare('INSERT INTO user_progress(user_id,xp,streak,last_active_date) VALUES(?,?,?,?)').run(uid, 0, 0, ''); row = { user_id: uid, xp: 0, streak: 0, last_active_date: '' }; }
  return row;
}
function touchActivity(uid) {
  const today = etDayKey();
  const p = getProgress(uid);
  if (p.last_active_date === today) return p;
  const yesterday = dayNumberToKey(etDayNumber() - 1);
  const streak = p.last_active_date === yesterday ? (p.streak || 0) + 1 : 1;
  db.prepare('UPDATE user_progress SET streak=?, last_active_date=? WHERE user_id=?').run(streak, today, uid);
  return { ...p, streak, last_active_date: today };
}
const CHALLENGE_POOL = [
  { key: 'trade-1', title: 'Make 1 trade', desc: 'Buy or sell any ticker today.', xp: 10, goal: 1 },
  { key: 'day-up-1', title: 'Finish the day up +1%', desc: 'End today at least 1% above where you started it.', xp: 10, goal: 1 },
  { key: 'predictor-1', title: 'Ask the Predictor a question', desc: 'Ask Verity AI or Rules-only about any ticker.', xp: 10, goal: 1 },
  { key: 'tickers-3', title: 'Check 3 different tickers', desc: 'Open the chart for 3 different tickers today.', xp: 10, goal: 3 },
  { key: 'sell-profit', title: 'Sell for a profit', desc: 'Close a trade in the green today.', xp: 10, goal: 1 },
  { key: 'hold-overnight', title: 'Hold a position overnight', desc: 'Hold a position you opened on an earlier day.', xp: 10, goal: 1 },
];
function todaysChallengeKeys(dateKey) {
  let seed = 0; for (const ch of dateKey) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const arr = CHALLENGE_POOL.map(c => c.key);
  for (let i = arr.length - 1; i > 0; i--) { seed = (seed * 1664525 + 1013904223) >>> 0; const j = seed % (i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr.slice(0, 3);
}
function challengeProgress(uid, key, todayKey, dayStart, dayEnd, st) {
  switch (key) {
    case 'trade-1': { const c = db.prepare('SELECT COUNT(*) c FROM trades WHERE user_id=? AND created_at>=? AND created_at<?').get(uid, dayStart, dayEnd).c; return { progress: Math.min(c, 1), goal: 1 }; }
    case 'day-up-1': { const done = (st?.todayPct || 0) >= 1 ? 1 : 0; return { progress: done, goal: 1 }; }
    case 'predictor-1': { const c = db.prepare('SELECT COUNT(*) c FROM predictor_chats WHERE user_id=? AND created_at>=? AND created_at<?').get(uid, dayStart, dayEnd).c; return { progress: Math.min(c, 1), goal: 1 }; }
    case 'tickers-3': { const c = db.prepare('SELECT COUNT(DISTINCT symbol) c FROM ticker_views WHERE user_id=? AND date=?').get(uid, todayKey).c; return { progress: Math.min(c, 3), goal: 3 }; }
    case 'sell-profit': { const c = db.prepare("SELECT COUNT(*) c FROM trades WHERE user_id=? AND pnl>0 AND created_at>=? AND created_at<? AND ((side='sell') OR (side='buy' AND source LIKE '%-cover'))").get(uid, dayStart, dayEnd).c; return { progress: Math.min(c, 1), goal: 1 }; }
    case 'hold-overnight': {
      const open = db.prepare('SELECT COUNT(*) c FROM positions WHERE user_id=? AND created_at<?').get(uid, dayStart).c;
      const closed = db.prepare("SELECT COUNT(*) c FROM trades t WHERE user_id=? AND t.created_at>=? AND t.created_at<? AND ((t.side='sell' AND t.pnl<>0) OR (t.side='buy' AND t.source LIKE '%-cover')) AND EXISTS (SELECT 1 FROM trades b WHERE b.user_id=t.user_id AND b.symbol=t.symbol AND b.created_at<? AND ((b.side='buy' AND b.source NOT LIKE '%-cover') OR (b.side='sell' AND b.source LIKE '%-short')))").get(uid, dayStart, dayEnd, dayStart).c;
      return { progress: (open > 0 || closed > 0) ? 1 : 0, goal: 1 };
    }
    default: return { progress: 0, goal: 1 };
  }
}
function todaysChallenges(uid) {
  const e = etDate(); const todayKey = etDayKey(); const [dayStart, dayEnd] = etDayBounds(e.year, e.month, e.day);
  const st = publicState(uid);
  const p = getProgress(uid);
  const claimed = new Set(db.prepare('SELECT key FROM challenge_claims WHERE user_id=? AND date=?').all(uid, todayKey).map(r => r.key));
  const challenges = todaysChallengeKeys(todayKey).map(k => {
    const def = CHALLENGE_POOL.find(c => c.key === k);
    const pr = challengeProgress(uid, k, todayKey, dayStart, dayEnd, st);
    return { key: k, title: def.title, desc: def.desc, xp: def.xp, goal: pr.goal, progress: pr.progress, done: pr.progress >= pr.goal, claimed: claimed.has(k) };
  });
  return { date: todayKey, xp: p.xp, streak: p.streak, lastActiveDate: p.last_active_date, challenges };
}
app.get('/api/challenges', auth, (req, res) => res.json(todaysChallenges(req.user.id)));
app.post('/api/challenges/claim', auth, (req, res) => {
  const key = req.body?.key;
  const todayKey = etDayKey();
  const e = etDate(); const [dayStart, dayEnd] = etDayBounds(e.year, e.month, e.day);
  if (!todaysChallengeKeys(todayKey).includes(key)) return res.status(400).json({ error: "That is not one of today's challenges" });
  const def = CHALLENGE_POOL.find(c => c.key === key);
  const st = publicState(req.user.id);
  const pr = challengeProgress(req.user.id, key, todayKey, dayStart, dayEnd, st);
  if (pr.progress < pr.goal) return res.status(400).json({ error: 'Challenge not complete yet — finish it first' });
  const already = db.prepare('SELECT 1 FROM challenge_claims WHERE user_id=? AND date=? AND key=?').get(req.user.id, todayKey, key);
  if (already) return res.status(400).json({ error: 'Already claimed — XP was already awarded for this one' });
  db.prepare('INSERT INTO challenge_claims(user_id,date,key,xp,created_at) VALUES(?,?,?,?,?)').run(req.user.id, todayKey, key, def.xp, Date.now());
  const p = getProgress(req.user.id);
  db.prepare('UPDATE user_progress SET xp=? WHERE user_id=?').run((p.xp || 0) + def.xp, req.user.id);
  touchActivity(req.user.id);
  res.json({ ok: true, awarded: def.xp, ...todaysChallenges(req.user.id) });
});
// Ticker views feed the "Check 3 different tickers" challenge. The client
// reports a view once per ticker per day; the PK dedupes replays.
app.post('/api/activity/view', auth, (req, res) => {
  const sym = String(req.body?.symbol || '').toUpperCase().trim();
  if (!sym) return res.status(400).json({ error: 'No ticker' });
  db.prepare('INSERT OR IGNORE INTO ticker_views(user_id,symbol,date,created_at) VALUES(?,?,?,?)').run(req.user.id, sym, etDayKey(), Date.now());
  res.json({ ok: true });
});

// ---------- Trade review / Coach (rules) ----------
// Honest rules analysis only — there is NO AI key on the server, so this
// is labelled "Coach (rules)" in the UI and never pretends to be AI.
// Everything comes from real trade rows: entry, exit, size, P&L,
// timestamps and stop/target settings. It never invents a future price —
// "you would have made $X more by holding" is NOT computed, because the
// price 1 day after a sell is not in the DB.
function computeCoach(uid) {
  const closed = db.prepare("SELECT * FROM trades WHERE user_id=? AND pnl<>0 AND ((side='sell') OR (side='buy' AND source LIKE '%-cover')) ORDER BY created_at ASC").all(uid);
  if (!closed.length) return { empty: true, observations: [], stats: null };
  const wins = closed.filter(t => t.pnl > 0), losses = closed.filter(t => t.pnl < 0);
  const winRate = Math.round((wins.length / closed.length) * 1000) / 10;
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, t) => a + t.pnl, 0) / losses.length : 0; // negative
  // Holding time: pair each close with the latest earlier open of the
  // same symbol (a buy for a long sell, a short-open sell for a cover).
  const opens = db.prepare("SELECT * FROM trades WHERE user_id=? AND ((side='buy' AND source NOT LIKE '%-cover') OR (side='sell' AND source LIKE '%-short')) ORDER BY created_at ASC").all(uid);
  let holdSum = 0, holdN = 0;
  for (const c of closed) {
    const o = [...opens].reverse().find(o => o.symbol === c.symbol && o.created_at < c.created_at);
    if (o) { holdSum += c.created_at - o.created_at; holdN++; }
  }
  const avgHoldHrs = holdN ? holdSum / holdN / 3600000 : null;
  // Stop discipline: a losing sell counts as "honoured" when the loss is
  // within ~7% of the trade's exit value — close to the -5% stop line.
  const losingSells = losses.filter(t => t.side === 'sell');
  const honoured = losingSells.filter(t => t.total > 0 && (-t.pnl / t.total) <= 0.07).length;
  // Best / worst ticker by average P&L per closed trade.
  const bySym = {};
  for (const t of closed) { (bySym[t.symbol] = bySym[t.symbol] || { n: 0, pnl: 0 }); bySym[t.symbol].n++; bySym[t.symbol].pnl += t.pnl; }
  const syms = Object.entries(bySym).map(([s, v]) => ({ symbol: s, avg: v.pnl / v.n, n: v.n, total: v.pnl })).sort((a, b) => b.avg - a.avg);
  const best = syms[0], worst = syms[syms.length - 1];
  const allTrades = db.prepare('SELECT symbol, COUNT(*) c FROM trades WHERE user_id=? GROUP BY symbol ORDER BY c DESC LIMIT 1').get(uid);
  const fmt$ = v => '$' + Number(v).toFixed(2);
  const obs = [];
  obs.push(`Win rate ${winRate}% — ${wins.length} wins out of ${closed.length} closed trades. Average win ${fmt$(avgWin)}, average loss ${fmt$(avgLoss)}${avgWin && avgLoss ? ` — your wins are ${(avgWin / Math.abs(avgLoss)).toFixed(1)}x the size of your losses.` : '.'}`);
  if (avgHoldHrs != null) {
    const holdTxt = avgHoldHrs < 24 ? `${avgHoldHrs.toFixed(1)} hours` : `${(avgHoldHrs / 24).toFixed(1)} days`;
    obs.push(`You hold trades for ${holdTxt} on average${avgHoldHrs < 24 ? ' — fast in-and-out, a day-trading pace.' : avgHoldHrs < 24 * 7 ? ' — a swing-trading pace.' : ' — a position-trading pace, weeks at a time.'}`);
  }
  if (losingSells.length) {
    const honPct = Math.round((honoured / losingSells.length) * 100);
    obs.push(honoured === losingSells.length
      ? `Stop discipline is clean — you honoured your stop on all ${losingSells.length} losing sell${losingSells.length === 1 ? '' : 's'} (losses cut within ~7% of the exit value).`
      : `Stop discipline: ${honoured} of ${losingSells.length} losing sells (${honPct}%) were cut within ~7% of the exit value — the rest ran past your stop line. Cutting sooner on those would have kept the losses smaller.`);
  } else {
    obs.push('No losing sells yet — every closed trade so far is a win. The stop line has not been tested.');
  }
  if (best && worst && best.symbol !== worst.symbol) {
    obs.push(`Best ticker: ${best.symbol} (${fmt$(best.avg)} average per closed trade, ${best.n} trade${best.n === 1 ? '' : 's'}). Worst ticker: ${worst.symbol} (${fmt$(worst.avg)} average per closed trade, ${worst.n} trade${worst.n === 1 ? '' : 's'}).`);
  } else if (best) {
    obs.push(`Best (and only) ticker so far: ${best.symbol} (${fmt$(best.avg)} average per closed trade). Try another ticker to compare.`);
  }
  if (allTrades) obs.push(`Most traded ticker: ${allTrades.symbol} (${allTrades.c} trade${allTrades.c === 1 ? '' : 's'}).`);
  return {
    empty: false,
    observations: obs.slice(0, 5),
    stats: { closed: closed.length, wins: wins.length, losses: losses.length, winRate, avgWin: Math.round(avgWin * 100) / 100, avgLoss: Math.round(avgLoss * 100) / 100, avgHoldHrs: avgHoldHrs == null ? null : Math.round(avgHoldHrs * 10) / 10, stopHonoured: honoured, stopTotal: losingSells.length, best, worst },
  };
}
app.get('/api/coach', auth, (req, res) => res.json(computeCoach(req.user.id)));
app.post('/api/trade', auth, async (req, res) => {
  const { symbol, side, shares } = req.body || {};
  if (!boardSymbols(req.user.id).all.includes(symbol) || !['buy', 'sell'].includes(side) || !(shares > 0)) return res.status(400).json({ error: 'Bad trade' });
  const quotes = effectiveQuotesFor(req.user.id, await fetchLiveQuotes(boardSymbols(req.user.id).all));
  const price = quotes[symbol]?.price;
  if (!price) return res.status(502).json({ error: 'Live price unavailable right now' });
  const r = applyTrade(req.user.id, symbol, side, +shares, price, 'manual');
  if (r.error) return res.status(400).json({ error: r.error });
  snapshotNetWorth(req.user.id); // throttled to 90 s, so cheap
  res.json({ ok: true, price, shorted: !!r.shorted, covered: !!r.covered, pnl: r.pnl || 0, session: marketSession(), state: publicState(req.user.id, { updateBest: true }) });
});
// Limit / stop orders — place, list, cancel. A new order fills immediately
// if the live price already touches its target.
app.post('/api/orders', auth, async (req, res) => {
  const { symbol, side, type, targetPrice, shares } = req.body || {};
  if (!boardSymbols(req.user.id).all.includes(symbol)) return res.status(400).json({ error: 'Unknown ticker — add it as your own pick first' });
  if (!['buy', 'sell'].includes(side)) return res.status(400).json({ error: 'Side must be buy or sell' });
  if (!['limit', 'stop'].includes(type)) return res.status(400).json({ error: 'Type must be limit or stop' });
  const target = +targetPrice, qty = +shares;
  if (!Number.isFinite(target) || target <= 0) return res.status(400).json({ error: 'Enter a target price above $0' });
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Enter shares above 0' });
  if (qty * target < 0.01) return res.status(400).json({ error: 'Order too small — total must be at least $0.01' });
  const openCount = db.prepare("SELECT COUNT(*) c FROM orders WHERE user_id=? AND status='open'").get(req.user.id).c;
  if (openCount >= 20) return res.status(400).json({ error: 'You already have 20 open orders — cancel one first' });
  const id = db.prepare('INSERT INTO orders(user_id,symbol,side,type,target_price,shares,created_at) VALUES(?,?,?,?,?,?,?)').run(req.user.id, symbol, side, type, target, qty, Date.now()).lastInsertRowid;
  let filledNow = false;
  try {
    const quotes = effectiveQuotesFor(req.user.id, await fetchLiveQuotes(boardSymbols(req.user.id).all));
    evaluateOrders(req.user.id, quotes);
    filledNow = db.prepare('SELECT status FROM orders WHERE id=?').get(id).status === 'filled';
  } catch {}
  res.json({ ok: true, id, filledNow, orders: listOrders(req.user.id), state: publicState(req.user.id, { updateBest: true }) });
});
app.get('/api/orders', auth, (req, res) => res.json({ orders: listOrders(req.user.id) }));
app.post('/api/orders/:id/cancel', auth, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  if (o.status !== 'open') return res.status(400).json({ error: 'That order is already ' + o.status });
  db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(o.id);
  res.json({ ok: true, orders: listOrders(req.user.id) });
});
app.post('/api/reset', auth, (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirmation required' });
  const sc = getSettings(req.user.id).startCash || START_CASH;
  wipeGame(req.user.id, sc);
  // NOTE: quote_cache is NOT deleted here — it is the shared live-price
  // fallback for every player, not part of one player's game.
  res.json({ ok: true, state: publicState(req.user.id) });
});
app.post('/api/settings/start-cash', auth, (req, res) => {
  const chk = validateStartCash(req.body?.amount); // M6: same validator as register (floors fractions)
  if (chk.error) return res.status(400).json({ error: chk.error });
  const amount = chk.value;
  const s = getSettings(req.user.id); s.startCash = amount; saveSettings(req.user.id, s);
  wipeGame(req.user.id, amount); // restarts fresh; board, settings, email and theme survive
  res.json({ ok: true, startCash: amount, state: publicState(req.user.id, { updateBest: true }) });
});
app.post('/api/account/delete', auth, (req, res) => {
  const { pin } = req.body || {};
  if (req.user.is_owner) return res.status(403).json({ error: 'The owner account cannot be deleted — it runs the feedback inbox and player list for everyone else.' });
  if (!req.user || !verifyPin(String(pin || ''), req.user)) return res.status(401).json({ error: 'Wrong PIN — account not deleted.' });
  const uid = req.user.id;
  for (const t of ['positions', 'trades', 'predictor_chats', 'predictor_ai_usage', 'alerts', 'auto_log', 'email_queue', 'settings', 'custom_symbols', 'email_verifications', 'net_worth_snapshots', 'orders', 'chat_messages', 'game', 'sessions', 'pin_lockouts', 'user_progress', 'challenge_claims', 'ticker_views', 'leagues']) db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(uid);
  db.prepare('DELETE FROM feedback WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM users WHERE id=?').run(uid);
  res.json({ ok: true });
});

// Predictor daily limit — AI mode ONLY. Standard members get 2 Verity AI
// questions per ET calendar day; rules-only questions are unlimited and
// never counted, and the owner is unlimited in both modes.
//
// C4: the count lives in a SEPARATE append-only ledger (predictor_ai_usage)
// that NOTHING deletes — not Clear history, not a game reset. The old code
// counted rows in predictor_chats, so DELETE /api/predictor (the UI's
// "Clear history" button) reset the day's count back to 0 and gave
// unlimited AI asks.
const PREDICTOR_AI_DAILY_LIMIT = 2;
function predictorAiUsedToday(uid) {
  const d = etDate();
  const [start, end] = etDayBounds(d.year, d.month, d.day);
  // Legacy rows (before the ledger existed) counted from predictor_chats so
  // old asks still count toward today's limit; the ledger is authoritative
  // for everything since. Take the max, never the sum (a legacy ask is also
  // in the ledger once it was recorded there).
  const legacy = db.prepare(`SELECT COUNT(*) c FROM predictor_chats WHERE user_id=? AND (mode IS NULL OR mode='ai') AND created_at>=? AND created_at<? AND NOT EXISTS (SELECT 1 FROM predictor_ai_usage WHERE user_id=? AND ABS(created_at - predictor_chats.created_at) < 2000)`).get(uid, start, end, uid).c;
  const ledger = db.prepare('SELECT COUNT(*) c FROM predictor_ai_usage WHERE user_id=? AND created_at>=? AND created_at<?').get(uid, start, end).c;
  return legacy + ledger;
}
function predictorLimitInfo(uid, user) {
  if (user?.is_owner) return { predictorLimit: PREDICTOR_AI_DAILY_LIMIT, predictorUsed: predictorAiUsedToday(uid), predictorRemaining: null, predictorUnlimited: true };
  const used = predictorAiUsedToday(uid);
  return { predictorLimit: PREDICTOR_AI_DAILY_LIMIT, predictorUsed: used, predictorRemaining: Math.max(0, PREDICTOR_AI_DAILY_LIMIT - used), predictorUnlimited: false };
}
// Predictor
app.post('/api/predictor', auth, async (req, res) => {
  const { symbol, question } = req.body || {};
  if (!boardSymbols(req.user.id).all.includes(symbol) || !question) return res.status(400).json({ error: 'Pick a ticker and ask a question' });
  // Mode: 'ai' (Verity AI, limited) or 'rules' (rules-only, unlimited).
  // No mode sent = 'ai', as before. The 2/day limit applies ONLY to AI
  // asks by non-owners — rules-only asks are never counted or blocked,
  // and the owner is unlimited in both modes. Check BEFORE any live
  // fetch or AI call, so a blocked ask costs nothing and is not recorded.
  const mode = req.body?.mode === 'rules' ? 'rules' : 'ai';
  if (mode === 'ai' && !req.user.is_owner && predictorAiUsedToday(req.user.id) >= PREDICTOR_AI_DAILY_LIMIT) {
    return res.status(429).json({ error: 'Daily Predictor limit reached — 2 AI questions a day for standard members. Come back tomorrow. (Rules-only questions are unlimited — switch to Rules only below.)', ...predictorLimitInfo(req.user.id, req.user) });
  }
  const quotes = effectiveQuotesFor(req.user.id, await fetchLiveQuotes(boardSymbols(req.user.id).all));
  const q = quotes[symbol];
  const res2 = await researchPass(symbol, quotes);
  const chg = q ? q.changePct : 0;
  let outlook = 'Neutral', confidence = 50;
  if (chg <= -3) { outlook = 'Bearish'; confidence = 60; } else if (chg >= 3) { outlook = 'Bullish'; confidence = 60; }
  else if (chg >= 1) { outlook = 'Bullish'; confidence = 45; } else if (chg <= -1) { outlook = 'Bearish'; confidence = 45; }
  // AI runs only in AI mode. Rules mode skips the AI call entirely —
  // the answer below is built from live price, trend and news.
  const ai = mode === 'ai' ? await aiDecide(`You are a paper-trading analyst. Ticker ${symbol}, live price $${q?.price}, day change ${chg.toFixed(2)}%. Trend: ${res2.trend} Headlines: ${res2.headlines.join('; ') || 'none'}. Question: ${question}. Give outlook (Bullish/Bearish/Neutral/Mixed), confidence 0-100, 3 key points, 2 risks, timeframe. Keep it short. Start your reply with two lines: OUTLOOK: <Bullish|Bearish|Neutral|Mixed> and CONFIDENCE: <0-100>.`) : null;
  // C8: the outlook/confidence used to be computed from rules BEFORE the AI
  // call and never updated from the AI reply — the "AI" chip was never AI.
  // Now the AI's own OUTLOOK:/CONFIDENCE: lines win when the AI succeeds;
  // otherwise the chip is labelled as a rules outlook.
  let outlookSource = 'rules';
  if (ai) {
    const om = ai.match(/OUTLOOK:\s*(Bullish|Bearish|Neutral|Mixed)/i);
    const cm = ai.match(/CONFIDENCE:\s*(\d{1,3})/i);
    if (om) { outlook = om[1][0].toUpperCase() + om[1].slice(1).toLowerCase(); outlookSource = 'ai'; }
    if (cm) { confidence = Math.max(0, Math.min(100, +cm[1])); outlookSource = 'ai'; }
  }
  const timeframe = /week/i.test(question) ? 'This week' : /swing/i.test(question) ? 'Next 1–4 weeks' : 'Next 1–5 trading days';
  const keyPoints = [
    `Live price $${q?.price} (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% today, prev close $${q?.prevClose}) — momentum is ${chg >= 0 ? 'positive' : 'negative'} today.`,
    `Trend: ${res2.trend}`,
    res2.headlines.length ? `Fresh headlines: ${res2.headlines.join(' | ')}` : 'No fresh headlines found for this ticker.',
  ];
  const risks = ['After-hours moves can reverse at the open', 'Single-day moves are noisy — watch the -5% stop / +10% target lines'];
  let answer = ai || `${symbol} — ${outlook} (${confidence}% confidence).\n${keyPoints.join('\n')}\nRisks: ${risks.join('; ')}.\nTimeframe: ${timeframe}.\n${mode === 'rules' ? '(Rules-only answer — no AI used, unlimited questions.)' : '(AI research unavailable — no AI_API_KEY configured; answer is rules-based from live price, trend and news.)'}`;
  db.prepare('INSERT INTO predictor_chats(user_id,symbol,question,answer,outlook,confidence,price_at_ask,timeframe,key_points,risks,mode,outlook_source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(req.user.id, symbol, question, answer, outlook, confidence, q?.price || 0, timeframe, JSON.stringify(keyPoints), JSON.stringify(risks), mode, outlookSource, Date.now());
  if (mode === 'ai') db.prepare('INSERT INTO predictor_ai_usage(user_id,created_at) VALUES(?,?)').run(req.user.id, Date.now()); // C4: append-only usage ledger
  touchActivity(req.user.id); // asking the Predictor counts toward the daily streak
  res.json({ outlook, confidence, outlookSource, answer, timeframe, keyPoints, risks, priceAtAsk: q?.price || 0, predictorMode: mode, ...predictorLimitInfo(req.user.id, req.user), state: publicState(req.user.id) });
});
// How many of today's 2 AI questions a standard member has left.
// Rules-only questions are unlimited, so they are not counted here.
app.get('/api/predictor/limit', auth, (req, res) => res.json(predictorLimitInfo(req.user.id, req.user)));
// Predictor track record: every past answer is scored against the actual
// price move since it was asked. Only Bullish/Bearish calls are scored
// (Neutral/Mixed make no directional call). A call scores once the move is
// decisive (more than 1% either way) or once its timeframe has elapsed —
// then any move in the called direction counts. Until then it is pending.
const PREDICTOR_HORIZON_DAYS = { 'This week': 5, 'Next 1–4 weeks': 28, 'Next 1–5 trading days': 5 };
function scorePrediction(p, currentPrice) {
  if (!p.price_at_ask || !currentPrice) return 'pending';
  const movePct = ((currentPrice - p.price_at_ask) / p.price_at_ask) * 100;
  const horizonDays = PREDICTOR_HORIZON_DAYS[p.timeframe] || 5;
  const ageDays = (Date.now() - p.created_at) / (24 * 60 * 60 * 1000);
  if (Math.abs(movePct) <= 1 && ageDays < horizonDays) return 'pending';
  if (movePct === 0) return 'pending';
  const up = movePct > 0;
  if (p.outlook === 'Bullish') return up ? 'correct' : 'wrong';
  if (p.outlook === 'Bearish') return up ? 'wrong' : 'correct';
  return 'unscored';
}
app.get('/api/predictor/track-record', auth, async (req, res) => {
  const rows = db.prepare('SELECT * FROM predictor_chats WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  const syms = [...new Set(rows.map(r => r.symbol))];
  const cached = cachedQuotes();
  const missing = syms.filter(s => !cached[s]);
  let live = {};
  if (missing.length) { try { live = await fetchLiveQuotes(missing); } catch {} }
  const prices = {};
  for (const s of syms) prices[s] = live[s]?.price ?? cached[s]?.price ?? null;
  let correct = 0, wrong = 0, pending = 0, unscored = 0;
  const items = rows.map(r => {
    const currentPrice = prices[r.symbol];
    const result = (r.outlook === 'Bullish' || r.outlook === 'Bearish') ? scorePrediction(r, currentPrice) : 'unscored';
    if (result === 'correct') correct++;
    else if (result === 'wrong') wrong++;
    else if (result === 'pending') pending++;
    else unscored++;
    const movePct = (r.price_at_ask && currentPrice) ? ((currentPrice - r.price_at_ask) / r.price_at_ask) * 100 : null;
    return { id: r.id, symbol: r.symbol, outlook: r.outlook, confidence: r.confidence, timeframe: r.timeframe, priceAtAsk: r.price_at_ask, currentPrice, movePct, createdAt: r.created_at, result };
  });
  const scored = correct + wrong;
  res.json({ total: rows.length, scored, correct, wrong, pending, unscored, accuracy: scored ? Math.round((correct / scored) * 1000) / 10 : null, items: items.slice(0, 30) });
});
app.delete('/api/predictor', auth, (req, res) => { db.prepare('DELETE FROM predictor_chats WHERE user_id=?').run(req.user.id); res.json({ ok: true }); });

// Feedback (owner-only inbox)
app.post('/api/feedback', auth, (req, res) => {
  const msg = String(req.body?.message || '').trim();
  if (!msg) return res.status(400).json({ error: 'Write some feedback first' });
  if (msg.length > 2000) return res.status(400).json({ error: 'Feedback is too long (max 2000 characters)' });
  db.prepare('INSERT INTO feedback(user_id,name,message,created_at) VALUES(?,?,?,?)').run(req.user.id, req.user.name, msg, Date.now());
  res.json({ ok: true });
});
app.get('/api/feedback', auth, (req, res) => {
  if (!req.user.is_owner) return res.status(403).json({ error: 'Feedback inbox is owner-only' });
  res.json({ feedback: db.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 100').all() });
});
app.delete('/api/feedback/:id', auth, (req, res) => {
  if (!req.user.is_owner) return res.status(403).json({ error: 'Feedback inbox is owner-only' });
  db.prepare('DELETE FROM feedback WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/feedback/clear', auth, (req, res) => {
  if (!req.user.is_owner) return res.status(403).json({ error: 'Feedback inbox is owner-only' });
  db.prepare('DELETE FROM feedback').run();
  res.json({ ok: true });
});

// Settings / pings / auto
// Settings allow-list: only these keys may be written via /api/settings.
// startCash is NOT here — it only changes via /api/settings/start-cash,
// which restarts the game. Anything else in the body is silently dropped.
// L6/L14: 'theme' was in the allow-list but the server never reads it
// (theme is localStorage-only in the frontend), and the saved* caps are
// written by the server itself when Credit Saver toggles — clients must not
// set them directly. Both are dropped; anything else is still silently ignored.
const SETTING_KEYS = new Set([
  'dipPct', 'momentumPct', 'pingsOn', 'buyPings', 'sellPings',
  'stopTargetPings', 'soundOn', 'browserNotify', 'autoSell', 'buyDips',
  'buyMomentum', 'overnightPrices', 'liveRefresh', 'autoOn', 'autoMode',
  'style', 'budgetPerBuy', 'maxPositions', 'maxTradesPerDay', 'checkSeconds',
  'creditSaver', 'emailPings', 'emailTrades',
]);
const VALID_STYLES = ['scalping', 'day', 'swing', 'position'];
const VALID_AUTO_MODES = ['rules', 'ai'];
app.post('/api/settings', auth, (req, res) => {
  const body = req.body || {};
  if (body.style != null && !VALID_STYLES.includes(String(body.style))) return res.status(400).json({ error: 'Unknown auto style — use Scalping, Day, Swing or Position' });
  if (body.autoMode != null && !VALID_AUTO_MODES.includes(String(body.autoMode))) return res.status(400).json({ error: 'Unknown auto mode — use rules or ai' });
  const prev = getSettings(req.user.id);
  const s = { ...prev };
  for (const [k, v] of Object.entries(body)) if (SETTING_KEYS.has(k)) s[k] = v;
  if (body.budgetPerBuy != null) s.budgetPerBuy = Math.min(50000, Math.max(50, +body.budgetPerBuy || 50));
  if (body.maxPositions != null) s.maxPositions = Math.min(12, Math.max(1, +body.maxPositions || 1));
  if (body.maxTradesPerDay != null) s.maxTradesPerDay = Math.min(20, Math.max(1, +body.maxTradesPerDay || 1));
  if (body.dipPct != null) s.dipPct = Math.min(15, Math.max(1, Math.abs(+body.dipPct || 3))) * -1;
  if (body.momentumPct != null) s.momentumPct = Math.min(15, Math.max(1, Math.abs(+body.momentumPct || 4)));
  // Credit Saver enforcement is effective-only (see effectiveSettings): the
  // stored maxTradesPerDay / checkSeconds are the user's own values and are
  // never overwritten by the Saver clamp. Turning Saver ON stashes them;
  // turning it OFF restores them.
  if (!req.user.is_owner) {
    // Non-owners can never turn Credit Saver off, so they have no
    // pre-Saver values to stash — never store saved caps for them.
    s.creditSaver = true;
    s.savedMaxTradesPerDay = null;
    s.savedCheckSeconds = null;
  } else if (body.creditSaver === true && !prev.creditSaver) {
    s.savedMaxTradesPerDay = prev.maxTradesPerDay;
    s.savedCheckSeconds = prev.checkSeconds;
  } else if (body.creditSaver === false && prev.creditSaver) {
    if (prev.savedMaxTradesPerDay != null) s.maxTradesPerDay = prev.savedMaxTradesPerDay;
    if (prev.savedCheckSeconds != null) s.checkSeconds = prev.savedCheckSeconds;
    s.savedMaxTradesPerDay = null; s.savedCheckSeconds = null;
  }
  // If Saver is already on and the owner changes a cap via the API, treat the
  // new value as their chosen (pre-Saver) value so it is what returns on off.
  if (req.user.is_owner && s.creditSaver && body.maxTradesPerDay != null) s.savedMaxTradesPerDay = s.maxTradesPerDay;
  if (req.user.is_owner && s.creditSaver && body.checkSeconds != null) s.savedCheckSeconds = s.checkSeconds;
  saveSettings(req.user.id, s);
  res.json({ ok: true, settings: effectiveSettings(req.user.id, req.user), creditSaverForced: !req.user.is_owner });
});
app.post('/api/auto/run', auth, async (req, res) => {
  const r = await runAutoCycle(req.user.id, { manual: true });
  res.json({ ...r, state: publicState(req.user.id) });
});
app.post('/api/alerts/read', auth, (req, res) => { db.prepare('UPDATE alerts SET read=1 WHERE user_id=?').run(req.user.id); res.json({ ok: true }); });
app.post('/api/alerts/clear', auth, (req, res) => { db.prepare('DELETE FROM alerts WHERE user_id=?').run(req.user.id); res.json({ ok: true, state: publicState(req.user.id) }); });
app.delete('/api/auto-log', auth, (req, res) => { db.prepare('DELETE FROM auto_log WHERE user_id=?').run(req.user.id); res.json({ ok: true, state: publicState(req.user.id) }); });
app.post('/api/email/clear', auth, (req, res) => { db.prepare('UPDATE users SET email=?, email_verified=0, pending_email=? WHERE id=?').run('', '', req.user.id); db.prepare("UPDATE email_queue SET status='cleared' WHERE user_id=? AND status='queued'").run(req.user.id); res.json({ ok: true, state: publicState(req.user.id) }); });
app.post('/api/email/test', auth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user?.email) return res.status(400).json({ error: 'Set your email in the Pings tab first' });
  if (!user.email_verified) {
    // M13: say which state the email is in, and whether email can work at
    // all on this server — the old message implied a code was on its way.
    if (!smtpConfigured()) return res.status(400).json({ error: `Your email ${user.pending_email || user.email} is saved but not verified — and no code can be sent, because email isn't configured on this server (SMTP not set up). Ask the owner to add SMTP credentials, then send a code from the Pings tab.` });
    return res.status(400).json({ error: 'Verify your email first — enter the 6-digit code we emailed it' });
  }
  const r = await sendEmail(user.email, `${APP_NAME} test email`, `This is a test email from ${APP_NAME}. If you got this, ping and auto-trade emails will reach you.`);
  res.json(r);
});

app.listen(PORT, () => console.log(`${APP_NAME} running on http://localhost:${PORT} — Created by Lucas Do`));
