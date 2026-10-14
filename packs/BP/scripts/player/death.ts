import {
    EntityComponentTypes,
    EquipmentSlot,
    GameMode,
    InputPermissionCategory,
    ItemStack,
    Player,
    system,
    world
} from "@minecraft/server";
import { ARMOR_SLOTS } from "../core/equipmentSlots.js";
import { damageArmor } from "../combat/armor.js";
import { eventBus } from "../core/eventBus.js";
import { teleportQuietly } from "../core/quietTeleport.js";
import { tickManager } from "../core/tickManager.js";
import { reportError, runCatching } from "../core/errorReporter.js";
import {
    dismissDeathScreen,
    isDeathScreenPending,
    showDeathScreen
} from "./deathScreen.js";
import type { DeathScreenHandlers } from "./deathScreen.js";

export const DEAD_PROPERTY = "bh:dead";
export const PRE_DEATH_GAMEMODE_PROPERTY = "bh:pre_death_gamemode";

export const LOCKED_INPUT_CATEGORIES: readonly InputPermissionCategory[] = Object.freeze([
    InputPermissionCategory.Movement,
    InputPermissionCategory.LateralMovement,
    InputPermissionCategory.Jump,
    InputPermissionCategory.Sneak,
    InputPermissionCategory.MoveForward,
    InputPermissionCategory.MoveBackward,
    InputPermissionCategory.MoveLeft,
    InputPermissionCategory.MoveRight
]);

const DROP_SCATTER_RADIUS = 2;
const DROP_SPAWN_HEIGHT = 1.44;
const RESPAWN_ROTATION = { x: 0, y: 0 };
const DEATH_FLOP_ANIMATION = "animation.player.death_flop";
const DEATH_FLOP_RESET_ANIMATION = "animation.player.death_flop_reset";
const DEATH_PUFF_PARTICLE = "minecraft:basic_smoke_particle";
const DEATH_PUFF_COUNT = 20;
const DEATH_PUFF_DELAY_TICKS = 21;
const PLAYER_WIDTH = 0.6;
const PLAYER_HEIGHT = 1.8;
const BASE_FOV = 70;
const FOV_DEADBAND = 0.5;

const deathFov = new Map<string, { startedAt: number; sent: number }>();

export function isDead(player: Player): boolean {
    return player.getDynamicProperty(DEAD_PROPERTY) === true;
}

function throwStack(player: Player, stack: ItemStack): void {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 0.5;
    const { x, y, z } = player.location;
    const distance = Math.sqrt(Math.random()) * DROP_SCATTER_RADIUS;

    const dropped = player.dimension.spawnItem(stack, {
        x: x + Math.cos(angle) * distance,
        y: y + DROP_SPAWN_HEIGHT,
        z: z + Math.sin(angle) * distance
    });
    dropped?.applyImpulse({
        x: -Math.sin(angle) * speed,
        y: 0.2,
        z: Math.cos(angle) * speed
    });
}

function setMovementLocked(player: Player, locked: boolean): void {
    for (const category of LOCKED_INPUT_CATEGORIES) {
        if (player.inputPermissions.isPermissionCategoryEnabled(category) === locked) {
            player.inputPermissions.setPermissionCategory(category, !locked);
        }
    }
}

function dropMainInventory(player: Player): void {
    const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
    if (!container) return;

    for (let slot = 0; slot < container.size; slot += 1) {
        const stack = container.getItem(slot);
        if (!stack) continue;

        container.setItem(slot, undefined);
        throwStack(player, stack);
    }
}

function dropWornEquipment(player: Player): void {
    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    if (!equippable) return;

    for (const slot of [...ARMOR_SLOTS, EquipmentSlot.Offhand]) {
        const stack = equippable.getEquipment(slot);
        if (!stack) continue;

        equippable.setEquipment(slot, undefined);
        throwStack(player, stack);
    }
}

function playDeathSound(player: Player): void {
    const pitch = (Math.random() - Math.random()) * 0.2 + 1;
    player.dimension.playSound("random.hurt", player.location, { volume: 1, pitch });
}

/**
 * `EntityLiving.tick` scatters twenty `explode` particles through the entity's box on the tick
 * `deathTime` passes 20, and removes it in the same pass (`EntityLiving.java:152-167`). Its client
 * player has already shrunk to a 0.2 box by then (`EntityPlayer.onDeath`), which is smaller than the
 * corpse being marked, so this scatters through the era's standing player box instead.
 */
function puffDeathCorpse(player: Player): void {
    const { x, y, z } = player.location;
    const dimension = player.dimension;

    for (let i = 0; i < DEATH_PUFF_COUNT; i++) {
        dimension.spawnParticle(DEATH_PUFF_PARTICLE, {
            x: x + Math.random() * PLAYER_WIDTH * 2 - PLAYER_WIDTH,
            y: y + Math.random() * PLAYER_HEIGHT,
            z: z + Math.random() * PLAYER_WIDTH * 2 - PLAYER_WIDTH
        });
    }
}

/**
 * `RenderLiving.rotateCorpse` turns a corpse `getDeathMaxRotation` degrees about Z over its first ~0.7s
 * (`RenderLiving.java:120-132`; 90 for a player, which `RenderPlayer` does not override for a dead one).
 * The animation carries the era's sqrt curve on the entity's `root` bone, whose pivot is the origin the
 * era rotated around. The puff follows the flop because the era removes the body as it puffs.
 */
