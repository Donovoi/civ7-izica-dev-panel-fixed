export const InfiniteMovement = new class {
    isEnabled = false;

    constructor() {
        this.refreshLabel = this.refreshLabel.bind(this);
        this.restoreAllMovement = this.restoreAllMovement.bind(this);
        this.setEnabled = this.setEnabled.bind(this);
        this.enable = this.enable.bind(this);
        this.disable = this.disable.bind(this);
        this.toggle = this.toggle.bind(this);

        engine.on('UnitMovementPointsChanged', (data) => {
            if (!this.isEnabled) {
                return;
            }

            Units.restoreMovement(data.unit);
            UI.Player.deselectAllUnits();
            Game.UnitCommands?.sendRequest(data.unit, 'UNITCOMMAND_CANCEL', data.unit);
            UI.Player.selectUnit(data.unit);
        });
    }

    refreshLabel() {
        const label = document.querySelector('.dev-panel-button__label--toggle-infinite-movement');
        if (label) {
            label.innerHTML = this.isEnabled ? 'Inf.movement: On' : 'Inf.movement: Off';
        }
    }

    restoreAllMovement() {
        const units = Players.get(GameContext.localPlayerID)?.Units?.getUnits();
        if (units) {
            for (let i = 0; i < units.length; i++) {
                Units.restoreMovement(units[i].id);
            }
        }
    }

    setEnabled(enabled) {
        const nextEnabled = Boolean(enabled);
        const didChange = this.isEnabled !== nextEnabled;

        this.isEnabled = nextEnabled;
        this.refreshLabel();

        if (this.isEnabled) {
            this.restoreAllMovement();
        }

        return didChange;
    }

    enable() {
        return this.setEnabled(true);
    }

    disable() {
        return this.setEnabled(false);
    }

    toggle() {
        this.setEnabled(!this.isEnabled);
    }
}