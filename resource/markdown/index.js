import { getToolbar, bindShortcut, disableSlowExports, } from "./util.js";
import { observeWorkspaceAbsoluteImages, createMarkdownValueReader, restoreWorkspaceBaseUrls, } from "./imagePath.js";
import { mapVscodeLanguageToVditorLang } from "./lang.js";

/** URL of a reference-style link: the "[label]: url" definition (labels ignore case). */
function findReferenceDefinition(markdown, label) {
  const escaped = label.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const match = new RegExp(`^ {0,3}\\[${escaped}\\]:\\s*(?:<([^>]*)>|(\\S+))`, 'im').exec(markdown || '');
  return match ? (match[1] ?? match[2]) : '';
}

/**
 * A mermaid diagram not drawn yet (it shows its spinner), in a block's preview (wysiwyg, ir) or the
 * preview pane (sv); the block's source, also .language-mermaid, is never drawn. mermaidRender marks a
 * diagram processed once drawn, or failed; until then it holds its source.
 */
const PENDING_DIAGRAM = ':is(.vditor-wysiwyg__preview, .vditor-ir__preview, .vditor-preview) .language-mermaid:not([data-vditor-mermaid-processed]):not(:empty)';
/** The longest the loading screen waits for the diagrams: a mermaid script that never loads */
const DIAGRAMS_TIMEOUT = 30000;

/**
 * Resolves once every mermaid diagram of the file is drawn: the file's loading screen and its status
 * bar entry last until then (vscode-office.markdown.waitForAllMermaidDiagrams), a save waits for it.
 * Resolves at once when there is none (checked after the editor's deferred renders), at the latest
 * after DIAGRAMS_TIMEOUT.
 */
function whenDiagramsDrawn(root) {
  return new Promise((resolve) => {
    if (!root) {
      resolve();
      return;
    }
    let observer;
    let timer;
    const finish = () => {
      observer?.disconnect();
      clearTimeout(timer);
      resolve();
    };
    setTimeout(() => {
      if (!root.querySelector(PENDING_DIAGRAM)) {
        finish();
        return;
      }
      observer = new MutationObserver(() => {
        if (!root.querySelector(PENDING_DIAGRAM)) {
          finish();
        }
      });
      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-vditor-mermaid-processed'] });
      timer = setTimeout(finish, DIAGRAMS_TIMEOUT);
    }, 0);
  });
}

/**
 * Reports the diagrams left to draw, whenever their number changes (the file opening, a diagram
 * edited, the mermaid theme changed): the extension shows "Loading 3 remaining Mermaid diagrams of
 * Markdown notes.md..." in the status bar and sends the text back, which each diagram's spinner shows
 * under it (data-loading-label). On the diagrams themselves: a property set on the editor would
 * restyle the whole document at each count, freezing a long one.
 */
function trackDiagrams(root) {
  if (!root) {
    return;
  }
  let label = '';
  const showLabel = (pending) => {
    for (const diagram of pending) {
      if (diagram.getAttribute('data-loading-label') !== label) {
        diagram.setAttribute('data-loading-label', label);
      }
    }
  };
  handler.on('mermaidLoadingLabel', (text) => {
    label = text || '';
    showLabel(root.querySelectorAll(PENDING_DIAGRAM));
  });
  let reported = 0;
  const update = () => {
    const pending = root.querySelectorAll(PENDING_DIAGRAM);
    // a diagram drawn again (edited, theme changed) gets the current text until the next one
    showLabel(pending);
    if (pending.length !== reported) {
      reported = pending.length;
      handler.emit('mermaidLoading', pending.length);
    }
  };
  new MutationObserver(update).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-vditor-mermaid-processed'] });
  // the editor's first diagrams are added after it is ready
  setTimeout(update, 0);
}

handler.on("open", (md) => {
  // the loading screen stays until the editor is ready, or its setup fails
  openMarkdown(md).catch((error) => {
    console.error(error);
    window.setDocumentLoading(false);
  });
}).emit("init")

