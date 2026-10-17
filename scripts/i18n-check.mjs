#!/usr/bin/env node
// Checks the translations in i18n/<language>.json and the code that uses them.
// Errors make the check fail; warnings are only reported.
//
//   node scripts/i18n-check.mjs [--verbose] [--summary <file>]
//
// --verbose lists every warning instead of counting them, --summary appends the result as
// Markdown to a file (CI passes $GITHUB_STEP_SUMMARY). A line containing `i18n-ignore` is
// skipped by the hard-coded string scan.
import { existsSync, readdirSync, readFileSync, appendFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const I18N_DIR = join(ROOT, 'i18n');
const RUNTIME = 'src/i18n/index.ts';
const SECTIONS = ['host', 'viewer', 'spreadsheet', 'markdown', 'pdf'];
const PLACEHOLDER = /\{(\w+)\}/g;
// values that stay the same in every language: brands, formats, symbols
const SAME_IN_EVERY_LANGUAGE = new Set(['Schema', 'Office Viewer', 'XMind', 'EPUB', 'PDF', 'HTML', 'CSV', 'OK', 'Markdown', 'Mermaid', 'PlantUML', 'KaTeX', 'Emoji', 'Excel', 'Word', 'VS Code', 'Github Copilot', 'Anthropic Claude', 'Google Gemini']);

// Which files use which section, and how they name keys.
const USAGE = {
    host: { files: ['src'], exclude: ['src/react', 'src/i18n'], calls: [/\bi18n\(\s*['"]([^'"]+)['"]/g] },
    viewer: { files: ['src/react'], exclude: ['src/react/view/excel/x-spreadsheet'], calls: [/\$t\(\s*['"]([^'"]+)['"]/g] },
    spreadsheet: {
        files: ['src/react/view/excel'],
        calls: [/(?<![\w$.])tf?\(\s*['"]([^'"]+)['"]/g],
        prefixes: [/(?<![\w$.])tf?\(\s*`([^`$]+)\$\{/g],
        mentions: true,
    },
    markdown: {
        files: ['vditor/src/ts', 'resource/markdown'],
        exclude: ['resource/markdown/dist'],
        calls: [/window\.VditorI18n\.(\w+)/g, /window\.VditorI18n\[\s*['"]([^'"]+)['"]\s*\]/g, /\bi18n\.(\w+)/g],
        mentions: true,
    },
    pdf: {
        files: ['resource/pdf/main.js', 'resource/pdf/viewer.html', 'resource/pdf/viewer.js', 'resource/pdf/pdf.js'],
        calls: [/\bstrings\.(\w+)/g],
        // l10n.get("document_properties_linearized_" + ...)
        prefixes: [/\bl10n\.get\(\s*"(\w+_)"\s*\+/g],
        mentions: true,
        // PDF.js names a string by its id, the path joined with _ without the attributes (@title)
        // and plural forms ([one]): pdf.find.input.@title and pdf.find.match.count.[one] are
        // find_input and find_match_count
        mentionName: key => key.split('.').slice(1).filter(part => !/^[@[]/.test(part)).join('_'),
    },
};

// Plain JS and host code that ESLint's hard-coded string rules do not cover.
const SCAN = [
    { files: ['resource/markdown'], exclude: ['resource/markdown/dist'], ext: /\.js$/ },
    { files: ['resource/pdf/main.js'], ext: /\.js$/ },
    { files: ['src'], exclude: ['src/react', 'src/i18n'], ext: /\.ts$/ },
];
const LITERAL = String.raw`(['"\`])((?:(?!\1).)*[A-Za-z]{2}(?:(?!\1).)*)\1`;
const HARD_CODED = [
    new RegExp(String.raw`\.(?:title|placeholder|textContent|innerText)\s*=\s*` + LITERAL),
    new RegExp(String.raw`setAttribute\(\s*['"](?:title|aria-label|placeholder|alt)['"]\s*,\s*` + LITERAL),
    new RegExp(String.raw`\btip:\s*` + LITERAL),
    new RegExp(String.raw`show(?:Information|Warning|Error)Message\(\s*` + LITERAL),
    new RegExp(String.raw`\b(?:title|placeHolder|prompt|openLabel|saveLabel):\s*` + LITERAL),
];

function listFiles(paths, exclude = [], ext = /\.(ts|tsx|js|mjs|html)$/) {
    const out = [];
    const skip = exclude.map(p => join(ROOT, p));
    const walk = path => {
        if (skip.some(p => path === p || path.startsWith(p + '/')) || !existsSync(path)) return;
        if (statSync(path).isDirectory()) {
            for (const name of readdirSync(path)) if (name !== 'node_modules') walk(join(path, name));
        } else if (ext.test(path) && !path.endsWith('.d.ts')) {
            out.push(path);
        }
    };
    paths.forEach(p => walk(join(ROOT, p)));
    return out;
}

/** key → value, with lists (month names...) kept as values */
function flatten(tree, prefix = '', out = new Map()) {
    for (const [key, value] of Object.entries(tree)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, `${prefix}${key}.`, out);
        else out.set(`${prefix}${key}`, value);
    }
    return out;
}

/** Blanks out the block comments, keeping the line numbers. */
const withoutBlockComments = text => text.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));

// A copy is only suspicious for real sentences: two words of three letters or more, once the
// placeholders and the parentheses (formats, shortcuts) are removed.
const isSentence = text => (text.replace(PLACEHOLDER, '').replace(/\([^)]*\)/g, '').match(/\p{L}{3,}/gu) ?? []).length >= 2;

const strings = value => (Array.isArray(value) ? value : [value]).filter(v => typeof v === 'string');
// PDF.js picks a plural form with a macro: find_match_count={[ plural(total) ]}
const MACRO = /\{\[\s*(\w+)\(\s*(\w+)\s*\)\s*\]\}/g;
const placeholders = value => [...new Set(strings(value).flatMap(s => [
    ...[...s.matchAll(PLACEHOLDER)].map(m => m[1]),
    ...[...s.matchAll(MACRO)].map(m => `[ ${m[1]}(${m[2]}) ]`),
]))].sort().join(', ');
const kind = value => (Array.isArray(value) ? `list of ${value.length}` : typeof value);

export function checkI18n() {
    const errors = [];
    const warnings = [];

    // 1. the files: valid JSON objects, all imported by the runtime
    const runtime = readFileSync(join(ROOT, RUNTIME), 'utf8');
    const imported = [...runtime.matchAll(/from '\.\.\/\.\.\/i18n\/([\w-]+)\.json'/g)].map(m => m[1]);
    const languages = {};
    for (const file of readdirSync(I18N_DIR).filter(f => f.endsWith('.json')).sort()) {
        const language = file.slice(0, -5);
        try {
            const data = JSON.parse(readFileSync(join(I18N_DIR, file), 'utf8'));
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
            languages[language] = data;
        } catch (e) {
            errors.push(`i18n/${file}: invalid JSON (${e.message})`);
            continue;
        }
        if (!imported.includes(language)) errors.push(`i18n/${file}: not imported by ${RUNTIME}`);
        for (const section of Object.keys(languages[language])) {
            if (!SECTIONS.includes(section)) errors.push(`i18n/${file}: unknown section "${section}" (expected ${SECTIONS.join(', ')})`);
        }
    }
    for (const language of imported) {
        if (!existsSync(join(I18N_DIR, `${language}.json`))) errors.push(`${RUNTIME}: imports i18n/${language}.json, which does not exist`);
    }
    if (!languages.en) {
        errors.push('i18n/en.json is missing: English is the reference and the fallback');
        return { errors, warnings, coverage: [] };
    }

    // 2. every language against English: same keys, types and placeholders
    const english = flatten(languages.en);
    const untranslated = {};
    for (const [key, value] of english) {
        if (strings(value).some(s => s === '')) errors.push(`i18n/en.json: ${key} is empty`);
        for (const s of strings(value)) {
            if (/\{\}|\$\d/.test(s)) errors.push(`i18n/en.json: ${key} uses a positional placeholder, name it: {count}`);
        }
    }
    const coverage = [];
    for (const [language, data] of Object.entries(languages)) {
        if (language === 'en') continue;
        const file = `i18n/${language}.json`;
        const translated = flatten(data);
        const row = { language, sections: {} };
        for (const [key, value] of translated) {
            if (!english.has(key)) {
                errors.push(`${file}: ${key} does not exist in English`);
                continue;
            }
            const reference = english.get(key);
            if (kind(value) !== kind(reference)) {
                errors.push(`${file}: ${key} is a ${kind(value)}, English has a ${kind(reference)}`);
                continue;
            }
            if (strings(value).some(s => s === '')) errors.push(`${file}: ${key} is empty: remove it to fall back to English`);
            if (placeholders(value) !== placeholders(reference)) {
                errors.push(`${file}: ${key} has the placeholders {${placeholders(value)}}, English has {${placeholders(reference)}}`);
            }
            if (JSON.stringify(value) === JSON.stringify(reference) && strings(value).some(isSentence)
                && !strings(value).every(s => SAME_IN_EVERY_LANGUAGE.has(s))) {
                (untranslated[language] ??= []).push(key);
            }
        }
        for (const section of SECTIONS) {
            const keys = [...english.keys()].filter(k => k.startsWith(`${section}.`));
            const done = keys.filter(k => translated.has(k) && !untranslated[language]?.includes(k)).length;
            row.sections[section] = { done, total: keys.length };
        }
        coverage.push(row);
    }
    for (const [language, keys] of Object.entries(untranslated)) {
        warnings.push(...keys.map(key => `i18n/${language}.json: ${key} is a copy of the English text: translate it or remove it`));
    }

    // 3. the keys the code uses exist in English, and every English key is used
    for (const [section, usage] of Object.entries(USAGE)) {
        const files = listFiles(usage.files, usage.exclude);
        const used = new Set();
        const prefixes = new Set();
        let sources = '';
        for (const path of files) {
            const text = withoutBlockComments(readFileSync(path, 'utf8'));
            sources += text;
            for (const pattern of usage.calls) {
                for (const match of text.matchAll(pattern)) {
                    const key = `${section}.${match[1]}`;
                    used.add(key);
                    // vditor reads its strings with fallbacks, and i18n.* also matches other objects there
                    if (!english.has(key) && section !== 'markdown') {
                        const line = text.slice(0, match.index).split('\n').length;
                        errors.push(`${relative(ROOT, path)}:${line}: ${key} does not exist in i18n/en.json`);
                    }
                }
            }
            for (const pattern of usage.prefixes ?? []) {
                for (const match of text.matchAll(pattern)) prefixes.add(`${section}.${match[1]}`);
            }
        }
        for (const key of english.keys()) {
            if (!key.startsWith(`${section}.`) || used.has(key)) continue;
            // PDF.js builds ids such as "document_properties_linearized_" + ...: compare them with the id
            const id = usage.mentionName ? `${section}.${usage.mentionName(key)}` : key;
            if ([...prefixes].some(p => id.startsWith(p))) continue;
            // keys built at run time (toolbar names, actions...) are found by their last part
            const name = usage.mentionName ? usage.mentionName(key) : key.split('.').pop();
            if (usage.mentions && new RegExp(String.raw`['"\`.]${name.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&')}\b`).test(sources)) continue;
            warnings.push(`i18n/en.json: ${key} is not used`);
        }
    }

    // 4. the manifest: VS Code only translates %key% values through package.nls.json
    const manifest = readFileSync(join(ROOT, 'package.json'), 'utf8');
    const manifestKeys = [...new Set([...manifest.matchAll(/"%([\w.-]+)%"/g)].map(m => m[1]))];
    if (manifestKeys.length) {
        const nls = existsSync(join(ROOT, 'package.nls.json')) ? JSON.parse(readFileSync(join(ROOT, 'package.nls.json'), 'utf8')) : {};
        for (const key of manifestKeys.filter(k => !(k in nls))) errors.push(`package.json: %${key}% is not defined in package.nls.json`);
    }

    // 5. the generated Vditor language scripts come from existing files
    const vditorConfig = readFileSync(join(ROOT, 'vditor/vite.config.ts'), 'utf8');
    const block = vditorConfig.match(/VDITOR_LANGUAGES[^{]*\{([^}]*)\}/);
    if (!block) errors.push('vditor/vite.config.ts: VDITOR_LANGUAGES not found');
    for (const match of block ? block[1].matchAll(/:\s*"([\w-]+)"/g) : []) {
        if (!languages[match[1]]) errors.push(`vditor/vite.config.ts: generates a Vditor script from i18n/${match[1]}.json, which does not exist`);
    }

    // 6. hard-coded UI strings in plain JS and host code (ESLint covers the React views)
    for (const scan of SCAN) {
        for (const path of listFiles(scan.files, scan.exclude, scan.ext)) {
            readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
                if (line.includes('i18n-ignore') || /^\s*(\/\/|\*)/.test(line)) return;
                const match = HARD_CODED.map(pattern => line.match(pattern)).find(Boolean);
                if (match) warnings.push(`${relative(ROOT, path)}:${index + 1}: hard-coded UI string "${match[2]}"`);
            });
        }
    }

    return { errors, warnings, coverage };
}

