<?php

declare(strict_types=1);

namespace Kastrack\StyleEditor;

use InvalidArgumentException;

/**
 * Parse, serialise and sanitise the CSS declarations kStyleEditor writes.
 *
 * A port of src/k-style-css.js, held to the same behaviour by
 * tests/fixtures/cases.json. SPEC.md is the prose version. Everything works
 * on bytes: every character the rules care about is ASCII, and UTF-8 never
 * puts an ASCII byte inside a multi-byte character.
 *
 * A declaration is ['property' => string, 'value' => string, 'important' => bool].
 */
final class Css
{
    public const VERSION = '0.1.3';

    /**
     * Every property the built-in controls can write, plus the common
     * shorthands people type into the Code tab.
     */
    public const DEFAULT_ALLOW = [
        'color',
        'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
        'background', 'background-color', 'background-image', 'background-size',
        'background-position', 'background-repeat', 'background-attachment',
        'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform',
        'text-decoration', 'text-decoration-line', 'text-decoration-style',
        'text-decoration-color', 'text-decoration-thickness', 'text-underline-offset',
        'text-shadow', 'text-indent', 'white-space', 'word-break', 'overflow-wrap',
        'vertical-align',
        'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
        'border-width', 'border-style', 'border-color',
        'border-radius', 'border-top-left-radius', 'border-top-right-radius',
        'border-bottom-right-radius', 'border-bottom-left-radius',
        'outline', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
        'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
        'box-sizing', 'aspect-ratio',
        'display', 'overflow', 'overflow-x', 'overflow-y', 'float', 'clear', 'visibility',
        'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content',
        'gap', 'row-gap', 'column-gap', 'flex', 'flex-grow', 'flex-shrink', 'flex-basis',
        'align-self', 'order', 'grid-template-columns', 'grid-template-rows',
        'position', 'inset', 'top', 'right', 'bottom', 'left', 'z-index',
        'opacity', 'box-shadow', 'transform', 'filter', 'mix-blend-mode', 'transition',
        'cursor', 'pointer-events', 'user-select',
        'list-style', 'list-style-type', 'list-style-position',
    ];

    /** Never allowed, whatever the allow-list says. */
    private const BLOCKED = ['behavior', '-moz-binding'];

    /** Lower-cased, space-free fragments refused anywhere in a value. */
    private const BAD_FRAGMENTS = [
        'expression(', 'javascript:', 'vbscript:', '-moz-binding', '@import',
        'image-set(', 'image(', 'element(', 'cross-fade(', 'src(',
    ];

    private const DATA_IMAGES = ['data:image/png', 'data:image/gif', 'data:image/jpeg', 'data:image/webp'];

    private const SPACE = " \t\n\r\f";

    // ─── parse ──────────────────────────────────────────────────────────────

    /**
     * Read CSS declarations, in order. Accepts a bare list or one rule
     * (`sel { ... }`). Never validates — that is sanitize()'s job.
     *
     * @return list<array{property: string, value: string, important: bool}>
     */
    public static function parse(?string $css): array
    {
        $out = [];
        if ($css === null) {
            return $out;
        }
        foreach (self::splitDeclarations(self::ruleBody(self::stripComments($css))) as $piece) {
            $colon = strpos($piece, ':');
            if ($colon === false) {
                continue;
            }
            $property = self::collapse(self::trim(substr($piece, 0, $colon)));
            if (strncmp($property, '--', 2) !== 0) {
                $property = strtolower($property);
            }
            $value = self::collapse(self::trim(substr($piece, $colon + 1)));
            $important = false;
            if (preg_match('/ *! *important$/iD', $value) === 1) {
                $important = true;
                $value = self::trim((string) preg_replace('/ *! *important$/iD', '', $value));
            }
            if ($property === '' || $value === '') {
                continue;
            }
            $out[] = ['property' => $property, 'value' => $value, 'important' => $important];
        }
        return $out;
    }

    // ─── stringify ──────────────────────────────────────────────────────────

    /**
     * Write declarations back out.
     *
     * Options: 'pretty' (default true) for one per line; 'selector' to wrap
     * them in `selector { ... }`. An empty list is always ''.
     *
     * @param iterable<array{property: string, value: string, important?: bool}> $declarations
     * @param array{selector?: ?string, pretty?: bool, allow?: mixed} $options
     * @throws InvalidArgumentException for an unsafe selector
     */
    public static function stringify(iterable $declarations, array $options = []): string
    {
        $pretty = ($options['pretty'] ?? true) !== false;
        $selector = isset($options['selector']) && $options['selector'] !== ''
            ? self::checkSelector((string) $options['selector'])
            : '';
        $lines = [];
        foreach ($declarations as $d) {
            $lines[] = $d['property'] . ': ' . $d['value'] . (!empty($d['important']) ? ' !important' : '') . ';';
        }
        if ($lines === []) {
            return '';
        }
        if ($selector === '') {
            return implode($pretty ? "\n" : ' ', $lines);
        }
        if ($pretty) {
            return $selector . " {\n  " . implode("\n  ", $lines) . "\n}";
        }
        return $selector . ' { ' . implode(' ', $lines) . ' }';
    }

