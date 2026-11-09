import {Constants} from "../constants";
import {processHeading} from "../ir/process";
import {getEventName, updateHotkeyTip} from "../util/compatibility";
import {afterRenderEvent} from "../wysiwyg/afterRenderEvent";
import {removeHeading, setHeading} from "../wysiwyg/setHeading";
import {MenuItem} from "./MenuItem";
import {removeCurrentToolbar} from "./setToolbar";

/** "H1" to "H6" as text, like the document editor's heading buttons. */
const headingIcon = (level: number) =>
    `<span class="vditor-heading-label" aria-hidden="true">H${level}</span>`;

/**
 * One toolbar button per heading level (`h1` to `h6`), in place of the Headings menu: it turns
 * the caret's block into that heading, or back into a paragraph when it already is one.
 * "Heading 1" is disabled after an existing one (MD025), by the toolbar highlighting.
 */
export class HeadingLevel extends MenuItem {
    constructor(vditor: IVditor, menuItem: IMenuItem) {
        const level = parseInt(menuItem.name.substring(1), 10);
        super(vditor, {
            ...menuItem,
            icon: menuItem.icon || headingIcon(level),
            tip: menuItem.tip
                || `${window.VditorI18n[`heading${level}`]} <${updateHotkeyTip(`⌥⌘${level}`)}>`,
        });

        const button = this.element.children[0] as HTMLElement;
        button.addEventListener(getEventName(), (event) => {
            event.preventDefault();
            if (button.classList.contains(Constants.CLASS_MENU_DISABLED)) {
                return;
            }
            button.blur();
            const current = button.classList.contains("vditor-menu--current");
            if (vditor.currentMode === "wysiwyg") {
                if (current) {
                    removeHeading(vditor);
                } else {
                    setHeading(vditor, `h${level}`);
                }
                afterRenderEvent(vditor);
                removeCurrentToolbar(vditor.toolbar.elements, Constants.HEADING_TOOLBARS);
                if (!current) {
                    button.classList.add("vditor-menu--current");
                }
            } else if (vditor.currentMode === "ir") {
                // highlights the toolbar again
                processHeading(vditor, current ? "" : `${"#".repeat(level)} `);
            }
        });
    }
}
