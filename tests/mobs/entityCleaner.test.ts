import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BlockPermutation, EntityComponentTypes, ItemStack } from "@minecraft/server";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { cleanerJob } from "../../packs/BP/scripts/mobs/entityCleaner.js";
import { mockPlayers, resetMocks, world, Player } from "../mocks/minecraftServer.js";

// The mock's ItemStack never clamps, so these cases pin our own respawn policy — the engine's clamp
// is what punishes a caller that skips it, and the mock cannot reproduce that half.
function recordSpawnedItems(): { typeId: string; amount: number }[] {
    const overworld = world.getDimension("minecraft:overworld") as any;
    const spawned: { typeId: string; amount: number }[] = [];
    overworld.spawnItem = (item: ItemStack) => {
        spawned.push({ typeId: item.typeId, amount: item.amount });
        return { id: "mock_item_entity", typeId: "minecraft:item" };
    };
    return spawned;
}

function placeStackInSweepRange(itemTypeId: string, amount = 1): any {
    const overworld = world.getDimension("minecraft:overworld") as any;
    const player = new Player("test_player");
    player.dimension = overworld;
    mockPlayers.push(player);

    const entity = overworld.spawnEntity("minecraft:item", { x: 2, y: 64, z: 2 });
    entity.setComponent(EntityComponentTypes.Item, { itemStack: new ItemStack(itemTypeId, amount) });
    return entity;
}

function sweep(): void {
    const job = cleanerJob();
    while (!job.next().done) {}
}

describe("EntityCleaner Batching & Lifetime Safety", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("yields part-way through the sweep, completes on the last entity, and skips a despawned handle", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("test_player");
        player.dimension = overworld;
        mockPlayers.push(player);

        for (let i = 0; i < 25; i++) {
            overworld.spawnEntity("minecraft:sniffer", { x: 0, y: 64, z: 0 });
        }
        overworld.spawnEntity("minecraft:sniffer", { x: 0, y: 64, z: 0 }).isValid = false;

        const job = cleanerJob();
        assert.equal(job.next().done, false, "the sweep yields with entities still to clean");

        let step = job.next();
        while (!step.done) step = job.next();
        assert.equal(step.done, true, "and finishes on the pass that cleans the last one");
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

        sweep();

        // The sweep runs on every loaded entity within 32 blocks of a player, so an unrecognized id
        // is deleted exactly as the player walks up to the stack on the ground.
        assert.equal(cane.isRemoved, false, "a reeds drop must survive the nearby-entity sweep");
    });

    it("lands a raw ore drop where the spawn pass lands it, at the era's one ore per drop", () => {
        const spawned = recordSpawnedItems();
        const raw = placeStackInSweepRange("minecraft:raw_iron", 3);

        sweep();

        assert.equal(raw.isRemoved, true, "the modern raw ore entity is replaced");
        assert.deepEqual(
            spawned,
            [{ typeId: "minecraft:iron_ore", amount: 1 }],
            "a swept raw ore stack must become the same single ore the spawn pass leaves"
        );
    });

    it("splits an unstackable food stack as it retypes it", () => {
        const spawned = recordSpawnedItems();
        placeStackInSweepRange("minecraft:porkchop", 4);

        sweep();

        // bh:porkchop is unstackable, so a swept stack has to come apart exactly as a spawned one does.
        assert.equal(spawned.length, 4, "the sweep must not hand the engine one oversized stack");
        for (const stack of spawned) {
            assert.equal(stack.typeId, "bh:porkchop");
            assert.equal(stack.amount, 1);
        }
    });

    it("leaves an already-converted drop untouched instead of respawning it every sweep", () => {
        const spawned = recordSpawnedItems();
        const drop = placeStackInSweepRange("bh:oak_log", 2);

        sweep();

        assert.equal(drop.isRemoved, false, "an era id is already final");
        assert.equal(spawned.length, 0, "respawning an unchanged drop would churn the entity every pass");
    });

    it("leaves the leaf-origin question to the pass that saw the break", () => {
        const spawned = recordSpawnedItems();
        const overworld = world.getDimension("minecraft:overworld") as any;

        eventBus.dispatch("playerBreakBlock", {
            block: { dimension: overworld, x: 2, y: 64, z: 2 },
            brokenBlockPermutation: BlockPermutation.resolve("minecraft:oak_leaves")
        });

        placeStackInSweepRange("minecraft:apple", 1);
        sweep();

        // The spawn and load passes delete an apple the engine drops beside a just-broken leaf; a sweep
        // has no break of its own to attribute, so it retypes the apple instead of reading the marker.
        assert.equal(spawned.length, 1, "the sweep retypes an apple rather than deleting it");
        assert.equal(spawned[0].typeId, "bh:apple");
    });
});

