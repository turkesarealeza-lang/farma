'use strict';

const TZ = 'America/Sao_Paulo';
const $ = (s) => document.querySelector(s);
const state = {
  user: null, vapid: null, open: [], done: [], view: 'list', highlight: null,
  month: null, selDay: null, editId: null, detailId: null, confirmDelete: false,
  stripDay: null, stripCentered: false,
  mode: 'push', descType: 'text', items: [], recur: '', wdays: [], remind: 0, alarm: null, silenced: {},
};

// ---------- icons (inline SVG, stroke = currentColor) ----------

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/>',
  alarm: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M5 3L2 6M19 3l3 3"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  mic: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3.5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  volume: '<path d="M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/>',
  moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
  checklist: '<path d="M10 6h11M10 12h11M10 18h11M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/>',
  skip: '<path d="M5 4l10 8-10 8zM19 5v14"/>',
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (!el.dataset.painted) { el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)); el.dataset.painted = '1'; }
  });
}

// ---------- helpers ----------

async function api(action, data, opts = {}) {
  const init = { method: data || opts.post ? 'POST' : 'GET', headers: { 'X-Tarefas': '1' }, credentials: 'same-origin' };
  if (data instanceof FormData) init.body = data;
  else if (data) { init.body = JSON.stringify(data); init.headers['Content-Type'] = 'application/json'; }
  let res, body;
  try {
    res = await fetch('api.php?a=' + action, init);
    body = await res.json();
  } catch {
    throw new Error('Sem conexão com o servidor.');
  }
  if (res.status === 401 && action !== 'login') { showLogin(); throw new Error(body.error); }
  if (!res.ok) throw new Error(body.error || 'Erro ' + res.status);
  return body;
}

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nowS = () => Math.floor(Date.now() / 1000);
const pref = {
  get(k) { try { return localStorage.getItem('tarefas.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('tarefas.' + k, v); } catch { /* private mode */ } },
};

function parts(ts) {
  const p = {};
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(new Date(ts * 1000)).forEach((x) => { p[x.type] = x.value; });
  p.weekday = p.weekday.replace('.', '');
  return p;
}
const dayKey = (ts) => { const p = parts(ts); return `${p.year}-${p.month}-${p.day}`; };
const fmtTime = (ts) => { const p = parts(ts); return `${p.hour}:${p.minute}`; };
const fmtShort = (ts) => { const p = parts(ts); return `${p.weekday} ${p.day}/${p.month}`; };
const keyToDate = (k) => new Date(k + 'T12:00:00Z');
function fmtLong(key) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(keyToDate(key));
}
function shiftKey(k, days) { const d = keyToDate(k); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function relDay(k) {
  const today = dayKey(nowS());
  if (k === today) return 'hoje';
  if (k === shiftKey(today, 1)) return 'amanhã';
  if (k === shiftKey(today, -1)) return 'ontem';
  return null;
}
function lateText(ts) {
  const min = Math.max(0, Math.floor((nowS() - ts) / 60));
  if (min < 60) return `${min} min de atraso`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h de atraso` : `${Math.floor(h / 24)} dias de atraso`;
}

/** "Next day, same time" label for snooze buttons (mirrors tomorrow_same_time on the server). */
const tomorrowLabel = (t) => fmtTime(t.base_at || t.due_at);

function descPreview(t) {
  if (t.desc_type === 'checklist' && t.checklist.length) {
    const next = t.checklist.find((i) => !i.done);
    return { text: next ? next.t : 'Tudo marcado' };
  }
  const line = (t.notes || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  return { text: line };
}

// ---------- recurrence (mirrors recurs_on / next_occurrence on the server) ----------

const WD_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const RECUR_SHORT = { daily: 'diária', weekdays: 'dias úteis', weekly: 'semanal', monthly: 'mensal' };
const monthDay = (t) => t.recur_days[0] || Number(dayKey(t.base_at).slice(8));
const weekDays = (t) => (t.recur_days.length ? t.recur_days : [keyToDate(dayKey(t.base_at)).getUTCDay()]);

function recurLabel(t) {
  const time = fmtTime(t.base_at);
  if (t.recur === 'daily') return `Todo dia às ${time}`;
  if (t.recur === 'weekdays') return `Dias úteis às ${time}`;
  if (t.recur === 'weekly') return `Toda ${weekDays(t).map((d) => WD_SHORT[d]).join(', ')} às ${time}`;
  if (t.recur === 'monthly') return `Todo dia ${monthDay(t)} às ${time}`;
  return '';
}

function recursOn(t, k) {
  const d = keyToDate(k);
  const wd = d.getUTCDay();
  if (t.recur === 'daily') return true;
  if (t.recur === 'weekdays') return wd >= 1 && wd <= 5;
  if (t.recur === 'weekly') return weekDays(t).includes(wd);
  if (t.recur === 'monthly') {
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return d.getUTCDate() === Math.min(monthDay(t), last);
  }
  return false;
}

/** Timestamp of a day key at the task's time of day. Brasília has no daylight saving time (UTC−3 all year). */
function atKey(k, baseTs) {
  const p = parts(baseTs);
  const [y, m, d] = k.split('-').map(Number);
  return Date.UTC(y, m - 1, d, Number(p.hour) + 3, Number(p.minute)) / 1000;
}

const remindLabel = (m) => (m >= 60 ? `${m / 60} h` : `${m} min`);

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------- auth ----------

function showLogin() {
  state.user = null;
  $('#app').hidden = true;
  $('#login').hidden = false;
}

async function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  await loadTasks();
  refreshNotifications();
  applyWakeLock();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('login', { email: $('#login-email').value, password: $('#login-password').value });
    const me = await api('me');
    Object.assign(state, { user: me.user, vapid: me.vapid });
    e.target.reset();
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

// ---------- data ----------

async function loadTasks() {
  try {
    const r = await api('tasks');
    state.open = r.open;
    state.done = r.done;
    render();
    checkAlarms();
  } catch (err) {
    if (state.user) toast(err.message);
  }
}

const allTasks = () => [...state.open, ...state.done];
const findTask = (id) => allTasks().find((t) => t.id === id);

function replaceTask(t) {
  state.open = state.open.filter((x) => x.id !== t.id);
  state.done = state.done.filter((x) => x.id !== t.id);
  (t.status === 'done' ? state.done : state.open).push(t);
  state.open.sort((a, b) => a.due_at - b.due_at);
}

// ---------- rendering ----------

/** Checklist progress, e.g. 1 of 2 ticked = 50%. */
function progressOf(t) {
  if (t.desc_type !== 'checklist' || !t.checklist.length) return null;
  const n = t.checklist.filter((i) => i.done).length;
  return { n, total: t.checklist.length, pct: Math.round((n / t.checklist.length) * 100) };
}

function progressBar(t) {
  const p = progressOf(t);
  return p ? `<div class="mini" aria-label="${p.n} de ${p.total} itens, ${p.pct}%"><div class="bar"><span style="width:${p.pct}%"></span></div><b>${p.pct}%</b></div>` : '';
}

function taskRow(t) {
  if (t.virtual) {  // a future occurrence of a recurring task, projected on the calendar
    return `<button class="task virtual" data-id="${t.id}">
      <div class="t-time"><b>${fmtTime(t.due_at)}</b><small>${fmtShort(t.due_at)}</small></div>
      <div class="t-main"><div class="t-title">${esc(t.title)}</div><div class="t-desc">${esc(recurLabel(t))}</div></div>
      <div class="t-meta"><span class="pill recur">${icon('repeat')}${RECUR_SHORT[t.recur]}</span></div>
    </button>`;
  }
  const late = t.status !== 'done' && t.due_at <= nowS();
  const d = descPreview(t);
  const when = t.status === 'done' ? fmtShort(t.done_at) : fmtShort(t.due_at);
  return `<button class="task ${late ? 'late' : ''} ${t.status === 'done' ? 'done' : ''} ${state.highlight === t.id ? 'highlight' : ''}" data-id="${t.id}">
    <div class="t-time"><b>${fmtTime(t.status === 'done' ? t.done_at : t.due_at)}</b><small>${late ? 'atrasada' : when}</small></div>
    <div class="t-main"><div class="t-title">${esc(t.title)}</div><div class="t-desc">${esc(d.text)}</div>${progressBar(t)}</div>
    <div class="t-meta">${t.recur && t.status !== 'done' ? `<span class="pill recur">${icon('repeat')}${RECUR_SHORT[t.recur]}</span>` : ''}${t.mode === 'alarm' ? icon('alarm', 'alarm-ic') : icon('bell')}</div>
  </button>`;
}

function renderHeader() {
  const today = dayKey(nowS());
  $('#today-title').textContent = fmtLong(today);
  const late = state.open.filter((t) => t.due_at <= nowS()).length;
  const n = state.open.length;
  $('#today-sub').textContent = n
    ? `${n} ${n === 1 ? 'tarefa ativa' : 'tarefas ativas'}${late ? ` · ${late} ${late === 1 ? 'atrasada' : 'atrasadas'}` : ''}`
    : 'Nenhuma tarefa ativa';
  document.querySelectorAll('#view-nav [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  $('#strip').hidden = state.view !== 'list';
  $('#view-list').hidden = state.view !== 'list';
  $('#view-days').hidden = state.view !== 'days';
}

/** Tasks per day between two day keys, including projected future occurrences of recurring tasks. */
function tasksByDay(from, to) {
  const today = dayKey(nowS());
  const byDay = {};
  allTasks().forEach((t) => {
    const k = dayKey(t.due_at);
    if (k >= from && k <= to) (byDay[k] ||= []).push(t);
  });
  state.open.filter((t) => t.recur).forEach((t) => {
    const start = dayKey(t.due_at) > today ? dayKey(t.due_at) : today;
    for (let k = from; k <= to; k = shiftKey(k, 1)) {
      if (k > start && recursOn(t, k)) (byDay[k] ||= []).push({ ...t, virtual: true, due_at: atKey(k, t.base_at) });
    }
  });
  return byDay;
}

/** Dot colour for a day: late beats active, active beats recurring, recurring beats done. */
function dayDot(list, now) {
  const open = list.filter((t) => t.status !== 'done');
  if (open.some((t) => t.due_at <= now)) return 'late';
  if (open.some((t) => !t.recur)) return 'on';
  if (open.length) return 'recur';
  return list.length ? 'done' : 'none';
}

function renderStrip() {
  const el = $('#strip');
  const now = nowS();
  const today = dayKey(now);
  const from = shiftKey(today, -7);
  const to = shiftKey(today, 60);
  const byDay = tasksByDay(from, to);
  const sel = state.stripDay || today;
  let html = '';
  for (let k = from; k <= to; k = shiftKey(k, 1)) {
    const list = byDay[k] || [];
    const d = keyToDate(k).getUTCDate();
    const wd = WD_SHORT[keyToDate(k).getUTCDay()];
    // On the 1st, the month name replaces the weekday so the carousel shows where months change.
    const top = d === 1
      ? `<small class="mon">${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'short' }).format(keyToDate(k)).replace('.', '')}</small>`
      : `<small>${wd[0].toUpperCase() + wd.slice(1)}</small>`;
    const label = `${fmtLong(k)}${list.length ? `, ${list.length} ${list.length === 1 ? 'tarefa' : 'tarefas'}` : ', sem tarefas'}`;
    html += `<button class="sday ${k === today ? 'today' : ''} ${k < today ? 'past' : ''}" data-sday="${k}" aria-pressed="${k === sel}" aria-label="${label}">
      <i class="sdot ${dayDot(list, now)}"></i>${top}<b>${d}</b></button>`;
  }
  el.innerHTML = html;
  if (!state.stripCentered && !el.hidden) {  // start with the selected day in view
    const btn = el.querySelector('[aria-pressed="true"]');
    if (btn && el.clientWidth) { el.scrollLeft = btn.offsetLeft - 16 - btn.offsetWidth * 2; state.stripCentered = true; }
  }
}

function renderList() {
  const now = nowS();
  const today = dayKey(now);
  const tomorrow = shiftKey(today, 1);
  const sel = state.stripDay || today;
  const isDaily = (t) => t.recur === 'daily';
  const upcoming = state.open.filter((t) => t.due_at > now);
  const onDay = (k) => upcoming.filter((t) => !isDaily(t) && dayKey(t.due_at) === k);
  const groups = [
    ['late', 'Atrasadas', state.open.filter((t) => t.due_at <= now)],
    ['recur-g', 'Diárias', upcoming.filter(isDaily)],
  ];
  let selGroup = '';
  if (sel === today) {
    groups.push(['', 'Hoje', onDay(today)], ['', 'Amanhã', onDay(tomorrow)]);
  } else {
    // The day picked in the carousel: its tasks (done ones too), minus what the groups above already show.
    const list = (tasksByDay(sel, sel)[sel] || [])
      .filter((t) => !(t.status !== 'done' && t.due_at <= now) && !(isDaily(t) && t.status !== 'done'))
      .sort((a, b) => (a.status === 'done') - (b.status === 'done') || a.due_at - b.due_at);
    const rel = relDay(sel);
    const name = rel ? `${rel} · ${fmtLong(sel)}` : fmtLong(sel);
    selGroup = `<section class="group"><h3><span style="color:var(--fg)">${name}</span><button class="back" data-today>Voltar para hoje</button></h3>
      ${list.length ? `<div class="cards">${list.map(taskRow).join('')}</div>`
        : `<div class="empty" style="padding:22px 16px"><p>Nenhuma tarefa neste dia.</p><button class="btn ghost" data-new-day="${sel}">${icon('plus')}Criar tarefa neste dia</button></div>`}
    </section>`;
    groups.push(['', 'Hoje', onDay(today)]);
  }
  let html = '';
  if (!state.open.length && sel === today) {
    html += `<div class="empty"><h2>Tudo em dia</h2><p>Nenhuma tarefa ativa. Toque em Nova tarefa e escolha se ela avisa com notificação ou toca como alarme.</p></div>`;
  }
  groups.forEach(([cls, name, list], i) => {
    if (i === 2 && selGroup) html += selGroup;  // the picked day goes right after Atrasadas and Diárias
    if (list.length) html += `<section class="group ${cls}"><h3>${name}<span>${list.length}</span></h3><div class="cards">${list.map(taskRow).join('')}</div></section>`;
  });
  const recent = state.done.filter((t) => t.done_at > now - 7 * 86400);
  if (recent.length) {
    html += `<details class="group done-group"><summary><h3><span class="chev">›</span> Concluídas nos últimos 7 dias · ${recent.length}</h3></summary>
      <div class="cards">${recent.map(taskRow).join('')}</div></details>`;
  }
  $('#view-list').innerHTML = html;
}

function renderDays() {
  const today = dayKey(nowS());
  if (!state.month) state.month = today.slice(0, 7);
  if (!state.selDay) state.selDay = today;
  const [y, m] = state.month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDay = tasksByDay(`${state.month}-01`, `${state.month}-${String(daysIn).padStart(2, '0')}`);
  const now = nowS();
  let cells = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d) => `<div class="cal-wd" aria-hidden="true">${d}</div>`).join('');
  for (let i = 0; i < first.getUTCDay(); i++) cells += '<span class="day out"></span>';
  for (let d = 1; d <= daysIn; d++) {
    const k = `${state.month}-${String(d).padStart(2, '0')}`;
    const list = byDay[k] || [];
    const dots = list.slice(0, 3).map((t) => `<i class="${t.status === 'done' ? 'done' : t.due_at <= now ? 'late' : t.recur ? 'recur' : ''}"></i>`).join('');
    const label = `${fmtLong(k)}: ${list.length ? list.length + (list.length === 1 ? ' tarefa' : ' tarefas') : 'sem tarefas'}`;
    cells += `<button class="day ${list.length ? 'has' : ''} ${k === today ? 'today' : ''}" data-day="${k}" aria-pressed="${k === state.selDay}" aria-label="${label}">${d}<span class="dots">${dots}</span></button>`;
  }
  const monthName = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(first);
  const sel = (byDay[state.selDay] || []).sort((a, b) => (a.status === 'done') - (b.status === 'done') || a.due_at - b.due_at);
  const rel = relDay(state.selDay);
  $('#view-days').innerHTML = `
    <section class="cal">
      <div class="cal-head">
        <button class="icon" data-month="-1" aria-label="Mês anterior">${icon('left')}</button>
        <h2>${monthName}</h2>
        <button class="icon" data-month="1" aria-label="Próximo mês">${icon('right')}</button>
      </div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-legend"><span><i></i>ativa</span><span><i class="late"></i>atrasada</span><span><i class="recur"></i>recorrente</span><span><i class="done"></i>concluída</span></div>
    </section>
    <div class="day-title"><div><h2>${rel || fmtLong(state.selDay)}</h2>${rel ? `<p class="muted small">${fmtLong(state.selDay)}</p>` : ''}</div>
      <span class="muted small">${sel.length || 'sem'} ${sel.length === 1 ? 'tarefa' : 'tarefas'}</span></div>
    ${sel.length
      ? `<div class="cards">${sel.map(taskRow).join('')}</div>`
      : `<div class="empty"><p>Nenhuma tarefa neste dia.</p><button class="btn ghost" data-new-day="${state.selDay}">${icon('plus')}Criar tarefa neste dia</button></div>`}`;
}

function render() {
  renderHeader();
  if (state.view === 'list') { renderStrip(); renderList(); } else renderDays();
  if (state.highlight) {
    document.querySelector(`.task[data-id="${state.highlight}"]`)?.scrollIntoView({ block: 'center' });
    setTimeout(() => { state.highlight = null; }, 2500);
  }
  if ($('#detail').open && state.detailId) renderDetail();
}

// ---------- navigation ----------

$('#view-nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  state.view = b.dataset.view;
  pref.set('view', state.view);
  render();
});

document.addEventListener('click', (e) => {
  const row = e.target.closest('.task[data-id]');
  if (row) { openDetail(Number(row.dataset.id)); return; }
  if (e.target.closest('[data-new]')) { openEditor(); return; }
  const nd = e.target.closest('[data-new-day]');
  if (nd) { openEditor(null, { day: nd.dataset.newDay }); return; }
  const sday = e.target.closest('[data-sday]');
  if (sday) { state.stripDay = sday.dataset.sday; renderStrip(); renderList(); return; }
  if (e.target.closest('[data-today]')) {
    state.stripDay = null;
    state.stripCentered = false;
    renderStrip();
    renderList();
    return;
  }
  const day = e.target.closest('[data-day]');
  if (day) { state.selDay = day.dataset.day; renderDays(); return; }
  const mon = e.target.closest('[data-month]');
  if (mon) {
    const [y, m] = state.month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + Number(mon.dataset.month), 1));
    state.month = d.toISOString().slice(0, 7);
    renderDays();
    return;
  }
  const close = e.target.closest('[data-close]');
  if (close) close.closest('dialog').close();
});

$('#add-btn').addEventListener('click', () => openEditor(null, state.stripDay && state.view === 'list' ? { day: state.stripDay } : {}));

// ---------- detail ----------

function openDetail(id) {
  state.detailId = id;
  state.confirmDelete = false;
  renderDetail();
  if (!$('#detail').open) $('#detail').showModal();
}

function renderDetail() {
  const t = findTask(state.detailId);
  if (!t) { $('#detail').close(); return; }
  const done = t.status === 'done';
  const late = !done && t.due_at <= nowS();
  const k = dayKey(t.due_at);
  const rel = relDay(k);
  let desc = '';
  if (t.desc_type === 'checklist' && t.checklist.length) {
    const n = t.checklist.filter((i) => i.done).length;
    const pct = progressOf(t).pct;
    desc = `<div class="progress"><span>${n} de ${t.checklist.length}</span><div class="bar"><span style="width:${pct}%"></span></div><b>${pct}%</b></div>
      <ul class="checks">${t.checklist.map((it, i) => `<li><label><input type="checkbox" data-check="${i}" ${it.done ? 'checked' : ''} ${done ? 'disabled' : ''}><span>${esc(it.t)}</span></label></li>`).join('')}</ul>`;
  } else if (t.notes) {
    desc = `<div class="d-notes">${linkify(esc(t.notes))}</div>`;
  }
  const delLabel = state.confirmDelete ? 'Confirmar exclusão' : t.recur ? 'Excluir série' : 'Excluir';
  const actions = done
    ? `<div class="d-row"><button class="btn ghost" data-d="reopen">${icon('undo')}Reabrir</button>
        <button class="btn ghost danger" data-d="delete">${icon('trash')}${delLabel}</button></div>`
    : `<button class="btn wide" data-d="done">${icon('check')}${t.recur ? 'Concluir esta vez' : 'Concluir tarefa'}</button>
      ${t.recur ? `<button class="btn ghost wide" data-d="skip">${icon('skip')}Pular esta vez</button>` : ''}
      ${late ? `<p class="fld" style="margin:4px 0 -4px">Adiar</p>
      <div class="d-snooze">
        <button data-d="s5">+5 min</button><button data-d="s30">+30 min</button>
        <button data-d="tomorrow">Dia seguinte<small>às ${tomorrowLabel(t)}</small></button>
      </div>` : ''}
      <div class="d-row"><button class="btn ghost" data-d="edit">${icon('edit')}Editar</button>
        <button class="btn ghost danger" data-d="delete">${icon('trash')}${delLabel}</button></div>`;
  $('#detail').innerHTML = `<div class="inner">
    <div class="sheet-head">
      <div class="d-tags">
        <span class="d-mode ${t.mode === 'alarm' ? 'alarm' : ''}">${icon(t.mode === 'alarm' ? 'alarm' : 'bell')}${t.mode === 'alarm' ? 'Alarme' : 'Notificação'}</span>
        ${t.recur && !done ? `<span class="d-mode recur">${icon('repeat')}${recurLabel(t)}</span>` : ''}
        ${t.remind_before && !done ? `<span class="d-mode">Aviso ${remindLabel(t.remind_before)} antes</span>` : ''}
      </div>
      <button class="icon" data-close aria-label="Fechar">${icon('x')}</button>
    </div>
    <h2 class="d-title">${esc(t.title)}</h2>
    <p class="d-when">${icon('clock')}${rel ? rel + ', ' : ''}${fmtLong(k)} · ${fmtTime(t.due_at)}
      ${done ? `<span class="ok">· concluída ${fmtShort(t.done_at)} ${fmtTime(t.done_at)}</span>` : late ? `<span class="late">· ${lateText(t.due_at)}</span>` : ''}</p>
    ${desc}
    ${actions}
  </div>`;
}

function linkify(html) {
  return html.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
}

$('#detail').addEventListener('change', async (e) => {
  const cb = e.target.closest('[data-check]');
  if (!cb) return;
  const t = findTask(state.detailId);
  t.checklist[Number(cb.dataset.check)].done = cb.checked;  // optimistic
  renderDetail();
  try {
    const r = await api('check', { id: t.id, index: Number(cb.dataset.check), done: cb.checked });
    replaceTask(r.task);
    render();
  } catch (err) {
    toast(err.message);
    loadTasks();
  }
});

$('#detail').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-d]');
  if (!b) return;
  const t = findTask(state.detailId);
  const a = b.dataset.d;
  if (a === 'edit') { $('#detail').close(); openEditor(t); return; }
  if (a === 'delete' && !state.confirmDelete) { state.confirmDelete = true; renderDetail(); return; }
  const map = {
    done: ['done', {}, t.recur ? 'Concluída. Vai para a próxima ocorrência.' : 'Tarefa concluída'],
    skip: ['skip', {}, 'Pulada. Vai para a próxima ocorrência.'], reopen: ['reopen', {}, 'Tarefa reaberta'], delete: ['delete', {}, 'Tarefa excluída'],
    s5: ['snooze', { minutes: 5 }, 'Adiada 5 min'], s30: ['snooze', { minutes: 30 }, 'Adiada 30 min'],
    tomorrow: ['snooze', { until: 'tomorrow' }, `Adiada para o dia seguinte às ${tomorrowLabel(t)}`],
  };
  const [action, extra, msg] = map[a];
  $('#detail').close();
  await act(t.id, action, extra, msg);
});

async function act(id, action, extra, msg) {
  try {
    const r = await api('act', { id, action, ...extra });
    closeNotifications(id);
    toast(r.task?.recur && (action === 'done' || action === 'skip')
      ? `Próxima: ${relDay(dayKey(r.task.due_at)) || fmtShort(r.task.due_at)} às ${fmtTime(r.task.due_at)}`
      : msg);
    await loadTasks();
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

// ---------- editor ----------

const pad = (n) => String(n).padStart(2, '0');

function setDue(ts) {
  const p = parts(ts);
  $('#f-date').value = `${p.year}-${p.month}-${p.day}`;
  $('#f-time').value = `${p.hour}:${p.minute}`;
}

function openEditor(task = null, preset = {}) {
  state.editId = task ? task.id : null;
  $('#editor-title').textContent = task ? 'Editar tarefa' : 'Nova tarefa';
  $('#editor-error').textContent = '';
  $('#f-title').value = task ? task.title : '';
  $('#f-notes').value = task ? task.notes : '';
  state.items = task ? task.checklist.map((i) => ({ ...i })) : [];
  setMode(task ? task.mode : pref.get('lastMode') || 'push');
  state.wdays = task && task.recur === 'weekly' ? [...task.recur_days] : [];
  setRecur(task ? task.recur : '');
  setRemind(task ? task.remind_before : 0);
  setDescType(task ? task.desc_type : 'text', false);
  if (task) setDue(task.due_at);
  else {
    setDue(Math.ceil((nowS() + 3600) / 1800) * 1800);
    if (preset.day) $('#f-date').value = preset.day;
  }
  recurHint();
  $('#editor').showModal();
  if (!task) setTimeout(() => $('#f-title').focus(), 50);
}

function setRecur(r) {
  state.recur = r;
  document.querySelectorAll('#f-recur [data-r]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.r === r)));
  $('#f-wdays').hidden = r !== 'weekly';
  if (r === 'weekly' && !state.wdays.length && $('#f-date').value) state.wdays = [keyToDate($('#f-date').value).getUTCDay()];
  document.querySelectorAll('#f-wdays [data-wd]').forEach((b) => b.setAttribute('aria-pressed', String(state.wdays.includes(Number(b.dataset.wd)))));
  recurHint();
}

function setRemind(m) {
  state.remind = Number(m);
  document.querySelectorAll('#f-remind [data-m]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.m) === state.remind)));
}

/** Plain-language summary of the repeat rule under the buttons. */
function recurHint() {
  const h = $('#f-recur-hint');
  const date = $('#f-date').value;
  const time = $('#f-time').value || '--:--';
  h.hidden = !state.recur;
  if (!state.recur || !date) return;
  const dom = Number(date.slice(8));
  const days = [...state.wdays].sort();
  h.textContent = {
    daily: `Repete todo dia às ${time}.`,
    weekdays: `Repete de segunda a sexta às ${time}.`,
    weekly: days.length ? `Repete toda ${days.map((d) => WD_SHORT[d]).join(', ')} às ${time}.` : 'Escolha os dias da semana.',
    monthly: `Repete todo dia ${dom} às ${time}.${dom > 28 ? ' Em meses mais curtos, no último dia do mês.' : ''}`,
  }[state.recur] + ' Ao concluir, a próxima já fica agendada.';
}

$('#f-recur').addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) setRecur(b.dataset.r); });
$('#f-wdays').addEventListener('click', (e) => {
  const b = e.target.closest('[data-wd]');
  if (!b) return;
  const d = Number(b.dataset.wd);
  state.wdays = state.wdays.includes(d) ? state.wdays.filter((x) => x !== d) : [...state.wdays, d];
  setRecur('weekly');
});
$('#f-remind').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) setRemind(b.dataset.m); });
['#f-date', '#f-time'].forEach((s) => $(s).addEventListener('change', recurHint));

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('#f-mode [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
}

function setDescType(type, convert = true) {
  if (convert && type !== state.descType) {
    if (type === 'checklist') {
      const lines = $('#f-notes').value.split('\n').map((s) => s.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
      if (lines.length && !state.items.length) state.items = lines.map((t) => ({ t, done: false }));
    } else if (!$('#f-notes').value.trim() && state.items.length) {
      $('#f-notes').value = state.items.map((i) => '- ' + i.t).join('\n');
    }
  }
  state.descType = type;
  document.querySelectorAll('#f-desc-type [data-dt]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dt === type)));
  $('#f-notes').hidden = type !== 'text';
  $('#f-checklist').hidden = type !== 'checklist';
  if (type === 'checklist') {
    if (!state.items.length) state.items = [{ t: '', done: false }];
    renderItems();
  }
}

function renderItems(focus = null) {
  $('#f-items').innerHTML = state.items.map((it, i) => `<li>
      <input type="checkbox" data-idone="${i}" ${it.done ? 'checked' : ''} aria-label="Marcado">
      <input type="text" id="f-item-${i}" data-item="${i}" value="${esc(it.t)}" placeholder="Item ${i + 1}" maxlength="300">
      <button type="button" class="icon" data-irm="${i}" aria-label="Remover item">${icon('x')}</button>
    </li>`).join('');
  if (focus !== null) $(`#f-item-${focus}`)?.focus();
}

$('#f-mode').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
$('#f-desc-type').addEventListener('click', (e) => { const b = e.target.closest('[data-dt]'); if (b) setDescType(b.dataset.dt); });
$('#f-add-item').addEventListener('click', () => { state.items.push({ t: '', done: false }); renderItems(state.items.length - 1); });
$('#f-items').addEventListener('input', (e) => { const i = e.target.dataset.item; if (i !== undefined) state.items[i].t = e.target.value; });
$('#f-items').addEventListener('change', (e) => { const i = e.target.dataset.idone; if (i !== undefined) state.items[i].done = e.target.checked; });
$('#f-items').addEventListener('click', (e) => {
  const b = e.target.closest('[data-irm]');
  if (!b) return;
  state.items.splice(Number(b.dataset.irm), 1);
  if (!state.items.length) state.items.push({ t: '', done: false });
  renderItems(Math.max(0, Number(b.dataset.irm) - 1));
});
$('#f-items').addEventListener('keydown', (e) => {
  const i = e.target.dataset.item;
  if (i === undefined) return;
  const n = Number(i);
  if (e.key === 'Enter') {
    e.preventDefault();
    state.items.splice(n + 1, 0, { t: '', done: false });
    renderItems(n + 1);
  } else if (e.key === 'Backspace' && e.target.value === '' && state.items.length > 1) {
    e.preventDefault();
    state.items.splice(n, 1);
    renderItems(Math.max(0, n - 1));
  }
});

$('#f-quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-q]');
  if (!b) return;
  const today = dayKey(nowS());
  if (b.dataset.q === 'today') $('#f-date').value = today;
  if (b.dataset.q === 'tomorrow') $('#f-date').value = shiftKey(today, 1);
  if (b.dataset.q === '1h') setDue(Math.ceil((nowS() + 3600) / 300) * 300);
  if (b.dataset.q === 'monday') {
    const wd = keyToDate(today).getUTCDay();
    $('#f-date').value = shiftKey(today, ((8 - wd) % 7) || 7);
  }
  recurHint();
});

