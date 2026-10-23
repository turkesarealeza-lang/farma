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

## Rodar
**Local**
```bash
cd telegram_bot
pip install -r requirements.txt
python bot.py
```

**Docker (VPS)**
```bash
cd telegram_bot
docker build -t lembretes .
docker run -d --restart unless-stopped --env-file .env -v $PWD/data:/app/data --name lembretes lembretes
```

**Railway** (~US$5/mês, mais simples): New Project → Deploy from GitHub → *Root Directory* = `telegram_bot` → adicione as variáveis do `.env` → crie um **Volume** montado em `/app/data` (sem volume, os lembretes somem a cada deploy).

> O bot precisa estar rodando 24/7 para cobrar. Rode só **uma** instância por token.

## Onde hospedar
| Opção | Custo | Observação |
|---|---|---|
| Railway | ~US$5/mês | Deploy pelo GitHub, menos manutenção |
| Oracle Cloud Free / Hetzner | grátis / ~€4 | VPS com Docker, você mantém |
| Seu PC | grátis | Só funciona com o PC ligado |
