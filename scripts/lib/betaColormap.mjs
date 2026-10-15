/**
 * The biome colour maps this pack ships, built from the real Beta 1.7.3 maps.
 *
 * Beta never stored a colour per biome: the client addressed the 256x256 map with the climate under
 * the block, so a biome's look came from *where in the map its climate sat*. Bedrock keeps the map
 * but asks its own question — one fixed pixel per biome (see scripts/lib/bedrockColormapSamples.mjs)
 * — so a map copied across unchanged answers the modern biome's climate, not the Beta one this pack
 * re-creates the biome from. That is the whole remap: the base plane stays Beta's, and the pixels
 * Bedrock samples for the biomes we ship are repointed to the colour this pack tints the biome with
 * (`BETA_PROFILE_TINTS`), which is Beta's own colour for the climate the biome declares.
 *
 * The five land biomes pin Beta's *region average* rather than the exact sample-point colour, so
 * their written pixels sit within 7/255 (grass) and 34/255 (foliage) of the colour Beta held at
 * that pixel. That is deliberate: the game has to agree with the pinned tint, and the tint is what
 * a player saw on an average block of the biome. Every other pixel is copied from Beta's map, so
 * anything we do not enumerate — the Nether, the End, an item tinted as if it stood in plains —
 * still reads Beta's answer for its climate.
 *
 * The source maps are Mojang assets and are read from a local directory at generation time only;
 * this module never touches the filesystem.
 */
import { deflateSync } from "node:zlib";
import { colormapCoordinate } from "./betaColorizer.mjs";
import { BETA_PROFILES, OVERWORLD_BIOME_IDS, OVERWORLD_BIOME_PROFILE } from "./betaBiomes.mjs";
import { resolveBiomeTint } from "./betaBiomeTints.mjs";
import { measuredSamplePoint } from "./bedrockColormapSamples.mjs";

/** The map names Bedrock resolves, and the file each one is read from. */
export const COLORMAP_TEXTURES = Object.freeze(["grass", "foliage"]);
export const COLORMAP_SIZE = 256;

function argbFromHex(hex) {
    return (0xff000000 | Number.parseInt(hex.slice(1), 16)) >>> 0;
}

/**
 * The pixel a biome's colour lands on. The template's measured point when it lists the biome, and
 * otherwise the pixel the biome's own declared climate addresses — the biomes Bedrock added after
 * that template was taken have no measured point, and this is where the engine samples them if it
 * honours the climate the behaviour pack declares.
 */
export function biomeSamplePoint(shortId) {
    const measured = measuredSamplePoint(shortId);
    if (measured) {
        return measured;
    }
    const { temperature, downfall } = BETA_PROFILES[OVERWORLD_BIOME_PROFILE[shortId]].climate;
    const { x, y } = colormapCoordinate(temperature, downfall);
    return [x, y];
}

/** The climate a sampled pixel stands for, read back the way the address is built. */
function pixelClimate(x, y) {
    const temperature = (COLORMAP_SIZE - 1 - x) / (COLORMAP_SIZE - 1);
    const humidity = (COLORMAP_SIZE - 1 - y) / (COLORMAP_SIZE - 1);
    return { temperature, rainfall: temperature > 0 ? Math.min(1, humidity / temperature) : 0 };
}

function climateDistance(x, y, profileName) {
    const climate = BETA_PROFILES[profileName].climate;
    const target = pixelClimate(x, y);
    const temperature = Math.min(1, Math.max(0, climate.temperature));
    const rainfall = Math.min(1, Math.max(0, climate.downfall));
    const rainfallGap = target.temperature > 0 ? Math.abs(target.rainfall - rainfall) : 0;
    return Math.abs(target.temperature - temperature) + rainfallGap;
}

/**
 * One write per sampled pixel, keyed "x,y". A pixel can belong to a group that this pack maps onto
 * different profiles — the snowy group holds ten biomes across four profiles — and a map can only
 * hold one colour there. The biome whose declared climate is closest to the pixel's own climate
 * wins, which keeps the plane coherent (a pixel that was already Beta's colour for that climate
 * stays put), and every other biome still renders its own tint because the client biome file pins
 * it. `contested` lists the biomes that lost, and only those that wanted a *different* colour: most
 * groups agree, and a shared pixel is not a conflict.
 */
export function colormapWrites(mapName) {
    const groups = new Map();

    for (const shortId of OVERWORLD_BIOME_IDS) {
        const profile = OVERWORLD_BIOME_PROFILE[shortId];
        const [x, y] = biomeSamplePoint(shortId);
        const key = `${x},${y}`;

        let group = groups.get(key);
        if (!group) {
            group = { x, y, candidates: [] };
            groups.set(key, group);
        }
        group.candidates.push({
            shortId,
            profile,
            argb: argbFromHex(resolveBiomeTint(profile)[mapName]),
            distance: climateDistance(x, y, profile)
        });
    }

    const writes = new Map();
    for (const [key, group] of groups) {
        const [winner, ...losers] = group.candidates
            .slice()
            .sort((a, b) => a.distance - b.distance || a.shortId.localeCompare(b.shortId));

        writes.set(key, {
            x: group.x,
            y: group.y,
            argb: winner.argb,
            biome: winner.shortId,
            profile: winner.profile,
            contested: losers.filter(loser => loser.argb !== winner.argb).map(loser => loser.shortId)
        });
    }
    return writes;
}

/** Copy Beta's plane and repoint the sampled pixels. */
export function applyColormapWrites(baseArgb, writes) {
    const plane = Uint32Array.from(baseArgb);
    for (const { x, y, argb } of writes.values()) {
        plane[(y << 8) | x] = argb;
    }
    return plane;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
});

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(body.length, 0);
    header.write(type, 4, "latin1");
    const trailer = Buffer.alloc(4);
    trailer.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), body])), 0);
    return Buffer.concat([header, body, trailer]);
}

/**
 * Encode an ARGB colormap as an 8-bit RGBA PNG, the inverse of `toArgbBuffer`. Rows carry filter
 * type 0: these planes are 256x256 and flat over large areas, so deflate does the work and the
 * filter search would only add code.
 */
export function encodeColormapPng(argb) {
    const raw = Buffer.alloc(COLORMAP_SIZE * (1 + COLORMAP_SIZE * 4));
    for (let y = 0; y < COLORMAP_SIZE; y++) {
        const row = y * (1 + COLORMAP_SIZE * 4);
        for (let x = 0; x < COLORMAP_SIZE; x++) {
            const value = argb[(y << 8) | x];
            const at = row + 1 + x * 4;
            raw[at] = (value >>> 16) & 0xff;
            raw[at + 1] = (value >>> 8) & 0xff;
            raw[at + 2] = value & 0xff;
            raw[at + 3] = (value >>> 24) & 0xff;
        }
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(COLORMAP_SIZE, 0);
    header.writeUInt32BE(COLORMAP_SIZE, 4);
    header[8] = 8;
    header[9] = 6;

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0))
    ]);
}
