import { BH_CHEST_ID } from "../core/betaRegistry.js";

export const SINGLE_CHEST_ID = BH_CHEST_ID;
export const DOUBLE_CHEST_ID = "bh:double_chest";
export const SINGLE_CHEST_SLOTS = 27;
export const DOUBLE_CHEST_SLOTS = 54;

export const PART_STATE = "minecraft:multi_block_part";
export const DIRECTION_STATE = "minecraft:cardinal_direction";

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

export const NEIGHBOUR_OFFSETS: readonly ChestLocation[] = Object.freeze([
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

/** A single chest whose direction state does not read back keeps vanilla's own default latch. */
export function latchOf(direction: CardinalDirection | undefined): CardinalDirection {
    return direction ?? FALLBACK_LATCH.x;
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

interface OpenDecisionInput {
    half: ChestHalf;
    firstViewer: boolean;
    masterHasItems: boolean;
    shadowHasItems: boolean;
    masterViewers: number;
    shadowViewers: number;
}

interface CloseDecisionInput {
    half: ChestHalf;
    remainingViewers: number;
    shadowHasItems: boolean;
}

interface SweepInput {
    shadowViewers: number;
    shadowHasItems: boolean;
}

interface OpenBlockInput {
    half: ChestHalf;
    masterViewers: number;
    shadowViewers: number;
}

interface PlacementBlockInput {
    placing: boolean;
    aboveSolid: boolean;
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

export function planClose(input: CloseDecisionInput): MirrorMove {
    if (input.half !== "shadow" || input.remainingViewers > 0 || !input.shadowHasItems) return "none";
    return "shadow-to-master";
}

export function planSweep(input: SweepInput): MirrorMove {
    return input.shadowViewers === 0 && input.shadowHasItems ? "shadow-to-master" : "none";
}

export function planOpenBlock(input: OpenBlockInput): boolean {
    return input.half === "master" ? input.shadowViewers > 0 : input.masterViewers > 0;
}

export function chestOpenBlocked(input: PlacementBlockInput): boolean {
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

export function clampSlots(requested: number, size: number | undefined): number {
    return size === undefined ? 0 : Math.min(requested, size);
}

export function partHome(masterPart: unknown, shadowPart: unknown): ChestHalf | undefined {
    const built = Number(masterPart);
    const twin = Number(shadowPart);
    if (built === 0 && twin === 1) return "master";
    if (built === 1 && twin === 0) return "shadow";
    return undefined;
}
