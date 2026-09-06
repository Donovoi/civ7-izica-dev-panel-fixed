import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual button callbacks, promotion discovery, selection, dispatch,
// event handlers and queue. This simulator never opens Civ7 or modifies a save.
// Contracts follow the installed 1.4.2 stock panel-unit-promotion.js: availability
// uses type strings and canEarnPromotion(..., false); commit uses hashed payloads
// and a fresh UnitCommands.canStart check. Stored point getters are properties.
class Clock {
    time = 0; serial = 0; tasks = new Map();
    schedule = (fn, delay = 0) => { const id = ++this.serial; this.tasks.set(id, {fn, due:this.time + delay}); return id; };
    unschedule = id => this.tasks.delete(id);
    next() {
        const item = [...this.tasks].sort((a,b) => a[1].due-b[1].due || a[0]-b[0])[0];
        if (!item) return false;
        this.tasks.delete(item[0]); this.time = item[1].due; item[1].fn(); return true;
    }
    until(time) {
        let count = 0;
        while ([...this.tasks.values()].some(t => t.due <= time)) { this.next(); assert(++count < 20000, 'queue did not terminate'); }
        this.time = Math.max(this.time, time);
    }
    drain() { let count = 0; while (this.next()) assert(++count < 20000, 'queue did not terminate'); }
}
const component = (id,owner=0) => ({id,owner,type:0});
const equalId = (a,b) => !!a && !!b && a.id === b.id && a.owner === b.owner && a.type === b.type;
const hash = text => { let n=2166136261; for(const c of text)n=Math.imul(n ^ c.charCodeAt(0),16777619); return n >>> 0; };
const PROMOTE = 73001;
const NATIVE_COMMANDER_TYPE = -1404681544;
// Freeze the source for one test run so parallel edits cannot mix revisions.
const actionsSource = fs.readFileSync(new URL('../ui/actions.js',import.meta.url),'utf8');
const definitions = [
    {type:'PROMOTION_A_1',discipline:'DISCIPLINE_A'},
    {type:'PROMOTION_A_2',discipline:'DISCIPLINE_A',prerequisite:'PROMOTION_A_1'},
    {type:'PROMOTION_A_3',discipline:'DISCIPLINE_A',prerequisite:'PROMOTION_A_2'},
    {type:'PROMOTION_B_1',discipline:'DISCIPLINE_B'},
    {type:'PROMOTION_B_2',discipline:'DISCIPLINE_B',prerequisite:'PROMOTION_B_1'},
    {type:'COMMENDATION_A',discipline:'DISCIPLINE_A',commendation:true,prerequisite:'PROMOTION_A_1'},
];

