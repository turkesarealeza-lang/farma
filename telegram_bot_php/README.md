# Bot de lembretes – versão PHP (Hostinger Cloud/Business)

Mesmo bot da pasta `telegram_bot/`, reescrito para hospedagem compartilhada: o Telegram chama `webhook.php` a cada mensagem e o cron do hPanel roda `cron.php` a cada minuto para enviar lembretes e cobranças. Banco SQLite em `data/`, sem MySQL.

## Instalação
1. **Groq**: crie uma chave grátis em https://console.groq.com/keys (começa com `gsk_`).
2. **Upload**: baixe `lembretes.zip`. No hPanel → Sites → *seu site* → **Gerenciador de Arquivos** → entre em `public_html` → envie o zip → clique com o botão direito → **Extrair**. Deve ficar `public_html/lembretes/`.
3. **Instalador**: abra `https://SEU-DOMINIO/lembretes/install.php`, cole o token do BotFather e a chave do Groq, mande "oi" pro bot quando pedir.
4. **Cron**: hPanel → Sites → Painel → **Cron Jobs** → tipo **PHP**, comando que o instalador mostrar, frequência **a cada minuto**.

## Arquivos
| Arquivo | Função |
|---|---|
| `install.php` | Assistente de configuração (trava sozinho após instalar) |
| `webhook.php` | Recebe mensagens/botões do Telegram (protegido por token secreto) |
| `cron.php` | Envia lembretes e cobranças vencidos |
| `lib.php` | Toda a lógica |
| `data/` | Configuração e banco (acesso web bloqueado) |

Reconfigurar: apague `data/config.php` e abra `install.php` de novo.
Atualizar o código: envie os novos `.php` por cima, sem apagar `data/`.
Trocar para OpenAI: em `data/config.php` adicione `'ai_base' => 'https://api.openai.com/v1', 'ai_chat_model' => 'gpt-4o-mini', 'ai_stt_model' => 'whisper-1'` e use a chave da OpenAI em `ai_key`.
