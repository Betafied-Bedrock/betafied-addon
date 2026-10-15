import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BlockPermutation, Direction, ItemStack, Player, resetMocks } from "@minecraft/server";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import "../../packs/BP/scripts/world/buildHeightLimit.js";
import { dimension } from "../support/world.js";

function click(block: any, blockFace: string, player: Player, itemStack?: any) {
    return { cancel: false, block, blockFace, itemStack, player };
}

describe("Build height limit", () => {
    beforeEach(() => {
        resetMocks();
        eventBus.init();
    });

    it("refuses the placement a click above the era's ceiling would make", () => {
        const top = dimension().getBlock({ x: 2, y: 127, z: 2 });
        const player = new Player("builder", "Builder");

        const event = click(top, Direction.Up, player, new ItemStack("minecraft:cobblestone", 1));
        eventBus.dispatch("playerInteractWithBlock", event);

        assert.equal(event.cancel, true, "the era's ceiling is 128 blocks");
        assert.equal(player.messagesSent.length, 1, "and its own message says which");
    });

    it("leaves a click with nothing in hand alone, which is how a sign is written on", () => {
        const top = dimension().getBlock({ x: 4, y: 127, z: 4 });
        const player = new Player("editor", "Editor");

        const event = click(top, Direction.Up, player);
        eventBus.dispatch("playerInteractWithBlock", event);

        assert.equal(event.cancel, false, "an empty hand places nothing, so there is no ceiling to hold");
        assert.equal(player.messagesSent.length, 0, "and no message for a placement nobody attempted");
    });

    it("leaves a sign above the ceiling alone, which is where its text is written", () => {
        const sign = dimension().getBlock({ x: 6, y: 128, z: 6 });
        sign.setPermutation(BlockPermutation.resolve("minecraft:standing_sign", {
            ground_sign_direction: 8
        }));
        const player = new Player("editor", "Editor");

        const event = click(sign, Direction.North, player, new ItemStack("minecraft:cobblestone", 1));
        eventBus.dispatch("playerInteractWithBlock", event);

        assert.equal(
            event.cancel,
            false,
            "the ceiling is a rule about building, and a sign already up is not a placement"
        );
        assert.equal(player.messagesSent.length, 0, "no message for a click nobody built with");
    });

    it("leaves a bed at the ceiling alone, which is the click that sets the spawn", () => {
        const bed = dimension().getBlock({ x: 10, y: 127, z: 10 });
        bed.setPermutation(BlockPermutation.resolve("minecraft:bed"));
        const player = new Player("sleeper", "Sleeper");

        const event = click(bed, Direction.Up, player, new ItemStack("minecraft:bed", 1));
        eventBus.dispatch("playerInteractWithBlock", event);

        assert.equal(
            event.cancel,
            false,
            "the click's own action is the sleep that records the spawn, not a placement"
        );
        assert.equal(player.messagesSent.length, 0, "no ceiling message for a click nobody built with");
    });

    it("leaves the top face of a wall sign at the ceiling alone the same way", () => {
        const sign = dimension().getBlock({ x: 8, y: 127, z: 8 });
        sign.setPermutation(BlockPermutation.resolve("minecraft:wall_sign", { facing_direction: 2 }));
        const player = new Player("editor", "Editor");

        const event = click(sign, Direction.Up, player, new ItemStack("minecraft:cobblestone", 1));
        eventBus.dispatch("playerInteractWithBlock", event);

        assert.equal(event.cancel, false, "the cell above it is not the click's to refuse");
        assert.equal(player.messagesSent.length, 0);
    });
});
