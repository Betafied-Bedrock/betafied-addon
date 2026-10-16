import { BlockPermutation, EntityComponentTypes, system, world } from "@minecraft/server";
import type { Block, Player, PlayerInteractWithBlockBeforeEvent } from "@minecraft/server";
import { BH_CAKE_ID } from "../policy/betaRegistry.js";
import { eventBus, InteractPriority } from "../core/eventBus.js";
import type { Cell } from "./cell.js";
import { reportError, runCatching } from "../core/errorReporter.js";

const AIR_ID = "minecraft:air";

export const CAKE_BITES_STATE = "bh:bites";
export const CAKE_SERVINGS = 6;
export const SLICE_HEAL = 3;
export const BITE_COOLDOWN_TICKS = 5;

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

export interface CakeBite {
    readonly heal: number;
    readonly nextBites: number | undefined;
}

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
        () => block.permutation.getAllStates()[CAKE_BITES_STATE]
    );
    return typeof bites === "number" ? bites : 0;
}

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

    if (!block || block.typeId !== BH_CAKE_ID) return;

    event.cancel = true;

    const cell: Cell = { x: block.location.x, y: block.location.y, z: block.location.z };
    const dimensionId = block.dimension.id;

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
}, InteractPriority.RULE);

