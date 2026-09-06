import assert from 'node:assert/strict';
import { createGameCityGrowthRuntime } from '../ui/city-growth.js';

// Native-shaped offline fixtures. These exercise payloads and guards, not the
// unavailable native implementation of growth or pre-growth plot discovery.
const cid = (id = 10, owner = 0) => ({ owner, id, type: 1 });
const point = plot => ({ x: plot % 100, y: Math.floor(plot / 100) });
const plotAt = location => location.y * 100 + location.x;
const tests = [];
const test = (name, check) => {
    try { check(); tests.push({ name, passed: true }); }
    catch (error) { tests.push({ name, passed: false, error: error.stack ?? String(error) }); }
};

function setup() {
    const id = cid();
    const s = { query: { Success: false, Plots: [101, 102, 103, 104] }, cap: 2,
        rows: [{ PlotIndex: 105, IsBlocked: false, NumWorkers: 0, MaxWorkers: 2 }],
        calls: [], food: 0, rural: [], sendResult: undefined, targetSuccess: true };
    s.owners = new Map([[102, id], [103, cid(11)], [104, id], [105, id]]);
    s.districts = new Map([[22, { id: { owner: 0, id: 22, type: 4 }, location: point(102) }]]);
    s.city = { id, owner: 0, name: 'LOC_TEST_CITY', population: 3, isTown: false,
        Growth: { isReadyToPlacePopulation: false, growthType: 701, projectType: 0 },
        Districts: { getIdsOfType(type) {
            assert.equal(type, 301); return [...s.districts.values()].map(d => d.id);
        } },
        Workers: { getCityWorkerCap: () => s.cap, GetAllPlacementInfo: () => s.rows },
        FoodQueue: { completeProduction() { s.food++; return s.foodResult; } },
        addRuralPopulation(amount) { s.rural.push(amount); },
    };
    s.cities = [s.city];
    s.g = {
        GameContext: { localPlayerID: 0 },
        GrowthTypes: { EXPAND: 701 }, DistrictTypes: { RURAL: 301 },
        CityCommandTypes: { EXPAND: 401 }, PlayerOperationTypes: { ASSIGN_WORKER: 501 },
        Players: { get: player => player === 0 ? { Cities: { getCities: () => s.cities } } : undefined },
        Cities: { get: cityId => s.cities.find(c => c.id.id === cityId.id) },
        Districts: { get: districtId => s.districts.get(districtId.id) },
        GameplayMap: {
            getLocationFromIndex: point,
            getIndexFromLocation: plotAt,
            getOwningCityFromXY: (x, y) => s.owners.get(y * 100 + x),
        },
        Locale: { compose: name => `Localized ${name}` },
        Game: {
            CityCommands: {
                canStart(target, type, args, visible) {
                    s.calls.push({ api: 'city-check', target, type, args: { ...args }, visible });
                    return Object.keys(args).length ? { Success: s.targetSuccess } : s.query;
                },
                sendRequest(target, type, args) {
                    s.calls.push({ api: 'city-send', target, type, args: { ...args } }); return s.sendResult;
                },
            },
            PlayerOperations: {
                canStart(target, type, args, visible) {
                    s.calls.push({ api: 'player-check', target, type, args: { ...args }, visible });
                    return { Success: s.targetSuccess };
                },
                sendRequest(target, type, args) {
                    s.calls.push({ api: 'player-send', target, type, args: { ...args } }); return s.sendResult;
                },
            },
        },
        engine: { on() {}, off() {} },
    };
    s.runtime = createGameCityGrowthRuntime(s.g);
    s.inspect = () => s.runtime.inspect(id, 0);
    s.ready = () => { s.city.Growth.isReadyToPlacePopulation = true; };
    s.sent = () => s.calls.filter(call => call.api.endsWith('-send'));
    return s;
}

test('Local settlement enumeration filters foreign cities and copies component IDs', () => {
    const s = setup(); s.cities.push({ id: cid(12, 1), owner: 1 });
    const ids = s.runtime.cityIds(0);
    assert.deepEqual(ids, [s.city.id]); assert.notEqual(ids[0], s.city.id);
    s.g.GameContext.localPlayerID = 2; assert.equal(s.runtime.localPlayerId(), 2);
});

test('Expansion query uses native CityCommands enum and accepts Plots despite query failure', () => {
    const s = setup(); const state = s.inspect();
    assert.deepEqual(s.calls[0], { api: 'city-check', target: s.city.id, type: 401, args: {}, visible: false });
    assert.equal(state.ruralAvailable, true);
    assert.deepEqual(state.candidates.map(c => [c.kind, c.plot]), [['rural', 101], ['rural', 104], ['specialist', 105]]);
    assert.equal(state.name, 'Localized LOC_TEST_CITY');
});

test('Expansion excludes other settlements, enemy land, existing rural districts and invalid duplicate plots', () => {
    const s = setup(); s.query.Plots.push(101, -1, 1.5, 106); s.owners.set(106, cid(12, 1));
    assert.deepEqual(s.inspect().candidates.filter(c => c.kind === 'rural').map(c => c.plot), [101, 104]);
});

