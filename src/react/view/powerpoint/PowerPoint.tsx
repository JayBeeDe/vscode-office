import { MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Alert, Layout, Spin } from "antd";
import { PPTXViewer } from "pptxviewjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { handler, loadDarkMode, applyDarkMode } from "../../util/vscode";
import { loadOfficeBuffer } from "../../util/loadOfficeContent";
import { loadMasterImages } from "./masterImages";
import './PowerPoint.css';

const { Sider, Content } = Layout;

const THUMB_WIDTH = 192;
const THUMB_HEIGHT = 108;
const SIDER_WIDTH = 220;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const WHEEL_NAV_INTERVAL_MS = 300;
const WHEEL_ZOOM_BASE = 1.004;
const PINCH_ZOOM_GAIN = 2.5;

async function waitForCanvasContainer(wrap: HTMLElement): Promise<{ width: number; height: number }> {
    for (let i = 0; i < 60; i++) {
        const width = wrap.clientWidth;
        const height = wrap.clientHeight;
        if (width > 0 && height > 0) {
            return { width, height };
        }
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    return { width: wrap.clientWidth, height: wrap.clientHeight };
}

function applyCanvasSize(canvas: HTMLCanvasElement, width: number, height: number) {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
}

function clampPan(
    x: number,
    y: number,
    zoomLevel: number,
    wrap: HTMLElement,
    canvas: HTMLCanvasElement,
) {
    if (zoomLevel <= 1) {
        return { x: 0, y: 0 };
    }
    const wrapW = wrap.clientWidth;
    const wrapH = wrap.clientHeight;
    const baseW = parseFloat(canvas.style.width) || canvas.clientWidth;
    const baseH = parseFloat(canvas.style.height) || canvas.clientHeight;
    const maxX = Math.max(0, (baseW * zoomLevel - wrapW) / 2);
    const maxY = Math.max(0, (baseH * zoomLevel - wrapH) / 2);
    return {
        x: Math.min(maxX, Math.max(-maxX, x)),
        y: Math.min(maxY, Math.max(-maxY, y)),
    };
}

function getStageTransform(zoom: number, pan: { x: number; y: number }) {
    if (zoom === 1 && pan.x === 0 && pan.y === 0) {
        return undefined;
    }
    return `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
}

type RenderQueue = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * destroy() alone keeps the slide images: revoke their blob URLs, and drop the globals the
 * library sets for charts, which would keep the old deck in memory.
 */
const MAX_CANVAS_PIXELS = 8192;

/** Render resolution of the slide canvas (device pixels per CSS pixel). */
function setRenderPixelRatio(viewer: PPTXViewer, ratio: number) {
    const wrapper = (viewer as unknown as { processor?: Record<string, any> }).processor;
    for (const target of [wrapper, wrapper?.processor]) {
        if (typeof target?.setPixelRatio === 'function') {
            target.setPixelRatio(ratio);
        } else if (target?.renderContext) {
            target.renderContext.pixelRatio = ratio;
        }
    }
}

function disposeViewer(viewer: PPTXViewer) {
    const processor = (viewer as unknown as { processor?: unknown }).processor;
    try {
        (viewer as unknown as { clearCaches?: () => void }).clearCaches?.();
    } catch {
        // already torn down
    }
    viewer.destroy();
    const globals = window as unknown as { currentProcessor?: { processor?: unknown }; currentZipData?: unknown };
    if (processor && globals.currentProcessor?.processor === processor) {
        delete globals.currentProcessor;
        delete globals.currentZipData;
    }
}

/**
 * The slide is fitted into the 16:9 canvas: crop to the drawn area, so a 4:3 deck has no bands
 * (transparent bands turn black in a JPEG), and paint it on white.
 */
function thumbnailDataUrl(canvas: HTMLCanvasElement): string {
    const context = canvas.getContext('2d');
    const { width, height } = canvas;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    if (context) {
        const { data } = context.getImageData(0, 0, width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (data[(y * width + x) * 4 + 3] === 0) continue;
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
    }
    if (right < left || bottom < top) {
        left = 0;
        top = 0;
        right = width - 1;
        bottom = height - 1;
    }
    const cropped = document.createElement('canvas');
    cropped.width = right - left + 1;
    cropped.height = bottom - top + 1;
    const target = cropped.getContext('2d');
    if (!target) return canvas.toDataURL('image/jpeg', 0.85);
    target.fillStyle = '#ffffff';
    target.fillRect(0, 0, cropped.width, cropped.height);
    target.drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    return cropped.toDataURL('image/jpeg', 0.85);
}

/** Each thumbnail is its own queued render, so slide changes are drawn in between. */
async function generateThumbnails(viewer: PPTXViewer, count: number, queueRender: RenderQueue, isCurrent: () => boolean): Promise<string[]> {
    const offscreen = document.createElement('canvas');
    offscreen.width = THUMB_WIDTH;
    offscreen.height = THUMB_HEIGHT;
    const urls: string[] = [];
    for (let i = 0; i < count && isCurrent(); i++) {
        urls.push(await queueRender(async () => {
            const context = offscreen.getContext('2d');
            context?.clearRect(0, 0, offscreen.width, offscreen.height);
            await viewer.renderSlide(i, offscreen);
            return thumbnailDataUrl(offscreen);
        }));
    }
    return urls;
}

export default function PowerPoint() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const canvasWrapRef = useRef<HTMLDivElement>(null);
    const mainPanelRef = useRef<HTMLDivElement>(null);
    const thumbListRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<PPTXViewer | null>(null);
    // pptxviewjs draws every canvas with one shared drawing state: renders must never overlap
    const renderQueueRef = useRef<Promise<unknown>>(Promise.resolve());
    // the slide shown, ours: the viewer's own index moves while thumbnails are drawn
    const currentIndexRef = useRef(0);
    // `open` can arrive again while a deck loads: only the latest load may touch the view
    const loadGenerationRef = useRef(0);
    const thumbRefs = useRef<(HTMLDivElement | null)[]>([]);
    const wheelNavLockRef = useRef(0);
    const pinchStartRef = useRef<{ distance: number; zoom: number } | null>(null);
    const zoomRef = useRef(1);
    const panRef = useRef({ x: 0, y: 0 });
    const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
    const touchPanRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [thumbsLoading, setThumbsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [slideCount, setSlideCount] = useState(0);
    const [thumbnails, setThumbnails] = useState<string[]>([]);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const [dark, setDark] = useState(loadDarkMode);

    useEffect(() => {
        document.body.classList.toggle('office-dark', dark);
    }, [dark]);

    const toggleDark = () => {
        setDark(prev => {
            const next = !prev;
            applyDarkMode(next);
            return next;
        });
    };

    useEffect(() => {
        zoomRef.current = zoom;
    }, [zoom]);


    useEffect(() => {
        panRef.current = pan;
    }, [pan]);

    const resetView = useCallback(() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    }, []);

    const applyPan = useCallback((x: number, y: number, zoomLevel = zoomRef.current) => {
        const wrap = canvasWrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) {
            return;
        }
        setPan(clampPan(x, y, zoomLevel, wrap, canvas));
    }, []);

    const setZoomLevel = useCallback((value: number | ((prev: number) => number)) => {
        setZoom(prev => {
            const next = typeof value === 'function' ? value(prev) : value;
            const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
            if (clamped <= 1) {
                setPan({ x: 0, y: 0 });
            } else {
                const wrap = canvasWrapRef.current;
                const canvas = canvasRef.current;
                if (wrap && canvas) {
                    setPan(current => clampPan(current.x, current.y, clamped, wrap, canvas));
                }
            }
            return clamped;
        });
    }, []);

    const syncCanvasSize = useCallback(() => {
        const canvas = canvasRef.current;
        const wrap = canvasWrapRef.current;
        if (!canvas || !wrap) {
            return false;
        }
        const width = wrap.clientWidth;
        const height = wrap.clientHeight;
        if (width <= 0 || height <= 0) {
            return false;
        }
        applyCanvasSize(canvas, width, height);
        return true;
    }, []);

    const queueRender = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
        const run = renderQueueRef.current.then(task, task);
        renderQueueRef.current = run.catch(() => undefined);
        return run;
    }, []);

    const rerenderSlide = useCallback(() => queueRender(async () => {
        const viewer = viewerRef.current;
        const canvas = canvasRef.current;
        if (!viewer || !canvas || !syncCanvasSize()) {
            return;
        }
        await viewer.goToSlide(currentIndexRef.current, canvas);
    }), [queueRender, syncCanvasSize]);

    // zoom is a CSS scale: draw the slide again at the zoomed resolution so it stays sharp
    useEffect(() => {
        const timer = setTimeout(() => {
            const viewer = viewerRef.current;
            const canvas = canvasRef.current;
            if (!viewer || !canvas) return;
            const cssWidth = parseFloat(canvas.style.width) || canvas.clientWidth || 1;
            const wanted = (window.devicePixelRatio || 1) * Math.max(1, zoom);
            setRenderPixelRatio(viewer, Math.min(wanted, MAX_CANVAS_PIXELS / cssWidth));
            void rerenderSlide();
        }, 150);
        return () => clearTimeout(timer);
    }, [zoom, rerenderSlide]);

    const selectSlide = useCallback(async (index: number) => {
        const viewer = viewerRef.current;
        if (!viewer || index < 0 || index >= viewer.getSlideCount()) {
            return;
        }
        // set at once, so that quick arrow presses move from the last requested slide
        currentIndexRef.current = index;
        setCurrentIndex(index);
        resetView();
        await rerenderSlide();
    }, [rerenderSlide, resetView]);

    const loadPresentation = useCallback(async (payload: { path?: string; buffer?: number[]; error?: string }) => {
        const generation = ++loadGenerationRef.current;
        const isCurrent = () => generation === loadGenerationRef.current;
        setLoading(true);
        setThumbsLoading(false);
        setError(null);
        setThumbnails([]);
        setCurrentIndex(0);
        setSlideCount(0);
        resetView();
        // destroyed once its queued renders are done, never in the middle of one
        const previous = viewerRef.current;
        viewerRef.current = null;
        if (previous) void queueRender(async () => disposeViewer(previous));

        let viewer: PPTXViewer | null = null;
        try {
            const buffer = await loadOfficeBuffer(payload);
            const canvas = canvasRef.current;
            const wrap = canvasWrapRef.current;
            if (!canvas || !wrap || !isCurrent()) {
                return;
            }

            setLoading(false);
            await waitForCanvasContainer(wrap);
            if (!isCurrent()) return;
            applyCanvasSize(canvas, wrap.clientWidth, wrap.clientHeight);

            const created = new PPTXViewer({
                canvas,
                slideSizeMode: 'fit',
                backgroundColor: '#ffffff',
            });
            viewer = created;
            await queueRender(async () => {
                if (!isCurrent()) return;
                await created.loadFile(buffer);
                await loadMasterImages(created);
                await created.render(canvas);
            });
            if (!isCurrent()) {
                void queueRender(async () => disposeViewer(created));
                return;
            }

            const count = viewer.getSlideCount();
            currentIndexRef.current = viewer.getCurrentSlideIndex();
            viewerRef.current = viewer;
            setSlideCount(count);
            setCurrentIndex(currentIndexRef.current);

            setThumbsLoading(true);
            const urls = await generateThumbnails(viewer, count, queueRender, isCurrent);
            if (!isCurrent()) return;
            setThumbnails(urls);
            // the slide the user is on now, not the one shown when loading started
            await rerenderSlide();
        } catch (e) {
            // a load replaced by a newer one doesn't report errors over the new deck
            if (!isCurrent()) return;
            setError(e instanceof Error ? e.message : 'Failed to load presentation');
            setLoading(false);
        } finally {
            if (isCurrent()) setThumbsLoading(false);
        }
    }, [resetView, queueRender, rerenderSlide]);

    useEffect(() => {
        handler.on('open', (payload) => {
            loadPresentation(payload);
        }).emit('init');

        return () => {
            if (viewerRef.current) disposeViewer(viewerRef.current);
        };
    }, [loadPresentation]);

    useEffect(() => {
        thumbRefs.current[currentIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [currentIndex, thumbnails]);

    useEffect(() => {
        const onKeyDown = async (e: KeyboardEvent) => {
            const viewer = viewerRef.current;
            if (!viewer || loading) {
                return;
            }
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
                e.preventDefault();
                const next = Math.min(currentIndexRef.current + 1, viewer.getSlideCount() - 1);
                await selectSlide(next);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
                e.preventDefault();
                const prev = Math.max(currentIndexRef.current - 1, 0);
                await selectSlide(prev);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [loading, selectSlide]);

    useEffect(() => {
        if (loading || slideCount === 0) {
            return;
        }
        requestAnimationFrame(() => {
            rerenderSlide();
        });
    }, [loading, slideCount, rerenderSlide]);

    useEffect(() => {
        const el = canvasWrapRef.current;
        if (!el) {
            return;
        }
        let timeout: ReturnType<typeof setTimeout>;
        const observer = new ResizeObserver(() => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                rerenderSlide();
            }, 100);
        });
        observer.observe(el);
        return () => {
            clearTimeout(timeout);
            observer.disconnect();
        };
    }, [rerenderSlide]);

    useEffect(() => {
        const el = mainPanelRef.current;
        if (!el) {
            return;
        }

        const getTouchDistance = (touches: TouchList) => {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.hypot(dx, dy);
        };

        const isRightPanelEvent = (target: EventTarget | null) => {
            if (!(target instanceof Node)) {
                return false;
            }
            const thumbList = thumbListRef.current;
            if (thumbList?.contains(target)) {
                return false;
            }
            return el.contains(target);
        };

        const onWheel = (e: WheelEvent) => {
            if (!isRightPanelEvent(e.target) || loading) {
                return;
            }
            const viewer = viewerRef.current;
            if (!viewer) {
                return;
            }

            // Trackpad pinch / ctrl+wheel → zoom
            if (e.ctrlKey) {
                e.preventDefault();
                const factor = Math.pow(WHEEL_ZOOM_BASE, -e.deltaY);
                setZoomLevel(value => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value * factor)));
                return;
            }

            // When zoomed in, scroll wheel pans vertically
            if (zoomRef.current > 1) {
                e.preventDefault();
                applyPan(panRef.current.x, panRef.current.y - e.deltaY);
                return;
            }

            // Mouse wheel / two-finger scroll → change slide
            e.preventDefault();
            const now = Date.now();
            if (now - wheelNavLockRef.current < WHEEL_NAV_INTERVAL_MS) {
                return;
            }
            wheelNavLockRef.current = now;

            const current = currentIndexRef.current;
            if (e.deltaY > 0) {
                void selectSlide(Math.min(current + 1, viewer.getSlideCount() - 1));
            } else if (e.deltaY < 0) {
                void selectSlide(Math.max(current - 1, 0));
            }
        };

        const onTouchStart = (e: TouchEvent) => {
            if (!isRightPanelEvent(e.target) || e.touches.length !== 2) {
                return;
            }
            pinchStartRef.current = {
                distance: getTouchDistance(e.touches),
                zoom: zoomRef.current,
            };
        };

        const onTouchMove = (e: TouchEvent) => {
            const pinchStart = pinchStartRef.current;
            if (!pinchStart || e.touches.length !== 2) {
                return;
            }
            if (!isRightPanelEvent(e.target)) {
                return;
            }
            e.preventDefault();
            const distance = getTouchDistance(e.touches);
            if (pinchStart.distance <= 0) {
                return;
            }
            const ratio = distance / pinchStart.distance;
            const nextZoom = pinchStart.zoom * (1 + (ratio - 1) * PINCH_ZOOM_GAIN);
            setZoomLevel(nextZoom);
        };

        const onTouchEnd = (e: TouchEvent) => {
            if (e.touches.length < 2) {
                pinchStartRef.current = null;
            }
            if (e.touches.length === 0) {
                touchPanRef.current = null;
            }
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', onTouchEnd);
        el.addEventListener('touchcancel', onTouchEnd);
        return () => {
            el.removeEventListener('wheel', onWheel);
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            el.removeEventListener('touchcancel', onTouchEnd);
        };
    }, [loading, selectSlide, applyPan, setZoomLevel]);

    useEffect(() => {
        const el = canvasWrapRef.current;
        if (!el) {
            return;
        }

        const onMouseDown = (e: MouseEvent) => {
            if (zoomRef.current <= 1 || e.button !== 0) {
                return;
            }
            e.preventDefault();
            dragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                panX: panRef.current.x,
                panY: panRef.current.y,
            };
            setDragging(true);
        };

        const onMouseMove = (e: MouseEvent) => {
            const drag = dragRef.current;
            if (!drag) {
                return;
            }
            e.preventDefault();
            applyPan(
                drag.panX + e.clientX - drag.startX,
                drag.panY + e.clientY - drag.startY,
            );
        };

        const endDrag = () => {
            dragRef.current = null;
            setDragging(false);
        };

        const onTouchStart = (e: TouchEvent) => {
            if (zoomRef.current <= 1 || e.touches.length !== 1 || pinchStartRef.current) {
                return;
            }
            touchPanRef.current = {
                startX: e.touches[0].clientX,
                startY: e.touches[0].clientY,
                panX: panRef.current.x,
                panY: panRef.current.y,
            };
        };

        const onTouchMove = (e: TouchEvent) => {
            const touchPan = touchPanRef.current;
            if (!touchPan || e.touches.length !== 1 || pinchStartRef.current) {
                return;
            }
            e.preventDefault();
            applyPan(
                touchPan.panX + e.touches[0].clientX - touchPan.startX,
                touchPan.panY + e.touches[0].clientY - touchPan.startY,
            );
        };

        const onTouchEnd = () => {
            touchPanRef.current = null;
        };

        el.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', endDrag);
        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', onTouchEnd);
        el.addEventListener('touchcancel', onTouchEnd);
        return () => {
            el.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', endDrag);
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            el.removeEventListener('touchcancel', onTouchEnd);
        };
    }, [applyPan]);

    useEffect(() => {
        if (zoom <= 1) {
            return;
        }
        const wrap = canvasWrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) {
            return;
        }
        setPan(current => clampPan(current.x, current.y, zoom, wrap, canvas));
    }, [zoom]);

    return (
        <>
            <Spin spinning={loading} fullscreen />
            {error && <Alert type="error" message={error} showIcon style={{ margin: 16 }} />}
            <Layout className="ppt-viewer office-viewer-themed">
                <Layout className="ppt-body">
                    <Sider width={SIDER_WIDTH} className="ppt-thumbnails">
                        <div className="ppt-thumbnails-inner">
                            <div className="ppt-thumbnails-header">
                                {slideCount > 0 ? `${slideCount} slides` : 'Slides'}
                                {thumbsLoading && ' · loading…'}
                            </div>
                            <div className="ppt-thumbnails-list" ref={thumbListRef}>
                                {slideCount > 0 && thumbnails.length === 0 && thumbsLoading && (
                                    Array.from({ length: Math.min(slideCount, 8) }, (_, i) => (
                                        <div key={i} className="ppt-thumb">
                                            <div className="ppt-thumb-placeholder" />
                                        </div>
                                    ))
                                )}
                                {thumbnails.map((url, index) => (
                                    <div
                                        key={index}
                                        ref={el => { thumbRefs.current[index] = el; }}
                                        className={`ppt-thumb${index === currentIndex ? ' is-active' : ''}`}
                                        onClick={() => selectSlide(index)}
                                    >
                                        <img src={url} alt={`Slide ${index + 1}`} draggable={false} />
                                        <span className="ppt-thumb-num">{index + 1}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </Sider>
                    <Content className="ppt-main" ref={mainPanelRef}>
                        <div
                            className={`ppt-main-canvas${zoom > 1 ? ' is-pannable' : ''}${dragging ? ' is-dragging' : ''}`}
                            ref={canvasWrapRef}
                        >
                            <div
                                className="ppt-canvas-stage"
                                style={{ transform: getStageTransform(zoom, pan) }}
                            >
                                <canvas ref={canvasRef} id="ppt-canvas" />
                            </div>
                        </div>
                        {slideCount > 0 && (
                            <div className="ppt-statusbar">
                                Slide {currentIndex + 1} / {slideCount}
                                {zoom !== 1 && ` · ${Math.round(zoom * 100)}%`}
                            </div>
                        )}
                    </Content>
                </Layout>
                <button
                    type="button"
                    className={`color-mode-toggle${slideCount > 0 ? ' is-above-status' : ''}`}
                    title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                    aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                    onClick={toggleDark}
                >
                    {dark ? <SunOutlined /> : <MoonOutlined />}
                </button>
            </Layout>
        </>
    );
}
