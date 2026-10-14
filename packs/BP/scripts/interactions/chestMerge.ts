import { BlockPermutation, BlockVolume } from "@minecraft/server";
import type { Block, ItemStack } from "@minecraft/server";
import { reportError } from "../core/errorReporter.js";
import type { CardinalDirection, ChestLocation } from "./chestPairing.js";
import {
    DOUBLE_CHEST_ID,
    DOUBLE_CHEST_SLOTS,
    DIRECTION_STATE,
    PAIR_LAYOUTS,
    PART_STATE,
    SINGLE_CHEST_ID,
    SINGLE_CHEST_SLOTS,
    latchOf,
    mergeContents,
    partHome,
    planPair
} from "./chestPairing.js";
import {
    AIR_ID,
    blockAt,
    cellOf,
    chestNeighbours,
    clearSlots,
    containerOf,
    directionStateOf,
    guard,
    isHalf,
    offsetLocation,
    partStateOf,
    readSlots,
    writeSlots
} from "./chestCells.js";

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

function pairPermutation(state: CardinalDirection): BlockPermutation {
    return BlockPermutation.resolve(DOUBLE_CHEST_ID, { [DIRECTION_STATE]: state, [PART_STATE]: 0 });
}

function singlePermutation(latch: CardinalDirection): BlockPermutation {
    return BlockPermutation.resolve(SINGLE_CHEST_ID, { [DIRECTION_STATE]: latch });
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

export function mergePair(master: Block, shadow: Block, state: CardinalDirection): void {
    const dimensionId = master.dimension.id;
    const masterCell = cellOf(master);
    const shadowCell = cellOf(shadow);

    const masterContainer = containerOf(master);
    const shadowContainer = containerOf(shadow);
    if (!masterContainer || !shadowContainer) return;

    const masterContents = readSlots(masterContainer, SINGLE_CHEST_SLOTS);
    const shadowContents = readSlots(shadowContainer, SINGLE_CHEST_SLOTS);
    if (!masterContents || !shadowContents) return;

    const masterLatch = latchOf(directionStateOf(master));
    const shadowLatch = latchOf(directionStateOf(shadow));

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

export function mergeChestAt(dimensionId: string, location: ChestLocation): void {
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
