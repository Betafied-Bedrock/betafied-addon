import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    MIN_REST_TICKS,
    SIGHTING_CHANCE,
    facingYaw,
    isWithinLookCone,
    pickRollDelayTicks,
    pickSightDistance
} from "../../packs/BP/scripts/mobs/herobrine.js";

// Sampling counts stay modest on purpose: these cases assert the shape of a distribution, and a
// couple of hundred draws already fails if the range, the bias or the spread moves.
const FAR_SIGHTING_CASES = 200;
const RATE_SAMPLES = 200;
const TICKS_PER_HOUR = 20 * 60 * 60;
const FORWARD = { x: 0, y: 0, z: 1 };

/** Direction sitting `degrees` off the +Z axis, in the horizontal plane. */
function offAxis(degrees: number): { x: number; y: number; z: number } {
    const radians = (degrees * Math.PI) / 180;
    return { x: Math.sin(radians), y: 0, z: Math.cos(radians) };
}

describe("Herobrine Appearance Policy", () => {
    describe("pickSightDistance", () => {
        it("stays inside the configured sighting range", () => {
            for (let i = 0; i < FAR_SIGHTING_CASES; i++) {
                const distance = pickSightDistance();
                assert.ok(distance >= 12, `distance ${distance} below minimum`);
                assert.ok(distance <= 40, `distance ${distance} above maximum`);
            }
        });

        it("favours the far half of the range over the near half", () => {
            let far = 0;
            for (let i = 0; i < FAR_SIGHTING_CASES; i++) {
                if (pickSightDistance() > 26) far++;
            }
            assert.ok(
                far / FAR_SIGHTING_CASES > 0.6,
                `expected distant sightings to dominate, got ${(far / FAR_SIGHTING_CASES).toFixed(2)}`
            );
        });
    });

    describe("pickRollDelayTicks", () => {
        it("keeps the first window quiet", () => {
            for (let i = 0; i < 200; i++) {
                const delay = pickRollDelayTicks(true);
                assert.ok(delay >= 24000 && delay <= 72000, `first delay ${delay} out of window`);
            }
        });

        it("re-rolls every later window somewhere else in the range", () => {
            const seen = new Set<number>();
            for (let i = 0; i < 200; i++) {
                const delay = pickRollDelayTicks(false);
                assert.ok(delay >= 12000 && delay <= 36000, `later delay ${delay} out of window`);
                seen.add(delay);
            }
            assert.ok(seen.size > 180, "later windows should be spread across the range, not fixed");
        });
    });

    describe("sighting rate", () => {
        it("holds a bare minimum of eight hours between sightings", () => {
            const restHours = MIN_REST_TICKS / TICKS_PER_HOUR;
            assert.ok(restHours >= 8, `rest period of ${restHours}h is under the eight-hour floor`);
        });

        it("makes a sighting a rare event, the better part of a day apart", () => {
            let total = 0;
            for (let i = 0; i < RATE_SAMPLES; i++) total += pickRollDelayTicks(false);
            const meanGapTicks = total / RATE_SAMPLES;
            const expectedHours = (MIN_REST_TICKS + meanGapTicks / SIGHTING_CHANCE) / TICKS_PER_HOUR;

            assert.ok(
                expectedHours >= 16 && expectedHours <= 26,
                `expected most of a day between sightings, got ${expectedHours.toFixed(1)}h`
            );
        });
    });

    describe("isWithinLookCone", () => {
        it("counts a gaze from dead-on out to just inside thirty degrees", () => {
            assert.equal(isWithinLookCone(FORWARD, offAxis(0)), true, "dead-on eye contact");
            assert.equal(isWithinLookCone(FORWARD, offAxis(15)), true, "a glance well inside the cone");
            assert.equal(isWithinLookCone(FORWARD, offAxis(29)), true, "the edge just inside the limit");
        });

        it("ignores anything past thirty degrees", () => {
            assert.equal(isWithinLookCone(FORWARD, offAxis(31)), false);
            assert.equal(isWithinLookCone(FORWARD, offAxis(90)), false);
            assert.equal(isWithinLookCone(FORWARD, offAxis(180)), false);
        });

        it("ignores the vertical axis when judging the cone", () => {
            assert.equal(isWithinLookCone({ x: 0, y: 1, z: 0 }, { x: 0, y: 5, z: 0 }), true);
            assert.equal(isWithinLookCone(FORWARD, { x: 0, y: 10, z: 0 }), false);
        });
    });

    describe("facingYaw", () => {
        it("reads the era's yaw for each cardinal direction", () => {
            const at = { x: 0, y: 0, z: 0 };

            assert.equal(Math.abs(facingYaw(at, { x: 0, y: 0, z: 10 })), 0, "toward +Z");
            assert.equal(facingYaw(at, { x: -10, y: 0, z: 0 }), 90, "toward -X");
            assert.equal(facingYaw(at, { x: 10, y: 0, z: 0 }), -90, "toward +X");
            assert.equal(Math.abs(facingYaw(at, { x: 0, y: 0, z: -10 })), 180, "toward -Z");
        });
    });
});
