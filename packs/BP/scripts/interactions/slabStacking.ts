/**
 * Beta 1.7.3's slab was the era's one stacking block: a second slab meeting the first rebuilt the
 * pair as a full cube in the *lower* of the two cells. Bedrock never merges custom blocks on its
 * own, so the pair is assembled here from the block the player just placed.
 */

import { BlockPermutation, system, world } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { reportError, runCatching } from "../core/errorReporter.js";

const AIR_ID = "minecraft:air";

interface Cell {
    x: number;
    y: number;
    z: number;
}

/**
 * The full block each single slab becomes once two of them meet.
 *
 * Only the pack's own ids are listed. A vanilla half is a different block from a `bh:` one, and
 * vanilla already merges its own pairs natively, so a mixed stack is left alone rather than
 * guessing which family the full block should belong to.
 */
export const DOUBLE_SLAB_OF: Readonly<Record<string, string>> = Object.freeze({
    "bh:wooden_slab": "bh:double_wooden_slab",
    "bh:cobblestone_slab": "bh:double_cobblestone_slab",
    "bh:sandstone_slab": "bh:double_sandstone_slab",
    "bh:stone_slab": "bh:double_stone_slab"
});

export interface SlabStackPlan {
    /** The cell that holds the merged full block, always the lower of the two. */
    double: Cell;
    /** The cell the full block replaces; it is emptied. */
    consumed: Cell;
}

/**
 * Which two cells merge, given the slab just placed and the block types directly above and below it.
 * `undefined` when neither neighbour is the same slab.
 *
 * A second slab can meet the first from either side: the usual click lands the new one on top of an
 * existing half, but a slab placed under an overhang lands beneath one. Beta's doubled block always
 * sat in the lower cell, so the lower of the two wins either way.
 */
export function planSlabStack(
    placed: Cell,
    slabId: string,
    aboveId: string | undefined,
    belowId: string | undefined
): SlabStackPlan | undefined {
    if (belowId === slabId) {
        return { double: { x: placed.x, y: placed.y - 1, z: placed.z }, consumed: placed };
    }
    if (aboveId === slabId) {
        return { double: placed, consumed: { x: placed.x, y: placed.y + 1, z: placed.z } };
    }
    return undefined;
}

function typeIdAt(dimensionId: string, cell: Cell): string | undefined {
    return runCatching(
        { system: "slabStacking", operation: "readBlock", target: `${cell.x},${cell.y},${cell.z}` },
        () => world.getDimension(dimensionId).getBlock(cell)?.typeId
    );
}

/**
 * The placed cell is re-checked because the merge runs a tick after the placement event: a break or
 * a replacement in between would otherwise let the plan double the wrong block.
 */
function mergePlacement(dimensionId: string, cell: Cell, slabId: string, doubleId: string): void {
    if (typeIdAt(dimensionId, cell) !== slabId) return;

    const plan = planSlabStack(
        cell,
        slabId,
        typeIdAt(dimensionId, { x: cell.x, y: cell.y + 1, z: cell.z }),
        typeIdAt(dimensionId, { x: cell.x, y: cell.y - 1, z: cell.z })
    );
    if (!plan) return;

    // Both writes ride one guard: a half-applied plan would delete a slab without building the
    // block it was meant to become. The merged block goes in through the permutation table, the same
    // way every other `bh:` writer places one; the emptied cell is plain vanilla air.
    runCatching({ system: "slabStacking", operation: "assemble", target: doubleId }, () => {
        const dimension = world.getDimension(dimensionId);
        dimension.setBlockPermutation(plan.double, BlockPermutation.resolve(doubleId));
        dimension.setBlockType(plan.consumed, AIR_ID);
    });
}

eventBus.onPlayerPlaceBlock(event => {
    const placed = event.block;
    if (!placed) return;

    const slabId = placed.typeId;
    const doubleId = DOUBLE_SLAB_OF[slabId];
    if (!doubleId) return;

    // The merge re-reads the world a tick later, so it keeps an id and a cell rather than a block
    // handle the tick boundary would invalidate.
    const dimensionId = placed.dimension.id;
    const cell: Cell = { x: placed.location.x, y: placed.location.y, z: placed.location.z };

    system.run(() => {
        try {
            mergePlacement(dimensionId, cell, slabId, doubleId);
        } catch (e) {
            reportError({
                system: "slabStacking",
                operation: "mergePlacement",
                target: `${cell.x},${cell.y},${cell.z}`
            }, e);
        }
    });
});
