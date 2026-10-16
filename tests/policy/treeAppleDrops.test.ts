import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    world,
    ItemStack,
    Entity,
    BlockPermutation,
    EntityComponentTypes
} from "@minecraft/server";
import { isTreeAppleDrop } from "../../packs/BP/scripts/mobs/entitySpawnHandler.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { mockPlayers, resetMocks, Player } from "../mocks/minecraftServer.js";

// Wiring-only: every case replays our own spawn handler through the mock, so this pins the
// predicate's decision table rather than the engine's behaviour. Whether Bedrock really reports a
// leaf-decay apple with a populated location and a readable Item component at entitySpawn time is
// an assumption this file cannot test and has to be confirmed on a client.
describe("Authentic Beta 1.7.3 Leaf Apple Drops Policy", () => {
    const spawnedItems: { typeId: string; amount: number }[] = [];
    const overworld = world.getDimension("minecraft:overworld") as any;

    beforeEach(() => {
        resetMocks();
        spawnedItems.length = 0;
        // The shared overworld mock drops spawned items on the floor; record them so the tests can
        // see the bh:apple a non-tree apple is retyped into.
        overworld.spawnItem = (item: ItemStack) => {
            spawnedItems.push({ typeId: item.typeId, amount: item.amount });
            return { id: "mock_item_entity", typeId: "minecraft:item" };
        };
    });

    it("identifies and prevents apple drops when leaves are broken by a player", () => {
        const dim = world.getDimension("minecraft:overworld") as any;

        eventBus.dispatch("playerBreakBlock", {
            block: { dimension: dim, x: 10, y: 70, z: 20 },
            brokenBlockPermutation: BlockPermutation.resolve("minecraft:oak_leaves")
        });

        const appleEntity = new Entity();
        appleEntity.typeId = "minecraft:item";
        appleEntity.location = { x: 10.5, y: 70.2, z: 20.5 };
        appleEntity.dimension = dim;

        const itemStack = new ItemStack("minecraft:apple", 1);
        appleEntity.setComponent(EntityComponentTypes.Item, { itemStack });

        assert.equal(isTreeAppleDrop(appleEntity), true, "Apple from broken leaf block must be identified as tree drop");

        eventBus.dispatch("entitySpawn", { entity: appleEntity });
        assert.equal(appleEntity.isRemoved, true, "Apple entity from broken leaves must be removed");
    });

    it("identifies and prevents apple drops from natural leaf decay near trees", () => {
        const dim = world.getDimension("minecraft:overworld") as any;

        dim.setBlock({ x: 50, y: 72, z: 50 }, {
            typeId: "minecraft:oak_leaves",
            permutation: BlockPermutation.resolve("minecraft:oak_leaves")
        });

        const appleEntity = new Entity();
        appleEntity.typeId = "minecraft:item";
        appleEntity.location = { x: 50.5, y: 71.5, z: 50.5 };
        appleEntity.dimension = dim;

        const itemStack = new ItemStack("minecraft:apple", 1);
        appleEntity.setComponent(EntityComponentTypes.Item, { itemStack });

        assert.equal(isTreeAppleDrop(appleEntity), true, "Apple from decaying leaves must be identified as tree drop");

        eventBus.dispatch("entitySpawn", { entity: appleEntity });
        assert.equal(appleEntity.isRemoved, true, "Apple entity from leaf decay must be removed");
    });

    it("preserves apples dropped from broken chests (e.g. dungeon loot chests)", () => {
        const dim = world.getDimension("minecraft:overworld") as any;

        eventBus.dispatch("playerBreakBlock", {
            block: { dimension: dim, x: 100, y: 30, z: 100 },
            brokenBlockPermutation: BlockPermutation.resolve("minecraft:chest")
        });

        const appleEntity = new Entity();
        appleEntity.typeId = "minecraft:item";
        appleEntity.location = { x: 100.5, y: 30.5, z: 100.5 };
        appleEntity.dimension = dim;

        const itemStack = new ItemStack("minecraft:apple", 1);
        appleEntity.setComponent(EntityComponentTypes.Item, { itemStack });

        assert.equal(isTreeAppleDrop(appleEntity), false, "Chest apple drops must NOT be flagged as tree drops");

        eventBus.dispatch("entitySpawn", { entity: appleEntity });
        assert.equal(appleEntity.isRemoved, true, "the vanilla apple entity is replaced, not kept");
        assert.equal(spawnedItems.length, 1, "the chest apple must be respawned so it can merge");
        assert.equal(spawnedItems[0].typeId, "bh:apple", "Apple entity from chest must become the Beta apple");
    });

    it("keeps an apple a player dropped or left on death, on the id the inventory keeps", () => {
        const dim = world.getDimension("minecraft:overworld") as any;

        function appleAt(location: { x: number; y: number; z: number }): Entity {
            const apple = new Entity();
            apple.typeId = "minecraft:item";
            apple.location = location;
            apple.dimension = dim;
            apple.setComponent(EntityComponentTypes.Item, { itemStack: new ItemStack("minecraft:apple", 1) });
            return apple;
        }

        const player = new Player();
        player.location = { x: 200, y: 65, z: 200 };
        player.dimension = dim;
        mockPlayers.push(player);

        const dropped = appleAt({ x: 200.5, y: 65.2, z: 200.5 });
        assert.equal(isTreeAppleDrop(dropped), false, "an apple a player dropped is not a leaf's");

        eventBus.dispatch("entitySpawn", { entity: dropped });
        assert.equal(spawnedItems[0]?.typeId, "bh:apple", "a dropped apple lands on the id the inventory keeps");

        spawnedItems.length = 0;
        const deadPlayer = new Player();
        deadPlayer.location = { x: 300, y: 64, z: 300 };
        deadPlayer.dimension = dim;
        eventBus.dispatch("entityDie", { deadEntity: deadPlayer });

        const onDeath = appleAt({ x: 300.2, y: 64.1, z: 300.1 });
        assert.equal(isTreeAppleDrop(onDeath), false, "nor is one the death drop scattered");

        eventBus.dispatch("entitySpawn", { entity: onDeath });
        assert.equal(spawnedItems[0]?.typeId, "bh:apple", "and the death drop lands on the same id");
    });

    it("identifies and prevents stick drops when leaves are broken by a player", () => {
        const dim = world.getDimension("minecraft:overworld") as any;

        eventBus.dispatch("playerBreakBlock", {
            block: { dimension: dim, x: 10, y: 70, z: 20 },
            brokenBlockPermutation: BlockPermutation.resolve("minecraft:oak_leaves")
        });

        const stickEntity = new Entity();
        stickEntity.typeId = "minecraft:item";
        stickEntity.location = { x: 10.5, y: 70.2, z: 20.5 };
        stickEntity.dimension = dim;

        const itemStack = new ItemStack("minecraft:stick", 1);
        stickEntity.setComponent(EntityComponentTypes.Item, { itemStack });

        assert.equal(isTreeAppleDrop(stickEntity), true, "Stick from broken leaf block must be identified as tree drop");

        eventBus.dispatch("entitySpawn", { entity: stickEntity });
        assert.equal(stickEntity.isRemoved, true, "Stick entity from broken leaves must be removed");
    });

    it("removes non-Beta entities on entityLoad as well as entitySpawn", () => {
        const traderEntity = new Entity();
        traderEntity.typeId = "minecraft:wandering_trader";
        traderEntity.location = { x: 10, y: 64, z: 10 };

        eventBus.dispatch("entityLoad", { entity: traderEntity });
        assert.equal(traderEntity.isRemoved, true, "Modern mob must be removed when loaded from disk");
    });
});
