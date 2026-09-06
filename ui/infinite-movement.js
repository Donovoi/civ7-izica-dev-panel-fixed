export class InfiniteMovementController {
    isEnabled = false;
    restoring = new Set();

    constructor(runtime) {
        this.runtime = runtime;
        this.refreshLabel = this.refreshLabel.bind(this);
        this.restoreAllMovement = this.restoreAllMovement.bind(this);
        this.setEnabled = this.setEnabled.bind(this);
        this.enable = this.enable.bind(this);
        this.disable = this.disable.bind(this);
        this.toggle = this.toggle.bind(this);

        runtime.onMovementChanged(data => this.restoreUnit(data.unit));
    }

    refreshLabel() {
        const label = this.runtime.getLabel();
        if (label) {
            label.innerHTML = this.isEnabled ? 'Inf.movement: On' : 'Inf.movement: Off';
        }
    }

    restoreAllMovement() {
        for (const id of this.runtime.getUnitIds()) this.restoreUnit(id);
    }

    restoreUnit(id) {
        if (!this.isEnabled || !id) return false;
        const unit = this.runtime.getUnit(id);
        if (!unit || unit.owner !== this.runtime.localPlayerId() || unit.isOnMap === false) return false;
        const remaining = unit.Movement?.movementMovesRemaining;
        const maximum = unit.Movement?.maxMoves;
        if (!Number.isFinite(remaining) || !Number.isFinite(maximum) || maximum <= 0 || remaining >= maximum) return false;
        const key = `${id.owner}:${id.id}:${id.type}`;
        if (this.restoring.has(key)) return false;
        this.restoring.add(key);
        try {
            // Restoring may itself raise the same event. Do not cancel orders,
            // change selection, or restore other players' movement here.
            this.runtime.restoreMovement(id);
            return true;
        } catch (error) {
            console.warn(`Dev panel: movement could not be restored for unit ${id.id}: ${error.message}`);
            return false;
        } finally { this.restoring.delete(key); }
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

export const InfiniteMovement = new InfiniteMovementController({
    onMovementChanged: callback => engine.on('UnitMovementPointsChanged', callback),
    localPlayerId: () => GameContext.localPlayerID,
    getUnitIds: () => Players.get(GameContext.localPlayerID)?.Units?.getUnitIds() ?? [],
    getUnit: id => Units.get(id),
    restoreMovement: id => Units.restoreMovement(id),
    getLabel: () => document.querySelector('.dev-panel-button__label--toggle-infinite-movement'),
});
