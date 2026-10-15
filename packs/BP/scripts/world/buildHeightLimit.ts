import { Direction } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { BETA_FLOOR_Y, BETA_HEIGHT_LIMIT, OVERWORLD_ID } from "../core/betaConstants.js";
import { BETA_BED_BLOCK_IDS, BETA_SIGN_BLOCK_IDS } from "../core/betaRegistry.js";

// Beta 1.7.3 bedrock floor veto at Y=0.
eventBus.onPlayerBreakBlockBefore((event) => {
    try {
        if (event.block.location.y < BETA_FLOOR_Y && event.block.dimension.id === OVERWORLD_ID) {
            event.cancel = true;
        }
    } catch {
        // Ignore boundary errors
    }
});

eventBus.onPlayerInteractWithBlock((event) => {
    try {
        const { player, block, blockFace, itemStack } = event;

        // The ceiling is a veto on building, and neither an empty hand, a sign already standing nor
        // a bed builds anything: cancelling a sign's click would swallow the text editor, and a
        // bed's is the sleep that sets the spawn.
        if (
            !itemStack ||
            BETA_SIGN_BLOCK_IDS.has(block.typeId) ||
            BETA_BED_BLOCK_IDS.has(block.typeId)
        ) return;

        let targetY = block.location.y;
        if (blockFace === Direction.Up) {
            targetY++;
        }
        if (targetY >= BETA_HEIGHT_LIMIT) {
            event.cancel = true;
            player.sendMessage("§cHeight limit for building is 128 blocks");
        }
    } catch {
        // Ignore boundary errors
    }
});

eventBus.onPlayerPlaceBlock((event) => {
    try {
        const { player, block } = event;
        if (block.location.y >= BETA_HEIGHT_LIMIT) {
            block.setType("minecraft:air");
            player.sendMessage("§cHeight limit for building is 128 blocks");
        }
    } catch {
        // Ignore boundary errors
    }
});
