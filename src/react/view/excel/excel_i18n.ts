import { getConfigs } from '../../util/vscodeConfig.ts';
import { getMessages, Language, resolveLanguage } from '../../../i18n/index.ts';
import Spreadsheet from './x-spreadsheet/index';
import { t as localeT } from './x-spreadsheet/locale/locale';

let currentLang: Language = 'en';
let initialized = false;

export function initExcelLocale(): Language {
    if (initialized) return currentLang;
    const lang = resolveLanguage(getConfigs()?.language);
    Spreadsheet.locale(lang, getMessages(lang).spreadsheet);
    currentLang = lang;
    initialized = true;
    return lang;
}

export function getExcelLang(): Language {
    if (!initialized) initExcelLocale();
    return currentLang;
}

/** Translate a locale key; `{}` placeholders are filled in order. */
export function t(key: string, ...args: (string | number)[]): string {
    if (!initialized) initExcelLocale();
    let text = localeT(key);
    for (const arg of args) {
        text = text.replace('{}', String(arg));
    }
    return text;
}
