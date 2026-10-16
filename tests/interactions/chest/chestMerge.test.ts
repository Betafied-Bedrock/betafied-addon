import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BlockPermutation, Container, ItemStack, resetMocks, mockSpawnedItems } from "@minecraft/server";
import { mergePair } from "../../../packs/BP/scripts/interactions/chest/chestMerge.js";
import {
    DIRECTION_STATE,
    DOUBLE_CHEST_ID,
    DOUBLE_CHEST_SLOTS,
    PART_STATE,
    SINGLE_CHEST_ID,
    SINGLE_CHEST_SLOTS
} from "../../../packs/BP/scripts/interactions/chest/chestPairing.js";
import { dimension } from "../../support/world.js";

const INVENTORY = "minecraft:inventory";

type Cell = { x: number; y: number; z: number };

/** A single chest, with the surface the merge reads that the mock's block object does not carry. */
function singleChest(cell: Cell, latch: string, container: any) {
    const block: any = dimension().getBlock(cell);
    block.setPermutation(BlockPermutation.resolve(SINGLE_CHEST_ID, { [DIRECTION_STATE]: latch }));
    block.center = () => ({ x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 });
    block.offset = (offset: Cell) =>
        dimension().getBlock({ x: cell.x + offset.x, y: cell.y + offset.y, z: cell.z + offset.z });
    block.getComponent = (typeId: string) =>
        typeId === INVENTORY && container !== undefined ? { container } : undefined;
    return block;
}

/** A half whose container refuses the write the merge needs, which is the state a broken handle is in. */
function refusingWrites(size: number) {
    const inner = new Container(size);
    const container: any = {
        get size() {
            return inner.size;
        },
        getItem: (slot: number) => inner.getItem(slot),
        setItem: () => {
            throw new Error("the container refused the write");
        }
    };
    return { container, inner };
}

/**
 * The engine's own pair assembly, as far as this module can observe it: the two cells become the
 * halves of one pair, part 0 in the cell the plan called the master. The mock has no fillBlocks, so
 * the case states the assumption it is simulating; a half left without a container is the handle that
 * went bad before the write.
 */
function fillPair(dim: any, masterCell: Cell, shadowCell: Cell, state: string, halves: { home: any; other: any }) {
    const setHalf = (cell: Cell, part: number, container: any) => {
        const block: any = dim.getBlock(cell);
        block.setPermutation(BlockPermutation.resolve(DOUBLE_CHEST_ID, { [DIRECTION_STATE]: state, [PART_STATE]: part }));
        block.getComponent = (typeId: string) =>
            typeId === INVENTORY && container !== undefined ? { container } : undefined;
    };

    dim.fillBlocks = () => {
        setHalf(masterCell, 0, halves.home);
        setHalf(shadowCell, 1, halves.other);
    };
}

function captureWarnings(run: () => void): string[] {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => {
        warnings.push(String(message));
    };
    try {
        run();
    } finally {
        console.warn = originalWarn;
    }
    return warnings;
}

function spawnedIds(): string[] {
    return mockSpawnedItems.map(item => item.itemStack?.typeId ?? "unknown").sort();
}

