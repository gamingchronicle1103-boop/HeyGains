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
// Discord invite link for the HeyGains community server.
// Set DISCORD_INVITE_URL in the environment (or .env) to a real invite,
// e.g. https://discord.gg/xxxxxx — until then it stays empty and the
// in-app Discord buttons render as "coming soon" and link nowhere.
// Only genuine discord.gg / discord.com/invite URLs are accepted, so a
// typo or a wrong URL can never send players somewhere else.
const _discordRaw = (process.env.DISCORD_INVITE_URL || '').trim();
const DISCORD_INVITE_URL = /^https:\/\/(discord\.gg\/[A-Za-z0-9_-]+|discord\.com\/invite\/[A-Za-z0-9_-]+)\/?$/.test(_discordRaw) ? _discordRaw : '';

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
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
`);
// Migrations for v11-era DBs (old file) (same file name was hey-gains.db; also handle new columns)
try { db.exec(`ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE quote_cache ADD COLUMN spark TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE predictor_chats ADD COLUMN price_at_ask REAL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE predictor_chats ADD COLUMN timeframe TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE predictor_chats ADD COLUMN key_points TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE predictor_chats ADD COLUMN risks TEXT DEFAULT ''`); } catch {}
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
  if (!g) { const sc = getSettings(uid).startCash || START_CASH; db.prepare('INSERT INTO game(user_id,cash,best_run,created_at) VALUES(?,?,?,?)').run(uid, sc, 0, Date.now()); g = db.prepare('SELECT * FROM game WHERE user_id=?').get(uid); }
  return g;
}
function hashPin(pin, salt) { return crypto.createHash('sha256').update(salt + ':' + pin).digest('hex'); }
function newToken() { return crypto.randomBytes(32).toString('hex'); }
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // sessions expire after 30 days
// PIN lockout: per-user failed-login tracking (in-memory). 5 wrong PINs lock
// the account for 15 minutes; a successful login clears the counter.
const PIN_LOCKOUT_MAX = 5, PIN_LOCKOUT_MS = 15 * 60 * 1000;
const pinLockouts = new Map(); // userId -> { count, lockedUntil }
function pinLockoutFor(uid) {
  const e = pinLockouts.get(uid);
  if (!e) return null;
  if (e.lockedUntil && Date.now() >= e.lockedUntil) { pinLockouts.delete(uid); return null; }
  return e;
}
function recordFailedPin(uid) {
  const e = pinLockouts.get(uid) || { count: 0, lockedUntil: 0 };
  e.count += 1;
  if (e.count >= PIN_LOCKOUT_MAX) e.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
  pinLockouts.set(uid, e);
  return e;
}
function clearFailedPins(uid) { pinLockouts.delete(uid); }
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
      const spark = closes.filter(c => c != null).slice(-40);
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
        if (!isNaN(close)) { const prev = db.prepare('SELECT * FROM quote_cache WHERE symbol=?').get(sym); out[sym] = { symbol: sym, price: close, prevClose: prev?.prev_close ?? close, regularClose: prev?.regular_close ?? close, changePct: 0, extChangePct: 0, source: 'live-stooq', asOf: Date.now(), lastTrade: '', spark: prev?.spark ? JSON.parse(prev.spark) : [], name: NAMES[sym] || sym }; return; }
        throw new Error('stooq parse');
      } catch (e2) {
        const prev = db.prepare('SELECT * FROM quote_cache WHERE symbol=?').get(sym);
        if (prev) out[sym] = { symbol: sym, price: prev.price, prevClose: prev.prev_close, regularClose: prev.regular_close, changePct: prev.change_pct, extChangePct: prev.ext_change_pct, source: 'simulated (feed down)', asOf: prev.as_of, lastTrade: prev.last_trade_label || '', spark: prev.spark ? JSON.parse(prev.spark) : [], name: NAMES[sym] || sym };
      }
    }
  }));
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
async function fetchHistory(sym, range) {
  const map = { '1D': ['1d', '1m'], '5D': ['5d', '15m'], '1M': ['1mo', '1d'], '3M': ['3mo', '1d'], '6M': ['6mo', '1wk'], '1Y': ['1y', '1wk'], '5Y': ['5y', '1mo'] };
  const [r, iv] = map[range] || map['1D'];
  const res = await yahooChart(sym, r, iv);
  const ts = res.timestamp || [];
  const q = res.indicators?.quote?.[0] || {};
  // After-hours bars: Yahoo reports volume 0 for ALL extended-hours bars,
  // even liquid tickers like NVDA — so volume can NOT be used to tell a
  // real after-hours bar from a stale one (a previous fix did exactly that
  // and wiped every ticker's after-hours chart). Only drop bars past the
  // post-market end (20:00 ET), and dedupe repeated timestamps (Yahoo
  // repeats the last bar). DUOL's after-hours stays sparse by nature —
  // it barely trades after hours, so its few bars are far apart — but it
  // is no longer singled out.
  const meta = res.meta || {};
  const postEnd = meta.currentTradingPeriod?.post?.end ?? null;
  const pts = [];
  const seenTs = new Set();
  for (let i = ts.length - 1; i >= 0; i--) {
    if (q.close?.[i] == null) continue;
    if (postEnd && ts[i] > postEnd) continue;
    if (seenTs.has(ts[i])) continue;
    seenTs.add(ts[i]);
    pts.push({ t: ts[i] * 1000, o: q.open?.[i] ?? q.close[i], h: q.high?.[i] ?? q.close[i], l: q.low?.[i] ?? q.close[i], c: q.close[i], v: q.volume?.[i] ?? 0 });
  }
  pts.reverse();
  if (range === '1D' && pts.length) {
    // DUOL pre/post barely shows: Yahoo only returns 4 premarket bars and
    // 5 post-market bars for DUOL (vs 330 / 241 for NVDA), so on an
    // index-based chart those 9 bars get ~3% of the width instead of their
    // true ~35% of the day. Fill the 1-minute grid by carrying the last
    // traded price forward (v=0) — no trades means the price didn't move,
    // so the line goes flat there instead of vanishing. This also makes
    // the index-based X axis true to time. NVDA is already full, so it
    // barely changes; DUOL's pre/post now show as real flat stretches.
    // Also fill the start: some tickers have NO premarket trades at all
    // (FANG: 0 premarket bars, TTWO 43, MCD 39) — without this the chart
    // starts at 9:30 and the whole premarket area is blank. Carry the
    // previous close forward from the 4:00 AM premarket open, so the line
    // sits flat at yesterday's close until the first trade of the day.
    const prevCloseFill = res.meta?.chartPreviousClose ?? res.meta?.previousClose ?? null;
    const preStart = meta.currentTradingPeriod?.pre?.start ?? null;
    if (prevCloseFill != null && preStart && pts[0].t > preStart * 1000) {
      const head = [];
      for (let t = preStart * 1000; t < pts[0].t; t += 60000) head.push({ t, o: prevCloseFill, h: prevCloseFill, l: prevCloseFill, c: prevCloseFill, v: 0 });
      pts.unshift(...head);
    }
    const filled = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = filled[filled.length - 1];
      const gapMin = Math.round((pts[i].t - prev.t) / 60000);
      for (let m = 1; m < gapMin; m++) {
        const t = prev.t + m * 60000;
        filled.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0 });
      }
      filled.push(pts[i]);
    }
    pts.length = 0; pts.push(...filled);
    // And the tail: some tickers stop trading early (FANG's last trade
    // was 5:15 PM) — carry the last price flat to the 8:00 PM post-market
    // close so the chart runs the full day instead of ending early.
    const postEndFill = meta.currentTradingPeriod?.post?.end ?? null;
    if (postEndFill && pts.length) {
      const last = pts[pts.length - 1];
      for (let t = last.t + 60000; t <= postEndFill * 1000; t += 60000) pts.push({ t, o: last.c, h: last.c, l: last.c, c: last.c, v: 0 });
    }
  }
  if (range === '5D' && pts.length) {
    // Same carry-forward fill as 1D, but on the 15-minute grid Yahoo
    // returns for 5D: flat prev-close/prev-trade stretches for gaps between
    // bars (thin after-hours, overnight), and a flat tail to the 8:00 PM ET
    // post-market close of the last day, so the chart ends near 8pm ET
    // instead of at the last trade (FANG often stops ~5:15 PM).
    const stepMs = 15 * 60 * 1000;
    const filled = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = filled[filled.length - 1];
      const gap = Math.round((pts[i].t - prev.t) / stepMs);
      for (let m = 1; m < gap; m++) {
        const t = prev.t + m * stepMs;
        filled.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0 });
      }
      filled.push(pts[i]);
    }
    pts.length = 0; pts.push(...filled);
    const last = pts[pts.length - 1];
    const { year, month, day } = etDate(new Date(last.t));
    const endMs = etWallToMs(year, month, day, 20, 0);
    for (let t = last.t + stepMs; t <= endMs; t += stepMs) pts.push({ t, o: last.c, h: last.c, l: last.c, c: last.c, v: 0 });
  }
  const step = Math.max(1, Math.ceil(pts.length / 220));
  const candles = [];
  for (let i = 0; i < pts.length; i += step) { const chunk = pts.slice(i, i + step); candles.push({ t: chunk[0].t, o: chunk[0].o, h: Math.max(...chunk.map(p => p.h)), l: Math.min(...chunk.map(p => p.l)), c: chunk[chunk.length - 1].c, v: chunk.reduce((a, p) => a + (p.v || 0), 0) }); }
  return { symbol: sym, range, points: pts, candles, prevClose: res.meta?.chartPreviousClose ?? res.meta?.previousClose ?? null, source: 'live' };
}
async function fetchNews(symbols) {
  const out = [];
  try {
    const q = encodeURIComponent(symbols.slice(0, 3).join(' OR ') + ' stock');
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
      const q = encodeURIComponent(sym + ' stock');
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
  db.prepare('INSERT INTO email_queue(user_id,subject,body,created_at) VALUES(?,?,?,?)').run(uid, subject, body, Date.now());
  return true;
}
// Email verification: 6-digit code, 10 min expiry, 5 tries, resend rate-limited.
function makeCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
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
    return { ok: true, pnl: 0, shorted: true };
  }
  return { ok: true };
}
// Limit / stop orders: evaluated against live quotes on every quote
// refresh (GET /api/quotes) and every server cycle. Fill price is the
// TARGET price, not the live price — the order fills the moment the live
// price touches the target.
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
    const r = applyTrade(uid, o.symbol, o.side, o.shares, o.target_price, 'order-' + o.type);
    if (r.error) continue; // stays open, retries next cycle
    db.prepare("UPDATE orders SET status='filled', filled_at=?, fill_price=? WHERE id=?").run(Date.now(), o.target_price, o.id);
    anyFilled = true;
    const label = (o.type === 'limit' ? 'Limit' : 'Stop') + ' ' + o.side;
    logAuto(uid, 'ORDER', `${label} filled: ${o.shares} ${o.symbol} @ $${o.target_price}${r.pnl ? ` · realised P&L $${r.pnl.toFixed(2)}` : ''}${r.shorted ? ' · short opened' : ''}${r.covered ? ' · short covered' : ''}`, { symbol: o.symbol, shares: o.shares, price: o.target_price });
    if (getSettings(uid).emailTrades) queueEmail(uid, `${APP_NAME} ${label} order filled: ${o.symbol}`, `${label} order filled: ${o.shares} ${o.symbol} @ $${o.target_price}.`);
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
      if (chg <= style.stop) addAlert(uid, p.symbol, 'SELL·STOP', `${p.symbol} hit your ${style.label} stop ${style.stop}% (${chg.toFixed(2)}% vs your cost) — $${q.price}`, q.price);
      if (chg >= style.target) addAlert(uid, p.symbol, 'SELL·TARGET', `${p.symbol} hit your ${style.label} target +${style.target}% (${chg.toFixed(2)}% vs your cost) — $${q.price}`, q.price);
      if (chg <= -5) addAlert(uid, p.symbol, 'SELL·STOP', `${p.symbol} down 5% vs your cost ($${p.avg_cost.toFixed(2)} → $${q.price}) — $${q.price}`, q.price);
      if (chg >= 10) addAlert(uid, p.symbol, 'SELL·TARGET', `${p.symbol} up 10% vs your cost ($${p.avg_cost.toFixed(2)} → $${q.price}) — $${q.price}`, q.price);
    }
  }
}
async function researchPass(sym, quotes) {
  let trend = '';
  try {
    const h = await fetchHistory(sym, '1M');
    const closes = h.points.map(p => p.c);
    if (closes.length >= 20) { const c5 = closes.slice(-5), c20 = closes.slice(-20); const avg = a => a.reduce((x, y) => x + y, 0) / a.length; const chg5 = ((closes[closes.length - 1] - c5[0]) / c5[0]) * 100; const chg20 = ((closes[closes.length - 1] - c20[0]) / c20[0]) * 100; trend = `Change over the last 5 days ${chg5 >= 0 ? '+' : ''}${chg5.toFixed(1)}% (5-day avg $${avg(c5).toFixed(2)}), change over the last 20 days ${chg20 >= 0 ? '+' : ''}${chg20.toFixed(1)}% (20-day avg $${avg(c20).toFixed(2)}), last $${closes[closes.length - 1].toFixed(2)}.`; }
  } catch { trend = 'Trend history unavailable.'; }
  const news = await fetchNews([sym]);
  return { trend, headlines: news.slice(0, 3).map(n => n.title) };
}
async function runAutoCycle(uid, { manual = false, quotes: presetQuotes = null } = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  if (!user) return { ran: false };
  const s = effectiveSettings(uid, user);
  const saver = !!s.creditSaver;
  if (saver && !isMarketHours() && !manual) { logAuto(uid, 'CHECK', 'Credit Saver — market closed (' + marketSession() + '). Waiting for market hours (9:30 AM–4:00 PM ET); no AI runs while it is closed'); return { ran: true, action: 'waiting-market-hours' }; }
  const rawQuotes = presetQuotes || await fetchLiveQuotes(boardSymbols(uid).all);
  const quotes = effectiveQuotesFor(uid, rawQuotes);
  evaluatePings(uid, quotes);
  if (!s.autoOn && !manual) return { ran: true, action: 'auto-off' };
  const style = STYLES[s.style] || STYLES.day;
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
      return { ran: true, action: 'sold' };
    }
  }
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
    logAuto(uid, 'RESEARCH', `${sig.sym}: ${res.trend} Headlines: ${res.headlines.join(' | ') || 'none found'}${s.autoMode === 'rules' ? ' (rules mode — strongest research score)' : ''}`, { symbol: sig.sym });
    researched.push({ ...sig, research: res });
  }
  const best = researched[0];
  let decision = 'buy', reason = `${best.kind} signal ${best.chg.toFixed(1)}% (strongest research score)`;
  if (s.autoMode === 'ai') {
    const q = quotes[best.sym];
    const prompt = `Paper-trading decision. Ticker ${best.sym} (${NAMES[best.sym]}), live price $${q.price}, day change ${q.changePct.toFixed(2)}%, signal ${best.kind} ${best.chg.toFixed(1)}%, style ${style.label} (${style.stop}% stop / +${style.target}% target). Trend: ${best.research.trend} Headlines: ${best.research.headlines.join('; ') || 'none'}. Answer ONLY with BUY or PASS and one short reason.`;
    const ai = await aiDecide(prompt);
    if (ai) { decision = /^\s*BUY/i.test(ai) ? 'buy' : 'pass'; reason = 'AI: ' + ai.slice(0, 200); }
    else reason = 'AI unavailable (no AI_API_KEY configured) — rules fallback: ' + reason;
  }
  if (decision === 'pass') { logAuto(uid, 'PASS', `${best.sym} passed — ${reason}`, { symbol: best.sym }); return { ran: true, action: 'pass' }; }
  const q = quotes[best.sym];
  const shares = Math.max(0.01, Math.floor((s.budgetPerBuy / q.price) * 100) / 100);
  const r = applyTrade(uid, best.sym, 'buy', shares, q.price, 'auto-' + s.style);
  if (r.error) { logAuto(uid, 'CHECK', `Checked — no trade (${r.error})`); return { ran: true, action: 'error' }; }
  logAuto(uid, 'BUY', `Bought ${shares} ${best.sym} @ $${q.price} — ${reason}`, { symbol: best.sym, shares, price: q.price });
  if (s.emailTrades) queueEmail(uid, `${APP_NAME} auto-buy: ${best.sym}`, `Bought ${shares} ${best.sym} @ $${q.price}. ${reason}`);
  return { ran: true, action: 'bought', symbol: best.sym };
}
async function serverCycle() {
  try {
    const users = db.prepare('SELECT id FROM users').all();
    if (!users.length) return;
    const quotes = await fetchLiveQuotes(); // shared live quotes for the whole cycle
    for (const u of users) {
      const s = effectiveSettings(u.id, db.prepare('SELECT * FROM users WHERE id=?').get(u.id));
      if (s.autoOn) await runAutoCycle(u.id, { quotes });
      else evaluatePings(u.id, effectiveQuotesFor(u.id, quotes));
      evaluateOrders(u.id, effectiveQuotesFor(u.id, quotes)); // limit/stop orders fill on touch
      snapshotNetWorth(u.id); // portfolio-over-time history, ~every 2 min
    }
    await flushEmailQueue().catch(() => {});
  } catch (e) { console.error('server cycle error', e.message); }
}
setInterval(serverCycle, 2 * 60 * 1000);

// ---------- Express ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
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
function publicState(uid) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const game = getGame(uid);
  const s = effectiveSettings(uid, user);
  const raw = cachedQuotes();
  const quotes = effectiveQuotesFor(uid, raw);
  const positions = positionsOf(uid).map(p => {
    const q = quotes[p.symbol]; const price = q?.price ?? p.avg_cost;
    const isShort = p.shares < 0;
    // changePct is the gain vs cost — flipped for shorts, so +5% always
    // means "you're up 5%", long or short. (Net worth and todayChange
    // already handle negative shares: price * shares is a liability.)
    return { ...p, price, isShort, changePct: isShort ? ((p.avg_cost - price) / p.avg_cost) * 100 : ((price - p.avg_cost) / p.avg_cost) * 100 };
  });
  const netWorth = game.cash + positions.reduce((a, p) => a + p.price * p.shares, 0);
  const allTime = netWorth - (s.startCash || START_CASH);
  const allTimePct = (s.startCash || START_CASH) ? (allTime / (s.startCash || START_CASH)) * 100 : 0;
  const openTodayChange = positions.reduce((a, p) => a + ((quotes[p.symbol]?.prevClose != null ? (p.price - quotes[p.symbol].prevClose) : 0) * p.shares), 0);
  // Realised P&L from trades sold today (ET calendar day), on top of the
  // open positions' move vs prev close — selling a winner still counts.
  const etToday = etDate();
  let realisedToday = 0;
  for (const tr of db.prepare("SELECT pnl, created_at FROM trades WHERE user_id=? AND side='sell'").all(uid)) {
    const d = etDate(new Date(tr.created_at));
    if (d.year === etToday.year && d.month === etToday.month && d.day === etToday.day) realisedToday += tr.pnl || 0;
  }
  const todayChange = openTodayChange + realisedToday;
  const todayPct = (netWorth - todayChange) ? (todayChange / (netWorth - todayChange)) * 100 : 0;
  let bestWorth = game.best_worth || 0;
  if (netWorth > bestWorth) { bestWorth = netWorth; db.prepare('UPDATE game SET best_worth=? WHERE user_id=?').run(bestWorth, uid); }
  const emailQueued = db.prepare("SELECT COUNT(*) c FROM email_queue WHERE user_id=? AND status='queued'").get(uid).c;
  return {
    user: { id: user.id, name: user.name, email: user.email || '', pendingEmail: user.pending_email || '', emailVerified: !!user.email_verified, isOwner: !!user.is_owner },
    cash: game.cash, bestRun: game.best_run, bestWorth, netWorth, allTime, allTimePct, todayChange, todayPct, emailQueued,
    positions, customSymbols: boardSymbols(uid).custom, coreTickers: TICKERS,
    trades: db.prepare('SELECT * FROM trades WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(uid),
    orders: listOrders(uid),
    alerts: db.prepare('SELECT * FROM alerts WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(uid),
    autoLog: db.prepare('SELECT * FROM auto_log WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(uid),
    predictorChats: db.prepare('SELECT * FROM predictor_chats WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(uid),
    settings: s, creditSaverForced: !user.is_owner, creditSaverEffective: !!s.creditSaver, session: marketSession(), discordInviteUrl: DISCORD_INVITE_URL,
    feedback: user.is_owner ? db.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 100').all() : undefined,
    players: db.prepare('SELECT id, name, is_owner, CASE WHEN pin_hash IS NULL OR pin_hash = \'\' THEN 0 ELSE 1 END AS has_pin FROM users ORDER BY created_at').all(),
  };
}
function snapshotNetWorth(uid) {
  // At most one snapshot per user per 90 s — the server cycle runs every
  // 2 min, and trades also snapshot, so this keeps the history ~2-min
  // spaced without spamming a row on every trade.
  const last = db.prepare('SELECT created_at FROM net_worth_snapshots WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(uid);
  if (last && Date.now() - last.created_at < 90 * 1000) return;
  const nw = publicState(uid).netWorth;
  db.prepare('INSERT INTO net_worth_snapshots(user_id,net_worth,created_at) VALUES(?,?,?)').run(uid, nw, Date.now());
}
// Leaderboard rows: public numbers only — name, owner flag, net worth,
// cash, today + all-time change. Never PINs, tokens, emails or salts.
function leaderboardRows() {
  const users = db.prepare('SELECT id, name, is_owner FROM users ORDER BY created_at').all();
  const rows = users.map(u => {
    const s = publicState(u.id);
    return { name: u.name, isOwner: !!u.is_owner, netWorth: s.netWorth, cash: s.cash, todayChange: s.todayChange, todayPct: s.todayPct, allTime: s.allTime, allTimePct: s.allTimePct };
  });
  // Ranked by % return (allTimePct), NOT by dollars: a player who turned
  // $1,000 into $1,050 (+5%) beats one who turned $100,000 into $100,500
  // (+0.5%), even though the second made more dollars. Ties break by net
  // worth, then by name.
  rows.sort((a, b) => (b.allTimePct - a.allTimePct) || (b.netWorth - a.netWorth) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}
function rankFor(allTimePct, netWorth) {
  if (allTimePct >= 25 || netWorth >= 200000) return 'Whale';
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
  const sells = trades.filter(t => t.side === 'sell');
  // Single-trade gain % for a sell: pnl / cost basis (proceeds - pnl).
  const gainPct = t => { const basis = (t.total || 0) - (t.pnl || 0); return basis > 0 ? (t.pnl / basis) * 100 : 0; };
  const firstBigWin = sells.find(t => gainPct(t) >= 10);
  // Stop honoured: sold at a loss no worse than ~-6% vs cost (the -5%
  // stop, plus a point of fill slippage) instead of riding it further down.
  const stopSave = sells.find(t => { const g = gainPct(t); return g < 0 && g >= -6; });
  const distinctDays = new Set(trades.map(t => { const d = etDate(new Date(t.created_at)); return `${d.year}-${d.month}-${d.day}`; })).size;
  const firstAuto = trades.find(t => (t.source || '').startsWith('auto'));
  const bestWorth = s.bestWorth || s.netWorth;
  const badges = [
    { id: 'first-trade', name: 'First Trade', desc: 'Made your first trade', earned: trades.length >= 1, earnedAt: trades[0]?.created_at || null },
    { id: 'big-win', name: '+10% Winner', desc: 'Banked +10% or more on a single sell', earned: !!firstBigWin, earnedAt: firstBigWin?.created_at || null },
    { id: 'stop-honoured', name: 'Stop Honoured', desc: 'Sold at a loss within your stop instead of riding it down', earned: !!stopSave, earnedAt: stopSave?.created_at || null },
    { id: 'streak-5', name: '5-Day Trader', desc: 'Traded on 5 different days', earned: distinctDays >= 5, earnedAt: null },
    { id: 'worth-150k', name: '$150K Club', desc: 'Net worth reached $150,000', earned: bestWorth >= 150000, earnedAt: null },
    { id: 'worth-200k', name: '$200K Club', desc: 'Net worth reached $200,000', earned: bestWorth >= 200000, earnedAt: null },
    { id: 'ten-trades', name: '10 Trades', desc: 'Made 10 trades in total', earned: trades.length >= 10, earnedAt: trades[9]?.created_at || null },
    { id: 'first-auto', name: 'First Auto-Trade', desc: 'The auto trader made a trade for you', earned: !!firstAuto, earnedAt: firstAuto?.created_at || null },
  ];
  return {
    rank: rankFor(s.allTimePct, s.netWorth),
    allTimePct: s.allTimePct, netWorth: s.netWorth, bestWorth,
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
  snapshotNetWorth(uid); // seed the new history at the starting amount
}

app.get('/api/health', (req, res) => res.json({ ok: true, app: APP_NAME, session: marketSession(), users: db.prepare('SELECT COUNT(*) c FROM users').get().c }));
// Public config — no auth needed (the welcome screen is shown before
// sign-in). Only exposes the Discord invite URL (empty until configured)
// plus two booleans the UI uses for its banners/badges.
app.get('/api/config', (req, res) => res.json({ discordInviteUrl: DISCORD_INVITE_URL, smtpConfigured: smtpConfigured(), aiConfigured: aiConfigured() }));
app.get('/api/session', (req, res) => res.json({ players: db.prepare("SELECT id, name, is_owner, CASE WHEN pin_hash IS NULL OR pin_hash = '' THEN 0 ELSE 1 END AS has_pin FROM users ORDER BY created_at").all() }));

app.post('/api/auth/register', async (req, res) => {
  const { name, pin, email } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Enter your name' });
  if (pin && String(pin).length < 4) return res.status(400).json({ error: 'PIN must be at least 4 characters' });
  if (db.prepare('SELECT 1 FROM users WHERE name=?').get(name.trim())) return res.status(400).json({ error: 'That name is taken' });
  // Owner is ONLY an exact name match with OWNER_NAME (default Lucas,
  // case-insensitive). The first registrant is never owner just for being
  // first — a non-Lucas first account stays a regular player.
  const isOwner = name.trim().toLowerCase() === OWNER_NAME ? 1 : 0;
  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = pin ? hashPin(String(pin), salt) : null; // no PIN yet — claim it later with SET PIN & CLAIM IT
  const id = db.prepare('INSERT INTO users(name,pin_hash,salt,email,is_owner,created_at) VALUES(?,?,?,?,?,?)').run(name.trim(), pinHash, salt, '', isOwner, Date.now()).lastInsertRowid;
  getGame(id); getSettings(id);
  // PIN-less accounts are claim-only: no session token, no auto sign-in.
  // The player must tap their name on the sign-in page and choose SET PIN & CLAIM IT.
  if (!pinHash) return res.json({ token: null, needsClaim: true, user: { id, name: name.trim(), isOwner: !!isOwner, emailVerified: false }, needsVerification: false, codeSent: false, codeError: null, smtpConfigured: smtpConfigured() });
  const token = newToken();
  db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(token, id, Date.now());
  let codeInfo = null;
  if ((email || '').trim()) { codeInfo = await sendVerificationCode(id, email); if (!codeInfo.ok) codeInfo = { ok: false, error: codeInfo.error, smtpConfigured: codeInfo.smtpConfigured }; }
  res.json({ token, user: { id, name: name.trim(), isOwner: !!isOwner, emailVerified: false }, needsVerification: !!(email || '').trim(), codeSent: !!codeInfo?.ok, codeError: codeInfo?.ok ? null : (codeInfo?.error || null), smtpConfigured: smtpConfigured() });
});
app.post('/api/auth/claim', (req, res) => {
  const { name, pin } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE name=?').get((name || '').trim());
  if (!user) return res.status(404).json({ error: 'No player with that name' });
  if (user.pin_hash) return res.status(400).json({ error: 'That player already has a PIN — sign in instead' });
  if (!pin || String(pin).length < 4) return res.status(400).json({ error: 'PIN must be at least 4 characters' });
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET pin_hash=?, salt=? WHERE id=?').run(hashPin(String(pin), salt), salt, user.id);
  const token = newToken();
  db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(token, user.id, Date.now());
  res.json({ token, user: { id: user.id, name: user.name, isOwner: !!user.is_owner, emailVerified: false } });
});
app.post('/api/auth/login', (req, res) => {
  const { name, pin } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE name=?').get((name || '').trim());
  if (!user) return res.status(401).json({ error: 'Wrong name or PIN' });
  if (!user.pin_hash) return res.status(401).json({ error: 'That player has no PIN yet — tap it and choose SET PIN & CLAIM IT' });
  const lock = pinLockoutFor(user.id);
  if (lock?.lockedUntil) {
    const mins = Math.ceil((lock.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many wrong PINs — this account is locked for ${mins} more minute${mins === 1 ? '' : 's'}` });
  }
  if (hashPin(String(pin || ''), user.salt) !== user.pin_hash) {
    const e = recordFailedPin(user.id);
    if (e.lockedUntil) return res.status(429).json({ error: 'Too many wrong PINs — this account is locked for 15 minutes' });
    return res.status(401).json({ error: 'Wrong name or PIN' });
  }
  clearFailedPins(user.id);
  const token = newToken();
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
app.post('/api/email/send-code', auth, async (req, res) => {
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
    evaluateOrders(req.user.id, eff); // open limit/stop orders fill on touch
    res.json({ quotes: eff, session: marketSession(), updatedAt: Date.now() });
  }
  catch { res.json({ quotes: effectiveQuotesFor(req.user.id, cachedQuotes()), session: marketSession(), updatedAt: Date.now(), note: 'live feed failed, showing last cached prices' }); }
});
app.get('/api/history', auth, async (req, res) => {
  const { symbol, range } = req.query;
  if (!boardSymbols(req.user.id).all.includes(symbol)) return res.status(400).json({ error: 'Unknown ticker — add it as your own pick first' });
  const VALID_RANGES = ['1D', '5D', '1M', '3M', '6M', '1Y', '5Y'];
  const r = range || '1D';
  if (!VALID_RANGES.includes(r)) return res.status(400).json({ error: 'Unknown range — use 1D, 5D, 1M, 3M, 6M, 1Y or 5Y' });
  try { res.json(await fetchHistory(symbol, r)); } catch (e) { res.status(502).json({ error: 'History feed failed: ' + e.message }); }
});
app.get('/api/news', async (req, res) => {
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
app.post('/api/trade', auth, async (req, res) => {
  const { symbol, side, shares } = req.body || {};
  if (!boardSymbols(req.user.id).all.includes(symbol) || !['buy', 'sell'].includes(side) || !(shares > 0)) return res.status(400).json({ error: 'Bad trade' });
  const quotes = effectiveQuotesFor(req.user.id, await fetchLiveQuotes(boardSymbols(req.user.id).all));
  const price = quotes[symbol]?.price;
  if (!price) return res.status(502).json({ error: 'Live price unavailable right now' });
  const r = applyTrade(req.user.id, symbol, side, +shares, price, 'manual');
  if (r.error) return res.status(400).json({ error: r.error });
  snapshotNetWorth(req.user.id); // throttled to 90 s, so cheap
  res.json({ ok: true, price, shorted: !!r.shorted, covered: !!r.covered, pnl: r.pnl || 0, session: marketSession(), state: publicState(req.user.id) });
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
  res.json({ ok: true, id, filledNow, orders: listOrders(req.user.id), state: publicState(req.user.id) });
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
  const amount = +req.body?.amount;
  if (!Number.isFinite(amount) || amount < 100 || amount > 10000000) return res.status(400).json({ error: 'Starting cash must be $100–$10,000,000' });
  const s = getSettings(req.user.id); s.startCash = amount; saveSettings(req.user.id, s);
  wipeGame(req.user.id, amount); // restarts fresh; board, settings, email and theme survive
  res.json({ ok: true, startCash: amount, state: publicState(req.user.id) });
});
app.post('/api/account/delete', auth, (req, res) => {
  const { pin } = req.body || {};
  if (req.user.is_owner) return res.status(403).json({ error: 'The owner account cannot be deleted — it runs the feedback inbox and player list for everyone else.' });
  if (!req.user || hashPin(String(pin || ''), req.user.salt) !== req.user.pin_hash) return res.status(401).json({ error: 'Wrong PIN — account not deleted.' });
  const uid = req.user.id;
  for (const t of ['positions', 'trades', 'predictor_chats', 'alerts', 'auto_log', 'email_queue', 'settings', 'custom_symbols', 'email_verifications', 'net_worth_snapshots', 'orders', 'chat_messages', 'game', 'sessions']) db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(uid);
  db.prepare('DELETE FROM feedback WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM users WHERE id=?').run(uid);
  res.json({ ok: true });
});

// Predictor
app.post('/api/predictor', auth, async (req, res) => {
  const { symbol, question } = req.body || {};
  if (!boardSymbols(req.user.id).all.includes(symbol) || !question) return res.status(400).json({ error: 'Pick a ticker and ask a question' });
  const quotes = effectiveQuotesFor(req.user.id, await fetchLiveQuotes(boardSymbols(req.user.id).all));
  const q = quotes[symbol];
  const res2 = await researchPass(symbol, quotes);
  const chg = q ? q.changePct : 0;
  let outlook = 'Neutral', confidence = 50;
  if (chg <= -3) { outlook = 'Bearish'; confidence = 60; } else if (chg >= 3) { outlook = 'Bullish'; confidence = 60; }
  else if (chg >= 1) { outlook = 'Bullish'; confidence = 45; } else if (chg <= -1) { outlook = 'Bearish'; confidence = 45; }
  const ai = await aiDecide(`You are a paper-trading analyst. Ticker ${symbol}, live price $${q?.price}, day change ${chg.toFixed(2)}%. Trend: ${res2.trend} Headlines: ${res2.headlines.join('; ') || 'none'}. Question: ${question}. Give outlook (Bullish/Bearish/Neutral/Mixed), confidence 0-100, 3 key points, 2 risks, timeframe. Keep it short.`);
  const timeframe = /week/i.test(question) ? 'This week' : /swing/i.test(question) ? 'Next 1–4 weeks' : 'Next 1–5 trading days';
  const keyPoints = [
    `Live price $${q?.price} (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% today, prev close $${q?.prevClose}) — momentum is ${chg >= 0 ? 'positive' : 'negative'} today.`,
    `Trend: ${res2.trend}`,
    res2.headlines.length ? `Fresh headlines: ${res2.headlines.join(' | ')}` : 'No fresh headlines found for this ticker.',
  ];
  const risks = ['After-hours moves can reverse at the open', 'Single-day moves are noisy — watch the -5% stop / +10% target lines'];
  let answer = ai || `${symbol} — ${outlook} (${confidence}% confidence).\n${keyPoints.join('\n')}\nRisks: ${risks.join('; ')}.\nTimeframe: ${timeframe}.\n(AI research unavailable — no AI_API_KEY configured; answer is rules-based from live price, trend and news.)`;
  db.prepare('INSERT INTO predictor_chats(user_id,symbol,question,answer,outlook,confidence,price_at_ask,timeframe,key_points,risks,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(req.user.id, symbol, question, answer, outlook, confidence, q?.price || 0, timeframe, JSON.stringify(keyPoints), JSON.stringify(risks), Date.now());
  res.json({ outlook, confidence, answer, timeframe, keyPoints, risks, priceAtAsk: q?.price || 0, state: publicState(req.user.id) });
});
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
const SETTING_KEYS = new Set([
  'theme', 'dipPct', 'momentumPct', 'pingsOn', 'buyPings', 'sellPings',
  'stopTargetPings', 'soundOn', 'browserNotify', 'autoSell', 'buyDips',
  'buyMomentum', 'overnightPrices', 'liveRefresh', 'autoOn', 'autoMode',
  'style', 'budgetPerBuy', 'maxPositions', 'maxTradesPerDay', 'checkSeconds',
  'creditSaver', 'emailPings', 'emailTrades',
  'savedMaxTradesPerDay', 'savedCheckSeconds',
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
  if (!user.email_verified) return res.status(400).json({ error: 'Verify your email first — enter the 6-digit code we emailed it' });
  const r = await sendEmail(user.email, `${APP_NAME} test email`, `This is a test email from ${APP_NAME}. If you got this, ping and auto-trade emails will reach you.`);
  res.json(r);
});

app.listen(PORT, () => console.log(`${APP_NAME} running on http://localhost:${PORT} — Created by Lucas Do`));
