import { P as Panel } from '/core/ui/panel-support.chunk.js';
import ContextManager from '/core/ui/context-manager/context-manager.js';
import { InterfaceMode, InterfaceModeChangedEventName } from '/core/ui/interface-modes/interface-modes.js';

import { Storage } from './storage.js';
import { Logs } from './logs.js';
import { Console } from './console.js';
import { Actions } from './actions.js';
import './hotkey-extender.js';

class DevPanel extends Panel {
    constructor(root) {
        super(root);
    }

    onAttach() {
        Actions.migratePanelLayout();
        Actions.updateFontSize();
        Actions.updatePositionLeft();
        Console.toggle(true);
        Actions.register();
        Logs.restore();
    }

    onDetach() {
        Logs.clear();
    }
}

window.addEventListener(InterfaceModeChangedEventName, (data) => {
    const disabledInterfaceModes = [
        "INTERFACEMODE_ACQUIRE_TILE",
        "INTERFACEMODE_PLACE_BUILDING",
        "INTERFACEMODE_RESOURCE_ALLOCATION",
        "INTERFACEMODE_ADD_TO_ARMY",
        "INTERFACEMODE_CALL_TO_ARMS",
        "INTERFACEMODE_WMD_STRIKE",
        "INTERFACEMODE_CARGO_DROP",
    ];

    if (disabledInterfaceModes.includes(InterfaceMode.getCurrent())) {
        ContextManager.pop('dev-panel');
        return;
    }

    const isOpened = Storage.get('dev-panel-is-opened');
    if (isOpened) {
        ContextManager.push("dev-panel");
    }
});

Controls.define('dev-panel', {
    createInstance: DevPanel,
    description: '',
    classNames: ["dev-panel"],
    content: ['fs://game/base-standard/ui/dev-panel.html'],
    tabIndex: -1,
});


// this code fixes hex cursor issue, even if it's strange
setTimeout(() => {
    let isOpened = Storage.get('dev-panel-is-opened');

    if (isOpened === false) {
        return;
    }

    if (isOpened === null) {
        Storage.set('dev-panel-is-opened', true);
    }

    ContextManager.push("dev-panel");
    ContextManager.pop("dev-panel");
    ContextManager.push("dev-panel");
}, 500);

