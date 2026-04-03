import { MustGetElement } from '/core/ui/utilities/utilities-dom.chunk.js';

import { Storage } from './storage.js';
import { Logs } from "./logs.js";

export const Console = new class {
    isVisible() {
        return document.querySelector('.dev-panel-console')?.classList.contains('dev-panel-console--visible') ?? false;
    }

    shouldMirrorToPanel(message, kind = 'log') {
        const normalizedMessage = `${message ?? ''}`;

        if (kind === 'error') {
            return true;
        }

        return /^Dev panel:/i.test(normalizedMessage);
    }

    formatConsoleArg(arg, spacing = 0) {
        if (typeof arg === 'string') {
            return arg;
        }

        if (arg instanceof Error) {
            return arg.stack || `${arg.name}: ${arg.message}`;
        }

        if (typeof arg === 'object' && arg !== null) {
            const seen = new WeakSet();

            try {
                return JSON.stringify(
                    arg,
                    (_key, value) => {
                        if (typeof value === 'function') {
                            return `[Function ${value.name || 'anonymous'}]`;
                        }

                        if (typeof value === 'object' && value !== null) {
                            if (seen.has(value)) {
                                return '[Circular]';
                            }

                            seen.add(value);
                        }

                        return value;
                    },
                    spacing,
                );
            } catch (_error) {
                // Fall through to the generic string coercion below.
            }
        }

        return `${arg}`;
    }

    formatConsoleArgs(args, spacing = 0) {
        const separator = spacing > 0 ? '\n' : ', ';

        return args.map(arg => this.formatConsoleArg(arg, spacing)).join(separator);
    }

    constructor() {
        console.errorBase = console.errorBase || console.error;
        console.error = (...args) => {
            const data = this.formatConsoleArgs(args);
            if (this.shouldMirrorToPanel(data, 'error')) {
                Logs.add(`Error: ${data}`);
            }
            return console.errorBase.apply(console, args);
        }

        console.warnBase = console.warnBase || console.warn;
        console.warn = (...args) => {
            const data = this.formatConsoleArgs(args);
            if (this.shouldMirrorToPanel(data, 'warn')) {
                Logs.add(`Warn: ${data}`);
            }
            return console.warnBase.apply(console, args);
        }

        console.logBase = console.logBase || console.log;
        console.log = (...args) => {
            const data = this.formatConsoleArgs(args);
            if (this.shouldMirrorToPanel(data, 'log')) {
                Logs.add(`Log: ${data}`);
            }
            return console.logBase.apply(console, args);
        }

        console.pre = (...args) => {
            const data = this.formatConsoleArgs(args, 2);
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