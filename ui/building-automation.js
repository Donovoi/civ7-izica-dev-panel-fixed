// Native contracts: production-chooser-helpers, building-placement-manager,
// model-build-queue, and model-city-details in Civ VII's base-standard UI.
const STEP_MS = 25;
const POLL_MS = 100;
const TIMEOUT_MS = 10000;
const WEIGHTS = { YIELD_PRODUCTION: 3, YIELD_FOOD: 2, YIELD_HAPPINESS: 2,
    YIELD_GOLD: 1.5, YIELD_SCIENCE: 2, YIELD_CULTURE: 2, YIELD_DIPLOMACY: 1.5 };
const trueValue = value => value === true || value === 1 || value === "true" || value === "1";
const cityKey = id => `${id.owner}:${id.id}:${id.type}`;
const samePlot = (a, b) => a?.x === b?.x && a?.y === b?.y;
const itemKey = c => `${cityKey(c.cityId)}:${c.type}:${c.plot}`;

export function buildingPriority(candidate) {
    if (candidate.wonder) return 6;
    if (candidate.repair || candidate.urgent) return 0;
    if (candidate.uniquePair) return 1;
    if (candidate.advisors > 0) return 2;
    if (candidate.foundation) return 3;
    if (candidate.knowledge) return 4;
    return 5;
}

function compareBuildings(a, b) {
    return buildingPriority(a) - buildingPriority(b) || b.advisors - a.advisors
        || b.score - a.score || Number(a.overbuild) - Number(b.overbuild)
        || a.cost - b.cost || cityKey(a.cityId).localeCompare(cityKey(b.cityId))
        || a.type.localeCompare(b.type) || a.plot - b.plot;
}

// Maximum bipartite matching reserves separate legal sites for available wonders.
// Flexible wonders can move aside for one with only a single legal location.
export function reserveWonderPlots(candidates) {
    const groups = new Map();
    for (const c of candidates.filter(c => c.wonder)) {
        if (!groups.has(c.type)) groups.set(c.type, new Map());
        const prior = groups.get(c.type).get(c.plot);
        if (!prior || compareBuildings(c, prior) < 0) groups.get(c.type).set(c.plot, c);
    }
    const options = new Map([...groups].map(([type, sites]) => [type, [...sites.values()].sort(compareBuildings)]));
    const owners = new Map();
    const assign = (type, seen) => {
        for (const candidate of options.get(type)) {
            if (seen.has(candidate.plot)) continue;
            seen.add(candidate.plot);
            const prior = owners.get(candidate.plot);
            if (prior == null || assign(prior, seen)) {
                owners.set(candidate.plot, type);
                return true;
            }
        }
        return false;
    };
    for (const [type] of [...options].sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]))) {
        assign(type, new Set());
    }
    return new Map([...owners].map(([plot, type]) => [plot, groups.get(type).get(plot)]));
}

export function chooseBuilding(candidates) {
    const reservations = reserveWonderPlots(candidates);
    const regular = candidates.filter(c => !c.wonder && !reservations.has(c.plot)).sort(compareBuildings);
    return regular[0] ?? [...reservations.values()].sort(compareBuildings)[0] ?? null;
}

