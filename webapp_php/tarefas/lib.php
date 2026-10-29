<?php
// Shared code for the tasks web app: config, database, auth, AI and Web Push.
declare(strict_types=1);

date_default_timezone_set('America/Sao_Paulo');

const CONFIG_FILE = __DIR__ . '/data/config.php';
const NAG_INTERVAL = 300;        // seconds between nags for notification tasks
const ALARM_INTERVAL = 60;       // alarm tasks ring again every minute until handled
const AUTH_COOKIE = 'tarefas_auth';
const SESSION_DAYS = 180;
const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

class ApiError extends RuntimeException
{
}

function cfg(): array
{
    static $c = null;
    if ($c === null) {
        if (!is_file(CONFIG_FILE)) {
            throw new RuntimeException('App não instalado. Abra install.php.');
        }
        $c = (require CONFIG_FILE) + [
            'ai_base' => ai_base(),
            'ai_chat_model' => 'openai/gpt-oss-120b',
            'ai_stt_model' => 'whisper-large-v3-turbo',
        ];
    }
    return $c;
}

// Overridable through an env var for local tests against a mock server.
function ai_base(): string
{
    return getenv('TAREFAS_AI_BASE') ?: 'https://api.groq.com/openai/v1';
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
    } elseif (isset($opts['body'])) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $opts['body']);
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
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                name          TEXT    NOT NULL,
                email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT    NOT NULL,
                is_admin      INTEGER NOT NULL DEFAULT 0,
                created_at    INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS auth_tokens (
                token_hash TEXT    PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS login_attempts (k TEXT NOT NULL, at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS tasks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL,
                text        TEXT    NOT NULL,
                due_at      INTEGER NOT NULL,
                status      TEXT    NOT NULL DEFAULT 'scheduled', -- scheduled | nagging | done | canceled
                last_nag_at INTEGER,
                nag_count   INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL,
                done_at     INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status, due_at);
            CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, status);
            CREATE TABLE IF NOT EXISTS push_subs (
                endpoint   TEXT    PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                p256dh     TEXT    NOT NULL,
                auth       TEXT    NOT NULL,
                created_at INTEGER NOT NULL
            );
        ");
        // Columns added after the first release; existing databases get them here.
        $cols = array_column($pdo->query('PRAGMA table_info(tasks)')->fetchAll(), 'name');
        $new = [
            'notes' => "TEXT NOT NULL DEFAULT ''",
            'checklist' => "TEXT NOT NULL DEFAULT '[]'",
            'desc_type' => "TEXT NOT NULL DEFAULT 'text'",  // text | checklist
            'mode' => "TEXT NOT NULL DEFAULT 'push'",       // push | alarm
            'base_at' => 'INTEGER',                          // time the user picked, kept through snoozes
            'recur' => "TEXT NOT NULL DEFAULT ''",           // '' | daily | weekdays | weekly | monthly
            'recur_days' => "TEXT NOT NULL DEFAULT ''",      // weekly: weekdays 0-6 (0 = Sunday); monthly: day of month
            'remind_before' => 'INTEGER NOT NULL DEFAULT 0',  // minutes of advance notice, 0 = none
            'pre_sent_for' => 'INTEGER',                     // due_at whose advance notice was already sent
        ];
        foreach ($new as $col => $def) {
            if (!in_array($col, $cols, true)) {
                $pdo->exec("ALTER TABLE tasks ADD COLUMN $col $def");
            }
        }
    }
    return $pdo;
}

function q(string $sql, array $args = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st;
}

// ---------- auth ----------

function cookie_path(): string
{
    return rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/') . '/';
}

