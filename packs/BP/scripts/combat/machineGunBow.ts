import {
    ItemStack,
    Player,
    EntityComponentTypes,
    system
} from "@minecraft/server";
import type { Container } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { reportError } from "../core/errorReporter.js";
import { BH_BOW_ID } from "../core/betaRegistry.js";
import { getPrivilegeReason } from "../core/permissions.js";

const CONFIG = Object.freeze({
    FIRE_COOLDOWN: 2,
    HOLD_FIRE_RATE: 3
});

const lastFireTime = new Map<string, number>();
const holdIntervals = new Map<string, number>();

function takeArrowFrom(inv: Container): boolean {
    const size = inv.size;
    for (let i = 0; i < size; i++) {
        const slotItem = inv.getItem(i);
        if (slotItem?.typeId !== "minecraft:arrow") continue;

        if (slotItem.amount > 1) {
            inv.setItem(i, new ItemStack("minecraft:arrow", slotItem.amount - 1));
        } else {
            inv.setItem(i, undefined);
        }
        return true;
    }

    return false;
}

/** The hold loop outlives the event that started it, so the held item is re-read from the engine. */
function holdingBetaBow(player: Player): boolean {
    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container;
    return inv?.getItem(player.selectedSlotIndex)?.typeId === BH_BOW_ID;
}

// A spent cooldown, an empty quiver and a mob's own projectile are ordinary outcomes of holding the
// bow and go unreported; only a failure the player never asked for is reported.
function fireArrow(player: Player): void {
    const now = system.currentTick;
    const lastFire = lastFireTime.get(player.id) ?? 0;

    if (now - lastFire < CONFIG.FIRE_COOLDOWN) return;

    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container;
    if (!inv) {
        // Stamped as well, so a broken container cannot turn the hold loop into a log flood.
        lastFireTime.set(player.id, now);
        reportError(
            { system: "machineGunBow", operation: "fireArrow", target: player.name },
            "player has no inventory container"
        );
        return;
    }

    // Creative fires without spending arrows; the builder tag buys an inventory sweep, not a cost.
    const freeArrows = getPrivilegeReason(player) === "creative";
    if (!freeArrows && !takeArrowFrom(inv)) return;

    // Stamped on the firing path only: a shot the guards refused must not spend the cooldown the
    // next legal shot needs.
    lastFireTime.set(player.id, now);

    const dir = player.getViewDirection();
    const head = player.getHeadLocation();
    const spawnPos = {
        x: head.x + dir.x * 1.5,
        y: head.y + dir.y * 1.5,
        z: head.z + dir.z * 1.5
    };

    try {
        const arrow = player.dimension.spawnEntity("minecraft:arrow", spawnPos);
        const proj = arrow.getComponent(EntityComponentTypes.Projectile);
        if (proj) {
            proj.owner = player;
            proj.shoot({ x: dir.x * 3.0, y: dir.y * 3.0, z: dir.z * 3.0 }, { uncertainty: 1.0 });
        }

        player.playSound("random.bow", {
            volume: 0.5,
            pitch: 1.0 + Math.random() * 0.3
        });
    } catch (e) {
        reportError({ system: "machineGunBow", operation: "spawnArrow", target: player.name }, e);
    }
}

function stopHoldFiring(playerId: string): void {
    const interval = holdIntervals.get(playerId);
    if (interval !== undefined) {
        system.clearRun(interval);
        holdIntervals.delete(playerId);
    }
}

eventBus.onItemUseAfter((ev) => {
    const player = ev.source;
    const item = ev.itemStack;

    if (!(player instanceof Player)) return;
    if (item?.typeId !== BH_BOW_ID) return;
    fireArrow(player);
});

eventBus.onItemStartUse((ev) => {
    const player = ev.source;
    const item = ev.itemStack;

    if (!(player instanceof Player)) return;
    if (item?.typeId !== BH_BOW_ID) return;

    stopHoldFiring(player.id);

    const intervalId = system.runInterval(() => {
        try {
            if (!player.isValid || !holdingBetaBow(player)) {
                stopHoldFiring(player.id);
                return;
            }

            fireArrow(player);
        } catch (e) {
            // The loop stops on the way out, so the reason it stopped is worth a report.
            reportError({ system: "machineGunBow", operation: "holdFire", target: player.name }, e);
            stopHoldFiring(player.id);
        }
    }, CONFIG.HOLD_FIRE_RATE);

    holdIntervals.set(player.id, intervalId);
});

eventBus.onItemStopUse((ev) => {
    const player = ev.source;
    if (player instanceof Player) {
        stopHoldFiring(player.id);
    }
});

eventBus.onItemReleaseUse((ev) => {
    const player = ev.source;
    if (player instanceof Player) {
        stopHoldFiring(player.id);
    }
});

eventBus.onPlayerLeave((ev) => {
    lastFireTime.delete(ev.playerId);
    stopHoldFiring(ev.playerId);
});
