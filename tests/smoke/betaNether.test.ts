import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { NETHER_BIOME_IDS, buildNetherBiome } from "../../scripts/lib/betaBiomes.mjs";
import { compareText } from "../support/text.js";

describe("Beta 1.7.3 Nether Contract", () => {
    const root = process.cwd();
    const biomesDir = resolve(root, "packs/BP/biomes");

    const readBiome = (shortId: string) =>
        JSON.parse(readFileSync(resolve(biomesDir, `${shortId}.json`), "utf-8"))["minecraft:biome"];

    it("overrides every vanilla Nether biome and nothing else", () => {
        // minecraft:replace_biomes is experimental and rejects the nether dimension, so the Nether
        // is claimed the same way the Overworld is: one override per vanilla biome identifier.
        const netherBiomes = readdirSync(biomesDir)
            .filter(f => f.endsWith(".json"))
            .map(f => JSON.parse(readFileSync(resolve(biomesDir, f), "utf-8"))["minecraft:biome"])
            .filter(b => (b.components?.["minecraft:tags"]?.tags ?? []).includes("nether"));

        assert.deepEqual(
            netherBiomes.map(b => b.description.identifier).sort(compareText),
            NETHER_BIOME_IDS.map(id => `minecraft:${id}`).sort(compareText),
            "The Nether must be the five vanilla biomes overridden, with no custom-only biome"
        );
    });

    it("keeps the shipped Nether files identical to the canonical table", () => {
        for (const shortId of NETHER_BIOME_IDS) {
            const expected = `${JSON.stringify(buildNetherBiome(shortId), null, 2)}\n`;
            const actual = readFileSync(resolve(biomesDir, `${shortId}.json`), "utf-8");
            assert.equal(actual, expected, `${shortId}.json is out of date with scripts/lib/betaBiomes.mjs`);
        }
    });

    it("generates only Beta terrain — netherrack, lava, and a gravel beach on the lava seas", () => {
        for (const shortId of NETHER_BIOME_IDS) {
            const components = readBiome(shortId).components;
            const builder = components["minecraft:surface_builder"].builder;

            assert.equal(builder.top_material, "minecraft:netherrack");
            assert.equal(builder.mid_material, "minecraft:netherrack");
            assert.equal(builder.foundation_material, "minecraft:netherrack");
            assert.equal(builder.sea_material, "minecraft:lava");

            const adjustments = components["minecraft:surface_material_adjustments"].adjustments;
            // Last entry wins where rules overlap, so the shoreline rule must come after the
            // scattered-gravel rule or the beach never gets a chance to apply.
            const beach = adjustments[adjustments.length - 1];

            assert.equal(beach.materials.top_material, "minecraft:gravel");
            assert.equal(beach.materials.sea_floor_material, "minecraft:gravel");
            assert.deepEqual(beach.height_range, ["variable.sea_level - 3", "variable.sea_level + 2"]);
            assert.ok(beach.noise_range[1] <= -0.5, "the beach must be uncommon, not a coastline");
        }
    });

    it("wears Beta's red fog on every Nether biome, not the Overworld's blue one", () => {
        const clientBiomes = JSON.parse(
            readFileSync(resolve(root, "packs/RP/biomes_client.json"), "utf-8")
        ).biomes;

        for (const shortId of NETHER_BIOME_IDS) {
            assert.equal(
                clientBiomes[shortId]?.fog_identifier,
                "mgg:fog_hell",
                `${shortId} must use the Nether's red fog`
            );

            // `biomes_client.json` is the route for worlds below base game version 1.21.40. From there
            // on a client biome file owns a biome's fog, and vanilla ships one per Nether biome, so
            // the pack has to claim each of them for the era's colour to be the one on screen.
            const client = JSON.parse(
                readFileSync(resolve(root, `packs/RP/biomes/${shortId}.client_biome.json`), "utf-8")
            )["minecraft:client_biome"];

            assert.equal(
                client.components["minecraft:fog_appearance"]?.fog_identifier,
                "mgg:fog_hell",
                `${shortId}.client_biome.json must wear the same fog as biomes_client.json`
            );
        }

        const fog = JSON.parse(
            readFileSync(resolve(root, "packs/RP/fogs/hell_fog_setting.json"), "utf-8")
        )["minecraft:fog_settings"];

        assert.equal(fog.description.identifier, "mgg:fog_hell", "the id the biomes above point at");
        assert.equal(fog.distance.air.fog_color.toLowerCase(), "#330808", "Beta's hardcoded Nether colour, 0.2/0.03/0.03");
    });

    it("blanks every Nether ambient loop in the pack's own sound definitions", () => {
        // The client biome files omit `minecraft:ambient_sounds`, which only silences the loops when
        // the engine replaces the vanilla component rather than merging into it. A definition whose
        // sound list is empty is silent either way, so each Nether family is blanked the way the pack
        // already blanked `ambient.nether_wastes`.
        const definitions = JSON.parse(
            readFileSync(resolve(root, "packs/RP/sounds/sound_definitions.json"), "utf-8")
        ).sound_definitions;

        for (const biome of ["nether_wastes", "crimson_forest", "warped_forest", "soulsand_valley", "basalt_deltas"]) {
            for (const part of ["additions", "loop", "mood"]) {
                const event = `ambient.${biome}.${part}`;
                assert.deepEqual(definitions[event]?.sounds, [], `${event} must be blanked, not left to vanilla`);
            }
        }

        // Cave sounds are the one Nether ambience the era has, so Beta's must stay audible.
        assert.ok(definitions["ambient.cave"].sounds.length > 0, "the era's cave ambience must keep its sounds");
    });

    it("spawns only the classic Ghast and Zombie Pigman", () => {
        for (const shortId of NETHER_BIOME_IDS) {
            const tags = readBiome(shortId).components["minecraft:tags"].tags;

            assert.ok(tags.includes("nether"), "Spawn rules key off the vanilla nether tag");
            assert.ok(tags.includes("spawn_ghast"));
            assert.ok(tags.includes("spawn_zombified_piglin"));

            for (const ghost of ["spawn_endermen", "spawn_piglin", "spawn_magma_cubes", "spawn_many_magma_cubes", "spawn_few_piglins", "spawn_few_zombified_piglins"]) {
                assert.ok(!tags.includes(ghost), `${shortId} must not carry the post-Beta '${ghost}' tag`);
            }
        }
    });
});
