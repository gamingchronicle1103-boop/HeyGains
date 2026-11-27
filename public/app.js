// HeyGains frontend — vanilla JS, no build step.
const CORE = ['NVDA', 'TSLA', 'AMD', 'META', 'AMZN', 'GOOGL', 'MSFT', 'INTC', 'TTWO', 'DUOL', 'FANG', 'MCD'];
const NAME_MAP = { NVDA: 'NVIDIA', TSLA: 'Tesla', AMD: 'Adv. Micro Devices', META: 'Meta Platforms', AMZN: 'Amazon', GOOGL: 'Alphabet', MSFT: 'Microsoft', INTC: 'Intel', TTWO: 'Take-Two Interactive', DUOL: 'Duolingo', FANG: 'Diamondback Energy', MCD: "McDonald's" };
const THEMES = { terminal: '#2bff88', purple: '#b388ff', ice: '#38bdf8', gold: '#ffb02e', pink: '#ff5da2' };
const CHECK_STEPS = [30, 60, 120, 300];
const STYLES = { scalping: { label: 'Scalping', stop: -2, target: 3, hold: 'Minutes–hours' }, day: { label: 'Day Trading', stop: -5, target: 10, hold: 'Same day–2 days' }, swing: { label: 'Swing', stop: -8, target: 20, hold: 'Days–weeks' }, position: { label: 'Position', stop: -12, target: 30, hold: 'Weeks–months' } };
// Migrate legacy localStorage keys to the verityinvest-* keys.
for (const [oldK, newK] of [['hg_token', 'verityinvest-token'], ['hg_theme', 'verityinvest-theme'], ['hg_welcome_seen', 'verityinvest-welcomed']]) {
  const v = localStorage.getItem(oldK); if (v && !localStorage.getItem(newK)) localStorage.setItem(newK, v);
}
let token = localStorage.getItem('verityinvest-token') || '';
let state = null, quotes = {}, chartData = null, chartMode = 'line', chartRange = '1D', chartSymbol = 'NVDA', showMA20 = false;
let tradeSide = 'buy', orderSide = 'buy', lastChartLoad = 0, lastNewsLoad = 0, refreshTimer = null, newsTimer = null;
let notifiedIds = new Set(), prevPrices = {}, bannerAlertId = null, authMode = 'signin', claimName = '';
let wlSearch = '', wlSort = 'default', tradeInFlight = false, predMode = 'ai';
let leagueData = null, leagueCountdownTimer = null;
// Predictor daily limit (AI mode only): standard members get 2 Verity AI
// questions per ET day; rules-only questions are unlimited and never
// counted; the owner is unlimited in both modes. updatePredLimit() keeps
// the "X / 2 AI questions left today" line and the ASK button in sync —
// when the AI limit is hit the AI path is blocked, but switching to
// Rules only re-enables ASK (the whole button is never disabled).
function updatePredLimit() {
  const el = $('pred-limit'); if (!el || !state) return;
  const btn = $('btn-ask');
  const setModeButtons = () => {
    const ai = $('pred-mode-ai'), ru = $('pred-mode-rules');
    if (ai) ai.classList.toggle('primary', predMode === 'ai');
    if (ru) ru.classList.toggle('primary', predMode === 'rules');
  };
  setModeButtons();
  const blocked = $('pred-blocked');
  if (state.user.isOwner) {
    el.textContent = 'Unlimited AI questions — owner. Rules-only questions are unlimited for everyone.';
    if (btn) btn.disabled = false;
    if (blocked) blocked.classList.add('hidden');
    return;
  }
  const left = state.predictorRemaining ?? 2;
  if (predMode === 'rules') el.textContent = 'Rules-only questions are unlimited.';
  else el.textContent = `${left} / 2 AI questions left today · Rules-only questions are unlimited.`;
  if (btn) btn.disabled = predMode === 'ai' && left <= 0;
  if (blocked) blocked.classList.toggle('hidden', !(predMode === 'ai' && left <= 0));
}
// Device-only sign-in: the server lists EVERY player, but this device only
// shows the accounts that were created or signed in on THIS browser.
// Names are kept in localStorage (verityinvest-device-accounts) — a
// different device/browser sees its own list, not yours. Tapping
// "Show all players" reveals the full server list once, for signing in
// on a new device or claiming an account made elsewhere.
const DEVICE_ACCOUNTS_KEY = 'verityinvest-device-accounts';
let showAllPlayers = false;
function getDeviceAccounts() {
  try { const v = JSON.parse(localStorage.getItem(DEVICE_ACCOUNTS_KEY) || '[]'); return Array.isArray(v) ? v.filter(n => typeof n === 'string' && n.trim()) : []; }
  catch { return []; }
}
function saveDeviceAccount(name) {
  const n = String(name || '').trim(); if (!n) return;
  const list = getDeviceAccounts();
  if (!list.some(x => x.toLowerCase() === n.toLowerCase())) { list.push(n); localStorage.setItem(DEVICE_ACCOUNTS_KEY, JSON.stringify(list.slice(-12))); }
}
function removeDeviceAccount(name) {
  const n = String(name || '').trim().toLowerCase();
  localStorage.setItem(DEVICE_ACCOUNTS_KEY, JSON.stringify(getDeviceAccounts().filter(x => x.toLowerCase() !== n)));
  loadPlayers();
}
let leaderboardData = null, portfolioHistory = null, achievementsData = null, predictorTrackRecord = null, lastExtrasLoad = 0;
let chatMessages = [], chatFilter = 'ALL', chatTimer = null;
// Server capability flags from /api/config (null = not loaded yet):
// smtpConfigured false => show the email-not-configured banner;
// aiConfigured false => show the "Rules-only mode — no AI key" badge.
let serverConfig = { smtpConfigured: null, aiConfigured: null };
let lastThemeRendered = null, lastSymbolKey = null;
// Write into a text input only when the player is NOT typing in it —
// the 10-second refresh used to overwrite emails / starting cash mid-type.
function setInputValue(id, value) {
  const el = $(id); if (!el) return;
  if (document.activeElement === el) return;
  if (el.value !== String(value ?? '')) el.value = value ?? '';
}
function fmtCashShort(v) {
  v = Number(v || 0);
  if (v >= 1000000) return '$' + (v / 1000000).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'M';
  if (v >= 1000) return '$' + (v / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'K';
  return money(v);
}
// Escape ALL user/server-controlled text before innerHTML injection.
// Use for names, messages, predictor text, news, symbols, emails, etc.
// App-generated HTML (chips/buttons) is built from literal templates, not from this.
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function safeUrl(u) { try { const p = new URL(String(u || ''), location.origin); return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : '#'; } catch { return '#'; } }
const $ = id => document.getElementById(id);
const money = n => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const pct = (n, s = false) => (n >= 0 ? '+' : '') + Number(n || 0).toFixed(2) + '%';
// ---------- Number-change flash ----------
// Generic helper: every money/price number that moves flashes green when
// it goes up and red when it goes down. flashNum(el, newValue, text)
// sets the element's text, compares against the last value shown for
// that element, and re-triggers the .flash-up/.flash-down animation.
// flashEl(el, key, newValue) does the same compare+flash without touching
// the text (for elements whose content is HTML). First paint (no previous
// value) never flashes.
const _prevNum = new Map();
function flashEl(el, key, newVal) {
  if (!el) return;
  const prev = _prevNum.get(key);
  _prevNum.set(key, newVal);
  if (prev == null || prev === newVal) return;
  el.classList.remove('flash-up', 'flash-down', 'flash-pop');
  void el.offsetWidth; // restart the animation
  el.classList.add(newVal > prev ? 'flash-up' : 'flash-down');
  if (el.classList.contains('flash-inline')) el.classList.add('flash-pop');
}
function flashNum(el, newVal, text) {
  if (!el) return;
  el.textContent = text;
  flashEl(el, el.id || el, newVal);
}
// Same, for spans rebuilt by innerHTML (positions, leaderboard rows):
// compare a numeric value against a stored map and flash the span.
function flashSpan(el, key, newVal, store) {
  if (!el) return;
  const prev = store.get(key);
  store.set(key, newVal);
  if (prev == null || prev === newVal) return;
  el.classList.remove('flash-up', 'flash-down', 'flash-pop');
  void el.offsetWidth;
  el.classList.add(newVal > prev ? 'flash-up' : 'flash-down');
  el.classList.add('flash-pop');
}
const _prevPos = new Map(), _prevLb = new Map();
const fmtTime = ts => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const fmtDT = ts => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function accent() { return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2bff88'; }
function applyTheme(name) {
  if (!THEMES[name]) name = 'terminal';
  document.documentElement.setAttribute('data-theme', name === 'terminal' ? '' : name);
  if (name === 'terminal') document.documentElement.removeAttribute('data-theme');
  localStorage.setItem('verityinvest-theme', name);
  renderThemePickers(); drawChart(); drawPortfolioChart();
}
function renderThemePickers() {
  const cur = localStorage.getItem('verityinvest-theme') || 'terminal';
  // Skip the rebuild when nothing changed — loadState runs every 10 s and
  // rebuilding the pickers that often is wasteful (and can drop focus).
  if (lastThemeRendered === cur && document.querySelectorAll('.theme-swatch').length) return;
  lastThemeRendered = cur;
  const labels = { terminal: 'Terminal', purple: 'Purple', ice: 'Ice Blue', gold: 'Gold', pink: 'Pink' };
  for (const id of ['theme-picker', 'set-theme-picker']) {
    const el = $(id); if (!el) continue; el.innerHTML = '';
    for (const [name, color] of Object.entries(THEMES)) {
      const d = document.createElement('button'); d.className = 'theme-swatch' + (name === cur ? ' active' : ''); d.title = name; d.setAttribute('aria-label', name + ' theme');
      d.innerHTML = `<span class="theme-dot" style="background:${color}"></span>${labels[name] || name}`;
      d.onclick = () => applyTheme(name); el.appendChild(d);
    }
  }
}
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: token ? 'Bearer ' + token : '', ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
function banner(msg) { const b = $('banner'); b.textContent = msg; b.classList.remove('hidden'); setTimeout(() => b.classList.add('hidden'), 6000); }
function beep880() {
  try {
    const ctx = window._ac || (window._ac = new (window.AudioContext || window.webkitAudioContext)());
    [0, 0.22].forEach(delay => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.16);
      o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + 0.18);
    });
  } catch {}
}
function playWinSound() {
  // Short celebratory arpeggio, WebAudio only, no external files.
  try {
    const ctx = window._ac || (window._ac = new (window.AudioContext || window.webkitAudioContext)());
    if (ctx.state === 'suspended') ctx.resume();
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const t0 = ctx.currentTime + i * 0.09;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; o.type = 'triangle';
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.24);
    });
  } catch {}
}
function confettiBurst() {
  try {
    const layer = document.createElement('div'); layer.className = 'confetti-layer'; layer.setAttribute('aria-hidden', 'true');
    const colors = ['#2bff88', '#ffb02e', '#b388ff', '#38bdf8', '#ff5da2', '#e8f0e9'];
    for (let i = 0; i < 36; i++) {
      const p = document.createElement('i');
      p.style.left = (8 + Math.random() * 84) + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.25) + 's';
      p.style.animationDuration = (1.4 + Math.random() * 1.1) + 's';
      p.style.transform = 'rotate(' + Math.floor(Math.random() * 360) + 'deg)';
      layer.appendChild(p);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3000);
  } catch {}
}
function flashTradeCardLoss() {
  try {
    const card = $('btn-trade-submit')?.closest('.card');
    if (!card) return;
    card.classList.remove('flash-loss'); void card.offsetWidth; card.classList.add('flash-loss');
    setTimeout(() => card.classList.remove('flash-loss'), 1400);
  } catch {}
}
function notifyPing(a) {
  if (state?.settings?.soundOn !== false) beep880();
  if (state?.settings?.browserNotify && Notification.permission === 'granted') { try { new Notification('HeyGains ping — ' + a.symbol, { body: a.message }); } catch {} }
}
function allSymbols() { return [...CORE, ...(state?.customSymbols || []).map(c => c.symbol)]; }
function symName(sym) { return (state?.customSymbols || []).find(c => c.symbol === sym)?.name || NAME_MAP[sym] || quotes[sym]?.name || sym; }
function sessionBadgeClass(s) {
  if (s === 'Open') return 'session-open';
  if (/^Closed/.test(s) || s === 'Weekend') return 'session-closed';
  return 'session-ah';
}
function sessionDisplay(s) {
  if (s === 'Open') return 'Market Open';
  if (s === 'Weekend') return 'Closed — Weekend';
  return s;
}
function sparkSvg(spark, up) {
  if (!spark || spark.length < 2) return '';
  const min = Math.min(...spark), max = Math.max(...spark), range = (max - min) || 1;
  const pts = spark.map((v, i) => `${(i / (spark.length - 1)) * 64},${18 - ((v - min) / range) * 16}`).join(' ');
  const color = up ? '#2bff88' : '#ff4757';
  return `<svg class="spark" width="64" height="20" viewBox="0 0 64 20"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

// ---------- State ----------
async function loadState() {
  state = await api('/api/state');
  applyDiscordLinks(state.discordInviteUrl || '');
  applyDonateLinks(state.donateUrl || '');
  $('user-line').textContent = 'Playing as ' + state.user.name + (state.user.isOwner ? ' · OWNER' : '');
  // League tier badge on the scoreboard (from /api/state — no extra call).
  const lb = $('league-badge');
  if (lb && state.league) {
    lb.textContent = '◆ ' + state.league.tierName.toUpperCase() + ' LEAGUE';
    lb.style.color = state.league.tierColor; lb.style.borderColor = state.league.tierColor + '66';
    lb.classList.remove('hidden');
  }
  flashNum($('net-worth-big'), state.netWorth, money(state.netWorth));
  $('net-worth-sub').innerHTML = `All-time <b class="${state.allTime >= 0 ? 'up' : 'down'}">${state.allTime >= 0 ? '+' : ''}${money(state.allTime)} (${pct(state.allTimePct)})</b> · Best worth <b>${money(state.bestWorth || state.netWorth)}</b>`;
  flashEl($('net-worth-sub'), 'net-worth-sub', state.netWorth);
  // Close balance vs live balance: after the bell the live figure keeps
  // moving on extended-hours prices; the close figure is frozen at the
  // regular-session close. When overnight prices are off the two match.
  const cd = state.netWorth - (state.closeNetWorth ?? state.netWorth);
  $('net-worth-close').innerHTML = `Balance at close <b>${money(state.closeNetWorth ?? state.netWorth)}</b> · Live <b>${money(state.netWorth)}</b> <span class="${cd >= 0 ? 'up' : 'down'}">(${cd >= 0 ? '+' : ''}${money(cd)} vs close)</span>`;
  flashEl($('net-worth-close'), 'net-worth-close', state.netWorth);
  flashNum($('score-cash'), state.cash, money(state.cash));
  $('score-cash-sub').textContent = 'Available to trade';
  // Set the up/down class BEFORE flashing, so the flash class survives.
  $('score-today').className = 'score-val ' + (state.todayChange >= 0 ? 'up' : 'down');
  flashNum($('score-today'), state.todayChange, (state.todayChange >= 0 ? '+' : '') + money(state.todayChange));
  flashNum($('score-today-sub'), state.todayPct, pct(state.todayPct) + ' today on holdings');
  $('score-session').textContent = sessionDisplay(state.session);
  $('score-session-sub').textContent = state.session === 'Open' ? 'Regular session · ' + (state.sessionHours || '9:30 AM–4:00 PM ET') : 'Trading stays open — fills at the live extended price';
  const sb = $('session-badge'); sb.textContent = sessionDisplay(state.session); sb.className = 'badge ' + sessionBadgeClass(state.session);
  $('market-label').textContent = state.marketLabel || (state.session === 'Open' ? 'NYSE · Regular session' : 'NYSE · ' + state.session);
  $('ext-explainer').textContent = state.settings.overnightPrices === false && state.session !== 'Open'
    ? 'Overnight prices are OFF: your game is frozen at the regular close outside market hours — board, positions, fills, pings and the auto trader all use the close.'
    : 'Extended prices: the price shown is the live extended price from the latest 1-minute bar — after hours it moves against the regular close. When overnight prices are off, your game freezes at the regular close outside market hours instead.';
  renderTradeSessionBanner();
  const fg = $('footer-game');
  if (fg) fg.textContent = `${money(state.settings.startCash || 100000)} paper cash to start (your amount — change it in Settings), but the prices are now real live quotes for your 12 watchlist tickers — plus any stocks and crypto you add yourself — refreshed every 10 seconds. Paper trading never closes — buy and sell premarket, after hours, whenever, at the last live price. Your guardrails still run the show: positions flag at −5% / +10%, the Pings tab watches those lines for you, the Predictor tab is Verity AI reading the live tape, and the Auto tab hands the whole sim to Verity AI — it buys the signals and sells your lines while you watch. No real money moves, ever.`;
  $('footer-best-run').textContent = state.bestRun > 0 ? 'BEST BANKED RUN: ' + money(state.bestRun) : '';
  renderPositions(); renderTrades(); renderOrders(); renderAlerts(); renderAutoLog(); renderPredHistory(); renderCustomList(); renderSidebarProfile(); renderSettings(); renderFeedbackInbox(); renderDeleteRow(); fillSymbolSelects(); updateSteppers(); updateAutoUI(); updatePingUI(); updateNotifyState(); applyServerConfigBadges(); updatePredLimit();
  const unread = state.alerts.filter(a => !a.read).length;
  $('ping-count').textContent = unread; $('ping-count').classList.toggle('hidden', !unread);
  loadExtras(false); // leaderboard / portfolio history / achievements, throttled to 60 s
  loadChallenges(false); // daily challenges + streak, throttled to 60 s
  $('side-ping-badge').textContent = unread; $('side-ping-badge').classList.toggle('hidden', !unread);
  $('auto-dot').classList.toggle('hidden', !state.settings.autoOn);
  const lt = $('btn-live-toggle'); const live = state.settings.liveRefresh !== false;
  lt.textContent = live ? '● LIVE · 10s' : '❚❚ PAUSED'; lt.className = 'badge ' + (live ? 'live' : 'paused');
  const styleLbl = (STYLES[state.settings.style] || STYLES.day).label;
  $('side-auto-hint').textContent = state.settings.autoOn ? `On · ${styleLbl} style` : 'Off — turn it on in the AUTO tab';
  const ph = $('side-ping-hint'); if (ph) ph.textContent = unread > 0 ? `${unread} new ping${unread === 1 ? '' : 's'} waiting` : 'Your alerts, rules & email setup';
  const ownCount = (state.customSymbols || []).length;
  $('side-own-count').textContent = ownCount ? `${ownCount} added — add more from the watchlist` : 'Add your own from the watchlist';
}
// Trade session banner (Trade tab): what session we're in and what price
// a fill uses. Overnight-off fills freeze at the 4 PM close.
function renderTradeSessionBanner() {
  const el = $('trade-session-banner'); if (!el || !state) return;
  const q = quotes[chartSymbol];
  const sess = sessionDisplay(state.session);
  if (state.session === 'Open') { el.textContent = 'Market is open — trading at the live price.'; return; }
  if (state.settings.overnightPrices === false) {
    el.textContent = `${sess} — overnight prices are OFF in your settings, so you fill at the frozen 4 PM close${q?.regularClose ? ` (${money(q.regularClose)})` : ''}. Turn them back on in Settings if you want live extended prices.`;
    return;
  }
  el.textContent = q
    ? `${sess} — after-hours paper trading is ON. You fill at the LIVE extended price (${money(q.price)}) — never the close. The 4 PM close was ${money(q.regularClose || q.prevClose)} (${pct(q.extChangePct || 0)} since then) — that's only there so you can see the after-hours move.`
    : `${sess} — after-hours paper trading is ON. You fill at the LIVE extended price — never the close.`;
}
function fillSymbolSelects() {
  // Skip the rebuild when the symbol list hasn't changed — loadState runs
  // every 10 s and rebuilding both selects that often can drop an open
  // dropdown. The key covers the symbols and the current chart symbol.
  const key = allSymbols().join(',') + '|' + chartSymbol;
  if (key === lastSymbolKey) { renderPredChips(); return; }
  lastSymbolKey = key;
  const cur = $('trade-symbol').value || chartSymbol;
  $('trade-symbol').innerHTML = '';
  for (const t of allSymbols()) { const o = document.createElement('option'); o.value = t; o.textContent = t + (CORE.includes(t) ? '' : ' ★'); $('trade-symbol').appendChild(o); }
  if (allSymbols().includes(cur)) $('trade-symbol').value = cur;
  const os = $('order-symbol');
  if (os) {
    const curO = os.value || chartSymbol;
    os.innerHTML = '';
    for (const t of allSymbols()) { const o = document.createElement('option'); o.value = t; o.textContent = t + (CORE.includes(t) ? '' : ' ★'); os.appendChild(o); }
    if (allSymbols().includes(curO)) os.value = curO;
  }
  renderPredChips();
}
function renderPredChips() {
  const el = $('pred-chips'); if (!el) return; el.innerHTML = '';
  for (const t of allSymbols()) {
    const b = document.createElement('button'); b.textContent = t; b.className = t === chartSymbol ? 'active' : '';
    b.onclick = () => { chartSymbol = t; $('trade-symbol').value = t; updatePredCurrent(); renderPredChips(); loadChart(); };
    el.appendChild(b);
  }
  updatePredCurrent();
}
function updatePredCurrent() {
  const q = quotes[chartSymbol];
  const held = (state?.positions || []).find(p => p.symbol === chartSymbol);
  $('btn-ask').textContent = 'ASK ABOUT ' + chartSymbol;
  $('link-ask-predictor').textContent = 'Ask the Predictor about ' + chartSymbol + ' →';
  if (!q) { $('pred-current').textContent = chartSymbol + ' — ' + symName(chartSymbol) + ' · price loading…'; return; }
  $('pred-current').textContent = `${chartSymbol} — ${symName(chartSymbol)} · ${money(q.price)} (${pct(q.changePct)} today, ${pct(q.extChangePct)} extended)${held ? (held.shares < 0 ? ` · You SHORT ${Math.abs(held.shares)} @ ${money(held.avg_cost)}` : ` · You hold ${held.shares} @ ${money(held.avg_cost)}`) : ' · You hold none'}`;
}
async function loadQuotes() {
  if (state && state.settings?.liveRefresh === false) return;
  try {
    const j = await api('/api/quotes'); quotes = j.quotes;
    $('quotes-updated').textContent = 'Quotes updated ' + new Date(j.updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) + (j.stale ? ' · STALE — live feed down, showing last cached prices' : '');
    const sb = $('session-badge'); sb.textContent = sessionDisplay(j.session); sb.className = 'badge ' + sessionBadgeClass(j.session);
    renderWatchlist(); renderTickerTape(); updatePredCurrent(); updateTradeEstimates();
    if (chartRange === '1D' || Date.now() - lastChartLoad > 60000) await loadChart();
  } catch (e) { $('quotes-updated').textContent = 'FEED DOWN — showing last cached prices'; }
}
function renderTickerTape() {
  const track = $('ticker-track'); if (!track) return;
  // Core tickers first, then the player's own picks (state.customSymbols).
  const items = allSymbols().map(sym => {
    const q = quotes[sym];
    const price = q ? money(q.price) : '—';
    const chg = q ? pct(q.changePct) : '';
    const cls = q ? (q.changePct >= 0 ? 'up' : 'down') : '';
    return `<span class="tape-item"><b>${escapeHtml(sym)}</b> ${escapeHtml(price)} <span class="${cls}">${escapeHtml(chg)}</span></span>`;
  }).join('<span class="tape-sep">·</span>');
  // Two copies for a seamless loop; content is symbols + numbers only.
  track.innerHTML = items + '<span class="tape-sep">·</span>' + items;
}
async function loadExtras(force) {
  if (!force && Date.now() - lastExtrasLoad < 60000) return;
  lastExtrasLoad = Date.now();
  try {
    const [lb, ph, ach, tr, lg] = await Promise.all([api('/api/leaderboard'), api('/api/portfolio-history'), api('/api/achievements'), api('/api/predictor/track-record'), api('/api/leagues')]);
    leaderboardData = lb; portfolioHistory = ph; achievementsData = ach; predictorTrackRecord = tr; leagueData = lg;
    renderLeaderboard(); renderWelcomeLeaderboard(); renderAchievements(); drawPortfolioChart(); renderPredictorTrackRecord(); renderLeagues();
  } catch { /* extras are non-critical — the game still works without them */ }
}
// ---------- Daily challenges + streaks ----------
// Throttled like loadExtras — the 10 s refresh must not re-fetch these.
let challengesData = null, lastChallengesLoad = 0;
async function loadChallenges(force) {
  if (!force && Date.now() - lastChallengesLoad < 60000) return;
  lastChallengesLoad = Date.now();
  try { challengesData = await api('/api/challenges'); renderChallenges(); } catch { /* non-critical */ }
}
function renderChallenges() {
  const el = $('challenges-list'); if (!el || !challengesData) return;
  const d = challengesData;
  const flame = $('challenges-streak'); if (flame) flame.textContent = `🔥 ${d.streak}-DAY STREAK · ${d.xp} XP`;
  const badge = $('streak-badge');
  if (badge) { badge.textContent = d.streak > 0 ? `🔥 ${d.streak}-DAY STREAK` : '🔥 START A STREAK — TRADE OR FINISH A CHALLENGE TODAY'; badge.classList.remove('hidden'); }
  el.innerHTML = d.challenges.map(c => {
    const stateTxt = c.claimed ? '<span class="tag green">✓ CLAIMED +' + c.xp + ' XP</span>'
      : c.done ? `<button class="btn small primary" data-claim="${escapeHtml(c.key)}">CLAIM +${c.xp} XP</button>`
      : `<span class="muted small">${c.progress}/${c.goal}</span>`;
    return `<div class="challenge-row"><span class="challenge-check">${c.done || c.claimed ? '✓' : '○'}</span><span><strong>${escapeHtml(c.title)}</strong><br><span class="muted small">${escapeHtml(c.desc)}</span></span><span class="spacer"></span>${stateTxt}</div>`;
  }).join('');
  el.querySelectorAll('[data-claim]').forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = 'CLAIMING…';
    try { const j = await api('/api/challenges/claim', { method: 'POST', body: JSON.stringify({ key: b.dataset.claim }) }); challengesData = j; lastChallengesLoad = Date.now(); renderChallenges(); }
    catch (e) { b.disabled = false; b.textContent = 'CLAIM +10 XP'; alert('Could not claim: ' + (e.message || 'try again')); }
  });
}
// Ticker views feed the "Check 3 different tickers" challenge. Report a
// view at most once per ticker per ET day — the server dedupes too, but
// the 10 s chart refresh must not spam it.
let viewedTodayDate = '', viewedTodaySyms = new Set();
function trackTickerView(sym) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (today !== viewedTodayDate) { viewedTodayDate = today; viewedTodaySyms = new Set(); }
  if (viewedTodaySyms.has(sym)) return;
  viewedTodaySyms.add(sym);
  api('/api/activity/view', { method: 'POST', body: JSON.stringify({ symbol: sym }) }).catch(() => {});
}

