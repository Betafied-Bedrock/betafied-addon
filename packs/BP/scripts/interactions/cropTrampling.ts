import { world, GameMode, EntityComponentTypes, ItemStack } from "@minecraft/server";
import type { Block, BlockPermutation, Dimension, Entity, Vector3 } from "@minecraft/server";
import { tickManager } from "../core/tickManager.js";
import { eventBus } from "../core/eventBus.js";
import { runCatching, reportError } from "../core/errorReporter.js";
import { BH_FENCE_ID } from "../core/betaRegistry.js";
import { eraRulesApply } from "../core/permissions.js";

const CONFIG = Object.freeze({
    MOB_INTERVAL: 2,
    MOB_RADIUS: 24,
    DISTANCE_WALKED_MODIFIER: 0.6,
    WALKED_BLOCK_OFFSET: 0.2,
    TRAMPLE_ROLL: 4,
    TELEPORT_DISTANCE: 3,
    LANDING_SCAN_DEPTH: 5,
    LANDING_LOOKAHEAD: 3,
    LANDING_READ_BUDGET: 12,
    WATCH_TICKS: 30,
    DROP_CLEAR_RADIUS: 0.9,
    MAX_TRACKED_WALKERS: 1024,
    STALE_WALKER_TICKS: 1200
});

const FARMLAND_ID = "minecraft:farmland";
const DIRT_ID = "minecraft:dirt";
const AIR_ID = "minecraft:air";
const WHEAT_ID = "minecraft:wheat";
const WHEAT_SEEDS_ID = "minecraft:wheat_seeds";

const GROWTH_STATE = "growth";
const RIPE_GROWTH = 7;
const SEED_ROLLS = 3;
const SEED_ROLL_FACES = 15;

const CROP_DROP_IDS: readonly string[] = ["minecraft:wheat", "minecraft:wheat_seeds", "minecraft:seeds"];

const NON_WALKING_TYPES = ["minecraft:item", "minecraft:xp_orb", "minecraft:experience_orb"];

// Passable blocks to inspect through during downward landing raycasts.
const PASSABLE_TYPES = new Set([
    "minecraft:air",
    "minecraft:cave_air",
    "minecraft:void_air",
    "minecraft:water",
    "minecraft:flowing_water",
    "minecraft:lava",
    "minecraft:flowing_lava",
    "minecraft:wheat",
    "minecraft:carrots",
    "minecraft:potatoes",
    "minecraft:beetroot",
    "minecraft:pumpkin_stem",
    "minecraft:melon_stem",
    "minecraft:torchflower_crop",
    "minecraft:pitcher_crop"
]);

export interface WalkState {
    lastX: number;
    lastZ: number;
    distance: number;
    nextStep: number;
    lastSeen: number;
}

interface WatchedLanding {
    location: Vector3;
    farmland: BlockPermutation;
    crop?: BlockPermutation;
    expiresAt: number;
}

const walkers = new Map<string, WalkState>();
const landings = new Map<string, WatchedLanding[]>();

let mobSweepDue = false;

export function tileKey(dimensionId: string, location: Vector3): string {
    return `${dimensionId}:${location.x},${location.y},${location.z}`;
}

export function walkedBlockLocation(x: number, y: number, z: number): Vector3 {
    return {
        x: Math.floor(x),
        y: Math.floor(y - CONFIG.WALKED_BLOCK_OFFSET),
        z: Math.floor(z)
    };
}

export function consumeStep(state: WalkState, horizontalDelta: number): boolean {
    state.distance += horizontalDelta * CONFIG.DISTANCE_WALKED_MODIFIER;
    if (state.distance <= state.nextStep) return false;
    state.nextStep += 1;
    return true;
}

export function isFenceBlock(typeId: string): boolean {
    return typeId === BH_FENCE_ID || typeId === "minecraft:fence" || typeId.endsWith("_fence");
}

