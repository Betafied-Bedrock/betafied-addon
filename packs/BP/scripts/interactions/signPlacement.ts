/**
 * Beta 1.7.3's `ItemSign`: the underside of a block was refused, the top face put a standing sign up
 * with the placing player's rotation, and every other face hung a wall sign off the block that was
 * clicked. Bedrock keeps those as two different native blocks, and the numbers below are the era's,
 * whose aux table maps straight onto `ground_sign_direction` and `facing_direction`.
 *
 * Only one of the two can be the item's, because `minecraft:block_placer` names a single block — and
 * that block has to be the standing sign, since the engine placing it is the only thing that raises
 * the sign editor, which no script API can open. A wall click is therefore left to place that standing
 * sign as well, and the tick after, the cell is rehung as the era's wall sign; the editor the engine
 * opened names that same cell, so the text the player types is written to the sign it ends up holding.
 *
 * The era had no sign editing to go back to: `BlockSign.onBlockActivated` answered false, so a click on
 * a sign that was already standing only ever fell through to whatever was in hand, while the engine
 * answers the same click with its sign editor. That editor is swallowed here, silently, unless the
 * click is a block the engine will still put up against the sign — the one interaction the era had.
 *
 * Only a cell the sign can take is written, and only the pack's sign triggers this, so a sign never
 * takes the place of what a player built, and the interaction is cancelled just for the placements the
 * era would have made — clicking a chest while holding a sign still opens the chest.
 *
 * A door or a trapdoor is even less this module's: the era let the block's own use answer the click
 * before the sign was ever offered, so nothing goes down against one — `BETA_USE_CONSUMING_BLOCK_IDS`.
 */

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

/** The two blocks the engine opens its sign editor on. */
const SIGN_BLOCK_IDS: ReadonlySet<string> = Object.freeze(new Set([STANDING_SIGN_ID, WALL_SIGN_ID]));

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

/**
 * The wall sign the era wanted at `planned.cell`, the tick after the click — a before-event cannot
 * touch the world, and the engine's own placement needs the click itself to raise the editor.
 */
function settleWallSign(player: Player, planned: PlannedSign, dimensionId: string): void {
    const dimension = world.getDimension(dimensionId);
    const target = dimension.getBlock(planned.cell);
    if (!target) return;

    // The engine hung the wall sign itself, which is what the placer names on a face it can hang from.
    if (target.typeId === WALL_SIGN_ID) return;

    // Otherwise the engine put its standing sign in the cell and opened the editor on it, so the cell
    // is rehung in place rather than rebuilt: an empty cell means the engine refused the face and the
    // sign is still the player's to write with.
    if (target.typeId === STANDING_SIGN_ID) {
        target.setPermutation(BlockPermutation.resolve(planned.blockId, planned.states));
        return;
    }

    // Anything else in the cell is a build, not a sign.
    if (target.typeId !== AIR_ID) return;
    if (!player.isValid || !heldSign(player)) return;

    dimension.setBlockPermutation(planned.cell, BlockPermutation.resolve(planned.blockId, planned.states));
    player.playSound(PLACE_SOUND, { volume: 1.0, pitch: 0.8 });
    consumeHeldItem(player, (typeId) => typeId === BH_SIGN_ID);
}

/**
 * The era's own sign, in hand. Returns whether the click was the era's at all: the underside was
 * refused, and a cell that is taken is a click the era placed nothing on, which leaves the click to
 * whatever else it can do — a chest still opens while a sign is held.
 */
function routeEraSign(
    event: PlayerInteractWithBlockBeforeEvent,
    player: Player,
    block: Block,
    face: Direction
): boolean {
    // The era asked the block's own use first, so a door or a trapdoor answered the click and the sign
    // stayed in hand. The engine consumes that same click, which is why nothing is written here: the
    // deferred pass would otherwise find an empty cell the engine never refused and hang an untyped
    // sign off the door.
    if (BETA_USE_CONSUMING_BLOCK_IDS.has(block.typeId)) return false;

    if (face === Direction.Down) {
        // `ItemSign` refused the underside, and the item's own placer would take it: a standing sign
        // hung under the block it was used on.
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

    // The top face belongs to the engine: it writes the block the item names with the rotation its own
    // table gives — `standingSignDirection` above is the era's version of that same table.
    if (planned.blockId === STANDING_SIGN_ID) return true;

    // A wall sign cannot be: the engine places the standing sign in the cell the era hung one in, and
    // the deferred pass rehangs it there. Cancelling this click instead would suppress the placement,
    // and with it the editor.
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

/**
 * Whether this click is a block placement the engine will make. A use that places nothing is the one
 * the engine answers with the sign editor, and the era had no editor at all, so a placement is the
 * only reason a click on a sign is kept. `canPlace` is the engine's own verdict on the block the item
 * names against this face, and no stable member answers that question.
 */
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

    // The pack's own sign in hand is the era's placement, and every click it makes is this module's.
    if (itemStack?.typeId === BH_SIGN_ID && heldSign(player) && routeEraSign(event, player, block, blockFace)) {
        return;
    }

    // No editing, then. The engine opens its sign editor for any click on a sign that places nothing,
    // and the editor is the one thing this file has to keep the era from.
    if (SIGN_BLOCK_IDS.has(block.typeId) && !placesABlock(block, blockFace, itemStack)) {
        event.cancel = true;
    }
});