async function openMarkdown(md) {
  /**
   * Shows a search result: the find bar on the match. The match's number among the source's
   * occurrences is its number among the rendered ones, unless markup (a link's URL, a code block's
   * hidden text) holds some: then the last one is shown.
   */
  const revealMatch = ({ text, occurrence }) => {
    if (text) {
      editor.revealFindMatch(text, occurrence);
    }
  };
  const { content, rootPath, workspaceBaseUrl, documentCacheId, pendingFragment, pendingMatch, shouldRestoreFocus, config, fileName, exporting } = md;
  window.__officeMarkdownFileName = fileName || 'Note';
  const {
    language, i18n, isWeb, isDev, markdown,
    editMode, theme, pageTheme, codeMirrorTheme, mermaidTheme, editorSettings, waitForAllMermaidDiagrams
  } = config;
  if (isWeb) {
    document.body.classList.add('is-web')
  }
  let editor;
  const readMarkdown = createMarkdownValueReader(() => editor, workspaceBaseUrl);
  // the Markdown written to the file follows markdownlint's rules (vditor/src/ts/markdown/lintFormat.ts)
  const formatForFile = (text) => editor?.formatMarkdown ? editor.formatMarkdown(text, fileName) : text;
  const getMarkdownValue = () => formatForFile(readMarkdown());
  /** the formatted text, shown in the editor when it differs: on save, not while typing */
  const saveNow = () => {
    const formatted = getMarkdownValue();
    handler.emit('doSave', formatted);
    if (formatted !== readMarkdown()) {
      editor.setValue(Vditor.prepareMarkdown(formatted));
    }
    editor?.markSaved();
  };
  // a save while diagrams are being drawn waits for the last one, then saves the text as it is then
  // (edits made meanwhile included); saves asked meanwhile are that one
  let pendingSave = null;
  const saveFormatted = () => {
    if (!pendingSave) {
      pendingSave = whenDiagramsDrawn(document.getElementById('vditor')).then(() => {
        pendingSave = null;
        saveNow();
      });
    }
    return pendingSave;
  };
  window.__officeMarkdownSave = saveFormatted;
  // `#word` is an Obsidian tag only with vscode-office.markdown.useObsidianTags (MD018)
  const obsidianTags = !!markdown?.useObsidianTags;
  editor = new Vditor('vditor', {
    value: Vditor.prepareMarkdown(content),
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
    editorSettings,
    codeMirrorTheme,
    mermaidTheme,
    lang: mapVscodeLanguageToVditorLang(language),
    i18n,
    tab: '\t',
    toolbar: await getToolbar(rootPath, i18n, () => {
      saveFormatted();
    }, isWeb),
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
    changeEditorFontSize(size) {
      handler.emit('editorFontSize', size)
    },
    input(content) {
      handler.emit("save", formatForFile(restoreWorkspaceBaseUrls(content, workspaceBaseUrl)))
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
      markdown: {
        obsidian: false,
        callout: true,
        obsidianWikiLink: true,
        obsidianTag: obsidianTags,
      },
    },
    after() {
      // the file shows once its diagrams are drawn, or at once, each diagram with its own spinner
      const root = document.getElementById('vditor');
      if (waitForAllMermaidDiagrams) {
        whenDiagramsDrawn(root).then(() => {
          window.setDocumentLoading(false);
          trackDiagrams(root);
        });
      } else {
        window.setDocumentLoading(false);
        trackDiagrams(root);
      }
      observeWorkspaceAbsoluteImages(document.getElementById('vditor'), workspaceBaseUrl);
      disableSlowExports(!!exporting);
      handler.on('exporting', disableSlowExports);
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
        if (update.editorSettings !== undefined) {
          editor.setEditorSettings(update.editorSettings);
        }
      });
      // an update that arrives while the front-matter editor has focus is applied when it loses
      // it: replacing the content would steal the focus, dropping it would lose the update
      let pendingUpdate = null;
      const applyUpdate = (content) => {
        if (getMarkdownValue() === content) {
          return;
        }
        editor.setValue(Vditor.prepareMarkdown(content));
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
      handler.on("gotoBlock", (fragment) => {
        if (fragment) {
          editor.scrollToBlock(fragment);
        }
      })
      // a search result clicked in VS Code's Search view
      handler.on("revealMatch", revealMatch)
      editor.restoreDocumentSession(true, !!shouldRestoreFocus)
      if (pendingFragment) {
        editor.scrollToBlock(pendingFragment);
      }
      if (pendingMatch) {
        revealMatch(pendingMatch);
      }
    }
  })
  bindShortcut(handler, editor, workspaceBaseUrl);
}