$('#editor-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#f-title').value.trim();
  const date = $('#f-date').value;
  const time = $('#f-time').value;
  if (!title) { $('#editor-error').textContent = 'Dê um título para a tarefa.'; $('#f-title').focus(); return; }
  if (!date || !time) { $('#editor-error').textContent = 'Escolha data e hora.'; return; }
  if (state.recur === 'weekly' && !state.wdays.length) { $('#editor-error').textContent = 'Escolha pelo menos um dia da semana.'; return; }
  try {
    const r = await api('save', {
      id: state.editId, title, due: `${date}T${time}`, mode: state.mode, desc_type: state.descType,
      notes: $('#f-notes').value, checklist: state.items.filter((i) => i.t.trim()),
      recur: state.recur, recur_days: state.wdays, remind_before: state.remind,
    });
    pref.set('lastMode', state.mode);
    $('#editor').close();
    toast(`${r.task.mode === 'alarm' ? 'Alarme' : 'Lembrete'} para ${relDay(dayKey(r.task.due_at)) || fmtShort(r.task.due_at)} às ${fmtTime(r.task.due_at)}`);
    state.highlight = r.task.id;
    loadTasks();
  } catch (err) {
    $('#editor-error').textContent = err.message;
  }
});

/** Fills title, date and time from free text such as "pagar boleto sexta 10h". */
function applyParsed(r) {
  $('#f-title').value = r.title;
  if (r.due_at) { setDue(r.due_at); $('#editor-error').textContent = ''; }
  else $('#editor-error').textContent = 'Não achei data ou hora no texto. Escolha abaixo.';
}

