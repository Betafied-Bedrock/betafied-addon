import { world, system, BlockPermutation, BlockVolume, Dimension } from "@minecraft/server";
import type { Block, BlockFilter, BlockLocationIterator } from "@minecraft/server";
import { BETA_BLOCK_IDS, POST_BETA_WOOD_SPECIES } from "../policy/betaRegistry.js";
import { BLOCK_BULK_REPLACEMENTS, BLOCK_FINE_REPLACEMENTS } from "../policy/compatibilityPolicy.js";
import { normalizeBlock } from "../policy/normalizer.js";
import { reportError } from "../core/errorReporter.js";
import { tickManager } from "../core/tickManager.js";
import { NETHER_ID } from "../policy/betaConstants.js";

const SCRUB_DUE_AT = new Map<string, number>();
const MAX_TRACKED_CHUNKS = 8192;
const CHUNKS_PER_TICK_LIMIT = 1;
// 64-block radius (4 chunks) sweeps out to the full Bedrock simulation distance.
const SCRUB_RADIUS = 4;

function buildNeighbourhood(): (readonly [number, number])[] {
    const offsets: [number, number][] = [];
    for (let dx = -SCRUB_RADIUS; dx <= SCRUB_RADIUS; dx++) {
        for (let dz = -SCRUB_RADIUS; dz <= SCRUB_RADIUS; dz++) {
            offsets.push([dx, dz]);
        }
    }
    // Nearest first so immediate player ground is sealed before outer ring.
    return offsets.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
}

const SCRUB_NEIGHBOURHOOD: readonly (readonly [number, number])[] = buildNeighbourhood();

// 128-block band bounds volume queries to 32,768 blocks for native Bedrock API limits.
const BAND_HEIGHT = 128;
const CHUNK_SIZE = 16;
const REVERIFY_INTERVAL_TICKS = 2400;
const REVERIFY_SPREAD_TICKS = 600;
// An unfinished pass retries here, not on the long window that hid a patch a player had walked back to.
const RETRY_INTERVAL_TICKS = 120;
// One read batch is one tick's fine-pass slice, and ends in the yield below.
const FINE_READ_BATCH = 512;
const MAX_FINE_READS_PER_BAND = 1024;

function reverifyOffset(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) | 0;
    }
    return (hash >>> 0) % REVERIFY_SPREAD_TICKS;
}

// Fine-pass filter: air plus the era's registered ids, which already cover every spelling the engine answers.
function buildUntouchedTypes(): string[] {
    const excludeTypes: string[] = [];
    const candidates = new Set<string>([
        "minecraft:air",
        ...BETA_BLOCK_IDS
    ]);

    for (const id of candidates) {
        try {
            BlockPermutation.resolve(id);
            excludeTypes.push(id);
        } catch {
            // Unregistered block identifier in current engine build.
        }
    }

    return excludeTypes;
}

// Built on first use: block-id lookups at this module's top level run in early execution and throw.
let untouchedTypesCache: string[] | undefined;

function untouchedTypes(): string[] {
    untouchedTypesCache ??= buildUntouchedTypes();
    return untouchedTypesCache;
}

let untouchedFilterCache: BlockFilter | undefined;

function untouchedFilter(): BlockFilter {
    untouchedFilterCache ??= Object.freeze({ excludeTypes: untouchedTypes() });
    return untouchedFilterCache;
}

const PLANKS_TARGET = BLOCK_BULK_REPLACEMENTS.find(([target]) => target.endsWith("_planks"))?.[1] ?? "minecraft:planks";

