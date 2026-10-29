<?php
// One-time setup: checks the server, validates the Groq key, creates the admin account and push keys.
declare(strict_types=1);
require __DIR__ . '/lib.php';

function page(string $body): never
{
    echo '<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<meta name="robots" content="noindex"><title>Instalar Tarefas</title><style>'
        . 'body{font-family:system-ui,sans-serif;max-width:640px;margin:32px auto;padding:0 16px;line-height:1.5;color:#f3efe9;background:#121110}'
        . 'input{width:100%;padding:10px;font-size:16px;box-sizing:border-box;margin:4px 0 16px;background:#1a1918;color:#f3efe9;border:1px solid #33302d;border-radius:10px}'
        . 'button,.btn{display:inline-block;padding:12px 20px;font-size:16px;background:#d4622b;color:#fff;border:0;border-radius:999px;cursor:pointer;text-decoration:none;font-weight:600}'
        . '.ok{color:#7fcf9b}.err{color:#f06f7a;background:rgba(240,111,122,.12);padding:10px;border-radius:10px}'
        . 'code,pre{background:#21201e;padding:2px 6px;border-radius:6px;word-break:break-all;white-space:pre-wrap}'
        . '</style></head><body><h1>✅ Tarefas — instalação</h1>' . $body . '</body></html>';
    exit;
}

function cron_help(): string
{
    $path = __DIR__ . '/cron.php';
    $rel = preg_replace('~^/home/[^/]+/~', '', $path);
    return '<h2>Agendar os lembretes (cron)</h2>'
        . '<p>No hPanel: <b>Sites → Painel → Avançado → Cron Jobs</b>.</p>'
        . '<ol><li>Tipo: <b>PHP</b></li>'
        . '<li>Comando a ser executado: <pre>' . htmlspecialchars($rel) . '</pre></li>'
        . '<li>Frequência: <b>A cada minuto</b></li><li>Clique em <b>Salvar</b>.</li></ol>'
        . '<p>Se o hPanel pedir o comando completo (tipo "Personalizado"), use:</p><pre>/usr/bin/php ' . htmlspecialchars($path) . '</pre>';
}

function requirements(): array
{
    $err = [];
    if (PHP_VERSION_ID < 80100) $err[] = 'PHP 8.1 ou mais novo é necessário (atual: ' . PHP_VERSION . '). Mude em hPanel → Avançado → Configuração do PHP.';
    foreach (['curl', 'pdo_sqlite', 'openssl'] as $ext) {
        if (!extension_loaded($ext)) $err[] = "Extensão PHP \"$ext\" desativada. Ative em hPanel → Avançado → Configuração do PHP → Extensões.";
    }
    if (!is_writable(__DIR__ . '/data')) $err[] = 'A pasta data/ não tem permissão de escrita.';
    if (!$err) {
        try {
            vapid_generate();
        } catch (Throwable $ex) {
            $err[] = 'O OpenSSL do servidor não gera chaves de notificação: ' . $ex->getMessage();
        }
    }
    if (!is_https()) $err[] = 'Abra esta página com https:// (notificações exigem SSL ativo).';
    return $err;
}

if (is_file(CONFIG_FILE)) {
    page('<p class="ok">✔ App já instalado.</p><p><a class="btn" href="./">Abrir o app</a></p>' . cron_help()
        . '<p>Para reinstalar do zero (apaga usuários e tarefas), apague a pasta <code>data</code> e envie-a de novo.</p>');
}

if ($err = requirements()) {
    page('<p class="err">' . implode('<br>', array_map('htmlspecialchars', $err)) . '</p>');
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $key = trim($_POST['key'] ?? '');
    $name = trim($_POST['name'] ?? '');
    $email = trim($_POST['email'] ?? '');
    $password = (string)($_POST['password'] ?? '');
    $ai = http(ai_base() . '/models', ['headers' => ['Authorization: Bearer ' . $key]]);
    if ($ai['code'] !== 200) {
        $error = "Chave do Groq recusada (HTTP {$ai['code']}). Crie outra em console.groq.com/keys.";
    } elseif ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $error = 'Informe seu nome e um e-mail válido.';
    } elseif (mb_strlen($password) < 8) {
        $error = 'A senha precisa ter pelo menos 8 caracteres.';
    } else {
        $config = ['ai_key' => $key, 'vapid_subject' => $email, 'db_file' => 'tarefas-' . bin2hex(random_bytes(8)) . '.sqlite'] + vapid_generate();
        file_put_contents(CONFIG_FILE, "<?php\nreturn " . var_export($config, true) . ";\n");
        @chmod(CONFIG_FILE, 0600);
        create_user($name, $email, $password, true);
        page('<p class="ok">✔ Instalado! Sua conta de administrador: <b>' . htmlspecialchars($email) . '</b></p>'
            . cron_help() . '<p><a class="btn" href="./">Abrir o app e entrar</a></p>');
    }
}

page(($error ? '<p class="err">' . htmlspecialchars($error) . '</p>' : '')
    . '<form method="post">'
    . '<label>Chave da API do Groq<input name="key" required placeholder="gsk_..." autocomplete="off"></label>'
    . '<h3>Sua conta (administrador)</h3>'
    . '<label>Nome<input name="name" required value="' . htmlspecialchars($_POST['name'] ?? '') . '"></label>'
    . '<label>E-mail<input name="email" type="email" required value="' . htmlspecialchars($_POST['email'] ?? '') . '"></label>'
    . '<label>Senha (mín. 8 caracteres)<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>'
    . '<button>Instalar</button></form>');
