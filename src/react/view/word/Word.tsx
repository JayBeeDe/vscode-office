import { MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Alert, Spin } from "antd";
import { DocxEditor, type DocxEditorRef } from "@eigenpal/docx-editor-react";
import "@eigenpal/docx-editor-react/styles.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { handler, onSaveRequest, vscodeApi } from "../../util/vscode";
import { loadOfficeBuffer } from "../../util/loadOfficeContent";
import { $t } from "../../i18n/i18nConfig.ts";
import "./Word.css";

type WordColorMode = "light" | "adaptive";

const WORD_COLOR_MODE_KEY = "office-word-color-mode";

function loadWordColorMode(): WordColorMode {
    const state = vscodeApi?.getState?.() as { wordColorMode?: WordColorMode } | undefined;
    if (state?.wordColorMode === "light" || state?.wordColorMode === "adaptive") {
        return state.wordColorMode;
    }
    try {
        const saved = localStorage.getItem(WORD_COLOR_MODE_KEY);
        if (saved === "light" || saved === "adaptive") {
            return saved;
        }
    } catch { }
    return "light";
}

function saveWordColorMode(mode: WordColorMode) {
    try {
        localStorage.setItem(WORD_COLOR_MODE_KEY, mode);
    } catch { }
    if (vscodeApi?.setState) {
        const prev = (vscodeApi.getState?.() ?? {}) as Record<string, unknown>;
        vscodeApi.setState({ ...prev, wordColorMode: mode });
    }
}

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
    const [colorMode, setColorMode] = useState<WordColorMode>(loadWordColorMode);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [readOnly, setReadOnly] = useState(false);
    const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | undefined>(undefined);
    const [documentKey, setDocumentKey] = useState("");
    const [fileName, setFileName] = useState("");
    const [commentsSidebarOpen, setCommentsSidebarOpen] = useState(false);
    const skipCommentsAutoOpenRef = useRef(true);

    const adaptiveColorMode = colorMode === "adaptive";

    const toggleColorMode = () => {
        setColorMode((prev) => {
            const next: WordColorMode = prev === "adaptive" ? "light" : "adaptive";
            saveWordColorMode(next);
            return next;
        });
    };

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
            setError(e instanceof Error ? e.message : $t("failedLoadDocument"));
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
            <button
                type="button"
                className="dark-mode-toggle"
                title={adaptiveColorMode ? $t("common.switchToLight") : $t("common.switchToDarkHint")}
                aria-label={adaptiveColorMode ? $t("common.switchToLight") : $t("common.switchToDark")}
                onClick={toggleColorMode}
            >
                {adaptiveColorMode ? <SunOutlined /> : <MoonOutlined />}
            </button>
            <Spin spinning={loading} fullscreen />
            {error && <Alert type="error" message={error} showIcon style={{ margin: 16 }} />}
            {readOnly && !loading && !error && documentBuffer && (
                <div className="word-readonly-banner">{$t("common.readOnlyBadge")}</div>
            )}
            {documentBuffer && !loading && !error && (
                <>
                    <DocxEditor
                        key={documentKey}
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
