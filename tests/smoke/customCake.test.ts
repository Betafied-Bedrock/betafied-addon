import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BETA_BLOCK_IDS, BH_CAKE_ID, isBetaBlock } from "../../packs/BP/scripts/core/betaRegistry.js";
import { BLOCK_FINE_REPLACEMENTS } from "../../packs/BP/scripts/core/compatibilityPolicy.js";

const root = process.cwd();

function readJson(path: string): any {
    return JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, ""));
}

const block = readJson(resolve(root, "packs/BP/blocks/cake.json"))["minecraft:block"];
const item = readJson(resolve(root, "packs/BP/items/cake.json"))["minecraft:item"];
const geometry = readJson(resolve(root, "packs/RP/models/blocks/cake.geo.json"))["minecraft:geometry"]
    .find((model: any) => model.description.identifier === "geometry.bh_cake");

/** Beta's metadata, and the slices one bite leaves behind: 14 - 2b pixels of the fourteen. */
function biteBox(bites: number): { origin: number; width: number } {
    return { origin: 2 * bites - 7, width: 14 - 2 * bites };
}

/**
 * The same fourteen pixels as the block declares them. A block's local x runs opposite the world's,
 * so the box Beta shrank from -X is held against the *model's* -x end and the world sees it against
 * its east one. Authoring it the world's way round draws the cake one end out of step with the very
 * collision box that answers the click eating it.
 */
function modelBox(bites: number): { origin: number; width: number } {
    return { origin: -7, width: 14 - 2 * bites };
}

function permutationFor(bites: number): any {
    return block.permutations.find((entry: any) => entry.condition.includes(`== ${bites}`));
}

/** The bones the state machine shows at a given bite count: the cake is one box, so exactly one. */
function visibleBones(bites: number): string[] {
    const visibility = block.components["minecraft:geometry"].bone_visibility as Record<string, string>;

    return Object.entries(visibility)
        .filter(([, condition]) => Number(/== (\d+)/.exec(condition)![1]) === bites)
        .map(([bone]) => bone);
}

function cubeFor(bone: string): any {
    const found = geometry.bones.find((entry: any) => entry.name === bone);
    assert.equal(found?.cubes?.length, 1, `${bone} must draw the cake as a single box`);
    return found.cubes[0];
}

