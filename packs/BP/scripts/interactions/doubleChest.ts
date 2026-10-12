/**
 * Beta 1.7.3 double chest inventory synchronization and multi-block pairing.
 * Moves contents between halves on open/close sessions to emulate a shared 54-slot container.
 */

import {
    Block,
    BlockPermutation,
    BlockVolume,
    Container,
    ItemStack,
    PlayerPlaceBlockAfterEvent,
    system,
    world
} from "@minecraft/server";
import type {
    BlockContainerClosedAfterEvent,
    BlockContainerOpenedAfterEvent,
    ContainerAccessSource,
    PlayerInteractWithBlockBeforeEvent,
    PlayerLeaveAfterEvent,
    PlayerPlaceBlockBeforeEvent
} from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { reportError, runCatching } from "../core/errorReporter.js";
import { tickManager } from "../core/tickManager.js";
import { BH_CHEST_ID } from "../core/betaRegistry.js";

export const SINGLE_CHEST_ID = BH_CHEST_ID;
export const DOUBLE_CHEST_ID = "bh:double_chest";
export const SINGLE_CHEST_SLOTS = 27;
export const DOUBLE_CHEST_SLOTS = 54;

const AIR_ID = "minecraft:air";
const PART_STATE = "minecraft:multi_block_part";
const DIRECTION_STATE = "minecraft:cardinal_direction";
const SWEEP_INTERVAL_TICKS = 10;
export const CHEST_PAIRS_PER_TICK = 10;
const MERGE_DELAY_TICKS = 1;

export type CardinalDirection = "north" | "south" | "east" | "west";
type PairAxis = "x" | "z";

const CARDINAL_DIRECTIONS: readonly CardinalDirection[] = Object.freeze(["north", "south", "east", "west"]);

export interface PairLayout {
    step: ChestLocation;
    latch: CardinalDirection;
}

export const PAIR_LAYOUTS: Readonly<Record<CardinalDirection, PairLayout>> = Object.freeze({
    east: { step: { x: 1, y: 0, z: 0 }, latch: "south" },
    west: { step: { x: -1, y: 0, z: 0 }, latch: "north" },
    north: { step: { x: 0, y: 0, z: -1 }, latch: "east" },
    south: { step: { x: 0, y: 0, z: 1 }, latch: "west" }
});

export const PAIR_STATE_BY_LATCH: Readonly<Record<CardinalDirection, CardinalDirection>> = Object.freeze({
    south: "east",
    north: "west",
    east: "north",
    west: "south"
});

export const INVERSE_DIRECTION: Readonly<Record<CardinalDirection, CardinalDirection>> = Object.freeze({
    north: "south",
    south: "north",
    east: "west",
    west: "east"
});

const SIDE_LATCHES: Readonly<Record<PairAxis, readonly CardinalDirection[]>> = Object.freeze({
    x: ["north", "south"],
    z: ["east", "west"]
});

const FALLBACK_LATCH: Readonly<Record<PairAxis, CardinalDirection>> = Object.freeze({
    x: "south",
    z: "east"
});

const NEIGHBOUR_OFFSETS: readonly ChestLocation[] = Object.freeze([
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 }
]);

export interface ChestLocation {
    x: number;
    y: number;
    z: number;
}

export type ChestHalf = "master" | "shadow";
export type MirrorMove = "none" | "master-to-shadow" | "shadow-to-master";

export interface PairResolution {
    half: ChestHalf;
    master: ChestLocation;
    shadow: ChestLocation;
}

export interface PlacementPlan<T> {
    destination: (T | undefined)[];
    source: (T | undefined)[];
    moves: { from: number; to: number }[];
}

export interface ChestNeighbour {
    offset: ChestLocation;
    latch: CardinalDirection | undefined;
}

export interface PairPlan {
    state: CardinalDirection;
    latch: CardinalDirection;
    masterOffset: ChestLocation;
}

function layoutStep(direction: ChestLocation): CardinalDirection | undefined {
    return CARDINAL_DIRECTIONS.find(state => {
        const step = PAIR_LAYOUTS[state].step;
        return step.x === direction.x && step.y === direction.y && step.z === direction.z;
    });
}

