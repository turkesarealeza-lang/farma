<?php
// Telegram calls this URL for every message or button press.
declare(strict_types=1);
require __DIR__ . '/lib.php';

try {
    $secret = cfg()['webhook_secret'];
} catch (Throwable $ex) {
    http_response_code(503);
    exit;
}
if (!hash_equals($secret, $_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? '')) {
    http_response_code(403);
    exit;
}

$update = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($update) || !isset($update['update_id'])) {
    exit;
}

// Telegram resends an update if we're slow or fail; process each one only once.
try {
    q('INSERT INTO updates (update_id, at) VALUES (?, ?)', [$update['update_id'], time()]);
} catch (PDOException $ex) {
    exit;
}

try {
    handle_update($update);
} catch (Throwable $ex) {
    error_log('lembretes: erro no webhook: ' . $ex->getMessage());
}
