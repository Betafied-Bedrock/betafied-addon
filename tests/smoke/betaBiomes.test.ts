import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
    BETA_LAND_PROFILES,
    BETA_PROFILES,
    NETHER_BIOME_IDS,
    OVERWORLD_BIOME_IDS,
    OVERWORLD_BIOME_PROFILE,
    UNMANAGED_BIOME_IDENTIFIERS,
    biomeIdentifier
} from "../../scripts/lib/betaBiomes.mjs";
import {
    BETA_PROFILE_TINTS,
    NETHER_CLIENT_FOG_ID,
    OVERWORLD_AIR_FOG,
    OVERWORLD_CLIENT_FOG_ID,
    buildClientBiome,
    buildNetherClientBiome,
    resolveBiomeTint
} from "../../scripts/lib/betaBiomeTints.mjs";
import { COLORMAP_TEXTURES, biomeSamplePoint, colormapWrites } from "../../scripts/lib/betaColormap.mjs";
import { colormapCoordinate, decodePng, toArgbBuffer, toHex } from "../../scripts/lib/betaColorizer.mjs";

// Every Overworld biome shipped in the vanilla behavior pack (Mojang/bedrock-samples). A biome
// added upstream that is missing here renders with the vanilla palette, since the pack no longer
// defines Overworld biomes at all, so this list is the guard against silently unhandled biomes.
const VANILLA_OVERWORLD_BIOMES = [
    "bamboo_jungle", "bamboo_jungle_hills", "beach", "birch_forest", "birch_forest_hills",
    "birch_forest_hills_mutated", "birch_forest_mutated", "cherry_grove", "cold_beach", "cold_ocean",
    "cold_taiga", "cold_taiga_hills", "cold_taiga_mutated", "dappled_forest", "deep_cold_ocean",
    "deep_dark", "deep_frozen_ocean", "deep_lukewarm_ocean", "deep_ocean", "deep_warm_ocean",
    "desert", "desert_hills", "desert_mutated", "dripstone_caves", "extreme_hills",
    "extreme_hills_edge", "extreme_hills_mutated", "extreme_hills_plus_trees",
    "extreme_hills_plus_trees_mutated", "flower_forest", "forest", "forest_hills", "frozen_ocean",
    "frozen_peaks", "frozen_river", "grove", "ice_mountains", "ice_plains", "ice_plains_spikes",
    "jagged_peaks", "jungle", "jungle_edge", "jungle_edge_mutated", "jungle_hills", "jungle_mutated",
    "legacy_frozen_ocean", "lukewarm_ocean", "lush_caves", "mangrove_swamp", "meadow", "mega_taiga",
    "mega_taiga_hills", "mesa", "mesa_bryce", "mesa_plateau", "mesa_plateau_mutated",
    "mesa_plateau_stone", "mesa_plateau_stone_mutated", "mushroom_island", "mushroom_island_shore",
    "ocean", "pale_garden", "plains", "redwood_taiga_hills_mutated", "redwood_taiga_mutated", "river",
    "roofed_forest", "roofed_forest_mutated", "savanna", "savanna_mutated", "savanna_plateau",
    "savanna_plateau_mutated", "snowy_slopes", "stone_beach", "stony_peaks", "sulfur_caves",
    "sunflower_plains", "swampland", "swampland_mutated", "taiga", "taiga_hills", "taiga_mutated",
    "warm_ocean"
];

const VANILLA_NETHER_BIOMES = ["hell", "soulsand_valley", "crimson_forest", "warped_forest", "basalt_deltas"];