function stepReaches(step: ChestLocation, offset: ChestLocation): boolean {
    return step.x === offset.x && step.y === offset.y && step.z === offset.z;
}

function onLongFace(latch: CardinalDirection | undefined, axis: PairAxis): latch is CardinalDirection {
    return latch !== undefined && SIDE_LATCHES[axis].includes(latch);
}

function planAgainst(placedLatch: CardinalDirection | undefined, neighbour: ChestNeighbour): PairPlan | undefined {
    const axis = neighbour.offset.x !== 0 ? "x" : "z";
    if (!layoutStep(neighbour.offset)) return undefined;

    const latch = onLongFace(placedLatch, axis)
        ? placedLatch
        : onLongFace(neighbour.latch, axis)
            ? neighbour.latch
            : FALLBACK_LATCH[axis];

    const state = PAIR_STATE_BY_LATCH[latch];
    return {
        state,
        latch,
        masterOffset: stepReaches(PAIR_LAYOUTS[state].step, neighbour.offset)
            ? { x: 0, y: 0, z: 0 }
            : neighbour.offset
    };
}

export function planPair(
    placedLatch: CardinalDirection | undefined,
    neighbours: readonly ChestNeighbour[]
): PairPlan | undefined {
    const plans: PairPlan[] = [];
    for (const neighbour of neighbours) {
        const plan = planAgainst(placedLatch, neighbour);
        if (plan) plans.push(plan);
    }

    return plans.find(plan => plan.latch === placedLatch) ?? plans[0];
}

export function planChestPlacement(neighbourTypeIds: readonly string[]): boolean {
    let singles = 0;
    for (const typeId of neighbourTypeIds) {
        if (typeId === DOUBLE_CHEST_ID) return false;
        if (typeId === SINGLE_CHEST_ID) singles++;
    }
    return singles <= 1;
}

export function mergeContents<T>(
    west: readonly (T | undefined)[],
    east: readonly (T | undefined)[]
): (T | undefined)[] {
    return [...west, ...east];
}

export function pairKey(dimensionId: string, master: ChestLocation): string {
    return `${dimensionId}:${master.x},${master.y},${master.z}`;
}

export function isCardinalDirection(value: unknown): value is CardinalDirection {
    return CARDINAL_DIRECTIONS.some(direction => direction === value);
}

export function resolveHalf(partValue: unknown, location: ChestLocation, state: unknown): PairResolution | undefined {
    const part = Number(partValue);
    if (!Number.isInteger(part) || part < 0 || part > 1) return undefined;
    if (!isCardinalDirection(state)) return undefined;

    const { step } = PAIR_LAYOUTS[state];
    const master =
        part === 0
            ? { x: location.x, y: location.y, z: location.z }
            : { x: location.x - step.x, y: location.y - step.y, z: location.z - step.z };

    return {
        half: part === 0 ? "master" : "shadow",
        master,
        shadow: { x: master.x + step.x, y: master.y + step.y, z: master.z + step.z }
    };
}

export function hasAnyItem<T>(contents: readonly (T | undefined)[]): boolean {
    return contents.some(stack => stack !== undefined);
}

export function planPlacement<T>(
    source: readonly (T | undefined)[],
    destination: readonly (T | undefined)[]
): PlacementPlan<T> {
    const sourceAfter = [...source];
    const destinationAfter = [...destination];
    const moves: { from: number; to: number }[] = [];

    let cursor = 0;
    for (let slot = 0; slot < sourceAfter.length; slot++) {
        const stack = sourceAfter[slot];
        if (!stack) continue;

        let target = slot < destinationAfter.length && destinationAfter[slot] === undefined ? slot : -1;
        if (target === -1) {
            while (cursor < destinationAfter.length && destinationAfter[cursor] !== undefined) cursor++;
            if (cursor >= destinationAfter.length) break;
            target = cursor;
        }

        destinationAfter[target] = stack;
        sourceAfter[slot] = undefined;
        moves.push({ from: slot, to: target });
    }

    return { destination: destinationAfter, source: sourceAfter, moves };
}

