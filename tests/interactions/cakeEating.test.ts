import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    planCakeBite,
    BITE_COOLDOWN_TICKS,
    CAKE_BITES_STATE,
    CAKE_SERVINGS,
    SLICE_HEAL
} from "../../packs/BP/scripts/interactions/cakeEating.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import {
    BlockPermutation,
    EntityComponentTypes,
    resetMocks,
    scheduledTimeouts,
    system
} from "@minecraft/server";
import { dimension } from "../support/world.js";

const CAKE_ID = "bh:cake";

function cakeCell(bites = 0) {
    const dim = dimension();
    const block = dim.getBlock({ x: 0, y: 64, z: 0 });
    block.setPermutation(BlockPermutation.resolve(CAKE_ID, { [CAKE_BITES_STATE]: bites }));
    return block;
}

function eaten(block: any): number | undefined {
    return block.permutation.getAllStates()[CAKE_BITES_STATE];
}

/** A player carrying the engine's health component, which is all the eat reads. */
function eater(health: number, maxHealth = 20) {
    const component = {
        currentValue: health,
        defaultValue: maxHealth,
        setCurrentValue(value: number) {
            component.currentValue = value;
        }
    };

    const player = {
        id: "cake_steve",
        isValid: true,
        name: "CakeSteve",
        getComponent(type: string) {
            return type === EntityComponentTypes.Health ? component : undefined;
        }
    };

    return { player, component };
}

function click(block: any, player: any) {
    const event = { cancel: false, block, blockFace: "Up", dimension: block.dimension, itemStack: undefined, player };
    eventBus.dispatch("playerInteractWithBlock", event);
    return event;
}

/** The slice is taken on the tick after the click, because a before-event cannot write to the world. */
function settle(): void {
    while (scheduledTimeouts.length > 0) {
        scheduledTimeouts.shift()!.callback();
    }
}

describe("Cake Eating - Beta 1.7.3 six bites", () => {
    // Ticks only move forward in game while the cooldown map outlives a single test, so each test
    // starts on a tick no earlier test has used.
    let tickBase = 0;

    beforeEach(() => {
        resetMocks();
        eventBus.init();
        tickBase += 100;
        system.currentTick = tickBase;
    });

    /** Taps the cake the way a player would: one input, then the next after the burst window. */
    function tap(block: any, player: any): void {
        click(block, player);
        settle();
        system.currentTick += BITE_COOLDOWN_TICKS;
    }

    describe("planCakeBite - the era's eatCakeSlice in one function", () => {
        it("plans the era's slice, unless the player is already whole", () => {
            assert.deepEqual(planCakeBite(0, 10, 20), { heal: SLICE_HEAL, nextBites: 1 });
            assert.deepEqual(
                planCakeBite(CAKE_SERVINGS - 1, 10, 20),
                { heal: SLICE_HEAL, nextBites: undefined },
                "`var6 >= 6` is what removed the cake instead of writing a seventh state"
            );
            assert.equal(planCakeBite(0, 20, 20), undefined);
            assert.equal(planCakeBite(3, 21, 20), undefined, "an over-healed player is refused the same way");
        });
    });

    describe("the click on a cake", () => {
        it("swallows the click and takes a slice on the tick after", () => {
            const block = cakeCell(0);
            const { player, component } = eater(10);

            const event = click(block, player);
            assert.equal(event.cancel, true, "the era's blockActivated answered true, so nothing in hand was used");
            assert.equal(eaten(block), 0, "the before-event writes nothing");

            settle();

            assert.equal(eaten(block), 1, "the slice advanced the bite");
            assert.equal(component.currentValue, 13, "and healed the era's three points");
        });

        it("walks a cake down to its last bite, then clears it", () => {
            const block = cakeCell(0);

            for (let slice = 0; slice < CAKE_SERVINGS; slice++) {
                const { player } = eater(10);
                tap(block, player);
            }

            assert.equal(block.typeId, "minecraft:air", "the sixth bite is the one that removed the block");
        });

        it("spends one slice per tap, from the player's own burst window", () => {
            const block = cakeCell(0);
            const { player, component } = eater(1);
            const second = { ...eater(1).player, id: "cake_alex" };

            // Bedrock hands a held input to the before-event again on every tick it lasts, so the raw
            // firing is not the click; the era took one slice from one activation of the block.
            for (let tick = 0; tick < CAKE_SERVINGS; tick++) {
                click(block, player);
                settle();
            }

            assert.equal(eaten(block), 1, "a burst of fires is still the one slice the tap earned");
            assert.equal(component.currentValue, 4, "and it heals once, not once per fire");

            click(block, second);
            settle();
            assert.equal(eaten(block), 2, "the window is the player's own, not the cake's");

            system.currentTick += BITE_COOLDOWN_TICKS;
            click(block, player);
            settle();
            assert.equal(eaten(block), 3, "a deliberate second tap still earns its slice");
        });

        it("spends the click but takes nothing from a player at full health", () => {
            const block = cakeCell(2);
            const { player, component } = eater(20);

            const event = click(block, player);
            settle();

            assert.equal(event.cancel, true, "the era spent the click either way");
            assert.equal(eaten(block), 2, "a full-health player left the cake where it was");
            assert.equal(component.currentValue, 20, "and got no heal out of it");
        });

        it("reads a cake whose bite state never got written as unbitten", () => {
            const dim = dimension();
            const block = dim.getBlock({ x: 4, y: 64, z: 4 });
            block.setPermutation(BlockPermutation.resolve(CAKE_ID));
            const { player } = eater(10);

            click(block, player);
            settle();

            assert.equal(eaten(block), 1);
        });

        it("keeps a slice that was taken from a cake the engine no longer holds", () => {
            const block = cakeCell(1);
            const { player, component } = eater(10);

            click(block, player);
            block.setType("minecraft:air");
            settle();

            assert.equal(component.currentValue, 10, "and the slice is not handed out");
        });

        it("leaves every other block alone", () => {
            const dim = dimension();
            const stone = dim.getBlock({ x: 8, y: 64, z: 8 });
            stone.setPermutation(BlockPermutation.resolve("minecraft:stone"));
            const { player } = eater(10);

            const event = click(stone, player);
            settle();

            assert.equal(event.cancel, false, "only the pack's cake is this module's click");
        });
    });
});
