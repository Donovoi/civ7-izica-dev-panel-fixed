import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createReinforcementRuntime, ReinforcementRunner } from '../ui/reinforcement.js';

// Offline native-contract simulator. Never connects to a game or edits a save.
class Clock {
    time = 0; serial = 0; tasks = new Map();
    schedule = (fn, delay) => { const id = ++this.serial; this.tasks.set(id, { fn, due: this.time + delay }); return id; };
    unschedule = id => this.tasks.delete(id);
    next() {
        const item = [...this.tasks].sort((a,b) => a[1].due-b[1].due || a[0]-b[0])[0];
        if (!item) return false;
        this.tasks.delete(item[0]); this.time = item[1].due; item[1].fn(); return true;
    }
    drain() { let count = 0; while (this.next()) assert(++count < 20000, 'did not terminate'); }
}
const id = (n, owner = 0, type = 0) => ({ owner, id: n, type });
const point = x => ({ x, y: 0 });
const equalId = (a,b) => a && b && a.id === b.id && a.owner === b.owner && a.type === b.type;
function setup(options = {}) {
    const clock = new Clock(), events = [], listeners = new Map(), units = [], armies = [];
    const emit = (name, data) => { for (const fn of listeners.get(name) ?? []) fn(data); };
    const addSoldier = (n, x, extra = {}) => {
        const u = { id: id(n), owner: 0, type: 'SOLDIER', isCommanderUnit: false, isOnMap: true, location: point(x),
            armyId: id(-1), Movement: { movementMovesRemaining: 2, maxMoves: 2 }, ...extra };
        units.push(u); return u;
    };
    const addCommander = (n, x, capacity = 2, extra = {}) => {
        const c = addSoldier(n,x,{ type:'COMMANDER', isCommanderUnit:true, armyId:id(n,0,1), ...extra });
        const a = { localId:n, combatUnitCapacity:capacity, members:[c.id], getUnitIds() { return this.members; } };
        armies.push(a); return c;
    };
    const soldier = addSoldier(1,0);
    const commander = addCommander(10,4);
    const findUnit = unitId => units.find(u => equalId(u.id,unitId));
    const findArmy = armyId => armies.find(a => equalId(id(a.localId,0,1),armyId));
    const definitions = { SOLDIER:{CoreClass:'CORE_CLASS_MILITARY',Domain:'LAND'}, COMMANDER:{CoreClass:'CORE_CLASS_SUPPORT',Domain:'LAND'},
        SHIP:{CoreClass:'CORE_CLASS_MILITARY',Domain:'SEA'}, FLEET:{CoreClass:'CORE_CLASS_SUPPORT',Domain:'SEA'}, CIVILIAN:{CoreClass:'CORE_CLASS_CIVILIAN',Domain:'LAND'} };
    const room = c => { const a = findArmy(c.armyId); return a && units.filter(u => !u.isCommanderUnit && definitions[u.type].CoreClass === 'CORE_CLASS_MILITARY' && (a.members.some(i => equalId(i,u.id)) || u.incoming === a.localId)).length < a.combatUnitCapacity; };
    const compatible = (u,c) => c.isCommanderUnit && c.owner === u.owner && c.isOnMap && definitions[c.type].Domain === definitions[u.type].Domain && room(c);
    const later = fn => options.inline ? fn() : clock.schedule(fn,options.delay ?? 20);
    const canStart = (unitId,name,args) => {
        const u = findUnit(unitId);
        if (!u || !u.isOnMap) return {Success:false};
        if (name === 'UNITOPERATION_MOVE_TO') return {Success: !options.noMoves && u.Movement.movementMovesRemaining > 0 && args.Y === 0 && args.X >= 0 && args.X <= 30};
        const targets = units.filter(c => compatible(u,c) && (name === 'UNITCOMMAND_ADD_TO_ARMY' ? !options.noAdd && Math.abs(c.location.x-u.location.x)<=1 : options.native));
        return { Success: args.X == null ? options.querySuccess ?? false : !options.rejectTarget && targets.some(c => c.location.x === args.X), Plots:targets.map(c=>c.location.x) };
    };
    const sendRequest = (unitId,name,args) => {
        events.push({name,unitId,args});
        if (options.sendThrows) throw new Error('uncertain native send');
        if (options.sendFalse) return false;
        if (options.noConfirm) return;
        later(() => {
            const u=findUnit(unitId); if(!u) return;
            if (name === 'UNITOPERATION_MOVE_TO') {
                u.location=point(args.X); u.Movement.movementMovesRemaining=0;
                emit('UnitMovementPointsChanged',{unit:u.id});
            } else {
                const c=units.find(c=>c.isCommanderUnit && c.location.x===args.X);
                if(name==='UNITCOMMAND_ADD_TO_ARMY') {
                    u.armyId=c.armyId; findArmy(c.armyId).members.push(u.id); u.isOnMap=false;
                    emit('UnitAddedToArmy',{unit:u.id});
                } else { u.incoming=findArmy(c.armyId).localId; u.isOnMap=false; }
                emit('UnitRemovedFromMap',{unit:u.id});
            }
        });
    };
    const player = { Units:{getUnitIds:()=>units.filter(u=>u.owner===0).map(u=>u.id)},
        Armies:{getUnitReinforcementCommanderId:unitId=>findUnit(unitId)?.incoming ?? -1},
        Diplomacy:{willMoveStartWar:()=>({Success:!!options.war})} };
    const g = {
        GameContext:{localPlayerID:0}, Players:{get:n=>n===0?player:null},
        Units:{get:findUnit, restoreMovement:unitId=>{
            events.push({name:'restore',unitId});
            if(options.noRestore) return;
            const restore=()=>{ const u=findUnit(unitId); if(u) { u.Movement.movementMovesRemaining=u.Movement.maxMoves; emit('UnitMovementPointsChanged',{unit:unitId}); } };
            if(options.restoreDelay) clock.schedule(restore,options.restoreDelay); else restore();
        },getPathTo:(unitId,dest)=>{
            if(options.pathThrows) throw new Error('path unavailable');
            if(options.noPath || dest.y !== 0 || dest.x < 0 || dest.x > 30) return {plots:[]};
            const x=findUnit(unitId).location.x;
            if(options.partialPath) return {plots:[x]};
            if(options.jumpPath) return {plots:[x,dest.x]};
            return {plots:Array.from({length:Math.abs(x-dest.x)+1},(_,i)=>x+i*Math.sign(dest.x-x))};
        }},
        GameInfo:{Units:{lookup:t=>definitions[t]}}, Armies:{get:findArmy},
        Game:{UnitCommands:{canStart,sendRequest},UnitOperations:{canStart,sendRequest},Combat:{testAttackInto:()=>options.combat?'ATTACK':'NONE'}},
        GameplayMap:{getIndexFromLocation:p=>p.x, getLocationFromIndex:point, getPlotDistance:(x,y,a,b)=>Math.abs(x-a)+Math.abs(y-b),
            getAdjacentPlotLocation:(p,d)=>point(p.x+(d%2?1:-1))},
        UnitOperationMoveModifiers:{NONE:0},CombatTypes:{NO_COMBAT:'NONE'},directions:[0,1,2,3,4,5],
    };
    const runtime=createReinforcementRuntime(g);
    const movement={restoreUnit:g.Units.restoreMovement};
    const runner=new ReinforcementRunner(()=>runtime,movement,{schedule:clock.schedule,unschedule:clock.unschedule,now:()=>clock.time});
    let outcome;
    const run=()=>{ runner.start(soldier.id,(success,reason)=>outcome={success,reason});clock.drain();return outcome; };
    return {g,clock,events,listeners,emit,units,armies,soldier,commander,addSoldier,addCommander,runtime,runner,run,options};
}
const tests=[];
async function test(name,fn) {try {await fn();tests.push({name,passed:true});}catch(e){tests.push({name,passed:false,error:e.stack});}}
const sent=s=>s.events.filter(e=>e.name!=='restore');

