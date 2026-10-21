import { Direction } from "@minecraft/server";
import { eventBus, guarded, InteractPriority } from "../core/eventBus.js";
import { BETA_FLOOR_Y, BETA_HEIGHT_LIMIT, OVERWORLD_ID } from "../policy/betaConstants.js";
import { BETA_BED_BLOCK_IDS, BETA_SIGN_BLOCK_IDS } from "../policy/betaRegistry.js";

const HEIGHT_MESSAGE = `§cHeight limit for building is ${BETA_HEIGHT_LIMIT} blocks`;

// Beta 1.7.3 bedrock floor veto at Y=0.
eventBus.onPlayerBreakBlockBefore(guarded({ system: "buildHeightLimit", operation: "floorVeto" }, (event) => {
    if (event.block.location.y < BETA_FLOOR_Y && event.block.dimension.id === OVERWORLD_ID) {
        event.cancel = true;
    }
}));

eventBus.onPlayerInteractWithBlock(guarded({ system: "buildHeightLimit", operation: "ceilingVeto" }, (event) => {
    const { player, block, blockFace, itemStack } = event;

    // An empty hand, a standing sign or a bed builds nothing; cancelling a sign's click would swallow the editor.
    if (
        !itemStack ||
        BETA_SIGN_BLOCK_IDS.has(block.typeId) ||
        BETA_BED_BLOCK_IDS.has(block.typeId)
    ) return;

    // A side face places in the clicked cell, top one above, bottom one below; judging by the cell alone refused legal placements.
    let targetY = block.location.y;
    if (blockFace === Direction.Up) {
        targetY++;
    } else if (blockFace === Direction.Down) {
        targetY--;
    }
    if (targetY >= BETA_HEIGHT_LIMIT) {
        event.cancel = true;
        player.sendMessage(HEIGHT_MESSAGE);
    }
}), InteractPriority.AREA_VETO);

eventBus.onPlayerPlaceBlock(guarded({ system: "buildHeightLimit", operation: "ceilingEnforce" }, (event) => {
    const { player, block } = event;
    if (block.location.y >= BETA_HEIGHT_LIMIT) {
        block.setType("minecraft:air");
        player.sendMessage(HEIGHT_MESSAGE);
    }
}));
