import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groundFor } from "../../packs/BP/scripts/mobs/entityShadow.js";

describe("EntityShadow - the surface under a mob", () => {
    it("keeps the feet of a grounded entity, the only exact reading on a half block", () => {
        assert.equal(groundFor(63.5, true, 63), 63.5);
    });

    it("lands on the top of the block an airborne entity's ray found", () => {
        assert.equal(groundFor(65.2, false, 63), 64);
    });

    it("keeps the feet of an entity with nothing under it", () => {
        assert.equal(groundFor(65.2, false, undefined), 65.2);
    });
});
