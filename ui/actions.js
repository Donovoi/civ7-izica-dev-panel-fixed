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

  // Track whether the user manually kicked off a commander-upgrade sweep.
  manualCommanderUpgradeRequested = false;

  // Track whether the user manually kicked off a reinforce-all sweep.
  manualReinforcementRequested = false;

  // Store the timer used to restore the idle status text after a completion message.
  commanderStatusResetTimer = null;

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
    "heal-units": "Heal every local unit, including packed and traveling units when possible.",
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

  // Prevent multiple delayed refreshes from piling up at once.
  commanderAdminRefreshScheduled = false;

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
      requestAnimationFrame(() => {
        this.commanderAdminRefreshScheduled = false;
        this.processAdminQueues();
      });
    });
  }

  // Return the default command payload used by the stock unit-action UI for generic commands.
  getDefaultCommandArgs() {
    return {
      X: -9999,
      Y: -9999,
      UnitAbilityType: -1,
    };
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
      const remainingUnits = this.getReinforceableUnitsCount();
      this.setCommanderStatus(
        remainingUnits > 0
          ? `Reinforcing units… ${remainingUnits} still available`
          : "Reinforcing units…",
      );
      return;
    }

    if (this.manualCommanderUpgradeRequested) {
      const remainingCommanders = this.getCommandersWithAdminActionsCount();
      this.setCommanderStatus(
        remainingCommanders > 0
          ? `Upgrading commanders… ${remainingCommanders} still need actions`
          : "Upgrading commanders…",
      );
      return;
    }

    this.setCommanderStatus("Commanders: ready");
  }

  // Finalize the visible status when a manual commander/admin sweep becomes idle.
  finishManualAdminStatusIfIdle() {
    if (
      this.reinforcementSweepRequested ||
      this.reinforcementInFlight ||
      this.commanderAdminInFlight ||
      this.commanderAdminQueue.length > 0
    ) {
      this.updateManualAdminStatus();
      return;
    }

    if (this.manualReinforcementRequested && this.manualCommanderUpgradeRequested) {
      this.manualReinforcementRequested = false;
      this.manualCommanderUpgradeRequested = false;
      this.setCommanderStatus("Commander tasks finished.");
      console.log("Dev panel: commander tasks finished.");
      this.refreshSelectedUnitUI();
      this.scheduleCommanderStatusReset();
      return;
    }

    if (this.manualReinforcementRequested) {
      this.manualReinforcementRequested = false;
      this.setCommanderStatus("Reinforcement sweep finished.");
      console.log("Dev panel: reinforcement sweep finished.");
      this.refreshSelectedUnitUI();
      this.scheduleCommanderStatusReset();
      return;
    }

    if (this.manualCommanderUpgradeRequested) {
      this.manualCommanderUpgradeRequested = false;
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

  // Find the next unit that can currently reinforce into any eligible commander.
  getNextReinforcementAction(skippedUnitIds = []) {
    let bestAction = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const unit of this.getLocalUnits()) {
      if (
        !unit ||
        unit.isCommanderUnit ||
        this.isComponentIdInList(skippedUnitIds, unit.id)
      ) {
        continue;
      }

      const result = Game.UnitOperations?.canStart(
        unit.id,
        "UNITOPERATION_REINFORCE_ARMY",
        {},
        false,
      );

      if (!result?.Success || !result.Plots?.length) {
        continue;
      }

      // We intentionally do not hardcode any slot or stack limit here.
      // The engine already knows the current free-space and same-slot stacking rules.
      const targetPlot = this.getBestReinforcementPlot(unit.id, result.Plots);

      if (!targetPlot) {
        continue;
      }

      const score = this.getReinforcementScore(unit.id, targetPlot);

      if (bestAction === null || score < bestScore) {
        bestAction = {
          unitId: unit.id,
          targetPlot,
        };
        bestScore = score;

        if (score === 0) {
          return bestAction;
        }
      }
    }

    return bestAction;
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
        this.reinforcementInFlight = null;
        this.scheduleCommanderAdminProcessing();
      }
    }, 400);

    return true;
  }

  // Consume any pending reinforce-all work before moving on to commander admin actions.
  processAdminQueues() {
    if (this.reinforcementInFlight || this.commanderAdminInFlight) {
      this.updateManualAdminStatus();
      return;
    }

    if (this.reinforcementSweepRequested) {
      const skippedUnitIds = [];

      while (this.reinforcementSweepRequested) {
        const nextReinforcement = this.getNextReinforcementAction(skippedUnitIds);

        if (!nextReinforcement) {
          this.reinforcementSweepRequested = false;
          break;
        }

        this.reinforcementInFlight = {
          unitId: nextReinforcement.unitId,
        };

        if (
          this.sendReinforcementRequest(
            nextReinforcement.unitId,
            nextReinforcement.targetPlot,
          )
        ) {
          this.updateManualAdminStatus();
          return;
        }

        skippedUnitIds.push(nextReinforcement.unitId);
        this.reinforcementInFlight = null;
      }
    }

    this.processCommanderAdminQueue();
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

  // Collect every currently available promotion or commendation for a commander.
  getCommanderPromotionCandidates(commander) {
    if (!commander?.Experience) {
      return [];
    }

    const unitDefinition = GameInfo.Units.lookup(commander.type);

    if (!unitDefinition?.PromotionClass) {
      return [];
    }

    const candidates = [];

    GameInfo.UnitPromotionClassSets.forEach((classSet, disciplineIndex) => {
      if (classSet.PromotionClassType !== unitDefinition.PromotionClass) {
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

        if (
          commander.Experience.hasPromotion(
            classSet.UnitPromotionDisciplineType,
            detail.UnitPromotionType,
          )
        ) {
          return;
        }

        if (
          !commander.Experience.canPromote ||
          !commander.Experience.canEarnPromotion(
            classSet.UnitPromotionDisciplineType,
            detail.UnitPromotionType,
            false,
          )
        ) {
          return;
        }

        candidates.push({
          disciplineIndex,
          detailIndex,
          disciplineType: classSet.UnitPromotionDisciplineType,
          promotionType: detail.UnitPromotionType,
          promotion,
          depth: depthMap.get(detail.UnitPromotionType) ?? 0,
        });
      });
    });

    return candidates.sort((left, right) => {
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
  }

  // Choose the next automatic commander admin action, prioritizing promotions and commendations first.
  getNextCommanderAdminAction(commander) {
    const nextPromotion = this.getCommanderPromotionCandidates(commander)[0];

    if (nextPromotion) {
      return {
        kind: "promotion",
        candidate: nextPromotion,
      };
    }

    const upgradeArmyResult = Game.UnitCommands?.canStart(
      commander.id,
      "UNITCOMMAND_UPGRADE_ARMY",
      this.getDefaultCommandArgs(),
      false,
    );

    if (upgradeArmyResult?.Success) {
      return {
        kind: "upgrade-army",
        commandType: "UNITCOMMAND_UPGRADE_ARMY",
      };
    }

    return null;
  }

  // Send a single promotion or commendation request to the game core.
  sendCommanderPromotion(unitId, candidate) {
    const args = {
      PromotionType: Database.makeHash(candidate.promotionType),
      PromotionDisciplineType: Database.makeHash(candidate.disciplineType),
    };

    const result = Game.UnitCommands?.canStart(
      unitId,
      "UNITCOMMAND_PROMOTE",
      args,
      false,
    );

    if (!result?.Success) {
      return false;
    }

    Game.UnitCommands?.sendRequest(unitId, "UNITCOMMAND_PROMOTE", args);
    return true;
  }

  // Send a generic commander command such as "upgrade army".
  sendCommanderCommand(unitId, commandType) {
    const args = this.getDefaultCommandArgs();
    const result = Game.UnitCommands?.canStart(unitId, commandType, args, false);

    if (!result?.Success) {
      return false;
    }

    Game.UnitCommands?.sendRequest(unitId, commandType, args);

    // Use a fallback retry so queue progress does not depend entirely on one engine event.
    setTimeout(() => {
      if (
        this.commanderAdminInFlight?.kind === "upgrade-army" &&
        this.isSameComponentId(this.commanderAdminInFlight.unitId, unitId)
      ) {
        this.commanderAdminInFlight = null;
        this.enqueueCommanderForAdmin(unitId);
        this.scheduleCommanderAdminProcessing();
      }
    }, 400);

    return true;
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
        continue;
      }

      const nextAction = this.getNextCommanderAdminAction(commander);

      if (!nextAction) {
        this.commanderAdminQueue.shift();
        continue;
      }

      this.commanderAdminInFlight = {
        kind: nextAction.kind,
        unitId: commander.id,
      };

      const didStart =
        nextAction.kind === "promotion"
          ? this.sendCommanderPromotion(commander.id, nextAction.candidate)
          : this.sendCommanderCommand(commander.id, nextAction.commandType);

      if (didStart) {
        this.updateManualAdminStatus();
        return;
      }

      this.commanderAdminInFlight = null;
      this.commanderAdminQueue.shift();
    }

    this.finishManualAdminStatusIfIdle();
  }

  // Queue every commander for a full admin sweep during autoplay.
  runAutoplayAdminTasks() {
    this.reinforcementSweepRequested = true;
    this.enqueueAllCommandersForAdmin();
    this.processAdminQueues();
  }

  // Queue every currently reinforceable unit and let the engine assign them to valid commanders.
  reinforceAllAvailableUnits() {
    const reinforceableUnits = this.getReinforceableUnitsCount();

    if (reinforceableUnits <= 0) {
      this.setCommanderStatus("No units can reinforce right now.");
      console.log("Dev panel: no units can reinforce right now.");
      this.scheduleCommanderStatusReset();
      return;
    }

    this.manualReinforcementRequested = true;
    this.reinforcementSweepRequested = true;
    this.setCommanderStatus(`Reinforcing units… ${reinforceableUnits} still available`);
    console.log(`Dev panel: reinforcing ${reinforceableUnits} available unit(s).`);
    this.processAdminQueues();
  }

  // Queue every commander that can currently spend promotions, commendations, or army upgrades.
  upgradeSelectedCommander() {
    const commandersWithActions = this.getCommanderUnits().filter((commander) =>
      Boolean(this.getNextCommanderAdminAction(commander)),
    );

    if (commandersWithActions.length <= 0) {
      this.setCommanderStatus("No commanders have upgrades available.");
      console.log("Dev panel: no commanders have upgrades available.");
      this.scheduleCommanderStatusReset();
      return;
    }

    this.manualCommanderUpgradeRequested = true;
    this.setCommanderStatus(
      `Upgrading commanders… ${commandersWithActions.length} still need actions`,
    );
    console.log(
      `Dev panel: upgrading ${commandersWithActions.length} commander(s).`,
    );

    commandersWithActions.forEach((commander) => {
      this.enqueueCommanderForAdmin(commander.id);
    });

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
      this.reinforcementSweepRequested = true;
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

    if (this.isSameComponentId(this.reinforcementInFlight?.unitId, unit.id)) {
      this.reinforcementInFlight = null;
    }

    this.reinforcementSweepRequested = true;
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

    if (this.isSameComponentId(this.reinforcementInFlight?.unitId, unit.id)) {
      this.reinforcementInFlight = null;
    }

    this.reinforcementSweepRequested = true;
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

    this.reinforcementSweepRequested = true;
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

    this.reinforcementSweepRequested = true;
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

    this.reinforcementSweepRequested = true;
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

    // Abort early if there is no active local player.
    if (localPlayerId === null) {
      return;
    }

    // Grant extra happiness to the current player.
    Players.grantYield(localPlayerId, YieldTypes.YIELD_HAPPINESS, 100);
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
    // Add one wildcard attribute point if the identity subsystem is available.
    this.getLocalPlayer()?.Identity?.addWildcardAttributePoints?.(1);
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
    // Iterate over a safe unit list so this action does nothing instead of crashing.
    for (const unit of this.getLocalUnits()) {
      // Remove all damage from each unit.
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
