import { world, system, BlockPermutation, BlockVolume, Dimension } from "@minecraft/server";
import type { Block, BlockFilter, BlockLocationIterator } from "@minecraft/server";
import { BETA_BLOCK_IDS, POST_BETA_WOOD_SPECIES } from "../core/betaRegistry.js";
import { BLOCK_BULK_REPLACEMENTS, BLOCK_FINE_REPLACEMENTS } from "../core/compatibilityPolicy.js";
import { normalizeBlock } from "../core/normalizer.js";
import { reportError } from "../core/errorReporter.js";
import { tickManager } from "../core/tickManager.js";
import { BETA_FLOOR_Y, OVERWORLD_ID } from "../core/betaConstants.js";

const SCRUB_DUE_AT = new Map<string, number>();
const MAX_TRACKED_CHUNKS = 8192;
const CHUNKS_PER_TICK_LIMIT = 1;
const SCRUB_RADIUS = 1;

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

function reverifyOffset(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) | 0;
    }
    return (hash >>> 0) % REVERIFY_SPREAD_TICKS;
}

const BETA_FLOOR_LAYERS = 2;

/** Filter for horizontal logs (modern fallen trees). */
function buildHorizontalLogFilter(): BlockFilter {
    const includePermutations: BlockPermutation[] = [];
    for (const type of ["minecraft:oak_log", "minecraft:birch_log", "minecraft:spruce_log"]) {
        for (const axis of ["x", "z"]) {
            try {
                includePermutations.push(BlockPermutation.resolve(type, { pillar_axis: axis }));
            } catch {
                // Log type or axis permutation unavailable in current engine build.
            }
        }
    }
    return Object.freeze({ includePermutations });
}

const HORIZONTAL_LOG_FILTER: BlockFilter = buildHorizontalLogFilter();

/** Filter for authentic Beta blocks preserved by fine pass volume queries. */
function buildUntouchedFilter(): BlockFilter {
    const excludeTypes: string[] = [];
    const candidates = new Set<string>([
        "minecraft:air",
        ...BETA_BLOCK_IDS,
        // Bedrock's legacy spellings for era blocks the registry names the Java way: the fine pass
        // would otherwise read a cobweb or a dead bush as modern terrain and erase it.
        "minecraft:deadbush",
        "minecraft:web",
        "minecraft:mob_spawner",
        "minecraft:unpowered_repeater",
        "minecraft:powered_repeater",
        "minecraft:stone_block_slab",
        "minecraft:brick_block"
    ]);

    for (const id of candidates) {
        try {
            BlockPermutation.resolve(id);
            excludeTypes.push(id);
        } catch {
            // Unregistered block identifier in current engine build.
        }
    }

    return Object.freeze({ excludeTypes });
}

const UNTOUCHED_FILTER: BlockFilter = buildUntouchedFilter();

