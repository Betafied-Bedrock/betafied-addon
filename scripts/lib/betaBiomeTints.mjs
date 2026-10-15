/**
 * Canonical Beta 1.7.3 grass and foliage tints, and the resource-pack client biome definitions that
 * carry them.
 *
 * Beta never stored a tint per biome: the client computed it from the block's climate through a
 * 256x256 colormap (`ColorizerGrass` / `ColorizerFoliage`). The five land biomes are therefore
 * derived by `scripts/derive-biome-colors.mjs`, which walks Beta's whole (temperature, rainfall)
 * plane, classifies each point with Beta's own `BiomeGenBase.getBiome`, samples the colorizer and
 * averages the points that land in each biome — the colour a player saw on an average block of that
 * biome, not a swatch picked at a single climate point.
 *
 * The terrain profiles (ocean, beach, gravel shore, river, cave) have no Beta biome behind them:
 * they are terrain the engine still insists on calling a biome, so each one takes the colormap's
 * answer at the climate the profile itself declares in `scripts/lib/betaBiomes.mjs`. That is the
 * same reading `scripts/generate-colormaps.mjs` writes into the shipped colormap, which is why a
 * warm ocean and a cold river no longer share one flat average.
 *
 * `sky` is the mean of `BiomeGenBase.getSkyColorByTemp` over the same climate-plane points for the
 * land biomes, and its value at the declared temperature for the terrain ones, so it shares the
 * grass/foliage methodology: Beta's sky shifted with the temperature under the player rather than
 * being one constant.
 *
 * Source colormaps: b1.7.3 `misc/grasscolor.png` (25237 bytes) and `misc/foliagecolor.png` (17693
 * bytes), both 256x256 RGBA. They are Mojang assets, so they are not committed; re-run the
 * derivation if the source is ever replaced.
 */
import { biomeIdentifier } from "./betaBiomes.mjs";

export const CLIENT_BIOME_FORMAT_VERSION = "1.26.0";

/** Profile name -> the Beta biome that profile stands for, with its derived tints. */
export const BETA_PROFILE_TINTS = Object.freeze({
    forest: Object.freeze({ betaBiome: "forest", grass: "#79C153", foliage: "#58B029", sky: "#79A7FF" }),
    plains: Object.freeze({ betaBiome: "plains", grass: "#97BE4B", foliage: "#7DAD1E", sky: "#77A9FF" }),
    desert: Object.freeze({ betaBiome: "desert", grass: "#B1B953", foliage: "#9EA728", sky: "#77A9FF" }),
    taiga: Object.freeze({ betaBiome: "taiga", grass: "#86B978", foliage: "#68A756", sky: "#7CA4FF" }),
    swampland: Object.freeze({ betaBiome: "swampland", grass: "#78BF60", foliage: "#56AE38", sky: "#7AA6FF" }),
    ocean: Object.freeze({ betaBiome: null, grass: "#8EB971", foliage: "#71A74D", sky: "#7BA5FF" }),
    beach: Object.freeze({ betaBiome: null, grass: "#91BD59", foliage: "#77AB2F", sky: "#79A7FF" }),
    gravel_beach: Object.freeze({ betaBiome: null, grass: "#8DB681", foliage: "#70A360", sky: "#7DA4FF" }),
    river: Object.freeze({ betaBiome: null, grass: "#85BD5E", foliage: "#67AC36", sky: "#7AA6FF" }),
    cave: Object.freeze({ betaBiome: null, grass: "#8EB971", foliage: "#71A74D", sky: "#7BA5FF" })
});

/**
 * Throws rather than falling back: a profile with no derived colour would silently render the
 * default one, and every profile in `BETA_PROFILES` is meant to have an entry here.
 */
export function resolveBiomeTint(profileName) {
    const tint = BETA_PROFILE_TINTS[profileName];
    if (!tint) {
        throw new Error(`No derived Beta tint for profile '${profileName}'`);
    }
    return tint;
}

/**
 * A fixed `#rrggbb` rather than a `{ color_map: ... }` reference: the pinned colour is what the
 * generator writes into the shipped colormap at this biome's sample pixel, so the two mechanisms
 * agree by construction, and a pinned literal cannot be moved by a future change to the engine's
 * colormap addressing.
 */
export function buildClientBiome(shortId, profileName) {
    const tint = resolveBiomeTint(profileName);

    return {
        format_version: CLIENT_BIOME_FORMAT_VERSION,
        "minecraft:client_biome": {
            description: { identifier: biomeIdentifier(shortId) },
            components: {
                "minecraft:grass_appearance": { color: tint.grass },
                "minecraft:foliage_appearance": { color: tint.foliage },
                "minecraft:sky_color": { sky_color: tint.sky }
            }
        }
    };
}
