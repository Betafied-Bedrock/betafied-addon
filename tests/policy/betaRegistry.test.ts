import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    BETA_BLOCK_IDS,
    BETA_ENTITY_TYPES,
    BETA_HOSTILE_TYPES,
    BETA_PASSIVE_TYPES,
    POST_BETA_WOOD_SPECIES,
    TERRAIN_PLANK_SPECIES,
    WOOL_BY_COLOR,
    isBetaBlock,
    isBetaEntity,
    isBetaItem,
    isModItem,
    isVanillaId
} from "../../packs/BP/scripts/core/betaRegistry.js";

describe("Canonical Beta 1.7.3 Registry Policy", () => {
    describe("Entity Registry", () => {
        it("disallows post-Beta 1.7.3 modern mobs", () => {
            const modern = [
                "minecraft:warden",
                // An era mob the pack ships under `bh:`, and the traded-away villager: both have to be
                // rejected under their vanilla ids.
                "minecraft:enderman",
                "minecraft:villager"
            ];
            for (const id of modern) {
                assert.equal(isBetaEntity(id), false, `Expected ${id} to be rejected as post-Beta`);
            }
        });
    });

    describe("Item Registry", () => {
        it("disallows modern post-Beta items", () => {
            const modern = [
                "minecraft:netherite_sword",
                "minecraft:elytra",
                // Banned as an item even though the ore it comes from is a conversion target.
                "minecraft:raw_iron"
            ];
            for (const id of modern) {
                assert.equal(isBetaItem(id), false, `Expected ${id} to be rejected as post-Beta item`);
            }
        });
    });

    describe("Addon-Owned Content", () => {
        it("trusts every item the mod itself defines, even when it is not a vanilla Beta id", () => {
            // The mod replaces the vanilla workbench with bh:crafting_table; the gatekeeper
            // must not delete the addon's own blocks or items.
            const addonContent = ["bh:crafting_table", "ubd:furnace_minecart"];
            for (const id of addonContent) {
                assert.ok(isModItem(id), `Expected ${id} to belong to a mod namespace`);
                assert.ok(isBetaItem(id), `Expected ${id} to be allowed through the item gatekeeper`);
            }
        });

        it("scopes destructive policies to the vanilla namespace, and mod content out of it", () => {
            assert.equal(isVanillaId("minecraft:stone"), true);
            assert.equal(isVanillaId("gun:1911"), false);
            // An id with no namespace at all belongs to nobody, so no gate may claim it.
            assert.equal(isVanillaId("crafting_table"), false);

            assert.equal(isModItem("minecraft:stone"), false);
            assert.equal(isModItem("crafting_table"), false);
        });

        it("allows the era's ids that modern Minecraft split in two", () => {
            // Beta's map and its fish each reach this engine as two ids; the gatekeeper has to let
            // both through or the map and food tables never see them.
            assert.ok(isBetaItem("minecraft:empty_map"));
            assert.ok(isBetaItem("minecraft:filled_map"));
            assert.ok(isBetaItem("minecraft:fish"));
            assert.ok(isBetaItem("minecraft:cooked_fish"));
        });
    });

    describe("Derived-set invariants", () => {
        it("keeps every derived set inside the allowlist it has to answer to", () => {
            // The palette drives both the shearing drop and the sword bonus; if it is ever unhooked
            // from the allowlist, a coloured wool becomes an "unsupported" block overnight.
            for (const wool of WOOL_BY_COLOR) {
                assert.ok(BETA_BLOCK_IDS.has(wool), `palette wool ${wool} must be an authentic block`);
            }

            for (const id of [...BETA_PASSIVE_TYPES, ...BETA_HOSTILE_TYPES]) {
                assert.ok(BETA_ENTITY_TYPES.has(id), `${id} must be an allowed Beta entity`);
            }

            for (const species of TERRAIN_PLANK_SPECIES) {
                assert.ok(POST_BETA_WOOD_SPECIES.has(species), `${species} must be a post-Beta species`);
            }
        });
    });

    describe("Block Registry", () => {
        it("disallows modern post-Beta blocks", () => {
            const modern = [
                "minecraft:deepslate",
                "minecraft:mangrove_planks",
                "minecraft:sculk"
            ];
            for (const id of modern) {
                assert.equal(isBetaBlock(id), false, `Expected ${id} to be rejected as post-Beta block`);
            }
        });
    });
});
