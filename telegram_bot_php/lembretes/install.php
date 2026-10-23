<?php
// One-time setup wizard: validates the keys, finds the owner's chat ID, writes the config and registers the webhook.
declare(strict_types=1);
require __DIR__ . '/lib.php';
session_start();

function page(string $body): never
{
    echo '<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>Instalar bot de lembretes</title><style>'
        . 'body{font-family:system-ui,sans-serif;max-width:640px;margin:32px auto;padding:0 16px;line-height:1.5;color:#222;background:#fafafa}'
        . 'input{width:100%;padding:10px;font-size:16px;box-sizing:border-box;margin:4px 0 16px}'
        . 'button{padding:12px 20px;font-size:16px;background:#2563eb;color:#fff;border:0;border-radius:6px;cursor:pointer}'
        . '.ok{color:#15803d}.err{color:#b91c1c;background:#fee2e2;padding:10px;border-radius:6px}'
        . 'code,pre{background:#eee;padding:2px 6px;border-radius:4px;word-break:break-all;white-space:pre-wrap}'
        . '</style></head><body><h1>🤖 Bot de lembretes</h1>' . $body . '</body></html>';
    exit;
}

function cron_help(): string
{
    $path = __DIR__ . '/cron.php';
    $rel = preg_replace('~^/home/[^/]+/~', '', $path);
    return '<h2>Último passo: agendar a cobrança (cron)</h2>'
        . '<p>No hPanel: <b>Sites → Painel → Avançado → Cron Jobs</b>.</p>'
        . '<ol><li>Tipo: <b>PHP</b></li>'
        . '<li>Comando a ser executado: <pre>' . e($rel) . '</pre></li>'
        . '<li>Frequência: <b>A cada minuto</b> (todos os campos <code>*</code>)</li>'
        . '<li>Clique em <b>Salvar</b>.</li></ol>'
        . '<p>Se o hPanel pedir o comando completo (tipo "Personalizado"), use:</p><pre>/usr/bin/php ' . e($path) . '</pre>';
}

function requirements(): array
{
    $err = [];
    if (PHP_VERSION_ID < 80100) $err[] = 'PHP 8.1 ou mais novo é necessário (atual: ' . PHP_VERSION . '). Mude em hPanel → Avançado → Configuração do PHP.';
    if (!extension_loaded('curl')) $err[] = 'Extensão PHP "curl" desativada.';
    if (!extension_loaded('pdo_sqlite')) $err[] = 'Extensão PHP "pdo_sqlite" desativada. Ative em hPanel → Avançado → Configuração do PHP → Extensões.';
    if (!is_writable(__DIR__ . '/data')) $err[] = 'A pasta data/ não tem permissão de escrita.';
    return $err;
}

// ---------- already installed ----------
if (is_file(CONFIG_FILE)) {
    $info = tg('getWebhookInfo')['result'] ?? [];
    $status = empty($info['url'])
        ? '<p class="err">Webhook não registrado. Apague <code>data/config.php</code> e rode o instalador de novo.</p>'
        : '<p class="ok">✔ Webhook ativo.</p>'
          . (!empty($info['last_error_message']) ? '<p class="err">Último erro do Telegram: ' . e($info['last_error_message']) . '</p>' : '');
    page('<p class="ok">✔ Bot já instalado.</p>' . $status . cron_help()
        . '<p>Para reconfigurar, apague <code>data/config.php</code> no Gerenciador de Arquivos e abra esta página de novo.</p>');
}

if ($err = requirements()) {
    page('<p class="err">' . implode('<br>', array_map('e', $err)) . '</p>');
}

$step = $_POST['step'] ?? '';

