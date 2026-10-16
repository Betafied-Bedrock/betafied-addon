import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
    BETA_CAPPED_ITEM_IDS,
    BETA_CAPPED_ITEM_OF,
    BETA_CAPPED_VANILLA_IDS,
    BETA_ITEM_IDS,
    BH_CAKE_ID
} from "../../packs/BP/scripts/policy/betaRegistry.js";
import { versionAtLeast } from "../support/text.js";

const root = process.cwd();

function readJson(path: string): any {
    // One legacy recipe still carries an editor's byte-order mark; JSON.parse refuses it.
    return JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, ""));
}

/** A shaped or shapeless recipe yields one stack or a list of them. */
function recipeResults(recipe: any): string[] {
    const results = Array.isArray(recipe.result) ? recipe.result : [recipe.result];
    return results.map((result: any) => result.item);
}

/** Every item the pack defines, keyed by the id it declares. */
function declaredItems(): Map<string, any> {
    const items = new Map<string, any>();

    for (const file of readdirSync(resolve(root, "packs/BP/items"))) {
        if (!file.endsWith(".json")) continue;
        const item = readJson(resolve(root, "packs/BP/items", file))["minecraft:item"];
        items.set(item.description.identifier, item);
    }
    return items;
}

const CAKE = {
    item: BH_CAKE_ID,
    icon: "cake",
    name: "Cake",
    recipe: "cake",
    vanilla: "minecraft:cake"
} as const;

describe("Classic Item Contract - Beta 1.7.3 unstackable utilities", () => {
    it("leaves the era's capped vanilla bucket to the engine and holds its stack in the sweep", () => {
        // A bucket is the one capped item whose use is a fluid, so the engine's own item is the only one
        // that fills from a source block; the pack cannot own it, and the cap is the sweep's to keep.
        assert.equal(declaredItems().has("bh:bucket"), false, "the pack's own bucket item is gone");
        assert.equal(declaredItems().has("bh:oak_sign"), false, "the pack's own sign item is gone");
        assert.equal(
            existsSync(resolve(root, "packs/BP/scripts/interactions/bucketUse.ts")),
            false,
            "the engine's own bucket fills from a source block, so the script that reimplemented it is gone"
        );
        assert.equal(
            existsSync(resolve(root, "packs/BP/scripts/interactions/signPlacement.ts")),
            false,
            "the engine's own sign places on floor and wall and opens the editor, so the script that reimplemented it is gone"
        );

        assert.ok(BETA_ITEM_IDS.has("minecraft:bucket"), "a vanilla bucket would be stripped if the registry dropped it");

        const claimed = Object.values(BETA_CAPPED_ITEM_OF).filter((id) => BETA_CAPPED_VANILLA_IDS.has(id));
        assert.deepEqual(
            claimed,
            [],
            "each of these is the engine's own item, so the pack must not claim it with a replacement"
        );
    });

    it("gives every capped id a pack item, because the engine only respects a cap it can read", () => {
        const items = declaredItems();

        for (const id of BETA_CAPPED_ITEM_IDS) {
            const item = items.get(id);
            assert.ok(item, `${id} has no item JSON, so a pickup of it would be thrown away`);
            assert.equal(
                item.components["minecraft:max_stack_size"],
                1,
                `Beta's Item.setMaxStackSize(1) is what keeps ${id} out of a stack in a chest`
            );
            assert.ok(
                item.components["minecraft:icon"],
                `${id} needs an icon or it renders as a missing texture`
            );
        }
    });

    it("ships the cake as the pack's own item, crafted in place of vanilla's", () => {
        const item = declaredItems().get(CAKE.item)!;

        assert.equal(
            item.components["minecraft:block_placer"].block,
            CAKE.item,
            "the cake places the pack's block, whose bites the engine cannot drive for a placer"
        );
        // format_version sits on the item file, not inside its "minecraft:item" object.
        assert.ok(
            versionAtLeast(readJson(resolve(root, "packs/BP/items/cake.json")).format_version, "1.21.50"),
            "minecraft:block_placer needs format_version 1.21.50 or later"
        );

        const atlas = readJson(resolve(root, "packs/RP/textures/item_texture.json")).texture_data;
        assert.ok(atlas[CAKE.icon], `'${CAKE.icon}' is missing from item_texture.json`);

        const raw = readFileSync(resolve(root, "packs/RP/texts/en_US.lang"), "utf-8");
        assert.ok(raw.includes(`item.${CAKE.item}=${CAKE.name}`), `en_US.lang is missing item.${CAKE.item}`);

        const recipe = readJson(resolve(root, "packs/BP/recipes", `${CAKE.recipe}.json`))["minecraft:recipe_shaped"];
        assert.equal(recipeResults(recipe)[0], CAKE.item);
        assert.equal(
            recipe.description.identifier,
            CAKE.vanilla,
            "the recipe has to take vanilla's own id, or its version stays craftable beside it"
        );
        assert.deepEqual(
            recipe.tags,
            ["beta_crafting"],
            "the custom crafting table is the only interface the pack's recipes belong to"
        );

        const results = recipe.result.map((entry: any) => entry.item);
        assert.deepEqual(results, [CAKE.item, "minecraft:bucket"], "the cake gives the buckets back as the engine's own");
        assert.equal(recipe.result[1].count, 3, "three milk buckets go into a cake");
        assert.deepEqual(
            recipe.key.A,
            { item: "minecraft:milk_bucket" },            "the cake takes the milk the engine's own bucket draws from a cow"
        );
    });

    it("never crafts a vanilla door, sign or cake", () => {
        const vanillaResults = new Set(Object.keys(BETA_CAPPED_ITEM_OF));

        for (const file of readdirSync(resolve(root, "packs/BP/recipes"))) {
            if (!file.endsWith(".json")) continue;
            const definition = readJson(resolve(root, "packs/BP/recipes", file));
            const recipe = definition["minecraft:recipe_shaped"] ?? definition["minecraft:recipe_shapeless"];
            if (!recipe) continue;

            for (const result of recipeResults(recipe)) {
                assert.equal(
                    vanillaResults.has(result),
                    false,
                    `${file} yields ${result}, a stack the engine would let sit in a chest`
                );
            }
        }
    });
});