// ---------- Trade review / Coach (rules) ----------
async function loadCoach() {
  const el = $('coach-list'); if (!el) return;
  const btn = $('btn-coach-refresh');
  if (btn && !btn.dataset.bound) { btn.dataset.bound = '1'; btn.onclick = () => loadCoach(); }
  el.innerHTML = '<p class="muted">Reading your trades…</p>';
  try {
    const j = await api('/api/coach');
    if (j.empty) { el.innerHTML = '<p class="muted">No trades yet — make your first trade to get coaching.</p>'; return; }
    el.innerHTML = j.observations.map(o => `<div class="coach-obs">${escapeHtml(o)}</div>`).join('') +
      `<p class="muted small">Based on ${j.stats.closed} closed trade${j.stats.closed === 1 ? '' : 's'} · win rate ${j.stats.winRate}% · avg win ${money(j.stats.avgWin)} · avg loss ${money(j.stats.avgLoss)}${j.stats.avgHoldHrs != null ? ` · avg hold ${j.stats.avgHoldHrs < 24 ? j.stats.avgHoldHrs + 'h' : (j.stats.avgHoldHrs / 24).toFixed(1) + ' days'}` : ''} · stops honoured ${j.stats.stopHonoured}/${j.stats.stopTotal}. Rules only — no AI involved.</p>`;
  } catch { el.innerHTML = '<p class="muted">Could not load coaching — try again.</p>'; }
}

