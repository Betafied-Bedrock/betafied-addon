/**
 * Beta 1.7.3 allowed wooden doors to be toggled by attacking/punching (left-click) as well
 * as interacting (right-click), whereas iron doors remained strictly redstone-operated.
 * Modern Bedrock does not toggle doors on attack, so this module restores that punch-to-toggle
 * behavior for authentic wooden doors.
 */

import { Block, system } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { reportError } from "../core/errorReporter.js";

const WOODEN_DOOR_ID = "minecraft:wooden_door";
const PUNCH_COOLDOWN_TICKS = 8;
const OPEN_BIT = "open_bit";
const UPPER_BIT = "upper_block_bit";

const lastToggledTicks = new Map<string, number>();

export interface Cell {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export interface DoorTogglePlan {
    readonly lowerCell: Cell;
    readonly upperCell: Cell;
    readonly newOpenState: boolean;
    readonly soundName: "random.door_open" | "random.door_close";
}

function findStateKey(
    states: Readonly<Record<string, boolean | number | string>>,
    suffix: string
): string | undefined {
    if (suffix in states) return suffix;
    return Object.keys(states).find(name => name.endsWith(`:${suffix}`));
}

/**
 * Calculates door halves and inverted open state from the attacked block.
 * Returns undefined for non-wooden doors or invalid door state configurations.
 */
export function planDoorToggle(
    blockTypeId: string,
    states: Readonly<Record<string, boolean | number | string>>,
    cell: Cell
): DoorTogglePlan | undefined {
    if (blockTypeId !== WOODEN_DOOR_ID) return undefined;

    const upperBitKey = findStateKey(states, UPPER_BIT);
    const openBitKey = findStateKey(states, OPEN_BIT);
    if (upperBitKey === undefined || openBitKey === undefined) return undefined;

    const isUpper = states[upperBitKey] === true;
    const isOpen = states[openBitKey] === true;
    const newOpenState = !isOpen;

    const lowerCell: Cell = isUpper
        ? { x: cell.x, y: cell.y - 1, z: cell.z }
        : { x: cell.x, y: cell.y, z: cell.z };

    const upperCell: Cell = isUpper
        ? { x: cell.x, y: cell.y, z: cell.z }
        : { x: cell.x, y: cell.y + 1, z: cell.z };

    return {
        lowerCell,
        upperCell,
        newOpenState,
        soundName: newOpenState ? "random.door_open" : "random.door_close"
    };
}

function isDebounced(key: string, currentTick: number): boolean {
    const lastTick = lastToggledTicks.get(key);
    if (lastTick !== undefined && currentTick - lastTick < PUNCH_COOLDOWN_TICKS) {
        return true;
    }
    lastToggledTicks.set(key, currentTick);

    // Prune stale entries when cache grows to avoid retention over long sessions
    if (lastToggledTicks.size > 100) {
        for (const [k, tick] of lastToggledTicks) {
            if (currentTick - tick > 100) {
                lastToggledTicks.delete(k);
            }
        }
    }
    return false;
}

function toggleDoor(hitBlock: Block): void {
    const states = hitBlock.permutation.getAllStates();
    const cell: Cell = {
        x: hitBlock.location.x,
        y: hitBlock.location.y,
        z: hitBlock.location.z
    };

    const plan = planDoorToggle(hitBlock.typeId, states, cell);
    if (!plan) return;

    const dim = hitBlock.dimension;
    const cooldownKey = `${dim.id}:${plan.lowerCell.x},${plan.lowerCell.y},${plan.lowerCell.z}`;
    if (isDebounced(cooldownKey, system.currentTick)) return;

    const lower = dim.getBlock(plan.lowerCell);
    const upper = dim.getBlock(plan.upperCell);
    if (!lower || !upper) return;
    if (lower.typeId !== WOODEN_DOOR_ID || upper.typeId !== WOODEN_DOOR_ID) return;

    const lowerStates = lower.permutation.getAllStates();
    const upperStates = upper.permutation.getAllStates();
    const lowerOpenKey = findStateKey(lowerStates, OPEN_BIT) ?? OPEN_BIT;
    const upperOpenKey = findStateKey(upperStates, OPEN_BIT) ?? OPEN_BIT;

    lower.setPermutation(lower.permutation.withState(lowerOpenKey as "open_bit", plan.newOpenState));
    upper.setPermutation(upper.permutation.withState(upperOpenKey as "open_bit", plan.newOpenState));

    dim.playSound(
        plan.soundName,
        {
            x: plan.lowerCell.x + 0.5,
            y: plan.lowerCell.y + 1.0,
            z: plan.lowerCell.z + 0.5
        },
        {
            volume: 1.0,
            pitch: 0.9 + Math.random() * 0.1
        }
    );
}

eventBus.onEntityHitBlock((event) => {
    if (event.damagingEntity?.typeId !== "minecraft:player") return;
    if (!event.hitBlock) return;

    try {
        toggleDoor(event.hitBlock);
    } catch (e) {
        reportError(
            {
                system: "doorPunch",
                operation: "toggleDoor",
                target: event.hitBlock.typeId
            },
            e
        );
    }
});
