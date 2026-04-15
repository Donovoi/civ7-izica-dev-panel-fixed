# Izica's Dev/Cheat Panel (Fixed)

This repository contains a fixed and expanded version of **Izica's Civilization VII dev/cheat panel**.

It adds an in-game panel with quick buttons for common testing, debugging, and sandbox actions such as giving yourself resources, finishing production, completing research, healing units, running autoplay, and more.

The mod metadata describes this fork as the version **fixed by Lottililex**, including the wildcard attribute point improvement so you no longer have to wait around for the game UI to catch up before spending the point.

## What it is

This mod adds:

- a **bottom-of-screen dev panel**
- an optional **embedded console/log view**
- **hotkeys** for the most common actions
- **saved panel settings** for visibility, console state, font size, and horizontal position

The panel is intended for:

- testing game systems quickly
- sandbox or cheat-style play
- debugging UI/gameplay behavior
- speeding up repeated setup steps while modding

## What has been done in this fixed version

Based on the files in this repository, this version includes:

- the original dev/cheat panel UI and hotkeys
- a fix for the old **wildcard attribute point** behavior so the point is granted and the attribute screen is refreshed promptly when needed
- saved panel state through local storage, including:
  - panel open/closed state
  - console open/closed state
  - font size
  - panel left position
- commander automation actions with visible status text
- autoplay helpers that can run admin/cleanup actions before autoplay takes over
- an embedded console that captures `console.log` and `console.error` output into the panel

## Installation

There is no build step in this repository.

To use the mod:

1. Place this mod folder in your Civilization VII mods directory.
2. Enable the mod in-game.
3. Load into a game.
4. Use the panel and hotkeys listed below.

If the panel is missing or off-screen, use **Ctrl+1** to reset its size/position, then press **B** to toggle it.

## Panel options

The panel is split into groups.

### Settings

| Option | What it does |
| --- | --- |
| `+` | Increase the panel font size |
| `-` | Decrease the panel font size |
| `<` | Move the panel left |
| `>` | Move the panel right |

### Resources

| Option | What it does |
| --- | --- |
| `+1,000,000 Gold` | Grants 1,000,000 gold to the local player |
| `+1,000,000 Influence` | Grants 1,000,000 influence / diplomacy balance |
| `+1 point` | Grants 1 wildcard attribute point and refreshes the attribute UI when needed |
| `+100` | Adds happiness / celebration progress for the local player |

### Cities

| Option | What it does |
| --- | --- |
| `Complete` | Completes current production in every local city |
| `+1 pop` | Adds 1 rural population to every local city |
| `+1` | Spawns a settler at the local player's capital and selects it when found |

### Commanders

| Option | What it does |
| --- | --- |
| `Upgrade all commanders` | Spends available commander promotions, commendations, and army upgrades where possible |
| `Reinforce all` | Sends eligible units to valid commanders where possible |
| `Commanders: ready` status line | Shows progress and completion state for commander automation |

### Units

| Option | What it does |
| --- | --- |
| `Inf.movement: Off/On` | Toggles infinite movement for the local player's units |
| `Heal` | Heals player-owned units |
| `+10,000,000 XP` | Grants a large amount of XP to local units |
| `Sleep all` | Puts local units to sleep |

### Progression

| Option | What it does |
| --- | --- |
| `Complete` under Tech | Finishes the active technology by granting enough science |
| `Complete` under Civic | Finishes the active civic by granting enough culture |

### Autoplay

| Option | What it does |
| --- | --- |
| `1 turn` | Starts autoplay for 1 turn |
| `5 turns` | Starts autoplay for 5 turns |
| `10 turns` | Starts autoplay for 10 turns |
| `25 turns` | Starts autoplay for 25 turns |

Autoplay also queues the panel's admin automation before autoplay begins.

### Misc

| Option | What it does |
| --- | --- |
| `Celebration` | Starts a golden age / celebration |
| `Reveal map` | Reveals all plots for the local player |
| `Meet all` | Triggers first contact with every living player |
| `Age transition` | Forces the game to move to the next age |
| `Console` | Shows or hides the panel's embedded console |
| `Reload UI` | Reloads the Civilization VII UI |

## Hotkeys

These are defined in `data/hotkey.xml`.

| Hotkey | Action |
| --- | --- |
| `B` | Toggle the dev panel |
| `Ctrl+C` | Toggle the dev console |
| `Ctrl+R` | Reload UI |
| `Ctrl+V` | Toggle infinite movement |
| `Ctrl+D` | Complete city production |
| `Ctrl+Z` | Complete tech |
| `Ctrl+X` | Complete civic |
| `Ctrl+G` | Add gold |
| `Ctrl+H` | Add influence |
| `Ctrl+S` | Spawn settler in the capital |
| `Ctrl+0` | Increase panel size |
| `Ctrl+9` | Decrease panel size |
| `Ctrl+1` | Reset panel size and position |

## Notes

- Most actions are aimed at the **local player**.
- Some actions affect a broader set of entities than the label suggests, especially automation and unit-handling actions.
- The console is useful for seeing mod output directly in-game.
- This repository is source-only; there is no npm/package-based build or test setup in the repo.

## Repository layout

Important files:

- `izica-dev-panel.modinfo` - mod metadata and load declarations
- `data/hotkey.xml` - input action and hotkey definitions
- `ui/dev-panel.html` - panel layout and button groups
- `ui/dev-panel.js` - panel bootstrapping and visibility restore
- `ui/actions.js` - main action logic
- `ui/console.js` - embedded console behavior
- `ui/storage.js` - saved settings storage
- `ui/infinite-movement.js` - infinite movement toggle behavior
