import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AttributeSpendingController, createGameAttributeRuntime, AttributeSpending } from '../ui/attribute-spending.js';

// Offline native-API simulator. Tree rows/prerequisites come from this machine's
// installed Civ VII XML; request timing and native responses are simulated.
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/civ7-attribute-fixture.json', import.meta.url)));
const attributes = fixture.attributes.filter(a => a.ProgressionTreeType);
const reports = [];
class Clock {
    time = 0;
    sequence = 0;
    tasks = new Map();
    currentTask = null;
    executed = 0;
    schedule = (fn, delay) => {
        const id = ++this.sequence;
        this.tasks.set(id, { fn, due: this.time + delay });
        return id;
    };
    unschedule = id => this.tasks.delete(id);
    next() {
        const next = [...this.tasks.entries()].sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!next) return false;
        this.tasks.delete(next[0]);
        this.time = Math.max(this.time, next[1].due);
        this.currentTask = next[0]; this.executed++;
        try { next[1].fn(); } finally { this.currentTask = null; }
        return true;
    }
    drain(limit = 25000) {
        let steps = 0;
        while (this.next()) assert(++steps < limit, 'run did not terminate');
    }
    advance(ms) {
        const until = this.time + ms;
        while ([...this.tasks.values()].some(t => t.due <= until)) this.next();
        this.time = until;
    }
}

