import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
    BETA_CAPPED_ITEM_IDS,
    BETA_CAPPED_ITEM_OF,
    BETA_ITEM_IDS,
    BH_BUCKET_ID,
    BH_CAKE_ID,
    BH_IRON_DOOR_ID,
    BH_SIGN_ID,
    BH_WOODEN_DOOR_ID
} from "../../packs/BP/scripts/core/betaRegistry.js";

const root = process.cwd();

function readJson(path: string): any {
    // One legacy recipe still carries an editor's byte-order mark; JSON.parse refuses it.
    return JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, ""));
}

function versionAtLeast(version: string, floor: string): boolean {
    const parts = (value: string) => value.split(".").map(Number);
    const [major, minor, patch] = parts(version);
    const [minMajor, minMinor, minPatch] = parts(floor);
    if (major !== minMajor) return major > minMajor;
    if (minor !== minMinor) return minor > minMinor;
    return patch >= minPatch;
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

const capped = [
    { item: BH_SIGN_ID, icon: "sign", name: "Sign", recipe: "sign_oak", vanilla: "minecraft:sign_oak" },
    { item: BH_BUCKET_ID, icon: "bucket_empty", name: "Bucket", recipe: "bucket", vanilla: "minecraft:bucket" },
    { item: BH_CAKE_ID, icon: "cake", name: "Cake", recipe: "cake", vanilla: "minecraft:cake" }
];

describe("Classic Item Contract - Beta 1.7.3 unstackable utilities", () => {
    it("keeps the era's unstackables and nothing else in the capped table", () => {
        assert.deepEqual(BETA_CAPPED_ITEM_OF, {
            "minecraft:wooden_door": BH_WOODEN_DOOR_ID,
            "minecraft:iron_door": BH_IRON_DOOR_ID,
            "minecraft:oak_sign": BH_SIGN_ID,
            "minecraft:bucket": BH_BUCKET_ID,
            "minecraft:cake": BH_CAKE_ID
        });
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

    for (const entry of capped) {
        it(`declares ${entry.item} as one item per slot`, () => {
            const item = declaredItems().get(entry.item)!;

            assert.equal(item.components["minecraft:max_stack_size"], 1);
            assert.equal(item.components["minecraft:icon"].textures.default, entry.icon);
            assert.ok(
                BETA_ITEM_IDS.has(entry.item),
                "a capped item that is not a Beta item would be stripped by the modern-item gate"
            );
        });

        it(`keeps an atlas entry for the ${entry.icon} icon`, () => {
            const atlas = readJson(resolve(root, "packs/RP/textures/item_texture.json")).texture_data;
            assert.ok(atlas[entry.icon], `'${entry.icon}' is missing from item_texture.json`);
        });

        it(`names ${entry.item} in the language file`, () => {
            const raw = readFileSync(resolve(root, "packs/RP/texts/en_US.lang"), "utf-8");
            assert.ok(raw.includes(`item.${entry.item}=${entry.name}`), `en_US.lang is missing item.${entry.item}`);
        });

        it(`crafts ${entry.item} rather than the vanilla stack`, () => {
            const recipe = readJson(resolve(root, "packs/BP/recipes", `${entry.recipe}.json`))["minecraft:recipe_shaped"];
            const results = recipeResults(recipe);

            assert.equal(results[0], entry.item);
            assert.equal(
                recipe.description.identifier,
                entry.vanilla,
                "the recipe has to take vanilla's own id, or its version stays craftable beside it"
            );
            assert.deepEqual(
                recipe.tags,
                ["beta_crafting"],
                "the custom crafting table is the only interface the pack's recipes belong to"
            );
        });
    }

    it("places the cake and nothing else, since the sign and the bucket are scripted", () => {
        const items = declaredItems();

        assert.equal(items.get(BH_CAKE_ID)!.components["minecraft:block_placer"].block, "minecraft:cake");
        assert.equal(
            items.get(BH_SIGN_ID)!.components["minecraft:block_placer"],
            undefined,
            "a single-block placer cannot hang a wall sign, so signPlacement owns both blocks"
        );
        assert.equal(
            items.get(BH_BUCKET_ID)!.components["minecraft:block_placer"],
            undefined,
            "the empty bucket places nothing; it is filled from a source block"
        );

        assert.ok(
            versionAtLeast(readJson(resolve(root, "packs/BP/items/cake.json")).format_version, "1.21.50"),
            "minecraft:block_placer needs format_version 1.21.50 or later"
        );
    });

    it("hands back the pack's bucket as the cake's empty containers", () => {
        const recipe = readJson(resolve(root, "packs/BP/recipes/cake.json"))["minecraft:recipe_shaped"];
        const results = recipe.result.map((entry: any) => entry.item);

        assert.deepEqual(results, [BH_CAKE_ID, BH_BUCKET_ID]);
        assert.equal(recipe.result[1].count, 3, "three milk buckets go into a cake");
    });

    it("never crafts a vanilla door, sign, bucket or cake", () => {
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