function playDeathFlop(player: Player): void {
    runCatching({ system: "death", operation: "playDeathFlop", target: player.name }, () => {
        player.playAnimation(DEATH_FLOP_ANIMATION);
    });

    system.runTimeout(() => {
        if (!player.isValid || !isDead(player)) return;
        runCatching({ system: "death", operation: "puffDeathCorpse", target: player.name }, () => {
            puffDeathCorpse(player);
        });
    }, DEATH_PUFF_DELAY_TICKS);
}

function standCorpseBackUp(player: Player): void {
    runCatching({ system: "death", operation: "resetDeathFlop", target: player.name }, () => {
        player.playAnimation(DEATH_FLOP_RESET_ANIMATION);
    });
}

export function enterDeathState(player: Player): void {
    if (!player.isValid) return;
    if (isDead(player)) return;

    try {
        player.setDynamicProperty(PRE_DEATH_GAMEMODE_PROPERTY, player.getGameMode());
        player.setDynamicProperty(DEAD_PROPERTY, true);

        player.setGameMode(GameMode.Spectator);
        setMovementLocked(player, true);
        playDeathSound(player);
        showDeathScreen(player, DEATH_SCREEN_HANDLERS);
        playDeathFlop(player);

        damageArmor(player);
        dropMainInventory(player);
        dropWornEquipment(player);
    } catch (e) {
        reportError({ system: "death", operation: "enterDeathState", target: player.name }, e);
    }
}

export function respawnPlayer(player: Player): void {
    if (!player.isValid) return;

    try {
        const remembered = player.getDynamicProperty(PRE_DEATH_GAMEMODE_PROPERTY);

        player.setDynamicProperty(DEAD_PROPERTY, undefined);
        player.setDynamicProperty(PRE_DEATH_GAMEMODE_PROPERTY, undefined);

        dismissDeathScreen(player);

        const spawnPoint = player.getSpawnPoint();
        const location = spawnPoint ?? world.getDefaultSpawnLocation();
        const dimension = spawnPoint?.dimension ?? world.getDimension("overworld");

        teleportQuietly(player, { x: location.x, y: location.y, z: location.z }, {
            dimension,
            rotation: RESPAWN_ROTATION
        });

        player.setRotation(RESPAWN_ROTATION);
        standCorpseBackUp(player);
        setMovementLocked(player, false);

        const mode = typeof remembered === "string" ? (remembered as GameMode) : GameMode.Survival;
        player.setGameMode(mode === GameMode.Spectator ? GameMode.Survival : mode);

        player.getComponent(EntityComponentTypes.Health)?.resetToMaxValue();

        deathFov.delete(player.id);
        runCatching({ system: "death", operation: "releaseCamera", target: player.name }, () => {
            player.camera.clear();
        });
    } catch (e) {
        reportError({ system: "death", operation: "respawnPlayer", target: player.name }, e);
    }
}

function assertDeathFov(player: Player): void {
    const now = tickManager.getCurrentTick();
    const state = deathFov.get(player.id);

    if (!state) {
        deathFov.set(player.id, { startedAt: now, sent: BASE_FOV });
        return;
    }

    const fov = BASE_FOV / ((1 - 500 / (now - state.startedAt + 500)) * 2 + 1);
    if (Math.abs(fov - state.sent) < FOV_DEADBAND) return;

    state.sent = fov;
    player.camera.setFov({ fov });
}

export function assertDeathState(player: Player): void {
    if (!player.isValid) return;
    if (!isDead(player)) return;

    if (player.getGameMode() !== GameMode.Spectator) {
        player.setGameMode(GameMode.Spectator);
    }

    setMovementLocked(player, true);
    assertDeathFov(player);
}

const DEATH_VERDICT_PRIORITY = 100;

eventBus.onEntityHurtBefore((ev) => {
    const player = ev.hurtEntity;
    if (!(player instanceof Player)) return;
    if (!player.isValid) return;
    if (isDead(player)) return;

    const health = player.getComponent(EntityComponentTypes.Health);
    if (!health || health.currentValue > 0) return;

    ev.cancel = true;
    system.run(() => enterDeathState(player));
}, DEATH_VERDICT_PRIORITY);

// No API returns a player to the title screen, so the era's second button takes the same way out as
// the first rather than leaving a dead player holding a button that does nothing.
const DEATH_SCREEN_HANDLERS: DeathScreenHandlers = {
    onRespawn: (player) => respawnPlayer(player),
    onTitleMenu: (player) => respawnPlayer(player)
};

tickManager.register("deathState", 2, () => {
    for (const player of world.getAllPlayers()) {
        assertDeathState(player);

        if (isDead(player) && !isDeathScreenPending(player.id)) {
            showDeathScreen(player, DEATH_SCREEN_HANDLERS);
        }
    }
});

eventBus.onPlayerSpawn((ev) => {
    if (!ev.initialSpawn) return;
    if (!ev.player) return;

    system.run(() => assertDeathState(ev.player));
});

eventBus.onPlayerLeave((ev) => {
    deathFov.delete(ev.playerId);
});

eventBus.onEntityDie((ev) => {
    const dead = ev.deadEntity;
    if (!(dead instanceof Player)) return;

    // Tripwire: entityDie indicates a lethal path bypassed before-hurt interception.
    reportError({
        system: "death",
        operation: `uninterceptedPlayerDeath:${ev.damageSource.cause}`,
        target: dead.name
    }, "player death bypassed the before-hurt interception");
});