async function integration(options={}) {
    const clock=new Clock(), listeners=new Map(), units=[], requests=[], grants=[], statuses=[], logs=[], eligibilityCalls=[], damageChanges=[], invalidUnitLookups=[];
    const unitDefinitions=new Map([
        ...['LAND','SEA','AIR'].map(domain=>['COMMANDER_'+domain,{UnitType:'COMMANDER_'+domain,PromotionClass:'CLASS_COMMANDER',CoreClass:'CORE_CLASS_SUPPORT',Domain:domain}]),
        [NATIVE_COMMANDER_TYPE,{UnitType:'COMMANDER_LAND',PromotionClass:'CLASS_COMMANDER',CoreClass:'CORE_CLASS_SUPPORT',Domain:'LAND'}],
        ...['SOLDIER','SOLDIER_UPGRADED'].map(type=>[type,{UnitType:type,CoreClass:'CORE_CLASS_MILITARY',Domain:'LAND'}]),
    ]);
    const allClassSets=['DISCIPLINE_A','DISCIPLINE_B'].map(d=>({PromotionClassType:'CLASS_COMMANDER',UnitPromotionDisciplineType:d}));
    const allDetails=definitions.map(d=>({UnitPromotionDisciplineType:d.discipline,UnitPromotionType:d.type,PrereqUnitPromotion:d.prerequisite}));
    const allPromotions=definitions.map((d,i)=>({UnitPromotionType:d.type,Name:d.type,Commendation:!!d.commendation,$hash:hash(d.type),$index:i}));
    const metadata={classSets:[...allClassSets],details:[...allDetails],promotions:[...allPromotions]};
    metadata.promotions.lookup=value=>metadata.promotions.find(row=>row.UnitPromotionType===value||row.$hash===value||row.$index===value);
    const setMetadata=({classSets,details,promotions}={})=>{
        if(classSets)metadata.classSets.splice(0,metadata.classSets.length,...classSets);
        if(details)metadata.details.splice(0,metadata.details.length,...details);
        if(promotions)metadata.promotions.splice(0,metadata.promotions.length,...promotions);
    };
    const restoreMetadata=()=>setMetadata({classSets:allClassSets,details:allDetails,promotions:allPromotions});
    let selected=null, selectedAt=-100, focused=null, interfaceMode='INTERFACEMODE_DEFAULT';
    const emit=(name,data)=>{ for(const fn of listeners.get(name)??[])fn(data); };
    const find=id=>units.find(u=>equalId(u.id,id));
    const nativeGet=value=>{
        if(value==null)return undefined;
        if(!Number.isInteger(value.id)||!Number.isInteger(value.owner)||!Number.isInteger(value.type)){
            invalidUnitLookups.push(value);throw new TypeError('Units.get requires a numeric ComponentID; got a nested unit object or malformed ID');
        }
        return find(value);
    };
    const canEarn=(u,discipline,type,excludeCost)=>{
        eligibilityCalls.push({discipline,type,excludeCost});
        assert.equal(typeof discipline,'string','native Experience requires discipline type strings');
        assert.equal(typeof type,'string','native Experience requires promotion type strings');
        assert.equal(excludeCost,false,'availability must enforce native point cost');
        const def=definitions.find(d=>d.type===type && d.discipline===discipline);
        return !!def && !u.xp.owned.has(type) && !u.xp.blocked.has(type) &&
            (!def.prerequisite || u.xp.owned.has(def.prerequisite)) &&
            (def.commendation?u.xp.commendations:u.xp.points)>0;
    };
    const addCommander=(n,points=0,extra={})=>{
        const u={id:component(n,extra.owner??0),owner:extra.owner??0,type:extra.type??'COMMANDER_LAND',name:'Commander '+n,
            isCommanderUnit:true,isOnMap:true,location:{x:n,y:0},armyId:{id:n,owner:extra.owner??0,type:1},
            Movement:{movementMovesRemaining:2,maxMoves:2},formationUpgrade:extra.formationUpgrade??false,xp:{points,commendations:extra.commendations??0,owned:new Set(extra.owned??[]),blocked:new Set(extra.blocked??[]),level:1,experience:0}};
        u.Experience={
            get canPromote(){return u.xp.points>0 || u.xp.commendations>0;},
            get getStoredPromotionPoints(){return u.xp.points;},
            get getStoredCommendations(){return u.xp.commendations;},
            get getLevel(){return u.xp.level;},
            get getTotalPromotionsEarned(){return u.xp.owned.size;},
            get experiencePoints(){return u.xp.experience;},
            get experienceToNextLevel(){return 10;},
            hasPromotion:(discipline,type)=>{assert.equal(typeof discipline,'string');assert.equal(typeof type,'string');return u.xp.owned.has(type);},
            canEarnPromotion:(discipline,type,excludeCost)=>canEarn(u,discipline,type,excludeCost),
        };
        units.push(u);return u;
    };
    const addSoldier=(n,extra={})=>{const u={id:component(n,extra.owner??0),owner:extra.owner??0,type:'SOLDIER',name:'Soldier '+n,isCommanderUnit:false,isOnMap:true,
        location:{x:n,y:0},Movement:{movementMovesRemaining:2,maxMoves:2},upgradeable:true,...extra};units.push(u);return u;};
    const commander=addCommander(10,options.points??3,{type:options.commanderType??'COMMANDER_LAND'});
    if(options.selected) {selected=commander.id;if(options.focused)focused=commander.id;}
    const canStart=(id,command,args)=>{
        const u=find(id); if(!u || u.owner!==g.GameContext.localPlayerID)return {Success:false};
        if(command==='UNITCOMMAND_UPGRADE')return {Success:!u.isCommanderUnit && u.upgradeable};
        if(command==='UNITCOMMAND_UPGRADE_ARMY')return {Success:u.isCommanderUnit && u.formationUpgrade && (!options.formationNeedsSelection || equalId(selected,id))};
        if(command!==PROMOTE)return {Success:false};
        const def=definitions.find(d=>hash(d.type)===args?.PromotionType && hash(d.discipline)===args?.PromotionDisciplineType);
        return {Success:!options.blockCommit && !!def && (options.permissiveCanStart || canEarn(u,def.discipline,def.type,false)) &&
            (!options.requireFocus || (equalId(selected,id) && equalId(focused,id) && clock.time-selectedAt>=16))};
    };
    const sendRequest=(id,command,args)=>{
        assert.equal(canStart(id,command,args).Success,true,'commit must freshly satisfy native canStart');
        requests.push({id:{...id},command,args:{...args},at:clock.time});
        if(options.sendThrows)throw new Error('native request outcome uncertain');
        if(options.sendFalse)return false;
        const u=find(id);
        if(options.earlyEvents && command===PROMOTE){emit('UnitPromoted',{unit:id});emit('UnitExperienceChanged',{unit:id});}
        if(options.noConfirm)return;
        if(command===PROMOTE){const def=definitions.find(d=>hash(d.type)===args.PromotionType);assert(canEarn(u,def.discipline,def.type,false),'the request selected a locked or unaffordable promotion');}
        const confirm=()=>{
            if(!find(id))return;
            if(command===PROMOTE){
                const def=definitions.find(d=>hash(d.type)===args.PromotionType);
                assert(!u.xp.owned.has(def.type),'duplicate promotion was sent before confirmation');
                u.xp.owned.add(def.type);if(def.commendation)u.xp.commendations--;else u.xp.points--;
                emit('UnitExperienceChanged',{unit:id});emit('UnitPromoted',{unit:id});
                if(options.duplicateEvents){emit('UnitPromoted',{unit:id});emit('UnitExperienceChanged',{unit:id});}
            }else if(command==='UNITCOMMAND_UPGRADE_ARMY'){u.formationUpgrade=false;emit('UnitCommandStarted',{unit:id,command:hash(command)});}
            else {u.type='SOLDIER_UPGRADED';u.upgradeable=false;emit('UnitCommandStarted',{unit:id,command:hash(command)});}
        };
        if(options.inline)confirm();else clock.schedule(confirm,options.confirmDelay??80);
    };
    const player={Units:{getUnitIds:()=>units.filter(u=>u.owner===0).map(u=>u.id),getUnits:()=>units.filter(u=>u.owner===0)},
        Armies:{getUnitReinforcementCommanderId:()=>-1},Diplomacy:{willMoveStartWar:()=>({Success:false})}};
    class Element {dispatchEvent(){return true;}focus(){}}
    const panel=new Element();
    const g={GameContext:{localPlayerID:0},Players:{get:id=>id===0?player:null},
        Units:{get:nativeGet,restoreMovement:id=>{const u=nativeGet(id);if(u)u.Movement.movementMovesRemaining=u.Movement.maxMoves;},
            setDamage:(id,amount)=>{assert(nativeGet(id),'setDamage received a missing unit');damageChanges.push({id,amount});},
            changeExperience:(id,amount)=>{grants.push({id,amount});const apply=()=>{const u=find(id);if(u?.isCommanderUnit){u.xp.points+=options.xpPoints??2;u.xp.level++;u.xp.experience+=amount;emit('UnitExperienceChanged',{unit:id});}};
                if(options.xpInline)apply();else clock.schedule(apply,options.xpDelay??500);}},
        GameInfo:{Units:{lookup:type=>unitDefinitions.get(type)},
            UnitPromotionClassSets:metadata.classSets,UnitPromotionDisciplineDetails:metadata.details,UnitPromotions:metadata.promotions},
        Database:{makeHash:hash},UnitCommandTypes:{PROMOTE},Game:{UnitCommands:{canStart,sendRequest}},
        UI:{Player:{getHeadSelectedUnit:()=>selected,selectUnit:id=>{if(!equalId(selected,id)){selected=id;selectedAt=clock.time;focused=null;}},deselectAllUnits:()=>{selected=null;focused=null;}}},
        Locale:{compose:text=>text},Element,HTMLElement:Element,Event:class {constructor(type){this.type=type;}},
        console:{log:(...x)=>logs.push(x.join(' ')),warn:(...x)=>logs.push(x.join(' ')),error:(...x)=>logs.push(x.join(' '))},
        setTimeout:clock.schedule,clearTimeout:clock.unschedule,requestAnimationFrame:fn=>clock.schedule(fn,16),cancelAnimationFrame:clock.unschedule,
        Date:class extends Date {static now(){return clock.time;}},
        engine:{whenReady:{then(){}},on:(name,fn,receiver)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(receiver?fn.bind(receiver):fn);}},
        document:{querySelector:selector=>selector.includes('unit-actions')?panel:null,querySelectorAll:()=>[]},
        window:{addEventListener(){},removeEventListener(){}},Autoplay:{isActive:false},
    };
    const context=vm.createContext(g);
    const stubs={
        '/core/ui/context-manager/context-manager.js':{default:{}},
        '/core/ui-next/services/focus-manager.js':{FocusManager:{get:()=>({setFocus:element=>{assert.equal(element,panel);focused=selected;}})}},
        '/core/ui/interface-modes/interface-modes.js':{InterfaceMode:{switchTo:mode=>{interfaceMode=mode;},getCurrent:()=>interfaceMode,switchToDefault:()=>{interfaceMode='INTERFACEMODE_DEFAULT';}}},
        // The stock helper checks sentinel values, not numeric shape. A unit
        // object therefore passes isValid even though Units.get rejects it.
        '/core/ui/utilities/utilities-component-id.js':{ComponentID:{isValid:id=>id!=null&&id.owner!=-1&&id.id!=-1,isMatch:equalId}},
        './storage.js':{Storage:{get:()=>null,set(){}}},'./console.js':{Console:{}},'./logs.js':{Logs:{}},
        './attribute-spending.js':{AttributeSpending:{}},'./building-automation.js':{BuildingAutomation:{}},
        './city-growth.js':{CityGrowth:{start(){},toggle(){},refreshStatus(){}}},
    };
    const cache=new Map();
    async function load(name){
        if(cache.has(name))return cache.get(name);
        let module;
        if(stubs[name]){const values=stubs[name];module=new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value);},{context});}
        else module=new vm.SourceTextModule(name==='./actions.js'?actionsSource:fs.readFileSync(new URL('../ui/'+name.replace('./',''),import.meta.url),'utf8'),{context,identifier:name});
        cache.set(name,module);await module.link(load);return module;
    }
    const module=await load('./actions.js');await module.evaluate();const actions=module.namespace.Actions;
    for(const kind of ['Commander','Units','Empire']){
        actions['set'+kind+'Status']=text=>statuses.push({kind,text,at:clock.time});
        actions['schedule'+kind+'StatusReset']=()=>{};
    }
    actions.refreshSelectedUnitUI=()=>{};
    // Scope isolation: empire still executes its real addXp and military actions.
    for(const method of ['addGold','addInfluence','addHappiness','startGoldenAge','completeProduction','addPopulation','healUnits','reinforceAllAvailableUnits','completeAllResearchAndCivics'])actions[method]=()=>{};
    actions.registerCommanderAdminListeners();
    const movement=cache.get('./infinite-movement.js').namespace.InfiniteMovement;
    const upgrade=()=>actions.map['upgrade-all-units']();
    const empire=()=>actions.map['run-empire-maintenance']();
    return {actions,g,clock,commander,units,addCommander,addSoldier,requests,grants,statuses,logs,emit,eligibilityCalls,movement,upgrade,empire,
        metadata,setMetadata,restoreMetadata,unitDefinitions,damageChanges,invalidUnitLookups};
}
const tests=[];
async function test(name,fn){try{await fn();tests.push({name,passed:true});}catch(error){tests.push({name,passed:false,error:error.stack});}}
const promotions=s=>s.requests.filter(r=>r.command===PROMOTE);
const idle=s=>{assert.equal(s.actions.commanderAdminInFlight,null);assert.equal(s.actions.commanderAdminQueue.length,0);assert.equal(s.actions.manualCommanderUpgradeRequested,false);assert.equal(s.actions.temporaryInfiniteMovementBorrowCounts.size,0);};
const failedStatus=s=>assert(s.statuses.some(s=>/skipp|fail|unconfirm|block|unavailable|remaining|paused|could not/i.test(s.text)), 'failure needs a visible explanation');

