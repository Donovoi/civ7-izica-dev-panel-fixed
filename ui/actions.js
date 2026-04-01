import ContextManager from "/core/ui/context-manager/context-manager.js";
import { C as ComponentID } from "/core/ui/utilities/utilities-component-id.chunk.js";

import { Storage } from "./storage.js";
import { Console } from "./console.js";
import { Logs } from "./logs.js";
import { InfiniteMovement } from "./infinite-movement.js";

export const Actions = new (class {
  // Store action callbacks here after the methods have been bound to this singleton.
  map = {};

  // Keep a FIFO queue of commanders that still need admin actions applied.
  commanderAdminQueue = [];

  // Track the command currently in flight so we do not spam duplicate requests.
  commanderAdminInFlight = null;

  // Track whether a global reinforce-all sweep is currently running.
  reinforcementSweepRequested = false;

  // Hold the queued unit upgrades for the current manual upgrade-all sweep.
  unitUpgradeQueue = [];

  // Track the unit currently being assigned to a commander.
  reinforcementInFlight = null;

  // Track the unit currently being upgraded by the manual upgrade-all sweep.
  unitUpgradeInFlight = null;

  // Hold the queued reinforcement actions for the current sweep.
  reinforcementQueue = [];

  // Track total/processed units for the current visible reinforcement pass.
  manualReinforcementTotal = 0;
  manualReinforcementProcessed = 0;

  // Track how many queued reinforcement attempts actually succeeded.
  manualReinforcementSucceeded = 0;

  // Track how many queued reinforcement attempts were skipped or became invalid.
  manualReinforcementSkipped = 0;

  // Track whether the user manually kicked off a commander-upgrade sweep.
  manualCommanderUpgradeRequested = false;

  // Track how many commanders were in the visible manual upgrade batch.
  manualCommanderUpgradeTotal = 0;

  // Track how many commanders have fully finished in the visible manual upgrade batch.
  manualCommanderUpgradeCompleted = 0;

  // Track how many individual promotion / army-upgrade requests were sent manually.
  manualCommanderActionsSent = 0;

  // Track the commanders that still belong to the visible manual upgrade batch.
  manualCommanderPendingIds = [];

  // Track the commander currently being worked on for status text and logs.
  manualCommanderCurrentName = "";

  // Track whether the user manually kicked off a reinforce-all sweep.
  manualReinforcementRequested = false;

  // Track whether the user manually kicked off an upgrade-all-units sweep.
  manualUnitUpgradeRequested = false;

  // Track total / processed / skipped units for the visible manual unit-upgrade sweep.
  manualUnitUpgradeTotal = 0;
  manualUnitUpgradeProcessed = 0;
  manualUnitUpgradeSucceeded = 0;
  manualUnitUpgradeSkipped = 0;

  // Track the unit currently being worked on for the visible manual unit-upgrade sweep.
  manualUnitUpgradeCurrentName = "";

  // Store the timer used to restore the idle status text after a completion message.
  commanderStatusResetTimer = null;

  // Store the timer used to restore the idle unit status text after a completion message.
  unitsStatusResetTimer = null;

  // Store the timer used to restore the idle progression status text after a completion message.
  progressionStatusResetTimer = null;

  // Store the timer used to restore the idle empire status text after a one-click tune-up.
  empireStatusResetTimer = null;

  // Track whether the player asked for the full tech-and-civic sweep.
  progressionAutomationRequested = false;

  // Prevent multiple delayed progression passes from piling up at once.
  progressionAutomationStepScheduled = false;

  // Count how many techs and civics the background sweep completed in the current run.
  progressionAutomationTechCompleted = 0;
  progressionAutomationCivicCompleted = 0;

  // Track which tech/civic node is currently waiting for completion so we do not spam the same grant forever.
  progressionAutomationInFlight = {
    tech: null,
    civic: null,
  };

  // Track whether autoplay should run with the cheat-assisted mastery helper enabled.
  autoplayMasteryEnabled = true;

  // Remember whether the current autoplay run still needs its one-time setup pass.
  autoplayMasteryNeedsSetup = false;

  // Collapse duplicate mastery bursts when the same autoplay start fires multiple nearby events.
  autoplayMasteryLastRunAt = 0;

  // Track the number of local-player autoplay turns processed in the current run.
  autoplayMasteryTurnCounter = 0;

  // Store the currently selected victory-bias helper mode for mastery-backed autoplay.
  autoplayMasteryBias = "balanced";

  // Keep the supported autoplay mastery bias modes in one place for labels, validation, and cycling.
  autoplayMasteryBiasModes = [
    {
      key: "balanced",
      label: "Balanced",
    },
    {
      key: "domination",
      label: "Domination",
    },
    {
      key: "science",
      label: "Science",
    },
    {
      key: "expansion",
      label: "Expansion",
    },
  ];

  // Track whether the fast-gameplay option bundle is currently enabled through the dev panel.
  fastGameplayEnabled = false;

  // Track whether the lightweight frame profiler is currently sampling frame times.
  performanceProfilerEnabled = false;

  // Hold the current requestAnimationFrame handle for the profiler loop.
  performanceProfilerFrameHandle = 0;

  // Track timing stats for the current profiler reporting window.
  performanceProfilerLastFrameAt = 0;
  performanceProfilerWindowStartedAt = 0;
  performanceProfilerFrameCount = 0;
  performanceProfilerSlowFrameCount = 0;
  performanceProfilerVerySlowFrameCount = 0;
  performanceProfilerHitchFrameCount = 0;
  performanceProfilerWorstFrameMs = 0;
  performanceProfilerFrameSamples = [];
  performanceProfilerLastOutlierLoggedAt = 0;

  // Track the current profiler session identity so resumed saves append to the same stored log buffer.
  performanceProfilerSessionKey = "";
  performanceProfilerSessionName = "";
  performanceProfilerMaxSessionCount = 6;
  performanceProfilerMaxEntriesPerSession = 800;

  // Track transient retries so commander automation can wait for gamecore without stalling forever.
  commanderAdminRetryCounts = new Map();

  // Prevent multiple attribute-screen refresh pop/push cycles from stacking.
  attributeTreeRefreshScheduled = false;

  // Short hover summaries for the dev-panel buttons.
  buttonTooltips = {
    "toggle-dev-panel": "Hide or show the dev panel.",
    "font-increase": "Increase the dev panel size.",
    "font-decrease": "Decrease the dev panel size.",
    "left-decrease": "Move the dev panel left.",
    "left-increase": "Move the dev panel right.",
    "toggle-fast-gameplay": "Toggle quick combat, quick movement, and notification camera panning for a snappier game flow.",
    "toggle-performance-profiler": "Toggle a lightweight frame-time profiler that reports UI stutters, records resumable session diagnostics, and keeps the console chatty in a helpful way.",
    "copy-all-logs": "Copy the current save's profiler session log and the mirrored dev console log to the clipboard so you can paste them into a text file for debugging.",
    "run-empire-maintenance": "Run a one-click empire tune-up: top up economy, growth, happiness, healing, XP, reinforcements, military upgrades, and the full research/civic sweep.",
    "add-gold": "Grant 1,000,000 gold.",
    "add-influence": "Grant 1,000,000 influence.",
    "add-wildcard-attribute-point": "Grant 1 wildcard attribute point.",
    "add-happiness": "Grant 100 happiness.",
    "complete-production": "Complete production in every city.",
    "add-population": "Add 1 rural population to every city.",
    "spawn-settler": "Spawn a settler at your capital.",
    "upgrade-commander": "Upgrade every commander that can spend promotions, commendations, or formation upgrades, including land, naval, and air commanders.",
    "reinforce-all-units": "Send every eligible land, sea, and air unit to a valid commander.",
    "toggle-infinite-movement": "Toggle infinite movement for your units.",
    "upgrade-all-units": "Upgrade every currently eligible local unit and commander in one sweep. Regular units use the stock Upgrade Unit command, while commanders spend promotions, commendations, and army upgrades through the existing commander-admin queue.",
    "heal-units": "Heal every alive player's unit, including packed and traveling units when possible.",
    "add-xp": "Grant max safe XP to every local unit. Regular units still get a huge XP boost, but commanders stop at their remaining promotion-point cap to avoid overflowing native counters.",
    "clear-all-logs": "Clear the mirrored dev console buffer and every stored profiler session log so the next repro starts from a clean slate.",
    "sleep-all-units": "Put every local unit to sleep.",
    "complete-tech": "Finish the active technology.",
    "complete-civic": "Finish the active civic.",
    "complete-all-research-civics": "Finish every remaining technology and civic, auto-pick the next node each time, and stop once Future Tech and Future Civic are selected.",
    "toggle-autoplay-mastery": "Toggle a cheat-assisted autoplay helper that reveals the map, forces first contact, boosts the local economy and production, heals and buffs units, maxes out research, and keeps commander admin automation running. This makes autoplay far stronger, but it is not a true engine-level forward-search AI.",
    "cycle-autoplay-bias": "Cycle the victory-bias package used by master autoplay. Balanced keeps the broad support bundle, Domination re-buffs armies harder, Science leans into growth plus full progression, and Expansion pushes settlers, growth, and production harder.",
    "autoplay-1": "Start autoplay for 1 turn. When Master mode is enabled, autoplay also gets aggressive research, economy, production, healing, and commander-support boosts.",
    "autoplay-5": "Start autoplay for 5 turns. When Master mode is enabled, autoplay also gets aggressive research, economy, production, healing, and commander-support boosts.",
    "autoplay-10": "Start autoplay for 10 turns. When Master mode is enabled, autoplay also gets aggressive research, economy, production, healing, and commander-support boosts.",
    "autoplay-25": "Start autoplay for 25 turns. When Master mode is enabled, autoplay also gets aggressive research, economy, production, healing, and commander-support boosts.",
    "start-golden-age": "Start a golden age / celebration.",
    "reveal-map": "Reveal every plot for your player.",
    "meet-all": "Trigger first contact with every living player.",
    "transition-to-next-age": "Force the game into the next age.",
    "toggle-dev-console": "Show or hide the dev panel console.",
    "reload-ui": "Reload the Civilization VII UI.",
  };

  // Cache static promotion tree metadata by promotion class so commander upgrades stay fast.
  promotionMetadataByClass = new Map();

  // Prevent multiple delayed refreshes from piling up at once.
  commanderAdminRefreshScheduled = false;

  // Track a unique token for each in-flight commander admin step so stale timers can be ignored safely.
  commanderAdminActionSequence = 0;

  // Track a unique token for each in-flight unit-upgrade step so stale timers can be ignored safely.
  unitUpgradeActionSequence = 0;

  // Prevent multiple delayed unit-upgrade refreshes from piling up at once.
  unitUpgradeRefreshScheduled = false;

  // Make sure engine listeners are registered only once.
  commanderAdminListenersRegistered = false;

  constructor() {
    // Bind every direct action callback so event listeners and hotkeys keep the right `this`.
    this.toggleDevPanel = this.toggleDevPanel.bind(this);
    this.addGold = this.addGold.bind(this);
    this.addInfluence = this.addInfluence.bind(this);
    this.addHappiness = this.addHappiness.bind(this);
    this.startGoldenAge = this.startGoldenAge.bind(this);
    this.addWildcardAttributePoint = this.addWildcardAttributePoint.bind(this);
    this.reloadUI = this.reloadUI.bind(this);
    this.transitionToNextAge = this.transitionToNextAge.bind(this);
    this.completeProduction = this.completeProduction.bind(this);
    this.addPopulation = this.addPopulation.bind(this);
    this.spawnSettler = this.spawnSettler.bind(this);
    this.toggleFastGameplay = this.toggleFastGameplay.bind(this);
    this.togglePerformanceProfiler = this.togglePerformanceProfiler.bind(this);
    this.copyAllLogs = this.copyAllLogs.bind(this);
    this.clearAllLogs = this.clearAllLogs.bind(this);
    this.runEmpireMaintenance = this.runEmpireMaintenance.bind(this);
    this.completeTech = this.completeTech.bind(this);
    this.completeCivic = this.completeCivic.bind(this);
    this.completeAllResearchAndCivics = this.completeAllResearchAndCivics.bind(this);
    this.toggleAutoplayMastery = this.toggleAutoplayMastery.bind(this);
    this.cycleAutoplayMasteryBias = this.cycleAutoplayMasteryBias.bind(this);
    this.upgradeAllAvailableUnits = this.upgradeAllAvailableUnits.bind(this);
    this.healUnits = this.healUnits.bind(this);
    this.addXp = this.addXp.bind(this);
    this.sleepAllUnits = this.sleepAllUnits.bind(this);
    this.revealMap = this.revealMap.bind(this);
    this.meetAll = this.meetAll.bind(this);
    this.upgradeSelectedCommander = this.upgradeSelectedCommander.bind(this);
    this.reinforceAllAvailableUnits = this.reinforceAllAvailableUnits.bind(this);
    this.refreshSelectedUnitUI = this.refreshSelectedUnitUI.bind(this);
    this.finishManualAdminStatusIfIdle = this.finishManualAdminStatusIfIdle.bind(this);
    this.onAutoplayStarted = this.onAutoplayStarted.bind(this);
    this.onPlayerTurnActivated = this.onPlayerTurnActivated.bind(this);
    this.onUnitAddedToMap = this.onUnitAddedToMap.bind(this);
    this.onUnitAddedToArmy = this.onUnitAddedToArmy.bind(this);
    this.onUnitRemovedFromArmy = this.onUnitRemovedFromArmy.bind(this);
    this.onUnitRemovedFromMap = this.onUnitRemovedFromMap.bind(this);
    this.onUnitExperienceChanged = this.onUnitExperienceChanged.bind(this);
    this.onUnitPromoted = this.onUnitPromoted.bind(this);
    this.onUnitCommandStarted = this.onUnitCommandStarted.bind(this);
    this.onTechNodeCompleted = this.onTechNodeCompleted.bind(this);
    this.onCultureNodeCompleted = this.onCultureNodeCompleted.bind(this);

    // Build the action map only after binding so stored callbacks keep the singleton context.
    this.map = {
      // Toggle the whole panel on or off.
      "toggle-dev-panel": this.toggleDevPanel,

      // Toggle the embedded console area.
      "toggle-dev-console": () => Console.toggle(),

      // Increase the panel font size a little.
      "font-increase": () => this.updateFontSize(0.05),

      // Decrease the panel font size a little.
      "font-decrease": () => this.updateFontSize(-0.05),

      // Restore the saved panel size and position defaults.
      "reset-panel-size": () => {
        // Save the default font size.
        Storage.set("dev-panel-font-size", 0.65);

        // Save the default horizontal offset.
        Storage.set("dev-panel-position-left", 0.75);

        // Reapply the saved font size to the live panel.
        this.updateFontSize();

        // Reapply the saved left position to the live panel.
        this.updatePositionLeft();
      },

      // Nudge the panel to the right.
      "left-increase": () => this.updatePositionLeft(0.25),

      // Nudge the panel to the left.
      "left-decrease": () => this.updatePositionLeft(-0.25),

      // Toggle the fast-gameplay option bundle.
      "toggle-fast-gameplay": this.toggleFastGameplay,

      // Toggle the lightweight frame profiler.
      "toggle-performance-profiler": this.togglePerformanceProfiler,

      // Copy the persisted profiler session log plus the mirrored dev console buffer to the clipboard.
      "copy-all-logs": this.copyAllLogs,

      // Clear the mirrored dev console buffer and every stored profiler session log.
      "clear-all-logs": this.clearAllLogs,

      // Launch the one-click empire maintenance pass.
      "run-empire-maintenance": this.runEmpireMaintenance,

      // Toggle the cheat-assisted autoplay mastery helper.
      "toggle-autoplay-mastery": this.toggleAutoplayMastery,

      // Cycle the victory-bias package used by mastery-backed autoplay.
      "cycle-autoplay-bias": this.cycleAutoplayMasteryBias,

      // Queue autoplay for 1 turn.
      "autoplay-1": this.startAutoplay(1),

      // Queue autoplay for 5 turns.
      "autoplay-5": this.startAutoplay(5),

      // Queue autoplay for 10 turns.
      "autoplay-10": this.startAutoplay(10),

      // Queue autoplay for 25 turns.
      "autoplay-25": this.startAutoplay(25),

      // Spend every available promotion, commendation, and formation upgrade across all commanders.
      "upgrade-commander": this.upgradeSelectedCommander,

      // Assign every currently reinforceable unit to a valid commander plot.
      "reinforce-all-units": this.reinforceAllAvailableUnits,

      // Upgrade every currently upgradeable non-commander unit.
      "upgrade-all-units": this.upgradeAllAvailableUnits,

      // Give the player gold.
      "add-gold": this.addGold,

      // Give the player influence.
      "add-influence": this.addInfluence,

      // Give the player happiness.
      "add-happiness": this.addHappiness,

      // Grant one wildcard attribute point.
      "add-wildcard-attribute-point": this.addWildcardAttributePoint,

      // Start a golden age / celebration.
      "start-golden-age": this.startGoldenAge,

      // Toggle the infinite movement helper.
      "toggle-infinite-movement": InfiniteMovement.toggle,

      // Fully heal all current units.
      "heal-units": this.healUnits,

      // Grant a large amount of XP to all units.
      "add-xp": this.addXp,

      // Put every unit to sleep.
      "sleep-all-units": this.sleepAllUnits,

      // Instantly finish city production queues.
      "complete-production": this.completeProduction,

      // Add one rural population to every city.
      "add-population": this.addPopulation,

      // Spawn a settler near the capital.
      "spawn-settler": this.spawnSettler,

      // Finish the current tech.
      "complete-tech": this.completeTech,

      // Finish the current civic.
      "complete-civic": this.completeCivic,

      // Finish every remaining tech and civic, then stop on the future repeatables.
      "complete-all-research-civics": this.completeAllResearchAndCivics,

      // Reload the UI layer.
      "reload-ui": this.reloadUI,

      // Force the game into the next age transition.
      "transition-to-next-age": this.transitionToNextAge,

      // Reveal the full map to the local player.
      "reveal-map": this.revealMap,

      // Trigger first-meet diplomacy with everyone alive.
      "meet-all": this.meetAll,
    };

    // Register autoplay/admin listeners once the engine is ready.
    engine.whenReady.then(() => {
      this.registerCommanderAdminListeners();
    });
  }

  // Read the local player ID once and normalize missing values to `null`.
  getLocalPlayerId() {
    return GameContext.localPlayerID ?? null;
  }

  // Resolve the current local player object in a null-safe way.
  getLocalPlayer() {
    const localPlayerId = this.getLocalPlayerId();

    if (localPlayerId === null) {
      return null;
    }

    return Players.get(localPlayerId) ?? null;
  }

  // Return a safe array of cities so bulk city actions never crash on missing data.
  getLocalCities() {
    return this.getLocalPlayer()?.Cities?.getCities?.() ?? [];
  }

  // Return a safe array of units so bulk unit actions can iterate without guards.
  getLocalUnits() {
    const unitIds = this.getLocalPlayer()?.Units?.getUnitIds?.() ?? [];

    return unitIds
      .map((unitId) => Units.get(unitId))
      .filter((unit) => unit !== null && unit !== undefined);
  }

  // Return a safe array of units for one specific player.
  getUnitsForPlayer(playerId) {
    const player = Players.get(playerId);
    const unitIds = player?.Units?.getUnitIds?.() ?? [];

    return unitIds
      .map((unitId) => Units.get(unitId))
      .filter((unit) => unit !== null && unit !== undefined);
  }

  // Return a deduplicated safe array of units for every alive player.
  getAllPlayerUnits() {
    const unitsByKey = new Map();

    for (const playerId of Players.getAliveIds?.() ?? []) {
      for (const unit of this.getUnitsForPlayer(playerId)) {
        const key = this.getComponentIdKey(unit.id);

        if (!key) {
          continue;
        }

        unitsByKey.set(key, unit);
      }
    }

    return [...unitsByKey.values()];
  }

  // Reset the visible progress state for a manual reinforce-all sweep.
  resetManualReinforcementProgress() {
    this.manualReinforcementTotal = 0;
    this.manualReinforcementProcessed = 0;
    this.manualReinforcementSucceeded = 0;
    this.manualReinforcementSkipped = 0;
  }

  // Reset the visible progress state for the manual unit-upgrade action.
  resetManualUnitUpgradeProgress() {
    this.manualUnitUpgradeTotal = 0;
    this.manualUnitUpgradeProcessed = 0;
    this.manualUnitUpgradeSucceeded = 0;
    this.manualUnitUpgradeSkipped = 0;
    this.manualUnitUpgradeCurrentName = "";
    this.unitUpgradeQueue = [];
    this.unitUpgradeInFlight = null;
  }

  // Start a fresh visible progress batch for the manual unit-upgrade action.
  beginManualUnitUpgradeProgress(unitIds) {
    this.manualUnitUpgradeTotal = unitIds.length;
    this.manualUnitUpgradeProcessed = 0;
    this.manualUnitUpgradeSucceeded = 0;
    this.manualUnitUpgradeSkipped = 0;
    this.manualUnitUpgradeCurrentName = "";
    this.unitUpgradeQueue = [...unitIds];
    this.unitUpgradeInFlight = null;
  }

  // Read the currently selected unit ID if one exists.
  getSelectedUnitId() {
    const selectedUnitId = UI.Player.getHeadSelectedUnit?.();

    if (!ComponentID.isValid(selectedUnitId)) {
      return null;
    }

    return selectedUnitId;
  }

  // Resolve the currently selected unit in a null-safe way.
  getSelectedUnit() {
    const selectedUnitId = this.getSelectedUnitId();

    if (!selectedUnitId) {
      return null;
    }

    return Units.get(selectedUnitId) ?? null;
  }

  // Return all of the local player's commanders.
  getCommanderUnits() {
    return this.getLocalUnits().filter((unit) => unit?.isCommanderUnit);
  }

  // Resolve the commander that owns the selected unit's army, or the unit itself if it already is a commander.
  getCommanderForUnit(unit) {
    if (!unit) {
      return null;
    }

    if (unit.isCommanderUnit) {
      return unit;
    }

    if (!ComponentID.isValid(unit.armyId)) {
      return null;
    }

    return (
      this.getCommanderUnits().find(
        (candidate) =>
          ComponentID.isValid(candidate?.armyId) &&
          ComponentID.isMatch(candidate.armyId, unit.armyId),
      ) ?? null
    );
  }

  // Resolve the commander associated with the current selection.
  getSelectedCommander() {
    return this.getCommanderForUnit(this.getSelectedUnit());
  }

  // Find the dev-panel status line for commander/admin tasks.
  getCommanderStatusElement() {
    return document.querySelector(".dev-panel-status--commanders");
  }

  // Update the commander/admin status line shown in the panel.
  setCommanderStatus(message) {
    const element = this.getCommanderStatusElement();

    if (!element) {
      return;
    }

    element.textContent = message;
  }

  // Find the dev-panel status line for research/civic automation.
  getProgressionStatusElement() {
    return document.querySelector(".dev-panel-status--progression");
  }

  // Update the progression status line shown in the panel.
  setProgressionStatus(message) {
    const element = this.getProgressionStatusElement();

    if (!element) {
      return;
    }

    element.textContent = message;
  }

  // Find the dev-panel status line for performance/profiling helpers.
  getPerformanceStatusElement() {
    return document.querySelector(".dev-panel-status--performance");
  }

  // Update the performance status line shown in the panel.
  setPerformanceStatus(message) {
    const element = this.getPerformanceStatusElement();

    if (!element) {
      return;
    }

    element.textContent = message;
  }

  // Find the dev-panel status line for autoplay helpers.
  getAutoplayStatusElement() {
    return document.querySelector(".dev-panel-status--autoplay");
  }

  // Update the autoplay status line shown in the panel.
  setAutoplayStatus(message) {
    const element = this.getAutoplayStatusElement();

    if (!element) {
      return;
    }

    element.textContent = message;
  }

  // Find the dev-panel status line for unit-wide helpers.
  getUnitsStatusElement() {
    return document.querySelector(".dev-panel-status--units");
  }

  // Update the units status line shown in the panel.
  setUnitsStatus(message) {
    const element = this.getUnitsStatusElement();

    if (!element) {
      return;
    }

    element.textContent = message;
  }

  // Find the dev-panel status line for one-click empire tune-ups.
  getEmpireStatusElement() {
    return document.querySelector(".dev-panel-status--empire");
  }

  // Update the empire status line shown in the panel.
  setEmpireStatus(message) {
    const element = this.getEmpireStatusElement();

    if (!element) {
      return;
    }

    element.textContent = message;
  }

  // Restore the default commander/admin status text after a short delay.
  scheduleCommanderStatusReset(delay = 2500) {
    if (this.commanderStatusResetTimer) {
      clearTimeout(this.commanderStatusResetTimer);
    }

    this.commanderStatusResetTimer = setTimeout(() => {
      this.commanderStatusResetTimer = null;
      this.setCommanderStatus("Commanders: ready");
    }, delay);
  }

  // Restore the default units status text after a short delay.
  scheduleUnitsStatusReset(delay = 2500) {
    if (this.unitsStatusResetTimer) {
      clearTimeout(this.unitsStatusResetTimer);
    }

    this.unitsStatusResetTimer = setTimeout(() => {
      this.unitsStatusResetTimer = null;
      this.setUnitsStatus("Units: ready");
    }, delay);
  }

  // Restore the default progression status text after a short delay.
  scheduleProgressionStatusReset(delay = 2500) {
    if (this.progressionStatusResetTimer) {
      clearTimeout(this.progressionStatusResetTimer);
    }

    this.progressionStatusResetTimer = setTimeout(() => {
      this.progressionStatusResetTimer = null;
      this.setProgressionStatus("Progression: ready");
    }, delay);
  }

  // Restore the default empire status text after a short delay.
  scheduleEmpireStatusReset(delay = 3000) {
    if (this.empireStatusResetTimer) {
      clearTimeout(this.empireStatusResetTimer);
    }

    this.empireStatusResetTimer = setTimeout(() => {
      this.empireStatusResetTimer = null;
      this.setEmpireStatus("Empire: ready");
    }, delay);
  }

  // Re-select the current unit so panels and stats refresh after a manual admin action completes.
  refreshSelectedUnitUI() {
    const selectedUnitId = this.getSelectedUnitId();

    if (!selectedUnitId || !Units.get(selectedUnitId)) {
      return;
    }

    requestAnimationFrame(() => {
      if (Units.get(selectedUnitId)) {
        UI.Player.selectUnit(selectedUnitId);
      }
    });
  }

  // Make one unit the active local selection so stock unit-command paths have the same context as manual clicks.
  ensureUnitSelected(unitId) {
    if (!ComponentID.isValid(unitId)) {
      return;
    }

    const selectedUnitId = this.getSelectedUnitId();

    if (this.isSameComponentId(selectedUnitId, unitId)) {
      return;
    }

    UI.Player.selectUnit?.(unitId);
  }

  // Borrow the current unit selection for one stock command check/request and then hand it back.
  withTemporaryUnitSelection(unitId, callback) {
    if (!ComponentID.isValid(unitId) || typeof callback !== "function") {
      return null;
    }

    const previousSelectionId = this.getSelectedUnitId();
    const alreadySelected = this.isSameComponentId(previousSelectionId, unitId);

    if (!alreadySelected) {
      this.ensureUnitSelected(unitId);
    }

    if (!this.isSameComponentId(this.getSelectedUnitId(), unitId)) {
      return null;
    }

    try {
      return callback();
    } finally {
      if (alreadySelected) {
        return;
      }

      requestAnimationFrame(() => {
        if (!this.isSameComponentId(this.getSelectedUnitId(), unitId)) {
          return;
        }

        if (previousSelectionId && Units.get(previousSelectionId)) {
          UI.Player.selectUnit?.(previousSelectionId);
        }
      });
    }
  }

  // Try to focus the stock unit-actions panel so command requests have the same UI context as a manual click.
  focusUnitActionsPanel() {
    const selectors = [
      ".unit-actions [tabindex]",
      ".unit-actions fxs-activatable",
      ".unit-actions",
      "unit-actions [tabindex]",
      "unit-actions fxs-activatable",
      "unit-actions",
      "[data-context='unit-actions'] [tabindex]",
      "[data-context='unit-actions'] fxs-activatable",
      "[data-context='unit-actions']",
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);

      if (!(element instanceof HTMLElement)) {
        continue;
      }

      element.dispatchEvent(new Event("mouseenter"));
      element.dispatchEvent(new Event("focus"));
      element.focus?.();
      return true;
    }

    return false;
  }

  // Restore the previous unit selection after one delayed stock-command attempt finishes.
  restoreTemporaryUnitSelection(unitId, previousSelectionId, alreadySelected) {
    if (alreadySelected) {
      return;
    }

    requestAnimationFrame(() => {
      if (!this.isSameComponentId(this.getSelectedUnitId(), unitId)) {
        return;
      }

      if (previousSelectionId && Units.get(previousSelectionId)) {
        UI.Player.selectUnit?.(previousSelectionId);
      }
    });
  }

  // Try one stock unit command again after the selection/UI focus has had a frame to catch up.
  sendUnitCommandAfterSelectionSettles(unitId, commandType, args, onFailure = null) {
    if (!ComponentID.isValid(unitId)) {
      return false;
    }

    const previousSelectionId = this.getSelectedUnitId();
    const alreadySelected = this.isSameComponentId(previousSelectionId, unitId);

    if (!alreadySelected) {
      this.ensureUnitSelected(unitId);
    }

    if (!this.isSameComponentId(this.getSelectedUnitId(), unitId)) {
      return false;
    }

    const unitLabel = this.getUnitDisplayName(unitId);
    const maxAttempts = 3;
    let attemptCount = 0;
    const releaseQueuedFailure = () => {
      if (typeof onFailure === "function") {
        onFailure();
        return;
      }

      if (!this.isSameComponentId(this.commanderAdminInFlight?.unitId, unitId)) {
        return;
      }

      this.commanderAdminInFlight = null;
      this.scheduleCommanderAdminProcessing();
    };

    const attemptSend = () => {
      attemptCount += 1;

      if (!this.isSameComponentId(this.getSelectedUnitId(), unitId)) {
        if (attemptCount < maxAttempts) {
          this.ensureUnitSelected(unitId);
          requestAnimationFrame(attemptSend);
          return;
        }

        console.log(
          `Dev panel: could not keep ${unitLabel} selected long enough for ${commandType}.`,
        );
        this.restoreTemporaryUnitSelection(
          unitId,
          previousSelectionId,
          alreadySelected,
        );
        releaseQueuedFailure();
        return;
      }

      this.focusUnitActionsPanel();

      const preparedResult = Game.UnitCommands?.canStart(
        unitId,
        commandType,
        args,
        false,
      );

      if (preparedResult?.Success) {
        Game.UnitCommands?.sendRequest(unitId, commandType, args);
        this.restoreTemporaryUnitSelection(
          unitId,
          previousSelectionId,
          alreadySelected,
        );
        return;
      }

      if (attemptCount < maxAttempts) {
        requestAnimationFrame(attemptSend);
        return;
      }

      console.log(
        `Dev panel: ${commandType} stayed unavailable for ${unitLabel} after waiting for unit-actions focus.`,
      );
      this.restoreTemporaryUnitSelection(
        unitId,
        previousSelectionId,
        alreadySelected,
      );
      releaseQueuedFailure();
    };

    requestAnimationFrame(attemptSend);
    return true;
  }

  // Ask the stock command system whether a command can start, borrowing selection only when requested.
  canStartUnitCommand(unitId, commandType, args, allowTemporarySelection = false) {
    const directResult = Game.UnitCommands?.canStart(
      unitId,
      commandType,
      args,
      false,
    );

    if (directResult?.Success || !allowTemporarySelection) {
      return directResult ?? null;
    }

    return (
      this.withTemporaryUnitSelection(unitId, () =>
        Game.UnitCommands?.canStart(unitId, commandType, args, false),
      ) ?? directResult ?? null
    );
  }

  // Send one stock unit command while minimizing how long automation owns the UI selection.
  sendUnitCommand(unitId, commandType, args, onFailure = null) {
    const directResult = this.canStartUnitCommand(unitId, commandType, args);

    if (directResult?.Success) {
      Game.UnitCommands?.sendRequest(unitId, commandType, args);
      return true;
    }

    return this.sendUnitCommandAfterSelectionSettles(
      unitId,
      commandType,
      args,
      onFailure,
    );
  }

  // Register the autoplay/admin listeners exactly once.
  registerCommanderAdminListeners() {
    if (this.commanderAdminListenersRegistered) {
      return;
    }

    this.commanderAdminListenersRegistered = true;
    engine.on("AutoplayStarted", this.onAutoplayStarted, this);
    engine.on("PlayerTurnActivated", this.onPlayerTurnActivated, this);
    engine.on("UnitAddedToMap", this.onUnitAddedToMap, this);
    engine.on("UnitAddedToArmy", this.onUnitAddedToArmy, this);
    engine.on("UnitRemovedFromArmy", this.onUnitRemovedFromArmy, this);
    engine.on("UnitRemovedFromMap", this.onUnitRemovedFromMap, this);
    engine.on("UnitExperienceChanged", this.onUnitExperienceChanged, this);
    engine.on("UnitPromoted", this.onUnitPromoted, this);
    engine.on("UnitCommandStarted", this.onUnitCommandStarted, this);
    engine.on("TechNodeCompleted", this.onTechNodeCompleted, this);
    engine.on("CultureNodeCompleted", this.onCultureNodeCompleted, this);
  }

  // Compare two component IDs safely.
  isSameComponentId(left, right) {
    return ComponentID.isValid(left) && ComponentID.isValid(right)
      ? ComponentID.isMatch(left, right)
      : false;
  }

  // Check whether the queue already contains a commander.
  hasQueuedCommander(unitId) {
    return this.commanderAdminQueue.some((queuedUnitId) =>
      this.isSameComponentId(queuedUnitId, unitId),
    );
  }

  // Add a commander to the admin queue if it is not already queued.
  enqueueCommanderForAdmin(unitId) {
    if (!ComponentID.isValid(unitId) || this.hasQueuedCommander(unitId)) {
      return;
    }

    this.commanderAdminQueue.push(unitId);
  }

  // Queue every local commander for the autoplay admin sweep.
  enqueueAllCommandersForAdmin() {
    this.getCommanderUnits().forEach((commander) => {
      this.enqueueCommanderForAdmin(commander.id);
    });
  }

  // Drop commanders that no longer exist or no longer belong to the local player.
  pruneCommanderAdminQueue() {
    const localPlayerId = this.getLocalPlayerId();

    this.commanderAdminQueue = this.commanderAdminQueue.filter((unitId) => {
      const commander = Units.get(unitId);

      if (!commander?.isCommanderUnit || commander.owner !== localPlayerId) {
        this.resetCommanderRetryCount(unitId);
        this.markManualCommanderComplete(unitId);
      }

      return Boolean(
        commander?.isCommanderUnit && commander.owner === localPlayerId,
      );
    });

    if (
      this.commanderAdminInFlight &&
      !Units.get(this.commanderAdminInFlight.unitId)
    ) {
      this.commanderAdminInFlight = null;
    }
  }

  // Schedule a delayed queue drain so the game can finish applying the previous command.
  scheduleCommanderAdminProcessing() {
    if (this.commanderAdminRefreshScheduled) {
      return;
    }

    this.commanderAdminRefreshScheduled = true;
    requestAnimationFrame(() => {
      this.commanderAdminRefreshScheduled = false;
      this.processAdminQueues();
    });
  }

  // Build a stable string key for one component ID so tiny lookup maps can track retries safely.
  getComponentIdKey(componentId) {
    if (!ComponentID.isValid(componentId)) {
      return "";
    }

    try {
      return JSON.stringify(componentId) ?? String(componentId);
    } catch (_error) {
      return String(componentId);
    }
  }

  // Resolve a readable unit name for status text and console logs.
  getUnitDisplayName(unitOrId) {
    const unit = ComponentID.isValid(unitOrId) ? Units.get(unitOrId) : unitOrId;

    if (!unit) {
      return "Commander";
    }

    if (typeof unit.name === "string" && unit.name.length > 0) {
      return unit.name;
    }

    const unitDefinition = GameInfo.Units.lookup(unit.type);

    if (unitDefinition?.Name) {
      return Locale.compose(unitDefinition.Name);
    }

    return unit.type ?? "Commander";
  }

  // Reset the visible progress state for the manual commander-upgrade action.
  resetManualCommanderProgress() {
    this.manualCommanderUpgradeTotal = 0;
    this.manualCommanderUpgradeCompleted = 0;
    this.manualCommanderActionsSent = 0;
    this.manualCommanderPendingIds = [];
    this.manualCommanderCurrentName = "";
  }

  // Start a fresh visible progress batch for the manual commander-upgrade action.
  beginManualCommanderProgress(unitIds) {
    this.manualCommanderUpgradeTotal = unitIds.length;
    this.manualCommanderUpgradeCompleted = 0;
    this.manualCommanderActionsSent = 0;
    this.manualCommanderPendingIds = [...unitIds];
    this.manualCommanderCurrentName = "";
  }

  // Mark one commander as fully finished inside the visible manual upgrade batch.
  markManualCommanderComplete(unitId) {
    const pendingIndex = this.manualCommanderPendingIds.findIndex((pendingUnitId) =>
      this.isSameComponentId(pendingUnitId, unitId),
    );

    if (pendingIndex < 0) {
      return;
    }

    this.manualCommanderPendingIds.splice(pendingIndex, 1);
    this.manualCommanderUpgradeCompleted = Math.min(
      this.manualCommanderUpgradeCompleted + 1,
      this.manualCommanderUpgradeTotal,
    );

    if (this.manualCommanderPendingIds.length <= 0) {
      this.manualCommanderCurrentName = "";
    }
  }

  // Read the current leader-attribute point state so the dev-panel button can verify it worked.
  captureAttributePointState(player = this.getLocalPlayer()) {
    const identity = player?.Identity;
    const availableByAttribute = [...GameInfo.Attributes].map((attribute) => ({
      attributeType: attribute.AttributeType,
      availablePoints: Number(
        identity?.getAvailableAttributePoints?.(attribute.AttributeType) ?? 0,
      ),
    }));

    return {
      wildcardPoints: Number(identity?.getWildcardPoints?.() ?? 0),
      totalAvailablePoints: availableByAttribute.reduce(
        (sum, entry) => sum + entry.availablePoints,
        0,
      ),
      availableByAttribute,
    };
  }

  // Compare two leader-attribute point snapshots so we can tell whether the grant actually applied.
  hasAttributePointStateChanged(beforeState, afterState) {
    if (
      beforeState.wildcardPoints !== afterState.wildcardPoints ||
      beforeState.totalAvailablePoints !== afterState.totalAvailablePoints
    ) {
      return true;
    }

    return beforeState.availableByAttribute.some(
      (entry, index) =>
        entry.attributeType !== afterState.availableByAttribute[index]?.attributeType ||
        entry.availablePoints !== afterState.availableByAttribute[index]?.availablePoints,
    );
  }

  // Nudge the stock leader-attribute screen onto a real node so wildcard points become immediately spendable.
  primeAttributeTreeSelection() {
    const firstAttributeCard = document.querySelector(
      ".screen-attribute-trees attribute-card.available .hitbox[type], .screen-attribute-trees attribute-card .hitbox[type]",
    );

    if (!(firstAttributeCard instanceof HTMLElement)) {
      return;
    }

    firstAttributeCard.dispatchEvent(new Event("mouseenter"));
    firstAttributeCard.dispatchEvent(new Event("focus"));
    firstAttributeCard.focus?.();
  }

  // Refresh the stock leader-attribute screen if it is already open so new wildcard points are usable immediately.
  refreshAttributeTreeUi() {
    if (this.attributeTreeRefreshScheduled) {
      return;
    }

    const attributeTreeIsOpen =
      ContextManager.hasInstanceOf?.("screen-attribute-trees") ??
      Boolean(document.querySelector(".screen-attribute-trees"));

    if (!attributeTreeIsOpen) {
      return;
    }

    this.attributeTreeRefreshScheduled = true;

    requestAnimationFrame(() => {
      try {
        ContextManager.pop("screen-attribute-trees");
      } catch (_error) {
        // Ignore and still try to reopen / reselect below.
      }

      requestAnimationFrame(() => {
        try {
          ContextManager.push("screen-attribute-trees");
        } catch (_error) {
          // Ignore and still try to select a real node if the screen remained mounted.
        }

        requestAnimationFrame(() => {
          this.attributeTreeRefreshScheduled = false;
          this.primeAttributeTreeSelection();
        });
      });
    });
  }

  // Forget the retry counter for a commander once it advances successfully or leaves the queue.
  resetCommanderRetryCount(unitId) {
    const key = this.getComponentIdKey(unitId);

    if (!key) {
      return;
    }

    this.commanderAdminRetryCounts.delete(key);
  }

  // Increment the retry counter for a commander when gamecore still has not exposed the next step yet.
  incrementCommanderRetryCount(unitId) {
    const key = this.getComponentIdKey(unitId);

    if (!key) {
      return 0;
    }

    const nextRetryCount = (this.commanderAdminRetryCounts.get(key) ?? 0) + 1;

    this.commanderAdminRetryCounts.set(key, nextRetryCount);
    return nextRetryCount;
  }

  // Return the default command payload used by the stock unit-action UI for generic commands.
  getDefaultCommandArgs() {
    return {
      X: -9999,
      Y: -9999,
      UnitAbilityType: -1,
    };
  }

  // Read one native-backed member that may be exposed as either a property or a zero-argument getter.
  readNativeValue(target, propertyName, fallback = null) {
    if (!target) {
      return fallback;
    }

    let value;

    try {
      value = target[propertyName];
    } catch (_error) {
      return fallback;
    }

    if (typeof value === "function") {
      try {
        return value.call(target);
      } catch (_error) {
        return fallback;
      }
    }

    return value ?? fallback;
  }

  // Normalize one native-backed numeric member so commander state checks never compare NaN forever.
  readNativeNumber(target, propertyName, fallback = 0) {
    const numericValue = Number(
      this.readNativeValue(target, propertyName, fallback),
    );

    return Number.isFinite(numericValue) ? numericValue : fallback;
  }

  // Normalize one native-backed boolean member for queue decisions and progress snapshots.
  readNativeBoolean(target, propertyName, fallback = false) {
    return Boolean(this.readNativeValue(target, propertyName, fallback));
  }

  // Collect callable method names from a native-backed game component for debugging/fallbacks.
  getCallablePropertyNames(target) {
    if (!target) {
      return [];
    }

    const names = new Set();
    let current = target;

    while (current && current !== Object.prototype) {
      Object.getOwnPropertyNames(current).forEach((name) => {
        if (name === "constructor") {
          return;
        }

        try {
          if (typeof target[name] === "function") {
            names.add(name);
          }
        } catch (_error) {
          // Some native-backed properties may throw during reflection; ignore those.
        }
      });

      current = Object.getPrototypeOf(current);
    }

    return [...names];
  }

  // Snapshot the player happiness/celebration state so we can tell whether a mutation actually worked.
  captureHappinessState(player = this.getLocalPlayer()) {
    const stats = player?.Stats;
    const happiness = player?.Happiness;

    return {
      lifetimeHappiness: Number(
        stats?.getLifetimeYield?.(YieldTypes.YIELD_HAPPINESS) ?? 0,
      ),
      netHappinessPerTurn: Number(
        stats?.getNetYield?.(YieldTypes.YIELD_HAPPINESS) ?? 0,
      ),
      nextGoldenAgeThreshold: Number(happiness?.nextGoldenAgeThreshold ?? 0),
      goldenAgeTurnsLeft: Number(happiness?.getGoldenAgeTurnsLeft?.() ?? 0),
      isInGoldenAge: Boolean(happiness?.isInGoldenAge?.()),
    };
  }

  // Compare two happiness snapshots to see whether the game state changed.
  hasHappinessStateChanged(beforeState, afterState) {
    return (
      beforeState.lifetimeHappiness !== afterState.lifetimeHappiness ||
      beforeState.netHappinessPerTurn !== afterState.netHappinessPerTurn ||
      beforeState.nextGoldenAgeThreshold !== afterState.nextGoldenAgeThreshold ||
      beforeState.goldenAgeTurnsLeft !== afterState.goldenAgeTurnsLeft ||
      beforeState.isInGoldenAge !== afterState.isInGoldenAge
    );
  }

  // Try a small list of plausible native mutation methods until one produces a visible happiness change.
  tryInvokeMutationMethods(target, methodNames, argLists, beforeState, captureState) {
    if (!target) {
      return false;
    }

    for (const methodName of methodNames) {
      const method = target[methodName];

      if (typeof method !== "function") {
        continue;
      }

      for (const args of argLists) {
        try {
          method.apply(target, args);
        } catch (_error) {
          continue;
        }

        if (this.hasHappinessStateChanged(beforeState, captureState())) {
          return true;
        }
      }
    }

    return false;
  }

  // Check whether a component ID already exists inside a small in-memory list.
  isComponentIdInList(componentIds, componentId) {
    return componentIds.some((candidate) =>
      this.isSameComponentId(candidate, componentId),
    );
  }

  // Extract the most relevant unit ID from a generic engine event payload.
  getEventUnitId(data) {
    return data?.initiatingUnit ?? data?.unit ?? null;
  }

  // Count how many commanders still have a promotion, commendation, or formation upgrade available.
  getCommandersWithAdminActionsCount() {
    return this.getCommandersWithAdminActions().length;
  }

  // Return every local commander that currently has a promotion, commendation, or formation upgrade available.
  getCommandersWithAdminActions() {
    return this.getCommanderUnits().filter((commander) =>
      Boolean(this.getNextCommanderAdminAction(commander, true)),
    );
  }

  // Count how many commander entries are currently pending in the fast in-memory queue.
  getPendingCommanderQueueCount() {
    return this.commanderAdminQueue.length + (this.commanderAdminInFlight ? 1 : 0);
  }

  // Build the ordered list of admin actions the current commander can legally try right now.
  getCommanderAdminActions(commander, allowTemporarySelection = false) {
    const buildActions = (resolvedCommander) => {
      const actions = this.getCommanderPromotionCandidates(resolvedCommander).map(
        (candidate) => ({
          kind: "promotion",
          candidate,
        }),
      );

      const upgradeArmyResult = this.canStartUnitCommand(
        resolvedCommander.id,
        "UNITCOMMAND_UPGRADE_ARMY",
        this.getDefaultCommandArgs(),
        false,
      );

      if (upgradeArmyResult?.Success) {
        actions.push({
          kind: "upgrade-army",
          commandType: "UNITCOMMAND_UPGRADE_ARMY",
        });
      }

      return actions;
    };

    const directActions = buildActions(commander);

    if (directActions.length > 0 || !allowTemporarySelection) {
      return directActions;
    }

    return (
      this.withTemporaryUnitSelection(commander.id, () =>
        buildActions(Units.get(commander.id) ?? commander),
      ) ?? directActions
    );
  }

  // Build a stable signature for one commander admin action so progress checks can tell whether options changed.
  getCommanderAdminActionSignature(action) {
    if (!action) {
      return "";
    }

    if (action.kind === "promotion") {
      return `${action.kind}:${action.candidate.disciplineType}:${action.candidate.promotionType}`;
    }

    return `${action.kind}:${action.commandType ?? ""}`;
  }

  // Snapshot the commander promotion state so we can tell whether an admin request actually changed anything.
  captureCommanderAdminState(commander) {
    const experience = commander?.Experience;
    const promotionSignatures = this.getCommanderPromotionCandidates(commander).map(
      (candidate) =>
        this.getCommanderAdminActionSignature({
          kind: "promotion",
          candidate,
        }),
    );

    return {
      promotionPoints: this.readNativeNumber(
        experience,
        "getStoredPromotionPoints",
      ),
      commendationPoints: this.readNativeNumber(
        experience,
        "getStoredCommendations",
      ),
      canPromote: this.readNativeBoolean(experience, "canPromote"),
      promotionSignatures,
    };
  }

  // Compare two commander promotion snapshots to see whether the command actually advanced the unit.
  hasCommanderAdminStateChanged(beforeState, afterState) {
    if (
      beforeState.promotionPoints !== afterState.promotionPoints ||
      beforeState.commendationPoints !== afterState.commendationPoints ||
      beforeState.canPromote !== afterState.canPromote
    ) {
      return true;
    }

    if (
      beforeState.promotionSignatures.length !==
      afterState.promotionSignatures.length
    ) {
      return true;
    }

    return beforeState.promotionSignatures.some(
      (signature, index) => signature !== afterState.promotionSignatures[index],
    );
  }

  // Poll the in-flight commander step until the unit state actually changes, instead of blindly re-sending the same command.
  monitorCommanderAdminInFlight(token, delay = 200) {
    setTimeout(() => {
      const inFlight = this.commanderAdminInFlight;

      if (!inFlight || inFlight.token !== token) {
        return;
      }

      const commander = Units.get(inFlight.unitId);

      if (!commander?.isCommanderUnit) {
        this.commanderAdminInFlight = null;
        this.scheduleCommanderAdminProcessing();
        return;
      }

      const afterState = this.captureCommanderAdminState(commander);

      if (this.hasCommanderAdminStateChanged(inFlight.beforeState, afterState)) {
        this.commanderAdminInFlight = null;
        this.resetCommanderRetryCount(commander.id);
        this.enqueueCommanderForAdmin(commander.id);
        this.scheduleCommanderAdminProcessing();
        return;
      }

      const elapsed = Date.now() - inFlight.startedAt;

      if (elapsed < 8000) {
        this.monitorCommanderAdminInFlight(token, elapsed < 2000 ? 150 : 300);
        return;
      }

      console.warn(
        `Dev panel: commander ${this.getUnitDisplayName(commander)} did not change after ${inFlight.actionSignature}; abandoning that step.`,
      );
      this.commanderAdminInFlight = null;
      this.commanderAdminQueue.shift();
      this.resetCommanderRetryCount(commander.id);
      this.markManualCommanderComplete(commander.id);
      this.scheduleCommanderAdminProcessing();
    }, delay);
  }

  // Count how many local non-commander units can currently reinforce into a commander.
  getReinforceableUnitsCount() {
    return this.getLocalUnits().filter((unit) => {
      if (!unit || unit.isCommanderUnit) {
        return false;
      }

      return Boolean(
        Game.UnitOperations?.canStart(
          unit.id,
          "UNITOPERATION_REINFORCE_ARMY",
          {},
          false,
        )?.Success,
      );
    }).length;
  }

  // Keep the commander/admin status line in sync while a manual action is running.
  updateManualAdminStatus() {
    if (this.manualReinforcementRequested && this.manualCommanderUpgradeRequested) {
      const remainingUnits =
        this.reinforcementQueue.length + (this.reinforcementInFlight ? 1 : 0);
      const remainingCommanders = this.manualCommanderPendingIds.length;
      const completedCommanders = Math.min(
        this.manualCommanderUpgradeCompleted,
        this.manualCommanderUpgradeTotal,
      );
      const currentCommanderLabel = this.manualCommanderCurrentName
        ? ` — ${this.manualCommanderCurrentName}`
        : "";

      this.setCommanderStatus(
        `Military upkeep… ${this.manualReinforcementSucceeded} reinforced, ${this.manualReinforcementSkipped} skipped, ${remainingUnits} units left, ${completedCommanders}/${this.manualCommanderUpgradeTotal} commanders done, ${remainingCommanders} commanders left${currentCommanderLabel}`,
      );
      return;
    }

    if (this.manualReinforcementRequested) {
      const remainingUnits =
        this.reinforcementQueue.length + (this.reinforcementInFlight ? 1 : 0);
      this.setCommanderStatus(
        this.manualReinforcementTotal > 0
          ? `Reinforcing units… ${this.manualReinforcementSucceeded} reinforced, ${this.manualReinforcementSkipped} skipped, ${remainingUnits} left to try`
          : "Reinforcing units…",
      );
      return;
    }

    if (this.manualCommanderUpgradeRequested) {
      const remainingCommanders = this.manualCommanderPendingIds.length;
      const completedCommanders = Math.min(
        this.manualCommanderUpgradeCompleted,
        this.manualCommanderUpgradeTotal,
      );
      const actionLabel =
        this.manualCommanderActionsSent === 1 ? "action" : "actions";
      const currentCommanderLabel = this.manualCommanderCurrentName
        ? ` — ${this.manualCommanderCurrentName}`
        : "";

      this.setCommanderStatus(
        remainingCommanders > 0
          ? `Upgrading commanders… ${completedCommanders}/${this.manualCommanderUpgradeTotal} done, ${remainingCommanders} left, ${this.manualCommanderActionsSent} ${actionLabel} sent${currentCommanderLabel}`
          : "Upgrading commanders… finalizing"
      );
      return;
    }

    this.setCommanderStatus("Commanders: ready");
  }

  // Keep the units status line in sync while a manual upgrade-all-units sweep is running.
  updateManualUnitUpgradeStatus() {
    if (!this.manualUnitUpgradeRequested) {
      this.setUnitsStatus("Units: ready");
      return;
    }

    const remainingUnits = Math.max(
      this.unitUpgradeQueue.length,
      this.unitUpgradeInFlight ? 1 : 0,
    );
    const currentUnitLabel = this.manualUnitUpgradeCurrentName
      ? ` — ${this.manualUnitUpgradeCurrentName}`
      : "";

    this.setUnitsStatus(
      remainingUnits > 0
        ? `Upgrading units… ${this.manualUnitUpgradeSucceeded}/${this.manualUnitUpgradeTotal} upgraded, ${this.manualUnitUpgradeSkipped} skipped, ${remainingUnits} left${currentUnitLabel}`
        : "Upgrading units… finalizing",
    );
  }

  // Finalize the visible status when a manual commander/admin sweep becomes idle.
  finishManualAdminStatusIfIdle() {
    if (this.manualReinforcementRequested && this.manualCommanderUpgradeRequested) {
      if (
        this.reinforcementSweepRequested ||
        this.reinforcementInFlight ||
        this.commanderAdminInFlight ||
        this.commanderAdminQueue.length > 0 ||
        this.manualCommanderPendingIds.length > 0
      ) {
        this.updateManualAdminStatus();
        return;
      }

      this.manualReinforcementRequested = false;
      this.manualCommanderUpgradeRequested = false;
      this.resetManualReinforcementProgress();
      this.resetManualCommanderProgress();
      this.setCommanderStatus("Commander tasks finished.");
      console.log("Dev panel: commander tasks finished.");
      this.refreshSelectedUnitUI();
      this.scheduleCommanderStatusReset();
      return;
    }

    if (this.manualReinforcementRequested) {
      if (this.reinforcementSweepRequested || this.reinforcementInFlight) {
        this.updateManualAdminStatus();
        return;
      }

      const remainingEligibleUnits = this.getReinforceableUnitsCount();
      this.manualReinforcementRequested = false;

      if (remainingEligibleUnits > 0) {
        this.setCommanderStatus(
          `Reinforcement sweep paused (${this.manualReinforcementSucceeded} reinforced, ${this.manualReinforcementSkipped} skipped, ${remainingEligibleUnits} still eligible).`,
        );
        console.warn(
          `Dev panel: reinforcement sweep paused (${this.manualReinforcementSucceeded} reinforced, ${this.manualReinforcementSkipped} skipped, ${remainingEligibleUnits} units still eligible).`,
        );
      } else {
        this.setCommanderStatus(
          `Reinforcement sweep finished (${this.manualReinforcementSucceeded} reinforced, ${this.manualReinforcementSkipped} skipped).`,
        );
        console.log(
          `Dev panel: reinforcement sweep finished (${this.manualReinforcementSucceeded} reinforced, ${this.manualReinforcementSkipped} skipped).`,
        );
      }

      this.resetManualReinforcementProgress();
      this.refreshSelectedUnitUI();
      this.scheduleCommanderStatusReset();
      return;
    }

    if (this.manualCommanderUpgradeRequested) {
      if (
        this.commanderAdminInFlight ||
        this.commanderAdminQueue.length > 0 ||
        this.manualCommanderPendingIds.length > 0
      ) {
        this.updateManualAdminStatus();
        return;
      }

      this.manualCommanderUpgradeRequested = false;
      this.resetManualCommanderProgress();
      this.setCommanderStatus("Commander upgrades finished.");
      console.log("Dev panel: commander upgrade sweep finished.");
      this.refreshSelectedUnitUI();
      this.scheduleCommanderStatusReset();
      return;
    }

    this.setCommanderStatus("Commanders: ready");
  }

  // Finalize the visible status when a manual upgrade-all-units sweep becomes idle.
  finishManualUnitUpgradeStatusIfIdle() {
    if (this.unitUpgradeInFlight || this.unitUpgradeQueue.length > 0) {
      this.updateManualUnitUpgradeStatus();
      return;
    }

    if (!this.manualUnitUpgradeRequested) {
      this.setUnitsStatus("Units: ready");
      return;
    }

    const upgradedUnits = this.manualUnitUpgradeSucceeded;
    const skippedUnits = this.manualUnitUpgradeSkipped;

    this.manualUnitUpgradeRequested = false;
    this.resetManualUnitUpgradeProgress();
    this.setUnitsStatus(
      `Unit upgrades finished (${upgradedUnits} upgraded, ${skippedUnits} skipped).`,
    );
    console.log(
      `Dev panel: unit upgrade sweep finished (${upgradedUnits} upgraded, ${skippedUnits} skipped).`,
    );
    this.refreshSelectedUnitUI();
    this.scheduleUnitsStatusReset();
  }

  // Return every local non-commander unit that can currently use the stock Upgrade Unit command.
  getUpgradeableUnits(unitIds = null) {
    const localPlayerId = this.getLocalPlayerId();
    const candidateUnits = (unitIds ?? this.getLocalUnits().map((unit) => unit.id))
      .map((unitId) => (ComponentID.isValid(unitId) ? Units.get(unitId) : unitId))
      .filter(
        (unit) =>
          unit !== null &&
          unit !== undefined &&
          !unit.isCommanderUnit &&
          unit.owner === localPlayerId,
      );

    return candidateUnits.filter((unit) =>
      Boolean(
        this.canStartUnitCommand(
          unit.id,
          "UNITCOMMAND_UPGRADE",
          this.getDefaultCommandArgs(),
          true,
        )?.Success,
      ),
    );
  }

  // Mark one queued unit upgrade step as completed and advance visible progress.
  completeUnitUpgradeStep(unitId, didSucceed) {
    const queueIndex = this.unitUpgradeQueue.findIndex((queuedUnitId) =>
      this.isSameComponentId(queuedUnitId, unitId),
    );

    if (queueIndex >= 0) {
      this.unitUpgradeQueue.splice(queueIndex, 1);
    }

    if (this.isSameComponentId(this.unitUpgradeInFlight?.unitId, unitId)) {
      this.unitUpgradeInFlight = null;
    }

    if (!this.manualUnitUpgradeRequested) {
      return;
    }

    this.manualUnitUpgradeProcessed = Math.min(
      this.manualUnitUpgradeProcessed + 1,
      this.manualUnitUpgradeTotal,
    );

    if (didSucceed) {
      this.manualUnitUpgradeSucceeded = Math.min(
        this.manualUnitUpgradeSucceeded + 1,
        this.manualUnitUpgradeProcessed,
      );
    } else {
      this.manualUnitUpgradeSkipped = Math.min(
        this.manualUnitUpgradeSkipped + 1,
        this.manualUnitUpgradeProcessed,
      );
    }

    if (this.unitUpgradeQueue.length <= 0) {
      this.manualUnitUpgradeCurrentName = "";
    }
  }

  // Schedule a delayed unit-upgrade queue drain so repeated UI refreshes do not stack.
  scheduleUnitUpgradeProcessing(delay = 0) {
    if (this.unitUpgradeRefreshScheduled) {
      return;
    }

    this.unitUpgradeRefreshScheduled = true;

    const runUpgradeStep = () => {
      this.unitUpgradeRefreshScheduled = false;
      this.processUnitUpgradeQueue();
    };

    if (delay > 0) {
      setTimeout(runUpgradeStep, delay);
      return;
    }

    requestAnimationFrame(runUpgradeStep);
  }

  // Poll one in-flight unit-upgrade step until the command has clearly landed or become unavailable.
  monitorUnitUpgradeInFlight(token, delay = 300) {
    setTimeout(() => {
      const inFlight = this.unitUpgradeInFlight;

      if (!inFlight || inFlight.token !== token) {
        return;
      }

      const unit = Units.get(inFlight.unitId);

      if (!unit) {
        this.completeUnitUpgradeStep(inFlight.unitId, true);
        this.scheduleUnitUpgradeProcessing();
        return;
      }

      const upgradeStillAvailable = Boolean(
        this.canStartUnitCommand(
          unit.id,
          "UNITCOMMAND_UPGRADE",
          this.getDefaultCommandArgs(),
          true,
        )?.Success,
      );

      if (unit.type !== inFlight.beforeType || !upgradeStillAvailable) {
        this.completeUnitUpgradeStep(unit.id, true);
        this.scheduleUnitUpgradeProcessing();
        return;
      }

      const elapsed = Date.now() - inFlight.startedAt;

      if (elapsed < 5000) {
        this.monitorUnitUpgradeInFlight(token, elapsed < 2000 ? 250 : 450);
        return;
      }

      console.warn(
        `Dev panel: unit ${this.getUnitDisplayName(unit)} did not finish upgrading after ${elapsed} ms; skipping it.`,
      );
      this.completeUnitUpgradeStep(unit.id, false);
      this.scheduleUnitUpgradeProcessing();
    }, delay);
  }

  // Drain the manual unit-upgrade queue one safe stock upgrade request at a time.
  processUnitUpgradeQueue() {
    if (this.unitUpgradeInFlight) {
      this.updateManualUnitUpgradeStatus();
      return;
    }

    if (
      this.reinforcementInFlight ||
      this.commanderAdminInFlight ||
      this.reinforcementSweepRequested ||
      this.commanderAdminQueue.length > 0
    ) {
      if (this.manualUnitUpgradeRequested) {
        this.updateManualUnitUpgradeStatus();
        this.scheduleUnitUpgradeProcessing(200);
      }

      return;
    }

    const localPlayerId = this.getLocalPlayerId();

    while (this.unitUpgradeQueue.length > 0) {
      const unitId = this.unitUpgradeQueue[0];
      const unit = Units.get(unitId);

      if (!unit || unit.isCommanderUnit || localPlayerId === null || unit.owner !== localPlayerId) {
        this.completeUnitUpgradeStep(unitId, false);
        continue;
      }

      const upgradeResult = this.canStartUnitCommand(
        unit.id,
        "UNITCOMMAND_UPGRADE",
        this.getDefaultCommandArgs(),
        true,
      );

      if (!upgradeResult?.Success) {
        this.completeUnitUpgradeStep(unit.id, false);
        continue;
      }

      this.manualUnitUpgradeCurrentName = this.getUnitDisplayName(unit);

      const token = ++this.unitUpgradeActionSequence;

      this.unitUpgradeInFlight = {
        unitId: unit.id,
        token,
        startedAt: Date.now(),
        beforeType: unit.type,
      };

      const didStart = this.sendUnitCommand(
        unit.id,
        "UNITCOMMAND_UPGRADE",
        this.getDefaultCommandArgs(),
        () => {
          if (!this.isSameComponentId(this.unitUpgradeInFlight?.unitId, unit.id)) {
            return;
          }

          console.warn(
            `Dev panel: could not start UNITCOMMAND_UPGRADE for ${this.getUnitDisplayName(unit)}.`,
          );
          this.completeUnitUpgradeStep(unit.id, false);
          this.scheduleUnitUpgradeProcessing();
        },
      );

      if (didStart) {
        console.log(
          `Dev panel: upgrading unit ${this.manualUnitUpgradeCurrentName}.`,
        );
        this.monitorUnitUpgradeInFlight(token);
        this.updateManualUnitUpgradeStatus();
        return;
      }

      this.unitUpgradeInFlight = null;
      this.completeUnitUpgradeStep(unit.id, false);
    }

    this.finishManualUnitUpgradeStatusIfIdle();
  }

  // Score one reinforce target so the sweep can prefer the closest valid commander plot.
  getReinforcementScore(unitId, targetPlot) {
    const pathToCommander = Units.getPathTo?.(unitId, targetPlot);
    const turns = Array.isArray(pathToCommander?.turns)
      ? Math.max(...pathToCommander.turns, 0)
      : 0;
    const steps = Array.isArray(pathToCommander?.plots)
      ? pathToCommander.plots.length
      : 0;

    return turns * 1000 + steps;
  }

  // Pick the best valid reinforce plot for a unit from the engine-provided plot list.
  getBestReinforcementPlot(unitId, plotIndexes) {
    let bestPlot = null;
    let bestScore = Number.POSITIVE_INFINITY;

    plotIndexes.forEach((plotIndex) => {
      const targetPlot = GameplayMap.getLocationFromIndex(plotIndex);

      if (!targetPlot) {
        return;
      }

      const score = this.getReinforcementScore(unitId, targetPlot);

      if (bestPlot === null || score < bestScore) {
        bestPlot = targetPlot;
        bestScore = score;
      }
    });

    return bestPlot;
  }

  // Build a current reinforcement action for one unit if the engine says it is valid right now.
  getReinforcementActionForUnit(unitId) {
    const unit = Units.get(unitId);

    if (!unit || unit.isCommanderUnit) {
      return null;
    }

    const result = Game.UnitOperations?.canStart(
      unit.id,
      "UNITOPERATION_REINFORCE_ARMY",
      {},
      false,
    );

    if (!result?.Success || !result.Plots?.length) {
      return null;
    }

    // We intentionally do not hardcode any slot or stack limit here.
    // The engine already knows the current free-space and same-slot stacking rules.
    const targetPlot = this.getBestReinforcementPlot(unit.id, result.Plots);

    if (!targetPlot) {
      return null;
    }

    return {
      unitId: unit.id,
      targetPlot,
      score: this.getReinforcementScore(unit.id, targetPlot),
    };
  }

  // Build a sorted reinforcement queue from the current game state.
  buildReinforcementQueue(unitIds = null) {
    const candidateUnitIds = unitIds ?? this.getLocalUnits().map((unit) => unit.id);
    const actions = [];

    candidateUnitIds.forEach((unitId) => {
      if (this.isSameComponentId(this.reinforcementInFlight?.unitId, unitId)) {
        return;
      }

      const action = this.getReinforcementActionForUnit(unitId);

      if (action) {
        actions.push(action);
      }
    });

    actions.sort((left, right) => left.score - right.score);
    return actions;
  }

  // Check whether a unit already appears in the queued reinforcement list.
  hasQueuedReinforcementAction(unitId) {
    return this.reinforcementQueue.some((action) =>
      this.isSameComponentId(action.unitId, unitId),
    );
  }

  // Replace the current reinforcement queue with a fresh snapshot.
  replaceReinforcementQueue(unitIds = null) {
    this.reinforcementQueue = this.buildReinforcementQueue(unitIds);
    this.reinforcementSweepRequested = this.reinforcementQueue.length > 0;
    return this.reinforcementQueue.length;
  }

  // Add a single reinforceable unit to the existing queue if it is not already pending.
  enqueueReinforcementUnit(unitId) {
    const action = this.getReinforcementActionForUnit(unitId);

    if (
      !action ||
      this.hasQueuedReinforcementAction(action.unitId) ||
      this.isSameComponentId(this.reinforcementInFlight?.unitId, action.unitId)
    ) {
      return false;
    }

    this.reinforcementQueue.push(action);
    this.reinforcementQueue.sort((left, right) => left.score - right.score);
    this.reinforcementSweepRequested = true;
    return true;
  }

  // Mark one queued reinforcement step as completed and advance manual progress.
  completeReinforcementStep(unitId) {
    if (!this.isSameComponentId(this.reinforcementInFlight?.unitId, unitId)) {
      return;
    }

    this.reinforcementInFlight = null;

    if (this.manualReinforcementRequested) {
      this.manualReinforcementProcessed = Math.min(
        this.manualReinforcementProcessed + 1,
        this.manualReinforcementTotal,
      );
      this.manualReinforcementSucceeded = Math.min(
        this.manualReinforcementSucceeded + 1,
        this.manualReinforcementProcessed,
      );
    }
  }

  // Send one reinforce request for a unit to the chosen commander plot.
  sendReinforcementRequest(unitId, targetPlot) {
    const result = Game.UnitOperations?.canStart(
      unitId,
      "UNITOPERATION_REINFORCE_ARMY",
      {},
      false,
    );
    const targetPlotIndex = GameplayMap.getIndexFromLocation(targetPlot);

    if (!result?.Success || !result.Plots?.includes(targetPlotIndex)) {
      return false;
    }

    Game.UnitOperations?.sendRequest(unitId, "UNITOPERATION_REINFORCE_ARMY", {
      X: targetPlot.x,
      Y: targetPlot.y,
    });

    // Fall back to a delayed refresh in case no immediate engine event fires.
    setTimeout(() => {
      if (this.isSameComponentId(this.reinforcementInFlight?.unitId, unitId)) {
        this.completeReinforcementStep(unitId);
        this.scheduleCommanderAdminProcessing();
      }
    }, 1000);

    return true;
  }

  // Consume any pending reinforce-all work before moving on to commander admin actions.
  processAdminQueues() {
    if (this.reinforcementInFlight || this.commanderAdminInFlight) {
      this.updateManualAdminStatus();
      return;
    }

    const prioritizeCommanders =
      this.manualCommanderUpgradeRequested && !this.manualReinforcementRequested;

    if (prioritizeCommanders) {
      this.processCommanderAdminQueue();

      if (this.commanderAdminInFlight) {
        return;
      }
    }

    if (this.reinforcementSweepRequested && !prioritizeCommanders) {
      while (this.reinforcementQueue.length > 0) {
        const nextReinforcement = this.reinforcementQueue.shift();
        const refreshedReinforcement = this.getReinforcementActionForUnit(
          nextReinforcement.unitId,
        );

        if (!refreshedReinforcement) {
          if (this.manualReinforcementRequested) {
            this.manualReinforcementProcessed = Math.min(
              this.manualReinforcementProcessed + 1,
              this.manualReinforcementTotal,
            );
            this.manualReinforcementSkipped = Math.min(
              this.manualReinforcementSkipped + 1,
              this.manualReinforcementProcessed,
            );
          }

          continue;
        }

        this.reinforcementInFlight = {
          unitId: refreshedReinforcement.unitId,
        };

        if (
          this.sendReinforcementRequest(
            refreshedReinforcement.unitId,
            refreshedReinforcement.targetPlot,
          )
        ) {
          this.updateManualAdminStatus();
          return;
        }

        this.reinforcementInFlight = null;

        if (this.manualReinforcementRequested) {
          this.manualReinforcementProcessed = Math.min(
            this.manualReinforcementProcessed + 1,
            this.manualReinforcementTotal,
          );
          this.manualReinforcementSkipped = Math.min(
            this.manualReinforcementSkipped + 1,
            this.manualReinforcementProcessed,
          );
        }
      }

      this.reinforcementSweepRequested = false;
    }

    if (!prioritizeCommanders) {
      this.processCommanderAdminQueue();
    }

    this.finishManualAdminStatusIfIdle();
  }

  // Group each promotion by its prerequisites so we can calculate a stable tree depth.
  getPromotionPrerequisitesByType(details) {
    const prerequisitesByType = new Map();

    details.forEach((detail) => {
      if (!prerequisitesByType.has(detail.UnitPromotionType)) {
        prerequisitesByType.set(detail.UnitPromotionType, []);
      }

      if (detail.PrereqUnitPromotion) {
        prerequisitesByType
          .get(detail.UnitPromotionType)
          ?.push(detail.PrereqUnitPromotion);
      }
    });

    return prerequisitesByType;
  }

  // Calculate the promotion depth for each node so automatic spending is deterministic.
  getPromotionDepthMap(details) {
    const prerequisitesByType = this.getPromotionPrerequisitesByType(details);
    const depthCache = new Map();

    const resolveDepth = (promotionType, trail = new Set()) => {
      if (depthCache.has(promotionType)) {
        return depthCache.get(promotionType);
      }

      if (trail.has(promotionType)) {
        return 0;
      }

      trail.add(promotionType);

      const prerequisites = prerequisitesByType.get(promotionType) ?? [];
      const depth = prerequisites.length
        ? Math.max(
          ...prerequisites.map((prerequisite) =>
            resolveDepth(prerequisite, new Set(trail)),
          ),
        ) + 1
        : 0;

      depthCache.set(promotionType, depth);
      return depth;
    };

    prerequisitesByType.forEach((_value, promotionType) => {
      resolveDepth(promotionType);
    });

    return depthCache;
  }

  // Build and cache the static promotion metadata for one promotion class.
  getPromotionMetadataForClass(promotionClassType) {
    if (!promotionClassType) {
      return [];
    }

    if (this.promotionMetadataByClass.has(promotionClassType)) {
      return this.promotionMetadataByClass.get(promotionClassType);
    }

    const metadata = [];

    GameInfo.UnitPromotionClassSets.forEach((classSet, disciplineIndex) => {
      if (classSet.PromotionClassType !== promotionClassType) {
        return;
      }

      const details = GameInfo.UnitPromotionDisciplineDetails.filter(
        (detail) =>
          detail.UnitPromotionDisciplineType ===
          classSet.UnitPromotionDisciplineType,
      );
      const depthMap = this.getPromotionDepthMap(details);
      const seenPromotionTypes = new Set();

      details.forEach((detail, detailIndex) => {
        if (seenPromotionTypes.has(detail.UnitPromotionType)) {
          return;
        }

        seenPromotionTypes.add(detail.UnitPromotionType);

        const promotion = GameInfo.UnitPromotions.lookup(detail.UnitPromotionType);

        if (!promotion) {
          return;
        }

        metadata.push({
          disciplineIndex,
          detailIndex,
          disciplineType: classSet.UnitPromotionDisciplineType,
          promotionType: detail.UnitPromotionType,
          promotion,
          depth: depthMap.get(detail.UnitPromotionType) ?? 0,
        });
      });
    });

    metadata.sort((left, right) => {
      const commendationWeight =
        Number(right.promotion.Commendation) - Number(left.promotion.Commendation);

      if (commendationWeight !== 0) {
        return commendationWeight;
      }

      if (left.depth !== right.depth) {
        return left.depth - right.depth;
      }

      if (left.disciplineIndex !== right.disciplineIndex) {
        return left.disciplineIndex - right.disciplineIndex;
      }

      if (left.detailIndex !== right.detailIndex) {
        return left.detailIndex - right.detailIndex;
      }

      return left.promotionType.localeCompare(right.promotionType);
    });

    this.promotionMetadataByClass.set(promotionClassType, metadata);
    return metadata;
  }

  // Collect every non-commendation promotion node a commander can ever spend regular promotion points on.
  getCommanderPrimaryPromotionMetadata(commander) {
    const unitDefinition = GameInfo.Units.lookup(commander?.type);
    const promotionClassType = unitDefinition?.PromotionClass;

    if (!promotionClassType) {
      return [];
    }

    return this.getPromotionMetadataForClass(promotionClassType).filter(
      (candidate) => !candidate.promotion?.Commendation,
    );
  }

  // Collect every commendation node a commander can still unlock through later XP levels.
  getCommanderCommendationMetadata(commander) {
    const unitDefinition = GameInfo.Units.lookup(commander?.type);
    const promotionClassType = unitDefinition?.PromotionClass;

    if (!promotionClassType) {
      return [];
    }

    return this.getPromotionMetadataForClass(promotionClassType).filter(
      (candidate) => Boolean(candidate.promotion?.Commendation),
    );
  }

  // Count how many regular promotion nodes this commander still has not purchased.
  getCommanderRemainingPromotionCount(commander) {
    const experience = commander?.Experience;

    if (!experience) {
      return 0;
    }

    return this.getCommanderPrimaryPromotionMetadata(commander).filter(
      (candidate) =>
        !experience.hasPromotion(
          candidate.disciplineType,
          candidate.promotionType,
        ),
    ).length;
  }

  // Count how many commendation nodes this commander still has not purchased.
  getCommanderRemainingCommendationCount(commander) {
    const experience = commander?.Experience;

    if (!experience) {
      return 0;
    }

    return this.getCommanderCommendationMetadata(commander).filter(
      (candidate) =>
        !experience.hasPromotion(
          candidate.disciplineType,
          candidate.promotionType,
        ),
    ).length;
  }

  // Snapshot the commander XP state used by the safe commander XP grant path.
  captureCommanderXpGrantState(commander) {
    const experience = commander?.Experience;

    return {
      level: this.readNativeNumber(experience, "getLevel"),
      experiencePoints: this.readNativeNumber(experience, "experiencePoints"),
      experienceToNextLevel: this.readNativeNumber(
        experience,
        "experienceToNextLevel",
      ),
      storedPromotionPoints: this.readNativeNumber(
        experience,
        "getStoredPromotionPoints",
      ),
      storedCommendations: this.readNativeNumber(
        experience,
        "getStoredCommendations",
      ),
      remainingPromotionCount: this.getCommanderRemainingPromotionCount(
        commander,
      ),
      remainingCommendationCount: this.getCommanderRemainingCommendationCount(
        commander,
      ),
    };
  }

  // Check whether one commander has already banked enough points to buy every remaining regular promotion and commendation.
  hasCommanderXpGrantReachedCap(state) {
    return (
      state.storedPromotionPoints >= state.remainingPromotionCount &&
      state.storedCommendations >= state.remainingCommendationCount
    );
  }

  // Check whether one commander XP snapshot visibly advanced level-up progress.
  hasCommanderXpGrantAdvanced(beforeState, afterState) {
    return (
      afterState.storedPromotionPoints > beforeState.storedPromotionPoints ||
      afterState.storedCommendations > beforeState.storedCommendations ||
      afterState.level > beforeState.level
    );
  }

  // Check whether one commander XP snapshot changed any of the native-backed XP counters at all.
  hasCommanderXpGrantStateChanged(beforeState, afterState) {
    return (
      this.hasCommanderXpGrantAdvanced(beforeState, afterState) ||
      afterState.experiencePoints !== beforeState.experiencePoints ||
      afterState.experienceToNextLevel !== beforeState.experienceToNextLevel
    );
  }

  // Top a commander up only to the highest remaining promotion + commendation point totals so native counters never overflow.
  grantCommanderSafeXp(unitOrId) {
    const commander = ComponentID.isValid(unitOrId)
      ? Units.get(unitOrId)
      : unitOrId;

    if (!commander?.isCommanderUnit) {
      return {
        didChange: false,
        reason: "not-commander",
      };
    }

    const initialState = this.captureCommanderXpGrantState(commander);
    const targetPromotionPoints = initialState.remainingPromotionCount;
    const targetCommendations = initialState.remainingCommendationCount;

    if (targetPromotionPoints <= 0 && targetCommendations <= 0) {
      return {
        didChange: false,
        reason: "no-promotions-left",
        initialState,
        finalState: initialState,
      };
    }

    if (this.hasCommanderXpGrantReachedCap(initialState)) {
      return {
        didChange: false,
        reason: "already-capped",
        initialState,
        finalState: initialState,
      };
    }

    const missingPromotionPoints = Math.max(
      targetPromotionPoints - initialState.storedPromotionPoints,
      0,
    );
    const missingCommendations = Math.max(
      targetCommendations - initialState.storedCommendations,
      0,
    );
    const maxIterations = Math.max(
      missingPromotionPoints + missingCommendations,
      0,
    ) + 8;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const liveCommander = Units.get(commander.id) ?? commander;
      const beforeState = this.captureCommanderXpGrantState(liveCommander);

      if (this.hasCommanderXpGrantReachedCap(beforeState)) {
        break;
      }

      if (
        !Number.isFinite(beforeState.experienceToNextLevel) ||
        beforeState.experienceToNextLevel <= 0
      ) {
        break;
      }

      const xpNeededForNextLevel = Math.max(
        Math.ceil(
          beforeState.experienceToNextLevel - beforeState.experiencePoints,
        ),
        1,
      );

      Units.changeExperience(liveCommander.id, xpNeededForNextLevel);

      let afterState = this.captureCommanderXpGrantState(
        Units.get(liveCommander.id) ?? liveCommander,
      );

      if (
        !this.hasCommanderXpGrantAdvanced(beforeState, afterState) &&
        this.hasCommanderXpGrantStateChanged(beforeState, afterState)
      ) {
        const fallbackXpGrant = Math.max(
          Math.ceil(afterState.experienceToNextLevel),
          1,
        );

        if (fallbackXpGrant !== xpNeededForNextLevel) {
          Units.changeExperience(liveCommander.id, fallbackXpGrant);
          afterState = this.captureCommanderXpGrantState(
            Units.get(liveCommander.id) ?? liveCommander,
          );
        }
      }

      if (!this.hasCommanderXpGrantStateChanged(beforeState, afterState)) {
        break;
      }
    }

    const finalState = this.captureCommanderXpGrantState(
      Units.get(commander.id) ?? commander,
    );

    return {
      didChange:
        finalState.storedPromotionPoints !== initialState.storedPromotionPoints ||
        finalState.storedCommendations !== initialState.storedCommendations ||
        finalState.level !== initialState.level ||
        finalState.experiencePoints !== initialState.experiencePoints,
      reason: this.hasCommanderXpGrantReachedCap(finalState) ? "capped" : "partial",
      initialState,
      finalState,
    };
  }

  // Collect every currently available promotion or commendation for a commander.
  getCommanderPromotionCandidates(commander, allowTemporarySelection = false) {
    const experience = commander?.Experience;

    if (!experience) {
      return [];
    }

    const unitDefinition = GameInfo.Units.lookup(commander.type);

    if (!unitDefinition?.PromotionClass) {
      return [];
    }

    return this.getPromotionMetadataForClass(unitDefinition.PromotionClass).filter(
      (candidate) => {
        if (
          experience.hasPromotion(
            candidate.disciplineType,
            candidate.promotionType,
          )
        ) {
          return false;
        }

        const promotionArgs = {
          PromotionType: Database.makeHash(candidate.promotionType),
          PromotionDisciplineType: Database.makeHash(candidate.disciplineType),
        };

        if (
          this.canStartUnitCommand(
            commander.id,
            "UNITCOMMAND_PROMOTE",
            promotionArgs,
            allowTemporarySelection,
          )?.Success
        ) {
          return true;
        }

        if (typeof experience.canEarnPromotion !== "function") {
          return false;
        }

        try {
          return Boolean(
            experience.canEarnPromotion(
              candidate.disciplineType,
              candidate.promotionType,
              false,
            ),
          );
        } catch (_error) {
          return false;
        }
      },
    );
  }

  // Choose the next automatic commander admin action, prioritizing promotions and commendations first.
  getNextCommanderAdminAction(commander, allowTemporarySelection = false) {
    return this.getCommanderAdminActions(commander, allowTemporarySelection)[0] ?? null;
  }

  // Send a single promotion or commendation request to the game core.
  sendCommanderPromotion(unitId, candidate) {
    const args = {
      PromotionType: Database.makeHash(candidate.promotionType),
      PromotionDisciplineType: Database.makeHash(candidate.disciplineType),
    };

    return this.sendUnitCommand(unitId, "UNITCOMMAND_PROMOTE", args);
  }

  // Send a generic commander command such as "upgrade army".
  sendCommanderCommand(unitId, commandType) {
    return this.sendUnitCommand(unitId, commandType, this.getDefaultCommandArgs());
  }

  // Drain the commander admin queue one safe request at a time.
  processCommanderAdminQueue() {
    if (this.reinforcementInFlight || this.commanderAdminInFlight) {
      return;
    }

    this.pruneCommanderAdminQueue();

    while (this.commanderAdminQueue.length > 0) {
      const commanderId = this.commanderAdminQueue[0];
      const commander = Units.get(commanderId);

      if (!commander?.isCommanderUnit) {
        this.commanderAdminQueue.shift();
        this.resetCommanderRetryCount(commanderId);
        this.markManualCommanderComplete(commanderId);
        continue;
      }

      this.manualCommanderCurrentName = this.getUnitDisplayName(commander);

      const availableActions = this.getCommanderAdminActions(commander, true);

      if (availableActions.length <= 0) {
        this.commanderAdminQueue.shift();
        this.resetCommanderRetryCount(commander.id);
        this.markManualCommanderComplete(commander.id);
        console.log(
          `Dev panel: commander ${this.getUnitDisplayName(commander)} finished upgrading.`,
        );
        continue;
      }

      const beforeState = this.captureCommanderAdminState(commander);

      for (const nextAction of availableActions) {
        const token = ++this.commanderAdminActionSequence;

        this.commanderAdminInFlight = {
          kind: nextAction.kind,
          unitId: commander.id,
          token,
          startedAt: Date.now(),
          beforeState,
          actionSignature: this.getCommanderAdminActionSignature(nextAction),
        };

        const didStart =
          nextAction.kind === "promotion"
            ? this.sendCommanderPromotion(commander.id, nextAction.candidate)
            : this.sendCommanderCommand(commander.id, nextAction.commandType);

        if (didStart) {
          this.resetCommanderRetryCount(commander.id);

          if (this.manualCommanderUpgradeRequested) {
            this.manualCommanderActionsSent += 1;
          }

          console.log(
            nextAction.kind === "promotion"
              ? `Dev panel: commander ${this.manualCommanderCurrentName} -> ${nextAction.candidate.promotionType}.`
              : `Dev panel: commander ${this.manualCommanderCurrentName} -> ${nextAction.commandType}.`,
          );
          this.monitorCommanderAdminInFlight(token);
          this.updateManualAdminStatus();
          return;
        }

        this.commanderAdminInFlight = null;
      }

      const retryCount = this.incrementCommanderRetryCount(commander.id);

      if (retryCount <= 30) {
        if (retryCount === 1 || retryCount % 10 === 0) {
          console.log(
            `Dev panel: waiting for commander ${this.manualCommanderCurrentName} to expose the next upgrade (${retryCount}).`,
          );
        }

        this.updateManualAdminStatus();

        setTimeout(() => {
          this.scheduleCommanderAdminProcessing();
        }, 200);

        return;
      }

      console.warn(
        `Dev panel: dropping commander ${this.manualCommanderCurrentName} after repeated unavailable upgrade attempts.`,
      );
      this.commanderAdminQueue.shift();
      this.resetCommanderRetryCount(commander.id);
      this.markManualCommanderComplete(commander.id);
    }

    this.finishManualAdminStatusIfIdle();
  }

  // Queue every commander for a full admin sweep during autoplay.
  runAutoplayAdminTasks() {
    this.replaceReinforcementQueue();
    this.enqueueAllCommandersForAdmin();
    this.processAdminQueues();
  }

  // Read the persisted autoplay mastery preference, defaulting new installs to the stronger helper mode.
  isAutoplayMasteryEnabled() {
    const storedValue = Storage.get("dev-panel-autoplay-mastery");

    return storedValue === null ? true : Boolean(storedValue);
  }

  // Normalize any stored / requested autoplay mastery bias to one of the supported modes.
  normalizeAutoplayMasteryBias(bias) {
    const normalizedBias = `${bias ?? ""}`.trim().toLowerCase();

    return this.autoplayMasteryBiasModes.some((mode) => mode.key === normalizedBias)
      ? normalizedBias
      : "balanced";
  }

  // Read the persisted victory-bias preference for mastery-backed autoplay.
  getAutoplayMasteryBias() {
    return this.normalizeAutoplayMasteryBias(
      Storage.get("dev-panel-autoplay-bias"),
    );
  }

  // Resolve the config record for the current or requested autoplay mastery bias.
  getAutoplayMasteryBiasConfig(bias = this.autoplayMasteryBias) {
    const normalizedBias = this.normalizeAutoplayMasteryBias(bias);

    return (
      this.autoplayMasteryBiasModes.find((mode) => mode.key === normalizedBias) ??
      this.autoplayMasteryBiasModes[0]
    );
  }

  // Resolve the user-facing label for the current or requested autoplay mastery bias.
  getAutoplayMasteryBiasLabel(bias = this.autoplayMasteryBias) {
    return this.getAutoplayMasteryBiasConfig(bias).label;
  }

  // Update the autoplay mastery toggle button label.
  updateAutoplayMasteryLabel() {
    const label = document.querySelector(
      ".dev-panel-button__label--toggle-autoplay-mastery",
    );

    if (label) {
      label.textContent = this.autoplayMasteryEnabled
        ? "Master mode: On"
        : "Master mode: Off";
    }
  }

  // Update the autoplay mastery bias button label.
  updateAutoplayMasteryBiasLabel() {
    const label = document.querySelector(
      ".dev-panel-button__label--cycle-autoplay-bias",
    );

    if (label) {
      label.textContent = `Bias: ${this.getAutoplayMasteryBiasLabel()}`;
    }
  }

  // Keep the autoplay status line aligned with the current mode when no richer message is active.
  syncAutoplayStatus() {
    const biasLabel = this.getAutoplayMasteryBiasLabel();

    if (Autoplay.isActive) {
      this.setAutoplayStatus(
        this.autoplayMasteryEnabled
          ? `Autoplay: ${biasLabel} master mode running.`
          : "Autoplay: stock AI + admin running.",
      );
      return;
    }

    this.setAutoplayStatus(
      this.autoplayMasteryEnabled
        ? `Autoplay: master mode armed (${biasLabel}).`
        : "Autoplay: stock AI + admin only.",
    );
  }

  // Toggle the cheat-assisted autoplay mastery helper on or off.
  toggleAutoplayMastery() {
    const nextEnabled = !this.autoplayMasteryEnabled;

    this.autoplayMasteryEnabled = nextEnabled;
    this.autoplayMasteryNeedsSetup = nextEnabled
      ? this.autoplayMasteryNeedsSetup || Autoplay.isActive
      : false;
    Storage.set("dev-panel-autoplay-mastery", nextEnabled);
    this.updateAutoplayMasteryLabel();
    this.syncAutoplayStatus();

    if (nextEnabled && Autoplay.isActive) {
      this.runAutoplayMasteryTasks("toggle");
    }

    console.log(
      `Dev panel: autoplay master mode ${nextEnabled ? "enabled" : "disabled"}.`,
    );
  }

  // Cycle the victory-bias mode used by mastery-backed autoplay.
  cycleAutoplayMasteryBias() {
    const currentIndex = this.autoplayMasteryBiasModes.findIndex(
      (mode) => mode.key === this.normalizeAutoplayMasteryBias(this.autoplayMasteryBias),
    );
    const nextMode =
      this.autoplayMasteryBiasModes[
      (currentIndex + 1) % this.autoplayMasteryBiasModes.length
      ] ?? this.autoplayMasteryBiasModes[0];

    this.autoplayMasteryBias = nextMode.key;
    Storage.set("dev-panel-autoplay-bias", nextMode.key);
    this.updateAutoplayMasteryBiasLabel();
    this.syncAutoplayStatus();

    if (this.autoplayMasteryEnabled && Autoplay.isActive) {
      this.runAutoplayMasteryTasks("bias");
    }

    console.log(`Dev panel: autoplay victory bias -> ${nextMode.label}.`);
  }

  // Check whether autoplay still needs to push the player onto Future Tech / Future Civic.
  shouldPrimeAutoplayMasteryResearch(player = this.getLocalPlayer()) {
    if (!player || this.progressionAutomationRequested) {
      return false;
    }

    const techBranch = this.getProgressionBranchState("tech", player);
    const civicBranch = this.getProgressionBranchState("civic", player);
    const techAtRepeatable = Boolean(
      techBranch?.activeNodeType &&
      this.isRepeatableProgressionNode(techBranch.activeNodeType),
    );
    const civicAtRepeatable = Boolean(
      civicBranch?.activeNodeType &&
      this.isRepeatableProgressionNode(civicBranch.activeNodeType),
    );

    return !techAtRepeatable || !civicAtRepeatable;
  }

  // Heal only the local player's units so autoplay gets the benefit without patching up the entire world.
  healLocalUnits() {
    for (const unit of this.getLocalUnits()) {
      Units.setDamage(unit.id, 0);
    }
  }

  // Buff one local unit for autoplay mastery, using the safe commander XP path where needed.
  boostUnitForAutoplayMastery(unitOrId) {
    const localPlayerId = this.getLocalPlayerId();
    const unit = ComponentID.isValid(unitOrId) ? Units.get(unitOrId) : unitOrId;

    if (!unit || localPlayerId === null || unit.owner !== localPlayerId) {
      return false;
    }

    Units.setDamage(unit.id, 0);

    if (unit.isCommanderUnit) {
      this.grantCommanderSafeXp(unit);
      this.enqueueCommanderForAdmin(unit.id);
      return true;
    }

    Units.changeExperience(unit.id, 10000000);
    return true;
  }

  // Count how many local units currently match one unit type.
  getLocalUnitCountByType(unitType) {
    if (!unitType) {
      return 0;
    }

    return this.getLocalUnits().filter((unit) => unit?.type === unitType).length;
  }

  // Spawn one settler at the capital without stealing selection or camera focus from autoplay.
  spawnSettlerForAutoplay() {
    const localPlayerId = this.getLocalPlayerId();
    const capitalLocation = this.getLocalPlayer()?.Cities?.getCapital?.()?.location;

    if (localPlayerId === null || !capitalLocation) {
      return false;
    }

    Game.PlayerOperations.sendRequest(localPlayerId, "CREATE_ELEMENT", {
      IndependentIndex: -1,
      Kind: "UNIT",
      Location: capitalLocation,
      Owner: localPlayerId,
      Type: "UNIT_SETTLER",
    });

    return true;
  }

  // Decide whether the expansion bias should inject another settler this turn.
  shouldSpawnAutoplayExpansionSettler(cityCount, settlerCount, needsSetup) {
    if (cityCount <= 0 || cityCount >= 10 || settlerCount >= 2) {
      return false;
    }

    if (needsSetup) {
      return true;
    }

    if (this.autoplayMasteryTurnCounter <= 0) {
      return false;
    }

    return this.autoplayMasteryTurnCounter % (cityCount < 4 ? 2 : 3) === 0;
  }

  // Apply the extra support bundle for the current autoplay victory bias.
  applyAutoplayMasteryBiasSupport(player, context) {
    const biasKey = this.normalizeAutoplayMasteryBias(this.autoplayMasteryBias);
    const summary = {
      populationBursts: 0,
      settlersSpawned: 0,
      extraRegularUnitsBuffed: 0,
      extraCommandersPrimed: 0,
      forcedResearchSweep: false,
    };

    switch (biasKey) {
      case "domination": {
        this.addHappiness();
        this.startGoldenAge();

        if (!context.needsSetup && this.autoplayMasteryTurnCounter % 3 === 0) {
          const rebuffSummary = this.primeAutoplayMasteryUnits();

          summary.extraRegularUnitsBuffed += rebuffSummary.regularUnitsBuffed;
          summary.extraCommandersPrimed += rebuffSummary.commandersPrimed;
        }

        break;
      }

      case "science": {
        this.addPopulation();
        summary.populationBursts += context.cityCount;
        summary.forcedResearchSweep = true;
        break;
      }

      case "expansion": {
        this.addPopulation();
        summary.populationBursts += context.cityCount;

        if (
          this.shouldSpawnAutoplayExpansionSettler(
            context.cityCount,
            context.settlerCount,
            context.needsSetup,
          ) &&
          this.spawnSettlerForAutoplay()
        ) {
          summary.settlersSpawned += 1;
        }

        break;
      }

      default: {
        if (context.needsSetup) {
          this.addPopulation();
          summary.populationBursts += context.cityCount;
        }

        break;
      }
    }

    return summary;
  }

  // Prime every current local unit once at the start of a mastery-backed autoplay run.
  primeAutoplayMasteryUnits(units = this.getLocalUnits()) {
    let regularUnitsBuffed = 0;
    let commandersPrimed = 0;

    units.forEach((unit) => {
      if (!this.boostUnitForAutoplayMastery(unit)) {
        return;
      }

      if (unit.isCommanderUnit) {
        commandersPrimed += 1;
        return;
      }

      regularUnitsBuffed += 1;
    });

    return {
      regularUnitsBuffed,
      commandersPrimed,
    };
  }

  // Keep commanders topped up during autoplay without repeatedly blasting every regular unit with XP.
  primeAutoplayMasteryCommanders(commanders = this.getCommanderUnits()) {
    let commandersPrimed = 0;

    commanders.forEach((commander) => {
      if (!this.boostUnitForAutoplayMastery(commander)) {
        return;
      }

      commandersPrimed += 1;
    });

    return commandersPrimed;
  }

  // Surround the stock autoplay AI with aggressive research, economy, production, and military support.
  runAutoplayMasteryTasks(reason = "turn") {
    if (!this.autoplayMasteryEnabled) {
      this.runAutoplayAdminTasks();
      this.syncAutoplayStatus();
      return;
    }

    const player = this.getLocalPlayer();

    if (!player) {
      return;
    }

    const now = Date.now();
    const needsSetup = this.autoplayMasteryNeedsSetup;
    const biasLabel = this.getAutoplayMasteryBiasLabel();

    if (!needsSetup && now - this.autoplayMasteryLastRunAt < 800) {
      return;
    }

    this.autoplayMasteryLastRunAt = now;
    this.autoplayMasteryNeedsSetup = false;

    if (needsSetup) {
      this.revealMap();
      this.meetAll();
      this.addHappiness();
      this.startGoldenAge();
    }

    const cityCount = this.getLocalCities().length;
    const settlerCount = this.getLocalUnitCountByType("UNIT_SETTLER");
    const buffSummary = needsSetup
      ? this.primeAutoplayMasteryUnits()
      : {
        regularUnitsBuffed: 0,
        commandersPrimed: this.primeAutoplayMasteryCommanders(),
      };
    const biasSummary = this.applyAutoplayMasteryBiasSupport(player, {
      needsSetup,
      cityCount,
      settlerCount,
      reason,
    });
    const shouldPrimeResearch =
      this.shouldPrimeAutoplayMasteryResearch(player) &&
      (biasSummary.forcedResearchSweep ||
        this.autoplayMasteryBias !== "domination" ||
        needsSetup ||
        this.autoplayMasteryTurnCounter % 4 === 0);

    this.completeProduction();
    this.addGold();
    this.addInfluence();
    this.healLocalUnits();

    if (shouldPrimeResearch) {
      this.completeAllResearchAndCivics();
    }

    this.runAutoplayAdminTasks();

    this.setAutoplayStatus(
      needsSetup
        ? `Autoplay: ${biasLabel} setup ran — ${cityCount} cities, ${buffSummary.regularUnitsBuffed + biasSummary.extraRegularUnitsBuffed} regular units buffed, ${buffSummary.commandersPrimed + biasSummary.extraCommandersPrimed} commanders primed${biasSummary.populationBursts > 0 ? `, +pop to ${biasSummary.populationBursts} city slots` : ""}${biasSummary.settlersSpawned > 0 ? `, ${biasSummary.settlersSpawned} settler spawned` : ""}${shouldPrimeResearch ? ", research sweep armed" : ""}.`
        : `Autoplay: ${biasLabel} upkeep ran — production, economy, healing, ${buffSummary.commandersPrimed + biasSummary.extraCommandersPrimed} commanders primed${biasSummary.extraRegularUnitsBuffed > 0 ? `, ${biasSummary.extraRegularUnitsBuffed} regular units re-buffed` : ""}${biasSummary.populationBursts > 0 ? `, +pop to ${biasSummary.populationBursts} city slots` : ""}${biasSummary.settlersSpawned > 0 ? `, ${biasSummary.settlersSpawned} settler spawned` : ""}${shouldPrimeResearch ? ", research sweep armed" : ""}.`,
    );
    console.log(
      `Dev panel: autoplay ${biasLabel.toLowerCase()} master ${needsSetup ? "setup" : reason} complete (turn=${this.autoplayMasteryTurnCounter}, cities=${cityCount}, settlers=${settlerCount}, regularUnits=${buffSummary.regularUnitsBuffed + biasSummary.extraRegularUnitsBuffed}, commanders=${buffSummary.commandersPrimed + biasSummary.extraCommandersPrimed}, populationBursts=${biasSummary.populationBursts}, spawnedSettlers=${biasSummary.settlersSpawned}, research=${shouldPrimeResearch ? "primed" : "steady"}).`,
    );
  }

  // Queue every currently reinforceable unit and let the engine assign them to valid commanders.
  reinforceAllAvailableUnits() {
    const reinforceableUnits = this.replaceReinforcementQueue();

    if (reinforceableUnits <= 0) {
      this.manualReinforcementRequested = false;
      this.resetManualReinforcementProgress();
      this.setCommanderStatus("No units can reinforce right now.");
      console.log("Dev panel: no units can reinforce right now.");
      this.scheduleCommanderStatusReset();
      return;
    }

    this.manualReinforcementRequested = true;
    this.manualReinforcementTotal = reinforceableUnits;
    this.manualReinforcementProcessed = 0;
    this.manualReinforcementSucceeded = 0;
    this.manualReinforcementSkipped = 0;
    this.setCommanderStatus(`Reinforcing units… 0 reinforced, 0 skipped, ${reinforceableUnits} left to try`);
    console.log(`Dev panel: reinforcing ${reinforceableUnits} available unit(s).`);
    this.processAdminQueues();
  }

  // Fire a one-click empire tune-up that chains together the highest-value maintenance cheats.
  runEmpireMaintenance() {
    if (!this.getLocalPlayer()) {
      this.setEmpireStatus("Empire: no local player found.");
      console.log("Dev panel: no local player found for empire maintenance.");
      this.scheduleEmpireStatusReset();
      return;
    }

    this.setEmpireStatus(
      "Empire: tune-up launched — economy, cities, armies, and research queued.",
    );
    console.log("Dev panel: launching full empire maintenance.");

    this.addGold();
    this.addInfluence();
    this.addHappiness();
    this.startGoldenAge();
    this.completeProduction();
    this.addPopulation();
    this.healUnits();
    this.addXp();
    this.reinforceAllAvailableUnits();
    this.upgradeAllAvailableUnits();
    this.completeAllResearchAndCivics();
    this.scheduleEmpireStatusReset(4500);
  }

  // Queue every commander that can currently spend promotions, commendations, or formation upgrades.
  upgradeSelectedCommander() {
    const commanders = this.getCommanderUnits();

    if (commanders.length <= 0) {
      this.manualCommanderUpgradeRequested = false;
      this.resetManualCommanderProgress();
      this.setCommanderStatus("No local commanders found.");
      console.log("Dev panel: no local commanders found.");
      this.scheduleCommanderStatusReset();
      return;
    }

    this.manualCommanderUpgradeRequested = true;
    this.beginManualCommanderProgress(commanders.map((commander) => commander.id));
    this.setCommanderStatus(
      `Upgrading commanders… 0/${commanders.length} done, ${commanders.length} left, 0 actions sent`,
    );
    console.log(
      `Dev panel: scanning ${commanders.length} commander(s) for upgrades.`,
    );

    this.enqueueAllCommandersForAdmin();

    this.processAdminQueues();
  }

  // Queue every local non-commander unit that can currently use the stock Upgrade Unit command.
  upgradeAllAvailableUnits() {
    const upgradeableUnits = this.getUpgradeableUnits();
    const upgradeableCommanders = this.getCommandersWithAdminActions();

    if (upgradeableUnits.length <= 0 && upgradeableCommanders.length <= 0) {
      this.manualUnitUpgradeRequested = false;
      this.resetManualUnitUpgradeProgress();
      this.manualCommanderUpgradeRequested = false;
      this.resetManualCommanderProgress();
      this.setUnitsStatus("No local units or commanders can upgrade right now.");
      this.setCommanderStatus("Commanders: ready");
      console.log("Dev panel: no local units or commanders can upgrade right now.");
      this.scheduleUnitsStatusReset();
      return;
    }

    if (upgradeableCommanders.length > 0) {
      this.manualCommanderUpgradeRequested = true;
      this.beginManualCommanderProgress(
        upgradeableCommanders.map((commander) => commander.id),
      );
      this.setCommanderStatus(
        `Upgrading commanders… 0/${upgradeableCommanders.length} done, ${upgradeableCommanders.length} left, 0 actions sent`,
      );
      console.log(
        `Dev panel: scanning ${upgradeableCommanders.length} commander(s) for upgrades.`,
      );
      upgradeableCommanders.forEach((commander) => {
        this.enqueueCommanderForAdmin(commander.id);
      });
      this.processAdminQueues();
    } else {
      this.manualCommanderUpgradeRequested = false;
      this.resetManualCommanderProgress();
      this.setCommanderStatus("No commanders need upgrades right now.");
      this.scheduleCommanderStatusReset();
    }

    if (upgradeableUnits.length > 0) {
      this.manualUnitUpgradeRequested = true;
      this.beginManualUnitUpgradeProgress(
        upgradeableUnits.map((unit) => unit.id),
      );
      this.setUnitsStatus(
        `Upgrading units… 0/${upgradeableUnits.length} upgraded, 0 skipped, ${upgradeableUnits.length} left`,
      );
      console.log(
        `Dev panel: scanning ${upgradeableUnits.length} unit(s) for upgrades.`,
      );
      this.scheduleUnitUpgradeProcessing();
      return;
    }

    this.manualUnitUpgradeRequested = false;
    this.resetManualUnitUpgradeProgress();
    this.setUnitsStatus("No regular units need upgrades right now; upgrading commanders.");
    this.scheduleUnitsStatusReset(4000);
  }

  // Start a fresh autoplay admin sweep when autoplay begins.
  onAutoplayStarted() {
    this.autoplayMasteryTurnCounter = 0;

    if (this.autoplayMasteryEnabled && Date.now() - this.autoplayMasteryLastRunAt > 1000) {
      this.autoplayMasteryNeedsSetup = true;
    }

    this.runAutoplayMasteryTasks("started");
  }

  // Re-run autoplay admin tasks at the start of the local player's autoplay turn.
  onPlayerTurnActivated(data) {
    const localPlayerId = this.getLocalPlayerId();

    if (!Autoplay.isActive || localPlayerId === null || data.player !== localPlayerId) {
      return;
    }

    this.autoplayMasteryTurnCounter += 1;
    this.runAutoplayMasteryTasks("turn");
  }

  // Queue newly created commanders so autoplay can immediately clean up their admin work too.
  onUnitAddedToMap(data) {
    const localPlayerId = this.getLocalPlayerId();
    const unit = Units.get(data.unit) ?? data.unit;

    if (localPlayerId === null) {
      return;
    }

    if (!unit || unit.owner !== localPlayerId) {
      return;
    }

    if (!Autoplay.isActive && !this.reinforcementSweepRequested) {
      return;
    }

    if (Autoplay.isActive) {
      // New local units may be reinforceable immediately.
      this.enqueueReinforcementUnit(unit.id);

      if (this.autoplayMasteryEnabled) {
        this.boostUnitForAutoplayMastery(unit);
      }
    }

    if (unit.isCommanderUnit) {
      this.enqueueCommanderForAdmin(unit.id);
    }

    this.scheduleCommanderAdminProcessing();
  }

  // Continue a reinforce-all sweep when a unit is successfully added to an army.
  onUnitAddedToArmy(data) {
    const localPlayerId = this.getLocalPlayerId();
    const unitId = this.getEventUnitId(data);
    const unit = Units.get(unitId) ?? data?.unit ?? data?.initiatingUnit ?? null;

    if (
      localPlayerId === null ||
      !unit ||
      unit.owner !== localPlayerId ||
      (!Autoplay.isActive &&
        !this.reinforcementSweepRequested &&
        !this.isSameComponentId(this.reinforcementInFlight?.unitId, unit.id))
    ) {
      return;
    }

    this.completeReinforcementStep(unit.id);

    this.reinforcementSweepRequested = this.reinforcementQueue.length > 0;
    this.scheduleCommanderAdminProcessing();
  }

  // Continue a reinforce-all sweep when a unit starts traveling to its commander off-map.
  onUnitRemovedFromMap(data) {
    const localPlayerId = this.getLocalPlayerId();
    const unitId = this.getEventUnitId(data);
    const unit = Units.get(unitId) ?? data?.unit ?? null;

    if (
      localPlayerId === null ||
      !unit ||
      unit.owner !== localPlayerId ||
      (!Autoplay.isActive &&
        !this.reinforcementSweepRequested &&
        !this.isSameComponentId(this.reinforcementInFlight?.unitId, unit.id))
    ) {
      return;
    }

    this.completeReinforcementStep(unit.id);

    this.reinforcementSweepRequested = this.reinforcementQueue.length > 0;
    this.scheduleCommanderAdminProcessing();
  }

  // Re-run the reinforce sweep when autoplay frees a slot by removing a unit from an army.
  onUnitRemovedFromArmy(data) {
    const localPlayerId = this.getLocalPlayerId();
    const unitId = this.getEventUnitId(data);
    const unit = Units.get(unitId) ?? data?.unit ?? data?.initiatingUnit ?? null;

    if (!Autoplay.isActive || localPlayerId === null || !unit || unit.owner !== localPlayerId) {
      return;
    }

    this.replaceReinforcementQueue();
    this.scheduleCommanderAdminProcessing();
  }

  // When a commander gains XP during autoplay, queue it for automatic spending.
  onUnitExperienceChanged(data) {
    const localPlayerId = this.getLocalPlayerId();
    const unit = Units.get(data.unit);

    if (!unit?.isCommanderUnit || unit.owner !== localPlayerId) {
      return;
    }

    if (
      !Autoplay.isActive &&
      !this.hasQueuedCommander(unit.id) &&
      !this.isSameComponentId(this.commanderAdminInFlight?.unitId, unit.id)
    ) {
      return;
    }

    this.enqueueCommanderForAdmin(unit.id);
    this.scheduleCommanderAdminProcessing();
  }

  // Clear the in-flight promotion step and keep draining until the commander is fully spent.
  onUnitPromoted(data) {
    const localPlayerId = this.getLocalPlayerId();
    const unit = Units.get(data.unit);

    if (!unit?.isCommanderUnit || unit.owner !== localPlayerId) {
      return;
    }

    if (
      !Autoplay.isActive &&
      !this.hasQueuedCommander(unit.id) &&
      !this.isSameComponentId(this.commanderAdminInFlight?.unitId, unit.id)
    ) {
      return;
    }

    if (this.isSameComponentId(this.commanderAdminInFlight?.unitId, unit.id)) {
      this.commanderAdminInFlight = null;
    }

    this.resetCommanderRetryCount(unit.id);
    this.enqueueCommanderForAdmin(unit.id);
    this.scheduleCommanderAdminProcessing();
  }

  // Clear the in-flight army-upgrade step and keep draining until no admin work remains.
  onUnitCommandStarted(data) {
    const localPlayerId = this.getLocalPlayerId();
    const unit = Units.get(data.unit) ?? data.unit;

    if (localPlayerId === null || !unit || unit.owner !== localPlayerId) {
      return;
    }

    if (data.command === Database.makeHash("UNITCOMMAND_UPGRADE")) {
      if (
        !this.manualUnitUpgradeRequested &&
        !this.isSameComponentId(this.unitUpgradeInFlight?.unitId, unit.id)
      ) {
        return;
      }

      this.completeUnitUpgradeStep(unit.id, true);
      this.scheduleUnitUpgradeProcessing();
      return;
    }

    if (!unit.isCommanderUnit) {
      return;
    }

    if (data.command !== Database.makeHash("UNITCOMMAND_UPGRADE_ARMY")) {
      return;
    }

    if (
      !Autoplay.isActive &&
      !this.hasQueuedCommander(unit.id) &&
      !this.isSameComponentId(this.commanderAdminInFlight?.unitId, unit.id)
    ) {
      return;
    }

    if (this.isSameComponentId(this.commanderAdminInFlight?.unitId, unit.id)) {
      this.commanderAdminInFlight = null;
    }

    this.resetCommanderRetryCount(unit.id);

    if (Autoplay.isActive || this.manualReinforcementRequested || this.reinforcementSweepRequested) {
      this.replaceReinforcementQueue();
    }

    this.enqueueCommanderForAdmin(unit.id);
    this.scheduleCommanderAdminProcessing();
  }

  register() {
    // Walk every action definition so we can wire matching panel buttons.
    Object.entries(this.map).forEach(([key, callback]) => {
      // Find every control with the class that matches the action key.
      const buttons = document.querySelectorAll(`.dev-panel-button--${key}`);

      // Skip actions that only exist as hotkeys or are not present in the DOM.
      if (!buttons.length) {
        return;
      }

      const tooltip = this.buttonTooltips[key];

      buttons.forEach((button) => {
        if (tooltip) {
          button.setAttribute("data-tooltip-content", tooltip);
          button.setAttribute("data-tooltip-anchor", "top");
          button.setAttribute("title", tooltip);
        }

        // Remove any previous registration so reopening the panel does not stack handlers.
        button.removeEventListener("action-activate", callback);

        // Attach the handler that will run when the button is activated.
        button.addEventListener("action-activate", callback);
      });
    });

    this.applyFastGameplaySettings(this.isFastGameplayEnabled());
    this.updatePerformanceProfilerLabel();
    this.autoplayMasteryEnabled = this.isAutoplayMasteryEnabled();
    this.autoplayMasteryBias = this.getAutoplayMasteryBias();
    this.updateAutoplayMasteryLabel();
    this.updateAutoplayMasteryBiasLabel();

    if (this.performanceProfilerEnabled) {
      this.setPerformanceStatus("Profiler: sampling frame times…");
    } else if (!this.fastGameplayEnabled) {
      this.setPerformanceStatus("Performance: ready");
    }

    if (this.progressionAutomationRequested) {
      this.scheduleProgressionAutomation();
    } else {
      this.setProgressionStatus("Progression: ready");
    }

    this.setEmpireStatus("Empire: ready");

    if (this.manualUnitUpgradeRequested) {
      this.updateManualUnitUpgradeStatus();
    } else {
      this.setUnitsStatus("Units: ready");
    }

    this.syncAutoplayStatus();

    this.finishManualAdminStatusIfIdle();
    this.finishManualUnitUpgradeStatusIfIdle();
  }

  updateFontSize(value = 0) {
    // Start from the saved font size, or the default if nothing has been stored yet.
    let fontSize = Number(Storage.get("dev-panel-font-size") ?? 0.65);

    // Apply the requested delta.
    fontSize += Number(value ?? 0);

    // Clamp floating-point noise so values stay tidy in storage and CSS.
    fontSize = Number(fontSize.toFixed(2));

    // Persist the updated font size.
    Storage.set("dev-panel-font-size", fontSize);

    // Find the live panel root element.
    const element = document.querySelector(`.dev-panel`);

    // Apply the new CSS font size if the panel is currently mounted.
    if (element) {
      element.style.fontSize = `${fontSize}rem`;
    }
  }

  // Migrate older saved panel positions so the redesigned sidebar opens on the left by default.
  migratePanelLayout() {
    const layoutVersion = Number(Storage.get("dev-panel-layout-version") ?? 0);

    if (layoutVersion >= 2) {
      return;
    }

    Storage.set("dev-panel-layout-version", 2);
    Storage.set("dev-panel-position-left", 0.75);
  }

  updatePositionLeft(value = 0) {
    // Start from the saved left offset, or the default offset when unset.
    let positionLeft = Number(Storage.get("dev-panel-position-left") ?? 0.75);

    // Apply the requested horizontal delta.
    positionLeft += Number(value ?? 0);

    // Round the value so it does not drift from floating-point precision errors.
    positionLeft = Number(positionLeft.toFixed(2));

    // Persist the updated offset.
    Storage.set("dev-panel-position-left", positionLeft);

    // Find the live panel root element.
    const element = document.querySelector(`.dev-panel`);

    // Apply the new CSS left position if the panel is currently mounted.
    if (element) {
      element.style.left = `${positionLeft}rem`;
    }
  }

  // Resolve a user-facing string that may already be localized or may still be a localization key.
  resolveDisplayText(value, fallback = "") {
    if (typeof value !== "string" || value.length <= 0) {
      return fallback;
    }

    try {
      const localizedValue = Locale.compose(value);

      return typeof localizedValue === "string" && localizedValue.length > 0
        ? localizedValue
        : value;
    } catch (_error) {
      return value;
    }
  }

  // Turn arbitrary session parts into storage-safe slugs.
  sanitizeProfilerSessionPart(value, fallback = "unknown") {
    const normalizedValue = `${value ?? ""}`
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return normalizedValue || fallback;
  }

  // Build stable profiler session metadata from the current save so resumed games append to the same stored log buffer.
  getProfilerSessionMetadata() {
    const localPlayer = this.getLocalPlayer();
    const localPlayerId = this.getLocalPlayerId();
    const leaderType = localPlayer?.leaderType ?? localPlayer?.leaderName ?? "unknown-leader";
    const leaderInfo = GameInfo.Leaders.lookup?.(leaderType);
    const leaderName =
      this.resolveDisplayText(leaderInfo?.Name) ||
      `${localPlayer?.leaderName ?? localPlayer?.name ?? leaderType}`;
    const civNameRaw =
      localPlayer?.civilizationName ??
      localPlayer?.civilizationAdjective ??
      localPlayer?.civilizationType ??
      "unknown-civ";
    const civName = this.resolveDisplayText(civNameRaw) || `${civNameRaw}`;
    const playerName = `${localPlayer?.name ?? `Player ${localPlayerId ?? "unknown"}`}`;
    const civilizationType = `${localPlayer?.civilizationType ?? civName}`;
    const mapSeed =
      Configuration.getMap?.()?.mapSeed ?? GameplayMap.getRandomSeed?.() ?? "unknown-map-seed";
    const gameSeed = Configuration.getGame?.()?.gameSeed ?? "unknown-game-seed";
    const sessionKey = [
      "leader",
      this.sanitizeProfilerSessionPart(leaderType, "leader"),
      "civ",
      this.sanitizeProfilerSessionPart(civilizationType, "civ"),
      "map",
      this.sanitizeProfilerSessionPart(mapSeed, "map"),
      "game",
      this.sanitizeProfilerSessionPart(gameSeed, "game"),
      "player",
      this.sanitizeProfilerSessionPart(localPlayerId, "player"),
    ].join("-");
    const sessionName = `${leaderName} · ${civName} · map ${mapSeed}`;

    this.performanceProfilerSessionKey = sessionKey;
    this.performanceProfilerSessionName = sessionName;

    return {
      sessionKey,
      sessionName,
      playerName,
      localPlayerId,
      leaderName,
      leaderType,
      civName,
      civilizationType,
      mapSeed,
      gameSeed,
    };
  }

  // Read the persistent profiler session store from localStorage.
  getProfilerSessionStore() {
    const store = Storage.get("dev-panel-profiler-sessions");

    return store && typeof store === "object" && !Array.isArray(store)
      ? store
      : {};
  }

  // Keep only a handful of recent profiler sessions so the localStorage blob stays lightweight.
  trimProfilerSessionStore(store) {
    const sortedSessionKeys = Object.keys(store).sort((leftKey, rightKey) => {
      const leftUpdatedAt =
        Date.parse(store[leftKey]?.updatedAt ?? store[leftKey]?.createdAt ?? "") || 0;
      const rightUpdatedAt =
        Date.parse(store[rightKey]?.updatedAt ?? store[rightKey]?.createdAt ?? "") || 0;

      return rightUpdatedAt - leftUpdatedAt;
    });

    sortedSessionKeys
      .slice(this.performanceProfilerMaxSessionCount)
      .forEach((sessionKey) => {
        delete store[sessionKey];
      });
  }

  // Persist the profiler session store quietly so it does not flood the mirrored dev console.
  saveProfilerSessionStore(store) {
    this.trimProfilerSessionStore(store);
    Storage.setQuietly("dev-panel-profiler-sessions", store);
  }

  // Append one profiler entry to the current session log.
  appendProfilerSessionEntry(level, message) {
    const metadata = this.getProfilerSessionMetadata();
    const timestamp = new Date().toISOString();
    const store = this.getProfilerSessionStore();
    const session = store[metadata.sessionKey] ?? {
      createdAt: timestamp,
      metadata,
      entries: [],
    };

    session.metadata = {
      ...(session.metadata ?? {}),
      ...metadata,
    };
    session.updatedAt = timestamp;
    session.entries = Array.isArray(session.entries) ? session.entries : [];
    session.entries.push({
      timestamp,
      level,
      message,
    });

    while (session.entries.length > this.performanceProfilerMaxEntriesPerSession) {
      session.entries.shift();
    }

    store[metadata.sessionKey] = session;
    this.saveProfilerSessionStore(store);
    return session;
  }

  // Return the persisted profiler session that matches the current save context.
  getActiveProfilerSession() {
    const metadata = this.getProfilerSessionMetadata();
    const store = this.getProfilerSessionStore();

    return store[metadata.sessionKey] ?? null;
  }

  // Format one persisted profiler session as plain text so it can be copied or dumped into the console.
  formatProfilerSessionLog(session) {
    if (!session) {
      return "";
    }

    const metadata = session.metadata ?? {};
    const entries = Array.isArray(session.entries) ? session.entries : [];

    return [
      "Dev Panel Profiler Log",
      `Session: ${metadata.sessionName ?? metadata.sessionKey ?? "unknown session"}`,
      `Session Key: ${metadata.sessionKey ?? "unknown"}`,
      `Player: ${metadata.playerName ?? "unknown"}`,
      `Leader: ${metadata.leaderName ?? metadata.leaderType ?? "unknown"}`,
      `Civilization: ${metadata.civName ?? metadata.civilizationType ?? "unknown"}`,
      `Map Seed: ${metadata.mapSeed ?? "unknown"}`,
      `Game Seed: ${metadata.gameSeed ?? "unknown"}`,
      `Created: ${session.createdAt ?? "unknown"}`,
      `Updated: ${session.updatedAt ?? "unknown"}`,
      `Entries: ${entries.length}`,
      "",
      ...entries.map(
        (entry) =>
          `[${entry.timestamp ?? "unknown time"}] [${String(entry.level ?? "info").toUpperCase()}] ${entry.message ?? ""}`,
      ),
    ].join("\n");
  }

  // Format the combined debug export so it can be pasted directly into a text file.
  formatCombinedLogExport(session, consoleEntries) {
    const profilerLog =
      session && Array.isArray(session.entries) && session.entries.length > 0
        ? this.formatProfilerSessionLog(session)
        : "No profiler session entries recorded yet.";
    const mirroredConsoleLog = consoleEntries.length > 0
      ? Logs.getText()
      : "No mirrored dev console entries recorded yet.";

    return [
      "Dev Panel Debug Export",
      `Generated: ${new Date().toISOString()}`,
      `Panel Console Visible: ${Console.isVisible() ? "yes" : "no"}`,
      `Mirrored Console Entries: ${consoleEntries.length}`,
      "",
      "=== Profiler Session Log ===",
      profilerLog,
      "",
      "=== Mirrored Dev Console Log ===",
      mirroredConsoleLog,
    ].join("\n");
  }

  // Copy the profiler session log plus the mirrored dev console buffer to the clipboard.
  copyAllLogs() {
    const session = this.getActiveProfilerSession();
    const consoleEntries = Logs.getEntries();
    const hasProfilerEntries =
      session && Array.isArray(session.entries) && session.entries.length > 0;
    const hasConsoleEntries = consoleEntries.length > 0;

    if (!hasProfilerEntries && !hasConsoleEntries) {
      this.setPerformanceStatus("Copy logs: nothing recorded yet.");
      console.log("Dev panel: no profiler or mirrored console logs recorded yet.");
      return;
    }

    const formattedLog = this.formatCombinedLogExport(session, consoleEntries);

    if (UI.isClipboardAvailable?.() && typeof UI.setClipboardText === "function") {
      UI.setClipboardText(formattedLog);
      this.setPerformanceStatus(
        `Logs copied · ${hasProfilerEntries ? session.entries.length : 0} profiler entries · ${consoleEntries.length} console lines`,
      );
      console.log(
        `Dev panel: copied combined debug log${session?.metadata?.sessionName ? ` for ${session.metadata.sessionName}` : ""}.`,
      );
      return;
    }

    this.setPerformanceStatus("Clipboard unavailable; dumped combined debug log into the browser console.");
    console.log(`Dev panel: combined debug log dump follows.\n${formattedLog}`);
  }

  // Clear the mirrored dev console buffer and every stored profiler session log.
  clearAllLogs() {
    Logs.clear();
    Storage.setQuietly("dev-panel-profiler-sessions", {});
    this.performanceProfilerSessionKey = "";
    this.performanceProfilerSessionName = "";
    this.setPerformanceStatus(
      this.performanceProfilerEnabled
        ? "Logs cleared. Profiler will start filling new entries again while it stays enabled."
        : "Logs cleared.",
    );
  }

  // Describe the current UI/gameplay context around a profiler sample so hitch logs are easier to interpret later.
  describeProfilerContext() {
    const selectedUnit = this.getSelectedUnit();
    const selectedUnitLabel = selectedUnit
      ? this.getUnitDisplayName(selectedUnit)
      : "none";
    const pendingReinforcements =
      this.reinforcementQueue.length + (this.reinforcementInFlight ? 1 : 0);

    return [
      `selected=${selectedUnitLabel}`,
      `console=${Console.isVisible() ? "open" : "closed"}`,
      `fastGameplay=${this.fastGameplayEnabled ? "on" : "off"}`,
      `commandersPending=${this.getPendingCommanderQueueCount()}`,
      `reinforcementsPending=${pendingReinforcements}`,
    ].join(" · ");
  }

  // Read one percentile from a sorted frame-time sample list.
  getProfilerPercentile(sortedSamples, percentile) {
    if (!Array.isArray(sortedSamples) || sortedSamples.length <= 0) {
      return 0;
    }

    const boundedPercentile = Math.min(Math.max(percentile, 0), 100);
    const sampleIndex = Math.min(
      sortedSamples.length - 1,
      Math.max(0, Math.ceil((boundedPercentile / 100) * sortedSamples.length) - 1),
    );

    return Number(sortedSamples[sampleIndex] ?? 0);
  }

  // Emit one detailed profiler outlier log, with light rate limiting so minor stutters do not spam forever.
  logPerformanceProfilerOutlier(frameMs, timestamp) {
    const isHitch = frameMs >= 100;

    if (!isHitch && timestamp - this.performanceProfilerLastOutlierLoggedAt < 2000) {
      return;
    }

    this.performanceProfilerLastOutlierLoggedAt = timestamp;
    const message = `${isHitch ? "Hitch" : "Long frame"} detected: ${frameMs.toFixed(1)} ms · ${this.describeProfilerContext()}`;

    this.appendProfilerSessionEntry(isHitch ? "warn" : "info", message);
    console.log(`Dev panel: ${message}`);
  }

  // Flush the current profiler window into the status text, console, and persistent session log.
  flushPerformanceProfilerWindow(timestamp, reason = "interval") {
    if (this.performanceProfilerFrameCount <= 0) {
      this.resetPerformanceProfilerWindow(timestamp);
      return null;
    }

    const sampledDuration = Math.max(
      timestamp - this.performanceProfilerWindowStartedAt,
      1,
    );
    const averageFrameMs = sampledDuration / Math.max(this.performanceProfilerFrameCount, 1);
    const fps = 1000 / averageFrameMs;
    const sortedSamples = [...this.performanceProfilerFrameSamples].sort(
      (left, right) => left - right,
    );
    const medianFrameMs = this.getProfilerPercentile(sortedSamples, 50);
    const p95FrameMs = this.getProfilerPercentile(sortedSamples, 95);
    const compactSummary = `Profiler: ${averageFrameMs.toFixed(1)} ms avg · ${fps.toFixed(0)} FPS · p95 ${p95FrameMs.toFixed(1)} ms · ${this.performanceProfilerSlowFrameCount} slow · ${this.performanceProfilerHitchFrameCount} hitches · ${this.performanceProfilerWorstFrameMs.toFixed(1)} ms worst`;
    const detailedSummary = [
      reason === "stop" ? "Profiler stop snapshot" : "Profiler window",
      `session=${this.performanceProfilerSessionName || this.getProfilerSessionMetadata().sessionName}`,
      `duration=${sampledDuration.toFixed(0)} ms`,
      `frames=${this.performanceProfilerFrameCount}`,
      `avg=${averageFrameMs.toFixed(2)} ms`,
      `fps=${fps.toFixed(1)}`,
      `p50=${medianFrameMs.toFixed(1)} ms`,
      `p95=${p95FrameMs.toFixed(1)} ms`,
      `slow34=${this.performanceProfilerSlowFrameCount}`,
      `slow50=${this.performanceProfilerVerySlowFrameCount}`,
      `hitches100=${this.performanceProfilerHitchFrameCount}`,
      `worst=${this.performanceProfilerWorstFrameMs.toFixed(1)} ms`,
      this.describeProfilerContext(),
    ].join(" · ");

    this.setPerformanceStatus(compactSummary);
    this.appendProfilerSessionEntry("info", detailedSummary);
    console.log(`Dev panel: ${detailedSummary}`);
    this.resetPerformanceProfilerWindow(timestamp);
    return compactSummary;
  }

  // Read the persisted fast-gameplay state once and normalize it to a boolean.
  isFastGameplayEnabled() {
    return Boolean(Storage.get("dev-panel-fast-gameplay"));
  }

  // Update the fast-gameplay button label so it reflects the current option bundle state.
  updateFastGameplayLabel() {
    const label = document.querySelector(
      ".dev-panel-button__label--toggle-fast-gameplay",
    );

    if (label) {
      label.textContent = this.fastGameplayEnabled
        ? "Fast gameplay: On"
        : "Fast gameplay: Off";
    }
  }

  // Update the profiler button label so it reflects whether frame sampling is active right now.
  updatePerformanceProfilerLabel() {
    const label = document.querySelector(
      ".dev-panel-button__label--toggle-performance-profiler",
    );

    if (label) {
      label.textContent = this.performanceProfilerEnabled
        ? "Profiler: On"
        : "Profiler: Off";
    }
  }

  // Apply or release the hidden fast-gameplay settings that skip combat/movement presentation overhead.
  applyFastGameplaySettings(enabled) {
    this.fastGameplayEnabled = Boolean(enabled);

    if (this.fastGameplayEnabled) {
      const previousNotificationPan = UI.getOption?.(
        "user",
        "Interface",
        "NotificationCameraPan",
      );

      if (
        Storage.get("dev-panel-notification-camera-pan-before-fast") === null &&
        previousNotificationPan !== undefined &&
        previousNotificationPan !== null
      ) {
        Storage.set(
          "dev-panel-notification-camera-pan-before-fast",
          Number(previousNotificationPan),
        );
      }

      Configuration.getUser()?.setLockedValue?.("QuickMovement", true);
      Configuration.getUser()?.setLockedValue?.("QuickCombat", true);
      UI.setOption?.("user", "Interface", "NotificationCameraPan", 0);
      this.setPerformanceStatus(
        "Fast gameplay enabled: quick combat, quick movement, and notification camera pans reduced.",
      );
    } else {
      Configuration.getUser()?.lockValue?.("QuickMovement", false);
      Configuration.getUser()?.lockValue?.("QuickCombat", false);

      const previousNotificationPan = Storage.get(
        "dev-panel-notification-camera-pan-before-fast",
      );

      if (previousNotificationPan !== null) {
        UI.setOption?.(
          "user",
          "Interface",
          "NotificationCameraPan",
          Number(previousNotificationPan) ? 1 : 0,
        );
        Storage.set("dev-panel-notification-camera-pan-before-fast", null);
      }

      this.setPerformanceStatus("Performance: ready");
    }

    this.updateFastGameplayLabel();
  }

  // Toggle the hidden fast-gameplay option bundle on or off.
  toggleFastGameplay() {
    const nextEnabled = !this.fastGameplayEnabled;

    Storage.set("dev-panel-fast-gameplay", nextEnabled);
    this.applyFastGameplaySettings(nextEnabled);
    console.log(
      `Dev panel: fast gameplay ${nextEnabled ? "enabled" : "disabled"}.`,
    );
  }

  // Reset one profiler reporting window so the next sample batch starts cleanly.
  resetPerformanceProfilerWindow(startedAt = 0) {
    this.performanceProfilerWindowStartedAt = startedAt;
    this.performanceProfilerFrameCount = 0;
    this.performanceProfilerSlowFrameCount = 0;
    this.performanceProfilerVerySlowFrameCount = 0;
    this.performanceProfilerHitchFrameCount = 0;
    this.performanceProfilerWorstFrameMs = 0;
    this.performanceProfilerFrameSamples = [];
  }

  // Handle one requestAnimationFrame profiler tick and emit verbose frame-time diagnostics every couple of seconds.
  onPerformanceProfilerFrame(timestamp) {
    if (!this.performanceProfilerEnabled) {
      return;
    }

    if (this.performanceProfilerLastFrameAt > 0) {
      const frameMs = timestamp - this.performanceProfilerLastFrameAt;

      this.performanceProfilerFrameCount += 1;
      this.performanceProfilerFrameSamples.push(frameMs);
      this.performanceProfilerWorstFrameMs = Math.max(
        this.performanceProfilerWorstFrameMs,
        frameMs,
      );

      if (frameMs > 34) {
        this.performanceProfilerSlowFrameCount += 1;
      }

      if (frameMs > 50) {
        this.performanceProfilerVerySlowFrameCount += 1;
        this.logPerformanceProfilerOutlier(frameMs, timestamp);
      }

      if (frameMs >= 100) {
        this.performanceProfilerHitchFrameCount += 1;
      }
    }

    if (this.performanceProfilerWindowStartedAt <= 0) {
      this.performanceProfilerWindowStartedAt = timestamp;
    }

    this.performanceProfilerLastFrameAt = timestamp;

    if (timestamp - this.performanceProfilerWindowStartedAt >= 2000) {
      this.flushPerformanceProfilerWindow(timestamp);
    }

    this.performanceProfilerFrameHandle = requestAnimationFrame((nextTimestamp) => {
      this.onPerformanceProfilerFrame(nextTimestamp);
    });
  }

  // Start the lightweight frame profiler.
  startPerformanceProfiler() {
    if (this.performanceProfilerEnabled) {
      return;
    }

    const metadata = this.getProfilerSessionMetadata();

    this.performanceProfilerEnabled = true;
    this.performanceProfilerFrameHandle = 0;
    this.performanceProfilerLastFrameAt = 0;
    this.performanceProfilerLastOutlierLoggedAt = 0;
    this.resetPerformanceProfilerWindow();
    this.updatePerformanceProfilerLabel();
    this.setPerformanceStatus(`Profiler: sampling… ${metadata.sessionName}`);
    this.appendProfilerSessionEntry(
      "info",
      [
        "Profiler started",
        `session=${metadata.sessionName}`,
        `key=${metadata.sessionKey}`,
        `player=${metadata.playerName}`,
        `leader=${metadata.leaderName}`,
        `civ=${metadata.civName}`,
        `mapSeed=${metadata.mapSeed}`,
        `gameSeed=${metadata.gameSeed}`,
        `fastGameplay=${this.fastGameplayEnabled ? "on" : "off"}`,
        this.describeProfilerContext(),
      ].join(" · "),
    );
    console.log(
      `Dev panel: profiler started · session=${metadata.sessionName} · key=${metadata.sessionKey}.`,
    );
    this.performanceProfilerFrameHandle = requestAnimationFrame((timestamp) => {
      this.onPerformanceProfilerFrame(timestamp);
    });
  }

  // Stop the lightweight frame profiler and clear its sampling loop.
  stopPerformanceProfiler() {
    if (this.performanceProfilerFrameHandle) {
      cancelAnimationFrame(this.performanceProfilerFrameHandle);
      this.performanceProfilerFrameHandle = 0;
    }

    const stopTimestamp =
      this.performanceProfilerLastFrameAt ||
      globalThis.performance?.now?.() ||
      Date.now();

    this.flushPerformanceProfilerWindow(stopTimestamp, "stop");

    const metadata = this.getProfilerSessionMetadata();

    this.appendProfilerSessionEntry(
      "info",
      `Profiler stopped · session=${metadata.sessionName} · ${this.describeProfilerContext()}`,
    );
    console.log(`Dev panel: profiler stopped · session=${metadata.sessionName}.`);

    this.performanceProfilerEnabled = false;
    this.performanceProfilerLastFrameAt = 0;
    this.performanceProfilerLastOutlierLoggedAt = 0;
    this.resetPerformanceProfilerWindow();
    this.updatePerformanceProfilerLabel();
    this.setPerformanceStatus(
      this.fastGameplayEnabled
        ? "Fast gameplay enabled: quick combat, quick movement, and notification camera pans reduced."
        : "Performance: ready",
    );
  }

  // Toggle the lightweight frame profiler on or off.
  togglePerformanceProfiler() {
    if (this.performanceProfilerEnabled) {
      this.stopPerformanceProfiler();
      return;
    }

    this.startPerformanceProfiler();
  }

  startAutoplay(turns) {
    // Return a callback so the action map can store a ready-to-use handler.
    return () => {
      // Resolve the local player once for all autoplay calls.
      const localPlayerId = this.getLocalPlayerId();

      // Abort early if the game has no active local player yet.
      if (localPlayerId === null) {
        return;
      }

      // Configure how many turns autoplay should run for.
      Autoplay.setTurns(turns);

      // Return control to the same player after autoplay finishes.
      Autoplay.setReturnAsPlayer(localPlayerId);

      // Observe the same player during autoplay.
      Autoplay.setObserveAsPlayer(localPlayerId);

      // Prime the current autoplay run before the engine AI takes over.
      this.autoplayMasteryTurnCounter = 0;
      this.setAutoplayStatus(
        this.autoplayMasteryEnabled
          ? `Autoplay: starting ${this.getAutoplayMasteryBiasLabel()} master mode for ${turns} turn${turns === 1 ? "" : "s"}…`
          : `Autoplay: starting stock AI for ${turns} turn${turns === 1 ? "" : "s"}…`,
      );
      this.autoplayMasteryNeedsSetup = this.autoplayMasteryEnabled;
      this.runAutoplayMasteryTasks("start");

      // Start autoplay.
      Autoplay.setActive(true);
    };
  }

  revealMap() {
    // Resolve the local player once before calling the engine API.
    const localPlayerId = this.getLocalPlayerId();

    // Abort early if there is no active local player.
    if (localPlayerId === null) {
      return;
    }

    // Reveal every plot for the current player.
    Visibility.revealAllPlots(localPlayerId);
  }

  addGold() {
    // Resolve the local player once before granting yields.
    const localPlayerId = this.getLocalPlayerId();

    // Abort early if there is no active local player.
    if (localPlayerId === null) {
      return;
    }

    // Grant a very large amount of gold to the current player.
    Players.grantYield(localPlayerId, YieldTypes.YIELD_GOLD, 1000000);
  }

  addInfluence() {
    // Add a very large diplomacy balance boost to the current player.
    this.getLocalPlayer()?.DiplomacyTreasury?.changeDiplomacyBalance?.(1000000);
  }

  addHappiness() {
    // Resolve the local player once before granting yields.
    const localPlayerId = this.getLocalPlayerId();
    const player = this.getLocalPlayer();

    // Abort early if there is no active local player.
    if (localPlayerId === null || !player) {
      return;
    }

    // Capture the current celebration progress so we can verify that the button actually did something.
    const beforeState = this.captureHappinessState(player);
    const captureState = () => this.captureHappinessState(this.getLocalPlayer());

    // First try the obvious yield-grant path.
    try {
      Players.grantYield(localPlayerId, YieldTypes.YIELD_HAPPINESS, 1000);
    } catch (_error) {
      // Ignore and continue into the native-method fallbacks below.
    }

    // Some gamecore-backed values update on the next tick, so probe after a short delay.
    setTimeout(() => {
      let afterState = captureState();

      if (this.hasHappinessStateChanged(beforeState, afterState)) {
        console.log(
          `Dev panel: happiness changed (${beforeState.lifetimeHappiness} -> ${afterState.lifetimeHappiness}).`,
        );
        return;
      }

      const currentPlayer = this.getLocalPlayer();
      const yieldHash =
        typeof Database?.makeHash === "function"
          ? Database.makeHash("YIELD_HAPPINESS")
          : null;

      const statsMethodNames = [
        "changeLifetimeYield",
        "adjustLifetimeYield",
        "addLifetimeYield",
        "changeYield",
        "adjustYield",
        "addYield",
        "grantYield",
      ];
      const statsArgLists = [
        [YieldTypes.YIELD_HAPPINESS, 1000],
        ...(yieldHash !== null ? [[yieldHash, 1000]] : []),
      ];

      const happinessMethodNames = [
        "changeHappiness",
        "adjustHappiness",
        "addHappiness",
        "changeProgress",
        "adjustProgress",
        "addProgress",
        "changeCelebrationProgress",
        "adjustCelebrationProgress",
        "addCelebrationProgress",
        "changeGoldenAgeProgress",
        "adjustGoldenAgeProgress",
        "addGoldenAgeProgress",
        "changeGoldenAgePoints",
        "adjustGoldenAgePoints",
        "addGoldenAgePoints",
      ];

      let applied = this.tryInvokeMutationMethods(
        currentPlayer?.Stats,
        statsMethodNames,
        statsArgLists,
        beforeState,
        captureState,
      );

      if (!applied) {
        applied = this.tryInvokeMutationMethods(
          currentPlayer?.Happiness,
          happinessMethodNames,
          [[1000]],
          beforeState,
          captureState,
        );
      }

      afterState = captureState();

      if (applied || this.hasHappinessStateChanged(beforeState, afterState)) {
        console.log(
          `Dev panel: happiness changed (${beforeState.lifetimeHappiness} -> ${afterState.lifetimeHappiness}).`,
        );
        return;
      }

      const statsMethods = this.getCallablePropertyNames(currentPlayer?.Stats)
        .filter((name) => /yield|lifetime/i.test(name))
        .slice(0, 20);
      const happinessMethods = this.getCallablePropertyNames(currentPlayer?.Happiness)
        .filter((name) => /happiness|golden|celebration|progress/i.test(name))
        .slice(0, 20);

      console.warn(
        "Dev panel: could not find a working happiness mutation API.",
        {
          beforeState,
          afterState,
          statsMethods,
          happinessMethods,
        },
      );
    }, 50);
  }

  startGoldenAge() {
    // Resolve the local player once before calling into the happiness system.
    const localPlayerId = this.getLocalPlayerId();

    // Abort early if there is no active local player.
    if (localPlayerId === null) {
      return;
    }

    // Trigger a golden age / celebration for the current player.
    this.getLocalPlayer()?.Happiness?.startGoldenAge?.(localPlayerId);
  }

  addWildcardAttributePoint() {
    // Resolve the local player once so we can both grant and verify the wildcard point change.
    const player = this.getLocalPlayer();

    // Abort early if the identity subsystem is unavailable.
    if (!player?.Identity) {
      return;
    }

    // Snapshot the current attribute point state so we can confirm the grant and refresh the stock UI correctly.
    const beforeState = this.captureAttributePointState(player);

    try {
      // Grant exactly one wildcard point so the button matches its label and avoids absurd UI counts.
      player.Identity.addWildcardAttributePoints?.(1000);
    } catch (_error) {
      // Ignore and fall through to the verification / diagnostics below.
    }

    setTimeout(() => {
      const currentPlayer = this.getLocalPlayer();
      const afterState = this.captureAttributePointState(currentPlayer);

      if (this.hasAttributePointStateChanged(beforeState, afterState)) {
        console.log(
          `Dev panel: wildcard attribute points changed (${beforeState.wildcardPoints} -> ${afterState.wildcardPoints}).`,
        );
        this.refreshAttributeTreeUi();
        return;
      }

      const identityMethods = this.getCallablePropertyNames(currentPlayer?.Identity)
        .filter((name) => /attribute|wildcard/i.test(name))
        .slice(0, 20);

      console.warn("Dev panel: wildcard attribute points did not change.", {
        beforeState,
        afterState,
        identityMethods,
      });
      this.refreshAttributeTreeUi();
    }, 50);
  }

  reloadUI() {
    // Ask the game to reload the entire UI layer.
    UI.reloadUI();
  }

  transitionToNextAge() {
    // Fire the engine call that advances the game into the next age.
    engine.call("transitionToNextAge");
  }

  completeProduction() {
    // Iterate over a safe city list so this action does nothing instead of crashing.
    this.getLocalCities().forEach((city) => {
      // Complete the current production item for each city.
      city?.BuildQueue?.completeProduction?.();
    });
  }

  addPopulation() {
    // Iterate over a safe city list so this action does nothing instead of crashing.
    this.getLocalCities().forEach((city) => {
      // Add one rural population to each city.
      city?.addRuralPopulation?.(1);
    });
  }

  spawnSettler() {
    // Resolve the local player ID once for all follow-up calls.
    const localPlayerId = this.getLocalPlayerId();

    // Resolve the local player object so we can ask for the capital and units.
    const player = this.getLocalPlayer();

    // Read the capital from the player city manager if that API is available.
    const capital = player?.Cities?.getCapital?.();

    // Abort early when the game cannot provide a valid capital plot.
    if (localPlayerId === null || !capital?.location) {
      return;
    }

    // Request a settler to be created on the capital's tile.
    Game.PlayerOperations.sendRequest(localPlayerId, "CREATE_ELEMENT", {
      // `-1` means the unit is not owned by an independent faction.
      IndependentIndex: -1,

      // Create a unit rather than a building or some other object type.
      Kind: "UNIT",

      // Place the unit on the capital's location.
      Location: capital.location,

      // Make the local player the owner.
      Owner: localPlayerId,

      // Spawn a settler specifically.
      Type: "UNIT_SETTLER",
    });

    // Search local units for the newly created settler so we can focus it.
    for (const unit of this.getLocalUnits()) {
      // Match the settler that appeared on the capital tile.
      if (
        unit.name === "Settler" &&
        unit.location?.x === capital.location.x &&
        unit.location?.y === capital.location.y
      ) {
        // Clear any previous unit selection first.
        UI.Player.deselectAllUnits();

        // Select the new settler.
        UI.Player.selectUnit(unit.id);

        // Move the camera to the capital so the new unit is visible.
        Camera.lookAtPlot(capital.location);

        // Stop once the first matching settler has been handled.
        break;
      }
    }
  }

  // Close the stock tech/civic completion popup when automation needs to keep rolling.
  dismissTechCivicPopup() {
    if (!ContextManager.hasInstanceOf("screen-tech-civic-complete")) {
      return false;
    }

    try {
      ContextManager.pop("screen-tech-civic-complete");
      return true;
    } catch (_error) {
      return false;
    }
  }

  // Normalize a progression node identifier into the request payload shape expected by player operations.
  getProgressionNodeArg(nodeType) {
    const numericNodeType = Number(nodeType);

    return Number.isFinite(numericNodeType) ? numericNodeType : nodeType;
  }

  // Compare two progression node identifiers safely even when the engine mixes strings and numeric hashes.
  isSameProgressionNode(left, right) {
    return left !== null && left !== undefined && right !== null && right !== undefined
      ? String(left) === String(right)
      : false;
  }

  // Resolve a readable progression node name for status text and logs.
  getProgressionNodeName(nodeType) {
    const nodeInfo = GameInfo.ProgressionTreeNodes.lookup(nodeType);

    if (nodeInfo?.Name) {
      return Locale.compose(nodeInfo.Name);
    }

    return nodeInfo?.ProgressionTreeNodeType ?? String(nodeType ?? "Node");
  }

  // Check whether one progression node is the repeatable future node that should end the sweep.
  isRepeatableProgressionNode(nodeType) {
    const nodeInfo = GameInfo.ProgressionTreeNodes.lookup(nodeType);

    return Boolean(
      nodeInfo?.Repeatable ||
      /FUTURE_(TECH|CIVIC)/i.test(nodeInfo?.ProgressionTreeNodeType ?? ""),
    );
  }

  // Reset the visible progress state for the full tech-and-civic sweep.
  resetProgressionAutomationProgress() {
    this.progressionAutomationTechCompleted = 0;
    this.progressionAutomationCivicCompleted = 0;
    this.progressionAutomationInFlight = {
      tech: null,
      civic: null,
    };
  }

  // Read one progression branch in a consistent shape so the automation can treat techs and civics the same way.
  getProgressionBranchState(kind, player = this.getLocalPlayer()) {
    if (!player) {
      return null;
    }

    const manager = kind === "tech" ? player.Techs : player.Culture;

    if (!manager) {
      return null;
    }

    const treeType =
      kind === "tech" ? manager.getTreeType?.() : manager.getActiveTree?.();

    if (treeType === null || treeType === undefined) {
      return null;
    }

    const treeObject = Game.ProgressionTrees.getTree(player.id, treeType);

    if (!treeObject) {
      return null;
    }

    return {
      kind,
      player,
      manager,
      treeType,
      treeObject,
      activeNodeType:
        treeObject.activeNodeIndex >= 0
          ? treeObject.nodes?.[treeObject.activeNodeIndex]?.nodeType ?? null
          : null,
      setNodeOperationType:
        kind === "tech"
          ? PlayerOperationTypes.SET_TECH_TREE_NODE
          : PlayerOperationTypes.SET_CULTURE_TREE_NODE,
      yieldType:
        kind === "tech" ? YieldTypes.YIELD_SCIENCE : YieldTypes.YIELD_CULTURE,
      futureLabel: kind === "tech" ? "Future Tech selected" : "Future Civic selected",
    };
  }

  // Find the next selectable node in one progression branch, preferring unfinished normal nodes before the future repeatable.
  getNextSelectableProgressionNode(branch) {
    if (!branch?.treeObject?.nodes?.length) {
      return null;
    }

    let repeatableNodeType = null;

    for (const node of branch.treeObject.nodes) {
      const nodeType = node?.nodeType;

      if (!nodeType) {
        continue;
      }

      const args = {
        ProgressionTreeNodeType: this.getProgressionNodeArg(nodeType),
      };
      const result = Game.PlayerOperations.canStart(
        branch.player.id,
        branch.setNodeOperationType,
        args,
        false,
      );

      if (!result?.Success) {
        continue;
      }

      if (this.isRepeatableProgressionNode(nodeType)) {
        repeatableNodeType ??= nodeType;
        continue;
      }

      return nodeType;
    }

    return repeatableNodeType;
  }

  // Select the next tech/civic node exactly the way the stock tree does when a node is open right now.
  selectProgressionNode(branch, nodeType) {
    if (!branch || !nodeType) {
      return false;
    }

    const args = {
      ProgressionTreeNodeType: this.getProgressionNodeArg(nodeType),
    };
    const result = Game.PlayerOperations.canStart(
      branch.player.id,
      branch.setNodeOperationType,
      args,
      false,
    );

    if (!result?.Success) {
      return false;
    }

    Game.PlayerOperations.sendRequest(
      branch.player.id,
      branch.setNodeOperationType,
      args,
    );
    return true;
  }

  // Grant enough science or culture to finish one specific active node immediately.
  grantYieldForProgressionNode(branch, nodeType, allowRepeatable = false) {
    if (!branch || !nodeType) {
      return false;
    }

    const nodeInfo = GameInfo.ProgressionTreeNodes.lookup(nodeType);

    if (!nodeInfo || (!allowRepeatable && this.isRepeatableProgressionNode(nodeType))) {
      return false;
    }

    const nodeCost = Math.max(Number(branch.manager.getNodeCost(nodeType) ?? 0), 1);
    const netYield = Number(
      branch.player.Stats?.getNetYield(branch.yieldType) ?? 0,
    );
    const turnsLeft = Math.max(Number(branch.manager.getTurnsLeft?.() ?? 0), 1);
    const grantedYield =
      netYield > 0
        ? Math.max(Math.ceil(netYield * turnsLeft * 1.4), nodeCost)
        : nodeCost;

    Players.grantYield(branch.player.id, branch.yieldType, grantedYield);
    return true;
  }

  // Keep the progression status line in sync while the full tech-and-civic sweep is running.
  updateProgressionAutomationStatus(techResult, civicResult) {
    if (!this.progressionAutomationRequested) {
      this.setProgressionStatus("Progression: ready");
      return;
    }

    this.setProgressionStatus(
      `Finishing techs & civics… ${this.progressionAutomationTechCompleted} techs, ${this.progressionAutomationCivicCompleted} civics — Tech: ${techResult.done ? techResult.futureLabel : techResult.label}; Civic: ${civicResult.done ? civicResult.futureLabel : civicResult.label}`,
    );
  }

  // Schedule one delayed progression-automation step so the UI stays responsive while the sweep runs.
  scheduleProgressionAutomation(delay = 0) {
    if (!this.progressionAutomationRequested || this.progressionAutomationStepScheduled) {
      return;
    }

    this.progressionAutomationStepScheduled = true;

    const runStep = () => {
      this.progressionAutomationStepScheduled = false;
      this.processProgressionAutomation();
    };

    if (delay > 0) {
      setTimeout(runStep, delay);
      return;
    }

    requestAnimationFrame(runStep);
  }

  // Advance one tech/civic branch by either selecting its next node or finishing the current non-repeatable node.
  processProgressionAutomationBranch(branch) {
    if (!branch) {
      return {
        done: true,
        label: "Unavailable",
        futureLabel: "Unavailable",
      };
    }

    const activeNodeType = branch.activeNodeType;
    const inFlight = this.progressionAutomationInFlight[branch.kind];

    if (activeNodeType && this.isRepeatableProgressionNode(activeNodeType)) {
      this.progressionAutomationInFlight[branch.kind] = null;
      return {
        done: true,
        label: this.getProgressionNodeName(activeNodeType),
        futureLabel: branch.futureLabel,
      };
    }

    if (!activeNodeType) {
      this.progressionAutomationInFlight[branch.kind] = null;
      const nextNodeType = this.getNextSelectableProgressionNode(branch);

      if (!nextNodeType) {
        return {
          done: true,
          label: branch.futureLabel,
          futureLabel: branch.futureLabel,
        };
      }

      const nextNodeName = this.getProgressionNodeName(nextNodeType);
      const didSelect = this.selectProgressionNode(branch, nextNodeType);

      return {
        done: false,
        label: didSelect ? `Selecting ${nextNodeName}` : `Waiting to select ${nextNodeName}`,
        futureLabel: branch.futureLabel,
      };
    }

    const activeNodeName = this.getProgressionNodeName(activeNodeType);

    if (!inFlight || !this.isSameProgressionNode(inFlight.nodeType, activeNodeType)) {
      const didGrant = this.grantYieldForProgressionNode(branch, activeNodeType);

      if (didGrant) {
        this.progressionAutomationInFlight[branch.kind] = {
          nodeType: activeNodeType,
          grantedAt: Date.now(),
          retries: 0,
        };
      }

      return {
        done: false,
        label: activeNodeName,
        futureLabel: branch.futureLabel,
      };
    }

    const elapsed = Date.now() - inFlight.grantedAt;

    if (elapsed >= 1200 && inFlight.retries < 2) {
      const didGrant = this.grantYieldForProgressionNode(branch, activeNodeType);

      if (didGrant) {
        inFlight.grantedAt = Date.now();
        inFlight.retries += 1;
      }
    }

    return {
      done: false,
      label: activeNodeName,
      futureLabel: branch.futureLabel,
    };
  }

  // Finalize the full tech-and-civic sweep and restore the idle status text after a short delay.
  finishProgressionAutomation(message) {
    this.progressionAutomationRequested = false;
    this.progressionAutomationStepScheduled = false;
    this.dismissTechCivicPopup();
    this.resetProgressionAutomationProgress();
    this.setProgressionStatus(message);
    console.log(`Dev panel: ${message}`);
    this.scheduleProgressionStatusReset(4000);
  }

  // Run the full research/civic sweep in the background until the player lands on Future Tech and Future Civic.
  completeAllResearchAndCivics() {
    if (!this.getLocalPlayer()) {
      return;
    }

    if (this.progressionAutomationRequested) {
      this.setProgressionStatus("Progression sweep already running.");
      return;
    }

    this.progressionAutomationRequested = true;
    this.resetProgressionAutomationProgress();
    this.dismissTechCivicPopup();
    this.setProgressionStatus("Finishing techs & civics…");
    console.log(
      "Dev panel: finishing every remaining tech and civic until Future Tech and Future Civic are selected.",
    );
    this.scheduleProgressionAutomation();
  }

  // Advance the full tech-and-civic sweep without monopolizing the UI thread.
  processProgressionAutomation() {
    if (!this.progressionAutomationRequested) {
      return;
    }

    const player = this.getLocalPlayer();

    if (!player) {
      this.finishProgressionAutomation("Progression sweep stopped: no local player.");
      return;
    }

    this.dismissTechCivicPopup();

    const techResult = this.processProgressionAutomationBranch(
      this.getProgressionBranchState("tech", player),
    );
    const civicResult = this.processProgressionAutomationBranch(
      this.getProgressionBranchState("civic", player),
    );

    this.updateProgressionAutomationStatus(techResult, civicResult);

    if (techResult.done && civicResult.done) {
      this.finishProgressionAutomation(
        "All standard techs and civics are finished. Future Tech and Future Civic are selected.",
      );
      return;
    }

    this.scheduleProgressionAutomation(150);
  }

  // Keep the full tech sweep moving whenever the current research node completes.
  onTechNodeCompleted(data) {
    const localPlayerId = this.getLocalPlayerId();

    if (!this.progressionAutomationRequested || localPlayerId === null || data.player !== localPlayerId) {
      return;
    }

    this.progressionAutomationTechCompleted += 1;
    this.progressionAutomationInFlight.tech = null;
    this.dismissTechCivicPopup();
    this.scheduleProgressionAutomation(60);
  }

  // Keep the full civic sweep moving whenever the current civic node completes.
  onCultureNodeCompleted(data) {
    const localPlayerId = this.getLocalPlayerId();

    if (!this.progressionAutomationRequested || localPlayerId === null || data.player !== localPlayerId) {
      return;
    }

    this.progressionAutomationCivicCompleted += 1;
    this.progressionAutomationInFlight.civic = null;
    this.dismissTechCivicPopup();
    this.scheduleProgressionAutomation(60);
  }

  completeTech() {
    // Resolve the current player because tech progress belongs to that player.
    const player = this.getLocalPlayer();

    // Abort if there is no active local player.
    if (!player) {
      return;
    }

    // Read the player's tech manager.
    const techs = player.Techs;

    // Abort if the tech system is not available yet.
    if (!techs) {
      return;
    }

    // Determine which tech tree the player is currently using.
    const techTreeType = techs.getTreeType();

    // Resolve the current progression tree state.
    const treeObject = Game.ProgressionTrees.getTree(player.id, techTreeType);

    // Abort if the tree data is missing.
    if (!treeObject) {
      return;
    }

    // Read the currently active research node.
    const currentResearchNode =
      treeObject.nodes?.[treeObject.activeNodeIndex]?.nodeType;

    // Abort if no research node is active.
    if (!currentResearchNode) {
      return;
    }

    // Validate that the node exists in game data before trying to pay for it.
    const nodeInfo = GameInfo.ProgressionTreeNodes.lookup(currentResearchNode);

    // Abort if the node lookup fails.
    if (!nodeInfo) {
      return;
    }

    // Read the remaining science cost of the active node.
    const techCost = techs.getNodeCost(currentResearchNode);

    // Read the player's net science per turn.
    const playerSciencePerTurn =
      player.Stats?.getNetYield(YieldTypes.YIELD_SCIENCE) ?? 0;

    // Treat zero or missing turns-left as one turn so the action still completes reliably.
    const turnsLeft = Math.max(techs.getTurnsLeft?.() ?? 0, 1);

    // Calculate a science grant that is comfortably enough to finish the node.
    const grantedScience =
      playerSciencePerTurn > 0
        ? Math.ceil(playerSciencePerTurn * turnsLeft * 1.4)
        : techCost;

    // Grant the science to the player.
    Players.grantYield(player.id, YieldTypes.YIELD_SCIENCE, grantedScience);
  }

  completeCivic() {
    // Resolve the current player because civic progress belongs to that player.
    const player = this.getLocalPlayer();

    // Abort if there is no active local player.
    if (!player) {
      return;
    }

    // Read the player's culture manager.
    const culture = player.Culture;

    // Abort if the culture system is not available yet.
    if (!culture) {
      return;
    }

    // Determine which civic tree is currently active.
    const cultureTreeType = culture.getActiveTree();

    // Resolve the current progression tree state.
    const treeObject = Game.ProgressionTrees.getTree(
      player.id,
      cultureTreeType,
    );

    // Abort if the tree data is missing.
    if (!treeObject) {
      return;
    }

    // Read the currently active civic node.
    const currentCivicNode =
      treeObject.nodes?.[treeObject.activeNodeIndex]?.nodeType;

    // Abort if no civic node is active.
    if (!currentCivicNode) {
      return;
    }

    // Validate that the node exists in game data before trying to pay for it.
    const nodeInfo = GameInfo.ProgressionTreeNodes.lookup(currentCivicNode);

    // Abort if the node lookup fails.
    if (!nodeInfo) {
      return;
    }

    // Read the remaining culture cost of the active node.
    const cultureCost = culture.getNodeCost(currentCivicNode);

    // Read the player's net culture per turn.
    const playerCulturePerTurn =
      player.Stats?.getNetYield(YieldTypes.YIELD_CULTURE) ?? 0;

    // Treat zero or missing turns-left as one turn so the action still completes reliably.
    const turnsLeft = Math.max(culture.getTurnsLeft?.() ?? 0, 1);

    // Calculate a culture grant that is comfortably enough to finish the node.
    const grantedCulture =
      playerCulturePerTurn > 0
        ? Math.ceil(playerCulturePerTurn * turnsLeft * 1.4)
        : cultureCost;

    // Grant the culture to the player.
    Players.grantYield(player.id, YieldTypes.YIELD_CULTURE, grantedCulture);
  }

  healUnits() {
    // Iterate over every alive player's safe unit list so this action heals all player-owned units.
    for (const unit of this.getAllPlayerUnits()) {
      // Remove all damage from each player-owned unit.
      Units.setDamage(unit.id, 0);
    }
  }

  addXp() {
    let regularUnitsBoosted = 0;
    let commandersCapped = 0;
    let commandersAlreadyCapped = 0;
    let commandersPartiallyCapped = 0;

    // Iterate over a safe unit list so this action does nothing instead of crashing.
    for (const unit of this.getLocalUnits()) {
      if (unit?.isCommanderUnit) {
        const result = this.grantCommanderSafeXp(unit);

        if (result.didChange) {
          if (result.reason === "capped") {
            commandersCapped += 1;
          } else {
            commandersPartiallyCapped += 1;
          }
        } else {
          commandersAlreadyCapped += 1;
        }

        continue;
      }

      // Grant a huge amount of experience so non-command units level immediately.
      Units.changeExperience(unit.id, 10000000);
      regularUnitsBoosted += 1;
    }

    console.log(
      `Dev panel: max safe XP applied to ${regularUnitsBoosted} regular unit(s); ${commandersCapped} commander(s) filled to their promotion/commendation cap, ${commandersPartiallyCapped} commander(s) advanced partway, ${commandersAlreadyCapped} commander(s) already at cap.`,
    );
  }

  sleepAllUnits() {
    // Iterate over a safe unit list so this action does nothing instead of crashing.
    for (const unit of this.getLocalUnits()) {
      // Change each unit's activity to sleep.
      Units.setActivity(unit.id, UnitActivityTypes.SLEEP);
    }
  }

  meetAll() {
    // Resolve the local player once before building requests.
    const localPlayerId = this.getLocalPlayerId();

    // Abort early if there is no active local player.
    if (localPlayerId === null) {
      return;
    }

    // Walk every living player in the game.
    for (const id of Players.getAliveIds()) {
      // Skip the local player because you do not need to meet yourself today.
      if (id === localPlayerId) {
        continue;
      }

      // Send the standard first-meet response to establish contact.
      Game.PlayerOperations.sendRequest(
        localPlayerId,
        PlayerOperationTypes.RESPOND_DIPLOMATIC_FIRST_MEET,
        {
          // Player1 is the current local player.
          Player1: localPlayerId,

          // Player2 is the other living player we are meeting.
          Player2: id,

          // Use the neutral first-meet relationship state.
          Type: DiplomacyPlayerFirstMeets.PLAYER_REALATIONSHIP_FIRSTMEET_NEUTRAL,
        },
      );
    }
  }

  toggleDevPanel() {
    // If the panel already exists in the context stack, close it.
    if (ContextManager.hasInstanceOf("dev-panel")) {
      ContextManager.pop("dev-panel");

      // Persist the closed state so the panel stays closed next time.
      Storage.set("dev-panel-is-opened", false);
    } else {
      // Otherwise push the panel into the context stack to show it.
      ContextManager.push("dev-panel");

      // Persist the open state so the panel restores next time.
      Storage.set("dev-panel-is-opened", true);
    }
  }
})();
