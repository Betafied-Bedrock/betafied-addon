import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    canStackSlab,
    canMergePlacedSlab
} from "../../packs/BP/scripts/interactions/slabStacking.js";
import {
    Direction,
    EntityComponentTypes,
    EntityEquippableComponent,
    EquipmentSlot,
    GameMode,
    ItemStack,
    Player,
    resetMocks,
    scheduledTimeouts,
    world
} from "@minecraft/server";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";

describe("Slab Stacking - Beta 1.7.3 Pre-Placement Stacking", () => {
    beforeEach(() => {
        resetMocks();
        eventBus.init();
    });

    describe("canStackSlab - interaction qualification", () => {
        it("qualifies only a matching slab clicked on the top face of a single slab", () => {
            assert.equal(canStackSlab("bh:wooden_slab", Direction.Up, "bh:wooden_slab"), true);
            assert.equal(canStackSlab("bh:sandstone_slab", Direction.Up, "bh:sandstone_slab"), true);

            assert.equal(canStackSlab("bh:wooden_slab", Direction.Down, "bh:wooden_slab"), false);
            assert.equal(canStackSlab("bh:wooden_slab", Direction.North, "bh:wooden_slab"), false);
            assert.equal(canStackSlab("bh:wooden_slab", Direction.Up, "bh:stone_slab"), false);
            assert.equal(canStackSlab("bh:stone_slab", Direction.Up, undefined), false);
            assert.equal(canStackSlab("bh:double_wooden_slab", Direction.Up, "bh:wooden_slab"), false);
            assert.equal(canStackSlab("minecraft:oak_planks", Direction.Up, "bh:wooden_slab"), false);
        });
    });

    describe("canMergePlacedSlab - placement fallback qualification", () => {
        it("merges only onto the same single slab", () => {
            assert.equal(canMergePlacedSlab("bh:wooden_slab", "bh:wooden_slab"), true);

            assert.equal(canMergePlacedSlab("bh:wooden_slab", "bh:cobblestone_slab"), false);
            assert.equal(canMergePlacedSlab("bh:wooden_slab", undefined), false);
            assert.equal(canMergePlacedSlab("minecraft:stone", "minecraft:stone"), false);
        });
    });

    describe("Event Interception & Execution", () => {
        it("cancels top-face interaction and doubles slab in Survival, consuming 1 item", () => {
            const dim = world.getDimension("overworld");
            const loc = { x: 10, y: 64, z: 10 };
            const block = dim.getBlock(loc);
            block.setType("bh:wooden_slab");

            const player = new Player("p1", "Tester");
            player.gameMode = GameMode.Survival;
            const equip = new EntityEquippableComponent();
            player.setComponent(EntityComponentTypes.Equippable, equip);
            equip.setEquipment(EquipmentSlot.Mainhand, new ItemStack("bh:wooden_slab", 3));

            const event: any = {
                block,
                blockFace: Direction.Up,
                faceLocation: { x: 0.5, y: 1.0, z: 0.5 },
                isFirstEvent: true,
                itemStack: new ItemStack("bh:wooden_slab", 3),
                player,
                cancel: false
            };

            eventBus.dispatch("playerInteractWithBlock", event);
            assert.equal(event.cancel, true, "Interaction must be cancelled immediately");

            // Flush scheduled system.run callback
            while (scheduledTimeouts.length > 0) {
                const item = scheduledTimeouts.shift()!;
                item.callback();
            }

            assert.equal(block.typeId, "bh:double_wooden_slab", "Block must turn into double slab");
            const held = equip.getEquipment(EquipmentSlot.Mainhand);
            assert.equal(held?.amount, 2, "Held item stack count must decrease by 1");
        });

        it("does not consume item in Creative mode", () => {
            const dim = world.getDimension("overworld");
            const loc = { x: 12, y: 64, z: 12 };
            const block = dim.getBlock(loc);
            block.setType("bh:stone_slab");

            const player = new Player("p2", "Builder");
            player.gameMode = GameMode.Creative;
            const equip = new EntityEquippableComponent();
            player.setComponent(EntityComponentTypes.Equippable, equip);
            equip.setEquipment(EquipmentSlot.Mainhand, new ItemStack("bh:stone_slab", 1));

            const event: any = {
                block,
                blockFace: Direction.Up,
                faceLocation: { x: 0.5, y: 1.0, z: 0.5 },
                isFirstEvent: true,
                itemStack: new ItemStack("bh:stone_slab", 1),
                player,
                cancel: false
            };

            eventBus.dispatch("playerInteractWithBlock", event);
            assert.equal(event.cancel, true);

            while (scheduledTimeouts.length > 0) {
                scheduledTimeouts.shift()!.callback();
            }

            assert.equal(block.typeId, "bh:double_stone_slab");
            const held = equip.getEquipment(EquipmentSlot.Mainhand);
            assert.equal(held?.amount, 1, "Creative mode must not consume item");
        });

        it("cancels playerPlaceBlockBefore when placing a slab directly onto another", () => {
            const dim = world.getDimension("overworld");
            const lowerLoc = { x: 5, y: 60, z: 5 };
            const lowerBlock = dim.getBlock(lowerLoc);
            lowerBlock.setType("bh:cobblestone_slab");

            const upperLoc = { x: 5, y: 61, z: 5 };
            const upperBlock = dim.getBlock(upperLoc);
            upperBlock.setType("minecraft:air");

            const player = new Player("p3", "Survivalist");
            player.gameMode = GameMode.Survival;
            const equip = new EntityEquippableComponent();
            player.setComponent(EntityComponentTypes.Equippable, equip);
            equip.setEquipment(EquipmentSlot.Mainhand, new ItemStack("bh:cobblestone_slab", 1));

            const event: any = {
                block: upperBlock,
                face: Direction.Up,
                faceLocation: { x: 0.5, y: 0.0, z: 0.5 },
                permutationToPlace: { type: { id: "bh:cobblestone_slab" } },
                player,
                cancel: false
            };

            eventBus.dispatch("playerPlaceBlockBefore", event);
            assert.equal(event.cancel, true, "Placement event must be cancelled");

            while (scheduledTimeouts.length > 0) {
                scheduledTimeouts.shift()!.callback();
            }

            assert.equal(lowerBlock.typeId, "bh:double_cobblestone_slab", "Lower block must become double slab");
            assert.equal(upperBlock.typeId, "minecraft:air", "Upper cell must remain air");
            const held = equip.getEquipment(EquipmentSlot.Mainhand);
            assert.equal(held, undefined, "Last item in stack should be removed when consumed");
        });

        it("spends the slab the click was made with, not a stack drawn in the tick since", () => {
            const dim = world.getDimension("overworld");
            const loc = { x: 14, y: 64, z: 14 };
            const block = dim.getBlock(loc);
            block.setType("bh:wooden_slab");

            const player = new Player("p4", "Swapper");
            player.gameMode = GameMode.Survival;
            const equip = new EntityEquippableComponent();
            player.setComponent(EntityComponentTypes.Equippable, equip);
            equip.setEquipment(EquipmentSlot.Mainhand, new ItemStack("bh:wooden_slab", 2));

            const event: any = {
                block,
                blockFace: Direction.Up,
                faceLocation: { x: 0.5, y: 1.0, z: 0.5 },
                isFirstEvent: true,
                itemStack: new ItemStack("bh:wooden_slab", 2),
                player,
                cancel: false
            };

            eventBus.dispatch("playerInteractWithBlock", event);
            assert.equal(event.cancel, true);

            // The doubling lands a tick later, so the mainhand stack is read again then.
            equip.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:iron_sword", 1));

            while (scheduledTimeouts.length > 0) {
                scheduledTimeouts.shift()!.callback();
            }

            assert.equal(block.typeId, "bh:double_wooden_slab", "the doubling still lands");
            const held = equip.getEquipment(EquipmentSlot.Mainhand);
            assert.equal(held?.typeId, "minecraft:iron_sword", "a stack the click never named is left alone");
            assert.equal(held?.amount, 1);
        });
    });
});