function buildPostBetaWoodTargets(): readonly (readonly [string, string])[] {
    const suffixes = [
        "planks", "log", "stem", "wood", "hyphae",
        "fence", "fence_gate", "stairs", "slab",
        "leaves", "door", "trapdoor", "sign", "sapling"
    ];

    const targets: [string, string][] = [];
    for (const species of POST_BETA_WOOD_SPECIES) {
        for (const suffix of suffixes) {
            const id = `minecraft:${species}_${suffix}`;

            if (suffix === "planks") {
                targets.push([id, PLANKS_TARGET]);
                continue;
            }

            const norm = normalizeBlock(id);
            if (norm.action !== "convert") continue;
            targets.push([id, norm.targetId]);
        }

        for (const spelling of [`stripped_${species}_log`, `stripped_${species}_stem`]) {
            const id = `minecraft:${spelling}`;
            const norm = normalizeBlock(id);
            if (norm.action !== "convert") continue;
            targets.push([id, norm.targetId]);
        }
    }
    return targets;
}

// Resolvable ids only: an unresolvable probe is refused, reads as present, and its fill ends the band; resolver injectable for tests.
export function buildScrubTargets(
    isRegistered: (id: string) => boolean = engineRegistersBlock
): readonly (readonly [string, string])[] {
    const seen = new Set<string>();
    const targets: [string, string][] = [];
    for (const [target, replacement] of [
        ...BLOCK_BULK_REPLACEMENTS,
        ...Object.entries(BLOCK_FINE_REPLACEMENTS),
        ...buildPostBetaWoodTargets()
    ]) {
        if (seen.has(target)) continue;
        seen.add(target);
        if (!isRegistered(target)) continue;
        targets.push([target, replacement]);
    }
    return targets;
}

function engineRegistersBlock(id: string): boolean {
    try {
        BlockPermutation.resolve(id);
        return true;
    } catch {
        return false;
    }
}

let resolvedTargets: readonly (readonly [string, string])[] | undefined;

function scrubTargets(): readonly (readonly [string, string])[] {
    resolvedTargets ??= buildScrubTargets();
    return resolvedTargets;
}

let resolvedTargetTypes: string[] | undefined;

function bulkTargetTypes(): string[] {
    resolvedTargetTypes ??= scrubTargets().map(([target]) => target);
    return resolvedTargetTypes;
}

const BULK_RANGE_FILTERS = new Map<string, BlockFilter>();
function bulkRangeFilter(lo: number, hi: number): BlockFilter {
    const key = `${lo}:${hi}`;
    let filter = BULK_RANGE_FILTERS.get(key);
    if (filter === undefined) {
        filter = { includeTypes: bulkTargetTypes().slice(lo, hi + 1) };
        BULK_RANGE_FILTERS.set(key, filter);
    }
    return filter;
}

let bulkByTarget: ReadonlyMap<string, string> | undefined;

function bulkReplacementFor(typeId: string): string | undefined {
    bulkByTarget ??= new Map(scrubTargets());
    return bulkByTarget.get(typeId);
}

function markScrubbed(key: string, tick: number, delayTicks: number): void {
    if (SCRUB_DUE_AT.size >= MAX_TRACKED_CHUNKS) {
        const oldest = SCRUB_DUE_AT.keys().next().value;
        if (oldest !== undefined) {
            SCRUB_DUE_AT.delete(oldest);
        }
    }
    SCRUB_DUE_AT.set(key, tick + delayTicks);
}

function needsScrub(key: string, tick: number): boolean {
    const dueAt = SCRUB_DUE_AT.get(key);
    return dueAt === undefined || tick >= dueAt;
}

// In-flight chunk claims prevent concurrent passes from re-processing the same chunk across yield points.
const SCRUB_IN_FLIGHT = new Map<string, number>();
const IN_FLIGHT_STALE_TICKS = 200;

function isInFlight(key: string, tick: number): boolean {
    const claimedAt = SCRUB_IN_FLIGHT.get(key);
    return claimedAt !== undefined && tick - claimedAt < IN_FLIGHT_STALE_TICKS;
}

