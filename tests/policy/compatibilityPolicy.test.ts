import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    BLOCK_BULK_REPLACEMENTS,
    BLOCK_FINE_REPLACEMENTS
} from "../../packs/BP/scripts/core/compatibilityPolicy.js";
import { normalizeItem } from "../../packs/BP/scripts/core/normalizer.js";
import { sanitizeWorldEntity } from "../../packs/BP/scripts/mobs/entitySpawnHandler.js";
import { BETA_BLOCK_IDS } from "../../packs/BP/scripts/core/betaRegistry.js";

/**
 * These cases describe the behaviour the game actually has. Every assertion goes through the same
 * function the subsystem calls, so a conversion named here is a conversion the player sees — the
 * older version of this file asserted a private table that production never read.
 */

function converted(itemId: string): string | undefined {
    const result = normalizeItem(itemId);
    return result.action === "convert" ? result.targetId : undefined;
}

describe("World block replacement policy", () => {
    it("never scrubs a block that is already authentic Beta terrain", () => {
        // A Beta id in the key column would delete real 1.7.3 terrain, which is the one outcome the
        // scrubber must never produce.
        const alreadyBeta = BLOCK_BULK_REPLACEMENTS
            .map(([modern]) => modern)
            .filter(modern => BETA_BLOCK_IDS.has(modern));

        assert.deepEqual(alreadyBeta, [], `these are authentic Beta blocks and must not be replaced: ${alreadyBeta.join(", ")}`);
    });

    it("repaints modern terrain onto a Beta material instead of leaving ore-shaped holes", () => {
        const bulkMap = new Map(BLOCK_BULK_REPLACEMENTS);

        assert.equal(bulkMap.get("minecraft:deepslate"), "minecraft:stone");
        assert.equal(bulkMap.get("minecraft:cobbled_deepslate"), "minecraft:cobblestone");

        // Emerald arrived in 1.3 and copper in 1.17. Both still generate on modern terrain, so the
        // scrubber has to repaint them; mapping them to air would leave cavities where the vein was
        // carried by rock the player can see through.
        assert.equal(bulkMap.get("minecraft:emerald_ore"), "minecraft:stone");
        assert.equal(bulkMap.get("minecraft:deepslate_emerald_ore"), "minecraft:stone");
        assert.equal(bulkMap.get("minecraft:copper_ore"), "minecraft:stone");
        assert.equal(bulkMap.get("minecraft:deepslate_copper_ore"), "minecraft:stone");
    });

    it("dissolves the Nether's ores but lets the biome own its terrain", () => {
        const bulkMap = new Map(BLOCK_BULK_REPLACEMENTS);

        assert.equal(bulkMap.get("minecraft:quartz_ore"), "minecraft:netherrack");
        assert.equal(bulkMap.get("minecraft:nether_gold_ore"), "minecraft:netherrack");
        assert.equal(bulkMap.get("minecraft:ancient_debris"), "minecraft:netherrack");

        // Modern Nether terrain is owned by the biome override, not repainted block-by-block, and the
        // magma shores become the era's gravel beaches.
        assert.equal(bulkMap.get("minecraft:blackstone"), undefined);
        assert.equal(bulkMap.get("minecraft:basalt"), undefined);
        assert.equal(normalizeItem("minecraft:blackstone").action, "remove");
        assert.equal(bulkMap.get("minecraft:magma"), "minecraft:gravel");
    });

    it("gives full-cube modern blocks a Beta stand-in and clears modern vegetation", () => {
        // The resource pack stopped masking these, so the fine pass is what turns them into a Beta
        // material and what takes the modern plants out of the world.
        assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:sculk"], "minecraft:stone");
        assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:beacon"], "minecraft:obsidian");
        assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:sea_lantern"], "minecraft:glowstone");
        assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:stonecutter_block"], "minecraft:stone");

        assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:tall_grass"], "minecraft:air");
        assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:seagrass"], "minecraft:water");
        assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:azalea_leaves"], "minecraft:leaves");
    });
});

describe("Inventory normalization agrees with the world tables where it should", () => {
    it("converts modern stone and copper items into Beta materials", () => {
        assert.equal(converted("minecraft:andesite"), "minecraft:stone");
        assert.equal(converted("minecraft:deepslate"), "minecraft:stone");
        assert.equal(converted("minecraft:cobbled_deepslate"), "minecraft:cobblestone");
        assert.equal(converted("minecraft:copper_ingot"), "minecraft:cobblestone");
        assert.equal(converted("minecraft:copper_stairs"), "minecraft:cobblestone_stairs");
    });

    it("converts modern woods, doors, fences and slabs to beta equivalents", () => {
        assert.equal(converted("minecraft:cherry_fence"), "bh:fence");
        assert.equal(converted("minecraft:cherry_slab"), "bh:wooden_slab");
        assert.equal(converted("minecraft:mangrove_door"), "bh:wooden_door");
        assert.equal(converted("minecraft:birch_boat"), "minecraft:boat");
    });

    it("keeps the world/inventory split the tables rely on, including which ids count as authentic Beta", () => {
        const bulkMap = new Map(BLOCK_BULK_REPLACEMENTS);

        // Tuff is cave-wall noise in terrain and a building block in a hotbar.
        assert.equal(bulkMap.get("minecraft:tuff"), "minecraft:gravel");
        assert.equal(converted("minecraft:tuff"), "minecraft:stone");

        // Raw copper stays solid rock underground but is cobblestone in the inventory.
        assert.equal(bulkMap.get("minecraft:raw_copper_block"), "minecraft:stone");
        assert.equal(converted("minecraft:raw_copper_block"), "minecraft:cobblestone");

        // Beta 1.7.3 shipped oak fences and wooden slabs, so this layer calls both authentic — it is
        // answering which ids may exist in the world. A *held* item does not reach this function
        // alone: `inventoryManager` consults the placer table first, which is what moves a held oak
        // fence onto bh:fence. tests/policy/inventoryManager.test.ts pins that player-visible result.
        assert.equal(normalizeItem("minecraft:oak_fence").action, "keep");
        assert.equal(normalizeItem("minecraft:oak_slab").action, "keep");
    });
});

/**
 * A stub stands in for the engine entity: the admission rule reads only `typeId`, `hasTag` and
 * `isValid`, so the assertion is on the shipped handler's own decision rather than on a table.
 */
function stubEntity(typeId: string): { typeId: string; isValid: boolean; hasTag: () => boolean; remove: () => void } {
    const entity = {
        typeId,
        isValid: true,
        hasTag: (): boolean => false,
        remove: (): void => {
            entity.isValid = false;
        }
    };
    return entity;
}

describe("World entity admission", () => {
    it("removes the vanilla mobs the era never had and keeps the creatures it shipped", () => {
        const admission: ReadonlyArray<readonly [string, boolean]> = [
            ["minecraft:villager", false],
            ["minecraft:warden", false],
            ["minecraft:breeze", false],
            ["minecraft:pig", true],
            ["minecraft:zombie_pigman", true],
            ["minecraft:boat", true]
        ];

        for (const [typeId, keeps] of admission) {
            const entity = stubEntity(typeId);
            sanitizeWorldEntity(entity as never);
            assert.equal(entity.isValid, keeps, `${typeId} must be ${keeps ? "left alone" : "removed from the world"}`);
        }
    });

    it("trusts entities owned by another namespace", () => {
        const entity = stubEntity("gun:turret");
        sanitizeWorldEntity(entity as never);
        assert.equal(entity.isValid, true, "an addon entity is its own namespace's business");
    });
});
