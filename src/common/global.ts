import * as vscode from 'vscode';
import { ExtensionContext } from 'vscode';
import { createTranslator, MessageKey, MessageVars, resolveLanguage, SectionKey } from '../i18n';

const prefix = 'vscode-office';

export function language() {
    return vscode.env.language;
}

const translate = createTranslator(resolveLanguage(vscode.env.language));

/** Translates a key of the `host` section of i18n/<language>.json. */
export function i18n(key: SectionKey<'host'>, vars?: MessageVars) {
    return translate(`host.${key}` as MessageKey, vars);
}

export class Global {
    public static context: ExtensionContext;

    public static async init(context: ExtensionContext) {
        Global.context = context;
    }

    /**
     * get configuration from vscode setting.
     * @param key config key
     */
    public static getConfig<T>(key: string, defaultValue?: T): T {
        const config = vscode.workspace.getConfiguration(prefix);
        return config.get<T>(key, defaultValue);
    }

    /**
     * update config for vscode, config must def in package.json.
     * @param name  config name
     * @param value config value
     */
    public static async updateConfig(name: string, value: any) {
        const config = vscode.workspace.getConfiguration(prefix);
        const meta = config.inspect(name);
        const newValue = meta?.defaultValue == value ? undefined : value;
        await config.update(name, newValue, true);
    }
}