await test('Distant exhausted soldier walks and packs when special reinforcement is unavailable',()=>{
    const s=setup();s.soldier.Movement.movementMovesRemaining=0;
    assert.equal(s.runtime.plan(s.soldier.id).mode,'move');assert.equal(s.run().success,true);
    assert.deepEqual(sent(s).map(e=>e.name),['UNITOPERATION_MOVE_TO','UNITOPERATION_MOVE_TO','UNITOPERATION_MOVE_TO','UNITCOMMAND_ADD_TO_ARMY']);
    assert(s.events.filter(e=>e.name==='restore').length>=3);
});
await test('Plot-query Success=false does not hide a valid targeted pack command',()=>{
    const s=setup();s.soldier.location=point(3);assert.equal(s.runtime.plan(s.soldier.id).mode,'add');assert.equal(s.run().success,true);assert.equal(sent(s).length,1);
});
await test('Targeted pack validation is required even when its plot is listed',()=>{
    const s=setup({rejectTarget:true,noPath:true});s.soldier.location=point(3);assert.equal(s.runtime.plan(s.soldier.id),null);
});
await test('Native reinforcement remains a fallback and confirms the target army',()=>{
    const s=setup({native:true,noPath:true});assert.equal(s.runtime.plan(s.soldier.id).mode,'reinforce');const result=s.run();assert.equal(result.success,true);assert.match(result.reason,/travel timer/);
});
await test('Walking is preferred over delayed native reinforcement',()=>{
    const s=setup({native:true});assert.equal(s.runtime.plan(s.soldier.id).mode,'move');assert.equal(s.run().success,true);assert(!sent(s).some(e=>e.name==='UNITOPERATION_REINFORCE_ARMY'));
});
await test('Full nearby commanders are skipped for another commander with room',()=>{
    const s=setup();s.armies[0].combatUnitCapacity=0;const c=s.addCommander(11,7);assert(equalId(s.runtime.plan(s.soldier.id).commanderId,c.id));assert.equal(s.run().success,true);assert(equalId(s.soldier.armyId,c.armyId));
});
await test('Incoming reinforcements reserve the actual army capacity',()=>{
    const s=setup();s.armies[0].combatUnitCapacity=1;s.addSoldier(2,8,{incoming:10,isOnMap:false});assert.equal(s.runtime.plan(s.soldier.id),null);
});
await test('Commander and civilian army members do not consume combat capacity',()=>{
    const s=setup();s.armies[0].combatUnitCapacity=1;const c=s.addSoldier(2,4,{type:'CIVILIAN',armyId:s.commander.armyId,isOnMap:false});s.armies[0].members.push(c.id);assert.equal(s.run().success,true);
});
await test('Civilians, commanders, packed units and incoming units are excluded',()=>{
    const s=setup();assert.equal(s.runtime.plan(s.commander.id),null);
    const civilian=s.addSoldier(2,0,{type:'CIVILIAN'}),packed=s.addSoldier(3,0,{armyId:s.commander.armyId}),incoming=s.addSoldier(4,0,{incoming:10});
    s.armies[0].members.push(packed.id);for(const u of [civilian,packed,incoming])assert.equal(s.runtime.plan(u.id),null);
});
await test('Foreign units and foreign commanders cannot be selected',()=>{
    const s=setup();const foreign=s.addSoldier(2,0,{owner:1,id:id(2,1)});assert.equal(s.runtime.plan(foreign.id),null);s.commander.owner=1;assert.equal(s.runtime.plan(s.soldier.id),null);
});
await test('Ships find fleet commanders instead of land commanders',()=>{
    const s=setup();s.soldier.type='SHIP';assert.equal(s.runtime.plan(s.soldier.id),null);const c=s.addCommander(12,6,2,{type:'FLEET'});assert(equalId(s.runtime.plan(s.soldier.id).commanderId,c.id));
});
await test('Empty, partial and discontinuous paths are not treated as zero-cost routes',()=>{
    for(const option of ['noPath','partialPath','jumpPath']){const s=setup({[option]:true});assert.equal(s.runtime.plan(s.soldier.id),null);}
});
await test('One failing route does not prevent checking other legal routes',()=>{
    const s=setup();const original=s.g.Units.getPathTo;s.g.Units.getPathTo=(unit,dest)=>{if(dest.x===4)throw new Error('unreachable');return original(unit,dest);};assert.equal(s.run().success,true);
});
await test('Movement cannot start a war or attack a unit',()=>{
    for(const option of ['war','combat']){const s=setup({[option]:true});assert.equal(s.runtime.plan(s.soldier.id),null);assert.equal(sent(s).length,0);}
});
await test('Moves are freshly checked before sending after target state changes',()=>{
    const s=setup();const action=s.runtime.plan(s.soldier.id);s.commander.location=point(6);assert.equal(s.runtime.send(action),false);assert.equal(sent(s).length,0);
});
await test('Missing army and reinforcement IDs cannot accidentally confirm dispatch',()=>{
    const s=setup();s.g.Players.get(0).Armies.getUnitReinforcementCommanderId=()=>undefined;assert.equal(s.runtime.state(s.soldier.id,{armyId:id(99,0,1)}).dispatched,false);
});
await test('Unconfirmed requests time out without being counted or resent',()=>{
    const s=setup({noConfirm:true});const result=s.run();assert.equal(result.success,false);assert.match(result.reason,/not confirmed/);assert.equal(sent(s).length,1);
});
await test('A dead unit is not counted as a reinforcement',()=>{
    const s=setup({noConfirm:true});s.runner.start(s.soldier.id,(ok)=>s.outcome=ok);s.clock.next();s.units.splice(s.units.indexOf(s.soldier),1);s.runner.wake();s.clock.drain();assert.equal(s.outcome,false);assert.equal(sent(s).length,1);
});
await test('Map removal without an army assignment is not success',()=>{
    const s=setup({noConfirm:true});s.runner.start(s.soldier.id,(ok)=>s.outcome=ok);s.clock.next();s.soldier.isOnMap=false;s.clock.drain();assert.equal(s.outcome,false);
});
await test('Asynchronous movement restoration is awaited',()=>{
    const s=setup({restoreDelay:200});s.soldier.Movement.movementMovesRemaining=0;assert.equal(s.run().success,true);
});
await test('Unavailable movement restoration terminates with a reason',()=>{
    const s=setup({noRestore:true});s.soldier.Movement.movementMovesRemaining=0;const r=s.run();assert.equal(r.success,false);assert.match(r.reason,/could not be restored/);assert.equal(sent(s).length,0);
});
await test('Changing local player stops the active runner',()=>{
    const s=setup();s.runner.start(s.soldier.id,(ok)=>s.outcome=ok);s.g.GameContext.localPlayerID=1;s.clock.drain();assert.equal(s.outcome,false);assert.equal(sent(s).length,0);
});
await test('Duplicate starts and wake events do not duplicate orders',()=>{
    const s=setup({inline:true});s.runner.start(s.soldier.id,(ok)=>s.outcome=ok);assert.equal(s.runner.start(s.soldier.id,()=>{}),false);s.runner.wake();s.runner.wake();s.clock.drain();assert.equal(s.outcome,true);assert.equal(sent(s).length,4);
});
await test('Explicit false or thrown sends terminate without automatic retry',()=>{
    for(const option of ['sendFalse','sendThrows']){const s=setup({[option]:true});assert.equal(s.run().success,false);assert.equal(sent(s).length,1);}
});
await test('Already visited path tiles are not used to loop a soldier indefinitely',()=>{
    const s=setup();assert.equal(s.runtime.plan(s.soldier.id,new Set(['1:0'])),null);
});
await test('Missing commanders and unavailable routes have useful explanations',()=>{
    const s=setup();s.commander.isOnMap=false;assert.match(s.runtime.explain(),/No local commanders/);s.commander.isOnMap=true;assert.match(s.runtime.explain(),/capacity, domain, and routes/);
});