export interface OpenDecisionInput {
    half: ChestHalf;
    firstViewer: boolean;
    masterHasItems: boolean;
    shadowHasItems: boolean;
    masterViewers: number;
    shadowViewers: number;
}

export function planOpen(input: OpenDecisionInput): MirrorMove {
    if (input.half === "shadow") {
        if (!input.firstViewer) return "none";
        if (input.masterViewers > 0) return "none";
        return input.masterHasItems ? "master-to-shadow" : "none";
    }

    if (!input.firstViewer) return "none";
    if (input.shadowViewers > 0) return "none";
    return input.shadowHasItems ? "shadow-to-master" : "none";
}

export function planClose(input: { half: ChestHalf; remainingViewers: number; shadowHasItems: boolean }): MirrorMove {
    if (input.half !== "shadow" || input.remainingViewers > 0 || !input.shadowHasItems) return "none";
    return "shadow-to-master";
}

export function planSweep(input: { shadowViewers: number; shadowHasItems: boolean }): MirrorMove {
    return input.shadowViewers === 0 && input.shadowHasItems ? "shadow-to-master" : "none";
}

export function planOpenBlock(input: { half: ChestHalf; masterViewers: number; shadowViewers: number }): boolean {
    return input.half === "master" ? input.shadowViewers > 0 : input.masterViewers > 0;
}

export function chestOpenBlocked(input: { placing: boolean; aboveSolid: boolean }): boolean {
    return input.aboveSolid && !input.placing;
}

export function dropOfflineViewers(viewers: Set<string>, onlinePlayerIds: ReadonlySet<string>): number {
    let dropped = 0;
    for (const playerId of [...viewers]) {
        if (onlinePlayerIds.has(playerId)) continue;
        viewers.delete(playerId);
        dropped++;
    }
    return dropped;
}

type Guarded<T> = { ok: true; value: T } | { ok: false };

function guard<T>(operation: string, fn: () => T): Guarded<T> {
    let outcome: Guarded<T> = { ok: false };
    runCatching({ system: "doubleChest", operation }, () => {
        outcome = { ok: true, value: fn() };
    });
    return outcome;
}

function blockAt(dimensionId: string, location: ChestLocation): Block | undefined {
    const found = guard(`getBlock:${dimensionId}`, () => world.getDimension(dimensionId).getBlock(location));
    return found.ok ? found.value : undefined;
}

function containerOf(block: Block): Container | undefined {
    const component = guard(`getContainerComponent`, () => block.getComponent("minecraft:inventory"));
    return component.ok ? component.value?.container : undefined;
}

function partStateOf(block: Block): unknown {
    const state = guard("readPartState", () => block.permutation.getState(PART_STATE));
    return state.ok ? state.value : undefined;
}

function isHalf(block: Block | undefined): block is Block {
    return block !== undefined && block.typeId === DOUBLE_CHEST_ID;
}

function cellOf(block: Block): ChestLocation {
    return { x: block.location.x, y: block.location.y, z: block.location.z };
}

function offsetLocation(location: ChestLocation, offset: ChestLocation): ChestLocation {
    return { x: location.x + offset.x, y: location.y + offset.y, z: location.z + offset.z };
}

function directionStateOf(block: Block): CardinalDirection | undefined {
    const state = guard("readDirection", () => block.permutation.getState(DIRECTION_STATE));
    const value = state.ok ? state.value : undefined;
    return isCardinalDirection(value) ? value : undefined;
}

function spansCells(dimensionId: string, resolution: PairResolution): boolean {
    return isHalf(blockAt(dimensionId, resolution.master)) && isHalf(blockAt(dimensionId, resolution.shadow));
}

export function clampSlots(requested: number, size: number | undefined): number {
    return size === undefined ? 0 : Math.min(requested, size);
}

