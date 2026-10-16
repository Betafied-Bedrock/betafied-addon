import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BlockPermutation, Direction, ItemStack, Player, resetMocks } from "@minecraft/server";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import "../../packs/BP/scripts/interactions/placement.js";
import { dimension } from "../support/world.js";

/**
 * One click on a block, delivered the way the bus delivers it. The rules here are a mapping from a
 * held item, a face and the block under the cursor to a cancel, so the case for each rule is the
 * click that breaks it.
 */
function click(blockId: string, heldId: string | undefined, face: string) {
    const block = dimension().getBlock({ x: 22, y: 64, z: 22 });
    block.setPermutation(BlockPermutation.resolve(blockId));

    const event: any = {
        cancel: false,
        block,
        blockFace: face,
        itemStack: heldId === undefined ? undefined : new ItemStack(heldId, 1),
        player: new Player("placement_tester", "Tester")
    };

    eventBus.dispatch("playerInteractWithBlock", event);
    return event;
}

describe("Block placement - the clicks Beta 1.7.3 answered for us", () => {
    beforeEach(() => resetMocks());

    it("refuses the two blocks the era could not hang from a ceiling", () => {
        const cases: [string, string, boolean][] = [
            ["minecraft:stone_button", Direction.Down, true],
            ["minecraft:lever", Direction.Down, true],
            ["minecraft:stone_button", Direction.Up, false]
        ];

        for (const [held, face, cancelled] of cases) {
            const event = click("minecraft:stone", held, face);
            assert.equal(
                event.cancel,
                cancelled,
                `${held} on a ${face} face: the era's ceiling rule is the bottom face, not the item alone`
            );
        }
    });

    it("refuses the log-stripping click the era had no recipe for", () => {
        assert.equal(click("minecraft:oak_log", "minecraft:iron_axe", Direction.Up).cancel, true, "an axe on a Beta log would strip it");
        assert.equal(click("minecraft:stone", "minecraft:iron_axe", Direction.Up).cancel, false, "and an axe on anything else is an ordinary click");
    });

    it("refuses the shovel click that would make a modern path", () => {
        assert.equal(click("minecraft:dirt", "minecraft:iron_shovel", Direction.Up).cancel, true);
        assert.equal(click("minecraft:grass_block", "minecraft:diamond_shovel", Direction.Up).cancel, true);
        assert.equal(click("minecraft:stone", "minecraft:iron_shovel", Direction.Up).cancel, false, "a shovel has no business with stone");
    });

    it("refuses the bone meal click the era left alone, so vanilla's spread never runs", () => {
        const cases: [string, boolean][] = [
            ["minecraft:short_grass", true],
            ["minecraft:fern", true],
            ["minecraft:wheat", false]
        ];

        for (const [blockId, cancelled] of cases) {
            const event = click(blockId, "minecraft:bone_meal", Direction.Up);
            assert.equal(event.cancel, cancelled, `bone meal on ${blockId}`);
        }
    });

    it("leaves an empty-handed click to whatever the era did with it", () => {
        const event = click("minecraft:stone", undefined, Direction.Down);

        assert.equal(event.cancel, false, "a rule about what is being placed cannot fire with nothing in hand");
    });
});