export function resolveTrampleTarget(dimension: Dimension, walked: Vector3): Block | undefined {
    const block = dimension.getBlock(walked);
    if (block === undefined || block.typeId !== FARMLAND_ID) return undefined;

    const below = dimension.getBlock({ x: walked.x, y: walked.y - 1, z: walked.z });
    if (below === undefined || isFenceBlock(below.typeId)) return undefined;

    return block;
}

export interface CropDrop {
    typeId: string;
    amount: number;
}

/** Authentic Beta 1.7.3 wheat drop calculation: 1 wheat if ripe, 0-3 seeds based on growth. */
export function cropDropsFor(typeId: string, growth: number, random: () => number = Math.random): CropDrop[] | undefined {
    if (typeId !== WHEAT_ID) return undefined;

    const drops: CropDrop[] = growth === RIPE_GROWTH ? [{ typeId: WHEAT_ID, amount: 1 }] : [];

    let seeds = 0;
    for (let roll = 0; roll < SEED_ROLLS; roll++) {
        if (Math.floor(random() * SEED_ROLL_FACES) <= growth) seeds += 1;
    }
    if (seeds > 0) drops.push({ typeId: WHEAT_SEEDS_ID, amount: seeds });

    return drops;
}

function growthOf(permutation: BlockPermutation): number {
    const growth = permutation.getState(GROWTH_STATE);
    return typeof growth === "number" ? growth : 0;
}

function breakCrop(dimension: Dimension, farmland: Vector3): void {
    const location = { x: farmland.x, y: farmland.y + 1, z: farmland.z };
    const crop = dimension.getBlock(location);
    if (crop === undefined) return;

    const drops = cropDropsFor(crop.typeId, growthOf(crop.permutation));
    if (drops === undefined) return;

    crop.setType(AIR_ID);

    const center = { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 };
    for (const drop of drops) {
        dimension.spawnItem(new ItemStack(drop.typeId, drop.amount), center);
    }
}

function sameTile(a: Vector3, b: Vector3): boolean {
    return a.x === b.x && a.y === b.y && a.z === b.z;
}

function resetWalker(state: WalkState, x: number, z: number): void {
    state.lastX = x;
    state.lastZ = z;
    state.distance = 0;
    state.nextStep = 0;
}

function forgetLandingsAt(location: Vector3): void {
    for (const [id, list] of landings) {
        const remaining = list.filter((watch) => !sameTile(watch.location, location));
        if (remaining.length === 0) landings.delete(id);
        else landings.set(id, remaining);
    }
}

function captureLanding(
    entity: Entity,
    dimension: Dimension,
    columnX: number,
    columnZ: number,
    feetY: number,
    nowTick: number,
    budget: number
): number {
    const id = entity.id;
    const top = Math.floor(feetY - CONFIG.WALKED_BLOCK_OFFSET);
    let remaining = budget;
    const probe = { x: columnX, y: 0, z: columnZ };

    for (let depth = 0; depth < CONFIG.LANDING_SCAN_DEPTH && remaining > 0; depth++) {
        const y = top - depth;
        probe.y = y;
        const block = dimension.getBlock(probe);
        remaining -= 1;
        if (block === undefined) return remaining;

        const typeId = block.typeId;

        if (typeId === FARMLAND_ID) {
            const location = { x: columnX, y, z: columnZ };
            const crop = dimension.getBlock({ x: columnX, y: y + 1, z: columnZ });
            const watch: WatchedLanding = {
                location,
                farmland: block.permutation,
                crop: crop !== undefined && crop.typeId !== AIR_ID ? crop.permutation : undefined,
                expiresAt: nowTick + CONFIG.WATCH_TICKS
            };

            const list = landings.get(id) ?? [];
            const existing = list.findIndex((entry) => sameTile(entry.location, location));
            if (existing >= 0) {
                list[existing] = watch;
            } else {
                list.push(watch);
            }

            landings.set(id, list);
            return remaining;
        }

        if (!PASSABLE_TYPES.has(typeId)) return remaining;
    }

    return remaining;
}

