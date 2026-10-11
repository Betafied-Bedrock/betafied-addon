import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    planSlabStack,
    DOUBLE_SLAB_OF
} from "../../packs/BP/scripts/interactions/slabStacking.js";

const PLACED = { x: 3, y: 64, z: -2 };

describe("Slab Stacking Plan - Beta 1.7.3 doubles two slabs into one cube", () => {
    it("doubles the lower cell when a slab lands on top of another", () => {
        // The usual click: the half below is already there, the new one takes the cell above it.
        assert.deepEqual(planSlabStack(PLACED, "bh:stone_slab", undefined, "bh:stone_slab"), {
            double: { x: 3, y: 63, z: -2 },
            consumed: { x: 3, y: 64, z: -2 }
        });
    });

    it("doubles the placed cell when a slab lands beneath an existing half", () => {
        assert.deepEqual(planSlabStack(PLACED, "bh:wooden_slab", "bh:wooden_slab", undefined), {
            double: { x: 3, y: 64, z: -2 },
            consumed: { x: 3, y: 65, z: -2 }
        });
    });

    it("takes the lower cell when halves sit on both sides", () => {
        assert.deepEqual(planSlabStack(PLACED, "bh:cobblestone_slab", "bh:cobblestone_slab", "bh:cobblestone_slab"), {
            double: { x: 3, y: 63, z: -2 },
            consumed: { x: 3, y: 64, z: -2 }
        });
    });

    it("merges nothing with an empty column or a different block", () => {
        assert.equal(planSlabStack(PLACED, "bh:stone_slab", undefined, undefined), undefined);
        assert.equal(planSlabStack(PLACED, "bh:stone_slab", "minecraft:stone", "minecraft:dirt"), undefined);
    });

    it("never merges across slab materials", () => {
        assert.equal(planSlabStack(PLACED, "bh:stone_slab", undefined, "bh:cobblestone_slab"), undefined);
        assert.equal(planSlabStack(PLACED, "bh:wooden_slab", "bh:sandstone_slab", undefined), undefined);
    });

    it("leaves an already-doubled block alone", () => {
        // A full block is not a half, so a third slab on top of a merged pair stays a slab.
        assert.equal(planSlabStack(PLACED, "bh:stone_slab", undefined, "bh:double_stone_slab"), undefined);
        assert.equal(planSlabStack(PLACED, "bh:stone_slab", "bh:double_stone_slab", undefined), undefined);
    });

    it("maps every single slab the pack ships to its own full block", () => {
        assert.deepEqual(DOUBLE_SLAB_OF, {
            "bh:wooden_slab": "bh:double_wooden_slab",
            "bh:cobblestone_slab": "bh:double_cobblestone_slab",
            "bh:sandstone_slab": "bh:double_sandstone_slab",
            "bh:stone_slab": "bh:double_stone_slab"
        });
    });
});
