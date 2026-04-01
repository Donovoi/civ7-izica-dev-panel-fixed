import ContextManager from "/core/ui/context-manager/context-manager.js";
import { C as ComponentID } from "/core/ui/utilities/utilities-component-id.chunk.js";

import { Storage } from "./storage.js";
import { Console } from "./console.js";
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

  // Track the unit currently being assigned to a commander.
  reinforcementInFlight = null;

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

  // Store the timer used to restore the idle status text after a completion message.
  commanderStatusResetTimer = null;

  // Track transient retries so commander automation can wait for gamecore without stalling forever.
  commanderAdminRetryCounts = new Map();

  // Prevent multiple attribute-screen refresh pop/push cycles from stacking.
  attributeTreeRefreshScheduled = false;

  // Short hover summaries for the dev-panel buttons.
  buttonTooltips = {
    "font-increase": "Increase the dev panel size.",
    "font-decrease": "Decrease the dev panel size.",
    "left-decrease": "Move the dev panel left.",
    "left-increase": "Move the dev panel right.",
    "add-gold": "Grant 1,000,000 gold.",
    "add-influence": "Grant 1,000,000 influence.",
    "add-wildcard-attribute-point": "Grant 1 wildcard attribute point.",
    "add-happiness": "Grant 100 happiness.",
    "complete-production": "Complete production in every city.",
    "add-population": "Add 1 rural population to every city.",
    "spawn-settler": "Spawn a settler at your capital.",
    "upgrade-commander": "Upgrade every commander that can spend promotions, commendations, or army upgrades.",
    "reinforce-all-units": "Send every eligible land, sea, and air unit to a valid commander.",
    "toggle-infinite-movement": "Toggle infinite movement for your units.",
    "heal-units": "Heal every alive player's unit, including packed and traveling units when possible.",
    "add-xp": "Grant 10,000,000 XP to every local unit.",
    "sleep-all-units": "Put every local unit to sleep.",
    "complete-tech": "Finish the active technology.",
    "complete-civic": "Finish the active civic.",
    "autoplay-1": "Start autoplay for 1 turn and run admin automation.",
    "autoplay-5": "Start autoplay for 5 turns and run admin automation.",
    "autoplay-10": "Start autoplay for 10 turns and run admin automation.",
    "autoplay-25": "Start autoplay for 25 turns and run admin automation.",
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
    this.completeTech = this.completeTech.bind(this);
    this.completeCivic = this.completeCivic.bind(this);
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
        Storage.set("dev-panel-position-left", 20.75);

        // Reapply the saved font size to the live panel.
        this.updateFontSize();

        // Reapply the saved left position to the live panel.
        this.updatePositionLeft();
      },

      // Nudge the panel to the right.
      "left-increase": () => this.updatePositionLeft(0.25),

      // Nudge the panel to the left.
      "left-decrease": () => this.updatePositionLeft(-0.25),

      // Queue autoplay for 1 turn.
      "autoplay-1": this.startAutoplay(1),

      // Queue autoplay for 5 turns.
      "autoplay-5": this.startAutoplay(5),

      // Queue autoplay for 10 turns.
      "autoplay-10": this.startAutoplay(10),

      // Queue autoplay for 25 turns.
      "autoplay-25": this.startAutoplay(25),

      // Spend every available promotion, commendation, and army upgrade across all commanders.
      "upgrade-commander": this.upgradeSelectedCommander,

      // Assign every currently reinforceable unit to a valid commander plot.
      "reinforce-all-units": this.reinforceAllAvailableUnits,

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
  sendUnitCommand(unitId, commandType, args) {
    const directResult = this.canStartUnitCommand(unitId, commandType, args);

    if (directResult?.Success) {
      Game.UnitCommands?.sendRequest(unitId, commandType, args);
      return true;
    }

    return Boolean(
      this.withTemporaryUnitSelection(unitId, () => {
        const selectedResult = Game.UnitCommands?.canStart(
          unitId,
          commandType,
          args,
          false,
        );

        if (!selectedResult?.Success) {
          return false;
        }

        Game.UnitCommands?.sendRequest(unitId, commandType, args);
        return true;
      }),
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

  // Count how many commanders still have an upgrade, commendation, or army upgrade available.
  getCommandersWithAdminActionsCount() {
    return this.getCommanderUnits().filter((commander) =>
      Boolean(this.getNextCommanderAdminAction(commander)),
    ).length;
  }

  // Count how many commander entries are currently pending in the fast in-memory queue.
  getPendingCommanderQueueCount() {
    return this.commanderAdminQueue.length + (this.commanderAdminInFlight ? 1 : 0);
  }

  // Build the ordered list of admin actions the current commander can legally try right now.
  getCommanderAdminActions(commander, allowTemporarySelection = false) {
    const actions = this.getCommanderPromotionCandidates(commander).map(
      (candidate) => ({
        kind: "promotion",
        candidate,
      }),
    );

    const upgradeArmyResult = this.canStartUnitCommand(
      commander.id,
      "UNITCOMMAND_UPGRADE_ARMY",
      this.getDefaultCommandArgs(),
      allowTemporarySelection,
    );

    if (upgradeArmyResult?.Success) {
      actions.push({
        kind: "upgrade-army",
        commandType: "UNITCOMMAND_UPGRADE_ARMY",
      });
    }

    return actions;
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

  // Collect every currently available promotion or commendation for a commander.
  getCommanderPromotionCandidates(commander) {
    const experience = commander?.Experience;

    if (!experience) {
      return [];
    }

    const unitDefinition = GameInfo.Units.lookup(commander.type);

    if (!unitDefinition?.PromotionClass) {
      return [];
    }

    if (!this.readNativeBoolean(experience, "canPromote")) {
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

        return Boolean(
          experience.canEarnPromotion(
            candidate.disciplineType,
            candidate.promotionType,
            false,
          ),
        );
      },
    );
  }

  // Choose the next automatic commander admin action, prioritizing promotions and commendations first.
  getNextCommanderAdminAction(commander) {
    return this.getCommanderAdminActions(commander)[0] ?? null;
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

  // Queue every commander that can currently spend promotions, commendations, or army upgrades.
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

  // Start a fresh autoplay admin sweep when autoplay begins.
  onAutoplayStarted() {
    this.runAutoplayAdminTasks();
  }

  // Re-run autoplay admin tasks at the start of the local player's autoplay turn.
  onPlayerTurnActivated(data) {
    const localPlayerId = this.getLocalPlayerId();

    if (!Autoplay.isActive || localPlayerId === null || data.player !== localPlayerId) {
      return;
    }

    this.runAutoplayAdminTasks();
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

    if (localPlayerId === null || !unit?.isCommanderUnit || unit.owner !== localPlayerId) {
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
      // Find the button with the class that matches the action key.
      const button = document.querySelector(`.dev-panel-button--${key}`);

      // Skip actions that only exist as hotkeys or are not present in the DOM.
      if (!button) {
        return;
      }

      const tooltip = this.buttonTooltips[key];

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

    this.finishManualAdminStatusIfIdle();
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

  updatePositionLeft(value = 0) {
    // Start from the saved left offset, or the default offset when unset.
    let positionLeft = Number(Storage.get("dev-panel-position-left") ?? 20.75);

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

      // Queue admin cleanup work before the autoplay AI takes over.
      this.runAutoplayAdminTasks();

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
      player.Identity.addWildcardAttributePoints?.(1);
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
    // Iterate over a safe unit list so this action does nothing instead of crashing.
    for (const unit of this.getLocalUnits()) {
      // Grant a huge amount of experience so units level immediately.
      Units.changeExperience(unit.id, 10000000);
    }
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