describe("Beta 1.7.3 Biome Table - Overworld Remap and Appearance", () => {
    const biomesDir = resolve(process.cwd(), "packs/BP/biomes");

    it("uses only the five land profiles Beta 1.7.3 actually generated, and uses all of them", () => {
        // Ten biomes existed in the code, but the Adventure Update changelog records that Rain
        // Forest, Seasonal Forest, Shrubland, Savanna, Tundra and Ice Desert never generated.
        for (const [shortId, profileName] of Object.entries(OVERWORLD_BIOME_PROFILE)) {
            assert.ok(
                Object.hasOwn(BETA_PROFILES, profileName),
                `${shortId} points at unknown profile '${profileName}'`
            );
        }

        const profiles = new Set(Object.values(OVERWORLD_BIOME_PROFILE));

        for (const profile of BETA_LAND_PROFILES) {
            assert.ok(profiles.has(profile), `profile '${profile}' is defined but no Bedrock biome uses it`);
        }

        for (const ghost of ["rainforest", "seasonal_forest", "shrubland", "savanna", "tundra"]) {
            assert.ok(!profiles.has(ghost), `'${ghost}' never generated in Beta 1.7.3 and must not be used`);
        }
    });

    it("confines snow to the single Beta taiga profile", () => {
        // Beta only accumulated snow in taiga. The engine's climate map hands out far more cold
        // zones than Beta had biomes, so every modern frozen biome is folded onto a temperate
        // profile and this stops anyone from quietly handing one of them snow again.
        const snowy = Object.entries(BETA_PROFILES)
            .filter(([, profile]) => profile.climate.snow_accumulation[1] > 0)
            .map(([name]) => name);

        assert.deepEqual(snowy, ["taiga"], "only taiga may accumulate snow");
    });

    it("renders Beta's sea unfrozen", () => {
        for (const shortId of ["frozen_ocean", "deep_cold_ocean"]) {
            assert.equal(OVERWORLD_BIOME_PROFILE[shortId], "ocean", `${shortId} must render as ordinary ocean water`);
        }
        assert.equal(OVERWORLD_BIOME_PROFILE.frozen_river, "river", "frozen rivers must render as plain water");
    });

    it("leaves no Overworld biome override behind", () => {
        // The Overworld ships pre-generated in the world template, so the pack defines no Overworld
        // biome at all: only the Nether set the generator still emits, plus the End, may sit here.
        const nether = new Set(NETHER_BIOME_IDS.map(biomeIdentifier));
        const unmanaged = new Set(UNMANAGED_BIOME_IDENTIFIERS);

        for (const file of readdirSync(biomesDir).filter(f => f.endsWith(".json"))) {
            const content = JSON.parse(readFileSync(resolve(biomesDir, file), "utf-8"));
            const identifier = content["minecraft:biome"]?.description?.identifier;
            assert.ok(
                nether.has(identifier) || unmanaged.has(identifier),
                `${file} defines '${identifier}'; the Overworld must have no behaviour-pack biome definition`
            );
        }
    });

    it("covers every vanilla biome so none renders with the modern palette", () => {
        for (const shortId of VANILLA_OVERWORLD_BIOMES) {
            assert.ok(
                Object.hasOwn(OVERWORLD_BIOME_PROFILE, shortId),
                `${shortId} is a vanilla Overworld biome with no Beta remap; it will render its vanilla grass and foliage`
            );
        }

        for (const shortId of VANILLA_NETHER_BIOMES) {
            assert.ok(
                NETHER_BIOME_IDS.includes(shortId),
                `${shortId} is a vanilla Nether biome with no Beta override`
            );
        }
    });
});

