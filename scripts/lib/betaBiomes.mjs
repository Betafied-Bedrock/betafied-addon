/**
 * Canonical Beta 1.7.3 biome climate table.
 *
 * The pack defines no Overworld biome any more. The world ships pre-generated in the world template,
 * so nothing here can shape Overworld terrain, tags or spawning: those come from Bedrock's own biome
 * definitions. What survives is the half a template cannot carry — the colour a biome renders.
 * `OVERWORLD_BIOME_PROFILE` maps every vanilla Overworld biome id onto one of Beta's profiles, and
 * that profile's climate is the coordinate its grass, foliage and sky are read at.
 *
 * Beta 1.7.3 defined ten Overworld biomes in code, but only five ever generated. The Adventure
 * Update's changelog is explicit that Rain Forest, Seasonal Forest, Shrubland, Savanna, Tundra and
 * Ice Desert "did not generate in previous versions, so their removal was not noticeable".
 * Ice Desert and Sky were never reachable at all. That leaves the five real land biomes — Forest,
 * Plains, Desert, Taiga and Swampland — and snowy ground only ever appeared as Taiga.
 *
 * The Nether is still generated live, so its five definitions are still emitted from this table by
 * `scripts/generate-biomes.mjs`; the Overworld half feeds the appearance generators in
 * `scripts/generate-client-biomes.mjs` and `scripts/generate-colormaps.mjs` only.
 */

/**
 * Beta's climate per profile, on Bedrock's -0.5..2.0 temperature and 0..1 downfall ranges, standing
 * in for Beta's temperature and rainfall percentages. Climate is all that is left here: it is the
 * coordinate the colormap and the derived tints are read at, so it is what decides the colour a
 * player sees. Taiga sits at 0.05 so precipitation falls as snow, which is the only way snow
 * appeared on land in Beta; there was no separate tundra biome in practice.
 */
export const BETA_PROFILES = Object.freeze({
    forest: { climate: { temperature: 0.7, downfall: 0.8, snow_accumulation: [0, 0] } },
    plains: { climate: { temperature: 0.8, downfall: 0.4, snow_accumulation: [0, 0] } },
    desert: { climate: { temperature: 2.0, downfall: 0.0, snow_accumulation: [0, 0] } },
    taiga: { climate: { temperature: 0.05, downfall: 0.5, snow_accumulation: [0, 0.125] } },
    swampland: { climate: { temperature: 0.65, downfall: 0.9, snow_accumulation: [0, 0] } },
    ocean: { climate: { temperature: 0.5, downfall: 0.5, snow_accumulation: [0, 0] } },
    beach: { climate: { temperature: 0.8, downfall: 0.4, snow_accumulation: [0, 0] } },
    gravel_beach: { climate: { temperature: 0.3, downfall: 0.4, snow_accumulation: [0, 0] } },
    river: { climate: { temperature: 0.7, downfall: 0.6, snow_accumulation: [0, 0] } },
    cave: { climate: { temperature: 0.5, downfall: 0.5, snow_accumulation: [0, 0] } }
});

/**
 * Bedrock Overworld biome (bare identifier) -> Beta profile.
 *
 * Biomes added after Beta collapse onto the one of the five that their climate most resembles:
 * jungles and mushroom islands to forest, savannas and mushroom shores to plains, badlands to
 * desert, and every snowy peak or cold forest to the single snowy biome Beta had, taiga.
 */
