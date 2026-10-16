import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    Player,
    ItemStack,
    EquipmentSlot,
    EntityComponentTypes,
    GameMode,
    InputPermissionCategory,
    commandFeedbackWrites,
    mockPlayers,
    mockSpawnedItems,
    resetMocks,
    scheduledTimeouts,
    world
} from "../mocks/minecraftServer.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { TELEPORT_DELAY_TICKS } from "../../packs/BP/scripts/core/quietTeleport.js";
import { tickManager } from "../../packs/BP/scripts/core/tickManager.js";
import {
    closedFormPlayers,
    FormCancelationReason,
    formsShown,
    resetUiMocks,
    setNextFormOutcome
} from "../mocks/minecraftServerUi.js";
import {
    DEAD_PROPERTY,
    LOCKED_INPUT_CATEGORIES,
    PRE_DEATH_GAMEMODE_PROPERTY,
    isDead,
    enterDeathState,
    respawnPlayer
} from "../../packs/BP/scripts/player/death.js";
import {
    dismissDeathScreen,
    isDeathScreenPending,
    showDeathScreen
} from "../../packs/BP/scripts/player/deathScreen.js";

const capturedErrors: string[] = [];
console.warn = (...args: unknown[]) => {
    capturedErrors.push(args.map(String).join(" "));
};

let playerSequence = 0;

function makeHarness() {
    resetMocks();
    resetUiMocks();
    capturedErrors.length = 0;

    playerSequence += 1;
    const player = new Player(`death_player_${playerSequence}`, "fyreic");
    player.location = { x: 4, y: 70, z: -9 };
    mockPlayers.push(player);

    const slots = new Map<number, any>();
    const container = {
        size: 36,
        getItem: (slot: number) => slots.get(slot),
        setItem: (slot: number, item: any) => {
            if (!item) slots.delete(slot);
            else slots.set(slot, item);
        }
    };

    const worn = new Map<any, any>();
    const equippable = {
        getEquipment: (slot: any) => worn.get(slot),
        setEquipment: (slot: any, item: any) => {
            if (!item) worn.delete(slot);
            else worn.set(slot, item);
            return true;
        }
    };

    const health = {
        currentValue: 12,
        effectiveMax: 20,
        resetToMaxValue() {
            this.currentValue = this.effectiveMax;
        }
    };

    player.setComponent(EntityComponentTypes.Inventory, { container });
    player.setComponent(EntityComponentTypes.Equippable, equippable);
    player.setComponent(EntityComponentTypes.Health, health);

    return { player, container, equippable, health };
}

