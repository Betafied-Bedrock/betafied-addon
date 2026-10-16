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

function clearBonus(bonus: ToolBonus, active: Set<string>, player: Player): void {
    if (!active.delete(player.id)) return;
    runCatching(
        { system: bonus.system, operation: "clearEffect", target: player.id },
        () => player.removeEffect(bonus.effect)
    );
}

function applyBonus(bonus: ToolBonus, active: Set<string>, player: Player): void {
    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    const mainhand = equippable?.getEquipment(EquipmentSlot.Mainhand);

    if (!mainhand || !bonus.tools.has(mainhand.typeId)) {
        clearBonus(bonus, active, player);
        return;
    }

    const blockRay = player.getBlockFromViewDirection({ maxDistance: MAX_DISTANCE });

    if (blockRay?.block && bonus.blocks.has(blockRay.block.typeId)) {
        player.addEffect(bonus.effect, bonus.duration, {
            amplifier: bonus.amplifier,
            showParticles: false
        });
        active.add(player.id);
        return;
    }

    clearBonus(bonus, active, player);
}

function watchTool(bonus: ToolBonus): void {
    const active = new Set<string>();

    tickManager.register(bonus.system, TICK_INTERVAL, () => {
        for (const player of world.getAllPlayers()) {
            if (!player.isValid) continue;

            runCatching({ system: bonus.system, operation: "checkPlayer", target: player.id }, () =>
                applyBonus(bonus, active, player)
            );
        }
    }, 0);

    eventBus.onPlayerLeave((ev) => {
        active.delete(ev.playerId);
    });
}

watchTool({
    system: "redstoneMining",
    effect: "mining_fatigue",
    duration: 10,
    amplifier: 1,
    tools: PICKAXES,
    blocks: SLOW_BLOCKS
});

watchTool({
    system: "swordMining",
    effect: "haste",
    duration: 10,
    amplifier: 2,
    tools: SWORDS,
    blocks: SWORD_FAST_BLOCKS
});
