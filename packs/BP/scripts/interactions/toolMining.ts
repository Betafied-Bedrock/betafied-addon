import { world, Player, EquipmentSlot, EntityComponentTypes, GameMode } from "@minecraft/server";
import type {
    Dimension,
    PlayerCancelBreakingBlockAfterEvent,
    PlayerStartBreakingBlockAfterEvent,
    Vector3
} from "@minecraft/server";
import { eventBus, guarded } from "../core/eventBus.js";
import { tickManager } from "../core/tickManager.js";
import { runCatching } from "../core/errorReporter.js";
import { BETA_PICKAXE_IDS, BETA_SWORD_IDS, SWORD_MINING_TICKS } from "../policy/betaRegistry.js";

export const SLOW_BLOCKS = new Set([
    "minecraft:redstone_ore",
    "minecraft:lit_redstone_ore"
]);

export const PICKAXES: ReadonlySet<string> = BETA_PICKAXE_IDS;

export const SWORDS: ReadonlySet<string> = BETA_SWORD_IDS;

const TICK_INTERVAL = 3;
const SWORD_TICK_INTERVAL = 1;
const MAX_DISTANCE = 5;

interface ToolBonus {
    readonly system: string;
    readonly effect: string;
    readonly duration: number;
    readonly amplifier: number;
    readonly tools: ReadonlySet<string>;
    readonly blocks: ReadonlySet<string>;
}

const REDSTONE_BONUS: ToolBonus = {
    system: "redstoneMining",
    effect: "mining_fatigue",
    duration: 10,
    amplifier: 1,
    tools: PICKAXES,
    blocks: SLOW_BLOCKS
};

const activeRedstone = new Set<string>();

// ticks counts the ticks the block spent under the sword; release, look-away or a new cell resets it.
interface SwordSwing {
    readonly dimensionId: string;
    readonly cell: Vector3;
    readonly blockTypeId: string;
    ticks: number;
}

const swordSwings = new Map<string, SwordSwing>();

function heldItemId(player: Player): string | undefined {
    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    return equippable?.getEquipment(EquipmentSlot.Mainhand)?.typeId;
}

function sameCell(a: Vector3, b: Vector3): boolean {
    return a.x === b.x && a.y === b.y && a.z === b.z;
}

function clearBonus(bonus: ToolBonus, active: Set<string>, player: Player): void {
    if (!active.delete(player.id)) return;
    runCatching(
        { system: bonus.system, operation: "clearEffect", target: player.id },
        () => player.removeEffect(bonus.effect)
    );
}

function applyBonusEffect(bonus: ToolBonus, active: Set<string>, player: Player): void {
    player.addEffect(bonus.effect, bonus.duration, {
        amplifier: bonus.amplifier,
        showParticles: false
    });
    active.add(player.id);
}

export function toolMiningJob(): void {
    for (const player of world.getAllPlayers()) {
        if (!player.isValid) continue;

        runCatching({ system: "toolMining", operation: "checkPlayer", target: player.id }, () => {
            const held = heldItemId(player);
            if (held === undefined || !PICKAXES.has(held)) {
                clearBonus(REDSTONE_BONUS, activeRedstone, player);
                return;
            }

            const blockRay = player.getBlockFromViewDirection({ maxDistance: MAX_DISTANCE });
            const hitBlockId = blockRay?.block?.typeId;

            if (hitBlockId !== undefined && SLOW_BLOCKS.has(hitBlockId)) {
                applyBonusEffect(REDSTONE_BONUS, activeRedstone, player);
            } else {
                clearBonus(REDSTONE_BONUS, activeRedstone, player);
            }
        });
    }
}

function trackSwing(event: PlayerStartBreakingBlockAfterEvent): void {
    const player = event.player;
    const block = event.block;

    // A creative break lands on the first tick, so there is nothing left for the clock to do.
    if (player.getGameMode() === GameMode.Creative) return;
    if (SWORD_MINING_TICKS.get(block.typeId) === undefined) return;

    const held = heldItemId(player);
    if (held === undefined || !SWORDS.has(held)) return;

    const cell = block.location;
    const current = swordSwings.get(player.id);
    if (
        current !== undefined &&
        current.blockTypeId === block.typeId &&
        sameCell(current.cell, cell)
    ) {
        return;
    }

    swordSwings.set(player.id, {
        dimensionId: block.dimension.id,
        cell: { x: cell.x, y: cell.y, z: cell.z },
        blockTypeId: block.typeId,
        ticks: 0
    });
}

function forgetSwing(event: PlayerCancelBreakingBlockAfterEvent): void {
    swordSwings.delete(event.player.id);
}

function breakSwordBlock(dimension: Dimension, swing: SwordSwing): void {
    const { x, y, z } = swing.cell;
    runCatching({ system: "swordMining", operation: "breakBlock", target: swing.blockTypeId }, () => {
        // No script API for destroy-with-loot, and hand-spawning drops would duplicate every loot rule.
        dimension.runCommand(`setblock ${x} ${y} ${z} air destroy`);
    });
}

export function swordMiningJob(): void {
    if (swordSwings.size === 0) return;

    const online = new Set<string>();
    for (const player of world.getAllPlayers()) {
        online.add(player.id);

        const swing = swordSwings.get(player.id);
        if (swing === undefined) continue;

        runCatching({ system: "swordMining", operation: "checkPlayer", target: player.id }, () => {
            if (!player.isValid) {
                swordSwings.delete(player.id);
                return;
            }

            const dimension = player.dimension;
            const held = heldItemId(player);
            if (held === undefined || !SWORDS.has(held) || dimension.id !== swing.dimensionId) {
                swordSwings.delete(player.id);
                return;
            }

            // Webs are passable, so only includePassableBlocks lets the raycast find the sword's fast block.
            const hit = player.getBlockFromViewDirection({
                maxDistance: MAX_DISTANCE,
                includePassableBlocks: true
            })?.block;
            if (
                hit === undefined ||
                hit.typeId !== swing.blockTypeId ||
                !sameCell(hit.location, swing.cell)
            ) {
                swordSwings.delete(player.id);
                return;
            }

            swing.ticks += 1;
            const target = SWORD_MINING_TICKS.get(swing.blockTypeId);
            if (target === undefined) {
                swordSwings.delete(player.id);
                return;
            }
            if (swing.ticks < target) return;

            swordSwings.delete(player.id);
            breakSwordBlock(dimension, swing);
        });
    }

    // A player who left mid-swing is gone from the roster but not from the table.
    if (swordSwings.size > 0) {
        for (const playerId of swordSwings.keys()) {
            if (!online.has(playerId)) swordSwings.delete(playerId);
        }
    }
}

tickManager.register("toolMining", TICK_INTERVAL, toolMiningJob, 0);
tickManager.register("swordMining", SWORD_TICK_INTERVAL, swordMiningJob, 2);

eventBus.onPlayerStartBreakingBlock(guarded({ system: "swordMining", operation: "trackSwing" }, trackSwing));
eventBus.onPlayerCancelBreakingBlock(forgetSwing);

// The engine's own break is the swing's other ending: once the block is gone the clock is moot.
eventBus.onPlayerBreakBlock((event) => {
    swordSwings.delete(event.player.id);
});

eventBus.onPlayerLeave((ev) => {
    activeRedstone.delete(ev.playerId);
    swordSwings.delete(ev.playerId);
});
