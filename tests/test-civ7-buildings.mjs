import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BuildingAutomationController, createGameBuildingRuntime, chooseBuilding, reserveWonderPlots, BuildingAutomation } from '../ui/building-automation.js';

// Offline native-contract simulator; no connection to the running game.
class Clock {
    time = 0; sequence = 0; tasks = new Map();
    schedule = (fn, delay) => { const id = ++this.sequence; this.tasks.set(id, { fn, due: this.time + delay }); return id; };
    unschedule = id => this.tasks.delete(id);
    next() {
        const item = [...this.tasks.entries()].sort((a,b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!item) return false;
        this.tasks.delete(item[0]); this.time = item[1].due; item[1].fn(); return true;
    }
    drain() { let steps = 0; while (this.next()) assert(++steps < 20000, 'automation failed to terminate'); }
}
const YIELDS = ['FOOD', 'PRODUCTION', 'GOLD', 'SCIENCE', 'CULTURE', 'HAPPINESS'];
const cityId = id => ({ owner: 0, id, type: 1 });
const point = p => ({ x: p, y: 0 });
function setup(specs, citySpecs = [{ id: 10 }], options = {}) {
    const clock = new Clock(); const listeners = new Map(); const events = [];
    const objects = new Map(); let objectId = 0; let gold = options.gold ?? 0;
    const definitions = specs.map((s, i) => ({
        ...s, $index: i + 100, $hash: i + 10000, Name: s.type, ConstructibleType: s.type,
        ConstructibleClass: s.class ?? 'BUILDING', Cost: s.cost ?? 100, DistrictDefense: s.wall ?? false,
    }));
    const lookup = id => definitions.find(d => id === d.$index || id === d.$hash || id === d.type);
    const cities = citySpecs.map(s => ({ ...s, id: cityId(s.id), owner: s.owner ?? 0, name: `City ${s.id}`, isTown: s.town ?? false, items: [...(s.queue ?? [])],
        Happiness: { netHappinessPerTurn: s.happiness ?? 5 } }));
    const emit = name => { for (const callback of [...(listeners.get(name) ?? [])]) callback({}); };
    const instances = city => [...objects.values()].filter(o => o.city === city);
    const make = (city, def, plot, complete = true, damaged = false) => {
        const instance = { id: { owner: city.owner, type: 2, id: ++objectId }, city, type: def.$hash, location: point(plot), complete, damaged };
        objects.set(instance.id.id, instance); return instance;
    };
    for (const city of cities) {
        for (const entry of city.existing ?? []) make(city, lookup(entry.type), entry.plot, entry.complete ?? true, entry.damaged ?? false);
        for (const item of city.items) {
            if (item.orderType === 'CONSTRUCT') {
                item.constructibleType = lookup(item.constructibleType).$hash;
                make(city, lookup(item.constructibleType), item.location.x, false);
            }
        }
    }
    const base = def => YIELDS.map(y => def.yields?.[y] ?? 0);
    const overbuild = (city, def, plot) => def.replace?.(instances(city), plot) ?? null;
    const legalPlots = (city, def) => {
        if (def.locked) return [];
        if (def.class === 'WONDER' && [...objects.values()].some(o => o.type === def.$hash && o.complete && !o.damaged)) return [];
        if (!def.repeat && instances(city).some(o => o.type === def.$hash && o.complete && !o.damaged)) return [];
        return (def.sites ? def.sites[city.id.id] ?? [] : def.plots ?? [1]).filter(plot => {
            if (def.legal && !def.legal({ city, plot, instances: instances(city), definitions })) return false;
            const existing = instances(city).filter(o => o.location.x === plot);
            if (existing.some(o => o.type === def.$hash && !o.damaged)) return false;
            if (def.repair) return existing.some(o => o.type === def.$hash && o.damaged);
            if (overbuild(city, def, plot)) return true;
            if (existing.some(o => lookup(o.type).ConstructibleClass === 'WONDER')) return false;
            return existing.length < (def.class === 'WONDER' ? 1 : 2);
        });
    };
    const apiResult = (city, def, mode, args = {}) => {
        if (options.rejectRecheck && args.X != null) return { Success: false };
        const inQueue = city.items.some(i => i.orderType === 'CONSTRUCT' && i.constructibleType === def.$hash);
        const plots = legalPlots(city, def);
        const legalMode = mode === 'purchase' ? def.purchase !== false && def.class !== 'WONDER' : !city.isTown;
        const insufficient = mode === 'purchase' && gold < def.Cost && plots.length > 0 && legalMode;
        return { Success: legalMode && !inQueue && !insufficient && plots.length > 0 && (args.X == null || plots.includes(args.X)),
            Plots: def.expand ? [] : plots, ExpandUrbanPlots: def.expand ? plots : [], InQueue: inQueue,
            InsufficientFunds: insufficient, Cost: def.Cost, RepairDamaged: !!def.repair, MoveToNewLocation: !!def.move };
    };
    const getCity = id => cities.find(c => c.id.id === id.id && c.id.type === id.type && c.id.owner === id.owner);
    const finishObject = (city, def, plot) => {
        let object = instances(city).find(o => o.type === def.$hash && o.location.x === plot);
        const prior = overbuild(city, def, plot);
        if (prior) for (const o of instances(city)) if (o.type === lookup(prior).$hash && o.location.x === plot) objects.delete(o.id.id);
        object ??= make(city, def, plot, false);
        object.complete = true; object.damaged = false;
        emit('ConstructibleBuildCompleted');
    };
    const later = callback => options.inline ? callback() : clock.schedule(callback, options.delay ?? 15);
    for (const city of cities) {
        city.Constructibles = {
            getIds: () => instances(city).map(o => o.id),
            getMaintenance: type => YIELDS.map(y => lookup(type)?.maintenance?.[y] ?? 0),
        };
        city.Yields = {
            getNetYield: () => city.food ?? 5,
            getAllBaseYieldValuesForConstructible: type => base(lookup(type)),
            calculateAllBuildingsPlacements: () => ({ buildings: definitions.map(def => ({
                constructibleType: def.$hash,
                placements: (def.sites ? def.sites[city.id.id] ?? [] : def.plots ?? [1]).map(plot => ({ plotID: plot,
                    yieldChanges: YIELDS.map(y => def.placementYields?.[plot]?.[y] ?? def.yields?.[y] ?? 0),
                    overbuiltConstructibleID: lookup(overbuild(city, def, plot))?.$index ?? -1,
                })),
            })) }),
        };
        city.BuildQueue = {
            getQueue: () => city.items,
            completeProduction() {
                const item = city.items[0];
                assert.equal(item?.orderType, 'CONSTRUCT', 'completed an unrelated unit/project');
                events.push({ operation: 'complete', city: city.id.id, type: lookup(item.constructibleType).type, plot: item.location.x });
                if (options.dropCompletion) return;
                later(() => {
                    assert.equal(city.items[0], item, 'queue head changed before completion');
                    city.items.shift(); finishObject(city, lookup(item.constructibleType), item.location.x);
                    emit('CityProductionQueueChanged');
                });
            },
        };
    }
    const query = mode => (id, operation, kind) => {
        assert.equal(operation, mode === 'purchase' ? 'PURCHASE' : 'BUILD'); assert.equal(kind, 'CONSTRUCTIBLE');
        const city = getCity(id);
        return definitions.map(def => ({ index: def.$index, result: apiResult(city, def, mode) }));
    };
    const check = mode => (id, operation, args, testVisible) => {
        assert.equal(operation, mode === 'purchase' ? 'PURCHASE' : 'BUILD'); assert.equal(testVisible, false);
        const city = getCity(id);
        if (args.InsertMode != null) {
            assert.equal(args.InsertMode, 'MOVE_TO');
            return { Success: args.QueueDestinationLocation === 0 && !!city.items[args.QueueSourceLocation] };
        }
        assert(Number.isInteger(args.ConstructibleType));
        return apiResult(city, lookup(args.ConstructibleType), mode, args);
    };
    const send = mode => (id, operation, args) => {
        const city = getCity(id); assert.equal(city.owner, 0);
        assert(check(mode)(id, operation, args, false).Success, 'sent an illegal native request');
        if (args.InsertMode != null) {
            events.push({ operation: 'move', city: city.id.id, args: { ...args } });
            if (!options.dropMove) later(() => {
                const [item] = city.items.splice(args.QueueSourceLocation, 1);
                city.items.splice(args.QueueDestinationLocation, 0, item); emit('CityProductionQueueChanged');
            });
            return;
        }
        const def = lookup(args.ConstructibleType);
        events.push({ operation: mode, city: city.id.id, type: def.type, plot: args.X });
        if (options.dropSubmit) return;
        later(() => {
            if (mode === 'purchase') {
                gold -= def.Cost;
                if (options.earlyIncomplete) {
                    make(city, def, args.X, false); emit('ConstructibleAddedToMap');
                    clock.schedule(() => finishObject(city, def, args.X), 500);
                } else finishObject(city, def, args.X);
            } else {
                city.items.push({ orderType: 'CONSTRUCT', constructibleType: def.$hash, location: point(args.X) });
                if (!instances(city).some(o => o.type === def.$hash && o.location.x === args.X)) make(city, def, args.X, false);
                emit('ConstructibleAddedToMap'); emit('CityProductionQueueChanged');
            }
        });
        if (options.throwAfterSubmit) throw new Error('send failed after possible acceptance');
    };
    const g = {
        GameContext: { localPlayerID: 0 },
        GameInfo: {
            Constructibles: { lookup }, TypeTags: definitions.flatMap(d => (d.tags ?? []).map(Tag => ({ Type: d.type, Tag }))),
            Yields: YIELDS.map((y, $index) => ({ $index, YieldType: `YIELD_${y}` })),
            AdvisorySubjects: { lookup: type => ({ AdvisorySubjectType: type }) },
            UniqueQuarters: { lookup: key => options.quarters?.find(q => q.UniqueQuarterType === key) },
        },
        Players: {
            get: id => id === 0 ? { Cities: { getCities: () => cities }, Constructibles: { getUnlockedUniqueQuarters: () => (options.quarters ?? []).map(q => q.UniqueQuarterType) } } : null,
            Advisory: { get: () => ({ getBuildRecommendations: params => {
                assert.equal(params.subject, 'PRODUCTION'); assert.equal(params.maxReturnedEntries, 0);
                return definitions.filter(d => d.advisors).map(d => ({ subject: 'ADVISORY_SUBJECT_PRODUCE_CONSTRUCTIBLES', recommendedType: d.$hash, whichAdvisors: Array(d.advisors).fill(1) }));
            } }) },
        },
        Cities: { get: getCity }, Constructibles: { getByComponentID: id => objects.get(id.id) },
        Game: { CityCommands: { canStartQuery: query('purchase'), canStart: check('purchase'), sendRequest: send('purchase') },
            CityOperations: { canStartQuery: query('build'), canStart: check('build'), sendRequest: send('build') } },
        CityCommandTypes: { PURCHASE: 'PURCHASE' }, CityOperationTypes: { BUILD: 'BUILD' },
        CityOperationsParametersValues: { MoveTo: 'MOVE_TO' }, CityQueryType: { Constructible: 'CONSTRUCTIBLE' },
        OrderTypes: { ORDER_CONSTRUCT: 'CONSTRUCT' }, AdvisorySubjectTypes: { PRODUCTION: 'PRODUCTION' }, YieldTypes: { YIELD_FOOD: 0 },
        GameplayMap: { getIndexFromLocation: p => p.x, getLocationFromIndex: point }, Locale: { compose: s => s },
        engine: { on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); }, off(event, fn) { listeners.get(event)?.delete(fn); } },
    };
    const rendered = [];
    const controller = new BuildingAutomationController(() => createGameBuildingRuntime(g), {
        schedule: clock.schedule, unschedule: clock.unschedule, now: () => clock.time, render: state => rendered.push({ ...state }),
    });
    return { clock, controller, g, events, cities, definitions, objects, rendered, emit, gold: () => gold,
        listeners: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0) };
}
const tests = [];
function test(name, body) { try { const details = body(); tests.push({ name, passed: true, ...details }); } catch(e) { tests.push({ name, passed: false, error: e.stack }); } }
function run(s) {
    s.controller.start(); s.clock.drain();
    assert.equal(s.controller.running, false); assert.equal(s.listeners(), 0); assert.equal(s.clock.tasks.size, 0);
}
const purchased = s => s.events.filter(e => ['purchase','build'].includes(e.operation));

