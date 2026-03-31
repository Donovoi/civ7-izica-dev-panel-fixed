const ACTIONS = [
    'toggle-dev-panel',
    'toggle-dev-console',
    'font-increase',
    'font-decrease',
    'reset-panel-size',
    'reload-ui',
    'complete-production',
    'complete-tech',
    'complete-civic',
    'toggle-infinite-movement',
    'add-gold',
    'add-influence',
    'spawn-settler',
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