// Load the actual action singleton and movement controller in an isolated UI VM.
async function integration(options={}) {
    const s=setup(options);const status=[];
    const context=vm.createContext({...s.g,console:{log(){},warn(){},error(){}},setTimeout:s.clock.schedule,clearTimeout:s.clock.unschedule,
        Date:class extends Date {static now(){return s.clock.time;}},requestAnimationFrame:fn=>s.clock.schedule(fn,16),cancelAnimationFrame:s.clock.unschedule,
        engine:{whenReady:{then(){}},on:(name,fn)=>{if(!s.listeners.has(name))s.listeners.set(name,[]);s.listeners.get(name).push(fn);}},
        document:{querySelector:()=>null,querySelectorAll:()=>[]},window:{addEventListener(){},removeEventListener(){}},Autoplay:{isActive:false},
        DirectionTypes:Object.fromEntries(['EAST','NORTHEAST','NORTHWEST','WEST','SOUTHWEST','SOUTHEAST'].map((d,i)=>['DIRECTION_'+d,i]))});
    const stubs={
        '/core/ui/context-manager/context-manager.js':{default:{}},'/core/ui/interface-modes/interface-modes.js':{InterfaceMode:{}},
        '/core/ui/utilities/utilities-component-id.js':{ComponentID:{isValid:i=>i?.id>=0,isMatch:equalId}},
        './storage.js':{Storage:{get:()=>null,set(){}}},'./console.js':{Console:{}},'./logs.js':{Logs:{}},
        './attribute-spending.js':{AttributeSpending:{}},'./building-automation.js':{BuildingAutomation:{}},
    };
    const cache=new Map();
    async function load(name) {
        if(cache.has(name))return cache.get(name);
        let m;
        if(stubs[name]) {const values=stubs[name];m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context});}
        else m=new vm.SourceTextModule(fs.readFileSync(new URL('../ui/'+name.replace('./',''),import.meta.url),'utf8'),{context,identifier:name});
        cache.set(name,m);await m.link(load);return m;
    }
    const main=await load('./actions.js');await main.evaluate();
    const actions=main.namespace.Actions,movement=cache.get('./infinite-movement.js').namespace.InfiniteMovement;
    actions.setCommanderStatus=text=>status.push(text);actions.refreshSelectedUnitUI=()=>{};actions.scheduleCommanderStatusReset=()=>{};
    actions.registerCommanderAdminListeners();
    return {...s,actions,movement,status,MovementController:cache.get('./infinite-movement.js').namespace.InfiniteMovementController};
}
await test('Actual button enables movement, walks multiple soldiers, packs them, then restores Off',async()=>{
    const s=await integration();s.addSoldier(2,0);s.soldier.Movement.movementMovesRemaining=0;
    s.actions.map['reinforce-all-units']();assert.equal(s.movement.isEnabled,true);s.clock.drain();
    assert.equal(s.armies[0].members.length,3);assert.equal(s.movement.isEnabled,false);assert.equal(s.actions.temporaryInfiniteMovementBorrowCounts.size,0);
    assert.match(s.status.at(-1),/2 reinforced, 0 skipped/);
});
await test('Actual button preserves an already enabled movement setting',async()=>{
    const s=await integration();s.movement.enable();s.soldier.Movement.movementMovesRemaining=0;s.actions.reinforceAllAvailableUnits();s.clock.drain();assert.equal(s.movement.isEnabled,true);assert.equal(s.armies[0].members.length,2);
});
await test('Rapid button clicks borrow movement only once',async()=>{
    const s=await integration();s.actions.reinforceAllAvailableUnits();s.actions.reinforceAllAvailableUnits();assert.equal(s.actions.getTemporaryInfiniteMovementBorrowCount('reinforce-all-units'),1);s.clock.drain();assert.equal(s.movement.isEnabled,false);assert.equal(sent(s).length,4);
});
await test('Actual button waits for delayed initial movement before scanning paths',async()=>{
    const s=await integration({restoreDelay:200});s.soldier.Movement.movementMovesRemaining=0;
    const original=s.g.Units.getPathTo;s.g.Units.getPathTo=(unit,dest)=>s.g.Units.get(unit).Movement.movementMovesRemaining<=0?{plots:[]}:original(unit,dest);
    s.actions.reinforceAllAvailableUnits();s.clock.drain();assert.match(s.status.at(-1),/1 reinforced, 0 skipped/);
});
await test('Global infinite movement ignores enemy, full, and off-map units',async()=>{
    const s=await integration();const foreign=s.addSoldier(2,0,{id:id(2,1),owner:1});foreign.Movement.movementMovesRemaining=0;
    s.movement.enable();s.events.length=0;s.emit('UnitMovementPointsChanged',{unit:foreign.id});s.emit('UnitMovementPointsChanged',{unit:s.soldier.id});
    s.soldier.isOnMap=false;s.soldier.Movement.movementMovesRemaining=0;s.emit('UnitMovementPointsChanged',{unit:s.soldier.id});assert.equal(s.events.length,0);
});
await test('Infinite movement guards synchronous recursive events and never cancels orders',async()=>{
    const s=await integration();s.movement.enable();s.soldier.Movement.movementMovesRemaining=0;let restores=0;
    s.g.Units.restoreMovement=unit=>{restores++;s.emit('UnitMovementPointsChanged',{unit});};s.emit('UnitMovementPointsChanged',{unit:s.soldier.id});assert.equal(restores,1);assert.equal(sent(s).length,0);
});
await test('Map-removal event in actual action queue cannot prematurely count success',async()=>{
    const s=await integration({noConfirm:true});s.actions.reinforceAllAvailableUnits();s.clock.next();s.clock.next();
    s.emit('UnitRemovedFromMap',{unit:s.soldier.id});assert.equal(s.actions.manualReinforcementSucceeded,0);assert(s.actions.reinforcementInFlight);
    s.clock.drain();assert.match(s.status.at(-1),/0 reinforced, 1 skipped/);assert.equal(s.movement.isEnabled,false);
});
await test('No compatible commander releases temporary movement and reports the constraint',async()=>{
    const s=await integration();s.armies[0].combatUnitCapacity=0;s.actions.reinforceAllAvailableUnits();s.clock.drain();assert.equal(s.movement.isEnabled,false);assert.match(s.status.at(-1),/capacity, domain, and routes/);assert.equal(sent(s).length,0);
});
await test('An unrelated status refresh cannot finish a pending movement preparation',async()=>{
    const s=await integration({restoreDelay:200});s.soldier.Movement.movementMovesRemaining=0;
    s.actions.reinforceAllAvailableUnits();s.actions.finishManualAdminStatusIfIdle();assert.equal(s.actions.manualReinforcementRequested,true);assert.equal(s.movement.isEnabled,true);
    s.clock.drain();assert.match(s.status.at(-1),/1 reinforced, 0 skipped/);assert.equal(s.movement.isEnabled,false);
});
await test('Local player changes during preparation stop the button sweep',async()=>{
    const s=await integration();s.actions.reinforceAllAvailableUnits();s.g.GameContext.localPlayerID=1;s.clock.drain();
    assert.match(s.status.at(-1),/local player changed/);assert.equal(s.movement.isEnabled,false);assert.equal(sent(s).length,0);
});
await test('A restoration error does not latch the controller or stop restoring other units',async()=>{
    const s=await integration();s.soldier.Movement.movementMovesRemaining=0;s.commander.Movement.movementMovesRemaining=0;
    const original=s.g.Units.restoreMovement;s.g.Units.restoreMovement=unit=>{if(equalId(unit,s.soldier.id))throw new Error('unit unavailable');original(unit);};
    s.movement.enable();assert.equal(s.commander.Movement.movementMovesRemaining,2);assert.equal(s.movement.restoring.size,0);s.g.Units.restoreMovement=original;assert.equal(s.movement.restoreUnit(s.soldier.id),true);
});
const report={passed:tests.filter(t=>t.passed).length,failed:tests.filter(t=>!t.passed).length,tests};
fs.writeFileSync(new URL('./civ7-reinforcement-tests.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,failed:report.failed,failures:tests.filter(t=>!t.passed)},null,2));process.exitCode=report.failed?1:0;