// fillBlocks skips command parsing and the 32,768-block command cap; a non-undefined answer is the engine refusing the write.
function fill(dim: Dimension, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, block: string, filter?: BlockFilter): unknown {
    try {
        dim.fillBlocks(
            new BlockVolume({ x: x1, y: y1, z: z1 }, { x: x2, y: y2, z: z2 }),
            block,
            { blockFilter: filter, ignoreChunkBoundErrors: true }
        );
        return undefined;
    } catch (error) {
        return error;
    }
}

// The consolidated planks block carries its species in a state a fill cannot set, so it keeps the per-block path.
const PLANKS_RETYPE = "planks:retype";

// A target a fill can write, unless it is the consolidated planks block a fill cannot restate.
function toFillTarget(target: string): string {
    return target === PLANKS_TARGET ? PLANKS_RETYPE : target;
}

function fineTargetOf(typeId: string): string | undefined {
    if (typeId === PLANKS_TARGET) return PLANKS_RETYPE;

    const bulkTarget = bulkReplacementFor(typeId);
    if (bulkTarget !== undefined) return toFillTarget(bulkTarget);

    const fineTarget = BLOCK_FINE_REPLACEMENTS[typeId];
    if (fineTarget !== undefined) return toFillTarget(fineTarget);

    const norm = normalizeBlock(typeId);
    if (norm.action === "convert") return toFillTarget(norm.targetId);
    return norm.action === "remove" ? "minecraft:air" : undefined;
}

function retypePlanks(block: Block): void {
    if (block.permutation.getState("wood_type") === "oak") return;
    block.setPermutation(BlockPermutation.resolve(PLANKS_TARGET).withState("wood_type", "oak"));
}

// Types the band already classified; a refused query answers true, which keeps the pass reading.
function unclassifiedFilter(classified: ReadonlyMap<string, string>): BlockFilter {
    return { excludeTypes: [...untouchedTypes(), ...classified.keys()] };
}

function containsBlocksIn(dimension: Dimension, volume: BlockVolume, filter: BlockFilter): boolean {
    try {
        return dimension.containsBlock(volume, filter, true);
    } catch {
        return true;
    }
}

// Binary search for the targets present; a test pins the empty-table `0..-1` case, whose unbounded recursion overflows the stack.
export function collectBulkTargets(dimension: Dimension, volume: BlockVolume, lo: number, hi: number, present: number[]): void {
    if (lo > hi) return;
    if (!containsBlocksIn(dimension, volume, bulkRangeFilter(lo, hi))) return;

    if (lo === hi) {
        present.push(lo);
        return;
    }

    const mid = (lo + hi) >> 1;
    collectBulkTargets(dimension, volume, lo, mid, present);
    collectBulkTargets(dimension, volume, mid + 1, hi, present);
}

function runBulkReplacements(dimension: Dimension, volume: BlockVolume, cx: number, cz: number, bandBottom: number, bandTop: number): unknown {
    const targets = scrubTargets();
    if (targets.length === 0) return undefined;

    const present: number[] = [];
    collectBulkTargets(dimension, volume, 0, targets.length - 1, present);
    if (present.length === 0) return undefined;

    const x1 = cx * CHUNK_SIZE;
    const z1 = cz * CHUNK_SIZE;
    const x2 = x1 + CHUNK_SIZE - 1;
    const z2 = z1 + CHUNK_SIZE - 1;

    for (const i of present) {
        const [target, replacement] = targets[i];
        const refusal = fill(dimension, x1, bandBottom, z1, x2, bandTop, z2, replacement, { includeTypes: [target] });
        if (refusal !== undefined) return refusal;
    }
    return undefined;
}

// Post-Beta generation (ruined-portal chest, fortress spawner): deleted, since neither has era behaviour; the drop boundary keeps their ids.
const GENERATED_STRUCTURE_TYPES: readonly string[] = Object.freeze(["minecraft:chest", "minecraft:mob_spawner"]);
const GENERATED_STRUCTURE_FILTER: BlockFilter = Object.freeze({ includeTypes: [...GENERATED_STRUCTURE_TYPES] });

