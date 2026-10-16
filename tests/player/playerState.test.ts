import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    Container,
    EntityComponentTypes,
    EntityEquippableComponent,
    EquipmentSlot,
    HudElement,
    ItemStack,
    Player,
    mockPlayers,
    mockSpawnedItems,
    resetMocks
} from "../mocks/minecraftServer.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
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
