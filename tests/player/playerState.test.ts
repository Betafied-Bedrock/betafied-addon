import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    Container,
    EntityComponentTypes,
    EntityDamageCause,
    EntityEquippableComponent,
    EquipmentSlot,
    GameMode,
    HudElement,
    ItemStack,
    Player,
    mockPlayers,
    mockSpawnedItems,
    resetMocks
} from "../mocks/minecraftServer.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { tickManager } from "../../packs/BP/scripts/core/tickManager.js";
import {
    ensurePlayerHudState,
    playerStateJob
} from "../../packs/BP/scripts/player/playerState.js";

/** A player in the world, carrying whatever components the case gives it. */
function join(id: string, name: string): Player {
    const player = new Player(id, name);
    mockPlayers.push(player);
    return player;
}

/** An equippable holding one stack in the offhand, which is the slot the era never had. */
function offhand(itemId: string): EntityEquippableComponent {
    const equippable = new EntityEquippableComponent();
    equippable.setEquipment(EquipmentSlot.Offhand, new ItemStack(itemId, 1));
    return equippable;
}

describe("Player state - the era's bars and the offhand slot", () => {
    // The module tracks which players it has already suppressed for the life of the process, so every
    // case names its own player instead of trying to reset that set.
    beforeEach(() => {
        resetMocks();
    });

    it("hides the hunger and progress bars and leaves the health bar showing", () => {
        const player = join("hud_steve", "HudSteve");

        ensurePlayerHudState(player);

        assert.deepEqual(
            player.onScreenDisplay.hiddenHudElements,
            [HudElement.Hunger, HudElement.ProgressBar],
            "the era has neither a hunger bar nor an experience bar to fill"
        );
        assert.equal(
            player.onScreenDisplay.hiddenHudElements.includes(HudElement.Health),
            false,
            "health is the one bar the era does show"
        );
    });

    it("suppresses a player once, not on every pass of the sweep", () => {
        const player = join("hud_once", "HudOnce");

        ensurePlayerHudState(player);
        ensurePlayerHudState(player);

        assert.equal(
            player.onScreenDisplay.hiddenHudElements.length,
            2,
            "the engine is told once per join; a pass every two ticks must not repeat it"
        );
    });

    it("takes a rejoining player back into the set it hides bars for", () => {
        const player = join("hud_returning", "HudReturning");

        eventBus.dispatch("playerSpawn", { player });
        const afterFirstJoin = player.onScreenDisplay.hiddenHudElements.length;

        eventBus.dispatch("playerLeave", { playerId: player.id });
        eventBus.dispatch("playerSpawn", { player });

        assert.equal(afterFirstJoin, 2, "the spawn hid both bars");
        assert.equal(
            player.onScreenDisplay.hiddenHudElements.length,
            4,
            "a player who left is suppressed again, which is the whole reason leave untracks them"
        );
    });

    it("re-suppresses bars when player changes dimensions", () => {
        const player = join("hud_dimension", "HudDimension");

        eventBus.dispatch("playerSpawn", { player });
        assert.equal(player.onScreenDisplay.hiddenHudElements.length, 2);

        eventBus.dispatch("playerDimensionChange", {
            player,
            fromDimension: { id: "minecraft:overworld" },
            toDimension: { id: "minecraft:nether" }
        });

        assert.equal(
            player.onScreenDisplay.hiddenHudElements.length,
            4,
            "dimension change re-applies suppression for the new screen"
        );
    });

    it("resets the level the era never had, and leaves a player without one alone", () => {
        let resets = 0;
        let untouched = 0;

        Object.assign(join("xp_steve", "XpSteve"), {
            level: 5,
            resetLevel: () => { resets += 1; }
        });
        Object.assign(join("xp_none", "XpNone"), {
            level: 0,
            xpEarnedAtCurrentLevel: 0,
            resetLevel: () => { untouched += 1; }
        });

        playerStateJob();

        assert.equal(resets, 1, "a level above zero is the post-Beta bar this pass removes");
        assert.equal(untouched, 0, "and a player who has nothing to lose is not touched");
    });

    it("hands the offhand stack to the inventory", () => {
        const player = join("offhand_steve", "OffhandSteve");
        const equippable = offhand("minecraft:torch");
        const inventory = new Container();
        player.setComponent(EntityComponentTypes.Equippable, equippable);
        player.setComponent(EntityComponentTypes.Inventory, { container: inventory });

        playerStateJob();

        assert.equal(
            equippable.getEquipment(EquipmentSlot.Offhand),
            undefined,
            "the offhand is not a slot the era had, so the stack does not stay there"
        );
        assert.equal(inventory.getItem(0)?.typeId, "minecraft:torch", "it waits in the inventory");
        assert.equal(mockSpawnedItems.length, 0, "and nothing is dropped on the ground for it");
    });

    it("spills the offhand stack when no inventory can take it", () => {
        const full = join("offhand_full", "OffhandFull");
        const fullEquip = offhand("minecraft:torch");
        full.setComponent(EntityComponentTypes.Equippable, fullEquip);
        full.setComponent(EntityComponentTypes.Inventory, { container: new Container(0) });

        playerStateJob();

        assert.equal(mockSpawnedItems.length, 1, "a full inventory leaves the stack in the world");

        const bare = join("offhand_bare", "OffhandBare");
        const bareEquip = offhand("minecraft:torch");
        bare.setComponent(EntityComponentTypes.Equippable, bareEquip);

        playerStateJob();

        assert.equal(
            mockSpawnedItems.length,
            2,
            "and a player the engine gives no inventory component drops it the same way"
        );
        assert.equal(bareEquip.getEquipment(EquipmentSlot.Offhand), undefined);
    });
});

