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
    system,
    world
} from "@minecraft/server";

const CAKE_ID = "bh:cake";
const OVERWORLD = "minecraft:overworld";

function cakeCell(bites = 0) {
    const dimension = world.getDimension(OVERWORLD);
    const block = dimension.getBlock({ x: 0, y: 64, z: 0 });
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
        it("takes a slice under full health and heals the era's three points", () => {
            assert.deepEqual(planCakeBite(0, 10, 20), { heal: SLICE_HEAL, nextBites: 1 });
            assert.equal(SLICE_HEAL, 3, "BlockCake.eatCakeSlice healed three, which is a heart and a half");
        });

        it("takes no slice at all once the player is at full health", () => {
            assert.equal(planCakeBite(0, 20, 20), undefined);
            assert.equal(planCakeBite(3, 21, 20), undefined);
        });

        it("clears the block on the sixth bite instead of writing a seventh state", () => {
            assert.equal(CAKE_SERVINGS, 6, "var6 >= 6 is what removed the cake");
            assert.deepEqual(planCakeBite(CAKE_SERVINGS - 1, 10, 20), { heal: SLICE_HEAL, nextBites: undefined });
        });

        it("keeps every bite below the sixth on the block", () => {
            for (let bites = 0; bites < CAKE_SERVINGS - 1; bites++) {
                assert.equal(planCakeBite(bites, 1, 20)?.nextBites, bites + 1, `bite ${bites} did not advance`);
            }
        });

        it("heals the whole three points even when that heals past the last one", () => {
            const bite = planCakeBite(2, 19, 20);
            assert.deepEqual(bite, { heal: SLICE_HEAL, nextBites: 3 });
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

        it("takes one slice however many times the engine fires a single tap", () => {
            const block = cakeCell(0);
            const { player, component } = eater(1);

            // Bedrock hands a held input to the before-event again on every tick it lasts, so the raw
            // firing is not the click; the era took one slice from one activation of the block.
            for (let tick = 0; tick < CAKE_SERVINGS; tick++) {
                click(block, player);
                settle();
            }

            assert.equal(eaten(block), 1, "a burst of fires is still the one slice the tap earned");
            assert.equal(component.currentValue, 4, "and it heals once, not once per fire");
        });

        it("takes the next slice once the burst window has passed", () => {
            const block = cakeCell(0);
            const { player } = eater(1);

            click(block, player);
            settle();
            assert.equal(eaten(block), 1);

            system.currentTick += BITE_COOLDOWN_TICKS;
            click(block, player);
            settle();

            assert.equal(eaten(block), 2, "a deliberate second tap still earns its slice");
        });

        it("keeps one player's burst from spending another player's tap", () => {
            const block = cakeCell(0);
            const { player: first } = eater(1);
            const second = { ...eater(1).player, id: "cake_alex" };

            click(block, first);
            settle();
            click(block, second);
            settle();

            assert.equal(eaten(block), 2, "the window is the player's own, not the cake's");
        });

        it("spends the click but takes nothing from a player at full health", () => {
            const block = cakeCell(2);
            const { player, component } = eater(20);

            const event = click(block, player);
            settle();

            assert.equal(event.cancel, true, "the era spent the click either way");
            assert.equal(eaten(block), 2, "a full-health player left the cake where it was");
            assert.equal(component.currentValue, 20);
        });

        it("reads a cake whose bite state never got written as unbitten", () => {
            const dimension = world.getDimension(OVERWORLD);
            const block = dimension.getBlock({ x: 4, y: 64, z: 4 });
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

            assert.equal(block.typeId, "minecraft:air", "a cell that is no longer a cake is left alone");
            assert.equal(component.currentValue, 10, "and the slice is not handed out");
        });

        it("leaves every other block alone", () => {
            const dimension = world.getDimension(OVERWORLD);
            const stone = dimension.getBlock({ x: 8, y: 64, z: 8 });
            stone.setPermutation(BlockPermutation.resolve("minecraft:stone"));
            const { player } = eater(10);

            const event = click(stone, player);
            settle();

            assert.equal(event.cancel, false, "only the pack's cake is this module's click");
            assert.equal(stone.typeId, "minecraft:stone");
        });
    });
});