function clearCropDrops(dimension: Dimension, farmland: Vector3): void {
    const drops = dimension.getEntities({
        location: { x: farmland.x + 0.5, y: farmland.y + 1.5, z: farmland.z + 0.5 },
        maxDistance: CONFIG.DROP_CLEAR_RADIUS,
        type: "minecraft:item"
    });

    for (const drop of drops) {
        if (!drop.isValid) continue;

        const stack = drop.getComponent(EntityComponentTypes.Item)?.itemStack;
        if (stack !== undefined && CROP_DROP_IDS.includes(stack.typeId)) drop.remove();
    }
}

function restoreLanding(dimension: Dimension, watch: WatchedLanding): void {
    const farmland = dimension.getBlock(watch.location);
    if (farmland === undefined) return;

    farmland.setPermutation(watch.farmland);

    if (watch.crop !== undefined) {
        const cropCell = dimension.getBlock({ x: watch.location.x, y: watch.location.y + 1, z: watch.location.z });
        if (cropCell !== undefined && cropCell.typeId === AIR_ID) cropCell.setPermutation(watch.crop);
        clearCropDrops(dimension, watch.location);
    }
}

function pruneLandingWatch(dimension: Dimension, list: WatchedLanding[], nowTick: number): void {
    let kept = 0;

    for (const watch of list) {
        if (nowTick > watch.expiresAt) continue;

        const block = dimension.getBlock(watch.location);
        if (block === undefined) {
            list[kept++] = watch;
            continue;
        }

        const typeId = block.typeId;
        if (typeId === FARMLAND_ID) {
            list[kept++] = watch;
            continue;
        }

        if (typeId === DIRT_ID) restoreLanding(dimension, watch);
    }

    list.length = kept;
}

function superviseLanding(entity: Entity, nowTick: number): void {
    const id = entity.id;
    const dimension = entity.dimension;
    const location = entity.location;
    const prior = walkers.get(id);
    const rawX = prior === undefined ? 0 : location.x - prior.lastX;
    const rawZ = prior === undefined ? 0 : location.z - prior.lastZ;
    const moved = Math.abs(rawX) <= CONFIG.TELEPORT_DISTANCE && Math.abs(rawZ) <= CONFIG.TELEPORT_DISTANCE;
    const deltaX = moved ? rawX : 0;
    const deltaZ = moved ? rawZ : 0;
    const list = landings.get(id);

    if (list !== undefined) {
        pruneLandingWatch(dimension, list, nowTick);
        if (list.length === 0) landings.delete(id);
    }

    const columnX = Math.floor(location.x);
    const columnZ = Math.floor(location.z);

    let budget = captureLanding(entity, dimension, columnX, columnZ, location.y, nowTick, CONFIG.LANDING_READ_BUDGET);

    const alongX = Math.min(CONFIG.LANDING_LOOKAHEAD, Math.ceil(Math.abs(deltaX)));
    const alongZ = Math.min(CONFIG.LANDING_LOOKAHEAD, Math.ceil(Math.abs(deltaZ)));
    const furthest = Math.max(alongX, alongZ);

    for (let ahead = 1; ahead <= furthest && budget > 0; ahead++) {
        if (ahead <= alongX) {
            budget = captureLanding(entity, dimension, columnX + Math.sign(deltaX) * ahead, columnZ, location.y, nowTick, budget);
        }
        if (ahead <= alongZ) {
            budget = captureLanding(entity, dimension, columnX, columnZ + Math.sign(deltaZ) * ahead, location.y, nowTick, budget);
        }
    }
}

function sample(entity: Entity, nowTick: number, mode?: GameMode): void {
    runCatching({ system: "cropTrampling", operation: "landingGuard", target: entity.id }, () =>
        superviseLanding(entity, nowTick)
    );
    runCatching({ system: "cropTrampling", operation: "walkRule", target: entity.id }, () =>
        walkRule(entity, nowTick, mode)
    );
}

