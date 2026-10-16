import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sweepBatches } from "../../packs/BP/scripts/interactions/chest/chestMirror.js";
import type { PairSession } from "../../packs/BP/scripts/interactions/chest/chestMirror.js";
import { resetMocks } from "../mocks/minecraftServer.js";

describe("Double Chest Session Sweep Generator & Batching", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("sweeps every session in batches of ten, yielding between them", () => {
        const entries: [string, PairSession][] = [];
        for (let i = 0; i < 25; i++) {
            entries.push([`minecraft:overworld:${i},64,0`, {
                dimensionId: "minecraft:overworld",
                master: { x: i, y: 64, z: 0 },
                shadow: { x: i + 1, y: 64, z: 0 },
                masterViewers: new Set(),
                shadowViewers: new Set()
            }]);
        }

        const job = sweepBatches(entries);

        assert.equal(job.next().done, false, "the first ten sessions yield before the rest");
        assert.equal(job.next().done, false, "so do the second ten");

        let tail = 0;
        while (!job.next().done) tail++;

        assert.equal(tail, 0, "the remaining five sessions finish in the pass that follows");
    });
});
