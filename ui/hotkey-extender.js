import { Actions } from "./actions.js";

class HotkeyExtenderClass {
    constructor() {
        this.handler = this.handler.bind(this);
        this.throttle = this.throttle.bind(this);

        window.removeEventListener('engine-input', this.handler);
        window.addEventListener('engine-input', this.handler);
    }

    throttles = {};

    throttle(key, fn) {
        if (key in this.throttles) {
            return;
        }

        this.throttles[key] = true;
        setTimeout(() => {
            fn();
            delete this.throttles[key];
        }, 20);
    }

    handler(inputEvent) {
        const status = inputEvent.detail.status;
        if (status === 1) {
            const name = inputEvent.detail.name;

            if (name in Actions.map) {
                this.throttle(name, Actions.map[name]);
                return false;
            }

            switch (name) {
                case "next-action":
                case "keyboard-enter":
                    window.dispatchEvent(new CustomEvent('hotkey-next-action'));
                    return false;
            }
        }
        return true;
    }
}

export const HotkeyExtender = new HotkeyExtenderClass();