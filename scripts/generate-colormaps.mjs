#!/usr/bin/env node
/**
 * Rebuilds the biome colour maps the resource pack ships, from Beta 1.7.3's own maps.
 *
 *   node scripts/generate-colormaps.mjs [colormapDir]           # write both textures
 *   node scripts/generate-colormaps.mjs [colormapDir] --check    # verify on-disk output, exit 1 otherwise
 *
 * The Beta maps are Mojang assets and are not committed. Point this at a directory holding copies of
 * `misc/grasscolor.png` and `misc/foliagecolor.png` from a b1.7.3 client — the defaults below read
 * from `.scratch/`, and the stock files are 25237 and 17693 bytes. See scripts/lib/betaColormap.mjs
 * for what is changed on the way through.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyColormapWrites, colormapWrites, encodeColormapPng, COLORMAP_TEXTURES } from "./lib/betaColormap.mjs";
import { decodePng, toArgbBuffer, toHex } from "./lib/betaColorizer.mjs";
import { OVERWORLD_BIOME_IDS } from "./lib/betaBiomes.mjs";
import { measuredSamplePoint } from "./lib/bedrockColormapSamples.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const directory = resolve(root, args.find(argument => !argument.startsWith("--")) ?? ".scratch");
const targetDirectory = resolve(root, "packs/RP/textures/colormap");

const unmeasured = OVERWORLD_BIOME_IDS.filter(shortId => !measuredSamplePoint(shortId));
const problems = [];

if (!check) {
    mkdirSync(targetDirectory, { recursive: true });
}

for (const map of COLORMAP_TEXTURES) {
    const source = resolve(directory, `${map}color.png`);
    if (!existsSync(source)) {
        console.error(
            `Could not read ${source}. Copy grasscolor.png and foliagecolor.png from a b1.7.3 client into ${directory}.`
        );
        process.exit(1);
    }

    const base = toArgbBuffer(decodePng(readFileSync(source)));
    const writes = colormapWrites(map);
    const plane = applyColormapWrites(base, writes);
    const png = encodeColormapPng(plane);
    const target = resolve(targetDirectory, `${map}.png`);

    if (check) {
        if (!existsSync(target)) {
            problems.push(`textures/colormap/${map}.png is missing`);
            continue;
        }
        if (!readFileSync(target).equals(png)) {
            problems.push(`textures/colormap/${map}.png is out of date with scripts/lib/betaColormap.mjs`);
            continue;
        }
    } else {
        writeFileSync(target, png);
    }

    const contested = [...writes.values()].filter(write => write.contested.length > 0);
    console.log(
        `${map}.png  ${writes.size} sampled pixels, ${contested.length} carrying a colour another ` +
            "biome also wanted"
    );
    for (const write of contested) {
        console.log(
            `  (${write.x},${write.y}) ${toHex(write.argb)} from ${write.biome} (${write.profile}); ` +
                `also wanted by ${write.contested.join(", ")}`
        );
    }
}

if (check && problems.length > 0) {
    console.error("Colormap generation check failed:");
    for (const problem of problems) {
        console.error(`  - ${problem}`);
    }
    process.exit(1);
}

console.log(
    check
        ? "Colormap generation check passed."
        : `Generated ${COLORMAP_TEXTURES.length} colormaps into packs/RP/textures/colormap.`
);
if (unmeasured.length > 0) {
    console.log(
        `No measured sample point for ${unmeasured.length} biome(s) added after the 1.21.11 template ` +
            `(${unmeasured.join(", ")}); they were written at the pixel their declared climate addresses.`
    );
}
