import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EntityComponentTypes, GameMode, ItemStack, system } from "@minecraft/server";
import "../../packs/BP/scripts/combat/machineGunBow.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { tickManager } from "../../packs/BP/scripts/core/tickManager.js";
import { Container, Player, mockEntities, resetMocks } from "../mocks/minecraftServer.js";

/**
 * Wiring only: these cases pin what the module decides for a given input and tick. Whether the engine
 * raises `itemStartUse` once and `itemReleaseUse` on the tick a player lets go of a drawn bow, and
 * whether a spawned arrow answers with a projectile component whose owner can be written, are
 * assumptions the mock cannot check and have to be confirmed on a client.
 */

const BOW_ID = "bh:bow";
const ARROW_ID = "minecraft:arrow";

function holdTaskId(playerId: string): string {
    return `machineGunBow:hold:${playerId}`;
}

/**
 * The player the module reads: a container holding the bow in the selected slot, and the arrows the
 * shot spends. The mock player has no `playSound` and no selected slot, so both are placed here.
 */
function archer(id: string, arrows: number): { player: Player; inv: Container } {
    const player = new Player(id, "Archer");
    const inv = new Container(36);
    inv.setItem(0, new ItemStack(BOW_ID, 1));
    if (arrows > 0) inv.setItem(1, new ItemStack(ARROW_ID, arrows));

    player.setComponent(EntityComponentTypes.Inventory, { container: inv });
    const writable = player as unknown as { selectedSlotIndex: number; playSound: (id: string) => void };
    writable.selectedSlotIndex = 0;
    writable.playSound = () => {};

    return { player, inv };
}

function heldBow(): ItemStack {
    return new ItemStack(BOW_ID, 1);
}

function drawAndLoose(player: Player): void {
    eventBus.dispatch("itemUseAfter", { source: player, itemStack: heldBow() });
}

function arrowsLeft(inv: Container): number {
    let total = 0;
    for (let i = 0; i < inv.size; i++) {
        const stack = inv.getItem(i);
        if (stack?.typeId === ARROW_ID) total += stack.amount;
    }
    return total;
}

function arrowsInFlight(): number {
    return [...mockEntities.values()].filter((entity: { typeId: string }) => entity.typeId === ARROW_ID).length;
}

/**
 * One manager step is one tick, and the module reads the engine's tick for its own cooldown. Cases
 * step until the loop reaches the state they are about rather than counting ticks, because the hold
 * task's own schedule is the module's to choose, not the test's.
 */
function ticks(count: number): void {
    for (let i = 0; i < count; i++) {
        system.currentTick++;
        tickManager.step();
    }
}

function ticksUntil(settled: () => boolean, limit = 12): number {
    for (let i = 0; i < limit; i++) {
        system.currentTick++;
        tickManager.step();
        if (settled()) return i + 1;
    }
    throw new Error("the hold loop never reached the state this case waits for");
}

describe("Machine-gun bow", () => {
    let tickBase = 0;

    beforeEach(() => {
        resetMocks();
        for (const taskId of tickManager.getRegisteredTaskIds()) {
            if (taskId.startsWith("machineGunBow:hold:")) tickManager.unregister(taskId);
        }
        // Ticks only move forward for the pack, so a case starts past every tick an earlier one used
        // and cannot inherit its cooldown.
        tickBase += 1000;
        system.currentTick = tickBase;
    });

    it("spaces a drawn bow's shots by the cooldown and makes the quiver pay for each", () => {
        const { player, inv } = archer("spender", 3);

        drawAndLoose(player);
        assert.equal(arrowsInFlight(), 1, "the first input is a shot");
        assert.equal(arrowsLeft(inv), 2, "and an arrow leaves the quiver with it");

        system.currentTick += 1;
        drawAndLoose(player);
        assert.equal(arrowsInFlight(), 1, "a second input inside the era's window is not a second shot");

        system.currentTick += 1;
        drawAndLoose(player);
        assert.equal(arrowsInFlight(), 2, "the tick the window closes on is a shot again");
        assert.equal(arrowsLeft(inv), 1, "and it costs the second arrow");
    });

    it("fires in creative on the same window without spending an arrow", () => {
        const { player, inv } = archer("creative", 1);
        player.setGameMode(GameMode.Creative);

        drawAndLoose(player);
        system.currentTick += 2;
        drawAndLoose(player);

        assert.equal(arrowsInFlight(), 2, "creative mode is not a different rate of fire");
        assert.equal(arrowsLeft(inv), 1, "and the quiver it carries is left alone");
    });

    it("does not spend the cooldown on a shot the empty quiver refused", () => {
        const { player, inv } = archer("empty", 0);

        drawAndLoose(player);
        assert.equal(arrowsInFlight(), 0, "nothing leaves a bow with no arrows");

        system.currentTick += 1;
        inv.setItem(1, new ItemStack(ARROW_ID, 1));
        drawAndLoose(player);

        assert.equal(arrowsInFlight(), 1, "the next tick still fires, because a refused shot stamps nothing");
    });

    it("keeps the loop firing while the bow is held, and stops it on release or a stop-use", () => {
        const { player, inv } = archer("holder", 8);

        eventBus.dispatch("itemStartUse", { source: player, itemStack: heldBow() });
        assert.equal(tickManager.isRegistered(holdTaskId(player.id)), true, "drawing the bow is what starts the loop");

        const steps = ticksUntil(() => arrowsInFlight() === 3);
        assert.ok(steps <= 9, "three loop passes fit inside three hold intervals, so the loop is not the cooldown's pacing");
        assert.equal(arrowsLeft(inv), 5, "and every pass is paid for from the quiver");

        eventBus.dispatch("itemReleaseUse", { source: player });
        ticks(4);
        assert.equal(tickManager.isRegistered(holdTaskId(player.id)), false, "a released bow stops its own loop");
        assert.equal(arrowsInFlight(), 3, "and takes none of the shots it would have taken");

        eventBus.dispatch("itemStartUse", { source: player, itemStack: heldBow() });
        eventBus.dispatch("itemStopUse", { source: player });
        assert.equal(tickManager.isRegistered(holdTaskId(player.id)), false, "the engine's other stop signal ends it too");
    });

    it("stops the loop when the bow is no longer the item in hand", () => {
        const { player, inv } = archer("switcher", 8);

        eventBus.dispatch("itemStartUse", { source: player, itemStack: heldBow() });
        ticksUntil(() => arrowsInFlight() === 1);

        inv.setItem(0, new ItemStack("minecraft:apple", 1));
        ticksUntil(() => !tickManager.isRegistered(holdTaskId(player.id)));

        assert.equal(arrowsInFlight(), 1, "the loop stops before it spends the next tick's arrow");
    });

    it("drops a held bow's schedule when the player leaves", () => {
        const { player } = archer("leaver", 4);

        eventBus.dispatch("itemStartUse", { source: player, itemStack: heldBow() });
        assert.equal(tickManager.isRegistered(holdTaskId(player.id)), true);

        eventBus.dispatch("playerLeave", { playerId: player.id });

        assert.equal(tickManager.isRegistered(holdTaskId(player.id)), false, "a player who left has no loop left running");
    });
});
