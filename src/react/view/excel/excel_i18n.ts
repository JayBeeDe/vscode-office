import { getConfigs } from '../../util/vscodeConfig.ts';
import { getMessages, Language, MessageVars, resolveLanguage } from '../../../i18n/index.ts';
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

/** Translates a key of the `spreadsheet` section; vars fill its `{name}` placeholders. */
export function t(key: string, vars?: MessageVars): string {
    if (!initialized) initExcelLocale();
    return localeT(key, vars);
}