// ---------- Shareable trade cards ----------
// The opening trade for a closed trade: latest earlier trade of the same
// symbol with the opposite side (a buy for a long sell, a short-open sell
// for a cover). state.trades is newest-first, limit 50.
function closedTradePair(t) {
  const idx = (state.trades || []).findIndex(x => x.id === t.id);
  const earlier = (state.trades || []).slice(idx + 1);
  if (t.side === 'sell' && !String(t.source || '').endsWith('-short')) return earlier.find(x => x.symbol === t.symbol && x.side === 'buy' && !String(x.source || '').endsWith('-cover'));
  if (t.side === 'buy' && String(t.source || '').endsWith('-cover')) return earlier.find(x => x.symbol === t.symbol && x.side === 'sell' && String(x.source || '').endsWith('-short'));
  return null;
}
function tradeCardData(t) {
  const open = closedTradePair(t);
  const entry = open ? open.price : null;
  const exit = t.price;
  const won = t.pnl > 0;
  const pnlPct = entry ? ((t.side === 'sell' ? (exit - entry) : (entry - exit)) / entry) * 100 : null;
  return { entry, exit, won, pnlPct, verb: t.side === 'sell' ? (String(t.source || '').endsWith('-short') ? 'SHORTED' : 'SOLD') : 'COVERED' };
}
function drawTradeCard(t) {
  const d = tradeCardData(t);
  const cv = document.createElement('canvas'); cv.width = 900; cv.height = 1125;
  const x = cv.getContext('2d');
  const accent = d.won ? '#2bff88' : '#ff4757';
  x.fillStyle = '#06090a'; x.fillRect(0, 0, 900, 1125);
  x.fillStyle = accent; x.fillRect(0, 0, 900, 14);
  x.fillStyle = '#2bff88'; x.font = '700 34px "JetBrains Mono", monospace'; x.fillText('HEYGAINS', 56, 90);
  x.fillStyle = '#7d8f83'; x.font = '400 24px "JetBrains Mono", monospace'; x.fillText('PAPER TRADING', 56, 126);
  x.fillStyle = '#e8f0ea'; x.font = '400 110px "Archivo Black", sans-serif'; x.fillText(t.symbol, 56, 260);
  x.fillStyle = accent; x.font = '700 40px "JetBrains Mono", monospace'; x.fillText(d.verb + '  ' + t.shares + ' SHARES', 56, 330);
  x.fillStyle = '#7d8f83'; x.font = '400 30px "JetBrains Mono", monospace';
  x.fillText('ENTRY', 56, 430); x.fillText('EXIT', 480, 430);
  x.fillStyle = '#e8f0ea'; x.font = '700 52px "JetBrains Mono", monospace';
  x.fillText(d.entry != null ? money(d.entry) : '—', 56, 500);
  x.fillText(money(d.exit), 480, 500);
  x.fillStyle = '#7d8f83'; x.font = '400 30px "JetBrains Mono", monospace'; x.fillText('P&L', 56, 600);
  x.fillStyle = accent; x.font = '700 96px "JetBrains Mono", monospace';
  x.fillText((d.won ? '+' : '') + money(t.pnl), 56, 700);
  x.font = '700 52px "JetBrains Mono", monospace';
  x.fillText(d.pnlPct != null ? ((d.pnlPct >= 0 ? '+' : '') + d.pnlPct.toFixed(1) + '%') : '', 56, 780);
  x.fillStyle = '#7d8f83'; x.font = '400 28px "JetBrains Mono", monospace';
  x.fillText(new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + (state?.user?.name || ''), 56, 880);
  x.fillText('Real prices. Fake money. Zero risk.', 56, 930);
  x.fillStyle = '#2bff88'; x.font = '700 30px "JetBrains Mono", monospace'; x.fillText('HEYGAINS', 56, 1050);
  x.fillStyle = '#7d8f83'; x.font = '400 24px "JetBrains Mono", monospace'; x.fillText('Paper trading only — no real money, no real orders.', 56, 1088);
  return cv;
}
function shareTradeCard(t) {
  const cv = drawTradeCard(t);
  cv.toBlob(b => {
    if (!b) { alert('Could not render the card — try again.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `heygains-${t.symbol}-${t.id}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}
function copyTradeText(t) {
  const d = tradeCardData(t);
  const pctTxt = d.pnlPct != null ? ` (${d.pnlPct >= 0 ? '+' : ''}${d.pnlPct.toFixed(1)}%)` : '';
  const verb = d.won ? 'made' : 'lost';
  const invite = state?.discordInviteUrl ? ` Join: ${state.discordInviteUrl}` : '';
  const txt = `I just ${verb} ${money(t.pnl)}${pctTxt} on ${t.symbol} with HeyGains! 📈 Paper trading — real prices, fake money.${invite}`;
  const done = () => alert('Copied — paste it in Discord!');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done));
  else fallbackCopy(txt, done);
}
function fallbackCopy(txt, done) {
  const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch { alert('Copy failed — select and copy manually:\n' + txt); }
  document.body.removeChild(ta);
}

// ---------- Donations ----------
// Donate button — the URL lives on the server (DONATE_URL env), never
// hard-coded here. While it is empty the buttons read "coming soon" and
// link nowhere; once Lucas sets his Ko-fi link they open it in a new tab.
function applyDonateLinks(url) {
  for (const id of ['donate-welcome', 'donate-sidebar']) {
    const el = $(id); if (!el) continue;
    if (url) { el.href = url; el.target = '_blank'; el.rel = 'noopener'; el.removeAttribute('aria-disabled'); el.textContent = id === 'donate-welcome' ? 'DONATE ↗' : 'DONATE ↗'; }
    else { el.removeAttribute('href'); el.removeAttribute('target'); el.setAttribute('aria-disabled', 'true'); el.textContent = 'DONATE — COMING SOON'; }
  }
}

// Leaderboard rows: ranked by % return — the all-time % is the big
// number, net worth $ is secondary info, today % last.
function leaderboardRowsHtml(players, you, limit) {
  const rows = (players || []).slice(0, limit || players.length);
  if (!rows.length) return '<p class="muted">No players yet.</p>';
  return rows.map(p => `<div class="lb-row"><span class="lb-rank">#${p.rank}</span><span class="lb-name"><strong>${escapeHtml(p.name)}</strong>${p.isOwner ? ' <span class="tag green">OWNER</span>' : ''}${p.name === you ? ' <span class="tag">YOU</span>' : ''}${p.leagueTierName ? ` <span class="tag league-tag" style="color:${escapeHtml(p.leagueTierColor || '#c0c0c0')};border-color:${escapeHtml(p.leagueTierColor || '#c0c0c0')}55">◆ ${escapeHtml(p.leagueTierName)}</span>` : ''}</span><span class="lb-pct-main flash-inline ${p.allTimePct >= 0 ? 'up' : 'down'}" data-lb="${escapeHtml(p.name)}:pct">${pct(p.allTimePct)}</span><span class="lb-worth flash-inline" data-lb="${escapeHtml(p.name)}:worth">${money(p.netWorth)}</span><span class="lb-pct lb-today flash-inline ${p.todayPct >= 0 ? 'up' : 'down'}" data-lb="${escapeHtml(p.name)}:today">${money(p.todayChange)} today (${pct(p.todayPct)})</span></div>`).join('');
}
// Flash leaderboard numbers when they move between refreshes.
function flashLeaderboard(el) {
  if (!el || !leaderboardData) return;
  el.querySelectorAll('[data-lb]').forEach(s => {
    const idx = s.dataset.lb.lastIndexOf(':');
    const name = s.dataset.lb.slice(0, idx), kind = s.dataset.lb.slice(idx + 1);
    const p = (leaderboardData.players || []).find(x => x.name === name); if (!p) return;
    const v = kind === 'worth' ? p.netWorth : kind === 'today' ? p.todayPct : p.allTimePct;
    flashSpan(s, name + ':' + kind, v, _prevLb);
  });
}
// ---------- Stock chat ----------
async function loadChat() {
  try {
    const q = chatFilter === 'ALL' ? '?limit=100' : '?symbol=' + encodeURIComponent(chatFilter) + '&limit=100';
    const j = await api('/api/chat' + q);
    chatMessages = j.messages || [];
    renderChat();
  } catch { /* chat is non-critical — the game still works without it */ }
}
function renderChatFilters() {
  const el = $('chat-filters'); if (!el) return; el.innerHTML = '';
  const mk = (label, val) => {
    const b = document.createElement('button'); b.textContent = label; b.className = val === chatFilter ? 'active' : '';
    b.onclick = () => { chatFilter = val; renderChatFilters(); loadChat(); };
    el.appendChild(b);
  };
  mk('All', 'ALL');
  for (const s of allSymbols()) mk(s, s);
}
function fmtChatTime(ts) { const d = new Date(ts), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : fmtDT(ts); }
function renderChat() {
  const el = $('chat-list'); if (!el) return;
  const pa = $('chat-posting-as');
  if (pa && state?.user) pa.innerHTML = `Posting as <strong>${escapeHtml(state.user.name)}</strong>${chatFilter !== 'ALL' ? ` · tagged <strong>${escapeHtml(chatFilter)}</strong>` : ''} · max 500 characters · one message every few seconds · newest first, refreshes every 15s.`;
  if (!chatMessages.length) { el.innerHTML = `<p class="muted">${chatFilter !== 'ALL' ? `Nothing on the ${escapeHtml(chatFilter)} board yet — say the first word.` : 'No messages yet — say the first word.'}</p>`; return; }
  // Names, symbols and messages are escaped — a stored <script> tag or
  // onerror payload renders as harmless text, never as HTML. Own messages
  // get an accent border; the symbol chip opens that ticker.
  el.innerHTML = chatMessages.map(m => `<div class="chat-msg${m.user_id === state?.user?.id ? ' own' : ''}"><strong>${escapeHtml(m.name)}</strong>${m.symbol ? ` <button class="chip" data-chat-sym="${escapeHtml(m.symbol)}">${escapeHtml(m.symbol)}</button>` : ''} <span class="muted small">${fmtChatTime(m.created_at)}</span><br>${escapeHtml(m.message)}</div>`).join('');
  el.querySelectorAll('[data-chat-sym]').forEach(b => b.onclick = () => { chartSymbol = b.dataset.chatSym; $('trade-symbol').value = chartSymbol; gotoTab('trade'); loadChart(); renderWatchlist(); });
}
async function postChat() {
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) { $('chat-msg').textContent = 'Write a message first.'; return; }
  try {
    // Posting while filtered to a ticker tags the message with that ticker.
    await api('/api/chat', { method: 'POST', body: JSON.stringify({ message: text, symbol: chatFilter === 'ALL' ? null : chatFilter }) });
    input.value = ''; $('chat-msg').textContent = '';
    await loadChat();
  } catch (e) { $('chat-msg').textContent = 'Post failed: ' + e.message; }
}
function renderLeaderboard() {
  const el = $('leaderboard-list'); if (!el || !leaderboardData) return;
  el.innerHTML = leaderboardRowsHtml(leaderboardData.players, leaderboardData.you);
  flashLeaderboard(el);
}
function renderWelcomeLeaderboard() {
  const el = $('welcome-leaderboard'); if (!el || !leaderboardData) return;
  el.innerHTML = leaderboardRowsHtml(leaderboardData.players, leaderboardData.you, 5);
  flashLeaderboard(el);
}
// ---------- Weekly LEAGUES ----------
// Standings, zones and countdown. The tier badge on the scoreboard comes
// from /api/state (loadState); this tab is the full league view.
async function loadLeagues() {
  try { leagueData = await api('/api/leagues'); renderLeagues(); }
  catch { const el = $('leagues-list'); if (el) el.innerHTML = '<p class="muted">Could not load leagues — try again in a moment.</p>'; }
}
function leagueCountdownText() {
  if (!leagueData?.weekEndsAt) return '';
  let ms = leagueData.weekEndsAt - Date.now();
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return d > 0 ? `${d}d ${h}h ${String(m).padStart(2, '0')}m ${String(ss).padStart(2, '0')}s` : `${h}h ${String(m).padStart(2, '0')}m ${String(ss).padStart(2, '0')}s`;
}
function updateLeagueCountdown() {
  const el = $('league-countdown'); if (!el || !leagueData) return;
  el.textContent = 'Week ends in ' + leagueCountdownText();
}
function renderLeagues() {
  const head = $('leagues-head'), list = $('leagues-list'), banner = $('leagues-banner'), foot = $('leagues-foot');
  if (!head || !leagueData) return;
  const lg = leagueData;
  const tierStyle = `color:${escapeHtml(lg.tierColor)}`;
  head.innerHTML = `<p><span class="league-tier-name" style="${tierStyle}">◆ ${escapeHtml(lg.tierName).toUpperCase()} LEAGUE</span> <span class="muted small">· ${lg.leagueSize} player${lg.leagueSize === 1 ? '' : 's'} in your league · <span id="league-countdown">Week ends in ${escapeHtml(leagueCountdownText())}</span></span></p>${lg.you ? `<p>You're <b>#${lg.you.rank}</b> · <b class="${lg.you.weeklyPct >= 0 ? 'up' : 'down'}">${pct(lg.you.weeklyPct)} this week</b> · net worth ${money(lg.you.netWorth)}</p>` : ''}<p class="muted small">Ranked by this week's % return. <span class="up">Top ${lg.promoteCount} promote ▲</span> · <span class="down">Bottom ${lg.demoteCount} demote ▼</span> · the middle stays.</p>`;
  if (banner) {
    if (lg.lastResult) {
      const cls = lg.lastResultKind === 'promoted' ? 'up' : lg.lastResultKind === 'demoted' ? 'down' : '';
      banner.innerHTML = `<p class="banner ${lg.lastResultKind === 'promoted' ? '' : 'warn'}"><strong class="${cls}">${escapeHtml(lg.lastResult)}</strong> <span class="muted small">Last week's result — this week is a fresh start.</span></p>`;
    } else banner.innerHTML = '';
  }
  if (!lg.standings?.length) { list.innerHTML = '<p class="muted">No standings yet.</p>'; }
  else {
    list.innerHTML = lg.standings.map(p => {
      const zoneTag = p.zone === 'promote' ? '<span class="tag green">▲ PROMOTES</span>' : p.zone === 'demote' ? '<span class="tag red">▼ DEMOTES</span>' : '';
      return `<div class="league-row${p.isYou ? ' you' : ''}"><span class="lb-rank">#${p.rank}</span><span class="lb-name"><strong>${escapeHtml(p.name)}</strong>${p.isOwner ? ' <span class="tag green">OWNER</span>' : ''}${p.isYou ? ' <span class="tag">YOU</span>' : ''} ${zoneTag}</span><span class="lb-pct-main ${p.weeklyPct >= 0 ? 'up' : 'down'}">${pct(p.weeklyPct)}</span><span class="lb-worth">${money(p.netWorth)}</span><span class="lb-pct lb-today">${p.zone === 'promote' ? '▲ top ' + lg.promoteCount : p.zone === 'demote' ? '▼ bottom ' + lg.demoteCount : 'stays'}</span></div>`;
    }).join('');
  }
  if (foot) foot.textContent = `Week of ${lg.weekKey} (Mon–Sun, ET) · Tiers: ${lg.tiers.map(t => t.name).join(' → ')}`;
  if (!leagueCountdownTimer) leagueCountdownTimer = setInterval(updateLeagueCountdown, 1000);
}
function renderAchievements() {
  const rankEl = $('achievements-rank'), listEl = $('achievements-list');
  if (!rankEl || !achievementsData) return;
  const a = achievementsData;
  rankEl.innerHTML = `<p>Your rank: <span class="rank-badge">${escapeHtml(a.rank)}</span> <span class="muted small">${pct(a.allTimePct)} all-time · best ${pct(a.bestReturnPct)} · ${a.earnedCount}/${a.totalCount} badges · ${a.tradeCount} trades · ${a.distinctDays} trading days</span></p><p class="muted small">Ranks are % only: Whale ≥ +25% · Diamond Hands ≥ +10% · Trader ≥ +5% · Rookie ≥ 0% · Paper Hands below 0%.</p>`;
  if (listEl) listEl.innerHTML = a.badges.map(b => `<span class="badge-chip ${b.earned ? 'earned' : 'locked'}" title="${escapeHtml(b.desc)}${b.earnedAt ? ' · ' + fmtDT(b.earnedAt) : ''}">${b.earned ? '★ ' : '☆ '}${escapeHtml(b.name)}</span>`).join('');
}
// Portfolio-over-time line chart — same drawing style as drawChart
// (DPR canvas, grid lines, accent line + gradient fill, dashed start-cash
// line), but its own canvas/element so the main trade chart is untouched.
function drawPortfolioChart() {
  const cv = $('portfolio-chart'); if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 760, h = 220;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = w, H = h;
  ctx.clearRect(0, 0, W, H);
  ctx.font = '11px "JetBrains Mono", monospace';
  const pts = portfolioHistory?.points || [];
  if (pts.length < 2) { ctx.fillStyle = '#7d8f83'; ctx.fillText(pts.length ? 'Need one more snapshot — check back in a couple of minutes.' : 'No history yet — your net worth is snapshotted every couple of minutes.', 20, 30); return; }
  const vals = pts.map(p => p.netWorth);
  if (portfolioHistory.startCash) vals.push(portfolioHistory.startCash);
  let min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.08 || 1; min -= pad; max += pad;
  const X = i => 52 + (i / (pts.length - 1)) * (W - 72);
  const Y = v => 18 + (1 - (v - min) / (max - min)) * (H - 52);
  ctx.strokeStyle = '#1e2a22'; ctx.fillStyle = '#7d8f83'; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) { const v = min + (max - min) * g / 4; const y = Y(v); ctx.beginPath(); ctx.moveTo(52, y); ctx.lineTo(W - 20, y); ctx.stroke(); ctx.fillText(money(v), 4, y + 4); }
  if (portfolioHistory.startCash) {
    ctx.setLineDash([5, 5]); ctx.strokeStyle = '#7d8f83'; ctx.beginPath(); ctx.moveTo(52, Y(portfolioHistory.startCash)); ctx.lineTo(W - 20, Y(portfolioHistory.startCash)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#7d8f83'; ctx.fillText('start ' + money(portfolioHistory.startCash), 58, Y(portfolioHistory.startCash) - 5);
  }
  const grad = ctx.createLinearGradient(0, 18, 0, H - 32); grad.addColorStop(0, accent() + '55'); grad.addColorStop(1, accent() + '00');
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(i), Y(p.netWorth)) : ctx.moveTo(X(i), Y(p.netWorth)));
  ctx.lineTo(X(pts.length - 1), H - 32); ctx.lineTo(X(0), H - 32); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = accent(); ctx.lineWidth = 2; ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(X(i), Y(p.netWorth)) : ctx.moveTo(X(i), Y(p.netWorth)));
  ctx.stroke();
  const last = pts[pts.length - 1]; ctx.fillStyle = accent(); ctx.beginPath(); ctx.arc(X(pts.length - 1), Y(last.netWorth), 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7d8f83';
  const fmt = t => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  ctx.fillText(fmt(pts[0].t), 52, H - 12);
  ctx.fillText(fmt(pts[pts.length - 1].t), W - 150, H - 12);
  const cap = $('portfolio-caption');
  if (cap) cap.textContent = `Your net worth, snapshotted every couple of minutes · ${pts.length} points, last 7 days · now ${money(last.netWorth)} · grey dashed line = your starting cash ${money(portfolioHistory.startCash)}.`;
}
function renderWatchlist() {
  const el = $('watchlist'); el.innerHTML = '';
  let syms = allSymbols();
  // Search filter (ticker or name, case-insensitive).
  if (wlSearch) { const needle = wlSearch.toLowerCase(); syms = syms.filter(s => s.toLowerCase().includes(needle) || symName(s).toLowerCase().includes(needle)); }
  // Sort only when the user picks one; default keeps the existing order.
  if (wlSort === 'chg') syms = [...syms].sort((a, b) => (quotes[b]?.changePct || 0) - (quotes[a]?.changePct || 0));
  else if (wlSort === 'name') syms = [...syms].sort((a, b) => symName(a).localeCompare(symName(b)));
  else if (wlSort === 'value') syms = [...syms].sort((a, b) => {
    const val = s => { const p = (state?.positions || []).find(x => x.symbol === s); return p ? p.price * p.shares : 0; };
    return val(b) - val(a);
  });
  for (const sym of syms) {
    const q = quotes[sym]; if (!q) continue;
    const custom = (state?.customSymbols || []).find(c => c.symbol === sym);
    const held = (state?.positions || []).find(p => p.symbol === sym);
    const prev = prevPrices[sym]; prevPrices[sym] = q.price;
    const flash = prev != null && q.price !== prev ? (q.price > prev ? 'flash-up' : 'flash-down') : '';
    const sess = state?.session || '';
    const extLabel = sess === 'Premarket' ? 'PRE' : (sess === 'After Hours' || sess === 'Overnight' || /^Closed/.test(sess)) ? 'AH' : 'EXT';
    const row = document.createElement('div'); row.className = 'wl-row' + (sym === chartSymbol ? ' selected' : '');
    row.innerHTML = `<span><span class="wl-sym">${escapeHtml(sym)}</span>${held ? '<span class="held-dot" title="You hold this"></span>' : ''} ${custom ? `<span class="tag">${custom.kind === 'crypto' ? 'CRYPTO·YOURS' : 'YOUR PICK'}</span>` : ''}<br><span class="wl-name">${escapeHtml(symName(sym))}</span></span>
      <span>${sparkSvg(q.spark, q.changePct >= 0)}</span>
      <span class="${flash}"><span class="wl-price">${money(q.price)}</span><br><span class="wl-chg ${q.changePct >= 0 ? 'up' : 'down'}">${pct(q.changePct)}</span><br><span class="wl-ext ext">${pct(q.extChangePct)} ${escapeHtml(extLabel)}</span></span>`;
    row.onclick = () => { chartSymbol = sym; $('trade-symbol').value = sym; updateTradeEstimates(); loadChart(); renderWatchlist(); renderPredChips(); };
    el.appendChild(row);
  }
  if (!el.children.length) el.innerHTML = wlSearch ? `<p class="muted">Nothing on your board matches “${escapeHtml(wlSearch)}”.</p>` : '<p class="muted">PULLING LIVE QUOTES…</p>';
}
function renderCustomList() {
  const el = $('custom-list'); if (!el) return;
  const list = state?.customSymbols || [];
  if (!list.length) { el.innerHTML = '<p class="muted small">No own picks yet — add AAPL or BTC above.</p>'; return; }
  el.innerHTML = list.map(c => {
    const held = (state?.positions || []).find(p => p.symbol === c.symbol);
    return `<div class="trade-row"><strong>${escapeHtml(c.symbol)}</strong> <span class="tag">${c.kind === 'crypto' ? 'CRYPTO·YOURS' : 'YOUR PICK'}</span> ${escapeHtml(c.name || '')} ${held ? (held.shares < 0 ? `· short ${Math.abs(held.shares)} — cover first to remove` : `· holding ${held.shares} — sell first to remove`) : ''} <button class="btn small" data-remove="${escapeHtml(c.symbol)}" ${held ? 'disabled' : ''}>× Remove</button></div>`;
  }).join('');
  el.querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => {
    try { const j = await api('/api/custom-symbols', { method: 'DELETE', body: JSON.stringify({ symbol: b.dataset.remove }) }); state = j.state; await loadState(); await loadQuotes(); banner(b.dataset.remove + ' removed'); }
    catch (e) { $('custom-msg').textContent = 'Remove failed: ' + e.message; }
  });
}