export function coverageTable(coverage) {
    const percent = ({ done, total }) => (total ? `${Math.round((done / total) * 100)}%` : '-');
    const lines = [
        `| Language | ${SECTIONS.join(' | ')} | Total |`,
        `| --- | ${SECTIONS.map(() => '---:').join(' | ')} | ---: |`,
    ];
    for (const { language, sections } of coverage) {
        const all = Object.values(sections).reduce((sum, s) => ({ done: sum.done + s.done, total: sum.total + s.total }), { done: 0, total: 0 });
        lines.push(`| ${language} | ${SECTIONS.map(s => percent(sections[s])).join(' | ')} | ${percent(all)} |`);
    }
    return lines.join('\n');
}

function summarize(warnings) {
    const counts = {};
    for (const warning of warnings) {
        const type = warning.includes('copy of the English') ? 'untranslated copies' : warning.includes('is not used') ? 'unused keys' : 'hard-coded strings';
        counts[type] = (counts[type] ?? 0) + 1;
    }
    return Object.entries(counts).map(([type, count]) => `${count} ${type}`).join(', ');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const verbose = process.argv.includes('--verbose');
    const summaryIndex = process.argv.indexOf('--summary');
    const { errors, warnings, coverage } = checkI18n();
    errors.forEach(e => console.error(`✖ ${e}`));
    if (verbose) warnings.forEach(w => console.warn(`⚠ ${w}`));
    console.log(`\n${coverageTable(coverage)}\n`);
    console.log(`${errors.length} error(s), ${warnings.length} warning(s)${warnings.length ? ` (${summarize(warnings)}${verbose ? '' : ', --verbose lists them'})` : ''}`);
    if (summaryIndex > 0 && process.argv[summaryIndex + 1]) {
        const report = [
            '## Translations',
            '',
            coverageTable(coverage),
            '',
            `${errors.length} error(s), ${warnings.length} warning(s)${warnings.length ? ` (${summarize(warnings)})` : ''}`,
            ...(errors.length ? ['', '### Errors', '', ...errors.map(e => `- ${e}`)] : []),
            ...(warnings.length ? ['', '<details><summary>Warnings</summary>', '', ...warnings.map(w => `- ${w}`), '', '</details>'] : []),
            '',
        ];
        appendFileSync(process.argv[summaryIndex + 1], report.join('\n'));
    }
    process.exitCode = errors.length ? 1 : 0;
}