describe("Classic Block Contract - Beta 1.7.3 cake", () => {
    it("keeps the era's six bites as the block's only state", () => {
        assert.deepEqual(block.description.states, { "bh:bites": [0, 1, 2, 3, 4, 5] });
        assert.equal(block.description.identifier, BH_CAKE_ID);
    });

    it("draws one permutation per bite, with the box Beta drew for it", () => {
        for (const bites of [0, 1, 2, 3, 4, 5]) {
            const permutation = permutationFor(bites);
            assert.ok(permutation, `bite ${bites} has no permutation`);

            const world = biteBox(bites);
            const model = modelBox(bites);
            const collision = permutation.components["minecraft:collision_box"];
            const selection = permutation.components["minecraft:selection_box"];

            // Declared the local way round, which is the mirror of the box the era's world saw.
            assert.deepEqual(collision.origin, [model.origin, 0, -7], `collision origin at ${bites} bites`);
            assert.deepEqual(collision.size, [model.width, 7, 14], "the era's collision box stopped a pixel short");
            assert.deepEqual(selection.origin, [model.origin, 0, -7], `selection origin at ${bites} bites`);
            assert.deepEqual(selection.size, [model.width, 8, 14], "the selection box is the whole eight pixels");

            assert.equal(
                -(model.origin + model.width),
                world.origin,
                `the declared box starts where Beta's did at ${bites} bites`
            );
            assert.equal(
                -model.origin,
                world.origin + world.width,
                `the declared box ends where Beta's did at ${bites} bites`
            );
        }

        assert.equal(block.permutations.length, 6, "one permutation per bite and no more");
    });

    it("draws the cake in the block's own space, so no bone pokes into the cell beside it", () => {
        for (const bone of geometry.bones.filter((entry: any) => entry.cubes)) {
            const [cube] = bone.cubes;
            const [x, y, z] = cube.origin;
            const [sizeX, sizeY, sizeZ] = cube.size;

            // Geometry pixels run -8..8 across and 0..16 up, centred on the block. A model authored in
            // the 1..15 element space of Java's block models lands eight pixels up-right of its own
            // collision box and renders inside the neighbouring cell.
            assert.ok(x >= -8 && x + sizeX <= 8, `${bone.name} must stay within the block's x extent`);
            assert.ok(z >= -8 && z + sizeZ <= 8, `${bone.name} must stay within the block's z extent`);
            assert.equal(y, 0, `${bone.name} sits on the floor`);
            assert.ok(y + sizeY <= 16, `${bone.name} must stay within the block's height`);
        }
    });

    it("shows one bone per state, sized to the collision box the era drew", () => {
        for (const bites of [0, 1, 2, 3, 4, 5]) {
            const visible = visibleBones(bites);
            assert.deepEqual(visible, [`bites_${bites}`], `exactly one bone is the cake at ${bites} bites`);

            const cube = cubeFor(visible[0]);
            const model = modelBox(bites);
            assert.deepEqual(cube.origin, [model.origin, 0, -7], `the cake at ${bites} bites is held against the model's -x end`);
            assert.deepEqual(cube.size, [model.width, 8, 14], `at ${bites} bites the geometry must match the box`);
        }

        assert.deepEqual(cubeFor("bites_0").size, [14, 8, 14], "an unbitten cake is the era's fourteen pixels");
        assert.deepEqual(cubeFor("bites_5").size, [4, 8, 14], "the last bite Beta drew was four pixels wide");
    });

    it("draws the cake over the box the block answers clicks with", () => {
        for (const bites of [0, 1, 2, 3, 4, 5]) {
            const cube = cubeFor(`bites_${bites}`);
            const collision = permutationFor(bites).components["minecraft:collision_box"];
            const world = biteBox(bites);

            // The drawn box and the hitbox are the same shape in the same space; a mesh authored the
            // world's way round instead sits beside the cell that answers the click.
            assert.deepEqual(
                [cube.origin[0], cube.size[0]],
                [collision.origin[0], collision.size[0]],
                `the mesh and the hitbox must be the same shape at ${bites} bites`
            );
            assert.equal(
                -(collision.origin[0] + collision.size[0]),
                world.origin,
                `the mesh and the hitbox start where Beta's box did at ${bites} bites`
            );
            assert.equal(
                -collision.origin[0],
                world.origin + world.width,
                `the mesh and the hitbox end where Beta's box did at ${bites} bites`
            );
        }
    });

    it("crops every face to the pixels the cake still shows", () => {
        for (const bites of [0, 1, 2, 3, 4, 5]) {
            const cube = cubeFor(`bites_${bites}`);
            const { width } = biteBox(bites);

            // Texture space: the cake art fills u 1..15, and the side and inner band is v 8..16. Each
            // entry names the world face its surface shows, so the crop runs from the art's own origin
            // on the faces met from the west and climbs on those met from the east.
            const top = { uv: [1 + 2 * bites, 1], uv_size: [width, 14], material_instance: "cake_top" };
            const bottom = { uv: [1 + 2 * bites, 1], uv_size: [width, 14], material_instance: "cake_bottom" };
            const north = { uv: [1, 8], uv_size: [width, 8], material_instance: "cake_side" };
            // The south face is met from the far side, so its column runs back down the texture.
            const south = { uv: [1 + 2 * bites, 8], uv_size: [width, 8], material_instance: "cake_side" };
            const west = {
                uv: [1, 8],
                uv_size: [14, 8],
                material_instance: bites === 0 ? "cake_side" : "cake_cut"
            };
            const east = { uv: [1, 8], uv_size: [14, 8], material_instance: "cake_side" };

            assert.deepEqual(cube.uv.up, top, `top at ${bites} bites`);
            assert.deepEqual(cube.uv.down, bottom, `bottom at ${bites} bites`);
            assert.deepEqual(cube.uv.north, north, `north at ${bites} bites`);
            assert.deepEqual(cube.uv.south, south, `south at ${bites} bites`);

            // Only the surface the cake is eaten from shows the cut, which is the era's
            // `metadata > 0` check; the far end keeps the two-pixel-deep side texture.
            assert.deepEqual(cube.uv.west, west, "the eaten end is the era's metadata > 0 check");
            assert.deepEqual(cube.uv.east, east, "the far end keeps its side texture");
        }
    });

    it("maps all six faces, so no side renders untextured", () => {
        for (const bone of geometry.bones.filter((entry: any) => entry.cubes)) {
            const faces = bone.cubes[0].uv;
            assert.deepEqual(
                Object.keys(faces).sort(),
                ["down", "east", "north", "south", "up", "west"],
                `${bone.name} must map every face`
            );

            for (const [face, mapping] of Object.entries(faces)) {
                const { uv, uv_size, material_instance } = mapping as {
                    uv: number[];
                    uv_size: number[];
                    material_instance?: string;
                };
                assert.ok(uv && uv_size, `${bone.name}'s ${face} face has no uv`);
                assert.ok(uv[0] + uv_size[0] <= 16, `${bone.name}'s ${face} samples past the texture`);

                // A face left to fall back to '*' inherits whatever instance the cube declared
                // elsewhere, which is how the cut face ended up on the end nobody had eaten into.
                assert.ok(material_instance, `${bone.name}'s ${face} face must name its material instance`);
                assert.ok(
                    (block.components["minecraft:material_instances"] as Record<string, unknown>)[material_instance],
                    `${bone.name}'s ${face} names '${material_instance}', which the block does not define`
                );
            }
        }
    });

    it("names the four cake textures in the terrain atlas", () => {
        const atlas = readJson(resolve(root, "packs/RP/textures/terrain_texture.json")).texture_data;

        assert.deepEqual(block.components["minecraft:material_instances"], {
            "*": { texture: "bh_cake_side", render_method: "opaque" },
            cake_side: { texture: "bh_cake_side", render_method: "opaque" },
            cake_top: { texture: "bh_cake_top", render_method: "opaque" },
            cake_bottom: { texture: "bh_cake_bottom", render_method: "opaque" },
            cake_cut: { texture: "bh_cake_inner", render_method: "opaque" },
            up: { texture: "bh_cake_top", render_method: "opaque" },
            down: { texture: "bh_cake_bottom", render_method: "opaque" },
            north: { texture: "bh_cake_side", render_method: "opaque" },
            south: { texture: "bh_cake_side", render_method: "opaque" },
            east: { texture: "bh_cake_side", render_method: "opaque" },
            west: { texture: "bh_cake_side", render_method: "opaque" }
        });

        for (const [key, texture] of Object.entries({
            bh_cake_top: "textures/blocks/cake_top",
            bh_cake_side: "textures/blocks/cake_side",
            bh_cake_inner: "textures/blocks/cake_inner",
            bh_cake_bottom: "textures/blocks/cake_bottom"
        })) {
            assert.equal(atlas[key]?.textures, texture, `${key} is missing from the terrain atlas`);
        }
    });

    it("carries the era's hardness, sound and piston behaviour", () => {
        assert.equal(block.components["minecraft:destructible_by_mining"].seconds_to_destroy, 0.5, "setHardness(0.5F)");
        assert.equal(
            block.components["minecraft:destructible_by_explosion"].explosion_resistance,
            0.5,
            "a hardness of 0.5 puts the resistance at 2.5, which is 0.5 once divided by five"
        );
        assert.equal(block.components["minecraft:sound"].sound, "cloth", "setStepSound(soundClothFootstep)");
        assert.equal(
            block.components["minecraft:movable"].movement_type,
            "popped",
            "Material.cakeMaterial took no push mobility, so a piston destroys the cake"
        );
    });

    it("declares tags without claiming a tool class", () => {
        // 1.26.20 replaced the `tag:*` components with a tags array that the schema insists is
        // non-empty. Vanilla's cake is in no vanilla tag group at all - the era gave it no tool
        // affinity, and every vanilla tag either speeds a tool up or grants a behaviour - so the
        // pack marks it with its own tag rather than inventing a tool it never answered to.
        assert.deepEqual(block.components["minecraft:tags"], ["bh:cake"]);
    });

    it("drops nothing, the way quantityDropped(0) did", () => {
        assert.equal(block.components["minecraft:loot"], "loot_tables/blocks/cake.json");
        const table = readJson(resolve(root, "packs/BP/loot_tables/blocks/cake.json"));

        assert.deepEqual(table.pools, [], "a broken cake is worth no item");
    });

    it("stands on a floor and nowhere else", () => {
        assert.deepEqual(block.components["minecraft:placement_filter"].conditions, [{ allowed_faces: ["up"] }]);
    });

    it("places the pack's own block and keeps the item as its block item", () => {
        assert.equal(item.components["minecraft:block_placer"].block, BH_CAKE_ID);
        assert.equal(item.components["minecraft:block_placer"].replace_block_item, true, "the declared item is the block's");
        assert.equal(item.components["minecraft:max_stack_size"], 1, "ItemReed's cake stayed capped at one");
    });

    it("takes the cake over from the engine, converting what is already in the world", () => {
        assert.equal(isBetaBlock("minecraft:cake"), false, "a vanilla cake is no longer the pack's cake");
        assert.equal(BETA_BLOCK_IDS.has("minecraft:cake"), false);
        assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:cake"], BH_CAKE_ID, "the scrubber rewrites a vanilla cake");
    });
});