// ---------- Chart ----------
// H2: every loadChart() call gets a token; a slow response that finishes
// after a newer call started is ignored, so a stale fetch can never
// overwrite the current ticker/range.
let chartLoadToken = 0;
async function loadChart() {
  const myToken = ++chartLoadToken;
  $('chart-error').classList.add('hidden');
  hoverIdx = -1; const _tip = $('chart-tip'); if (_tip) _tip.classList.add('hidden');
  try { const data = await api(`/api/history?symbol=${chartSymbol}&range=${chartRange}`); if (myToken !== chartLoadToken) return; chartData = data; lastChartLoad = Date.now(); trackTickerView(chartSymbol); }
  catch (e) { if (myToken !== chartLoadToken) return; $('chart-error').textContent = 'Chart is warming up — the feed didn\'t answer. '; const b = document.createElement('button'); b.className = 'btn small'; b.textContent = 'Retry'; b.onclick = loadChart; $('chart-error').appendChild(b); $('chart-error').classList.remove('hidden'); return; }
  const q = quotes[chartSymbol];
  $('chart-title').textContent = chartSymbol + ' — ' + symName(chartSymbol);
  const priceEl = $('chart-price');
  if (q) {
    const prev = prevPrices['chart:' + chartSymbol]; prevPrices['chart:' + chartSymbol] = q.price;
    priceEl.textContent = money(q.price);
    if (prev != null && q.price !== prev) { priceEl.classList.remove('flash-up', 'flash-down'); void priceEl.offsetWidth; priceEl.classList.add(q.price > prev ? 'flash-up' : 'flash-down'); }
    const base = chartRange === '1D' ? (q.prevClose || chartData.points[0]?.c) : chartData.points[0]?.c;
    const chg = base ? ((q.price - base) / base) * 100 : 0;
    $('chart-change').textContent = ` ${pct(chg)} ${chartRange === '1D' ? 'today' : 'over ' + chartRange}`;
    $('chart-change').className = chg >= 0 ? 'up' : 'down';
    const extPct = q.regularClose ? ((q.price - q.regularClose) / q.regularClose) * 100 : 0;
    $('chart-ext').textContent = `Overnight ${pct(extPct)} · ${closeHourLabel()} ${money(q.regularClose)} · last trade ${q.lastTrade || '—'}${q.frozenAtClose ? ' · frozen at close (overnight off)' : ''}`;
  }
  const intervals = { '1D': '1-minute', '5D': '30-minute', '1M': 'daily', '3M': 'daily', '6M': 'weekly', '1Y': 'weekly', '5Y': 'monthly' };
  // M8: RSI is computed over REAL bars only — filled (f=1) points are
  // synthetic flat carries, and the old code let 421 of them drag RSI to 50.
  const realCloses = chartData.points.filter(p => !p.f).map(p => p.c);
  const rsi = computeRSI(realCloses);
  // M9: the old caption lied ("1 candle per source bar") — candles actually
  // group ceil(points/220) bars each. Say so, and say what MA20 means.
  const candleNote = `${chartData.candles?.length || 0} candles · ${chartData.candleStep || 1} bar${(chartData.candleStep || 1) > 1 ? 's' : ''} per candle`;
  const maNote = showMA20 ? ` · MA20 over 20 ${chartMode === 'candles' ? 'candles' : 'bars'} (running avg for first 19)` : '';
  $('chart-caption').textContent = `${chartRange} · ${intervals[chartRange]} bars · ${chartData.points.length} bars${chartRange === '1D' ? ' · purple shading = premarket / after-hours' : ''} · ${candleNote} · RSI(14) ${rsi == null ? '—' : rsi.toFixed(0) + ' (' + rsiLabel(rsi) + ')'}${maNote}${chartData.source === 'stale' ? ` · history feed down — showing the last good chart${chartData.staleAsOf ? ' from ' + fmtTime(chartData.staleAsOf) : ''}` : ''}`;
  if (chartRange === '1D') {
    // Session-aware note: on an early-close day after-hours starts at the
    // real close (e.g. 1:00 PM), not 4:00 PM, and the amber line is the
    // real close, not "4 PM close".
    $('chart-ah-note').textContent = `Purple shading on 1D = premarket (before ${etTimeLabel(chartData.regularStart, '9:30 AM')} ET) and after-hours (after ${etTimeLabel(chartData.regularEnd, '4:00 PM')} ET). The grey dashed line is the previous close; the amber dashed line is the ${closeHourLabel()}; the amber dotted line is your average cost when you hold the stock. Fills are at the LIVE extended price — never the close.`;
  }
  drawChart();
}
// MA20: a 20-period average that is DEFINED from the first bar — until 20
// periods exist it is the running average of the closes so far (mean of
// closes[0..i]). The old strict version left the first 19 points null, so
// on short series the line was a stub: NVDA 6M (~28 weekly bars) only drew
// the last 9 points, 1M (~22 daily bars) only the last 3. Now the line
// spans the whole chart in both modes.
function computeMA(closes, period) {
  const out = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    out[i] = sum / Math.min(i + 1, period);
  }
  return out;
}
// Pure helper: MA20 points for the series actually drawn, so the math can
// be tested without a canvas. Returns [{pos, v, brk}]: pos is a pts index
// in line mode or a candle index in candle mode, v the MA value, brk true
// when a session gap sits just before this point (line breaks there).
// Candle mode averages 20 CANDLE closes (the old code averaged 20 bars
// and plotted them at fractional candle positions — wrong values at wrong
// x). Line mode averages the 20 points of the drawn line, carries included
// (a flat minute is the price not moving), with the window resetting at
// session gaps so one day never averages the previous day's closes. Gaps
// are read off the point grid itself (1D/5D only): the grid is filled
// inside a day, so a jump in it is an overnight/weekend/holiday break.
// Daily+ ranges routinely span weekends and the price line connects there,
// so no breaks there.
function maSeries(chartData, mode) {
  const pts = chartData.points || [];
  const stepMs = chartData.range === '1D' ? 60000 : chartData.range === '5D' ? 30 * 60 * 1000 : 0;
  const gapBefore = new Set();
  if (stepMs) {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].t - pts[i - 1].t > stepMs * 1.5) gapBefore.add(i);
    }
  }
  const hasGapBetween = (a, b) => { for (let k = a + 1; k <= b; k++) if (gapBefore.has(k)) return true; return false; };
  if (mode === 'candles') {
    const candles = chartData.candles || [];
    const step = chartData.candleStep || 1;
    return computeMA(candles.map(c => c.c), 20).map((v, k) => ({
      pos: k, v,
      brk: k > 0 && hasGapBetween(k * step - 1, k * step)
    }));
  }
  // Line mode: the MA averages the DRAWN line — every point on the grid,
  // carries included. A flat minute means the price didn't move, so the
  // last traded price is the honest value there; averaging real bars only
  // made thin tickers' MA start halfway across the chart (DUOL 1D: first
  // real bar is ~58% in; FANG/MCD similar) and its last point stop short
  // of the right edge. The window resets at session gaps (5D), so Monday
  // never averages Friday's closes; seeding keeps the line spanning.
  const segs = [];
  let segStart = 0;
  for (let i = 1; i <= pts.length; i++) {
    if (i === pts.length || gapBefore.has(i)) { segs.push([segStart, i]); segStart = i; }
  }
  const out = [];
  for (const [a, b] of segs) {
    computeMA(pts.slice(a, b).map(p => p.c), 20).forEach((v, k) => {
      out.push({ pos: a + k, v, brk: k === 0 && a > 0 });
    });
  }
  return out;
}
function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}
function rsiLabel(rsi) { return rsi == null ? '—' : rsi >= 70 ? 'overbought' : rsi <= 30 ? 'oversold' : 'neutral'; }
function etMins(t) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false });
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return (+p.hour % 24) * 60 + (+p.minute);
}
// Session-aware close label: "1 PM close" on an early-close day, "4 PM
// close" on a normal day. The regular-session end comes from the server
// (chartData.regularEnd, ms epoch, Yahoo currentTradingPeriod); fall back
// to the old hardcoded label when the server didn't send it.
function closeHourLabel() {
  if (chartData?.regularEnd != null) {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: true }).format(new Date(chartData.regularEnd)) + ' close';
  }
  return '4 PM close';
}
function etTimeLabel(t, fallback) {
  if (t == null) return fallback;
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(t));
}
function drawChart() {
  const cv = $('chart'); if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 760, h = 320;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = w, H = h;
  ctx.clearRect(0, 0, W, H);
  ctx.font = '11px "JetBrains Mono", monospace';
  if (!chartData?.points?.length || chartData.points.length < 2) { ctx.fillStyle = '#7d8f83'; ctx.fillText('Chart warming up — no data yet. Try Refresh.', 20, 30); return; }
  const pts = chartData.points;
  const vals = pts.flatMap(p => [p.h, p.l]);
  let min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.08 || 1; min -= pad; max += pad;
  const X = i => 52 + (i / (pts.length - 1)) * (W - 72);
  const Y = v => 18 + (1 - (v - min) / (max - min)) * (H - 52);
  if (chartRange === '1D') {
    // H3: shading boundaries come from the real session the server sent
    // (regularStart/regularEnd), not hardcoded 9:30/16:00 — on early-close
    // days 13:00–16:00 used to draw unshaded as regular hours. Fallback is
    // the old 570/960 when the server didn't send them.
    const regStartM = chartData.regularStart != null ? etMins(chartData.regularStart) : 570;
    const regEndM = chartData.regularEnd != null ? etMins(chartData.regularEnd) : 960;
    ctx.fillStyle = 'rgba(179,136,255,0.14)';
    let start = null, label = '';
    const barW = (W - 72) / Math.max(1, pts.length - 1);
    const flush = (endIdx) => { if (start !== null) { ctx.fillRect(X(start), 0, (X(endIdx) + barW) - X(start), H - 32); ctx.fillStyle = '#c4a8ff'; ctx.fillText(label, X(start) + 6, 14); ctx.fillStyle = 'rgba(179,136,255,0.14)'; start = null; } }; // H3: flush covers the last bar too (was one bar short)
    pts.forEach((p, i) => { const m = etMins(p.t); const ah = m < regStartM || m >= regEndM; if (ah && start === null) { start = i; label = m < regStartM ? 'PRE' : 'AFTER HOURS'; } if (!ah && start !== null) flush(i); });
    flush(pts.length - 1);
  }
  ctx.strokeStyle = '#1e2a22'; ctx.fillStyle = '#7d8f83'; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) { const v = min + (max - min) * g / 4; const y = Y(v); ctx.beginPath(); ctx.moveTo(52, y); ctx.lineTo(W - 20, y); ctx.stroke(); ctx.fillText(money(v), 4, y + 4); }
  ctx.strokeStyle = '#1e2a22'; ctx.beginPath(); ctx.moveTo(52, 0); ctx.lineTo(52, H - 32); ctx.lineTo(W - 20, H - 32); ctx.stroke();
  if (chartRange === '1D' && chartData.prevClose) {
    ctx.setLineDash([5, 5]); ctx.strokeStyle = '#7d8f83'; ctx.beginPath(); ctx.moveTo(52, Y(chartData.prevClose)); ctx.lineTo(W - 20, Y(chartData.prevClose)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#7d8f83'; ctx.fillText('prev close ' + money(chartData.prevClose), 58, Y(chartData.prevClose) - 5);
  }
  const q = quotes[chartSymbol];
  if (chartRange === '1D' && q?.regularClose) { // amber dashed close line — 1D only, it means nothing on 5D/1M/1Y. Label is session-aware: "1 PM close" on an early-close day, "4 PM close" normally.
    ctx.setLineDash([6, 4]); ctx.strokeStyle = '#ffb02e'; ctx.beginPath(); ctx.moveTo(52, Y(q.regularClose)); ctx.lineTo(W - 20, Y(q.regularClose)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffb02e'; ctx.fillText(closeHourLabel() + ' ' + money(q.regularClose), 58, Y(q.regularClose) - 5);
  }
  const held = (state?.positions || []).find(p => p.symbol === chartSymbol);
  if (held) { // amber dotted "your avg" line
    ctx.setLineDash([2, 4]); ctx.strokeStyle = '#ffb02e'; ctx.beginPath(); ctx.moveTo(52, Y(held.avg_cost)); ctx.lineTo(W - 20, Y(held.avg_cost)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffb02e'; ctx.fillText('your avg ' + money(held.avg_cost), 58, Y(held.avg_cost) - 5);
  }
  // Volume bars (bottom strip, under the price line) + optional MA20.
  // Volume comes from the history points' v field (candles carry the summed
  // volume of their bars). Filled 1D bars have v=0 and draw nothing, which
  // is honest — no trades happened in those minutes.
  {
    const series = chartMode === 'candles' ? (chartData.candles || []) : pts;
    if (series.length) {
      // L12: volume bars share one scale in both modes (max over the raw
      // points), instead of each mode scaling to its own max.
      const maxV = Math.max(...pts.map(p => p.v || 0), 1);
      const vTop = H - 50, vBot = H - 34;
      series.forEach((p, i) => {
        const v = p.v || 0; if (!v) return;
        const hgt = Math.max(1, (v / maxV) * (vBot - vTop));
        const x = chartMode === 'candles' ? 52 + (i + 0.5) / series.length * (W - 72) : X(i);
        const w = chartMode === 'candles' ? Math.max(2, (W - 72) / series.length * 0.7) : Math.max(1, (W - 72) / series.length * 0.8);
        ctx.fillStyle = p.c >= p.o ? 'rgba(43,255,136,0.35)' : 'rgba(255,71,87,0.35)';
        ctx.fillRect(x - w / 2, vBot - hgt, w, hgt);
      });
      if (showMA20) {
        // MA20 is a true 20-period average of what is drawn — 20 candles
        // in candle mode, 20 grid points in line mode — seeded with the
        // running average so the line starts at the first bar (on 6M the
        // old strict MA only drew the last 9 of 28 points). Breaks at
        // session gaps on 1D/5D instead of joining across them.
        const maPts = maSeries(chartData, chartMode);
        if (maPts.length) {
          ctx.strokeStyle = '#b388ff'; ctx.lineWidth = 1.5; ctx.beginPath();
          let started = false;
          maPts.forEach(p => {
            if (p.v == null) return;
            const x = chartMode === 'candles' ? 52 + (p.pos + 0.5) / series.length * (W - 72) : X(p.pos);
            if (!started || p.brk) { ctx.moveTo(x, Y(p.v)); started = true; } else ctx.lineTo(x, Y(p.v));
          });
          ctx.stroke();
        }
      }
    }
  }
  if (chartMode === 'line') {
    // Line colour follows the period's direction, not the theme accent:
    // 1D compares the last price to prevClose; other ranges compare the
    // last close to the first close. Green when the period is up, red
    // when it's down.
    // M12: colour the line from the LIVE quote when one is available, not
    // the last chart point — the header % already uses the live quote, and
    // the two used to disagree while the chart was stale.
    const liveQ = quotes[chartSymbol];
    const base = chartRange === '1D' ? (chartData.prevClose ?? pts[0].c) : pts[0].c;
    const endVal = (chartRange === '1D' && liveQ) ? liveQ.price : pts[pts.length - 1].c;
    const lineColor = endVal >= base ? '#2bff88' : '#ff4757';
    const grad = ctx.createLinearGradient(0, 18, 0, H - 32); grad.addColorStop(0, lineColor + '55'); grad.addColorStop(1, lineColor + '00');
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(i), Y(p.c)) : ctx.moveTo(X(i), Y(p.c)));
    ctx.lineTo(X(pts.length - 1), H - 32); ctx.lineTo(X(0), H - 32); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(X(i), Y(p.c)) : ctx.moveTo(X(i), Y(p.c)));
    ctx.stroke();
    const last = pts[pts.length - 1]; ctx.fillStyle = lineColor; ctx.beginPath(); ctx.arc(X(pts.length - 1), Y(last.c), 3.5, 0, Math.PI * 2); ctx.fill();
  } else {
    const candles = chartData.candles || [];
    const w = Math.max(2, (W - 72) / candles.length * 0.7);
    candles.forEach((c, i) => { const x = 52 + (i + 0.5) / candles.length * (W - 72); const up = c.c >= c.o; ctx.strokeStyle = up ? '#2bff88' : '#ff4757'; ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke(); ctx.fillRect(x - w / 2, Y(Math.max(c.o, c.c)), w, Math.max(1, Math.abs(Y(c.o) - Y(c.c)))); });
  }
  ctx.fillStyle = '#7d8f83';
  const fmt = t => new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  ctx.fillText(fmt(pts[0].t), 52, H - 12);
  ctx.fillText(fmt(pts[pts.length - 1].t), W - 150, H - 12);
  // Hover state: crosshair + dot at the hovered bar, tooltip is a DOM div.
  chartGeom = { pts, candles: chartData.candles || [], X, Y, W, H };
  if (hoverIdx >= 0) {
    const n = chartMode === 'candles' ? chartGeom.candles.length : pts.length;
    const i = Math.max(0, Math.min(n - 1, hoverIdx));
    const p = chartMode === 'candles' ? chartGeom.candles[i] : pts[i];
    if (p) {
      const x = chartMode === 'candles' ? 52 + (i + 0.5) / n * (W - 72) : X(i);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = '#e8f0e9'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 32); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = accent(); ctx.beginPath(); ctx.arc(x, Y(p.c), 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#06090a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, Y(p.c), 4, 0, Math.PI * 2); ctx.stroke();
    }
  }
  bindChartHover();
}
let hoverIdx = -1, chartGeom = null;
function bindChartHover() {
  const cv = $('chart'), tip = $('chart-tip'); if (!cv || !tip || cv._hoverBound) return;
  cv._hoverBound = true;
  const fmtTip = t => new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const showTip = e => {
    if (!chartGeom) return;
    const rect = cv.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (cv.clientWidth / rect.width);
    const n = chartMode === 'candles' ? chartGeom.candles.length : chartGeom.pts.length;
    if (!n) return;
    const i = chartMode === 'candles'
      ? Math.max(0, Math.min(n - 1, Math.floor((x - 52) / (chartGeom.W - 72) * n)))
      : Math.max(0, Math.min(n - 1, Math.round((x - 52) / (chartGeom.W - 72) * (n - 1))));
    const p = chartMode === 'candles' ? chartGeom.candles[i] : chartGeom.pts[i];
    if (!p) return;
    hoverIdx = i;
    const px = chartMode === 'candles' ? 52 + (i + 0.5) / n * (chartGeom.W - 72) : chartGeom.X(i);
    const py = chartGeom.Y(p.c);
    // L10: OHLC + volume in BOTH modes (line mode used to show close +
    // time only), and clamp the tooltip inside the chart vertically too —
    // it used to clip off the top.
    tip.innerHTML = `<b>${money(p.c)}</b><br>${fmtTip(p.t)}<br>O ${money(p.o)} · H ${money(p.h)} · L ${money(p.l)} · C ${money(p.c)}${p.v ? `<br>Vol ${Number(p.v).toLocaleString('en-US')}` : ''}`;
    tip.classList.remove('hidden');
    // Keep the tooltip inside the chart: flip it left when near the right edge.
    const tipW = tip.offsetWidth || 140;
    const tipH = tip.offsetHeight || 80;
    tip.style.left = Math.max(4, Math.min(chartGeom.W - tipW - 4, px + 12)) + 'px';
    tip.style.top = Math.max(4, Math.min(chartGeom.H - tipH - 4, py - 10)) + 'px';
    drawChart();
  };
  const hideTip = () => { if (hoverIdx === -1) return; hoverIdx = -1; tip.classList.add('hidden'); drawChart(); };
  cv.addEventListener('pointermove', showTip);
  cv.addEventListener('pointerleave', hideTip);
  cv.addEventListener('pointerdown', showTip);
}

// ---------- Trade panel ----------
function currentPrice() { return quotes[chartSymbol]?.price || 0; }
function heldPosition(sym) { return (state?.positions || []).find(p => p.symbol === sym); }
function renderQuickSize() {
  const el = $('quick-size'); const q = quotes[chartSymbol]; const pos = heldPosition(chartSymbol);
  if (!q) { el.innerHTML = ''; return; }
  const mk = (label, frac, base) => `<button class="btn small" data-frac="${frac}" data-base="${base}">${label}</button>`;
  const isLong = pos && pos.shares > 0, isShort = pos && pos.shares < 0;
  if (tradeSide === 'buy' && isShort) el.innerHTML = mk('25%', 0.25, 'short') + mk('50%', 0.50, 'short') + mk('COVER ALL', 1, 'short'); // cover fractions of the short
  else if (tradeSide === 'buy' || !isLong) el.innerHTML = mk('10%', 0.10, 'cash') + mk('25%', 0.25, 'cash') + mk('50%', 0.50, 'cash') + mk('MAX', 1, 'cash'); // buy long, or size a new/increased short by cash
  else el.innerHTML = mk('25%', 0.25, 'pos') + mk('50%', 0.50, 'pos') + mk('ALL', 1, 'pos');
  el.querySelectorAll('button').forEach(b => b.onclick = () => {
    const frac = parseFloat(b.dataset.frac);
    let shares = 0;
    if (b.dataset.base === 'cash') shares = (state.cash * frac) / q.price;
    else if (b.dataset.base === 'short' && pos) shares = Math.abs(pos.shares) * frac;
    else if (pos) shares = pos.shares * frac;
    $('trade-shares').value = Math.floor(shares * 10000) / 10000;
    updateTradeEstimates();
  });
}
function updateTradeEstimates() {
  const q = quotes[chartSymbol]; const shares = parseFloat($('trade-shares').value) || 0;
  $('trade-side-buy').classList.toggle('active', tradeSide === 'buy');
  $('trade-side-sell').classList.toggle('active', tradeSide === 'sell');
  const pos0 = heldPosition(chartSymbol);
  // Button says what the trade actually does: SELL with no long position
  // opens a SHORT; BUY against a short COVERS it.
  $('btn-trade-submit').textContent = tradeSide === 'buy'
    ? (pos0 && pos0.shares < 0 ? 'COVER ' : 'BUY ') + chartSymbol
    : (pos0 && pos0.shares > 0 ? 'SELL ' : 'SHORT ') + chartSymbol;
  renderQuickSize();
  renderTradeSessionBanner();
  if (!q) { $('trade-est').textContent = 'Waiting for a live price…'; $('trade-cash-after').textContent = ''; $('trade-position-line').textContent = ''; return; }
  const total = shares * q.price;
  const frozenNote = q.frozenAtClose ? ' · frozen at the regular close (overnight prices off)' : '';
  flashNum($('trade-est'), total, (tradeSide === 'buy' ? `Est. cost: ${money(total)} (${shares} × ${money(q.price)})` : `Est. proceeds: ${money(total)} (${shares} × ${money(q.price)})`) + frozenNote);
  flashNum($('trade-cash-after'), tradeSide === 'buy' ? state.cash - total : state.cash + total, 'Cash after: ' + money(tradeSide === 'buy' ? state.cash - total : state.cash + total));
  const pos = heldPosition(chartSymbol);
  if (!pos) $('trade-position-line').textContent = 'You hold no ' + chartSymbol + ' yet. SELL opens a short — you profit if the price falls; BUY while short covers it.';
  else if (pos.shares < 0) $('trade-position-line').textContent = `You SHORT ${Math.abs(pos.shares)} shares @ ${money(pos.avg_cost)} avg short price · unrealized ${pos.changePct >= 0 ? '+' : ''}${pos.changePct.toFixed(2)}% (${money((pos.avg_cost - q.price) * Math.abs(pos.shares))}) · BUY covers it${shares > Math.abs(pos.shares) && tradeSide === 'buy' ? ` — you only short ${Math.abs(pos.shares)}, covering more is not allowed` : ''}.`;
  else $('trade-position-line').textContent = `You hold ${pos.shares} shares @ ${money(pos.avg_cost)} avg · unrealized ${pos.changePct >= 0 ? '+' : ''}${pos.changePct.toFixed(2)}% (${money((q.price - pos.avg_cost) * pos.shares)})`;
}
async function doTrade() {
  if (tradeInFlight) return; // guard: no double-click double-fills
  const shares = parseFloat($('trade-shares').value);
  if (!(shares > 0)) { $('trade-msg').textContent = 'Enter shares first (fractions work, up to 4 decimals).'; return; }
  const q0 = quotes[chartSymbol];
  if (!q0 || !(q0.price > 0)) { $('trade-msg').textContent = 'No live price yet — hit Refresh first.'; return; }
  const btn = $('btn-trade-submit');
  const heldBefore = heldPosition(chartSymbol);
  const avgBefore = heldBefore ? heldBefore.avg_cost : 0;
  const style = STYLES[state?.settings?.style] || STYLES.day;
  tradeInFlight = true; if (btn) btn.disabled = true;
  try {
    const j = await api('/api/trade', { method: 'POST', body: JSON.stringify({ symbol: chartSymbol, side: tradeSide, shares }) });
    const verb = j.shorted ? 'Shorted' : j.covered ? 'Covered' : tradeSide === 'buy' ? 'Bought' : 'Sold';
    $('trade-msg').textContent = `${verb} ${shares} ${chartSymbol} @ ${money(j.price)} — ${sessionDisplay(j.session)} session${j.pnl ? ` · P&L ${(j.pnl >= 0 ? '+' : '−')}$${Math.abs(j.pnl).toFixed(2)}` : ''}`;
    $('trade-shares').value = 1; updateTradeEstimates();
    if (tradeSide === 'sell' && heldBefore && heldBefore.shares > 0 && avgBefore > 0) {
      const gainPct = ((j.price - avgBefore) / avgBefore) * 100;
      if (gainPct > 0) { // take-profit / any profitable sell: sound + confetti
        if (state?.settings?.soundOn !== false) playWinSound();
        confettiBurst();
      } else if (gainPct <= style.stop || gainPct <= -5) { // stop-loss sell: flash red
        flashTradeCardLoss();
      }
    } else if (tradeSide === 'buy' && heldBefore && heldBefore.shares < 0 && avgBefore > 0) {
      // Covering a short: gain is the price FALLING vs the short price.
      const gainPct = ((avgBefore - j.price) / avgBefore) * 100;
      if (gainPct > 0) { // profitable cover: sound + confetti
        if (state?.settings?.soundOn !== false) playWinSound();
        confettiBurst();
      } else if (gainPct <= style.stop || gainPct <= -5) { // covered at a loss past the stop: flash red
        flashTradeCardLoss();
      }
    }
    state = j.state; await loadState(); await loadQuotes(); loadExtras(true);
  } catch (e) { $('trade-msg').textContent = 'Trade failed: ' + e.message; }
  finally { tradeInFlight = false; if (btn) btn.disabled = false; }
}

