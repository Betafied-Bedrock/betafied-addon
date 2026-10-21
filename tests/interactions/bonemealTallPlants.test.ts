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

interface Plant {
    location: { x: number; y: number; z: number };
    typeId: string;
}

function bonemealBlock(blockId: string, plants: Plant[] = []) {
    const fills: FillCall[] = [];
    const replanted: { location: { x: number; y: number; z: number }; block: string }[] = [];
    const remaining = [...plants];

    eventBus.dispatch("playerInteractWithBlock", {
        cancel: false,
        itemStack: { typeId: "minecraft:bone_meal" },
        block: {
            typeId: blockId,
            location: { x: 10, y: 64, z: -20 },
            dimension: {
                id: "minecraft:overworld",
                fillBlocks(volume: FillCall["volume"], block: unknown, options: FillCall["options"]) {
                    fills.push({ volume, block, options });
                    const include = options?.blockFilter?.includeTypes ?? [];
                    for (let i = remaining.length - 1; i >= 0; i--) {
                        if (include.includes(remaining[i].typeId)) remaining.splice(i, 1);
                    }
                },
                getBlocks(_volume: unknown, options: { includeTypes?: string[] }) {
                    const include = options.includeTypes ?? [];
                    const matches = remaining.filter((plant) => include.includes(plant.typeId));
                    return {
                        getBlockLocationIterator() {
                            return matches.map((plant) => plant.location)[Symbol.iterator]();
                        }
                    };
                },
                setBlockType(location: { x: number; y: number; z: number }, block: string) {
                    replanted.push({ location, block });
                }
            }
        }
    });

    const cleanup = scheduledTimeouts[scheduledTimeouts.length - 1];
    assert.ok(cleanup, "Bone meal on a grass block must schedule a deferred plant cleanup");
    cleanup.callback();

    return { fills, replanted };
}

describe("Instant bone meal - post-Beta plants", () => {
    it("sweeps the patch's two-block plants without touching the era's own flowers", () => {
        resetMocks();

        const { fills } = bonemealBlock("minecraft:grass_block");

        assert.equal(fills.length, 1, "The patch should be swept exactly once");
        assert.equal(fills[0].block, "minecraft:air");
        const cleared = fills[0].options?.blockFilter?.includeTypes ?? [];
        assert.ok(cleared.includes("minecraft:tall_grass"), "modern double-height grass must be cleared");
        assert.ok(cleared.includes("minecraft:large_fern"), "modern double-height fern must be cleared");
        assert.ok(!cleared.includes("minecraft:poppy"), "a rose is Beta-legal and must survive the sweep");
        assert.ok(!cleared.includes("minecraft:dandelion"), "a dandelion is Beta-legal and must survive the sweep");
    });

    it("turns the modern flowers bone meal leaves behind into the era's roses and dandelions", () => {
        resetMocks();

        const { replanted } = bonemealBlock("minecraft:grass_block", [
            { location: { x: 11, y: 65, z: -19 }, typeId: "minecraft:cornflower" },
            { location: { x: 8, y: 64, z: -22 }, typeId: "minecraft:azure_bluet" },
            { location: { x: 10, y: 65, z: -20 }, typeId: "minecraft:poppy" }
        ]);

        assert.deepEqual(
            replanted.map((plant) => plant.location).sort((a, b) => a.x - b.x),
            [
                { x: 8, y: 64, z: -22 },
                { x: 11, y: 65, z: -19 }
            ],
            "Every post-Beta flower in the patch is rewritten, and the poppy already in it is left alone"
        );
        for (const plant of replanted) {
            assert.ok(
                plant.block === "minecraft:poppy" || plant.block === "minecraft:dandelion",
                `${plant.block} is not one of the two flowers the era grew`
            );
        }
    });

    it("clears a two-block modern flower rather than planting a flower in each half", () => {
        resetMocks();

        const { replanted } = bonemealBlock("minecraft:grass_block", [
            { location: { x: 11, y: 64, z: -19 }, typeId: "minecraft:lilac" },
            { location: { x: 11, y: 65, z: -19 }, typeId: "minecraft:lilac" }
        ]);

        assert.deepEqual(replanted, [], "A lilac has no single-block Beta form, so both halves leave with the sweep");
    });

    it("clears the bee nest a bonemeal-grown sapling can carry", () => {
        resetMocks();

        const { fills } = bonemealBlock("minecraft:oak_sapling");

        assert.equal(fills.length, 1, "A grown sapling schedules one nest sweep");
        assert.equal(fills[0].block, "minecraft:air");
        assert.deepEqual(
            fills[0].options?.blockFilter?.includeTypes,
            ["minecraft:bee_nest"],
            "Only the nest may be cleared, never the tree that grew around it"
        );
        assert.ok(
            fills[0].volume.to.y >= 64 + 6 && fills[0].volume.from.y <= 64,
            "The sweep must run from the sapling up through the canopy"
        );
    });
});
