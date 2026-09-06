const ADD = "UNITCOMMAND_ADD_TO_ARMY";
const REINFORCE = "UNITOPERATION_REINFORCE_ARMY";
const MOVE = "UNITOPERATION_MOVE_TO";
const key = id => id ? `${id.owner}:${id.id}:${id.type}` : "";
const same = (a, b) => !!a && !!b && key(a) === key(b);
const valid = id => id && Number.isInteger(id.owner) && id.owner >= 0 && Number.isInteger(id.id) && id.id >= 0;
const plotKey = p => `${p.x}:${p.y}`;
const samePlot = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
const coords = p => ({ X: p.x, Y: p.y });

export function createReinforcementRuntime(g) {
    const units = () => (g.Players.get(g.GameContext.localPlayerID)?.Units?.getUnitIds() ?? [])
        .map(id => g.Units.get(id)).filter(u => u?.owner === g.GameContext.localPlayerID);
    const definition = u => g.GameInfo.Units.lookup(u.type);
    const army = u => valid(u?.armyId) ? g.Armies.get(u.armyId) : null;
    const incoming = id => g.Players.get(g.GameContext.localPlayerID)?.Armies?.getUnitReinforcementCommanderId(id, g.GameContext.localPlayerID);
    const military = u => !u.isCommanderUnit && definition(u)?.CoreClass === "CORE_CLASS_MILITARY";
    const assigned = u => !!army(u)?.getUnitIds().some(id => same(id, u.id));
    const eligible = u => !!u && u.owner === g.GameContext.localPlayerID && military(u)
        && u.isOnMap !== false && u.location?.x >= 0 && u.location?.y >= 0 && !assigned(u)
        && !(Number.isInteger(incoming(u.id)) && incoming(u.id) >= 0);
    const hasRoom = (commander, all) => {
        const targetArmy = army(commander);
        const capacity = targetArmy?.combatUnitCapacity;
        if (!Number.isFinite(capacity)) return false;
        const members = new Set(targetArmy.getUnitIds().map(key));
        const used = all.filter(u => military(u) && (members.has(key(u.id)) || incoming(u.id) === targetArmy.localId)).length;
        return used < capacity;
    };
    const moveArgs = p => ({ ...coords(p), Modifiers: g.UnitOperationMoveModifiers.NONE });
    const safeMove = (u, p, allowExhausted = false) => {
        const diplomacy = g.Players.get(u.owner)?.Diplomacy;
        if (diplomacy?.willMoveStartWar(u.id, p)?.Success) return false;
        const args = moveArgs(p);
        const combat = g.Game.Combat?.testAttackInto(u.id, args);
        if (combat != null && combat !== g.CombatTypes.NO_COMBAT) return false;
        if (g.Game.UnitOperations.canStart(u.id, MOVE, args, false)?.Success) return true;
        // Paths can be planned for an exhausted unit while movement restoration
        // is still propagating. Sending still requires a successful fresh check.
        return allowExhausted && u.Movement?.movementMovesRemaining <= 0 && u.Movement?.maxMoves > 0;
    };
    return {
        localPlayerId: () => g.GameContext.localPlayerID,
        eligible,
        awaitingMovement: () => units().some(u => eligible(u) && u.Movement?.movementMovesRemaining <= 0 && u.Movement?.maxMoves > 0),
        explain() {
            const all = units();
            const soldiers = all.filter(eligible);
            const commanders = all.filter(u => u.isCommanderUnit && u.isOnMap !== false);
            if (!commanders.length) return "No local commanders are on the map.";
            if (!soldiers.length) return "No unassigned soldiers are on the map; units may already be packed or reinforcing.";
            return `${soldiers.length} unassigned soldiers found, but no reachable compatible commander with room or legal reinforcement target. Check commander capacity, domain, and routes.`;
        },
        plan(id, visited = new Set()) {
            const u = g.Units.get(id);
            if (!eligible(u)) return null;
            const all = units();
            const commanders = all.filter(c => c.isCommanderUnit && c.isOnMap !== false
                && c.location?.x >= 0 && c.location?.y >= 0 && definition(c)?.Domain === definition(u)?.Domain);
            const addPlots = g.Game.UnitCommands.canStart(id, ADD, {}, false)?.Plots ?? [];
            const reinforcementPlots = g.Game.UnitOperations.canStart(id, REINFORCE, {}, false)?.Plots ?? [];
            const choices = [];
            for (const commander of commanders) {
                const targetPlot = { x: commander.location.x, y: commander.location.y };
                const targetIndex = g.GameplayMap.getIndexFromLocation(targetPlot);
                const base = { unitId: id, commanderId: commander.id, armyId: commander.armyId, targetPlot };
                if (addPlots.includes(targetIndex) && g.Game.UnitCommands.canStart(id, ADD, coords(targetPlot), false)?.Success) {
                    choices.push({ ...base, mode: "add", score: -1 });
                    continue;
                }
                if (hasRoom(commander, all)) {
                    const approach = [targetPlot, ...g.directions.map(d => g.GameplayMap.getAdjacentPlotLocation(targetPlot, d))];
                    for (const destination of approach) {
                        if (!destination || destination.x < 0 || destination.y < 0 || samePlot(u.location, destination)) continue;
                        let path;
                        try { path = g.Units.getPathTo(id, destination); }
                        catch { continue; } // One unavailable route must not hide other commanders.
                        const plots = path?.plots;
                        // Empty and partial paths are not zero-cost routes.
                        if (!plots?.length || plots[plots.length - 1] !== g.GameplayMap.getIndexFromLocation(destination)) continue;
                        const first = plots.find(p => p !== g.GameplayMap.getIndexFromLocation(u.location));
                        if (first == null) continue;
                        const next = g.GameplayMap.getLocationFromIndex(first);
                        if (!next || g.GameplayMap.getPlotDistance(u.location.x, u.location.y, next.x, next.y) !== 1
                            || visited.has(plotKey(next)) || !safeMove(u, next, true)) continue;
                        choices.push({ ...base, mode: "move", next, score: plots.length + (samePlot(destination, targetPlot) ? 0 : 0.5) });
                    }
                }
                // Native reinforcement is still available for routes/domains
                // that cannot use ordinary movement (including off-map travel).
                if (reinforcementPlots.includes(targetIndex)
                    && g.Game.UnitOperations.canStart(id, REINFORCE, coords(targetPlot), false)?.Success) {
                    choices.push({ ...base, mode: "reinforce", score: 100000 + g.GameplayMap.getPlotDistance(u.location.x, u.location.y, targetPlot.x, targetPlot.y) });
                }
            }
            choices.sort((a, b) => a.score - b.score || key(a.commanderId).localeCompare(key(b.commanderId)));
            return choices[0] ?? null;
        },
        state(id, target) {
            const u = g.Units.get(id);
            if (!u || u.owner !== g.GameContext.localPlayerID) return { missing: true };
            const destinationArmy = valid(target?.armyId) ? g.Armies.get(target.armyId) : null;
            const incomingArmy = incoming(id);
            return { joined: assigned(u), dispatched: !!destinationArmy && Number.isInteger(incomingArmy)
                    && incomingArmy >= 0 && incomingArmy === destinationArmy.localId,
                location: { ...u.location }, onMap: u.isOnMap !== false,
                moves: u.Movement?.movementMovesRemaining, maxMoves: u.Movement?.maxMoves };
        },
        send(action) {
            const u = g.Units.get(action.unitId);
            const commander = g.Units.get(action.commanderId);
            if (!u || !commander || u.owner !== g.GameContext.localPlayerID || commander.owner !== u.owner) return false;
            if (!samePlot(commander.location, action.targetPlot)) return false;
            const isAdd = action.mode === "add";
            const name = isAdd ? ADD : action.mode === "move" ? MOVE : REINFORCE;
            const api = isAdd ? g.Game.UnitCommands : g.Game.UnitOperations;
            const args = action.mode === "move" ? moveArgs(action.next) : coords(action.targetPlot);
            if (action.mode === "move" && !safeMove(u, action.next)) return false;
            if (!api.canStart(action.unitId, name, args, false)?.Success) return false;
            if (api.sendRequest(action.unitId, name, args) === false) throw new Error(`The game rejected ${name}; no duplicate request was sent.`);
            return true;
        },
    };
}

