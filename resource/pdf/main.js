"use strict";

(function () {
  const SIDEBAR_WIDTH_VAR = '--sidebar-width';
  const SIDEBAR_MIN_WIDTH = 200;
  const SIDEBAR_DEFAULT_WIDTH = 270;
  // the sidebar opens 270px wide with every PDF: the width it is dragged to is not kept (the one
  // earlier versions kept is removed)
  try {
    localStorage.removeItem('vscode-office.pdf.sidebarWidth');
  } catch {
    // ignore storage errors
  }

  // vscode-office.pdf.sidebar: `<none|always|auto>-<outlines|thumbnails>`. The first part says
  // whether the sidebar opens with the document (`auto`: when it has an outline), the second the
  // view it shows whenever it opens, an empty outline if the document has none
  let sidebarSetting = window.officePdfSidebar || 'auto-outlines';
  const SIDEBAR_VIEW_THUMBS = 1;
  const SIDEBAR_VIEW_OUTLINE = 2;

  const sidebarView = () => sidebarSetting.endsWith('-thumbnails') ? SIDEBAR_VIEW_THUMBS : SIDEBAR_VIEW_OUTLINE;

  /** Shows the setting's view, the outline even when it is empty (its button is disabled then). */
  function showSidebarView() {
    const sidebar = PDFViewerApplication.pdfSidebar;
    const disabled = sidebar.outlineButton.disabled;
    sidebar.outlineButton.disabled = false;
    sidebar.switchView(sidebarView());
    sidebar.outlineButton.disabled = disabled;
  }

  function setupSidebar() {
    const sidebar = PDFViewerApplication.pdfSidebar;
    const open = sidebar.open.bind(sidebar);
    sidebar.open = () => {
      if (!sidebar.isOpen) {
        showSidebarView();
      }
      open();
    };
    handler.on('pdfSidebar', (value) => {
      sidebarSetting = value;
    });
    const { eventBus } = PDFViewerApplication;
    eventBus.on('documentloaded', () => {
      if (sidebarSetting.startsWith('always-')) {
        sidebar.open();
      } else if (sidebarSetting.startsWith('none-')) {
        sidebar.close();
      }
    });
    eventBus.on('outlineloaded', ({ outlineCount }) => {
      if (sidebarSetting.startsWith('auto-')) {
        if (outlineCount) {
          sidebar.open();
        } else {
          sidebar.close();
        }
      } else if (sidebar.isOpen) {
        // pdf.js shows the thumbnails when the document has no outline
        showSidebarView();
      }
    });
  }

  // vscode-office.pdf.tool: 'hand' (1) scrolls by dragging the pages, 'selection' (0) selects text
  function cursorTools(name) {
    return name === 'selection' ? 0 : 1
  }
  // vscode-office.pdf.scrolling
  function scrollMode(name) {
    switch (name) {
      case 'vertical':
        return 0
      case 'horizontal':
        return 1
      case 'wrapped':
        return 2
      default:
        return -1
    }
  }
  // vscode-office.pdf.spread
  function spreadMode(name) {
    switch (name) {
      case 'none':
        return 0
      case 'odd':
        return 1
      case 'even':
        return 2
      default:
        return -1
    }
  }
  const BULB_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2a3.5 3.5 0 0 0-1.5 6.7V12h3V8.7A3.5 3.5 0 0 0 8 2z"/><path d="M6.25 12h3.5M6.75 13.5h2.5"/></svg>';

  const MOON_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8.53A6 6 0 1 1 7.48 2 4.67 4.67 0 0 0 14 8.53z"/></svg>';

  const strings = window.officePdfStrings || {};

  // vscode-office.theme: the toolbars, the sidebar and the menus are light or dark.
  // vscode-office.pdf.theme: the pages' colours, inverted when dark (`office-dark`); `auto`
  // follows vscode-office.theme. The dark mode button sets it.
  let uiTheme = window.officePdfTheme || 'auto';
  let pageTheme = window.officePdfPageTheme || 'auto';

  const isVscodeDark = () => {
    const kind = document.body.getAttribute('data-vscode-theme-kind')
      || ['vscode-high-contrast-light', 'vscode-light', 'vscode-high-contrast', 'vscode-dark']
        .find((name) => document.body.classList.contains(name));
    return kind === 'vscode-dark' || kind === 'vscode-high-contrast';
  };
  const isDark = (setting) => setting === 'dark' || (setting === 'auto' && isVscodeDark());
  const isPageDark = () => isDark(pageTheme === 'auto' ? uiTheme : pageTheme);

  function applyThemes() {
    const vscodeDark = isVscodeDark();
    const dark = isDark(uiTheme);
    document.body.classList.toggle('office-adaptive-theme', dark);
    // VS Code's colours are light ones then: ../theme/dark-palette.css replaces them
    document.body.classList.toggle('office-forced-dark', dark && !vscodeDark);

    const pageDark = isPageDark();
    document.body.classList.toggle('office-dark', pageDark);
    const btn = document.getElementById('darkModeToggle');
    if (btn) {
      btn.classList.toggle('toggled', pageDark);
      btn.innerHTML = pageDark ? BULB_ICON : MOON_ICON;
      btn.title = `${pageDark ? strings.switchToLight : strings.switchToDark} (Ctrl/Cmd+L)`; // i18n-ignore: the shortcut
      btn.setAttribute('aria-label', pageDark ? strings.switchToLight : strings.switchToDark);
    }
  }

  function setupTheme() {
    applyThemes();
    handler.on('theme', (value) => {
      uiTheme = value;
      applyThemes();
    });
    handler.on('pdfTheme', (value) => {
      pageTheme = value;
      applyThemes();
    });
    new MutationObserver(applyThemes).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind'] });
  }

  // the dark mode button and Ctrl/Cmd+L save the other theme in vscode-office.pdf.theme
  function setupDarkMode() {
    const toggle = () => {
      pageTheme = isPageDark() ? 'light' : 'dark';
      applyThemes();
      handler.emit('pdfTheme', pageTheme);
    };
    const btn = document.getElementById('darkModeToggle');
    if (btn) btn.addEventListener('click', toggle);
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        toggle();
      }
    })
  }

  function getSidebarWidth() {
    const value = getComputedStyle(document.documentElement).getPropertyValue(SIDEBAR_WIDTH_VAR).trim();
    const width = parseInt(value, 10);
    return Number.isFinite(width) ? width : SIDEBAR_DEFAULT_WIDTH;
  }

  function setSidebarWidth(width, minWidth = SIDEBAR_MIN_WIDTH) {
    const outerContainer = document.getElementById('outerContainer');
    if (!outerContainer) {
      return;
    }
    const maxWidth = Math.max(minWidth, Math.floor(outerContainer.clientWidth / 2));
    const nextWidth = Math.min(Math.max(width, minWidth), maxWidth);
    document.documentElement.style.setProperty(SIDEBAR_WIDTH_VAR, `${nextWidth}px`);
    if (window.PDFViewerApplication?.eventBus) {
      PDFViewerApplication.eventBus.dispatch('resize', { source: window });
    }
    return nextWidth;
  }

  // The sidebar is as wide as the thumbnails when it shows them (it cannot be resized then), and
  // as the outline's width otherwise: 270px, or the width it is dragged to while the PDF is open
  const THUMBNAIL_WIDTH = 114; // PDF.js's 98px thumbnails, their 1px border and 7px ring
  let outlineWidth = SIDEBAR_DEFAULT_WIDTH;

  const isThumbnailsSidebar = () => PDFViewerApplication.pdfSidebar.active === SIDEBAR_VIEW_THUMBS;

  function thumbnailsSidebarWidth() {
    const view = document.getElementById('thumbnailView');
    const thumbnail = view.querySelector('.thumbnail');
    const style = getComputedStyle(view);
    const scrollbar = view.offsetWidth - view.clientWidth;
    return Math.ceil((thumbnail?.getBoundingClientRect().width || THUMBNAIL_WIDTH)
      + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + scrollbar);
  }

  function fitSidebarToView() {
    const thumbnails = isThumbnailsSidebar();
    document.getElementById('outerContainer')?.classList.toggle('office-sidebar-thumbnails', thumbnails);
    if (thumbnails) {
      setSidebarWidth(thumbnailsSidebarWidth(), 0);
    } else if (getSidebarWidth() !== outlineWidth) {
      setSidebarWidth(outlineWidth);
    }
  }

  // The zoom field (5 to 500%) between its -/+ buttons, and the Page Fit and Page Width buttons, in
  // place of PDF.js's zoom dropdown; Ctrl +/- and Ctrl+wheel zoom within the same limits (MIN_SCALE
  // and MAX_SCALE)
  const ZOOM_MIN = 5;
  const ZOOM_MAX = 500;
  const ZOOM_STEP = 10;

  function setupZoom() {
    const input = document.getElementById('zoomValue');
    const fit = document.getElementById('zoomPageFit');
    const width = document.getElementById('zoomPageWidth');
    const stepOut = document.getElementById('zoomStepOut');
    const stepIn = document.getElementById('zoomStepIn');
    if (!input || !fit || !width || !stepOut || !stepIn) {
      return;
    }
    const app = PDFViewerApplication;
    const currentPercent = () => Math.round(app.pdfViewer.currentScale * 100);
    const zoomTo = (percent) => {
      app.pdfViewer.currentScaleValue = String(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, percent)) / 100);
    };

    const show = () => {
      const value = app.pdfViewer.currentScaleValue;
      const percent = currentPercent();
      input.value = String(percent);
      fit.classList.toggle('toggled', value === 'page-fit');
      width.classList.toggle('toggled', value === 'page-width');
      stepOut.disabled = percent <= ZOOM_MIN;
      stepIn.disabled = percent >= ZOOM_MAX;
    };
    const apply = () => {
      const percent = Math.round(Number(input.value));
      if (Number.isFinite(percent) && input.value !== '') {
        zoomTo(percent);
      }
      show();
    };

    // to the next multiple of 10% first (107% goes to 110% or 100%), then by 10%
    stepIn.addEventListener('click', () => {
      zoomTo(Math.floor(currentPercent() / ZOOM_STEP) * ZOOM_STEP + ZOOM_STEP);
    });
    stepOut.addEventListener('click', () => {
      zoomTo(Math.ceil(currentPercent() / ZOOM_STEP) * ZOOM_STEP - ZOOM_STEP);
    });

    input.addEventListener('change', apply);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        apply();
        input.select();
      } else if (event.key === 'Escape') {
        show();
        input.blur();
      }
    });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('blur', show);
    fit.addEventListener('click', () => {
      app.pdfViewer.currentScaleValue = 'page-fit';
    });
    width.addEventListener('click', () => {
      app.pdfViewer.currentScaleValue = 'page-width';
    });
    app.eventBus.on('scalechanging', () => {
      if (document.activeElement !== input) {
        show();
      }
    });
  }

  function initSidebarResize() {
    const resizer = document.getElementById('sidebarResizer');
    const outerContainer = document.getElementById('outerContainer');
    if (!resizer || !outerContainer) {
      return;
    }

    resizer.classList.remove('hidden');
    PDFViewerApplication.eventBus.on('sidebarviewchanged', fitSidebarToView);
    fitSidebarToView();

    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    let isRTL = false;
    let activePointerId = null;

    const onPointerMove = (event) => {
      if (!dragging) {
        return;
      }
      let nextWidth = startWidth + (event.clientX - startX);
      if (isRTL) {
        nextWidth = startWidth - (event.clientX - startX);
      }
      setSidebarWidth(nextWidth);
    };

    const endDrag = () => {
      if (!dragging) {
        return;
      }
      dragging = false;
      outerContainer.classList.remove('sidebarResizing');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('blur', endDrag);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (activePointerId != null) {
        try {
          resizer.releasePointerCapture(activePointerId);
        } catch {
          // ignore
        }
        activePointerId = null;
      }
      outlineWidth = setSidebarWidth(getSidebarWidth());
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        endDrag();
      }
    };

    resizer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || dragging) {
        return;
      }
      event.preventDefault();
      dragging = true;
      isRTL = document.documentElement.dir === 'rtl';
      startX = event.clientX;
      startWidth = getSidebarWidth();
      activePointerId = event.pointerId;
      outerContainer.classList.add('sidebarResizing');
      try {
        resizer.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
      window.addEventListener('blur', endDrag);
      document.addEventListener('visibilitychange', onVisibilityChange);
    });
  }

  /**
   * The toolbar's right part scrolls when the window is too narrow for all its buttons (its
   * scrollbar is hidden, viewer_adjust.css): the mouse wheel scrolls it sideways
   */
  function setupToolbarRightScroll() {
    const right = document.getElementById('toolbarViewerRight');
    if (!right) {
      return;
    }
    right.addEventListener('wheel', (event) => {
      if (right.scrollWidth <= right.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }
      event.preventDefault();
      right.scrollLeft += event.deltaY;
    }, { passive: false });
  }

  function toUint8Array(buffer) {
    if (!buffer) {
      return null;
    }
    if (buffer instanceof Uint8Array) {
      return buffer;
    }
    if (ArrayBuffer.isView(buffer)) {
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    if (Array.isArray(buffer) && buffer.length) {
      const data = new Uint8Array(buffer.length);
      for (let i = 0; i < buffer.length; i++) {
        data[i] = buffer[i];
      }
      return data;
    }
    return null;
  }

  function openPdfDocument(payload) {
    if (!payload) {
      return;
    }
    if (payload.error) {
      console.error(payload.error);
      return;
    }
    const data = toUint8Array(payload.buffer);
    if (data?.length) {
      PDFViewerApplication.open(data);
      return;
    }
    if (payload.path) {
      PDFViewerApplication.open(payload.path);
    }
  }

  window.addEventListener('load', function () {
    setupTheme();
    setupDarkMode();
    setupToolbarRightScroll();
    PDFViewerApplication.initializedPromise.then(() => {
      initSidebarResize();
      setupSidebar();
      // vscode-office.pdf.zoom: the zoom every PDF opens with (rather than the one it was last
      // viewed with), and the one Ctrl/Cmd+0 goes back to
      PDFViewerApplicationOptions.set('defaultZoomValue', window.officePdfZoom || 'page-width');
      // every PDF opens at its beginning: not where it was last viewed, nor at the destination the
      // PDF asks to open at (viewOnLoad 1, INITIAL)
      PDFViewerApplicationOptions.set('viewOnLoad', 1);
      setupZoom();
      const optsOnLoad = () => {
        PDFViewerApplication.pdfCursorTools.switchTool(cursorTools(window.officePdfTool))
        PDFViewerApplication.pdfViewer.scrollMode = scrollMode(window.officePdfScrolling || 'vertical')
        PDFViewerApplication.pdfViewer.spreadMode = spreadMode(window.officePdfSpread || 'none')
        PDFViewerApplication.eventBus.off('documentloaded', optsOnLoad)
      }
      PDFViewerApplication.eventBus.on('documentloaded', optsOnLoad)
    })
    vscodeEvent.on("open", openPdfDocument)
    vscodeEvent.emit("init")
  }, { once: true });
}());
