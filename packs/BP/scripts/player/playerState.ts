import {
    world,
    EquipmentSlot,
    EntityComponentTypes,
    EntityDamageCause,
    GameMode,
    HudElement,
    HudVisibility,
    Player
} from "@minecraft/server";
import type { Dimension } from "@minecraft/server";
import { tickManager } from "../core/tickManager.js";
import { eventBus } from "../core/eventBus.js";
import { reportError } from "../core/errorReporter.js";

const PLAYER_STATE_INTERVAL_TICKS = 2;
const LAVA_DAMAGE_INTERVAL_TICKS = 10;
const LAVA_DAMAGE_AMOUNT = 4;
const LAVA_FIRE_SECONDS = 15;

const SUPPRESSED_HUD_ELEMENTS = [
    HudElement.Hunger,
    HudElement.ProgressBar
];

const trackedHudPlayers = new Set<string>();
const lastLavaDamageTicks = new Map<string, number>();

function isLavaAt(dimension: Dimension, x: number, y: number, z: number): boolean {
    try {
        const block = dimension.getBlock({ x, y, z });
        return block !== undefined && (block.typeId === "minecraft:lava" || block.typeId === "minecraft:flowing_lava");
    } catch {
        return false;
    }
}

export function isPlayerSubmergedInLava(player: Player): boolean {
    const dimension = player.dimension;
    if (!dimension) return false;

    const loc = player.location;
    if (isLavaAt(dimension, Math.floor(loc.x), Math.floor(loc.y), Math.floor(loc.z))) {
        return true;
    }

    const head = player.getHeadLocation();
    if (isLavaAt(dimension, Math.floor(head.x), Math.floor(head.y), Math.floor(head.z))) {
        return true;
    }

    return false;
}

export function checkLavaDamageWatchdog(player: Player, currentTick: number): void {
    const mode = typeof player.getGameMode === "function" ? player.getGameMode() : undefined;
    if (mode !== GameMode.Survival && mode !== GameMode.Adventure) {
        return;
    }

    if (!isPlayerSubmergedInLava(player)) {
        return;
    }

    const lastTick = lastLavaDamageTicks.get(player.id);
    if (lastTick !== undefined && currentTick >= lastTick && (currentTick - lastTick) < LAVA_DAMAGE_INTERVAL_TICKS) {
        return;
    }

    lastLavaDamageTicks.set(player.id, currentTick);
    player.applyDamage(LAVA_DAMAGE_AMOUNT, { cause: EntityDamageCause.lava });
    if (player.isValid) {
        player.setOnFire(LAVA_FIRE_SECONDS, false);
    }
}

export function suppressPostBetaHudElements(player: Player): void {
    if (!player.isValid) return;
    try {
        if (typeof player.onScreenDisplay?.setHudVisibility === "function") {
            player.onScreenDisplay.setHudVisibility(HudVisibility.Hide, SUPPRESSED_HUD_ELEMENTS);
        }
    } catch (e) {
        reportError({
            system: "playerState",
            operation: "suppressPostBetaHudElements",
            target: player.name
        }, e);
    }
}

export function ensurePlayerHudState(player: Player): void {
    if (trackedHudPlayers.has(player.id)) return;
    trackedHudPlayers.add(player.id);
    suppressPostBetaHudElements(player);
}

eventBus.onEntityHurt((ev) => {
    const hurtEntity = ev.hurtEntity;
    if (!(hurtEntity instanceof Player)) return;
    if (ev.damageSource?.cause === EntityDamageCause.lava) {
        lastLavaDamageTicks.set(hurtEntity.id, tickManager.getCurrentTick());
    }
});

eventBus.onPlayerSpawn((ev) => {
    if (ev.player) {
        trackedHudPlayers.delete(ev.player.id);
        lastLavaDamageTicks.delete(ev.player.id);
        ensurePlayerHudState(ev.player);
    }
});

eventBus.onPlayerDimensionChange((ev) => {
    if (ev.player) {
        trackedHudPlayers.delete(ev.player.id);
        ensurePlayerHudState(ev.player);
    }
});

eventBus.onPlayerLeave((ev) => {
    trackedHudPlayers.delete(ev.playerId);
    lastLavaDamageTicks.delete(ev.playerId);
});

export function playerStateJob(): void {
    const players = world.getAllPlayers();
    const currentTick = tickManager.getCurrentTick();

    for (const player of players) {
        if (!player.isValid) continue;

        try {
            ensurePlayerHudState(player);

            if (player.level > 0 || player.xpEarnedAtCurrentLevel > 0) {
                player.resetLevel();
            }

            checkLavaDamageWatchdog(player, currentTick);

            const equippable = player.getComponent(EntityComponentTypes.Equippable);
            if (!equippable) continue;

            const offhandItem = equippable.getEquipment(EquipmentSlot.Offhand);

            if (offhandItem) {
                equippable.setEquipment(EquipmentSlot.Offhand, undefined);

                const invComp = player.getComponent(EntityComponentTypes.Inventory);
                const inv = invComp?.container;
                if (inv) {
                    const leftover = inv.addItem(offhandItem);
                    if (leftover) {
                        player.dimension.spawnItem(leftover, player.location);
                    }
                } else {
                    player.dimension.spawnItem(offhandItem, player.location);
                }
            }
        } catch (e) {
            reportError({
                system: "playerState",
                operation: "processPlayerState",
                target: player.name
            }, e);
        }
    }
}

tickManager.register("playerState", PLAYER_STATE_INTERVAL_TICKS, playerStateJob, 1);

