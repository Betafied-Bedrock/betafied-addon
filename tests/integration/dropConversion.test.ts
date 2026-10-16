import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ItemStack, EntityComponentTypes } from "@minecraft/server";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { mockPlayers, resetMocks, world, Player } from "../mocks/minecraftServer.js";
// Importing the module registers its entitySpawn handler on the bus.
import "../../packs/BP/scripts/mobs/entitySpawnHandler.js";
import { cleanerJob } from "../../packs/BP/scripts/mobs/entityCleaner.js";

interface Spawned {
    typeId: string;
    amount: number;
}

function brokenDrop(typeId: string, amount = 1): { entity: any; spawned: Spawned[]; removed: () => boolean } {
    const spawned: Spawned[] = [];
    let removed = false;

    const entity: any = {
        isValid: true,
        hasTag: () => false,
        typeId: "minecraft:item",
        location: { x: 4, y: 64, z: 12 },
        dimension: {
            spawnItem(item: ItemStack) {
                spawned.push({ typeId: item.typeId, amount: item.amount });
            }
        },
        getComponent(type: string) {
            if (type === EntityComponentTypes.Item) {
                return { itemStack: new ItemStack(typeId, amount) };
            }
            return undefined;
        },
        remove() {
            removed = true;
            entity.isValid = false;
        }
    };

    return { entity, spawned, removed: () => removed };
}

/**
 * The same drop, but placed in the world before the script could see it spawn and then swept up by
 * `entityCleaner`. The mock does not run the spawn handler on `spawnEntity` unless `eventBus.init()`
 * was called, so this reaches the sweep alone.
 */
function sweptDrop(typeId: string, amount = 1): { spawned: Spawned[]; removed: () => boolean } {
    const overworld = world.getDimension("minecraft:overworld") as any;
    const spawned: Spawned[] = [];

    overworld.spawnItem = (item: ItemStack) => {
        spawned.push({ typeId: item.typeId, amount: item.amount });
        return { id: "mock_item_entity", typeId: "minecraft:item" };
    };

    const player = new Player("parity_player");
    player.dimension = overworld;
    mockPlayers.push(player);

    const entity = overworld.spawnEntity("minecraft:item", { x: 0, y: 64, z: 0 });
    entity.setComponent(EntityComponentTypes.Item, { itemStack: new ItemStack(typeId, amount) });

    Array.from(cleanerJob());

    return { spawned, removed: () => entity.isRemoved === true };
}

