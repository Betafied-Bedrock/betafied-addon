import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DOUBLE_SLAB_OF } from "../../packs/BP/scripts/interactions/slabStacking.js";
import { BETA_BLOCK_IDS } from "../../packs/BP/scripts/core/betaRegistry.js";

const root = process.cwd();

// [single slab id, merged block id], straight from the table the merge itself uses.
const PAIRS: readonly (readonly [string, string])[] = Object.entries(DOUBLE_SLAB_OF);

function readJson(path: string): any {
    return JSON.parse(readFileSync(path, "utf-8"));
}

function blockOf(name: string): any {
    const path = resolve(root, "packs/BP/blocks", `${name}.json`);
    assert.ok(existsSync(path), `packs/BP/blocks/${name}.json must exist`);
    return readJson(path)["minecraft:block"];
}

const fileOf = (id: string): string => id.replace("bh:", "");

describe("Beta Double Slab Contract - two slabs become one full block", () => {
    it("renders the merged block as an untransformed cube wearing the single's faces", () => {
        for (const [single, double] of PAIRS) {
            const block = blockOf(fileOf(double));
            const half = blockOf(fileOf(single));

            assert.equal(block.description.identifier, double);
            assert.equal(
                block.components["minecraft:geometry"].identifier,
                "minecraft:geometry.full_block",
                `${double} must render as a full cube`
            );
            assert.deepEqual(
                block.components["minecraft:collision_box"],
                { origin: [-8, 0, -8], size: [16, 16, 16] },
                `${double} must collide as a full block`
            );
            assert.deepEqual(
                block.components["minecraft:selection_box"],
                { origin: [-8, 0, -8], size: [16, 16, 16] },
                `${double} must outline a full block`
            );

            // No half state, no placement trait and no permutation: the pack's slabs only ever sit
            // in the bottom half, so the merged cube has nothing to rotate or flip either.
            assert.equal(block.description.states, undefined, `${double} must not declare states`);
            assert.equal(block.description.traits, undefined, `${double} must not enable placement traits`);
            assert.equal(block.permutations, undefined, `${double} must not transform itself`);

            assert.deepEqual(
                block.components["minecraft:material_instances"],
                half.components["minecraft:material_instances"],
                `${double} must reuse the half's textures on every face`
            );
            assert.equal(
                block.components["minecraft:destructible_by_mining"].seconds_to_destroy,
                half.components["minecraft:destructible_by_mining"].seconds_to_destroy,
                `${double} must keep the half's hardness`
            );
            assert.equal(
                block.components["minecraft:display_name"],
                half.components["minecraft:display_name"],
                `${double} must be named the way Beta named the doubled slab`
            );
        }
    });

    it("pays back the two single slabs when the merged block is mined", () => {
        for (const [single, double] of PAIRS) {
            const block = blockOf(fileOf(double));
            const loot = block.components["minecraft:loot"];

            assert.equal(loot, `loot_tables/blocks/${fileOf(double)}.json`, `${double} must route its drop through a loot table`);

            const pools = readJson(resolve(root, "packs/BP", loot)).pools;
            assert.deepEqual(pools.map((pool: any) => pool.rolls), [2], `${double} must roll twice`);
            assert.deepEqual(
                pools[0].entries.map((entry: any) => entry.name),
                [single],
                `${double} must drop its own half`
            );
        }
    });

    it("registers the merged blocks as authentic Beta blocks, not as items of their own", () => {
        for (const [, double] of PAIRS) {
            assert.ok(BETA_BLOCK_IDS.has(double), `${double} must be an authentic Beta block`);
            assert.equal(
                existsSync(resolve(root, "packs/BP/items", `${fileOf(double)}.json`)),
                false,
                `${double} must not ship an item definition`
            );
        }
    });

    it("registers every gained texture in the terrain atlas", () => {
        const atlas = readJson(resolve(root, "packs/RP/textures/terrain_texture.json")).texture_data;

        for (const [, double] of PAIRS) {
            const instances = blockOf(fileOf(double)).components["minecraft:material_instances"];
            for (const instance of Object.values(instances) as any[]) {
                assert.ok(atlas[instance.texture], `${double} references '${instance.texture}', which is missing from terrain_texture.json`);
            }
        }
    });
});
