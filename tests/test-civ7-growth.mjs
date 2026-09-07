import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CityGrowthController } from '../ui/city-growth.js';

// Offline settlement simulator. Every test runs the actual controller against
// fresh snapshots and native-style delayed mutations; no game/save is accessed.
class Clock {
    time=0; sequence=0; tasks=new Map();
    schedule=(fn,delay=0)=>{const id=++this.sequence;this.tasks.set(id,{fn,due:this.time+delay});return id;};
    unschedule=id=>this.tasks.delete(id);
    next(){const entry=[...this.tasks].sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];if(!entry)return false;this.tasks.delete(entry[0]);this.time=entry[1].due;entry[1].fn();return true;}
    until(time){let count=0;while([...this.tasks.values()].some(t=>t.due<=time)){this.next();assert(++count<20000,'growth queue did not terminate');}this.time=Math.max(this.time,time);}
    drain(){let count=0;while(this.next())assert(++count<20000,'growth queue did not terminate');}
}
const key=id=>`${id.owner}:${id.id}:${id.type}`;
const id=(n,owner=0)=>({id:n,owner,type:1});
const location=plot=>({x:plot,y:0});
function setup(specs=[{}],options={}){
    const clock=new Clock(),events=[],listeners=new Map(),renders=[],reports=[];
    let playerId=options.playerId??0;
    const cities=specs.map((spec,i)=>({id:id(spec.id??i+10,spec.owner??0),owner:spec.owner??0,name:spec.name??`Settlement ${i+1}`,
        population:spec.population??1,ready:spec.ready??false,ruralPlots:[...(spec.existingRural??[])],ruralSlots:[...(spec.rural??[101+i*100])],
        workers:(spec.workers??[]).map(w=>({plot:w.plot,count:w.count??0,max:w.max??1})),spec,inspections:0,removed:false}));
    const plotOwners=new Map(cities.flatMap(city=>city.ruralPlots.map(plot=>[plot,key(city.id)])));
    const find=cityId=>cities.find(city=>!city.removed&&key(city.id)===key(cityId));
    const requireCity=(cityId,owner)=>{const city=find(cityId);if(!city||city.owner!==owner||city.id.owner!==owner)throw new Error('Settlement ownership changed');return city;};
    const emit=(name='CityPopulationChanged',data={})=>{for(const handler of [...(listeners.get(name)??[])])handler(data);};
    const announce=city=>{for(const name of ['CityPopulationChanged','CityGrowth','CityWorkerChanged','CityYieldChanged','CityAddedToMap'])emit(name,{city:city.id,player:city.owner});};
    const candidates=city=>[
        ...city.ruralSlots.filter(plot=>!city.ruralPlots.includes(plot)
            &&(!options.sharedPlots||!plotOwners.has(plot)||plotOwners.get(plot)===key(city.id)))
            .map(plot=>({kind:'rural',plot,location:location(plot)})),
        ...city.workers.filter(worker=>worker.count<worker.max).map(worker=>({kind:'specialist',plot:worker.plot,location:location(worker.plot)})),
    ];
    const applyPlacement=(city,candidate)=>{
        if(candidate.kind==='rural'){
            assert(city.ruralSlots.includes(candidate.plot),'rural placement targeted an unavailable plot');
            assert(!city.ruralPlots.includes(candidate.plot),'duplicate rural placement');
            if(options.sharedPlots)assert(!plotOwners.has(candidate.plot)||plotOwners.get(candidate.plot)===key(city.id),'another settlement already owns this rural plot');
            city.ruralPlots.push(candidate.plot);plotOwners.set(candidate.plot,key(city.id));
        }else{const worker=city.workers.find(w=>w.plot===candidate.plot);assert(worker&&worker.count<worker.max,'specialist placement exceeded target capacity');worker.count++;}
        city.ready=false;city.spec.afterPlace?.(city,candidate);announce(city);
    };
    const later=(city,kind,fn)=>{const delay=city.spec[`${kind}Delay`]??options[`${kind}Delay`]??60;if(options.inline||city.spec.inline)fn();else clock.schedule(fn,delay);};
    const runtime={
        localPlayerId:()=>playerId,
        cityIds:owner=>cities.filter(city=>!city.removed&&city.owner===owner).map(city=>({...city.id})),
        inspect(cityId,owner){
            const city=requireCity(cityId,owner);city.inspections++;city.spec.onInspect?.(city);
            if(city.spec.inspectThrows)throw new Error('Native placement snapshot unavailable');
            return {name:city.name,ready:city.ready,population:city.population,ruralAvailable:city.spec.ruralAvailable??true,ruralPlots:[...city.ruralPlots],
                workers:city.workers.map(w=>({plot:w.plot,count:w.count})),candidates:candidates(city)};
        },
        grant(cityId,owner){
            const city=requireCity(cityId,owner);events.push({kind:'grant',city:city.id.id,at:clock.time});
            assert(!city.ready,'granted population while a citizen was already ready');
            assert(candidates(city).length||city.spec.ruralAvailable===false,'granted population despite known zero capacity');
            if(city.spec.grantFalse||options.grantFalse)return false;
            if(city.spec.grantThrows||options.grantThrows)throw new Error('Growth grant has an uncertain outcome');
            if(city.spec.dropGrant||options.dropGrant)return true;
            later(city,'grant',()=>{
                if(city.removed)return;
                city.population++;
                if(city.spec.populationOnly||options.populationOnly){announce(city);return;}
                if(city.spec.autoAssign||options.autoAssign){
                    const available=candidates(city);const amount=city.spec.autoAssignCount??options.autoAssignCount??1;
                    for(const candidate of available.slice(0,amount))applyPlacement(city,candidate);
                    city.spec.afterGrant?.(city);announce(city);return;
                }
                city.ready=true;city.spec.afterGrant?.(city);announce(city);
            });return true;
        },
        place(cityId,candidate,owner){
            const city=requireCity(cityId,owner);events.push({kind:'place',city:city.id.id,candidate:{...candidate},at:clock.time});
            if(city.spec.placeFalse||options.placeFalse||city.spec.rejectedPlots?.includes(candidate.plot))return false;
            assert(city.ready,'placed a citizen before native readiness');
            assert(candidates(city).some(c=>c.kind===candidate.kind&&c.plot===candidate.plot),'placement was not freshly legal');
            if(city.spec.placeThrows||options.placeThrows)throw new Error('Growth placement has an uncertain outcome');
            if(city.spec.dropPlace||options.dropPlace)return true;
            later(city,'place',()=>{if(!city.removed)applyPlacement(city,candidate);});return true;
        },
        on(name,handler){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(handler);},
        off(name,handler){listeners.get(name)?.delete(handler);},
    };
    const controller=new CityGrowthController(()=>runtime,{schedule:clock.schedule,unschedule:clock.unschedule,now:()=>clock.time,
        render:(...args)=>renders.push(args),report:(...args)=>reports.push(args)});
    const run=()=>{controller.start();clock.drain();};
    return {controller,runtime,clock,events,cities,renders,reports,listeners,emit,announce,run,plotOwners,
        setPlayer:value=>{playerId=value;},setOwnership:(city,owner)=>{city.owner=owner;},candidates};
}
const tests=[];
async function test(name,fn){try{await fn();tests.push({name,passed:true});}catch(error){tests.push({name,passed:false,error:error.stack});}}
const ops=(s,kind)=>s.events.filter(e=>e.kind===kind);
const counts=(s,rural,specialists)=>{assert.equal(s.controller.count.rural,rural);assert.equal(s.controller.count.specialists,specialists);};
const stopped=s=>assert.equal(s.controller.running,false);
const notMaxed=s=>assert(!/\b(?:all|every)\b.*\b(?:max(?:ed|imum)?|fully grown|complete)\b/i.test(s.controller.message),'a blocked run must not claim maximum completion');

