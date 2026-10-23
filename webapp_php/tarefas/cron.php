<?php
// Run every minute by the hPanel cron: sends reminders and nags that are due.
declare(strict_types=1);
require __DIR__ . '/lib.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}

// Skip if the previous run is still going.
$lock = fopen(__DIR__ . '/data/cron.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
    exit;
}
$sent = run_nags();
echo date('Y-m-d H:i:s') . " ok, $sent notificação(ões)\n";
