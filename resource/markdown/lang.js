const DEFAULT_VDITOR_LANG = 'en_US'

/** @type {Map<string, string>} */
const VSCODE_TO_VDITOR = new Map([
    ['en', 'en_US'],
    ['zh', 'zh_CN'],
    ['ja', 'ja_JP'],
    ['ru', 'ru_RU'],
])

/**
 * @param {string | undefined} vscodeLanguage vscode.env.language
 * @returns {string}
 */
export function mapVscodeLanguageToVditorLang(vscodeLanguage) {
    if (!vscodeLanguage) {
        return DEFAULT_VDITOR_LANG
    }
    // the region is dropped, as for the extension's own strings: zh-tw uses zh
    const language = vscodeLanguage.toLowerCase().split(/[-_]/)[0]
    return VSCODE_TO_VDITOR.get(language) ?? DEFAULT_VDITOR_LANG
}
