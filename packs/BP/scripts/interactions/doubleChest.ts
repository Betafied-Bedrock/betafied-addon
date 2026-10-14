import { system } from "@minecraft/server";
import type {
    BlockContainerClosedAfterEvent,
    BlockContainerOpenedAfterEvent,
    PlayerInteractWithBlockBeforeEvent,
    PlayerLeaveAfterEvent,
    PlayerPlaceBlockAfterEvent,
    PlayerPlaceBlockBeforeEvent
} from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { reportError } from "../core/errorReporter.js";
import { tickManager } from "../core/tickManager.js";
import type { ChestLocation } from "./chestPairing.js";
import {
    DOUBLE_CHEST_ID,
    SINGLE_CHEST_ID,
    chestOpenBlocked,
    planChestPlacement,
    planClose,
    planOpen,
    planOpenBlock
} from "./chestPairing.js";
import { containerHasItems, neighbourTypeIds, solidAbove } from "./chestCells.js";
import {
    applyMove,
    dropIfIdle,
    releaseIdleShadow,
    resolveEventBlock,
    resolvePairRef,
    sessions,
    sweepPairsJob,
    viewerIdOf,
    SWEEP_INTERVAL_TICKS
} from "./chestMirror.js";
import { mergeChestAt } from "./chestMerge.js";

const MERGE_DELAY_TICKS = 1;

function handleContainerOpened(event: BlockContainerOpenedAfterEvent): void {
    const resolved = resolveEventBlock(event.block);
    if (!resolved) return;

    const { session, half } = resolved;
    const masterViewers = session.masterViewers.size;
    const shadowViewers = session.shadowViewers.size;
    const firstViewer = half === "master" ? masterViewers === 0 : shadowViewers === 0;

    const viewerId = viewerIdOf(event.openSource);
    if (viewerId) (half === "master" ? session.masterViewers : session.shadowViewers).add(viewerId);

    const move = planOpen({
        half,
        firstViewer,
        masterHasItems: containerHasItems(session.dimensionId, session.master) ?? false,
        shadowHasItems: containerHasItems(session.dimensionId, session.shadow) ?? false,
        masterViewers,
        shadowViewers
    });

    const drained = applyMove(move, session);
    if (move !== "none") dropIfIdle(session, resolved.key, drained);
}

function handleContainerClosed(event: BlockContainerClosedAfterEvent): void {
    const resolved = resolveEventBlock(event.block);
    if (!resolved) return;

    const { key, session, half } = resolved;
    const viewerId = viewerIdOf(event.closeSource);
    if (viewerId) (half === "master" ? session.masterViewers : session.shadowViewers).delete(viewerId);

    if (half !== "shadow") return;

    const remainingViewers = session.shadowViewers.size;
    const shadowHasItems = containerHasItems(session.dimensionId, session.shadow);
    // An unreadable half stays tracked so the sweep retries the drain instead of parking items.
    if (shadowHasItems === undefined) return;

    const drained = applyMove(planClose({ half, remainingViewers, shadowHasItems }), session);
    dropIfIdle(session, key, drained);
}

function handlePlayerLeave(event: PlayerLeaveAfterEvent): void {
    for (const [key, session] of sessions) {
        const leftMaster = session.masterViewers.delete(event.playerId);
        const leftShadow = session.shadowViewers.delete(event.playerId);
        if (!leftMaster && !leftShadow) continue;

        releaseIdleShadow(session, key);
    }
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

        if (chestOpenBlocked({ placing, aboveSolid: solidAbove(block) })) {
            event.cancel = true;
            return;
        }
    }

    if (block.typeId !== DOUBLE_CHEST_ID) return;

    const ref = resolvePairRef(block);
    if (!ref) return;

    const session = sessions.get(ref.key);
    if (!session) return;

    const busy = planOpenBlock({
        half: ref.resolution.half,
        masterViewers: session.masterViewers.size,
        shadowViewers: session.shadowViewers.size
    });
    if (!busy) return;

    event.cancel = true;
    event.player.sendMessage("§cThis chest is in use");
}

eventBus.onPlayerPlaceBlockBefore(event => {
    try {
        handleChestPlacement(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "placementRule", target: SINGLE_CHEST_ID }, e);
    }
});

eventBus.onPlayerPlaceBlock(event => {
    try {
        handleChestPlaced(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "mergeOnPlace", target: SINGLE_CHEST_ID }, e);
    }
});

eventBus.onBlockContainerOpened(event => {
    try {
        handleContainerOpened(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "containerOpened" }, e);
    }
});

eventBus.onBlockContainerClosed(event => {
    try {
        handleContainerClosed(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "containerClosed" }, e);
    }
});

eventBus.onPlayerLeave(event => {
    try {
        handlePlayerLeave(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "playerLeave" }, e);
    }
});

eventBus.onPlayerInteractWithBlock(event => {
    try {
        handleInteractWithBlock(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "interactWithBlock" }, e);
    }
});

tickManager.register("doubleChest:sweep", SWEEP_INTERVAL_TICKS, sweepPairsJob);
