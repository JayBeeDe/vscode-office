const vscode = window['acquireVsCodeApi']?.();
export { vscode as vscodeApi };
const postMessage = (message) => { if (vscode) { vscode.postMessage(message) } }

const events = {}
function receive({ data }) {
    if (!data)
        return;
    if (events[data.type]) {
        events[data.type](data.content);
    }
}
window.addEventListener('message', receive)
const isMac = navigator.userAgent.includes('Mac OS');
window.addEventListener('keydown', e => {
    if (isMac && isCompose(e) && (e.altKey || e.code == 'KeyW')) {
        e.preventDefault()
    }
}, isMac ? true : undefined)

const getVscodeEvent = () => {
    return {
        on(event: string, data) {
            events[event] = data
            return this;
        },
        emit(event: string, data?: any) {
            postMessage({ type: event, content: data })
        }
    }
}
export const handler = getVscodeEvent();

/**
 * Answer the host's save requests (Ctrl+S, save on close, hot-exit backup). `save` must emit
 * `save` with the content; `backup` asks for the content without any dialog.
 */
export function onSaveRequest(save: (backup: boolean) => unknown) {
    handler.on('saveRequest', async (request?: { backup?: boolean }) => {
        try {
            await save(!!request?.backup);
        } catch (error) {
            console.error(error);
        } finally {
            handler.emit('saveRequestDone');
        }
    });
}

export function isCompose(e) {
    return e.metaKey || e.ctrlKey;
}

window.addEventListener('keydown', e => {
    if (e.code == 'F12') handler.emit('developerTool')
    else if ((isCompose(e) && e.code == 'KeyV')) e.preventDefault()  // VS Code bug: with a Hebrew keyboard, paste happens twice
})