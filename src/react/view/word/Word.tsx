import { Alert, Spin } from "antd";
import { DocxEditor, type DocxEditorRef } from "@eigenpal/docx-editor-react";
import "@eigenpal/docx-editor-react/styles.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { handler, onSaveRequest } from "../../util/vscode";
import { useTheme } from "../../util/theme";
import { loadOfficeBuffer } from "../../util/loadOfficeContent";
import { $t, getLanguage, getSection } from "../../i18n/i18nConfig.ts";
import { LANGUAGES } from "../../../i18n/index.ts";
import DocumentMenuButtons from "./DocumentMenuButtons";
import "./Word.css";

// the editor's toolbar, menus and dialogs: the `document` section of i18n/<language>.json.
// _lang picks the plural rules: English ones while the language has no strings of its own,
// or Japanese rules would give "1 replies"
const EDITOR_STRINGS = {
    ...getSection("document"),
    _lang: "document" in LANGUAGES[getLanguage()] ? getLanguage() : "en",
};

// no preset texts in the Watermark dialog: its dropdown only filled the text field
const WATERMARK_PRESETS: readonly string[] = [];

interface WordOpenPayload {
    path?: string;
    buffer?: number[];
    error?: string;
    readOnly?: boolean;
    fileName?: string;
    documentCacheId?: string;
    nonce?: number;
}

export default function Word() {
    const editorRef = useRef<DocxEditorRef>(null);
    const readOnlyRef = useRef(false);
    const theme = useTheme();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [readOnly, setReadOnly] = useState(false);
    const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | undefined>(undefined);
    const [documentKey, setDocumentKey] = useState("");
    const [fileName, setFileName] = useState("");
    const [commentsSidebarOpen, setCommentsSidebarOpen] = useState(false);
    const skipCommentsAutoOpenRef = useRef(true);

    // dark: the toolbars and panels take VS Code's colours (dark-palette.css when VS Code is light)
    const adaptiveColorMode = theme === "dark";

    const emitSave = useCallback((buffer: ArrayBuffer) => {
        const bytes = new Uint8Array(buffer);
        const content: number[] = new Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            content[i] = bytes[i];
        }
        handler.emit("save", content);
    }, []);

    // the editor's save() already hands the buffer to onSave (emitSave): emitting it here as well
    // wrote the file twice
    const handleSave = useCallback(async () => {
        await editorRef.current?.save();
    }, []);

    const loadGenerationRef = useRef(0);

    const loadDocument = useCallback(async (payload: WordOpenPayload) => {
        // `open` can arrive again while a load is running: only the latest one is applied
        const generation = ++loadGenerationRef.current;
        setLoading(true);
        setError(null);
        setDocumentBuffer(undefined);

        try {
            const fileReadOnly = payload.readOnly === true;
            readOnlyRef.current = fileReadOnly;
            setReadOnly(fileReadOnly);
            setFileName(payload.fileName ?? "");
            setDocumentKey(`${payload.documentCacheId ?? ""}-${payload.nonce ?? Date.now()}`);
            skipCommentsAutoOpenRef.current = true;
            setCommentsSidebarOpen(false);
            const buffer = await loadOfficeBuffer(payload);
            if (generation !== loadGenerationRef.current) return;
            setDocumentBuffer(buffer);
        } catch (e) {
            if (generation !== loadGenerationRef.current) return;
            setError(e instanceof Error ? e.message : $t("document.failedLoad"));
        } finally {
            if (generation === loadGenerationRef.current) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        handler
            .on("open", (payload: WordOpenPayload) => {
                void loadDocument(payload);
            })
            .emit("init");
    }, [loadDocument]);

    useEffect(() => {
        // Ctrl+S goes through VS Code, which asks for the content
        onSaveRequest(() => handleSave());
    }, [handleSave]);

    return (
        <div className={`word-viewer${adaptiveColorMode ? " word-viewer--vscode-theme" : ""}`}>
            <Spin spinning={loading} fullscreen />
            {error && <Alert type="error" message={error} showIcon style={{ margin: 16 }} />}
            {readOnly && !loading && !error && documentBuffer && (
                <div className="word-readonly-banner">{$t("common.readOnlyBadge")}</div>
            )}
            {documentBuffer && !loading && !error && (
                <>
                    <DocxEditor
                        key={documentKey}
                        i18n={EDITOR_STRINGS}
                        ref={editorRef}
                        className="word-editor"
                        documentBuffer={documentBuffer}
                        documentName={fileName}
                        documentNameEditable={false}
                        readOnly={readOnly}
                        {...(readOnly ? { mode: "viewing" as const } : {})}
                        commentsSidebarOpen={commentsSidebarOpen}
                        onCommentsSidebarOpenChange={(open) => {
                            if (open && skipCommentsAutoOpenRef.current) {
                                skipCommentsAutoOpenRef.current = false;
                                return;
                            }
                            setCommentsSidebarOpen(open);
                        }}
                        colorMode="light"
                        showFileOpen={false}
                        showHelpMenu={false}
                        watermarkPresets={WATERMARK_PRESETS}
                        toolbarExtra={readOnly ? undefined : <DocumentMenuButtons editorRef={editorRef} onSave={handleSave} />}
                        onChange={() => {
                            if (!readOnlyRef.current) {
                                handler.emit("change");
                            }
                        }}
                        onSave={emitSave}
                    />
                </>
            )}
        </div>
    );
}
