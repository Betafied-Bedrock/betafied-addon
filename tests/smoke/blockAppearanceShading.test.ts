import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";

const root = process.cwd();

type Rgba = [number, number, number, number];

function readJson(path: string): any {
    const raw = readFileSync(resolve(root, path), "utf-8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
}

/** Decodes a non-interlaced 8-bit PNG into top-down RGBA pixels; RGB images read as alpha 255. */
function decodePng(path: string): { width: number; height: number; pixels: Rgba[] } {
    const png = readFileSync(resolve(root, path));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${path}: expected a PNG`);
    assert.equal(png[24], 8, `${path}: expected 8 bits per channel`);
    const colourType = png[25];
    assert.ok(colourType === 2 || colourType === 6, `${path}: expected colour type 2 or 6, got ${colourType}`);
    assert.equal(png[28], 0, `${path}: interlaced PNGs are not supported`);
    const channels = colourType === 6 ? 4 : 3;

    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);

    const idat: Buffer[] = [];
    for (let offset = 8; offset + 8 <= png.length; ) {
        const length = png.readUInt32BE(offset);
        const type = png.subarray(offset + 4, offset + 8).toString("ascii");
        if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
        if (type === "IEND") break;
        offset += length + 12;
    }

    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const pixels: Rgba[] = [];
    let previous = new Array(stride).fill(0);
    let cursor = 0;

    for (let y = 0; y < height; y++) {
        const filter = raw[cursor++];
        const line = Array.from(raw.subarray(cursor, cursor + stride));
        cursor += stride;

        for (let x = 0; x < stride; x++) {
            const left = x >= channels ? line[x - channels] : 0;
            const up = previous[x];
            const upLeft = x >= channels ? previous[x - channels] : 0;
            if (filter === 1) line[x] = (line[x] + left) & 255;
            else if (filter === 2) line[x] = (line[x] + up) & 255;
            else if (filter === 3) line[x] = (line[x] + ((left + up) >> 1)) & 255;
            else if (filter === 4) {
                const estimate = left + up - upLeft;
                const distances = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)];
                const nearest = distances[0] <= distances[1] && distances[0] <= distances[2] ? left
                    : distances[1] <= distances[2] ? up : upLeft;
                line[x] = (line[x] + nearest) & 255;
            }
        }

        for (let x = 0; x < width; x++) {
            pixels.push([
                line[x * channels],
                line[x * channels + 1],
                line[x * channels + 2],
                channels === 4 ? line[x * channels + 3] : 255
            ]);
        }
        previous = line;
    }

    return { width, height, pixels };
}

/** Decodes Betafied's 32-bit true-colour / RLE TGAs into top-down RGBA pixels. */
function decodeTga(path: string): { width: number; height: number; pixels: Rgba[] } {
    const tga = readFileSync(resolve(root, path));
    const idLength = tga[0];
    const imageType = tga[2];
    assert.equal(tga[1], 0, `${path}: no colour map expected`);
    assert.ok(imageType === 2 || imageType === 10, `${path}: expected a true-colour TGA (type 2 or 10)`);
    assert.equal(tga[16], 32, `${path}: expected 32 bits per pixel`);

    const width = tga.readUInt16LE(12);
    const height = tga.readUInt16LE(14);
    const stored: Rgba[] = [];
    let cursor = 18 + idLength;

    const readPixel = (): Rgba => {
        const pixel: Rgba = [tga[cursor + 2], tga[cursor + 1], tga[cursor], tga[cursor + 3]];
        cursor += 4;
        return pixel;
    };

    while (stored.length < width * height) {
        if (imageType === 2) {
            stored.push(readPixel());
            continue;
        }
        const header = tga[cursor++];
        const runLength = (header & 0x7f) + 1;
        if ((header & 0x80) !== 0) {
            const pixel = readPixel();
            for (let i = 0; i < runLength; i++) stored.push(pixel);
        } else {
            for (let i = 0; i < runLength; i++) stored.push(readPixel());
        }
    }

    // Bit 5 of the image descriptor marks a top-down origin; this pack's leaf art is bottom-up.
    const topDown = (tga[17] & 0x20) !== 0;
    const pixels: Rgba[] = [];
    for (let y = 0; y < height; y++) {
        const row = topDown ? y : height - 1 - y;
        pixels.push(...stored.slice(row * width, row * width + width));
    }

    return { width, height, pixels };
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

    it("ships 16x16 fully opaque leaf textures for Fast graphics", () => {
        for (const type of ["oak", "birch", "spruce"]) {
            const path = `packs/RP/textures/blocks/leaves_${type}_opaque.png`;
            assert.ok(existsSync(resolve(root, path)), `missing ${path}`);

            const { width, height, pixels } = decodePng(path);
            assert.equal(width, 16, `${path} must be 16 pixels wide`);
            assert.equal(height, 16, `${path} must be 16 pixels tall`);

            const translucent = pixels.filter((pixel) => pixel[3] !== 255);
            assert.equal(translucent.length, 0, `${path} must be fully opaque: ${translucent.length} of ${pixels.length} pixels are not`);
        }
    });

    it("punches real holes in the Fancy leaf tiles rather than alpha-1 fringe pixels", () => {
        // Beta 1.7.3's leaf sprite is 155 opaque pixels and 101 gaps at alpha 0. An alpha-1 gap is not
        // a gap for any renderer that keeps alpha > 0 opaque, and those pixels are what read in game as
        // a solid fill between the leaves.
        for (const type of ["oak", "birch", "spruce"]) {
            const path = `packs/RP/textures/blocks/leaves_${type}.tga`;
            const { width, height, pixels } = decodeTga(path);
            assert.equal(width, 16, `${path} must be 16 pixels wide`);
            assert.equal(height, 16, `${path} must be 16 pixels tall`);

            const fringe = pixels.filter((pixel) => pixel[3] !== 0 && pixel[3] !== 255);
            assert.equal(fringe.length, 0, `${path} must ship binary alpha: ${fringe.length} of ${pixels.length} pixels sit between 0 and 255`);
            assert.ok(
                pixels.some((pixel) => pixel[3] === 0),
                `${path} must leave transparent gaps for the Fast tile to fill`
            );
        }
    });

    it("fills the Fast leaf tile exactly where the Fancy tile has gaps", () => {
        for (const type of ["oak", "birch", "spruce"]) {
            const fancy = decodeTga(`packs/RP/textures/blocks/leaves_${type}.tga`);
            const fast = decodePng(`packs/RP/textures/blocks/leaves_${type}_opaque.png`);
            assert.deepEqual([fast.width, fast.height], [fancy.width, fancy.height], `${type}: the two tiles must be the same size`);

            const gapIndices = fancy.pixels.map((pixel, index) => (pixel[3] === 0 ? index : -1)).filter((index) => index >= 0);
            assert.ok(gapIndices.length > 0, `leaves_${type}.tga must have gaps for the Fast tile to fill`);

            const counts = new Map<string, number>();
            for (const pixel of fast.pixels) {
                const key = pixel.slice(0, 3).join(",");
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            const [filler] = [...counts.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best));
            const fillerIndices = fast.pixels.map((pixel, index) => (pixel.slice(0, 3).join(",") === filler ? index : -1)).filter((index) => index >= 0);

            assert.deepEqual(fillerIndices, gapIndices, `leaves_${type}_opaque.png must fill the Fancy tile's gaps and nothing else (filler ${filler})`);
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
