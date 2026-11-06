const vscode = typeof (acquireVsCodeApi) != "undefined" ? acquireVsCodeApi() : null;
const postMessage = (message) => { if (vscode) { vscode.postMessage(message) } }

let events = {}
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
        on(event, data) {
            events[event] = data
            return this;
        },
        emit(event, data) {
            postMessage({ type: event, content: data })
        }
    }
}

window.vscodeEvent = getVscodeEvent();
window.handler = getVscodeEvent();

/**
 * Shows or hides the loading screen the extension puts in every viewer's page
 * (src/common/loadingStatus.ts), and tells the extension, which shows the load in the status bar.
 */
window.setDocumentLoading = function (loading) {
    document.getElementById('office-loading')?.classList.toggle('office-loading--done', !loading);
    window.vscodeEvent.emit('loadingState', loading);
}

function addCss(css) {
    const style = document.createElement('style');
    style.innerText = css;
    document.documentElement.appendChild(style)
}



window.addThemeCss = function () {
    addCss(`
    *{
        background-color: var(--vscode-editor-background) !important;
        color: var(--vscode-editor-foreground) !important;
    }
    *{
        border-color: var(--vscode-quickInputTitle-background) !important;
    }
    `);
}

function isCompose(e) {
    return e.metaKey || e.ctrlKey;
}

function isInsideCodeMirrorTarget(target) {
    const node = target?.nodeType === 1 ? target : target?.parentElement;
    return !!node?.closest?.(".vditor-code-block--cm .cm-editor");
}

window.addEventListener('keydown', e => {
    if (e.code == 'F12') window.vscodeEvent.emit('developerTool')
    else if ((isCompose(e) && e.code == 'KeyV')
        && !isInsideCodeMirrorTarget(e.target)
        && !isInsideCodeMirrorTarget(document.activeElement)) {
        e.preventDefault()  // VS Code bug: the Hebrew keyboard pastes twice
    }
})