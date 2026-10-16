import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mockPlayers } from "../mocks/minecraftServer.js";
import { chunkScanJob } from "../../packs/BP/scripts/world/chunkScrubber.js";

// A refused volume query reports through the ambient Bedrock console, so capture it rather than let
// the line land in the test output.
function captureWarnings(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (message?: unknown) => {
        lines.push(String(message));
    };
    return { lines, restore: () => { console.warn = original; } };
}

interface ChunkVisit {
    visited: string[];
    fills: string[];
}

function chunkKey(volume: { from: { x: number; z: number } }): string {
    return `${volume.from.x / 16},${volume.from.z / 16}`;
}

/**
 * Minimal dimension stub for the scan loop. The fine sweep is the only pass the scrubber still makes,
 * and it queries one volume per band per chunk, so a chunk it claims shows up as one entry in
 * `visited`. Answering "the chunk holds nothing to scrub" everywhere keeps a pass short enough that
 * the visit order can be read straight off that list.
 */
function scanDimension(
    log: ChunkVisit,
    isUnloaded: (location: { x: number; y: number; z: number }) => boolean = () => false,
    id = "minecraft:nether"
) {
    return {
        id,
        heightRange: { min: 0, max: 127 },
        fillBlocks(volume: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } }, block: string) {
            log.fills.push(`fill ${volume.from.x} ${volume.from.y} ${volume.from.z} ${block}`);
        },
        isChunkLoaded(location: { x: number; y: number; z: number }) {
            return !isUnloaded(location);
        },
        containsBlock() {
            return false;
        },
        getBlocks(volume: { from: { x: number; y: number; z: number } }) {
            log.visited.push(chunkKey(volume));
            return { getBlockLocationIterator: () => ([] as { x: number; y: number; z: number }[])[Symbol.iterator]() };
        },
        getBlock() {
            return undefined;
        }
    };
}

function drain(job: Generator<void, void, unknown>): void {
    for (const _ of job) {
        // The scan loop yields between chunks; every step is part of the recorded pass.
    }
}

function visitedChunks(log: ChunkVisit): Set<string> {
    return new Set(log.visited);
}

describe("Chunk scrubber - visit order", () => {
    let warnings: { lines: string[]; restore: () => void };

    beforeEach(() => {
        mockPlayers.length = 0;
        warnings = captureWarnings();
    });

    afterEach(() => {
        warnings.restore();
    });

    it("visits the player's own chunk before the ring around it", () => {
        const log: ChunkVisit = { visited: [], fills: [] };
        const dimension = scanDimension(log);

        mockPlayers.push({
            isValid: true,
            location: { x: -33, y: 13, z: 1 },
            dimension
        } as never);

        drain(chunkScanJob());

        assert.equal(
            log.visited[0],
            "-3,0",
            `expected the player's own chunk first, got: ${log.visited.slice(0, 2).join(" | ")}`
        );
        assert.deepEqual(log.fills, [], "a chunk that holds nothing to scrub must not be filled against");
    });

    it("sweeps the ring around the player's own chunk", () => {
        const log: ChunkVisit = { visited: [], fills: [] };
        const dimension = scanDimension(log);

        // Far from the previous case's chunk so no visit is already marked done.
        mockPlayers.push({
            isValid: true,
            location: { x: 1000, y: 13, z: 1000 },
            dimension
        } as never);

        // One chunk is swept per pass, so the whole neighbourhood takes one pass per chunk.
        for (let pass = 0; pass < 9; pass++) {
            drain(chunkScanJob());
        }

        const playerChunkX = Math.floor(1000 / 16);
        const playerChunkZ = Math.floor(1000 / 16);

        const visited = visitedChunks(log);

        assert.equal(visited.size, 9, `expected a 3x3 neighbourhood, got ${visited.size}: ${[...visited].join(" ")}`);

        for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
            assert.ok(
                visited.has(`${playerChunkX + dx},${playerChunkZ + dz}`),
                `expected the corner ${dx},${dz} to be in the ring`
            );
        }
    });

    it("reports a refused fine query once for the whole neighbourhood", () => {
        const log: ChunkVisit = { visited: [], fills: [] };
        const dimension = scanDimension(log);
        // The engine refuses the volume query on every band of every chunk. Reported per chunk that
        // was nine lines per neighbourhood sweep, forever; the refusal is one condition about the
        // engine, so it is one line.
        dimension.getBlocks = (volume: { from: { x: number; y: number; z: number } }) => {
            log.visited.push(chunkKey(volume));
            throw new Error("the volume query is unavailable");
        };

        mockPlayers.push({ isValid: true, location: { x: 3000, y: 13, z: 3000 }, dimension } as never);

        // One chunk is swept per pass, so the neighbourhood takes one pass per chunk.
        for (let pass = 0; pass < 9; pass++) {
            drain(chunkScanJob());
        }

        assert.equal(
            warnings.lines.filter(line => line.includes("during fineScrubQuery")).length,
            1,
            `expected one line for nine chunks, got: ${warnings.lines.join(" | ")}`
        );
        // The sweep still did its work; silencing the report must not be done by skipping the pass.
        assert.equal(visitedChunks(log).size, 9, "the whole neighbourhood must still be swept");
    });

    it("moves on while the chunk under the player is still mid-sweep", () => {
        const log: ChunkVisit = { visited: [], fills: [] };
        const dimension = scanDimension(log);
        mockPlayers.push({ isValid: true, location: { x: 2000, y: 13, z: 2000 }, dimension } as never);

        // A sweep yields mid-chunk, so the scheduler's next pass starts while this one still owns its
        // chunk. It must claim the next one instead of re-sweeping the same ground.
        const first = chunkScanJob();
        first.next();

        const before = log.visited.length;
        drain(chunkScanJob());

        assert.notEqual(
            log.visited[before],
            log.visited[0],
            `the second pass re-swept the first pass's chunk: ${log.visited[before]}`
        );
    });

    it("reaches past a neighbour that is not loaded yet", () => {
        const log: ChunkVisit = { visited: [], fills: [] };
        const centerX = 150;
        const centerZ = 150;
        const westX = (centerX - 1) * 16;

        const dimension = scanDimension(log, location => location.x === westX && location.z === centerZ * 16);
        mockPlayers.push({
            isValid: true,
            location: { x: centerX * 16 + 8, y: 13, z: centerZ * 16 + 8 },
            dimension
        } as never);

        drain(chunkScanJob()); // the player's own chunk
        drain(chunkScanJob()); // the west neighbour is unloaded, so the pass must reach the next one

        const visited = visitedChunks(log);

        assert.ok(visited.has(`${centerX},${centerZ}`), "the player's chunk must be swept");
        assert.ok(visited.has(`${centerX},${centerZ - 1}`), "the pass must reach past the unloaded neighbour");
        assert.ok(!visited.has(`${centerX - 1},${centerZ}`), "an unloaded neighbour must not be read");
    });

    it("leaves the Overworld and the End alone", () => {
        for (const id of ["minecraft:overworld", "minecraft:the_end"]) {
            const log: ChunkVisit = { visited: [], fills: [] };
            mockPlayers.length = 0;
            mockPlayers.push({ isValid: true, location: { x: 0, y: 13, z: 0 }, dimension: scanDimension(log, undefined, id) } as never);

            for (let pass = 0; pass < 9; pass++) {
                drain(chunkScanJob());
            }

            // The Overworld ships pre-generated in the world template, so the sweep is Nether-only.
            assert.deepEqual(log.visited, [], `${id} must not be swept`);
        }
    });
});
