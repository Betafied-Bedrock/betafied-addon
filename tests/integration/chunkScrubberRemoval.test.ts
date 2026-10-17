import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { BlockPermutation } from "@minecraft/server";
import { scrubFineDetails } from "../../packs/BP/scripts/world/chunkScrubber.js";

// The refused-query and refused-write cases both report through the ambient Bedrock console, so
// capture it rather than let those lines land in the test output.
function captureWarnings(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (message?: unknown) => {
        lines.push(String(message));
    };
    return { lines, restore: () => { console.warn = original; } };
}

interface RecordedBlock {
    typeId: string;
    permutation: any;
    setTypeCalls: string[];
    permutationCalls: string[];
    setType(id: string): void;
    setPermutation(perm: any): void;
}

// The engine charges the sweep one native call per read and per write, so a case that names a call
// count names the cost. Counting writes globally rather than per block keeps the number honest when a
// fill replaces the map's entry for a block it just covered.
let perBlockWrites = 0;

function recordingBlock(typeId: string, states: Record<string, any> = {}): RecordedBlock {
    const block: RecordedBlock = {
        typeId,
        permutation: BlockPermutation.resolve(typeId, states),
        setTypeCalls: [],
        permutationCalls: [],
        setType(id: string) {
            perBlockWrites++;
            block.setTypeCalls.push(id);
            block.typeId = id;
        },
        setPermutation(perm: any) {
            perBlockWrites++;
            block.permutationCalls.push(perm.typeId);
        }
    };
    return block;
}

const AIR = {
    typeId: "minecraft:air",
    permutation: BlockPermutation.resolve("minecraft:air"),
    setType() {},
    setPermutation() {}
};

interface TestDimension {
    id: string;
    heightRange: { min: number; max: number };
    commands: string[];
    containsBlockCalls: number;
    getBlockCalls: number;
    getBlock(location: { x: number; y: number; z: number }): RecordedBlock;
    isChunkLoaded(location: { x: number; y: number; z: number }): boolean;
    getBlocks(volume: any, filter: any): { getBlockLocationIterator(): IterableIterator<{ x: number; y: number; z: number }> };
    containsBlock(volume: any, filter: any): boolean;
    fillBlocks(volume: any, block: string, options?: any): void;
}

/**
 * Stands in for the dimension the way the script API presents it: volume queries and fills both read
 * and write the one block map, exactly as the engine does, so a fill is visible to the pass that runs
 * after it. A stub that only recorded the fill would leave the blocks standing and make the sweep's
 * second pass re-cover ground the engine had already cleared.
 */
function scrubDimension(blocks: Map<string, RecordedBlock>): TestDimension {
    const commands: string[] = [];
    let containsBlockCalls = 0;
    let getBlockCalls = 0;

    const typeIdAt = (x: number, y: number, z: number): string => blocks.get(`${x},${y},${z}`)?.typeId ?? AIR.typeId;

    const accepts = (typeId: string, filter: any): boolean => {
        if (filter.includeTypes && !filter.includeTypes.includes(typeId)) return false;
        if (filter.excludeTypes && filter.excludeTypes.includes(typeId)) return false;
        return true;
    };

    const walk = (volume: any, visit: (x: number, y: number, z: number) => boolean | void): void => {
        for (let x = volume.from.x; x <= volume.to.x; x++) {
            for (let y = volume.from.y; y <= volume.to.y; y++) {
                for (let z = volume.from.z; z <= volume.to.z; z++) {
                    if (visit(x, y, z) === false) return;
                }
            }
        }
    };

    return {
        id: "minecraft:nether",
        heightRange: { min: 0, max: 127 },
        commands,
        get containsBlockCalls() {
            return containsBlockCalls;
        },
        get getBlockCalls() {
            return getBlockCalls;
        },
        getBlock({ x, y, z }) {
            getBlockCalls++;
            return blocks.get(`${x},${y},${z}`) ?? AIR;
        },
        isChunkLoaded() {
            return true;
        },
        getBlocks(volume, filter) {
            const hits: { x: number; y: number; z: number }[] = [];
            walk(volume, (x, y, z) => {
                if (accepts(typeIdAt(x, y, z), filter)) hits.push({ x, y, z });
            });
            return { getBlockLocationIterator: () => hits[Symbol.iterator]() };
        },
        containsBlock(volume, filter) {
            containsBlockCalls++;
            let found = false;
            walk(volume, (x, y, z) => {
                if (accepts(typeIdAt(x, y, z), filter)) {
                    found = true;
                    return false;
                }
            });
            return found;
        },
        fillBlocks(volume, block, options) {
            const replace = options?.blockFilter?.includeTypes?.[0];
            commands.push(`fill ${volume.from.x} ${volume.from.y} ${volume.from.z} ${volume.to.x} ${volume.to.y} ${volume.to.z} ${block}${replace === undefined ? "" : ` replace ${replace}`}`);

            const filter = options?.blockFilter ?? {};
            walk(volume, (x, y, z) => {
                const key = `${x},${y},${z}`;
                const existing = blocks.get(key);
                if (existing && accepts(existing.typeId, filter)) {
                    blocks.set(key, recordingBlock(block));
                }
            });
        }
    };
}