describe("Script-based lava damage watchdog", () => {
    beforeEach(() => {
        resetMocks();
        tickManager.stop();
    });

    it("damages and sets on fire a survival player submerged in lava when no lava damage received recently", () => {
        const player = join("lava_surv", "LavaSurv");
        player.setGameMode(GameMode.Survival);
        player.location = { x: 10, y: 64, z: 10 };
        player.dimension.setBlockType({ x: 10, y: 64, z: 10 }, "minecraft:lava");

        playerStateJob();

        assert.equal(player.damageApplied.length, 1, "lava damage must be applied");
        assert.equal(player.damageApplied[0].amount, 4, "exact Beta 1.7.3 damage: 4 (2 hearts)");
        assert.deepEqual(
            player.damageApplied[0].options,
            { cause: EntityDamageCause.lava },
            "cause must be EntityDamageCause.lava"
        );
        assert.equal(player.fireApplied.length, 1, "fire must be applied");
        assert.equal(player.fireApplied[0].seconds, 15, "exact Beta 1.7.3 fire duration: 15 seconds");
        assert.equal(player.fireApplied[0].useEffects, false);
    });

    it("damages a player submerged in minecraft:flowing_lava at head level", () => {
        const player = join("lava_flow", "LavaFlow");
        player.setGameMode(GameMode.Survival);
        player.location = { x: 10, y: 64, z: 10 };
        // Feet in stone, head at y=65 in flowing lava
        player.dimension.setBlockType({ x: 10, y: 64, z: 10 }, "minecraft:stone");
        player.dimension.setBlockType({ x: 10, y: 65, z: 10 }, "minecraft:flowing_lava");

        playerStateJob();

        assert.equal(player.damageApplied.length, 1);
        assert.equal(player.damageApplied[0].amount, 4);
        assert.equal(player.fireApplied.length, 1);
        assert.equal(player.fireApplied[0].seconds, 15);
    });

    it("debounces damage within 10 ticks (smart debounce)", () => {
        const player = join("lava_debounce", "LavaDebounce");
        player.setGameMode(GameMode.Survival);
        player.location = { x: 10, y: 64, z: 10 };
        player.dimension.setBlockType({ x: 10, y: 64, z: 10 }, "minecraft:lava");

        // First pass applies damage at tick 0
        playerStateJob();
        assert.equal(player.damageApplied.length, 1);

        // Advance a few ticks (< 10 ticks)
        for (let i = 0; i < 4; i++) {
            tickManager.step();
        }
        playerStateJob();

        assert.equal(player.damageApplied.length, 1, "must not double-damage within 10 ticks");
    });

    it("steps back when native engine applies lava damage via eventBus.onEntityHurt", () => {
        const player = join("lava_native", "LavaNative");
        player.setGameMode(GameMode.Survival);
        player.location = { x: 10, y: 64, z: 10 };
        player.dimension.setBlockType({ x: 10, y: 64, z: 10 }, "minecraft:lava");

        // Native engine deals lava damage
        eventBus.dispatch("entityHurt", {
            hurtEntity: player,
            damage: 4,
            damageSource: { cause: EntityDamageCause.lava }
        });

        // Watchdog runs on same tick or shortly after
        playerStateJob();

        assert.equal(
            player.damageApplied.length,
            0,
            "script steps back when native engine applies lava damage"
        );
    });

    it("applies damage again after 10 ticks have elapsed", () => {
        const player = join("lava_repeat", "LavaRepeat");
        player.setGameMode(GameMode.Survival);
        player.location = { x: 10, y: 64, z: 10 };
        player.dimension.setBlockType({ x: 10, y: 64, z: 10 }, "minecraft:lava");

        playerStateJob();
        assert.equal(player.damageApplied.length, 1);

        // Advance 10 ticks
        for (let i = 0; i < 10; i++) {
            tickManager.step();
        }
        playerStateJob();

        assert.equal(player.damageApplied.length, 2, "deals damage again after 10 ticks have elapsed");
    });

    it("does not damage players in Creative or Spectator mode", () => {
        const creative = join("lava_creative", "LavaCreative");
        creative.setGameMode(GameMode.Creative);
        creative.location = { x: 10, y: 64, z: 10 };
        creative.dimension.setBlockType({ x: 10, y: 64, z: 10 }, "minecraft:lava");

        const spectator = join("lava_spectator", "LavaSpectator");
        spectator.setGameMode(GameMode.Spectator);
        spectator.location = { x: 10, y: 64, z: 10 };
        spectator.dimension.setBlockType({ x: 10, y: 64, z: 10 }, "minecraft:lava");

        playerStateJob();

        assert.equal(creative.damageApplied.length, 0);
        assert.equal(creative.fireApplied.length, 0);
        assert.equal(spectator.damageApplied.length, 0);
        assert.equal(spectator.fireApplied.length, 0);
    });

    it("does not damage players not submerged in lava", () => {
        const safe = join("lava_safe", "LavaSafe");
        safe.setGameMode(GameMode.Survival);
        safe.location = { x: 10, y: 64, z: 10 };
        safe.dimension.setBlockType({ x: 10, y: 64, z: 10 }, "minecraft:water");

        playerStateJob();

        assert.equal(safe.damageApplied.length, 0);
        assert.equal(safe.fireApplied.length, 0);
    });

    it("cleans up tracked damage ticks on playerLeave", () => {
        const player = join("lava_leave", "LavaLeave");
        player.setGameMode(GameMode.Survival);
        player.location = { x: 10, y: 64, z: 10 };
        player.dimension.setBlockType({ x: 10, y: 64, z: 10 }, "minecraft:lava");

        // Native engine damage notes tick
        eventBus.dispatch("entityHurt", {
            hurtEntity: player,
            damage: 4,
            damageSource: { cause: EntityDamageCause.lava }
        });

        // Player leaves and rejoins
        eventBus.dispatch("playerLeave", { playerId: player.id });

        // Without advancing 10 ticks, since leave cleared the map, watchdog treats player afresh
        playerStateJob();
        assert.equal(player.damageApplied.length, 1);
    });
});

