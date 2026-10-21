import { system } from "@minecraft/server";
import type {
    BlockContainerClosedAfterEvent,
    BlockContainerOpenedAfterEvent,
    PlayerInteractWithBlockBeforeEvent,
    PlayerLeaveAfterEvent,
    PlayerPlaceBlockAfterEvent,
    PlayerPlaceBlockBeforeEvent
} from "@minecraft/server";
import { eventBus, guarded, InteractPriority } from "../../core/eventBus.js";
import { reportError } from "../../core/errorReporter.js";
import type { ChestLocation, PlacementBlockInput } from "./chestPairing.js";
import { DOUBLE_CHEST_ID, SINGLE_CHEST_ID, planChestPlacement, planPlacementBlocked } from "./chestPairing.js";
import { neighbourTypeIds, solidAbove } from "./chestCells.js";
import { closePair, openPair, pairInUse, releaseViewer, viewerIdOf } from "./chestMirror.js";
import { mergeChestAt } from "./chestMerge.js";

const MERGE_DELAY_TICKS = 1;

// Event wiring only: session state lives in chestMirror, structural conversion in chestMerge.
function handleContainerOpened(event: BlockContainerOpenedAfterEvent): void {
    openPair(event.block, viewerIdOf(event.openSource));
}

function handleContainerClosed(event: BlockContainerClosedAfterEvent): void {
    closePair(event.block, viewerIdOf(event.closeSource));
}

function handlePlayerLeave(event: PlayerLeaveAfterEvent): void {
    releaseViewer(event.playerId);
}

function handleChestPlacement(event: PlayerPlaceBlockBeforeEvent): void {
    if (event.permutationToPlace.type.id !== SINGLE_CHEST_ID) return;

    if (!planChestPlacement(neighbourTypeIds(event.block))) {
        event.cancel = true;
    }
}

function handleChestPlaced(event: PlayerPlaceBlockAfterEvent): void {
    const placed = event.block;
    if (!placed || placed.typeId !== SINGLE_CHEST_ID) return;

    const dimensionId = placed.dimension.id;
    const location: ChestLocation = { x: placed.location.x, y: placed.location.y, z: placed.location.z };

    system.runTimeout(() => {
        try {
            mergeChestAt(dimensionId, location);
        } catch (e) {
            reportError({
                system: "doubleChest",
                operation: "mergeOnPlace",
                target: `${location.x},${location.y},${location.z}`
            }, e);
        }
    }, MERGE_DELAY_TICKS);
}

function handleInteractWithBlock(event: PlayerInteractWithBlockBeforeEvent): void {
    const block = event.block;
    if (!block) return;

    if (block.typeId === SINGLE_CHEST_ID || block.typeId === DOUBLE_CHEST_ID) {
        const placing = event.player.isSneaking && event.itemStack !== undefined;
        const blocked: PlacementBlockInput = { placing, aboveSolid: solidAbove(block) };

        if (planPlacementBlocked(blocked)) {
            event.cancel = true;
            return;
        }
    }

    if (!pairInUse(block)) return;

    event.cancel = true;
    event.player.sendMessage("§cThis chest is in use");
}

eventBus.onPlayerPlaceBlockBefore(guarded({ system: "doubleChest", operation: "placementRule", target: SINGLE_CHEST_ID }, handleChestPlacement));

eventBus.onPlayerPlaceBlock(guarded({ system: "doubleChest", operation: "mergeOnPlace", target: SINGLE_CHEST_ID }, handleChestPlaced));

eventBus.onBlockContainerOpened(guarded({ system: "doubleChest", operation: "containerOpened" }, handleContainerOpened));

eventBus.onBlockContainerClosed(guarded({ system: "doubleChest", operation: "containerClosed" }, handleContainerClosed));

eventBus.onPlayerLeave(guarded({ system: "doubleChest", operation: "playerLeave" }, handlePlayerLeave));

eventBus.onPlayerInteractWithBlock(
    guarded({ system: "doubleChest", operation: "interactWithBlock" }, handleInteractWithBlock),
    InteractPriority.RULE
);
