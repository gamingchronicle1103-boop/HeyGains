// HeyGains frontend — vanilla JS, no build step.
const CORE = ['NVDA', 'TSLA', 'AMD', 'META', 'AMZN', 'GOOGL', 'MSFT', 'INTC', 'TTWO', 'DUOL', 'FANG', 'MCD'];
const NAME_MAP = { NVDA: 'NVIDIA', TSLA: 'Tesla', AMD: 'Adv. Micro Devices', META: 'Meta Platforms', AMZN: 'Amazon', GOOGL: 'Alphabet', MSFT: 'Microsoft', INTC: 'Intel', TTWO: 'Take-Two Interactive', DUOL: 'Duolingo', FANG: 'Diamondback Energy', MCD: "McDonald's" };
const THEMES = { terminal: '#2bff88', purple: '#b388ff', ice: '#38bdf8', gold: '#ffb02e', pink: '#ff5da2' };
const CHECK_STEPS = [30, 60, 120, 300];
const STYLES = { scalping: { stop: -2, target: 3 }, day: { stop: -5, target: 10 }, swing: { stop: -8, target: 20 }, position: { stop: -12, target: 30 } };
const SUGGESTIONS = [];
// Migrate legacy localStorage keys to the verityinvest-* keys.
for (const [oldK, newK] of [['hg_token', 'verityinvest-token'], ['hg_theme', 'verityinvest-theme'], ['hg_welcome_seen', 'verityinvest-welcomed']]) {
  const v = localStorage.getItem(oldK); if (v && !localStorage.getItem(newK)) localStorage.setItem(newK, v);
}
let token = localStorage.getItem('verityinvest-token') || '';
let state = null, quotes = {}, chartData = null, chartMode = 'line', chartRange = '1D', chartSymbol = 'NVDA', showMA20 = false;
let tradeSide = 'buy', orderSide = 'buy', lastChartLoad = 0, lastNewsLoad = 0, refreshTimer = null, newsTimer = null;
let notifiedIds = new Set(), prevPrices = {}, bannerAlertId = null, authMode = 'signin', claimName = '';
let wlSearch = '', wlSort = 'default', tradeInFlight = false;
let leaderboardData = null, portfolioHistory = null, achievementsData = null, predictorTrackRecord = null, lastExtrasLoad = 0;
let chatMessages = [], chatFilter = 'ALL', chatTimer = null;
// Escape ALL user/server-controlled text before innerHTML injection.
// Use for names, messages, predictor text, news, symbols, emails, etc.
// App-generated HTML (chips/buttons) is built from literal templates, not from this.
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function safeUrl(u) { try { const p = new URL(String(u || ''), location.origin); return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : '#'; } catch { return '#'; } }
const $ = id => document.getElementById(id);
const money = n => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const pct = (n, s = false) => (n >= 0 ? '+' : '') + Number(n || 0).toFixed(2) + '%';
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
  for (const id of ['theme-picker', 'set-theme-picker']) {
    const el = $(id); if (!el) continue; el.innerHTML = '';
    for (const [name, color] of Object.entries(THEMES)) {
      const d = document.createElement('button'); d.className = 'theme-dot' + (name === cur ? ' active' : ''); d.style.background = color; d.title = name; d.setAttribute('aria-label', name + ' theme');
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
  $('user-line').textContent = 'Playing as ' + state.user.name + (state.user.isOwner ? ' · OWNER' : '');
  $('net-worth-big').textContent = money(state.netWorth);
  $('net-worth-sub').innerHTML = `All-time <b class="${state.allTime >= 0 ? 'up' : 'down'}">${state.allTime >= 0 ? '+' : ''}${money(state.allTime)} (${pct(state.allTimePct)})</b> · Best worth <b>${money(state.bestWorth || state.netWorth)}</b>`;
  $('score-cash').textContent = money(state.cash);
  $('score-cash-sub').textContent = 'Available to trade';
  $('score-today').textContent = (state.todayChange >= 0 ? '+' : '') + money(state.todayChange);
  $('score-today').className = 'score-val ' + (state.todayChange >= 0 ? 'up' : 'down');
  $('score-today-sub').textContent = pct(state.todayPct) + ' today on holdings';
  $('score-session').textContent = sessionDisplay(state.session);
  $('score-session-sub').textContent = state.session === 'Open' ? 'Regular session · 9:30 AM–4:00 PM ET' : 'Trading stays open — fills at the live extended price';
  const sb = $('session-badge'); sb.textContent = sessionDisplay(state.session); sb.className = 'badge ' + sessionBadgeClass(state.session);
  $('market-label').textContent = state.session === 'Open' ? 'NYSE · Regular session' : 'NYSE · ' + state.session;
  $('ext-explainer').textContent = state.settings.overnightPrices === false && state.session !== 'Open'
    ? 'Overnight prices are OFF: your game is frozen at the 4 PM close outside market hours — board, positions, fills, pings and the auto trader all use the close.'
    : 'Extended prices: the price shown is the live extended price from the latest 1-minute bar — after hours it moves against the 4 PM close. When overnight prices are off, your game freezes at the 4 PM close outside market hours instead.';
  $('trade-session-banner').textContent = 'Session: ' + sessionDisplay(state.session) + ' — trading never closes. You fill at the LIVE extended price, never the close.';
  $('footer-best-run').textContent = state.bestRun > 0 ? 'BEST BANKED RUN: ' + money(state.bestRun) : '';
  renderPositions(); renderTrades(); renderOrders(); renderAlerts(); renderAutoLog(); renderPredHistory(); renderCustomList(); renderSidebarProfile(); renderSettings(); renderFeedbackInbox(); renderDeleteRow(); fillSymbolSelects(); updateSteppers(); updateAutoUI(); updatePingUI(); updateNotifyState();
  const unread = state.alerts.filter(a => !a.read).length;
  $('ping-count').textContent = unread; $('ping-count').classList.toggle('hidden', !unread);
  loadExtras(false); // leaderboard / portfolio history / achievements, throttled to 60 s
  $('side-ping-badge').textContent = unread; $('side-ping-badge').classList.toggle('hidden', !unread);
  $('auto-dot').classList.toggle('hidden', !state.settings.autoOn);
  const lt = $('btn-live-toggle'); const live = state.settings.liveRefresh !== false;
  lt.textContent = live ? '● LIVE · 10s' : '❚❚ PAUSED'; lt.className = 'badge ' + (live ? 'live' : 'paused');
  $('side-auto-hint').textContent = state.settings.autoOn ? 'ON · ' + state.settings.style : 'OFF';
  $('side-own-count').textContent = (state.customSymbols || []).length + ' added';
}
function fillSymbolSelects() {
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
    $('quotes-updated').textContent = 'Quotes updated ' + new Date(j.updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    const sb = $('session-badge'); sb.textContent = sessionDisplay(j.session); sb.className = 'badge ' + sessionBadgeClass(j.session);
    renderWatchlist(); renderTickerTape(); updatePredCurrent(); updateTradeEstimates();
    if (chartRange === '1D' || Date.now() - lastChartLoad > 60000) await loadChart();
  } catch (e) { $('quotes-updated').textContent = 'FEED DOWN — showing last cached prices'; }
}
function renderTickerTape() {
  const track = $('ticker-track'); if (!track) return;
  const items = CORE.map(sym => {
    const q = quotes[sym];
    const price = q ? money(q.price) : '—';
    const chg = q ? pct(q.changePct) : '';
    const cls = q ? (q.changePct >= 0 ? 'up' : 'down') : '';
    return `<span class="tape-item"><b>${escapeHtml(sym)}</b> ${escapeHtml(price)} <span class="${cls}">${escapeHtml(chg)}</span></span>`;
  }).join('<span class="tape-sep">·</span>');
  // Two copies for a seamless loop; content is CORE symbols + numbers only.
  track.innerHTML = items + '<span class="tape-sep">·</span>' + items;
}
async function loadExtras(force) {
  if (!force && Date.now() - lastExtrasLoad < 60000) return;
  lastExtrasLoad = Date.now();
  try {
    const [lb, ph, ach, tr] = await Promise.all([api('/api/leaderboard'), api('/api/portfolio-history'), api('/api/achievements'), api('/api/predictor/track-record')]);
    leaderboardData = lb; portfolioHistory = ph; achievementsData = ach; predictorTrackRecord = tr;
    renderLeaderboard(); renderWelcomeLeaderboard(); renderAchievements(); drawPortfolioChart(); renderPredictorTrackRecord();
  } catch { /* extras are non-critical — the game still works without them */ }
}
// Leaderboard rows: ranked by % return — the all-time % is the big
// number, net worth $ is secondary info, today % last.
function leaderboardRowsHtml(players, you, limit) {
  const rows = (players || []).slice(0, limit || players.length);
  if (!rows.length) return '<p class="muted">No players yet.</p>';
  return rows.map(p => `<div class="lb-row"><span class="lb-rank">#${p.rank}</span><span class="lb-name"><strong>${escapeHtml(p.name)}</strong>${p.isOwner ? ' <span class="tag green">OWNER</span>' : ''}${p.name === you ? ' <span class="tag">YOU</span>' : ''}</span><span class="lb-pct-main ${p.allTimePct >= 0 ? 'up' : 'down'}">${pct(p.allTimePct)}</span><span class="lb-worth">${money(p.netWorth)}</span><span class="lb-pct lb-today ${p.todayPct >= 0 ? 'up' : 'down'}">${pct(p.todayPct)} today</span></div>`).join('');
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
function renderChat() {
  const el = $('chat-list'); if (!el) return;
  if (!chatMessages.length) { el.innerHTML = '<p class="muted">No messages yet — say hi.</p>'; return; }
  // Names, symbols and messages are escaped — a stored <script> tag or
  // onerror payload renders as harmless text, never as HTML.
  el.innerHTML = chatMessages.map(m => `<div class="chat-msg"><strong>${escapeHtml(m.name)}</strong>${m.symbol ? ` <span class="chip">${escapeHtml(m.symbol)}</span>` : ''} <span class="muted small">${fmtDT(m.created_at)}</span><br>${escapeHtml(m.message)}</div>`).join('');
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
}
function renderWelcomeLeaderboard() {
  const el = $('welcome-leaderboard'); if (!el || !leaderboardData) return;
  el.innerHTML = leaderboardRowsHtml(leaderboardData.players, leaderboardData.you, 5);
}
function renderAchievements() {
  const rankEl = $('achievements-rank'), listEl = $('achievements-list');
  if (!rankEl || !achievementsData) return;
  const a = achievementsData;
  rankEl.innerHTML = `<p>Your rank: <span class="rank-badge">${escapeHtml(a.rank)}</span> <span class="muted small">${pct(a.allTimePct)} all-time · ${a.earnedCount}/${a.totalCount} badges · ${a.tradeCount} trades · ${a.distinctDays} trading days</span></p>`;
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
  if (!el.children.length) el.innerHTML = wlSearch ? '<p class="muted">No tickers match your search.</p>' : '<p class="muted">PULLING LIVE QUOTES…</p>';
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
async function loadChart() {
  $('chart-error').classList.add('hidden');
  hoverIdx = -1; const _tip = $('chart-tip'); if (_tip) _tip.classList.add('hidden');
  try { chartData = await api(`/api/history?symbol=${chartSymbol}&range=${chartRange}`); lastChartLoad = Date.now(); }
  catch (e) { $('chart-error').textContent = 'Chart is warming up — the feed didn\'t answer. '; const b = document.createElement('button'); b.className = 'btn small'; b.textContent = 'Retry'; b.onclick = loadChart; $('chart-error').appendChild(b); $('chart-error').classList.remove('hidden'); return; }
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
    $('chart-ext').textContent = `Overnight ${pct(extPct)} · 4 PM close ${money(q.regularClose)} · last trade ${q.lastTrade || '—'}${q.frozenAtClose ? ' · frozen at close (overnight off)' : ''}`;
  }
  const intervals = { '1D': '1-minute', '5D': '15-minute', '1M': 'daily', '3M': 'daily', '6M': 'weekly', '1Y': 'weekly', '5Y': 'monthly' };
  const rsi = computeRSI(chartData.points.map(p => p.c));
  $('chart-caption').textContent = `${chartRange} · ${intervals[chartRange]} bars · ${chartData.points.length} bars${chartRange === '1D' ? ' · purple shading = premarket / after-hours' : ''} · 1 candle per source bar (max 220 candles) · RSI(14) ${rsi == null ? '—' : rsi.toFixed(0) + ' (' + rsiLabel(rsi) + ')'}`;
  drawChart();
}
// Chart indicators — pure functions of closes, so they can be unit-tested.
function computeMA(closes, period) {
  const out = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
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
    ctx.fillStyle = 'rgba(179,136,255,0.14)';
    let start = null, label = '';
    const flush = (endIdx) => { if (start !== null) { ctx.fillRect(X(start), 0, X(endIdx) - X(start), H - 32); ctx.fillStyle = '#c4a8ff'; ctx.fillText(label, X(start) + 6, 14); ctx.fillStyle = 'rgba(179,136,255,0.14)'; start = null; } };
    pts.forEach((p, i) => { const m = etMins(p.t); const ah = m < 570 || m >= 960; if (ah && start === null) { start = i; label = m < 570 ? 'PRE' : 'AFTER HOURS'; } if (!ah && start !== null) flush(i); });
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
  if (chartRange === '1D' && q?.regularClose) { // amber dashed 4 PM close line — 1D only, it means nothing on 5D/1M/1Y
    ctx.setLineDash([6, 4]); ctx.strokeStyle = '#ffb02e'; ctx.beginPath(); ctx.moveTo(52, Y(q.regularClose)); ctx.lineTo(W - 20, Y(q.regularClose)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffb02e'; ctx.fillText('4 PM close ' + money(q.regularClose), 58, Y(q.regularClose) - 5);
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
      const maxV = Math.max(...series.map(p => p.v || 0), 1);
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
        const ma = computeMA(series.map(p => p.c), 20);
        if (ma.some(v => v != null)) {
          ctx.strokeStyle = '#b388ff'; ctx.lineWidth = 1.5; ctx.beginPath();
          let started = false;
          ma.forEach((v, i) => {
            if (v == null) return;
            const x = chartMode === 'candles' ? 52 + (i + 0.5) / series.length * (W - 72) : X(i);
            if (!started) { ctx.moveTo(x, Y(v)); started = true; } else ctx.lineTo(x, Y(v));
          });
          ctx.stroke();
        }
      }
    }
  }
  if (chartMode === 'line') {
    const grad = ctx.createLinearGradient(0, 18, 0, H - 32); grad.addColorStop(0, accent() + '55'); grad.addColorStop(1, accent() + '00');
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(i), Y(p.c)) : ctx.moveTo(X(i), Y(p.c)));
    ctx.lineTo(X(pts.length - 1), H - 32); ctx.lineTo(X(0), H - 32); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = accent(); ctx.lineWidth = 2; ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(X(i), Y(p.c)) : ctx.moveTo(X(i), Y(p.c)));
    ctx.stroke();
    const last = pts[pts.length - 1]; ctx.fillStyle = accent(); ctx.beginPath(); ctx.arc(X(pts.length - 1), Y(last.c), 3.5, 0, Math.PI * 2); ctx.fill();
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
    tip.innerHTML = chartMode === 'candles'
      ? `<b>${money(p.c)}</b><br>${fmtTip(p.t)}<br>O ${money(p.o)} · H ${money(p.h)} · L ${money(p.l)} · C ${money(p.c)}`
      : `<b>${money(p.c)}</b><br>${fmtTip(p.t)}`;
    tip.classList.remove('hidden');
    // Keep the tooltip inside the chart: flip it left when near the right edge.
    const tipW = tip.offsetWidth || 140;
    tip.style.left = Math.max(4, Math.min(chartGeom.W - tipW - 4, px + 12)) + 'px';
    tip.style.top = Math.max(4, py - 10) + 'px';
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
  if (tradeSide === 'buy' && isShort) el.innerHTML = mk('25%', 0.25, 'short') + mk('50%', 0.50, 'short') + mk('ALL', 1, 'short'); // cover fractions of the short
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
  if (!q) { $('trade-est').textContent = 'Waiting for a live price…'; $('trade-cash-after').textContent = ''; $('trade-position-line').textContent = ''; return; }
  const total = shares * q.price;
  $('trade-est').textContent = tradeSide === 'buy' ? `Est. cost: ${money(total)} (${shares} × ${money(q.price)})` : `Est. proceeds: ${money(total)} (${shares} × ${money(q.price)})`;
  $('trade-cash-after').textContent = 'Cash after: ' + money(tradeSide === 'buy' ? state.cash - total : state.cash + total);
  const pos = heldPosition(chartSymbol);
  if (!pos) $('trade-position-line').textContent = 'You hold no ' + chartSymbol + ' yet. SELL opens a short — you profit if the price falls; BUY while short covers it.';
  else if (pos.shares < 0) $('trade-position-line').textContent = `You SHORT ${Math.abs(pos.shares)} shares @ ${money(pos.avg_cost)} avg short price · unrealized ${pos.changePct >= 0 ? '+' : ''}${pos.changePct.toFixed(2)}% (${money((pos.avg_cost - q.price) * Math.abs(pos.shares))}) · BUY covers it${shares > Math.abs(pos.shares) && tradeSide === 'buy' ? ` — you only short ${Math.abs(pos.shares)}, covering more is not allowed` : ''}.`;
  else $('trade-position-line').textContent = `You hold ${pos.shares} shares @ ${money(pos.avg_cost)} avg · unrealized ${pos.changePct >= 0 ? '+' : ''}${pos.changePct.toFixed(2)}% (${money((q.price - pos.avg_cost) * pos.shares)})`;
}
async function doTrade() {
  if (tradeInFlight) return; // guard: no double-click double-fills
  const shares = parseFloat($('trade-shares').value);
  if (!(shares > 0)) { $('trade-msg').textContent = 'Enter shares first (fractions work, up to 4 decimals).'; return; }
  const btn = $('btn-trade-submit');
  const heldBefore = heldPosition(chartSymbol);
  const avgBefore = heldBefore ? heldBefore.avg_cost : 0;
  const style = STYLES[state?.settings?.style] || STYLES.day;
  tradeInFlight = true; if (btn) btn.disabled = true;
  try {
    const j = await api('/api/trade', { method: 'POST', body: JSON.stringify({ symbol: chartSymbol, side: tradeSide, shares }) });
    const kind = j.shorted ? 'SHORT opened' : j.covered ? 'COVER filled' : tradeSide.toUpperCase();
    $('trade-msg').textContent = `${kind} at live price ${money(j.price)} (${j.session})${j.pnl ? ` · realised P&L ${money(j.pnl)}` : ''}`;
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
    $('order-msg').textContent = j.filledNow ? 'Order filled immediately at the target price.' : 'Order placed — it fills at the target price when the live price touches it.';
  } catch (e) { $('order-msg').textContent = 'Order failed: ' + e.message; }
}

