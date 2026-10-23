"""Transcription and reminder parsing through any OpenAI-compatible API (Groq by default)."""
import json
import os
from datetime import datetime

from openai import AsyncOpenAI

client = AsyncOpenAI(
    api_key=os.environ["AI_API_KEY"],
    base_url=os.getenv("AI_BASE_URL", "https://api.groq.com/openai/v1"),
)
CHAT_MODEL = os.getenv("AI_CHAT_MODEL", "openai/gpt-oss-120b")
STT_MODEL = os.getenv("AI_STT_MODEL", "whisper-large-v3-turbo")

WEEKDAYS = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira",
            "sexta-feira", "sábado", "domingo"]


async def transcribe(path):
    with open(path, "rb") as f:
        r = await client.audio.transcriptions.create(model=STT_MODEL, file=f, language="pt")
    return r.text.strip()


async def parse_reminder(text, now: datetime):
    """Returns {"task": str|None, "datetime": "YYYY-MM-DD HH:MM"|None}."""
    system = f"""Você extrai lembretes de mensagens em português.
Agora são {now:%Y-%m-%d %H:%M}, {WEEKDAYS[now.weekday()]}, fuso {now.tzinfo}.

Responda SOMENTE com JSON no formato:
{{"task": "<o que fazer>", "datetime": "YYYY-MM-DD HH:MM"}}

Regras:
- "task": descrição curta e clara da tarefa, sem a data/hora, começando com verbo. Ex: "Ligar para o contador".
- "datetime": data e hora locais do lembrete.
- Datas relativas ("amanhã", "sexta", "daqui 2 horas", "semana que vem") são calculadas a partir de agora.
- Dia da semana sem "que vem" = a próxima ocorrência futura desse dia.
- Só hora, sem data: hoje se ainda não passou, senão amanhã.
- Só data, sem hora: use 09:00.
- "de manhã" = 09:00, "à tarde" = 14:00, "à noite" = 20:00, "meio-dia" = 12:00.
- Se não houver nenhuma indicação de quando, use "datetime": null.
- Se a mensagem não for um pedido de lembrete, use "task": null e "datetime": null."""
    r = await client.chat.completions.create(
        model=CHAT_MODEL,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": text}],
    )
    data = json.loads(r.choices[0].message.content)
    return {"task": data.get("task"), "datetime": data.get("datetime")}
