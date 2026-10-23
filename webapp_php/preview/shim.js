'use strict';
// Preview-only: fakes the server (api.php), push notifications and the microphone so the real
// app.js runs unchanged inside a static page with sample data.

(function () {
  const now = () => Math.floor(Date.now() / 1000);
  const at = (days, h, m = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(h, m, 0, 0);
    return Math.floor(d / 1000);
  };

  function seed() {
    return {
      nextId: 10,
      user: { id: 1, name: 'Turko', email: 'turko@farmaciabotanique.com.br', is_admin: true },
      users: [
        { id: 1, name: 'Turko', email: 'turko@farmaciabotanique.com.br', is_admin: true },
        { id: 2, name: 'Ana', email: 'ana@farmaciabotanique.com.br', is_admin: false },
        { id: 3, name: 'Bruno', email: 'bruno@farmaciabotanique.com.br', is_admin: false },
      ],
      tasks: [
        { id: 1, text: 'Ligar para o contador sobre o DAS', due_at: now() - 12 * 60, status: 'nagging', nag_count: 2, done_at: null },
        { id: 2, text: 'Pagar boleto da distribuidora', due_at: now() + 3 * 3600, status: 'scheduled', nag_count: 0, done_at: null },
        { id: 3, text: 'Revisar criativos da campanha de Black Friday', due_at: at(1, 10), status: 'scheduled', nag_count: 0, done_at: null },
        { id: 4, text: 'Renovar alvará sanitário', due_at: at(5, 9), status: 'scheduled', nag_count: 0, done_at: null },
        { id: 5, text: 'Enviar relatório de mídia paga', due_at: now() - 3 * 3600, status: 'done', nag_count: 1, done_at: now() - 2 * 3600 },
        { id: 6, text: 'Aprovar copy do anúncio de vitaminas', due_at: at(-1, 15), status: 'done', nag_count: 0, done_at: at(-1, 15, 20) },
      ],
    };
  }
  let db = seed();
  window.__preview = { reset() { db = seed(); }, db: () => db };

  // ---- a tiny stand-in for the AI date parser ----
  const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  function fakeParse(text) {
    let t = text.toLowerCase();
    let due = null;
    const rel = t.match(/daqui (?:a )?(\d+)\s*(min|minutos?|h|horas?)/);
    if (rel) due = now() + Number(rel[1]) * (rel[2].startsWith('h') ? 3600 : 60);
    const hm = t.match(/(?:às|as)\s*(\d{1,2})(?:[:h](\d{2}))?|(\d{1,2})h(\d{2})?/);
    const hour = hm ? Number(hm[1] || hm[3]) : null;
    const min = hm ? Number(hm[2] || hm[4] || 0) : 0;
    let day = null;
    if (/amanh[ãa]/.test(t)) day = 1;
    else if (/hoje/.test(t)) day = 0;
    else {
      const w = WD.findIndex((d) => t.includes(d));
      if (w >= 0) day = ((w - new Date().getDay() + 7) % 7) || 7;
    }
    if (!due && (day !== null || hour !== null)) {
      due = at(day ?? 0, hour ?? 9, min);
      if (day === null && due < now()) due += 86400;
    }
    let task = text
      .replace(/^(me )?lembr(a|ar|e)( de| que)?\s*/i, '')
      .replace(/daqui (a )?\d+\s*(min|minutos?|h|horas?)/i, '')
      .replace(/(amanh[ãa]|hoje|(na |nessa |próxima )?(segunda|terça|quarta|quinta|sexta|sábado|domingo)(-feira)?( que vem)?)/gi, '')
      .replace(/(às|as)\s*\d{1,2}([:h]\d{2})?h?|\d{1,2}h(\d{2})?/gi, '')
      .replace(/\s+/g, ' ').trim();
    task = task ? task[0].toUpperCase() + task.slice(1) : null;
    return { task, due };
  }

  // ---- fake api.php ----
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const find = (id) => db.tasks.find((t) => t.id === Number(id));

  function createFrom(text) {
    const p = fakeParse(text);
    if (!p.task) return json({ error: 'Não entendi como lembrete. Ex: "ligar pro João amanhã às 14h".' }, 422);
    if (!p.due) return json({ need_date: true, text: p.task });
    const t = { id: db.nextId++, text: p.task, due_at: p.due, status: 'scheduled', nag_count: 0, done_at: null };
    db.tasks.push(t);
    return json({ task: t });
  }

  async function route(action, init) {
    await new Promise((r) => setTimeout(r, 250));  // feel of a network round trip
    let body = {};
    if (init?.body && typeof init.body === 'string') body = JSON.parse(init.body);
    const open = db.tasks.filter((t) => t.status === 'scheduled' || t.status === 'nagging').sort((a, b) => a.due_at - b.due_at);
    switch (action) {
      case 'login':
        if (!body.password) return json({ error: 'E-mail ou senha incorretos.' }, 401);
        return json({ user: db.user });
      case 'me': return window.__previewLoggedOut ? json({ error: 'Faça login.' }, 401) : json({ user: db.user, vapid: 'BPreview' });
      case 'logout': return json({ ok: true });
      case 'tasks':
        return json({ open, done: db.tasks.filter((t) => t.status === 'done').sort((a, b) => b.done_at - a.done_at), now: now() });
      case 'create': return createFrom(body.text || '');
      case 'audio': {
        const r = await createFrom('ligar pro fornecedor amanhã às 10h').json();
        return json({ transcript: 'ligar pro fornecedor amanhã às 10h', ...r });
      }
      case 'save': {
        const due = Math.floor(new Date(body.due) / 1000);
        if (!body.text?.trim()) return json({ error: 'Descreva a tarefa.' }, 400);
        if (!due || due < now() - 60) return json({ error: 'Esse horário já passou. Escolha uma data futura.' }, 400);
        let t = body.id ? find(body.id) : null;
        if (t) Object.assign(t, { text: body.text.trim(), due_at: due, status: 'scheduled', nag_count: 0, done_at: null });
        else { t = { id: db.nextId++, text: body.text.trim(), due_at: due, status: 'scheduled', nag_count: 0, done_at: null }; db.tasks.push(t); }
        return json({ task: t });
      }
      case 'act': {
        const t = find(body.id);
        if (!t) return json({ error: 'Tarefa não encontrada.' }, 404);
        if (body.action === 'done') Object.assign(t, { status: 'done', done_at: now() });
        if (body.action === 'delete') db.tasks = db.tasks.filter((x) => x !== t);
        if (body.action === 'reopen') Object.assign(t, { status: 'scheduled', done_at: null, nag_count: 0, due_at: Math.max(t.due_at, now() + 300) });
        if (body.action === 'snooze') {
          t.due_at = body.until === 'tomorrow' ? at(1, 9) : now() + (body.minutes || 30) * 60;
          t.status = 'scheduled';
        }
        return json({ task: t });
      }
      case 'subscribe': case 'unsubscribe': return json({ ok: true });
      case 'test_push': return json({ sent: 1 });
      case 'password': return body.current ? json({ ok: true }) : json({ error: 'Senha atual incorreta.' }, 400);
      case 'users': return json({ users: db.users });
      case 'user_save':
        if (body.id) return json({ ok: true });
        if (db.users.some((u) => u.email.toLowerCase() === String(body.email).toLowerCase())) return json({ error: 'Já existe um usuário com esse e-mail.' }, 400);
        db.users.push({ id: db.nextId++, name: body.name, email: body.email, is_admin: false });
        return json({ ok: true });
      case 'user_delete': db.users = db.users.filter((u) => u.id !== body.id); return json({ ok: true });
    }
    return json({ error: 'Rota inválida.' }, 404);
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = (url, init) => {
    const m = String(url).match(/^api\.php\?a=(\w+)/);
    return m ? route(m[1], init) : realFetch(url, init);
  };

  // ---- fake notifications (state set from the preview toolbar) ----
  window.__previewNotif = 'default';
  const fakeSub = { endpoint: 'https://preview', toJSON: () => ({ endpoint: 'https://preview', keys: { p256dh: 'x', auth: 'y' } }), unsubscribe: async () => true };
  const reg = {
    pushManager: { getSubscription: async () => (window.__previewNotif === 'granted' ? fakeSub : null), subscribe: async () => fakeSub },
    getNotifications: async () => [],
  };
  const sw = { register: async () => reg, ready: Promise.resolve(reg), addEventListener() {} };
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
  window.PushManager = window.PushManager || function () {};
  function FakeNotification() {}
  Object.defineProperty(FakeNotification, 'permission', { get: () => window.__previewNotif });
  FakeNotification.requestPermission = async () => (window.__previewNotif = 'granted');
  Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });

  // ---- fake microphone: records "something" for ~2s of UI ----
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) }, configurable: true,
  });
  class FakeRecorder {
    static isTypeSupported(t) { return t === 'audio/webm'; }
    constructor() { this.mimeType = 'audio/webm'; }
    start() {}
    stop() {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(4000)], { type: 'audio/webm' }) });
      setTimeout(() => this.onstop?.(), 0);
    }
  }
  window.MediaRecorder = FakeRecorder;

  // The viewer can't show native dialogs; answer them so delete/reset work in the preview.
  window.confirm = () => true;
  window.prompt = () => 'novasenha123';
})();
