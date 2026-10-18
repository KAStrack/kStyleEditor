<?php

declare(strict_types=1);

/*
 * The shared conformance cases, run against the PHP SDK. No dependencies:
 *
 *   php tests/php/conformance.php
 *
 * Exits non-zero if any case fails.
 */

require __DIR__ . '/../../sdk/php/autoload.php';

use Kastrack\StyleEditor\Css;

$cases = json_decode((string) file_get_contents(__DIR__ . '/../fixtures/cases.json'), true, 512, JSON_THROW_ON_ERROR);

$total = 0;
$failed = 0;

function check(string $name, bool $ok, mixed $got = null, mixed $want = null): void
{
    global $total, $failed;
    $total++;
    if (!$ok) {
        $failed++;
        echo "FAIL {$name}\n  got:  " . json_encode($got, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
            . "\n  want: " . json_encode($want, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
    }
}

check('DEFAULT_ALLOW matches the fixture list', Css::DEFAULT_ALLOW === $cases['defaultAllow'], Css::DEFAULT_ALLOW, $cases['defaultAllow']);

foreach ($cases['parse'] as $c) {
    $got = Css::parse($c['input']);
    check('parse: ' . $c['name'], $got === $c['expect'], $got, $c['expect']);
}

foreach ($cases['stringify'] as $c) {
    $got = Css::stringify($c['input'], $c['options']);
    check('stringify: ' . $c['name'], $got === $c['expect'], $got, $c['expect']);
}

foreach ($cases['sanitize'] as $c) {
    $got = Css::sanitize($c['input'], $c['options']);
    check('sanitize: ' . $c['name'], $got === $c['expect'], $got, $c['expect']);
    $rejected = array_map(
        fn (array $r): array => ['property' => $r['property'], 'reason' => $r['reason']],
        Css::clean($c['input'], $c['options'])['rejected']
    );
    check('clean: ' . $c['name'], $rejected === $c['rejected'], $rejected, $c['rejected']);
}

foreach ($cases['invalidSelectors'] as $selector) {
    $threw = false;
    try {
        Css::sanitize('color: red', ['selector' => $selector]);
    } catch (InvalidArgumentException $e) {
        $threw = true;
    }
    check('invalid selector is refused: ' . json_encode($selector), $threw);
}

echo "PHP SDK: {$total} checks, failures: {$failed}\n";
exit($failed ? 1 : 0);
