import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareText, versionAtLeast } from "./text.js";

/**
 * These helpers compare values rather than read the disk, so a pass here is real evidence -- and
 * they are now shared by tests in three directories, which is why the padding rule below is pinned
 * rather than left to whichever call site happens to exercise it.
 */
describe("test support helpers", () => {
    describe("versionAtLeast", () => {
        it("orders by each dotted component, most significant first", () => {
            assert.equal(versionAtLeast("1.21.60", "1.21.50"), true);
            assert.equal(versionAtLeast("1.21.50", "1.21.50"), true);
            assert.equal(versionAtLeast("1.21.40", "1.21.50"), false);
            assert.equal(versionAtLeast("1.8.0", "1.21.50"), false);
            assert.equal(versionAtLeast("2.0.0", "1.99.99"), true);
        });

        it("treats a missing trailing component as zero, so 1.21 is 1.21.0", () => {
            assert.equal(versionAtLeast("1.21", "1.21.0"), true);
            assert.equal(versionAtLeast("1.21", "1.21.1"), false);
        });
    });

    describe("compareText", () => {
        it("compares as text, so a numeric-looking list keeps its code-unit order", () => {
            assert.deepEqual(["10", "9", "2"].sort(compareText), ["10", "2", "9"]);
            assert.deepEqual(["b", "a", "c"].sort(compareText), ["a", "b", "c"]);
        });
    });
});