function setup(options = {}) {
    const clock = new Clock();
    let wildcard = options.wildcard ?? 0;
    const dedicated = attributes.map((_, i) => options.dedicated?.[i] ?? 0);
    const listeners = new Map();
    const history = [];
    const confirmationHistory = [];
    const pendingNative = new Map();
    const pendingCostByBranch = attributes.map(() => 0);
    let attempts = 0;
    const traits = options.traits ?? ['TRAIT_LEADER_AUGUSTUS_ABILITY'];
    const states = new Map();
    const types = new Map();
    for (const [i, def] of fixture.nodes.entries()) {
        const id = 1000 + i;
        const branch = attributes.findIndex(a => a.ProgressionTreeType === def.ProgressionTree);
        const requirements = fixture.unlocks.filter(u => u.ProgressionTreeNodeType === def.ProgressionTreeNodeType && u.RequiredTraitType);
        const eligible = !requirements.length || requirements.some(u => traits.includes(u.RequiredTraitType));
        const repeatable = def.Repeatable === 'true';
        const node = { id, def: { ...def }, branch, eligible, repeatable, maxDepth: 1,
            depthUnlocked: options.finished && !repeatable ? 1 : 0,
            repeatedDepth: repeatable ? options.levels?.[branch] ?? 0 : 0 };
        states.set(id, node);
        types.set(def.ProgressionTreeNodeType, node);
    }
    for (const type of options.precompleted ?? []) types.get(type).depthUnlocked = 1;
    const events = (event, player = game.GameContext.localPlayerID) => {
        if (options.silentEvents) return;
        for (const fn of [...(listeners.get(event) ?? [])]) fn({ player });
    };
    const prereqs = node => fixture.prereqs.filter(p => p.Node === node.def.ProgressionTreeNodeType).map(p => types.get(p.PrereqNode));
    const unlocked = node => !prereqs(node).length || prereqs(node).some(p => p.depthUnlocked + p.repeatedDepth > 0);
    const canBuy = node => node.eligible && !options.blockAll
        && !options.blocked?.includes(node.def.ProgressionTreeNodeType)
        && (node.repeatable || node.depthUnlocked < node.maxDepth) && unlocked(node)
        && dedicated[node.branch] + wildcard >= Number(node.def.Cost);
    const total = () => wildcard + dedicated.reduce((a, b) => a + b, 0);
    let inflight = 0;
    let maxInflight = 0;
    const game = {
        GameContext: { localPlayerID: 0 },
        PlayerOperationTypes: { BUY_ATTRIBUTE_TREE_NODE: 'BUY_ATTRIBUTE_TREE_NODE' },
        ProgressionTreeNodeState: { NODE_STATE_FULLY_UNLOCKED: 3 },
        Locale: { compose: s => s },
        GameInfo: {
            Attributes: fixture.attributes,
            ProgressionTreeNodes: { lookup: id => states.get(id)?.def },
        },
        Players: { get: id => id === 0 ? { Identity: {
            getWildcardPoints: () => { clock.time += options.snapshotWorkMs ?? 0; return wildcard; },
            getAvailableAttributePoints: type => dedicated[attributes.findIndex(a => a.AttributeType === type)],
        } } : null },
        engine: {
            on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
            off(event, fn) { listeners.get(event)?.delete(fn); },
        },
        Game: {
            ProgressionTrees: {
                getTreeStructure: tree => [...states.values()].filter(n => n.def.ProgressionTree === tree)
                    .map(n => ({ nodeType: n.id, treeDepth: prereqs(n).length ? 1 : 0 })),
                canEverUnlock: (player, id) => ({ isLocked: !states.get(id).eligible }),
                getNode: (player, id) => states.get(id),
                getNodeState: (player, id) => {
                    const n = states.get(id);
                    return !n.repeatable && n.depthUnlocked >= n.maxDepth ? 3 : unlocked(n) ? 1 : 0;
                },
            },
            PlayerOperations: {
                canStart(player, operation, args, testVisible) {
                    assert.equal(player, 0);
                    assert.equal(operation, 'BUY_ATTRIBUTE_TREE_NODE');
                    assert.equal(testVisible, false);
                    assert.deepEqual(Object.keys(args), ['ProgressionTreeNodeType']);
                    assert(Number.isInteger(args.ProgressionTreeNodeType));
                    return { Success: canBuy(states.get(args.ProgressionTreeNodeType)) };
                },
                sendRequest(player, operation, args) {
                    assert.equal(player, 0);
                    assert.equal(operation, 'BUY_ATTRIBUTE_TREE_NODE');
                    const node = states.get(args.ProgressionTreeNodeType);
                    assert(canBuy(node), 'sent an illegal purchase');
                    attempts++;
                    if (options.reject || options.rejectAt === attempts) return false;
                    assert(!pendingNative.has(node.id), 'a node was requested again before its previous node and point updates both confirmed');
                    const cost = Number(node.def.Cost);
                    pendingCostByBranch[node.branch] += cost;
                    assert(pendingCostByBranch.reduce((sum, owed, branch) => sum + Math.max(0, owed - dedicated[branch]), 0) <= wildcard,
                        'accepted purchases over-reserved shared wildcard or dedicated points');
                    const pending = { nodeDone: false, pointDone: false, cost };
                    pendingNative.set(node.id, pending);
                    const settle = () => {
                        if (pending.nodeDone && pending.pointDone) { pendingNative.delete(node.id); inflight--; }
                    };
                    history.push({ id: node.id, type: node.def.ProgressionTreeNodeType,
                        repeatable: node.repeatable, branch: node.branch, total: total(),
                        at: clock.time, pump: clock.currentTask,
                        unfinished: [...states.values()].filter(n => n.eligible && !n.repeatable && n.depthUnlocked < n.maxDepth).length });
                    inflight++;
                    maxInflight = Math.max(maxInflight, inflight);
                    if (options.drop || options.dropNodes?.includes(node.def.ProgressionTreeNodeType)) return;
                    const apply = () => {
                        if (!options.noNodeProgress && !options.noNodeProgressNodes?.includes(node.def.ProgressionTreeNodeType)) {
                            if (node.repeatable) node.repeatedDepth++;
                            else node.depthUnlocked++;
                            pending.nodeDone = true;
                            confirmationHistory.push({ kind: 'node', id: node.id, at: clock.time });
                        }
                        events('AttributeNodeCompleted', 0);
                        const deduct = () => {
                            if (!options.free && !options.freeNodes?.includes(node.def.ProgressionTreeNodeType)) {
                                const own = Math.min(cost, dedicated[node.branch]);
                                dedicated[node.branch] -= own;
                                wildcard -= cost - own;
                                assert(wildcard >= 0 && dedicated.every(points => points >= 0), 'native point pools became negative');
                                pendingCostByBranch[node.branch] -= cost;
                                pending.pointDone = true;
                                confirmationHistory.push({ kind: 'points', id: node.id, at: clock.time });
                            }
                            settle();
                            events('AttributePointsChanged', 0);
                        };
                        const pointDelay = typeof options.pointDelay === 'function' ? options.pointDelay(node, history.length) : options.pointDelay;
                        if (pointDelay) clock.schedule(deduct, pointDelay);
                        else deduct();
                    };
                    const delay = typeof options.delay === 'function' ? options.delay(node, history.length) : options.delay;
                    if (delay === 0) apply();
                    else clock.schedule(apply, delay ?? 10);
                    if (options.throwAfterAccept || options.throwAfterAcceptAt === attempts) throw new Error('simulated send error after acceptance');
                },
            },
        },
    };
    const status = [];
    const controller = new AttributeSpendingController(() => createGameAttributeRuntime(game), {
        schedule: clock.schedule, unschedule: clock.unschedule, now: () => { clock.time += options.nowStep ?? 0; return clock.time; },
        render: state => status.push({ ...state }),
    });
    return { game, clock, controller, history, states, types, events, total, dedicated, status, confirmationHistory, pendingNative,
        levels: () => [...states.values()].filter(n => n.repeatable).map(n => n.depthUnlocked + n.repeatedDepth),
        listeners: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
        maxInflight: () => maxInflight, attempts: () => attempts, wildcard: () => wildcard,
        maxRequestsPerPump: () => { const counts = new Map(); for (const item of history) counts.set(item.pump, (counts.get(item.pump) ?? 0) + 1); return Math.max(0, ...counts.values()); } };
}