    // ─── clean / sanitize ───────────────────────────────────────────────────

    /**
     * Split CSS into what sanitize() would keep and what it would drop.
     *
     * Rejection reasons: property, blocked, not-allowed, value, url.
     *
     * @param array{allow?: list<string>|string|null} $options
     * @return array{declarations: list<array{property: string, value: string, important: bool}>,
     *               rejected: list<array{property: string, value: string, reason: string}>}
     */
    public static function clean(?string $css, array $options = []): array
    {
        $allow = $options['allow'] ?? null;
        if ($allow === null) {
            $allow = self::DEFAULT_ALLOW;
        }
        $kept = [];
        $rejected = [];
        foreach (self::parse($css) as $d) {
            $why = self::reject($d, $allow);
            if ($why !== '') {
                $rejected[] = ['property' => $d['property'], 'value' => $d['value'], 'reason' => $why];
            } else {
                $kept[] = $d;
            }
        }
        return ['declarations' => $kept, 'rejected' => $rejected];
    }

    /**
     * Untrusted CSS in, safe CSS out.
     *
     * Options: 'allow' — property names to keep (default DEFAULT_ALLOW); a
     * trailing `*` is a prefix match, and '*' keeps any well-formed name.
     * 'selector' and 'pretty' as stringify().
     *
     * @param array{allow?: list<string>|string|null, selector?: ?string, pretty?: bool} $options
     * @throws InvalidArgumentException for an unsafe selector
     */
    public static function sanitize(?string $css, array $options = []): string
    {
        return self::stringify(self::clean($css, $options)['declarations'], $options);
    }

    // ─── Internals ──────────────────────────────────────────────────────────

    private static function trim(string $s): string
    {
        return trim($s, self::SPACE);
    }

    private static function collapse(string $s): string
    {
        return (string) preg_replace('/[ \t\n\r\f]+/', ' ', $s);
    }

    private static function stripComments(string $css): string
    {
        $out = '';
        $quote = '';
        $n = strlen($css);
        for ($i = 0; $i < $n; $i++) {
            $ch = $css[$i];
            if ($quote !== '') {
                $out .= $ch;
                if ($ch === '\\' && $i + 1 < $n) {
                    $out .= $css[++$i];
                    continue;
                }
                if ($ch === $quote) {
                    $quote = '';
                }
                continue;
            }
            if ($ch === '"' || $ch === "'") {
                $quote = $ch;
                $out .= $ch;
                continue;
            }
            if ($ch === '/' && $i + 1 < $n && $css[$i + 1] === '*') {
                $end = strpos($css, '*/', $i + 2);
                $i = $end === false ? $n : $end + 1;
                $out .= ' ';
                continue;
            }
            $out .= $ch;
        }
        return $out;
    }

    private static function ruleBody(string $css): string
    {
        $quote = '';
        $open = -1;
        $depth = 0;
        $n = strlen($css);
        for ($i = 0; $i < $n; $i++) {
            $ch = $css[$i];
            if ($quote !== '') {
                if ($ch === '\\') {
                    $i++;
                    continue;
                }
                if ($ch === $quote) {
                    $quote = '';
                }
                continue;
            }
            if ($ch === '"' || $ch === "'") {
                $quote = $ch;
                continue;
            }
            if ($ch === '{') {
                if ($open === -1) {
                    $open = $i;
                }
                $depth++;
            } elseif ($ch === '}' && $open !== -1) {
                $depth--;
                if ($depth === 0) {
                    return substr($css, $open + 1, $i - $open - 1);
                }
            }
        }
        return $open === -1 ? $css : substr($css, $open + 1);
    }

