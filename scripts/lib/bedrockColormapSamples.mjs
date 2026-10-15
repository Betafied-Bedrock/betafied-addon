/**
 * Where Bedrock samples `textures/colormap/{grass,foliage}.png` for each biome.
 *
 * Bedrock does not document the coordinate it samples, but it is the one b1.7.3's
 * `ColorizerGrass.getGrassColor` used: `x = (1 - temperature) * 255` and
 * `y = (1 - temperature * rainfall) * 255`, both truncated. The table below is the 1.21.11 build's
 * own answer for the biomes that render through the map, transcribed row by row from the
 * "colormap template" (v9.1.1, December 2025) the maintainer supplied — a screenshot of a tool
 * that plots each biome's sample point, not an asset this pack ships.
 *
 * Two rows name a pixel inside a flat plateau rather than its corner: the hot, dry Desert/Savanna
 * group is (6,255) and Stony Peaks is (8,178). Those are the pixels the template reports, so they
 * are the pixels a write has to hit; the map holds one colour across the plateau either way.
 *
 * Rows are the template's rows: the pixel, then every biome that lands on it. `x` is the column and
 * `y` the row of `buffer[y << 8 | x]`, so the numbers are directly indexable. A group shares one
 * pixel, which is why a group can hold biomes that this pack renders differently — the client biome
 * files pin those apart (see scripts/lib/betaBiomeTints.mjs) and the generator resolves the pixel
 * once, for the group.
 *
 * Names are Bedrock identifiers. Java's "Sparse Jungle" is Bedrock's `jungle_edge`, Java's "Old
 * Growth Pine/Spruce Taiga" are Bedrock's `mega_taiga`/`redwood_taiga`, Java's "Windswept
 * Savanna/Hills" are Bedrock's `savanna_mutated`/`extreme_hills`. The Nether and End entries only
 * read the pixel — this pack gives them no grass tint of their own — but they are listed because
 * they share it, and a write there has to leave them something sensible.
 */
export const COLORMAP_SAMPLE_GROUPS = Object.freeze([
    Object.freeze({
        pixel: Object.freeze([6, 255]),
        biomes: Object.freeze([
            "desert", "desert_hills", "desert_mutated",
            "savanna", "savanna_mutated", "savanna_plateau", "savanna_plateau_mutated",
            "mesa", "mesa_bryce", "mesa_plateau", "mesa_plateau_mutated",
            "mesa_plateau_stone", "mesa_plateau_stone_mutated",
            // Readers only: Beta's Nether had no grass, and the template groups the netherrack
            // biomes with the hot, dry Overworld ones.
            "hell", "soulsand_valley", "crimson_forest", "warped_forest", "basalt_deltas"
        ])
    }),
    Object.freeze({ pixel: Object.freeze([8, 178]), biomes: Object.freeze(["stony_peaks"]) }),
    Object.freeze({ pixel: Object.freeze([12, 61]), biomes: Object.freeze(["jungle_edge", "jungle_edge_mutated"]) }),
    Object.freeze({
        pixel: Object.freeze([12, 36]),
        biomes: Object.freeze(["jungle", "jungle_hills", "jungle_mutated", "bamboo_jungle", "bamboo_jungle_hills"])
    }),
    Object.freeze({ pixel: Object.freeze([25, 25]), biomes: Object.freeze(["mushroom_island", "mushroom_island_shore"]) }),
    Object.freeze({
        pixel: Object.freeze([50, 173]),
        biomes: Object.freeze(["plains", "sunflower_plains", "beach", "dripstone_caves", "deep_dark"])
    }),
    Object.freeze({ pixel: Object.freeze([76, 112]), biomes: Object.freeze(["forest", "forest_hills", "flower_forest"]) }),
    Object.freeze({
        pixel: Object.freeze([101, 163]),
        biomes: Object.freeze([
            "birch_forest", "birch_forest_hills", "birch_forest_mutated", "birch_forest_hills_mutated"
        ])
    }),
    // Cherry grove is not on the template; its climate matches meadow's, so it lands on the same
    // pixel by the formula above rather than by measurement.
    Object.freeze({ pixel: Object.freeze([127, 152]), biomes: Object.freeze(["meadow", "cherry_grove"]) }),
    Object.freeze({
        pixel: Object.freeze([127, 191]),
        biomes: Object.freeze([
            "lush_caves", "river", "frozen_river",
            "ocean", "deep_ocean", "cold_ocean", "deep_cold_ocean", "frozen_ocean",
            "deep_frozen_ocean", "legacy_frozen_ocean", "lukewarm_ocean", "deep_lukewarm_ocean",
            "warm_ocean", "deep_warm_ocean",
            // Readers only: the End's climate does not exist in Beta, and the template paints it
            // with the ocean.
            "the_end"
        ])
    }),
    Object.freeze({
        pixel: Object.freeze([178, 193]),
        biomes: Object.freeze(["mega_taiga", "mega_taiga_hills", "redwood_taiga_mutated", "redwood_taiga_hills_mutated"])
    }),
    Object.freeze({ pixel: Object.freeze([191, 203]), biomes: Object.freeze(["taiga", "taiga_hills", "taiga_mutated"]) }),
    Object.freeze({
        pixel: Object.freeze([203, 239]),
        biomes: Object.freeze([
            "extreme_hills", "extreme_hills_edge", "extreme_hills_mutated",
            "extreme_hills_plus_trees", "extreme_hills_plus_trees_mutated",
            "stone_beach"
        ])
    }),
    Object.freeze({ pixel: Object.freeze([242, 251]), biomes: Object.freeze(["cold_beach"]) }),
    Object.freeze({
        pixel: Object.freeze([255, 255]),
        biomes: Object.freeze([
            "ice_plains", "ice_plains_spikes", "ice_mountains",
            "cold_taiga", "cold_taiga_hills", "cold_taiga_mutated",
            "snowy_slopes", "grove", "jagged_peaks", "frozen_peaks"
        ])
    })
]);

/** Biome -> its sample pixel, flattened out of the groups. */
export const BIOME_COLORMAP_SAMPLE = Object.freeze(
    Object.fromEntries(
        COLORMAP_SAMPLE_GROUPS.flatMap(group => group.biomes.map(biome => [biome, group.pixel]))
    )
);

/** The sampled pixel for a biome, or `null` when the template does not list it. */
export function measuredSamplePoint(shortId) {
    return BIOME_COLORMAP_SAMPLE[shortId] ?? null;
}
