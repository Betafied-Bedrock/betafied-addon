import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BlockPermutation, resetMocks, scheduledTimeouts, world } from "@minecraft/server";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import "../../packs/BP/scripts/world/netherIce.js";

const NETHER = "minecraft:nether";
const OVERWORLD = "minecraft:overworld";

interface Cell {
    x: number;
    y: number;
    z: number;
}

/**
 * The Nether under the id the pack's own policy uses. The mock registers its nether under Java's
 * `minecraft:the_nether`, which is not the spelling a real break event carries, so this asks for the
 * dimension whose id matches what the engine reports.
 */
function nether() {
    return world.getDimension(NETHER) as any;
}

/**
 * One break of `brokenType`, with the cell already in the state the engine leaves it in: the block is
 * gone, so the cell reads `remainingAfterBreak` unless the case says otherwise.
 */
function breakBlock(dimensionId: string, cell: Cell, brokenType: string, remainingAfterBreak = "minecraft:air") {
    const dimension = world.getDimension(dimensionId) as any;
    dimension.getBlock(cell).setType(remainingAfterBreak);

    eventBus.dispatch("playerBreakBlock", {
        block: { location: { ...cell }, dimension, typeId: remainingAfterBreak },
        brokenBlockPermutation: BlockPermutation.resolve(brokenType),
        dimension,
        player: undefined
    });

    return dimension;
}

/** The rule writes on the tick after the break, so nothing appears until the parked work has run. */
function settle(): void {
    while (scheduledTimeouts.length > 0) {
        scheduledTimeouts.shift()!.callback();
    }
}

describe("Nether Ice - the era's source block", () => {
    beforeEach(() => {
        resetMocks();
        eventBus.init();
    });

    it("turns ice broken in the Nether into flowing water on the tick after", () => {
        const cell = { x: 4, y: 60, z: 4 };
        breakBlock(NETHER, cell, "minecraft:ice");

        settle();

        assert.equal(
            nether().getBlock(cell).typeId,
            "minecraft:flowing_water",
            "the era's ice paid a water source, which is what makes the Nether's ice worth mining"
        );
    });

    it("leaves the cell to the engine when the rule does not apply", () => {
        const rows: [string, string, string, number, string][] = [
            [NETHER, "minecraft:ice", "minecraft:stone", 4, "a cell that is no longer air is not this rule's to fill"],
            [NETHER, "minecraft:netherrack", "minecraft:air", 6, "only ice pays water"],
            [OVERWORLD, "minecraft:ice", "minecraft:air", 8, "the Overworld's ice is not the era's Nether rule"]
        ];

        for (const [dimensionId, brokenType, remaining, x, why] of rows) {
            const cell = { x, y: 60, z: 8 };
            const dimension = breakBlock(dimensionId, cell, brokenType, remaining);

            settle();

            assert.equal(dimension.getBlock(cell).typeId, remaining, `${brokenType} in ${dimensionId}: ${why}`);
        }
    });
});
