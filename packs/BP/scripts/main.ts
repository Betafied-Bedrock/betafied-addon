import { eventBus } from "./core/eventBus.js";
import { tickManager } from "./core/tickManager.js";
import "./core/jobRunner.js";

// Import order is load-bearing: the bus dispatches in subscription order and stops at the first cancelled before-event.
import "./core/inventoryManager.js";
import "./player/achievements.js";
import "./player/welcome.js";
import "./world/buildHeightLimit.js";
import "./combat/armor.js";
import "./combat/machineGunBow.js";
import "./mobs/pigmanEquipment.js";
import "./interactions/toolMining.js";
import "./interactions/boatCollision.js";
import "./interactions/furnaceMinecart.js";
import "./interactions/instantBonemeal.js";
import "./interactions/cropTrampling.js";
import "./interactions/placement.js";
import "./player/foodAndHealth.js";
import "./player/playerState.js";
import "./player/death.js";
import "./world/chunkScrubber.js";
import "./world/netherIce.js";
import "./world/classicFog.js";
import "./world/underwaterOverlay.js";
import "./world/dimensionBoundary.js";
import "./interactions/fenceConnectivity.js";
import "./interactions/slabStacking.js";
import "./interactions/doorPlacement.js";
import "./interactions/doorPunch.js";
import "./interactions/cakeEating.js";
import "./mobs/entitySpawnHandler.js";
import "./mobs/entityCleaner.js";
import "./mobs/betaAnimalAI.js";
import "./mobs/nightmares.js";
import "./mobs/herobrine.js";
import "./interactions/chest/doubleChest.js";

eventBus.init();

tickManager.start();
