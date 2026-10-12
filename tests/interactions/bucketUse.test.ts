import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { filledBucketFor } from "../../packs/BP/scripts/interactions/bucketUse.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import {
    BlockPermutation,
    Entity,
    EntityComponentTypes,
    EntityEquippableComponent,
    EquipmentSlot,
    ItemStack,
    Player,
    resetMocks,
    scheduledTimeouts,
    world
} from "@minecraft/server";

const OVERWORLD = "minecraft:overworld";

function dimension() {
    return world.getDimension(OVERWORLD);
}

function bucketHolder(): Player {
    const player = new Player("bucket_user", "BucketUser");
    const equippable = new EntityEquippableComponent();
    equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack("bh:bucket", 1));
    player.setComponent(EntityComponentTypes.Equippable, equippable);
    return player;
}

function heldItem(player: Player) {
    return player.getComponent(EntityComponentTypes.Equippable)?.getEquipment(EquipmentSlot.Mainhand);
}

function fluid(typeId: string, liquidDepth: number) {
    return BlockPermutation.resolve(typeId, { liquid_depth: liquidDepth });
}

/** The fill is written on the next tick, because a before-event cannot touch the world. */
function settle(): void {
    while (scheduledTimeouts.length > 0) {
        scheduledTimeouts.shift()!.callback();
    }
}

describe("Bucket Use - Beta 1.7.3 source-only filling", () => {
    beforeEach(() => {
        resetMocks();
        eventBus.init();
    });

    describe("filledBucketFor - what a bucket can lift", () => {
        it("fills from a still source", () => {
            assert.equal(filledBucketFor("minecraft:water", 0), "minecraft:water_bucket");
            assert.equal(filledBucketFor("minecraft:lava", 0), "minecraft:lava_bucket");
        });

        it("accepts the legacy flowing ids the engine still reports", () => {
            assert.equal(filledBucketFor("minecraft:flowing_water", 0), "minecraft:water_bucket");
            assert.equal(filledBucketFor("minecraft:flowing_lava", 0), "minecraft:lava_bucket");
        });

        it("refuses water on its way somewhere, which is what kept an infinite pool working", () => {
            assert.equal(filledBucketFor("minecraft:water", 3), undefined);
            assert.equal(filledBucketFor("minecraft:lava", 1), undefined);
            assert.equal(filledBucketFor("minecraft:water", undefined), undefined);
        });

        it("refuses anything that is not a fluid", () => {
            assert.equal(filledBucketFor("minecraft:stone", 0), undefined);
            assert.equal(filledBucketFor("minecraft:ice", 0), undefined);
        });
    });

    describe("filling from a source block", () => {
        it("takes the source with it and hands back the filled bucket", () => {
            const dim = dimension();
            const source = dim.getBlock({ x: 2, y: 64, z: 2 });
            source.setPermutation(fluid("minecraft:water", 0));

            const player = bucketHolder();
            const event = {
                cancel: false,
                block: source,
                blockFace: "Up",
                dimension: dim,
                itemStack: heldItem(player),
                player
            };

            eventBus.dispatch("playerInteractWithBlock", event);
            settle();

            assert.equal(event.cancel, true, "the engine's own bucket would fill the same way twice");
            assert.equal(source.typeId, "minecraft:air");
            assert.equal(heldItem(player)?.typeId, "minecraft:water_bucket");
        });

        it("leaves flowing water alone", () => {
            const dim = dimension();
            const stream = dim.getBlock({ x: 4, y: 64, z: 4 });
            stream.setPermutation(fluid("minecraft:water", 3));

            const player = bucketHolder();
            const event = {
                cancel: false,
                block: stream,
                blockFace: "Up",
                dimension: dim,
                itemStack: heldItem(player),
                player
            };

            eventBus.dispatch("playerInteractWithBlock", event);
            settle();

            assert.equal(event.cancel, false);
            assert.equal(stream.typeId, "minecraft:water");
            assert.equal(heldItem(player)?.typeId, "bh:bucket", "a missed click keeps the bucket");
        });

        it("lifts lava without burning the bucket", () => {
            const dim = dimension();
            const lava = dim.getBlock({ x: 6, y: 64, z: 6 });
            lava.setPermutation(fluid("minecraft:lava", 0));

            const player = bucketHolder();
            eventBus.dispatch("playerInteractWithBlock", {
                cancel: false,
                block: lava,
                blockFace: "Up",
                dimension: dim,
                itemStack: heldItem(player),
                player
            });
            settle();

            assert.equal(lava.typeId, "minecraft:air");
            assert.equal(heldItem(player)?.typeId, "minecraft:lava_bucket");
        });

        it("ignores a bucket that is not the pack's empty one", () => {
            const dim = dimension();
            const source = dim.getBlock({ x: 8, y: 64, z: 8 });
            source.setPermutation(fluid("minecraft:water", 0));

            const player = bucketHolder();
            const event = {
                cancel: false,
                block: source,
                blockFace: "Up",
                dimension: dim,
                itemStack: new ItemStack("minecraft:stick", 1),
                player
            };

            eventBus.dispatch("playerInteractWithBlock", event);
            settle();

            assert.equal(event.cancel, false);
            assert.equal(source.typeId, "minecraft:water");
        });
    });

    describe("milking a cow", () => {
        it("answers the same empty bucket with a milk bucket", () => {
            const player = bucketHolder();
            const cow = new Entity();
            cow.typeId = "minecraft:cow";

            const event = {
                cancel: false,
                itemStack: heldItem(player),
                player,
                target: cow
            };

            eventBus.dispatch("playerInteractWithEntity", event);
            settle();

            assert.equal(event.cancel, true, "the cow's own interaction would milk it twice");
            assert.equal(heldItem(player)?.typeId, "minecraft:milk_bucket");
        });

        it("leaves a bucket held at anything else alone", () => {
            const player = bucketHolder();
            const pig = new Entity();
            pig.typeId = "minecraft:pig";

            const event = {
                cancel: false,
                itemStack: heldItem(player),
                player,
                target: pig
            };

            eventBus.dispatch("playerInteractWithEntity", event);
            settle();

            assert.equal(event.cancel, false);
            assert.equal(heldItem(player)?.typeId, "bh:bucket");
        });
    });
});
