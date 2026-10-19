import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENTITIES_DIR = "packs/BP/entities";

function readJson(path: string): any {
    return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf-8").replace(/^\uFEFF/, ""));
}

describe("Entity properties - what a neutralized mob still has to declare", () => {
    it("keeps the nectar property vanilla's bee controllers query", () => {
        // The pack strips the bee down to an inert body, but not its client definitions: vanilla's
        // bee render controller and animation controller both ask for `minecraft:has_nectar`, and a
        // definition that does not declare it logs `query.property: property does not exist, consider
        // using query.has_property` -- once per session, with the render controller left indexing its
        // texture array off a failed query.
        const description = readJson(`${ENTITIES_DIR}/bee.json`)["minecraft:entity"].description;

        assert.deepEqual(
            description.properties?.["minecraft:has_nectar"],
            { type: "bool", client_sync: true, default: false },
            "the bee's definition has to carry the property the vanilla client reads"
        );
    });
});