function slotCapacity(container: Container, requested: number): number | undefined {
    const measured = guard("containerSize", () => container.size);
    return measured.ok ? clampSlots(requested, measured.value) : undefined;
}

function readSlots(container: Container, slots: number): (ItemStack | undefined)[] | undefined {
    const contents: (ItemStack | undefined)[] = [];
    const capacity = slotCapacity(container, slots);
    if (capacity === undefined) return undefined;

    for (let slot = 0; slot < capacity; slot++) {
        const read = guard(`readSlot:${slot}`, () => container.getItem(slot));
        if (!read.ok) return undefined;
        contents.push(read.value);
    }
    return contents;
}

function clearSlots(container: Container, slots: number): void {
    const capacity = slotCapacity(container, slots) ?? 0;
    for (let slot = 0; slot < capacity; slot++) {
        guard(`clearSlot:${slot}`, () => container.setItem(slot));
    }
}

function containerHasItems(dimensionId: string, location: ChestLocation): boolean | undefined {
    const block = blockAt(dimensionId, location);
    if (!block) return undefined;

    const container = containerOf(block);
    if (!container) return undefined;

    const contents = readSlots(container, DOUBLE_CHEST_SLOTS);
    return contents === undefined ? undefined : hasAnyItem(contents);
}

function writeSlots(container: Container, contents: readonly (ItemStack | undefined)[], fallback: Block): void {
    const capacity = slotCapacity(container, contents.length) ?? 0;
    for (let slot = 0; slot < contents.length; slot++) {
        const stack = contents[slot];
        if (!stack) continue;
        if (slot < capacity && guard(`writeSlot:${slot}`, () => container.setItem(slot, stack)).ok) continue;

        guard("spawnUnplacedStack", () => fallback.dimension.spawnItem(stack, fallback.center()));
    }
}

function moveContents(dimensionId: string, from: ChestLocation, to: ChestLocation): number | undefined {
    const source = blockAt(dimensionId, from);
    const destination = blockAt(dimensionId, to);
    if (!source || !destination) return undefined;

    const sourceContainer = containerOf(source);
    const destinationContainer = containerOf(destination);
    if (!sourceContainer || !destinationContainer) return undefined;

    const sourceContents = readSlots(sourceContainer, DOUBLE_CHEST_SLOTS);
    const destinationContents = readSlots(destinationContainer, DOUBLE_CHEST_SLOTS);
    if (!sourceContents || !destinationContents) return undefined;

    const plan = planPlacement(sourceContents, destinationContents);
    for (const move of plan.moves) {
        const stack = sourceContents[move.from];
        if (!stack) continue;

        if (!guard(`clearSlot:${move.from}`, () => sourceContainer.setItem(move.from)).ok) continue;
        if (guard(`writeSlot:${move.to}`, () => destinationContainer.setItem(move.to, stack)).ok) continue;

        guard("spawnUnplacedStack", () => source.dimension.spawnItem(stack, source.center()));
    }

    return plan.source.filter(stack => stack !== undefined).length;
}

export interface PairSession {
    dimensionId: string;
    master: ChestLocation;
    shadow: ChestLocation;
    masterViewers: Set<string>;
    shadowViewers: Set<string>;
}

export const sessions = new Map<string, PairSession>();

function sessionFor(key: string, dimensionId: string, resolution: PairResolution): PairSession {
    const existing = sessions.get(key);
    if (existing) return existing;

    const session: PairSession = {
        dimensionId,
        master: resolution.master,
        shadow: resolution.shadow,
        masterViewers: new Set(),
        shadowViewers: new Set()
    };
    sessions.set(key, session);
    return session;
}

function applyMove(move: MirrorMove, session: PairSession): number | undefined {
    if (move === "none") return 0;

    return move === "master-to-shadow"
        ? moveContents(session.dimensionId, session.master, session.shadow)
        : moveContents(session.dimensionId, session.shadow, session.master);
}

function dropIfIdle(session: PairSession, key: string, drained: number | undefined): void {
    if (session.masterViewers.size > 0 || session.shadowViewers.size > 0) return;
    if (drained === 0) sessions.delete(key);
}

