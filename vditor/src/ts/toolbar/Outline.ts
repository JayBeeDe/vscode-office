import {Constants} from "../constants";
import {getEventName} from "../util/compatibility";
import {isEditorThemeMobileLayout, isMobileOutlineDrawerOpen, setMobileOutlineDrawerOpen} from "../ui/mobileOutlineMenu";
import {MenuItem} from "./MenuItem";

export class Outline extends MenuItem {
    constructor(vditor: IVditor, menuItem: IMenuItem) {
        super(vditor, menuItem);
        this.element.children[0].addEventListener(getEventName(), (event) => {
            event.preventDefault();
            const btnElement = vditor.toolbar.elements.outline.firstElementChild;
            if (btnElement.classList.contains(Constants.CLASS_MENU_DISABLED)) {
                return;
            }
            if (isEditorThemeMobileLayout(vditor)) {
                // a narrow editor: the outline is a drawer over the page
                const open = !isMobileOutlineDrawerOpen(vditor);
                setMobileOutlineDrawerOpen(vditor, open);
                vditor.outline.toggle(vditor, open);
                return;
            }
            const show = !this.element.firstElementChild.classList.contains("vditor-menu--current");
            vditor.outline.toggle(vditor, show);
        });
    }
}
