import { MustGetElement } from '/core/ui/utilities/utilities-dom.chunk.js';

import { Storage } from './storage.js';
import { Logs } from "./logs.js";

export const Console = new class {
    isVisible() {
        return document.querySelector('.dev-panel-console')?.classList.contains('dev-panel-console--visible') ?? false;
    }

    shouldMirrorToPanel(message, kind = 'log') {
        if (kind === 'error') {
            return true;
        }

        return /^Dev panel:/i.test(message);
    }

    constructor() {
        console.errorBase = console.errorBase || console.error;
        console.error = (...args) => {
            const data = args.map(arg => `${arg}`).join(', ');
            if (this.shouldMirrorToPanel(data, 'error')) {
                Logs.add(`Error: ${data}`);
            }
            return console.errorBase.apply(console, args);
        }

        console.logBase = console.logBase || console.log;
        console.log = (...args) => {
            const data = args.map(arg => `${arg}`).join(', ');
            if (this.shouldMirrorToPanel(data, 'log')) {
                Logs.add(`Log: ${data}`);
            }
            return console.logBase.apply(console, args);
        }

        console.pre = (...args) => {
            const data = args.map(arg => JSON.stringify(arg, null, 2)).join("\n");
            if (this.shouldMirrorToPanel(data, 'pretty')) {
                Logs.add(`Pretty: ${data}`);
            }
            return console.logBase.apply(console, args);
        }

        console.scrollToBottom = () => {
            setTimeout(() => {
                try {
                    MustGetElement('.dev-panel-console .fxs-scrollable', document)?._component?.scrollToPercentage(1);
                } catch (e) { }
            }, 50);
        }
    }

    toggle(isInitialization = false) {
        let isOpened = +(Storage.get('dev-panel-console') || false);


        if (isInitialization) {
            if (isOpened) {
                document.querySelector(`.dev-panel-console`)?.classList.add('dev-panel-console--visible');
                Logs.restore();
            }
            return;
        }

        isOpened = !isOpened;
        Storage.set('dev-panel-console', isOpened);
        if (isOpened) {
            document.querySelector(`.dev-panel-console`)?.classList.add('dev-panel-console--visible');
        } else {
            document.querySelector(`.dev-panel-console`)?.classList.remove('dev-panel-console--visible');
        }
    }
}