function releaseIdleShadow(session: PairSession, key: string): void {
    if (session.shadowViewers.size > 0) return;
    const drained = applyMove("shadow-to-master", session);
    dropIfIdle(session, key, drained);
}

function viewerIdOf(source: ContainerAccessSource | undefined): string | undefined {
    const entity = source?.entity;
    return entity?.typeId === "minecraft:player" ? entity.id : undefined;
}

function resolvePairRef(block: Block): { key: string; dimensionId: string; resolution: PairResolution } | undefined {
    if (block.typeId !== DOUBLE_CHEST_ID) return undefined;

    const dimensionId = block.dimension.id;
    const part = partStateOf(block);
    const state = directionStateOf(block);

    // The engine is the one that places the halves, so when the world does not match the layout the
    // state promised, the mirrored layout is the one that does.
    let resolution = resolveHalf(part, block.location, state);
    if (!resolution || !spansCells(dimensionId, resolution)) {
        resolution = resolveHalf(part, block.location, state ? INVERSE_DIRECTION[state] : undefined);
    }

    if (!resolution || !spansCells(dimensionId, resolution)) return undefined;

    return { key: pairKey(dimensionId, resolution.master), dimensionId, resolution };
}

function resolveEventBlock(block: Block): { key: string; session: PairSession; half: ChestHalf } | undefined {
    const ref = resolvePairRef(block);
    if (!ref) return undefined;

    return {
        key: ref.key,
        session: sessionFor(ref.key, ref.dimensionId, ref.resolution),
        half: ref.resolution.half
    };
}

function handleContainerOpened(event: BlockContainerOpenedAfterEvent): void {
    const resolved = resolveEventBlock(event.block);
    if (!resolved) return;

    const { session, half } = resolved;
    const masterViewers = session.masterViewers.size;
    const shadowViewers = session.shadowViewers.size;
    const firstViewer = half === "master" ? masterViewers === 0 : shadowViewers === 0;

    const viewerId = viewerIdOf(event.openSource);
    if (viewerId) (half === "master" ? session.masterViewers : session.shadowViewers).add(viewerId);

    const move = planOpen({
        half,
        firstViewer,
        masterHasItems: containerHasItems(session.dimensionId, session.master) ?? false,
        shadowHasItems: containerHasItems(session.dimensionId, session.shadow) ?? false,
        masterViewers,
        shadowViewers
    });

    const drained = applyMove(move, session);
    if (move !== "none") dropIfIdle(session, resolved.key, drained);
}

function handleContainerClosed(event: BlockContainerClosedAfterEvent): void {
    const resolved = resolveEventBlock(event.block);
    if (!resolved) return;

    const { key, session, half } = resolved;
    const viewerId = viewerIdOf(event.closeSource);
    if (viewerId) (half === "master" ? session.masterViewers : session.shadowViewers).delete(viewerId);

    if (half !== "shadow") return;

    const remainingViewers = session.shadowViewers.size;
    const shadowHasItems = containerHasItems(session.dimensionId, session.shadow);
    // An unreadable half stays tracked so the sweep retries the drain instead of parking items.
    if (shadowHasItems === undefined) return;

    const drained = applyMove(planClose({ half, remainingViewers, shadowHasItems }), session);
    dropIfIdle(session, key, drained);
}

function handlePlayerLeave(event: PlayerLeaveAfterEvent): void {
    for (const [key, session] of sessions) {
        const leftMaster = session.masterViewers.delete(event.playerId);
        const leftShadow = session.shadowViewers.delete(event.playerId);
        if (!leftMaster && !leftShadow) continue;

        releaseIdleShadow(session, key);
    }
}

function onlinePlayerIds(): Set<string> | undefined {
    const players = guard("getAllPlayers", () => world.getAllPlayers());
    return players.ok ? new Set(players.value.map(player => player.id)) : undefined;
}