function clearGeneratedStructures(dimension: Dimension, volume: BlockVolume, x1: number, bandBottom: number, z1: number, bandTop: number): unknown {
    if (!containsBlocksIn(dimension, volume, GENERATED_STRUCTURE_FILTER)) return undefined;

    for (const typeId of GENERATED_STRUCTURE_TYPES) {
        const refusal = fill(dimension, x1, bandBottom, z1, x1 + CHUNK_SIZE - 1, bandTop, z1 + CHUNK_SIZE - 1, "minecraft:air", { includeTypes: [typeId] });
        if (refusal !== undefined) return refusal;
    }
    return undefined;
}

// Dimension.getBlocks may throw unhandled native errors on certain engine builds; latch to avoid log spam.
let fineQueryRefusalReported = false;

// The leftovers: each type is written once for the whole band, and reading stops once nothing unclassified remains.
export function* scrubFineDetails(dimension: Dimension, cx: number, cz: number): Generator<void, boolean, unknown> {
    const { min: yMin, max: yMax } = dimension.heightRange;
    const x1 = cx * CHUNK_SIZE;
    const z1 = cz * CHUNK_SIZE;

    if (!dimension.isChunkLoaded({ x: x1, y: yMin, z: z1 })) return false;

    let refusedBands = 0;
    let refusedReads = 0;
    let refusedBlocks = 0;
    let refusedWrites = 0;
    let incomplete = false;
    let firstError: unknown;

    for (let y = yMin; y <= yMax; y += BAND_HEIGHT) {
        // The pass spans ticks, so the chunk can unload between bands; a refused write must not take the success mark.
        if (!dimension.isChunkLoaded({ x: x1, y, z: z1 })) return false;

        const bandTop = Math.min(y + BAND_HEIGHT - 1, yMax);
        const volume = new BlockVolume({ x: x1, y, z: z1 }, { x: x1 + CHUNK_SIZE - 1, y: bandTop, z: z1 + CHUNK_SIZE - 1 });

        // A refused fill ends the band: the rest of it is work the engine would refuse as well.
        const refusal = runBulkReplacements(dimension, volume, cx, cz, y, bandTop)
            ?? clearGeneratedStructures(dimension, volume, x1, y, z1, bandTop);
        if (refusal !== undefined) {
            refusedWrites++;
            firstError ??= refusal;
            break;
        }

        let matches: BlockLocationIterator | null = null;
        try {
            matches = dimension.getBlocks(volume, untouchedFilter(), true).getBlockLocationIterator();
        } catch (error) {
            refusedBands++;
            if (!fineQueryRefusalReported) {
                fineQueryRefusalReported = true;
                reportError(
                    {
                        system: "chunkScrubber",
                        operation: "fineScrubQuery",
                        target: `${cx},${cz}`,
                        details: { bandBottom: y, refusedBands, refusedBlocks }
                    },
                    error
                );
            }
        }

        if (matches !== null) {
            const classified = new Map<string, string>();
            let truncated = false;

            try {
                const locations = matches[Symbol.iterator]();
                let exhausted = false;
                let totalBandReads = 0;

                while (!exhausted) {
                    let classifiedAnything = false;
                    let reads = 0;

                    while (reads < FINE_READ_BATCH) {
                        const next = locations.next();
                        if (next.done) {
                            exhausted = true;
                            break;
                        }
                        reads++;
                        totalBandReads++;

                        try {
                            const block = dimension.getBlock(next.value);
                            if (block) {
                                const target = fineTargetOf(block.typeId);
                                if (target === PLANKS_RETYPE) {
                                    retypePlanks(block);
                                } else if (target !== undefined && !classified.has(block.typeId)) {
                                    classified.set(block.typeId, target);
                                    classifiedAnything = true;
                                }
                            }
                        } catch (error) {
                            refusedBlocks++;
                            firstError ??= error;
                        }
                    }

                    if (totalBandReads >= MAX_FINE_READS_PER_BAND) {
                        exhausted = true;
                        // The cap ends the reads, not the band's work: unclassified types are still standing.
                        truncated = containsBlocksIn(dimension, volume, unclassifiedFilter(classified));
                    }

                    // A batch that ran the band out is followed by the band's yield; another here would burn a tick.
                    if (reads > 0 && !exhausted) yield;

                    // Nothing unclassified left: stop rather than read every duplicate coordinate across the bridge.
                    if ((classifiedAnything || reads === FINE_READ_BATCH) && !exhausted && !containsBlocksIn(dimension, volume, unclassifiedFilter(classified))) {
                        exhausted = true;
                    }
                }
            } catch (error) {
                refusedReads++;
                firstError ??= error;
            }

            for (const [typeId, target] of classified) {
                const writeRefusal = fill(dimension, x1, y, z1, x1 + CHUNK_SIZE - 1, bandTop, z1 + CHUNK_SIZE - 1, target, { includeTypes: [typeId] });
                if (writeRefusal !== undefined) {
                    refusedWrites++;
                    firstError ??= writeRefusal;
                }
            }

            if (truncated) incomplete = true;
        }

        if (refusedWrites > 0) break;

        yield;
    }

    if (firstError !== undefined) {
        reportError(
            { system: "chunkScrubber", operation: "fineScrub", target: `${cx},${cz}`, details: { refusedReads, refusedBlocks, refusedWrites } },
            firstError
        );
    }

    // Only a fully read and written chunk is clean; the re-verify window would hide whatever is left.
    return refusedWrites === 0 && !incomplete;
}

