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
// A ruined portal is the one vanilla structure the Nether still generates, and its chest sits at the
// portal: a single chunk of ring left the loot in the next chunk over until the player walked into it.
const SCRUB_RADIUS = 2;

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
// One read batch is one tick's slice of the fine pass: it ends in a yield, and the band is asked
// whether anything unclassified is left once it has classified a type.
const FINE_READ_BATCH = 512;

function reverifyOffset(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) | 0;
    }
    return (hash >>> 0) % REVERIFY_SPREAD_TICKS;
}

/**
 * Filter for authentic Beta blocks preserved by fine pass volume queries. Only air is added here: the
 * registry already carries the era's ids in every spelling the engine answers to.
 */
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

const UNTOUCHED_TYPES: string[] = buildUntouchedTypes();

const UNTOUCHED_FILTER: BlockFilter = Object.freeze({ excludeTypes: UNTOUCHED_TYPES });

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

function buildScrubTargets(): readonly (readonly [string, string])[] {
    const seen = new Set<string>();
    const targets: [string, string][] = [];
    for (const [target, replacement] of [
        ...BLOCK_BULK_REPLACEMENTS,
        ...Object.entries(BLOCK_FINE_REPLACEMENTS),
        ...buildPostBetaWoodTargets()
    ]) {
        if (seen.has(target)) continue;
        seen.add(target);
        targets.push([target, replacement]);
    }
    return targets;
}

const SCRUB_TARGETS: readonly (readonly [string, string])[] = buildScrubTargets();

const BULK_TARGET_TYPES: string[] = SCRUB_TARGETS.map(([target]) => target);

const BULK_RANGE_FILTERS = new Map<string, BlockFilter>();
function bulkRangeFilter(lo: number, hi: number): BlockFilter {
    const key = `${lo}:${hi}`;
    let filter = BULK_RANGE_FILTERS.get(key);
    if (filter === undefined) {
        filter = { includeTypes: BULK_TARGET_TYPES.slice(lo, hi + 1) };
        BULK_RANGE_FILTERS.set(key, filter);
    }
    return filter;
}

const BULK_BY_TARGET = new Map(SCRUB_TARGETS);

