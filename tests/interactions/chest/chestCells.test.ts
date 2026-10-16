import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BlockPermutation, Container, ItemStack, resetMocks, mockSpawnedItems } from "@minecraft/server";
import {
    chestNeighbours,
    containerHasItems,
    moveContents,
    neighbourTypeIds,
    readLatch,
    readSlots,
    solidAbove,
    writeSlots
} from "../../../packs/BP/scripts/interactions/chest/chestCells.js";
import {
    DIRECTION_STATE,
    DOUBLE_CHEST_ID,
    DOUBLE_CHEST_SLOTS,
    SINGLE_CHEST_ID,
    SINGLE_CHEST_SLOTS
} from "../../../packs/BP/scripts/interactions/chest/chestPairing.js";
import { dimension } from "../../support/world.js";

const OVERWORLD = "minecraft:overworld";
const INVENTORY = "minecraft:inventory";

type Cell = { x: number; y: number; z: number };

/**
 * A cell as the module reads it. The mock hands back a plain block object, so the three members this
 * module needs and the mock does not model -- getComponent, offset and center -- are attached here
 * rather than given a second meaning inside the mock, which every other suite shares.
 */
function cellAt(cell: Cell, options: { id?: string; latch?: string; container?: any } = {}) {
    const block: any = dimension().getBlock(cell);
    const states: Record<string, any> = {};
    if (options.latch !== undefined) states[DIRECTION_STATE] = options.latch;
    block.setPermutation(BlockPermutation.resolve(options.id ?? SINGLE_CHEST_ID, states));
    block.center = () => ({ x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 });
    block.offset = (offset: Cell) =>
        dimension().getBlock({ x: cell.x + offset.x, y: cell.y + offset.y, z: cell.z + offset.z });
    block.getComponent = (typeId: string) =>
        typeId === INVENTORY && options.container !== undefined ? { container: options.container } : undefined;
    return block;
}

/** A container that refuses one call, which is how the engine answers a handle it cannot serve. */
function refusing(size: number, call: "size" | "getItem" | "setItem") {
    const inner = new Container(size);
    const container: any = {
        get size() {
            if (call === "size") throw new Error("the container refused its size");
            return inner.size;
        },
        getItem(slot: number) {
            if (call === "getItem") throw new Error("the container refused the slot");
            return inner.getItem(slot);
        },
        setItem(slot: number, item?: any) {
            if (call === "setItem") throw new Error("the container refused the write");
            inner.setItem(slot, item);
        }
    };
    return { container, inner };
}

function spawnedIds(): string[] {
    return mockSpawnedItems.map(item => item.itemStack?.typeId ?? "unknown");
}

