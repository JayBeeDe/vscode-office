import { AimOutlined, AlignCenterOutlined, AlignLeftOutlined, AlignRightOutlined, ExpandOutlined, MinusOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { Alert, Button, Layout, Spin, message } from 'antd';
import MindElixir, { type MindElixirData, type MindElixirInstance } from 'mind-elixir';
import { useCallback, useEffect, useRef, useState } from 'react';
import { handler, onSaveRequest } from '../../util/vscode';
import { loadOfficeBuffer } from '../../util/loadOfficeContent';
import { $t } from '../../i18n/i18nConfig.ts';
import { observeVscodeThemeChange } from '../../util/vscodeTheme';
import { useTheme } from '../../util/theme';
import { buildMindElixirTheme } from './mindElixirTheme';
import { parseXmind, XmindDocument, XmindSheet } from './xmindParser';
import './XmindViewer.css';

const { Sider, Content } = Layout;
const SIDER_WIDTH = 220;
// percents, like the PDF viewer's zoom field
const ZOOM_MIN = 20;
const ZOOM_MAX = 400;
const ZOOM_STEP = 10;

type Direction = typeof MindElixir.LEFT | typeof MindElixir.RIGHT | typeof MindElixir.SIDE;

function attachScaleListener(mind: MindElixirInstance, onScale: (value: number) => void) {
    mind.bus.addListener('scale', onScale);
    onScale(mind.scaleVal);
}

function detachScaleListener(mind: MindElixirInstance, onScale: (value: number) => void) {
    mind.bus.removeListener('scale', onScale);
}

function detachOperationListener(mind: MindElixirInstance, onOperation: () => void) {
    mind.bus.removeListener('operation', onOperation);
}

export default function XmindViewer() {
    const mapRef = useRef<HTMLDivElement>(null);
    const mindRef = useRef<MindElixirInstance | null>(null);
    const documentRef = useRef<XmindDocument | null>(null);
    const sheetsRef = useRef<XmindSheet[]>([]);
    const selectedIdRef = useRef<string | null>(null);
    const scaleHandlerRef = useRef<((value: number) => void) | null>(null);
    const operationHandlerRef = useRef<(() => void) | null>(null);
    const [sheets, setSheets] = useState<XmindSheet[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [scalePercent, setScalePercent] = useState(100);
    // the zoom field's text while it is edited, null otherwise
    const [editingZoom, setZoomInput] = useState<string | null>(null);
    const zoomInput = editingZoom ?? String(scalePercent);
    const [direction, setDirection] = useState<Direction>(MindElixir.SIDE);
    // auto zoom, like the PDF viewer's Page Fit: the whole map in the view, again when the view or
    // the layout changes, until another zoom is chosen
    const [autoZoom, setAutoZoom] = useState(true);
    const autoZoomRef = useRef(true);
    const fittingRef = useRef(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // dark: the map takes VS Code's colours (dark-palette.css when VS Code is light)
    const dark = useTheme() === 'dark';

    useEffect(() => {
        sheetsRef.current = sheets;
    }, [sheets]);

    useEffect(() => {
        selectedIdRef.current = selectedId;
    }, [selectedId]);

    const destroyMind = useCallback(() => {
        const mind = mindRef.current;
        const scaleHandler = scaleHandlerRef.current;
        const operationHandler = operationHandlerRef.current;
        if (mind && scaleHandler) {
            detachScaleListener(mind, scaleHandler);
        }
        if (mind && operationHandler) {
            detachOperationListener(mind, operationHandler);
        }
        scaleHandlerRef.current = null;
        operationHandlerRef.current = null;
        mindRef.current?.destroy();
        mindRef.current = null;
    }, []);

    const syncCurrentSheet = useCallback(() => {
        const currentMind = mindRef.current;
        const currentId = selectedIdRef.current;
        let nextSheets = sheetsRef.current;
        if (currentMind && currentId) {
            nextSheets = sheetsRef.current.map(sheet => (
                sheet.id === currentId
                    ? { ...sheet, data: currentMind.getData() }
                    : sheet
            ));
            sheetsRef.current = nextSheets;
            setSheets(nextSheets);
        }
        return nextSheets;
    }, []);

    const markDirty = useCallback(() => {
        setDirty(true);
        handler.emit('change');
    }, []);

    const readOnlyRef = useRef(false);

    const setAutoZoomState = useCallback((value: boolean) => {
        autoZoomRef.current = value;
        setAutoZoom(value);
    }, []);

    const fitMap = useCallback((mind: MindElixirInstance) => {
        fittingRef.current = true;
        try {
            mind.scaleFit();
        } finally {
            fittingRef.current = false;
        }
        setAutoZoomState(true);
    }, [setAutoZoomState]);

    const toggleAutoZoom = useCallback(() => {
        const mind = mindRef.current;
        if (!mind) {
            return;
        }
        if (autoZoomRef.current) {
            setAutoZoomState(false);
        } else {
            fitMap(mind);
        }
    }, [fitMap, setAutoZoomState]);

    const renderSheet = useCallback((data: MindElixirData, resolveImageUrl: (url: string) => string, adaptive: boolean) => {
        const el = mapRef.current;
        if (!el) {
            return;
        }
        const onScale = (value: number) => {
            setScalePercent(Math.round(value * 100));
            // any other zoom (the field, -/+, the wheel, a pinch) leaves auto zoom
            if (!fittingRef.current) {
                setAutoZoomState(false);
            }
        };
        if (mindRef.current) {
            mindRef.current.changeTheme(buildMindElixirTheme(adaptive), false);
            // refresh keeps the previous sheet's layout: each sheet opens in its own, like the first one
            mindRef.current.direction = data.direction ?? MindElixir.SIDE;
            mindRef.current.refresh(data);
            setDirection(mindRef.current.direction as Direction);
            mindRef.current.clearHistory?.();
            fitMap(mindRef.current);
            return;
        }
        const mind = new MindElixir({
            el,
            direction: MindElixir.SIDE,
            // a read-only file (a git revision...) can be viewed, not edited
            editable: !readOnlyRef.current,
            contextMenu: true,
            // the viewer's toolbar replaces mind-elixir's floating ones
            toolBar: false,
            keypress: true,
            scaleMin: ZOOM_MIN / 100,
            scaleMax: ZOOM_MAX / 100,
            imageProxy: resolveImageUrl,
            theme: buildMindElixirTheme(adaptive),
        });
        mind.init(data);
        fitMap(mind);
        scaleHandlerRef.current = onScale;
        operationHandlerRef.current = markDirty;
        attachScaleListener(mind, onScale);
        mind.bus.addListener('operation', markDirty);
        setDirection(mind.direction as Direction);
        mindRef.current = mind;
    }, [markDirty, fitMap, setAutoZoomState]);

    const zoomTo = useCallback((percent: number) => {
        const mind = mindRef.current;
        if (!mind) {
            return;
        }
        mind.scale(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, percent)) / 100);
    }, []);

    // to the next multiple of 10% first (107% goes to 110% or 100%), then by 10%, like the PDF viewer
    const zoomOut = useCallback(() => {
        zoomTo(Math.ceil(scalePercent / ZOOM_STEP) * ZOOM_STEP - ZOOM_STEP);
    }, [scalePercent, zoomTo]);

    const zoomIn = useCallback(() => {
        zoomTo(Math.floor(scalePercent / ZOOM_STEP) * ZOOM_STEP + ZOOM_STEP);
    }, [scalePercent, zoomTo]);

    const applyZoomInput = useCallback(() => {
        const percent = Math.round(Number(zoomInput));
        if (zoomInput.trim() !== '' && Number.isFinite(percent)) {
            zoomTo(percent);
        }
        setZoomInput(null);
    }, [zoomInput, zoomTo]);

    const changeDirection = useCallback((next: Direction) => {
        const mind = mindRef.current;
        if (!mind || mind.direction === next) {
            return;
        }
        if (next === MindElixir.LEFT) mind.initLeft();
        else if (next === MindElixir.RIGHT) mind.initRight();
        else mind.initSide();
        // a way to look at the map: XMind keeps its layout elsewhere (structureClass), the file is unchanged
        setDirection(next);
        if (autoZoomRef.current) {
            fitMap(mind);
        }
    }, [fitMap]);

    // a resized view (the panel, the window, the sheets' sidebar) fits the map again in auto zoom
    useEffect(() => {
        const el = mapRef.current;
        if (!el) {
            return;
        }
        let frame = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const mind = mindRef.current;
                if (mind && autoZoomRef.current) {
                    fitMap(mind);
                }
            });
        });
        observer.observe(el);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [fitMap, selectedId, loading]);

    const loadGenerationRef = useRef(0);

    const loadXmind = useCallback(async (payload: { path?: string; buffer?: number[]; error?: string; fileName?: string; readOnly?: boolean }) => {
        // `open` can arrive again while a file is parsed: only the latest parse is shown, the
        // others are disposed (their blob URLs revoked)
        const generation = ++loadGenerationRef.current;
        const isCurrent = () => generation === loadGenerationRef.current;
        readOnlyRef.current = payload.readOnly === true;
        setLoading(true);
        setSaving(false);
        setDirty(false);
        setError(null);
        setSheets([]);
        setSelectedId(null);
        setScalePercent(100);
        documentRef.current?.dispose();
        documentRef.current = null;
        destroyMind();

        try {
            const buffer = await loadOfficeBuffer(payload);
            const fileName = payload.fileName ?? payload.path?.split('/').pop() ?? 'document.xmind';
            const parsed = await parseXmind(buffer, fileName);
            if (!isCurrent()) {
                parsed.dispose();
                return;
            }
            if (!parsed.sheets.length) {
                throw new Error($t('xmind.noSheets'));
            }
            documentRef.current = parsed;
            sheetsRef.current = parsed.sheets;
            setSheets(parsed.sheets);
            setSelectedId(parsed.sheets[0].id);
        } catch (e) {
            if (!isCurrent()) return;
            setError(e instanceof Error ? e.message : $t('xmind.failedLoad'));
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [destroyMind]);

    const handleSave = useCallback(async (backup = false) => {
        const doc = documentRef.current;
        if (!doc) {
            return;
        }
        if (backup) {
            handler.emit('save', [...await doc.export(syncCurrentSheet())]);
            return;
        }
        if (saving) {
            return;
        }
        try {
            setSaving(true);
            const content = await doc.export(syncCurrentSheet());
            handler.emit('save', [...content]);
        } catch (e) {
            setSaving(false);
            message.error(e instanceof Error ? e.message : $t('xmind.failedSave'));
        }
    }, [saving, syncCurrentSheet]);

    useEffect(() => {
        handler.on('open', (payload) => {
            loadXmind(payload);
        }).on('saveDone', () => {
            setSaving(false);
            setDirty(false);
            message.success({ duration: 1.5, content: $t('common.saved') });
        }).on('saveFailed', (payload?: { message?: string }) => {
            setSaving(false);
            if (payload?.message) {
                message.error(payload.message);
            }
        }).emit('init');

        return () => {
            documentRef.current?.dispose();
            documentRef.current = null;
            destroyMind();
        };
    }, [loadXmind, destroyMind]);

    useEffect(() => {
        // Ctrl+S goes through VS Code, which asks for the content
        onSaveRequest((backup) => handleSave(backup));
    }, [handleSave]);

    const selected = sheets.find(sheet => sheet.id === selectedId) ?? null;

    // the theme follows `dark` through changeTheme below: rendering the sheet again on a theme
    // change would replace the edits with the loaded data
    const darkRef = useRef(dark);
    useEffect(() => {
        darkRef.current = dark;
    }, [dark]);
    // drawn when another sheet is selected or a file is loaded, not when a save stores the current
    // sheet's data: that would clear the undo history and reset the zoom
    useEffect(() => {
        const sheet = sheetsRef.current.find(item => item.id === selectedId);
        if (!sheet || loading || !documentRef.current) {
            return;
        }
        renderSheet(sheet.data, documentRef.current.resolveImageUrl, darkRef.current);
    }, [selectedId, loading, renderSheet]);

    useEffect(() => {
        mindRef.current?.changeTheme(buildMindElixirTheme(dark));
    }, [dark]);

    useEffect(() => {
        // another VS Code theme: a new accent, and new colours for a dark map
        return observeVscodeThemeChange(() => {
            mindRef.current?.changeTheme(buildMindElixirTheme(dark));
        });
    }, [dark]);

    const showSidebar = sheets.length > 1;

    return (
        <Layout className={`xmind-viewer${dark ? ' xmind-dark' : ''}`}>
            <Layout className="xmind-body">
                {showSidebar && (
                    <Sider width={SIDER_WIDTH} className="xmind-sider">
                        <div className="xmind-sider-inner">
                            <div className="xmind-sider-header">{$t('xmind.sheets')}</div>
                            <div className="xmind-sheet-list">
                                {sheets.map(sheet => (
                                    <div
                                        key={sheet.id}
                                        className={`xmind-sheet-item${selectedId === sheet.id ? ' is-active' : ''}`}
                                        title={sheet.title}
                                        onClick={() => {
                                            syncCurrentSheet();
                                            setSelectedId(sheet.id);
                                        }}
                                    >
                                        {sheet.title}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </Sider>
                )}
                <Content className="xmind-main">
                    {!loading && error && (
                        <div className="xmind-empty">
                            <Alert type="error" showIcon message={error} />
                        </div>
                    )}
                    {!loading && !error && selected && (
                        <div className="xmind-map-wrap">
                            <div className="xmind-map-toolbar">
                                <div className="xmind-toolbar-group">
                                    <Button
                                        type="text"
                                        size="small"
                                        className="xmind-tool-btn"
                                        icon={<SaveOutlined />}
                                        aria-label={$t('common.save')}
                                        title={$t('common.save')}
                                        loading={saving}
                                        disabled={!dirty || saving}
                                        onClick={() => void handleSave()}
                                    />
                                    {!showSidebar && (
                                        <span className="xmind-map-title" title={selected.title}>{selected.title}</span>
                                    )}
                                </div>
                                <div className="xmind-toolbar-group">
                                    {([
                                        [MindElixir.LEFT, AlignLeftOutlined, $t('xmind.layoutLeft')],
                                        [MindElixir.SIDE, AlignCenterOutlined, $t('xmind.layoutSide')],
                                        [MindElixir.RIGHT, AlignRightOutlined, $t('xmind.layoutRight')],
                                    ] as const).map(([value, Icon, label]) => (
                                        <Button
                                            key={value}
                                            type="text"
                                            size="small"
                                            className={`xmind-tool-btn${direction === value ? ' is-active' : ''}`}
                                            icon={<Icon />}
                                            aria-label={label}
                                            aria-pressed={direction === value}
                                            title={label}
                                            onClick={() => changeDirection(value)}
                                        />
                                    ))}
                                    <span className="xmind-toolbar-separator" />
                                    <Button
                                        type="text"
                                        size="small"
                                        className="xmind-tool-btn"
                                        icon={<AimOutlined />}
                                        aria-label={$t('xmind.center')}
                                        title={$t('xmind.center')}
                                        onClick={() => mindRef.current?.toCenter()}
                                    />
                                    <span className="xmind-toolbar-separator" />
                                    <div className="xmind-zoom-field">
                                        <Button
                                            type="text"
                                            size="small"
                                            className="xmind-tool-btn"
                                            icon={<MinusOutlined />}
                                            aria-label={$t('common.zoomOut')}
                                            title={$t('common.zoomOut')}
                                            disabled={scalePercent <= ZOOM_MIN}
                                            onClick={zoomOut}
                                        />
                                        <input
                                            type="number"
                                            className="xmind-zoom-input"
                                            min={ZOOM_MIN}
                                            max={ZOOM_MAX}
                                            step={1}
                                            value={zoomInput}
                                            aria-label={$t('xmind.zoom')}
                                            title={$t('xmind.zoom')}
                                            autoComplete="off"
                                            onChange={event => setZoomInput(event.target.value)}
                                            onFocus={event => event.target.select()}
                                            onBlur={applyZoomInput}
                                            onKeyDown={event => {
                                                if (event.key === 'Enter') {
                                                    applyZoomInput();
                                                    event.currentTarget.select();
                                                } else if (event.key === 'Escape') {
                                                    setZoomInput(null);
                                                    event.currentTarget.blur();
                                                }
                                            }}
                                        />
                                        <span className="xmind-zoom-unit" aria-hidden="true">%</span>
                                        <Button
                                            type="text"
                                            size="small"
                                            className="xmind-tool-btn"
                                            icon={<PlusOutlined />}
                                            aria-label={$t('common.zoomIn')}
                                            title={$t('common.zoomIn')}
                                            disabled={scalePercent >= ZOOM_MAX}
                                            onClick={zoomIn}
                                        />
                                    </div>
                                    <Button
                                        type="text"
                                        size="small"
                                        className={`xmind-tool-btn${autoZoom ? ' is-active' : ''}`}
                                        icon={<ExpandOutlined />}
                                        aria-label={$t('xmind.autoZoom')}
                                        aria-pressed={autoZoom}
                                        title={$t('xmind.autoZoom')}
                                        onClick={toggleAutoZoom}
                                    />
                                </div>
                            </div>
                            <div ref={mapRef} className="xmind-map" />
                        </div>
                    )}
                    {!loading && !error && !selected && (
                        <div className="xmind-empty">{$t('xmind.noContent')}</div>
                    )}
                </Content>
            </Layout>
            <Spin spinning={loading} fullscreen tip={$t('xmind.loading')} />
        </Layout>
    );
}