function markScrubbed(key: string, tick: number): void {
    if (SCRUB_DUE_AT.size >= MAX_TRACKED_CHUNKS) {
        const oldest = SCRUB_DUE_AT.keys().next().value;
        if (oldest !== undefined) {
            SCRUB_DUE_AT.delete(oldest);
        }
    }
    SCRUB_DUE_AT.set(key, tick + REVERIFY_INTERVAL_TICKS + reverifyOffset(key));
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

// Uses native fillBlocks directly to bypass command parsing and the 32,768 block command volume cap.
function fill(dim: Dimension, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, block: string, filter?: BlockFilter): void {
    try {
        dim.fillBlocks(
            new BlockVolume({ x: x1, y: y1, z: z1 }, { x: x2, y: y2, z: z2 }),
            block,
            { blockFilter: filter, ignoreChunkBoundErrors: true }
        );
    } catch {
        // Outside loaded chunks; retried on later pass.
    }
}

/**
 * What one block type becomes, from its id alone. The consolidated Bedrock planks block is the one
 * exception: its wood species lives in a block state, and a fill sets a type without touching states,
 * so it keeps the per-block path. Every other id answers for itself, which is what lets a whole type
 * be written by one filtered fill instead of one write per block.
 */
const PLANKS_RETYPE = "planks:retype";

/** A target a fill can write, unless it is the consolidated planks block a fill cannot restate. */
function toFillTarget(target: string): string {
    return target === PLANKS_TARGET ? PLANKS_RETYPE : target;
}

function fineTargetOf(typeId: string): string | undefined {
    if (typeId === PLANKS_TARGET) return PLANKS_RETYPE;

    const bulkTarget = BULK_BY_TARGET.get(typeId);
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

/**
 * The types a band's read batch has already classified, so the volume can be asked whether anything
 * it would still return is of a type no fill covers yet. A refused query falls back to `true`, which
 * keeps the answer on the conservative side: keep reading.
 */
function unclassifiedFilter(classified: ReadonlyMap<string, string>): BlockFilter {
    return { excludeTypes: [...UNTOUCHED_TYPES, ...classified.keys()] };
}

function containsBlocksIn(dimension: Dimension, volume: BlockVolume, filter: BlockFilter): boolean {
    try {
        return dimension.containsBlock(volume, filter, true);
    } catch {
        return true;
    }
}

/** Binary search to find which scrub target types exist in volume with minimal containsBlock calls. */
function collectBulkTargets(dimension: Dimension, volume: BlockVolume, lo: number, hi: number, present: number[]): void {
    if (!containsBlocksIn(dimension, volume, bulkRangeFilter(lo, hi))) return;

    if (lo === hi) {
        present.push(lo);
        return;
    }

    const mid = (lo + hi) >> 1;
    collectBulkTargets(dimension, volume, lo, mid, present);
    collectBulkTargets(dimension, volume, mid + 1, hi, present);
}

function runBulkReplacements(dimension: Dimension, volume: BlockVolume, cx: number, cz: number, bandBottom: number, bandTop: number): void {
    const present: number[] = [];
    collectBulkTargets(dimension, volume, 0, SCRUB_TARGETS.length - 1, present);
    if (present.length === 0) return;

    const x1 = cx * CHUNK_SIZE;
    const z1 = cz * CHUNK_SIZE;
    const x2 = x1 + CHUNK_SIZE - 1;
    const z2 = z1 + CHUNK_SIZE - 1;

    for (const i of present) {
        const [target, replacement] = SCRUB_TARGETS[i];
        fill(dimension, x1, bandBottom, z1, x2, bandTop, z2, replacement, { includeTypes: [target] });
    }
}

/**
 * A structure chest carries loot the era never had, and the chest the pack gives a player is
 * `bh:chest`, so a `minecraft:chest` in the world is always a generated one. It is deleted rather
 * than retyped: opening it would run the pack's container screen over the structure's own loot. The
 * id stays in `BETA_BLOCK_IDS` for the drop boundary, so this cannot live in the compatibility
 * tables — which is also what keeps the untouched-terrain filter from preserving it as Beta terrain.
 */
const GENERATED_CHEST_FILTER: BlockFilter = Object.freeze({ includeTypes: ["minecraft:chest"] });

function clearGeneratedChests(dimension: Dimension, volume: BlockVolume, x1: number, bandBottom: number, z1: number, bandTop: number): void {
    if (!containsBlocksIn(dimension, volume, GENERATED_CHEST_FILTER)) return;
    fill(dimension, x1, bandBottom, z1, x1 + CHUNK_SIZE - 1, bandTop, z1 + CHUNK_SIZE - 1, "minecraft:air", GENERATED_CHEST_FILTER);
}

// Dimension.getBlocks may throw unhandled native errors on certain engine builds; latch to avoid log spam.
let fineQueryRefusalReported = false;

/**
 * The pass the tables did not claim: what the bulk replacements leave behind, classified by id. A type
 * is written once for the whole band rather than once per block, and an id that answers for itself stops
 * being read as soon as the band holds nothing else - the old shape paid one native read and one native
 * write per block, which is thousands of calls for a chunk made of one modern rock type.
 */
export function* scrubFineDetails(dimension: Dimension, cx: number, cz: number): Generator<void, boolean, unknown> {
    const { min: yMin, max: yMax } = dimension.heightRange;
    const x1 = cx * CHUNK_SIZE;
    const z1 = cz * CHUNK_SIZE;

    if (!dimension.isChunkLoaded({ x: x1, y: yMin, z: z1 })) return false;

    let refusedBands = 0;
    let refusedReads = 0;
    let refusedBlocks = 0;
    let firstError: unknown;

    for (let y = yMin; y <= yMax; y += BAND_HEIGHT) {
        const bandTop = Math.min(y + BAND_HEIGHT - 1, yMax);
        const volume = new BlockVolume({ x: x1, y, z: z1 }, { x: x1 + CHUNK_SIZE - 1, y: bandTop, z: z1 + CHUNK_SIZE - 1 });

        runBulkReplacements(dimension, volume, cx, cz, y, bandTop);
        clearGeneratedChests(dimension, volume, x1, y, z1, bandTop);

        let matches: BlockLocationIterator | null = null;
        try {
            matches = dimension.getBlocks(volume, UNTOUCHED_FILTER, true).getBlockLocationIterator();
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

            try {
                const locations = matches[Symbol.iterator]();
                let exhausted = false;

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

                    // A batch that ran the band out is followed by the band's own yield, so yielding here
                    // too would spend a whole tick on nothing.
                    if (reads > 0 && !exhausted) yield;

                    // A batch that classified nothing new cannot end the pass, so probing here would buy
                    // a whole-volume scan to learn what the batch already said. When it does end the
                    // pass, every block left unread in the band is of a type already covered by a fill.
                    if (classifiedAnything && !exhausted && !containsBlocksIn(dimension, volume, unclassifiedFilter(classified))) {
                        exhausted = true;
                    }
                }
            } catch (error) {
                refusedReads++;
                firstError ??= error;
            }

            for (const [typeId, target] of classified) {
                fill(dimension, x1, y, z1, x1 + CHUNK_SIZE - 1, bandTop, z1 + CHUNK_SIZE - 1, target, { includeTypes: [typeId] });
            }
        }

        yield;
    }

    if (firstError !== undefined) {
        reportError(
            { system: "chunkScrubber", operation: "fineScrub", target: `${cx},${cz}`, details: { refusedReads, refusedBlocks } },
            firstError
        );
    }

    return true;
}

let playerCursor = 0;

/**
 * The Overworld ships pre-generated in the world template, so the sweep is Nether-only: new Overworld
 * chunks are left to Bedrock's own generation the way the template world is.
 */
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

            if (!clean) continue;

            markScrubbed(key, tick);
            scrubbed++;
        }
    }
}

tickManager.register("chunkScrubber", 3, chunkScanJob, 1);
