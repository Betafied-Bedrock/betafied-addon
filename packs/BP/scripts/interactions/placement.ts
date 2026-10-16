import {
    Direction,
    PlayerInteractWithBlockBeforeEvent
} from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { BETA_WOOD_SPECIES } from "../policy/betaRegistry.js";

const CEILING_RESTRICTED = Object.freeze(new Set([
    "minecraft:stone_button",
    "minecraft:lever"
]));

const STRIPPABLE_LOGS = Object.freeze(
    new Set([...BETA_WOOD_SPECIES].map(species => `minecraft:${species}_log`))
);

const PATHABLE_BLOCKS = Object.freeze(new Set([
    "minecraft:dirt",
    "minecraft:grass_block"
]));

function validateBlockInteraction(event: PlayerInteractWithBlockBeforeEvent): void {
    const { itemStack, block, blockFace } = event;
    if (!itemStack) return;

    const itemId = itemStack.typeId;

    if (blockFace === Direction.Down && CEILING_RESTRICTED.has(itemId)) {
        event.cancel = true;
        return;
    }

    if (!block) return;
    const blockId = block.typeId;

    if (itemId.endsWith("_axe") && STRIPPABLE_LOGS.has(blockId)) {
        event.cancel = true;
        return;
    }

    if (itemId.endsWith("_shovel") && PATHABLE_BLOCKS.has(blockId)) {
        event.cancel = true;
        return;
    }

    if (itemId === "minecraft:bone_meal" && (blockId === "minecraft:short_grass" || blockId === "minecraft:fern")) {
        event.cancel = true;
    }
}

eventBus.onPlayerInteractWithBlock(validateBlockInteraction);