function drain(dim: TestDimension): boolean | undefined {
    const job = scrubFineDetails(dim as any, 0, 0);
    let step = job.next();
    while (!step.done) {
        step = job.next();
    }
    return step.value;
}

function scrub(dim: TestDimension): void {
    drain(dim);
}

function bulkFillsFor(dim: TestDimension, target: string): string[] {
    return dim.commands.filter(command => command.endsWith(` replace ${target}`));
}

describe("Chunk Scrubber - Inverse Allowlist Enforcement", () => {
    let warnings: { lines: string[]; restore: () => void };

    beforeEach(() => {
        warnings = captureWarnings();
        perBlockWrites = 0;
    });

    afterEach(() => {
        warnings.restore();
    });

    it("scrubs post-Beta blocks that have no authentic counterpart", () => {
        const blocks = new Map<string, RecordedBlock>([
            ["3,64,4", recordingBlock("minecraft:bee_nest")],
            ["5,70,6", recordingBlock("minecraft:beehive")],
            ["7,12,8", recordingBlock("minecraft:stone_bricks")]
        ]);

        const dim = scrubDimension(blocks);
        scrub(dim);

        // All three are deleted, and a type is deleted whole: the sweep classifies an id once and
        // covers the rest of the band with a filtered fill rather than a write per block.
        for (const id of ["minecraft:bee_nest", "minecraft:beehive", "minecraft:stone_bricks"]) {
            assert.deepEqual(
                bulkFillsFor(dim, id),
                [`fill 0 0 0 15 127 15 minecraft:air replace ${id}`],
                `${id} must be deleted`
            );
        }

        assert.equal(perBlockWrites, 0, "a deleted type must not be written one block at a time");
    });

    it("clears a post-Beta plant through the bulk path", () => {
        const dim = scrubDimension(new Map<string, RecordedBlock>([
            ["3,70,2", recordingBlock("minecraft:vine")]
        ]));

        scrub(dim);

        assert.deepEqual(bulkFillsFor(dim, "minecraft:vine"), [
            "fill 0 0 0 15 127 15 minecraft:air replace minecraft:vine"
        ]);
    });

    it("keeps authentic Beta blocks untouched", () => {
        const log = recordingBlock("minecraft:oak_log");
        const cobble = recordingBlock("minecraft:cobblestone");

        scrub(scrubDimension(new Map<string, RecordedBlock>([
            ["1,64,1", log],
            ["2,65,2", cobble]
        ])));

        assert.deepEqual(log.setTypeCalls, []);
        assert.deepEqual(log.permutationCalls, []);
        assert.deepEqual(cobble.setTypeCalls, []);
        assert.deepEqual(cobble.permutationCalls, []);
    });

    it("deletes a generated structure chest, and only that chunk's", () => {
        const generated = recordingBlock("minecraft:chest");
        const own = recordingBlock("bh:chest");

        const dim = scrubDimension(new Map<string, RecordedBlock>([
            ["4,64,4", generated],
            ["6,64,6", own]
        ]));

        scrub(dim);

        // A chest in a swept chunk is a structure's — a ruined portal's, the one vanilla structure the
        // Nether still generates — and the loot it holds arrived with the Nether Update. The block is
        // cleared wholesale, so nothing is left for the player to open.
        assert.deepEqual(bulkFillsFor(dim, "minecraft:chest"), [
            "fill 0 0 0 15 127 15 minecraft:air replace minecraft:chest"
        ]);
        assert.deepEqual(generated.setTypeCalls, [], "the chest goes by volume fill, not one write per block");
        assert.deepEqual(own.setTypeCalls, [], "the pack's own chest must survive the sweep");
        assert.deepEqual(own.permutationCalls, []);
    });

    it("never builds the chest fill for a chunk that holds no generated chest", () => {
        const dim = scrubDimension(new Map<string, RecordedBlock>([
            ["4,64,4", recordingBlock("bh:chest")]
        ]));

        scrub(dim);

        assert.deepEqual(dim.commands, [], `expected no fill, got: ${dim.commands.join(" | ")}`);
    });

    it("leaves the era's sugar cane standing", () => {
        const cane = recordingBlock("minecraft:reeds", { age: 3 });

        scrub(scrubDimension(new Map<string, RecordedBlock>([["6,64,6", cane]])));

        // Betafied's terrain is grown rather than generated, so the fine pass is the only thing that
        // can reach a cane the world already holds; a reeds block missing from the allowlist read as
        // modern terrain and was erased as the player walked up to it.
        assert.deepEqual(cane.setTypeCalls, [], "sugar cane must survive the fine pass");
        assert.deepEqual(cane.permutationCalls, []);
    });

    it("leaves a lit nether portal standing, frame and all", () => {
        const frame = recordingBlock("minecraft:obsidian");
        const portal = recordingBlock("minecraft:portal", { portal_axis: "x" });

        scrub(scrubDimension(new Map<string, RecordedBlock>([
            ["3,64,4", frame],
            ["4,64,4", portal]
        ])));

        // The era's portal is its own block (1.7.3's block 90) and the sweep read it as modern
        // terrain, so a portal died with its obsidian frame still standing. The frame surviving is
        // what made the report "my portal keeps breaking" rather than "blocks are missing".
        assert.deepEqual(portal.setTypeCalls, [], "a lit portal must survive the fine pass");
        assert.deepEqual(portal.permutationCalls, []);
        assert.deepEqual(frame.setTypeCalls, [], "the obsidian frame must survive the fine pass");
    });

    it("leaves the era's fire standing", () => {
        const fire = recordingBlock("minecraft:fire", { age: 3 });

        scrub(scrubDimension(new Map<string, RecordedBlock>([["4,64,4", fire]])));

        assert.deepEqual(fire.setTypeCalls, [], "fire must survive the fine pass");
        assert.deepEqual(fire.permutationCalls, []);
    });

    it("leaves the era's farmland standing", () => {
        const farmland = recordingBlock("minecraft:farmland", { moisturized_amount: 7 });

        scrub(scrubDimension(new Map<string, RecordedBlock>([["4,64,4", farmland]])));

        assert.deepEqual(farmland.setTypeCalls, [], "farmland must survive the fine pass");
        assert.deepEqual(farmland.permutationCalls, []);
    });

    it("leaves an extended piston standing", () => {
        const base = recordingBlock("minecraft:piston", { facing_direction: 1 });
        const head = recordingBlock("minecraft:piston_arm_collision", { facing_direction: 1 });
        const stickyHead = recordingBlock("minecraft:sticky_piston_arm_collision", { facing_direction: 1 });

        scrub(scrubDimension(new Map<string, RecordedBlock>([
            ["4,64,4", base],
            ["5,64,4", head],
            ["9,64,9", stickyHead]
        ])));

        // This engine renders Beta's piston extension (block 34) as a block of its own, so the base
        // alone is a headless — broken — piston. A piston left extended at logout lost its head to
        // the sweep on the chunk load that followed.
        assert.deepEqual(head.setTypeCalls, [], "an extended piston head must survive the fine pass");
        assert.deepEqual(head.permutationCalls, []);
        assert.deepEqual(stickyHead.setTypeCalls, [], "a sticky piston head must survive the fine pass");
        assert.deepEqual(base.setTypeCalls, [], "the piston base must survive the fine pass");
    });

    it("retypes Bedrock's consolidated planks block to oak instead of scrubbing it", () => {
        const planks = recordingBlock("minecraft:planks", { wood_type: "spruce" });

        scrub(scrubDimension(new Map<string, RecordedBlock>([["7,64,7", planks]])));

        assert.deepEqual(planks.setTypeCalls, []);
        assert.deepEqual(planks.permutationCalls, ["minecraft:planks"]);
    });

    it("runs a bulk fill for every post-Beta rock type the chunk actually holds", () => {
        const andesite = recordingBlock("minecraft:andesite");
        const dim = scrubDimension(new Map<string, RecordedBlock>([
            ["2,64,2", andesite],
            ["8,20,3", recordingBlock("minecraft:deepslate")]
        ]));

        scrub(dim);

        assert.equal(andesite.setTypeCalls.length, 0, "a convertible block is repainted, never deleted");
        assert.deepEqual(bulkFillsFor(dim, "minecraft:andesite"), [
            "fill 0 0 0 15 127 15 minecraft:stone replace minecraft:andesite"
        ]);
        assert.deepEqual(bulkFillsFor(dim, "minecraft:deepslate"), [
            "fill 0 0 0 15 127 15 minecraft:stone replace minecraft:deepslate"
        ]);
    });

    it("reports success only for a chunk it was actually able to read", () => {
        const readable = scrubDimension(new Map<string, RecordedBlock>());
        assert.equal(drain(readable), true, "a fully read chunk is done");

        const unloaded = scrubDimension(new Map<string, RecordedBlock>());
        unloaded.isChunkLoaded = () => false;

        // An unloaded chunk reads as "nothing to do", which must not be mistaken for "already clean"
        // now that a success mark keeps a chunk out of the queue until the re-verify window.
        assert.equal(drain(unloaded), false, "an unread chunk must stay queued for a retry");
        assert.deepEqual(unloaded.commands, [], "an unloaded chunk must not be filled against");
    });

    it("clears a post-Beta species' whole building set through the bulk path", () => {
        const dim = scrubDimension(new Map<string, RecordedBlock>([
            ["2,64,2", recordingBlock("minecraft:jungle_planks")],
            ["3,64,2", recordingBlock("minecraft:jungle_stairs")],
            ["6,64,2", recordingBlock("minecraft:acacia_fence")],
            ["7,64,2", recordingBlock("minecraft:crimson_stem")]
        ]));

        scrub(dim);

        // These ids are derived from the post-Beta species list rather than hand-listed, and the fine
        // pass that used to be their only route is absent from the pinned module version - so the
        // bulk table is the path that has to reach them.
        for (const [id, replacement] of [
            ["minecraft:jungle_planks", "minecraft:planks"],
            ["minecraft:jungle_stairs", "minecraft:oak_stairs"],
            ["minecraft:acacia_fence", "bh:fence"],
            // A stem is the one spelling whose replacement is a log rather than its own species' part.
            ["minecraft:crimson_stem", "minecraft:oak_log"]
        ]) {
            assert.deepEqual(
                bulkFillsFor(dim, id),
                [`fill 0 0 0 15 127 15 ${replacement} replace ${id}`],
                `expected ${id} to be bulk-filled to ${replacement}`
            );
        }
    });

    it("keeps its success mark when the engine declines the fine query", () => {
        const dim = scrubDimension(new Map<string, RecordedBlock>([
            ["2,64,2", recordingBlock("minecraft:andesite")]
        ]));
        // The engine can refuse the reverse query outright. The chunk has still been read, so it must
        // not be left unmarked: an unmarkable chunk is re-swept whole on every pass, forever.
        let attempts = 0;
        dim.getBlocks = () => {
            attempts++;
            throw new Error("the volume query is unavailable");
        };

        assert.equal(drain(dim), true, "a declined query must not cost the chunk its success mark");
        assert.deepEqual(
            bulkFillsFor(dim, "minecraft:andesite"),
            ["fill 0 0 0 15 127 15 minecraft:stone replace minecraft:andesite"],
            "the bulk pass must still run when the fine query is refused"
        );

        const firstSweep = warnings.lines.filter(line => line.includes("during fineScrubQuery")).length;
        assert.ok(firstSweep > 0, "a refused query has to be reported at least once");

        const attemptsBefore = attempts;
        drain(dim);

        // The refusal is structural, so one line is the whole report - but the call is still made.
        // Latching the attempt off instead would need a per-dimension verdict, and a transient refusal
        // would then switch off a query that works on another build.
        assert.equal(
            warnings.lines.filter(line => line.includes("during fineScrubQuery")).length,
            firstSweep,
            "a structural query refusal must not re-report on the next sweep"
        );
        assert.ok(attempts > attemptsBefore, "the next sweep must still attempt the query");
    });

    it("keeps its success mark when one block refuses its write", () => {
        // The consolidated planks block is the fine pass's one per-block write: a fill can set a type
        // but not the wood species a state carries, so this is where a refused write still lands.
        const stubborn = recordingBlock("minecraft:planks", { wood_type: "spruce" });
        stubborn.setPermutation = () => {
            throw new Error("the block could not be written");
        };

        const dim = scrubDimension(new Map<string, RecordedBlock>([["3,64,4", stubborn]]));

        // One unwritable block used to fail the whole sweep, which left the chunk permanently dirty.
        assert.equal(drain(dim), true, "one unwritable block must not wedge the whole chunk");

        // Unlike the structural query refusal, this is an anomaly of one chunk, so it keeps its
        // per-chunk cadence - silencing it here would be the bug the query latch exists to avoid.
        const perChunkLines = () => warnings.lines.filter(line => line.includes("during fineScrub [")).length;
        const firstSweep = perChunkLines();
        assert.ok(firstSweep > 0, "a refused write has to be reported for its chunk");

        drain(dim);

        assert.ok(perChunkLines() > firstSweep, "a per-chunk write refusal must report on every sweep");
    });

    it("group-tests the bulk table instead of probing every entry", () => {
        const dim = scrubDimension(new Map<string, RecordedBlock>([
            ["2,64,2", recordingBlock("minecraft:andesite")]
        ]));

        scrub(dim);

        // A 70-entry table must not cost 70 full-volume scans. The present type is located by
        // pruning ranges, so the probe count tracks what the chunk holds, not the table's size.
        assert.ok(
            dim.containsBlockCalls < 40,
            `expected group-testing, got ${dim.containsBlockCalls} volume probes`
        );
    });

    it("never builds a fill for a type the chunk does not contain", () => {        const dim = scrubDimension(new Map<string, RecordedBlock>([
            ["2,64,2", recordingBlock("minecraft:andesite")]
        ]));

        scrub(dim);

        // The gating probe is the whole point: 80 table entries would otherwise each pay for a native
        // scan of the band, and this chunk only needs the one it actually holds.
        assert.equal(dim.commands.length, 1, `expected only the andesite fill, got: ${dim.commands.join(" | ")}`);
        assert.deepEqual(bulkFillsFor(dim, "minecraft:deepslate"), []);
        assert.deepEqual(bulkFillsFor(dim, "minecraft:terracotta"), []);
        assert.deepEqual(bulkFillsFor(dim, "minecraft:magma"), []);
    });

    it("clears a mass of one post-Beta rock type with one fill and one batch of reads", () => {
        const blocks = new Map<string, RecordedBlock>();
        for (let y = 0; y < 64; y++) {
            for (let z = 0; z < 16; z++) {
                for (let x = 0; x < 4; x++) {
                    blocks.set(`${x},${y},${z}`, recordingBlock("minecraft:basalt"));
                }
            }
        }

        const dim = scrubDimension(blocks);
        scrub(dim);

        // Basalt is the shape of the problem: no authentic counterpart, no table entry, and one of the
        // Nether's own biomes is made of it. Deleting it a block at a time cost 4,096 reads and 4,096
        // writes per band; a type uniform by id is one fill, and the read pass stops once the band
        // holds nothing it has not already classified.
        assert.deepEqual(bulkFillsFor(dim, "minecraft:basalt"), [
            "fill 0 0 0 15 127 15 minecraft:air replace minecraft:basalt"
        ]);
        assert.equal(perBlockWrites, 0, "a mass of one type must not be written one block at a time");
        assert.ok(
            dim.getBlockCalls <= 512,
            `expected one read batch, got ${dim.getBlockCalls} reads for 4,096 basalt blocks`
        );
    });

    it("reaches a second type that only appears after a batch has been read", () => {
        const blocks = new Map<string, RecordedBlock>();
        for (let y = 0; y < 32; y++) {
            for (let z = 0; z < 16; z++) {
                for (let x = 0; x < 4; x++) {
                    blocks.set(`${x},${y},${z}`, recordingBlock("minecraft:basalt"));
                }
            }
        }
        // Sorts after every basalt block, so the sweep has classified basalt and asked the volume
        // whether anything unclassified was left before it reaches this one.
        blocks.set("15,64,15", recordingBlock("minecraft:blackstone"));

        const dim = scrubDimension(blocks);
        scrub(dim);

        assert.deepEqual(bulkFillsFor(dim, "minecraft:basalt"), [
            "fill 0 0 0 15 127 15 minecraft:air replace minecraft:basalt"
        ]);
        assert.deepEqual(
            bulkFillsFor(dim, "minecraft:blackstone"),
            ["fill 0 0 0 15 127 15 minecraft:air replace minecraft:blackstone"],
            "stopping the read pass early must not skip a type the band still holds"
        );
        assert.equal(perBlockWrites, 0, "neither type may be written one block at a time");
    });

    it("caps coordinate reads per band so unclassified repeats cannot stall the engine", () => {
        const blocks = new Map<string, RecordedBlock>();
        for (let y = 0; y < 50; y++) {
            for (let z = 0; z < 10; z++) {
                for (let x = 0; x < 6; x++) {
                    blocks.set(`${x},${y},${z}`, recordingBlock("minecraft:crafter"));
                }
            }
        }

        const dim = scrubDimension(blocks);
        // If containsBlock refuses or always returns true, reads must still be bounded
        dim.containsBlock = () => true;

        scrub(dim);

        assert.ok(
            dim.getBlockCalls <= 1024,
            `expected fine read budget to cap reads at 1024, got ${dim.getBlockCalls}`
        );
        assert.ok(bulkFillsFor(dim, "minecraft:crafter").length > 0);
    });
});