let playerCursor = 0;

// Nether-only: the template's Overworld is pre-generated, so new chunks stay Bedrock's own.
export function* chunkScanJob(): Generator<void, void, unknown> {
    let scrubbed = 0;

    const players = world.getAllPlayers();
    const playerCount = players.length;
    if (playerCount === 0) return;

    const start = playerCount > 1 ? playerCursor % playerCount : 0;
    playerCursor = playerCount > 1 ? (start + 1) % playerCount : 0;

    for (let i = 0; i < playerCount; i++) {
        const player = players[(start + i) % playerCount];
        if (scrubbed >= CHUNKS_PER_TICK_LIMIT) return;
        if (!player.isValid) continue;

        const dimension = player.dimension;
        if (dimension.id !== NETHER_ID) continue;

        const { x: playerX, z: playerZ } = player.location;
        const centerX = Math.floor(playerX / CHUNK_SIZE);
        const centerZ = Math.floor(playerZ / CHUNK_SIZE);

        for (const [dx, dz] of SCRUB_NEIGHBOURHOOD) {
            if (scrubbed >= CHUNKS_PER_TICK_LIMIT) return;

            const chunkX = centerX + dx;
            const chunkZ = centerZ + dz;
            const key = `${dimension.id}:${chunkX},${chunkZ}`;

            const tick = system.currentTick;
            if (!needsScrub(key, tick) || isInFlight(key, tick)) continue;

            if (!dimension.isChunkLoaded({ x: chunkX * CHUNK_SIZE, y: 0, z: chunkZ * CHUNK_SIZE })) continue;

            SCRUB_IN_FLIGHT.set(key, tick);

            const clean = yield* scrubFineDetails(dimension, chunkX, chunkZ);
            SCRUB_IN_FLIGHT.delete(key);

            // Every chunk is marked so a failing one cannot starve the neighbourhood; only a clean pass earns the long window.
            markScrubbed(key, tick, clean ? REVERIFY_INTERVAL_TICKS + reverifyOffset(key) : RETRY_INTERVAL_TICKS);

            if (!clean) continue;

            scrubbed++;
        }
    }
}

tickManager.register("chunkScrubber", 3, chunkScanJob, 1);
