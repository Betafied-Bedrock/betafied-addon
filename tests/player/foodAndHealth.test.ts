import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    Container,
    EntityComponentTypes,
    ItemStack,
    Player,
    resetMocks,
    scheduledTimeouts
} from "@minecraft/server";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import "../../packs/BP/scripts/player/foodAndHealth.js";

/**
 * These cases drive the module through the bus the way the engine does, so a pass is a statement
 * about this handler and the mock's shape: that the use is cancelled, what it writes on the tick it
 * deferred to, and what it refuses. It says nothing about how Bedrock resolves an item use.
 */
const SLOT = 3;

function healthComponent(value: number, max: number) {
    const component = {
        currentValue: value,
        defaultValue: max,
        setCurrentValue(next: number): void {
            component.currentValue = next;
        }
    };
    return component;
}

/** A player holding `item` in the selected slot, with the two components the eat reads. */
function eater(item: ItemStack, options: { health?: number; max?: number } = {}) {
    const container = new Container(36);
    container.setItem(SLOT, item);

    const health = healthComponent(options.health ?? 10, options.max ?? 20);
    const player = new Player("eater", "Eater");
    player.setComponent(EntityComponentTypes.Inventory, { container });
    player.setComponent(EntityComponentTypes.Health, health);
    // The mock's Player has no selected slot, so the case states which one the click came from; the
    // module reads it to find the stack the cancelled use is supposed to consume.
    (player as any).selectedSlotIndex = SLOT;

    return { player, container, health };
}

function useItem(source: any, itemStack?: ItemStack): any {
    const event: any = { cancel: false, source, itemStack };
    eventBus.dispatch("itemUse", event);
    return event;
}

/** The eat is written on the tick after the click, because a before-event may not write to a slot. */
function settle(): void {
    const due = scheduledTimeouts.splice(0, scheduledTimeouts.length);
    for (const item of due) {
        item.callback();
    }
}

function captureWarnings(body: () => void): string[] {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message?: unknown) => void warnings.push(String(message));
    try {
        body();
    } finally {
        console.warn = original;
    }
    return warnings;
}

describe("Food and health — the era's instant eat", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("cancels the use, then heals and spends the stack from the tick after it", () => {
        const { player, container, health } = eater(new ItemStack("bh:apple", 2));

        const event = useItem(player, new ItemStack("bh:apple", 1));

        assert.equal(event.cancel, true, "the era ate instantly, so the vanilla use must not also run");
        assert.equal(container.getItem(SLOT).amount, 2, "a before-event writes nothing to the inventory");
        assert.equal(health.currentValue, 10, "and heals nothing on the tick of the click");

        settle();

        assert.equal(health.currentValue, 14, "ten health plus the apple's four");
        assert.equal(container.getItem(SLOT).amount, 1, "one apple out of the stack of two");
    });

    it("clears the slot when the last item of the stack is the one eaten", () => {
        const { player, container, health } = eater(new ItemStack("bh:apple", 1));

        useItem(player, new ItemStack("bh:apple", 1));
        settle();

        assert.equal(
            container.getItem(SLOT),
            undefined,
            "the last apple leaves an empty slot rather than a stack of zero"
        );
        assert.equal(health.currentValue, 14);
    });

    it("clamps the heal at the player's own maximum", () => {
        // A representative, the era's outlier and a single-point food: the era's table is capped by
        // the health component, so the golden apple is the one row where the clamp is all that shows.
        const rows: [string, number, number][] = [
            ["bh:golden_apple", 18, 20],
            ["bh:cooked_porkchop", 10, 18],
            ["bh:cookie", 19, 20]
        ];

        for (const [id, from, expected] of rows) {
            resetMocks();
            const { player, health } = eater(new ItemStack(id, 1), { health: from });

            useItem(player, new ItemStack(id, 1));
            settle();

            assert.equal(health.currentValue, expected, `${id} eaten from ${from} health`);
        }
    });

    it("spends a golden apple at full health and leaves every other food in the inventory", () => {
        const golden = eater(new ItemStack("bh:golden_apple", 1), { health: 20 });
        useItem(golden.player, new ItemStack("bh:golden_apple", 1));
        settle();

        assert.equal(
            golden.container.getItem(SLOT),
            undefined,
            "the era ate a golden apple with nothing left to heal"
        );
        assert.equal(golden.health.currentValue, 20, "and it cannot heal past the maximum");

        const apple = eater(new ItemStack("bh:apple", 2), { health: 20 });
        useItem(apple.player, new ItemStack("bh:apple", 1));
        settle();

        assert.equal(
            apple.container.getItem(SLOT).amount,
            2,
            "while a plain food at full health is refused before it is spent"
        );
    });

    it("leaves a use the pack does not feed the player with alone", () => {
        const { player } = eater(new ItemStack("bh:apple", 1));

        const rows: [string, ItemStack | undefined][] = [
            ["an item the era never ate", new ItemStack("minecraft:stick", 1)],
            ["the vanilla apple the sweep converts before it is ever held", new ItemStack("minecraft:apple", 1)],
            ["nothing in hand", undefined]
        ];

        for (const [label, held] of rows) {
            assert.equal(useItem(player, held).cancel, false, `${label} is not this module's click`);
        }

        const mob = { typeId: "minecraft:pig", isValid: true };
        assert.equal(
            useItem(mob, new ItemStack("bh:apple", 1)).cancel,
            false,
            "and a non-player source never reaches the eat"
        );
    });

    it("reports the cancelled use instead of eating when the slot moved on inside the deferred tick", () => {
        const { player, container, health } = eater(new ItemStack("bh:apple", 2));

        useItem(player, new ItemStack("bh:apple", 1));
        // Cancelling the use and writing the slot are a tick apart, and that window is the whole race:
        // a swap inside it must not be eaten from, and must not be dropped without a word either.
        container.setItem(SLOT, new ItemStack("minecraft:stick", 1));

        const warnings = captureWarnings(settle);

        assert.equal(health.currentValue, 10, "the click healed nothing");
        assert.equal(container.getItem(SLOT).typeId, "minecraft:stick", "the stack that arrived is untouched");
        assert.equal(warnings.length, 1, "and the dropped use is reported exactly once");
        assert.match(warnings[0], /^foodAndHealth: Error during consumeFoodDeferred/);
    });
});