test('Unowned sentinel and plot zero remain valid rural candidates', () => {
    const s = setup(); s.query.Plots = [0]; s.owners.set(0, { owner: -1, id: -1, type: 0 });
    assert.deepEqual(s.inspect().candidates[0], { kind: 'rural', plot: 0, location: { x: 0, y: 0 } });
});

test('Rural snapshot uses native district locations and excludes land reassigned elsewhere', () => {
    const s = setup(); assert.deepEqual(s.inspect().ruralPlots, [102]);
    s.owners.set(102, cid(11)); assert.deepEqual(s.inspect().ruralPlots, []);
});

test('Specialist availability refreshes dynamic caps, blocked flags, counts and ownership', () => {
    const s = setup(); s.rows.push({ PlotIndex: 106, IsBlocked: false, NumWorkers: 0, MaxWorkers: 9 });
    assert.equal(s.inspect().candidates.filter(c => c.kind === 'specialist').length, 1);
    s.cap = 0; assert.equal(s.inspect().candidates.filter(c => c.kind === 'specialist').length, 0);
    s.cap = 1; s.rows[0].IsBlocked = true;
    assert.equal(s.inspect().candidates.filter(c => c.kind === 'specialist').length, 0);
    s.rows[0].IsBlocked = false; s.rows[0].NumWorkers = 2;
    assert.equal(s.inspect().candidates.filter(c => c.kind === 'specialist').length, 0);
    s.rows[0].MaxWorkers = 3;
    assert.equal(s.inspect().candidates.filter(c => c.kind === 'specialist').length, 1);
});

test('Towns exclude specialists without requiring the city worker API', () => {
    const s = setup(); s.city.isTown = true; delete s.city.Workers;
    assert.deepEqual(s.inspect().workers, []);
    assert(s.inspect().candidates.every(c => c.kind === 'rural'));
});

test('Missing expansion Plots preserves independently available specialist candidates', () => {
    const s = setup(); s.query = { Success: false };
    const state = s.inspect(); assert.equal(state.ruralAvailable, false);
    assert.deepEqual(state.candidates.map(c => [c.kind, c.plot]), [['specialist', 105]]);
    assert.equal(s.runtime.grant(s.city.id, 0), true); assert.equal(s.food, 1);
});

test('Exposed expansion capacity containing only another settlement prevents population grants', () => {
    const s = setup(); s.query.Plots = [103]; s.rows = [];
    assert.equal(s.inspect().ruralAvailable, true); assert.deepEqual(s.inspect().candidates, []);
    assert.equal(s.runtime.grant(s.city.id, 0), false);
    assert.equal(s.food, 0); assert.deepEqual(s.rural, []);
});

test('Existing pending population prevents another grant', () => {
    const s = setup(); s.ready(); assert.equal(s.runtime.grant(s.city.id, 0), false);
    assert.equal(s.food, 0); assert.deepEqual(s.rural, []);
});

test('Cities and growing towns complete the native food queue', () => {
    for (const town of [false, true]) {
        const s = setup(); s.city.isTown = town;
        assert.equal(s.runtime.grant(s.city.id, 0), true); assert.equal(s.food, 1); assert.deepEqual(s.rural, []);
    }
});

test('Focused towns use one rural grant and preserve their chosen growth mode and project', () => {
    const s = setup(); s.city.isTown = true;
    s.city.Growth.growthType = 702; s.city.Growth.projectType = 777;
    assert.equal(s.runtime.grant(s.city.id, 0), true);
    assert.equal(s.food, 0); assert.deepEqual(s.rural, [1]);
    assert.equal(s.city.Growth.growthType, 702); assert.equal(s.city.Growth.projectType, 777);
});

test('Missing food helper falls back to one rural grant and missing both helpers reports unavailable', () => {
    const s = setup(); delete s.city.FoodQueue;
    assert.equal(s.runtime.grant(s.city.id, 0), true); assert.deepEqual(s.rural, [1]);
    delete s.city.addRuralPopulation;
    assert.throws(() => s.runtime.grant(s.city.id, 0), /Population growth is unavailable/);
});

test('Explicit food completion rejection throws without another grant', () => {
    const s = setup(); s.foodResult = false;
    assert.throws(() => s.runtime.grant(s.city.id, 0), /food growth request was rejected/);
    assert.equal(s.food, 1); assert.deepEqual(s.rural, []);
});

test('Rural dispatch derives coordinates from the refreshed plot rather than a stale caller location', () => {
    const s = setup(); s.ready();
    const candidate = { ...s.inspect().candidates[0], location: point(103) };
    assert.equal(s.runtime.place(s.city.id, candidate, 0), true);
    assert.deepEqual(s.sent(), [{ api: 'city-send', target: s.city.id, type: 401, args: { X: 1, Y: 1 } }]);
    assert.deepEqual(s.calls.at(-2), { api: 'city-check', target: s.city.id, type: 401, args: { X: 1, Y: 1 }, visible: false });
});