// One soldier and one confirmed native step at a time. Movement is issued one
// path tile at a time, so restoring movement never needs to cancel a long order.
export class ReinforcementRunner {
    constructor(runtimeFactory, movement, { schedule = setTimeout, unschedule = clearTimeout, now = () => Date.now() } = {}) {
        Object.assign(this, { runtimeFactory, movement, schedule, unschedule, now });
        this.job = null;
        this.timer = null;
    }
    get runtime() { return this._runtime ??= this.runtimeFactory(); }
    plan(id) { return this.runtime.plan(id); }
    explain() { return this.runtime.explain(); }
    awaitingMovement() { return this.runtime.awaitingMovement(); }
    isActive(id) { return this.job && same(id, this.job.id); }
    wake() {
        if (!this.job || this.timer !== null) return;
        this.timer = this.schedule(() => { this.timer = null; this.step(); }, 75);
    }
    start(id, callback) {
        if (this.job) return false;
        this.job = { id, callback, playerId: this.runtime.localPlayerId(), pending: null,
            visited: new Set(), steps: 0, stale: 0, readySince: this.now() };
        this.wake();
        return true;
    }
    finish(success, reason) {
        const job = this.job;
        this.job = null;
        if (this.timer !== null) this.unschedule(this.timer);
        this.timer = null;
        job?.callback(success, reason);
    }
    step() {
        const job = this.job;
        if (!job) return;
        try {
            if (this.runtime.localPlayerId() !== job.playerId) { this.finish(false, "Local player changed."); return; }
            const state = this.runtime.state(job.id, job.pending?.action);
            if (state.missing) { this.finish(false, "Unit no longer exists or is no longer owned locally."); return; }
            if (state.joined) { this.finish(true, "Joined a commander."); return; }
            if (state.dispatched && job.pending?.action.mode === "reinforce") { this.finish(true, "Native reinforcement travel confirmed; arrival follows the game's travel timer."); return; }
            if (job.pending) {
                const pending = job.pending;
                if (pending.action.mode === "move" && samePlot(state.location, pending.action.next)) {
                    job.visited.add(plotKey(state.location));
                    job.pending = null;
                    job.readySince = this.now();
                } else {
                    if (this.now() - pending.sentAt >= 10000) this.finish(false, "The last movement/reinforcement was not confirmed; no retry was sent.");
                    else this.wake();
                    return;
                }
            }
            if (!state.onMap) { this.finish(false, "Unit left the map without a confirmed army assignment."); return; }
            if (state.moves <= 0 && state.maxMoves > 0) {
                this.movement.restoreUnit(job.id);
                if (this.now() - job.readySince >= 5000) this.finish(false, "Movement points could not be restored.");
                else this.wake();
                return;
            }
            job.visited.add(plotKey(state.location));
            const action = this.runtime.plan(job.id, job.visited);
            if (!action) { this.finish(false, this.runtime.explain()); return; }
            if (++job.steps > 4096) { this.finish(false, "Movement limit reached; stopped to avoid a route loop."); return; }
            job.pending = { action, sentAt: this.now() };
            if (!this.runtime.send(action)) {
                job.pending = null;
                if (++job.stale >= 3) { this.finish(false, "The target or movement eligibility kept changing."); return; }
            } else job.stale = 0;
            this.wake();
        } catch (error) { this.finish(false, error.message ?? String(error)); }
    }
}
