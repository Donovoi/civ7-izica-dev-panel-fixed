# Izica's Civilization VII dev panel (fixed)

This working copy includes the original dev/cheat panel and these additions:

- **Spend all attribute points:** completes available non-repeatable upgrades first, then balances repeatable bonuses across branches until no more points can be spent. Click again to stop.
- **Build all buildings + wonders:** purchases or instantly completes available buildings across settlements, prioritizing urgent needs, unique quarters, advisor recommendations, and yields before remaining buildings and wonders. Placement uses the game's legal plots and protects available wonder space. Click again to stop.
- **Grow all cities:** adds population one growth step at a time, fills legal rural tiles, then fills available specialist slots. It rechecks every settlement until the game reports no further slots, including capacity unlocked during growth. Existing pending population is placed first, and tiles belonging to another settlement are excluded. Click again to stop; uncertain requests are checked before resuming.
- **Reinforce all:** temporarily enables infinite movement, walks eligible soldiers to compatible commanders with space, and packs them using the game's commands. Each movement/assignment is confirmed before continuing. Native reinforcement travel is a fallback when walking is unavailable. The previous infinite-movement setting is restored after the sweep.
- **Upgrade all military:** upgrades regular units and spends every available commander promotion/commendation point, checking prerequisites and confirming each purchased node. Commanders with no legal upgrade report a skipped result. The dedicated commander button uses the same spending path.
- **Full empire maintenance:** includes full city growth and the military sweep, and waits for its XP grant to reach commander state before scanning. Maintenance requested during another upgrade sweep schedules a follow-up so newly granted points are not missed. Repeated maintenance/autoplay growth requests leave an active growth sweep running.
- Current UI module imports replace obsolete `.chunk.js` imports. Infinite movement only restores local units and no longer cancels their orders or changes selection.

## Install

Copy `izica-dev-panel.modinfo`, `data/`, and `ui/` into a folder named `izica-dev-panel` under your Civilization VII Mods directory. On Windows this is normally:

```text
%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\Mods\izica-dev-panel
```

Back up an existing mod installation before replacing it. Restart the game after updating. The repository root must be the mod folder; avoid an extra nested folder between it and the `.modinfo` file. The `tests/` directory and Node/Python tools are for development and are not needed by the game.

The panel retains the original keyboard bindings. Its existing recovery shortcut is Ctrl+1 and B if the panel position or size needs resetting.

## Validation

The current changes passed 205 offline checks: 29 attribute, 42 building, 37 reinforcement, 28 commander, and 69 growth tests. Native API usage was compared with the locally installed game's UI modules and definitions. These checks simulate game responses; successful execution in a live save has not yet been verified. Real commander capacity, terrain, unit domains, building eligibility, and placement rules still apply. Native reinforcement fallback retains the game's travel timer.

The tests use Node.js (validated with Node 24) and Python 3's standard library. No npm dependencies are required. First generate attribute test data from your own game installation; generated game data is ignored by Git:

```powershell
python tests/generate-attribute-fixture.py "C:\Program Files (x86)\Steam\steamapps\common\Sid Meier's Civilization VII\Base\modules\base-standard\data"
npm test
```

Adjust the game path if it is installed elsewhere. Building, reinforcement, commander, and growth tests can also run independently without an installed game:

```text
node tests/test-civ7-buildings.mjs
node --experimental-vm-modules tests/test-civ7-reinforcement.mjs
node --experimental-vm-modules tests/test-civ7-commanders.mjs
node --experimental-vm-modules tests/test-civ7-growth.mjs
node tests/test-civ7-growth-runtime.mjs
```

The reinforcement, commander, and growth tests use Node's experimental VM modules to load the actual action singleton against isolated game API stubs. None of these tests connect to a running game or edit a save.

Growth uses the installed game's food-queue completion command and native `EXPAND` / `ASSIGN_WORKER` requests. Specialized towns retain their focus and use the game's separate rural-population grant. Each request must produce readiness or actual district/worker changes before another is sent. If expansion plots are hidden before population is ready, one growth step reveals placement capacity. If there are then no slots, the final population point remains unplaced and the status says so; repeated runs do not keep adding population. Missing APIs, rejected targets, or unconfirmed requests report a blocked settlement instead of claiming it reached maximum size. There is no hardcoded population or specialist cap; current legal plots and worker limits determine capacity.

Live-save checks still needed for growth: whether `EXPAND` returns its full plot list before population is ready, whether a focused town's direct grant exposes a placement, and asynchronous placement behavior during concurrent building automation. The shipped UI demonstrates the request signatures but does not expose the underlying native implementations. An unconfirmed grant is retained without automatic retries.