describe("Beta 1.7.3 Biome Tints - Resource Pack Client Biomes", () => {
    const clientBiomesDir = resolve(process.cwd(), "packs/RP/biomes");
    const managed = new Set([...OVERWORLD_BIOME_IDS, ...NETHER_BIOME_IDS].map(biomeIdentifier));

    it("keeps the on-disk client biomes byte-identical to the tint table, with no stray file beside them", () => {
        for (const shortId of OVERWORLD_BIOME_IDS) {
            const expected = `${JSON.stringify(buildClientBiome(shortId, OVERWORLD_BIOME_PROFILE[shortId]), null, 2)}\n`;
            const actual = readFileSync(resolve(clientBiomesDir, `${shortId}.client_biome.json`), "utf-8");
            assert.equal(
                actual,
                expected,
                `${shortId}.client_biome.json is out of date with scripts/lib/betaBiomeTints.mjs`
            );
        }

        for (const shortId of NETHER_BIOME_IDS) {
            const expected = `${JSON.stringify(buildNetherClientBiome(shortId), null, 2)}\n`;
            const actual = readFileSync(resolve(clientBiomesDir, `${shortId}.client_biome.json`), "utf-8");
            assert.equal(
                actual,
                expected,
                `${shortId}.client_biome.json is out of date with scripts/lib/betaBiomeTints.mjs`
            );
        }

        for (const file of readdirSync(clientBiomesDir).filter(f => f.endsWith(".client_biome.json"))) {
            const content = JSON.parse(readFileSync(resolve(clientBiomesDir, file), "utf-8"));
            const identifier = content["minecraft:client_biome"]?.description?.identifier;
            assert.ok(
                managed.has(identifier),
                `${file} defines '${identifier}', which the Beta biome table does not manage`
            );
        }
    });

    it("claims each Nether biome's fog and air, which vanilla's client biomes otherwise own", () => {
        // Beta's Nether was one red fog with nothing in the air, and a client biome file is what owns
        // both since 1.21.40. Vanilla's Nether client biomes are still there under the pack's, and
        // they declare the biome fogs, the ash and spores (`minecraft:precipitation`), the ambient
        // loops and the Nether's music — all of it from the Nether Update.
        for (const shortId of NETHER_BIOME_IDS) {
            const content = JSON.parse(readFileSync(resolve(clientBiomesDir, `${shortId}.client_biome.json`), "utf-8"));
            const components = content["minecraft:client_biome"].components;

            assert.equal(
                components["minecraft:fog_appearance"]?.fog_identifier,
                NETHER_CLIENT_FOG_ID,
                `${shortId} must wear the pack's one Nether fog`
            );
            assert.equal(
                components["minecraft:biome_music"]?.music_definition,
                "",
                `${shortId} must switch off the Nether's music rather than leave the component unset`
            );
            // Declared rather than left out: unset only removes the vanilla ash and spores when the
            // engine replaces the vanilla definition, and a zero density stops them either way.
            assert.equal(
                components["minecraft:precipitation"]?.ash,
                0,
                `${shortId} must declare a zero ash density`
            );
            assert.deepEqual(
                Object.keys(components).sort(),
                ["minecraft:biome_music", "minecraft:fog_appearance", "minecraft:precipitation"],
                `${shortId} may declare nothing else: no ambience or atmosphere`
            );
        }
    });

    it("wears the era's air fog on every Overworld biome, from the tint table's own sky colour", () => {
        // Beta's Overworld fog was one fog whose colour the client derived from the biome's sky
        // colour, so the biome layer is where it belongs, and `classic_water:default_fog` is the data
        // default that also sits underneath it. Both routes carry the era's values, which are derived
        // in the tint table rather than picked: a hand-chosen colour here is the regression.
        for (const shortId of OVERWORLD_BIOME_IDS) {
            const content = JSON.parse(readFileSync(resolve(clientBiomesDir, `${shortId}.client_biome.json`), "utf-8"));

            assert.equal(
                content["minecraft:client_biome"].components["minecraft:fog_appearance"]?.fog_identifier,
                OVERWORLD_CLIENT_FOG_ID,
                `${shortId} must wear the era's air fog`
            );
        }

        const fog = JSON.parse(
            readFileSync(resolve(process.cwd(), "packs/RP/fogs/classic_water_default_fog.json"), "utf-8")
        )["minecraft:fog_settings"];

        assert.deepEqual(
            fog.distance.air,
            OVERWORLD_AIR_FOG,
            "Beta's air fog is linear from a quarter of the render distance to the cull radius, not a 0.6/0.95 haze"
        );
    });

    it("has a derived tint for every profile the biome table defines, and no others", () => {
        // A profile without an entry would throw in the generator, and an entry for a profile no
        // biome uses is a value someone will copy from by mistake.
        assert.deepEqual(
            Object.keys(BETA_PROFILE_TINTS).sort(),
            Object.keys(BETA_PROFILES).sort(),
            "scripts/lib/betaBiomeTints.mjs must cover exactly the profiles in scripts/lib/betaBiomes.mjs"
        );
    });

    it("keeps the five land biomes distinct and does not collapse terrain onto one colour", () => {
        // Beta only gave the five generating biomes their own grass. The terrain profiles take the
        // map's colour at the climate each one declares, so a river no longer reads as an ocean and
        // a gravel shore no longer reads as a sand beach.
        const landTints = BETA_LAND_PROFILES.map(profile => resolveBiomeTint(profile).grass);
        assert.equal(
            new Set(landTints).size,
            landTints.length,
            "the five land biomes must each have their own grass colour"
        );

        for (const [terrain, neighbour] of [["river", "ocean"], ["gravel_beach", "beach"]]) {
            assert.notEqual(
                resolveBiomeTint(terrain).grass,
                resolveBiomeTint(neighbour).grass,
                `${terrain} must not read as ${neighbour}`
            );
        }
    });
});

