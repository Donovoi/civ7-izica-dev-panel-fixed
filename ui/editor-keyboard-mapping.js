const ACTIONS = [
    'toggle-dev-panel',
    'toggle-dev-console',
    'font-increase',
    'font-decrease',
    'reset-panel-size',
    'toggle-fast-gameplay',
    'toggle-performance-profiler',
    'add-repro-marker',
    'capture-debug-snapshot',
    'copy-all-logs',
    'clear-all-logs',
    'run-empire-maintenance',
    'reload-ui',
    'complete-production',
    'add-population',
    'complete-tech',
    'complete-civic',
    'complete-all-research-civics',
    'toggle-infinite-movement',
    'reinforce-all-units',
    'inspect-selected-commander',
    'upgrade-all-units',
    'heal-units',
    'add-xp',
    'toggle-autoplay-mastery',
    'cycle-autoplay-bias',
    'add-gold',
    'add-influence',
    'add-happiness',
    'add-wildcard-attribute-point',
    'start-golden-age',
    'spawn-settler',
    'reveal-map',
    'meet-all',
    'transition-to-next-age',
];

setTimeout(() => {
    const EditorKeyboardMapping = Controls.getDefinition('editor-keyboard-mapping').createInstance;
    EditorKeyboardMapping.prototype.addActionForDevPanel = function (action, inputContext) {
        const actionId = Input.getActionIdByName(action);
        if (!actionId || this.mappingDataMap.has(actionId)) {
            return;
        }
        if (!Input.hasGesture(actionId, 0, inputContext) && !Input.hasGesture(actionId, 1, inputContext)) {
            return;
        }
        this.actionContainer.appendChild(this.createActionEntry(actionId, inputContext));
    }

    const addActionsForContext = EditorKeyboardMapping.prototype.addActionsForContext;
    EditorKeyboardMapping.prototype.addActionsForContext = function (inputContext) {
        ACTIONS.forEach(action => this.addActionForDevPanel(action, inputContext))
        addActionsForContext.call(this, inputContext);
    }
}, 0);