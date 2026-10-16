import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { resetMocks, scheduledTimeouts } from "../mocks/minecraftServer.js";
import "../../packs/BP/scripts/interactions/instantBonemeal.js";

interface FillCall {
    volume: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } };
    block: unknown;
    options: { blockFilter?: { includeTypes?: string[] } } | undefined;
}

function interactWithGrassBlock(): FillCall[] {
    const fills: FillCall[] = [];

    eventBus.dispatch("playerInteractWithBlock", {
        cancel: false,
        itemStack: { typeId: "minecraft:bone_meal" },
        block: {
            typeId: "minecraft:grass_block",
            location: { x: 10, y: 64, z: -20 },
            dimension: {
                id: "minecraft:overworld",
                fillBlocks(volume: FillCall["volume"], block: unknown, options: FillCall["options"]) {
                    fills.push({ volume, block, options });
                }
            }
        }
    });

    const cleanup = scheduledTimeouts[scheduledTimeouts.length - 1];
    assert.ok(cleanup, "Bone meal on a grass block must schedule a deferred plant cleanup");
    cleanup.callback();

    return fills;
}

describe("Instant bone meal - post-Beta tall plants", () => {
    it("sweeps double-height grass and fern out of the bone meal patch", () => {
        resetMocks();

        const fills = interactWithGrassBlock();

        assert.equal(fills.length, 1, "The patch should be swept exactly once");
        assert.equal(fills[0].block, "minecraft:air");
        assert.deepEqual(
            fills[0].options?.blockFilter?.includeTypes,
            ["minecraft:tall_grass", "minecraft:large_fern"],
            "Only the two-block grasses may be cleared, never Beta-legal plants"
        );
    });
});
