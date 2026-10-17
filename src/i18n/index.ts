// Shared translation runtime for the extension host and the webviews.
// Every string lives in i18n/<language>.json at the repository root; English is complete and
// the other languages only hold what is translated, so missing keys fall back to English.
import en from '../../i18n/en.json';
import de from '../../i18n/de.json';
import es from '../../i18n/es.json';
import fr from '../../i18n/fr.json';
import ja from '../../i18n/ja.json';
import ptBr from '../../i18n/pt-br.json';
import ru from '../../i18n/ru.json';
import zhCn from '../../i18n/zh-cn.json';

export type Messages = typeof en;

// lists (the spreadsheet's month and weekday names) are values like strings
type Tree = { [key: string]: string | string[] | Tree };

type Leaves<T, P extends string = ''> = {
    [K in keyof T & string]: T[K] extends string | readonly string[] ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every dotted key of the English file, e.g. `host.markdown.exportStart`. */
export type MessageKey = Leaves<Messages>;

/** The keys of one section relative to it, e.g. `SectionKey<'host'>` gives `markdown.exportStart`. */
export type SectionKey<S extends string, K = MessageKey> = K extends `${S}.${infer R}` ? R : never;

export type MessageVars = Record<string, string | number>;

export const LANGUAGES = {
    en,
    'zh-cn': zhCn,
    ja,
    ru,
    de,
    fr,
    es,
    'pt-br': ptBr,
} as const;

export type Language = keyof typeof LANGUAGES;

const ALIASES: Record<string, Language> = {
    zh: 'zh-cn',
    'zh-sg': 'zh-cn',
    'zh-hans': 'zh-cn',
    pt: 'pt-br',
};

/** Maps a VS Code or browser locale (`fr-CA`, `zh_TW`, …) to one of the supported languages. */
export function resolveLanguage(locale?: string): Language {
    let candidate = (locale || 'en').toLowerCase().replace(/_/g, '-');
    while (candidate) {
        if (candidate in LANGUAGES) return candidate as Language;
        if (candidate in ALIASES) return ALIASES[candidate];
        const index = candidate.lastIndexOf('-');
        if (index <= 0) break;
        candidate = candidate.substring(0, index);
    }
    return 'en';
}

function merge(base: Tree, override: Tree): Tree {
    const result: Tree = { ...base };
    for (const [key, value] of Object.entries(override || {})) {
        const current = result[key];
        const nested = (v: unknown): v is Tree => typeof v === 'object' && v !== null && !Array.isArray(v);
        result[key] = nested(value) && nested(current) ? merge(current, value) : value;
    }
    return result;
}

const cache = new Map<Language, Messages>();

/** The messages of a language, with English filling in what is not translated. */
export function getMessages(language: Language): Messages {
    let messages = cache.get(language);
    if (!messages) {
        messages = (language === 'en' ? en : merge(en, LANGUAGES[language] as Tree)) as Messages;
        cache.set(language, messages);
    }
    return messages;
}

/** Replaces `{name}` placeholders; unknown placeholders are left as they are. */
export function format(message: string, vars?: MessageVars): string {
    if (!vars || typeof vars !== 'object') return message;
    return message.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

export function lookup(messages: Messages, key: string): string | undefined {
    let node: unknown = messages;
    for (const part of key.split('.')) {
        if (!node || typeof node !== 'object') return undefined;
        node = (node as Tree)[part];
    }
    return typeof node === 'string' ? node : undefined;
}

/** Creates a translate function for one language; unknown keys are returned as they are. */
export function createTranslator(language: Language) {
    const messages = getMessages(language);
    return (key: MessageKey, vars?: MessageVars): string => format(lookup(messages, key) ?? key, vars);
}