$('#f-magic').addEventListener('click', async () => {
  const text = $('#f-title').value.trim();
  if (!text) { toast('Escreva a tarefa primeiro, ex: "pagar boleto sexta 10h".'); return; }
  const b = $('#f-magic');
  b.disabled = true;
  try { applyParsed(await api('parse', { text })); } catch (err) { $('#editor-error').textContent = err.message; }
  b.disabled = false;
});

let recorder = null;
$('#f-mic').addEventListener('click', async () => {
  const btn = $('#f-mic');
  if (recorder) { recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Este navegador não grava áudio. Use o ditado do teclado.'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast('Permita o acesso ao microfone para gravar.'); return; }
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopTimer = setTimeout(() => recorder?.stop(), 60000);
  recorder.onstop = async () => {
    clearTimeout(stopTimer);
    stream.getTracks().forEach((t) => t.stop());
    btn.classList.remove('recording');
    btn.innerHTML = icon('mic');
    const mime = recorder.mimeType || type;
    recorder = null;
    const blob = new Blob(chunks, { type: mime });
    if (blob.size < 1000) { toast('Áudio muito curto.'); return; }
    const fd = new FormData();
    fd.append('audio', blob, mime.includes('mp4') ? 'audio.m4a' : 'audio.webm');
    btn.disabled = true;
    toast('Transcrevendo…', 8000);
    try {
      const r = await api('audio', fd);
      applyParsed(r);
      toast(`"${r.transcript}"`, 4000);
    } catch (err) {
      $('#editor-error').textContent = err.message;
    }
    btn.disabled = false;
  };
  recorder.start();
  btn.classList.add('recording');
  btn.innerHTML = icon('stop');
  toast('Gravando… toque de novo para parar.', 2500);
});

// ---------- alarm: sound, vibration and full-screen ringing ----------

const Sound = {
  ctx: null,
  timer: null,
  unlock() {
    try {
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const src = this.ctx.createBufferSource();  // a silent blip unlocks audio on iOS
      src.buffer = this.ctx.createBuffer(1, 1, 22050);
      src.connect(this.ctx.destination);
      src.start(0);
    } catch { /* no Web Audio */ }
  },
  ready() { return !!this.ctx && this.ctx.state === 'running'; },
  beep(t, freq, dur) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.01);
    g.gain.setValueAtTime(0.22, t + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  },
  pattern() {  // classic digital alarm: four quick beeps, then a pause
    const t = this.ctx.currentTime + 0.03;
    for (let i = 0; i < 4; i++) this.beep(t + i * 0.16, 1046, 0.1);
  },
  start() {
    this.stop();
    const play = () => {
      if (this.ready()) this.pattern();
      navigator.vibrate?.([300, 100, 300, 100, 300]);
    };
    play();
    this.timer = setInterval(play, 1300);
  },
  stop() {
    clearInterval(this.timer);
    this.timer = null;
    navigator.vibrate?.(0);
  },
};
document.addEventListener('pointerdown', () => { if (!Sound.ready()) Sound.unlock(); }, { passive: true });

