import {
    BlockPermutation,
    Direction,
    Player,
    system,
    world
} from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { reportError, runCatching } from "../core/errorReporter.js";
import { consumeHeldItem } from "../core/heldItem.js";

interface Cell {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export const DOUBLE_SLAB_OF: Readonly<Record<string, string>> = Object.freeze({
    "bh:wooden_slab": "bh:double_wooden_slab",
    "bh:cobblestone_slab": "bh:double_cobblestone_slab",
    "bh:sandstone_slab": "bh:double_sandstone_slab",
    "bh:stone_slab": "bh:double_stone_slab"
});

export const SLAB_SOUND_OF: Readonly<Record<string, string>> = Object.freeze({
    "bh:wooden_slab": "use.wood",
    "bh:cobblestone_slab": "use.stone",
    "bh:sandstone_slab": "use.stone",
    "bh:stone_slab": "use.stone"
});

export function canStackSlab(blockTypeId: string, face: Direction, heldItemId: string | undefined): boolean {
    return face === Direction.Up && DOUBLE_SLAB_OF[blockTypeId] !== undefined && heldItemId === blockTypeId;
}

export function canMergePlacedSlab(permutationToPlaceId: string, belowBlockTypeId: string | undefined): boolean {
    return DOUBLE_SLAB_OF[permutationToPlaceId] !== undefined && belowBlockTypeId === permutationToPlaceId;
}

function scheduleSlabDoubling(
    dimensionId: string,
    cell: Cell,
    slabId: string,
    doubleId: string,
    player: Player
): void {
    system.run(() => {
        try {
            const dimension = world.getDimension(dimensionId);
            const block = dimension.getBlock(cell);
            if (!block?.isValid || block.typeId !== slabId) return;

            dimension.setBlockPermutation(cell, BlockPermutation.resolve(doubleId));

            const soundId = SLAB_SOUND_OF[slabId] ?? "use.stone";
            if (typeof player.playSound === "function") {
                player.playSound(soundId, { volume: 1.0, pitch: 0.8 });
            }

            if (player.isValid) {
                consumeHeldItem(player, (typeId) => typeId === slabId);
            }
        } catch (e) {
            reportError({
                system: "slabStacking",
                operation: "assembleDoubleSlab",
                target: `${cell.x},${cell.y},${cell.z}`
            }, e);
        }
    });
}

eventBus.onPlayerInteractWithBlock(event => {
    const { block, blockFace, itemStack, player } = event;
    if (!block || !itemStack) return;

    const slabId = block.typeId;
    const doubleId = DOUBLE_SLAB_OF[slabId];
    if (!doubleId || !canStackSlab(slabId, blockFace, itemStack.typeId)) return;

    event.cancel = true;

    const cell: Cell = { x: block.location.x, y: block.location.y, z: block.location.z };
    scheduleSlabDoubling(block.dimension.id, cell, slabId, doubleId, player);
}, 10);

eventBus.onPlayerPlaceBlockBefore(event => {
    const { block, permutationToPlace, player } = event;
    if (!block || !permutationToPlace) return;

    const placedId = permutationToPlace.type.id;
    const doubleId = DOUBLE_SLAB_OF[placedId];
    if (!doubleId) return;

    const dimensionId = block.dimension.id;
    const belowCell: Cell = { x: block.location.x, y: block.location.y - 1, z: block.location.z };

    const belowTypeId = runCatching(
        { system: "slabStacking", operation: "readBelowBlock", target: `${belowCell.x},${belowCell.y},${belowCell.z}` },
        () => world.getDimension(dimensionId).getBlock(belowCell)?.typeId
    );

    if (!canMergePlacedSlab(placedId, belowTypeId)) return;

    event.cancel = true;
    scheduleSlabDoubling(dimensionId, belowCell, placedId, doubleId, player);
}, 10);
