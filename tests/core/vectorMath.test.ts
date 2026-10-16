import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { magnitude, normalizeXZ, scale } from "../../packs/BP/scripts/core/vectorMath.js";

describe("Vector helpers - the arithmetic the vehicle passes steer with", () => {
    describe("normalizeXZ", () => {
        it("answers a horizontal unit vector, from the horizontal length alone", () => {
            assert.deepEqual(normalizeXZ({ x: 3, y: 99, z: 4 }), { x: 0.6, y: 0, z: 0.8 });
            assert.deepEqual(normalizeXZ({ x: -5, z: 0 }), { x: -1, y: 0, z: 0 });
        });

        it("answers a standstill with a zero vector rather than a heading of NaN", () => {
            // An impulse built from 0/0 is a NaN vector, and the engine reads a NaN impulse as no
            // motion at all -- a boat that never moves again, traced from a division nobody guarded.
            assert.deepEqual(normalizeXZ({ x: 0, z: 0 }), { x: 0, y: 0, z: 0 });
        });
    });

    describe("scale", () => {
        it("scales every axis, including the vertical one a horizontal helper would drop", () => {
            assert.deepEqual(scale({ x: 2, y: -3, z: 0.5 }, 4), { x: 8, y: -12, z: 2 });

            // A zero scalar multiplies each axis to -0 or 0 depending on the sign the axis came in
            // with, which is the same number to the engine and a different one to deepEqual.
            const zeroed = scale({ x: 2, y: -3, z: 0.5 }, 0);
            assert.deepEqual([zeroed.x, zeroed.y, zeroed.z].map(Math.abs), [0, 0, 0]);
        });
    });

    describe("magnitude", () => {
        it("measures the full vector, so a drop still counts as speed", () => {
            assert.equal(magnitude({ x: 3, y: 4, z: 0 }), 5);
            assert.equal(magnitude({ x: 0, y: -7, z: 0 }), 7);
            assert.equal(magnitude({ x: 0, y: 0, z: 0 }), 0);
        });
    });
});