/** Filter to test if floor is already sealed with bedrock. */
const NOT_BEDROCK_FILTER: BlockFilter = Object.freeze({ excludeTypes: ["minecraft:bedrock"] });

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
            if (norm.action === "keep" || !norm.targetId) continue;
            targets.push([id, norm.targetId]);
        }

        for (const spelling of [`stripped_${species}_log`, `stripped_${species}_stem`]) {
            const id = `minecraft:${spelling}`;
            const norm = normalizeBlock(id);
            if (norm.action === "keep" || !norm.targetId) continue;
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

function floorNoise(cx: number, cz: number, gx: number, gz: number): number {
    let h = (cx * 374761393 + cz * 668265263 + gx * 1274126177 + gz * 1013904223) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function floorHeight(noise: number): number {
    if (noise < 0.3) return 0;
    return noise < 0.72 ? 1 : BETA_FLOOR_LAYERS;
}

/** Generates a ragged bedrock floor at Y=0 matching Beta 1.7.3. */
export function solidifyBetaFloor(dim: Dimension, cx: number, cz: number): void {
    if (dim.id !== OVERWORLD_ID) return;

    const originX = cx * CHUNK_SIZE;
    const originZ = cz * CHUNK_SIZE;

    // The floor is deterministic per chunk and its base layer is always a full bedrock slab, so
    // "Y=0 holds nothing but bedrock" answers "was this chunk sealed already" for 256 blocks. The
    // cap above the base is ~120 separate fills - the single largest native cost the scrubber had -
    // and without this gate every re-verify of an already-sealed chunk paid for all of them again.
    // A failed fill leaves the slab unsealed, so the probe stays true and the seal is retried.
    if (
        !containsBlocksIn(
            dim,
            new BlockVolume(
                { x: originX, y: BETA_FLOOR_Y, z: originZ },
                { x: originX + CHUNK_SIZE - 1, y: BETA_FLOOR_Y, z: originZ + CHUNK_SIZE - 1 }
            ),
            NOT_BEDROCK_FILTER
        )
    ) {
        return;
    }

    // A solid base first: with the sub-zero column no longer ballasted, a gap here would drop the
    // player onto native deepslate or, in a flat world, into the void.
    fill(dim, originX, BETA_FLOOR_Y, originZ, originX + CHUNK_SIZE - 1, BETA_FLOOR_Y, originZ + CHUNK_SIZE - 1, "minecraft:bedrock");

    for (let z = 0; z < CHUNK_SIZE; z++) {
        let runStart = -1;
        let runHeight = 0;

        for (let x = 0; x <= CHUNK_SIZE; x++) {
            // The trailing sentinel of height zero flushes whatever run is still open.
            const height = x === CHUNK_SIZE ? 0 : floorHeight(floorNoise(cx, cz, x, z));

            if (runStart >= 0 && height === runHeight) continue;

            if (runStart >= 0) {
                fill(dim, originX + runStart, BETA_FLOOR_Y + 1, originZ + z, originX + x - 1, runHeight, originZ + z, "minecraft:bedrock");
            }

            runStart = height > 0 ? x : -1;
            runHeight = height;
        }
    }
}

export function clearFallenLogs(dim: Dimension, cx: number, cz: number): void {
    if (dim.id !== OVERWORLD_ID) return;

    const permutations = HORIZONTAL_LOG_FILTER.includePermutations;
    if (!permutations || permutations.length === 0) return;

    const { max: yMax } = dim.heightRange;
    const x1 = cx * CHUNK_SIZE;
    const z1 = cz * CHUNK_SIZE;
    const x2 = x1 + CHUNK_SIZE - 1;
    const z2 = z1 + CHUNK_SIZE - 1;

    for (let y = BETA_FLOOR_Y; y <= yMax; y += BAND_HEIGHT) {
        const bandTop = Math.min(y + BAND_HEIGHT - 1, yMax);
        const volume = new BlockVolume({ x: x1, y, z: z1 }, { x: x2, y: bandTop, z: z2 });

        if (!containsBlocksIn(dim, volume, HORIZONTAL_LOG_FILTER)) continue;

        fill(dim, x1, y, z1, x2, bandTop, z2, "minecraft:air", HORIZONTAL_LOG_FILTER);
    }
}

const PERM_CACHE = new Map<string, BlockPermutation | null>();
function getPermutation(typeId: string): BlockPermutation | null {
    if (PERM_CACHE.has(typeId)) return PERM_CACHE.get(typeId) ?? null;
    try {
        const perm = BlockPermutation.resolve(typeId);
        PERM_CACHE.set(typeId, perm);
        return perm;
    } catch {
        PERM_CACHE.set(typeId, null);
        return null;
    }
}

function applyReplacement(block: Block, targetId: string): void {
    if (targetId === "minecraft:air") {
        block.setType("minecraft:air");
        return;
    }
    if (targetId === "minecraft:water") {
        block.setType("minecraft:water");
        return;
    }
    const permutation = getPermutation(targetId);
    if (permutation) {
        block.setPermutation(permutation);
    }
}

function applyFineScrub(block: Block): void {
    let typeId = block.typeId;

    const bulkTarget = BULK_BY_TARGET.get(typeId);
    if (bulkTarget !== undefined) {
        applyReplacement(block, bulkTarget);
        if (bulkTarget !== "minecraft:planks") return;
        typeId = bulkTarget;
    }

    if (typeId === "minecraft:planks") {
        if (block.permutation.getState("wood_type") !== "oak") {
            block.setPermutation(BlockPermutation.resolve("minecraft:planks").withState("wood_type", "oak"));
        }
        return;
    }

    const fineTarget = BLOCK_FINE_REPLACEMENTS[typeId];
    const blockNorm = fineTarget === undefined
        ? normalizeBlock(typeId)
        : { action: "convert" as const, targetId: fineTarget };

    if (blockNorm.action === "convert" && blockNorm.targetId) {
        applyReplacement(block, blockNorm.targetId);
    } else if (blockNorm.action === "remove") {
        block.setType("minecraft:air");
    }
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

// Dimension.getBlocks may throw unhandled native errors on certain engine builds; latch to avoid log spam.
let fineQueryRefusalReported = false;

export function* scrubFineDetails(dimension: Dimension, cx: number, cz: number): Generator<void, boolean, unknown> {
    const { min: yMin, max: yMax } = dimension.heightRange;
    const x1 = cx * CHUNK_SIZE;
    const z1 = cz * CHUNK_SIZE;

    const startY = dimension.id === OVERWORLD_ID ? Math.max(yMin, BETA_FLOOR_Y) : yMin;

    if (!dimension.isChunkLoaded({ x: x1, y: startY, z: z1 })) return false;

    let refusedBands = 0;
    let refusedReads = 0;
    let refusedBlocks = 0;
    let firstError: unknown;

    for (let y = startY; y <= yMax; y += BAND_HEIGHT) {
        const bandTop = Math.min(y + BAND_HEIGHT - 1, yMax);
        const volume = new BlockVolume({ x: x1, y, z: z1 }, { x: x1 + CHUNK_SIZE - 1, y: bandTop, z: z1 + CHUNK_SIZE - 1 });

        runBulkReplacements(dimension, volume, cx, cz, y, bandTop);

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
            let inspected = 0;
            try {
                for (const location of matches) {
                    try {
                        const block = dimension.getBlock(location);
                        if (block) applyFineScrub(block);
                    } catch (error) {
                        refusedBlocks++;
                        firstError ??= error;
                    }

                    if (++inspected % 512 === 0) yield;
                }
            } catch (error) {
                refusedReads++;
                firstError ??= error;
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

            if (!dimension.isChunkLoaded({ x: chunkX * CHUNK_SIZE, y: BETA_FLOOR_Y, z: chunkZ * CHUNK_SIZE })) continue;

            SCRUB_IN_FLIGHT.set(key, tick);
            solidifyBetaFloor(dimension, chunkX, chunkZ);
            clearFallenLogs(dimension, chunkX, chunkZ);

            const clean = yield* scrubFineDetails(dimension, chunkX, chunkZ);
            SCRUB_IN_FLIGHT.delete(key);

            if (!clean) continue;

            markScrubbed(key, tick);
            scrubbed++;
        }
    }
}

tickManager.register("chunkScrubber", 3, chunkScanJob, 1);
