import { BlockPermutation, BlockVolume } from "@minecraft/server";
import type { Block, Container, ItemStack } from "@minecraft/server";
import { reportError } from "../../core/errorReporter.js";
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
    guard,
    isHalf,
    offsetLocation,
    partStateOf,
    readLatch,
    readSlots,
    valueOr,
    writeSlots
} from "./chestCells.js";

interface PairCells {
    home: ChestLocation;
    other: ChestLocation;
}

/** Everything the two singles held when the merge started, plus their containers to clear. */
interface SavedPair {
    masterContainer: Container;
    shadowContainer: Container;
    masterLatch: CardinalDirection;
    shadowLatch: CardinalDirection;
    masterContents: (ItemStack | undefined)[];
    shadowContents: (ItemStack | undefined)[];
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
    if (placed.ok) guard("placePair", () => placed.value.setPermutation(permutation));

    return readPair(dimensionId, masterCell, shadowCell);
}

function clearPairCells(dimensionId: string, masterCell: ChestLocation, shadowCell: ChestLocation): void {
    for (const cell of [masterCell, shadowCell]) {
        const block = blockAt(dimensionId, cell);
        if (!block.ok) continue;

        guard("clearPairCell", () => block.value.setType(AIR_ID));
    }
}

function readPair(dimensionId: string, masterCell: ChestLocation, shadowCell: ChestLocation): PairCells | undefined {
    const built = blockAt(dimensionId, masterCell);
    const twin = blockAt(dimensionId, shadowCell);
    if (!built.ok || !twin.ok) return undefined;
    if (!isHalf(built.value) || !isHalf(twin.value)) return undefined;

    const builtPart = partStateOf(built.value);
    const twinPart = partStateOf(twin.value);
    const home = partHome(builtPart.ok ? builtPart.value : undefined, twinPart.ok ? twinPart.value : undefined);
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
    if (container.ok) {
        for (const stack of writeSlots(container.value, contents)) {
            guard("spawnUnplacedStack", () => block.dimension.spawnItem(stack, block.center()));
        }
        return;
    }

    for (const stack of contents) {
        if (!stack) continue;
        guard("spawnUnplacedStack", () => block.dimension.spawnItem(stack, block.center()));
    }
}

/** Reads the pre-merge state the merge must be able to hand back, or nothing if it cannot be read. */
function savePair(master: Block, shadow: Block): SavedPair | undefined {
    const masterContainer = containerOf(master);
    const shadowContainer = containerOf(shadow);
    if (!masterContainer.ok || !shadowContainer.ok) return undefined;

    const masterContents = readSlots(masterContainer.value, SINGLE_CHEST_SLOTS);
    const shadowContents = readSlots(shadowContainer.value, SINGLE_CHEST_SLOTS);
    if (!masterContents.ok || !shadowContents.ok) return undefined;

    return {
        masterContainer: masterContainer.value,
        shadowContainer: shadowContainer.value,
        masterLatch: latchOf(readLatch(master)),
        shadowLatch: latchOf(readLatch(shadow)),
        masterContents: masterContents.value,
        shadowContents: shadowContents.value
    };
}

function restoreSingles(master: Block, shadow: Block, saved: SavedPair): void {
    guard("restoreMasterSingle", () => master.setPermutation(singlePermutation(saved.masterLatch)));
    guard("restoreShadowSingle", () => shadow.setPermutation(singlePermutation(saved.shadowLatch)));

    handBackContents(master, saved.masterContents);
    handBackContents(shadow, saved.shadowContents);

    console.warn("doubleChest: pairing failed, kept two single chests");
}

export function mergePair(master: Block, shadow: Block, state: CardinalDirection): void {
    const saved = savePair(master, shadow);
    if (!saved) return;

    const dimensionId = master.dimension.id;
    const masterCell = cellOf(master);
    const shadowCell = cellOf(shadow);

    // Both bail-outs are the same operation, so they share one path. The cells are re-read because
    // assembling the pair replaces the blocks the caller passed, which go stale under `fillBlocks`;
    // `liveMaster`/`liveShadow` are the freshest handles for those two cells at the point of failure.
    const rollBack = (liveMaster: Block, liveShadow: Block): void => {
        restoreSingles(
            valueOr(blockAt(dimensionId, masterCell), liveMaster),
            valueOr(blockAt(dimensionId, shadowCell), liveShadow),
            saved
        );
    };

    // A half that would not clear still holds stacks the merged write would duplicate, so the pair is
    // abandoned instead of built on top of them. Nothing is lost: both reads are already in hand.
    const cleared = clearSlots(saved.masterContainer, SINGLE_CHEST_SLOTS).ok
        && clearSlots(saved.shadowContainer, SINGLE_CHEST_SLOTS).ok;
    if (!cleared) {
        rollBack(master, shadow);
        return;
    }

    const cells = assemblePair(master, shadow, state);
    if (!cells) {
        rollBack(master, shadow);
        return;
    }

    const home = valueOr(blockAt(dimensionId, cells.home), master);
    const other = valueOr(blockAt(dimensionId, cells.other), shadow);

    const homeContainer = containerOf(home);
    if (!homeContainer.ok) {
        rollBack(home, other);
        return;
    }

    writeSlots(homeContainer.value, mergeContents(saved.masterContents, saved.shadowContents));

    const otherContainer = containerOf(other);
    if (otherContainer.ok) clearSlots(otherContainer.value, DOUBLE_CHEST_SLOTS);
}

export function mergeChestAt(dimensionId: string, location: ChestLocation): void {
    const placed = blockAt(dimensionId, location);
    if (!placed.ok || placed.value.typeId !== SINGLE_CHEST_ID) return;

    const plan = planPair(readLatch(placed.value), chestNeighbours(placed.value));
    if (!plan) return;

    const masterLocation = offsetLocation(location, plan.masterOffset);
    const shadowLocation = offsetLocation(masterLocation, PAIR_LAYOUTS[plan.state].step);

    const master = blockAt(dimensionId, masterLocation);
    const shadow = blockAt(dimensionId, shadowLocation);
    if (!master.ok || !shadow.ok) return;
    if (master.value.typeId !== SINGLE_CHEST_ID || shadow.value.typeId !== SINGLE_CHEST_ID) return;

    mergePair(master.value, shadow.value, plan.state);
}
