import { createMarkdownValueReader } from "./imagePath.js";

function loadRes(url) {
    return fetch(url).then(r => r.text())
}

const isMac = navigator.userAgent.includes('Mac OS');
const shortcutTip = isMac ? '⌘ ^ E' : 'Ctrl Alt E';

export async function getToolbar(resPath, i18n, onSave = null, isWeb = false) {
    const codicon = (name) => `<span class="codicon codicon-${name}" aria-hidden="true"></span>`;
    const exportItem = (name, type, icon) => ({
        name,
        tip: i18n[name],
        className: 'right',
        icon: codicon(icon),
        click() {
            // VS Code's accent, which the exports use like the editor
            const accent = getComputedStyle(document.documentElement).getPropertyValue('--vscode-focusBorder').trim()
            handler.emit('export', { type, accent })
        }
    });
    // the exports need the desktop: Chromium, the file system
    const exports = isWeb ? [] : [
        exportItem('exportPdf', 'pdf', 'file-pdf'),
        exportItem('exportDocx', 'docx', 'file-text'),
        exportItem('exportHtml', 'html', 'code'),
    ];
    return [
        'outline',
        "headings",
        "bold",
        "italic",
        "strike",
        "link",
        "|",
        {
            name: 'edit-in-vscode',
            tip: i18n.editInVscode.replace('{shortcut}', shortcutTip),
            className: 'right',
            icon: codicon('vscode'),
            click() {
                handler.emit("editInVSCode", true)
            }
        },
        {
            name: 'save',
            tip: i18n.save,
            className: 'right',
            icon: codicon('save'),
            click() {
                onSave?.()
            }
        },
        ...exports,
        'upload',
        "|",
        // "|",
        "list",
        "ordered-list",
        "check",
        "table",
        "|",
        "quote",
        "code",
        "inline-code",
        "|",
        "undo",
        "redo",
        "|",
        "find"
    ]
}

/** Grays out the PDF and DOCX export buttons while one of those exports runs; clicks are then ignored */
export function disableSlowExports(disabled) {
    for (const button of document.querySelectorAll('.vditor-toolbar [data-type="exportPdf"], .vditor-toolbar [data-type="exportDocx"]')) {
        button.classList.toggle('vditor-menu--disabled', disabled);
    }
}

function matchShortcut(hotkey, event) {

    const matchAlt = hotkey.match(/!/) != null == event.altKey
    const matchMeta = hotkey.match(/⌘/) != null == event.metaKey
    const matchCtrl = hotkey.match(/\^/) != null == event.ctrlKey
    const matchShifter = hotkey.match(/\+/) != null == event.shiftKey

    if (matchAlt && matchCtrl && matchShifter && matchMeta) {
        return hotkey.match(new RegExp(`\\b${event.key}\\b`, "i"))
    }

}


const isInsideCodeMirrorTarget = (target) => {
    const node = target?.nodeType === 1 ? target : target?.parentElement;
    return !!node?.closest?.(".vditor-code-block--cm .cm-editor");
};

export const bindShortcut = (handler, editor, workspaceBaseUrl = '') => {
    const getMarkdownValue = createMarkdownValueReader(() => editor, workspaceBaseUrl);
    let _exec = document.execCommand.bind(document)
    document.execCommand = (cmd, ...args) => {
        if (cmd === 'delete') {
            setTimeout(() => {
                return _exec(cmd, ...args)
            })
        } else {
            return _exec(cmd, ...args)
        }
    }
    window.addEventListener('keydown', async e => {
        if (matchShortcut('^⌘e', e) || matchShortcut('^!e', e)) {
            e.stopPropagation();
            e.preventDefault();
            return handler.emit("editInVSCode", true);
        }

        if (e.code == 'F12') return handler.emit('developerTool')
        if (isCompose(e)) {
            switch (e.code) {
                case 'KeyS':
                    vscodeEvent.emit("doSave", getMarkdownValue());
                    editor.markSaved();
                    e.stopPropagation();
                    e.preventDefault();
                    break;
                case 'KeyV':
                    if (isInsideCodeMirrorTarget(e.target) || isInsideCodeMirrorTarget(document.activeElement)) {
                        return;
                    }
                    if (e.shiftKey) {
                        const text = await navigator.clipboard.readText();
                        if (text) document.execCommand('insertText', false, text.trim());
                        e.stopPropagation();
                    }
                    else if (document.getSelection()?.toString()) {
                        // vscode webview only: fix selected text not being cleared after cut
                        document.execCommand("delete")
                    }
                    e.preventDefault();
                    break;
            }
        }
    }, isMac ? true : undefined)

    window.onresize = () => {
        document.getElementById('vditor').style.height = '100%'
    }
}
