import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

/** Everything the retired shadow swap shipped; a reappearing file is the regression. */
const RETIRED_FILES = [
    "packs/BP/scripts/mobs/entityShadow.ts",
    "packs/RP/animation_controllers/entity_shadow.animation_controllers.json",
    "packs/RP/materials/shadows.material",
    "packs/RP/particles/entity_shadow.json",
    "packs/RP/particles/entity_shadow_player.json",
    "packs/RP/textures/particle/entity_shadow.png"
];

const RETIRED_REFERENCES = [
    "betarock:shadow_",
    "minecraft:renders_when_invisible",
    "minecraft:is_hidden_when_invisible",
    "\"invisibility\""
];

function jsonFiles(directory: string): string[] {
    return readdirSync(resolve(root, directory))
        .filter((name) => name.endsWith(".json"))
        .map((name) => `${directory}/${name}`);
}

function text(path: string): string {
    return readFileSync(resolve(root, path), "utf-8");
}

describe("Entity shadows - the custom system is retired", () => {
    it("ships none of the shadow files or the ground sweep", () => {
        for (const path of RETIRED_FILES) {
            assert.equal(existsSync(resolve(root, path)), false, `${path} belongs to the retired shadow system`);
        }

        assert.equal(
            text("packs/BP/scripts/main.ts").includes("./mobs/entityShadow.js"),
            false,
            "a leftover import would keep the retired sweep running"
        );
    });

    it("leaves no shadow property or invisibility component on a Beta entity", () => {
        for (const path of jsonFiles("packs/BP/entities")) {
            const source = text(path);
            for (const reference of RETIRED_REFERENCES) {
                assert.equal(source.includes(reference), false, `${path} still carries ${reference}`);
            }
        }
    });

    it("wires no shadow particle or controller into a client entity", () => {
        for (const path of jsonFiles("packs/RP/entity")) {
            const source = text(path);
            assert.equal(
                /bh_entity_shadow|controller\.animation\.betarock\.entity_shadow/.test(source),
                false,
                `${path} still binds the retired decal`
            );
        }
    });
});