    /** @return list<string> */
    private static function splitDeclarations(string $body): array
    {
        $parts = [];
        $quote = '';
        $depth = 0;
        $start = 0;
        $n = strlen($body);
        for ($i = 0; $i < $n; $i++) {
            $ch = $body[$i];
            if ($quote !== '') {
                if ($ch === '\\') {
                    $i++;
                    continue;
                }
                if ($ch === $quote) {
                    $quote = '';
                }
                continue;
            }
            if ($ch === '"' || $ch === "'") {
                $quote = $ch;
            } elseif ($ch === '(') {
                $depth++;
            } elseif ($ch === ')') {
                if ($depth > 0) {
                    $depth--;
                }
            } elseif ($ch === ';' && $depth === 0) {
                $parts[] = substr($body, $start, $i - $start);
                $start = $i + 1;
            }
        }
        $parts[] = (string) substr($body, $start);
        return $parts;
    }

    private static function checkSelector(string $selector): string
    {
        $s = self::collapse(self::trim($selector));
        if ($s === '' || preg_match('/[{}<;\\\\\x00-\x1f\x7f]/', $s) === 1 || str_contains($s, '/*')) {
            throw new InvalidArgumentException('kStyleCss: invalid selector "' . $selector . '"');
        }
        return $s;
    }

    /** @param list<string>|string $allow */
    private static function isAllowed(string $property, array|string $allow): bool
    {
        if ($allow === '*') {
            return true;
        }
        foreach ((array) $allow as $entry) {
            if ($entry === '*') {
                return true;
            }
            if (str_ends_with($entry, '*')) {
                if (str_starts_with($property, substr($entry, 0, -1))) {
                    return true;
                }
            } elseif ($entry === $property) {
                return true;
            }
        }
        return false;
    }

    private static function isSafeValue(string $value): bool
    {
        if (preg_match('/[{}<>\\\\\x00-\x1f\x7f]/', $value) === 1) {
            return false;
        }
        $quote = '';
        $depth = 0;
        $n = strlen($value);
        for ($i = 0; $i < $n; $i++) {
            $ch = $value[$i];
            if ($quote !== '') {
                if ($ch === $quote) {
                    $quote = '';
                }
                continue;
            }
            if ($ch === '"' || $ch === "'") {
                $quote = $ch;
            } elseif ($ch === '(') {
                $depth++;
            } elseif ($ch === ')') {
                $depth--;
                if ($depth < 0) {
                    return false;
                }
            }
        }
        if ($quote !== '' || $depth !== 0) {
            return false;
        }
        $squashed = str_replace(' ', '', strtolower($value));
        foreach (self::BAD_FRAGMENTS as $fragment) {
            if (str_contains($squashed, $fragment)) {
                return false;
            }
        }
        return true;
    }

    /** @return list<string> */
    private static function urls(string $value): array
    {
        $found = [];
        $lower = strtolower($value);
        $n = strlen($value);
        $at = strpos($lower, 'url(');
        while ($at !== false) {
            $i = $at + 4;
            while ($i < $n && $value[$i] === ' ') {
                $i++;
            }
            $ch = $i < $n ? $value[$i] : '';
            if ($ch === '"' || $ch === "'") {
                $end = strpos($value, $ch, $i + 1);
                if ($end === false) {
                    $end = $n;
                }
                $found[] = substr($value, $i + 1, $end - $i - 1);
            } else {
                $end = strpos($value, ')', $i);
                if ($end === false) {
                    $end = $n;
                }
                $found[] = self::trim(substr($value, $i, $end - $i));
            }
            $at = $end < $n ? strpos($lower, 'url(', $end) : false;
        }
        return $found;
    }

    private static function isSafeUrl(string $url): bool
    {
        $u = strtolower(self::trim($url));
        if (preg_match('/^[a-z][a-z0-9+.\-]*:/', $u) !== 1) {
            return true;
        }
        if (str_starts_with($u, 'http:') || str_starts_with($u, 'https:')) {
            return true;
        }
        foreach (self::DATA_IMAGES as $prefix) {
            $next = substr($u, strlen($prefix), 1);
            if (str_starts_with($u, $prefix) && ($next === ';' || $next === ',')) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param array{property: string, value: string, important: bool} $d
     * @param list<string>|string $allow
     */
    private static function reject(array $d, array|string $allow): string
    {
        $p = $d['property'];
        if (preg_match('/^-?[a-z][a-z0-9\-]*$/D', $p) !== 1 && preg_match('/^--[A-Za-z0-9_\-]+$/D', $p) !== 1) {
            return 'property';
        }
        if (in_array($p, self::BLOCKED, true)) {
            return 'blocked';
        }
        if (!self::isAllowed($p, $allow)) {
            return 'not-allowed';
        }
        if (!self::isSafeValue($d['value'])) {
            return 'value';
        }
        foreach (self::urls($d['value']) as $url) {
            if (!self::isSafeUrl($url)) {
                return 'url';
            }
        }
        return '';
    }
}
