import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { boatLoopJob, processBoats } from "../../packs/BP/scripts/interactions/boatCollision.js";
import { BlockPermutation, resetMocks, world, mockEntities } from "../mocks/minecraftServer.js";

/** The four cells the pass reads at the boat's own floor level, for a boat spawned at y 64. */
function surroundBoat(block: Record<string, unknown>, y = 64): void {
    const overworld = world.getDimension("minecraft:overworld") as any;
    for (const offset of [{ x: 1, y, z: 0 }, { x: -1, y, z: 0 }, { x: 0, y, z: 1 }, { x: 0, y, z: -1 }]) {
        overworld.setBlock(offset, block);
    }
}

const STONE = { typeId: "minecraft:stone", permutation: BlockPermutation.resolve("minecraft:stone") };
const FLOWING_WATER = {
    typeId: "minecraft:flowing_water",
    permutation: BlockPermutation.resolve("minecraft:flowing_water"),
    isLiquid: true
};

describe("Boat Collision Batching & Lifetime Safety", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("batches boat processing and yields every 10 boats", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        for (let i = 0; i < 25; i++) {
            overworld.spawnEntity("minecraft:boat", { x: i, y: 64, z: 0 });
        }

        const job = boatLoopJob();
        assert.ok(typeof job.next === "function", "boatLoopJob is a generator");

        // Batch 1: processes 10 boats
        const step1 = job.next();
        assert.equal(step1.done, false, "yields after 10 boats");

        // Batch 2: processes next 10 boats (20 total)
        const step2 = job.next();
        assert.equal(step2.done, false, "yields after 20 boats");

        // Remaining 5 boats
        const step3 = job.next();
        assert.equal(step3.done, true, "completes after remaining boats");
    });

    it("safely skips invalid or destroyed boats without throwing", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const boat = overworld.spawnEntity("minecraft:boat", { x: 0, y: 64, z: 0 });
        boat.isValid = false;

        const job = boatLoopJob();
        assert.doesNotThrow(() => {
            while (!job.next().done) {}
        });
    });

    // Wiring-only: these pin what the pass reads off a boat's motion and off the block beside it.
    // Whether the engine reports a boat's velocity the way the era's motion read did — and whether a
    // boat that rams a block still reads as moving by the time a pass sees it — is an assumption this
    // file cannot test and has to be confirmed on a client.
    it("leaves a moored boat alone instead of reading the block beside it as a ram", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const boat = overworld.spawnEntity("minecraft:boat", { x: 0, y: 64, z: 0 });
        surroundBoat(STONE);

        processBoats();

        assert.equal(boat.isRemoved, false, "a boat at rest must survive the block beside it");
    });

    it("leaves a drifting boat alone below the era's collision speed", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const boat = overworld.spawnEntity("minecraft:boat", { x: 0, y: 64, z: 0 });
        boat.velocity = { x: 0.05, y: 0, z: 0 };
        surroundBoat(STONE);

        processBoats();

        assert.equal(boat.isRemoved, false, "a drift is not a collision (the era's var6 > 0.15D)");
    });

    it("still breaks a boat that is moving into a block at the era's speed", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const dropped: { typeId: string; amount: number }[] = [];
        overworld.spawnItem = (item: any) => {
            dropped.push({ typeId: item.typeId, amount: item.amount });
            return { id: "mock_item_entity", typeId: "minecraft:item" };
        };

        const boat = overworld.spawnEntity("minecraft:boat", { x: 0, y: 64, z: 0 });
        boat.velocity = { x: 0.2, y: 0, z: 0 };
        surroundBoat(STONE);

        processBoats();

        assert.equal(boat.isRemoved, true, "a blocked move above the era's speed destroys the boat");
        assert.equal(dropped.filter(item => item.typeId === "minecraft:oak_planks").length, 3);
        assert.equal(dropped.filter(item => item.typeId === "minecraft:stick").length, 2);
    });

    it("does not read a liquid as something to break against", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const boat = overworld.spawnEntity("minecraft:boat", { x: 0, y: 64, z: 0 });
        boat.velocity = { x: 0.2, y: 0, z: 0 };
        // `flowing_water` is the id a stream's surface cell carries, and the engine's own boat names
        // both water ids as its liquids (`minecraft:buoyant.liquid_blocks` in `boat.json`).
        surroundBoat(FLOWING_WATER);

        processBoats();

        assert.equal(boat.isRemoved, false, "water is not shoreline, however it is spelled");
    });

    it("re-resolves entities by ID across yield boundaries without holding live references", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const boats: any[] = [];
        for (let i = 0; i < 15; i++) {
            boats.push(overworld.spawnEntity("minecraft:boat", { x: i, y: 64, z: 0 }));
        }

        const job = boatLoopJob();
        job.next(); // First batch of 10

        // Despawn remaining boats from world and detect if stale references are touched
        let staleAccessed = false;
        for (let i = 10; i < 15; i++) {
            mockEntities.delete(boats[i].id);
            Object.defineProperty(boats[i], "location", {
                get() {
                    staleAccessed = true;
                    return { x: 0, y: 64, z: 0 };
                }
            });
        }

        while (!job.next().done) {}
        assert.equal(staleAccessed, false, "stale boat handles from earlier ticks must not be accessed");
    });

    it("processBoats drains generator synchronously", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        for (let i = 0; i < 15; i++) {
            overworld.spawnEntity("minecraft:boat", { x: i, y: 64, z: 0 });
        }

        assert.doesNotThrow(() => {
            processBoats();
        });
    });
});
