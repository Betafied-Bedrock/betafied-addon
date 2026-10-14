import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function readJson(path: string): any {
    const raw = readFileSync(resolve(root, path), "utf-8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
}

describe("Block Appearance & Shading Contract", () => {
    it("configures face dimming overlays for Beta light sources", () => {
        const blocks = readJson("packs/RP/blocks.json");
        const terrain = readJson("packs/RP/textures/terrain_texture.json").texture_data;

        const expectedBlocks = ["glowstone", "lit_pumpkin", "lit_furnace", "lit_redstone_ore"];
        for (const id of expectedBlocks) {
            const block = blocks[id];
            assert.ok(block, `missing block definition for ${id}`);
            assert.equal(block.ambient_occlusion_exponent, 0.0, `${id} must disable AO exponent`);
            assert.equal(block.isotropic, false, `${id} must not be isotropic`);

            const textures = block.textures;
            assert.ok(typeof textures === "object", `${id} must have per-face texture mapping`);
            assert.ok(textures.down, `${id} must have down face texture`);
            assert.ok(textures.north, `${id} must have north face texture`);
            assert.ok(textures.south, `${id} must have south face texture`);
            assert.ok(textures.east, `${id} must have east face texture`);
            assert.ok(textures.west, `${id} must have west face texture`);

            for (const face of ["down", "north", "south", "east", "west"]) {
                const texKey = textures[face];
                const def = terrain[texKey];
                assert.ok(def, `terrain_texture.json missing key ${texKey} for ${id}.${face}`);
            }
        }

        // Verify standard Java directional overlay colors
        assert.equal(terrain.glowstone_bottom.textures[0].overlay_color, "#929292");
        assert.equal(terrain.glowstone_east_west.textures[0].overlay_color, "#AAAAAA");
        assert.equal(terrain.glowstone_north_south.textures[0].overlay_color, "#D7D7D7");
    });

    it("disables animation frame blending on all flipbook textures", () => {
        const flipbooks = readJson("packs/RP/textures/flipbook_textures.json");
        assert.ok(Array.isArray(flipbooks) && flipbooks.length > 0);

        for (const entry of flipbooks) {
            assert.equal(entry.blend_frames, false, `flipbook ${entry.flipbook_texture} must set blend_frames to false`);
        }
    });

    it("enforces deterministic orientation without random isotropic rotation", () => {
        const blocks = readJson("packs/RP/blocks.json");
        const checkedBlocks = ["oak_leaves", "birch_leaves", "sand", "gravel", "dirt"];

        for (const id of checkedBlocks) {
            const block = blocks[id];
            if (block && "isotropic" in block) {
                assert.equal(block.isotropic, false, `${id} must set isotropic to false`);
            }
        }
    });

    it("ships 100% opaque black leaf textures for Fast graphics", () => {
        for (const type of ["oak", "birch", "spruce"]) {
            const path = `packs/RP/textures/blocks/leaves_${type}_opaque.png`;
            assert.ok(existsSync(resolve(root, path)), `missing ${path}`);
        }
    });

    it("matches Sand ambient occlusion and shading to Sandstone", () => {
        const blocks = readJson("packs/RP/blocks.json");
        const sandBlocks = ["sand", "red_sand", "suspicious_sand"];

        for (const id of sandBlocks) {
            const block = blocks[id];
            assert.ok(block, `missing block definition for ${id}`);
            assert.equal(
                block.ambient_occlusion_exponent,
                1.0,
                `${id} must have ambient_occlusion_exponent set to 1.0 to match Sandstone`
            );
            assert.equal(
                block.brightness_gamma,
                undefined,
                `${id} must not carry legacy brightness_gamma`
            );
        }

        const sandstoneBlocks = ["sandstone", "red_sandstone"];
        for (const id of sandstoneBlocks) {
            const block = blocks[id];
            assert.ok(block, `missing block definition for ${id}`);
            assert.equal(
                block.brightness_gamma,
                undefined,
                `${id} must not carry legacy brightness_gamma`
            );
        }
    });

    it("relights leaves toward Beta with a trimmed ambient occlusion exponent", () => {
        const blocks = readJson("packs/RP/blocks.json");
        const leafIds = [
            "acacia_leaves", "birch_leaves", "dark_oak_leaves", "jungle_leaves",
            "leaves", "leaves2", "mangrove_leaves", "oak_leaves", "spruce_leaves"
        ];

        for (const id of leafIds) {
            const block = blocks[id];
            assert.ok(block, `missing block definition for ${id}`);
            assert.equal(
                block.ambient_occlusion_exponent,
                0.25,
                `${id} must trim ambient occlusion toward Beta's flat leaf shading`
            );
            assert.equal(
                block.brightness_gamma,
                undefined,
                `${id} must not carry legacy brightness_gamma`
            );
        }
    });

    it("bakes Beta directional face dimming onto the leaf faces", () => {
        const blocks = readJson("packs/RP/blocks.json");
        const terrain = readJson("packs/RP/textures/terrain_texture.json").texture_data;

        // Oak and birch share Beta's base leaf texture (index 52); spruce uses its own (index 132).
        const cases: [string, string][] = [
            ["oak_leaves", "oak_leaves"],
            ["birch_leaves", "oak_leaves"],
            ["spruce_leaves", "spruce_leaves"]
        ];

        for (const [id, base] of cases) {
            const block = blocks[id];
            assert.ok(block, `missing block definition for ${id}`);
            assert.equal(typeof block.textures, "object", `${id} must have per-face texture mapping`);
            assert.equal(block.textures.up, base, `${id} up face must stay unmodified`);

            // Directional multipliers calibrated with the glowstone face dimming: N/S 84.3% (#D7D7D7), E/W 66.7% (#AAAAAA), bottom 57.2% (#929292), top unmodified.
            const faceGroups: [string, string, string][] = [
                ["down", `${base}_bottom`, "#929292"],
                ["north", `${base}_north_south`, "#D7D7D7"],
                ["south", `${base}_north_south`, "#D7D7D7"],
                ["east", `${base}_east_west`, "#AAAAAA"],
                ["west", `${base}_east_west`, "#AAAAAA"]
            ];

            for (const [face, key, overlay] of faceGroups) {
                assert.equal(block.textures[face], key, `${id}.${face} must map to ${key}`);
                const def = terrain[key];
                assert.ok(def, `terrain_texture.json missing key ${key} for ${id}.${face}`);
                assert.equal(def.textures[0].tint_color, overlay, `${key} must carry tint ${overlay}`);
                assert.equal(
                    def.textures[0].overlay_color,
                    undefined,
                    `${key} must not use overlay_color, which discards the leaf alpha cutout`
                );
            }
        }
    });
});
