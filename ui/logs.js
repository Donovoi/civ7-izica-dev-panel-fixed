export const Logs = new class {
    logs = [];
    maxEntries = 250;

    constructor() {
        this.add = this.add.bind(this);
        this.getEntries = this.getEntries.bind(this);
        this.getText = this.getText.bind(this);
        this.render = this.render.bind(this);
        this.restore = this.restore.bind(this);
        this.clear = this.clear.bind(this);
    }

    getEntries() {
        return [...this.logs];
    }

    getText() {
        return this.logs.join('\n');
    }

    add(entry) {
        if (entry.includes('Failed to preload')) {
            return;
        }

        this.logs.push(entry);

        while (this.logs.length > this.maxEntries) {
            this.logs.shift();
        }

        const consoleVisible = document.querySelector('.dev-panel-console')?.classList.contains('dev-panel-console--visible');
        if (consoleVisible) {
            this.render(entry);
            console?.scrollToBottom();
        }
    }

    render(entry) {
        const element = document.querySelector(`.dev-panel-console .fxs-scrollable-content`);
        if (!element) {
            return;
        }

        const row = document.createElement('div');
        row.textContent = entry;
        element.appendChild(row);

        while (element.children.length > this.maxEntries) {
            element.removeChild(element.firstChild);
        }

        console?.scrollToBottom();
    }

    restore() {
        // timeout required
        setTimeout(() => {
            const element = document.querySelector(`.dev-panel-console .fxs-scrollable-content`);
            if (!element) {
                return;
            }
            element.innerHTML = '';
            const fragment = document.createDocumentFragment();
            this.logs.forEach(entry => {
                const row = document.createElement('div');
                row.textContent = entry;
                fragment.appendChild(row);
            });
            element.appendChild(fragment);
            console?.scrollToBottom();
        }, 1);
    }

    clear() {
        this.logs = [];
        const element = document.querySelector(`.dev-panel-console .fxs-scrollable-content`);
        if (element) {
            element.innerHTML = '';
        }
    }
}