test('Specialist dispatch uses player operation and exact Location Amount payload', () => {
    const s = setup(); s.ready(); const candidate = s.inspect().candidates.find(c => c.kind === 'specialist');
    assert.equal(s.runtime.place(s.city.id, candidate, 0), true);
    assert.deepEqual(s.sent(), [{ api: 'player-send', target: 0, type: 501, args: { Location: 105, Amount: 1 } }]);
    assert.deepEqual(s.calls.at(-2), { api: 'player-check', target: 0, type: 501, args: { Location: 105, Amount: 1 }, visible: false });
});

test('A stale expansion target or changed plot ownership is rejected before sending', () => {
    const s = setup(); s.ready(); const candidate = s.inspect().candidates[0];
    s.query.Plots = [104]; assert.equal(s.runtime.place(s.city.id, candidate, 0), false);
    s.query.Plots = [101]; s.owners.set(101, cid(11));
    assert.equal(s.runtime.place(s.city.id, candidate, 0), false); assert.deepEqual(s.sent(), []);
});

test('Settlement ownership is checked again for placement and grants', () => {
    const s = setup(); const candidate = s.inspect().candidates[0]; s.city.owner = 1;
    assert.throws(() => s.runtime.place(s.city.id, candidate, 0), /no longer owned/);
    assert.throws(() => s.runtime.grant(s.city.id, 0), /no longer owned/);
    assert.deepEqual(s.sent(), []); assert.equal(s.food, 0); assert.deepEqual(s.rural, []);
});

test('Placement requires current readiness and current specialist space', () => {
    const s = setup(); const candidate = s.inspect().candidates.find(c => c.kind === 'specialist');
    assert.equal(s.runtime.place(s.city.id, candidate, 0), false);
    s.ready(); s.rows[0].NumWorkers = 2;
    assert.equal(s.runtime.place(s.city.id, candidate, 0), false); assert.deepEqual(s.sent(), []);
});

test('A targeted native availability rejection never sends either placement type', () => {
    const s = setup(); s.ready(); s.targetSuccess = false;
    for (const candidate of s.inspect().candidates) assert.equal(s.runtime.place(s.city.id, candidate, 0), false);
    assert.deepEqual(s.sent(), []);
});

test('Explicit false native sends throw after one dispatch for either placement type', () => {
    for (const kind of ['rural', 'specialist']) {
        const s = setup(); s.ready(); s.sendResult = false;
        const candidate = s.inspect().candidates.find(c => c.kind === kind);
        assert.throws(() => s.runtime.place(s.city.id, candidate, 0), /placement request was rejected/);
        assert.equal(s.sent().length, 1);
    }
});

test('Missing readiness or population evidence stops before any growth request', () => {
    for (const field of ['readiness', 'population']) {
        const s = setup();
        if (field === 'readiness') delete s.city.Growth.isReadyToPlacePopulation; else delete s.city.population;
        assert.throws(() => s.runtime.grant(s.city.id, 0), /Population readiness is unavailable/);
        assert.equal(s.food, 0); assert.deepEqual(s.rural, []);
    }
});

test('Missing district enumeration or location is reported instead of treating the city as empty', () => {
    const s = setup(); s.city.Districts = undefined;
    assert.throws(() => s.inspect(), /Rural district data is unavailable/);
    const t = setup(); t.g.Districts.get = () => undefined;
    assert.throws(() => t.inspect(), /rural district has no location/);
});

test('Missing specialist capacity or placement counts is reported instead of assuming empty slots', () => {
    const s = setup(); s.cap = undefined;
    assert.throws(() => s.inspect(), /Specialist capacity is unavailable/);
    s.cap = 1; s.rows[0].NumWorkers = undefined;
    assert.throws(() => s.inspect(), /Specialist placement counts are unavailable/);
});

test('Missing expansion Plots permits a growth probe and readiness prevents another grant', () => {
    const s = setup(); s.query = { Success: false }; s.rows = [];
    const state = s.inspect(); assert.equal(state.ruralAvailable, false); assert.deepEqual(state.candidates, []);
    assert.equal(s.runtime.grant(s.city.id, 0), true); assert.equal(s.food, 1); assert.deepEqual(s.rural, []);
    s.ready(); assert.equal(s.runtime.grant(s.city.id, 0), false); assert.equal(s.food, 1);
});

test('Empty expansion Plots before readiness permits a food growth probe rather than assuming full', () => {
    const s = setup(); s.query.Plots = []; s.rows = [];
    assert.equal(s.inspect().ruralAvailable, false);
    assert.equal(s.runtime.grant(s.city.id, 0), true); assert.equal(s.food, 1);
    s.ready(); assert.equal(s.runtime.grant(s.city.id, 0), false); assert.equal(s.food, 1);
});

test('Empty expansion Plots with pending growth provides a confirmed empty rural result', () => {
    const s = setup(); s.ready(); s.query.Plots = []; s.rows = [];
    const state = s.inspect(); assert.equal(state.ruralAvailable, true); assert.deepEqual(state.candidates, []);
    assert.equal(s.runtime.grant(s.city.id, 0), false); assert.equal(s.food, 0);
});

const result = { passed: tests.filter(t => t.passed).length, failed: tests.filter(t => !t.passed).length, tests };
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.failed ? 1 : 0;