// ---------- Limit / stop orders ----------
function renderOrders() {
  const el = $('orders-list'); if (!el) return;
  const orders = state?.orders || [];
  if (!orders.length) { el.innerHTML = '<p class="muted">No orders yet — place a limit or stop order above.</p>'; return; }
  el.innerHTML = orders.map(o => {
    const statusChip = o.status === 'open' ? '<span class="chip check">OPEN</span>' : o.status === 'filled' ? '<span class="chip buy">FILLED</span>' : o.status === 'cancelled' ? '<span class="chip">CANCELLED</span>' : '<span class="chip sell">FAILED</span>';
    return `<div class="trade-row">${statusChip} <strong>${escapeHtml(o.symbol)}</strong> ${escapeHtml(String(o.type || '').toUpperCase())} ${escapeHtml(String(o.side || '').toUpperCase())} ${o.shares} @ ${money(o.target_price)} · placed ${fmtDT(o.created_at)}${o.status === 'filled' ? ` · filled ${fmtDT(o.filled_at)} @ ${money(o.fill_price)}` : ''} ${o.status === 'open' ? `<button class="btn small" data-cancel-order="${o.id}">Cancel</button>` : ''}</div>`;
  }).join('');
  el.querySelectorAll('[data-cancel-order]').forEach(b => b.onclick = async () => {
    try { const j = await api('/api/orders/' + b.dataset.cancelOrder + '/cancel', { method: 'POST' }); state.orders = j.orders; renderOrders(); $('order-msg').textContent = 'Order cancelled.'; }
    catch (e) { $('order-msg').textContent = 'Cancel failed: ' + e.message; }
  });
}
async function placeOrder() {
  const target = parseFloat($('order-target').value), shares = parseFloat($('order-shares').value);
  if (!(target > 0)) { $('order-msg').textContent = 'Enter a target price first.'; return; }
  if (!(shares > 0)) { $('order-msg').textContent = 'Enter shares first.'; return; }
  try {
    const j = await api('/api/orders', { method: 'POST', body: JSON.stringify({ symbol: $('order-symbol').value, side: orderSide, type: $('order-type').value, targetPrice: target, shares }) });
    state = j.state; renderOrders(); loadExtras(true);
    $('order-msg').textContent = j.filledNow ? 'Order filled immediately at the target price or better.' : 'Order placed — it fills at the target price or better when the live price touches it.';
  } catch (e) { $('order-msg').textContent = 'Order failed: ' + e.message; }
}

