export const isSafari = () => {
    return navigator.userAgent.indexOf("Safari") > -1 && navigator.userAgent.indexOf("Chrome") === -1;
};

export const isFirefox = () => {
    return navigator.userAgent.toLowerCase().indexOf("firefox") > -1;
};

export const accessLocalStorage = () => {
    try {
       return typeof localStorage !== "undefined";
    } catch (e) {
        return false;
    }
};

// handle tap delay / double-tap requirement on iPhone
export const getEventName = () => {
    if (navigator.userAgent.indexOf("iPhone") > -1) {
        return "touchstart";
    } else {
        return "click";
    }
};

// distinguish ctrl and meta on mac
export const isCtrl = (event: KeyboardEvent) => {
    if (navigator.platform.toUpperCase().indexOf("MAC") >= 0) {
        // mac
        if (event.metaKey && !event.ctrlKey) {
            return true;
        }
        return false;
    } else {
        if (!event.metaKey && event.ctrlKey) {
            return true;
        }
        return false;
    }
};
export const isMacPlatform = (): boolean => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
    return /macOS|Mac|iPhone|iPod|iPad/i.test(platform);
};

/** For cases like closing a dialog: Mac shows ⌥Enter, Windows/Linux shows Alt+Enter */
export const formatAltEnterHotkeyTip = (): string =>
    isMacPlatform() ? "⌥Enter" : "Alt+Enter";

// Shortcut display for Mac and Windows
export const updateHotkeyTip = (hotkey: string) => {
    if (hotkey === "⌥Enter" || hotkey === "⌥+Enter") {
        return formatAltEnterHotkeyTip();
    }
    if (isMacPlatform()) {
        if (hotkey.indexOf("⇧") > -1 && isFirefox()) {
            // in Firefox on Mac, with shift pressed, key behaves as on Windows
            hotkey = hotkey.replace(";", ":").replace("=", "+").replace("-", "_");
        }
    } else {
        if (hotkey.startsWith("⌘")) {
            hotkey = hotkey.replace("⌘", "⌘+");
        } else if (hotkey.startsWith("⌥") && hotkey.substr(1, 1) !== "⌘") {
            hotkey = hotkey.replace("⌥", "⌥+");
        } else {
            hotkey = hotkey.replace("⇧⌘", "⌘+⇧+").replace("⌥⌘", "⌥+⌘+");
        }
        hotkey = hotkey.replace("⌘", "Ctrl").replace("⇧", "Shift")
            .replace("⌥", "Alt");
        if (hotkey.indexOf("Shift") > -1) {
            hotkey = hotkey.replace(";", ":").replace("=", "+").replace("-", "_");
        }
    }
    return hotkey;
};

export const isChrome = () => {
    return /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
};
