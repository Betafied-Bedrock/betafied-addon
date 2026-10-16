import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    registeredBeforeEvents,
    registeredAfterEvents,
    scheduledIntervals
} from "../mocks/minecraftServer.js";

describe("Main Integration Harness - Bedrock Server Script Loading", () => {
    it("imports main.ts and initializes the subsystems without throwing", async () => {
        await import("../../packs/BP/scripts/main.js");

        assert.ok(registeredAfterEvents.size > 0, "the composition root registers after-event handlers");
        assert.ok(registeredBeforeEvents.size > 0, "and before-event handlers");
        assert.ok(
            scheduledIntervals.length >= 1,
            `the master tickManager interval is armed, got ${scheduledIntervals.length}`
        );
    });

    it("arms every scheduled interval with a positive rate", () => {
        for (const item of scheduledIntervals) {
            assert.ok(item.interval > 0, `scheduled item ${item.id} must fire on a positive interval`);
        }
    });
});
