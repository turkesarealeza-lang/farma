"""Builds preview.html: the real app (index.html, style.css, app.js) inside a phone frame,
with shim.js faking the server so it runs as a static page. Run after editing the app files."""
import base64
import re
from pathlib import Path

HERE = Path(__file__).parent
APP = HERE.parent / "tarefas"

index = (APP / "index.html").read_text()
body = index.split("<body>", 1)[1].split("</body>", 1)[0]
body = re.sub(r'\s*<script src="app.js"></script>', "", body)
icon = base64.b64encode((APP / "icons/icon-192.png").read_bytes()).decode()
body = body.replace('src="icons/icon-192.png"', f'src="data:image/png;base64,{icon}"')

CHROME_CSS = """
/* Preview frame: a toolbar to switch states, and the app inside a phone-sized screen. */
html, body { height: 100%; }
body { display: flex; flex-direction: column; align-items: center; gap: 14px;
  padding-block: 16px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.pv-bar { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; justify-content: center; max-width: 720px; font-size: .85rem; color: var(--muted); }
.pv-bar strong { color: var(--text); font-size: .95rem; margin-right: 4px; }
.pv-group { display: inline-flex; gap: 2px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 2px; }
.pv-group button { border: 0; padding: 5px 10px; font-size: .82rem; border-radius: 8px; background: transparent; color: var(--muted); }
.pv-group button[aria-pressed="true"] { background: var(--primary); color: var(--primary-text); }
.pv-bar > button { padding: 6px 12px; font-size: .82rem; border: 1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 999px; }
.pv-phone { position: relative; transform: translateZ(0); width: 390px; height: min(800px, calc(100dvh - 120px)); min-height: 560px; flex: none;
  border: 10px solid var(--card2); border-radius: 44px; overflow: hidden; background: var(--bg);
  box-shadow: 0 20px 50px rgb(0 0 0 / .18); }
.pv-screen { height: 100%; overflow-y: auto; overscroll-behavior: contain; }
.pv-screen .top { padding-top: 14px; }
.pv-note { font-size: .78rem; color: var(--muted); text-align: center; max-width: 420px; }
@media (max-width: 480px) {
  body { padding: 0; gap: 0; }
  .pv-bar { padding: 10px 12px; }
  .pv-phone { width: 100%; height: auto; flex: 1; border: 0; border-radius: 0; box-shadow: none; }
  .pv-note { display: none; }
}
"""

CHROME_JS = """
(function () {
  const root = document.documentElement;
  const press = (group, btn) => group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  document.querySelectorAll('.pv-group').forEach((g) => g.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    press(g, b);
    const v = b.dataset.v;
    if (g.id === 'pv-screen') {
      if (v === 'login') { window.__previewLoggedOut = true; showLogin(); }
      else { window.__previewLoggedOut = false; const me = await api('me'); Object.assign(state, { user: me.user, vapid: me.vapid }); showApp(); }
    }
    if (g.id === 'pv-skin') applySkin(v);
    if (g.id === 'pv-notif') { window.__previewNotif = v; refreshNotifications(); }
  }));
  document.getElementById('pv-nag').addEventListener('click', () => {
    const t = window.__preview.db().tasks.filter((x) => x.status === 'scheduled').sort((a, b) => a.due_at - b.due_at)[0];
    if (t) Object.assign(t, { status: 'nagging', due_at: Math.floor(Date.now() / 1000) - 60, nag_count: 1 });
    loadTasks();
  });
  document.getElementById('pv-alarm').addEventListener('click', () => {
    const p = window.__preview, d = p.db();
    d.tasks.push(p.T({ id: p.nextId(), title: 'Tomar remédio', due_at: Math.floor(Date.now() / 1000) - 2, mode: 'alarm', notes: '1 comprimido depois do almoço' }));
    Sound.unlock();
    loadTasks();
  });
  applySkin('label');
  document.getElementById('pv-reset').addEventListener('click', () => { window.__preview.reset(); state.highlight = null; loadTasks(); });
})();
"""

TOOLBAR = """
<div class="pv-bar" role="toolbar" aria-label="Controles da prévia">
  <strong>Prévia</strong>
  <span class="pv-group" id="pv-screen"><button data-v="app" aria-pressed="true">App</button><button data-v="login" aria-pressed="false">Login</button></span>
  <span class="pv-group" id="pv-skin"><button data-v="label" aria-pressed="true">Etiqueta</button><button data-v="micro" aria-pressed="false">Micro</button></span>
  <span class="pv-group" id="pv-notif" title="Estado das notificações"><button data-v="default" aria-pressed="true">🔔 Pedir</button><button data-v="granted" aria-pressed="false">Ativadas</button><button data-v="denied" aria-pressed="false">Bloqueadas</button></span>
  <button id="pv-alarm">Disparar alarme</button>
  <button id="pv-nag">Simular atraso</button>
  <button id="pv-reset">Restaurar exemplo</button>
</div>
"""

html = f"""<title>Prévia do app Tarefas</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@300;400;500;600;700&family=Roboto:wght@300;400;500;700;900&display=swap">
<style>
{(APP / "style.css").read_text()}
{CHROME_CSS}
</style>
{TOOLBAR}
<div class="pv-phone"><div class="pv-screen">
{body}
</div></div>
<p class="pv-note">Dados de exemplo e servidor simulado. As datas são entendidas por um interpretador simples; no app real quem faz isso é a IA.</p>
<script>
{(HERE / "shim.js").read_text()}
</script>
<script>
{(APP / "app.js").read_text()}
</script>
<script>
{CHROME_JS}
</script>
"""
(HERE / "preview.html").write_text(html)
print("ok", len(html), "bytes")
