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
 *
 * The five Nether biomes are emitted from here too, although the era gave them no tint to derive: a
 * client biome file is also what owns a biome's fog, its ambience and its airborne particles, and
 * leaving vanilla's Nether client biomes in place is what hung the Nether Update's ash, spores,
 * ambient loops and music over the pack's Nether.
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
 *
 * `minecraft:fog_appearance` is what claims the biome's fog on game versions where the client biome
 * file owns it, which is the layer the era's biome-dependent fog colour needs; the values are the
 * era's, derived below rather than chosen.
 */
export function buildClientBiome(shortId, profileName) {
    const tint = resolveBiomeTint(profileName);

    return {
        format_version: CLIENT_BIOME_FORMAT_VERSION,
        "minecraft:client_biome": {
            description: { identifier: biomeIdentifier(shortId) },
            components: {
                "minecraft:fog_appearance": { fog_identifier: OVERWORLD_CLIENT_FOG_ID },
                "minecraft:grass_appearance": { color: tint.grass },
                "minecraft:foliage_appearance": { color: tint.foliage },
                "minecraft:sky_color": { sky_color: tint.sky }
            }
        }
    };
}

/** b1.7.3 `WorldProvider.getFogColor` at full day, where both of its day scales are exactly 1. */
const ERA_FOG_PROVIDER = Object.freeze([0.7529412, 0.84705883, 1.0]);

/** b1.7.3 `EntityRenderer.updateFogColor`: the weight the biome sky colour carried at Far. */
const ERA_SKY_FOG_WEIGHT = 1 - Math.pow(1 / 4, 0.25);

function parseTint(hex) {
    return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function toHex(channels) {
    return `#${channels
        .map(channel => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).toUpperCase().padStart(2, "0"))
        .join("")}`;
}

/**
 * Mean over the profiles, each once: the era's biome spread lands inside one 8-bit step, so the mix
 * is applied per profile and averaged rather than pretending the biomes differ. A sky tint change in
 * the table above moves this colour, which is the point of deriving it here.
 */
function eraOverworldFogColor() {
    const mixed = Object.values(BETA_PROFILE_TINTS).map(({ sky }) =>
        ERA_FOG_PROVIDER.map((provider, index) => {
            const biome = parseTint(sky)[index];
            return provider + (biome - provider) * ERA_SKY_FOG_WEIGHT;
        })
    );

    return toHex(mixed[0].map((_, index) => mixed.reduce((sum, channels) => sum + channels[index], 0) / mixed.length));
}

/**
 * The era's Overworld air fog, derived from the sky tints above rather than picked.
 *
 * Beta ran one linear air fog per dimension: `GL_FOG_START = farPlaneDistance * 0.25` and
 * `GL_FOG_END = farPlaneDistance`, where `farPlaneDistance` was the terrain cull radius in blocks
 * (b1.7.3 `EntityRenderer.setupFog`). Bedrock's `render` type multiplies by the player's own render
 * distance, so the era's pair survives as ratios: a quarter of the way out, ending at the cull.
 *
 * The colour was recomputed every frame — `WorldProvider.getFogColor`'s `#C0D8FF` at full day, mixed
 * toward the biome's own sky colour by `1 - (1 / (4 - renderDistanceIndex))^0.25` (0.293 at the era's
 * Far setting), then darkened by rain, thunder and the camera's sky light. Bedrock reads `fog_color`
 * as a constant, so this is the clear-noon value that curve starts from, mixed over the profiles'
 * mean sky colour with the same 0.293 weight. A per-biome file each would say the same thing ten
 * times: the era's own biome spread lands inside one 8-bit step, which is why one fog serves all.
 */
export const OVERWORLD_CLIENT_FOG_ID = "classic_water:default_fog";

export const OVERWORLD_AIR_FOG = Object.freeze({
    fog_start: 0.25,
    fog_end: 1.0,
    fog_color: eraOverworldFogColor(),
    render_distance_type: "render"
});

/**
 * The pack's one Nether fog, and the id `packs/RP/biomes_client.json` maps every Nether biome to.
 * Beta had a single hardcoded Nether colour rather than a per-biome one, so all five share it.
 *
 * It is the same shape as the Overworld's above — one fog for the dimension, claimed by every biome
 * — but its own file, because the era's Nether opened its fog at the camera and was a different
 * colour: `WorldProviderHell` set `foggy` and `getFogColor` returned 0.2/0.03/0.03.
 */
export const NETHER_CLIENT_FOG_ID = "mgg:fog_hell";

/**
 * A pack's client biome file replaces the vanilla definition for its biome, so a component the era
 * did not have is left out: no `minecraft:ambient_sounds` (the biome loops and additions; the mood
 * falls back to the era's `ambient.cave`) and no `minecraft:atmosphere_identifier` or lighting
 * identifier. The two components declared anyway are the ones a merge rather than a replacement
 * would otherwise let through: a precipitation density of zero for the Nether Update's ash and
 * spores, and an empty music definition, which is the documented way to switch a biome's music off.
 * The Nether's ambient loops are blanked a second time in `packs/RP/sounds/sound_definitions.json`,
 * so they stay silent even if the vanilla `minecraft:ambient_sounds` component is the one that wins.
 */
export function buildNetherClientBiome(shortId) {
    return {
        format_version: CLIENT_BIOME_FORMAT_VERSION,
        "minecraft:client_biome": {
            description: { identifier: biomeIdentifier(shortId) },
            components: {
                "minecraft:fog_appearance": { fog_identifier: NETHER_CLIENT_FOG_ID },
                "minecraft:precipitation": { ash: 0 },
                "minecraft:biome_music": { music_definition: "" }
            }
        }
    };
}
