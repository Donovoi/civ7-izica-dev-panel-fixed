// Use the same purchase operation and node metadata as the stock attribute screen.
// No points are granted here: each run only spends the local player's legal points.
const POLL_MS = 100;
const STEP_MS = 0;
const MAX_IN_FLIGHT = 6;
const MAX_REQUESTS_PER_TICK = 32;
const WORK_BUDGET_MS = 4;
const REQUEST_TIMEOUT_MS = 8000;

function count(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new Error(`Invalid ${name} from the game.`);
    }
    return number;
}

function isTrue(value) {
    return value === true || value === 1 || value === "1" || value === "true";
}

export function createGameAttributeRuntime(game) {
    let catalog = [];
    const operation = game.PlayerOperationTypes.BUY_ATTRIBUTE_TREE_NODE;
    if (operation == null) {
        throw new Error("The attribute purchase operation is unavailable.");
    }
    const args = (nodeId) => ({ ProgressionTreeNodeType: nodeId });
    const progress = (playerId, nodeId) => {
        const node = game.Game.ProgressionTrees.getNode(playerId, nodeId);
        if (!node) {
            throw new Error("Attribute node data is unavailable.");
        }
        const depth = count(node.depthUnlocked, "unlocked depth");
        const repeated = count(node.repeatedDepth, "repeat depth");
        return {
            signature: `${depth}:${repeated}`,
            level: depth + repeated,
            complete: game.Game.ProgressionTrees.getNodeState(playerId, nodeId)
                === game.ProgressionTreeNodeState.NODE_STATE_FULLY_UNLOCKED,
        };
    };

    return {
        localPlayerId: () => game.GameContext.localPlayerID,
        prepare(playerId) {
            catalog = [];
            const seenTrees = new Set();
            for (const attribute of game.GameInfo.Attributes) {
                const tree = attribute.ProgressionTreeType;
                if (!tree || seenTrees.has(tree)) continue;
                seenTrees.add(tree);
                const structure = game.Game.ProgressionTrees.getTreeStructure(tree);
                if (!structure) throw new Error(`Attribute tree unavailable: ${tree}.`);
                const nodes = [];
                for (const entry of structure) {
                    const id = entry.nodeType;
                    if (!Number.isInteger(id)) throw new Error("Invalid attribute node ID.");
                    if (game.Game.ProgressionTrees.canEverUnlock(playerId, id).isLocked) continue;
                    const definition = game.GameInfo.ProgressionTreeNodes.lookup(id);
                    if (!definition) throw new Error(`Attribute definition unavailable: ${id}.`);
                    nodes.push({
                        id,
                        repeatable: isTrue(definition.Repeatable),
                        cost: count(definition.Cost ?? 1, "attribute node cost"),
                        treeDepth: Number(entry.treeDepth) || 0,
                    });
                }
                nodes.sort((a, b) => a.treeDepth - b.treeDepth || a.id - b.id);
                catalog.push({
                    id: attribute.AttributeType,
                    name: game.Locale.compose(attribute.Name),
                    nodes,
                });
            }
            if (!catalog.length) throw new Error("No attribute branches are available.");
        },
        snapshot(playerId) {
            const identity = game.Players.get(playerId)?.Identity;
            if (!identity) throw new Error("The local player's attributes are unavailable.");
            const wildcard = count(identity.getWildcardPoints(), "wildcard points");
            const branches = catalog.map((branch) => ({
                ...branch,
                points: count(identity.getAvailableAttributePoints(branch.id), "attribute points"),
                nodes: branch.nodes.map((node) => ({ ...node, ...progress(playerId, node.id) })),
            }));
            return { branches, wildcard, total: wildcard + branches.reduce((sum, branch) => sum + branch.points, 0) };
        },
        progress,
        canBuy: (playerId, nodeId) => game.Game.PlayerOperations.canStart(playerId, operation, args(nodeId), false)?.Success === true,
        buy: (playerId, nodeId) => game.Game.PlayerOperations.sendRequest(playerId, operation, args(nodeId)),
        on: (event, listener) => game.engine.on(event, listener),
        off: (event, listener) => game.engine.off(event, listener),
    };
}

// Stay on one unfinished branch while it has legal finite upgrades. Once none
// remain purchasable, use dedicated points first, then balance repeatable levels.
export function chooseAttributePurchase(branches, focusedBranch, canBuy) {
    const finiteBranches = [...branches].sort((a, b) =>
        Number(b.id === focusedBranch) - Number(a.id === focusedBranch));
    for (const branch of finiteBranches) {
        for (const node of branch.nodes) {
            if (!node.repeatable && !node.complete && canBuy(node.id)) {
                return { branch, node, phase: "Finishing" };
            }
        }
    }
    const repeats = branches.flatMap((branch, order) => {
        const branchLevel = branch.nodes.filter((node) => node.repeatable)
            .reduce((sum, node) => sum + node.level, 0);
        return branch.nodes.filter((node) => node.repeatable)
            .map((node) => ({ branch, node, order, branchLevel, phase: "Balancing" }));
    });
    repeats.sort((a, b) => Number(b.branch.points > 0) - Number(a.branch.points > 0)
        || a.branchLevel - b.branchLevel || a.order - b.order || a.node.level - b.node.level);
    return repeats.find((candidate) => canBuy(candidate.node.id)) ?? null;
}

