import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SWORD_FAST_BLOCKS } from "../../packs/BP/scripts/interactions/toolMining.js";

const root = process.cwd();

const STAIRS = ["oak_stairs", "cobblestone_stairs"];
const SLABS = ["wooden_slab", "cobblestone_slab", "sandstone_slab", "stone_slab"];
const LOGS = ["oak_log", "birch_log", "spruce_log"];

function readJson(path: string): any {
    return JSON.parse(readFileSync(path, "utf-8"));
}

function blockOf(name: string): any {
    const path = resolve(root, "packs/BP/blocks", `${name}.json`);
    assert.ok(existsSync(path), `packs/BP/blocks/${name}.json must exist`);
    return readJson(path)["minecraft:block"];
}

function texturesOf(block: any): string[] {
    return Object.values(block.components["minecraft:material_instances"])
        .map((instance: any) => instance.texture);
}

describe("Classic Block Contract - Beta 1.7.3 logs, stairs and slabs", () => {
    it("places stairs as a flat step with no vertical half, and drops its source material", () => {
        // Beta's stairs were the one block that did not drop themselves: breaking a wooden stair
        // handed back a plank, which is why a mis-placed stair cost a quarter of the stack.
        const drops: Record<string, string> = {
            oak_stairs: "minecraft:oak_planks",
            cobblestone_stairs: "minecraft:cobblestone"
        };

        for (const name of STAIRS) {
            const block = blockOf(name);
            const traits = block.description.traits;

            assert.deepEqual(
                traits["minecraft:placement_direction"].enabled_states,
                ["minecraft:cardinal_direction"],
                `${name} must only record the player's horizontal direction`
            );
            // Beta 1.7.3 had no upside-down stairs, so no vertical_half state may exist.
            assert.equal(traits["minecraft:placement_position"], undefined, `${name} must not enable vertical_half`);

            // The cardinal rotations move the collision box with the model, so the box is declared
            // once in its default (south facing) orientation: a lower step plus a back quarter.
            assert.deepEqual(
                block.components["minecraft:collision_box"],
                [
                    { origin: [-8, 0, -8], size: [16, 8, 16] },
                    { origin: [-8, 8, 0], size: [16, 8, 8] }
                ],
                `${name} must collide as a lower step plus an upper back quarter`
            );

            const pools = readJson(resolve(root, "packs/BP", block.components["minecraft:loot"])).pools;
            assert.deepEqual(
                pools[0].entries.map((entry: any) => entry.name),
                [drops[name]],
                `${name} must drop its source material`
            );
        }
    });

    it("keeps slabs flat on the ground with nothing to rotate them", () => {
        for (const name of SLABS) {
            const block = blockOf(name);

            // Beta slabs only ever sat in the bottom half, so the block needs no half state,
            // no placement trait and no transformation at all.
            assert.equal(block.description.traits, undefined, `${name} must not enable placement traits`);
            assert.equal(block.description.states, undefined, `${name} must not declare states`);
            assert.equal(block.description.permutations, undefined, `${name} must not transform itself`);
            assert.deepEqual(
                block.components["minecraft:collision_box"],
                { origin: [-8, 0, -8], size: [16, 8, 16] },
                `${name} must collide as a bottom half`
            );
        }
    });

    it("pins logs to the vertical axis with bark on the sides and rings on the caps", () => {
        for (const name of LOGS) {
            const block = blockOf(name);
            const instances = block.components["minecraft:material_instances"];

            assert.equal(block.description.states, undefined, `${name} must not expose a pillar axis`);
            assert.equal(block.description.traits, undefined, `${name} must not rotate on placement`);
            assert.ok(instances["*"].texture.endsWith("_log_side"), `${name} sides must use the bark texture`);
            assert.ok(instances["up"].texture.endsWith("_log_top"), `${name} caps must use the ring texture`);
        }
    });

    it("keeps every Beta log item craftable, smeltable to charcoal and burning at 15 seconds", () => {
        // The pack retypes every held log into a bh: item, so vanilla's log tags and
        // furnace_log_* recipes can never match. These declarations are the only route to planks,
        // to charcoal, and to a log that still burns - tags grant no burn time.
        for (const name of LOGS) {
            const item = readJson(resolve(root, "packs/BP/items", `${name}.json`))["minecraft:item"];
            const placer = item.components["minecraft:block_placer"];

            assert.equal(placer.block, `bh:${name}`);
            assert.ok(
                item.components["minecraft:tags"].tags.includes("minecraft:logs"),
                `${name} must stay craftable into planks`
            );

            const recipe = readJson(
                resolve(root, "packs/BP/recipes", `furnace_charcoal_${name}.json`)
            )["minecraft:recipe_furnace"];
            assert.equal(
                recipe.input.item,
                `bh:${name}`,
                `the charcoal recipe must smelt the item players actually hold (${name})`
            );
            assert.equal(recipe.output, "minecraft:charcoal");
            assert.equal(recipe.tags.includes("furnace"), true, `the charcoal recipe for ${name} must fire in a furnace`);

            assert.equal(item.components["minecraft:fuel"].duration, 15.0, `${name} must burn for Beta's 15 seconds`);
        }
    });

    it("registers every block texture in the terrain atlas", () => {
        const atlas = readJson(resolve(root, "packs/RP/textures/terrain_texture.json")).texture_data;

        for (const name of [...STAIRS, ...SLABS, ...LOGS]) {
            for (const texture of texturesOf(blockOf(name))) {
                assert.ok(atlas[texture], `${name} references '${texture}', which is missing from terrain_texture.json`);
            }
        }
    });

    it("declares tool tags the way the current block schema accepts them", () => {
        const blocksDir = resolve(root, "packs/BP/blocks");
        const files = readdirSync(blocksDir).filter(file => file.endsWith(".json"));

        for (const file of files) {
            const raw = readFileSync(resolve(blocksDir, file), "utf-8");
            const formatVersion = String(JSON.parse(raw).format_version).split(".").map(Number);
            if (formatVersion[1] < 26) continue;

            // Formats from 1.26.20 onward dropped the `tag:<name>` component from the schema in
            // favour of a tags array, and the loader rejects a definition that still uses it.
            assert.equal(raw.includes('"tag:'), false, `${file} must declare tags as an array`);
        }

        for (const name of STAIRS) {
            assert.equal(
                blockOf(name).components["minecraft:tags"].includes("minecraft:cornerable_stairs"),
                false,
                `${name} must stay out of vanilla's corner-forming group`
            );
        }

        for (const name of [...LOGS, "oak_stairs"]) {
            assert.ok(
                blockOf(name).components["minecraft:tags"].includes("minecraft:is_axe_item_destructible"),
                `${name} must be chopped with an axe`
            );
        }

        // Beta shipped the wooden slab as the stone slab with a plank texture tacked on: it answers
        // to a pickaxe, must not reward an axe, and sounds and breaks like the stone one. Declaring
        // flammability is what would let the plank texture catch, so it must stay absent.
        const stoneMining = blockOf("stone_slab").components["minecraft:destructible_by_mining"];
        const woodenSlab = blockOf("wooden_slab").components;
        assert.ok(
            woodenSlab["minecraft:tags"].includes("minecraft:is_pickaxe_item_destructible"),
            "wooden_slab must be mined at stone speed with a pickaxe"
        );
        assert.equal(
            woodenSlab["minecraft:tags"].includes("minecraft:is_axe_item_destructible"),
            false,
            "wooden_slab must not be chopped with an axe"
        );

        for (const name of ["wooden_slab", "double_wooden_slab"]) {
            const components = blockOf(name).components;

            assert.equal(
                components["minecraft:sound"].sound,
                "stone",
                `${name} must sound like the stone slab it is a clone of`
            );
            assert.deepEqual(
                components["minecraft:destructible_by_mining"],
                stoneMining,
                `${name} must break at the stone slab's speed`
            );
            assert.equal(
                components["minecraft:flammable"],
                undefined,
                `${name} must not burn like the planks it is textured from`
            );
        }
    });

    it("gives the sword haste only to the wood-class blocks", () => {
        assert.ok(SWORD_FAST_BLOCKS.has("bh:oak_stairs"), "custom wooden stairs must break fast with a sword");
        assert.equal(
            SWORD_FAST_BLOCKS.has("bh:wooden_slab"),
            false,
            "the stone-backed wooden slab must not get the sword bonus"
        );
    });
});

