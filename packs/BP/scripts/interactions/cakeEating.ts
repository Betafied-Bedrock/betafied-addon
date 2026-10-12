/**
 * Beta 1.7.3's `BlockCake`: one block carrying six bites in its metadata, an eat that healed three
 * points but only for a player under full health, and a slice that went without a sound. Those bites
 * are the `bh:bites` state here and the block's geometry draws the slices that are left, so this
 * module only has to answer what the next bite leaves behind.
 *
 * Every click is swallowed. `BlockCake.blockActivated` answered true whatever was in hand, which is
 * what kept a held block from going up against the cake, and the era took no slice at all once the
 * player was at full health — the click was spent either way.
 *
 * The slice itself is taken on the next tick: a before-event answers the engine, and the world write
 * belongs in the pass that follows it.
 *
 * Bedrock hands a single input to the before-event repeatedly, so the raw firing is not the click. A
 * short cooldown per player and cell makes one tap earn one slice, which is what the era's click did.
 */

import { BlockPermutation, EntityComponentTypes, system, world } from "@minecraft/server";
import type { Block, Player, PlayerInteractWithBlockBeforeEvent } from "@minecraft/server";
import { BH_CAKE_ID } from "../core/betaRegistry.js";
import { eventBus } from "../core/eventBus.js";
import { reportError, runCatching } from "../core/errorReporter.js";

const AIR_ID = "minecraft:air";

/** Beta's metadata, the value its `setBlockBoundsBasedOnState` drew a smaller box for each bite. */
export const CAKE_BITES_STATE = "bh:bites";

/** `if (var6 >= 6) setBlockWithNotify(..., 0)`: the sixth bite cleared the block, not a seventh state. */
export const CAKE_SERVINGS = 6;

/** `var5.heal(3)`, taken only while `var5.health < 20`. */
export const SLICE_HEAL = 3;

/**
 * How long a tap keeps the cell to itself. The engine fires the before-event several times over the
 * ticks an input is held, and every fire would otherwise take its own slice; one quarter of a second
 * collapses that burst while staying far inside the gap between two deliberate taps.
 */
export const BITE_COOLDOWN_TICKS = 5;

/** The tick each player last took a slice from a given cell, so a burst of fires earns one slice. */
const lastBiteTicks = new Map<string, number>();

function isBursted(key: string, currentTick: number): boolean {
    const lastTick = lastBiteTicks.get(key);
    if (lastTick !== undefined && currentTick - lastTick < BITE_COOLDOWN_TICKS) {
        return true;
    }
    lastBiteTicks.set(key, currentTick);

    if (lastBiteTicks.size > 100) {
        for (const [entry, tick] of lastBiteTicks) {
            if (currentTick - tick > 100) {
                lastBiteTicks.delete(entry);
            }
        }
    }
    return false;
}

export interface Cell {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export interface CakeBite {
    readonly heal: number;
    /** The state the cell is left holding, or undefined where the era cleared it. */
    readonly nextBites: number | undefined;
}

/**
 * Beta's `BlockCake.eatCakeSlice`, whole: a player at full health took no slice, and the bite that
 * would have been the seventh cleared the block instead of writing a seventh bite.
 */
export function planCakeBite(bites: number, health: number, maxHealth: number): CakeBite | undefined {
    if (health >= maxHealth) return undefined;

    const nextBites = bites + 1;
    return { heal: SLICE_HEAL, nextBites: nextBites >= CAKE_SERVINGS ? undefined : nextBites };
}

function readBites(block: Block, cell: Cell): number {
    const bites = runCatching(
        {
            system: "cakeEating",
            operation: "readBites",
            target: `${cell.x},${cell.y},${cell.z}`
        },
        // A custom state is not in the engine's typed state table, so it is read off the map the same
        // way the door and fence modules read theirs.
        () => block.permutation.getAllStates()[CAKE_BITES_STATE]
    );
    return typeof bites === "number" ? bites : 0;
}

/** The slice the click earned, written where the era wrote it: health first, then the bite. */
function takeSlice(player: Player, dimensionId: string, cell: Cell): void {
    if (!player.isValid) return;

    const block = world.getDimension(dimensionId).getBlock(cell);
    if (!block || block.typeId !== BH_CAKE_ID) return;

    const health = player.getComponent(EntityComponentTypes.Health);
    if (!health) return;

    const bite = planCakeBite(readBites(block, cell), health.currentValue, health.defaultValue);
    if (!bite) return;

    const healed = Math.min(health.currentValue + bite.heal, health.defaultValue);
    if (healed > health.currentValue) {
        health.setCurrentValue(healed);
    }

    if (bite.nextBites === undefined) {
        block.setType(AIR_ID);
        return;
    }

    block.setPermutation(BlockPermutation.resolve(BH_CAKE_ID, { [CAKE_BITES_STATE]: bite.nextBites }));
}

eventBus.onPlayerInteractWithBlock((event: PlayerInteractWithBlockBeforeEvent) => {
    const { block, player } = event;

    // Only the pack's cake answers to this: a vanilla cake left in an old world is converted by the
    // scrubber, so there is one eating path and not two.
    if (!block || block.typeId !== BH_CAKE_ID) return;

    event.cancel = true;

    const cell: Cell = { x: block.location.x, y: block.location.y, z: block.location.z };
    const dimensionId = block.dimension.id;

    // Cancelling above already spent the click; only the slice is throttled here.
    if (isBursted(`${player.id}:${dimensionId}:${cell.x},${cell.y},${cell.z}`, system.currentTick)) {
        return;
    }

    system.run(() => {
        try {
            takeSlice(player, dimensionId, cell);
        } catch (e) {
            reportError(
                {
                    system: "cakeEating",
                    operation: "takeSlice",
                    target: `${cell.x},${cell.y},${cell.z}`
                },
                e
            );
        }
    });
});
