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
No terminal da VPS (hPanel → VPS → Gerenciar → Terminal do navegador):
```bash
curl -fsSL https://raw.githubusercontent.com/turkesarealeza-lang/farma/claude/telegram-task-reminder-bot-q4xjhq/telegram_bot/instalar.sh | bash
```
O instalador instala o Docker, baixa o código em `/opt/lembretes`, pede o token e a chave do Groq (e valida os dois), descobre seu chat ID e sobe o bot. Ele reinicia sozinho se a VPS reiniciar.

**Atualizar depois:** rode o mesmo comando de novo (mantém a configuração e os lembretes).

**Ver logs:** `cd /opt/lembretes/telegram_bot && docker compose logs -f`

**Rodar no PC (teste):** `pip install -r requirements.txt && python bot.py`

> O bot precisa estar rodando 24/7 para cobrar. Rode só **uma** instância por token.
