<?php
// Shared code for the reminder bot: config, database, Telegram and AI calls, message handling.
declare(strict_types=1);

date_default_timezone_set('America/Sao_Paulo');

const CONFIG_FILE = __DIR__ . '/data/config.php';
const NAG_INTERVAL = 300;  // seconds between nags
const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const AFFIRMATIVE = '/^(sim|s|ss|feito|fiz|j[aá]|pronto|ok|okay|conclu[ií]d[oa]|terminei|done|yes|✅|👍)(?=\W|$)/iu';
const NEGATIVE = '/^(n[aã]o|ainda n[aã]o|nope|n)(?=\W|$)/iu';

function cfg(): array
{
    static $c = null;
    if ($c === null) {
        if (!is_file(CONFIG_FILE)) {
            throw new RuntimeException('Bot não configurado. Abra install.php.');
        }
        $c = (require CONFIG_FILE) + [
            'tg_base' => tg_base(),
            'ai_base' => ai_base(),
            'ai_chat_model' => 'llama-3.3-70b-versatile',
            'ai_stt_model' => 'whisper-large-v3-turbo',
        ];
    }
    return $c;
}

// Overridable through env vars for local tests against a mock server.
function tg_base(): string
{
    return getenv('LEMBRETES_TG_BASE') ?: 'https://api.telegram.org';
}

function ai_base(): string
{
    return getenv('LEMBRETES_AI_BASE') ?: 'https://api.groq.com/openai/v1';
}

// ---------- HTTP ----------

function http(string $url, array $opts = []): array
{
    $ch = curl_init($url);
    $headers = $opts['headers'] ?? [];
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $opts['timeout'] ?? 30]);
    if (array_key_exists('json', $opts)) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($opts['json'], JSON_UNESCAPED_UNICODE));
    } elseif (isset($opts['form'])) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $opts['form']);
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($body === false) {
        throw new RuntimeException("Falha de rede: $err");
    }
    $data = json_decode($body, true);
    return ['code' => $code, 'data' => is_array($data) ? $data : [], 'raw' => $body];
}

function tg(string $method, array $params = [], ?string $token = null): array
{
    $token ??= cfg()['telegram_token'];
    $base = is_file(CONFIG_FILE) ? cfg()['tg_base'] : tg_base();
    return http("$base/bot$token/$method", ['json' => (object)$params])['data'];
}

function send(int $chatId, string $html, ?array $keyboard = null): array
{
    $p = ['chat_id' => $chatId, 'text' => $html, 'parse_mode' => 'HTML'];
    if ($keyboard) {
        $p['reply_markup'] = ['inline_keyboard' => $keyboard];
    }
    return tg('sendMessage', $p);
}

function e(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

// ---------- database ----------

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO('sqlite:' . __DIR__ . '/data/' . cfg()['db_file'], null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec('PRAGMA busy_timeout = 10000');
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS tasks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id     INTEGER NOT NULL,
                text        TEXT    NOT NULL,
                due_at      INTEGER NOT NULL,
                status      TEXT    NOT NULL DEFAULT 'scheduled', -- scheduled | nagging | done | canceled
                last_nag_at INTEGER,
                nag_count   INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL,
                done_at     INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status, due_at);
            CREATE TABLE IF NOT EXISTS nag_messages (
                chat_id    INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                task_id    INTEGER NOT NULL,
                PRIMARY KEY (chat_id, message_id)
            );
            CREATE TABLE IF NOT EXISTS updates (update_id INTEGER PRIMARY KEY, at INTEGER NOT NULL);
        ");
    }
    return $pdo;
}

function q(string $sql, array $args = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st;
}

function get_task(int $id, int $chatId): ?array
{
    return q('SELECT * FROM tasks WHERE id = ? AND chat_id = ?', [$id, $chatId])->fetch() ?: null;
}

/** Close a task (done/canceled). Returns the task if it was open, else null. */
function close_task(int $id, int $chatId, string $status): ?array
{
    $n = q("UPDATE tasks SET status = ?, done_at = ? WHERE id = ? AND chat_id = ? AND status IN ('scheduled', 'nagging')",
        [$status, time(), $id, $chatId])->rowCount();
    return $n ? get_task($id, $chatId) : null;
}

function nagging(int $chatId): array
{
    return q("SELECT * FROM tasks WHERE chat_id = ? AND status = 'nagging' ORDER BY due_at", [$chatId])->fetchAll();
}

function open_tasks(int $chatId): array
{
    return q("SELECT * FROM tasks WHERE chat_id = ? AND status IN ('scheduled', 'nagging') ORDER BY due_at", [$chatId])->fetchAll();
}

// ---------- AI (Groq by default, any OpenAI-compatible API) ----------