function drainForm(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

function makeHandlers() {
    const respawned: Player[] = [];
    const titled: Player[] = [];

    return {
        respawned,
        titled,
        handlers: {
            onRespawn: (player: Player) => respawned.push(player),
            onTitleMenu: (player: Player) => titled.push(player)
        }
    };
}

function drainDeferred(): void {
    const due = scheduledTimeouts.splice(0, scheduledTimeouts.length);
    for (const item of due) {
        item.callback();
    }
}

/** The respawn's move follows the mute by the helper's delay, so reading a position means running that work. */
function drainNextTick(): void {
    const due = scheduledTimeouts.filter(entry => entry.timeout === TELEPORT_DELAY_TICKS);
    for (const item of due) {
        scheduledTimeouts.splice(scheduledTimeouts.indexOf(item), 1);
    }
    for (const item of due) {
        item.callback();
    }
}

function runTicks(count: number): void {
    for (let tick = 0; tick < count; tick += 1) {
        tickManager.step();
    }
}

function runDeathStatePass(): void {
    runTicks(20);
}

/** What the first join records, so a bed-less respawn has somewhere real to land. */
const WORLD_SPAWN_PROPERTY = "betafied:world_spawn";

function joinWorld(player: Player): void {
    eventBus.dispatch("playerSpawn", { player, initialSpawn: true });
    drainDeferred();
}

function hurtEvent(player: Player, damage: number) {
    return { cancel: false, damage, hurtEntity: player, damageSource: { cause: "entityAttack" } } as any;
}

describe("Player death state machine", () => {
    it("spills every occupied slot and the worn armor out of the corpse, scattered around it, exactly once", () => {
        const { player, container, equippable, health } = makeHarness();
        for (let slot = 0; slot < 12; slot += 1) {
            container.setItem(slot, new ItemStack("bh:apple", 1));
        }
        equippable.setEquipment(EquipmentSlot.Head, new ItemStack("minecraft:iron_helmet", 1));

        enterDeathState(player);

        assert.equal(container.getItem(0), undefined, "the corpse keeps nothing");
        assert.equal(equippable.getEquipment(EquipmentSlot.Head), undefined);
        assert.equal(mockSpawnedItems.length, 13, "one drop per stack, plus the helmet");

        const offsets = mockSpawnedItems.map(item => ({
            dx: item.location.x - player.location.x,
            dz: item.location.z - player.location.z
        }));

        for (const { dx, dz } of offsets) {
            const distance = Math.hypot(dx, dz);
            assert.ok(
                distance <= 2,
                `a stack spawned ${distance.toFixed(2)} blocks out, past the scatter radius`
            );
        }

        const distinct = new Set(offsets.map(({ dx, dz }) => `${dx.toFixed(4)},${dz.toFixed(4)}`));
        assert.ok(distinct.size > 1, "the drops must be spread around the player, not piled on one point");

        assert.equal(mockSpawnedItems[0].location.y, player.location.y + 1.44, "the era throws from chest height");

        const impulse = mockSpawnedItems[0].impulse as { x: number; y: number; z: number };
        assert.equal(impulse.y, 0.2, "the era's throw always kicks upward by 0.2");
        assert.ok(
            Math.hypot(impulse.x, impulse.z) <= 0.5,
            `horizontal throw must stay within 0.5, got ${Math.hypot(impulse.x, impulse.z)}`
        );

        enterDeathState(player);

        assert.equal(mockSpawnedItems.length, 13, "a second death state must not drop the inventory again");

        health.currentValue = 0;
        const event = hurtEvent(player, 5);
        eventBus.dispatch("entityHurtBefore", event);

        assert.equal(event.cancel, false, "a dead player's hits are the engine's business again");
        assert.equal(mockSpawnedItems.length, 13);
    });

    it("marks the player dead, remembers their mode, and parks them", () => {
        const { player } = makeHarness();

        enterDeathState(player);

        assert.equal(player.getDynamicProperty(DEAD_PROPERTY), true);
        assert.equal(player.getDynamicProperty(PRE_DEATH_GAMEMODE_PROPERTY), GameMode.Survival);
        assert.equal(player.getGameMode(), GameMode.Spectator);
        assert.deepEqual(
            LOCKED_INPUT_CATEGORIES.filter(c => player.inputPermissions.isPermissionCategoryEnabled(c)),
            [],
            "spectator alone still flies: every movement category must be denied"
        );
        assert.equal(player.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Camera), true);
    });

    it("respawns with full health, the mode they died in, a clean facing and the controls handed back, without announcing the move", () => {
        const { player, container, health } = makeHarness();
        container.setItem(0, new ItemStack("bh:apple", 1));

        enterDeathState(player);
        player.spawnPoint = { dimension: player.dimension, x: 10, y: 64, z: -20 };
        player.setRotation({ x: 45, y: 137 });

        respawnPlayer(player);

        assert.equal(player.getDynamicProperty(DEAD_PROPERTY), undefined);
        assert.equal(player.getDynamicProperty(PRE_DEATH_GAMEMODE_PROPERTY), undefined);
        assert.equal(player.getGameMode(), GameMode.Survival);
        assert.deepEqual(commandFeedbackWrites, [false], "the respawn must mute the engine's announcement");

        drainNextTick();

        assert.deepEqual(player.location, { x: 10, y: 64, z: -20 });
        assert.equal(health.currentValue, health.effectiveMax, "a respawn hands back full health");
        assert.deepEqual(player.getRotation(), { x: 0, y: 0 }, "a corpse's view must not be inherited");
        assert.deepEqual(
            LOCKED_INPUT_CATEGORIES.filter(c => !player.inputPermissions.isPermissionCategoryEnabled(c)),
            [],
            "respawn must hand movement back"
        );
        assert.deepEqual(closedFormPlayers, [player.id]);

        drainDeferred();

        assert.deepEqual(commandFeedbackWrites, [false, true], "and put the gamerule back afterwards");

        player.setGameMode(GameMode.Creative);
        enterDeathState(player);
        respawnPlayer(player);

        assert.equal(player.getGameMode(), GameMode.Creative, "a Creative death must hand back Creative");
    });

    it("sends a corpse to its bed, else to the world spawn the first join recorded, else leaves it where it fell", () => {
        const { player } = makeHarness();
        player.location = { x: 4, y: 70, z: -9 };
        joinWorld(player);

        player.spawnPoint = { dimension: player.dimension, x: 10, y: 64, z: -20 };
        player.location = { x: 900, y: 12, z: 900 };
        enterDeathState(player);
        respawnPlayer(player);
        drainNextTick();

        assert.deepEqual(player.location, { x: 10, y: 64, z: -20 }, "a player who slept gets their bed");

        const later = new Player("death_player_later", "alex");
        later.location = { x: 900, y: 64, z: 900 };
        mockPlayers.push(later);
        joinWorld(later);

        assert.deepEqual(
            world.getDynamicProperty(WORLD_SPAWN_PROPERTY),
            { x: 4, y: 70, z: -9 },
            "the world spawn is the first join's, not the latest one's"
        );

        enterDeathState(later);
        respawnPlayer(later);
        drainNextTick();

        assert.deepEqual(later.location, { x: 4, y: 70, z: -9 }, "a bed-less player lands at the world spawn");

        // A save the void bug parked above the world cannot be anybody's spawn.
        const { player: stranded } = makeHarness();
        stranded.location = { x: 0, y: 32767, z: 0 };
        joinWorld(stranded);

        assert.equal(
            world.getDynamicProperty(WORLD_SPAWN_PROPERTY),
            undefined,
            "a save parked above the world is not a world spawn"
        );

        stranded.location = { x: 4, y: 70, z: -9 };
        enterDeathState(stranded);
        respawnPlayer(stranded);
        drainNextTick();

        assert.deepEqual(
            stranded.location,
            { x: 4, y: 70, z: -9 },
            "with no world spawn to move to, the player stays where they died rather than above the world"
        );
        assert.equal(stranded.getGameMode(), GameMode.Survival, "and the respawn still hands the player back");
    });

    it("flops the corpse over and plays the era's death sound, then stands it back up on respawn", () => {
        const { player } = makeHarness();

        enterDeathState(player);

        assert.deepEqual(
            player.animationsPlayed.map(entry => entry.animationName),
            ["animation.player.death_flop"],
            "the era turns a dead body about Z, so the death has to take it off its feet"
        );

        const played = player.dimension.soundsPlayed;
        assert.equal(played.length, 1, "one death, one sound");
        assert.equal(played[0].soundId, "random.hurt", "the player inherits the era's death sound");
        assert.deepEqual(played[0].location, player.location, "played at the corpse, for everyone nearby");
        const pitch = played[0].options.pitch;
        assert.ok(
            pitch >= 0.8 && pitch <= 1.2,
            `the era's pitch jitter lands in [0.8, 1.2], got ${pitch}`
        );

        respawnPlayer(player);

        assert.ok(
            player.animationsPlayed.some(entry => entry.animationName === "animation.player.death_flop_reset"),
            "and a respawn has to undo it, because the era deletes its corpse rather than reviving it"
        );
    });

    it("puffs smoke through the corpse once the era would have removed it, and narrows the view on the era's curve", () => {
        const { player } = makeHarness();
        player.location = { x: 4, y: 70, z: -9 };

        runTicks(40);
        assert.deepEqual(player.camera.fovWrites, [], "only a dead player gets the death zoom");

        enterDeathState(player);

        assert.equal(player.dimension.particles.length, 0, "nothing puffs while the body is still falling");
        assert.ok(
            scheduledTimeouts.some(entry => entry.timeout === 21),
            "the puff waits for the tick the era's deathTime passes 20"
        );

        runTicks(200);

        const written = player.camera.fovWrites;
        assert.ok(written.length > 0, "a death must move the field of view");
        assert.ok(
            Math.abs(written.at(-1) - 44.55) < 0.7,
            `expected the era's 44.55 at t = 200, wrote ${written.at(-1)}`
        );
        assert.ok(
            written.every((fov, index) => index === 0 || fov < written[index - 1]),
            "the curve only ever narrows"
        );

        drainDeferred();

        const puffs = player.dimension.particles;
        assert.equal(puffs.length, 20, "twenty particles, as EntityLiving.tick scatters");

        for (const puff of puffs) {
            assert.equal(puff.effectName, "minecraft:basic_smoke_particle");
            assert.ok(puff.location.x >= 4 - 0.6 && puff.location.x <= 4 + 0.6, "x stays inside the player's box");
            assert.ok(puff.location.y >= 70 && puff.location.y <= 70 + 1.8, "y stays inside the player's box");
            assert.ok(puff.location.z >= -9 - 0.6 && puff.location.z <= -9 + 0.6, "z stays inside the player's box");
        }

        respawnPlayer(player);

        assert.equal(player.camera.clears, 1, "respawn is the one path that hands the view back");

        const writesAtRespawn = player.camera.fovWrites.length;
        runTicks(40);
        assert.equal(
            player.camera.fovWrites.length,
            writesAtRespawn,
            "a respawned player must not be zoomed again"
        );

        const { player: revived } = makeHarness();
        enterDeathState(revived);
        respawnPlayer(revived);
        drainDeferred();

        assert.equal(revived.dimension.particles.length, 0, "a respawn cancels the corpse's puff");
    });

    it("cancels a lethal hit and leaves a survivable one to the engine", () => {
        const lethal = makeHarness();
        lethal.container.setItem(0, new ItemStack("bh:apple", 1));
        lethal.health.currentValue = 0;

        const lethalHit = hurtEvent(lethal.player, 5);
        eventBus.dispatch("entityHurtBefore", lethalHit);
        drainDeferred();

        assert.equal(lethalHit.cancel, true, "the lethal hit must be vetoed");
        assert.equal(lethal.player.getGameMode(), GameMode.Spectator);
        assert.equal(isDead(lethal.player), true);
        assert.equal(mockSpawnedItems.length, 1);

        const survivable = makeHarness();
        survivable.health.currentValue = 15;

        const survivableHit = hurtEvent(survivable.player, 5);
        eventBus.dispatch("entityHurtBefore", survivableHit);

        assert.equal(survivableHit.cancel, false);
        assert.equal(isDead(survivable.player), false);
        assert.equal(survivable.player.getGameMode(), GameMode.Survival);
    });

    it("re-asserts the park on the tick pass and on a relog, for a dead player only", () => {
        const { player, container } = makeHarness();
        container.setItem(0, new ItemStack("bh:apple", 1));

        enterDeathState(player);
        player.setGameMode(GameMode.Survival);
        player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, true);
        player.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, true);

        runDeathStatePass();

        assert.equal(player.getGameMode(), GameMode.Spectator);
        assert.equal(
            player.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Movement),
            false,
            "the pass must take movement back, not only the game mode"
        );
        assert.equal(player.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Jump), false);
        assert.equal(mockSpawnedItems.length, 1, "the pass must not drop the inventory again");

        const living = new Player("death_player_living", "alex");
        living.setGameMode(GameMode.Creative);
        mockPlayers.push(living);

        runDeathStatePass();

        assert.equal(living.getGameMode(), GameMode.Creative, "a living player keeps the mode they chose");

        // A relog comes back through playerSpawn with the dead flag already set.
        const { player: returning } = makeHarness();
        returning.setDynamicProperty(DEAD_PROPERTY, true);
        returning.setGameMode(GameMode.Survival);

        eventBus.dispatch("playerSpawn", { player: returning, initialSpawn: true });
        drainDeferred();

        assert.equal(returning.getGameMode(), GameMode.Spectator);
        assert.equal(
            returning.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Movement),
            false,
            "a relog must come back locked too"
        );
        assert.equal(mockSpawnedItems.length, 0, "a relog must never re-drop the inventory");
    });

    it("reports a death that slipped through, naming its cause", () => {
        const { player } = makeHarness();

        eventBus.dispatch("entityDie", { deadEntity: player, damageSource: { cause: "void" } });

        assert.match(capturedErrors.join("\n"), /void/, "the tripwire must name the bypassing cause");
    });
});