describe("Drop conversion - picked-up items match their stack", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("answers a drop by retyping it onto the id the inventory keeps, or removing one the era has no drop for", () => {
        const log = brokenDrop("minecraft:oak_log");
        eventBus.dispatch("entitySpawn", { entity: log.entity });

        assert.equal(log.spawned.length, 1, "the vanilla log drop must be replaced once");
        assert.equal(log.spawned[0].typeId, "bh:oak_log", "the ground item must be the id the inventory keeps");
        assert.equal(log.spawned[0].amount, 1, "stack size must be preserved");

        const bow = brokenDrop("minecraft:bow");
        eventBus.dispatch("entitySpawn", { entity: bow.entity });

        assert.equal(bow.spawned[0]?.typeId, "bh:bow", "the bow drop lands on the bh id too");

        const birch = brokenDrop("minecraft:birch_log", 3);
        eventBus.dispatch("entitySpawn", { entity: birch.entity });

        assert.equal(birch.spawned[0]?.typeId, "bh:birch_log", "birch must not collapse into oak");
        assert.equal(birch.spawned[0]?.amount, 3, "whole stack rides across the respawn");

        const salmon = brokenDrop("minecraft:salmon");
        eventBus.dispatch("entitySpawn", { entity: salmon.entity });

        assert.equal(salmon.removed(), true, "the vanilla salmon entity is replaced, not kept");
        assert.equal(salmon.spawned[0]?.typeId, "bh:cod", "salmon collapses to the Beta cod item");

        const flesh = brokenDrop("minecraft:rotten_flesh");
        eventBus.dispatch("entitySpawn", { entity: flesh.entity });

        assert.equal(flesh.removed(), true, "rotten flesh is not a Beta drop");
        assert.equal(flesh.spawned.length, 0, "a banned drop must not be replaced with anything");
    });

    it("leaves a drop that is already final — both cane ids, or the pack's own — exactly where it is", () => {
        // `minecraft:reeds` is this engine's cane BLOCK; the item a broken cane pays is
        // `minecraft:sugar_cane`. Retyping the item onto the block id handed the drop back to the
        // engine as an id it will not build, and the entity is the only copy of the item, so it stays.
        for (const id of ["minecraft:reeds", "minecraft:sugar_cane", "bh:oak_log", "bh:porkchop"]) {
            const { entity, spawned, removed } = brokenDrop(id, 2);
            eventBus.dispatch("entitySpawn", { entity });

            assert.equal(removed(), false, `${id} must not be read as a banned drop`);
            assert.equal(spawned.length, 0, `${id} is already final and needs no respawn`);
        }
    });

    it("leaves a drop alone when the id it would be retyped to cannot be built", () => {
        // Stands in for the engine refusing a replacement id: the mock's ItemStack accepts anything,
        // so only this patch can reach the ordering the fix is for. The source entity is removed to
        // spawn a replacement, which means an unbuildable target may never be reached at all.
        const original = Object.getOwnPropertyDescriptor(ItemStack.prototype, "maxAmount")!;
        const originalGet = original.get!;
        Object.defineProperty(ItemStack.prototype, "maxAmount", {
            configurable: true,
            get(this: ItemStack) {
                if (this.typeId === "bh:oak_log") throw new Error("id this engine cannot build");
                return originalGet.call(this);
            }
        });

        try {
            const { entity, spawned, removed } = brokenDrop("minecraft:oak_log", 3);
            eventBus.dispatch("entitySpawn", { entity });

            assert.equal(removed(), false, "a drop must outlive a replacement the engine refused");
            assert.equal(spawned.length, 0, "nothing can be spawned under the refused id");
        } finally {
            Object.defineProperty(ItemStack.prototype, "maxAmount", original);
        }
    });

    it("splits a retyped food stack into the singles Beta allowed", () => {
        const { entity, spawned } = brokenDrop("minecraft:porkchop", 4);
        eventBus.dispatch("entitySpawn", { entity });

        // bh:porkchop is unstackable, so four porkchops cannot ride across as one oversized entity:
        // the engine would leave a stack the player can neither split nor eat. Each item drops alone.
        assert.equal(spawned.length, 4, "an unstackable bh food must not spawn as one oversized stack");
        for (const stack of spawned) {
            assert.equal(stack.typeId, "bh:porkchop", "food must match the id the inventory sweeps to");
            assert.equal(stack.amount, 1, "every split stack holds a single item");
        }
    });

    it("answers a drop the same way whether it is seen at spawn or swept up later", () => {
        const cases: readonly [string, number][] = [
            ["minecraft:oak_log", 3],
            ["minecraft:porkchop", 4],
            ["minecraft:reeds", 3],
            ["minecraft:rotten_flesh", 1],
            ["bh:oak_log", 2]
        ];

        for (const [id, amount] of cases) {
            const atSpawn = brokenDrop(id, amount);
            eventBus.dispatch("entitySpawn", { entity: atSpawn.entity });

            const atSweep = sweptDrop(id, amount);

            assert.deepEqual(
                atSweep.spawned,
                atSpawn.spawned,
                `${id} x${amount} must land the same way in the sweep as at spawn`
            );
            assert.equal(
                atSweep.removed(),
                atSpawn.removed(),
                `${id} x${amount} must be replaced or kept by both passes`
            );
        }
    });
});