describe("Classic Recipe Contract - Beta 1.7.3 fence", () => {
    it("replaces vanilla's fence recipe instead of adding a parallel one", () => {
        // Vanilla's oak fence recipe id is `minecraft:fence`. Adding a second bh: recipe beside it -
        // which is what this recipe used to be - leaves the vanilla result craftable, and a vanilla
        // fence never joins a bh:fence line. Overriding the id is the same fix the chest needed.
        const recipe = readJson(resolve(root, "packs/BP/recipes/oak_fence.json"))["minecraft:recipe_shaped"];

        assert.equal(
            recipe.description.identifier,
            "minecraft:fence",
            "the recipe must override vanilla's id rather than sit beside it"
        );
        assert.equal(recipe.result.item, "bh:fence", "a crafted fence must already be the custom block");
        assert.equal(recipe.result.count, 2, "Beta crafted two fences from six sticks");
        assert.deepEqual(
            recipe.tags,
            ["beta_crafting"],
            "the custom crafting table is the only interface the pack's recipes belong to"
        );
    });

    it("keeps ambient occlusion and opaque shading on the fence", () => {
        const fence = blockOf("fence").components;
        const defaultInstance = fence["minecraft:material_instances"]["*"];

        // An AO exponent of 0 or false is what makes the fence read as a glowing outline.
        assert.notEqual(defaultInstance.ambient_occlusion, false, "fence must not disable ambient occlusion");
        assert.equal(defaultInstance.render_method, "opaque", "fence must use the opaque render method");
        assert.equal(fence["minecraft:light_emission"], undefined, "fence must not emit light");
    });
});