describe("Death screen", () => {
    it("carries a lethal hit all the way back to a living player, from either button", async () => {
        for (const selection of [0, 1]) {
            const { player, container, health } = makeHarness();
            container.setItem(0, new ItemStack("bh:apple", 1));

            setNextFormOutcome({ selection });
            health.currentValue = 0;
            const event = hurtEvent(player, 5);
            eventBus.dispatch("entityHurtBefore", event);
            drainDeferred();

            assert.equal(event.cancel, true);
            assert.equal(player.getGameMode(), GameMode.Spectator);
            assert.equal(isDeathScreenPending(player.id), true, "the screen is the player's only way out");

            const form = formsShown.at(-1)!;
            assert.deepEqual(form.buttons, ["Respawn", "Title menu"], "the era's two ways out, in its order");

            runDeathStatePass();
            assert.equal(formsShown.length, 1, "a screen already in flight must not be pushed a second time");

            await drainForm();

            assert.equal(
                player.getGameMode(),
                GameMode.Survival,
                `button ${selection} must not strand a dead player`
            );
            assert.equal(isDead(player), false);
            assert.equal(health.currentValue, health.effectiveMax);
            assert.equal(mockSpawnedItems.length, 1, "one death, one drop");

            runDeathStatePass();
            assert.equal(formsShown.length, 1, "a respawned player must never get the screen back");
        }
    });

    it("tracks the pending form however it goes away, and never lets a dismissal be an escape", async () => {
        const { player } = makeHarness();
        const { respawned, handlers } = makeHandlers();

        setNextFormOutcome({ selection: 0 });
        showDeathScreen(player, handlers);
        assert.equal(isDeathScreenPending(player.id), true);

        dismissDeathScreen(player);

        assert.equal(isDeathScreenPending(player.id), false);
        assert.deepEqual(closedFormPlayers, [player.id]);

        await drainForm();

        assert.equal(respawned.length, 0, "a superseded form must not respawn the player");

        enterDeathState(player);
        dismissDeathScreen(player);
        const shownBefore = formsShown.length;

        runDeathStatePass();

        assert.equal(isDeathScreenPending(player.id), true, "Escape must not be an escape from a death");
        assert.equal(formsShown.length, shownBefore + 1, "and the pass puts the screen back up exactly once");

        setNextFormOutcome({ canceled: true, cancelationReason: FormCancelationReason.UserClosed });
        showDeathScreen(player, handlers);
        await drainForm();

        assert.equal(isDeathScreenPending(player.id), false, "nor is one the player closed himself");

        showDeathScreen(player, handlers);
        eventBus.dispatch("playerLeave", { playerId: player.id, playerName: player.name });

        assert.equal(isDeathScreenPending(player.id), false, "and a departed player's form is forgotten");

        makeHarness();
        runDeathStatePass();

        assert.equal(formsShown.length, 0, "only a dead player gets the death screen");
    });
});
