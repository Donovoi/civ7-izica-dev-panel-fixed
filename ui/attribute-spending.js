// Use the same purchase operation and node metadata as the stock attribute screen.
// No points are granted here: each run only spends the local player's legal points.
const POLL_MS = 100;
const STEP_MS = 25;
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
            return { branches, total: wildcard + branches.reduce((sum, branch) => sum + branch.points, 0) };
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
        this.runtimeFactory = runtimeFactory;
        this.schedule = schedule;
        this.unschedule = unschedule;
        this.now = now;
        this.render = render;
        this.report = report;
        this.running = false;
        this.pending = null;
        this.timer = null;
        this.listeners = [];
        this.message = "Attributes: ready";
        this.purchases = 0;
        this.toggle = this.toggle.bind(this);
        this.refreshStatus = this.refreshStatus.bind(this);
    }

    refreshStatus() {
        this.render({ running: this.running, message: this.message, purchases: this.purchases });
    }

    setStatus(message) {
        this.message = message;
        this.refreshStatus();
    }

    toggle() {
        if (this.running) {
            this.finish(`Stopped after ${this.purchases} purchases.${this.pending ? " One purchase is still pending." : ""}`);
        } else {
            this.start();
        }
    }

    confirmed(pending) {
        const current = this.runtime.progress(pending.playerId, pending.nodeId);
        return current.signature !== pending.signature || (!pending.complete && current.complete);
    }

    start() {
        if (this.running) return;
        try {
            this.runtime ??= this.runtimeFactory();
            const playerId = this.runtime.localPlayerId();
            if (!Number.isInteger(playerId) || playerId < 0) throw new Error("No local player is active.");
            // A timed-out/cancelled request must settle before another run can
            // submit the same repeatable purchase. Never retry an uncertain send.
            if (this.pending && (!this.confirmed(this.pending)
                || this.runtime.snapshot(this.pending.playerId).total >= this.pending.pointsBefore)) {
                this.setStatus("Attributes: previous purchase unconfirmed. Wait, or reload the UI before trying again.");
                return;
            }
            this.pending = null;
            this.playerId = playerId;
            this.runtime.prepare(playerId);
            this.focusedBranch = null;
            this.purchases = 0;
            this.running = true;
            const changed = (data) => {
                if (data?.player != null && data.player !== this.playerId) return;
                this.queue(STEP_MS);
            };
            const playerChanged = () => this.finish("Stopped because the local player changed.");
            for (const [event, listener] of [
                ["AttributePointsChanged", changed], ["AttributeNodeCompleted", changed],
                ["LocalPlayerChanged", playerChanged],
            ]) {
                this.runtime.on(event, listener);
                this.listeners.push([event, listener]);
            }
            this.setStatus("Attributes: checking available upgrades...");
            this.queue(STEP_MS);
        } catch (error) {
            this.finish(`Stopped: ${error.message ?? error}`);
        }
    }

    queue(delay) {
        if (!this.running || this.timer !== null) return;
        this.timer = this.schedule(() => {
            this.timer = null;
            this.step();
        }, delay);
    }

    step() {
        if (!this.running) return;
        try {
            if (this.runtime.localPlayerId() !== this.playerId) {
                this.finish("Stopped because the local player changed.");
                return;
            }
            let state;
            if (this.pending) {
                const nodeConfirmed = this.confirmed(this.pending);
                if (nodeConfirmed) state = this.runtime.snapshot(this.playerId);
                // Both node progress and a consumed point must be visible. This
                // also bounds a run if another mod makes repeatable nodes free.
                if (!nodeConfirmed || state.total >= this.pending.pointsBefore) {
                    if (this.now() - this.pending.sentAt >= REQUEST_TIMEOUT_MS) {
                        this.finish(`Stopped after ${this.purchases} purchases: the game did not confirm the last purchase. No retry was sent.`);
                    } else {
                        this.queue(POLL_MS);
                    }
                    return;
                }
                this.pending = null;
                this.purchases++;
            }
            state ??= this.runtime.snapshot(this.playerId);
            if (state.total === 0) {
                this.finish(`Done: ${this.purchases} purchases; no points left.`);
                return;
            }
            const candidate = chooseAttributePurchase(state.branches, this.focusedBranch,
                (id) => this.runtime.canBuy(this.playerId, id));
            if (!candidate) {
                this.finish(`Stopped: ${this.purchases} purchases; ${state.total} points left, but no legal upgrades are available.`);
                return;
            }
            const { branch, node, phase } = candidate;
            // Recheck immediately before sending; the player may also be using
            // the normal attribute screen while the automation runs.
            if (!this.runtime.canBuy(this.playerId, node.id)) {
                this.finish("Stopped: the selected upgrade is no longer available. Run again to recheck.");
                return;
            }
            this.focusedBranch = node.repeatable ? null : branch.id;
            this.pending = {
                playerId: this.playerId, nodeId: node.id, signature: node.signature,
                complete: node.complete, pointsBefore: state.total, sentAt: this.now(),
            };
            this.setStatus(`Attributes: ${phase} ${branch.name}; ${this.purchases} bought, ${state.total} points left.`);
            // Store pending before sendRequest: engine events can fire inline.
            const result = this.runtime.buy(this.playerId, node.id);
            if (result === false) {
                this.finish("Stopped: the game rejected the purchase request.");
                return;
            }
            this.queue(STEP_MS);
        } catch (error) {
            this.finish(`Stopped: ${error.message ?? error}`);
        }
    }

    finish(message) {
        this.running = false;
        if (this.timer !== null) this.unschedule(this.timer);
        this.timer = null;
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