export function* sweepPairsJob(): Generator<void, void, unknown> {
    let processed = 0;
    for (const [key, session] of sessions) {
        if (session.masterViewers.size > 0 || session.shadowViewers.size > 0) {
            const online = onlinePlayerIds();
            if (online) {
                dropOfflineViewers(session.masterViewers, online);
                dropOfflineViewers(session.shadowViewers, online);
            }
        }

        const master = blockAt(session.dimensionId, session.master);
        const shadow = blockAt(session.dimensionId, session.shadow);
        if (!isHalf(master) || !isHalf(shadow)) {
            sessions.delete(key);
            processed++;
            if (processed % CHEST_PAIRS_PER_TICK === 0) {
                yield;
            }
            continue;
        }

        if (session.masterViewers.size > 0 || session.shadowViewers.size > 0) {
            processed++;
            if (processed % CHEST_PAIRS_PER_TICK === 0) {
                yield;
            }
            continue;
        }

        const shadowHasItems = containerHasItems(session.dimensionId, session.shadow);
        if (shadowHasItems === undefined) {
            processed++;
            if (processed % CHEST_PAIRS_PER_TICK === 0) {
                yield;
            }
            continue;
        }
        if (!shadowHasItems) {
            sessions.delete(key);
            processed++;
            if (processed % CHEST_PAIRS_PER_TICK === 0) {
                yield;
            }
            continue;
        }

        const drained = applyMove(planSweep({ shadowViewers: 0, shadowHasItems }), session);
        dropIfIdle(session, key, drained);

        processed++;
        if (processed % CHEST_PAIRS_PER_TICK === 0) {
            yield;
        }
    }
}

export function sweepPairs(): void {
    const job = sweepPairsJob();
    while (!job.next().done) {
        // Drain generator synchronously
    }
}

interface PairCells {
    home: ChestLocation;
    other: ChestLocation;
}

function assemblePair(master: Block, shadow: Block, state: CardinalDirection): PairCells | undefined {
    const dimensionId = master.dimension.id;
    const masterCell = cellOf(master);
    const shadowCell = cellOf(shadow);
    const permutation = pairPermutation(state);

    clearPairCells(dimensionId, masterCell, shadowCell);
    try {
        master.dimension.fillBlocks(new BlockVolume(masterCell, shadowCell), permutation);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "fillPair", target: DOUBLE_CHEST_ID }, e);
    }

    const filled = readPair(dimensionId, masterCell, shadowCell);
    if (filled) return filled;

    clearPairCells(dimensionId, masterCell, shadowCell);
    const placed = blockAt(dimensionId, masterCell);
    if (placed) guard("placePair", () => placed.setPermutation(permutation));

    return readPair(dimensionId, masterCell, shadowCell);
}

function clearPairCells(dimensionId: string, masterCell: ChestLocation, shadowCell: ChestLocation): void {
    for (const cell of [masterCell, shadowCell]) {
        const block = blockAt(dimensionId, cell);
        if (!block) continue;

        guard("clearPairCell", () => block.setType(AIR_ID));
    }
}

function readPair(dimensionId: string, masterCell: ChestLocation, shadowCell: ChestLocation): PairCells | undefined {
    const built = blockAt(dimensionId, masterCell);
    const twin = blockAt(dimensionId, shadowCell);
    if (!isHalf(built) || !isHalf(twin)) return undefined;

    const home = partHome(partStateOf(built), partStateOf(twin));
    if (home === undefined) return undefined;

    return home === "master" ? { home: masterCell, other: shadowCell } : { home: shadowCell, other: masterCell };
}

export function partHome(masterPart: unknown, shadowPart: unknown): ChestHalf | undefined {
    const built = Number(masterPart);
    const twin = Number(shadowPart);
    if (built === 0 && twin === 1) return "master";
    if (built === 1 && twin === 0) return "shadow";
    return undefined;
}

function pairPermutation(state: CardinalDirection): BlockPermutation {
    return BlockPermutation.resolve(DOUBLE_CHEST_ID, { [DIRECTION_STATE]: state, [PART_STATE]: 0 });
}

