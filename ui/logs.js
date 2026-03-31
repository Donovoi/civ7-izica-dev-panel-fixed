export const Logs = new class {
    logs = [];

    constructor() {
        this.add = this.add.bind(this);
        this.render = this.render.bind(this);
        this.restore = this.restore.bind(this);
        this.clear = this.clear.bind(this);
    }

    add(entry) {
        if (entry.includes('Failed to preload')) {
            return;
        }

        this.logs.push(entry);

        this.render(entry);
        console?.scrollToBottom();
    }

    render(entry) {
        const element = document.querySelector(`.dev-panel-console .fxs-scrollable-content`);
        if (!element) {
            return;
        }

        const row = document.createElement('div');
        row.innerHTML = entry;
        element.appendChild(row);
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
            this.logs.forEach(entry => this.render(entry));
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