function run(name, body) {
    try { const details = body(); reports.push({ name, passed: true, ...details }); }
    catch (error) { reports.push({ name, passed: false, error: error.stack }); }
}
function complete(sim) {
    sim.controller.start();
    sim.clock.drain();
    assert.equal(sim.controller.running, false);
    assert.equal(sim.listeners(), 0);
    assert.equal(sim.clock.tasks.size, 0);
    assert(sim.maxInflight() <= 6, 'more than six independent nodes were in flight');
    assert(sim.maxRequestsPerPump() <= 32, 'a single UI pump submitted more than 32 requests');
}

run('1000 wildcard points: complete all finite nodes before balanced repeats', () => {
    const s = setup({ wildcard: 1000 }); complete(s);
    assert.equal(s.total(), 0); assert.equal(s.history.length, 1000);
    assert.equal(s.controller.purchases, 1000);
    assert(s.history.filter(h => h.repeatable).every(h => h.unfinished === 0));
    const finite = s.history.filter(h => !h.repeatable);
    const groups = finite.map(h => h.branch).filter((b, i, all) => i === 0 || b !== all[i - 1]);
    assert.deepEqual(groups, [0, 1, 2, 3, 4, 5]);
    assert(Math.max(...s.levels()) - Math.min(...s.levels()) <= 1);
    assert(!s.history.some(h => !s.states.get(h.id).eligible));
    return { purchases: 1000, finiteNodes: finite.length, finalRepeatLevels: s.levels() };
});
run('Remaining points catch up existing repeatable level imbalance', () => {
    const s = setup({ wildcard: 55, finished: true, levels: [9, 0, 3, 6, 0, 0] }); complete(s);
    assert.equal(s.total(), 0);
    assert(Math.max(...s.levels()) - Math.min(...s.levels()) <= 1);
    assert.equal(s.history[0].branch, 1);
    return { finalRepeatLevels: s.levels() };
});
run('Dedicated repeatable points are spent before wildcard balancing', () => {
    const s = setup({ wildcard: 40, dedicated: [8, 0, 0, 0, 0, 0], finished: true }); complete(s);
    assert(s.history.slice(0, 8).every(h => h.branch === 0));
    assert.deepEqual(s.levels(), [8, 8, 8, 8, 8, 8]); assert.equal(s.total(), 0);
});
run('All six dedicated pools empty even when equality is impossible', () => {
    const s = setup({ dedicated: [1, 4, 7, 2, 20, 3], finished: true }); complete(s);
    assert.equal(s.total(), 0); assert.deepEqual(s.levels(), [1, 4, 7, 2, 20, 3]);
});
run('Scarce points finish the current branch before moving to another', () => {
    const s = setup({ wildcard: 4, precompleted: ['NODE_ATTRIBUTE_CULTURAL_01'] }); complete(s);
    assert.equal(s.history.length, 4); assert(s.history.every(h => h.branch === 0 && !h.repeatable));
});
run('A reachable repeatable cap never preempts unfinished side upgrades', () => {
    const s = setup({ wildcard: 100, precompleted: ['NODE_ATTRIBUTE_CULTURAL_01', 'NODE_ATTRIBUTE_CULTURAL_02', 'NODE_ATTRIBUTE_CULTURAL_04', 'NODE_ATTRIBUTE_CULTURAL_07'] });
    complete(s); assert(s.history.filter(h => h.repeatable).every(h => h.unfinished === 0));
});
run('Leader-ineligible nodes are excluded and eligible legends are purchased', () => {
    const s = setup({ wildcard: 100 }); complete(s);
    assert(s.history.some(h => h.type.includes('LEGEND_AUGUSTUS')));
    assert(!s.history.some(h => h.type.includes('LEGEND_CATHERINE')));
});
run('Profile-locked legend upgrades do not block other legal spending', () => {
    const blocked = fixture.nodes.filter(n => n.ProgressionTreeNodeType.includes('LEGEND_AUGUSTUS')).map(n => n.ProgressionTreeNodeType);
    const s = setup({ wildcard: 100, blocked }); complete(s);
    assert.equal(s.total(), 0); assert(!s.history.some(h => blocked.includes(h.type)));
});
run('Zero points terminates with no native purchase', () => {
    const s = setup(); complete(s); assert.equal(s.history.length, 0); assert.match(s.controller.message, /no points left/);
});
run('Points with no legal node terminate honestly with a remainder', () => {
    const s = setup({ wildcard: 3, blockAll: true }); complete(s);
    assert.equal(s.history.length, 0); assert.match(s.controller.message, /3 points left, but no legal/);
});
run('Delayed requests and lost engine events use polling without duplicate sends', () => {
    const s = setup({ wildcard: 4, delay: 650 });
    s.game.engine.on = () => {}; s.game.engine.off = () => {};
    complete(s); assert.equal(s.total(), 0); assert.equal(s.history.length, 4);
});
run('Inline completion events cannot recurse or double-purchase', () => {
    const s = setup({ wildcard: 75, delay: 0 }); complete(s);
    assert.equal(s.total(), 0); assert.equal(s.history.length, 75);
});
run('Point and node updates arriving separately are both awaited', () => {
    const s = setup({ wildcard: 3, delay: 10, pointDelay: 600 }); complete(s);
    assert.equal(s.history.length, 3); assert.equal(s.total(), 0);
});
run('Timeout is bounded and an unconfirmed request cannot be resubmitted', () => {
    const s = setup({ wildcard: 4, drop: true }); complete(s);
    assert.equal(s.history.length, 1); assert(s.clock.time <= 8200);
    assert.match(s.controller.message, /did not confirm/);
    s.controller.start(); s.clock.drain();
    assert.equal(s.history.length, 1); assert.match(s.controller.message, /previous purchase unconfirmed/);
});
run('Cancellation before the first step sends nothing', () => {
    const s = setup({ wildcard: 5 }); s.controller.toggle(); s.controller.toggle(); s.clock.drain();
    assert.equal(s.history.length, 0); assert.equal(s.listeners(), 0);
});
run('Cancellation in flight waits for the old request before restart', () => {
    const s = setup({ wildcard: 3, delay: 500 }); s.controller.start(); s.clock.next();
    s.controller.toggle(); s.controller.start(); assert.equal(s.history.length, 1);
    assert.equal(s.controller.running, false); assert.equal(s.listeners(), 0);
    s.clock.drain(); assert.equal(s.total(), 2);
    complete(s); assert.equal(s.total(), 0); assert.equal(s.history.length, 3);
});
run('Local-player change stops all further requests and cleans up listeners', () => {
    const s = setup({ wildcard: 4, delay: 500 }); s.controller.start(); s.clock.next();
    s.game.GameContext.localPlayerID = 1; s.events('LocalPlayerChanged', 1); s.clock.drain();
    assert.equal(s.history.length, 1); assert.equal(s.controller.running, false); assert.equal(s.listeners(), 0);
});
run('Restart cannot overtake a cancelled request with a delayed point deduction', () => {
    const s = setup({ wildcard: 3, delay: 0, pointDelay: 600 });
    s.controller.start(); s.clock.next();
    s.controller.toggle(); s.controller.start();
    assert.equal(s.history.length, 1); assert.equal(s.controller.running, false);
    assert.match(s.controller.message, /previous purchase unconfirmed/);
    s.clock.drain(); complete(s); assert.equal(s.history.length, 3); assert.equal(s.total(), 0);
});
run('A purchase becoming illegal at the final recheck is not sent', () => {
    const s = setup({ wildcard: 3 });
    const original = s.game.Game.PlayerOperations.canStart;
    let first = true;
    s.game.Game.PlayerOperations.canStart = (...args) => {
        const result = original(...args);
        if (result.Success && first) { first = false; return result; }
        return { Success: false };
    };
    complete(s); assert.equal(s.history.length, 0); assert.match(s.controller.message, /no longer available/);
});
run('An explicit false Repeatable database field remains a finite node', () => {
    const s = setup({ wildcard: 4 });
    for (const node of s.states.values()) if (!node.repeatable) node.def.Repeatable = 'false';
    complete(s); assert.equal(s.history.length, 4); assert(s.history.every(h => !h.repeatable));
});
run('Polling detects player changes even without the engine event', () => {
    const s = setup({ wildcard: 4 }); s.controller.start(); s.game.GameContext.localPlayerID = 1; s.clock.drain();
    assert.equal(s.history.length, 0); assert.match(s.controller.message, /local player changed/);
});
run('Native rejection stops instead of looping', () => {
    const s = setup({ wildcard: 4, reject: true }); complete(s);
    assert.equal(s.history.length, 0); assert.match(s.controller.message, /rejected/);
});
run('Ambiguous native send exception is not retried', () => {
    const s = setup({ wildcard: 4, throwAfterAccept: true, delay: 500 }); s.controller.start(); s.clock.next();
    assert.equal(s.controller.running, false); s.controller.start(); assert.equal(s.history.length, 1);
    s.clock.drain(); assert.equal(s.history.length, 1);
});
run('A spent point without the requested node progress cannot confirm', () => {
    const s = setup({ wildcard: 3, noNodeProgress: true }); complete(s);
    assert.equal(s.history.length, 1); assert.equal(s.controller.purchases, 0); assert.match(s.controller.message, /did not confirm/);
});
run('A free repeatable upgrade is bounded rather than looping forever', () => {
    const s = setup({ wildcard: 3, finished: true, free: true }); complete(s);
    assert(s.history.length >= 1 && s.history.length <= 3); assert.equal(new Set(s.history.map(h => h.id)).size, s.history.length);
    assert.equal(s.controller.purchases, 0); assert.match(s.controller.message, /did not confirm/);
});
run('Unavailable API and invalid point data surface visible failures', () => {
    const s = setup({ wildcard: 5 }); delete s.game.PlayerOperationTypes.BUY_ATTRIBUTE_TREE_NODE;
    complete(s); assert.equal(s.history.length, 0); assert.match(s.controller.message, /unavailable/);
    const bad = setup({ wildcard: NaN }); complete(bad); assert.equal(bad.history.length, 0); assert.match(bad.controller.message, /Invalid wildcard/);
});
run('Fresh runs reset counters and duplicate starts do not add listeners', () => {
    const s = setup({ wildcard: 2 }); s.controller.start(); s.controller.start(); assert.equal(s.listeners(), 3);
    s.clock.drain(); assert.equal(s.controller.purchases, 2);
    complete(s); assert.equal(s.controller.purchases, 0); assert.equal(s.history.length, 2);
});
run('Multi-depth finite nodes are completed before repeatable spending', () => {
    const s = setup({ wildcard: 100 }); s.types.get('NODE_ATTRIBUTE_CULTURAL_01').maxDepth = 3;
    complete(s); assert.equal(s.history.filter(h => h.type === 'NODE_ATTRIBUTE_CULTURAL_01').length, 3);
    assert(s.history.filter(h => h.repeatable).every(h => h.unfinished === 0));
});
run('6000 wildcard points preserve finite branch order and finish balanced repeats promptly', () => {
    const s = setup({ wildcard: 6000, delay: 40 }); complete(s);
    assert.equal(s.total(), 0); assert.equal(s.controller.purchases, 6000); assert.equal(s.history.length, 6000);
    assert(s.history.filter(h => h.repeatable).every(h => h.unfinished === 0));
    const finiteBranches = s.history.filter(h => !h.repeatable).map(h => h.branch).filter((branch,index,all) => index === 0 || branch !== all[index-1]);
    assert.deepEqual(finiteBranches, [0,1,2,3,4,5]); assert(Math.max(...s.levels()) - Math.min(...s.levels()) <= 1);
    assert.equal(s.maxInflight(), 6); assert(s.clock.time <= 60000, '6000-point simulator run still pays a serial poll delay per point');
    return { purchases: 6000, simulatedGameConfirmationMs: 40, simulatedElapsedMs: s.clock.time, maxInflight: s.maxInflight(), finalRepeatLevels: s.levels() };
});
run('6000 dedicated points use all six independent repeatables without overspending any pool', () => {
    const s = setup({ dedicated: [1000,1000,1000,1000,1000,1000], finished: true, delay: 40 }); complete(s);
    assert.equal(s.total(), 0); assert.equal(s.wildcard(), 0); assert.equal(s.controller.purchases, 6000); assert.deepEqual(s.levels(), [1000,1000,1000,1000,1000,1000]);
    assert.equal(s.maxInflight(), 6); assert(s.clock.time <= 50000);
    return { purchases: 6000, simulatedGameConfirmationMs: 40, simulatedElapsedMs: s.clock.time, maxInflight: s.maxInflight() };
});
run('Inline 6000-point spending yields after at most 32 new requests in each UI pump', () => {
    const s = setup({ wildcard: 6000, finished: true, delay: 0 }); complete(s);
    assert.equal(s.total(), 0); assert.equal(s.controller.purchases, 6000); assert(s.maxRequestsPerPump() > 6, 'inline confirmations still incur one task per tiny batch');
    assert(s.maxRequestsPerPump() <= 32); assert(s.clock.executed >= Math.ceil(6000/32));
    return { purchases: 6000, maxRequestsPerPump: s.maxRequestsPerPump(), scheduledTasks: s.clock.executed };
});
run('The UI time budget yields early when native checks consume the current task budget', () => {
    const s = setup({ wildcard: 120, finished: true, delay: 0, nowStep: 1 }); complete(s);
    assert.equal(s.total(), 0); assert.equal(s.controller.purchases, 120); assert(s.maxRequestsPerPump() < 32, 'elapsed work budget was ignored');
    assert(s.clock.executed > Math.ceil(120/32));
    return { maxRequestsPerPump: s.maxRequestsPerPump(), scheduledTasks: s.clock.executed };
});
run('A snapshot taking longer than the UI work budget still permits bounded forward progress', () => {
    const s = setup({ wildcard: 18, finished: true, delay: 0, snapshotWorkMs: 6 }); complete(s);
    assert.equal(s.history.length, 18); assert.equal(s.controller.purchases, 18); assert.equal(s.total(), 0);
    assert.equal(s.maxRequestsPerPump(), 1); assert(s.clock.executed >= 18);
});
run('Attribute events preempt a slow fallback poll for the next independent batch', () => {
    const s = setup({ wildcard: 12, finished: true, delay: 40 }); complete(s);
    assert.equal(s.history.length, 12); assert.equal(s.maxInflight(), 6);
    assert(s.history[6].at - s.history[0].at <= 50, 'ready events remained behind the 100ms fallback poll');
});
run('Lost events still confirm six pending nodes by polling without duplicate requests', () => {
    const s = setup({ wildcard: 18, finished: true, delay: 250, silentEvents: true }); complete(s);
    assert.equal(s.total(), 0); assert.equal(s.controller.purchases, 18); assert.equal(s.maxInflight(), 6);
});
run('Pending purchases reserve scarce dedicated and shared wildcard points before dispatch', () => {
    const s = setup({ wildcard: 1, dedicated: [1,0,0,0,0,0], finished: true, delay: 0, pointDelay: 500 });
    s.controller.start(); s.clock.next(); assert.equal(s.history.length, 2); assert.equal(s.total(), 2); assert.equal(s.controller.purchases, 0);
    s.clock.advance(400); assert.equal(s.history.length, 2); assert.equal(s.controller.purchases, 0);
    s.clock.drain(); assert.equal(s.total(), 0); assert.equal(s.history.length, 2); assert.equal(s.controller.purchases, 2); assert.equal(s.listeners(), 0);
});
run('Different node and pool update times require proof for the entire reserved batch', () => {
    const s = setup({ wildcard: 12, finished: true, delay: 0, pointDelay: node => node.branch === 0 ? 500 : 100 });
    s.controller.start(); s.clock.next(); assert.equal(s.history.length, 6); s.clock.advance(400);
    assert.equal(s.history.length, 6); assert.equal(s.controller.purchases, 0); assert.equal(s.total(), 7);
    s.clock.drain(); assert.equal(s.total(), 0); assert.equal(s.history.length, 12); assert.equal(s.controller.purchases, 12); assert.equal(s.maxInflight(), 6);
});
run('Multi-point node costs reserve the actual shared budget and require the full cost debit', () => {
    const s = setup({ wildcard: 11, dedicated: [1,0,0,0,0,0], finished: true, delay: 0,
        pointDelay: node => node.branch < 3 ? 100 : 500 });
    for (const node of s.states.values()) if (node.repeatable) node.def.Cost = '2';
    s.controller.start(); s.clock.next(); assert.equal(s.history.length, 6); s.clock.advance(200);
    assert.equal(s.total(), 6); assert.equal(s.controller.purchases, 0); assert.equal(s.history.length, 6);
    s.clock.drain(); assert.equal(s.total(), 0); assert.equal(s.controller.purchases, 6); assert.equal(s.history.length, 6);
    assert(s.dedicated.every(points => points === 0)); assert.equal(s.wildcard(), 0); assert.equal(s.maxInflight(), 6); assert.equal(s.listeners(), 0);
});
run('Out-of-order confirmations preserve virtual balancing and never skip ahead of a busy low branch', () => {
    const s = setup({ wildcard: 60, finished: true, levels: [10,0,0,0,0,0], delay: node => node.branch === 1 ? 500 : 40 });
    s.controller.start(); s.clock.advance(200); assert(s.history.length >= 2); assert(s.history.every(item => item.branch !== 0));
    s.clock.drain(); assert.equal(s.total(), 0); assert(Math.max(...s.levels()) - Math.min(...s.levels()) <= 1); assert(s.maxInflight() <= 6);
});
run('A shared point debit cannot confirm a free node in an otherwise successful batch', () => {
    const options = { wildcard: 6, finished: true, freeNodes: [] }; const s = setup(options);
    options.freeNodes.push([...s.states.values()].find(node => node.repeatable && node.branch === 0).def.ProgressionTreeNodeType);
    complete(s); assert.equal(s.history.length, 6); assert.equal(s.total(), 1); assert.equal(s.controller.purchases, 0); assert.match(s.controller.message, /did not confirm/);
    s.controller.start(); s.clock.drain(); assert.equal(s.history.length, 6); assert.equal(s.controller.running, false);
});
run('Other nodes completing cannot confirm one node that spent its point without progressing', () => {
    const options = { wildcard: 6, finished: true, noNodeProgressNodes: [] }; const s = setup(options);
    options.noNodeProgressNodes.push([...s.states.values()].find(node => node.repeatable && node.branch === 0).def.ProgressionTreeNodeType);
    complete(s); assert.equal(s.history.length, 6); assert.equal(s.total(), 0); assert.equal(s.controller.purchases, 0); assert.match(s.controller.message, /did not confirm/);
    s.controller.start(); s.clock.drain(); assert.equal(s.history.length, 6); assert.equal(s.controller.running, false);
});
run('Stopping and resuming six pending requests never overtakes their partial confirmations', () => {
    const s = setup({ wildcard: 12, finished: true, delay: node => node.branch === 5 ? 600 : 40 });
    s.controller.start(); s.clock.next(); assert.equal(s.history.length, 6); s.clock.advance(100); s.controller.toggle(); s.controller.start();
    assert.equal(s.controller.running, false); assert.equal(s.history.length, 6); assert.equal(s.listeners(), 0);
    s.clock.drain(); assert.equal(s.total(), 6); complete(s); assert.equal(s.total(), 0); assert.equal(s.history.length, 12);
});
run('A partial batch rejection preserves accepted requests and permits a later explicit restart', () => {
    const s = setup({ wildcard: 12, finished: true, delay: 500, rejectAt: 4 }); s.controller.start(); s.clock.next();
    assert.equal(s.controller.running, false); assert.equal(s.history.length, 3); assert.match(s.controller.message, /rejected/);
    s.controller.start(); assert.equal(s.controller.running, false); assert.equal(s.history.length, 3);
    s.clock.drain(); assert.equal(s.total(), 9); assert.equal(s.history.length, 3);
    complete(s); assert.equal(s.total(), 0); assert.equal(s.history.length, 12); assert.equal(s.controller.purchases, 9);
});
run('An exception after partial batch acceptance cannot resubmit its uncertain node', () => {
    const s = setup({ wildcard: 12, finished: true, delay: 500, throwAfterAcceptAt: 3 }); s.controller.start(); s.clock.next();
    assert.equal(s.controller.running, false); assert.equal(s.history.length, 3);
    s.controller.start(); assert.equal(s.controller.running, false); assert.equal(s.history.length, 3);
    s.clock.drain(); assert.equal(s.total(), 9); assert.equal(s.history.length, 3);
    complete(s); assert.equal(s.total(), 0); assert.equal(s.history.length, 12); assert.equal(s.controller.purchases, 9);
});
run('A local-player change stops an independent batch without submitting follow-up purchases', () => {
    const s = setup({ wildcard: 12, finished: true, delay: 500 }); s.controller.start(); s.clock.next(); assert.equal(s.history.length, 6);
    s.game.GameContext.localPlayerID = 1; s.events('LocalPlayerChanged', 1); s.clock.drain();
    assert.equal(s.history.length, 6); assert.equal(s.controller.running, false); assert.equal(s.listeners(), 0);
});
run('Panel selectors and action mapping reach the new singleton', () => {
    const html = fs.readFileSync(new URL('../ui/dev-panel.html', import.meta.url), 'utf8');
    const actions = fs.readFileSync(new URL('../ui/actions.js', import.meta.url), 'utf8');
    assert.match(html, /dev-panel-button--spend-all-attribute-points/);
    assert.match(actions, /"spend-all-attribute-points": AttributeSpending\.toggle/);
    assert.match(actions, /AttributeSpending\.refreshStatus\(\)/);
    const elements = new Map();
    globalThis.document = { querySelector(selector) {
        assert(html.includes(selector.slice(1)));
        if (!elements.has(selector)) elements.set(selector, {});
        return elements.get(selector);
    } };
    AttributeSpending.refreshStatus();
    assert.equal(elements.get('.dev-panel-button__label--spend-all-attribute-points').textContent, 'Spend all attribute points');
    AttributeSpending.running = true; AttributeSpending.refreshStatus();
    assert.equal(elements.get('.dev-panel-button__label--spend-all-attribute-points').textContent, 'Stop spending attribute points');
    AttributeSpending.running = false;
});

const result = { fixture: { source: fixture.source, branches: attributes.length, nodes: fixture.nodes.length },
    passed: reports.filter(r => r.passed).length, failed: reports.filter(r => !r.passed).length, tests: reports };
fs.writeFileSync(new URL('./civ7-attribute-tests.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.failed ? 1 : 0;
