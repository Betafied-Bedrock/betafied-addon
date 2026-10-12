/**
 * Beta 1.7.3's `ItemSign`: the underside of a block was refused, the top face put a standing sign up
 * with the placing player's rotation, and every other face hung a wall sign off the block that was
 * clicked. Bedrock keeps those as two different native blocks and the vanilla sign item places them
 * itself, so the pack's sign places its own — the numbers below are the era's, whose aux table maps
 * straight onto `ground_sign_direction` and `facing_direction`.
 *
 * Only the empty cell is written and only the pack's sign triggers this, so a sign never takes the
 * place of what a player built, and the interaction is cancelled just for the placements the era
 * would have made — clicking a chest while holding a sign still opens the chest.
 */

import {
    BlockPermutation,
    Direction,
    EntityComponentTypes,
    EquipmentSlot,
    GameMode,
    Player,
    system,
    world
} from "@minecraft/server";
import type { PlayerInteractWithBlockBeforeEvent } from "@minecraft/server";
import { BH_SIGN_ID } from "../core/betaRegistry.js";
import { eventBus } from "../core/eventBus.js";
import { reportError, runCatching } from "../core/errorReporter.js";

const AIR_ID = "minecraft:air";
const STANDING_SIGN_ID = "minecraft:standing_sign";
const WALL_SIGN_ID = "minecraft:wall_sign";
const PLACE_SOUND = "use.wood";

export interface Cell {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** Beta's `EntityPlayer` side numbering, which Bedrock's `facing_direction` states share. */
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

/**
 * The sign the era would have placed on `face`, or undefined where it would have placed none: the
 * underside of a block. The three wall faces are one block under different `facing_direction`
 * states, so only the standing sign carries a rotation to compute.
 */
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

/** `MathHelper.func_584_b((yaw + 180) * 16 / 360 + 0.5) & 15`, the era's standing sign rotation. */
export function standingSignDirection(yaw: number): number {
    return Math.floor(((yaw + 180) * 16) / 360 + 0.5) & 15;
}

function heldSign(player: Player): boolean {
    return player.getComponent(EntityComponentTypes.Equippable)
        ?.getEquipment(EquipmentSlot.Mainhand)?.typeId === BH_SIGN_ID;
}

function consumeHeldSign(player: Player): void {
    if (player.getGameMode() === GameMode.Creative) return;

    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    const held = equippable?.getEquipment(EquipmentSlot.Mainhand);
    if (!equippable || !held || held.typeId !== BH_SIGN_ID) return;

    if (held.amount > 1) {
        held.amount -= 1;
        equippable.setEquipment(EquipmentSlot.Mainhand, held);
    } else {
        equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
    }
}

interface PlannedSign {
    readonly cell: Cell;
    readonly blockId: string;
    readonly states: Record<string, boolean | number | string>;
}

/**
 * The sign this click would place, or undefined when it would place none. Every read happens here, in
 * the before-event, so the handler knows whether cancelling the interaction is faithful before it
 * commits to it; nothing is written until the deferred pass.
 */
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

function placeSign(player: Player, planned: PlannedSign, dimensionId: string): void {
    if (!player.isValid || !heldSign(player)) return;

    const dimension = world.getDimension(dimensionId);
    const target = dimension.getBlock(planned.cell);

    // The cell is checked again because the world may have moved since the click; a sign that is no
    // longer wanted leaves the held item in hand.
    if (!target || target.typeId !== AIR_ID) return;

    dimension.setBlockPermutation(planned.cell, BlockPermutation.resolve(planned.blockId, planned.states));
    player.playSound(PLACE_SOUND, { volume: 1.0, pitch: 0.8 });
    consumeHeldSign(player);
}

eventBus.onPlayerInteractWithBlock((event: PlayerInteractWithBlockBeforeEvent) => {
    const { block, blockFace, itemStack, player } = event;
    if (!block || !itemStack || itemStack.typeId !== BH_SIGN_ID) return;
    if (!heldSign(player)) return;

    const clicked: Cell = { x: block.location.x, y: block.location.y, z: block.location.z };
    const dimension = block.dimension;
    const planned = plannedSign(player, clicked, blockFace);
    if (!planned) return;

    const target = dimension.getBlock(planned.cell);
    if (!target || target.typeId !== AIR_ID) return;

    event.cancel = true;

    // A before-event cannot write to the world, so the sign goes up on the next tick.
    system.run(() => {
        try {
            placeSign(player, planned, dimension.id);
        } catch (e) {
            reportError({
                system: "signPlacement",
                operation: "placeSign",
                target: `${planned.cell.x},${planned.cell.y},${planned.cell.z}`
            }, e);
        }
    });
});
