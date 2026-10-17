import { createTranslator, getMessages, Language, MessageKey, MessageVars, resolveLanguage, SectionKey } from '../../i18n/index.ts';

/** A key of the `viewer` section of i18n/<language>.json, e.g. `parquet.save`. */
export type ViewerKey = SectionKey<'viewer'>;

let currentLanguage: Language = 'en';
let translate = createTranslator(currentLanguage);

export function initI18n(language?: string): void {
    currentLanguage = resolveLanguage(language);
    translate = createTranslator(currentLanguage);
}

/** The strings of a section in the VS Code language, English filling in the missing ones. */
export function getSection<S extends keyof ReturnType<typeof getMessages>>(section: S) {
    return getMessages(currentLanguage)[section];
}

export function getLanguage(): Language {
    return currentLanguage;
}

export function $t(key: ViewerKey, vars?: MessageVars): string {
    return translate(`viewer.${key}` as MessageKey, vars);
}
