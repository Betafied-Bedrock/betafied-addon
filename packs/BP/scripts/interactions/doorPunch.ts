import { Block, Player, system } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import type { Cell } from "./cell.js";
import { reportError } from "../core/errorReporter.js";

const WOODEN_DOOR_ID = "minecraft:wooden_door";
const PUNCH_COOLDOWN_TICKS = 8;
const OPEN_BIT = "open_bit";
const UPPER_BIT = "upper_block_bit";

const lastToggledTicks = new Map<string, number>();

/**
 * A `[Private]` sign beside a door, as the server's lockette signs write it:
 * owner on line 2, guest names on lines 3-4. Clan tags are left out of `guests`
 * because the addon has no clan index, which keeps a clan member's punch refused
 * rather than letting a stranger through on a line the addon cannot resolve.
 */
interface DoorLock {
    owner: string;
    guests: string[];
}

const SIGN_OFFSETS: readonly Cell[] = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 }
];

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

function parsePrivateSign(text: string): DoorLock | undefined {
    const lines = text.split("\n");
    const marker = (lines[0] ?? "").trim().toLowerCase();
    if (marker !== "[private]" && marker !== "private") return undefined;

    const owner = (lines[1] ?? "").trim().toLowerCase();
    // An owner line that is still blank parses as unclaimed everywhere else in
    // far.land, and the first interaction claims it. Refusing the punch here
    // would make a sign nobody owns punish the player about to own it.
    if (!owner) return undefined;

    const guests: string[] = [];
    for (let i = 2; i < lines.length; i++) {
        const line = (lines[i] ?? "").trim().toLowerCase();
        if (!line) continue;
        if (line.startsWith("[") && line.endsWith("]")) continue;
        guests.push(line);
    }

    return { owner, guests };
}

function signLock(block: Block): DoorLock | undefined {
    if (!block.typeId.includes("sign")) return undefined;

    const sign = block.getComponent("minecraft:sign");
    const text = sign?.getText();
    return text ? parsePrivateSign(text) : undefined;
}

/**
 * Whether a sign really governs `anchor`, rather than merely sitting beside it.
 * A wall sign names the block it is mounted on through its facing state; a
 * standing sign has no facing and is attached to whatever it stands against.
 */
function isSignMountedOn(sign: Block, anchor: Cell): boolean {
    const facingKey = findStateKey(sign.permutation.getAllStates(), "facing_direction");
    if (facingKey === undefined) return true;

    const facing = sign.permutation.getState(facingKey as "facing_direction");
    const { x, y, z } = sign.location;
    switch (facing) {
        case 2:
            return anchor.x === x && anchor.y === y && anchor.z === z + 1;
        case 3:
            return anchor.x === x && anchor.y === y && anchor.z === z - 1;
        case 4:
            return anchor.x === x + 1 && anchor.y === y && anchor.z === z;
        case 5:
            return anchor.x === x - 1 && anchor.y === y && anchor.z === z;
        default:
            return false;
    }
}

/** The `[Private]` lock governing the door, found from either half. */
function findDoorLock(door: Block, plan: DoorTogglePlan): DoorLock | undefined {
    const dimension = door.dimension;

    for (const anchor of [plan.lowerCell, plan.upperCell]) {
        for (const offset of SIGN_OFFSETS) {
            const neighbor = dimension.getBlock({
                x: anchor.x + offset.x,
                y: anchor.y + offset.y,
                z: anchor.z + offset.z
            });
            if (!neighbor?.isValid) continue;

            const lock = signLock(neighbor);
            if (lock && isSignMountedOn(neighbor, anchor)) return lock;
        }
    }

    return undefined;
}

function isLockedAgainst(lock: DoorLock, player: Player): boolean {
    const name = player.name.toLowerCase();
    return name !== lock.owner && !lock.guests.includes(name);
}

function isDebounced(key: string, currentTick: number): boolean {
    const lastTick = lastToggledTicks.get(key);
    if (lastTick !== undefined && currentTick - lastTick < PUNCH_COOLDOWN_TICKS) {
        return true;
    }
    lastToggledTicks.set(key, currentTick);

    if (lastToggledTicks.size > 100) {
        for (const [k, tick] of lastToggledTicks) {
            if (currentTick - tick > 100) {
                lastToggledTicks.delete(k);
            }
        }
    }
    return false;
}

function toggleDoor(hitBlock: Block, player: Player): void {
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

    const lock = findDoorLock(hitBlock, plan);
    if (lock && isLockedAgainst(lock, player)) {
        player.sendMessage("§cThis door is locked by a private sign.");
        return;
    }

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
        toggleDoor(event.hitBlock, event.damagingEntity as Player);
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