test('Important buildings first, all remaining buildings, then wonders across cities', () => {
    const s = setup([
        { type: 'LIBRARY', plots: [1,2], yields: { SCIENCE: 3 } },
        { type: 'WORKSHOP', plots: [1,2], yields: { PRODUCTION: 3 } },
        { type: 'BARRACKS', plots: [2,3] },
        { type: 'WONDER', class: 'WONDER', plots: [4] },
    ]); run(s);
    assert.deepEqual(purchased(s).map(e => e.type), ['WORKSHOP','LIBRARY','BARRACKS','WONDER']);
    assert.equal(s.controller.count, 4); assert.equal([...s.objects.values()].filter(o => o.complete).length, 4);
});
test('Advisor recommendations precede ordinary yield buildings', () => {
    const s = setup([{ type: 'MARKET', plots: [1], yields: { GOLD: 3 } }, { type: 'FORT', plots: [2], advisors: 2 }]); run(s);
    assert.equal(purchased(s)[0].type, 'FORT');
});
test('Urgent happiness recovery precedes an advisor recommendation', () => {
    const s = setup([{ type:'FORT', plots:[1], advisors:3 }, { type:'BATH', plots:[2], yields:{HAPPINESS:4} }], [{ id:10, happiness:-5 }]); run(s);
    assert.equal(purchased(s)[0].type, 'BATH');
});
test('Best placement accounts for yields and maintenance', () => {
    const s = setup([{ type:'LIBRARY', plots:[0,1,2], yields:{SCIENCE:2}, maintenance:{GOLD:2}, placementYields:{0:{SCIENCE:1},1:{SCIENCE:7},2:{SCIENCE:3}} }]); run(s);
    assert.equal(purchased(s)[0].plot, 1);
});
test('Cities use instant construction to preserve gold for towns', () => {
    const s = setup([{ type:'WORKSHOP', sites:{10:[1]}, yields:{PRODUCTION:2} },{type:'LIBRARY',sites:{20:[2]},yields:{SCIENCE:2}}],[{id:10},{id:20,town:true}],{gold:100}); run(s);
    assert.deepEqual(purchased(s).map(e=>e.operation),['build','purchase']); assert.equal(s.gold(),0);
});
test('Towns purchase legal buildings and never use production completion', () => {
    const s = setup([{type:'GRANARY',plots:[1]}],[{id:10,town:true}],{gold:200});run(s);
    assert.equal(s.controller.count,1);assert.equal(purchased(s)[0].operation,'purchase');assert(!s.events.some(e=>e.operation==='complete'));
});
test('Insufficient town gold ends with an explicit reason', () => {
    const s=setup([{type:'GRANARY',plots:[1]}],[{id:10,town:true}]);run(s);
    assert.equal(purchased(s).length,0);assert.match(s.controller.message,/more gold/);
});
test('Wonder-exclusive plot is reserved while ordinary building chooses another',()=>{
    const s=setup([{type:'WORKSHOP',plots:[1,2],yields:{PRODUCTION:2},placementYields:{1:{PRODUCTION:10}}},{type:'WONDER',class:'WONDER',plots:[1]}]);run(s);
    assert.deepEqual(purchased(s).map(e=>[e.type,e.plot]),[['WORKSHOP',2],['WONDER',1]]);
});
test('Overlapping wonder options get separate sites instead of blocking one another',()=>{
    const s=setup([{type:'FLEXIBLE',class:'WONDER',plots:[1,2]},{type:'STRICT',class:'WONDER',plots:[1]}]);run(s);
    assert.equal(s.controller.count,2);assert.deepEqual(new Set(purchased(s).map(e=>e.plot)),new Set([1,2]));
});
test('Wonder matching uses augmenting paths, not a greedy single-site choice',()=>{
    const c=(type,plot)=>({type,plot,wonder:true,cityId:cityId(10),score:0,advisors:0,cost:100});
    const match=reserveWonderPlots([c('A',1),c('A',2),c('B',1),c('B',3),c('C',1),c('C',3)]);
    assert.equal(match.size,3);assert.equal(new Set([...match.values()].map(v=>v.type)).size,3);
});
test('A world wonder is built only once across multiple cities',()=>{
    const s=setup([{type:'WONDER',class:'WONDER',sites:{10:[1],20:[2]}}],[{id:10},{id:20}]);run(s);
    assert.equal(purchased(s).length,1);assert.equal(s.controller.count,1);
});
test('Existing unit and project queues survive building completion',()=>{
    const initial=[{orderType:'TRAIN',unitType:5},{orderType:'ADVANCE',projectType:7}];
    const s=setup([{type:'WORKSHOP',plots:[1]}],[{id:10,queue:initial}]);run(s);
    assert.deepEqual(s.cities[0].items,initial);assert.equal(s.events.filter(e=>e.operation==='move').length,1);
    assert.equal(s.events.filter(e=>e.operation==='complete').length,1);
});
test('Existing queued wonders finish without duplicate build submissions',()=>{
    const s=setup([{type:'WONDER',class:'WONDER',plots:[1]}],[{id:10,queue:[{orderType:'TRAIN',unitType:5},{orderType:'CONSTRUCT',constructibleType:'WONDER',location:point(1)}]}]);run(s);
    assert.equal(purchased(s).length,0);assert.equal(s.controller.count,1);assert.equal(s.cities[0].items[0].orderType,'TRAIN');
});
test('An unfinished constructible appearing on the map is not mistaken for completion',()=>{
    const s=setup([{type:'MARKET',plots:[1]}],[{id:10,town:true}],{gold:100,earlyIncomplete:true});run(s);
    assert.equal(s.controller.count,1);assert(s.clock.time>=500);assert.equal(purchased(s).length,1);
});
test('New unique quarter uses a shared plot and completes both halves together',()=>{
    const s=setup([{type:'PAIR_A',plots:[1,2]},{type:'PAIR_B',plots:[2,3]}],undefined,{quarters:[{UniqueQuarterType:'Q',BuildingType1:'PAIR_A',BuildingType2:'PAIR_B'}]});run(s);
    assert.equal(s.controller.count,2);assert(purchased(s).every(e=>e.plot===2));
});
test('Existing unique quarter partner keeps its plot free from ordinary buildings',()=>{
    const s=setup([{type:'PAIR_A',plots:[1]},{type:'PAIR_B',plots:[1,2]},{type:'MARKET',plots:[1,2],yields:{GOLD:20}}],[{id:10,existing:[{type:'PAIR_A',plot:1}]}],{quarters:[{UniqueQuarterType:'Q',BuildingType1:'PAIR_A',BuildingType2:'PAIR_B'}]});run(s);
    assert.equal(purchased(s).find(e=>e.type==='PAIR_B').plot,1);assert.equal(purchased(s).find(e=>e.type==='MARKET').plot,2);
});
test('Protected ageless buildings cannot be overbuilt',()=>{
    const s=setup([{type:'OLD',plots:[1],tags:['AGELESS']},{type:'NEW',plots:[1],replace:()=> 'OLD'}],[{id:10,existing:[{type:'OLD',plot:1}]}]);run(s);
    assert.equal(purchased(s).length,0);assert.match(s.controller.message,/protected/);
});
test('Obsolete replaceable buildings can be upgraded in their legal location',()=>{
    const s=setup([{type:'OLD',plots:[1],locked:true},{type:'NEW',plots:[1],replace:()=> 'OLD'}],[{id:10,existing:[{type:'OLD',plot:1}]}]);run(s);
    assert.equal(s.controller.count,1);assert.equal(purchased(s)[0].type,'NEW');
});
test('Newly built structures are not immediately overbuilt in a loop',()=>{
    const s=setup([{type:'A',plots:[1],replace:items=>items.some(i=>i.type===10001)?'B':null,yields:{PRODUCTION:3}},
        {type:'B',plots:[1],replace:items=>items.some(i=>i.type===10000)?'A':null}]);run(s);
    assert.equal(purchased(s).length,1);assert.equal(purchased(s)[0].type,'A');
});
test('Repeatable defenses fill each eligible plot once and terminate',()=>{
    const s=setup([{type:'WALL',plots:[0,1,2,3],repeat:true,wall:true}]);run(s);
    assert.equal(s.controller.count,4);assert.equal(new Set(purchased(s).map(e=>e.plot)).size,4);
});
test('Expansion plots and plot index zero are valid choices',()=>{
    const s=setup([{type:'GRANARY',plots:[0],expand:true}]);run(s);assert.equal(purchased(s)[0].plot,0);
});
test('Legal repairs complete damaged buildings',()=>{
    const s=setup([{type:'BATH',plots:[1],repair:true}],[{id:10,existing:[{type:'BATH',plot:1,damaged:true}]}]);run(s);
    assert.equal(s.controller.count,1);assert.equal([...s.objects.values()][0].damaged,false);
});
test('Locked buildings and relocation requests are skipped',()=>{
    const s=setup([{type:'LOCKED',plots:[1],locked:true},{type:'MOVABLE',plots:[2],move:true}]);run(s);assert.equal(purchased(s).length,0);
});
test('Availability is recalculated after each building unlocks its prerequisite',()=>{
    const s=setup([{type:'BASE',plots:[1]},{type:'ADVANCED',plots:[2],legal:({instances})=>instances.some(i=>i.type===10000&&i.complete)}]);run(s);
    assert.deepEqual(purchased(s).map(e=>e.type),['BASE','ADVANCED']);
});
test('Foreign settlements never receive commands',()=>{
    const s=setup([{type:'MARKET',plots:[1]}],[{id:10,owner:1}]);run(s);assert.equal(purchased(s).length,0);
});
test('Loss of settlement ownership stops before the next mutation',()=>{
    const s=setup([{type:'MARKET',plots:[1]}]);s.controller.start();s.clock.next();s.cities[0].owner=1;s.clock.drain();
    assert.equal(purchased(s).length,0);assert.match(s.controller.message,/no longer owned/);
});
test('Cancellation during empire scanning sends no request',()=>{
    const s=setup([{type:'MARKET',plots:[1]}],[{id:10},{id:20}]);s.controller.start();s.clock.next();s.controller.toggle();s.clock.drain();
    assert.equal(purchased(s).length,0);assert.equal(s.listeners(),0);
});
test('Cancellation after queue submission can resume without enqueuing twice',()=>{
    const s=setup([{type:'MARKET',plots:[1]}]);s.controller.start();s.clock.next();s.clock.next();s.controller.toggle();s.clock.drain();
    assert.equal(purchased(s).length,1);assert.equal(s.controller.count,0);run(s);
    assert.equal(purchased(s).length,1);assert.equal(s.controller.count,1);
});
test('Dropped queue submission times out without retrying',()=>{
    const s=setup([{type:'MARKET',plots:[1]}],undefined,{dropSubmit:true});run(s);
    assert.equal(purchased(s).length,1);assert.match(s.controller.message,/not confirmed/);assert(s.clock.time<10500);
    run(s);assert.equal(purchased(s).length,1);
});
test('Dropped queue move is never submitted twice',()=>{
    const s=setup([{type:'MARKET',plots:[1]}],[{id:10,queue:[{orderType:'TRAIN',unitType:5}]}],{dropMove:true});run(s);
    assert.equal(s.events.filter(e=>e.operation==='move').length,1);assert(!s.events.some(e=>e.operation==='complete'));
});
test('Dropped completion is never applied to the next queue item',()=>{
    const s=setup([{type:'MARKET',plots:[1]}],[{id:10,queue:[{orderType:'TRAIN',unitType:5}]}],{dropCompletion:true});run(s);
    assert.equal(s.events.filter(e=>e.operation==='complete').length,1);assert.match(s.controller.message,/not confirmed/);
});
test('Inline native events do not duplicate purchases or build completions',()=>{
    const s=setup([{type:'A',plots:[1]},{type:'B',plots:[2]}],undefined,{inline:true});run(s);
    assert.equal(purchased(s).length,2);assert.equal(s.controller.count,2);
});
test('Missing engine events use bounded polling',()=>{
    const s=setup([{type:'MARKET',plots:[1]}],undefined,{delay:500});s.g.engine.on=()=>{};s.g.engine.off=()=>{};run(s);
    assert.equal(s.controller.count,1);assert.equal(purchased(s).length,1);
});
test('A native send exception after possible acceptance never duplicates a build',()=>{
    const s=setup([{type:'MARKET',plots:[1]}],undefined,{throwAfterSubmit:true});run(s);
    assert.equal(purchased(s).length,1);run(s);assert.equal(purchased(s).length,1);assert.equal(s.controller.count,1);
});
test('Local player change stops processing an already queued purchase',()=>{
    const s=setup([{type:'MARKET',plots:[1]}]);s.controller.start();s.clock.next();s.clock.next();s.g.GameContext.localPlayerID=1;s.emit('LocalPlayerChanged');s.clock.drain();
    assert.equal(purchased(s).length,1);assert(!s.events.some(e=>e.operation==='complete'));assert.equal(s.listeners(),0);
});
test('Missing placement data reports a failure rather than claiming completion',()=>{
    const s=setup([{type:'MARKET',plots:[1]}]);s.cities[0].Yields.calculateAllBuildingsPlacements=()=>null;run(s);
    assert.equal(purchased(s).length,0);assert.match(s.controller.message,/Placement data is unavailable/);
});
test('Multiple start calls do not duplicate listeners or scans',()=>{
    const s=setup([{type:'MARKET',plots:[1]}]);s.controller.start();s.controller.start();assert.equal(s.listeners(),5);s.clock.drain();assert.equal(purchased(s).length,1);
});
test('Panel action and status selectors connect to the new singleton',()=>{
    const html=fs.readFileSync(new URL('../ui/dev-panel.html',import.meta.url),'utf8');
    const actions=fs.readFileSync(new URL('../ui/actions.js',import.meta.url),'utf8');
    assert.match(actions,/"build-all-buildings": BuildingAutomation\.toggle/);assert.match(actions,/BuildingAutomation\.refreshStatus\(\)/);
    const elements=new Map();globalThis.document={querySelector(selector){assert(html.includes(selector.slice(1)));if(!elements.has(selector))elements.set(selector,{});return elements.get(selector);}};
    BuildingAutomation.refreshStatus();assert.equal(elements.get('.dev-panel-button__label--build-all-buildings').textContent,'Build all buildings + wonders');
    BuildingAutomation.running=true;BuildingAutomation.refreshStatus();assert.equal(elements.get('.dev-panel-button__label--build-all-buildings').textContent,'Stop building automation');BuildingAutomation.running=false;
});
test('Stale availability triggers replanning and continues with other buildings',()=>{
    const s=setup([{type:'WORKSHOP',plots:[1],yields:{PRODUCTION:3}},{type:'LIBRARY',plots:[2],yields:{SCIENCE:3}}]);
    s.controller.start();s.clock.next();s.definitions[0].locked=true;s.clock.drain();
    assert.deepEqual(purchased(s).map(e=>e.type),['LIBRARY']);assert.equal(s.controller.count,1);
});
test('Repeated stale rechecks terminate after three scans without sending',()=>{
    const s=setup([{type:'WORKSHOP',plots:[1]}]);
    const runtime=createGameBuildingRuntime(s.g);runtime.submit=()=>false;s.controller.runtimeFactory=()=>runtime;run(s);
    assert.equal(purchased(s).length,0);assert.match(s.controller.message,/kept changing/);assert.equal(s.controller.staleScans,3);
});
test('An explicit false native send keeps an uncertain request from resubmission',()=>{
    const s=setup([{type:'MARKET',plots:[1]}]);let sends=0;s.g.Game.CityOperations.sendRequest=()=>{sends++;return false;};run(s);
    assert.equal(sends,1);assert.match(s.controller.message,/rejected/);run(s);assert.equal(sends,1);
});
test('A missing instant-completion helper uses purchases and reports remaining production limits',()=>{
    const s=setup([{type:'MARKET',plots:[1]},{type:'WONDER',class:'WONDER',plots:[2]}],undefined,{gold:100});
    delete s.cities[0].BuildQueue.completeProduction;run(s);assert.equal(s.controller.count,1);
    assert.equal(purchased(s)[0].operation,'purchase');assert.match(s.controller.message,/instant production is unavailable/);
});
const result={passed:tests.filter(t=>t.passed).length,failed:tests.filter(t=>!t.passed).length,tests};
fs.writeFileSync(new URL('./civ7-building-tests.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));process.exitCode=result.failed?1:0;
