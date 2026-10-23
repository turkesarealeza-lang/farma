# Bot de lembretes no Telegram

Mande texto ou áudio ("me lembra de pagar o boleto sexta às 10h"). Na hora marcada o bot avisa e **cobra a cada 5 min** até você responder **sim** (ou tocar em ✅). Suporta vários lembretes ao mesmo tempo.

## Como responder às cobranças
- **sim / feito / já / ok / ✅** → marca como feito. Se houver mais de uma cobrança aberta, o bot pergunta qual (ou responda direto na mensagem da cobrança).
- **não / ainda não** → continua cobrando.
- Botões: ✅ Feito · ⏰ 30 min · ⏰ 1 h · ⏰ Amanhã (9h).
- Comandos: `/lista`, `/cancelar <id>`, `/feito <id>`.

## Setup (10 min)
1. **Bot**: no Telegram, fale com [@BotFather](https://t.me/BotFather) → `/newbot` → copie o token.
2. **IA**: crie uma chave grátis em https://console.groq.com/keys (transcreve áudio e interpreta datas). Quer OpenAI? Veja `.env.example`.
3. `cp .env.example .env` e preencha `TELEGRAM_TOKEN` e `AI_API_KEY`.
4. Rode (abaixo), mande `/start` pro bot, copie seu chat ID para `ALLOWED_CHAT_IDS` e reinicie. **Sem isso, qualquer pessoa que achar o bot pode usá-lo (e gastar sua cota da IA).**

## Rodar na VPS da Hostinger
1. **Acesse o terminal**: hPanel → VPS → *Gerenciar* → botão **Terminal do navegador** (ou `ssh root@IP_DA_VPS`).
2. **Instale Docker** (pule se escolheu o template "Ubuntu com Docker"):
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. **Baixe o código** (repo privado: o Git pede usuário + [token do GitHub](https://github.com/settings/tokens) como senha):
   ```bash
   git clone -b claude/telegram-task-reminder-bot-q4xjhq https://github.com/turkesarealeza-lang/farma.git
   cd farma/telegram_bot
   cp .env.example .env && nano .env   # preencha TELEGRAM_TOKEN e AI_API_KEY; Ctrl+O, Enter, Ctrl+X
   ```
4. **Suba o bot**:
   ```bash
   docker compose up -d --build
   docker compose logs -f   # deve aparecer "bot started"; Ctrl+C sai sem parar o bot
   ```
5. Mande `/start` no Telegram, copie o chat ID para `ALLOWED_CHAT_IDS` no `.env` e rode `docker compose up -d`.

O bot reinicia sozinho se a VPS reiniciar. Os lembretes ficam em `telegram_bot/data/`.

**Atualizar depois:** `git pull && docker compose up -d --build`

**Rodar no PC (teste):** `pip install -r requirements.txt && python bot.py`

> O bot precisa estar rodando 24/7 para cobrar. Rode só **uma** instância por token.
