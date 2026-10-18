import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blockResolveCalls } from "../mocks/minecraftServer.js";

describe("Chunk Scrubber - when its tables are resolved", () => {
    it("resolves no block id while the pack is still loading", async () => {
        // A script file's top level runs in early execution, where a block lookup throws. Resolving
        // the probe table there is how it came out empty -- and an empty table is the inverted
        // `0..-1` range that recursed until the watchdog killed the whole pack.
        const before = blockResolveCalls;

        await import("../../packs/BP/scripts/world/chunkScrubber.js");

        assert.equal(
            blockResolveCalls,
            before,
            "block ids must be resolved on the first sweep, not at pack load"
        );
    });
});
