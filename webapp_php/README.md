# Tarefas – web app (PWA) de lembretes com push

App instalável (Android e iPhone) com login por e-mail e senha. Cada usuário cria lembretes por texto ou áudio; na hora marcada recebe uma notificação push e é cobrado a cada 5 min até marcar como feito.

Roda em hospedagem compartilhada PHP (Hostinger Cloud/Business): PHP 8.1+, SQLite, cron a cada minuto. Sem dependências externas além da chave do Groq (transcrição e interpretação de datas).

## Instalação
1. Envie `tarefas.zip` para `public_html` no Gerenciador de Arquivos e extraia → `public_html/tarefas/`.
2. Abra `https://SEU-DOMINIO/tarefas/install.php`: chave do Groq + sua conta de administrador.
3. Cron Jobs no hPanel: tipo PHP, comando mostrado pelo instalador, a cada minuto.
4. Abra `https://SEU-DOMINIO/tarefas/` no celular, entre e ative as notificações.
   - iPhone (iOS 16.4+): abra no Safari → Compartilhar → Adicionar à Tela de Início → abra pelo ícone → ative.
   - Android: Chrome → menu ⋮ → Instalar app (ou Adicionar à tela inicial).

## Usuários
O administrador cria contas em ⚙️ → Usuários (nome, e-mail, senha inicial) e pode redefinir senhas ou remover pessoas. Cada usuário só vê as próprias tarefas.

## Arquivos
| Arquivo | Função |
|---|---|
| `index.html`, `app.js`, `style.css` | Interface |
| `sw.js` | Service worker: recebe push, botões da notificação, cache offline |
| `api.php` | API JSON (login, tarefas, push, usuários) |
| `cron.php` | Envia lembretes/cobranças vencidos (só via linha de comando) |
| `lib.php` | Banco, autenticação, IA e Web Push (VAPID + aes128gcm, sem bibliotecas) |
| `install.php` | Instalação (trava sozinho depois) |
| `data/` | Configuração e banco (acesso web bloqueado) |

Atualizar: envie os arquivos novos por cima, sem apagar `data/`.

## Limitações conhecidas
- iPhone: notificações sem botões (toque abre o app); só funciona com o app instalado na tela de início.
- Lembretes chegam com até 1 min de variação (intervalo do cron).
