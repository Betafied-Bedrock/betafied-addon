import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BlockPermutation, resetMocks, scheduledTimeouts } from "@minecraft/server";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import "../../packs/BP/scripts/interactions/fenceConnectivity.js";

const FENCE_ID = "bh:fence";
const VANILLA_FENCE_ID = "minecraft:oak_fence";
const CONNECTIONS = "bh:connections";

// The wire format of the state the engine and the client both read: one bit per compensated
// direction. The cases below assert the mask rather than a bit name because the number is the
// contract the block JSON and the client-side model share.
const NORTH = 1;
const EAST = 2;
const SOUTH = 4;
const WEST = 8;

type Cell = { x: number; y: number; z: number };

function cellKey(cell: Cell): string {
    return `${cell.x},${cell.y},${cell.z}`;
}

/**
 * A stand-in for the engine's block handle. `north()`/`east()`/`south()`/`west()` read a shared grid
 * the way the engine's own offsets would, and every permutation this module writes is recorded --
 * rewriting a block state is the whole of what the module does, so that is what the cases read.
 */
function blockAt(cell: Cell, typeId: string, grid: Map<string, any>) {
    const block: any = {
        typeId,
        isValid: true,
        location: { ...cell },
        permutation: BlockPermutation.resolve(typeId, typeId === FENCE_ID ? { [CONNECTIONS]: 0 } : {}),
        writes: [] as Record<string, any>[],
        setPermutation(permutation: any) {
            block.permutation = permutation;
            block.writes.push(permutation.getAllStates());
        }
    };

    block.north = () => grid.get(cellKey({ ...cell, z: cell.z - 1 }));
    block.east = () => grid.get(cellKey({ ...cell, x: cell.x + 1 }));
    block.south = () => grid.get(cellKey({ ...cell, z: cell.z + 1 }));
    block.west = () => grid.get(cellKey({ ...cell, x: cell.x - 1 }));

    grid.set(cellKey(cell), block);
    return block;
}

/** The mask the module last wrote for this block, or undefined when it never wrote one. */
function maskWritten(block: any): number | undefined {
    return block.writes.at(-1)?.[CONNECTIONS];
}

function flushScheduled(): void {
    while (scheduledTimeouts.length > 0) {
        scheduledTimeouts.shift()!.callback();
    }
}

describe("Fence connectivity - the Beta connection mask", () => {
    beforeEach(() => {
        resetMocks();
        eventBus.init();
    });

    it("connects a placed fence to its fence neighbours and never to a vanilla one", () => {
        const grid = new Map<string, any>();
        const placed = blockAt({ x: 0, y: 64, z: 0 }, FENCE_ID, grid);
        const north = blockAt({ x: 0, y: 64, z: -1 }, FENCE_ID, grid);
        const east = blockAt({ x: 1, y: 64, z: 0 }, FENCE_ID, grid);
        const vanilla = blockAt({ x: -1, y: 64, z: 0 }, VANILLA_FENCE_ID, grid);

        eventBus.dispatch("playerPlaceBlock", { block: placed });
        flushScheduled();

        assert.equal(maskWritten(placed), NORTH | EAST, "one bit per fence beside it, north and east together");
        assert.equal(maskWritten(north), SOUTH, "and each neighbour is told about the joint from its own side");
        assert.equal(maskWritten(east), WEST);
        assert.equal(
            maskWritten(vanilla),
            undefined,
            "vanilla's fence is another addon's block: it is neither counted nor rewritten"
        );
    });

    it("schedules no pass for a placement that is not the pack's fence", () => {
        const grid = new Map<string, any>();
        const stone = blockAt({ x: 4, y: 64, z: 4 }, "minecraft:stone", grid);

        eventBus.dispatch("playerPlaceBlock", { block: stone });

        assert.equal(scheduledTimeouts.length, 0, "a block this module does not own costs the tick nothing");
    });

    it("re-masks the neighbours of a broken fence, so none keeps a stale connection", () => {
        const grid = new Map<string, any>();
        const broken = blockAt({ x: 0, y: 64, z: 0 }, FENCE_ID, grid);
        const north = blockAt({ x: 0, y: 64, z: -1 }, FENCE_ID, grid);

        eventBus.dispatch("playerPlaceBlock", { block: broken });
        flushScheduled();
        assert.equal(maskWritten(north), SOUTH, "the neighbour is connected while the fence stands");

        // The fence is gone, so the four cells around it are read again.
        grid.delete(cellKey({ x: 0, y: 64, z: 0 }));
        eventBus.dispatch("playerBreakBlock", {
            block: { location: { x: 0, y: 64, z: 0 } },
            brokenBlockPermutation: { type: { id: FENCE_ID } },
            dimension: { getBlock: (cell: Cell) => grid.get(cellKey(cell)) }
        });

        assert.equal(maskWritten(north), 0, "a connection to a fence that is gone is cleared, not left standing");
    });
});