async function actionsFixture(s){
    const context=vm.createContext({console:{log(){},warn(){},error(){}},engine:{whenReady:{then(){}}},
        GameContext:{localPlayerID:0},Players:{get:()=>({})},document:{querySelector:()=>null,querySelectorAll:()=>[]},
        setTimeout:s.clock.schedule,clearTimeout:s.clock.unschedule,requestAnimationFrame:fn=>s.clock.schedule(fn,16)});
    const stubs={
        '/core/ui/context-manager/context-manager.js':{default:{}},
        '/core/ui/interface-modes/interface-modes.js':{InterfaceMode:{}},
        '/core/ui/utilities/utilities-component-id.js':{ComponentID:{}},
        '/core/ui-next/services/focus-manager.js':{FocusManager:{}},
        './storage.js':{Storage:{get:()=>null,set(){}}},'./console.js':{Console:{}},'./logs.js':{Logs:{}},
        './infinite-movement.js':{InfiniteMovement:{toggle(){}}},'./attribute-spending.js':{AttributeSpending:{toggle(){}}},
        './building-automation.js':{BuildingAutomation:{toggle(){}}},'./city-growth.js':{CityGrowth:s.controller},
        './reinforcement.js':{createReinforcementRuntime(){},ReinforcementRunner:class{}},
    };
    const actionsModule=new vm.SourceTextModule(fs.readFileSync(new URL('../ui/actions.js',import.meta.url),'utf8'),{context});
    await actionsModule.link(name=>{
        assert(stubs[name],`unstubbed Actions dependency ${name}`);const exports=stubs[name];
        return new vm.SyntheticModule(Object.keys(exports),function(){for(const [name,value]of Object.entries(exports))this.setExport(name,value);},{context});
    });await actionsModule.evaluate();
    return actionsModule.namespace.Actions;
}

