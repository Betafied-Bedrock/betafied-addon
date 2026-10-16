import { world } from "@minecraft/server";
import type { Block, Container, ItemStack } from "@minecraft/server";
import { runCatching } from "../core/errorReporter.js";
import type { CardinalDirection, ChestLocation, ChestNeighbour, PairResolution } from "./chestPairing.js";
import {
    DOUBLE_CHEST_ID,
    DOUBLE_CHEST_SLOTS,
    DIRECTION_STATE,
    NEIGHBOUR_OFFSETS,
    PART_STATE,
    SINGLE_CHEST_ID,
    clampSlots,
    hasAnyItem,
    isCardinalDirection,
    planPlacement
} from "./chestPairing.js";

export const AIR_ID = "minecraft:air";

/**
 * The module's one failure shape. `ok: false` means the engine refused or could not answer the call;
 * it is never the same as a successful read whose value happens to be empty. A caller that learns
 * about a container only through this envelope therefore cannot mistake "unreadable" — a state the
 * sweep retries — for "holds nothing", which is what an item-losing early return would do.
 */
export type Guarded<T> = { ok: true; value: T } | { ok: false };

export function guard<T>(operation: string, fn: () => T): Guarded<T> {
    let outcome: Guarded<T> = { ok: false };
    runCatching({ system: "doubleChest", operation }, () => {
        outcome = { ok: true, value: fn() };
    });
    return outcome;
}

/** The value of a successful call, or the caller's own fallback. */
export function valueOr<T>(guarded: Guarded<T>, fallback: T): T {
    return guarded.ok ? guarded.value : fallback;
}

export function blockAt(dimensionId: string, location: ChestLocation): Guarded<Block> {
    const found = guard(`getBlock:${dimensionId}`, () => world.getDimension(dimensionId).getBlock(location));
    return found.ok && found.value !== undefined ? { ok: true, value: found.value } : { ok: false };
}

export function containerOf(block: Block): Guarded<Container> {
    const component = guard("getContainerComponent", () => block.getComponent("minecraft:inventory"));
    const container = component.ok ? component.value?.container : undefined;
    return container !== undefined ? { ok: true, value: container } : { ok: false };
}

export function partStateOf(block: Block): Guarded<unknown> {
    return guard("readPartState", () => block.permutation.getState(PART_STATE));
}

export function directionStateOf(block: Block): Guarded<CardinalDirection | undefined> {
    const state = guard("readDirection", () => block.permutation.getState(DIRECTION_STATE));
    if (!state.ok) return { ok: false };
    return { ok: true, value: isCardinalDirection(state.value) ? state.value : undefined };
}

/** The latch a chest wears: the one place an unreadable direction state folds down to `undefined`. */
export function readLatch(block: Block): CardinalDirection | undefined {
    const state = directionStateOf(block);
    return state.ok ? state.value : undefined;
}

export function isHalf(block: Block | undefined): block is Block {
    return block !== undefined && block.typeId === DOUBLE_CHEST_ID;
}

export function cellOf(block: Block): ChestLocation {
    return { x: block.location.x, y: block.location.y, z: block.location.z };
}

export function offsetLocation(location: ChestLocation, offset: ChestLocation): ChestLocation {
    return { x: location.x + offset.x, y: location.y + offset.y, z: location.z + offset.z };
}

export function spansCells(dimensionId: string, resolution: PairResolution): boolean {
    const master = blockAt(dimensionId, resolution.master);
    const shadow = blockAt(dimensionId, resolution.shadow);
    return master.ok && isHalf(master.value) && shadow.ok && isHalf(shadow.value);
}

function slotCapacity(container: Container, requested: number): Guarded<number> {
    const measured = guard("containerSize", () => container.size);
    return measured.ok ? { ok: true, value: clampSlots(requested, measured.value) } : { ok: false };
}

export function readSlots(container: Container, slots: number): Guarded<(ItemStack | undefined)[]> {
    const contents: (ItemStack | undefined)[] = [];
    const capacity = slotCapacity(container, slots);
    if (!capacity.ok) return { ok: false };

    for (let slot = 0; slot < capacity.value; slot++) {
        const read = guard(`readSlot:${slot}`, () => container.getItem(slot));
        if (!read.ok) return { ok: false };
        contents.push(read.value);
    }
    return { ok: true, value: contents };
}