/** Rings for any alarm task that is due while the app is open. */
function checkAlarms() {
  if (!state.user || state.alarm) return;
  const t = state.open.find((x) => x.mode === 'alarm' && x.due_at <= nowS() && !state.silenced[`${x.id}:${x.due_at}`]);
  if (t) openAlarm(t);
}
setInterval(checkAlarms, 5000);

function openAlarm(t) {
  state.alarm = t;
  ['#detail', '#editor', '#settings'].forEach((s) => $(s).open && $(s).close());
  $('#toast').classList.remove('show');
  $('#alarm-time').textContent = fmtTime(t.due_at);
  $('#alarm-title').textContent = t.title;
  $('#alarm-desc').textContent = descPreview(t).text;
  $('#alarm-tomorrow').textContent = `às ${tomorrowLabel(t)}`;
  $('#alarm').hidden = false;
  $('#alarm').classList.add('ringing');
  Sound.unlock();
  Sound.start();
  setTimeout(() => { $('#alarm-sound').hidden = Sound.ready(); }, 400);
}

function closeAlarm() {
  Sound.stop();
  $('#alarm').hidden = true;
  $('#alarm').classList.remove('ringing');
  state.alarm = null;
}

$('#alarm-sound').addEventListener('click', () => { Sound.unlock(); Sound.start(); setTimeout(() => { $('#alarm-sound').hidden = Sound.ready(); }, 300); });

