# Izica's Civilization VII dev panel (fixed)

This working copy includes the original dev/cheat panel and these additions:

- **Spend all attribute points:** completes available non-repeatable upgrades first, then balances repeatable bonuses across branches until no more points can be spent. Click again to stop.
- **Build all buildings + wonders:** purchases or instantly completes available buildings across settlements, prioritizing urgent needs, unique quarters, advisor recommendations, and yields before remaining buildings and wonders. Placement uses the game's legal plots and protects available wonder space. Click again to stop.
- **Reinforce all:** temporarily enables infinite movement, walks eligible soldiers to compatible commanders with space, and packs them using the game's commands. Each movement/assignment is confirmed before continuing. Native reinforcement travel is a fallback when walking is unavailable. The previous infinite-movement setting is restored after the sweep.
- Current UI module imports replace obsolete `.chunk.js` imports. Infinite movement only restores local units and no longer cancels their orders or changes selection.

## Install

Copy `izica-dev-panel.modinfo`, `data/`, and `ui/` into a folder named `izica-dev-panel` under your Civilization VII Mods directory. On Windows this is normally:

```text
%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\Mods\izica-dev-panel
```

Back up an existing mod installation before replacing it. Restart the game after updating. The repository root must be the mod folder; avoid an extra nested folder between it and the `.modinfo` file. The `tests/` directory and Node/Python tools are for development and are not needed by the game.

The panel retains the original keyboard bindings. Its existing recovery shortcut is Ctrl+1 and B if the panel position or size needs resetting.

## Validation

The current changes passed 108 offline checks: 29 attribute, 42 building, and 37 reinforcement tests. Native API usage was compared with the locally installed game's UI modules and definitions. These checks simulate game responses; successful execution in a live save has not yet been verified. Real commander capacity, terrain, unit domains, building eligibility, and placement rules still apply. Native reinforcement fallback retains the game's travel timer.

The tests use Node.js (validated with Node 24) and Python 3's standard library. No npm dependencies are required. First generate attribute test data from your own game installation; generated game data is ignored by Git:

```powershell
python tests/generate-attribute-fixture.py "C:\Program Files (x86)\Steam\steamapps\common\Sid Meier's Civilization VII\Base\modules\base-standard\data"
npm test
```

Adjust the game path if it is installed elsewhere. Building and reinforcement tests can also run independently without an installed game:

```text
node tests/test-civ7-buildings.mjs
node --experimental-vm-modules tests/test-civ7-reinforcement.mjs
```

The reinforcement test uses Node's experimental VM modules to load the actual action singleton against isolated game API stubs. None of these tests connect to a running game or edit a save.
