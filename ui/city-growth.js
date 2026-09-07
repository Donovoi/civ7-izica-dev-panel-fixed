// Native contracts: place-population/model-place-population.js,
// interface-mode-acquire-tile.js, plot-workers-manager.js, and Cities.ltp.
const STEP_MS = 25;
const POLL_MS = 100;
const CITIES_PER_TICK = 8;
const TICK_BUDGET_MS = 4;
const TIMEOUT_MS = 10000;
const MAX_PLACEMENTS = 50000; // A runaway guard, never reported as a population cap.
const key = id => `${id.owner}:${id.id}:${id.type}`;
const sameCity = (a, b) => a != null && b != null && key(a) === key(b);
const noCity = id => id == null || (id.owner === -1 && id.id === -1);
const workerCount = (state, plot) => state.workers.find(w => w.plot === plot)?.count ?? 0;
const delta = (before, after) => ({
    rural: after.ruralPlots.filter(plot => !before.ruralPlots.includes(plot)).length,
    specialists: after.workers.reduce((sum, w) => sum + Math.max(0, w.count - workerCount(before, w.plot)), 0),
});

export function createGameCityGrowthRuntime(g) {
    const cityFor = (id, playerId) => {
        const city = g.Cities.get(id);
        if (g.GameContext.localPlayerID !== playerId || !city || city.owner !== playerId || id.owner !== playerId || !sameCity(city.id, id)) {
            throw new Error("Settlement is no longer owned by the local player.");
        }
        return city;
    };
    const ownerAt = location => g.GameplayMap.getOwningCityFromXY(location.x, location.y);
    const ownedBy = (plot, id) => sameCity(ownerAt(g.GameplayMap.getLocationFromIndex(plot)), id);
    const expandArgs = c => ({ X: c.location.x, Y: c.location.y });
    const workerArgs = c => ({ Location: c.plot, Amount: 1 });
    const inspect = (id, playerId) => {
        const city = cityFor(id, playerId);
        if (typeof city.Growth?.isReadyToPlacePopulation !== "boolean" || !Number.isFinite(city.population)) {
            throw new Error("Population readiness is unavailable.");
        }
        const ids = city.Districts?.getIdsOfType(g.DistrictTypes.RURAL);
        if (!ids) throw new Error("Rural district data is unavailable.");
        const ruralPlots = ids.map(districtId => {
            const district = g.Districts.get(districtId);
            if (!district?.location) throw new Error("A rural district has no location.");
            return g.GameplayMap.getIndexFromLocation(district.location);
        }).filter(plot => ownedBy(plot, id));
        // This query also lists neighboring settlements' tiles. Excluding them
        // prevents an empire sweep from transferring the same tiles endlessly.
        const query = g.Game.CityCommands.canStart(id, g.CityCommandTypes.EXPAND, {}, false);
        // Native UI queries this while population is ready. Before readiness,
        // returned plots are useful candidates, but an empty result does not
        // establish that the native engine has exposed its placement capacity.
        const ruralAvailable = Array.isArray(query?.Plots)
            && (city.Growth.isReadyToPlacePopulation || query.Plots.length > 0);
        const candidates = [];
        for (const plot of new Set(query?.Plots ?? [])) {
            if (!Number.isInteger(plot) || plot < 0 || ruralPlots.includes(plot)) continue;
            const location = g.GameplayMap.getLocationFromIndex(plot);
            if (!location) throw new Error("An expansion plot has no location.");
            const owner = ownerAt(location);
            if (noCity(owner) || sameCity(owner, id)) candidates.push({ kind: "rural", plot, location });
        }
        const workers = [];
        if (!city.isTown) {
            const cap = city.Workers?.getCityWorkerCap();
            const info = city.Workers?.GetAllPlacementInfo();
            if (!Number.isFinite(cap) || !info) throw new Error("Specialist capacity is unavailable.");
            for (const row of info) {
                if (!Number.isInteger(row.PlotIndex) || !ownedBy(row.PlotIndex, id)) continue;
                if (!Number.isFinite(row.NumWorkers) || !Number.isFinite(row.MaxWorkers)) {
                    throw new Error("Specialist placement counts are unavailable.");
                }
                workers.push({ plot: row.PlotIndex, count: row.NumWorkers });
                if (cap > 0 && !row.IsBlocked && row.NumWorkers < row.MaxWorkers) {
                    candidates.push({ kind: "specialist", plot: row.PlotIndex,
                        location: g.GameplayMap.getLocationFromIndex(row.PlotIndex) });
                }
            }
        }
        candidates.sort((a, b) => Number(a.kind === "specialist") - Number(b.kind === "specialist") || a.plot - b.plot);
        return { name: g.Locale?.compose(city.name) ?? city.name ?? `Settlement ${id.id}`,
            ready: city.Growth.isReadyToPlacePopulation, population: city.population,
            ruralAvailable, ruralPlots, workers, candidates };
    };
    return {
        localPlayerId: () => g.GameContext.localPlayerID,
        cityIds(playerId) {
            const cities = g.Players.get(playerId)?.Cities?.getCities();
            if (!cities) throw new Error("Local settlements are unavailable.");
            return cities.filter(city => city.owner === playerId).map(city => ({ ...city.id }));
        },
        inspect,
        grant(id, playerId) {
            const city = cityFor(id, playerId);
            const state = inspect(id, playerId);
            if (state.ready || (!state.candidates.length && state.ruralAvailable !== false)) return false;
            // Complete the food queue as the game's own Cities tuner does.
            // Focused towns use the separate tuner population grant so their
            // chosen focus is preserved and no focus project is completed.
            const focusedTown = city.isTown && city.Growth.growthType !== g.GrowthTypes.EXPAND;
            if (!focusedTown && typeof city.FoodQueue?.completeProduction === "function") {
                if (city.FoodQueue.completeProduction() === false) throw new Error("The food growth request was rejected.");
            } else if (typeof city.addRuralPopulation === "function") {
                city.addRuralPopulation(1);
            } else throw new Error("Population growth is unavailable in this settlement.");
            return true;
        },
        place(id, candidate, playerId) {
            cityFor(id, playerId);
            const state = inspect(id, playerId);
            const current = state.candidates.find(c => c.kind === candidate.kind && c.plot === candidate.plot);
            if (!state.ready || !current) return false;
            const rural = candidate.kind === "rural";
            const api = rural ? g.Game.CityCommands : g.Game.PlayerOperations;
            const target = rural ? id : playerId;
            const type = rural ? g.CityCommandTypes.EXPAND : g.PlayerOperationTypes.ASSIGN_WORKER;
            const args = rural ? expandArgs(current) : workerArgs(current);
            if (api.canStart(target, type, args, false)?.Success !== true) return false;
            cityFor(id, playerId);
            if (api.sendRequest(target, type, args) === false) throw new Error("The population placement request was rejected.");
            return true;
        },
        on: (event, callback) => g.engine.on(event, callback),
        off: (event, callback) => g.engine.off(event, callback),
    };
}

