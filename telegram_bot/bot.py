"""Telegram reminder bot: text or voice in, reminder at the set time, nagging every N minutes until done."""
import html
import logging
import os
import re
import tempfile
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv()

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update  # noqa: E402
from telegram.constants import ParseMode  # noqa: E402
from telegram.ext import (  # noqa: E402
    Application, CallbackQueryHandler, CommandHandler, ContextTypes, MessageHandler, filters,
)

import ai  # noqa: E402
import db  # noqa: E402

logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("lembretes")

TOKEN = os.environ["TELEGRAM_TOKEN"]
TZ = ZoneInfo(os.getenv("TIMEZONE", "America/Sao_Paulo"))
NAG_INTERVAL_S = int(os.getenv("NAG_INTERVAL_MIN", "5")) * 60
ALLOWED = {int(x) for x in os.getenv("ALLOWED_CHAT_IDS", "").replace(" ", "").split(",") if x}

AFFIRMATIVE = re.compile(
    r"^(sim|s|ss|feito|fiz|j[aá]|pronto|ok|okay|conclu[ií]d[oa]|terminei|done|yes|✅|👍)(?=\W|$)", re.I
)
NEGATIVE = re.compile(r"^(n[aã]o|ainda n[aã]o|nope|n)(?=\W|$)", re.I)
WEEKDAYS_SHORT = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]

HELP = (
    "Me mande um texto ou áudio dizendo o que e quando. Exemplos:\n"
    "• <i>Me lembra de pagar o boleto amanhã às 10h</i>\n"
    "• <i>Sexta 15h reunião com cliente</i>\n"
    "• <i>Daqui 40 minutos tirar o bolo do forno</i>\n\n"
    "Na hora marcada eu te aviso e cobro a cada {n} min até você responder <b>sim</b> "
    "(ou tocar em ✅).\n\n"
    "/lista – lembretes abertos\n"
    "/cancelar &lt;id&gt; – cancela um lembrete\n"
    "/feito &lt;id&gt; – marca como feito"
)


def allowed(chat_id):
    return not ALLOWED or chat_id in ALLOWED


def fmt_when(ts):
    dt = datetime.fromtimestamp(ts, TZ)
    return f"{WEEKDAYS_SHORT[dt.weekday()]} {dt:%d/%m às %H:%M}"


def short_reply(text, pattern):
    text = text.strip()
    return len(text.split()) <= 6 and bool(pattern.match(text))


def nag_keyboard(task_id):
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ Feito", callback_data=f"done:{task_id}")],
        [InlineKeyboardButton("⏰ 30 min", callback_data=f"snooze:{task_id}:30"),
         InlineKeyboardButton("⏰ 1 h", callback_data=f"snooze:{task_id}:60"),
         InlineKeyboardButton("⏰ Amanhã", callback_data=f"snooze:{task_id}:tomorrow")],
    ])