describe("Chest merge - assembling two singles, and handing them back", () => {
    beforeEach(() => {
        resetMocks();
        // A stub installed by one case would otherwise answer for the next one's assembly.
        (dimension() as any).fillBlocks = undefined;
    });

    it("hands two singles back, and nothing twice, when a half will not clear", () => {
        const masterStack = new ItemStack("minecraft:stone", 3);
        const shadowStack = new ItemStack("minecraft:dirt", 5);
        const masterContainer = new Container(SINGLE_CHEST_SLOTS);
        masterContainer.setItem(0, masterStack);
        const { container: shadowContainer, inner: shadowInner } = refusingWrites(SINGLE_CHEST_SLOTS);
        shadowInner.setItem(5, shadowStack);

        const master = singleChest({ x: 0, y: 64, z: 0 }, "south", masterContainer);
        const shadow = singleChest({ x: 1, y: 64, z: 0 }, "south", shadowContainer);

        const warnings = captureWarnings(() => mergePair(master, shadow, "east"));

        assert.equal(master.typeId, SINGLE_CHEST_ID, "the pair was abandoned, so the master is a single again");
        assert.equal(shadow.typeId, SINGLE_CHEST_ID, "and so is the half that would not clear");
        assert.equal(masterContainer.getItem(0), masterStack, "the master's stack is back in its own chest");
        assert.deepEqual(
            spawnedIds(),
            ["minecraft:dirt"],
            "the half that refuses writes cannot take its stack back, so the world holds it once"
        );
        assert.equal(
            warnings.filter(message => message.includes("pairing failed")).length,
            1,
            "an abandoned merge is reported, because the player is left with two chests"
        );
    });

    it("hands the pair's stacks back when the half it must write into cannot be read", () => {
        const masterStack = new ItemStack("minecraft:stone", 3);
        const shadowStack = new ItemStack("minecraft:dirt", 5);
        const masterContainer = new Container(SINGLE_CHEST_SLOTS);
        masterContainer.setItem(0, masterStack);
        const shadowContainer = new Container(SINGLE_CHEST_SLOTS);
        shadowContainer.setItem(0, shadowStack);

        const masterCell = { x: 0, y: 64, z: 0 };
        const shadowCell = { x: 1, y: 64, z: 0 };
        const master = singleChest(masterCell, "south", masterContainer);
        const shadow = singleChest(shadowCell, "south", shadowContainer);

        fillPair(dimension(), masterCell, shadowCell, "east", { home: undefined, other: undefined });

        const warnings = captureWarnings(() => mergePair(master, shadow, "east"));

        assert.equal(master.typeId, SINGLE_CHEST_ID, "an unreadable home is not an empty one, so nothing is built on it");
        assert.equal(shadow.typeId, SINGLE_CHEST_ID);
        assert.deepEqual(
            spawnedIds(),
            ["minecraft:dirt", "minecraft:stone"],
            "both halves' stacks reached the world once each, rather than being written into a failed handle"
        );
        assert.equal(masterContainer.getItem(0), undefined, "and neither half kept a copy of what it handed over");
        assert.equal(shadowContainer.getItem(0), undefined);
        assert.equal(
            warnings.filter(message => message.includes("pairing failed")).length,
            1,
            "the pair the player saw is reported as two singles again"
        );
    });

    it("writes the master's half and then the shadow's into the pair the engine built", () => {
        const masterStack = new ItemStack("minecraft:stone", 3);
        const shadowStack = new ItemStack("minecraft:dirt", 5);
        const masterContainer = new Container(SINGLE_CHEST_SLOTS);
        masterContainer.setItem(0, masterStack);
        const shadowContainer = new Container(SINGLE_CHEST_SLOTS);
        shadowContainer.setItem(0, shadowStack);

        const masterCell = { x: 0, y: 64, z: 0 };
        const shadowCell = { x: 1, y: 64, z: 0 };
        const master = singleChest(masterCell, "south", masterContainer);
        const shadow = singleChest(shadowCell, "south", shadowContainer);

        const pairContainer = new Container(DOUBLE_CHEST_SLOTS);
        const otherHalf = new Container(DOUBLE_CHEST_SLOTS);
        otherHalf.setItem(0, new ItemStack("minecraft:gravel", 1));
        fillPair(dimension(), masterCell, shadowCell, "east", { home: pairContainer, other: otherHalf });

        const warnings = captureWarnings(() => mergePair(master, shadow, "east"));

        assert.equal(
            pairContainer.getItem(0),
            masterStack,
            "the master's contents fill slots 0-26, the half a viewer sees on their left"
        );
        assert.equal(
            pairContainer.getItem(SINGLE_CHEST_SLOTS),
            shadowStack,
            "and the shadow's start at 27, in the other half"
        );
        assert.equal(otherHalf.getItem(0), undefined, "the other half is emptied, so no stack is left counted twice");
        assert.equal(master.typeId, DOUBLE_CHEST_ID, "the cells are the two halves of the pair");
        assert.equal(shadow.typeId, DOUBLE_CHEST_ID);
        assert.deepEqual(spawnedIds(), [], "nothing had to be dropped, because every stack had a home");
        assert.deepEqual(warnings, [], "and a merge that lands reports nothing");
    });
});