export class AttributeSpendingController {
    constructor(runtimeFactory, { schedule = setTimeout, unschedule = clearTimeout,
        now = () => Date.now(), render = () => {}, report = () => {} } = {}) {
        Object.assign(this, { runtimeFactory, schedule, unschedule, now, render, report });
        this.running = false;
        this.pending = null;
        this.timer = null;
        this.timerDue = null;
        this.listeners = [];
        this.message = "Attributes: ready";
        this.purchases = 0;
        this.toggle = this.toggle.bind(this);
        this.refreshStatus = this.refreshStatus.bind(this);
    }

    refreshStatus() {
        this.render({ running: this.running, message: this.message, purchases: this.purchases });
    }
    setStatus(message) { this.message = message; this.refreshStatus(); }
    toggle() {
        if (this.running) {
            this.finish(`Stopped after ${this.purchases} purchases.${this.pending ? ` ${this.pending.requests.size} purchase request(s) still pending.` : ""}`);
        } else this.start();
    }

    confirmed(batch, state) {
        if (state.total > batch.pointsBefore - batch.totalCost) return false;
        return [...batch.requests.values()].every(request => {
            const current = this.runtime.progress(batch.playerId, request.nodeId);
            return current.level > request.level || (!request.complete && current.complete);
        });
    }

    start() {
        if (this.running) return;
        try {
            this.runtime ??= this.runtimeFactory();
            const playerId = this.runtime.localPlayerId();
            if (!Number.isInteger(playerId) || playerId < 0) throw new Error("No local player is active.");
            // A stopped/uncertain batch keeps all its node and point reservations.
            // Never send another request to those nodes before both settle.
            if (this.pending && (playerId !== this.pending.playerId
                || !this.confirmed(this.pending, this.runtime.snapshot(playerId)))) {
                this.setStatus("Attributes: previous purchase unconfirmed. Wait, or reload the UI before trying again.");
                return;
            }
            this.pending = null;
            this.playerId = playerId;
            this.runtime.prepare(playerId);
            this.focusedBranch = null;
            this.purchases = 0;
            this.running = true;
            const changed = data => {
                if (data?.player != null && data.player !== this.playerId) return;
                this.queue(STEP_MS);
            };
            for (const [event, listener] of [
                ["AttributePointsChanged", changed], ["AttributeNodeCompleted", changed],
                ["LocalPlayerChanged", () => this.finish("Stopped because the local player changed.")],
            ]) { this.runtime.on(event, listener); this.listeners.push([event, listener]); }
            this.setStatus("Attributes: checking available upgrades...");
            this.queue(STEP_MS);
        } catch (error) { this.finish(`Stopped: ${error.message ?? error}`); }
    }

    queue(delay) {
        if (!this.running) return;
        const due = this.now() + delay;
        if (this.timer !== null) {
            if (this.timerDue <= due) return;
            this.unschedule(this.timer);
        }
        this.timerDue = due;
        this.timer = this.schedule(() => {
            this.timer = null;
            this.timerDue = null;
            this.step();
        }, delay);
    }

    active() {
        if (!this.running) return false;
        if (this.runtime.localPlayerId() !== this.playerId) {
            this.finish("Stopped because the local player changed.");
            return false;
        }
        return true;
    }

    // Plan against a private budget: pending requests have not necessarily
    // changed native pools yet. Reserved points and levels must count now.
    makePlan(state) {
        const branches = state.branches.map(branch => ({ ...branch,
            nodes: branch.nodes.map(node => ({ ...node })) }));
        const dedicated = branches.reduce((sum, branch) => sum + branch.points, 0);
        const wildcard = count(state.wildcard ?? state.total - dedicated, "wildcard budget");
        const byNode = new Map(branches.flatMap(branch => branch.nodes.map(node => [node.id, { branch, node }])));
        return { branches, byNode, wildcard };
    }