# ---------- commands ----------

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    msg = HELP.format(n=NAG_INTERVAL_S // 60)
    if not allowed(chat_id):
        msg = f"Seu chat ID é <code>{chat_id}</code>. Adicione em ALLOWED_CHAT_IDS para usar o bot."
    elif not ALLOWED:
        msg += f"\n\n⚠️ Bot aberto a qualquer pessoa. Defina ALLOWED_CHAT_IDS={chat_id} para restringir."
    await update.message.reply_text(msg, parse_mode=ParseMode.HTML)


async def cmd_list(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    tasks = db.open_tasks(update.effective_chat.id)
    if not tasks:
        await update.message.reply_text("Nenhum lembrete aberto. 🎉")
        return
    lines = []
    for t in tasks:
        icon = "🔔" if t["status"] == "nagging" else "🕒"
        lines.append(f"{icon} <b>#{t['id']}</b> {html.escape(t['text'])} — {fmt_when(t['due_at'])}")
    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.HTML)


async def _close_by_arg(update: Update, ctx: ContextTypes.DEFAULT_TYPE, status, label):
    try:
        task_id = int(ctx.args[0].lstrip("#"))
    except (IndexError, ValueError):
        await update.message.reply_text("Use com o número do lembrete. Veja em /lista.")
        return
    task = db.set_status(task_id, update.effective_chat.id, status)
    if task:
        await update.message.reply_text(f"{label}: {html.escape(task['text'])}", parse_mode=ParseMode.HTML)
    else:
        await update.message.reply_text("Lembrete não encontrado ou já fechado.")


async def cmd_cancel(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await _close_by_arg(update, ctx, "canceled", "🗑️ Cancelado")


async def cmd_done(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await _close_by_arg(update, ctx, "done", "✅ Feito")


# ---------- messages ----------

async def on_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await handle_text(update, update.message.text)


async def on_voice(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    media = update.message.voice or update.message.audio
    file = await media.get_file()
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "audio.ogg")
        await file.download_to_drive(path)
        try:
            text = await ai.transcribe(path)
        except Exception:
            log.exception("transcription failed")
            await update.message.reply_text("Não consegui transcrever o áudio. Tenta de novo ou manda por texto.")
            return
    if not text:
        await update.message.reply_text("Não entendi nada no áudio. 🤔")
        return
    await update.message.reply_text(f"🎙️ <i>{html.escape(text)}</i>", parse_mode=ParseMode.HTML)
    await handle_text(update, text)


async def handle_text(update: Update, text):
    chat_id = update.effective_chat.id
    pending = db.nagging(chat_id)

    # Reply to a nag message → that specific task.
    replied = update.message.reply_to_message
    target = db.task_by_message(chat_id, replied.message_id) if replied else None

    if pending and short_reply(text, AFFIRMATIVE):
        if target and target["status"] in ("nagging", "scheduled"):
            pending = [target]
        if len(pending) == 1:
            db.set_status(pending[0]["id"], chat_id, "done")
            await update.message.reply_text(
                f"✅ Boa! Marquei como feito: <b>{html.escape(pending[0]['text'])}</b>",
                parse_mode=ParseMode.HTML)
        else:
            buttons = [[InlineKeyboardButton(f"✅ {t['text'][:40]}", callback_data=f"done:{t['id']}")]
                       for t in pending]
            await update.message.reply_text(
                "Qual delas você fez? (ou responda direto na mensagem de cobrança)",
                reply_markup=InlineKeyboardMarkup(buttons))
        return

    if pending and short_reply(text, NEGATIVE):
        await update.message.reply_text(f"Ok, te cobro de novo em {NAG_INTERVAL_S // 60} min. 💪")
        return

    await create_reminder(update, text)


async def create_reminder(update: Update, text):
    chat_id = update.effective_chat.id
    now = datetime.now(TZ)
    try:
        parsed = await ai.parse_reminder(text, now)
    except Exception:
        log.exception("parse failed")
        await update.message.reply_text("Deu erro ao interpretar a mensagem. Tenta de novo em instantes.")
        return

    if not parsed["task"]:
        await update.message.reply_text(
            "Não entendi como lembrete. Ex: <i>me lembra de ligar pro João amanhã às 14h</i>",
            parse_mode=ParseMode.HTML)
        return
    if not parsed["datetime"]:
        await update.message.reply_text(
            f"Quando quer que eu te lembre de <b>{html.escape(parsed['task'])}</b>? "
            "Manda de novo com data e hora.", parse_mode=ParseMode.HTML)
        return

    try:
        due = datetime.strptime(parsed["datetime"].strip()[:16].replace("T", " "), "%Y-%m-%d %H:%M")
    except ValueError:
        log.warning("bad datetime from model: %r", parsed["datetime"])
        await update.message.reply_text("Não consegui entender a data. Pode reformular?")
        return
    due_ts = int(due.replace(tzinfo=TZ).timestamp())
    if due_ts < time.time() - 60:
        await update.message.reply_text(f"Esse horário ({fmt_when(due_ts)}) já passou. Manda uma data futura.")
        return

    task_id = db.add_task(chat_id, parsed["task"], due_ts)
    await update.message.reply_text(
        f"📌 <b>#{task_id}</b> {html.escape(parsed['task'])}\n🗓️ {fmt_when(due_ts)}",
        parse_mode=ParseMode.HTML,
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("🗑️ Cancelar", callback_data=f"cancel:{task_id}")]]),
    )


