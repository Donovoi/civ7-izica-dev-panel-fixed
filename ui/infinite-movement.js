export const InfiniteMovement = new class {
    isEnabled = false;

    constructor() {
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

    toggle() {
        this.isEnabled = !this.isEnabled;

        const label = document.querySelector('.dev-panel-button__label--toggle-infinite-movement');
        if (label) {
            label.innerHTML = this.isEnabled ? 'Inf.movement: On' : 'Inf.movement: Off';
        }

        if (!this.isEnabled) {
            return;
        }

        const units = Players.get(GameContext.localPlayerID)?.Units?.getUnits();
        if (units) {
            for (let i = 0; i < units.length; i++) {
                Units.restoreMovement(units[i].id);
            }
        }
    }
}