export const OVERWORLD_BIOME_PROFILE = Object.freeze({
    // Forest (including jungle and roofed forest, which postdate Beta)
    forest: "forest",
    forest_hills: "forest",
    birch_forest: "forest",
    birch_forest_hills: "forest",
    birch_forest_mutated: "forest",
    birch_forest_hills_mutated: "forest",
    flower_forest: "forest",
    roofed_forest: "forest",
    roofed_forest_mutated: "forest",
    pale_garden: "forest",
    cherry_grove: "forest",
    jungle: "forest",
    jungle_hills: "forest",
    jungle_edge: "forest",
    jungle_mutated: "forest",
    jungle_edge_mutated: "forest",
    bamboo_jungle: "forest",
    bamboo_jungle_hills: "forest",
    extreme_hills: "forest",
    extreme_hills_edge: "forest",
    extreme_hills_mutated: "forest",
    extreme_hills_plus_trees: "forest",
    extreme_hills_plus_trees_mutated: "forest",
    stony_peaks: "forest",
    meadow: "forest",
    dappled_forest: "forest",

    // Plains (savanna and mushroom islands did not exist in Beta)
    plains: "plains",
    sunflower_plains: "plains",
    savanna: "plains",
    savanna_mutated: "plains",
    savanna_plateau: "plains",
    savanna_plateau_mutated: "plains",
    mushroom_island: "plains",
    mushroom_island_shore: "plains",

    // Desert (terracotta badlands collapse back to sand and sandstone)
    desert: "desert",
    desert_hills: "desert",
    desert_mutated: "desert",
    mesa: "desert",
    mesa_bryce: "desert",
    mesa_plateau: "desert",
    mesa_plateau_mutated: "desert",
    mesa_plateau_stone: "desert",
    mesa_plateau_stone_mutated: "desert",

    // Taiga — Beta's one cold, snowy biome. The genuine taiga ids keep their snow.
    taiga: "taiga",
    taiga_hills: "taiga",
    taiga_mutated: "taiga",
    cold_taiga: "taiga",
    cold_taiga_hills: "taiga",
    cold_taiga_mutated: "taiga",
    mega_taiga: "taiga",
    mega_taiga_hills: "taiga",
    redwood_taiga_mutated: "taiga",
    redwood_taiga_hills_mutated: "taiga",

    // The modern climate map paints these cold zones with the same snowy ground Beta only had in
    // taiga, and the engine — not this table — decides where the zones sit. Since a biome file
    // cannot move them, the frozen-peak and ice-plain ids are folded onto the temperate biome
    // their terrain most resembles, so a cold zone reads as forested hills or plains rather than
    // yet another snowy spruce forest. Taiga and cold_taiga stay snowy as Beta's one cold biome.
    ice_plains: "plains",
    ice_plains_spikes: "plains",
    ice_mountains: "forest",
    frozen_peaks: "forest",
    jagged_peaks: "forest",
    snowy_slopes: "forest",
    grove: "forest",

    // Swampland
    swamp: "swampland",
    swampland: "swampland",
    swampland_mutated: "swampland",
    mangrove_swamp: "swampland",

    // Terrain features that Bedrock still models as biomes
    beach: "beach",
    cold_beach: "gravel_beach",
    stone_beach: "gravel_beach",
    ocean: "ocean",
    lukewarm_ocean: "ocean",
    warm_ocean: "ocean",
    cold_ocean: "ocean",
    deep_ocean: "ocean",
    deep_lukewarm_ocean: "ocean",
    deep_warm_ocean: "ocean",
    deep_cold_ocean: "ocean",
    // Beta's sea never froze; the engine's cold climate zones just inherit an ice sheet. Rendering
    // them as ordinary water keeps the ocean from reading as one endless frozen expanse.
    frozen_ocean: "ocean",
    legacy_frozen_ocean: "ocean",
    deep_frozen_ocean: "ocean",
    river: "river",
    frozen_river: "river",

    // Cave biomes never break the surface, but scrubbing their tags keeps sculk, dripstone and
    // azalea out of the vanilla feature rules.
    deep_dark: "cave",
    dripstone_caves: "cave",
    lush_caves: "cave",
    sulfur_caves: "cave"
});

/** Land biomes that actually generated in Beta 1.7.3. */
export const BETA_LAND_PROFILES = Object.freeze(["forest", "plains", "desert", "taiga", "swampland"]);

export function biomeIdentifier(shortId) {
    return `minecraft:${shortId}`;
}

