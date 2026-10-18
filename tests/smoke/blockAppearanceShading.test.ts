import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

            // The face loop below is also the presence check: a face with no texture resolves no
            // terrain_texture.json key, which fails there.
            const textures = block.textures;

            for (const face of ["down", "north", "south", "east", "west"]) {
                const texKey = textures[face];
                const def = terrain[texKey];
                assert.ok(def, `terrain_texture.json missing key ${texKey} for ${id}.${face}`);
            }
        }

        // The standard Java directional overlay colours.
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

    it("punches real holes in the Fancy leaf tiles, and fills them in Beta's fast-graphics tone", () => {
        // Beta 1.7.3's leaf sprite is 155 opaque pixels and 101 gaps at alpha 0. An alpha-1 gap is not
        // a gap for any renderer that keeps alpha > 0 opaque, and those pixels are what read in game as
        // a solid fill between the leaves. Beta swaps the leaf texture for the tile beside it when
        // Fancy graphics is off, so its Fast tiles are the Fancy art with the cut-outs painted flat --
        // the dark grey that tints to the in-game foliage green: terrain.png tile (5,3), and (5,8)
        // for pine. The pixel loop is also what pins the Fast tile's size and its full opacity.
        const fastFills: [string, Rgba][] = [
            ["oak", [44, 44, 44, 255]],
            ["birch", [44, 44, 44, 255]],
            ["spruce", [49, 49, 49, 255]]
        ];

        for (const [type, fill] of fastFills) {
            const fancy = decodeTga(`packs/RP/textures/blocks/leaves_${type}.tga`);
            assert.deepEqual(
                [fancy.width, fancy.height],
                [16, 16],
                `leaves_${type}.tga must be a 16x16 tile`
            );

            const fringe = fancy.pixels.filter((pixel) => pixel[3] !== 0 && pixel[3] !== 255);
            assert.equal(
                fringe.length,
                0,
                `leaves_${type}.tga must ship binary alpha: ${fringe.length} of ${fancy.pixels.length} pixels sit between 0 and 255`
            );
            assert.ok(
                fancy.pixels.some((pixel) => pixel[3] === 0),
                `leaves_${type}.tga must leave transparent gaps for the Fast tile to fill`
            );

            // The era's own Fancy tile keeps #000000 under its holes because nothing ever showed that
            // colour there; Bedrock does not grant the art that luxury. `alpha_test_to_opaque` -- the
            // render method the engine gives leaves, "used for a block like the leaves" -- drops the
            // alpha test at distance, so a black hole is a black gap, and black is also what the mip
            // levels bleed into the leaf pixels around it. Beta never rendered tile (4,3) that way: its
            // fast sprite, (5,3) and (5,8) for pine, is this same drawing with every hole painted one
            // flat tone, and that tone is what has to sit under the alpha here.
            const offTone = fancy.pixels.filter(
                (pixel) => pixel[3] === 0 && (pixel[0] !== fill[0] || pixel[1] !== fill[1] || pixel[2] !== fill[2])
            );
            assert.equal(
                offTone.length,
                0,
                `leaves_${type}.tga: ${offTone.length} of ${fancy.pixels.filter((p) => p[3] === 0).length} holes carry a tone that shows the moment the engine drops the alpha test; the era's Fast sprite paints them all ${fill.slice(0, 3).join(",")}`
            );

            const fast = decodePng(`packs/RP/textures/blocks/leaves_${type}_opaque.png`);
            assert.deepEqual([fast.width, fast.height], [fancy.width, fancy.height], `${type}: the two tiles must be the same size`);

            for (let index = 0; index < fancy.pixels.length; index++) {
                const expected = fancy.pixels[index][3] === 0 ? fill : fancy.pixels[index];
                assert.deepEqual(
                    fast.pixels[index],
                    expected,
                    `leaves_${type}_opaque.png must be the Fancy tile with every cut-out painted ${fill.slice(0, 3).join(",")}, pixel ${index}`
                );
            }
        }
    });

    it("trims ambient occlusion to the era's tone for sand and leaves", () => {
        const blocks = readJson("packs/RP/blocks.json");
        const families: [number, string[]][] = [
            [1.0, ["sand", "suspicious_sand"]],
            [0.25, ["oak_leaves", "leaves", "leaves2"]]
        ];

        for (const [exponent, ids] of families) {
            for (const id of ids) {
                const block = blocks[id];
                assert.ok(block, `missing block definition for ${id}`);
                assert.equal(
                    block.ambient_occlusion_exponent,
                    exponent,
                    `${id} must carry the ambient_occlusion_exponent its material family uses`
                );
                assert.equal(block.brightness_gamma, undefined, `${id} must not carry legacy brightness_gamma`);
            }
        }
    });

    it("carries a darker AO exponent on birch leaves than the rest of the leaf family", () => {
        // The engine tints birch leaves on its own path (`birch_foliage`, which ignores
        // `minecraft:foliage_appearance`), and that path renders them brighter than the oak leaves
        // beside them at the same AO. The exponent is the one per-block brightness value the
        // renderer still honours, so the compensation lives here rather than in the tint.
        const block = readJson("packs/RP/blocks.json").birch_leaves;
        assert.ok(block, "missing block definition for birch_leaves");
        assert.equal(
            block.ambient_occlusion_exponent,
            0.5,
            "birch_leaves must stay darker than the 0.25 the other leaves use"
        );
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
