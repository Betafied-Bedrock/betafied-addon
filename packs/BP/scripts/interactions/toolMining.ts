import { world, Player, EquipmentSlot, EntityComponentTypes } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { tickManager } from "../core/tickManager.js";
import { runCatching } from "../core/errorReporter.js";
import { BETA_PICKAXE_IDS, BETA_SWORD_IDS, WOOL_BY_COLOR } from "../policy/betaRegistry.js";

export const SLOW_BLOCKS = new Set([
    "minecraft:redstone_ore",
    "minecraft:lit_redstone_ore"
]);

export const PICKAXES: ReadonlySet<string> = BETA_PICKAXE_IDS;

export const SWORD_FAST_BLOCKS = new Set([
    "minecraft:cobweb",
    "minecraft:oak_leaves", "minecraft:spruce_leaves", "minecraft:birch_leaves",
    "minecraft:oak_planks", "minecraft:spruce_planks", "minecraft:birch_planks",
    "minecraft:planks",
    "minecraft:oak_stairs",
    "bh:oak_stairs",
    "minecraft:pumpkin", "minecraft:carved_pumpkin", "minecraft:lit_pumpkin",
    ...WOOL_BY_COLOR
]);

export const SWORDS: ReadonlySet<string> = BETA_SWORD_IDS;

const TICK_INTERVAL = 3;
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

const SWORD_BONUS: ToolBonus = {
    system: "swordMining",
    effect: "haste",
    duration: 10,
    amplifier: 2,
    tools: SWORDS,
    blocks: SWORD_FAST_BLOCKS
};

const activeRedstone = new Set<string>();
const activeSword = new Set<string>();

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
            const equippable = player.getComponent(EntityComponentTypes.Equippable);
            const mainhand = equippable?.getEquipment(EquipmentSlot.Mainhand);
            const mainhandId = mainhand?.typeId;

            const isPickaxe = mainhandId !== undefined && PICKAXES.has(mainhandId);
            const isSword = mainhandId !== undefined && SWORDS.has(mainhandId);

            if (!isPickaxe) {
                clearBonus(REDSTONE_BONUS, activeRedstone, player);
            }
            if (!isSword) {
                clearBonus(SWORD_BONUS, activeSword, player);
            }

            if (!isPickaxe && !isSword) {
                return;
            }

            const blockRay = player.getBlockFromViewDirection({ maxDistance: MAX_DISTANCE });
            const hitBlockId = blockRay?.block?.typeId;

            if (isPickaxe) {
                if (hitBlockId !== undefined && SLOW_BLOCKS.has(hitBlockId)) {
                    applyBonusEffect(REDSTONE_BONUS, activeRedstone, player);
                } else {
                    clearBonus(REDSTONE_BONUS, activeRedstone, player);
                }
            }

            if (isSword) {
                if (hitBlockId !== undefined && SWORD_FAST_BLOCKS.has(hitBlockId)) {
                    applyBonusEffect(SWORD_BONUS, activeSword, player);
                } else {
                    clearBonus(SWORD_BONUS, activeSword, player);
                }
            }
        });
    }
}

tickManager.register("toolMining", TICK_INTERVAL, toolMiningJob, 0);

eventBus.onPlayerLeave((ev) => {
    activeRedstone.delete(ev.playerId);
    activeSword.delete(ev.playerId);
});

