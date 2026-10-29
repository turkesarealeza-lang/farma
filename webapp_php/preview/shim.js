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

  const T = (o) => ({ status: 'scheduled', nag_count: 0, done_at: null, mode: 'push', desc_type: 'text', notes: '', checklist: [], base_at: o.due_at, recur: '', recur_days: [], remind_before: 0, ...o });
  function seed() {
    return {
      nextId: 20,
      user: { id: 1, name: 'Turko', email: 'turko@farmaciabotanique.com.br', is_admin: true },
      users: [
        { id: 1, name: 'Turko', email: 'turko@farmaciabotanique.com.br', is_admin: true },
        { id: 2, name: 'Ana', email: 'ana@farmaciabotanique.com.br', is_admin: false },
        { id: 3, name: 'Bruno', email: 'bruno@farmaciabotanique.com.br', is_admin: false },
      ],
      tasks: [
        T({ id: 1, title: 'Ligar para o contador sobre o DAS', due_at: now() - 12 * 60, status: 'nagging', nag_count: 2, notes: 'Perguntar sobre o parcelamento de setembro.' }),
        T({ id: 2, title: 'Pagar boleto da distribuidora', due_at: now() + 3 * 3600, mode: 'alarm', notes: 'Vence hoje. Código de barras no e-mail do financeiro.' }),
        T({ id: 3, title: 'Revisar criativos da Black Friday', due_at: at(1, 10), desc_type: 'checklist',
          checklist: [{ t: 'Conferir copy dos 3 anúncios', done: true }, { t: 'Ajustar oferta no vídeo 2', done: false }, { t: 'Aprovar com a agência', done: false }] }),
        T({ id: 4, title: 'Tomar vitamina D', due_at: at(1, 8), mode: 'alarm', recur: 'daily' }),
        T({ id: 9, title: 'Reunião de pauta com a agência', due_at: at(((1 - new Date().getDay() + 7) % 7) || 7, 10), recur: 'weekly', recur_days: [1, 4], remind_before: 15, notes: 'Levar números de ROAS e CPA da semana.' }),
        T({ id: 10, title: 'Pagar aluguel da loja', due_at: at(3, 9), recur: 'monthly', recur_days: [new Date(Date.now() + 3 * 86400000).getDate()], remind_before: 60 }),
        T({ id: 5, title: 'Renovar alvará sanitário', due_at: at(5, 9), notes: 'Levar CNPJ, contrato social e o último laudo.' }),
        T({ id: 6, title: 'Fechar pedido do laboratório', due_at: at(8, 14), desc_type: 'checklist',
          checklist: [{ t: 'Conferir estoque de cápsulas', done: false }, { t: 'Pedir orçamento', done: false }] }),
        T({ id: 7, title: 'Enviar relatório de mídia paga', due_at: now() - 3 * 3600, status: 'done', done_at: now() - 2 * 3600, notes: 'ROAS da semana e criativo vencedor.' }),
        T({ id: 8, title: 'Aprovar copy do anúncio de vitaminas', due_at: at(-1, 15), status: 'done', done_at: at(-1, 15, 20) }),
      ],
    };
  }
  let db = seed();
  window.__preview = { reset() { db = seed(); }, db: () => db, T, nextId: () => db.nextId++ };

  // ---- a tiny stand-in for the AI date parser ----
  const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  function fakeParse(text) {
    const t = text.toLowerCase();
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
    return { title: task, due_at: due };
  }

  // ---- fake api.php ----
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const find = (id) => db.tasks.find((t) => t.id === Number(id));
  const tomorrowSame = (t) => { const b = new Date((t.base_at || t.due_at) * 1000); const d = new Date(Math.max(Date.now(), t.due_at * 1000)); d.setDate(d.getDate() + 1); d.setHours(b.getHours(), b.getMinutes(), 0, 0); return Math.floor(d / 1000); };
  function nextOcc(t) {  // same rule as next_occurrence() on the server
    const b = new Date(t.base_at * 1000), after = Math.max(t.base_at, now());
    const d = new Date(after * 1000);
    for (let i = 0; i < 400; i++, d.setDate(d.getDate() + 1)) {
      const c = new Date(d); c.setHours(b.getHours(), b.getMinutes(), 0, 0);
      const k = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
      if (c / 1000 > after && recursOn(t, k)) return Math.floor(c / 1000);
    }
    return t.due_at;
  }

  async function route(action, init) {
    await new Promise((r) => setTimeout(r, 200));  // feel of a network round trip
    let body = {};
    if (init?.body && typeof init.body === 'string') body = JSON.parse(init.body);
    switch (action) {
      case 'login':
        if (!body.password) return json({ error: 'E-mail ou senha incorretos.' }, 401);
        return json({ user: db.user });
      case 'me': return window.__previewLoggedOut ? json({ error: 'Faça login.' }, 401) : json({ user: db.user, vapid: 'BPreview' });
      case 'logout': return json({ ok: true });
      case 'tasks':
        return json({
          open: db.tasks.filter((t) => t.status === 'scheduled' || t.status === 'nagging').sort((a, b) => a.due_at - b.due_at),
          done: db.tasks.filter((t) => t.status === 'done').sort((a, b) => b.done_at - a.done_at), now: now(),
        });
      case 'parse': {
        const p = fakeParse(body.text || '');
        return p.title ? json(p) : json({ error: 'Não entendi como tarefa. Ex: "ligar pro João amanhã às 14h".' }, 422);
      }
      case 'audio': return json({ transcript: 'ligar pro fornecedor amanhã às 10h', ...fakeParse('ligar pro fornecedor amanhã às 10h') });
      case 'save': {
        const due = Math.floor(new Date(body.due) / 1000);
        if (!body.title?.trim()) return json({ error: 'Dê um título para a tarefa.' }, 400);
        if (!due || due < now() - 60) return json({ error: 'Esse horário já passou. Escolha uma data futura.' }, 400);
        const fields = { title: body.title.trim(), due_at: due, base_at: due, mode: body.mode === 'alarm' ? 'alarm' : 'push',
          desc_type: body.desc_type === 'checklist' ? 'checklist' : 'text', notes: (body.notes || '').trim(),
          checklist: (body.checklist || []).filter((i) => i.t.trim()).map((i) => ({ t: i.t.trim(), done: !!i.done })),
          status: 'scheduled', nag_count: 0, done_at: null,
          recur: ['daily', 'weekdays', 'weekly', 'monthly'].includes(body.recur) ? body.recur : '',
          recur_days: body.recur === 'weekly' ? [...(body.recur_days || [])].sort() : body.recur === 'monthly' ? [new Date(due * 1000).getDate()] : [],
          remind_before: [5, 15, 30, 60].includes(body.remind_before) ? body.remind_before : 0 };
        let t = body.id ? find(body.id) : null;
        if (t) Object.assign(t, fields); else { t = T({ id: db.nextId++, ...fields }); db.tasks.push(t); }
        return json({ task: t });
      }
      case 'check': {
        const t = find(body.id);
        t.checklist[body.index].done = !!body.done;
        return json({ task: t });
      }
      case 'act': {
        const t = find(body.id);
        if (!t) return json({ error: 'Tarefa não encontrada.' }, 404);
        if (body.action === 'done' && !t.recur) Object.assign(t, { status: 'done', done_at: now() });
        if ((body.action === 'done' || body.action === 'skip') && t.recur) {
          if (body.action === 'done') db.tasks.push(T({ ...t, id: db.nextId++, recur: '', status: 'done', done_at: now(), checklist: t.checklist.map((i) => ({ ...i })) }));
          t.due_at = nextOcc(t); t.base_at = t.due_at; t.status = 'scheduled'; t.nag_count = 0;
          t.checklist = t.checklist.map((i) => ({ ...i, done: false }));
        }
        if (body.action === 'delete') db.tasks = db.tasks.filter((x) => x !== t);
        if (body.action === 'reopen') Object.assign(t, { status: 'scheduled', done_at: null, nag_count: 0, due_at: Math.max(t.due_at, now() + 300) });
        if (body.action === 'snooze') {
          if (body.until === 'tomorrow') { t.due_at = tomorrowSame(t); if (!t.recur) t.base_at = t.due_at; } else t.due_at = now() + (body.minutes || 5) * 60;
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
