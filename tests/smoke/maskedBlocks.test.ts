import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// The pack used to make a post-Beta block disappear instead of removing it: a blocks.json entry with
// blockshape "invisible", or an atlas tile pointed at the transparent sentinel below. Both leave the
// block standing but unrendered, vanilla masks nothing, and the engine's own flipbook repaints a
// masked tile from its source file anyway -- which is how a masked firefly bush kept its animated
// fireflies. These cases keep either mechanism from coming back: a block that post-dates the era
// belongs to the scrubber, not to the atlas.
const MASKED_PATH = "textures/blocks/invisible";
const MASKED_SHORTNAME = "invisible";

// Shortnames the pack's own blocks.json asks the atlas to resolve for Beta materials. Each one has
// to be declared here: an undeclared shortname falls back to resolution behaviour the pack does not
// control, which is how netherrack and soul sand became hard to tell apart.
const BETA_SHORTNAMES = ["netherrack", "soul_sand", "stone", "gravel", "obsidian", "glowstone"];

// Tiles vanilla's flipbook_textures.json animates by name. The engine animates the atlas tile, not
// the JSON entry, so a pack entry that points at the same texture path as one of these is the same
// tile and silently inherits its frames. Pointing magma at gravel's path is how gravel started
// rendering with the soul sand art sitting in graphics/blocks/magma.
const VANILLA_ANIMATED_TILES = [
    "magma",
    "portal",
    "prismarine",
    "sea_lantern",
    "stonecutter2_saw",
    "still_lava",
    "flowing_lava",
    "still_water_grey",
    "flowing_water_grey",
    "cauldron_water",
    "campfire_fire",
    "campfire_log_lit",
    "lantern",
    "kelp_a",
    "kelp_b",
    "kelp_c",
    "kelp_d",
    "kelp_top",
    "kelp_top_bulb",
    "seagrass_short",
    "seagrass_tall_bot_a",
    "seagrass_tall_bot_b",
    "seagrass_tall_top_a",
    "seagrass_tall_top_b",
    "fire_0",
    "fire_1"
];

const readJson = (path: string): any => JSON.parse(readFileSync(path, "utf-8"));

// Mojang's own files open with a "do not copy this file" comment, which JSON.parse rejects.
const readCorpusJson = (path: string): any =>
    JSON.parse(readFileSync(path, "utf-8").replace(/^\s*\/\/.*$/gm, ""));

// The single texture path of an atlas entry, or undefined when it fans out across several tiles.
const solePath = (entry: any): string | undefined =>
    typeof entry?.textures === "string" ? entry.textures : undefined;

// Every tile an atlas entry resolves to, whichever of the three shapes it uses.
const tilePaths = (entry: any): string[] => {
    if (!Array.isArray(entry?.textures)) return [entry?.textures].filter((t) => typeof t === "string");
    return entry.textures.map((t: any) => (typeof t === "string" ? t : t?.path)).filter(Boolean);
};

// Every shortname a block definition names, carried textures included, so a mask cannot hide behind
// a carried_textures map the way `seagrass` used to.
const declaredNames = (definition: any): string[] => {
    const names: string[] = [];
    for (const field of ["textures", "carried_textures"]) {
        const value = definition?.[field];
        if (typeof value === "string") names.push(value);
        else if (value && typeof value === "object") names.push(...Object.values(value) as string[]);
    }
    return names;
};

describe("Block Appearance - nothing is masked", () => {
    const root = process.cwd();
    const blocks = readJson(resolve(root, "packs/RP/blocks.json"));
    const atlas = readJson(resolve(root, "packs/RP/textures/terrain_texture.json")).texture_data;

    it("never unrenders a block from its own definition", () => {
        const masked = Object.entries(blocks)
            .filter(([, definition]: [string, any]) => {
                if (definition?.blockshape === "invisible") return true;
                return declaredNames(definition).some(
                    (name) => name === MASKED_SHORTNAME || name === MASKED_PATH
                );
            })
            .map(([name]) => name);

        assert.deepEqual(
            masked,
            [],
            "a block may not be masked away; convert it in the scrubber or leave it to vanilla"
        );
    });

    it("never points an atlas tile at the transparent sentinel", () => {
        const masked = Object.entries(atlas)
            .filter(([, entry]: [string, any]) => tilePaths(entry).includes(MASKED_PATH))
            .map(([name]) => name);

        assert.deepEqual(
            masked,
            [],
            "an atlas entry must resolve to block art, never to the invisible sentinel"
        );
    });

    // Vanilla's own flipbook targets atlas_index 1 of this entry ("firefly_bush_firefly"), so the
    // second tile is load-bearing. Collapsing it to a single tile does not silence the engine's
    // "invalid atlas index 1 for the expected UV count 1" line either: that compile-time check fires
    // for vanilla's own declaration, which the pack cannot replace, only shadow.
    it("keeps the firefly bush entry two tiles wide for vanilla's flipbook", () => {
        const entry = atlas.firefly_bush;
        assert.ok(entry, "terrain_texture.json must keep the firefly_bush entry");
        assert.ok(
            Array.isArray(entry.textures) && entry.textures.length === 2,
            "firefly_bush must stay two tiles: vanilla's flipbook animates atlas_index 1"
        );
    });

    it("declares every shortname the remapped blocks resolve through the atlas", () => {
        for (const name of BETA_SHORTNAMES) {
            const entry = atlas[name];
            assert.ok(entry, `terrain_texture.json must define the '${name}' shortname`);
            assert.match(entry.textures, /^textures\/blocks\//, `${name} must point at a block texture path`);
        }
    });

    it("never lets a beta block alias onto a tile vanilla animates", () => {
        const animated = new Map(
            VANILLA_ANIMATED_TILES.filter((name) => name in atlas).map((name) => [name, solePath(atlas[name])])
        );

        for (const [name, entry] of Object.entries(atlas)) {
            const path = solePath(entry);
            if (path === undefined) continue;
            for (const [animatedName, animatedPath] of animated) {
                if (name === animatedName || animatedPath !== path) continue;
                assert.fail(
                    `'${name}' and the vanilla-animated '${animatedName}' both resolve to ${path}; ` +
                        `give '${name}' its own texture file so the flipbook cannot repaint it`
                );
            }
        }
    });

    // A flipbook entry pulls its frames from a texture file and paints them onto an atlas tile, so a
    // pack entry that names a source file vanilla animates elsewhere is a texture swap dressed as an
    // override. The two fire entries once did exactly that, feeding vanilla's fire frames to the
    // soul fire tile the era has no block for. The pack may re-declare an entry -- to step its frames
    // without blending -- but it has to animate the tile vanilla takes that art for.
    it("never paints a tile with another tile's frames", () => {
        const corpus = resolve(
            root,
            "reference-docs/bedrock-samples/resource_pack/textures/flipbook_textures.json"
        );
        const flipbooks = readJson(resolve(root, "packs/RP/textures/flipbook_textures.json"));

        // reference-docs is a local clone of vanilla's resources and is deliberately not tracked,
        // so the only list the pack can be held against is the one a developer has restored.
        if (!existsSync(corpus)) return;

        const vanillaTile = new Map<string, string>(
            readCorpusJson(corpus).map((entry: any): [string, string] => [entry.flipbook_texture, entry.atlas_tile])
        );

        for (const entry of flipbooks) {
            const expected = vanillaTile.get(entry.flipbook_texture);
            if (expected === undefined) continue;
            assert.equal(
                entry.atlas_tile,
                expected,
                `${entry.flipbook_texture} animates '${expected}' for vanilla; the pack cannot paint it onto '${entry.atlas_tile}'`
            );
        }
    });
});