/**
 * Bedrock models the Nether as five biomes. Beta 1.7.3 had a single "Hell", so every one is
 * overridden with the same netherrack-and-lava definition and the classic ghast / zombie pigman
 * tags. These are direct identifier overrides rather than minecraft:replace_biomes, which is still
 * experimental and rejects the nether dimension outright.
 */
export const NETHER_BIOME_IDS = Object.freeze([
    // The original Nether biome is `minecraft:hell` in the engine's data; `nether_wastes` only
    // exists as a biome *tag*, so an override keyed to it would never replace the real thing.
    "hell",
    "soulsand_valley",
    "crimson_forest",
    "warped_forest",
    "basalt_deltas"
]);

const NETHER_SURFACE = Object.freeze({
    type: "minecraft:overworld",
    sea_floor_depth: 1,
    top_material: "minecraft:netherrack",
    mid_material: "minecraft:netherrack",
    foundation_material: "minecraft:netherrack",
    sea_material: "minecraft:lava",
    sea_floor_material: "minecraft:netherrack"
});

// Scattered soul sand and gravel, the only surface variation Beta's Nether had. The gravel beach is
// listed last because adjustments are applied in order and later entries win where they overlap, so
// the shoreline rule takes precedence over the scatter rule near the lava.
const NETHER_ADJUSTMENTS = Object.freeze([
    {
        materials: { top_material: "minecraft:soul_sand", sea_floor_material: "minecraft:soul_sand" },
        noise_frequency_scale: 0.08,
        noise_range: [0.42, 0.5]
    },
    {
        materials: { top_material: "minecraft:gravel", sea_floor_material: "minecraft:gravel" },
        noise_frequency_scale: 0.12,
        noise_range: [0.6, 0.66]
    },
    {
        // Gravel ringed the lava seas, which is what makes a shore read as a beach instead of a
        // wall of netherrack. The sea-level height band is the beach; the noise band is what keeps
        // it uncommon — vanilla hands its shores the whole lower half of the range, and Beta's
        // gravel was rarer than that.
        materials: { top_material: "minecraft:gravel", sea_floor_material: "minecraft:gravel" },
        height_range: ["variable.sea_level - 3", "variable.sea_level + 2"],
        noise_frequency_scale: 0.03125,
        noise_range: [-1.0, -0.6]
    }
]);

function copyAdjustment(adjustment) {
    const rule = {
        materials: { ...adjustment.materials },
        noise_frequency_scale: adjustment.noise_frequency_scale,
        noise_range: [...adjustment.noise_range]
    };
    if (adjustment.height_range) {
        rule.height_range = [...adjustment.height_range];
    }
    return rule;
}

export function buildNetherBiome(shortId) {
    return {
        format_version: "1.26.0",
        "minecraft:biome": {
            description: { identifier: biomeIdentifier(shortId) },
            components: {
                "minecraft:climate": { temperature: 2, downfall: 0, snow_accumulation: [0, 0.125] },
                "minecraft:surface_builder": { builder: { ...NETHER_SURFACE } },
                "minecraft:surface_material_adjustments": {
                    adjustments: NETHER_ADJUSTMENTS.map(copyAdjustment)
                },
                "minecraft:tags": { tags: ["nether", "monster", "spawn_ghast", "spawn_zombified_piglin"] }
            }
        }
    };
}

/** Bedrock biomes that are not overwritten by this table and must survive generation. */
export const UNMANAGED_BIOME_IDENTIFIERS = Object.freeze(["minecraft:the_end"]);

/**
 * Identifiers this table used to emit and must now delete, so a corrected id never leaves the
 * superceded override behind as a stray file.
 */
export const RETIRED_BIOME_IDENTIFIERS = Object.freeze(["minecraft:nether_wastes"]);

export const OVERWORLD_BIOME_IDS = Object.freeze(Object.keys(OVERWORLD_BIOME_PROFILE));
