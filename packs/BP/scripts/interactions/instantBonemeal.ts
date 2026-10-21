import { BlockVolume, system } from "@minecraft/server";
import type { Dimension, Vector3 } from "@minecraft/server";
import { eventBus, InteractPriority } from "../core/eventBus.js";
import { reportError } from "../core/errorReporter.js";
import {
    POST_BETA_FLOWERS,
    POST_BETA_TALL_FLOWERS,
    POST_BETA_TALL_PLANTS
} from "../policy/compatibilityPolicy.js";

const BLOCKED_TARGETS = Object.freeze(new Set([
    "minecraft:brown_mushroom",
    "minecraft:red_mushroom"
]));

const SAPLING_TARGETS = Object.freeze(new Set([
    "minecraft:oak_sapling",
    "minecraft:birch_sapling",
    "minecraft:spruce_sapling"
]));

// Bone meal on grass spreads across the clicked block's neighbourhood, so the sweep covers the
// same 15x5x15 volume the vanilla feature reaches into.
const SPREAD_RADIUS = 7;
const SPREAD_VERTICAL = 2;

// A sapling grown within two blocks of a flower can carry a bee nest into the tree, and the era has
// neither bees nor nests. The sweep is taller than it is wide because the nest rides the trunk.
const NEST_RADIUS = 4;
const NEST_HEIGHT = 16;

function blockOrigin(block: { location: Vector3 }): Vector3 {
    return {
        x: Math.floor(block.location.x),
        y: Math.floor(block.location.y),
        z: Math.floor(block.location.z)
    };
}

function patchVolume(origin: Vector3): BlockVolume {
    return new BlockVolume(
        {
            x: origin.x - SPREAD_RADIUS,
            y: origin.y - SPREAD_VERTICAL,
            z: origin.z - SPREAD_RADIUS
        },
        {
            x: origin.x + SPREAD_RADIUS,
            y: origin.y + SPREAD_VERTICAL,
            z: origin.z + SPREAD_RADIUS
        }
    );
}

function clearPostBetaTallPlants(dimension: Dimension, volume: BlockVolume): void {
    dimension.fillBlocks(volume, "minecraft:air", {
        blockFilter: { includeTypes: [...POST_BETA_TALL_PLANTS, ...POST_BETA_TALL_FLOWERS] },
        ignoreChunkBoundErrors: true
    });
}

/**
 * Vanilla bone meal draws its flowers from the modern palette. The era's ItemDye grew only the rose
 * and the yellow flower, choosing the yellow one twice as often, so every modern flower the spread
 * left in the patch is replanted at those odds.
 */
function replantBetaFlowers(dimension: Dimension, volume: BlockVolume): void {
    const flowers = dimension.getBlocks(volume, { includeTypes: [...POST_BETA_FLOWERS] }, true);

    for (const location of flowers.getBlockLocationIterator()) {
        dimension.setBlockType(location, Math.random() < 1 / 3 ? "minecraft:poppy" : "minecraft:dandelion");
    }
}

function clearBeeNest(dimension: Dimension, origin: Vector3): void {
    dimension.fillBlocks(
        new BlockVolume(
            {
                x: origin.x - NEST_RADIUS,
                y: origin.y - 1,
                z: origin.z - NEST_RADIUS
            },
            {
                x: origin.x + NEST_RADIUS,
                y: origin.y + NEST_HEIGHT,
                z: origin.z + NEST_RADIUS
            }
        ),
        "minecraft:air",
        {
            blockFilter: { includeTypes: ["minecraft:bee_nest"] },
            ignoreChunkBoundErrors: true
        }
    );
}

eventBus.onPlayerInteractWithBlock((event) => {
    try {
        const { itemStack, block } = event;
        if (!itemStack || itemStack.typeId !== "minecraft:bone_meal") return;

        if (BLOCKED_TARGETS.has(block.typeId)) {
            event.cancel = true;
            return;
        }

        if (block.typeId === "minecraft:wheat") {
            system.run(() => {
                block.setPermutation(block.permutation.withState("growth", 7));
                block.dimension.spawnParticle("minecraft:crop_growth_emitter", block.center());
            });
        }

        if (block.typeId === "minecraft:grass_block") {
            const dimension = block.dimension;
            const origin = blockOrigin(block);

            system.runTimeout(() => {
                try {
                    const volume = patchVolume(origin);
                    clearPostBetaTallPlants(dimension, volume);
                    replantBetaFlowers(dimension, volume);
                } catch (e) {
                    reportError({
                        system: "instantBonemeal",
                        operation: "replantBetaFlowers",
                        target: `${origin.x},${origin.y},${origin.z}`
                    }, e);
                }
            }, 1);
        }

        if (SAPLING_TARGETS.has(block.typeId)) {
            const dimension = block.dimension;
            const origin = blockOrigin(block);

            system.runTimeout(() => {
                try {
                    clearBeeNest(dimension, origin);
                } catch (e) {
                    reportError({
                        system: "instantBonemeal",
                        operation: "clearBeeNest",
                        target: `${origin.x},${origin.y},${origin.z}`
                    }, e);
                }
            }, 1);
        }
    } catch (e) {
        reportError({
            system: "instantBonemeal",
            operation: "playerInteractWithBlock",
            target: event.block.typeId
        }, e);
    }
}, InteractPriority.RULE);
