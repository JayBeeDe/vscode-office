import {
    ApartmentOutlined,
    ArrowDownOutlined,
    ArrowUpOutlined,
    DeleteOutlined,
    FullscreenExitOutlined,
    FullscreenOutlined,
    GroupOutlined,
    InsertRowBelowOutlined,
    LinkOutlined,
    SubnodeOutlined,
    SwapOutlined,
} from '@ant-design/icons';
import type { MindElixirInstance, Topic } from 'mind-elixir';
import { type ComponentType, useEffect, useState } from 'react';
import { $t, type ViewerKey } from '../../i18n/i18nConfig.ts';
import XmindToolButton, { type TipKey } from './XmindToolButton';

/** What the toolbar knows of the map's selection, to grey out the actions that don't apply. */
interface Selection {
    count: number;
    // the root topic is in the selection: no parent, sibling, move, focus or summary for it
    hasRoot: boolean;
    focusMode: boolean;
}

const EMPTY: Selection = { count: 0, hasRoot: false, focusMode: false };

function readSelection(mind: MindElixirInstance): Selection {
    const nodes: Topic[] = mind.currentNodes ?? [];
    return {
        count: nodes.length,
        hasRoot: nodes.some(node => !node.nodeObj.parent),
        focusMode: mind.isFocusMode,
    };
}

interface Action {
    tip: TipKey;
    icon: ComponentType;
    keys?: string[];
    /** why the action doesn't apply to the selection, null when it does */
    unavailable: (selection: Selection) => ViewerKey | null;
    run: (mind: MindElixirInstance) => void;
}

const needOne = (s: Selection): ViewerKey | null => (s.count === 1 ? null : 'xmind.unavailable.selectOne');
/** One topic other than the central one. */
const needOneChild = (s: Selection): ViewerKey | null => (s.count === 1 && !s.hasRoot ? null : 'xmind.unavailable.selectOneChild');
const needChildren = (s: Selection): ViewerKey | null => (s.count > 0 && !s.hasRoot ? null : 'xmind.unavailable.selectChildren');

/** mind-elixir's context menu, in its order, with its shortcuts. */
const ACTIONS: (Action | 'separator')[] = [
    { tip: 'addChild', icon: SubnodeOutlined, keys: ['Tab'], unavailable: needOne, run: mind => void mind.addChild() },
    { tip: 'addSibling', icon: InsertRowBelowOutlined, keys: ['Enter'], unavailable: needOneChild, run: mind => void mind.insertSibling('after') },
    { tip: 'addParent', icon: ApartmentOutlined, keys: ['Mod', 'Enter'], unavailable: needOneChild, run: mind => void mind.insertParent() },
    { tip: 'remove', icon: DeleteOutlined, keys: ['Delete'], unavailable: needChildren, run: mind => void mind.removeNodes(mind.currentNodes ?? []) },
    'separator',
    { tip: 'moveUp', icon: ArrowUpOutlined, keys: ['Page Up'], unavailable: needOneChild, run: mind => void mind.moveUpNode() },
    { tip: 'moveDown', icon: ArrowDownOutlined, keys: ['Page Down'], unavailable: needOneChild, run: mind => void mind.moveDownNode() },
    'separator',
    {
        tip: 'focus', icon: FullscreenOutlined, unavailable: needOneChild,
        run: mind => {
            const node = mind.currentNode;
            if (node) {
                mind.focusNode(node);
            }
        },
    },
    { tip: 'cancelFocus', icon: FullscreenExitOutlined, unavailable: s => (s.focusMode ? null : 'xmind.unavailable.notFocused'), run: mind => mind.cancelFocus() },
    'separator',
    { tip: 'link', icon: LinkOutlined, unavailable: needOne, run: mind => startLink(mind, false) },
    { tip: 'linkBidirectional', icon: SwapOutlined, unavailable: needOne, run: mind => startLink(mind, true) },
    {
        tip: 'summary', icon: GroupOutlined, unavailable: needChildren,
        run: mind => {
            mind.createSummary();
            mind.unselectNodes(mind.currentNodes ?? []);
        },
    },
];

/** Like the context menu's Link: the next click on a topic is the link's target. */
function startLink(mind: MindElixirInstance, bidirectional: boolean) {
    const from = mind.currentNode;
    if (!from) {
        return;
    }
    const tips = document.createElement('div');
    tips.className = 'tips';
    tips.innerText = $t('xmind.clickTarget');
    mind.container.appendChild(tips);
    mind.map.addEventListener('click', (event) => {
        event.preventDefault();
        tips.remove();
        const target = event.target as HTMLElement;
        const tag = target.parentElement?.tagName;
        if (tag === 'ME-PARENT' || tag === 'ME-ROOT') {
            mind.createArrow(from, target as Topic, { bidirectional });
        }
    }, { once: true });
}

interface Props {
    mind: MindElixirInstance | null;
    editable: boolean;
}

/** The context menu's actions as toolbar buttons, enabled for the selected topics. */
export default function XmindNodeActions({ mind, editable }: Props) {
    const [state, setState] = useState<{ mind: MindElixirInstance | null; selection: Selection }>({ mind: null, selection: EMPTY });
    // another map (another file) starts with nothing selected
    const selection = state.mind === mind ? state.selection : EMPTY;

    useEffect(() => {
        if (!mind) {
            return;
        }
        // after mind-elixir's own handlers: the selection and focus mode are up to date
        const update = () => queueMicrotask(() => setState({ mind, selection: readSelection(mind) }));
        update();
        mind.bus.addListener('selectNodes', update);
        mind.bus.addListener('unselectNodes', update);
        mind.bus.addListener('operation', update);
        // focus mode and refresh (another sheet) change the map without an event
        mind.bus.addListener('linkDiv', update);
        return () => {
            mind.bus.removeListener('selectNodes', update);
            mind.bus.removeListener('unselectNodes', update);
            mind.bus.removeListener('operation', update);
            mind.bus.removeListener('linkDiv', update);
        };
    }, [mind]);

    return ACTIONS.map((action, index) => {
        if (action === 'separator') {
            return <span key={`separator-${index}`} className="xmind-toolbar-separator" />;
        }
        const unavailable: ViewerKey | null = !editable
            ? 'xmind.unavailable.readOnly'
            : !mind
                ? 'xmind.unavailable.selectOne'
                : action.unavailable(selection);
        return (
            <XmindToolButton
                key={action.tip}
                tipKey={action.tip}
                icon={action.icon}
                keys={action.keys}
                unavailable={unavailable}
                onClick={() => {
                    if (mind) {
                        action.run(mind);
                        mind.container.focus();
                    }
                }}
            />
        );
    });
}