// ---------- Positions / trades / movers / news ----------
function renderPositions() {
  const el = $('positions');
  if (!state.positions.length) { el.innerHTML = '<p class="muted">No positions yet.</p>'; return; }
  const style = STYLES[state.settings.style] || STYLES.day;
  el.innerHTML = state.positions.map(p => {
    const mv = p.price * p.shares;
    const unrl = (p.price - p.avg_cost) * p.shares; // correct sign for shorts too: negative shares flip it
    const isShort = p.shares < 0;
    // Stop/target lines flip for shorts: the stop sits ABOVE the short
    // price (a rising price is a loss), the target BELOW it.
    const stopPrice = isShort ? p.avg_cost * (1 - style.stop / 100) : p.avg_cost * (1 + style.stop / 100);
    const targetPrice = isShort ? p.avg_cost * (1 - style.target / 100) : p.avg_cost * (1 + style.target / 100);
    const line5 = isShort ? p.avg_cost * 1.05 : p.avg_cost * 0.95;
    const line10 = isShort ? p.avg_cost * 0.90 : p.avg_cost * 1.10;
    const stopHit = p.changePct <= -5 || p.changePct <= style.stop, targetHit = p.changePct >= 10 || p.changePct >= style.target;
    const flag = stopHit ? '<span class="tag red">STOP HIT</span>' : targetHit ? '<span class="tag green">TARGET HIT</span>' : '';
    const shortTag = isShort ? '<span class="tag red">SHORT</span>' : '';
    return `<div class="pos-row"><strong>${escapeHtml(p.symbol)}</strong> ${shortTag} ${flag}<br><span class="muted">${isShort ? `Short ${Math.abs(p.shares)} shares @ ${money(p.avg_cost)} short avg · exposure ${money(Math.abs(mv))}` : `Market value ${money(mv)} · ${p.shares} shares @ ${money(p.avg_cost)} avg`}</span><br><span class="${p.changePct >= 0 ? 'up' : 'down'}">Unrealized ${money(unrl)} (${pct(p.changePct)})</span><br><span class="muted small">your lines: stop ${money(stopPrice)} · target ${money(targetPrice)} · −5% ${money(line5)} · +10% ${money(line10)}</span> <button class="btn small" data-open="${escapeHtml(p.symbol)}">Open ${escapeHtml(p.symbol)} →</button></div>`;
  }).join('');
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { chartSymbol = b.dataset.open; $('trade-symbol').value = chartSymbol; gotoTab('trade'); loadChart(); renderWatchlist(); });
}
function renderTrades() {
  const el = $('trades');
  if (!state.trades.length) { el.innerHTML = '<p class="muted">No trades yet.</p>'; return; }
  el.innerHTML = state.trades.map(t => {
    const src = String(t.source || '');
    const kindTag = src.endsWith('-short') ? ' <span class="tag red">SHORT</span>' : src.endsWith('-cover') ? ' <span class="tag amber">COVER</span>' : '';
    return `<div class="trade-row"><span class="chip ${t.side === 'buy' ? 'buy' : 'sell'}">${escapeHtml(String(t.side || '').toUpperCase())}</span>${kindTag} <strong>${escapeHtml(t.symbol)}</strong> · ${t.shares} shares @ ${money(t.price)} · ${money(t.total)} · ${fmtDT(t.created_at)} · ${escapeHtml(t.session || '')} · ${escapeHtml(t.source || '')}${t.pnl ? ` · Realized P&L <span class="${t.pnl >= 0 ? 'up' : 'down'}">${money(t.pnl)}</span>` : ''}</div>`;
  }).join('');
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
    }).join('') || '<p class="muted">No headlines right now.</p>';
    el.querySelectorAll('[data-news-sym]').forEach(b => b.onclick = () => { chartSymbol = b.dataset.newsSym; $('trade-symbol').value = chartSymbol; loadChart(); renderWatchlist(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  } catch (e) {
    el.innerHTML = `<p class="muted">The news feed didn't answer.</p><button class="btn small" id="btn-news-retry">Retry</button>`;
    $('btn-news-retry').onclick = loadNews;
  }
}

// ---------- Pings ----------
function pingKindChip(kind) { const k = String(kind || ''); return `<span class="chip ${k.startsWith('BUY') ? 'buy' : 'sell'}">${escapeHtml(k)}</span>`; }
function renderAlerts() {
  const el = $('ping-feed');
  el.innerHTML = state.alerts.length ? state.alerts.map(a => {
    const q = quotes[a.symbol];
    return `<div class="ping-row">${pingKindChip(a.kind)} <strong>${escapeHtml(a.symbol)}</strong>${a.read ? '' : '<span class="new-badge">NEW</span>'}<br>${escapeHtml(a.message)}<br><span class="muted small">${money(a.price)} · ${q ? pct(q.changePct) + ' today' : ''} · ${fmtDT(a.created_at)}</span> <button class="btn small" data-ping-open="${escapeHtml(a.symbol)}">Open ${escapeHtml(a.symbol)} →</button></div>`;
  }).join('') : '<p class="muted">No pings yet.</p>';
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
  $('pings-on').checked = s.pingsOn; $('buy-pings').checked = s.buyPings !== false; $('sell-pings').checked = s.sellPings !== false;
  $('stop-target-pings').checked = s.stopTargetPings !== false; $('sound-on').checked = s.soundOn !== false;
  $('notify-email').value = state.user.email || state.user.pendingEmail || '';
  $('email-status').textContent = state.user.emailVerified ? 'VERIFIED ✓ ' + state.user.email : (state.user.pendingEmail ? 'SAVED — pending verification: ' + state.user.pendingEmail + ' — enter the code below.' : 'No email saved — send yourself a code to turn on email pings.');
  const codeBtn = $('btn-send-code'), setCodeBtn = $('btn-set-send-code');
  const codeLabel = state.user.emailVerified ? 'VERIFIED ✓' : state.user.pendingEmail ? 'SAVED' : 'SEND CODE';
  if (codeBtn) codeBtn.textContent = codeLabel;
  if (setCodeBtn) setCodeBtn.textContent = codeLabel;
  $('email-verify-block').classList.toggle('hidden', !(state.user.pendingEmail && !state.user.emailVerified));
  $('email-pings').checked = s.emailPings; $('email-trades').checked = s.emailTrades;
  $('email-queued').textContent = state.emailQueued ? state.emailQueued + ' email(s) queued — they send batched (max 20 per email).' : 'No emails queued.';
  $('set-email').value = state.user.email || state.user.pendingEmail || '';
  $('set-email-status').textContent = $('email-status').textContent;
  $('set-email-pings').checked = s.emailPings; $('set-email-trades').checked = s.emailTrades;
  $('set-verify-block').classList.toggle('hidden', !(state.user.pendingEmail && !state.user.emailVerified));
}
function updateNotifyState() {
  const p = ('Notification' in window) ? Notification.permission : 'unsupported';
  $('notify-state').textContent = 'Browser notifications: ' + (p === 'granted' ? 'ON' : p === 'denied' ? 'blocked' : 'prompt — tap Enable browser notifications');
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
  if (!state.predictorChats.length) { el.innerHTML = '<p class="muted">No answers yet — ask about a ticker above.</p>'; return; }
  el.innerHTML = state.predictorChats.map(c => {
    let kp = [], risks = [];
    try { kp = JSON.parse(c.key_points || '[]'); } catch {}
    try { risks = JSON.parse(c.risks || '[]'); } catch {}
    return `<div class="pred-card">
      <p><span class="chip ${c.outlook === 'Bullish' ? 'buy' : c.outlook === 'Bearish' ? 'sell' : 'check'}">${escapeHtml(c.outlook)}</span> <strong>${escapeHtml(c.symbol)}</strong> · ${escapeHtml(c.timeframe || '')} · price at ask ${money(c.price_at_ask || 0)} · ${fmtDT(c.created_at)}</p>
      <p class="muted">“${escapeHtml(c.question)}”</p>
      <p>${escapeHtml((c.answer || '').slice(0, 900))}</p>
      <p>CONFIDENCE ${Number(c.confidence) || 0}%</p><div class="conf-bar"><i style="width:${Number(c.confidence) || 0}%"></i></div>
      ${kp.length ? '<p><strong>Key points</strong></p><ul>' + kp.map(k => `<li>${escapeHtml(k)}</li>`).join('') + '</ul>' : ''}
      ${risks.length ? `<p class="muted small">Risks: ${escapeHtml(risks.join('; '))}</p>` : ''}
      <div class="row"><button class="btn small" data-trade-sym="${escapeHtml(c.symbol)}">Trade ${escapeHtml(c.symbol)} →</button></div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-trade-sym]').forEach(b => b.onclick = () => { chartSymbol = b.dataset.tradeSym; $('trade-symbol').value = chartSymbol; gotoTab('trade'); loadChart(); renderWatchlist(); });
}
async function askPredictor() {
  const q = $('pred-q').value.trim();
  if (!q) { $('pred-answer').textContent = 'Ask a question first — or tap one of the suggestion chips.'; return; }
  $('pred-answer').innerHTML = '<p class="muted">Asking the Predictor…</p>';
  try {
    const j = await api('/api/predictor', { method: 'POST', body: JSON.stringify({ symbol: chartSymbol, question: q }) });
    $('pred-answer').innerHTML = `<div class="pred-card"><p><span class="chip ${j.outlook === 'Bullish' ? 'buy' : j.outlook === 'Bearish' ? 'sell' : 'check'}">${escapeHtml(j.outlook)}</span> <strong>${escapeHtml(chartSymbol)}</strong> · ${escapeHtml(j.timeframe || '')} · price at ask ${money(j.priceAtAsk || 0)}</p><p>${escapeHtml(j.answer)}</p><p>CONFIDENCE ${Number(j.confidence) || 0}%</p><div class="conf-bar"><i style="width:${Number(j.confidence) || 0}%"></i></div>${(j.keyPoints || []).length ? '<p><strong>Key points</strong></p><ul>' + j.keyPoints.map(k => `<li>${escapeHtml(k)}</li>`).join('') + '</ul>' : ''}${(j.risks || []).length ? `<p class="muted small">Risks: ${escapeHtml(j.risks.join('; '))}</p>` : ''}</div>`;
    state = j.state; renderPredHistory(); loadExtras(true); // track record gains a new (pending) call
  } catch (e) { $('pred-answer').textContent = 'Predictor failed: ' + e.message; }
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
  set('step-budgetPerBuy', money(s.budgetPerBuy)); set('step-set-budgetPerBuy', money(s.budgetPerBuy));
  set('step-maxPositions', s.maxPositions); set('step-set-maxPositions', s.maxPositions);
  set('step-maxTradesPerDay', s.maxTradesPerDay); set('step-set-maxTradesPerDay', s.maxTradesPerDay);
  set('step-checkSeconds', fmtCheck(s.checkSeconds)); set('step-set-checkSeconds', fmtCheck(s.checkSeconds));
  set('step-dipPct', (s.dipPct || -3) + '%'); set('step-set-dipPct', (s.dipPct || -3) + '%');
  set('step-momentumPct', '+' + (s.momentumPct || 4) + '%'); set('step-set-momentumPct', '+' + (s.momentumPct || 4) + '%');
  // Steppers locked under Credit Saver (any user while it is on)
  const locked = !!s.creditSaver;
  document.querySelectorAll('[data-stepper="maxTradesPerDay"], [data-stepper="checkSeconds"]').forEach(b => b.disabled = locked);
}
function updateAutoUI() {
  if (!state) return; const s = state.settings; const style = STYLES[s.style] || STYLES.day;
  $('auto-on').checked = s.autoOn; $('set-auto-on').checked = s.autoOn;
  $('auto-sell').checked = s.autoSell !== false; $('set-auto-sell').checked = s.autoSell !== false;
  $('auto-buy-dips').checked = s.buyDips !== false; $('set-auto-buy-dips').checked = s.buyDips !== false;
  $('auto-buy-momentum').checked = s.buyMomentum !== false; $('set-auto-buy-momentum').checked = s.buyMomentum !== false;
  document.querySelectorAll('#style-grid .style-card, #set-style-grid .style-card').forEach(c => c.classList.toggle('active', c.dataset.style === s.style));
  document.querySelectorAll('#mode-picker .btn, #set-mode-picker .btn').forEach(c => c.classList.toggle('active', c.dataset.mode === s.autoMode));
  $('credit-saver').checked = s.creditSaver; $('set-credit-saver').checked = s.creditSaver;
  const saverLocked = !state.user.isOwner;
  $('credit-saver').disabled = saverLocked; $('set-credit-saver').disabled = saverLocked;
  $('saver-state').textContent = s.creditSaver ? 'ON' : 'OFF';
  $('set-saver-state').textContent = s.creditSaver ? 'ON' : 'OFF';
  $('saver-note').textContent = saverLocked ? 'Credit Saver is forced ON for your account (players only). Only Lucas (owner) can turn it off. AI / Rules choice stays yours.' : (s.creditSaver ? 'Credit Saver is ON — 30s checks, AI only on a signal, market hours only, max 2 trades/day.' : 'Credit Saver is OFF (owner only) — your steppers and trade caps are unlocked.');
  $('side-saver-note').textContent = $('saver-note').textContent;
  const last = state.autoLog[0];
  const today = new Date().toISOString().slice(0, 10);
  const tradesToday = state.trades.filter(t => (t.source || '').startsWith('auto') && new Date(t.created_at).toISOString().slice(0, 10) === today).length;
  const statusHtml = `Last action: <b>${last ? escapeHtml(last.kind) + ' — ' + escapeHtml(last.message) : 'none yet'}</b><br>Style: <b>${escapeHtml(s.style)}</b> · lines ${style.stop}% / +${style.target}% · mode ${escapeHtml(s.autoMode)}<br>Credit Saver: <b>${s.creditSaver ? 'ON' : 'OFF'}</b>${saverLocked ? ' (forced for players)' : ''}<br>Last check: <b>${last ? fmtDT(last.created_at) : 'never'}</b><br>Trades used today: <b>${tradesToday} / ${s.maxTradesPerDay}</b> · Positions open: <b>${state.positions.length} / ${s.maxPositions}</b><br>Cash: <b>${money(state.cash)}</b><br>Email: auto-trade emails ${s.emailTrades ? 'ON' : 'OFF'} to ${state.user.emailVerified ? escapeHtml(state.user.email) : 'a verified email (verify in Pings first)'}`;
  $('auto-status').innerHTML = statusHtml; $('set-auto-status').innerHTML = statusHtml;
}
function renderAutoLog() {
  const el = $('auto-log');
  if (!state.autoLog.length) { el.innerHTML = '<p class="muted">No auto-trading activity yet.</p>'; return; }
  const chipCls = k => k === 'BUY' ? 'buy' : k === 'SELL' ? 'sell' : k === 'RESEARCH' ? 'research' : 'check';
  const chipTxt = k => k === 'BUY' ? 'AUTO BUY' : k === 'SELL' ? 'AUTO SELL' : k === 'RESEARCH' ? 'RESEARCH' : 'CHECKED';
  el.innerHTML = state.autoLog.map(l => `<div class="log-row"><span class="chip ${chipCls(l.kind)}">${chipTxt(l.kind)}</span> <strong>${l.kind === 'CHECK' || l.kind === 'PASS' ? 'Checked' : l.kind === 'RESEARCH' ? 'Research' : ''}</strong> — ${escapeHtml(l.message)}<br><span class="muted small">${fmtDT(l.created_at)}${l.shares ? ` · ${l.shares} shares @ ${money(l.price)}` : ''}</span>${l.symbol ? ` <button class="btn small" data-auto-open="${escapeHtml(l.symbol)}">Open ${escapeHtml(l.symbol)} →</button>` : ''}</div>`).join('');
  el.querySelectorAll('[data-auto-open]').forEach(b => b.onclick = () => { chartSymbol = b.dataset.autoOpen; $('trade-symbol').value = chartSymbol; gotoTab('trade'); loadChart(); renderWatchlist(); });
}

// ---------- Settings / sidebar / feedback ----------
function renderSettings() {
  if (!state) return; const s = state.settings;
  const init = (state.user.name || '?')[0].toUpperCase();
  $('settings-profile').innerHTML = `<span class="avatar" style="width:44px;height:44px;border-radius:50%;background:var(--accent);color:#06090a;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:18px">${escapeHtml(init)}</span> <strong>${escapeHtml(state.user.name)}</strong> ${state.user.isOwner ? '<span class="tag green">OWNER</span>' : '<span class="tag">PLAYER</span>'}<div class="stat-grid"><div class="stat"><div class="stat-label">Net Worth</div><div class="stat-val">${money(state.netWorth)}</div></div><div class="stat"><div class="stat-label">Cash</div><div class="stat-val">${money(state.cash)}</div></div><div class="stat"><div class="stat-label">All-time</div><div class="stat-val">${money(state.allTime)}</div></div><div class="stat"><div class="stat-label">Positions</div><div class="stat-val">${state.positions.length}</div></div></div>`;
  $('settings-best-run').textContent = state.bestRun > 0 ? 'BEST BANKED RUN: ' + money(state.bestRun) : 'BEST BANKED RUN: — none banked yet';
  $('start-cash').value = s.startCash || 100000;
  $('btn-apply-startcash').textContent = 'RESTART MY GAME AT ' + money(s.startCash || 100000);
  $('set-live-refresh').checked = s.liveRefresh !== false; $('set-overnight').checked = s.overnightPrices !== false;
  $('set-sound').checked = s.soundOn !== false;
  $('set-pings-on').checked = s.pingsOn; $('set-buy-pings').checked = s.buyPings !== false; $('set-sell-pings').checked = s.sellPings !== false;
  $('set-stop-target-pings').checked = s.stopTargetPings !== false;
  renderThemePickers();
}
function renderSidebarProfile() {
  const el = $('side-profile'); if (!el || !state) return;
  const init = (state.user.name || '?')[0].toUpperCase();
  el.innerHTML = `<span class="avatar">${escapeHtml(init)}</span><span class="prof-name">${escapeHtml(state.user.name)}</span> ${state.user.isOwner ? '<span class="tag green">OWNER</span>' : '<span class="tag">PLAYER</span>'}<div class="stat-grid"><div class="stat"><div class="stat-label">Net worth</div><div class="stat-val">${money(state.netWorth)}</div></div><div class="stat"><div class="stat-label">Cash</div><div class="stat-val">${money(state.cash)}</div></div><div class="stat"><div class="stat-label">All-time</div><div class="stat-val">${money(state.allTime)}</div></div><div class="stat"><div class="stat-label">Positions</div><div class="stat-val">${state.positions.length}</div></div></div><p class="muted small">BEST BANKED RUN: ${state.bestRun > 0 ? money(state.bestRun) : '— none yet'}</p><p class="muted small">Email: ${state.user.emailVerified ? 'VERIFIED ✓ ' + escapeHtml(state.user.email) : state.user.pendingEmail ? 'Pending: ' + escapeHtml(state.user.pendingEmail) : 'Not set up'} — <a href="#" id="side-email-link">${state.user.emailVerified ? 'Change my email' : state.user.pendingEmail ? 'Verify my email' : 'Set up my email'}</a></p>`;
  const link = $('side-email-link'); if (link) link.onclick = e => { e.preventDefault(); gotoTab('pings'); };
  const q = $('side-quick'); if (q) {
    const st = state.settings;
    q.innerHTML = `
      <label class="switch"><input type="checkbox" id="sq-live" ${st.liveRefresh !== false ? 'checked' : ''}> Live prices</label>
      <label class="switch"><input type="checkbox" id="sq-overnight" ${st.overnightPrices !== false ? 'checked' : ''}> Overnight &amp; after-hours prices</label>
      <label class="switch"><input type="checkbox" id="sq-pings" ${st.pingsOn ? 'checked' : ''}> Pings</label>
      <label class="switch"><input type="checkbox" id="sq-sound" ${st.soundOn !== false ? 'checked' : ''}> Ping sound</label>
      <label class="switch"><input type="checkbox" id="sq-email-pings" ${st.emailPings ? 'checked' : ''}> Email me pings</label>
      <label class="switch"><input type="checkbox" id="sq-email-trades" ${st.emailTrades ? 'checked' : ''}> Email me auto trades</label>
      <label class="switch"><input type="checkbox" id="sq-auto" ${st.autoOn ? 'checked' : ''}> Auto trader</label>`;
    const bind = (id, key) => { const n = $(id); if (n) n.onchange = () => saveSettings({ [key]: n.checked }); };
    bind('sq-live', 'liveRefresh'); bind('sq-overnight', 'overnightPrices'); bind('sq-pings', 'pingsOn'); bind('sq-sound', 'soundOn'); bind('sq-email-pings', 'emailPings'); bind('sq-email-trades', 'emailTrades'); bind('sq-auto', 'autoOn');
  }
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
  const b = $('btn-delete-acc'); if (b) b.onclick = () => $('delete-modal').classList.remove('hidden');
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
}
function showWelcome() { $('welcome-screen').classList.remove('hidden'); $('auth-screen').classList.add('hidden'); if (token) loadExtras(true); }
function showAuth(mode) {
  authMode = mode || authMode;
  $('welcome-screen').classList.add('hidden'); $('auth-screen').classList.remove('hidden');
  $('auth-mode-signin').classList.toggle('active', authMode === 'signin');
  $('auth-mode-new').classList.toggle('active', authMode === 'new');
  $('auth-email-wrap').classList.toggle('hidden', authMode === 'signin');
  $('btn-auth-go').textContent = authMode === 'signin' ? 'SIGN IN' : 'CREATE MY ACCOUNT';
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
$('btn-show-welcome').onclick = showWelcome; $('btn-footer-what').onclick = showWelcome; $('btn-side-what').onclick = showWelcome;
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
  'pings-on': 'pingsOn', 'set-pings-on': 'pingsOn', 'buy-pings': 'buyPings', 'set-buy-pings': 'buyPings',
  'sell-pings': 'sellPings', 'set-sell-pings': 'sellPings', 'stop-target-pings': 'stopTargetPings', 'set-stop-target-pings': 'stopTargetPings',
  'sound-on': 'soundOn', 'set-sound': 'soundOn', 'email-pings': 'emailPings', 'set-email-pings': 'emailPings',
  'email-trades': 'emailTrades', 'set-email-trades': 'emailTrades', 'auto-on': 'autoOn', 'set-auto-on': 'autoOn',
  'auto-sell': 'autoSell', 'set-auto-sell': 'autoSell', 'auto-buy-dips': 'buyDips', 'set-auto-buy-dips': 'buyDips',
  'auto-buy-momentum': 'buyMomentum', 'set-auto-buy-momentum': 'buyMomentum', 'credit-saver': 'creditSaver', 'set-credit-saver': 'creditSaver',
  'set-live-refresh': 'liveRefresh', 'set-overnight': 'overnightPrices',
};
for (const [id, key] of Object.entries(TOGGLE_MAP)) { const el = $(id); if (el) el.onchange = () => saveSettings({ [key]: el.checked }); }
// Style + mode pickers (AUTO tab + Settings duplicates)
document.querySelectorAll('#style-grid .style-card, #set-style-grid .style-card').forEach(c => c.onclick = () => saveSettings({ style: c.dataset.style }));
document.querySelectorAll('#mode-picker .btn, #set-mode-picker .btn').forEach(c => c.onclick = () => saveSettings({ autoMode: c.dataset.mode }));
async function requestNotify() { if (!('Notification' in window)) { banner('This browser does not support notifications'); return; } await Notification.requestPermission(); saveSettings({ browserNotify: Notification.permission === 'granted' }); updateNotifyState(); banner('Browser notifications: ' + Notification.permission); }
$('btn-notify').onclick = requestNotify; $('btn-set-notify').onclick = requestNotify; $('btn-side-notify').onclick = requestNotify;
// Pings feed actions
$('btn-mark-read').onclick = async () => { await api('/api/alerts/read', { method: 'POST' }); bannerAlertId = null; await loadState(); };
$('btn-clear-pings').onclick = async () => { const j = await api('/api/alerts/clear', { method: 'POST' }); state = j.state; bannerAlertId = null; await loadState(); };
// Email verification
async function sendCode(email, msgEl, verifyBlock) {
  try { const j = await api('/api/email/send-code', { method: 'POST', body: JSON.stringify({ email }) }); $(msgEl).textContent = 'Code sent to ' + j.email + ' — it expires in 10 minutes.'; if (verifyBlock) $(verifyBlock).classList.remove('hidden'); await loadState(); }
  catch (e) { $(msgEl).textContent = 'Code not sent: ' + e.message; }
}
$('btn-send-code').onclick = () => sendCode($('notify-email').value, 'email-msg', 'email-verify-block');
$('btn-set-send-code').onclick = () => sendCode($('set-email').value, 'set-email-msg', 'set-verify-block');
$('btn-resend-email').onclick = () => sendCode($('notify-email').value, 'email-msg', 'email-verify-block');
async function verifyCode(code, msgEl) {
  try { const j = await api('/api/email/verify-code', { method: 'POST', body: JSON.stringify({ code }) }); state = j.state; await loadState(); $(msgEl).textContent = 'VERIFIED ✓ ' + j.email; banner('Email verified'); return true; }
  catch (e) { $(msgEl).textContent = 'Verify failed: ' + e.message; return false; }
}
$('btn-verify-email').onclick = () => verifyCode($('email-verify-code').value, 'email-msg');
$('btn-set-verify').onclick = () => verifyCode($('set-verify-code').value, 'set-email-msg');
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
$('btn-run-now').onclick = async () => { const j = await api('/api/auto/run', { method: 'POST' }); state = j.state; await loadState(); banner('Check ran: ' + (j.action || '')); };
$('btn-set-run-now').onclick = () => $('btn-run-now').onclick();
$('btn-clear-auto-log').onclick = async () => { const j = await api('/api/auto-log', { method: 'DELETE' }); state = j.state; await loadState(); banner('Auto log cleared'); };
// Starting cash
document.querySelectorAll('.sc-preset').forEach(b => b.onclick = () => { $('start-cash').value = b.dataset.startcash; $('btn-apply-startcash').textContent = 'RESTART MY GAME AT ' + money(+b.dataset.startcash); });
$('start-cash').oninput = () => { $('btn-apply-startcash').textContent = 'RESTART MY GAME AT ' + money(+$('start-cash').value || 0); };
$('btn-apply-startcash').onclick = () => { $('startcash-modal-title').textContent = 'START OVER AT ' + money(+$('start-cash').value || 0) + '?'; $('startcash-modal').classList.remove('hidden'); };
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
function openReset() { $('reset-modal').classList.remove('hidden'); }
$('btn-reset').onclick = openReset; $('btn-reset2').onclick = openReset; $('btn-side-reset').onclick = openReset; $('btn-footer-reset').onclick = openReset;
$('btn-cancel-reset').onclick = () => $('reset-modal').classList.add('hidden');
$('btn-confirm-reset').onclick = async () => { await api('/api/reset', { method: 'POST', body: JSON.stringify({ confirm: true }) }); $('reset-modal').classList.add('hidden'); banner('Reset complete.'); await refreshAll(); loadExtras(true); };
$('btn-cancel-delete').onclick = () => $('delete-modal').classList.add('hidden');
$('btn-confirm-delete').onclick = async () => {
  try { await api('/api/account/delete', { method: 'POST', body: JSON.stringify({ pin: $('delete-pin').value }) }); token = ''; localStorage.removeItem('verityinvest-token'); location.reload(); }
  catch (e) { $('delete-msg').textContent = e.message; }
};
async function doLogout() { try { await api('/api/auth/logout', { method: 'POST' }); } catch {} token = ''; localStorage.removeItem('verityinvest-token'); location.reload(); }
$('btn-logout').onclick = doLogout; $('btn-signout2').onclick = doLogout; $('btn-side-signout').onclick = doLogout;
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
      $('auth-error').textContent = '';
      $('verify-block').classList.add('hidden');
      await loadPlayers();
      $('auth-error').textContent = (body.name || 'That account') + ' was created with no PIN yet — tap your name above and choose SET PIN & CLAIM IT.';
      return;
    }
    token = j.token; localStorage.setItem('verityinvest-token', token);
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
  if (authMode === 'new') tryAuth('/api/auth/register', { name: $('auth-name').value, pin: $('auth-pin').value, email: $('auth-email').value });
  else tryAuth('/api/auth/login', { name: $('auth-name').value, pin: $('auth-pin').value });
};
$('btn-verify').onclick = async () => { if (await verifyCode($('verify-code').value, 'verify-msg')) { enterApp(); try { await refreshAll(); $('app-loading').classList.add('hidden'); } catch {} } };
$('btn-resend').onclick = () => sendCode($('auth-email').value, 'verify-msg', null);
$('btn-skip-verify').onclick = () => { enterApp(); refreshAll().then(() => $('app-loading').classList.add('hidden')).catch(() => {}); };
$('btn-retry-app').onclick = async () => { $('app-error').classList.add('hidden'); $('app-loading').classList.remove('hidden'); try { await refreshAll(); $('app-loading').classList.add('hidden'); } catch { $('app-loading').classList.add('hidden'); $('app-error').classList.remove('hidden'); } };
$('btn-claim').onclick = async () => {
  try {
    const j = await api('/api/auth/claim', { method: 'POST', body: JSON.stringify({ name: claimName, pin: $('claim-pin').value }) });
    token = j.token; localStorage.setItem('verityinvest-token', token);
    $('claim-block').classList.add('hidden'); enterApp();
    try { await refreshAll(); $('app-loading').classList.add('hidden'); } catch {}
  } catch (e) { $('claim-msg').textContent = e.message; }
};
$('btn-claim-cancel').onclick = () => $('claim-block').classList.add('hidden');
async function loadPlayers() {
  try {
    const j = await api('/api/session');
    const el = $('player-list');
    el.innerHTML = j.players.length ? '<p class="muted small">PLAYERS — tap one to fill in the name:</p>' + j.players.map(p => `<span class="player-chip ${p.has_pin ? '' : 'claim'}" data-name="${escapeHtml(p.name)}" data-haspin="${p.has_pin}">${escapeHtml(p.name)} · ${p.is_owner ? 'OWNER' : p.has_pin ? 'PLAYER' : 'NO PIN YET'}</span>`).join('') : '<p class="muted">No players yet — be the first.</p>';
    el.querySelectorAll('.player-chip').forEach(c => c.onclick = () => {
      $('auth-name').value = c.dataset.name;
      if (c.dataset.haspin === '0') {
        claimName = c.dataset.name; $('claim-name').textContent = claimName;
        $('claim-block').classList.remove('hidden'); $('claim-pin').focus();
      } else { $('claim-block').classList.add('hidden'); showAuth('signin'); $('auth-pin').focus(); }
    });
  } catch { $('player-list').innerHTML = '<p class="muted">LOADING PLAYERS… (couldn\'t reach the game — it will retry)</p>'; }
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
