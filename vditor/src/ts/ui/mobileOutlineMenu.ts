
export const EDITOR_THEME_MOBILE_BREAKPOINT = 700;

type MobileOutlineHost = {
    outline: HTMLElement;
    backdrop: HTMLElement;
    drawerOpen: boolean;
    wasMobileLayout: boolean;
};

const mobileOutlineHosts = new WeakMap<IVditor, MobileOutlineHost>();

export const isEditorThemeMobileLayout = (vditor: IVditor): boolean => {
    return vditor.element.hasAttribute("data-editor-theme")
        && window.innerWidth <= EDITOR_THEME_MOBILE_BREAKPOINT;
};

export const isOutlinePanelVisible = (vditor: IVditor): boolean => {
    if (isEditorThemeMobileLayout(vditor)) {
        return vditor.outline.element.classList.contains("vditor-outline--mobile-open");
    }
    return vditor.outline.element.style.display !== "none";
};

const getHost = (vditor: IVditor) => mobileOutlineHosts.get(vditor);

export const isMobileOutlineDrawerOpen = (vditor: IVditor): boolean => {
    return getHost(vditor)?.drawerOpen ?? false;
};

export const setMobileOutlineDrawerOpen = (vditor: IVditor, open: boolean) => {
    const host = getHost(vditor);
    if (host) {
        host.drawerOpen = open;
    }
};

/** The toolbar's outline button opens the drawer too: it shows whether the drawer is open. */
const updateOutlineButton = (vditor: IVditor, open: boolean) => {
    const button = vditor.toolbar.elements.outline?.firstElementChild;
    button?.classList.toggle("vditor-menu--current", open);
    button?.setAttribute("aria-expanded", open ? "true" : "false");
};

const clearMobileOutlineUi = (vditor: IVditor) => {
    const host = getHost(vditor);
    const outline = vditor.outline.element;
    outline.classList.remove("vditor-outline--mobile-open");
    outline.style.removeProperty("--mobile-outline-top");
    vditor.element.classList.remove("vditor--mobile-outline-open");
    host?.backdrop.classList.remove("vditor-outline__backdrop--visible");
    if (host) {
        host.drawerOpen = false;
    }
    vditor.toolbar.elements.outline?.firstElementChild?.removeAttribute("aria-expanded");
};

export const syncMobileOutlinePanel = (vditor: IVditor, show: boolean) => {
    const host = getHost(vditor);
    const outline = vditor.outline.element;
    if (!isEditorThemeMobileLayout(vditor)) {
        clearMobileOutlineUi(vditor);
        return;
    }

    outline.style.display = "";
    if (show) {
        // below the toolbar, which takes several rows in a narrow editor
        const toolbarBottom = vditor.toolbar.element.getBoundingClientRect().bottom;
        outline.style.setProperty("--mobile-outline-top", `${Math.round(toolbarBottom) + 6}px`);
    }
    outline.classList.toggle("vditor-outline--mobile-open", show);
    host?.backdrop.classList.toggle("vditor-outline__backdrop--visible", show);
    updateOutlineButton(vditor, show);
    vditor.element.classList.toggle("vditor--mobile-outline-open", show);
};

export const closeMobileOutline = (vditor: IVditor) => {
    if (!isEditorThemeMobileLayout(vditor)) {
        return;
    }
    setMobileOutlineDrawerOpen(vditor, false);
    vditor.outline.resetMobileDrawer(vditor);
};

const handleMobileOutlineResize = (vditor: IVditor) => {
    const host = getHost(vditor);
    if (!host) {
        return;
    }

    const isMobile = isEditorThemeMobileLayout(vditor);
    if (!isMobile) {
        clearMobileOutlineUi(vditor);
        if (host.wasMobileLayout) {
            vditor.outline.restoreDesktopState(vditor);
        }
        host.wasMobileLayout = false;
        return;
    }

    if (!host.wasMobileLayout) {
        setMobileOutlineDrawerOpen(vditor, false);
        vditor.outline.resetMobileDrawer(vditor);
    } else if (host.drawerOpen) {
        syncMobileOutlinePanel(vditor, true);
    } else {
        vditor.outline.resetMobileDrawer(vditor);
    }
    host.wasMobileLayout = true;
};

export const prepareEditorThemeMobileOutline = (vditor: IVditor) => {
    if (!vditor.element.hasAttribute("data-editor-theme")
        || window.innerWidth > EDITOR_THEME_MOBILE_BREAKPOINT) {
        return;
    }
    vditor.outline.element.classList.remove("vditor-outline--mobile-open");
    vditor.outline.element.style.display = "none";
};

export const initMobileOutlineMenu = (vditor: IVditor) => {
    if (!vditor.element.hasAttribute("data-editor-theme") || getHost(vditor)) {
        return;
    }

    prepareEditorThemeMobileOutline(vditor);

    const backdrop = document.createElement("div");
    backdrop.className = "vditor-outline__backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    vditor.element.appendChild(backdrop);

    const host: MobileOutlineHost = {
        outline: vditor.outline.element,
        backdrop,
        drawerOpen: false,
        wasMobileLayout: isEditorThemeMobileLayout(vditor),
    };
    mobileOutlineHosts.set(vditor, host);

    backdrop.addEventListener("click", () => {
        closeMobileOutline(vditor);
    });

    const onResize = () => {
        handleMobileOutlineResize(vditor);
    };
    window.addEventListener("resize", onResize);
    handleMobileOutlineResize(vditor);
};