function ai(string $path, array $opts): array
{
    $opts['headers'] = ['Authorization: Bearer ' . cfg()['ai_key']];
    $r = http(cfg()['ai_base'] . $path, $opts + ['timeout' => 60]);
    if ($r['code'] !== 200) {
        throw new RuntimeException("IA respondeu HTTP {$r['code']}: " . substr($r['raw'], 0, 300));
    }
    return $r['data'];
}

function transcribe(string $file): string
{
    $d = ai('/audio/transcriptions', ['form' => [
        'model' => cfg()['ai_stt_model'],
        'language' => 'pt',
        'file' => new CURLFile($file, 'audio/ogg', 'audio.ogg'),
    ]]);
    return trim($d['text'] ?? '');
}

/** Returns ['task' => ?string, 'datetime' => ?string "YYYY-MM-DD HH:MM"]. */
function parse_reminder(string $text): array
{
    $now = new DateTime();
    $wd = WEEKDAYS[(int)$now->format('w')];
    $system = "Você extrai lembretes de mensagens em português.
Agora são {$now->format('Y-m-d H:i')}, $wd, fuso America/Sao_Paulo.

Responda SOMENTE com JSON no formato:
{\"task\": \"<o que fazer>\", \"datetime\": \"YYYY-MM-DD HH:MM\"}

Regras:
- \"task\": descrição curta e clara da tarefa, sem a data/hora, começando com verbo. Ex: \"Ligar para o contador\".
- \"datetime\": data e hora locais do lembrete.
- Datas relativas (\"amanhã\", \"sexta\", \"daqui 2 horas\", \"semana que vem\") são calculadas a partir de agora.
- Dia da semana sem \"que vem\" = a próxima ocorrência futura desse dia.
- Só hora, sem data: hoje se ainda não passou, senão amanhã.
- Só data, sem hora: use 09:00.
- \"de manhã\" = 09:00, \"à tarde\" = 14:00, \"à noite\" = 20:00, \"meio-dia\" = 12:00.
- Se não houver nenhuma indicação de quando, use \"datetime\": null.
- Se a mensagem não for um pedido de lembrete, use \"task\": null e \"datetime\": null.";
    $d = ai('/chat/completions', ['json' => [
        'model' => cfg()['ai_chat_model'],
        'temperature' => 0,
        'response_format' => ['type' => 'json_object'],
        'messages' => [['role' => 'system', 'content' => $system], ['role' => 'user', 'content' => $text]],
    ]]);
    $out = json_decode($d['choices'][0]['message']['content'] ?? '', true) ?: [];
    return ['task' => $out['task'] ?? null, 'datetime' => $out['datetime'] ?? null];
}

// ---------- helpers ----------

function fmt_when(int $ts): string
{
    return WEEKDAYS_SHORT[(int)date('w', $ts)] . ' ' . date('d/m \à\s H:i', $ts);
}

function short_reply(string $text, string $pattern): bool
{
    $text = trim($text);
    return count(preg_split('/\s+/u', $text)) <= 6 && preg_match($pattern, $text) === 1;
}

function nag_keyboard(int $id): array
{
    return [
        [['text' => '✅ Feito', 'callback_data' => "done:$id"]],
        [['text' => '⏰ 30 min', 'callback_data' => "snooze:$id:30"],
         ['text' => '⏰ 1 h', 'callback_data' => "snooze:$id:60"],
         ['text' => '⏰ Amanhã', 'callback_data' => "snooze:$id:tomorrow"]],
    ];
}

function allowed(int $chatId): bool
{
    return in_array($chatId, cfg()['allowed_chat_ids'], true);
}

// ---------- update handling ----------

const HELP = "Me mande um texto ou áudio dizendo o que e quando. Exemplos:\n"
    . "• <i>Me lembra de pagar o boleto amanhã às 10h</i>\n"
    . "• <i>Sexta 15h reunião com cliente</i>\n"
    . "• <i>Daqui 40 minutos tirar o bolo do forno</i>\n\n"
    . "Na hora marcada eu te aviso e cobro a cada 5 min até você responder <b>sim</b> (ou tocar em ✅).\n\n"
    . "/lista – lembretes abertos\n/cancelar &lt;id&gt; – cancela um lembrete\n/feito &lt;id&gt; – marca como feito";

function handle_update(array $u): void
{
    if (isset($u['callback_query'])) {
        handle_button($u['callback_query']);
    } elseif (isset($u['message'])) {
        handle_message($u['message']);
    }
}

function handle_message(array $m): void
{
    $chatId = (int)$m['chat']['id'];
    if (!allowed($chatId)) {
        send($chatId, "Bot privado. Seu chat ID é <code>$chatId</code>.");
        return;
    }

    if (isset($m['voice']) || isset($m['audio'])) {
        $text = voice_to_text($chatId, $m['voice'] ?? $m['audio']);
        if ($text === null) {
            return;
        }
        send($chatId, '🎙️ <i>' . e($text) . '</i>');
    } else {
        $text = trim($m['text'] ?? '');
    }
    if ($text === '') {
        return;
    }

    if (preg_match('~^/(\w+)(?:@\w+)?\s*(.*)$~su', $text, $cmd)) {
        handle_command($chatId, strtolower($cmd[1]), trim($cmd[2]));
        return;
    }

    $pending = nagging($chatId);
    $target = null;
    if (isset($m['reply_to_message']['message_id'])) {
        $target = q('SELECT t.* FROM nag_messages n JOIN tasks t ON t.id = n.task_id WHERE n.chat_id = ? AND n.message_id = ?',
            [$chatId, $m['reply_to_message']['message_id']])->fetch() ?: null;
    }

    if ($pending && short_reply($text, AFFIRMATIVE)) {
        if ($target && in_array($target['status'], ['nagging', 'scheduled'], true)) {
            $pending = [$target];
        }
        if (count($pending) === 1) {
            close_task((int)$pending[0]['id'], $chatId, 'done');
            send($chatId, '✅ Boa! Marquei como feito: <b>' . e($pending[0]['text']) . '</b>');
        } else {
            $kb = array_map(fn($t) => [['text' => '✅ ' . mb_substr($t['text'], 0, 40), 'callback_data' => "done:{$t['id']}"]], $pending);
            send($chatId, 'Qual delas você fez? (ou responda direto na mensagem de cobrança)', $kb);
        }
        return;
    }

    if ($pending && short_reply($text, NEGATIVE)) {
        send($chatId, 'Ok, te cobro de novo em 5 min. 💪');
        return;
    }

    create_reminder($chatId, $text);
}

function voice_to_text(int $chatId, array $media): ?string
{
    $tmp = tempnam(sys_get_temp_dir(), 'voz');
    try {
        $f = tg('getFile', ['file_id' => $media['file_id']]);
        $path = $f['result']['file_path'] ?? null;
        if (!$path) {
            throw new RuntimeException('getFile falhou');
        }
        $audio = http(cfg()['tg_base'] . '/file/bot' . cfg()['telegram_token'] . '/' . $path)['raw'];
        file_put_contents($tmp, $audio);
        $text = transcribe($tmp);
    } catch (Throwable $ex) {
        error_log('lembretes: transcrição falhou: ' . $ex->getMessage());
        send($chatId, 'Não consegui transcrever o áudio. Tenta de novo ou manda por texto.');
        return null;
    } finally {
        @unlink($tmp);
    }
    if ($text === '') {
        send($chatId, 'Não entendi nada no áudio. 🤔');
        return null;
    }
    return $text;
}

function handle_command(int $chatId, string $cmd, string $arg): void
{
    switch ($cmd) {
        case 'start':
        case 'help':
        case 'ajuda':
            send($chatId, HELP);
            return;
        case 'lista':
            $tasks = open_tasks($chatId);
            if (!$tasks) {
                send($chatId, 'Nenhum lembrete aberto. 🎉');
                return;
            }
            $lines = array_map(fn($t) => ($t['status'] === 'nagging' ? '🔔' : '🕒')
                . " <b>#{$t['id']}</b> " . e($t['text']) . ' — ' . fmt_when((int)$t['due_at']), $tasks);
            send($chatId, implode("\n", $lines));
            return;
        case 'cancelar':
        case 'feito':
            $id = (int)ltrim($arg, '#');
            if ($id <= 0) {
                send($chatId, 'Use com o número do lembrete. Veja em /lista.');
                return;
            }
            $done = $cmd === 'feito';
            $t = close_task($id, $chatId, $done ? 'done' : 'canceled');
            send($chatId, $t ? ($done ? '✅ Feito: ' : '🗑️ Cancelado: ') . e($t['text']) : 'Lembrete não encontrado ou já fechado.');
            return;
        default:
            send($chatId, 'Comando desconhecido. Mande /ajuda.');
    }
}

function create_reminder(int $chatId, string $text): void
{
    try {
        $p = parse_reminder($text);
    } catch (Throwable $ex) {
        error_log('lembretes: parse falhou: ' . $ex->getMessage());
        send($chatId, 'Deu erro ao interpretar a mensagem. Tenta de novo em instantes.');
        return;
    }
    if (!$p['task']) {
        send($chatId, 'Não entendi como lembrete. Ex: <i>me lembra de ligar pro João amanhã às 14h</i>');
        return;
    }
    if (!$p['datetime']) {
        send($chatId, 'Quando quer que eu te lembre de <b>' . e($p['task']) . '</b>? Manda de novo com data e hora.');
        return;
    }
    $dt = DateTime::createFromFormat('Y-m-d H:i', substr(str_replace('T', ' ', trim($p['datetime'])), 0, 16));
    if (!$dt) {
        error_log('lembretes: data inválida da IA: ' . $p['datetime']);
        send($chatId, 'Não consegui entender a data. Pode reformular?');
        return;
    }
    $due = $dt->getTimestamp();
    if ($due < time() - 60) {
        send($chatId, 'Esse horário (' . fmt_when($due) . ') já passou. Manda uma data futura.');
        return;
    }
    q('INSERT INTO tasks (chat_id, text, due_at, created_at) VALUES (?, ?, ?, ?)', [$chatId, $p['task'], $due, time()]);
    $id = (int)db()->lastInsertId();
    send($chatId, "📌 <b>#$id</b> " . e($p['task']) . "\n🗓️ " . fmt_when($due),
        [[['text' => '🗑️ Cancelar', 'callback_data' => "cancel:$id"]]]);
}

function handle_button(array $cb): void
{
    $chatId = (int)($cb['message']['chat']['id'] ?? 0);
    $msgId = (int)($cb['message']['message_id'] ?? 0);
    $answer = fn(string $t = '') => tg('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => $t]);
    if (!allowed($chatId)) {
        $answer();
        return;
    }
    $parts = explode(':', $cb['data'] ?? '');
    [$action, $id] = [$parts[0], (int)($parts[1] ?? 0)];
    $edit = fn(string $html) => tg('editMessageText', ['chat_id' => $chatId, 'message_id' => $msgId, 'text' => $html, 'parse_mode' => 'HTML']);

    if ($action === 'done' || $action === 'cancel') {
        $t = close_task($id, $chatId, $action === 'done' ? 'done' : 'canceled');
        if (!$t) {
            $answer('Esse lembrete já foi fechado.');
            return;
        }
        $label = $action === 'done' ? '✅ Feito' : '🗑️ Cancelado';
        $answer($label);
        $edit("$label: <b>" . e($t['text']) . '</b>');
    } elseif ($action === 'snooze') {
        $until = ($parts[2] ?? '') === 'tomorrow'
            ? (new DateTime('tomorrow 09:00'))->getTimestamp()
            : time() + (int)($parts[2] ?? 30) * 60;
        $t = get_task($id, $chatId);
        $n = q("UPDATE tasks SET due_at = ?, status = 'scheduled', last_nag_at = NULL
                WHERE id = ? AND chat_id = ? AND status IN ('scheduled', 'nagging')", [$until, $id, $chatId])->rowCount();
        if (!$t || !$n) {
            $answer('Esse lembrete já foi fechado.');
            return;
        }
        $answer('Adiado');
        $edit('⏰ Adiado: <b>' . e($t['text']) . '</b> → ' . fmt_when($until));
    } else {
        $answer();
    }
}

// ---------- scheduler (called by cron) ----------

function run_nags(): int
{
    $now = time();
    // 30s tolerance so a cron firing a few seconds early doesn't push the nag to the next minute.
    $due = q("SELECT * FROM tasks WHERE status IN ('scheduled', 'nagging') AND due_at <= ?
              AND (last_nag_at IS NULL OR last_nag_at <= ?) ORDER BY due_at", [$now, $now - NAG_INTERVAL + 30])->fetchAll();
    $sent = 0;
    foreach ($due as $t) {
        $count = (int)$t['nag_count'];
        if ($count === 0) {
            $msg = '⏰ <b>Lembrete:</b> ' . e($t['text']) . "\n\nJá fez?";
        } else {
            $late = intdiv($now - (int)$t['due_at'], 60);
            $msg = "🔔 <b>Cobrança #$count</b> ($late min de atraso)\n" . e($t['text']) . "\n\nJá fez?";
        }
        try {
            $r = send((int)$t['chat_id'], $msg, nag_keyboard((int)$t['id']));
            if (empty($r['ok'])) {
                throw new RuntimeException(json_encode($r));
            }
            q("UPDATE tasks SET status = 'nagging', last_nag_at = ?, nag_count = nag_count + 1 WHERE id = ?", [$now, $t['id']]);
            q('INSERT OR REPLACE INTO nag_messages (chat_id, message_id, task_id) VALUES (?, ?, ?)',
                [$t['chat_id'], $r['result']['message_id'], $t['id']]);
            $sent++;
        } catch (Throwable $ex) {
            error_log("lembretes: falha ao cobrar tarefa {$t['id']}: " . $ex->getMessage());
        }
    }
    q('DELETE FROM updates WHERE at < ?', [$now - 2 * 86400]);
    return $sent;
}