// ---------- step 2: find the owner's chat ID and finish ----------
if ($step === 'chat' && isset($_SESSION['token'], $_SESSION['key'])) {
    $token = $_SESSION['token'];
    $updates = tg('getUpdates', [], $token)['result'] ?? [];
    $chatId = null;
    foreach (array_reverse($updates) as $u) {
        if (isset($u['message']['chat']['id'])) {
            $chatId = (int)$u['message']['chat']['id'];
            break;
        }
    }
    if (!$chatId) {
        page('<p class="err">Ainda não recebi sua mensagem. No Telegram, abra <b>@' . e($_SESSION['bot']) . '</b>, toque em <b>Iniciar</b> e mande <b>oi</b>.</p>'
            . '<form method="post"><input type="hidden" name="step" value="chat"><button>Já mandei, continuar</button></form>');
    }

    $config = [
        'telegram_token' => $token,
        'ai_key' => $_SESSION['key'],
        'allowed_chat_ids' => [$chatId],
        'webhook_secret' => bin2hex(random_bytes(24)),
        'db_file' => 'lembretes-' . bin2hex(random_bytes(8)) . '.sqlite',
    ];
    file_put_contents(CONFIG_FILE, "<?php\nreturn " . var_export($config, true) . ";\n");
    @chmod(CONFIG_FILE, 0600);
    db();  // creates the tables

    $https = 'https://' . $_SERVER['HTTP_HOST'] . rtrim(dirname($_SERVER['SCRIPT_NAME']), '/') . '/webhook.php';
    $r = tg('setWebhook', [
        'url' => $https,
        'secret_token' => $config['webhook_secret'],
        'allowed_updates' => ['message', 'callback_query'],
        'drop_pending_updates' => true,
    ]);
    if (empty($r['ok'])) {
        unlink(CONFIG_FILE);
        page('<p class="err">O Telegram recusou o endereço <code>' . e($https) . '</code>: ' . e($r['description'] ?? 'erro desconhecido')
            . '</p><p>Confira se o SSL (https) do domínio está ativo no hPanel e tente de novo.</p>'
            . '<form method="post"><input type="hidden" name="step" value="chat"><button>Tentar de novo</button></form>');
    }
    send($chatId, "✅ <b>Bot instalado!</b>\n\n" . HELP);
    session_destroy();
    page('<p class="ok">✔ Configuração salva. Seu chat ID: <code>' . $chatId . '</code> (só você pode usar o bot).</p>'
        . '<p class="ok">✔ Webhook registrado. Você deve ter recebido uma mensagem do bot no Telegram.</p>' . cron_help());
}

// ---------- step 1: validate token and AI key ----------
$error = '';
if ($step === 'keys') {
    $token = trim($_POST['token'] ?? '');
    $key = trim($_POST['key'] ?? '');
    $me = $token !== '' ? tg('getMe', [], $token) : [];
    $ai = http(ai_base() . '/models', ['headers' => ['Authorization: Bearer ' . $key]]);
    if (empty($me['ok'])) {
        $error = 'Token do Telegram inválido. Copie de novo do @BotFather (sem espaços).';
    } elseif ($ai['code'] !== 200) {
        $error = "Chave do Groq recusada (HTTP {$ai['code']}). Crie outra em console.groq.com/keys.";
    } else {
        tg('deleteWebhook', [], $token);  // getUpdates only works without a webhook
        $_SESSION['token'] = $token;
        $_SESSION['key'] = $key;
        $_SESSION['bot'] = $me['result']['username'];
        page('<p class="ok">✔ Bot encontrado: <b>@' . e($_SESSION['bot']) . '</b><br>✔ Chave do Groq válida</p>'
            . '<p>Agora, no Telegram, abra <a href="https://t.me/' . e($_SESSION['bot']) . '" target="_blank"><b>@' . e($_SESSION['bot'])
            . '</b></a>, toque em <b>Iniciar</b> e mande <b>oi</b>. Depois clique abaixo.</p>'
            . '<form method="post"><input type="hidden" name="step" value="chat"><button>Já mandei, continuar</button></form>');
    }
}

page(($error ? '<p class="err">' . e($error) . '</p>' : '')
    . '<form method="post"><input type="hidden" name="step" value="keys">'
    . '<label>Token do BotFather<input name="token" required placeholder="123456789:AA..." autocomplete="off"></label>'
    . '<label>Chave da API do Groq<input name="key" required placeholder="gsk_..." autocomplete="off"></label>'
    . '<button>Validar e continuar</button></form>');
