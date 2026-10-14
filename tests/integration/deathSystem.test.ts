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
    assertDeathState,
    respawnPlayer
} from "../../packs/BP/scripts/player/death.js";
import {
    DEATH_SCREEN_COPY,
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
    it("throws every stack and armor piece from chest height", () => {
        const { player, container, equippable } = makeHarness();
        container.setItem(0, new ItemStack("bh:apple", 3));
        equippable.setEquipment(EquipmentSlot.Head, new ItemStack("minecraft:iron_helmet", 1));

        enterDeathState(player);

        assert.equal(container.getItem(0), undefined);
        assert.equal(equippable.getEquipment(EquipmentSlot.Head), undefined);
        assert.equal(mockSpawnedItems.length, 2);
        assert.equal(mockSpawnedItems[0].location.y, player.location.y + 1.44);

        const impulse = mockSpawnedItems[0].impulse as { x: number; y: number; z: number };
        assert.equal(impulse.y, 0.2, "the era's throw always kicks upward by 0.2");
        assert.ok(
            Math.hypot(impulse.x, impulse.z) <= 0.5,
            `horizontal throw must stay within 0.5, got ${Math.hypot(impulse.x, impulse.z)}`
        );
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

    it("spills the inventory over the two blocks around the corpse", () => {
        const { player, container } = makeHarness();
        for (let slot = 0; slot < 12; slot += 1) {
            container.setItem(slot, new ItemStack("bh:apple", 1));
        }

        enterDeathState(player);

        assert.equal(mockSpawnedItems.length, 12);

        const offsets = mockSpawnedItems.map((item) => ({
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

        assert.ok(
            mockSpawnedItems.every(item => (item.impulse as { y: number }).y === 0.2),
            "the era's upward kick survives the scatter"
        );
    });

    it("reports the dead flag through isDead", () => {
        const { player } = makeHarness();

        assert.equal(isDead(player), false);
        enterDeathState(player);
        assert.equal(isDead(player), true);
    });

    it("drops once, however many lethal hits arrive", () => {
        const { player, container } = makeHarness();
        container.setItem(0, new ItemStack("bh:apple", 3));

        enterDeathState(player);
        enterDeathState(player);

        assert.equal(mockSpawnedItems.length, 1);
    });

    it("respawns at the spawn point with full health and no dead property", () => {
        const { player, container, health } = makeHarness();
        container.setItem(0, new ItemStack("bh:apple", 1));

        enterDeathState(player);
        player.spawnPoint = { dimension: player.dimension, x: 10, y: 64, z: -20 };

        respawnPlayer(player);

        assert.equal(player.getDynamicProperty(DEAD_PROPERTY), undefined);
        assert.equal(player.getDynamicProperty(PRE_DEATH_GAMEMODE_PROPERTY), undefined);
        assert.equal(player.getGameMode(), GameMode.Survival);

        drainNextTick();

        assert.deepEqual(player.location, { x: 10, y: 64, z: -20 });
        assert.equal(health.currentValue, health.effectiveMax);
        assert.deepEqual(
            LOCKED_INPUT_CATEGORIES.filter(c => !player.inputPermissions.isPermissionCategoryEnabled(c)),
            [],
            "respawn must hand movement back"
        );
        assert.deepEqual(closedFormPlayers, [player.id]);
    });

    it("respawns the player without announcing the move", () => {
        const { player } = makeHarness();
        player.location = { x: 4, y: 70, z: -9 };
        joinWorld(player);

        player.location = { x: 900, y: 12, z: 900 };
        enterDeathState(player);
        respawnPlayer(player);

        assert.deepEqual(commandFeedbackWrites, [false], "the respawn must mute the engine's announcement");

        drainDeferred();

        assert.deepEqual(commandFeedbackWrites, [false, true], "and put the gamerule back afterwards");
    });

    it("flops the corpse over, and stands it back up on respawn", () => {
        const { player } = makeHarness();

        enterDeathState(player);
        assert.deepEqual(
            player.animationsPlayed.map(entry => entry.animationName),
            ["animation.player.death_flop"],
            "the era turns a dead body about Z, so the death has to take it off its feet"
        );

        respawnPlayer(player);
        assert.ok(
            player.animationsPlayed.some(entry => entry.animationName === "animation.player.death_flop_reset"),
            "and a respawn has to undo it, because the era deletes its corpse rather than reviving it"
        );
    });

    it("puffs twenty particles through the corpse once the era would have removed it", () => {
        const { player } = makeHarness();
        player.location = { x: 4, y: 70, z: -9 };

        enterDeathState(player);

        assert.equal(player.dimension.particles.length, 0, "nothing puffs while the body is still falling");
        assert.ok(
            scheduledTimeouts.some(entry => entry.timeout === 21),
            "the puff waits for the tick the era's deathTime passes 20"
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
    });

    it("withholds the puff from a player who is back on their feet before it lands", () => {
        const { player } = makeHarness();

        enterDeathState(player);
        respawnPlayer(player);
        drainDeferred();

        assert.equal(player.dimension.particles.length, 0, "a respawn cancels the corpse's puff");
    });

    it("respawns the player facing yaw 0 and pitch 0", () => {
        const { player } = makeHarness();

        enterDeathState(player);
        player.setRotation({ x: 45, y: 137 });

        respawnPlayer(player);

        assert.deepEqual(player.getRotation(), { x: 0, y: 0 }, "a corpse's view must not be inherited");
    });

    it("respawns a player with no spawn point at the world spawn the first join recorded", () => {
        const { player } = makeHarness();
        player.location = { x: 4, y: 70, z: -9 };
        joinWorld(player);

        player.location = { x: 900, y: 12, z: 900 };
        enterDeathState(player);
        respawnPlayer(player);

        drainNextTick();

        assert.deepEqual(player.location, { x: 4, y: 70, z: -9 });
        assert.equal(player.getGameMode(), GameMode.Survival);
    });

    it("keeps the first join's world spawn for everyone who joins later", () => {
        const { player } = makeHarness();
        player.location = { x: 4, y: 70, z: -9 };
        joinWorld(player);

        const later = new Player("death_player_later", "alex");
        later.location = { x: 900, y: 64, z: 900 };
        mockPlayers.push(later);
        joinWorld(later);

        assert.deepEqual(
            world.getDynamicProperty(WORLD_SPAWN_PROPERTY),
            { x: 4, y: 70, z: -9 },
            "the world spawn is the first join's, not the latest one's"
        );
    });

    it("never records a join the dimension could not hold", () => {
        const { player } = makeHarness();
        player.location = { x: 0, y: 32767, z: 0 };
        joinWorld(player);

        assert.equal(
            world.getDynamicProperty(WORLD_SPAWN_PROPERTY),
            undefined,
            "a save parked above the world is not a world spawn"
        );

        player.location = { x: 4, y: 70, z: -9 };
        enterDeathState(player);
        respawnPlayer(player);
        drainNextTick();

        assert.deepEqual(
            player.location,
            { x: 4, y: 70, z: -9 },
            "with no world spawn to move to, the player stays where they died rather than above the world"
        );
        assert.equal(player.getGameMode(), GameMode.Survival, "and the respawn still hands the player back");
    });

    it("sends a player who has a bed home rather than to the world spawn", () => {
        const { player } = makeHarness();
        player.location = { x: 4, y: 70, z: -9 };
        joinWorld(player);

        player.spawnPoint = { dimension: player.dimension, x: 10, y: 64, z: -20 };
        player.location = { x: 900, y: 12, z: 900 };
        enterDeathState(player);
        respawnPlayer(player);

        drainNextTick();

        assert.deepEqual(player.location, { x: 10, y: 64, z: -20 });
    });

    it("hands back the mode the player died in", () => {
        const { player } = makeHarness();
        player.setGameMode(GameMode.Creative);

        enterDeathState(player);
        respawnPlayer(player);

        assert.equal(player.getGameMode(), GameMode.Creative, "a Creative death must hand back Creative");
    });

    it("takes the controls away before it spills the inventory", () => {
        const { player, container } = makeHarness();
        container.setItem(0, new ItemStack("bh:apple", 1));

        const stateWhileDropping: string[] = [];
        const setItem = container.setItem;
        container.setItem = (slot: number, item: any) => {
            if (item === undefined) {
                stateWhileDropping.push(
                    `${player.getGameMode()}/${player.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Movement)}`
                );
            }
            setItem(slot, item);
        };

        enterDeathState(player);

        assert.deepEqual(stateWhileDropping, [`${GameMode.Spectator}/false`]);
    });

    it("plays the era's death sound, which the vetoed hit would have played itself", () => {
        const { player } = makeHarness();

        enterDeathState(player);

        const played = player.dimension.soundsPlayed;
        assert.equal(played.length, 1, "one death, one sound");
        assert.equal(played[0].soundId, "random.hurt", "the player inherits the era's death sound");
        assert.deepEqual(played[0].location, player.location, "played at the corpse, for everyone nearby");
        assert.equal(played[0].options.volume, 1, "the era's volume for it");
        const pitch = played[0].options.pitch;
        assert.ok(
            pitch >= 0.8 && pitch <= 1.2,
            `the era's pitch jitter lands in [0.8, 1.2], got ${pitch}`
        );
    });

    it("narrows the view along the era's death curve", () => {
        const { player } = makeHarness();

        enterDeathState(player);
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
        assert.ok(
            written.every((fov) => fov < 70 && fov > 23.33),
            "and it never leaves 70 heading for 23.3"
        );
        assert.ok(written.length < 60, `expected a stepped curve, got ${written.length} writes`);
    });

    it("hands the camera back on respawn, and never touches a living player's", () => {
        const { player } = makeHarness();

        runTicks(40);
        assert.deepEqual(player.camera.fovWrites, [], "only a dead player gets the death zoom");

        enterDeathState(player);
        runTicks(40);
        assert.ok(player.camera.fovWrites.length > 0);

        respawnPlayer(player);
        assert.equal(player.camera.clears, 1, "respawn is the one path that hands the view back");

        const writesAtRespawn = player.camera.fovWrites.length;
        runTicks(40);
        assert.equal(
            player.camera.fovWrites.length,
            writesAtRespawn,
            "a respawned player must not be zoomed again"
        );
    });

    it("cancels a lethal hit and enters the death state out of the before-event", () => {
        const { player, container, health } = makeHarness();
        container.setItem(0, new ItemStack("bh:apple", 1));
        health.currentValue = 0;

        const event = hurtEvent(player, 5);
        eventBus.dispatch("entityHurtBefore", event);
        drainDeferred();

        assert.equal(event.cancel, true, "the lethal hit must be vetoed");
        assert.equal(player.getGameMode(), GameMode.Spectator);
        assert.equal(isDead(player), true);
        assert.equal(mockSpawnedItems.length, 1);
    });

    it("leaves a survivable hit to the engine", () => {
        const { player, health } = makeHarness();
        health.currentValue = 15;

        const event = hurtEvent(player, 5);
        eventBus.dispatch("entityHurtBefore", event);

        assert.equal(event.cancel, false);
        assert.equal(isDead(player), false);
        assert.equal(player.getGameMode(), GameMode.Survival);
    });

    it("does not re-enter the death state for a hit on a dead player", () => {
        const { player, container, health } = makeHarness();
        container.setItem(0, new ItemStack("bh:apple", 1));

        enterDeathState(player);
        health.currentValue = 0;

        const event = hurtEvent(player, 5);
        eventBus.dispatch("entityHurtBefore", event);

        assert.equal(event.cancel, false, "a dead player's hits are the engine's business again");
        assert.equal(mockSpawnedItems.length, 1, "the inventory drops exactly once");
    });

    it("re-asserts spectator on the tick pass without dropping again", () => {
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
        assert.equal(mockSpawnedItems.length, 1);
    });

    it("leaves a living player in whatever mode they are in on the tick pass", () => {
        const { player } = makeHarness();
        player.setGameMode(GameMode.Creative);

        runDeathStatePass();

        assert.equal(player.getGameMode(), GameMode.Creative);
    });

    it("assertDeathState leaves a living player alone directly", () => {
        const { player } = makeHarness();
        player.setGameMode(GameMode.Survival);

        assertDeathState(player);

        assert.equal(player.getGameMode(), GameMode.Survival);
    });

    it("puts a returning dead player back in spectator without dropping again", () => {
        const { player } = makeHarness();
        player.setDynamicProperty(DEAD_PROPERTY, true);
        player.setGameMode(GameMode.Survival);

        eventBus.dispatch("playerSpawn", { player, initialSpawn: true });
        drainDeferred();

        assert.equal(player.getGameMode(), GameMode.Spectator);
        assert.equal(
            player.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Movement),
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
    it("shows the era's copy, with the buttons in the era's order", () => {
        const { player } = makeHarness();
        showDeathScreen(player, makeHandlers().handlers);

        const form = formsShown.at(-1)!;
        assert.equal(form.titleText, "Game over!");
        assert.equal(form.titleText, DEATH_SCREEN_COPY.title);
        assert.equal(form.bodyText, "Score: &e0");
        assert.equal(form.bodyText, DEATH_SCREEN_COPY.body);
        assert.deepEqual(form.buttons, ["Respawn", "Title menu"]);
    });

    it("hands the first selection to onRespawn and the second to onTitleMenu", async () => {
        const { player } = makeHarness();
        const { respawned, titled, handlers } = makeHandlers();

        setNextFormOutcome({ selection: 0 });
        showDeathScreen(player, handlers);
        await drainForm();
        assert.equal(respawned.length, 1);

        setNextFormOutcome({ selection: 1 });
        showDeathScreen(player, handlers);
        await drainForm();
        assert.equal(respawned.length, 1, "the screen must not respawn the player itself");
        assert.equal(titled.length, 1);
    });

    it("leaves no form pending once the player dismisses it", async () => {
        const { player } = makeHarness();
        const { handlers } = makeHandlers();

        setNextFormOutcome({ canceled: true, cancelationReason: FormCancelationReason.UserClosed });
        showDeathScreen(player, handlers);
        await drainForm();

        assert.equal(isDeathScreenPending(player.id), false);
    });

    it("keeps a single show in flight per player", () => {
        const { player } = makeHarness();
        const { handlers } = makeHandlers();

        showDeathScreen(player, handlers);
        showDeathScreen(player, handlers);

        assert.equal(formsShown.length, 1, "the second show would land as UserBusy and waste a pass");
    });

    it("closes the open form and clears the pending flag on dismiss", () => {
        const { player } = makeHarness();
        const { handlers } = makeHandlers();

        showDeathScreen(player, handlers);
        assert.equal(isDeathScreenPending(player.id), true);

        dismissDeathScreen(player);

        assert.equal(isDeathScreenPending(player.id), false);
        assert.deepEqual(closedFormPlayers, [player.id]);
    });

    it("ignores a click that arrives after the form was dismissed", async () => {
        const { player } = makeHarness();
        const { respawned, handlers } = makeHandlers();

        setNextFormOutcome({ selection: 0 });
        showDeathScreen(player, handlers);
        dismissDeathScreen(player);
        await drainForm();

        assert.equal(respawned.length, 0, "a superseded form must not respawn the player");
    });

    it("puts the screen up as the player is parked, without waiting for a pass", () => {
        const { player, container } = makeHarness();
        container.setItem(0, new ItemStack("bh:apple", 1));

        enterDeathState(player);

        assert.equal(isDeathScreenPending(player.id), true, "the screen is the player's only way out");
        assert.equal(formsShown.length, 1, "the death itself shows the screen, not the pass behind it");
        assert.equal(formsShown.at(-1)?.titleText, DEATH_SCREEN_COPY.title);
        assert.deepEqual(formsShown.at(-1)?.buttons, ["Respawn", "Title menu"]);

        runDeathStatePass();

        assert.equal(formsShown.length, 1, "a screen already in flight must not be pushed a second time");
        assert.equal(mockSpawnedItems.length, 1, "showing the screen must never drop the inventory again");
    });

    it("puts a dismissed screen back on the tick pass", () => {
        const { player } = makeHarness();

        enterDeathState(player);
        dismissDeathScreen(player);

        runDeathStatePass();

        assert.equal(isDeathScreenPending(player.id), true, "Escape must not be an escape from a death");
        assert.equal(formsShown.length, 2);
    });

    it("leaves a living player without a screen on the tick pass", () => {
        makeHarness();

        runDeathStatePass();

        assert.equal(formsShown.length, 0, "only a dead player gets the death screen");
    });

    it("carries a lethal hit all the way back to a living player", async () => {
        const { player, container, health } = makeHarness();
        container.setItem(0, new ItemStack("bh:apple", 1));

        setNextFormOutcome({ selection: 0 });
        health.currentValue = 0;
        const event = hurtEvent(player, 5);
        eventBus.dispatch("entityHurtBefore", event);
        drainDeferred();

        assert.equal(event.cancel, true);
        assert.equal(player.getGameMode(), GameMode.Spectator);
        assert.equal(isDeathScreenPending(player.id), true, "the screen is the player's only way out");

        await drainForm();

        assert.equal(player.getGameMode(), GameMode.Survival);
        assert.equal(isDead(player), false);
        assert.equal(health.currentValue, health.effectiveMax);
        assert.equal(mockSpawnedItems.length, 1, "one death, one drop");

        runDeathStatePass();
        assert.equal(formsShown.length, 1, "a respawned player must never get the screen back");
    });

    it("respawns from the era's Title menu button as well", async () => {
        const { player, container, health } = makeHarness();
        container.setItem(0, new ItemStack("bh:apple", 1));

        setNextFormOutcome({ selection: 1 });
        health.currentValue = 0;
        eventBus.dispatch("entityHurtBefore", hurtEvent(player, 5));
        drainDeferred();

        assert.equal(isDeathScreenPending(player.id), true);

        await drainForm();

        assert.equal(player.getGameMode(), GameMode.Survival, "the second button must not strand a dead player");
        assert.equal(isDead(player), false);
        assert.equal(health.currentValue, health.effectiveMax);
        assert.equal(mockSpawnedItems.length, 1, "one death, one drop");
    });

    it("forgets a departed player's form so a relog does not read as pending", () => {
        const { player } = makeHarness();
        const { handlers } = makeHandlers();

        showDeathScreen(player, handlers);
        assert.equal(isDeathScreenPending(player.id), true);

        eventBus.dispatch("playerLeave", { playerId: player.id, playerName: player.name });

        assert.equal(isDeathScreenPending(player.id), false);
    });
});