function restoreSingles(
    master: Block,
    shadow: Block,
    masterLatch: CardinalDirection,
    shadowLatch: CardinalDirection,
    masterContents: (ItemStack | undefined)[],
    shadowContents: (ItemStack | undefined)[]
): void {
    guard("restoreMasterSingle", () => master.setPermutation(singlePermutation(masterLatch)));
    guard("restoreShadowSingle", () => shadow.setPermutation(singlePermutation(shadowLatch)));

    handBackContents(master, masterContents);
    handBackContents(shadow, shadowContents);

    console.warn("doubleChest: pairing failed, kept two single chests");
}

function handBackContents(block: Block, contents: readonly (ItemStack | undefined)[]): void {
    const container = containerOf(block);
    if (container) {
        writeSlots(container, contents, block);
        return;
    }

    for (const stack of contents) {
        if (!stack) continue;
        guard("spawnUnplacedStack", () => block.dimension.spawnItem(stack, block.center()));
    }
}

function singlePermutation(latch: CardinalDirection): BlockPermutation {
    return BlockPermutation.resolve(SINGLE_CHEST_ID, { [DIRECTION_STATE]: latch });
}

function mergePair(master: Block, shadow: Block, state: CardinalDirection): void {
    const dimensionId = master.dimension.id;
    const masterCell = cellOf(master);
    const shadowCell = cellOf(shadow);

    const masterContainer = containerOf(master);
    const shadowContainer = containerOf(shadow);
    if (!masterContainer || !shadowContainer) return;

    const masterContents = readSlots(masterContainer, SINGLE_CHEST_SLOTS);
    const shadowContents = readSlots(shadowContainer, SINGLE_CHEST_SLOTS);
    if (!masterContents || !shadowContents) return;

    const masterLatch = directionStateOf(master) ?? FALLBACK_LATCH.x;
    const shadowLatch = directionStateOf(shadow) ?? FALLBACK_LATCH.x;

    clearSlots(masterContainer, SINGLE_CHEST_SLOTS);
    clearSlots(shadowContainer, SINGLE_CHEST_SLOTS);

    const cells = assemblePair(master, shadow, state);
    if (!cells) {
        const left = blockAt(dimensionId, masterCell) ?? master;
        const right = blockAt(dimensionId, shadowCell) ?? shadow;
        restoreSingles(left, right, masterLatch, shadowLatch, masterContents, shadowContents);
        return;
    }

    const home = blockAt(dimensionId, cells.home) ?? master;
    const other = blockAt(dimensionId, cells.other) ?? shadow;

    const homeContainer = containerOf(home);
    if (!homeContainer) {
        const left = blockAt(dimensionId, masterCell) ?? home;
        const right = blockAt(dimensionId, shadowCell) ?? other;
        restoreSingles(left, right, masterLatch, shadowLatch, masterContents, shadowContents);
        return;
    }

    writeSlots(homeContainer, mergeContents(masterContents, shadowContents), home);

    const otherContainer = containerOf(other);
    if (otherContainer) clearSlots(otherContainer, DOUBLE_CHEST_SLOTS);
}

function solidAbove(block: Block): boolean {
    const above = guard("cellAbove", () => block.offset({ x: 0, y: 1, z: 0 }));
    if (!above.ok || !above.value) return false;

    const aboveBlock = above.value;
    if (aboveBlock.typeId === SINGLE_CHEST_ID || aboveBlock.typeId === DOUBLE_CHEST_ID) return false;

    const solid = guard("cellAboveSolid", () => aboveBlock.isSolid);
    return solid.ok && solid.value;
}

function neighbourTypeIds(cell: Block): string[] {
    const types: string[] = [];

    for (const offset of NEIGHBOUR_OFFSETS) {
        const found = guard(`placementNeighbour:${offset.x},${offset.z}`, () => cell.offset(offset));
        if (found.ok && found.value) types.push(found.value.typeId);
    }

    return types;
}