await test('Every legal rural plot and specialist slot is exhausted with confirmed counts',()=>{
    const s=setup([{rural:[1,2],workers:[{plot:3,max:2},{plot:4,max:1}]}]);s.run();
    assert.equal(ops(s,'grant').length,5);assert.equal(ops(s,'place').length,5);counts(s,2,3);assert.equal(s.candidates(s.cities[0]).length,0);stopped(s);
});
await test('Already ready population is placed before any extra growth grant',()=>{
    const s=setup([{ready:true,rural:[1,2]}]);s.run();assert.equal(s.events[0].kind,'place');assert.equal(ops(s,'grant').length,1);counts(s,2,0);stopped(s);
});
await test('No population is granted when the settlement has no legal placement candidates',()=>{
    const s=setup([{rural:[],workers:[{plot:1,count:2,max:2}]}]);s.run();assert.equal(s.events.length,0);counts(s,0,0);assert(s.cities[0].inspections>=2);stopped(s);
});
await test('Capacity hidden before readiness is revealed by one confirmed growth grant',()=>{
    const s=setup([{rural:[],ruralAvailable:false,afterGrant:city=>{city.spec.ruralAvailable=true;city.ruralSlots=[1,2];}}]);s.run();
    assert.equal(ops(s,'grant').length,2);assert.equal(ops(s,'place').length,2);counts(s,2,0);assert.equal(s.controller.blocked.size,0);stopped(s);
});
await test('Unknown capacity that never becomes ready permits only one unconfirmed grant',()=>{
    const s=setup([{rural:[],ruralAvailable:false}],{dropGrant:true});s.run();assert.equal(ops(s,'grant').length,1);assert.equal(ops(s,'place').length,0);
    assert(s.controller.pending.size>0);assert(s.controller.blocked.size>0);counts(s,0,0);notMaxed(s);stopped(s);
    s.controller.start();s.clock.drain();assert.equal(ops(s,'grant').length,1);notMaxed(s);stopped(s);
});
await test('A capacity probe that reveals no slots reports its unplaced citizen without granting again',()=>{
    const s=setup([{rural:[],ruralAvailable:false,afterGrant:city=>{city.spec.ruralAvailable=true;}}]);s.run();
    assert.equal(ops(s,'grant').length,1);assert.equal(ops(s,'place').length,0);assert.equal(s.cities[0].ready,true);assert.equal(s.controller.unplaced.size,1);
    assert.equal(s.controller.blocked.size,0);assert.match(s.controller.message,/unplaced population/i);counts(s,0,0);stopped(s);
    s.controller.start();s.clock.drain();assert.equal(ops(s,'grant').length,1);assert.equal(s.controller.unplaced.size,1);assert.match(s.controller.message,/unplaced population/i);stopped(s);
});
await test('Still-unknown capacity after a ready probe blocks with no second population grant',()=>{
    const s=setup([{rural:[],ruralAvailable:false}]);s.run();assert.equal(ops(s,'grant').length,1);assert.equal(ops(s,'place').length,0);
    assert.equal(s.cities[0].ready,true);assert(s.controller.blocked.size>0);counts(s,0,0);notMaxed(s);stopped(s);
    s.controller.start();s.clock.drain();assert.equal(ops(s,'grant').length,1);assert(s.controller.blocked.size>0);notMaxed(s);stopped(s);
});
await test('Synchronous grants, placements and repeated events do not duplicate requests',()=>{
    const s=setup([{rural:[1,2],workers:[{plot:3,max:2}]}],{inline:true});s.run();assert.equal(ops(s,'grant').length,4);assert.equal(ops(s,'place').length,4);counts(s,2,2);stopped(s);
});
await test('Repeated start calls and event bursts preserve one active controller',()=>{
    const s=setup([{rural:[1]}],{grantDelay:700,placeDelay:700});s.controller.start();s.controller.start();s.clock.until(100);
    for(let i=0;i<10;i++){s.controller.start();s.announce(s.cities[0]);}assert.equal(ops(s,'grant').length,1);s.clock.drain();counts(s,1,0);assert.equal(ops(s,'grant').length,1);assert.equal(ops(s,'place').length,1);stopped(s);
});
await test('Multiple settlements make progress fairly instead of draining only the first',()=>{
    const s=setup([{rural:[1,2,3]},{rural:[4,5,6]}]);s.run();counts(s,6,0);const firstSecond=s.events.findIndex(e=>e.city===11);
    const thirdFirst=s.events.findIndex((e,index)=>e.city===10&&e.kind==='place'&&s.events.slice(0,index).filter(x=>x.city===10&&x.kind==='place').length===2);
    assert(firstSecond>=0&&firstSecond<thirdFirst,'second settlement was starved until the first finished');stopped(s);
});
await test('A slow settlement does not prevent independent ready settlements from progressing',()=>{
    const s=setup([{rural:[1],grantDelay:1800},{rural:[2],ready:true}]);s.controller.start();s.clock.until(1000);
    assert(s.cities[1].ruralPlots.includes(2));assert(!s.cities[0].ruralPlots.includes(1));s.clock.drain();counts(s,2,0);stopped(s);
});
await test('A scheduled tick batches eight independent settlements and continues the remaining cities fairly',()=>{
    const s=setup(Array.from({length:20},()=>({})),{grantDelay:700});s.controller.start();s.clock.next();
    assert.equal(ops(s,'grant').length,8);assert.equal(s.controller.pending.size,8);
    assert.equal(new Set(ops(s,'grant').map(e=>e.at)).size,1);
    s.clock.next();assert.equal(ops(s,'grant').length,16);
    s.clock.next();assert.equal(ops(s,'grant').length,20);assert.equal(s.controller.pending.size,20);
    assert.deepEqual(ops(s,'grant').map(e=>e.city),s.cities.map(c=>c.id.id));
    s.clock.until(600);assert.equal(ops(s,'grant').length,20);assert.equal(ops(s,'place').length,0);
    s.clock.drain();counts(s,20,0);assert.equal(ops(s,'grant').length,20);assert.equal(ops(s,'place').length,20);stopped(s);
});
await test('Shared border plots are reserved so another ready city selects an independent alternative',()=>{
    const s=setup([{ready:true,rural:[1]},{ready:true,rural:[1,2]}],{sharedPlots:true,placeDelay:600});
    s.controller.start();s.clock.next();
    assert.deepEqual(ops(s,'place').map(e=>[e.city,e.candidate.plot]),[[10,1],[11,2]]);
    assert.equal(s.controller.pending.size,2);s.clock.until(500);assert.equal(ops(s,'place').length,2);
    s.clock.drain();counts(s,2,0);assert.equal(ops(s,'grant').length,0);stopped(s);
});
await test('A city waits for a reserved sole border plot and then refreshes ownership instead of transferring it',()=>{
    const s=setup([{ready:true,rural:[1]},{ready:true,rural:[1]}],{sharedPlots:true,placeDelay:600});
    s.controller.start();s.clock.next();assert.equal(ops(s,'place').length,1);
    assert.equal(s.controller.pending.size,1);assert.equal(s.controller.full.size,0);assert.equal(s.controller.blocked.size,0);
    s.clock.until(500);assert.equal(ops(s,'place').length,1);assert.equal(s.controller.full.size,0);
    s.clock.drain();counts(s,1,0);assert.equal(ops(s,'place').length,1);assert.equal(ops(s,'grant').length,0);
    assert.deepEqual(s.cities[1].ruralPlots,[]);assert.equal(s.plotOwners.get(1),key(s.cities[0].id));stopped(s);
});
await test('A timed-out expansion reservation blocks dependent cities without creating new population',()=>{
    const s=setup([{ready:true,rural:[1],dropPlace:true},{rural:[1]}],{sharedPlots:true});s.run();
    assert.equal(ops(s,'place').length,1);assert.equal(ops(s,'grant').length,0);assert.equal(s.controller.pending.size,1);
    assert.equal(s.controller.blocked.size,2);assert.match(s.controller.message,/waiting for unconfirmed expansion/);counts(s,0,0);stopped(s);
    s.controller.start();s.clock.drain();assert.equal(ops(s,'place').length,1);assert.equal(ops(s,'grant').length,0);stopped(s);
});
await test('Reservations survive Stop and resume until late proof confirms the original placement',()=>{
    const s=setup([{ready:true,rural:[1]},{ready:true,rural:[1]}],{sharedPlots:true,placeDelay:600});
    s.controller.start();s.clock.next();assert.equal(ops(s,'place').length,1);s.controller.stop();
    s.controller.start();s.clock.until(500);assert.equal(ops(s,'place').length,1);assert.equal(s.controller.pending.size,1);
    s.clock.drain();counts(s,1,0);assert.equal(ops(s,'place').length,1);assert.equal(s.controller.pending.size,0);stopped(s);
});
await test('Pending population grants do not reserve land until an actual expansion is sent',()=>{
    const s=setup([{rural:[1]},{rural:[1]}],{sharedPlots:true,grantDelay:400,placeDelay:600});
    s.controller.start();s.clock.next();assert.equal(ops(s,'grant').length,2);
    assert.equal(s.controller.pending.size,2);assert([...s.controller.pending.values()].every(p=>p.kind==='grant'));
    s.clock.drain();assert.equal(ops(s,'place').length,1);assert.equal(ops(s,'grant').length,2);counts(s,1,0);stopped(s);
});
await test('The per-tick wall budget yields between expensive city inspections without starving later cities',()=>{
    const s=setup(Array.from({length:10},()=>({})),{grantDelay:700});
    for(const city of s.cities)city.spec.onInspect=()=>{s.clock.time+=2;};
    s.controller.start();s.clock.next();assert.equal(ops(s,'grant').length,2);
    assert.equal(s.controller.index,2);assert.equal(s.controller.pending.size,2);
    s.clock.next();assert.equal(ops(s,'grant').length,4);
    s.clock.drain();counts(s,10,0);assert.equal(ops(s,'grant').length,10);stopped(s);
});
await test('A city taking longer than the wall budget still makes one bounded step per tick',()=>{
    const s=setup([{rural:[1]},{rural:[2]}],{grantDelay:700});
    for(const city of s.cities)city.spec.onInspect=()=>{s.clock.time+=8;};
    s.controller.start();s.clock.next();assert.equal(ops(s,'grant').length,1);assert.equal(s.controller.index,1);
    s.clock.next();assert.equal(ops(s,'grant').length,2);
    s.clock.drain();counts(s,2,0);stopped(s);
});
await test('Duplicate settlement IDs never advance the same city twice in a batch',()=>{
    const s=setup([{rural:[1,2]},{rural:[3]}],{inline:true});
    const list=s.runtime.cityIds;s.runtime.cityIds=owner=>{const ids=list(owner);return[...Array(8).fill(ids[0]),ids[1],ids[1]];};
    s.controller.start();s.clock.next();assert.equal(ops(s,'grant').length,2);assert.equal(ops(s,'place').length,0);
    assert.equal(s.controller.pending.size,2);s.clock.drain();counts(s,3,0);stopped(s);
});
await test('Native growth events preempt a later poll while bursts preserve one earliest timer',()=>{
    const s=setup([{rural:[1]}],{grantDelay:60});s.controller.start();s.clock.next();
    const oldTimer=s.controller.timer;assert.equal(s.controller.timerDue,125);
    s.clock.next();assert.equal(s.clock.time,85);assert.equal(s.controller.timerDue,110);
    assert(!s.clock.tasks.has(oldTimer),'later poll was not cancelled');
    const earlier=s.controller.timer;
    for(let i=0;i<20;i++)s.announce(s.cities[0]);s.controller.queue(500);
    assert.equal(s.controller.timer,earlier);assert.equal(s.controller.timerDue,110);assert.equal(s.clock.tasks.size,1);
    s.clock.drain();counts(s,1,0);assert.equal(ops(s,'grant').length,1);assert.equal(ops(s,'place').length,1);stopped(s);
});
await test('A stop during a synchronous batch dispatch prevents later cities and keeps its pending request',()=>{
    const s=setup(Array.from({length:10},()=>({})),{grantDelay:700});const grant=s.runtime.grant;
    s.runtime.grant=(...args)=>{const result=grant(...args);s.controller.stop();return result;};
    s.controller.start();s.clock.next();assert.equal(ops(s,'grant').length,1);assert.equal(s.controller.pending.size,1);
    stopped(s);assert.equal(s.controller.timer,null);assert.equal(s.controller.timerDue,null);assert.match(s.controller.message,/Stopped/);
    s.clock.drain();assert.equal(ops(s,'place').length,0);assert.equal(ops(s,'grant').length,1);
});
await test('A player change during a batch dispatch prevents every subsequent city request',()=>{
    const s=setup(Array.from({length:10},()=>({})),{grantDelay:700});const grant=s.runtime.grant;
    s.runtime.grant=(...args)=>{const result=grant(...args);s.setPlayer(1);return result;};
    s.controller.start();s.clock.next();assert.equal(ops(s,'grant').length,1);assert.equal(s.controller.pending.size,1);stopped(s);
    s.clock.drain();assert.equal(ops(s,'place').length,0);assert.match(s.controller.message,/local player changed/);
});
await test('A player change or stop while inspecting a city prevents even that city from dispatching',()=>{
    for(const mode of ['player','stop']){
        const s=setup([{rural:[1]},{rural:[2]}]);
        s.cities[0].spec.onInspect=()=>{if(mode==='player')s.setPlayer(1);else s.controller.stop();};
        s.controller.start();s.clock.drain();assert.equal(s.events.length,0);assert.equal(s.controller.pending.size,0);stopped(s);
    }
});
await test('A confirmed placement reaching the guard halts the remainder of its batch',()=>{
    const s=setup([{ready:true,rural:[1]},{ready:true,rural:[2]}],{inline:true});s.controller.start();s.clock.next();
    assert.equal(ops(s,'place').length,2);assert.equal(s.controller.pending.size,2);
    s.controller.count={rural:49999,specialists:0};s.clock.next();stopped(s);
    assert.equal(s.controller.count.rural,50000);assert.equal(s.controller.pending.size,1);
    assert.equal(ops(s,'place').length,2);assert.match(s.controller.message,/operation guard/);
});
await test('Growth automatically assigned by the game needs no duplicate placement command',()=>{
    const s=setup([{rural:[1,2]}],{autoAssign:true});s.run();assert.equal(ops(s,'grant').length,2);assert.equal(ops(s,'place').length,0);counts(s,2,0);stopped(s);
});
await test('Automatic assignment counters reflect actual rural and worker deltas',()=>{
    const s=setup([{rural:[1],workers:[{plot:2,max:1}]}],{autoAssign:true,autoAssignCount:2});s.run();assert.equal(ops(s,'grant').length,1);assert.equal(ops(s,'place').length,0);counts(s,1,1);stopped(s);
});
await test('A population increase without readiness or assigned slots cannot confirm a grant',()=>{
    const s=setup([{rural:[1]}],{populationOnly:true});s.run();assert.equal(ops(s,'grant').length,1);assert.equal(ops(s,'place').length,0);counts(s,0,0);assert(s.controller.blocked.size>0);assert(s.controller.pending.size>0);notMaxed(s);stopped(s);
});
await test('A grant timeout retains its uncertain request instead of granting again',()=>{
    const s=setup([{rural:[1]}],{dropGrant:true});s.run();assert.equal(ops(s,'grant').length,1);assert(s.controller.pending.size>0);assert(s.controller.blocked.size>0);counts(s,0,0);
    s.controller.start();s.clock.drain();assert.equal(ops(s,'grant').length,1);notMaxed(s);stopped(s);
});
await test('A placement timeout is not counted and never becomes a second population grant',()=>{
    const s=setup([{ready:true,rural:[1]}],{dropPlace:true});s.run();assert.equal(ops(s,'grant').length,0);assert.equal(ops(s,'place').length,1);counts(s,0,0);assert(s.controller.pending.size>0);assert(s.controller.blocked.size>0);notMaxed(s);stopped(s);
});
await test('Unrelated rural growth cannot confirm the requested specialist placement',()=>{
    const s=setup([{ready:true,rural:[],workers:[{plot:3,max:1}]}],{dropPlace:true});s.controller.start();s.clock.until(100);assert.equal(ops(s,'place').length,1);
    s.cities[0].ruralPlots.push(99);s.cities[0].population++;s.announce(s.cities[0]);s.clock.drain();assert.equal(ops(s,'place').length,1);counts(s,0,0);assert(s.controller.blocked.size>0);notMaxed(s);stopped(s);
});
await test('Worker growth on another tile cannot confirm the requested specialist placement',()=>{
    const s=setup([{ready:true,rural:[],workers:[{plot:3,max:1},{plot:4,max:1}]}],{dropPlace:true});s.controller.start();s.clock.until(100);const target=ops(s,'place')[0].candidate.plot;
    s.cities[0].workers.find(w=>w.plot!==target).count++;s.announce(s.cities[0]);s.clock.drain();assert.equal(ops(s,'place').length,1);counts(s,0,0);assert(s.controller.blocked.size>0);stopped(s);
});
await test('Stopping and resuming during a grant preserves the pending mutation',()=>{
    const s=setup([{rural:[1]}],{grantDelay:600});s.controller.start();s.clock.until(100);assert.equal(ops(s,'grant').length,1);s.controller.stop();stopped(s);assert(s.controller.pending.size>0);
    s.clock.drain();assert.equal(ops(s,'place').length,0);s.controller.start();s.clock.drain();assert.equal(ops(s,'grant').length,1);assert.equal(ops(s,'place').length,1);counts(s,1,0);stopped(s);
});
await test('Stopping and resuming during placement counts its late confirmation once',()=>{
    const s=setup([{ready:true,rural:[1]}],{placeDelay:600});s.controller.start();s.clock.until(100);assert.equal(ops(s,'place').length,1);s.controller.stop();assert(s.controller.pending.size>0);
    s.clock.drain();s.controller.start();s.clock.drain();assert.equal(ops(s,'place').length,1);assert.equal(ops(s,'grant').length,0);counts(s,1,0);stopped(s);
});
await test('A timed-out grant can reconcile later proof on restart without a second grant',()=>{
    const s=setup([{rural:[1]}],{dropGrant:true});s.run();assert.equal(ops(s,'grant').length,1);s.cities[0].population++;s.cities[0].ready=true;
    s.controller.start();s.clock.drain();assert.equal(ops(s,'grant').length,1);assert.equal(ops(s,'place').length,1);counts(s,1,0);stopped(s);
});
await test('Toggle stops ongoing work and starts it again without losing pending commands',()=>{
    const s=setup([{rural:[1]}],{grantDelay:600});s.controller.toggle();assert.equal(s.controller.running,true);s.clock.until(100);s.controller.toggle();stopped(s);
    s.clock.drain();s.controller.toggle();s.clock.drain();assert.equal(ops(s,'grant').length,1);counts(s,1,0);stopped(s);
});
await test('New placement options unlocked by growth are discovered from fresh state',()=>{
    const s=setup([{rural:[1],afterPlace:(city,candidate)=>{if(candidate.plot===1)city.ruralSlots.push(2);}}]);s.run();counts(s,2,0);assert.equal(ops(s,'grant').length,2);stopped(s);
});
await test('The second quiet pass catches specialist capacity becoming available late',()=>{
    const s=setup([{rural:[],workers:[{plot:3,count:0,max:0}],onInspect:city=>{if(city.inspections===2)city.workers[0].max=1;}}]);s.run();counts(s,0,1);assert.equal(ops(s,'grant').length,1);stopped(s);
});
await test('Existing rural tiles and worker counts are not included in this run counts',()=>{
    const s=setup([{existingRural:[1],rural:[1,2],workers:[{plot:3,count:2,max:3}]}]);s.run();counts(s,1,1);assert.equal(ops(s,'grant').length,2);stopped(s);
});
await test('A blocked city cannot hide successful growth in another city',()=>{
    const s=setup([{rural:[1],dropGrant:true},{rural:[2]}]);s.run();assert(s.cities[1].ruralPlots.includes(2));counts(s,1,0);assert(s.controller.blocked.size>0);notMaxed(s);stopped(s);
});
await test('Rejected or thrown grants terminate without repeated uncertain mutations',()=>{
    for(const flag of ['grantFalse','grantThrows']){const s=setup([{rural:[1]}],{[flag]:true});s.run();
        // false explicitly means no mutation occurred, so a bounded fresh retry
        // is safe. A thrown request remains uncertain and must never repeat.
        if(flag==='grantThrows')assert.equal(ops(s,'grant').length,1);else assert(ops(s,'grant').length>=1&&ops(s,'grant').length<=5);
        assert.equal(ops(s,'place').length,0);counts(s,0,0);assert(s.controller.blocked.size>0);notMaxed(s);stopped(s);}
});
await test('Rejected or thrown placement requests cannot be counted as completed',()=>{
    for(const flag of ['placeFalse','placeThrows']){const s=setup([{ready:true,rural:[1]}],{[flag]:true});s.run();assert.equal(ops(s,'place').length,1);counts(s,0,0);assert(s.controller.blocked.size>0);notMaxed(s);stopped(s);}
});
await test('A definitely rejected first candidate does not hide a legal later candidate',()=>{
    const s=setup([{ready:true,rural:[1,2],rejectedPlots:[1]}]);s.run();assert(s.cities[0].ruralPlots.includes(2));assert(!s.cities[0].ruralPlots.includes(1));counts(s,1,0);
    assert(s.controller.blocked.size>0);assert(ops(s,'place').some(e=>e.candidate.plot===2));notMaxed(s);stopped(s);
});
await test('Missing rural availability blocks a completion claim when no known slots remain',()=>{
    const s=setup([{ready:true,rural:[],ruralAvailable:false}]);s.run();assert.equal(s.events.length,0);assert(s.controller.blocked.size>0);assert.match(s.controller.message,/unavailable|blocked/i);counts(s,0,0);notMaxed(s);stopped(s);
});
await test('Known specialist capacity remains usable while rural availability is missing',()=>{
    const s=setup([{rural:[],ruralAvailable:false,workers:[{plot:3,max:2}]}]);s.run();counts(s,0,2);assert.equal(ops(s,'place').length,2);assert(s.controller.blocked.size>0);notMaxed(s);stopped(s);
});
await test('An unreadable city snapshot is reported while other settlements remain usable',()=>{
    const s=setup([{rural:[1],inspectThrows:true},{rural:[2]}]);s.run();assert(s.cities[1].ruralPlots.includes(2));counts(s,1,0);assert(s.controller.blocked.size>0);notMaxed(s);stopped(s);
});
await test('Changing the local player stops requests for the previous player',()=>{
    const s=setup([{rural:[1]}],{grantDelay:600});s.controller.start();s.clock.until(100);s.setPlayer(1);s.clock.drain();assert.equal(ops(s,'grant').length,1);assert.equal(ops(s,'place').length,0);counts(s,0,0);stopped(s);
});
await test('Losing settlement ownership after a grant never sends a placement to it',()=>{
    const s=setup([{rural:[1]}],{grantDelay:600});s.controller.start();s.clock.until(100);s.setOwnership(s.cities[0],1);s.clock.drain();assert.equal(ops(s,'place').length,0);counts(s,0,0);stopped(s);
});
await test('Foreign settlements are excluded from both growth and placement',()=>{
    const s=setup([{rural:[1]},{owner:1,rural:[2]}]);s.run();assert(s.events.every(event=>event.city===10));assert.equal(s.cities[1].population,1);counts(s,1,0);stopped(s);
});
await test('No local settlements terminate without grants or fictitious counts',()=>{
    const s=setup([]);s.run();assert.equal(s.events.length,0);counts(s,0,0);stopped(s);
});
await test('A completed run does not leave a permanent automatic growth listener',()=>{
    const s=setup([{rural:[1]}]);s.run();s.cities[0].ruralSlots.push(2);s.announce(s.cities[0]);s.clock.drain();assert.equal(ops(s,'grant').length,1);counts(s,1,0);stopped(s);
});
await test('The global operation guard stops every settlement before another dispatch',()=>{
    const s=setup([{rural:[1]},{ready:true,rural:[2]}]);s.controller.start();s.controller.count={rural:49999,specialists:1};s.clock.drain();
    assert.equal(s.events.length,0);assert.equal(s.cities[0].population,1);assert.equal(s.cities[1].ruralPlots.length,0);stopped(s);
    assert.match(s.controller.message,/operation guard/i);assert.match(s.controller.message,/not.*exhausted/i);notMaxed(s);
});
await test('Reaching the global guard preserves existing pending requests without further placements',()=>{
    const s=setup([{rural:[1]},{rural:[2]}],{grantDelay:600});s.controller.start();s.clock.until(100);const issued=s.events.length;
    assert(issued>0);assert(s.controller.pending.size>0);s.controller.count={rural:50000,specialists:0};s.clock.drain();
    assert.equal(s.events.length,issued);assert.equal(ops(s,'place').length,0);assert(s.controller.pending.size>0);stopped(s);
    assert.match(s.controller.message,/operation guard/i);assert.match(s.controller.message,/not.*exhausted/i);notMaxed(s);
});
await test('Actual Actions.addPopulation repeatedly starts growth without cancelling pending work',async()=>{
    const s=setup([{rural:[1]}],{grantDelay:600});const actions=await actionsFixture(s);
    actions.addPopulation();actions.addPopulation();assert.equal(s.controller.running,true);s.clock.until(100);actions.addPopulation();assert.equal(s.controller.running,true);
    s.clock.drain();assert.equal(ops(s,'grant').length,1);assert.equal(ops(s,'place').length,1);counts(s,1,0);stopped(s);
});
await test('The actual manual population button toggles Stop and resumes the same pending request',async()=>{
    const s=setup([{rural:[1]}],{grantDelay:600});const actions=await actionsFixture(s);actions.map['add-population']();s.clock.until(100);
    actions.map['add-population']();stopped(s);assert(s.controller.pending.size>0);s.clock.drain();assert.equal(ops(s,'place').length,0);
    actions.map['add-population']();s.clock.drain();assert.equal(ops(s,'grant').length,1);assert.equal(ops(s,'place').length,1);counts(s,1,0);stopped(s);
});
await test('Full empire maintenance uses idempotent growth start rather than the manual toggle',async()=>{
    const s=setup([{rural:[1]}],{grantDelay:600});const actions=await actionsFixture(s);
    for(const method of ['addGold','addInfluence','addHappiness','startGoldenAge','completeProduction','healUnits','addXp','reinforceAllAvailableUnits','upgradeAllAvailableUnits','completeAllResearchAndCivics'])actions[method]=()=>{};
    actions.getCommanderUnits=()=>[];actions.scheduleEmpireStatusReset=()=>{};
    actions.map['run-empire-maintenance']();s.clock.until(100);actions.map['run-empire-maintenance']();assert.equal(s.controller.running,true);
    s.clock.drain();assert.equal(ops(s,'grant').length,1);assert.equal(ops(s,'place').length,1);counts(s,1,0);stopped(s);
});

const report={passed:tests.filter(t=>t.passed).length,failed:tests.filter(t=>!t.passed).length,failures:tests.filter(t=>!t.passed)};
console.log(JSON.stringify(report,null,2));process.exitCode=report.failed?1:0;