# ---------- buttons ----------

async def on_button(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    chat_id = q.message.chat.id
    if not allowed(chat_id):
        await q.answer()
        return
    action, task_id, *rest = q.data.split(":")
    task_id = int(task_id)

    if action in ("done", "cancel"):
        task = db.set_status(task_id, chat_id, "done" if action == "done" else "canceled")
        if not task:
            await q.answer("Esse lembrete já foi fechado.")
            return
        label = "✅ Feito" if action == "done" else "🗑️ Cancelado"
        await q.answer(label)
        await q.edit_message_text(f"{label}: <b>{html.escape(task['text'])}</b>", parse_mode=ParseMode.HTML)

    elif action == "snooze":
        if rest[0] == "tomorrow":
            tomorrow = datetime.now(TZ) + timedelta(days=1)
            until = int(tomorrow.replace(hour=9, minute=0, second=0, microsecond=0).timestamp())
        else:
            until = int(time.time()) + int(rest[0]) * 60
        task = db.get_task(task_id, chat_id)
        if not task or not db.snooze(task_id, chat_id, until):
            await q.answer("Esse lembrete já foi fechado.")
            return
        await q.answer("Adiado")
        await q.edit_message_text(
            f"⏰ Adiado: <b>{html.escape(task['text'])}</b> → {fmt_when(until)}", parse_mode=ParseMode.HTML)


# ---------- scheduler ----------

async def nag_job(ctx: ContextTypes.DEFAULT_TYPE):
    now = int(time.time())
    for t in db.due_for_nag(now, NAG_INTERVAL_S):
        if t["nag_count"] == 0:
            msg = f"⏰ <b>Lembrete:</b> {html.escape(t['text'])}\n\nJá fez?"
        else:
            late = (now - t["due_at"]) // 60
            msg = (f"🔔 <b>Cobrança #{t['nag_count']}</b> ({late} min de atraso)\n"
                   f"{html.escape(t['text'])}\n\nJá fez?")
        try:
            sent = await ctx.bot.send_message(
                t["chat_id"], msg, parse_mode=ParseMode.HTML, reply_markup=nag_keyboard(t["id"]))
            db.mark_nagged(t["id"], t["chat_id"], sent.message_id, now)
        except Exception:
            log.exception("failed to nag task %s", t["id"])


def main():
    db.init()
    app = Application.builder().token(TOKEN).build()
    only_allowed = filters.Chat(chat_id=ALLOWED) if ALLOWED else filters.ALL

    app.add_handler(CommandHandler(["start", "help", "ajuda"], cmd_start))
    app.add_handler(CommandHandler("lista", cmd_list, filters=only_allowed))
    app.add_handler(CommandHandler("cancelar", cmd_cancel, filters=only_allowed))
    app.add_handler(CommandHandler("feito", cmd_done, filters=only_allowed))
    app.add_handler(MessageHandler(only_allowed & (filters.VOICE | filters.AUDIO), on_voice))
    app.add_handler(MessageHandler(only_allowed & filters.TEXT & ~filters.COMMAND, on_text))
    app.add_handler(CallbackQueryHandler(on_button))

    app.job_queue.run_repeating(nag_job, interval=20, first=5)
    log.info("bot started (tz=%s, nag every %ss)", TZ, NAG_INTERVAL_S)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