$('#alarm').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-al]');
  if (!b) return;
  const t = state.alarm;
  state.silenced[`${t.id}:${t.due_at}`] = true;
  closeAlarm();
  const a = b.dataset.al;
  const ok = a === 'done'
    ? await act(t.id, 'done', {}, 'Tarefa concluída')
    : a === 'tomorrow'
      ? await act(t.id, 'snooze', { until: 'tomorrow' }, `Adiada para amanhã às ${tomorrowLabel(t)}`)
      : await act(t.id, 'snooze', { minutes: Number(a) }, `Adiada ${a} min`);
  if (!ok) { delete state.silenced[`${t.id}:${t.due_at}`]; checkAlarms(); }
});

// "Modo despertador": keep the screen on while the app is open, so alarms ring with sound.
let wakeLock = null;
async function applyWakeLock() {
  const on = pref.get('wake') === '1';
  $('#wake-toggle').checked = on;
  const chip = $('#wake-chip');
  chip.hidden = !on;
  chip.innerHTML = `${icon('moon')}Despertador`;
  if (on && !document.hidden && 'wakeLock' in navigator) {
    try {
      if (!wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch { /* not allowed right now */ }
  } else if (!on && wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}
$('#wake-toggle').addEventListener('change', (e) => {
  pref.set('wake', e.target.checked ? '1' : '0');
  if (e.target.checked) {
    Sound.unlock();
    toast('Modo despertador ligado: a tela fica acesa com o app aberto');
  }
  applyWakeLock();
});
$('#wake-chip').addEventListener('click', () => { $('#wake-toggle').checked = false; pref.set('wake', '0'); applyWakeLock(); toast('Modo despertador desligado'); });

$('#test-sound').addEventListener('click', () => {
  Sound.unlock();
  Sound.start();
  setTimeout(() => Sound.stop(), 3000);
  setTimeout(() => { if (!Sound.ready()) toast('O navegador bloqueou o som. Confira se o celular não está no silencioso.'); }, 500);
});

// ---------- push notifications ----------

function b64ToBytes(s) {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function swReg() {
  return 'serviceWorker' in navigator ? navigator.serviceWorker.ready : null;
}

async function closeNotifications(id) {
  const reg = await swReg();
  if (!reg) return;
  (await reg.getNotifications({ tag: 'task-' + id })).forEach((n) => n.close());
}

async function subscribe() {
  const reg = await swReg();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(state.vapid) });
  await api('subscribe', sub.toJSON());
}

async function refreshNotifications() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let html;
  let banner = '';
  if (isIOS && !isStandalone) {
    html = `<p>No iPhone, as notificações só funcionam com o app instalado: no <b>Safari</b>, toque em <b>Compartilhar</b>, depois em <b>Adicionar à Tela de Início</b>, e abra pelo ícone.</p>`;
    banner = `<div class="banner"><p>Para receber lembretes e alarmes, instale o app: <b>Compartilhar → Adicionar à Tela de Início</b>.</p></div>`;
  } else if (!supported) {
    html = '<p>Este navegador não recebe notificações. Use o Chrome no Android ou o Safari no iPhone.</p>';
    banner = `<div class="banner"><p>Este navegador não recebe notificações. Use o Chrome no Android ou o Safari no iPhone.</p></div>`;
  } else if (Notification.permission === 'denied') {
    html = `<p>Notificações <b>bloqueadas</b>. Libere em ${isIOS ? 'Ajustes → Notificações → Tarefas' : 'informações do site (ícone ao lado do endereço) → Notificações'}.</p>`;
    banner = `<div class="banner"><p>Notificações bloqueadas neste aparelho. Sem elas, lembretes e alarmes só aparecem com o app aberto.</p></div>`;
  } else if (Notification.permission === 'granted') {
    try {
      await subscribe();
      html = `<p class="ok">Ativadas neste aparelho.</p><button class="btn ghost" id="test-push">Enviar notificação de teste</button>`;
    } catch (err) {
      html = `<p class="error">Falha ao ativar: ${esc(err.message)}</p><button class="btn" id="enable-push">Tentar de novo</button>`;
    }
  } else {
    html = `<p class="muted">Ative para receber lembretes e alarmes com o app fechado.</p><button class="btn" id="enable-push">Ativar notificações</button>`;
    banner = `<div class="banner"><p>Ative as notificações para receber lembretes e alarmes com o app fechado.</p><button class="btn" data-enable>Ativar</button></div>`;
  }
  $('#notif-status').innerHTML = html;
  $('#banner').innerHTML = banner;
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('#enable-push, [data-enable]')) {
    Sound.unlock();
    try { if (await Notification.requestPermission() === 'granted') toast('Notificações ativadas'); } catch (err) { toast(err.message); }
    refreshNotifications();
  }
  if (e.target.closest('#test-push')) {
    try {
      const r = await api('test_push', null, { post: true });
      toast(r.sent ? 'Teste enviado. Deve chegar em segundos.' : 'Nenhum aparelho recebeu. Desative e ative de novo.');
    } catch (err) { toast(err.message); }
  }
});

