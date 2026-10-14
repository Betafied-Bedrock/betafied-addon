import {
    BlockPermutation,
    Direction,
    EntityComponentTypes,
    EquipmentSlot,
    Player,
    system,
    world
} from "@minecraft/server";
import type { Block, ItemStack, PlayerInteractWithBlockBeforeEvent } from "@minecraft/server";
import { BETA_USE_CONSUMING_BLOCK_IDS, BH_SIGN_ID } from "../core/betaRegistry.js";
import { eventBus } from "../core/eventBus.js";
import { reportError, runCatching } from "../core/errorReporter.js";
import { consumeHeldItem } from "../core/heldItem.js";

const AIR_ID = "minecraft:air";
const STANDING_SIGN_ID = "minecraft:standing_sign";
const WALL_SIGN_ID = "minecraft:wall_sign";
const PLACE_SOUND = "use.wood";

const SIGN_BLOCK_IDS: ReadonlySet<string> = Object.freeze(new Set([STANDING_SIGN_ID, WALL_SIGN_ID]));

export interface Cell {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

const FACE_STEP: Readonly<Record<string, { readonly offset: Cell; readonly facing: number }>> = Object.freeze({
    [Direction.Down]: { offset: { x: 0, y: -1, z: 0 }, facing: 0 },
    [Direction.Up]: { offset: { x: 0, y: 1, z: 0 }, facing: 1 },
    [Direction.North]: { offset: { x: 0, y: 0, z: -1 }, facing: 2 },
    [Direction.South]: { offset: { x: 0, y: 0, z: 1 }, facing: 3 },
    [Direction.West]: { offset: { x: -1, y: 0, z: 0 }, facing: 4 },
    [Direction.East]: { offset: { x: 1, y: 0, z: 0 }, facing: 5 }
});

export interface SignPlan {
    readonly offset: Cell;
    readonly blockId: string;
    readonly states: Record<string, boolean | number | string>;
}

export function planSignPlacement(face: Direction, yaw: number): SignPlan | undefined {
    const step = FACE_STEP[face];
    if (!step || step.facing === 0) return undefined;

    if (step.facing === 1) {
        return {
            offset: step.offset,
            blockId: STANDING_SIGN_ID,
            states: { ground_sign_direction: standingSignDirection(yaw) }
        };
    }

    return { offset: step.offset, blockId: WALL_SIGN_ID, states: { facing_direction: step.facing } };
}

export function standingSignDirection(yaw: number): number {
    return Math.floor(((yaw + 180) * 16) / 360 + 0.5) & 15;
}

function heldSign(player: Player): boolean {
    return player.getComponent(EntityComponentTypes.Equippable)
        ?.getEquipment(EquipmentSlot.Mainhand)?.typeId === BH_SIGN_ID;
}

interface PlannedSign {
    readonly cell: Cell;
    readonly blockId: string;
    readonly states: Record<string, boolean | number | string>;
}

function plannedSign(player: Player, clicked: Cell, face: Direction): PlannedSign | undefined {
    const yaw = runCatching(
        { system: "signPlacement", operation: "readYaw", target: player.name },
        () => player.getRotation().y
    );
    if (yaw === undefined) return undefined;

    const plan = planSignPlacement(face, yaw);
    if (!plan) return undefined;

    const cell: Cell = {
        x: clicked.x + plan.offset.x,
        y: clicked.y + plan.offset.y,
        z: clicked.z + plan.offset.z
    };

    return { cell, blockId: plan.blockId, states: plan.states };
}

function settleWallSign(player: Player, planned: PlannedSign, dimensionId: string): void {
    const dimension = world.getDimension(dimensionId);
    const target = dimension.getBlock(planned.cell);
    if (!target) return;

    if (target.typeId === WALL_SIGN_ID) return;

    if (target.typeId === STANDING_SIGN_ID) {
        target.setPermutation(BlockPermutation.resolve(planned.blockId, planned.states));
        return;
    }

    if (target.typeId !== AIR_ID) return;
    if (!player.isValid || !heldSign(player)) return;

    dimension.setBlockPermutation(planned.cell, BlockPermutation.resolve(planned.blockId, planned.states));
    player.playSound(PLACE_SOUND, { volume: 1.0, pitch: 0.8 });
    consumeHeldItem(player, (typeId) => typeId === BH_SIGN_ID);
}

function routeEraSign(
    event: PlayerInteractWithBlockBeforeEvent,
    player: Player,
    block: Block,
    face: Direction
): boolean {
    if (BETA_USE_CONSUMING_BLOCK_IDS.has(block.typeId)) return false;

    if (face === Direction.Down) {
        event.cancel = true;
        return true;
    }

    const clicked: Cell = { x: block.location.x, y: block.location.y, z: block.location.z };
    const planned = plannedSign(player, clicked, face);
    if (!planned) return false;

    const dimension = block.dimension;
    const open = runCatching(
        { system: "signPlacement", operation: "readSignCell", target: `${planned.cell.x},${planned.cell.y},${planned.cell.z}` },
        () => {
            const target = dimension.getBlock(planned.cell);
            return target !== undefined && target.typeId === AIR_ID;
        }
    );
    if (open !== true) return false;

    if (planned.blockId === STANDING_SIGN_ID) return true;

    system.run(() => {
        try {
            settleWallSign(player, planned, dimension.id);
        } catch (e) {
            reportError({
                system: "signPlacement",
                operation: "settleWallSign",
                target: `${planned.cell.x},${planned.cell.y},${planned.cell.z}`
            }, e);
        }
    });

    return true;
}

function placesABlock(block: Block, face: Direction, itemStack?: ItemStack): boolean {
    if (!itemStack) return false;

    return runCatching(
        { system: "signPlacement", operation: "canPlace", target: `${itemStack.typeId}@${block.typeId}` },
        () => block.canPlace(itemStack.typeId, face)
    ) ?? false;
}

eventBus.onPlayerInteractWithBlock((event: PlayerInteractWithBlockBeforeEvent) => {
    const { block, blockFace, itemStack, player } = event;
    if (!block) return;

    if (itemStack?.typeId === BH_SIGN_ID && heldSign(player) && routeEraSign(event, player, block, blockFace)) {
        return;
    }

    if (SIGN_BLOCK_IDS.has(block.typeId) && !placesABlock(block, blockFace, itemStack)) {
        event.cancel = true;
    }
});

