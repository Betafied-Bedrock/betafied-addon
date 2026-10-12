import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const recipeDir = resolve(root, "packs/BP/recipes");

/**
 * Vanilla's own identifiers and recipe types, read from Mojang's sample behavior pack
 * (github.com/Mojang/bedrock-samples, behavior_pack/recipes). A pack recipe only replaces vanilla's
 * when both the identifier and the recipe type match — anything else is registered alongside it, which
 * is how a second entry for the same grid appears in the recipe book.
 */
const VANILLA_RECIPES: Readonly<Record<string, { id: string; type: string }>> = Object.freeze({
    "chest.json": { id: "minecraft:Chest_recipeId", type: "shaped" },
    "wooden_door.json": { id: "minecraft:wooden_door", type: "shaped" },
    "iron_door.json": { id: "minecraft:iron_door", type: "shaped" },
    "oak_fence.json": { id: "minecraft:fence", type: "shaped" },
    "sandstone.json": { id: "minecraft:sandstone", type: "shaped" },
    "golden_apple.json": { id: "minecraft:golden_apple", type: "shaped" },
    "lit_pumpkin.json": { id: "minecraft:lit_pumpkin", type: "shaped" },
    "bucket.json": { id: "minecraft:bucket", type: "shaped" },
    "cake.json": { id: "minecraft:cake", type: "shaped" },
    "sign_oak.json": { id: "minecraft:sign_oak", type: "shaped" },
    "gold_nugget.json": { id: "minecraft:gold_nugget", type: "shaped" },
    "iron_nugget.json": { id: "minecraft:iron_nugget", type: "shaped" },
    "cut_sandstone.json": { id: "minecraft:smooth_sandstone", type: "shaped" },
    "crafting_table.json": { id: "minecraft:WorkBench_recipeId", type: "shaped" }
});

/** The interface tags a recipe may carry: the pack's table, or nothing at all. */
const DISABLED = "";
const BETA_TABLE = "beta_crafting";

interface Recipe {
    readonly file: string;
    readonly type: string;
    readonly id: string;
    readonly tags: readonly string[];
    readonly signature: string;
    readonly output: string;
}

function recipes(): Recipe[] {
    const found: Recipe[] = [];

    for (const file of readdirSync(recipeDir).sort()) {
        if (!file.endsWith(".json")) continue;

        const definition = JSON.parse(readFileSync(resolve(recipeDir, file), "utf-8").replace(/^\uFEFF/, ""));
        const key = Object.keys(definition).find(k => k.startsWith("minecraft:recipe_"));
        assert.ok(key, `${file} defines no recipe`);

        const recipe = definition[key];
        found.push({
            file,
            type: key.replace("minecraft:recipe_", ""),
            id: recipe.description.identifier,
            tags: recipe.tags ?? [],
            signature: signatureOf(recipe),
            output: outputOf(recipe)
        });
    }

    return found;
}

/** What a recipe consumes, so two registrations of the same craft can be spotted. */
function signatureOf(recipe: any): string {
    if (recipe.pattern) {
        const key = Object.entries(recipe.key ?? {})
            .map(([letter, ingredient]: [string, any]) => `${letter}=${ingredient.item ?? `#${ingredient.tag}`}`)
            .sort()
            .join(",");
        return `${recipe.pattern.join("/")}|${key}`;
    }
    if (recipe.ingredients) {
        return recipe.ingredients.map((i: any) => i.item ?? `#${i.tag}`).join(",");
    }
    return recipe.input?.item ?? "";
}

function outputOf(recipe: any): string {
    const output = recipe.result ?? recipe.output;
    const stacks = Array.isArray(output) ? output : [output];
    return stacks
        .map((stack: any) => typeof stack === "string" ? stack : `${stack.item}:${stack.data ?? 0}`)
        .join("+");
}

describe("Classic Recipe Contract - one crafting interface", () => {
    const all = recipes();

    it("registers the pack's recipes for the custom crafting table and nothing else", () => {
        const strays = all
            .filter(recipe => recipe.tags.includes("crafting_table"))
            .map(recipe => recipe.file);

        // The workbench is the one exception: `crafting_table` is the tag the player's 2x2 inventory
        // grid serves, and without a live workbench recipe there the pack's table could never be made
        // in survival. It carries both tags, so it is still the pack's table recipe too.
        assert.deepEqual(strays, ["crafting_table_bh.json"]);
    });

    it("keeps every other pack recipe on the custom table alone", () => {
        for (const recipe of all) {
            if (recipe.file === "crafting_table_bh.json") continue;
            // Cooking recipes belong to the furnace, campfire and smoker interfaces, not to a
            // crafting grid, so the pack's table has nothing to say about them.
            if (recipe.type !== "shaped" && recipe.type !== "shapeless") continue;

            if (recipe.tags.includes(DISABLED)) {
                assert.deepEqual(
                    recipe.tags,
                    [DISABLED],
                    `${recipe.file} suppresses a vanilla recipe, so it must offer nothing anywhere`
                );
                continue;
            }

            assert.deepEqual(
                recipe.tags,
                [BETA_TABLE],
                `${recipe.file} must be craftable at the custom crafting table only`
            );
        }
    });

    it("matches vanilla's identifier and recipe type wherever it replaces a vanilla recipe", () => {
        for (const [file, vanilla] of Object.entries(VANILLA_RECIPES)) {
            const recipe = all.find(r => r.file === file);

            assert.ok(recipe, `${file} is missing`);
            assert.equal(
                recipe.type,
                vanilla.type,
                `${file} has the wrong recipe type, so it registers beside vanilla's instead of replacing it`
            );
            assert.equal(recipe.id, vanilla.id, `${file} must carry vanilla's identifier`);
        }
    });

    it("suppresses exactly the vanilla recipes the era did not have", () => {
        const disabled = all.filter(recipe => recipe.tags.includes(DISABLED)).map(recipe => recipe.file);

        assert.deepEqual(disabled, [
            "crafting_table.json",
            "crafting_table_default.json",
            "cut_sandstone.json",
            "gold_nugget.json",
            "iron_nugget.json"
        ]);
    });

    it("registers no two recipes for the same craft on the same interface", () => {
        const seen = new Map<string, string>();

        for (const recipe of all) {
            // A furnace's three log recipes share an output and a type, so the input is what tells
            // them apart — the signature covers it for shaped and shapeless recipes alike.
            const key = `${recipe.tags.join("+")}|${recipe.output}|${recipe.signature}`;
            const previous = seen.get(key);

            assert.equal(
                previous,
                undefined,
                `${recipe.file} repeats the craft ${previous} already registers`
            );
            seen.set(key, recipe.file);
        }
    });

    it("never offers the vanilla item a pack item replaces", () => {
        // The bucket is deliberately absent: it stays the engine's own item, so a recipe handing one
        // back — the cake returns the three its milk came in — is the era's behaviour, not a leak.
        const replaced = new Set([
            "minecraft:chest", "minecraft:wooden_door", "minecraft:iron_door", "minecraft:sign",
            "minecraft:oak_sign", "minecraft:cake"
        ]);

        for (const recipe of all) {
            if (recipe.tags.includes(DISABLED)) continue;

            for (const output of recipe.output.split("+")) {
                const item = output.replace(/:\d+$/, "");
                assert.equal(
                    replaced.has(item),
                    false,
                    `${recipe.file} hands out ${item}, which the inventory sweep retypes onto a pack item`
                );
            }
        }
    });
});