export function createGameBuildingRuntime(g) {
    const tags = new Map();
    for (const row of g.GameInfo.TypeTags) {
        if (!tags.has(row.Type)) tags.set(row.Type, new Set());
        tags.get(row.Type).add(row.Tag);
    }
    const yields = [...g.GameInfo.Yields];
    const lookup = value => g.GameInfo.Constructibles.lookup(value);
    const cityFor = (id, playerId) => {
        const city = g.Cities.get(id);
        if (!city || city.owner !== playerId || id.owner !== playerId) {
            throw new Error("Settlement is no longer owned by the local player.");
        }
        return city;
    };
    const queue = city => {
        const result = city.BuildQueue?.getQueue();
        if (!result) throw new Error("Production queue data is unavailable.");
        return result;
    };
    const queueIndex = (city, c) => queue(city).findIndex(item =>
        item.orderType === g.OrderTypes.ORDER_CONSTRUCT
        && lookup(item.constructibleType)?.ConstructibleType === c.type
        && samePlot(item.location, c.location));
    const completed = (city, c) => city.Constructibles.getIds().some(id => {
        const instance = g.Constructibles.getByComponentID(id);
        return instance?.complete === true && !instance.damaged && samePlot(instance.location, c.location)
            && lookup(instance.type)?.ConstructibleType === c.type;
    });
    const args = c => ({ ConstructibleType: c.hash, X: c.location.x, Y: c.location.y });
    const check = (city, c) => c.mode === "purchase"
        ? g.Game.CityCommands.canStart(city.id, g.CityCommandTypes.PURCHASE, args(c), false)
        : g.Game.CityOperations.canStart(city.id, g.CityOperationTypes.BUILD, args(c), false);
    const tag = (type, value) => tags.get(type)?.has(value) ?? false;
    const weighted = values => yields.reduce((sum, def) =>
        sum + (Number(values?.[def.$index]) || 0) * (WEIGHTS[def.YieldType] ?? 1), 0);
    const hasYield = (values, type) => {
        const def = yields.find(def => def.YieldType === type);
        return def != null && Number(values?.[def.$index]) > 0;
    };

    return {
        localPlayerId: () => g.GameContext.localPlayerID,
        cityIds(playerId) {
            const cities = g.Players.get(playerId)?.Cities?.getCities();
            if (!cities) throw new Error("Local settlements are unavailable.");
            return cities.filter(c => c.owner === playerId).map(c => ({ ...c.id }));
        },
        inspect(id, playerId, done) {
            const city = cityFor(id, playerId);
            const buildQueue = queue(city);
            const canComplete = !city.isTown && typeof city.BuildQueue?.completeProduction === "function";
            const placements = city.Yields?.calculateAllBuildingsPlacements();
            if (!placements?.buildings) throw new Error(`Placement data is unavailable for ${city.name}.`);
            const existing = city.Constructibles.getIds().map(id => g.Constructibles.getByComponentID(id)).filter(Boolean);
            const recommendations = g.Players.Advisory?.get(playerId)?.getBuildRecommendations({
                cityId: city.id, subject: g.AdvisorySubjectTypes.PRODUCTION, maxReturnedEntries: 0,
            }) ?? [];
            const advisors = new Map();
            for (const rec of recommendations) {
                if (g.GameInfo.AdvisorySubjects.lookup(rec.subject)?.AdvisorySubjectType !== "ADVISORY_SUBJECT_PRODUCE_CONSTRUCTIBLES") continue;
                const def = lookup(rec.recommendedType);
                if (def) advisors.set(def.ConstructibleType, rec.whichAdvisors?.length ?? 0);
            }
            const quarters = (g.Players.get(playerId)?.Constructibles?.getUnlockedUniqueQuarters() ?? [])
                .map(type => g.GameInfo.UniqueQuarters.lookup(type)).filter(Boolean);
            const existingQuarter = new Map();
            const quarterTypes = new Set(quarters.flatMap(q => [q.BuildingType1, q.BuildingType2]));
            for (const q of quarters) {
                const members = new Set([q.BuildingType1, q.BuildingType2]);
                const locations = [...existing.map(e => ({ type: lookup(e.type)?.ConstructibleType, location: e.location })),
                    ...buildQueue.filter(e => e.orderType === g.OrderTypes.ORDER_CONSTRUCT)
                        .map(e => ({ type: lookup(e.constructibleType)?.ConstructibleType, location: e.location }))]
                    .filter(e => members.has(e.type));
                for (const location of locations) {
                    existingQuarter.set(g.GameplayMap.getIndexFromLocation(location.location), members);
                }
            }
            const result = { candidates: [], blocked: { funds: 0, placement: 0, protected: 0,
                production: !city.isTown && !canComplete ? 1 : 0 } };
            const seen = new Set();
            const add = (definition, operation, mode, plot, queued = false) => {
                if (!["BUILDING", "WONDER", "IMPROVEMENT"].includes(definition.ConstructibleClass)) return;
                if (operation.MoveToNewLocation) return; // Do not endlessly relocate existing structures.
                const location = g.GameplayMap.getLocationFromIndex(plot);
                if (!Number.isInteger(plot) || !location) return;
                const c = { cityId: { ...id }, cityName: g.Locale.compose(city.name), type: definition.ConstructibleType,
                    name: g.Locale.compose(definition.Name), hash: definition.$hash, plot, location, mode,
                    wonder: definition.ConstructibleClass === "WONDER", repair: !!operation.RepairDamaged,
                    cost: Math.max(0, Number(operation.Cost ?? definition.Cost) || 0),
                    advisors: advisors.get(definition.ConstructibleType) ?? 0, queued };
                if (done.has(itemKey(c)) || completed(city, c)) return;
                if (!Number.isInteger(c.hash)) throw new Error("A constructible has no numeric type hash.");
                const placement = placements.buildings.find(b => b.constructibleType === definition.$hash)
                    ?.placements.find(p => p.plotID === plot);
                const reservedQuarter = existingQuarter.get(plot);
                if (!queued && reservedQuarter && !reservedQuarter.has(c.type) && !trueValue(definition.DistrictDefense)) {
                    result.blocked.protected++; return;
                }
                for (const [otherPlot, members] of existingQuarter) {
                    if (!queued && members.has(c.type) && otherPlot !== plot) {
                        result.blocked.protected++; return;
                    }
                }
                const overbuilt = placement?.overbuiltConstructibleID;
                const previous = Number.isInteger(overbuilt) && overbuilt >= 0 ? lookup(overbuilt) : null;
                c.overbuild = !!previous;
                if (!queued && previous && previous.ConstructibleType !== c.type && (
                    previous.ConstructibleClass === "WONDER" || quarterTypes.has(previous.ConstructibleType)
                    || tag(previous.ConstructibleType, "UNIQUE") || tag(previous.ConstructibleType, "UNIQUE_IMPROVEMENT")
                    || (previous.ConstructibleClass === "BUILDING" && tag(previous.ConstructibleType, "AGELESS"))
                    || done.has(itemKey({ ...c, type: previous.ConstructibleType }))
                )) { result.blocked.protected++; return; }
                if (!queued && check(city, c)?.Success !== true) return;
                const base = city.Yields.getAllBaseYieldValuesForConstructible(c.hash);
                const changes = [...(placement?.yieldChanges ?? base ?? [])];
                const maintenance = city.Constructibles.getMaintenance(c.type);
                const oldMaintenance = previous ? city.Constructibles.getMaintenance(previous.ConstructibleType) : [];
                for (const y of yields) changes[y.$index] = (Number(changes[y.$index]) || 0)
                    - (Number(maintenance?.[y.$index]) || 0) + (Number(oldMaintenance?.[y.$index]) || 0);
                c.score = weighted(changes) - (c.overbuild ? 0.25 : 0);
                c.urgent = (city.Happiness?.netHappinessPerTurn < 0 && hasYield(changes, "YIELD_HAPPINESS"))
                    || (city.Yields.getNetYield(g.YieldTypes.YIELD_FOOD) < 0 && hasYield(changes, "YIELD_FOOD"));
                c.foundation = ["FOOD", "PRODUCTION", "HAPPINESS", "GOLD"].some(t => tag(c.type, t) || hasYield(base, `YIELD_${t}`));
                c.knowledge = ["SCIENCE", "CULTURE"].some(t => tag(c.type, t) || hasYield(base, `YIELD_${t}`));
                const key = itemKey(c);
                if (!seen.has(key)) { result.candidates.push(c); seen.add(key); }
            };
            // Already queued constructibles can be finished, while units/projects
            // stay in their queue. Never use completeProduction on an unrelated head.
            if (canComplete) {
                for (const item of buildQueue) {
                    if (item.orderType !== g.OrderTypes.ORDER_CONSTRUCT) continue;
                    const definition = lookup(item.constructibleType);
                    if (definition && item.location) add(definition, {}, "existing", g.GameplayMap.getIndexFromLocation(item.location), true);
                }
            }
            // Instant production in cities preserves gold for towns that can
            // only purchase. A purchase remains a fallback for build restrictions.
            const modes = [...(canComplete ? ["build"] : []), "purchase"];
            for (const mode of modes) {
                const rows = mode === "purchase"
                    ? g.Game.CityCommands.canStartQuery(id, g.CityCommandTypes.PURCHASE, g.CityQueryType.Constructible)
                    : g.Game.CityOperations.canStartQuery(id, g.CityOperationTypes.BUILD, g.CityQueryType.Constructible);
                if (!rows) throw new Error("Constructible availability query failed.");
                for (const row of rows) {
                    const definition = lookup(row.index);
                    if (!definition || row.result.InQueue || row.result.InProgress) continue;
                    if (row.result.InsufficientFunds) result.blocked.funds++;
                    if (row.result.Success !== true) continue;
                    const plots = [...new Set([...(row.result.Plots ?? []), ...(row.result.ExpandUrbanPlots ?? [])])];
                    if (!plots.length) result.blocked.placement++;
                    for (const plot of plots) add(definition, row.result, mode, plot);
                }
            }
            // Start a new unique quarter on a plot where both halves can fit;
            // an existing half reserves its own plot for its partner above.
            for (const q of quarters) {
                const pair = result.candidates.filter(c => c.type === q.BuildingType1 || c.type === q.BuildingType2);
                for (const c of pair) {
                    c.uniquePair = existingQuarter.get(c.plot)?.has(c.type)
                        || pair.some(other => other.type !== c.type && other.plot === c.plot);
                    const shared = pair.some(other => other.type !== c.type && other.plot === c.plot);
                    if (shared) c.score += 100;
                }
            }
            return result;
        },
        state(c, playerId) {
            const city = cityFor(c.cityId, playerId);
            return { complete: completed(city, c), queueIndex: queueIndex(city, c) };
        },
        submit(c, playerId) {
            const city = cityFor(c.cityId, playerId);
            if (check(city, c)?.Success !== true) return false;
            const result = c.mode === "purchase"
                ? g.Game.CityCommands.sendRequest(c.cityId, g.CityCommandTypes.PURCHASE, args(c))
                : g.Game.CityOperations.sendRequest(c.cityId, g.CityOperationTypes.BUILD, args(c));
            if (result === false) throw new Error("The game rejected the building request; no automatic retry was sent.");
            return true;
        },
        moveToFront(c, playerId) {
            const city = cityFor(c.cityId, playerId);
            const index = queueIndex(city, c);
            if (index <= 0) return index === 0;
            const parameters = { InsertMode: g.CityOperationsParametersValues.MoveTo,
                QueueSourceLocation: index, QueueDestinationLocation: 0 };
            if (parameters.InsertMode == null) throw new Error("The production queue move operation is unavailable.");
            if (!g.Game.CityOperations.canStart(c.cityId, g.CityOperationTypes.BUILD, parameters, false)?.Success) return false;
            return g.Game.CityOperations.sendRequest(c.cityId, g.CityOperationTypes.BUILD, parameters) !== false;
        },
        complete(c, playerId) {
            const city = cityFor(c.cityId, playerId);
            if (queueIndex(city, c) !== 0 || city.isTown) return false;
            if (typeof city.BuildQueue.completeProduction !== "function") throw new Error("Instant production completion is unavailable.");
            city.BuildQueue.completeProduction();
            return true;
        },
        on: (event, callback) => g.engine.on(event, callback),
        off: (event, callback) => g.engine.off(event, callback),
    };
}

