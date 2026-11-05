import { Button, Tooltip } from 'antd';
import type { ComponentType, ReactNode } from 'react';
import { $t, type ViewerKey } from '../../i18n/i18nConfig.ts';

const isMac = navigator.userAgent.includes('Mac OS');
// the tooltip on a long hover, not a glance
const TOOLTIP_DELAY = 0.8;

/** A toolbar control's tooltip in `xmind.tips`: its title and what it does. */
export type TipKey = 'save' | 'addChild' | 'addSibling' | 'addParent' | 'remove' | 'moveUp' | 'moveDown' | 'focus'
    | 'cancelFocus' | 'link' | 'linkBidirectional' | 'summary' | 'layoutLeft' | 'layoutSide' | 'layoutRight' | 'center'
    | 'zoomOut' | 'zoom' | 'zoomIn' | 'autoZoom';

const tipTitle = (tipKey: TipKey) => $t(`xmind.tips.${tipKey}.title`);
const tipText = (tipKey: TipKey) => $t(`xmind.tips.${tipKey}.text`);

/** A key as the keyboard shows it: Ctrl is ⌘ on a Mac. */
function keyName(key: string): string {
    return key === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : key;
}

/** A toolbar button's tooltip: what it does, its shortcut, and why it is greyed out. */
export function ToolTip({ tipKey, keys, unavailable }: { tipKey: TipKey; keys?: string[]; unavailable?: ViewerKey | null }) {
    return (
        <div className="xmind-tip">
            <div className="xmind-tip-title">
                <span>{tipTitle(tipKey)}</span>
                {keys && (
                    <span className="xmind-tip-keys">
                        {keys.map(key => <kbd key={key}>{keyName(key)}</kbd>)}
                    </span>
                )}
            </div>
            <div className="xmind-tip-text">{tipText(tipKey)}</div>
            {unavailable && <div className="xmind-tip-unavailable">{$t(unavailable)}</div>}
        </div>
    );
}

/** Wraps a toolbar control in its tooltip; a span keeps it on a disabled button, which gets no mouse events. */
export function WithTip({ tipKey, keys, unavailable, children }: { tipKey: TipKey; keys?: string[]; unavailable?: ViewerKey | null; children: ReactNode }) {
    return (
        <Tooltip
            title={<ToolTip tipKey={tipKey} keys={keys} unavailable={unavailable} />}
            mouseEnterDelay={TOOLTIP_DELAY}
            placement="bottom"
            rootClassName="xmind-tooltip"
        >
            <span className="xmind-tool-btn-wrap">{children}</span>
        </Tooltip>
    );
}

interface Props {
    /** the tooltip's key in `xmind.tips` */
    tipKey: TipKey;
    icon: ComponentType;
    keys?: string[];
    /** why the button is greyed out, null when it is available */
    unavailable?: ViewerKey | null;
    active?: boolean;
    pressed?: boolean;
    loading?: boolean;
    onClick: () => void;
}

export default function XmindToolButton({ tipKey, icon: Icon, keys, unavailable = null, active, pressed, loading, onClick }: Props) {
    return (
        <WithTip tipKey={tipKey} keys={keys} unavailable={unavailable}>
            <Button
                type="text"
                size="small"
                className={`xmind-tool-btn${active ? ' is-active' : ''}`}
                icon={<Icon />}
                aria-label={tipTitle(tipKey)}
                aria-pressed={pressed}
                loading={loading}
                disabled={unavailable !== null}
                onClick={onClick}
            />
        </WithTip>
    );
}
