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

type Guarded<T> = { ok: true; value: T } | { ok: false };

export function guard<T>(operation: string, fn: () => T): Guarded<T> {
    let outcome: Guarded<T> = { ok: false };
    runCatching({ system: "doubleChest", operation }, () => {
        outcome = { ok: true, value: fn() };
    });
    return outcome;
}

export function blockAt(dimensionId: string, location: ChestLocation): Block | undefined {
    const found = guard(`getBlock:${dimensionId}`, () => world.getDimension(dimensionId).getBlock(location));
    return found.ok ? found.value : undefined;
}

export function containerOf(block: Block): Container | undefined {
    const component = guard(`getContainerComponent`, () => block.getComponent("minecraft:inventory"));
    return component.ok ? component.value?.container : undefined;
}

export function partStateOf(block: Block): unknown {
    const state = guard("readPartState", () => block.permutation.getState(PART_STATE));
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

export function directionStateOf(block: Block): CardinalDirection | undefined {
    const state = guard("readDirection", () => block.permutation.getState(DIRECTION_STATE));
    const value = state.ok ? state.value : undefined;
    return isCardinalDirection(value) ? value : undefined;
}

export function spansCells(dimensionId: string, resolution: PairResolution): boolean {
    return isHalf(blockAt(dimensionId, resolution.master)) && isHalf(blockAt(dimensionId, resolution.shadow));
}

function slotCapacity(container: Container, requested: number): number | undefined {
    const measured = guard("containerSize", () => container.size);
    return measured.ok ? clampSlots(requested, measured.value) : undefined;
}

export function readSlots(container: Container, slots: number): (ItemStack | undefined)[] | undefined {
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

export function clearSlots(container: Container, slots: number): void {
    const capacity = slotCapacity(container, slots) ?? 0;
    for (let slot = 0; slot < capacity; slot++) {
        guard(`clearSlot:${slot}`, () => container.setItem(slot));
    }
}

export function containerHasItems(dimensionId: string, location: ChestLocation): boolean | undefined {
    const block = blockAt(dimensionId, location);
    if (!block) return undefined;

    const container = containerOf(block);
    if (!container) return undefined;

    const contents = readSlots(container, DOUBLE_CHEST_SLOTS);
    return contents === undefined ? undefined : hasAnyItem(contents);
}

export function writeSlots(container: Container, contents: readonly (ItemStack | undefined)[], fallback: Block): void {
    const capacity = slotCapacity(container, contents.length) ?? 0;
    for (let slot = 0; slot < contents.length; slot++) {
        const stack = contents[slot];
        if (!stack) continue;
        if (slot < capacity && guard(`writeSlot:${slot}`, () => container.setItem(slot, stack)).ok) continue;

        guard("spawnUnplacedStack", () => fallback.dimension.spawnItem(stack, fallback.center()));
    }
}

export function moveContents(dimensionId: string, from: ChestLocation, to: ChestLocation): number | undefined {
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

        neighbours.push({ offset, latch: directionStateOf(found.value) });
    }

    return neighbours;
}
