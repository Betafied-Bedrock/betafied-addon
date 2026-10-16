#!/usr/bin/env node
/**
 * Emits the per-biome resource-pack client biome files: the Overworld ones that tint grass and
 * foliage with the Beta 1.7.3 colours from scripts/lib/betaBiomeTints.mjs, and the Nether ones that
 * carry the era's single fog with none of the Nether Update's air, ambience or music.
 *
 *   node scripts/generate-client-biomes.mjs           # write packs/RP/biomes/*.client_biome.json
 *   node scripts/generate-client-biomes.mjs --check   # verify on-disk output matches, exit 1 otherwise
 *
 * Stale files are removed by identifier so a rename never leaves two definitions of the same biome
 * behind.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NETHER_BIOME_IDS, OVERWORLD_BIOME_IDS, OVERWORLD_BIOME_PROFILE, biomeIdentifier } from "./lib/betaBiomes.mjs";
import { buildClientBiome, buildNetherClientBiome } from "./lib/betaBiomeTints.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const biomesDir = resolve(root, "packs/RP/biomes");
const check = process.argv.includes("--check");

const planned = Object.freeze([
    ...OVERWORLD_BIOME_IDS.map((shortId) => [shortId, buildClientBiome(shortId, OVERWORLD_BIOME_PROFILE[shortId])]),
    ...NETHER_BIOME_IDS.map((shortId) => [shortId, buildNetherClientBiome(shortId)])
]);

const managed = new Set(planned.map(([shortId]) => biomeIdentifier(shortId)));
const problems = [];

function readIdentifier(path) {
    try {
        return JSON.parse(readFileSync(path, "utf-8"))["minecraft:client_biome"]?.description?.identifier ?? null;
    } catch {
        return null;
    }
}

if (existsSync(biomesDir)) {
    for (const file of readdirSync(biomesDir).filter(f => f.endsWith(".client_biome.json"))) {
        const path = resolve(biomesDir, file);
        const identifier = readIdentifier(path);

        if (identifier && managed.has(identifier) && !check) {
            rmSync(path);
        }
    }
} else if (!check) {
    mkdirSync(biomesDir, { recursive: true });
}

for (const [shortId, definition] of planned) {
    const target = resolve(biomesDir, `${shortId}.client_biome.json`);
    const expected = `${JSON.stringify(definition, null, 2)}\n`;

    if (check) {
        if (!existsSync(target)) {
            problems.push(`${shortId}.client_biome.json is missing`);
            continue;
        }
        if (readFileSync(target, "utf-8") !== expected) {
            problems.push(`${shortId}.client_biome.json is out of date with scripts/lib/betaBiomeTints.mjs`);
        }
        continue;
    }

    writeFileSync(target, expected);
}

if (check && problems.length > 0) {
    console.error("Client biome generation check failed:");
    for (const problem of problems) {
        console.error(`  - ${problem}`);
    }
    process.exit(1);
}

console.log(
    check
        ? `Client biome generation check passed (${planned.length} biomes).`
        : `Generated ${planned.length} client biome files.`
);