function walkRule(entity: Entity, nowTick: number, mode?: GameMode): void {
    if (!eraRulesApply(mode)) return;

    const id = entity.id;
    const location = entity.location;
    const prior = walkers.get(id);
    const state: WalkState = prior ?? {
        lastX: location.x,
        lastZ: location.z,
        distance: 0,
        nextStep: 0,
        lastSeen: nowTick
    };

    state.lastSeen = nowTick;
    if (prior === undefined) walkers.set(id, state);

    const deltaX = location.x - state.lastX;
    const deltaZ = location.z - state.lastZ;

    if (Math.abs(deltaX) > CONFIG.TELEPORT_DISTANCE || Math.abs(deltaZ) > CONFIG.TELEPORT_DISTANCE) {
        resetWalker(state, location.x, location.z);
        return;
    }

    state.lastX = location.x;
    state.lastZ = location.z;

    // Sneaking on ground suppresses walking step counter in Beta 1.7.3.
    if (entity.isSneaking && entity.isOnGround) return;

    if (!consumeStep(state, Math.hypot(deltaX, deltaZ))) return;

    const walked = walkedBlockLocation(location.x, location.y, location.z);

    // Mounted entities do not trample.
    const riding = runCatching(
        { system: "cropTrampling", operation: "readRidingComponent", target: id },
        () => entity.getComponent(EntityComponentTypes.Riding)
    );
    if (riding !== undefined) return;

    const target = resolveTrampleTarget(entity.dimension, walked);

    if (target !== undefined && Math.floor(Math.random() * CONFIG.TRAMPLE_ROLL) === 0) {
        forgetLandingsAt(walked);
        breakCrop(entity.dimension, walked);
        target.setType(DIRT_ID);
    }
}

function pruneWalkers(nowTick: number): void {
    for (const [id, state] of walkers) {
        if (nowTick - state.lastSeen > CONFIG.STALE_WALKER_TICKS) {
            walkers.delete(id);
        }
    }

    let oldest = walkers.keys().next();
    while (walkers.size > CONFIG.MAX_TRACKED_WALKERS && !oldest.done) {
        walkers.delete(oldest.value);
        oldest = walkers.keys().next();
    }

    for (const [id, list] of landings) {
        if (list.every((watch) => nowTick > watch.expiresAt)) landings.delete(id);
    }
}

function sampleNearbyMobs(player: Entity, nowTick: number, seen: Set<string>): void {
    const mobs = player.dimension.getEntities({
        location: player.location,
        maxDistance: CONFIG.MOB_RADIUS,
        excludeTypes: NON_WALKING_TYPES
    });

    for (const mob of mobs) {
        if (!mob.isValid || seen.has(mob.id)) continue;
        seen.add(mob.id);

        try {
            sample(mob, nowTick);
        } catch (e) {
            reportError({ system: "cropTrampling", operation: "sampleMob", target: mob.id }, e);
        }
    }
}

export function cropTramplingJob(): void {
    mobSweepDue = !mobSweepDue;
    const nowTick = tickManager.getCurrentTick();
    const seen = mobSweepDue ? new Set<string>() : undefined;

    for (const player of world.getAllPlayers()) {
        if (!player.isValid) continue;

        try {
            const gameMode = runCatching(
                { system: "cropTrampling", operation: "readGameMode", target: player.id },
                () => player.getGameMode()
            );

            sample(player, nowTick, gameMode);
            if (seen !== undefined) sampleNearbyMobs(player, nowTick, seen);
        } catch (e) {
            reportError({ system: "cropTrampling", operation: "samplePlayer", target: player.id }, e);
        }
    }

    if (walkers.size > CONFIG.MAX_TRACKED_WALKERS || landings.size > CONFIG.MAX_TRACKED_WALKERS) {
        pruneWalkers(nowTick);
    }
}

eventBus.onPlayerLeave((event) => {
    walkers.delete(event.playerId);
    landings.delete(event.playerId);
});

eventBus.onPlayerPlaceBlock((event) => {
    forgetLandingsAt(event.block.location);
});

tickManager.register("cropTrampling", 1, cropTramplingJob);
