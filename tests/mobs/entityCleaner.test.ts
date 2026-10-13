import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EntityComponentTypes, ItemStack } from "@minecraft/server";
import { cleanerJob } from "../../packs/BP/scripts/mobs/entityCleaner.js";
import { mockPlayers, resetMocks, world, Player } from "../mocks/minecraftServer.js";

describe("EntityCleaner Batching & Lifetime Safety", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("batches entity processing into 20-item chunks", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("test_player");
        player.dimension = overworld;
        mockPlayers.push(player);

        for (let i = 0; i < 45; i++) {
            overworld.spawnEntity("minecraft:sniffer", { x: 0, y: 64, z: 0 });
        }

        const job = cleanerJob();

        // Batch 1 (20 entities)
        const step1 = job.next();
        assert.equal(step1.done, false, "yields after first batch of 20 entities");

        // Batch 2 (next 20 entities -> 40 total)
        const step2 = job.next();
        assert.equal(step2.done, false, "yields after second batch of 20 entities");

        // Remaining 5 entities + player loop yield
        const step3 = job.next();
        assert.equal(step3.done, false, "yields after player loop");

        const step4 = job.next();
        assert.equal(step4.done, true, "generator completes after all entities cleaned");
    });

    it("safely skips invalid entities without throwing", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("test_player");
        player.dimension = overworld;
        mockPlayers.push(player);

        const ent = overworld.spawnEntity("minecraft:sniffer", { x: 0, y: 64, z: 0 });
        ent.isValid = false;

        const job = cleanerJob();
        assert.doesNotThrow(() => {
            while (!job.next().done) {}
        });
    });

    it("aborts player sweep cleanly if player disconnects across yield boundary", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("test_player");
        player.dimension = overworld;
        mockPlayers.push(player);

        for (let i = 0; i < 40; i++) {
            overworld.spawnEntity("minecraft:sniffer", { x: 0, y: 64, z: 0 });
        }

        const job = cleanerJob();

        const step1 = job.next();
        assert.equal(step1.done, false);

        player.isValid = false;

        const step2 = job.next();
        assert.equal(step2.done, false);

        const step3 = job.next();
        assert.equal(step3.done, true);
    });

    it("keeps a dropped sugar cane stack beside a player", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("test_player");
        player.dimension = overworld;
        mockPlayers.push(player);

        const cane = overworld.spawnEntity("minecraft:item", { x: 2, y: 64, z: 2 });
        cane.setComponent(EntityComponentTypes.Item, { itemStack: new ItemStack("minecraft:reeds", 3) });

        const job = cleanerJob();
        while (!job.next().done) {}

        // The sweep runs on every loaded entity within 32 blocks of a player, so an unrecognized id
        // is deleted exactly as the player walks up to the stack on the ground.
        assert.equal(cane.isRemoved, false, "a reeds drop must survive the nearby-entity sweep");
    });

    it("migrates uninitialized properties and effects on nearby Beta mobs", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("test_player");
        player.dimension = overworld;
        mockPlayers.push(player);

        const cow = overworld.spawnEntity("minecraft:cow", { x: 0, y: 64, z: 0 });
        cow.setComponent("minecraft:is_hidden_when_invisible", {});
        assert.equal(cow.getProperty("betarock:shadow_span"), undefined);
        assert.equal(cow.getEffect("invisibility"), undefined);

        const job = cleanerJob();
        while (!job.next().done) {}

        assert.equal(cow.getProperty("betarock:shadow_span"), 1);
        assert.ok(cow.getEffect("invisibility"));
    });
});