describe("Classic Block Contract - custom block names", () => {
    it("translates every custom block, not just its display name", () => {
        // Since 1.19.30 minecraft:display_name shows its raw string, but surfaces that build their
        // own title (the container screen among them) still look up tile.<identifier>.name and come
        // up nameless when it is missing.
        const entries = new Set<string>();
        for (const line of readFileSync(resolve(root, "packs/RP/texts/en_US.lang"), "utf-8").split(/\r?\n/)) {
            const separator = line.indexOf("=");
            if (separator > 0 && !line.startsWith("#")) entries.add(line.slice(0, separator));
        }

        const blocksDir = resolve(root, "packs/BP/blocks");
        const untranslated = readdirSync(blocksDir)
            .filter(file => file.endsWith(".json"))
            .map(file => readJson(resolve(blocksDir, file))["minecraft:block"].description.identifier)
            .filter(identifier => !entries.has(`tile.${identifier}.name`));

        assert.deepEqual(untranslated, [], "every custom block needs a tile.<identifier>.name entry");
    });
});

describe("Classic Block Contract - Beta 1.7.3 crafting table", () => {
    it("mines at the era's pace instead of a tuned-down time", () => {
        // `seconds_to_destroy` is the block's hardness, not a literal time: the engine mines at 1.5x
        // it. The workbench had been tuned down for gameplay and no longer matched the era, where it
        // was as slow to break as a chest.
        const table = blockOf("crafting_table").components["minecraft:destructible_by_mining"].seconds_to_destroy;
        const chest = blockOf("chest").components["minecraft:destructible_by_mining"].seconds_to_destroy;

        assert.equal(table, 2.5);
        assert.equal(table, chest, "the workbench and the chest shared the era's 2.5 hardness");
    });
});