// ---------- settings ----------

$('#open-settings').addEventListener('click', () => {
  $('#me-line').textContent = `${state.user.name} · ${state.user.email}`;
  $('#admin-section').hidden = !state.user.is_admin;
  if (state.user.is_admin) loadUsers();
  refreshNotifications();
  applyWakeLock();
  $('#settings').showModal();
});

$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('password', { current: $('#pw-current').value, new: $('#pw-new').value });
    e.target.reset();
    toast('Senha alterada');
  } catch (err) { toast(err.message); }
});

let confirmUser = null;
async function loadUsers() {
  const r = await api('users');
  $('#users').innerHTML = r.users.map((u) => `<li data-id="${u.id}">
      <div>${esc(u.name)}${u.is_admin ? ' · admin' : ''}<br><small>${esc(u.email)}</small></div>
      <button class="btn ghost" data-u="reset">Nova senha</button>
      ${u.id === state.user.id ? '' : `<button class="btn ghost danger" data-u="del">${confirmUser === u.id ? 'Confirmar' : 'Remover'}</button>`}
    </li>`).join('');
}

$('#users').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-u]');
  if (!b) return;
  const id = Number(b.closest('li').dataset.id);
  try {
    if (b.dataset.u === 'reset') {
      const password = prompt('Nova senha para este usuário (mín. 8 caracteres):');
      if (!password) return;
      await api('user_save', { id, password });
      toast('Senha redefinida. Passe a nova senha para a pessoa.');
    } else if (confirmUser !== id) {
      confirmUser = id;
    } else {
      await api('user_delete', { id });
      confirmUser = null;
      toast('Usuário removido');
    }
    loadUsers();
  } catch (err) { toast(err.message); }
});

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('user_save', { name: $('#u-name').value, email: $('#u-email').value, password: $('#u-password').value });
    e.target.reset();
    toast('Usuário criado. Passe o e-mail e a senha para a pessoa.');
    loadUsers();
  } catch (err) { toast(err.message); }
});

$('#logout').addEventListener('click', async () => {
  try {
    const reg = await swReg();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await api('unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    await api('logout', null, { post: true });
  } catch { /* logging out anyway */ }
  $('#settings').close();
  showLogin();
});

// ---------- boot ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'refresh') loadTasks();
    if (e.data?.type === 'open' && e.data.id) { state.highlight = e.data.id; loadTasks(); }
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !state.user) return;
  loadTasks();
  applyWakeLock();
});
setInterval(() => { if (!document.hidden && state.user) loadTasks(); }, 30000);

paintIcons();
state.view = pref.get('view') === 'days' ? 'days' : 'list';

(async function boot() {
  const t = Number(new URLSearchParams(location.search).get('t'));
  if (t) { state.highlight = t; history.replaceState(null, '', location.pathname); }
  try {
    const me = await api('me');
    Object.assign(state, { user: me.user, vapid: me.vapid });
    showApp();
  } catch {
    showLogin();
  }
})();
