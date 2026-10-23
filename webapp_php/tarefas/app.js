'use strict';

const TZ = 'America/Sao_Paulo';
const $ = (s) => document.querySelector(s);
const state = { user: null, vapid: null, open: [], done: [], highlight: null, snoozeId: null, editId: null };

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
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function parts(ts) {
  const p = {};
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(new Date(ts * 1000)).forEach((x) => { p[x.type] = x.value; });
  return p;
}

function dayKey(ts) { const p = parts(ts); return `${p.year}${p.month}${p.day}`; }

function fmtWhen(ts) {
  const p = parts(ts);
  const now = Date.now() / 1000;
  const time = `${p.hour}:${p.minute}`;
  if (dayKey(ts) === dayKey(now)) return `hoje às ${time}`;
  if (dayKey(ts) === dayKey(now + 86400)) return `amanhã às ${time}`;
  if (dayKey(ts) === dayKey(now - 86400)) return `ontem às ${time}`;
  return `${p.weekday.replace('.', '')} ${p.day}/${p.month} às ${time}`;
}

function fmtLate(ts) {
  const min = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 60));
  if (min < 60) return `${min} min de atraso`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h}h de atraso` : `${Math.floor(h / 24)} dias de atraso`;
}

function toInput(ts) {
  const p = parts(ts);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

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
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#login-error').textContent = '';
  try {
    await api('login', { email: f.get('email'), password: f.get('password') });
    const me = await api('me');
    Object.assign(state, { user: me.user, vapid: me.vapid });
    e.target.reset();
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

// ---------- tasks ----------

async function loadTasks() {
  try {
    const r = await api('tasks');
    state.open = r.open;
    state.done = r.done;
    render();
  } catch (err) {
    if (state.user) toast(err.message);
  }
}

function taskCard(t) {
  const nag = t.status === 'nagging';
  const meta = nag ? `🔔 ${fmtLate(t.due_at)} · cobrança a cada 5 min` : `🕒 ${fmtWhen(t.due_at)}`;
  return `<article class="task ${nag ? 'nagging' : ''} ${state.highlight === t.id ? 'highlight' : ''}" data-id="${t.id}">
    <div class="task-text">${esc(t.text)}</div>
    <div class="task-meta">${meta}</div>
    <div class="task-actions">
      <button class="done-btn" data-act="done">✅ Feito</button>
      <button data-act="snooze">⏰ Adiar</button>
      <span class="spacer"></span>
      <button data-act="edit" aria-label="Editar">✏️</button>
    </div>
  </article>`;
}

function render() {
  const nagging = state.open.filter((t) => t.status === 'nagging');
  const upcoming = state.open.filter((t) => t.status !== 'nagging');
  let html = '';
  if (!state.open.length) {
    html += `<div class="empty"><b>🎉</b>Nada pendente.<br>Escreva ou grave abaixo o que você precisa lembrar.</div>`;
  }
  if (nagging.length) html += `<h3 class="section-title">Cobrando agora</h3>` + nagging.map(taskCard).join('');
  if (upcoming.length) html += `<h3 class="section-title">Próximas</h3>` + upcoming.map(taskCard).join('');
  if (state.done.length) {
    html += `<details><summary><h3 class="section-title">Concluídas (${state.done.length}) ▾</h3></summary>`
      + state.done.map((t) => `<article class="task done" data-id="${t.id}">
          <div class="task-text">${esc(t.text)}</div>
          <div class="task-meta">✅ ${fmtWhen(t.done_at)}</div>
          <div class="task-actions"><button data-act="reopen">↩️ Reabrir</button><span class="spacer"></span><button data-act="delete">🗑️</button></div>
        </article>`).join('')
      + `</details>`;
  }
  $('#list').innerHTML = html;
  if (state.highlight) document.querySelector(`.task[data-id="${state.highlight}"]`)?.scrollIntoView({ block: 'center' });
}

async function act(id, action, extra = {}) {
  try {
    await api('act', { id, action, ...extra });
    closeNotifications(id);
    const msgs = { done: '✅ Feito!', delete: '🗑️ Excluída', reopen: '↩️ Reaberta (lembro em 5 min)', snooze: '⏰ Adiada' };
    toast(msgs[action] || 'Ok');
    loadTasks();
  } catch (err) {
    toast(err.message);
  }
}

$('#list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = Number(btn.closest('.task').dataset.id);
  const a = btn.dataset.act;
  if (a === 'done' || a === 'reopen') act(id, a);
  else if (a === 'delete') { if (confirm('Excluir esta tarefa?')) act(id, 'delete'); }
  else if (a === 'snooze') { state.snoozeId = id; $('#snooze').showModal(); }
  else if (a === 'edit') openEditor(state.open.find((t) => t.id === id));
});

$('#snooze').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  $('#snooze').close();
  if (b.dataset.min) act(state.snoozeId, 'snooze', { minutes: Number(b.dataset.min) });
  else if (b.dataset.until) act(state.snoozeId, 'snooze', { until: b.dataset.until });
});

// ---------- editor ----------

function openEditor(task, preset = {}) {
  const f = $('#editor-form');
  state.editId = task ? task.id : null;
  $('#editor-title').textContent = task ? 'Editar tarefa' : 'Nova tarefa';
  $('#editor-delete').hidden = !task;
  $('#editor-error').textContent = preset.error || '';
  f.text.value = task ? task.text : preset.text || '';
  const due = task ? task.due_at : Math.ceil((Date.now() / 1000 + 3600) / 900) * 900;
  f.due.value = toInput(due);
  $('#editor').showModal();
  if (preset.focusDate) f.due.focus();
}

$('#editor-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await api('save', { id: state.editId, text: f.text.value, due: f.due.value });
    $('#editor').close();
    toast(`📌 ${r.task.text} — ${fmtWhen(r.task.due_at)}`);
    loadTasks();
  } catch (err) {
    $('#editor-error').textContent = err.message;
  }
});
$('#editor-cancel').addEventListener('click', () => $('#editor').close());
$('#editor-delete').addEventListener('click', () => {
  if (!confirm('Excluir esta tarefa?')) return;
  $('#editor').close();
  act(state.editId, 'delete');
});
$('#manual-btn').addEventListener('click', () => openEditor(null, { text: $('#composer-text').value.trim() }));

// ---------- composer: text and voice ----------

const textEl = $('#composer-text');

function syncComposer() {
  textEl.style.height = 'auto';
  textEl.style.height = Math.min(textEl.scrollHeight, 120) + 'px';
  const has = textEl.value.trim() !== '';
  $('#send-btn').hidden = !has;
  $('#mic-btn').hidden = has;
}
textEl.addEventListener('input', syncComposer);
textEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !isIOS) { e.preventDefault(); $('#composer').requestSubmit(); }
});

function handleCreated(r) {
  if (r.task) {
    toast(`📌 ${r.task.text} — ${fmtWhen(r.task.due_at)}`, 5000);
    state.highlight = r.task.id;
    loadTasks();
  } else if (r.need_date) {
    openEditor(null, { text: r.text, error: r.error || 'Quando devo te lembrar?', focusDate: true });
  }
}

async function busy(fn) {
  $('#composer').classList.add('busy');
  try { await fn(); } catch (err) { toast(err.message, 5000); } finally { $('#composer').classList.remove('busy'); }
}

$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = textEl.value.trim();
  if (!text) return;
  busy(async () => {
    const r = await api('create', { text });
    textEl.value = '';
    syncComposer();
    handleCreated(r);
  });
});

let recorder = null;
let recTimer = null;

$('#mic-btn').addEventListener('click', async () => {
  if (recorder) { recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('Este navegador não grava áudio. Use o ditado do teclado.');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast('Permita o acesso ao microfone para gravar.');
    return;
  }
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    clearTimeout(recTimer);
    $('#mic-btn').classList.remove('recording');
    $('#mic-btn').textContent = '🎙️';
    const mime = recorder.mimeType || type;
    recorder = null;
    const blob = new Blob(chunks, { type: mime });
    if (blob.size < 1000) { toast('Áudio muito curto.'); return; }
    const fd = new FormData();
    fd.append('audio', blob, mime.includes('mp4') ? 'audio.m4a' : 'audio.webm');
    busy(async () => {
      toast('🎙️ Transcrevendo…', 10000);
      const r = await api('audio', fd);
      toast(`🎙️ "${r.transcript}"`, 4000);
      handleCreated(r);
    });
  };
  recorder.start();
  $('#mic-btn').classList.add('recording');
  $('#mic-btn').textContent = '⏹';
  toast('Gravando… toque de novo para enviar.', 2500);
  recTimer = setTimeout(() => recorder?.stop(), 120000);
});

// ---------- notifications ----------

function b64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
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
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(state.vapid) });
  }
  await api('subscribe', sub.toJSON());
  return sub;
}

/** Works out whether this device can get push, and shows the right banner and settings. */
async function refreshNotifications() {
  const banner = $('#banner');
  const status = $('#notif-status');
  let html;
  let bannerHtml = '';
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  if (isIOS && !isStandalone) {
    html = `<p>No iPhone, as notificações só funcionam com o app instalado:</p>
      <ol><li>Abra este endereço no <b>Safari</b></li><li>Toque em <b>Compartilhar</b> (quadrado com seta ↑)</li>
      <li>Toque em <b>Adicionar à Tela de Início</b></li><li>Abra o app pelo ícone <b>Tarefas</b> e ative aqui</li></ol>`;
    bannerHtml = `<div class="banner">📲 Para receber os lembretes, instale o app: <b>Compartilhar → Adicionar à Tela de Início</b>, e abra pelo ícone.</div>`;
  } else if (!supported) {
    html = '<p>Este navegador não suporta notificações. Use o Chrome (Android) ou o Safari (iPhone).</p>';
    bannerHtml = `<div class="banner">⚠️ Este navegador não recebe notificações. Use o Chrome no Android ou o Safari no iPhone.</div>`;
  } else if (Notification.permission === 'denied') {
    html = `<p>As notificações estão <b>bloqueadas</b>. Libere em: ${isIOS ? 'Ajustes → Notificações → Tarefas' : 'cadeado/ⓘ ao lado do endereço → Permissões → Notificações'}.</p>`;
    bannerHtml = `<div class="banner">🔕 Notificações bloqueadas neste aparelho. Libere nas configurações do ${isIOS ? 'iPhone' : 'navegador'}.</div>`;
  } else if (Notification.permission === 'granted') {
    try {
      await subscribe();
      html = `<p class="ok">✅ Ativadas neste aparelho.</p><div class="row"><button id="test-push">Enviar teste</button></div>`;
    } catch (err) {
      html = `<p class="error">Falha ao ativar: ${esc(err.message)}</p><button id="enable-push" class="primary">Tentar de novo</button>`;
    }
  } else {
    html = `<p>Ative para receber os lembretes e cobranças mesmo com o app fechado.</p><button id="enable-push" class="primary">Ativar notificações</button>`;
    bannerHtml = `<div class="banner">🔔 Ative as notificações para receber os lembretes.<br><button class="primary" data-enable>Ativar notificações</button></div>`;
  }
  status.innerHTML = html;
  banner.innerHTML = bannerHtml;
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') toast('🔔 Notificações ativadas!');
  } catch (err) {
    toast(err.message);
  }
  refreshNotifications();
}

document.addEventListener('click', async (e) => {
  if (e.target.matches('#enable-push, [data-enable]')) enablePush();
  if (e.target.id === 'test-push') {
    try {
      const r = await api('test_push', null, { post: true });
      toast(r.sent ? '📨 Teste enviado! Deve chegar em segundos.' : 'Nenhum aparelho recebeu. Tente desativar e ativar de novo.');
    } catch (err) {
      toast(err.message);
    }
  }
});

// ---------- settings ----------

$('#open-settings').addEventListener('click', () => {
  $('#me-line').textContent = `${state.user.name} · ${state.user.email}`;
  $('#admin-section').hidden = !state.user.is_admin;
  if (state.user.is_admin) loadUsers();
  refreshNotifications();
  $('#settings').showModal();
});
$('#settings-close').addEventListener('click', () => $('#settings').close());

$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('password', { current: f.get('current'), new: f.get('new') });
    e.target.reset();
    toast('🔑 Senha alterada.');
  } catch (err) {
    toast(err.message);
  }
});

async function loadUsers() {
  const r = await api('users');
  $('#users').innerHTML = r.users.map((u) => `<li data-id="${u.id}">
      <div>${esc(u.name)}${u.is_admin ? ' 👑' : ''}<br><small>${esc(u.email)}</small></div>
      <button data-u="reset">Nova senha</button>
      ${u.id === state.user.id ? '' : '<button data-u="del" class="danger">Remover</button>'}
    </li>`).join('');
}

$('#users').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-u]');
  if (!b) return;
  const li = b.closest('li');
  const id = Number(li.dataset.id);
  try {
    if (b.dataset.u === 'reset') {
      const password = prompt('Nova senha para este usuário (mín. 8 caracteres):');
      if (!password) return;
      await api('user_save', { id, password });
      toast('🔑 Senha redefinida. Passe a nova senha para a pessoa.');
    } else if (confirm('Remover este usuário e todas as tarefas dele?')) {
      await api('user_delete', { id });
      toast('Usuário removido.');
    }
    loadUsers();
  } catch (err) {
    toast(err.message);
  }
});

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('user_save', Object.fromEntries(f));
    e.target.reset();
    toast('👤 Usuário criado. Passe o e-mail e a senha para a pessoa.');
    loadUsers();
  } catch (err) {
    toast(err.message);
  }
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
  navigator.serviceWorker.register('sw.js');
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'refresh') loadTasks();
    if (e.data?.type === 'open' && e.data.id) { state.highlight = e.data.id; loadTasks(); }
  });
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) loadTasks(); });
setInterval(() => { if (!document.hidden && state.user) loadTasks(); }, 30000);

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