    sendBatch(state, remaining, startedAt) {
        const plan = this.makePlan(state);
        const affordable = id => {
            const { branch, node } = plan.byNode.get(id);
            const cost = node.cost ?? 1;
            // Zero-cost/malformed mods must not produce an unbounded repeat loop.
            return Number.isFinite(cost) && cost > 0 && branch.points + plan.wildcard >= cost
                && this.runtime.canBuy(this.playerId, id);
        };
        let sent = 0;
        while (this.active() && sent < Math.min(MAX_IN_FLIGHT, remaining)) {
            if (sent > 0 && this.now() - startedAt >= WORK_BUDGET_MS) break;
            const candidate = chooseAttributePurchase(plan.branches, this.focusedBranch, affordable);
            if (!this.active()) break;
            if (!candidate) {
                if (!sent) this.finish(`Stopped: ${this.purchases} purchases; ${state.total} points left, but no legal upgrades are available.`);
                break;
            }
            const { branch, node, phase } = candidate;
            // Do not skip a busy lower-level/dedicated target to buy a higher
            // branch. Waiting here preserves the original balancing policy.
            if (this.pending?.requests.has(node.id)) break;
            if (sent && !node.repeatable) break;
            if (!this.runtime.canBuy(this.playerId, node.id)) {
                this.finish("Stopped: the selected upgrade is no longer available. Run again to recheck.");
                break;
            }
            if (!this.active()) break;
            const cost = node.cost ?? 1;
            const own = Math.min(branch.points, cost);
            branch.points -= own;
            plan.wildcard -= cost - own;
            this.focusedBranch = node.repeatable ? null : branch.id;
            this.pending ??= { playerId: this.playerId, pointsBefore: state.total,
                totalCost: 0, requests: new Map(), sentAt: this.now() };
            const batch = this.pending;
            // Store before dispatch because engine callbacks can fire inline.
            batch.requests.set(node.id, { nodeId: node.id, level: node.level,
                signature: node.signature, complete: node.complete, cost });
            batch.totalCost += cost;
            const result = this.runtime.buy(this.playerId, node.id);
            if (result === false) {
                batch.requests.delete(node.id);
                batch.totalCost -= cost;
                if (!batch.requests.size) this.pending = null;
                this.finish("Stopped: the game rejected the purchase request.");
                break;
            }
            sent++;
            node.level++;
            this.phaseLabel = `${phase} ${branch.name}`;
            // Finite nodes may unlock dependent nodes, so confirm each one.
            if (!node.repeatable) break;
        }
        return sent;
    }

    step() {
        if (!this.active()) return;
        const startedAt = this.now();
        let sent = 0;
        try {
            while (this.active()) {
                const state = this.runtime.snapshot(this.playerId);
                if (!this.active()) return;
                if (this.pending) {
                    if (!this.confirmed(this.pending, state)) {
                        if (this.now() - this.pending.sentAt >= REQUEST_TIMEOUT_MS) {
                            this.finish(`Stopped after ${this.purchases} purchases: the game did not confirm the last purchase batch. No retry was sent.`);
                        } else {
                            this.setStatus(`Attributes: ${this.phaseLabel ?? "Confirming upgrades"}; ${this.purchases} bought, ${state.total} points left, ${this.pending.requests.size} pending.`);
                            this.queue(POLL_MS);
                        }
                        return;
                    }
                    this.purchases += this.pending.requests.size;
                    this.pending = null;
                }
                if (state.total === 0) {
                    this.finish(`Done: ${this.purchases} purchases; no points left.`);
                    return;
                }
                if (sent >= MAX_REQUESTS_PER_TICK || (sent > 0 && this.now() - startedAt >= WORK_BUDGET_MS)) {
                    this.setStatus(`Attributes: ${this.phaseLabel ?? "Spending"}; ${this.purchases} bought, ${state.total} points left.`);
                    this.queue(STEP_MS);
                    return;
                }
                sent += this.sendBatch(state, MAX_REQUESTS_PER_TICK - sent, startedAt);
                // Inline confirmations can continue within the same bounded
                // tick; async batches yield until an event or fallback poll.
            }
        } catch (error) { this.finish(`Stopped: ${error.message ?? error}`); }
    }

    finish(message) {
        this.running = false;
        if (this.timer !== null) this.unschedule(this.timer);
        this.timer = null;
        this.timerDue = null;
        for (const [event, listener] of this.listeners) this.runtime.off(event, listener);
        this.listeners = [];
        this.setStatus(`Attributes: ${message}`);
        this.report(this.message);
    }
}

export const AttributeSpending = new AttributeSpendingController(
    () => createGameAttributeRuntime({ Game, GameContext, GameInfo, Players, PlayerOperationTypes,
        ProgressionTreeNodeState, Locale, engine }),
    {
        render({ running, message }) {
            const label = document.querySelector(".dev-panel-button__label--spend-all-attribute-points");
            if (label) label.textContent = running ? "Stop spending attribute points" : "Spend all attribute points";
            const status = document.querySelector(".dev-panel-status--attributes");
            if (status) status.textContent = message;
        },
        report: (message) => console.log(`[Izica attributes] ${message}`),
    },
);
