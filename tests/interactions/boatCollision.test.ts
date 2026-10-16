import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { boatLoopJob, boatCollisionJob } from "../../packs/BP/scripts/interactions/boatCollision.js";
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

    it("survives a boat that is already invalid, and one that is gone by the time its batch runs", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;

        const wrecked = overworld.spawnEntity("minecraft:boat", { x: 0, y: 64, z: 0 });
        wrecked.isValid = false;

        // A destroyed handle is skipped rather than read, so the pass cannot throw here.
        assert.doesNotThrow(() => {
            const job = boatLoopJob();
            while (!job.next().done) {}
        });

        const boats: any[] = [];
        for (let i = 0; i < 15; i++) {
            boats.push(overworld.spawnEntity("minecraft:boat", { x: i, y: 64, z: 0 }));
        }

        const batched = boatLoopJob();
        batched.next(); // First batch of 10

        // Despawn the tail of the list and detect whether a handle from the first batch is touched again.
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

        while (!batched.next().done) {}
        assert.equal(staleAccessed, false, "handles from an earlier batch must not be read again");
    });

    // Wiring-only: these pin what the pass reads off a boat's motion and off the block beside it.
    // Whether the engine reports a boat's velocity the way the era's motion read did — and whether a
    // boat that rams a block still reads as moving by the time a pass sees it — is an assumption this
    // file cannot test and has to be confirmed on a client.
    it("leaves a boat alone at rest or below the era's collision speed", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const moored = overworld.spawnEntity("minecraft:boat", { x: 0, y: 64, z: 0 });
        surroundBoat(STONE);

        boatCollisionJob();

        assert.equal(moored.isRemoved, false, "a boat at rest is not reading the block beside it as a ram");

        // Same cell, so the stone ring around it still stands, but now the boat is drifting into it.
        const drifting = overworld.spawnEntity("minecraft:boat", { x: 0, y: 64, z: 0 });
        drifting.velocity = { x: 0.05, y: 0, z: 0 };

        boatCollisionJob();

        assert.equal(drifting.isRemoved, false, "a drift is not a collision (the era's var6 > 0.15D)");
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

        boatCollisionJob();

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

        boatCollisionJob();

        assert.equal(boat.isRemoved, false, "water is not shoreline, however it is spelled");
    });
});
