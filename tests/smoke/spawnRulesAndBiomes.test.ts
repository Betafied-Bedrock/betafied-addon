import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

describe("Bedrock Natural Spawning Contract - Spawn Rules & Biome Integrity", () => {
    const root = process.cwd();
    const biomesDir = resolve(root, "packs/BP/biomes");
    const spawnRulesDir = resolve(root, "packs/BP/spawn_rules");

    it("gives every biome file a dimension tag, and every animal biome a spawn probability", () => {
        const biomeFiles = readdirSync(biomesDir).filter(f => f.endsWith(".json"));
        assert.ok(biomeFiles.length > 0, "Expected the pack's own biome definitions");

        for (const file of biomeFiles) {
            const content = JSON.parse(readFileSync(resolve(biomesDir, file), "utf-8"));
            const biome = content["minecraft:biome"];
            assert.ok(biome, `${file} must contain a minecraft:biome root`);

            const tags = biome.components?.["minecraft:tags"]?.tags;
            assert.ok(tags?.length > 0, `${file} must declare a non-empty minecraft:tags array`);
            assert.ok(
                tags.some((t: string) => t === "overworld" || t === "nether" || t === "the_end"),
                `${file} must declare a dimension tag (overworld, nether, or the_end)`
            );

            // Without the probability the chunk generator never rolls a herd into an animal biome.
            if (tags.includes("animal")) {
                const prob = biome.components?.["minecraft:creature_spawn_probability"];
                assert.ok(prob?.probability > 0, `${file} has 'animal' but no positive creature spawn probability`);
            }
        }
    });

    it("verifies spawn rules only filter on block ids vanilla uses", () => {
        // The 51 vanilla spawn_rules files only ever filter on these four ids. grass_block is a
        // real block (it is the command-facing name since 1.20.70) but vanilla never uses it here,
        // so a rule that does is filtering on something the spawn engine has no sample data for.
        const VANILLA_FILTERS = new Set([
            "minecraft:grass",
            "minecraft:sand",
            "minecraft:ice",
            "minecraft:clay"
        ]);

        const ruleFiles = readdirSync(spawnRulesDir).filter(f => f.endsWith(".json"));

        for (const file of ruleFiles) {
            const raw = readFileSync(resolve(spawnRulesDir, file), "utf-8");
            const declared = [...raw.matchAll(/"minecraft:spawns_on_block_filter":\s*"([^"]+)"/g)].map(m => m[1]);

            for (const id of declared) {
                assert.ok(
                    VANILLA_FILTERS.has(id),
                    `${file} filters on '${id}', which no vanilla spawn rule uses`
                );
            }
        }
    });

    it("places every mob's spawn rule where its era can reach it", () => {
        for (const file of ["zombie.json", "skeleton.json", "creeper.json", "spider.json"]) {
            const content = JSON.parse(readFileSync(resolve(spawnRulesDir, file), "utf-8"));
            const conditions = content["minecraft:spawn_rules"]?.conditions ?? [];

            for (const cond of conditions) {
                if (cond["minecraft:spawns_on_surface"]) {
                    assert.ok(
                        !cond["minecraft:spawns_on_block_filter"],
                        `${file} must not constrain surface spawning to a block filter`
                    );
                }
            }
        }

        for (const file of ["ghast.json", "zombie_pigman.json"]) {
            const raw = readFileSync(resolve(spawnRulesDir, file), "utf-8");
            const conditions = JSON.parse(raw)["minecraft:spawn_rules"]?.conditions ?? [];

            assert.ok(!raw.includes("beta_nether"), `${file} must not reference phantom tag 'beta_nether'`);

            for (const cond of conditions) {
                assert.ok(
                    !cond["minecraft:spawns_on_surface"],
                    `${file} cannot use spawns_on_surface in Nether (Nether has no surface)`
                );
                assert.ok(cond["minecraft:spawns_underground"], `${file} must use spawns_underground in Nether`);
            }
        }

        // Vanilla keeps adding natural spawners; each one must ship a rule whose only
        // biome condition is a tag no real biome ever uses, otherwise it spawns unchecked.
        for (const name of ["sulfur_cube", "bee", "creaking"]) {
            const content = JSON.parse(readFileSync(resolve(spawnRulesDir, `${name}.json`), "utf-8"));
            const conditions = content["minecraft:spawn_rules"]?.conditions ?? [];

            assert.ok(conditions.length > 0, `${name}.json must declare spawn conditions`);

            for (const cond of conditions) {
                const filter = JSON.stringify(cond["minecraft:biome_filter"] ?? "");
                assert.ok(
                    filter.includes("the_void"),
                    `${name}.json must filter on the_void so it never spawns naturally`
                );
            }
        }
    });

    it("verifies all Beta mob spawn rules reference existing biome tags", () => {
        const betaRules = [
            "chicken.json", "cow.json", "creeper.json", "ghast.json", "pig.json",
            "sheep.json", "skeleton.json", "slime.json", "spider.json", "squid.json",
            "wolf.json", "zombie.json", "zombie_pigman.json"
        ];

        // The Overworld biome overrides are gone: the world ships pre-generated in the world
        // template, so those tags now come from Bedrock's own biome definitions. These three are
        // the ones the Beta mob rules filter on, read off the vanilla behaviour pack
        // (reference-docs/bedrock-samples/behavior_pack/biomes). Without them the rules would never
        // match, and the engine silently ignores a tag no biome declares.
        const VANILLA_OVERWORLD_TAGS = new Set(["overworld", "forest", "taiga"]);

        const declaredTags = new Set<string>();
        const biomeFiles = readdirSync(biomesDir).filter(f => f.endsWith(".json"));
        for (const file of biomeFiles) {
            const content = JSON.parse(readFileSync(resolve(biomesDir, file), "utf-8"));
            const tags = content["minecraft:biome"]?.components?.["minecraft:tags"]?.tags ?? [];
            for (const t of tags) declaredTags.add(t);
        }

        for (const file of betaRules) {
            const content = JSON.parse(readFileSync(resolve(spawnRulesDir, file), "utf-8"));
            const conditions = content["minecraft:spawn_rules"]?.conditions ?? [];

            for (const cond of conditions) {
                const filter = cond["minecraft:biome_filter"];
                if (!filter) continue;

                const checkFilter = (f: any) => {
                    if (f.test === "has_biome_tag" && f.operator === "==") {
                        assert.ok(
                            declaredTags.has(f.value) || VANILLA_OVERWORLD_TAGS.has(f.value),
                            `${file} references tag '${f.value}', which neither the pack nor the vanilla Overworld declares`
                        );
                    }
                    if (f.any_of) f.any_of.forEach(checkFilter);
                    if (f.all_of) f.all_of.forEach(checkFilter);
                };

                checkFilter(filter);
            }
        }
    });

    it("keeps the era's wolf and creeper definitions", () => {
        const wolf = JSON.parse(readFileSync(resolve(root, "packs/BP/entities/wolf.json"), "utf-8"));
        const tame = wolf["minecraft:entity"]?.component_groups?.["minecraft:wolf_tame"];
        assert.ok(tame, "wolf.json must declare minecraft:wolf_tame");
        assert.equal(tame["minecraft:behavior.breed"], undefined, "Beta wolves cannot breed");
        assert.equal(tame["minecraft:is_dyeable"], undefined, "Beta wolves cannot have collars dyed");
        assert.equal(tame["minecraft:leashable"], undefined, "Beta wolves cannot be leashed");

        // behavior.melee_attack is how a Bedrock creeper closes the distance to its target. It is
        // gated on the mob having an attack component, so without minecraft:attack the goal never
        // starts and the creeper only ever explodes when the player walks into fuse range. Vanilla
        // pairs the goal with reach_multiplier 0.0 so the chase cannot deal melee damage.
        const creeper = JSON.parse(readFileSync(resolve(root, "packs/BP/entities/creeper.json"), "utf-8"));
        const components = creeper["minecraft:entity"]?.components ?? {};
        assert.ok(components["minecraft:attack"], "the creeper's melee_attack goal needs an attack component to start");
        const melee = components["minecraft:behavior.melee_attack"];
        assert.ok(melee, "creeper.json must keep the chase goal");
        assert.equal(melee.reach_multiplier, 0, "Beta creepers chase but do no melee damage");
    });

    it("caps each mob's meat drop at the count Beta's own drop rule rolled", () => {
        // Beta pays `rand.nextInt(3)` copies of `getDropItemId()` — zero, one or two
        // (EntityLiving.java:405-413) — and the pig and the pigman each name one meat there
        // (EntityPig.java:45, EntityPigZombie.java:85). A table capped at one pays half the era's rate.
        const meats: readonly (readonly [string, string])[] = [
            ["pig.json", "minecraft:porkchop"],
            ["zombie_pigman.json", "minecraft:cooked_porkchop"]
        ];

        for (const [file, item] of meats) {
            const content = JSON.parse(readFileSync(resolve(root, `packs/BP/loot_tables/entities/${file}`), "utf-8"));
            const entries = (content.pools ?? [])
                .flatMap((pool: any) => pool.entries ?? [])
                .filter((entry: any) => entry.name === item);
            assert.ok(entries.length > 0, `${file} must drop ${item}`);

            for (const entry of entries) {
                const setCount = (entry.functions ?? []).find((f: any) => f.function === "set_count");
                assert.ok(setCount, `every ${item} entry must declare a set_count`);
                assert.equal(setCount.count.min, 0, "one roll in three paid no meat at all");
                assert.equal(setCount.count.max, 2, "Beta never paid more than two of one meat");
            }
        }
    });
});
