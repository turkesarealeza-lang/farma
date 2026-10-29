<?php
// JSON API used by the app (app.js) and the service worker (sw.js).
declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function out(array $data, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function input(): array
{
    return json_decode(file_get_contents('php://input') ?: '', true) ?: [];
}

function need_admin(array $u): void
{
    if (!$u['is_admin']) {
        throw new ApiError('Só o administrador pode fazer isso.', 403);
    }
}

function user_json(array $u): array
{
    return ['id' => (int)$u['id'], 'name' => $u['name'], 'email' => $u['email'], 'is_admin' => (bool)$u['is_admin']];
}

/** Turns free text (typed or spoken) into a title and date for the editor to fill in; nothing is saved. */
function parse_text(string $text): array
{
    $p = parse_reminder($text);
    if (!$p['task']) {
        throw new ApiError('Não entendi como tarefa. Ex: "ligar pro João amanhã às 14h".', 422);
    }
    $due = $p['datetime'] ? parse_local($p['datetime']) : null;
    return ['title' => $p['task'], 'due_at' => $due && $due > time() - 60 ? $due : null];
}

$a = $_GET['a'] ?? '';
$post = $_SERVER['REQUEST_METHOD'] === 'POST';
// Cross-site pages can't send this custom header without a CORS preflight, which we never allow.
if ($post && ($_SERVER['HTTP_X_TAREFAS'] ?? '') !== '1') {
    out(['error' => 'Requisição inválida.'], 403);
}

try {
    if ($a === 'login' && $post) {
        $in = input();
        out(['user' => user_json(login((string)($in['email'] ?? ''), (string)($in['password'] ?? '')))]);
    }

    $u = current_user();
    if (!$u) {
        out(['error' => 'Faça login.'], 401);
    }
    $uid = (int)$u['id'];

    switch ("$a:" . ($post ? 'POST' : 'GET')) {
        case 'me:GET':
            out(['user' => user_json($u), 'vapid' => cfg()['vapid_public']]);

        case 'logout:POST':
            logout();
            out(['ok' => true]);

        case 'tasks:GET':
            $open = q("SELECT * FROM tasks WHERE user_id = ? AND status IN ('scheduled', 'nagging') ORDER BY due_at", [$uid])->fetchAll();
            $done = q("SELECT * FROM tasks WHERE user_id = ? AND status = 'done' AND done_at > ? ORDER BY done_at DESC LIMIT 200",
                [$uid, time() - 62 * 86400])->fetchAll();
            out(['open' => array_map('task_json', $open), 'done' => array_map('task_json', $done), 'now' => time()]);

        case 'parse:POST':
            out(parse_text(trim((string)(input()['text'] ?? ''))));

        case 'audio:POST':
            $f = $_FILES['audio'] ?? null;
            if (!$f || $f['error'] !== UPLOAD_ERR_OK) {
                throw new ApiError('Áudio não recebido. Tente gravar de novo.');
            }
            $ext = strtolower(pathinfo((string)$f['name'], PATHINFO_EXTENSION));
            $ext = in_array($ext, ['webm', 'm4a', 'mp4', 'ogg', 'wav', 'mp3'], true) ? $ext : 'webm';
            $text = transcribe($f['tmp_name'], "audio.$ext");
            if ($text === '') {
                throw new ApiError('Não entendi nada no áudio. Tente de novo.', 422);
            }
            out(['transcript' => $text] + parse_text($text));

        case 'save:POST':
            $in = input();
            $due = parse_local((string)($in['due'] ?? ''));
            if (!$due) {
                throw new ApiError('Escolha data e hora.');
            }
            out(['task' => save_task($uid, !empty($in['id']) ? (int)$in['id'] : null, $in, $due)]);

        case 'check:POST':  // tick or untick one checklist item
            $in = input();
            $t = get_task((int)($in['id'] ?? 0), $uid);
            $items = json_decode($t['checklist'], true) ?: [];
            $i = (int)($in['index'] ?? -1);
            if (!isset($items[$i])) {
                throw new ApiError('Item não encontrado.', 404);
            }
            $items[$i]['done'] = !empty($in['done']);
            q('UPDATE tasks SET checklist = ? WHERE id = ?', [json_encode($items, JSON_UNESCAPED_UNICODE), $t['id']]);
            out(['task' => task_json(get_task((int)$t['id'], $uid))]);

        case 'act:POST':
            $in = input();
            $id = (int)($in['id'] ?? 0);
            $task = get_task($id, $uid);
            $open = "AND status IN ('scheduled', 'nagging')";
            switch ($in['action'] ?? '') {
                case 'done':
                    q("UPDATE tasks SET status = 'done', done_at = ? WHERE id = ? $open", [time(), $id]);
                    break;
                case 'delete':
                    q('DELETE FROM tasks WHERE id = ?', [$id]);
                    out(['ok' => true]);
                case 'reopen':
                    q("UPDATE tasks SET status = 'scheduled', done_at = NULL, last_nag_at = NULL, nag_count = 0,
                       due_at = MAX(due_at, ?) WHERE id = ? AND status = 'done'", [time() + 300, $id]);
                    break;
                case 'snooze':
                    if (($in['until'] ?? '') === 'tomorrow') {  // same time of day, next day; becomes the new base time
                        $until = tomorrow_same_time($task);
                        q("UPDATE tasks SET due_at = ?, base_at = ?, status = 'scheduled', last_nag_at = NULL WHERE id = ? $open", [$until, $until, $id]);
                    } else {
                        $until = time() + max(1, (int)($in['minutes'] ?? 5)) * 60;
                        q("UPDATE tasks SET due_at = ?, status = 'scheduled', last_nag_at = NULL WHERE id = ? $open", [$until, $id]);
                    }
                    break;
                default:
                    throw new ApiError('Ação inválida.');
            }
            out(['task' => task_json(get_task($id, $uid))]);

        case 'subscribe:POST':
            $in = input();
            $endpoint = (string)($in['endpoint'] ?? '');
            if (!preg_match('~^https://~', $endpoint) || empty($in['keys']['p256dh']) || empty($in['keys']['auth'])) {
                throw new ApiError('Inscrição de notificação inválida.');
            }
            q('INSERT OR REPLACE INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)',
                [$endpoint, $uid, $in['keys']['p256dh'], $in['keys']['auth'], time()]);
            out(['ok' => true]);

        case 'unsubscribe:POST':
            q('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?', [(string)(input()['endpoint'] ?? ''), $uid]);
            out(['ok' => true]);

        case 'test_push:POST':
            $n = push_user($uid, ['title' => '🔔 Teste', 'body' => 'As notificações estão funcionando!', 'id' => 0]);
            out(['sent' => $n]);

        case 'password:POST':
            $in = input();
            if (!password_verify((string)($in['current'] ?? ''), $u['password_hash'])) {
                throw new ApiError('Senha atual incorreta.');
            }
            check_password((string)($in['new'] ?? ''));
            q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string)$in['new'], PASSWORD_DEFAULT), $uid]);
            out(['ok' => true]);

        case 'users:GET':
            need_admin($u);
            out(['users' => array_map('user_json', q('SELECT * FROM users ORDER BY name')->fetchAll())]);

        case 'user_save:POST':
            need_admin($u);
            $in = input();
            if (!empty($in['id'])) {  // admin resets someone's password
                check_password((string)($in['password'] ?? ''));
                q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string)$in['password'], PASSWORD_DEFAULT), (int)$in['id']]);
                q('DELETE FROM auth_tokens WHERE user_id = ?', [(int)$in['id']]);
                out(['ok' => true]);
            }
            create_user((string)($in['name'] ?? ''), (string)($in['email'] ?? ''), (string)($in['password'] ?? ''));
            out(['ok' => true]);

        case 'user_delete:POST':
            need_admin($u);
            $id = (int)(input()['id'] ?? 0);
            if ($id === $uid) {
                throw new ApiError('Você não pode remover a si mesmo.');
            }
            foreach (['tasks', 'push_subs', 'auth_tokens'] as $table) {
                q("DELETE FROM $table WHERE user_id = ?", [$id]);
            }
            q('DELETE FROM users WHERE id = ?', [$id]);
            out(['ok' => true]);
    }
    out(['error' => 'Rota inválida.'], 404);
} catch (ApiError $ex) {
    out(['error' => $ex->getMessage()], $ex->getCode() ?: 400);
} catch (Throwable $ex) {
    error_log('tarefas: ' . $ex->getMessage());
    $admin = isset($u) && $u && $u['is_admin'];
    out(['error' => 'Deu erro no servidor. Tente de novo em instantes.' . ($admin ? ' 🔧 ' . mb_substr($ex->getMessage(), 0, 300) : '')], 500);
}