export class BuildingAutomationController {
    constructor(runtimeFactory, { schedule = setTimeout, unschedule = clearTimeout,
        now = () => Date.now(), render = () => {}, report = () => {} } = {}) {
        Object.assign(this, { runtimeFactory, schedule, unschedule, now, render, report });
        this.running = false;
        this.pending = null;
        this.timer = null;
        this.listeners = [];
        this.done = new Set();
        this.count = 0;
        this.message = "Buildings: ready";
        this.toggle = this.toggle.bind(this);
        this.refreshStatus = this.refreshStatus.bind(this);
    }
    refreshStatus() { this.render({ running: this.running, message: this.message }); }
    status(text) { this.message = `Buildings: ${text}`; this.refreshStatus(); }
    toggle() {
        if (this.running) this.finish(`Stopped; ${this.count} completed.${this.pending ? " The last purchase/build may still be pending or queued." : ""}`);
        else this.start();
    }
    start() {
        if (this.running) return;
        try {
            this.runtime ??= this.runtimeFactory();
            const id = this.runtime.localPlayerId();
            if (!Number.isInteger(id) || id < 0) throw new Error("No local player is active.");
            if (this.pending && id !== this.playerId) throw new Error("The previous player's build is still pending. Reload the UI to start for this player.");
            this.playerId = id;
            if (!this.pending) { this.done.clear(); this.count = 0; this.staleScans = 0; }
            this.running = true;
            const changed = () => this.queue(STEP_MS);
            for (const [event, listener] of [
                ["ConstructibleBuildCompleted", changed], ["ConstructibleAddedToMap", changed],
                ["ConstructibleChanged", changed], ["CityProductionQueueChanged", changed],
                ["LocalPlayerChanged", () => this.finish("Stopped because the local player changed.")],
            ]) { this.runtime.on(event, listener); this.listeners.push([event, listener]); }
            this.beginScan();
            this.status(this.pending ? "Resuming the pending build..." : "Checking local settlements...");
            this.queue(STEP_MS);
        } catch (error) { this.finish(`Stopped: ${error.message ?? error}`); }
    }
    beginScan() {
        this.cityIds = this.runtime.cityIds(this.playerId);
        this.scanIndex = 0;
        this.candidates = [];
        this.blocked = { funds: 0, placement: 0, protected: 0, production: 0 };
    }
    queue(delay) {
        if (!this.running || this.timer !== null) return;
        this.timer = this.schedule(() => { this.timer = null; this.step(); }, delay);
    }
    waitForPending() {
        if (this.now() - this.pending.sentAt >= TIMEOUT_MS) {
            this.finish(`Stopped after ${this.count}: the last ${this.pending.stage} was not confirmed. No duplicate request was sent.`);
        } else this.queue(POLL_MS);
    }
    processPending() {
        const p = this.pending;
        const state = this.runtime.state(p.candidate, this.playerId);
        if (state.complete) {
            this.done.add(itemKey(p.candidate));
            this.count++;
            this.staleScans = 0;
            this.pending = null;
            this.beginScan();
            this.queue(STEP_MS);
            return;
        }
        if (p.stage === "purchase" || p.stage === "completion") { this.waitForPending(); return; }
        if (state.queueIndex < 0 || (p.stage === "queue move" && state.queueIndex !== 0)) {
            this.waitForPending(); return;
        }
        if (state.queueIndex > 0) {
            p.stage = "queue move";
            p.sentAt = this.now();
            if (!this.runtime.moveToFront(p.candidate, this.playerId)) this.finish("Stopped: the building could not be moved to the front of its queue.");
            else this.queue(STEP_MS);
            return;
        }
        p.stage = "completion";
        p.sentAt = this.now();
        if (!this.runtime.complete(p.candidate, this.playerId)) this.finish("Stopped: the queue changed before the building could be completed.");
        else this.queue(STEP_MS);
    }
    step() {
        if (!this.running) return;
        try {
            if (this.runtime.localPlayerId() !== this.playerId) throw new Error("The local player changed.");
            if (this.pending) { this.processPending(); return; }
            // Spread empire-wide placement calculations over UI ticks so Stop
            // remains responsive even in a large empire.
            if (this.scanIndex < this.cityIds.length) {
                const snapshot = this.runtime.inspect(this.cityIds[this.scanIndex++], this.playerId, this.done);
                this.candidates.push(...snapshot.candidates);
                for (const key of Object.keys(this.blocked)) this.blocked[key] += snapshot.blocked[key];
                this.status(`Planning settlement ${this.scanIndex}/${this.cityIds.length}; ${this.count} completed.`);
                this.queue(STEP_MS);
                return;
            }
            const candidate = chooseBuilding(this.candidates);
            if (!candidate) {
                const reasons = [];
                if (this.blocked.funds) reasons.push("some purchases need more gold");
                if (this.blocked.placement) reasons.push("some items have no legal plot");
                if (this.blocked.protected) reasons.push("some plots are reserved or protected");
                if (this.blocked.production) reasons.push("instant production is unavailable in some cities");
                this.finish(`Finished ${this.count}; no further eligible building or wonder placements${reasons.length ? ` (${reasons.join("; ")})` : ""}.`);
                return;
            }
            this.pending = { candidate, stage: candidate.mode === "purchase" ? "purchase" : "queue submission", sentAt: this.now() };
            this.status(`${candidate.mode === "purchase" ? "Buying" : "Building"} ${candidate.name} in ${candidate.cityName}; ${this.count} completed.`);
            if (candidate.mode !== "existing" && !this.runtime.submit(candidate, this.playerId)) {
                // canStart rejected this placement, so no request was submitted.
                this.pending = null;
                if (++this.staleScans >= 3) {
                    this.finish("Stopped: placement availability kept changing. Run again to refresh the plan.");
                } else {
                    this.beginScan();
                    this.status("Availability changed; refreshing the placement plan...");
                    this.queue(STEP_MS);
                }
                return;
            }
            this.queue(STEP_MS);
        } catch (error) { this.finish(`Stopped: ${error.message ?? error}`); }
    }
    finish(message) {
        this.running = false;
        if (this.timer !== null) this.unschedule(this.timer);
        this.timer = null;
        for (const [event, callback] of this.listeners) this.runtime.off(event, callback);
        this.listeners = [];
        this.status(message);
        this.report(this.message);
    }
}

export const BuildingAutomation = new BuildingAutomationController(
    () => createGameBuildingRuntime({ Game, GameContext, GameInfo, Players, Cities, Constructibles,
        CityCommandTypes, CityOperationTypes, CityOperationsParametersValues, CityQueryType, OrderTypes,
        AdvisorySubjectTypes, YieldTypes, GameplayMap, Locale, engine }),
    {
        render({ running, message }) {
            const label = document.querySelector(".dev-panel-button__label--build-all-buildings");
            if (label) label.textContent = running ? "Stop building automation" : "Build all buildings + wonders";
            const status = document.querySelector(".dev-panel-status--buildings");
            if (status) status.textContent = message;
        },
        report: message => console.log(`[Izica buildings] ${message}`),
    },
);