function is_https(): bool
{
    return ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

function set_auth_cookie(string $value, int $expires): void
{
    setcookie(AUTH_COOKIE, $value, [
        'expires' => $expires, 'path' => cookie_path(), 'secure' => is_https(),
        'httponly' => true, 'samesite' => 'Lax',
    ]);
}

function current_user(): ?array
{
    $token = $_COOKIE[AUTH_COOKIE] ?? '';
    if ($token === '') {
        return null;
    }
    return q('SELECT u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.expires_at > ?',
        [hash('sha256', $token), time()])->fetch() ?: null;
}

function login(string $email, string $password): array
{
    $key = strtolower(trim($email)) . '|' . ($_SERVER['REMOTE_ADDR'] ?? '');
    q('DELETE FROM login_attempts WHERE at < ?', [time() - 900]);
    if (q('SELECT COUNT(*) FROM login_attempts WHERE k = ?', [$key])->fetchColumn() >= 8) {
        throw new ApiError('Muitas tentativas. Espere 15 minutos.', 429);
    }
    $user = q('SELECT * FROM users WHERE email = ?', [trim($email)])->fetch();
    if (!$user || !password_verify($password, $user['password_hash'])) {
        q('INSERT INTO login_attempts (k, at) VALUES (?, ?)', [$key, time()]);
        throw new ApiError('E-mail ou senha incorretos.', 401);
    }
    $token = bin2hex(random_bytes(32));
    $expires = time() + SESSION_DAYS * 86400;
    q('INSERT INTO auth_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [hash('sha256', $token), $user['id'], $expires]);
    q('DELETE FROM auth_tokens WHERE expires_at < ?', [time()]);
    set_auth_cookie($token, $expires);
    return $user;
}

function logout(): void
{
    $token = $_COOKIE[AUTH_COOKIE] ?? '';
    if ($token !== '') {
        q('DELETE FROM auth_tokens WHERE token_hash = ?', [hash('sha256', $token)]);
    }
    set_auth_cookie('', time() - 3600);
}

function create_user(string $name, string $email, string $password, bool $admin = false): int
{
    $name = trim($name);
    $email = trim($email);
    if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new ApiError('Informe nome e um e-mail válido.');
    }
    check_password($password);
    if (q('SELECT 1 FROM users WHERE email = ?', [$email])->fetch()) {
        throw new ApiError('Já existe um usuário com esse e-mail.');
    }
    q('INSERT INTO users (name, email, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)',
        [$name, $email, password_hash($password, PASSWORD_DEFAULT), (int)$admin, time()]);
    return (int)db()->lastInsertId();
}

function check_password(string $password): void
{
    if (mb_strlen($password) < 8) {
        throw new ApiError('A senha precisa ter pelo menos 8 caracteres.');
    }
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

function transcribe(string $file, string $filename): string
{
    $d = ai('/audio/transcriptions', ['form' => [
        'model' => cfg()['ai_stt_model'],
        'language' => 'pt',
        'file' => new CURLFile($file, '', $filename),
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
    // Providers retire models; fall back to another one so the app keeps working.
    $models = array_unique([cfg()['ai_chat_model'], 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
    foreach ($models as $i => $model) {
        try {
            $d = ai('/chat/completions', ['json' => [
                'model' => $model,
                'temperature' => 0,
                'response_format' => ['type' => 'json_object'],
                'messages' => [['role' => 'system', 'content' => $system], ['role' => 'user', 'content' => $text]],
            ]]);
            break;
        } catch (RuntimeException $ex) {
            error_log("tarefas: modelo $model falhou: " . $ex->getMessage());
            if ($i === array_key_last($models)) {
                throw $ex;
            }
        }
    }
    $content = $d['choices'][0]['message']['content'] ?? '';
    $out = json_decode($content, true);
    if (!is_array($out) && preg_match('/\{.*\}/s', $content, $m)) {
        $out = json_decode($m[0], true);
    }
    if (!is_array($out)) {
        throw new RuntimeException('Resposta da IA sem JSON: ' . mb_substr($content, 0, 200));
    }
    return ['task' => $out['task'] ?? null, 'datetime' => $out['datetime'] ?? null];
}

// ---------- tasks ----------

/** Parses "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM" in local time. */
function parse_local(string $s): ?int
{
    $dt = DateTime::createFromFormat('Y-m-d H:i', substr(str_replace('T', ' ', trim($s)), 0, 16));
    return $dt ? $dt->getTimestamp() : null;
}

function task_json(array $t): array
{
    return [
        'id' => (int)$t['id'], 'title' => $t['text'], 'due_at' => (int)$t['due_at'], 'status' => $t['status'],
        'nag_count' => (int)$t['nag_count'], 'done_at' => $t['done_at'] === null ? null : (int)$t['done_at'],
        'mode' => $t['mode'], 'desc_type' => $t['desc_type'], 'notes' => $t['notes'],
        'checklist' => json_decode($t['checklist'], true) ?: [],
        'base_at' => (int)($t['base_at'] ?? $t['due_at']), 'recur' => $t['recur'],
        'recur_days' => $t['recur_days'] === '' ? [] : array_map('intval', explode(',', $t['recur_days'])),
        'remind_before' => (int)$t['remind_before'],
    ];
}

const RECUR_TYPES = ['daily', 'weekdays', 'weekly', 'monthly'];
const REMIND_OPTIONS = [0, 5, 15, 30, 60];

/** Whether a recurring task falls on a given day. */
function recurs_on(array $t, DateTime $day, DateTime $base): bool
{
    $wd = (int)$day->format('w');
    switch ($t['recur']) {
        case 'daily':
            return true;
        case 'weekdays':
            return $wd >= 1 && $wd <= 5;
        case 'weekly':
            $days = $t['recur_days'] === '' ? [(int)$base->format('w')] : array_map('intval', explode(',', $t['recur_days']));
            return in_array($wd, $days, true);
        case 'monthly':  // same day of month; short months use their last day
            $dom = (int)$t['recur_days'] ?: (int)$base->format('j');
            return (int)$day->format('j') === min($dom, (int)$day->format('t'));
    }
    return false;
}

/** First occurrence of a recurring task strictly after $after, at the time of day of its base time. */
function next_occurrence(array $t, int $after): ?int
{
    $tz = new DateTimeZone(date_default_timezone_get());
    $base = (new DateTime('@' . (int)($t['base_at'] ?? $t['due_at'])))->setTimezone($tz);
    $day = (new DateTime('@' . $after))->setTimezone($tz);
    for ($i = 0; $i < 400; $i++) {
        $cand = (clone $day)->setTime((int)$base->format('H'), (int)$base->format('i'));
        if ($cand->getTimestamp() > $after && recurs_on($t, $cand, $base)) {
            return $cand->getTimestamp();
        }
        $day->modify('+1 day');
    }
    return null;
}

/**
 * Completes a task. A recurring task leaves a done copy for the history and moves on to its next
 * occurrence, with the checklist unticked again.
 */
function complete_task(array $t): void
{
    if ($t['recur'] === '') {
        q("UPDATE tasks SET status = 'done', done_at = ? WHERE id = ? AND status IN ('scheduled', 'nagging')", [time(), $t['id']]);
        return;
    }
    q("INSERT INTO tasks (user_id, text, due_at, base_at, status, nag_count, created_at, done_at, mode, desc_type, notes, checklist)
       VALUES (?, ?, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?)",
        [$t['user_id'], $t['text'], $t['due_at'], $t['due_at'], $t['nag_count'], time(), time(), $t['mode'], $t['desc_type'], $t['notes'], $t['checklist']]);
    advance_recurring($t);
}

/** Moves a recurring task to its next occurrence (after completing or skipping this one). */
function advance_recurring(array $t): void
{
    $next = next_occurrence($t, max((int)($t['base_at'] ?? $t['due_at']), time()));
    $items = array_map(fn($i) => ['t' => $i['t'], 'done' => false], json_decode($t['checklist'], true) ?: []);
    q("UPDATE tasks SET due_at = ?, base_at = ?, status = 'scheduled', last_nag_at = NULL, nag_count = 0, checklist = ? WHERE id = ?",
        [$next, $next, json_encode($items, JSON_UNESCAPED_UNICODE), $t['id']]);
}

/** Validates the checklist sent by the app: [{t: string, done: bool}, ...]. */
function clean_checklist($items): array
{
    $out = [];
    foreach (is_array($items) ? array_slice($items, 0, 100) : [] as $it) {
        $t = trim(mb_substr((string)($it['t'] ?? ''), 0, 300));
        if ($t !== '') {
            $out[] = ['t' => $t, 'done' => !empty($it['done'])];
        }
    }
    return $out;
}

/**
 * The day after the task's day (or after today, if it is already overdue), at the time of day the
 * user originally picked.
 */
function tomorrow_same_time(array $t): int
{
    $tz = new DateTimeZone(date_default_timezone_get());
    $base = (new DateTime('@' . (int)($t['base_at'] ?? $t['due_at'])))->setTimezone($tz);
    $d = (new DateTime('@' . max(time(), (int)$t['due_at'])))->setTimezone($tz)->modify('+1 day');
    $d->setTime((int)$base->format('H'), (int)$base->format('i'));
    return $d->getTimestamp();
}

function get_task(int $id, int $userId): array
{
    $t = q('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [$id, $userId])->fetch();
    if (!$t) {
        throw new ApiError('Tarefa não encontrada.', 404);
    }
    return $t;
}

/** Creates or updates a task from the editor's fields. */
function save_task(int $userId, ?int $id, array $in, int $due): array
{
    $title = trim(mb_substr((string)($in['title'] ?? ''), 0, 200));
    if ($title === '') {
        throw new ApiError('Dê um título para a tarefa.');
    }
    if ($due < time() - 60) {
        throw new ApiError('Esse horário já passou. Escolha uma data futura.');
    }
    $mode = ($in['mode'] ?? '') === 'alarm' ? 'alarm' : 'push';
    $descType = ($in['desc_type'] ?? '') === 'checklist' ? 'checklist' : 'text';
    $notes = trim(mb_substr((string)($in['notes'] ?? ''), 0, 5000));
    $checklist = json_encode(clean_checklist($in['checklist'] ?? []), JSON_UNESCAPED_UNICODE);
    $recur = in_array($in['recur'] ?? '', RECUR_TYPES, true) ? $in['recur'] : '';
    $days = $recur === 'weekly' && is_array($in['recur_days'] ?? null)
        ? array_values(array_unique(array_map('intval', array_filter($in['recur_days'], fn($d) => is_int($d) && $d >= 0 && $d <= 6))))
        : [];
    sort($days);
    if ($recur === 'monthly') {
        $days = [(int)date('j', $due)];  // remember "day 31" even after it lands on a shorter month's last day
    }
    $remind = (int)($in['remind_before'] ?? 0);
    $remind = in_array($remind, REMIND_OPTIONS, true) ? $remind : 0;
    $fields = [$title, $due, $due, $mode, $descType, $notes, $checklist, $recur, implode(',', $days), $remind];
    if ($id) {
        get_task($id, $userId);
        q("UPDATE tasks SET text = ?, due_at = ?, base_at = ?, mode = ?, desc_type = ?, notes = ?, checklist = ?,
           recur = ?, recur_days = ?, remind_before = ?, pre_sent_for = NULL,
           status = 'scheduled', last_nag_at = NULL, nag_count = 0, done_at = NULL WHERE id = ? AND user_id = ?",
            [...$fields, $id, $userId]);
    } else {
        q('INSERT INTO tasks (text, due_at, base_at, mode, desc_type, notes, checklist, recur, recur_days, remind_before, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [...$fields, $userId, time()]);
        $id = (int)db()->lastInsertId();
    }
    return task_json(get_task($id, $userId));
}

// ---------- Web Push (RFC 8030 / 8291 / 8292) ----------

function b64u(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

function b64u_decode(string $s): string
{
    return (string)base64_decode(strtr($s, '-_', '+/'));
}

function ec_new_key(): OpenSSLAsymmetricKey
{
    $k = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if (!$k) {
        throw new RuntimeException('OpenSSL não conseguiu gerar chave EC.');
    }
    return $k;
}

/** Uncompressed P-256 point (65 bytes) of a key. */
function ec_public_raw(OpenSSLAsymmetricKey $key): string
{
    $ec = openssl_pkey_get_details($key)['ec'];
    return "\x04" . str_pad($ec['x'], 32, "\0", STR_PAD_LEFT) . str_pad($ec['y'], 32, "\0", STR_PAD_LEFT);
}

function ec_public_from_raw(string $raw): OpenSSLAsymmetricKey
{
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $raw;
    $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
    $key = openssl_pkey_get_public($pem);
    if (!$key) {
        throw new RuntimeException('Chave pública de push inválida.');
    }
    return $key;
}

function vapid_generate(): array
{
    $k = ec_new_key();
    openssl_pkey_export($k, $pem);
    return ['vapid_private_pem' => $pem, 'vapid_public' => b64u(ec_public_raw($k))];
}

/** ECDSA DER signature → raw r||s (64 bytes), as JWS ES256 requires. */
function der_to_raw(string $der): string
{
    $pos = 2;
    $out = '';
    for ($i = 0; $i < 2; $i++) {
        $len = ord($der[$pos + 1]);
        $int = ltrim(substr($der, $pos + 2, $len), "\0");
        $out .= str_pad($int, 32, "\0", STR_PAD_LEFT);
        $pos += 2 + $len;
    }
    return $out;
}

function vapid_auth(string $endpoint): string
{
    $u = parse_url($endpoint);
    $aud = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
    $h = b64u(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $c = b64u(json_encode(['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => 'mailto:' . cfg()['vapid_subject']]));
    openssl_sign("$h.$c", $sig, cfg()['vapid_private_pem'], OPENSSL_ALGO_SHA256);
    return "vapid t=$h.$c." . b64u(der_to_raw($sig)) . ', k=' . cfg()['vapid_public'];
}

/** aes128gcm content encoding (RFC 8291). $salt/$asKey are only injected by tests. */
function push_encrypt(string $payload, string $uaPublic, string $authSecret, ?string $salt = null, ?OpenSSLAsymmetricKey $asKey = null): string
{
    $salt ??= random_bytes(16);
    $asKey ??= ec_new_key();
    $asPublic = ec_public_raw($asKey);
    $shared = openssl_pkey_derive(ec_public_from_raw($uaPublic), $asKey, 32);
    $ikm = hash_hkdf('sha256', $shared, 32, "WebPush: info\0" . $uaPublic . $asPublic, $authSecret);
    $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
    $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);
    $ct = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
    return $salt . pack('N', 4096) . chr(65) . $asPublic . $ct . $tag;
}

/** Sends a notification to every device of a user. Returns how many accepted it. */
function push_user(int $userId, array $payload, ?string $topic = null): int
{
    $ok = 0;
    foreach (q('SELECT * FROM push_subs WHERE user_id = ?', [$userId])->fetchAll() as $s) {
        try {
            $body = push_encrypt(json_encode($payload, JSON_UNESCAPED_UNICODE), b64u_decode($s['p256dh']), b64u_decode($s['auth']));
            $headers = [
                'Content-Type: application/octet-stream', 'Content-Encoding: aes128gcm',
                'TTL: 3600', 'Urgency: high', 'Authorization: ' . vapid_auth($s['endpoint']),
            ];
            if ($topic) {
                $headers[] = "Topic: $topic";  // replaces an undelivered older nag for the same task
            }
            $r = http($s['endpoint'], ['body' => $body, 'headers' => $headers, 'timeout' => 15]);
            if ($r['code'] === 404 || $r['code'] === 410) {
                q('DELETE FROM push_subs WHERE endpoint = ?', [$s['endpoint']]);  // device unsubscribed
            } elseif ($r['code'] >= 200 && $r['code'] < 300) {
                $ok++;
            } else {
                error_log("tarefas: push HTTP {$r['code']}: " . substr($r['raw'], 0, 200));
            }
        } catch (Throwable $ex) {
            error_log('tarefas: push falhou: ' . $ex->getMessage());
        }
    }
    return $ok;
}

// ---------- scheduler (called by cron) ----------

function run_nags(): int
{
    $now = time();
    $sent = 0;

    // Advance notice ("avisar antes"): one notification per occurrence, ahead of the due time.
    $pre = q("SELECT * FROM tasks WHERE status = 'scheduled' AND remind_before > 0 AND due_at > ?
              AND due_at - remind_before * 60 <= ? + 30 AND (pre_sent_for IS NULL OR pre_sent_for != due_at)", [$now, $now])->fetchAll();
    foreach ($pre as $t) {
        $mins = max(1, (int)round(((int)$t['due_at'] - $now) / 60));
        $in = $mins >= 60 ? intdiv($mins, 60) . ' h' . ($mins % 60 ? ' ' . ($mins % 60) . ' min' : '') : "$mins min";
        $kind = $t['mode'] === 'alarm' ? 'Alarme' : 'Lembrete';
        $payload = ['title' => "Em $in · " . $t['text'], 'body' => "$kind às " . date('H:i', (int)$t['due_at']) . '.', 'id' => (int)$t['id'], 'mode' => 'pre'];
        $sent += push_user((int)$t['user_id'], $payload, "pre{$t['id']}");
        q('UPDATE tasks SET pre_sent_for = due_at WHERE id = ?', [$t['id']]);
    }

    // 30s tolerance so a cron firing a few seconds early doesn't push the nag to the next minute.
    $due = q("SELECT * FROM tasks WHERE status IN ('scheduled', 'nagging') AND due_at <= ?
              AND (last_nag_at IS NULL OR last_nag_at <= ? - CASE mode WHEN 'alarm' THEN ? ELSE ? END + 30)
              ORDER BY due_at", [$now, $now, ALARM_INTERVAL, NAG_INTERVAL])->fetchAll();
    foreach ($due as $t) {
        $count = (int)$t['nag_count'];
        $late = intdiv($now - (int)$t['due_at'], 60);
        if ($t['mode'] === 'alarm') {
            $title = '⏰ ' . date('H:i', (int)$t['due_at']) . ' · ' . $t['text'];
            $body = $count === 0 ? 'Alarme! Toque para abrir.' : "Alarme tocando há $late min. Toque para abrir.";
        } else {
            $title = $count === 0 ? '🔔 ' . $t['text'] : "🔔 Cobrança #$count · $late min de atraso";
            $body = $count === 0 ? 'Já fez?' : $t['text'] . ' — já fez?';
        }
        $payload = ['title' => $title, 'body' => $body, 'id' => (int)$t['id'], 'mode' => $t['mode']];
        $sent += push_user((int)$t['user_id'], $payload, "task{$t['id']}");
        // Mark as nagged even without a device, so the cadence stays every 5 minutes.
        q("UPDATE tasks SET status = 'nagging', last_nag_at = ?, nag_count = nag_count + 1 WHERE id = ?", [$now, $t['id']]);
    }
    return $sent;
}