describe("Chest cells - the guarded reads the pair family leans on", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("reads the slots a container owns, so a pair-sized request invents no second half", () => {
        const container = new Container(SINGLE_CHEST_SLOTS);
        const stack = new ItemStack("minecraft:stone", 3);
        container.setItem(SINGLE_CHEST_SLOTS - 1, stack);

        const read = readSlots(container, DOUBLE_CHEST_SLOTS);

        assert.equal(read.ok, true);
        if (!read.ok) return;
        assert.equal(read.value.length, SINGLE_CHEST_SLOTS, "the request is clamped to the 27 slots this half has");
        assert.equal(read.value[SINGLE_CHEST_SLOTS - 1], stack, "and its last slot is the one that holds the stack");
    });

    it("answers a refused slot read as unreadable, never as an empty slot", () => {
        const refused = readSlots(refusing(SINGLE_CHEST_SLOTS, "getItem").container, SINGLE_CHEST_SLOTS);
        const empty = readSlots(new Container(SINGLE_CHEST_SLOTS), SINGLE_CHEST_SLOTS);

        assert.equal(refused.ok, false, "a read that threw is not a half that holds nothing");
        assert.equal(empty.ok, true, "the readable empty half is the one this must not be confused with");
        if (!empty.ok) return;
        assert.equal(empty.value.length, SINGLE_CHEST_SLOTS);
    });

    it("hands back only the stacks a container would not take", () => {
        const stack = new ItemStack("minecraft:stone", 3);
        const working = new Container(SINGLE_CHEST_SLOTS);

        assert.deepEqual(
            writeSlots(refusing(SINGLE_CHEST_SLOTS, "setItem").container, [stack]),
            [stack],
            "a refused write returns the stack to the caller, which is the only thing that can place it"
        );
        assert.deepEqual(writeSlots(working, [stack]), [], "a write that landed has nothing to hand back");
        assert.equal(working.getItem(0), stack, "and it landed in the slot it was aimed at");
    });

    it("distinguishes an unreadable half from an empty one and from one that holds something", () => {
        const holding = new Container(SINGLE_CHEST_SLOTS);
        holding.setItem(SINGLE_CHEST_SLOTS - 1, new ItemStack("minecraft:stone", 1));

        cellAt({ x: 0, y: 64, z: 0 }, { latch: "south", container: holding });
        cellAt({ x: 2, y: 64, z: 2 }, { latch: "south", container: new Container(SINGLE_CHEST_SLOTS) });
        cellAt({ x: 4, y: 64, z: 4 }, { latch: "south", container: refusing(SINGLE_CHEST_SLOTS, "size").container });
        cellAt({ x: 6, y: 64, z: 6 }, { latch: "south" });

        assert.deepEqual(
            containerHasItems(OVERWORLD, { x: 0, y: 64, z: 0 }),
            { ok: true, value: true },
            "a stack in the half's last slot counts, because the pair reads past a single half's range"
        );
        assert.deepEqual(
            containerHasItems(OVERWORLD, { x: 2, y: 64, z: 2 }),
            { ok: true, value: false },
            "an empty half is readable, and says so"
        );
        assert.equal(
            containerHasItems(OVERWORLD, { x: 4, y: 64, z: 4 }).ok,
            false,
            "a refused read is neither of those, which is what keeps the sweep retrying it"
        );
        assert.equal(
            containerHasItems(OVERWORLD, { x: 6, y: 64, z: 6 }).ok,
            false,
            "and a cell with no container is not an empty chest either"
        );
    });

    it("reads the latch, and folds a state it cannot read into no latch at all", () => {
        const east = cellAt({ x: 0, y: 64, z: 0 }, { latch: "east" });
        const unreadable: any = dimension().getBlock({ x: 2, y: 64, z: 2 });
        unreadable.permutation = {
            getState() {
                throw new Error("the state was refused");
            }
        };
        const notACardinal: any = dimension().getBlock({ x: 4, y: 64, z: 4 });
        notACardinal.setPermutation(BlockPermutation.resolve(SINGLE_CHEST_ID, { [DIRECTION_STATE]: 3 }));

        assert.equal(readLatch(east), "east", "a chest that says which way it faces keeps what it says");
        assert.equal(readLatch(unreadable), undefined, "a refused read is no latch, not a guessed one");
        assert.equal(readLatch(notACardinal), undefined, "and a value outside the four directions is not one");
    });

    it("keeps the pack's own chests out of the cell above", () => {
        const underStone = cellAt({ x: 0, y: 64, z: 0 }, { latch: "south" });
        const underChest = cellAt({ x: 4, y: 64, z: 4 }, { latch: "south" });
        cellAt({ x: 4, y: 65, z: 4 }, { latch: "north" });
        const underHalf = cellAt({ x: 8, y: 64, z: 8 }, { latch: "south" });
        cellAt({ x: 8, y: 65, z: 8 }, { id: DOUBLE_CHEST_ID, latch: "south" });
        const blind = cellAt({ x: 12, y: 64, z: 12 }, { latch: "south" });
        blind.offset = () => {
            throw new Error("the cell above was refused");
        };

        assert.equal(solidAbove(underStone), true, "the cell above this one is solid stone");
        assert.equal(solidAbove(underChest), false, "a chest above is the pair's own furniture, not a ceiling");
        assert.equal(solidAbove(underHalf), false, "and so is the other half of a pair");
        assert.equal(solidAbove(blind), false, "a refused read is not a solid cell");
    });

    it("loses only the neighbour a refused read could not answer for", () => {
        const cell: any = cellAt({ x: 0, y: 64, z: 0 }, { latch: "south" });
        cellAt({ x: 1, y: 64, z: 0 }, { latch: "north" });
        cellAt({ x: 0, y: 64, z: 1 }, { latch: "north" });
        const read = cell.offset;
        cell.offset = (offset: Cell) => {
            if (offset.z === -1) throw new Error("the neighbour was refused");
            return read(offset);
        };

        assert.deepEqual(
            neighbourTypeIds(cell),
            [SINGLE_CHEST_ID, "minecraft:stone", SINGLE_CHEST_ID],
            "three of the four cells answered, so the placement still sees the chest line it is joining"
        );
    });

    it("collects the single chests beside a placement, each with the latch it reads", () => {
        const placed = cellAt({ x: 0, y: 64, z: 0 }, { latch: "south" });
        cellAt({ x: 1, y: 64, z: 0 }, { latch: "north" });
        cellAt({ x: 0, y: 64, z: -1 }, { id: DOUBLE_CHEST_ID, latch: "south" });

        assert.deepEqual(
            chestNeighbours(placed),
            [{ offset: { x: 1, y: 0, z: 0 }, latch: "north" }],
            "a half is not a candidate, and the cells holding ordinary blocks are not neighbours"
        );
    });

    it("moves what fits into the half's own slot and clears the one it came from", () => {
        const stack = new ItemStack("minecraft:stone", 3);
        const source = new Container(SINGLE_CHEST_SLOTS);
        source.setItem(0, stack);
        const destination = new Container(DOUBLE_CHEST_SLOTS);
        cellAt({ x: 0, y: 64, z: 0 }, { latch: "south", container: source });
        cellAt({ x: 1, y: 64, z: 0 }, { latch: "south", container: destination });

        const moved = moveContents(OVERWORLD, { x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 });

        // The count is what the source still holds, not what crossed: the pair's session is kept
        // alive by leftovers, so a clean move answers zero and the sweep is free to drop the pair.
        assert.deepEqual(moved, { ok: true, value: 0 }, "a clean move leaves nothing behind");
        assert.equal(source.getItem(0), undefined, "the source slot is cleared rather than copied");
        assert.equal(destination.getItem(0), stack, "and the stack sits in the same slot of the half it moved to");
    });

    it("drops a stack the destination refuses rather than losing it", () => {
        const stack = new ItemStack("minecraft:dirt", 5);
        const source = new Container(SINGLE_CHEST_SLOTS);
        source.setItem(3, stack);
        cellAt({ x: 2, y: 64, z: 2 }, { latch: "south", container: source });
        cellAt({ x: 3, y: 64, z: 2 }, { latch: "south", container: refusing(DOUBLE_CHEST_SLOTS, "setItem").container });

        const moved = moveContents(OVERWORLD, { x: 2, y: 64, z: 2 }, { x: 3, y: 64, z: 2 });

        assert.equal(moved.ok, true, "the pair is readable, so the move ran rather than being abandoned");
        assert.equal(source.getItem(3), undefined, "the source let the stack go");
        assert.deepEqual(spawnedIds(), ["minecraft:dirt"], "and the world holds it once, so nothing was lost");
    });
});
