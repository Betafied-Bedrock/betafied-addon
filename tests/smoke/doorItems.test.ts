import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    BETA_DOOR_BLOCK_OF,
    BH_IRON_DOOR_ID,
    BH_WOODEN_DOOR_ID
} from "../../packs/BP/scripts/core/betaRegistry.js";

const root = process.cwd();

function readJson(path: string): any {
    return JSON.parse(readFileSync(path, "utf-8"));
}

function versionAtLeast(version: string, floor: string): boolean {
    const parts = (value: string) => value.split(".").map(Number);
    const [major, minor, patch] = parts(version);
    const [minMajor, minMinor, minPatch] = parts(floor);
    if (major !== minMajor) return major > minMajor;
    if (minor !== minMinor) return minor > minMinor;
    return patch >= minPatch;
}

const doors = [
    { file: "wooden_door", item: BH_WOODEN_DOOR_ID, block: "minecraft:wooden_door", icon: "door_wood", name: "Wooden Door" },
    { file: "iron_door", item: BH_IRON_DOOR_ID, block: "minecraft:iron_door", icon: "door_iron", name: "Iron Door" }
];

describe("Classic Item Contract - Beta 1.7.3 doors", () => {
    it("keeps an atlas entry for every door icon the items ask for", () => {
        const atlas = readJson(resolve(root, "packs/RP/textures/item_texture.json")).texture_data;

        for (const door of doors) {
            assert.ok(atlas[door.icon], `door icon '${door.icon}' is missing from item_texture.json`);
        }
    });

    for (const door of doors) {
        it(`defines ${door.item} as an unstackable placer for ${door.block}`, () => {
            const definition = readJson(resolve(root, "packs/BP/items", `${door.file}.json`));
            const item = definition["minecraft:item"];

            assert.equal(item.description.identifier, door.item);
            assert.equal(
                item.components["minecraft:max_stack_size"],
                1,
                "Beta's ItemDoor set its own stack size to one, which is what keeps a door out of a stack in a chest"
            );
            assert.equal(
                item.components["minecraft:block_placer"].block,
                door.block,
                "the item has to place the vanilla door block"
            );
            assert.equal(
                BETA_DOOR_BLOCK_OF[door.item],
                door.block,
                "the script registry and the item JSON must name the same block"
            );
            assert.equal(item.components["minecraft:icon"].textures.default, door.icon);
            assert.ok(
                versionAtLeast(definition.format_version, "1.21.50"),
                `minecraft:block_placer needs format_version 1.21.50 or later, got ${definition.format_version}`
            );
        });

        it(`names ${door.item} in the language file`, () => {
            const raw = readFileSync(resolve(root, "packs/RP/texts/en_US.lang"), "utf-8");
            assert.ok(
                raw.includes(`item.${door.item}=${door.name}`),
                `en_US.lang is missing item.${door.item}`
            );
        });

        it(`crafts ${door.item} on the custom crafting table, one door at a time`, () => {
            const recipe = readJson(resolve(root, "packs/BP/recipes", `${door.file}.json`))["minecraft:recipe_shaped"];

            assert.equal(recipe.result.item, door.item);
            assert.equal(recipe.result.count, 1, "Beta crafted a single door from six planks or ingots");
            assert.equal(
                recipe.description.identifier,
                door.block,
                "the recipe must override vanilla's door recipe rather than sit beside it"
            );
            assert.deepEqual(
                recipe.tags,
                ["beta_crafting"],
                "the custom crafting table is the only interface the pack's recipes belong to"
            );
        });
    }
});