function chestNeighbours(placed: Block): ChestNeighbour[] {
    const neighbours: ChestNeighbour[] = [];

    for (const offset of NEIGHBOUR_OFFSETS) {
        const found = guard(`neighbour:${offset.x},${offset.z}`, () => placed.offset(offset));
        if (!found.ok || !found.value) continue;
        if (found.value.typeId !== SINGLE_CHEST_ID) continue;

        neighbours.push({ offset, latch: directionStateOf(found.value) });
    }

    return neighbours;
}

function handleChestPlacement(event: PlayerPlaceBlockBeforeEvent): void {
    if (event.permutationToPlace.type.id !== SINGLE_CHEST_ID) return;

    if (!planChestPlacement(neighbourTypeIds(event.block))) {
        event.cancel = true;
    }
}

function handleChestPlaced(event: PlayerPlaceBlockAfterEvent): void {
    const placed = event.block;
    if (!placed || placed.typeId !== SINGLE_CHEST_ID) return;

    const dimensionId = placed.dimension.id;
    const location: ChestLocation = { x: placed.location.x, y: placed.location.y, z: placed.location.z };

    system.runTimeout(() => {
        try {
            mergeChestAt(dimensionId, location);
        } catch (e) {
            reportError({
                system: "doubleChest",
                operation: "mergeOnPlace",
                target: `${location.x},${location.y},${location.z}`
            }, e);
        }
    }, MERGE_DELAY_TICKS);
}

function mergeChestAt(dimensionId: string, location: ChestLocation): void {
    const placed = blockAt(dimensionId, location);
    if (!placed || placed.typeId !== SINGLE_CHEST_ID) return;

    const plan = planPair(directionStateOf(placed), chestNeighbours(placed));
    if (!plan) return;

    const masterLocation = offsetLocation(location, plan.masterOffset);
    const shadowLocation = offsetLocation(masterLocation, PAIR_LAYOUTS[plan.state].step);

    const master = blockAt(dimensionId, masterLocation);
    const shadow = blockAt(dimensionId, shadowLocation);
    if (!master || !shadow) return;
    if (master.typeId !== SINGLE_CHEST_ID || shadow.typeId !== SINGLE_CHEST_ID) return;

    mergePair(master, shadow, plan.state);
}

eventBus.onPlayerPlaceBlockBefore(event => {
    try {
        handleChestPlacement(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "placementRule", target: SINGLE_CHEST_ID }, e);
    }
});

eventBus.onPlayerPlaceBlock(event => {
    try {
        handleChestPlaced(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "mergeOnPlace", target: SINGLE_CHEST_ID }, e);
    }
});

eventBus.onBlockContainerOpened(event => {
    try {
        handleContainerOpened(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "containerOpened" }, e);
    }
});

eventBus.onBlockContainerClosed(event => {
    try {
        handleContainerClosed(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "containerClosed" }, e);
    }
});

eventBus.onPlayerLeave(event => {
    try {
        handlePlayerLeave(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "playerLeave" }, e);
    }
});

function handleInteractWithBlock(event: PlayerInteractWithBlockBeforeEvent): void {
    const block = event.block;
    if (!block) return;

    if (block.typeId === SINGLE_CHEST_ID || block.typeId === DOUBLE_CHEST_ID) {
        const placing = event.player.isSneaking && event.itemStack !== undefined;

        if (chestOpenBlocked({ placing, aboveSolid: solidAbove(block) })) {
            event.cancel = true;
            return;
        }
    }

    if (block.typeId !== DOUBLE_CHEST_ID) return;

    const ref = resolvePairRef(block);
    if (!ref) return;

    const session = sessions.get(ref.key);
    if (!session) return;

    const busy = planOpenBlock({
        half: ref.resolution.half,
        masterViewers: session.masterViewers.size,
        shadowViewers: session.shadowViewers.size
    });
    if (!busy) return;

    event.cancel = true;
    event.player.sendMessage("§cThis chest is in use");
}

eventBus.onPlayerInteractWithBlock(event => {
    try {
        handleInteractWithBlock(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "interactWithBlock" }, e);
    }
});

tickManager.register("doubleChest:sweep", SWEEP_INTERVAL_TICKS, sweepPairsJob);
