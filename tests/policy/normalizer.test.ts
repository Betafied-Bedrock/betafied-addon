import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    normalizeItem,
    normalizeBlock,
    normalizeEntityDrop,
    resolveHeldItem,
    resolvePlacerTarget
} from "../../packs/BP/scripts/policy/normalizer.js";

describe("Heuristic Inverse Normalizer", () => {
    describe("Item Normalization", () => {
        it("keeps authentic Beta items unchanged", () => {
            const betaItems = ["minecraft:iron_sword", "minecraft:bread"];
            for (const item of betaItems) {
                assert.deepEqual(normalizeItem(item), { action: "keep" });
            }
        });

        it("leaves third-party namespace content untouched", () => {
            // Both paths name something the heuristics would otherwise convert or delete, so the
            // namespace is the only thing that can spare them.
            const modded = ["gun:deepslate", "techmod:rotten_flesh"];
            for (const item of modded) {
                assert.deepEqual(normalizeItem(item), { action: "keep" }, `Expected ${item} to be left to its own addon`);
            }
        });

        it("keeps the era's reed item under the id this engine gives it", () => {
            // The era's plant arrived under one id in Beta and is split across two here: the block is
            // `minecraft:reeds`, the item a broken cane pays is `minecraft:sugar_cane`. Folding the
            // item onto the block id changed the id the drop is carried as, into one the engine does
            // not build an ItemStack for, and the drop died with the entity holding it.
            assert.deepEqual(normalizeItem("minecraft:sugar_cane"), { action: "keep" });
            assert.deepEqual(normalizeEntityDrop("minecraft:sugar_cane"), { action: "keep" });
        });

        it("converts modern wood items to authentic oak equivalents via pattern heuristics", () => {
            assert.deepEqual(normalizeItem("minecraft:cherry_planks"), { action: "convert", targetId: "minecraft:oak_planks" });

            // The stripped prefix and the Nether's _stem suffix are the two spellings the suffix rule
            // has to reach beyond a bare species name.
            assert.deepEqual(normalizeItem("minecraft:stripped_mangrove_log"), { action: "convert", targetId: "minecraft:oak_log" });
            assert.deepEqual(normalizeItem("minecraft:crimson_stem"), { action: "convert", targetId: "minecraft:oak_log" });

            assert.deepEqual(normalizeItem("minecraft:cherry_door"), { action: "convert", targetId: "bh:wooden_door" });
            assert.deepEqual(normalizeItem("minecraft:crimson_trapdoor"), { action: "convert", targetId: "minecraft:trapdoor" });
            assert.deepEqual(normalizeItem("minecraft:bamboo_fence"), { action: "convert", targetId: "bh:fence" });

            // Beta cut one sign from any of its three woods and hung signs separately, so every modern
            // species lands on the era's single oak sign rather than a species of its own.
            assert.deepEqual(normalizeItem("minecraft:cherry_sign"), { action: "convert", targetId: "minecraft:oak_sign" });
        });

        it("sends every placer the era capped at one onto its pack item", () => {
            assert.deepEqual(resolvePlacerTarget("minecraft:cake"), { action: "convert", targetId: "bh:cake" });
            assert.deepEqual(resolvePlacerTarget("minecraft:iron_door"), { action: "convert", targetId: "bh:iron_door" });
            assert.equal(
                resolveHeldItem("minecraft:bucket"),
                undefined,
                "the engine's own bucket is already the era's item, so nothing retypes it"
            );
        });

        it("converts modern stone, deepslate, and copper variants", () => {
            assert.deepEqual(normalizeItem("minecraft:andesite"), { action: "convert", targetId: "minecraft:stone" });
            assert.deepEqual(normalizeItem("minecraft:cobbled_deepslate"), { action: "convert", targetId: "minecraft:cobblestone" });
            assert.deepEqual(normalizeItem("minecraft:copper_ingot"), { action: "convert", targetId: "minecraft:cobblestone" });

            // Raw copper has to answer with the same cobblestone target on both paths, or a mined
            // ore and a held one land on different blocks.
            assert.deepEqual(normalizeItem("minecraft:raw_copper"), { action: "convert", targetId: "minecraft:cobblestone" });
            assert.deepEqual(normalizeEntityDrop("minecraft:raw_copper"), { action: "convert", targetId: "minecraft:cobblestone" });
        });

        it("removes unconvertible modern items that have no authentic counterpart", () => {
            const junk = ["minecraft:netherite_sword"];
            for (const item of junk) {
                assert.deepEqual(normalizeItem(item), { action: "remove" });
            }
        });
    });

    describe("Block Normalization", () => {
        it("keeps authentic Beta blocks, and anything another addon shipped", () => {
            assert.deepEqual(normalizeBlock("minecraft:stone"), { action: "keep" });
            // The era's plant carries a different id on this engine, so it is the block the allowlist
            // is most likely to miss.
            assert.deepEqual(normalizeBlock("minecraft:reeds"), { action: "keep" });
            assert.deepEqual(normalizeBlock("techmod:deepslate"), { action: "keep" });
        });

        it("strips the Nether's modern blocks and ores back to Beta terrain", () => {
            // Vanilla ties these ores to the `nether` tag our single biome carries, so Beta 1.7.3's
            // ore-free Nether needs them dissolved rather than left in the rock.
            assert.deepEqual(normalizeBlock("minecraft:quartz_ore"), { action: "convert", targetId: "minecraft:netherrack" });

            // Modern Nether terrain has neither a Beta counterpart nor a biome left to generate it.
            assert.deepEqual(normalizeBlock("minecraft:basalt"), { action: "remove" });
        });

        it("removes every vanilla block with no authentic counterpart (inverse allowlist)", () => {
            assert.deepEqual(normalizeBlock("minecraft:bee_nest"), { action: "remove" });
        });
    });

    describe("Entity Drop Normalization", () => {
        it("converts raw ore item drops back to authentic mined ore blocks", () => {
            assert.deepEqual(normalizeEntityDrop("minecraft:raw_iron"), { action: "convert", targetId: "minecraft:iron_ore" });
        });

        it("removes post-Beta monster and animal drops", () => {
            assert.deepEqual(normalizeEntityDrop("minecraft:rotten_flesh"), { action: "remove" });
        });

        it("never rewrites drops owned by another addon", () => {
            assert.deepEqual(normalizeEntityDrop("gun:bullet"), { action: "keep" });
            assert.deepEqual(normalizeEntityDrop("techmod:raw_iron"), { action: "keep" });
        });
    });
});