// ---------- Positions / trades / movers / news ----------
function renderPositions() {
  const el = $('positions');
  if (!state.positions.length) { el.innerHTML = '<p class="muted">No positions yet — pick a ticker and send it. Yes, even after hours.</p>'; return; }
  el.innerHTML = state.positions.map(p => {
    const mv = p.price * p.shares;
    const unrl = (p.price - p.avg_cost) * p.shares; // correct sign for shorts too: negative shares flip it
    const isShort = p.shares < 0;
    // Guardrail lines are the fixed −5% / +10% (the auto trader uses its
    // style's lines instead — see the note under the lines).
    const stopPrice = isShort ? p.avg_cost * 1.05 : p.avg_cost * 0.95;
    const targetPrice = isShort ? p.avg_cost * 0.90 : p.avg_cost * 1.10;
    const stopHit = p.changePct <= -5, targetHit = p.changePct >= 10;
    const flag = stopHit ? `<span class="tag red">${isShort ? 'STOP HIT — cover, it\'s past your +5% line' : 'STOP HIT — past your −5% line'} (${money(stopPrice)})</span>` : targetHit ? `<span class="tag green">${isShort ? 'TARGET HIT — cover, it\'s past your −10% line' : 'TARGET HIT — past your +10% line'} (${money(targetPrice)})</span>` : '';
    const shortTag = isShort ? '<span class="tag red">SHORT</span>' : '';
    const linesTxt = isShort ? `your lines: cover-stop ${money(stopPrice)} · cover-target ${money(targetPrice)} (a short loses at +5%, wins at −10%)` : `your lines: stop ${money(stopPrice)} · target ${money(targetPrice)} (−5% / +10% — the auto trader uses its style's lines)`;
    return `<div class="pos-row"><strong>${escapeHtml(p.symbol)}</strong> ${shortTag} ${flag}<br><span class="muted">${isShort ? `Short ${Math.abs(p.shares)} shares @ ${money(p.avg_cost)} short avg · exposure <span class="pos-mv flash-inline" data-pos-flash data-sym="${escapeHtml(p.symbol)}" data-kind="mv">${money(Math.abs(mv))}</span>` : `Market value <span class="pos-mv flash-inline" data-pos-flash data-sym="${escapeHtml(p.symbol)}" data-kind="mv">${money(mv)}</span> · ${p.shares} shares @ ${money(p.avg_cost)} avg`}</span><br><span class="pos-unrl flash-inline ${p.changePct >= 0 ? 'up' : 'down'}" data-pos-flash data-sym="${escapeHtml(p.symbol)}" data-kind="unrl">Unrealized ${money(unrl)} (${pct(p.changePct)})</span><br><span class="muted small">${linesTxt}</span> <button class="btn small" data-open="${escapeHtml(p.symbol)}">Open ${escapeHtml(p.symbol)} →</button></div>`;
  }).join('');
  // Flash market value / unrealized P&L when they move since last render.
  el.querySelectorAll('[data-pos-flash]').forEach(s => {
    const p = (state?.positions || []).find(x => x.symbol === s.dataset.sym); if (!p) return;
    const v = s.dataset.kind === 'mv' ? p.price * p.shares : (p.price - p.avg_cost) * p.shares;
    flashSpan(s, s.dataset.sym + ':' + s.dataset.kind, v, _prevPos);
  });
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { chartSymbol = b.dataset.open; $('trade-symbol').value = chartSymbol; gotoTab('trade'); loadChart(); renderWatchlist(); });
}
function renderTrades() {
  const el = $('trades');
  if (!state.trades.length) { el.innerHTML = '<p class="muted">No trades yet. First one\'s free — well, they\'re all free, it\'s paper.</p>'; return; }
  el.innerHTML = state.trades.map(t => {
    const src = String(t.source || '');
    const kindTag = src.endsWith('-short') ? ' <span class="tag red">SHORT</span>' : src.endsWith('-cover') ? ' <span class="tag amber">COVER</span>' : '';
    const closed = !!t.pnl && ((t.side === 'sell' && !src.endsWith('-short')) || (t.side === 'buy' && src.endsWith('-cover')));
    return `<div class="trade-row"><span class="chip ${t.side === 'buy' ? 'buy' : 'sell'}">${escapeHtml(String(t.side || '').toUpperCase())}</span>${kindTag} <strong>${escapeHtml(t.symbol)}</strong> · ${t.shares} shares @ ${money(t.price)} · ${money(t.total)} · ${fmtDT(t.created_at)} · ${escapeHtml(t.session || '')} · ${escapeHtml(t.source || '')}${t.pnl ? ` · Realized P&L <span class="${t.pnl >= 0 ? 'up' : 'down'}">${money(t.pnl)}</span>` : ''}${closed ? ` <button class="btn small" data-share-trade="${t.id}">SHARE ⤓ PNG</button><button class="btn small" data-copy-trade="${t.id}">COPY FOR DISCORD</button>` : ''}</div>`;
  }).join('');
  el.querySelectorAll('[data-share-trade]').forEach(b => b.onclick = () => { const t = (state.trades || []).find(x => x.id === +b.dataset.shareTrade); if (t) shareTradeCard(t); });
  el.querySelectorAll('[data-copy-trade]').forEach(b => b.onclick = () => { const t = (state.trades || []).find(x => x.id === +b.dataset.copyTrade); if (t) copyTradeText(t); });
}
async function loadNews() {
  const el = $('news');
  try {
    const n = await api('/api/news'); lastNewsLoad = Date.now();
    $('news-searched').textContent = 'searched ' + new Date(n.searchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const tm = $('top-movers');
    // TOP MOVERS · LIVE: one line per headline, with symbol chip and % today.
    const moverRows = (n.groups || []).flatMap(g => {
      const mv = (n.movers || []).find(m => m.symbol === g.symbol);
      const chg = mv?.changePct || 0;
      if (!g.headlines.length) return [`<div class="mover-row"><span class="chip">${escapeHtml(g.symbol)}</span> <span class="${chg >= 0 ? 'up' : 'down'}">${pct(chg)}</span> — no fresh headlines</div>`];
      return g.headlines.map(h => `<div class="mover-row"><span class="chip">${escapeHtml(g.symbol)}</span> <span class="${chg >= 0 ? 'up' : 'down'}">${pct(chg)}</span> — <a href="${escapeHtml(safeUrl(h.link))}" target="_blank" rel="noopener">${escapeHtml(h.title)}</a></div>`);
    });
    tm.innerHTML = moverRows.join('') || '<p class="muted">No movers right now.</p>';
    el.innerHTML = (n.groups || []).map(g => {
      const mv = (n.movers || []).find(m => m.symbol === g.symbol);
      return `<div class="pred-card"><p><button class="btn small" data-news-sym="${escapeHtml(g.symbol)}">${escapeHtml(g.symbol)}</button> <span class="${(mv?.changePct || 0) >= 0 ? 'up' : 'down'}">${pct(mv?.changePct || 0)} today</span></p>` +
        (g.headlines.length ? g.headlines.map(h => `<div class="log-row"><a href="${escapeHtml(safeUrl(h.link))}" target="_blank" rel="noopener"><strong>${escapeHtml(h.title)}</strong></a><br><span class="muted small">${escapeHtml(h.snippet || '')}</span></div>`).join('') : '<p class="muted small">No fresh headlines for this ticker.</p>') + '</div>';
    }).join('') || '<p class="muted">No fresh headlines found for the big movers right now — hit ↻ NEWS in a bit.</p>';
    el.querySelectorAll('[data-news-sym]').forEach(b => b.onclick = () => { chartSymbol = b.dataset.newsSym; $('trade-symbol').value = chartSymbol; loadChart(); renderWatchlist(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  } catch (e) {
    el.innerHTML = `<p class="muted">The news search didn't answer this time.</p><button class="btn small" id="btn-news-retry">Retry</button>`;
    $('btn-news-retry').onclick = loadNews;
    // TOP MOVERS fallback: render the movers from live quotes so the box
    // never sits on "PULLING LIVE QUOTES…" forever when the news feed is down.
    const tm = $('top-movers');
    if (tm) {
      const movers = Object.values(quotes).filter(q => q?.price > 0).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 6);
      tm.innerHTML = movers.length ? movers.map(q => `<div class="mover-row"><span class="chip">${escapeHtml(q.symbol)}</span> <span class="${q.changePct >= 0 ? 'up' : 'down'}">${pct(q.changePct)}</span> — no fresh headlines</div>`).join('') : '<p class="muted">No movers right now.</p>';
    }
  }
}

// ---------- Pings ----------
function pingKindChip(kind) { const k = String(kind || ''); return `<span class="chip ${k.startsWith('BUY') ? 'buy' : 'sell'}">${escapeHtml(k)}</span>`; }
function renderAlerts() {
  const el = $('ping-feed');
  el.innerHTML = state.alerts.length ? state.alerts.map(a => {
    const q = quotes[a.symbol];
    return `<div class="ping-row">${pingKindChip(a.kind)} <strong>${escapeHtml(a.symbol)}</strong>${a.read ? '' : '<span class="new-badge">NEW</span>'}<br>${escapeHtml(a.message)}<br><span class="muted small">${money(a.price)} · ${q ? pct(q.changePct) + ' today' : ''} · ${fmtDT(a.created_at)}</span> <button class="btn small" data-ping-open="${escapeHtml(a.symbol)}">Open ${escapeHtml(a.symbol)} →</button></div>`;
  }).join('') : `<p class="muted">${state.settings.pingsOn ? 'No pings yet — the engine is watching. First dip, rip, stop or target hit lands here.' : 'Pings are OFF. Flip the master switch above and the engine starts watching your rules.'}</p>`;
  el.querySelectorAll('[data-ping-open]').forEach(b => b.onclick = () => { chartSymbol = b.dataset.pingOpen; $('trade-symbol').value = chartSymbol; gotoTab('trade'); loadChart(); renderWatchlist(); });
  // Ping banner: newest unread ping, with VIEW + Dismiss; sound + browser notification once.
  const fresh = state.alerts.filter(a => !notifiedIds.has(a.id));
  for (const a of fresh) {
    notifiedIds.add(a.id);
    if (a.created_at > Date.now() - 10 * 60 * 1000) notifyPing(a);
  }
  const newestUnread = state.alerts.filter(a => !a.read).sort((x, y) => y.created_at - x.created_at)[0];
  const b = $('banner');
  if (newestUnread && bannerAlertId !== newestUnread.id) {
    bannerAlertId = newestUnread.id;
    b.innerHTML = `${pingKindChip(newestUnread.kind)} <strong>${escapeHtml(newestUnread.symbol)}</strong> — ${escapeHtml(newestUnread.message)} <span class="spacer"></span><button class="btn small" id="btn-banner-view">VIEW</button><button class="btn small" id="btn-banner-dismiss">Dismiss</button>`;
    b.classList.remove('hidden');
    $('btn-banner-view').onclick = () => { chartSymbol = newestUnread.symbol; $('trade-symbol').value = newestUnread.symbol; gotoTab('pings'); };
    $('btn-banner-dismiss').onclick = () => { b.classList.add('hidden'); bannerAlertId = null; };
  } else if (!newestUnread) { b.classList.add('hidden'); bannerAlertId = null; }
}
function updatePingUI() {
  if (!state) return; const s = state.settings;
  const setChecked = (id, v) => { const el = $(id); if (el) el.checked = v; };
  setChecked('pings-on', s.pingsOn); setChecked('set-pings-on', s.pingsOn); setChecked('side-pings', s.pingsOn);
  setChecked('buy-pings', s.buyPings !== false); setChecked('set-buy-pings', s.buyPings !== false);
  setChecked('sell-pings', s.sellPings !== false); setChecked('set-sell-pings', s.sellPings !== false);
  setChecked('stop-target-pings', s.stopTargetPings !== false); setChecked('set-stop-target-pings', s.stopTargetPings !== false);
  setChecked('sound-on', s.soundOn !== false); setChecked('set-sound-on', s.soundOn !== false); setChecked('side-sound', s.soundOn !== false);
  // Focus-guarded: the 10-second refresh must not overwrite an email the
  // player is in the middle of typing.
  setInputValue('notify-email', state.user.email || state.user.pendingEmail || '');
  setInputValue('set-notify-email', state.user.email || state.user.pendingEmail || '');
  const statusTxt = state.user.emailVerified ? 'VERIFIED ✓ ' + state.user.email : (state.user.pendingEmail ? 'SAVED — pending verification: ' + state.user.pendingEmail + ' — enter the code below.' : 'No email saved — send yourself a code to turn on email pings.');
  $('email-status').textContent = statusTxt;
  const setStatus = $('set-email-status'); if (setStatus) setStatus.textContent = statusTxt;
  const codeLabel = state.user.emailVerified ? 'VERIFIED ✓' : state.user.pendingEmail ? 'SAVED' : 'SEND CODE';
  for (const id of ['btn-send-code', 'btn-set-send-code']) { const b = $(id); if (b) b.textContent = codeLabel; }
  $('email-verify-block').classList.toggle('hidden', !(state.user.pendingEmail && !state.user.emailVerified));
  const setVerify = $('set-email-verify-block'); if (setVerify) setVerify.classList.toggle('hidden', !(state.user.pendingEmail && !state.user.emailVerified));
  // NOT VERIFIED YET — the address is saved but no mail goes there until
  // the code is entered.
  for (const [boxId, txtId] of [['email-not-verified', 'email-not-verified-text'], ['set-email-not-verified', 'set-email-not-verified-text']]) {
    const box = $(boxId); if (!box) continue;
    box.classList.toggle('hidden', !(state.user.pendingEmail && !state.user.emailVerified));
    const t = $(txtId); if (t && state.user.pendingEmail) t.textContent = `NOT VERIFIED YET — ${state.user.pendingEmail} is saved, but NO emails go there until you enter the code we emailed it. That keeps alerts out of inboxes that aren't yours.`;
  }
  setChecked('email-pings', s.emailPings); setChecked('set-email-pings', s.emailPings); setChecked('side-email-pings', s.emailPings);
  setChecked('email-trades', s.emailTrades); setChecked('set-email-trades', s.emailTrades); setChecked('side-email-trades', s.emailTrades);
  const queuedTxt = state.emailQueued ? state.emailQueued + ' email(s) queued — they send batched (max 20 per email).' : 'No emails queued.';
  $('email-queued').textContent = queuedTxt;
  const setQueued = $('set-email-queued'); if (setQueued) setQueued.textContent = queuedTxt;
  // The test button only works once an address is verified — the server
  // 400s otherwise, so disable it here instead of on click.
  const testOk = !!(state.user.email && state.user.emailVerified);
  for (const id of ['btn-test-email', 'btn-set-test-email']) { const b = $(id); if (b) b.disabled = !testOk; }
  // PING FEED · N NEW count in the feed header (the tab badge has it too).
  const unread = state.alerts.filter(a => !a.read).length;
  const feedNew = $('ping-feed-new'); if (feedNew) feedNew.textContent = unread > 0 ? `· ${unread} NEW` : '';
  // BUY pings hint follows the dip / momentum thresholds.
  const buyHint = `Dip: a ticker drops −${s.dipPct}% or more today · Momentum: it rips +${s.momentumPct}% or more`;
  for (const id of ['buy-pings-hint', 'set-buy-pings-hint']) { const el = $(id); if (el) el.textContent = buyHint; }
}
function updateNotifyState() {
  const p = ('Notification' in window) ? Notification.permission : 'unsupported';
  const txt = 'Browser notifications: ' + (p === 'granted' ? 'ON' : p === 'denied' ? 'blocked' : 'prompt — tap Enable browser notifications');
  $('notify-state').textContent = txt;
  const setState = $('set-notify-state'); if (setState) setState.textContent = txt;
}

// ---------- Predictor ----------
// Predictor track record — how past Bullish/Bearish calls actually did.
function renderPredictorTrackRecord() {
  const el = $('pred-track-record'); if (!el || !predictorTrackRecord) return;
  const t = predictorTrackRecord;
  if (!t.total) { el.innerHTML = '<p class="muted">No predictions yet — ask about a ticker above and come back to see how the calls did.</p>'; return; }
  const acc = t.accuracy == null ? '—' : t.accuracy.toFixed(1) + '%';
  el.innerHTML = `<p>Accuracy <b class="${t.accuracy != null && t.accuracy >= 50 ? 'up' : 'down'}">${acc}</b> · <span class="up">${t.correct} right</span> · <span class="down">${t.wrong} wrong</span> · ${t.pending} pending · ${t.unscored} unscored (Neutral/Mixed make no call) · ${t.scored} scored of ${t.total}</p>` +
    (t.items.length ? t.items.map(it => `<div class="trade-row"><span class="chip ${it.outlook === 'Bullish' ? 'buy' : it.outlook === 'Bearish' ? 'sell' : 'check'}">${escapeHtml(it.outlook)}</span> <strong>${escapeHtml(it.symbol)}</strong> · asked at ${money(it.priceAtAsk)} · now ${it.currentPrice != null ? money(it.currentPrice) : '—'} (${it.movePct == null ? '—' : pct(it.movePct)}) · ${escapeHtml(it.timeframe || '')} · ${fmtDT(it.createdAt)} · <b class="${it.result === 'correct' ? 'up' : it.result === 'wrong' ? 'down' : ''}">${String(it.result || '').toUpperCase()}</b></div>`).join('') : '');
}
function renderPredHistory() {
  const el = $('pred-history');
  if (!state.predictorChats.length) { el.innerHTML = '<p class="muted">No predictions yet. Ask your first question above — try NVDA after a big move, it gets spicy.</p>'; return; }
  el.innerHTML = state.predictorChats.map(c => {
    let kp = [], risks = [];
    try { kp = JSON.parse(c.key_points || '[]'); } catch {}
    try { risks = JSON.parse(c.risks || '[]'); } catch {}
    const answer = c.answer || '';
    // Long answers: show the first 900 chars with a "Read more" toggle
    // instead of a hard cut — the full answer is right there behind it.
    const long = answer.length > 900;
    const ansHtml = long
      ? `<p class="pred-answer-short">${escapeHtml(answer.slice(0, 900))}…</p><p class="pred-answer-full hidden">${escapeHtml(answer)}</p><p><button class="btn small" data-readmore>Read more</button></p>`
      : `<p>${escapeHtml(answer)}</p>`;
    return `<div class="pred-card">
      <p><span class="chip ${c.outlook === 'Bullish' ? 'buy' : c.outlook === 'Bearish' ? 'sell' : 'check'}">${escapeHtml(c.outlook)}</span> <strong>${escapeHtml(c.symbol)}</strong> · ${escapeHtml(c.timeframe || '')} · price at ask ${money(c.price_at_ask || 0)} · ${fmtDT(c.created_at)}${c.mode === 'rules' ? ' · <span class="tag amber">RULES</span>' : ''}${c.mode !== 'rules' && c.outlook_source === 'rules' ? ' · <span class="tag amber">RULES OUTLOOK</span>' : ''}</p>
      <p class="muted">“${escapeHtml(c.question)}”</p>
      ${ansHtml}
      <p>CONFIDENCE ${Number(c.confidence) || 0}%</p><div class="conf-bar"><i style="width:${Number(c.confidence) || 0}%"></i></div>
      ${kp.length ? '<p><strong>Key points</strong></p><ul>' + kp.map(k => `<li>${escapeHtml(k)}</li>`).join('') + '</ul>' : ''}
      ${risks.length ? `<p class="muted small">Risks: ${escapeHtml(risks.join('; '))}</p>` : ''}
      <div class="row"><button class="btn small" data-trade-sym="${escapeHtml(c.symbol)}">Trade ${escapeHtml(c.symbol)} →</button></div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-readmore]').forEach(b => b.onclick = () => {
    const card = b.closest('.pred-card'); if (!card) return;
    const short = card.querySelector('.pred-answer-short'), full = card.querySelector('.pred-answer-full');
    if (!short || !full) return;
    const showingFull = full.classList.toggle('hidden');
    short.classList.toggle('hidden', !showingFull);
    b.textContent = showingFull ? 'Read more' : 'Show less';
  });
  el.querySelectorAll('[data-trade-sym]').forEach(b => b.onclick = () => { chartSymbol = b.dataset.tradeSym; $('trade-symbol').value = chartSymbol; gotoTab('trade'); loadChart(); renderWatchlist(); });
}
async function askPredictor() {
  const q = $('pred-q').value.trim();
  if (!q) { $('pred-answer').textContent = 'Ask a question first — or tap one of the suggestion chips.'; return; }
  if (predMode === 'ai' && !state?.user?.isOwner && (state?.predictorRemaining ?? 2) <= 0) {
    $('pred-answer').textContent = 'Daily Predictor limit reached — 2 AI questions a day for standard members. Come back tomorrow. (Rules-only questions are unlimited — tap RULES ONLY above.)';
    return;
  }
  $('pred-answer').innerHTML = '<p class="muted">Asking the Predictor…</p>';
  try {
    const j = await api('/api/predictor', { method: 'POST', body: JSON.stringify({ symbol: chartSymbol, question: q, mode: predMode }) });
    if (j.predictorRemaining != null) state.predictorRemaining = j.predictorRemaining;
    if (j.predictorUsed != null) state.predictorUsed = j.predictorUsed;
    updatePredLimit();
    $('pred-answer').innerHTML = `<div class="pred-card"><p><span class="chip ${j.outlook === 'Bullish' ? 'buy' : j.outlook === 'Bearish' ? 'sell' : 'check'}">${escapeHtml(j.outlook)}</span> <strong>${escapeHtml(chartSymbol)}</strong> · ${escapeHtml(j.timeframe || '')} · price at ask ${money(j.priceAtAsk || 0)}${j.predictorMode === 'rules' ? ' · <span class="tag amber">RULES</span>' : ''}${j.predictorMode !== 'rules' && j.outlookSource === 'rules' ? ' · <span class="tag amber">RULES OUTLOOK</span>' : ''}</p><p>${escapeHtml(j.answer)}</p><p>CONFIDENCE ${Number(j.confidence) || 0}%</p><div class="conf-bar"><i style="width:${Number(j.confidence) || 0}%"></i></div>${(j.keyPoints || []).length ? '<p><strong>Key points</strong></p><ul>' + j.keyPoints.map(k => `<li>${escapeHtml(k)}</li>`).join('') + '</ul>' : ''}${(j.risks || []).length ? `<p class="muted small">Risks: ${escapeHtml(j.risks.join('; '))}</p>` : ''}</div>`;
    state = j.state; renderPredHistory(); updatePredLimit(); loadExtras(true); // track record gains a new (pending) call
  } catch (e) {
    // A 429 means the AI daily limit was hit — the server did not record
    // the ask. Rules-only still works: switch modes and ask again.
    if (/Daily Predictor limit/i.test(e.message) && state) { state.predictorRemaining = 0; updatePredLimit(); }
    $('pred-answer').textContent = 'Predictor failed: ' + e.message;
  }
}

// ---------- AUTO ----------
function fmtCheck(s) { return s >= 300 ? '5m' : s >= 120 ? '2m' : s + 's'; }
function stepperValue(key, dir) {
  const s = state.settings; let v;
  if (key === 'budgetPerBuy') v = Math.min(50000, Math.max(50, (s.budgetPerBuy || 10000) + dir * 250));
  else if (key === 'maxPositions') v = Math.min(12, Math.max(1, (s.maxPositions || 10) + dir));
  else if (key === 'maxTradesPerDay') v = Math.min(20, Math.max(1, (s.maxTradesPerDay || 5) + dir));
  else if (key === 'checkSeconds') { const i = CHECK_STEPS.indexOf(s.checkSeconds || 30); v = CHECK_STEPS[Math.min(CHECK_STEPS.length - 1, Math.max(0, i + dir))]; }
  else if (key === 'dipPct') v = -(Math.min(15, Math.max(1, Math.abs(s.dipPct || 3) + dir)));
  else if (key === 'momentumPct') v = Math.min(15, Math.max(1, (s.momentumPct || 4) + dir));
  return v;
}
function updateSteppers() {
  if (!state) return; const s = state.settings;
  const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  set('step-budgetPerBuy', money(s.budgetPerBuy));
  set('step-maxPositions', s.maxPositions);
  set('step-maxTradesPerDay', s.maxTradesPerDay);
  set('step-checkSeconds', fmtCheck(s.checkSeconds));
  set('step-dipPct', (s.dipPct || -3) + '%');
  set('step-momentumPct', '+' + (s.momentumPct || 4) + '%');
  set('set-step-budgetPerBuy', money(s.budgetPerBuy));
  set('set-step-maxPositions', s.maxPositions);
  set('set-step-maxTradesPerDay', s.maxTradesPerDay);
  set('set-step-checkSeconds', fmtCheck(s.checkSeconds));
  set('set-step-dipPct', (s.dipPct || -3) + '%');
  set('set-step-momentumPct', '+' + (s.momentumPct || 4) + '%');
  // Steppers locked under Credit Saver (any user while it is on)
  const locked = !!s.creditSaver;
  document.querySelectorAll('[data-stepper="maxTradesPerDay"], [data-stepper="checkSeconds"]').forEach(b => b.disabled = locked);
}
function updateAutoUI() {
  if (!state) return; const s = state.settings; const style = STYLES[s.style] || STYLES.day;
  const styleLabel = style.label;
  const lines = `${style.stop}% / +${style.target}%`;
  const setChecked = (id, v) => { const el = $(id); if (el) el.checked = v; };
  setChecked('auto-on', s.autoOn); setChecked('set-auto-on', s.autoOn); setChecked('side-auto', s.autoOn);
  setChecked('auto-sell', s.autoSell !== false); setChecked('set-auto-sell', s.autoSell !== false);
  setChecked('auto-buy-dips', s.buyDips !== false); setChecked('set-auto-buy-dips', s.buyDips !== false);
  setChecked('auto-buy-momentum', s.buyMomentum !== false); setChecked('set-auto-buy-momentum', s.buyMomentum !== false);
  document.querySelectorAll('#style-grid .style-card, #set-style-grid .style-card').forEach(c => c.classList.toggle('active', c.dataset.style === s.style));
  document.querySelectorAll('#mode-picker .btn, #set-mode-picker .btn').forEach(c => c.classList.toggle('active', c.dataset.mode === s.autoMode));
  setChecked('credit-saver', s.creditSaver); setChecked('set-credit-saver', s.creditSaver);
  const saverLocked = !state.user.isOwner;
  for (const id of ['credit-saver', 'set-credit-saver']) { const el = $(id); if (el) el.disabled = saverLocked; }
  const saverStateTxt = state.user.isOwner ? (s.creditSaver ? '· ON' : '· OFF') : '· ALWAYS ON';
  for (const id of ['saver-state', 'set-saver-state']) { const el = $(id); if (el) el.textContent = saverStateTxt; }
  // Credit Saver box — three variants (owner on / owner off / player).
  const saverIntro = state.user.isOwner
    ? (s.creditSaver ? 'On for your account right now — the bundle below applies. As owner you can flip it off above whenever you want (it stays forced on for player accounts either way):' : 'Off on your owner account — full mode: checks run at your CHECK EVERY pace in any session (premarket, after hours, overnight too), up to four signals get researched per check, and your own MAX TRADES cap below applies instead of the saver\'s 2-a-day. Flip it back on above to return to the cheap bundle: 30s rules checks, decider only on a signal, market hours only, max 2 trades a day.')
    : 'Always on for player accounts — it can\'t be switched off, so no auto trader can burn extra AI credits:';
  const saverTail = state.user.isOwner
    ? (s.creditSaver ? 'While it\'s on, the CHECK EVERY and MAX TRADES controls below are locked to the bundle. WHO PICKS THE BUYS below is still your call either way: Verity AI (wakes only on a real signal) or Rules Only (no AI at all, the strongest research score wins).' : 'Player accounts can\'t do this — Credit Saver stays forced on for them. WHO PICKS THE BUYS below is still your call: Verity AI or Rules Only.')
    : 'Credit Saver stays on — the CHECK EVERY and MAX TRADES controls below are locked to the bundle. But WHO PICKS THE BUYS below is still your call: Verity AI (wakes only on a real signal) or Rules Only (no AI at all, the strongest research score wins).';
  for (const [noteId, bulletsId, tailId] of [['saver-note', 'saver-bullets', 'saver-note2'], ['set-saver-note', 'set-saver-bullets', 'set-saver-note2']]) {
    const n = $(noteId); if (n) n.textContent = saverIntro;
    const b = $(bulletsId); if (b) b.classList.toggle('hidden', !s.creditSaver);
    const t = $(tailId); if (t) t.textContent = saverTail;
  }
  // Active style line under the style cards.
  const activeTxt = `Active: ${styleLabel} — holds ${style.hold.toLowerCase()}, auto-sells at ${lines}, and every signal gets researched (news + trend) before a buy.`;
  for (const id of ['auto-active-style', 'set-auto-active-style']) { const el = $(id); if (el) el.textContent = activeTxt; }
  // Toggle hints — auto-sell carries the style's lines; buy hints vary by style.
  const sellHint = `Sell a whole position the moment it hits the ${styleLabel} lines (${lines})`;
  for (const id of ['auto-sell-hint', 'set-auto-sell-hint']) { const el = $(id); if (el) el.textContent = sellHint; }
  const dipsHint = s.style === 'day' ? `Day style: a ticker down −${s.dipPct}% or more today (change the % in Pings)` : s.style === 'scalping' ? 'Scalping style: a ticker dropping fast in the last 15 minutes' : 'Pullbacks inside an uptrend, per the style\'s trend window';
  const momHint = s.style === 'day' ? `Day style: a ticker ripping +${s.momentumPct}% or more today (change the % in Pings)` : s.style === 'scalping' ? 'Scalping style: a ticker bursting up in the last 15 minutes' : 'Breakouts / strength on the style\'s trend window';
  for (const id of ['auto-buy-dips-hint']) { const el = $(id); if (el) el.textContent = dipsHint; }
  for (const id of ['auto-buy-momentum-hint']) { const el = $(id); if (el) el.textContent = momHint; }
  const setDips = $('set-auto-buy-dips-hint'); if (setDips) setDips.textContent = 'Enter on dip signals for the chosen style';
  const setMom = $('set-auto-buy-momentum-hint'); if (setMom) setMom.textContent = 'Enter on momentum signals for the chosen style';
  // WHO PICKS THE BUYS descriptions.
  const aiDesc = s.creditSaver ? 'Credit Saver way: rules check every 30s, the AI wakes only on a signal to pick — or pass and say why' : 'Full mode: on a signal the AI reads the research and picks — or passes and says why';
  for (const id of ['mode-desc-ai', 'set-mode-desc-ai']) { const el = $(id); if (el) el.textContent = aiDesc; }
  for (const id of ['mode-desc-rules', 'set-mode-desc-rules']) { const el = $(id); if (el) el.textContent = 'No AI at all — on a signal, the strongest research score takes the buy'; }
  // Sidebar auto hint + Credit Saver paragraph.
  const sideHint = $('side-auto-toggle-hint'); if (sideHint) sideHint.textContent = s.autoOn ? `Running · ${styleLabel.toLowerCase()} style` : 'Let it trade your rules while the server is awake';
  const sideSaver = $('side-saver-note');
  if (sideSaver) sideSaver.innerHTML = state.user.isOwner
    ? `Credit Saver is <strong>${s.creditSaver ? 'ON' : 'OFF'}</strong> on your owner account — you can flip it in the AUTO tab; it stays forced on for player accounts. The Verity AI / Rules Only decider can be changed in the AUTO tab too. Dip / momentum thresholds, ping rules and full auto-trader controls live in the tabs:`
    : `Credit Saver is <strong>ON</strong> — forced on for player accounts, it can't be turned off; the Verity AI / Rules Only decider can still be changed in the AUTO tab. Dip / momentum thresholds, ping rules and full auto-trader controls live in the tabs:`;
  // RUN A CHECK NOW note.
  const runNote = $('auto-run-note');
  if (runNote) runNote.textContent = `Runs one check instantly, ignoring the timer. Otherwise the auto trader runs on the server around the clock — with the page closed it checks every couple of minutes, and never trades faster than your CHECK EVERY pace above. ${s.creditSaver ? 'Credit Saver is on, so a check outside market hours just reports that it\'s waiting — no trades, no AI.' : 'Credit Saver is off on your owner account, so checks run in any session, extended hours included.'}`;
  // STATUS box — the server's lastAction is the bold line; when auto is
  // off the box says so.
  const last = state.autoLog[0];
  const today = new Date().toISOString().slice(0, 10);
  const tradesToday = state.trades.filter(t => (t.source || '').startsWith('auto') && new Date(t.created_at).toISOString().slice(0, 10) === today).length;
  const modeLabel = s.autoMode === 'ai' ? 'Verity AI' : 'Rules only';
  const lastAction = s.lastAction || (last ? last.message : '');
  const statusHtml = s.autoOn
    ? `<b>${escapeHtml(lastAction || 'Watching…')}</b><br>Server cycle: runs while the server is awake, even with this page closed${s.creditSaver ? ' — market hours only under Credit Saver' : ''}<br>Style: <b>${escapeHtml(s.style)}</b> · lines ${style.stop}% / +${style.target}% · mode ${modeLabel}<br>Credit Saver: <b>${s.creditSaver ? 'ON' : 'OFF'}</b>${saverLocked ? ' (forced for players)' : ''}<br>Last check: <b>${last ? fmtDT(last.created_at) : 'never'}</b><br>Trades used today: <b>${tradesToday} / ${s.maxTradesPerDay}</b> · Positions open: <b>${state.positions.length} / ${s.maxPositions}</b><br>Cash: <b>${money(state.cash)}</b><br>Email: auto-trade emails ${s.emailTrades ? 'ON' : 'OFF'} to ${state.user.emailVerified ? escapeHtml(state.user.email) : 'a verified email (verify in Pings first)'}`
    : `<b>Off — the sim is all yours</b><br>Turn it on and the first check runs right away. Auto trades land in YOUR TRADES on the Trade tab too.`;
  $('auto-status').innerHTML = statusHtml;
  const setStatus = $('set-auto-status');
  if (setStatus) setStatus.innerHTML = s.autoOn
    ? `<b>${escapeHtml(lastAction || 'Watching…')}</b><br>${tradesToday} of ${s.maxTradesPerDay} trades used today · ${state.positions.length} of ${s.maxPositions} positions open · cash ${money(state.cash)} · the activity log lives in the AUTO tab`
    : `<b>Off — the sim is all yours</b><br>Turn it on and the first check runs right away. Auto trades land in YOUR TRADES on the Trade tab too.`;
}
function renderAutoLog() {
  const el = $('auto-log');
  if (!state.autoLog.length) { el.innerHTML = `<p class="muted">${state.settings.autoOn ? 'Watching… the first check lands here in a few seconds.' : 'Nothing yet. Flip auto trading on above and every check, buy and sell the bot makes shows up here with its reason.'}</p>`; return; }
  const chipCls = k => k === 'BUY' ? 'buy' : k === 'SELL' ? 'sell' : k === 'RESEARCH' ? 'research' : k === 'ORDER' ? 'buy' : 'check';
  const chipTxt = k => k === 'BUY' ? 'AUTO BUY' : k === 'SELL' ? 'AUTO SELL' : k === 'RESEARCH' ? 'RESEARCH' : k === 'ORDER' ? 'ORDER FILL' : k === 'HOLD' ? 'HELD' : k === 'PASS' ? 'PASS' : 'CHECKED';
  // The server's messages already carry a title ("RESEARCH — …"), so no
  // kind prefix is needed here.
  el.innerHTML = state.autoLog.map(l => `<div class="log-row"><span class="chip ${chipCls(l.kind)}">${chipTxt(l.kind)}</span> ${escapeHtml(l.message)}<br><span class="muted small">${fmtDT(l.created_at)}${l.shares ? ` · ${l.shares} shares @ ${money(l.price)}` : ''}</span>${l.symbol ? ` <button class="btn small" data-auto-open="${escapeHtml(l.symbol)}">Open ${escapeHtml(l.symbol)} →</button>` : ''}</div>`).join('');
  el.querySelectorAll('[data-auto-open]').forEach(b => b.onclick = () => { chartSymbol = b.dataset.autoOpen; $('trade-symbol').value = chartSymbol; gotoTab('trade'); loadChart(); renderWatchlist(); });
}

// ---------- Settings / sidebar / feedback ----------
function renderSettings() {
  if (!state) return; const s = state.settings;
  const init = (state.user.name || '?')[0].toUpperCase();
  $('settings-profile').innerHTML = `<span class="avatar" style="width:44px;height:44px;border-radius:50%;background:var(--accent);color:#06090a;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:18px">${escapeHtml(init)}</span> <strong>${escapeHtml(state.user.name)}</strong> ${state.user.isOwner ? '<span class="tag green">OWNER</span>' : '<span class="tag">PLAYER</span>'}<div class="stat-grid"><div class="stat"><div class="stat-label">Net Worth</div><div class="stat-val">${money(state.netWorth)}</div></div><div class="stat"><div class="stat-label">Cash</div><div class="stat-val">${money(state.cash)}</div></div><div class="stat"><div class="stat-label">All-time</div><div class="stat-val">${money(state.allTime)}</div></div><div class="stat"><div class="stat-label">Positions</div><div class="stat-val">${state.positions.length}</div></div></div>`;
  const profNote = $('settings-profile-note');
  if (profNote) profNote.textContent = state.user.isOwner ? 'Owner account — reads player feedback; you can switch Credit Saver off for your own account.' : 'Player account — your game, your board, your settings.';
  $('settings-best-run').textContent = state.bestRun > 0 ? 'BEST BANKED RUN: ' + money(state.bestRun) : 'BEST BANKED RUN: — none banked yet';
  // Focus-guarded: the 10-second refresh must not overwrite a starting
  // cash amount the player is in the middle of typing.
  setInputValue('start-cash', s.startCash || 100000);
  syncStartCashUI();
  $('set-live-refresh').checked = s.liveRefresh !== false; $('set-overnight').checked = s.overnightPrices !== false;
  const sideLive = $('side-live-refresh'); if (sideLive) sideLive.checked = s.liveRefresh !== false;
  const sideOver = $('side-overnight'); if (sideOver) sideOver.checked = s.overnightPrices !== false;
  const overHint = s.overnightPrices !== false ? 'Live extended prices outside market hours' : 'Frozen at the 4 PM close outside market hours';
  const sideOverHint = $('side-overnight-hint'); if (sideOverHint) sideOverHint.textContent = overHint;
  const setOverHint = $('set-overnight-hint'); if (setOverHint) setOverHint.textContent = overHint;
  renderThemePickers();
}
// Start-cash button: the label follows the typed amount and the button
// stays disabled while the amount is invalid or equals the current start
// cash (restarting at the same amount would wipe the game for nothing).
function syncStartCashUI() {
  if (!state) return;
  const el = $('start-cash'); const btn = $('btn-apply-startcash'); if (!el || !btn) return;
  const cur = state.settings.startCash || 100000;
  const val = parseFloat(el.value);
  const err = $('startcash-error');
  const note = $('startcash-note');
  const curEl = $('startcash-current');
  if (curEl) curEl.textContent = money(cur);
  const invalid = !(val >= 100 && val <= 10000000);
  if (err) err.classList.toggle('hidden', !invalid);
  if (note) note.textContent = !invalid && val === cur ? "That's the amount you already start at — pick a different one to restart." : '';
  btn.disabled = invalid || val === cur;
  if (document.activeElement !== el) btn.textContent = invalid ? 'RESTART MY GAME AT A NEW AMOUNT' : 'RESTART MY GAME AT ' + money(val);
}
function renderSidebarProfile() {
  const el = $('side-profile'); if (!el || !state) return;
  const init = (state.user.name || '?')[0].toUpperCase();
  el.innerHTML = `<span class="avatar">${escapeHtml(init)}</span><span class="prof-name">${escapeHtml(state.user.name)}</span> ${state.user.isOwner ? '<span class="tag green">OWNER</span>' : '<span class="tag">PLAYER</span>'}<div class="stat-grid"><div class="stat"><div class="stat-label">Net worth</div><div class="stat-val">${money(state.netWorth)}</div></div><div class="stat"><div class="stat-label">Cash</div><div class="stat-val">${money(state.cash)}</div></div><div class="stat"><div class="stat-label">All-time</div><div class="stat-val">${money(state.allTime)}</div></div><div class="stat"><div class="stat-label">Positions</div><div class="stat-val">${state.positions.length}</div></div></div><p class="muted small">BEST BANKED RUN: ${state.bestRun > 0 ? money(state.bestRun) : '— none yet'}</p><p class="muted small">Email: ${state.user.emailVerified ? 'VERIFIED ✓ ' + escapeHtml(state.user.email) : state.user.pendingEmail ? 'Pending: ' + escapeHtml(state.user.pendingEmail) : 'Not set up'} — <a href="#" id="side-email-link">${state.user.emailVerified ? 'Change my email' : state.user.pendingEmail ? 'Verify my email' : 'Set up my email'}</a></p>`;
  const link = $('side-email-link'); if (link) link.onclick = e => { e.preventDefault(); gotoTab('pings'); };
}
function renderFeedbackInbox() {
  const render = (el, withClear) => {
    if (!el) return;
    if (!state?.user.isOwner) { el.innerHTML = ''; return; }
    const fb = state.feedback || [];
    el.innerHTML = '<h3>Feedback inbox (owner only)</h3>' + (fb.length ? fb.map(f => `<div class="log-row"><strong>${escapeHtml(f.name)}</strong> <span class="muted">${fmtDT(f.created_at)}</span><br>${escapeHtml(f.message)} <button class="btn small" data-fbdel="${escapeHtml(f.id)}">Delete</button></div>`).join('') + (withClear ? '<div class="row"><button id="btn-clear-feedback" class="btn small">Clear all feedback</button></div>' : '') : '<p class="muted">No feedback yet.</p>');
    el.querySelectorAll('[data-fbdel]').forEach(b => b.onclick = async () => { await api('/api/feedback/' + b.dataset.fbdel, { method: 'DELETE' }); await loadState(); });
    const clr = $('btn-clear-feedback'); if (clr) clr.onclick = async () => { await api('/api/feedback/clear', { method: 'POST' }); await loadState(); };
  };
  render($('feedback-inbox'), true); render($('side-feedback-inbox'), false);
}
function renderDeleteRow() {
  const el = $('delete-row'); if (!el || !state) return;
  if (state.user.isOwner) el.innerHTML = `<button class="btn danger" disabled>Delete my account</button><p class="muted small">The owner account can't be deleted — it runs the feedback inbox and player list for everyone else.</p>`;
  else el.innerHTML = `<button id="btn-delete-acc" class="btn danger">Delete my account — gone for good</button><p class="muted small">You'll be asked for your PIN. Everything you own is wiped and you disappear from the sign-in page.</p>`;
  const b = $('btn-delete-acc'); if (b) b.onclick = () => { const nm = $('delete-modal-name'); if (nm) nm.textContent = state.user.name; $('delete-modal').classList.remove('hidden'); };
}
async function saveSettings(patch) {
  const j = await api('/api/settings', { method: 'POST', body: JSON.stringify(patch) });
  if (j.creditSaverForced) banner('Credit Saver is owner-only — it was forced back ON for your account.');
  await loadState(); return j;
}
async function refreshAll() { await loadQuotes(); await loadState().catch(() => {}); if (Date.now() - lastNewsLoad > 60000) await loadNews(); }
function openSidebar() { $('sidebar').classList.add('open'); $('sidebar-overlay').classList.remove('hidden'); }
function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebar-overlay').classList.add('hidden'); }
function gotoTab(name) {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
  document.querySelectorAll('.tabpage').forEach(p => p.classList.add('hidden'));
  $('tab-' + name).classList.remove('hidden'); closeSidebar();
  if (name === 'trade' && Date.now() - lastNewsLoad > 60000) loadNews();
  if (name === 'chat') { renderChatFilters(); loadChat(); }
  if (name === 'stats') { drawPortfolioChart(); loadCoach(); } // canvas was hidden — redraw at real width
  if (name === 'leagues') loadLeagues();
}
function showWelcome() { $('welcome-screen').classList.remove('hidden'); $('auth-screen').classList.add('hidden'); const back = $('btn-welcome-back'); if (back) back.classList.toggle('hidden', !token); if (token) loadExtras(true); }
function showAuth(mode) {
  authMode = mode || authMode;
  $('welcome-screen').classList.add('hidden'); $('auth-screen').classList.remove('hidden');
  $('auth-mode-signin').classList.toggle('active', authMode === 'signin');
  $('auth-mode-new').classList.toggle('active', authMode === 'new');
  $('auth-email-wrap').classList.toggle('hidden', authMode === 'signin');
  $('auth-startcash-wrap').classList.toggle('hidden', authMode === 'signin');
  $('auth-claimcode-wrap').classList.toggle('hidden', authMode === 'signin');
  $('btn-auth-go').textContent = authMode === 'signin' ? 'SIGN IN' : 'CREATE MY ACCOUNT';
  const nameLbl = $('auth-name-label'); if (nameLbl) nameLbl.textContent = authMode === 'new' ? 'PICK YOUR PLAYER NAME' : 'YOUR PLAYER NAME';
  const pinLbl = $('auth-pin-label'); if (pinLbl) pinLbl.textContent = authMode === 'new' ? 'SET A PIN (6+ CHARACTERS)' : 'YOUR PIN';
}
function enterApp() {
  $('welcome-screen').classList.add('hidden'); $('auth-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('app-loading').classList.remove('hidden'); $('app-error').classList.add('hidden');
  startRefresh();
}
function startRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => { await loadQuotes(); await loadState().catch(() => {}); if (Date.now() - lastNewsLoad > 60000) loadNews(); }, 10000);
  if (newsTimer) clearInterval(newsTimer);
  newsTimer = setInterval(() => { if (!$('tab-trade').classList.contains('hidden')) loadNews(); }, 60000);
  // Stock chat polls every 15 s, but only while the CHAT tab is open.
  if (chatTimer) clearInterval(chatTimer);
  chatTimer = setInterval(() => { if (!$('tab-chat').classList.contains('hidden')) loadChat(); }, 15000);
}

// ---------- Static bindings ----------
document.querySelectorAll('.tab').forEach(b => b.onclick = () => gotoTab(b.dataset.tab));
document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => gotoTab(b.dataset.goto));
document.querySelectorAll('#range-btns button').forEach(b => b.onclick = () => { document.querySelectorAll('#range-btns button').forEach(x => x.classList.remove('active')); b.classList.add('active'); chartRange = b.dataset.range; loadChart(); });
$('chart-line').onclick = () => { chartMode = 'line'; $('chart-line').classList.add('active'); $('chart-candles').classList.remove('active'); drawChart(); };
$('chart-candles').onclick = () => { chartMode = 'candles'; $('chart-candles').classList.add('active'); $('chart-line').classList.remove('active'); drawChart(); };
$('chart-ma20').onclick = () => { showMA20 = !showMA20; $('chart-ma20').classList.toggle('active', showMA20); drawChart(); };
$('btn-menu').onclick = openSidebar; $('btn-close-sidebar').onclick = closeSidebar; $('sidebar-overlay').onclick = closeSidebar;
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSidebar(); $('reset-modal').classList.add('hidden'); $('delete-modal').classList.add('hidden'); $('startcash-modal').classList.add('hidden'); } });
// Welcome
$('btn-welcome-create').onclick = () => { localStorage.setItem('verityinvest-welcomed', '1'); showAuth('new'); };
$('btn-welcome-create2').onclick = () => { localStorage.setItem('verityinvest-welcomed', '1'); showAuth('new'); };
$('btn-welcome-signin').onclick = () => { localStorage.setItem('verityinvest-welcomed', '1'); showAuth('signin'); };
$('btn-welcome-signin2').onclick = () => { localStorage.setItem('verityinvest-welcomed', '1'); showAuth('signin'); };
$('btn-back-welcome').onclick = showWelcome;
$('btn-welcome-back').onclick = () => $('welcome-screen').classList.add('hidden'); // back to the app
$('btn-footer-what').onclick = showWelcome;
// Auth mode toggle
$('auth-mode-signin').onclick = () => showAuth('signin');
$('auth-mode-new').onclick = () => showAuth('new');
// Trade
$('trade-symbol').onchange = e => { chartSymbol = e.target.value; updateTradeEstimates(); loadChart(); renderPredChips(); };
$('trade-side-buy').onclick = () => { tradeSide = 'buy'; updateTradeEstimates(); };
$('trade-side-sell').onclick = () => { tradeSide = 'sell'; updateTradeEstimates(); };
$('trade-shares').oninput = updateTradeEstimates;
$('btn-trade-submit').onclick = doTrade;
$('order-side-buy').onclick = () => { orderSide = 'buy'; $('order-side-buy').classList.add('active'); $('order-side-sell').classList.remove('active'); };
$('order-side-sell').onclick = () => { orderSide = 'sell'; $('order-side-sell').classList.add('active'); $('order-side-buy').classList.remove('active'); };
$('btn-place-order').onclick = placeOrder;
const _wlSearch = $('wl-search'); if (_wlSearch) _wlSearch.addEventListener('input', () => { wlSearch = _wlSearch.value.trim(); renderWatchlist(); });
const _wlSort = $('wl-sort'); if (_wlSort) _wlSort.addEventListener('change', () => { wlSort = _wlSort.value; renderWatchlist(); });
$('link-ask-predictor').onclick = e => { e.preventDefault(); gotoTab('predictor'); };
$('btn-refresh').onclick = async () => { await loadQuotes(); await loadState(); await loadNews(); };
$('custom-kind').onchange = () => $('custom-crypto-note').classList.toggle('hidden', $('custom-kind').value !== 'crypto');
$('btn-add-custom').onclick = async () => {
  try { const j = await api('/api/custom-symbols', { method: 'POST', body: JSON.stringify({ symbol: $('custom-symbol').value, kind: $('custom-kind').value }) }); $('custom-msg').textContent = `Added ${j.symbol} (${j.name}) at live $${j.price}`; state = j.state; fillSymbolSelects(); await loadState(); await loadQuotes(); }
  catch (e) { $('custom-msg').textContent = 'Add failed: ' + e.message; }
};
$('btn-news-refresh').onclick = loadNews;
// Stock chat
$('btn-chat-send').onclick = postChat;
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') postChat(); });
// Predictor
document.querySelectorAll('.sugg-chip').forEach(c => c.onclick = () => { $('pred-q').value = c.dataset.q; });
$('btn-ask').onclick = askPredictor;
// Predictor mode picker: Verity AI (2/day for standard members) vs
// Rules only (unlimited). Switching to Rules only re-enables ASK even
// when the AI limit is hit.
const _setPredMode = m => { predMode = m; updatePredLimit(); applyServerConfigBadges(); };
const _pmAi = $('pred-mode-ai'); if (_pmAi) _pmAi.onclick = () => _setPredMode('ai');
const _pmRu = $('pred-mode-rules'); if (_pmRu) _pmRu.onclick = () => _setPredMode('rules');
$('btn-clear-pred').onclick = async () => { await api('/api/predictor', { method: 'DELETE' }); $('pred-history').innerHTML = ''; $('pred-answer').innerHTML = ''; await loadState(); };
// Steppers (all tabs share the same handler)
document.querySelectorAll('[data-stepper]').forEach(b => b.onclick = async () => {
  if (b.disabled) return;
  const key = b.dataset.stepper, dir = +b.dataset.dir;
  const v = stepperValue(key, dir);
  await saveSettings({ [key]: v });
});
// Toggle bindings — every toggle saves immediately and affects behavior
const TOGGLE_MAP = {
  'pings-on': 'pingsOn', 'buy-pings': 'buyPings',
  'sell-pings': 'sellPings', 'stop-target-pings': 'stopTargetPings',
  'sound-on': 'soundOn', 'email-pings': 'emailPings',
  'email-trades': 'emailTrades', 'auto-on': 'autoOn',
  'auto-sell': 'autoSell', 'auto-buy-dips': 'buyDips',
  'auto-buy-momentum': 'buyMomentum', 'credit-saver': 'creditSaver',
  'set-live-refresh': 'liveRefresh', 'set-overnight': 'overnightPrices',
  // Sidebar quick settings + Settings-tab mirrors share the same keys —
  // the generic binding below wires every checkbox on the page.
  'side-live-refresh': 'liveRefresh', 'side-overnight': 'overnightPrices',
  'side-pings': 'pingsOn', 'side-sound': 'soundOn',
  'side-email-pings': 'emailPings', 'side-email-trades': 'emailTrades',
  'side-auto': 'autoOn',
  'set-pings-on': 'pingsOn', 'set-buy-pings': 'buyPings',
  'set-sell-pings': 'sellPings', 'set-stop-target-pings': 'stopTargetPings',
  'set-sound-on': 'soundOn', 'set-email-pings': 'emailPings',
  'set-email-trades': 'emailTrades', 'set-auto-on': 'autoOn',
  'set-auto-sell': 'autoSell', 'set-auto-buy-dips': 'buyDips',
  'set-auto-buy-momentum': 'buyMomentum', 'set-credit-saver': 'creditSaver',
};
for (const [id, key] of Object.entries(TOGGLE_MAP)) { const el = $(id); if (el) el.onchange = () => saveSettings({ [key]: el.checked }); }
// Style + mode pickers (AUTO tab + the Settings-tab mirrors — same keys).
document.querySelectorAll('#style-grid .style-card, #set-style-grid .style-card').forEach(c => c.onclick = () => saveSettings({ style: c.dataset.style }));
document.querySelectorAll('#mode-picker .btn, #set-mode-picker .btn').forEach(c => c.onclick = () => saveSettings({ autoMode: c.dataset.mode }));
async function requestNotify() { if (!('Notification' in window)) { banner('This browser does not support notifications'); return; } await Notification.requestPermission(); saveSettings({ browserNotify: Notification.permission === 'granted' }); updateNotifyState(); banner('Browser notifications: ' + Notification.permission); }
$('btn-notify').onclick = requestNotify; $('btn-side-notify').onclick = requestNotify; $('btn-set-notify').onclick = requestNotify;
// Pings feed actions
$('btn-mark-read').onclick = async () => { await api('/api/alerts/read', { method: 'POST' }); bannerAlertId = null; await loadState(); };
$('btn-clear-pings').onclick = async () => { const j = await api('/api/alerts/clear', { method: 'POST' }); state = j.state; bannerAlertId = null; await loadState(); };
// Email verification
async function sendCode(email, msgEl, verifyBlock) {
  try { const j = await api('/api/email/send-code', { method: 'POST', body: JSON.stringify({ email }) }); $(msgEl).textContent = 'Code sent to ' + j.email + ' — it expires in 10 minutes.'; if (verifyBlock) $(verifyBlock).classList.remove('hidden'); await loadState(); }
  catch (e) { $(msgEl).textContent = 'Code not sent: ' + e.message; }
}
$('btn-send-code').onclick = () => sendCode($('notify-email').value, 'email-msg', 'email-verify-block');
$('btn-resend-email').onclick = () => sendCode($('notify-email').value, 'email-msg', 'email-verify-block');
$('btn-set-send-code').onclick = () => sendCode($('set-notify-email').value, 'set-email-msg', 'set-email-verify-block');
$('btn-set-resend-email').onclick = () => sendCode($('set-notify-email').value, 'set-email-msg', 'set-email-verify-block');
async function verifyCode(code, msgEl) {
  try { const j = await api('/api/email/verify-code', { method: 'POST', body: JSON.stringify({ code }) }); state = j.state; await loadState(); $(msgEl).textContent = 'VERIFIED ✓ ' + j.email; banner('Email verified'); return true; }
  catch (e) { $(msgEl).textContent = 'Verify failed: ' + e.message; return false; }
}
$('btn-verify-email').onclick = () => verifyCode($('email-verify-code').value, 'email-msg');
$('btn-set-verify-email').onclick = () => verifyCode($('set-email-verify-code').value, 'set-email-msg');
async function testEmail(msgEl) {
  try { const j = await api('/api/email/test', { method: 'POST' }); $(msgEl).textContent = j.sent ? 'Test email sent — check your inbox.' : 'Test email not sent: ' + (j.reason || 'unknown'); }
  catch (e) { $(msgEl).textContent = 'Test email failed: ' + e.message; }
}
$('btn-test-email').onclick = () => testEmail('email-msg');
$('btn-set-test-email').onclick = () => testEmail('set-email-msg');
async function clearEmail(msgEl) {
  try { const j = await api('/api/email/clear', { method: 'POST' }); state = j.state; await loadState(); $(msgEl).textContent = 'Email cleared.'; }
  catch (e) { $(msgEl).textContent = 'Clear failed: ' + e.message; }
}
$('btn-clear-email').onclick = () => clearEmail('email-msg');
$('btn-set-clear-email').onclick = () => clearEmail('set-email-msg');
// AUTO actions
async function runNow() { const j = await api('/api/auto/run', { method: 'POST' }); state = j.state; await loadState(); banner('Check ran: ' + (j.action || '')); }
$('btn-run-now').onclick = runNow;
$('btn-set-run-now').onclick = runNow;
$('btn-clear-auto-log').onclick = async () => { const j = await api('/api/auto-log', { method: 'DELETE' }); state = j.state; await loadState(); banner('Auto log cleared'); };
// Starting cash
document.querySelectorAll('.sc-preset').forEach(b => b.onclick = () => { $('start-cash').value = b.dataset.startcash; syncStartCashUI(); });
$('start-cash').oninput = syncStartCashUI;
$('btn-apply-startcash').onclick = () => {
  const val = +$('start-cash').value || 0;
  if (!(val >= 100 && val <= 10000000)) { $('startcash-msg').textContent = 'Pick an amount between $100 and $10,000,000.'; return; }
  $('startcash-modal-title').textContent = 'START OVER AT ' + money(val) + '?';
  $('startcash-modal-body').textContent = `Your starting cash changes from ${money(state?.settings?.startCash || 100000)} to ${money(val)} and your game restarts fresh at that amount:`;
  $('startcash-modal').classList.remove('hidden');
};
$('btn-cancel-startcash').onclick = () => $('startcash-modal').classList.add('hidden');
$('btn-confirm-startcash').onclick = async () => {
  try { const j = await api('/api/settings/start-cash', { method: 'POST', body: JSON.stringify({ amount: +$('start-cash').value }) }); $('startcash-modal').classList.add('hidden'); state = j.state; await loadState(); await loadQuotes(); $('startcash-msg').textContent = 'Game restarted fresh at ' + money(j.startCash); banner('Starting cash set to ' + money(j.startCash)); }
  catch (e) { $('startcash-msg').textContent = 'Failed: ' + e.message; }
};
// Feedback
async function sendFeedback(textEl, msgEl) {
  try { await api('/api/feedback', { method: 'POST', body: JSON.stringify({ message: $(textEl).value }) }); $(textEl).value = ''; $(msgEl).textContent = 'Feedback sent to Lucas — thanks!'; if (state?.user.isOwner) await loadState(); }
  catch (e) { $(msgEl).textContent = 'Feedback failed: ' + e.message; }
}
$('btn-side-feedback').onclick = () => sendFeedback('side-feedback', 'side-feedback-msg');
$('btn-set-feedback').onclick = () => sendFeedback('set-feedback', 'set-feedback-msg');
// Reset / delete / sign out
function openReset() { const b = $('reset-modal-body'); if (b && state) b.textContent = `This wipes YOUR whole game and starts you over at ${money(state.settings.startCash || 100000)} paper cash (your starting amount — change it in Settings):`; $('reset-modal').classList.remove('hidden'); }
$('btn-reset2').onclick = openReset;
$('btn-footer-reset').onclick = openReset;
$('btn-side-reset').onclick = () => { closeSidebar(); openReset(); };
$('btn-side-what').onclick = () => { closeSidebar(); showWelcome(); };
$('btn-cancel-reset').onclick = () => $('reset-modal').classList.add('hidden');
$('btn-confirm-reset').onclick = async () => { await api('/api/reset', { method: 'POST', body: JSON.stringify({ confirm: true }) }); $('reset-modal').classList.add('hidden'); banner('Reset complete.'); await refreshAll(); loadExtras(true); };
$('btn-cancel-delete').onclick = () => $('delete-modal').classList.add('hidden');
$('btn-confirm-delete').onclick = async () => {
  try { await api('/api/account/delete', { method: 'POST', body: JSON.stringify({ pin: $('delete-pin').value }) }); token = ''; localStorage.removeItem('verityinvest-token'); location.reload(); }
  catch (e) { $('delete-msg').textContent = e.message; }
};
async function doLogout() { try { await api('/api/auth/logout', { method: 'POST' }); } catch {} token = ''; localStorage.removeItem('verityinvest-token'); location.reload(); }
$('btn-side-signout').onclick = doLogout;
$('btn-live-toggle').onclick = async () => { if (!state) return; await saveSettings({ liveRefresh: !(state.settings.liveRefresh !== false) }); if (state.settings.liveRefresh !== false) await loadQuotes(); };
// Sidebar shortcuts
$('btn-side-ping-rules').onclick = () => gotoTab('pings');
$('btn-side-auto-controls').onclick = () => gotoTab('auto');
$('side-own-picks').onclick = () => gotoTab('trade');
// Auth
async function tryAuth(path, body) {
  $('auth-error').textContent = '';
  try {
    const j = await api(path, { method: 'POST', body: JSON.stringify(body) });
    if (j.needsClaim || !j.token) {
      // PIN-less account: claim-only, no auto sign-in. Stay on auth so the
      // player can tap their name and choose SET PIN & CLAIM IT.
      saveDeviceAccount(body.name); // created on this device — show it here
      $('auth-error').textContent = '';
      $('verify-block').classList.add('hidden');
      await loadPlayers();
      $('auth-error').textContent = (body.name || 'That account') + ' was created with no PIN yet — tap your name above and choose SET PIN & CLAIM IT.';
      return;
    }
    token = j.token; localStorage.setItem('verityinvest-token', token);
    saveDeviceAccount(body.name); // signed in on this device — show it here
    if (path.includes('register') && j.needsVerification) {
      if (j.codeSent) {
        $('verify-email-label').textContent = body.email; $('verify-block').classList.remove('hidden');
        $('verify-code').classList.remove('hidden'); $('btn-verify').classList.remove('hidden'); $('btn-resend').classList.remove('hidden');
        $('btn-skip-verify').textContent = 'SKIP — VERIFY LATER IN PINGS';
        $('verify-msg').textContent = 'Code sent — enter it to verify your email, or skip for now.';
      } else {
        // No code can ever arrive here (e.g. SMTP not set up on this server):
        // do NOT trap the player on a verify panel with a VERIFY button that
        // can never work. Save is already done server-side — just start playing.
        $('verify-email-label').textContent = body.email; $('verify-block').classList.remove('hidden');
        $('verify-code').classList.add('hidden'); $('btn-verify').classList.add('hidden'); $('btn-resend').classList.add('hidden');
        $('btn-skip-verify').textContent = 'START PLAYING — VERIFY EMAIL LATER';
        $('verify-msg').textContent = 'Your email was saved, but no code was sent: ' + (j.codeError || 'email is not set up on this server') + ' — verify it later in Pings once the owner adds email settings.';
      }
      return; // stay on the verify panel until VERIFY & START PLAYING or SKIP
    }
    enterApp();
    try { await refreshAll(); $('app-loading').classList.add('hidden'); } catch (e) { $('app-loading').classList.add('hidden'); $('app-error').classList.remove('hidden'); }
  } catch (e) { $('auth-error').textContent = e.message; }
}
$('btn-auth-go').onclick = () => {
  const name = $('auth-name').value.trim();
  // Client-side checks first — the server re-checks, but these messages
  // tell the player what to fix before a round trip.
  if (name.length < 2) { $('auth-error').textContent = 'Pick a name with at least 2 characters.'; return; }
  if (name.length > 30) { $('auth-error').textContent = 'Keep your name to 30 characters or fewer.'; return; }
  if ($('auth-pin').value.length < 6) { $('auth-error').textContent = 'Your PIN needs at least 6 characters.'; return; }
  if (authMode === 'new') {
    const sc = Number($('auth-startcash').value) || 0;
    if (!(sc >= 100 && sc <= 10000000)) { $('auth-error').textContent = 'Starting cash must be between $100 and $10,000,000.'; return; }
    tryAuth('/api/auth/register', { name, pin: $('auth-pin').value, email: $('auth-email').value, startCash: sc, claimCode: $('auth-claim-code')?.value || '' });
  } else tryAuth('/api/auth/login', { name, pin: $('auth-pin').value });
};
document.querySelectorAll('.auth-cash-preset').forEach(b => b.onclick = () => { $('auth-startcash').value = b.dataset.authcash; });
$('btn-verify').onclick = async () => { if (await verifyCode($('verify-code').value, 'verify-msg')) { enterApp(); try { await refreshAll(); $('app-loading').classList.add('hidden'); } catch {} } };
$('btn-resend').onclick = () => sendCode($('auth-email').value, 'verify-msg', null);
$('btn-skip-verify').onclick = () => { enterApp(); refreshAll().then(() => $('app-loading').classList.add('hidden')).catch(() => {}); };
$('btn-retry-app').onclick = async () => { $('app-error').classList.add('hidden'); $('app-loading').classList.remove('hidden'); try { await refreshAll(); $('app-loading').classList.add('hidden'); } catch { $('app-loading').classList.add('hidden'); $('app-error').classList.remove('hidden'); } };
$('btn-claim').onclick = async () => {
  try {
    const j = await api('/api/auth/claim', { method: 'POST', body: JSON.stringify({ name: claimName, pin: $('claim-pin').value, claimCode: $('claim-code')?.value || '' }) });
    token = j.token; localStorage.setItem('verityinvest-token', token);
    saveDeviceAccount(claimName); // claimed on this device — show it here
    $('claim-block').classList.add('hidden'); enterApp();
    try { await refreshAll(); $('app-loading').classList.add('hidden'); } catch {}
  } catch (e) { $('claim-msg').textContent = e.message; }
};
$('btn-claim-cancel').onclick = () => $('claim-block').classList.add('hidden');
async function loadPlayers() {
  try {
    const j = await api('/api/session');
    const el = $('player-list');
    const device = getDeviceAccounts();
    // Default: only accounts used on this device. "Show all players" is
    // the escape hatch for a brand-new device or an account made elsewhere.
    const visible = showAllPlayers ? j.players : j.players.filter(p => device.some(d => d.toLowerCase() === p.name.toLowerCase()));
    const heading = showAllPlayers
      ? '<p class="muted small">ALL PLAYERS — tap one to fill in the name:</p>'
      : device.length
        ? '<p class="muted small">ACCOUNTS ON THIS DEVICE — tap one to fill in the name:</p>'
        : '<p class="muted small">No accounts saved on this device yet — type your name + PIN below, or tap Show all players to pick one.</p>';
    const toggleLabel = showAllPlayers ? 'Show only this device' : 'Show all players';
    el.innerHTML = heading + (visible.length
      ? visible.map(p => `<span class="player-chip ${p.has_pin ? '' : 'claim'}" data-name="${escapeHtml(p.name)}" data-haspin="${p.has_pin}">${escapeHtml(p.name)} · ${p.is_owner ? 'OWNER' : p.has_pin ? 'PLAYER' : 'NO PIN YET'}${!showAllPlayers ? ` <button class="chip-x" data-forget="${escapeHtml(p.name)}" title="Forget this account on this device">×</button>` : ''}</span>`).join('')
      : (device.length || showAllPlayers ? '<p class="muted">No players yet — be the first.</p>' : ''))
      + (showAllPlayers ? '' : '<p class="muted small">Only accounts used on this device are listed — the × forgets one here (the account itself stays). Accounts are never deleted by this.</p>')
      + `<p><button class="btn small" id="btn-toggle-players">${toggleLabel}</button></p>`;
    const tg = $('btn-toggle-players');
    if (tg) tg.onclick = () => { showAllPlayers = !showAllPlayers; loadPlayers(); };
    el.querySelectorAll('[data-forget]').forEach(b => b.onclick = e => { e.stopPropagation(); removeDeviceAccount(b.dataset.forget); });
    el.querySelectorAll('.player-chip').forEach(c => c.onclick = () => {
      $('auth-name').value = c.dataset.name;
      if (c.dataset.haspin === '0') {
        claimName = c.dataset.name; $('claim-name').textContent = claimName;
        $('claim-block').classList.remove('hidden'); $('claim-pin').focus();
      } else { $('claim-block').classList.add('hidden'); showAuth('signin'); $('auth-pin').focus(); }
    });
  } catch { $('player-list').innerHTML = '<p class="muted">LOADING PLAYERS… (couldn\'t reach the game — it will retry)</p>'; }
}
// Discord invite — the URL lives on the server (DISCORD_INVITE_URL env),
// never hard-coded here. While it is empty the buttons read "coming soon"
// and link nowhere; once set they open the real invite in a new tab.
function applyDiscordLinks(url) {
  for (const id of ['discord-welcome', 'discord-sidebar', 'discord-footer']) {
    const el = $(id); if (!el) continue;
    if (url) { el.href = url; el.target = '_blank'; el.rel = 'noopener'; el.removeAttribute('aria-disabled'); el.textContent = 'JOIN OUR DISCORD ↗'; }
    else { el.removeAttribute('href'); el.removeAttribute('target'); el.setAttribute('aria-disabled', 'true'); el.textContent = 'DISCORD — COMING SOON'; }
  }
}
async function loadConfig() {
  try {
    const r = await fetch('/api/config'); const j = await r.json();
    serverConfig = { smtpConfigured: j.smtpConfigured !== false, aiConfigured: !!j.aiConfigured };
    applyDiscordLinks(j.discordInviteUrl || '');
    applyDonateLinks(j.donateUrl || '');
    applyServerConfigBadges();
  } catch { applyDiscordLinks(''); }
}
// Banners/badges driven by the server's capability flags:
// - email not configured => banner above the SEND CODE buttons (Pings +
//   Settings) so players know upfront that no email can send.
// - no AI key => "Rules-only mode — no AI key" badge on AUTO + Predictor.
function applyServerConfigBadges() {
  const smtpOff = serverConfig.smtpConfigured === false;
  for (const id of ['email-not-configured', 'set-email-not-configured']) {
    const el = $(id); if (el) el.classList.toggle('hidden', !smtpOff);
  }
  // The "Rules-only mode" badge shows whenever Rules Only is selected —
  // the AI key doesn't matter: rules mode means no AI is used either way.
  const autoBadge = $('auto-ai-badge'); if (autoBadge) autoBadge.classList.toggle('hidden', state?.settings?.autoMode !== 'rules');
  const predBadge = $('pred-ai-badge'); if (predBadge) predBadge.classList.toggle('hidden', predMode !== 'rules');
}
// Welcome board
(function renderWelcomeBoard() {
  const el = $('welcome-board'); if (!el) return;
  el.innerHTML = CORE.map(s => `<div><b>${escapeHtml(s)}</b><span>${escapeHtml(NAME_MAP[s])}</span></div>`).join('');
})();
// Boot — SECURITY: never auto-sign-in on load/reload. A stored token or
// cookie must not open the owner account with no PIN. If a token is left
// over from an earlier session, delete that server session, drop the
// token, and always ask for name + PIN.
(async () => {
  applyTheme(localStorage.getItem('verityinvest-theme') || 'terminal');
  renderThemePickers();
  await loadConfig();
  if (!localStorage.getItem('verityinvest-welcomed')) showWelcome(); else $('welcome-screen').classList.add('hidden');
  if (token) {
    try { await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }); } catch {}
    token = ''; localStorage.removeItem('verityinvest-token');
  }
  await loadPlayers();
  if (localStorage.getItem('verityinvest-welcomed')) showAuth('signin');
  // PWA: register the service worker (app-shell cache only, never API).
  // Guarded — if registration fails or the browser has no SW support, the
  // app just runs without offline caching.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }
})();