await test('Upgrade all military drains stored promotion points using the native hashed payload',async()=>{
    const s=await integration();s.upgrade();s.clock.drain();assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,3);
    for(const request of promotions(s)){assert.deepEqual(Object.keys(request.args).sort(),['PromotionDisciplineType','PromotionType']);assert(definitions.some(d=>hash(d.type)===request.args.PromotionType && hash(d.discipline)===request.args.PromotionDisciplineType));}
    assert(s.eligibilityCalls.length);idle(s);
});
await test('Discovery retains Experience-available promotions until selection and focus permit commit',async()=>{
    const s=await integration({requireFocus:true});s.upgrade();s.clock.drain();assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,3);assert(promotions(s)[0].at>=16);idle(s);
});
await test('An already selected commander retains the return value of temporary selection checks',async()=>{
    const s=await integration({selected:true,focused:true,requireFocus:true});assert.equal(s.actions.withTemporaryUnitSelection(s.commander.id,()=>123),123);
    s.upgrade();s.clock.drain();assert.equal(s.commander.xp.points,0);idle(s);
});
await test('Several land, naval and air commanders each spend all available points',async()=>{
    const s=await integration({requireFocus:true});const sea=s.addCommander(11,2,{type:'COMMANDER_SEA'}),air=s.addCommander(12,4,{type:'COMMANDER_AIR'});
    s.upgrade();s.clock.drain();for(const c of [s.commander,sea,air])assert.equal(c.xp.points,0);assert.equal(promotions(s).length,9);idle(s);
});
await test('Owned promotions and unmet prerequisites are excluded while remaining branches drain',async()=>{
    const s=await integration({points:4});s.commander.xp.owned.add('PROMOTION_A_1');s.upgrade();s.clock.drain();assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,4);
    assert(!promotions(s).some(r=>r.args.PromotionType===hash('PROMOTION_A_1')));idle(s);
});
await test('Regular promotion points and commendations use their separate pools',async()=>{
    const s=await integration({points:2});s.commander.xp.commendations=1;s.upgrade();s.clock.drain();assert.equal(s.commander.xp.points,0);assert.equal(s.commander.xp.commendations,0);assert(s.commander.xp.owned.has('COMMENDATION_A'));assert.equal(promotions(s).length,3);idle(s);
});
await test('Rapid repeated clicks preserve one sweep and one movement borrow',async()=>{
    const s=await integration({confirmDelay:500});s.upgrade();s.upgrade();assert(s.actions.getTemporaryInfiniteMovementBorrowCount('upgrade-all-units')<=1);
    s.clock.until(100);s.upgrade();s.upgrade();assert(s.actions.getTemporaryInfiniteMovementBorrowCount('upgrade-all-units')<=1);
    s.clock.drain();assert.equal(promotions(s).length,3);assert.equal(s.commander.xp.points,0);assert.equal(s.movement.isEnabled,false);idle(s);
});
await test('Inline native confirmation and duplicate engine events do not resend a promotion',async()=>{
    const s=await integration({inline:true,duplicateEvents:true});s.upgrade();s.clock.drain();assert.equal(promotions(s).length,3);assert.equal(s.commander.xp.points,0);idle(s);
});
await test('Early UnitPromoted events cannot confirm a request before hasPromotion changes',async()=>{
    const s=await integration({earlyEvents:true,confirmDelay:700});s.upgrade();s.clock.until(600);assert.equal(promotions(s).length,1);assert.equal(s.commander.xp.owned.size,0);
    s.clock.drain();assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,3);idle(s);
});
await test('An army-upgrade event cannot clear or duplicate an outstanding promotion',async()=>{
    const s=await integration({points:1,confirmDelay:700});s.upgrade();s.clock.until(100);const token=s.actions.commanderAdminInFlight?.token;
    assert(token);assert.equal(promotions(s).length,1);s.emit('UnitCommandStarted',{unit:s.commander.id,command:hash('UNITCOMMAND_UPGRADE_ARMY')});
    assert.equal(s.actions.commanderAdminInFlight?.token,token);s.clock.until(600);assert.equal(promotions(s).length,1);assert.equal(s.commander.xp.owned.size,0);
    s.clock.drain();assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,1);idle(s);
});
await test('An unrelated XP change cannot confirm or resend an unconfirmed promotion',async()=>{
    const s=await integration({points:1,noConfirm:true});s.upgrade();s.clock.until(100);s.commander.xp.points++;s.emit('UnitExperienceChanged',{unit:s.commander.id});s.clock.until(1500);
    assert.equal(promotions(s).length,1);assert.equal(s.commander.xp.owned.size,0);s.clock.drain();assert.equal(promotions(s).length,1);failedStatus(s);idle(s);
});
await test('Full empire maintenance spends points granted after its first military scan',async()=>{
    const s=await integration({points:0,xpDelay:500,xpPoints:2,requireFocus:true});s.empire();s.clock.drain();assert.equal(s.grants.length,1);assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,2);idle(s);
});
await test('Full empire maintenance catches delayed XP for multiple previously empty commanders',async()=>{
    const s=await integration({points:0,xpDelay:2200,xpPoints:2});const other=s.addCommander(11,0);s.empire();s.clock.drain();assert.equal(s.grants.length,2);
    assert.equal(s.commander.xp.points,0);assert.equal(other.xp.points,0);assert.equal(promotions(s).length,4);idle(s);
});
await test('Full empire maintenance retains immediate stored points and inline XP events',async()=>{
    const s=await integration({points:2,xpInline:true,xpPoints:1});s.empire();s.clock.drain();assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,3);idle(s);
});
await test('Maintenance requested during a military sweep still spends its later XP grant',async()=>{
    const s=await integration({points:1,confirmDelay:100,xpDelay:500,xpPoints:2});s.upgrade();s.clock.until(40);s.empire();s.clock.drain();
    assert.equal(s.grants.length,1);assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,3);idle(s);
});
await test('Completed maintenance does not leave a permanent automatic XP spending listener',async()=>{
    const s=await integration({points:0,xpPoints:1});s.empire();s.clock.drain();assert.equal(promotions(s).length,1);idle(s);
    s.commander.xp.points++;s.emit('UnitExperienceChanged',{unit:s.commander.id});s.clock.drain();assert.equal(promotions(s).length,1);assert.equal(s.commander.xp.points,1);idle(s);
});
await test('The dedicated commander upgrade button uses the same confirmed spending queue',async()=>{
    const s=await integration({requireFocus:true});s.actions.map['upgrade-commander']();s.clock.drain();assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,3);idle(s);
});
await test('Ordinary unit upgrades continue alongside commander promotions',async()=>{
    const s=await integration({requireFocus:true});const a=s.addSoldier(1),b=s.addSoldier(2);s.upgrade();s.clock.drain();assert.equal(s.commander.xp.points,0);
    for(const u of [a,b])assert.equal(u.type,'SOLDIER_UPGRADED');assert.equal(s.requests.filter(r=>r.command==='UNITCOMMAND_UPGRADE').length,2);idle(s);
});
await test('Formation-only commanders remain discoverable when army upgrades require selection',async()=>{
    const s=await integration({points:0,formationNeedsSelection:true});s.commander.formationUpgrade=true;s.upgrade();s.clock.drain();
    assert.equal(s.commander.formationUpgrade,false);assert.equal(promotions(s).length,0);assert.equal(s.requests.filter(r=>r.command==='UNITCOMMAND_UPGRADE_ARMY').length,1);idle(s);
});
await test('Zero points finish without commands or a retained movement override',async()=>{
    const s=await integration({points:0});s.upgrade();s.clock.drain();assert.equal(s.requests.length,0);assert.equal(s.movement.isEnabled,false);idle(s);
});
await test('Native-ineligible promotions are never sent even when points are stored',async()=>{
    const s=await integration({points:2});s.commander.xp.blocked=new Set(definitions.map(d=>d.type));s.upgrade();s.clock.drain();assert.equal(promotions(s).length,0);assert.equal(s.commander.xp.points,2);idle(s);
});
await test('Permissive command checks cannot bypass native promotion-tree prerequisites',async()=>{
    const s=await integration({points:2,permissiveCanStart:true});s.commander.xp.blocked.add('PROMOTION_A_1');s.upgrade();s.clock.drain();
    assert.deepEqual(promotions(s).map(r=>r.args.PromotionType),[hash('PROMOTION_B_1'),hash('PROMOTION_B_2')]);assert.equal(s.commander.xp.points,0);idle(s);
});
await test('Native commit refusal is bounded and reported without claiming promotions completed',async()=>{
    const s=await integration({blockCommit:true});s.upgrade();s.clock.drain();assert.equal(promotions(s).length,0);assert.equal(s.commander.xp.points,3);failedStatus(s);
    assert(!s.logs.some(line=>/Commander 10 finished upgrading\./.test(line)));idle(s);
});
await test('A missing confirmation times out once and leaves points unchanged',async()=>{
    const s=await integration({noConfirm:true});s.upgrade();s.clock.drain();assert.equal(promotions(s).length,1);assert.equal(s.commander.xp.points,3);failedStatus(s);idle(s);
});
await test('Thrown or explicitly rejected native sends terminate without automatic duplicates',async()=>{
    for(const option of ['sendThrows','sendFalse']){const s=await integration({[option]:true});s.upgrade();s.clock.drain();assert.equal(promotions(s).length,1);assert.equal(s.commander.xp.points,3);failedStatus(s);idle(s);}
});
await test('Foreign commanders never receive a promotion or a movement restore',async()=>{
    const s=await integration();const foreign=s.addCommander(11,3,{owner:1});s.upgrade();s.clock.drain();assert.equal(foreign.xp.points,3);assert(promotions(s).every(r=>r.id.owner===0));idle(s);
});
await test('Removing a commander during an unconfirmed request does not block the next commander',async()=>{
    const s=await integration({confirmDelay:500});const next=s.addCommander(11,1);s.upgrade();s.clock.until(100);s.units.splice(s.units.indexOf(s.commander),1);s.clock.drain();assert.equal(next.xp.points,0);idle(s);
});
await test('An existing infinite movement preference remains enabled after all promotions drain',async()=>{
    const s=await integration();s.movement.enable();s.upgrade();s.clock.drain();assert.equal(s.commander.xp.points,0);assert.equal(s.movement.isEnabled,true);idle(s);
});
await test('Numeric native commander unit types resolve their promotion class and spend points',async()=>{
    const s=await integration({commanderType:NATIVE_COMMANDER_TYPE,requireFocus:true});s.upgrade();s.clock.drain();
    assert.equal(s.commander.type,NATIVE_COMMANDER_TYPE);assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,3);idle(s);
});
await test('An initially empty promotion class table is refreshed after native data appears',async()=>{
    const s=await integration();s.setMetadata({classSets:[]});assert.equal(s.actions.getPromotionMetadataForClass('CLASS_COMMANDER').length,0);
    s.restoreMetadata();s.upgrade();s.clock.drain();assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,3);idle(s);
});
await test('Initially empty discipline details do not permanently cache an empty tree',async()=>{
    const s=await integration();s.setMetadata({details:[]});assert.equal(s.actions.getPromotionMetadataForClass('CLASS_COMMANDER').length,0);
    s.restoreMetadata();s.upgrade();s.clock.drain();assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,3);idle(s);
});
await test('Temporarily unavailable promotion definitions recover after native lookups hydrate',async()=>{
    const s=await integration();s.setMetadata({promotions:[]});assert.equal(s.actions.getPromotionMetadataForClass('CLASS_COMMANDER').length,0);
    s.restoreMetadata();s.upgrade();s.clock.drain();assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,3);idle(s);
});
await test('Partially loaded promotion definitions expand when the remaining nodes become available',async()=>{
    const s=await integration();s.setMetadata({promotions:s.metadata.promotions.filter(row=>row.UnitPromotionType==='PROMOTION_A_1')});
    assert.equal(s.actions.getPromotionMetadataForClass('CLASS_COMMANDER').length,1);s.restoreMetadata();
    assert.equal(s.actions.getPromotionMetadataForClass('CLASS_COMMANDER').length,definitions.length);s.upgrade();s.clock.drain();assert.equal(s.commander.xp.points,0);idle(s);
});
await test('A later military sweep sees discipline nodes that were missing during the previous sweep',async()=>{
    const s=await integration({points:2});s.setMetadata({details:s.metadata.details.filter(row=>row.UnitPromotionType==='PROMOTION_A_1')});s.upgrade();s.clock.drain();
    assert.equal(s.commander.xp.points,1);assert.equal(promotions(s).length,1);s.restoreMetadata();s.upgrade();s.clock.drain();
    assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,2);idle(s);
});
await test('An owned partial tree remains queued until its missing native definitions hydrate',async()=>{
    const s=await integration({points:1});s.commander.xp.owned.add('PROMOTION_A_1');
    s.setMetadata({promotions:s.metadata.promotions.filter(row=>row.UnitPromotionType==='PROMOTION_A_1')});
    s.clock.schedule(()=>s.restoreMetadata(),500);s.upgrade();s.clock.drain();
    assert.equal(s.commander.xp.points,0);assert.equal(promotions(s).length,1);assert(promotions(s)[0].at>=500);idle(s);
});
await test('Missing metadata with banked points terminates with an unknown-tree diagnostic',async()=>{
    const s=await integration({points:27,selected:true,commanderType:NATIVE_COMMANDER_TYPE});s.commander.xp.level=57;s.setMetadata({classSets:[]});
    s.actions.map['inspect-selected-commander']();s.upgrade();s.clock.drain();assert.equal(promotions(s).length,0);assert.equal(s.commander.xp.points,27);
    const text=[...s.logs,...s.statuses.map(x=>x.text)].join('\n');assert.match(text,/metadata.*(?:unavailable|unknown|missing|incomplete)|(?:unavailable|unknown|missing|incomplete).*metadata/i);
    assert(!s.logs.some(line=>/Commander 10 finished upgrading\./.test(line)));assert(!s.statuses.some(x=>/Commander upgrades finished|No local units or commanders can upgrade|No commanders need upgrades/i.test(x.text)));failedStatus(s);idle(s);
});
await test('Missing native unit definitions are distinguished from a fully purchased promotion tree',async()=>{
    const s=await integration({points:3,selected:true,commanderType:NATIVE_COMMANDER_TYPE});s.unitDefinitions.delete(NATIVE_COMMANDER_TYPE);
    s.actions.map['inspect-selected-commander']();s.upgrade();s.clock.drain();assert.equal(promotions(s).length,0);assert.equal(s.commander.xp.points,3);
    assert.match([...s.logs,...s.statuses.map(x=>x.text)].join('\n'),/unavailable|unknown|missing|incomplete/i);failedStatus(s);idle(s);
});
await test('A fully purchased native tree with surplus points sends no request and reports all nodes owned',async()=>{
    const s=await integration({points:27,selected:true,commanderType:NATIVE_COMMANDER_TYPE});s.commander.xp.level=57;s.commander.xp.owned=new Set(definitions.map(d=>d.type));
    s.actions.map['inspect-selected-commander']();s.upgrade();s.clock.drain();assert.equal(promotions(s).length,0);assert.equal(s.commander.xp.points,27);
    const text=[...s.logs,...s.statuses.map(x=>x.text)].join('\n');assert.match(text,/all[^\n]*(?:owned|purchased)|fully[^\n]*(?:purchased|promoted)|tree[^\n]*complete/i);
    const diagnostic=s.actions.getCommanderPromotionDiagnostics(s.commander);assert.equal(diagnostic.metadataAvailable,true);assert.equal(diagnostic.totalNodes,definitions.length);
    assert.equal(diagnostic.ownedRegular,5);assert.equal(diagnostic.ownedCommendations,1);assert.equal(diagnostic.unownedNodes,0);assert.equal(diagnostic.nativePromotionsEarned,definitions.length);idle(s);
});
await test('Autoplay mastery accepts a real commander object without passing it into Units.get',async()=>{
    const s=await integration({points:0,xpInline:true});assert.equal(s.actions.boostUnitForAutoplayMastery(s.commander),true);
    assert.equal(s.grants.length,1);assert(equalId(s.grants[0].id,s.commander.id));assert.equal(s.damageChanges.length,1);
    assert.equal(s.commander.xp.points,2);assert.equal(s.invalidUnitLookups.length,0);assert(s.actions.hasQueuedCommander(s.commander.id));
});
await test('Autoplay mastery accepts numeric ComponentIDs and regular unit objects',async()=>{
    const s=await integration({points:0,xpInline:true});const soldier=s.addSoldier(1);
    assert.equal(s.actions.boostUnitForAutoplayMastery(s.commander.id),true);assert.equal(s.actions.boostUnitForAutoplayMastery(soldier),true);
    assert.equal(s.grants.length,2);assert.equal(s.damageChanges.length,2);assert.equal(s.invalidUnitLookups.length,0);
    assert(s.grants.every(grant=>Number.isInteger(grant.id.id)&&Number.isInteger(grant.id.owner)));
});
await test('Commander XP grants resolve both unit objects and their component IDs',async()=>{
    const s=await integration({points:0,xpInline:true,xpPoints:1});assert.equal(s.actions.grantCommanderXp(s.commander,10000).didChange,true);
    assert.equal(s.actions.grantCommanderXp(s.commander.id,10000).didChange,true);assert.equal(s.grants.length,2);assert.equal(s.commander.xp.points,2);assert.equal(s.invalidUnitLookups.length,0);
});
await test('Direct experience and stored-point helpers distinguish objects from ComponentIDs',async()=>{
    const s=await integration({points:0,xpInline:true,xpPoints:1});assert.equal(s.actions.applyCommanderExperienceGrant(s.commander,10000).didChange,true);
    assert.equal(s.actions.applyCommanderExperienceGrant(s.commander.id,10000).didChange,true);
    // This fixture exposes no native point setter. Failure must be clean rather
    // than sending the whole unit object through the component-ID converter.
    assert.equal(s.actions.applyCommanderStoredPointGrant(s.commander,'promotion',1).didChange,false);
    assert.equal(s.actions.applyCommanderStoredPointGrant(s.commander.id,'promotion',1).didChange,false);
    assert.equal(s.grants.length,2);assert.equal(s.commander.xp.points,2);assert.equal(s.invalidUnitLookups.length,0);
});
await test('Malformed unit handles cannot trigger mastery healing or XP mutation',async()=>{
    const s=await integration({points:0,xpInline:true});
    for(const value of [null,undefined,{}, {owner:0,id:{}}, {owner:0,id:10,type:'0'}, {owner:0,id:{owner:0,id:10,type:'0'}}, component(999)]){
        assert.equal(s.actions.boostUnitForAutoplayMastery(value),false);assert.equal(s.actions.grantCommanderXp(value,10000).didChange,false);
        assert.equal(s.actions.applyCommanderExperienceGrant(value,10000).didChange,false);assert.equal(s.actions.applyCommanderStoredPointGrant(value,'promotion',1).didChange,false);
    }
    assert.equal(s.grants.length,0);assert.equal(s.damageChanges.length,0);assert.equal(s.invalidUnitLookups.length,0);
});
await test('Display names and regular upgrade discovery accept actual unit objects',async()=>{
    const s=await integration();const soldier=s.addSoldier(1);
    assert.equal(s.actions.getUnitDisplayName(s.commander),'Commander 10');assert.equal(s.actions.getUnitDisplayName(s.commander.id),'Commander 10');
    const available=s.actions.getUpgradeableUnits([s.commander,soldier]);assert.equal(available.length,1);assert(equalId(available[0].id,soldier.id));assert.equal(s.invalidUnitLookups.length,0);
});
await test('Passive commander counts do not borrow unit selection for context-dependent army upgrades',async()=>{
    const s=await integration({points:0,formationNeedsSelection:true});s.commander.formationUpgrade=true;let selections=0;
    const select=s.g.UI.Player.selectUnit;s.g.UI.Player.selectUnit=id=>{selections++;select(id);};
    assert.equal(s.actions.getCommandersWithAdminActionsCount(false),0);assert.equal(selections,0);
    assert.equal(s.actions.getCommandersWithAdminActionsCount(true),1);assert(selections>0);assert.equal(s.invalidUnitLookups.length,0);
});

const report={passed:tests.filter(t=>t.passed).length,failed:tests.filter(t=>!t.passed).length,failures:tests.filter(t=>!t.passed)};
console.log(JSON.stringify(report,null,2));process.exitCode=report.failed?1:0;