export function clearSlots(container: Container, slots: number): Guarded<void> {
    const capacity = slotCapacity(container, slots);
    if (!capacity.ok) return { ok: false };

    for (let slot = 0; slot < capacity.value; slot++) {
        if (!guard(`clearSlot:${slot}`, () => container.setItem(slot)).ok) return { ok: false };
    }
    return { ok: true, value: undefined };
}

export function containerHasItems(dimensionId: string, location: ChestLocation): Guarded<boolean> {
    const block = blockAt(dimensionId, location);
    if (!block.ok) return { ok: false };

    const container = containerOf(block.value);
    if (!container.ok) return { ok: false };

    const contents = readSlots(container.value, DOUBLE_CHEST_SLOTS);
    return contents.ok ? { ok: true, value: hasAnyItem(contents.value) } : { ok: false };
}

/**
 * Writes what fits and hands back the stacks it could not place, so the caller — not this module —
 * decides where an unplaceable stack goes.
 */
export function writeSlots(container: Container, contents: readonly (ItemStack | undefined)[]): ItemStack[] {
    const unplaced: ItemStack[] = [];
    const capacity = slotCapacity(container, contents.length);

    for (let slot = 0; slot < contents.length; slot++) {
        const stack = contents[slot];
        if (!stack) continue;
        if (capacity.ok && slot < capacity.value && guard(`writeSlot:${slot}`, () => container.setItem(slot, stack)).ok) continue;

        unplaced.push(stack);
    }

    return unplaced;
}

export function moveContents(dimensionId: string, from: ChestLocation, to: ChestLocation): Guarded<number> {
    const source = blockAt(dimensionId, from);
    const destination = blockAt(dimensionId, to);
    if (!source.ok || !destination.ok) return { ok: false };

    const sourceContainer = containerOf(source.value);
    const destinationContainer = containerOf(destination.value);
    if (!sourceContainer.ok || !destinationContainer.ok) return { ok: false };

    const sourceContents = readSlots(sourceContainer.value, DOUBLE_CHEST_SLOTS);
    const destinationContents = readSlots(destinationContainer.value, DOUBLE_CHEST_SLOTS);
    if (!sourceContents.ok || !destinationContents.ok) return { ok: false };

    const plan = planPlacement(sourceContents.value, destinationContents.value);
    for (const move of plan.moves) {
        const stack = sourceContents.value[move.from];
        if (!stack) continue;

        if (!guard(`clearSlot:${move.from}`, () => sourceContainer.value.setItem(move.from)).ok) continue;
        if (guard(`writeSlot:${move.to}`, () => destinationContainer.value.setItem(move.to, stack)).ok) continue;

        guard("spawnUnplacedStack", () => source.value.dimension.spawnItem(stack, source.value.center()));
    }

    return { ok: true, value: plan.source.filter(stack => stack !== undefined).length };
}

export function solidAbove(block: Block): boolean {
    const above = guard("cellAbove", () => block.offset({ x: 0, y: 1, z: 0 }));
    if (!above.ok || !above.value) return false;

    const aboveBlock = above.value;
    if (aboveBlock.typeId === SINGLE_CHEST_ID || aboveBlock.typeId === DOUBLE_CHEST_ID) return false;

    const solid = guard("cellAboveSolid", () => aboveBlock.isSolid);
    return solid.ok && solid.value;
}

export function neighbourTypeIds(cell: Block): string[] {
    const types: string[] = [];

    for (const offset of NEIGHBOUR_OFFSETS) {
        const found = guard(`placementNeighbour:${offset.x},${offset.z}`, () => cell.offset(offset));
        if (found.ok && found.value) types.push(found.value.typeId);
    }

    return types;
}

export function chestNeighbours(placed: Block): ChestNeighbour[] {
    const neighbours: ChestNeighbour[] = [];

    for (const offset of NEIGHBOUR_OFFSETS) {
        const found = guard(`neighbour:${offset.x},${offset.z}`, () => placed.offset(offset));
        if (!found.ok || !found.value) continue;
        if (found.value.typeId !== SINGLE_CHEST_ID) continue;

        neighbours.push({ offset, latch: readLatch(found.value) });
    }

    return neighbours;
}
