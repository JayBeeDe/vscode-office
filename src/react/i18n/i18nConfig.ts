import { createTranslator, MessageKey, MessageVars, resolveLanguage, SectionKey } from '../../i18n/index.ts';

/** A key of the `viewer` section of i18n/<language>.json, e.g. `parquet.save`. */
export type ViewerKey = SectionKey<'viewer'>;

let translate = createTranslator('en');

export function initI18n(language?: string): void {
    translate = createTranslator(resolveLanguage(language));
}

export function $t(key: ViewerKey, vars?: MessageVars): string {
    return translate(`viewer.${key}` as MessageKey, vars);
}