export class CityGrowthController {
    constructor(runtimeFactory, { schedule = setTimeout, unschedule = clearTimeout, now = Date.now,
        render = () => {}, report = () => {} } = {}) {
        Object.assign(this, { runtimeFactory, schedule, unschedule, now, render, report });
        this.runtime = null;
        this.running = false;
        this.timer = null;
        this.timerDue = null;
        this.listeners = [];
        this.pending = new Map();
        this.blocked = new Map();
        this.count = { rural: 0, specialists: 0 };
        this.message = "Growth: ready";
        this.toggle = this.toggle.bind(this);
        this.refreshStatus = this.refreshStatus.bind(this);
    }
    refreshStatus() { this.render({ running: this.running, message: this.message }); }
    status(text) { this.message = `Growth: ${text}`; this.refreshStatus(); }
    toggle() { if (this.running) this.stop(); else this.start(); }
    stop() { this.finish(`Stopped; ${this.totals()}.${this.pending.size ? " Pending growth will be checked before resuming." : ""}`); }
    totals() { return `${this.count.rural} rural tiles and ${this.count.specialists} specialists placed`; }
    start() {
        if (this.running) return;
        try {
            this.runtime ??= this.runtimeFactory();
            const playerId = this.runtime.localPlayerId();
            if (!Number.isInteger(playerId) || playerId < 0) throw new Error("No local player is active.");
            if (this.pending.size && playerId !== this.playerId) throw new Error("The previous player's growth is pending. Reload the UI before changing players.");
            this.playerId = playerId;
            this.blocked.clear();
            this.rejections = new Map();
            this.rejectedCandidates = new Map();
            this.count = { rural: 0, specialists: 0 };
            this.quietPasses = 0;
            this.running = true;
            const changed = () => this.queue(STEP_MS);
            for (const [event, callback] of [
                ["DistrictAddedToMap", changed], ["WorkerAdded", changed], ["CityPopulationChanged", changed],
                ["FoodQueueChanged", changed], ["CityGrowthModeChanged", changed],
                ["LocalPlayerChanged", () => this.finish("Stopped because the local player changed.")],
            ]) { this.runtime.on(event, callback); this.listeners.push([event, callback]); }
            this.beginPass();
            this.status("Filling available rural tiles and specialist slots...");
            this.queue(STEP_MS);
        } catch (error) { this.finish(`Stopped: ${error.message ?? error}`); }
    }
    beginPass() {
        this.cityIds = [...new Map(this.runtime.cityIds(this.playerId).map(id => [key(id), id])).values()];
        const present = new Set(this.cityIds.map(key));
        for (const [cityKey, p] of this.pending) {
            if (!present.has(cityKey)) this.blocked.set(cityKey, `${p.name}: settlement is no longer available; its request remains unconfirmed`);
        }
        this.index = 0;
        this.passProgress = false;
        this.full = new Set();
        this.unplaced = new Set();
    }
    queue(delay) {
        if (!this.running) return;
        const due = this.now() + delay;
        if (this.timer !== null) {
            if (this.timerDue <= due) return;
            this.unschedule(this.timer);
        }
        this.timerDue = due;
        this.timer = this.schedule(() => { this.timer = null; this.timerDue = null; this.step(); }, delay);
    }
    credit(before, after) {
        const added = delta(before, after);
        this.count.rural += added.rural;
        this.count.specialists += added.specialists;
        this.passProgress = true;
    }
    advanceCity(id) {
        const cityKey = key(id);
        if (this.blocked.has(cityKey)) return;
        try {
            const state = this.runtime.inspect(id, this.playerId);
            if (!this.running) return;
            if (this.runtime.localPlayerId() !== this.playerId) {
                this.finish("Stopped because the local player changed.");
                return;
            }
            const p = this.pending.get(cityKey);
            if (p) {
                const added = delta(p.before, state);
                const confirmed = p.kind === "grant"
                    ? state.ready || (state.population > p.before.population && added.rural + added.specialists > 0)
                    : p.candidate.kind === "rural"
                        ? !p.before.ruralPlots.includes(p.candidate.plot) && state.ruralPlots.includes(p.candidate.plot)
                        : workerCount(state, p.candidate.plot) > workerCount(p.before, p.candidate.plot);
                if (confirmed) {
                    this.pending.delete(cityKey);
                    if (p.kind === "placement" || added.rural + added.specialists > 0) this.credit(p.before, state);
                    this.passProgress = true;
                    this.rejections.delete(cityKey);
                    this.rejectedCandidates.delete(cityKey);
                    // Allow the engine to settle readiness/capacity on a later
                    // tick before sending another operation to this settlement.
                    return;
                }
                if (this.now() - p.sentAt >= TIMEOUT_MS) {
                    this.blocked.set(cityKey, `${state.name}: ${p.kind} was not confirmed; no duplicate request sent`);
                }
                return;
            }
            if (!state.candidates.length && (state.ruralAvailable !== false || state.ready)) {
                if (state.ruralAvailable === false) this.blocked.set(cityKey, `${state.name}: expansion capacity could not be verified`);
                else {
                    this.full.add(cityKey);
                    if (state.ready) this.unplaced.add(cityKey);
                }
                return;
            }
            const rejected = this.rejectedCandidates.get(cityKey) ?? new Set();
            // Native growth grants may assign population automatically, without
            // a documented target boundary. Serialize them against every other
            // city's pending mutation. Retained uncertain requests keep this
            // barrier after Stop/timeout; explicit placements reserve one plot.
            const reservations = [...this.pending]
                .filter(([otherKey]) => otherKey !== cityKey)
                .map(([owner, request]) => ({ owner, kind: request.kind, plot: request.candidate?.plot }));
            const waitFor = conflicts => {
                if (conflicts.every(claim => this.blocked.has(claim.owner))) {
                    this.blocked.set(cityKey, `${state.name}: waiting for unconfirmed growth in another settlement`);
                }
            };
            const grantBarriers = state.ready ? reservations.filter(claim => claim.kind === "grant") : reservations;
            if (grantBarriers.length) { waitFor(grantBarriers); return; }
            const legalCandidates = state.candidates.filter(c => !rejected.has(`${c.kind}:${c.plot}`));
            const candidate = legalCandidates.find(c => !reservations.some(claim => claim.plot === c.plot));
            if (!candidate && state.candidates.length) {
                const waiting = reservations.filter(claim => legalCandidates.some(c => claim.plot === c.plot));
                if (waiting.length) {
                    waitFor(waiting);
                    return;
                }
                this.blocked.set(cityKey, `${state.name}: the game rejected all remaining growth placements`);
                return;
            }
            const kind = state.ready ? "placement" : "grant";
            // The native UI normally queries plots only after population is
            // ready. If capacity is hidden, create ONE growth step to reveal
            // it. Pending confirmation prevents a repeated speculative grant.
            // Record before dispatch: native calls can synchronously emit events.
            this.pending.set(cityKey, { id, name: state.name, kind, candidate, before: state, sentAt: this.now() });
            const submitted = state.ready
                ? this.runtime.place(id, candidate, this.playerId)
                : this.runtime.grant(id, this.playerId);
            if (submitted === false) {
                this.pending.delete(cityKey); // Guard rejected it; nothing was sent.
                if (kind === "placement") {
                    rejected.add(`${candidate.kind}:${candidate.plot}`);
                    this.rejectedCandidates.set(cityKey, rejected);
                }
                const failures = (this.rejections.get(cityKey) ?? 0) + 1;
                this.rejections.set(cityKey, failures);
                if (kind === "grant" && failures >= 3) this.blocked.set(cityKey, `${state.name}: the game rejected population growth`);
            }
            this.passProgress = true;
            if (this.running) this.status(`${state.name}; ${this.totals()}. Click again to stop.`);
        } catch (error) {
            // Keep uncertain requests across Stop/Start, but let other cities grow.
            this.blocked.set(cityKey, `${error.message ?? error}`);
        }
    }
    step() {
        if (!this.running) return;
        try {
            const started = this.now();
            let processed = 0;
            // Every city keeps its own pending proof. A bounded batch lets
            // independent settlements progress together without issuing two
            // operations to the same city or monopolizing the UI thread.
            while (this.index < this.cityIds.length && processed < CITIES_PER_TICK
                && (processed === 0 || this.now() - started < TICK_BUDGET_MS)) {
                if (!this.running) return;
                if (this.runtime.localPlayerId() !== this.playerId) throw new Error("The local player changed.");
                if (this.count.rural + this.count.specialists >= MAX_PLACEMENTS) {
                    throw new Error("Growth stopped at the operation guard. Remaining capacity has not been exhausted.");
                }
                this.advanceCity(this.cityIds[this.index++]);
                processed++;
            }
            if (!this.running) return;
            if (this.runtime.localPlayerId() !== this.playerId) throw new Error("The local player changed.");
            if (this.count.rural + this.count.specialists >= MAX_PLACEMENTS) {
                throw new Error("Growth stopped at the operation guard. Remaining capacity has not been exhausted.");
            }
            if (this.index < this.cityIds.length) {
                this.queue(STEP_MS);
                return;
            }
            const waiting = [...this.pending.keys()].some(cityKey => !this.blocked.has(cityKey));
            if (this.passProgress || waiting) this.quietPasses = 0;
            else this.quietPasses++;
            if (this.quietPasses >= 2) {
                const blocked = [...this.blocked.values()];
                this.finish(`${this.totals()}; ${this.full.size} settlements report no remaining growth slots.${blocked.length
                    ? ` ${blocked.length} blocked: ${blocked.slice(0, 3).join("; ")}.` : ""}${this.unplaced.size
                    ? ` ${this.unplaced.size} settlements still have unplaced population because no slots remain.` : ""}`);
                return;
            }
            this.beginPass();
            this.queue(waiting || this.quietPasses ? POLL_MS : STEP_MS);
        } catch (error) { this.finish(`Stopped: ${error.message ?? error}`); }
    }
    finish(message) {
        this.running = false;
        if (this.timer !== null) this.unschedule(this.timer);
        this.timer = null;
        this.timerDue = null;
        for (const [event, callback] of this.listeners) this.runtime.off(event, callback);
        this.listeners = [];
        this.status(message);
        this.report(this.message);
    }
}

export const CityGrowth = new CityGrowthController(
    () => createGameCityGrowthRuntime({ Game, GameContext, Players, Cities, GameplayMap, Districts,
        DistrictTypes, CityCommandTypes, PlayerOperationTypes, GrowthTypes, Locale, engine }),
    {
        render({ running, message }) {
            const label = document.querySelector(".dev-panel-button__label--add-population");
            if (label) label.textContent = running ? "Stop growing cities" : "Grow all cities";
            const status = document.querySelector(".dev-panel-status--growth");
            if (status) status.textContent = message;
        },
        report: message => console.log(`[Izica growth] ${message}`),
    },
);
