import { Global } from '@/common/global';
import { Handler } from '@/common/handler';
import * as vscode from 'vscode';

/** The EPUB reader's display settings, `vscode-office.epub.*`: their defaults are package.json's. */
const EPUB_SETTINGS = {
    fontFamily: 'epub.font.family',
    fontSize: 'epub.font.size',
    lineHeight: 'epub.line-height',
} as const;

type EpubSettingName = keyof typeof EPUB_SETTINGS;

export interface EpubSettings {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
}

/** A setting's value when it is one of its package.json choices, else its package.json default. */
function readSetting(key: string): unknown {
    const config = vscode.workspace.getConfiguration('vscode-office');
    const value = config.get(key);
    const choices = (getSettingSchema(key)?.enum ?? []) as unknown[];
    return choices.includes(value) ? value : config.inspect(key)?.defaultValue;
}

function getSettingSchema(key: string): { enum?: unknown[] } | undefined {
    const configuration = Global.context?.extension.packageJSON?.contributes?.configuration;
    const sections: { properties?: Record<string, { enum?: unknown[] }> }[] = Array.isArray(configuration) ? configuration : [configuration];
    for (const section of sections) {
        const schema = section?.properties?.[`vscode-office.${key}`];
        if (schema) {
            return schema;
        }
    }
    return undefined;
}

/** The `vscode-office.epub.font.family`, `.font.size` and `.line-height` settings. */
export function getEpubSettings(): EpubSettings {
    return {
        fontFamily: readSetting(EPUB_SETTINGS.fontFamily) as string,
        fontSize: readSetting(EPUB_SETTINGS.fontSize) as number,
        lineHeight: readSetting(EPUB_SETTINGS.lineHeight) as number,
    };
}

/**
 * Keeps the EPUB reader's display settings in sync: sends `epubSettings` whenever one of them
 * changes, and saves the choice the reader's settings tab makes (`epubSetting`) in the user settings.
 */
export function bindEpubSettings(handler: Handler) {
    const subscription = vscode.workspace.onDidChangeConfiguration((change) => {
        if (Object.values(EPUB_SETTINGS).some(key => change.affectsConfiguration(`vscode-office.${key}`))) {
            handler.emit('epubSettings', getEpubSettings());
        }
    });
    handler.panel.onDidDispose(() => subscription.dispose());
    handler.on('epubSetting', async ({ name, value }: { name: EpubSettingName; value: unknown }) => {
        const key = EPUB_SETTINGS[name];
        if (key && (getSettingSchema(key)?.enum ?? []).includes(value)) {
            await Global.updateConfig(key, value);
        }
    });
}
