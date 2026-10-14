import { Block, BlockPermutation, Direction, EntityComponentTypes, EquipmentSlot, world } from "@minecraft/server";
import type { Player, PlayerPlaceBlockBeforeEvent } from "@minecraft/server";
import { BETA_DOOR_BLOCK_IDS, BETA_DOOR_BLOCK_OF } from "../core/betaRegistry.js";
import { eventBus } from "../core/eventBus.js";
import { reportError, runCatching } from "../core/errorReporter.js";

const AIR_ID = "minecraft:air";
const UPPER_BIT = "upper_block_bit";

export interface Cell {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export interface DoorCompletion {
    readonly upperStates: Record<string, boolean | number | string>;
}

export function planDoorCompletion(
    typeId: string,
    states: Readonly<Record<string, boolean | number | string>>,
    aboveTypeId: string
): DoorCompletion | undefined {
    if (!BETA_DOOR_BLOCK_IDS.has(typeId)) return undefined;

    const upperBit = upperBitKey(states);
    if (upperBit === undefined || states[upperBit] === true) return undefined;
    if (aboveTypeId !== AIR_ID) return undefined;

    return { upperStates: { ...states, [upperBit]: true } };
}

function upperBitKey(states: Readonly<Record<string, boolean | number | string>>): string | undefined {
    if (UPPER_BIT in states) return UPPER_BIT;
    return Object.keys(states).find(name => name.endsWith(`:${UPPER_BIT}`));
}

function heldDoorItem(player: Player): boolean {
    const held = player.getComponent(EntityComponentTypes.Equippable)?.getEquipment(EquipmentSlot.Mainhand);
    return held !== undefined && BETA_DOOR_BLOCK_OF[held.typeId] !== undefined;
}

function enforceTopFaceOnly(event: PlayerPlaceBlockBeforeEvent): void {
    if (!event.permutationToPlace) return;
    if (!BETA_DOOR_BLOCK_IDS.has(event.permutationToPlace.type.id)) return;
    if (event.face === Direction.Up) return;
    if (!heldDoorItem(event.player)) return;

    event.cancel = true;
}

function completeDoor(dimensionId: string, cell: Cell): void {
    const dimension = world.getDimension(dimensionId);
    const lower = dimension.getBlock(cell);
    const upper = dimension.getBlock({ x: cell.x, y: cell.y + 1, z: cell.z });
    if (!lower || !upper) return;

    const plan = planDoorCompletion(lower.typeId, lower.permutation.getAllStates(), upper.typeId);
    if (!plan) return;

    upper.setPermutation(BlockPermutation.resolve(lower.typeId, plan.upperStates));
}

eventBus.onPlayerPlaceBlockBefore(event => {
    try {
        enforceTopFaceOnly(event);
    } catch (e) {
        reportError({ system: "doorPlacement", operation: "topFaceRule" }, e);
    }
});

function readCell(block: Block): Cell | undefined {
    return runCatching(
        { system: "doorPlacement", operation: "readPlacedCell", target: block.typeId },
        () => ({ x: block.location.x, y: block.location.y, z: block.location.z })
    );
}

eventBus.onPlayerPlaceBlock(event => {
    const cell = readCell(event.block);
    if (!cell) return;

    try {
        completeDoor(event.block.dimension.id, cell);
    } catch (e) {
        reportError({
            system: "doorPlacement",
            operation: "completePair",
            target: `${cell.x},${cell.y},${cell.z}`
        }, e);
    }
});
