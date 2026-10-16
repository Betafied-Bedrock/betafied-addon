import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    END_ID,
    END_KEY,
    NETHER_ID,
    NETHER_KEY,
    OVERWORLD_ID,
    OVERWORLD_KEY
} from "../../packs/BP/scripts/policy/betaConstants.js";

describe("Beta dimension spellings", () => {
    /**
     * The engine answers two spellings for one dimension: `Dimension.id` is namespace-prefixed and is
     * what a comparison reads, while `world.getDimension` takes the short key. A pair that drifts turns
     * into a check that can never be true -- the world pass over the Nether would simply never run --
     * which is the failure mode the constants module exists to prevent.
     */
    it("keeps each dimension's id and key in step", () => {
        const dimensions: [string, string][] = [
            [OVERWORLD_ID, OVERWORLD_KEY],
            [NETHER_ID, NETHER_KEY],
            [END_ID, END_KEY]
        ];

        for (const [id, key] of dimensions) {
            assert.equal(id, `minecraft:${key}`, `${id}: getDimension takes the key, and id is the prefixed spelling`);
        }
    });
});
