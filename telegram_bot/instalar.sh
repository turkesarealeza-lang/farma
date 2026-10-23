#!/usr/bin/env bash
# Instala/atualiza o bot de lembretes numa VPS Ubuntu/Debian.
# Uso: curl -fsSL <url deste arquivo> | sudo bash
set -euo pipefail

REPO="https://github.com/turkesarealeza-lang/farma.git"
BRANCH="claude/telegram-task-reminder-bot-q4xjhq"
DIR="/opt/lembretes"
APP="$DIR/telegram_bot"

ask() { local v; read -r -p "$1" v < /dev/tty; echo "$v"; }
ok() { echo -e "\033[32m✔ $*\033[0m"; }
warn() { echo -e "\033[33m⚠ $*\033[0m"; }

[ "$(id -u)" -eq 0 ] || { echo "Rode como root (ou com sudo)."; exit 1; }

echo "== 1/5 Instalando dependências =="
apt-get update -qq
apt-get install -y -qq git curl python3 >/dev/null
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
docker compose version >/dev/null 2>&1 || apt-get install -y -qq docker-compose-plugin >/dev/null
ok "Docker pronto"

echo "== 2/5 Baixando o código =="
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q -b "$BRANCH" "$REPO" "$DIR"
fi
ok "Código em $APP"

cd "$APP"
if [ -f .env ]; then
  ok ".env já existe, mantendo configuração (apague $APP/.env para reconfigurar)"
else
  echo "== 3/5 Configuração =="
  while true; do
    TOKEN=$(ask "Cole o token do BotFather: ")
    NAME=$(curl -s "https://api.telegram.org/bot$TOKEN/getMe" \
      | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["result"]["username"] if d.get("ok") else "")' 2>/dev/null || true)
    [ -n "$NAME" ] && { ok "Bot encontrado: @$NAME"; break; }
    warn "Token inválido. Confira no BotFather e cole de novo."
  done

  while true; do
    KEY=$(ask "Cole a chave da API do Groq (começa com gsk_): ")
    CODE=$(curl -s -o /dev/null -w '%{http_code}' https://api.groq.com/openai/v1/models -H "Authorization: Bearer $KEY")
    [ "$CODE" = "200" ] && { ok "Chave do Groq válida"; break; }
    warn "Chave recusada (HTTP $CODE). Confira e cole de novo."
  done

  echo
  echo "Agora abra o Telegram, entre no @$NAME, toque em INICIAR e mande qualquer mensagem (ex: oi)."
  CHAT_ID=""
  while [ -z "$CHAT_ID" ]; do
    ask "Depois de mandar a mensagem, aperte Enter aqui... " >/dev/null
    CHAT_ID=$(curl -s "https://api.telegram.org/bot$TOKEN/getUpdates" \
      | python3 -c 'import sys,json; r=json.load(sys.stdin).get("result",[]); print(r[-1]["message"]["chat"]["id"] if r and "message" in r[-1] else "")' 2>/dev/null || true)
    [ -z "$CHAT_ID" ] && warn "Não recebi sua mensagem ainda. Mande de novo e aperte Enter."
  done
  ok "Seu chat ID: $CHAT_ID (só você poderá usar o bot)"

  echo "== 4/5 Salvando configuração =="
  cat > .env <<EOF
TELEGRAM_TOKEN=$TOKEN
AI_API_KEY=$KEY
ALLOWED_CHAT_IDS=$CHAT_ID
TIMEZONE=America/Sao_Paulo
NAG_INTERVAL_MIN=5
EOF
  chmod 600 .env
  ok "Configuração salva em $APP/.env"
fi

echo "== 5/5 Subindo o bot =="
docker compose up -d --build
sleep 5
if docker compose logs bot 2>&1 | grep -q "bot started"; then
  ok "Bot rodando! Mande /start para ele no Telegram."
else
  warn "O bot não confirmou a inicialização. Últimas linhas do log:"
  docker compose logs --tail 30 bot
fi
