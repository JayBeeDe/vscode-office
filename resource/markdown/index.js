import { getToolbar, bindShortcut, createContextMenu, } from "./util.js";
import { observeWorkspaceAbsoluteImages, createMarkdownValueReader, restoreWorkspaceBaseUrls, } from "./imagePath.js";
import { mapVscodeLanguageToVditorLang } from "./lang.js";

/** URL of a reference-style link: the "[label]: url" definition (labels ignore case). */
function findReferenceDefinition(markdown, label) {
  const escaped = label.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const match = new RegExp(`^ {0,3}\\[${escaped}\\]:\\s*(?:<([^>]*)>|(\\S+))`, 'im').exec(markdown || '');
  return match ? (match[1] ?? match[2]) : '';
}

handler.on("open", async (md) => {
  const { content, rootPath, workspaceBaseUrl, documentCacheId, pendingFragment, shouldRestoreFocus, config, fileName } = md;
  window.__officeMarkdownFileName = fileName || 'Note';
  const {
    language, i18n, isWeb, isDev, markdown,
    editMode, theme, pageTheme, codeMirrorTheme, mermaidTheme
  } = config;
  if (isWeb) {
    document.body.classList.add('is-web')
  }
  let editor;
  const getMarkdownValue = createMarkdownValueReader(() => editor, workspaceBaseUrl);
  editor = new Vditor('vditor', {
    value: content,
    cdn: rootPath,
    height: '100%',
    outline: {
      position: 'left',
    },
    cache: {
      enable: false,
      id: documentCacheId,
      focusHost: 'vscode',
    },
    mode: editMode,
    colorTheme: theme,
    pageTheme,
    codeMirrorTheme,
    mermaidTheme,
    lang: mapVscodeLanguageToVditorLang(language),
    i18n,
    tab: '\t',
    toolbar: await getToolbar(rootPath, i18n, () => {
      handler.emit('doSave', getMarkdownValue());
      editor?.markSaved();
    }),
    onLinkClick(payload, event) {
      const isCompose = event.metaKey || event.ctrlKey;
      if (payload.action !== "dblclick" && !(payload.action === "click" && isCompose)) {
        return;
      }
      if (payload.type === "footnote-ref") {
        editor.scrollToBlock(`footnote:${payload.href}`);
        return;
      }
      if (payload.type === "tag") {
        // a tag is no file: search the workspace for it, as Obsidian does
        handler.emit("searchTag", payload.href);
        return;
      }
      let uri = payload.href;
      if (payload.type === "link-ref") {
        // [text][label]: the target is in the "[label]: url" definition
        uri = findReferenceDefinition(getMarkdownValue(), payload.href);
        if (!uri) return;
      }
      if (uri?.startsWith("#")) {
        editor.scrollToBlock(uri);
        return;
      }
      if (payload.type === "wikilink" || payload.type === "wikilink-embed") {
        const hashIndex = uri.indexOf("#");
        const page = hashIndex < 0 ? uri : uri.slice(0, hashIndex);
        const fragment = hashIndex < 0 ? "" : uri.slice(hashIndex + 1);
        if (!page && fragment) {
          editor.scrollToBlock(fragment);
          return;
        }
        uri = `wiki:${payload.href}`;
      }
      handler.emit("openLink", uri);
    },
    debugger: isDev,
    wysiwygInputPerf: isDev && false,
    changeEditMode(mode) {
      handler.emit('editMode', mode)
    },
    input(content) {
      handler.emit("save", restoreWorkspaceBaseUrls(content, workspaceBaseUrl))
    },
    upload: {
      url: '/image',
      accept: 'image/*',
      handler(files) {
        const file = files[0];
        const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
        let reader = new FileReader();
        reader.readAsBinaryString(file);
        reader.onloadend = () => {
          handler.emit("img", { data: reader.result, ext })
        };
      }
    },
    preview: {
      math: {
        macros: markdown?.math?.macros ?? {},
      },
    },
    after() {
      observeWorkspaceAbsoluteImages(document.getElementById('vditor'), workspaceBaseUrl);
      handler.on('theme', (theme) => {
        editor.setColorTheme(theme);
      });
      handler.on('markdownConfig', (update) => {
        if (update.theme !== undefined) {
          editor.setPageTheme(update.theme);
        }
        if (update.codeMirrorTheme !== undefined) {
          editor.setCodeMirrorTheme(update.codeMirrorTheme);
        }
        if (update.mermaidTheme !== undefined) {
          editor.setMermaidTheme(update.mermaidTheme);
        }
        if (update.editMode !== undefined) {
          editor.switchEditMode(update.editMode);
        }
      });
      // an update that arrives while the front-matter editor has focus is applied when it loses
      // it: replacing the content would steal the focus, dropping it would lose the update
      let pendingUpdate = null;
      const applyUpdate = (content) => {
        if (getMarkdownValue() === content) {
          return;
        }
        editor.setValue(content);
        editor.markSaved();
      };
      handler.on("update", content => {
        const focusedFrontMatter = document.querySelector("[data-type='yaml-front-matter'].vditor-code-block--cm .cm-editor.cm-focused");
        if (focusedFrontMatter) {
          if (pendingUpdate === null) {
            focusedFrontMatter.addEventListener('focusout', () => {
              const latest = pendingUpdate;
              pendingUpdate = null;
              if (latest !== null) applyUpdate(latest);
            }, { once: true });
          }
          pendingUpdate = content;
          return;
        }
        pendingUpdate = null;
        applyUpdate(content);
      })
      handler.on("insertImageMarkdown", (markdown) => {
        editor.insertMarkdown(markdown);
      })
      handler.on("pasteText", (text) => {
        if (document.getSelection()?.toString()) { document.execCommand('delete') }
        editor.insertMarkdown(text);
      })
      handler.on("gotoBlock", (fragment) => {
        if (fragment) {
          editor.scrollToBlock(fragment);
        }
      })
      editor.restoreDocumentSession(true, !!shouldRestoreFocus)
      if (pendingFragment) {
        editor.scrollToBlock(pendingFragment);
      }
    }
  })
  bindShortcut(handler, editor, workspaceBaseUrl);
  createContextMenu(editor)
}).emit("init")