describe("Beta 1.7.3 Colour Maps - What the Biome Sample Pixels Hold", () => {
    const colormapDir = resolve(process.cwd(), "packs/RP/textures/colormap");
    const clientBiomesDir = resolve(process.cwd(), "packs/RP/biomes");

    /** The shipped map, as the `buffer[y << 8 | x]` array the engine indexes. */
    function loadColormap(name: string) {
        const path = resolve(colormapDir, `${name}.png`);
        assert.ok(existsSync(path), `textures/colormap/${name}.png is missing; run \`npm run generate:colormaps\``);
        return toArgbBuffer(decodePng(readFileSync(path)));
    }

    it("ships a 256x256 colour map holding the planned tint at every pixel Bedrock samples", () => {
        // The plan is what the generator writes, so this is the guard against a stale or hand-edited
        // texture: the engine hard-codes a 256 stride, and `toArgbBuffer` rejects anything else.
        for (const name of COLORMAP_TEXTURES) {
            const decoded = decodePng(readFileSync(resolve(colormapDir, `${name}.png`)));
            assert.equal(decoded.width, 256, `${name}.png must be 256 wide`);
            assert.equal(decoded.height, 256, `${name}.png must be 256 tall`);

            const colormap = toArgbBuffer(decoded);
            for (const write of colormapWrites(name).values()) {
                assert.equal(
                    toHex(colormap[(write.y << 8) | write.x]),
                    toHex(write.argb),
                    `textures/colormap/${name}.png must hold ${write.biome}'s colour at (${write.x},${write.y})`
                );
            }
        }
    });

    it("reads the terrain profiles' colour off the map at the climate they declare", () => {
        // Beta gave terrain no biome of its own, so the profile's pinned colour *is* the map's
        // answer at its declared climate - which is what makes these profiles verifiable offline.
        for (const name of COLORMAP_TEXTURES) {
            const colormap = loadColormap(name);
            for (const [profile, entry] of Object.entries(BETA_PROFILES)) {
                if (BETA_LAND_PROFILES.includes(profile)) {
                    continue;
                }
                const { x, y } = colormapCoordinate(entry.climate.temperature, entry.climate.downfall);
                assert.equal(
                    toHex(colormap[(y << 8) | x]),
                    resolveBiomeTint(profile)[name],
                    `${profile} must carry the map's colour at its declared climate`
                );
            }
        }
    });

    it("keeps a shared pixel from costing a biome its colour", () => {
        // One pixel serves a whole group, and this pack renders some of those groups differently.
        // The biome that lost the pixel still renders its own tint, because its client biome file
        // pins it, and the group's pixel keeps the colour of the biome whose climate is nearest.
        for (const name of COLORMAP_TEXTURES) {
            // The load is for its own assertions; this case reads the client biome files, not the pixels.
            loadColormap(name);
            for (const shortId of OVERWORLD_BIOME_IDS) {
                const [x, y] = biomeSamplePoint(shortId);
                if (!colormapWrites(name).get(`${x},${y}`).contested.includes(shortId)) {
                    continue;
                }
                const content = JSON.parse(readFileSync(resolve(clientBiomesDir, `${shortId}.client_biome.json`), "utf-8"));
                const component = name === "grass" ? "minecraft:grass_appearance" : "minecraft:foliage_appearance";
                assert.equal(
                    content["minecraft:client_biome"].components[component].color,
                    resolveBiomeTint(OVERWORLD_BIOME_PROFILE[shortId])[name],
                    `${shortId} lost the shared pixel at (${x},${y}) and must still pin its own tint`
                );
            }
        }
    });
});
