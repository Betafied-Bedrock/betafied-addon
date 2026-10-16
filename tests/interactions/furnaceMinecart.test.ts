import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    BlockPermutation,
    EntityComponentTypes,
    ItemStack,
    resetMocks,
    scheduledTimeouts,
    system
} from "@minecraft/server";
import "../../packs/BP/scripts/interactions/furnaceMinecart.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { tickManager } from "../../packs/BP/scripts/core/tickManager.js";
import { mockEntities } from "../mocks/minecraftServer.js";
import { dimension } from "../support/world.js";

/**
 * Wiring only: these cases pin what the module decides about a cart and its fuel. Whether the engine
 * carries the cart's burn as a dynamic property across a save, and whether a minecart's own movement
 * arrives as a location the module can difference, are assumptions the mock cannot check.
 */

const CART_ID = "ubd:furnace_minecart";
const COAL_ID = "minecraft:coal";
const FUEL_KEY = "fuelTime";
const FUEL_TICKS_PER_COAL = 720;

type MockCart = Record<string, any>;

function cartTaskId(entityId: string): string {
    return `furnaceMinecart:cart:${entityId}`;
}

/**
 * A cart as the engine hands it over: the variant component that says whether it is already burning,
 * plus the two calls the stop path makes that the mock entity has no equivalent for.
 */
function furnaceCart(location = { x: 0, y: 64, z: 0 }, variant = 0): MockCart {
    const cart = dimension().spawnEntity(CART_ID, location) as unknown as MockCart;
    cart.setComponent(EntityComponentTypes.Variant, { value: variant });

    cart.triggeredEvents = [];
    cart.triggerEvent = (name: string) => {
        cart.triggeredEvents.push(name);
    };
    cart.velocityCleared = false;
    cart.clearVelocity = () => {
        cart.velocityCleared = true;
        cart.velocity = { x: 0, y: 0, z: 0 };
    };

    return cart;
}

function railUnder(cart: MockCart): void {
    dimension().setBlock(cart.location, {
        typeId: "minecraft:rail",
        permutation: BlockPermutation.resolve("minecraft:rail"),
        isSolid: false,
        isLiquid: false
    });
}

/**
 * The step the cart took between two loop passes: it stands one cell further along, and the cell it
 * stands on is where its rail is, so the pass reads both from the same position the engine reports.
 */
function drift(cart: MockCart, toX: number): void {
    cart.location = { x: toX, y: 64, z: 0 };
    railUnder(cart);
}

/**
 * Takes a cart out of the world and stops its loop. A case that leaves a fueled cart moving would let
 * its next pass push the cart the following assertion is about, since the mock answers a proximity
 * query with every entity in the dimension.
 */
function retire(cart: MockCart): void {
    tickManager.unregister(cartTaskId(cart.id));
    mockEntities.delete(cart.id);
}

/** A click on the cart with a stack in hand, and the deferred fueling the click schedules. */
function clickWith(cart: MockCart, itemId?: string): void {
    eventBus.dispatch("playerInteractWithEntity", {
        target: cart,
        itemStack: itemId === undefined ? undefined : new ItemStack(itemId, 1)
    });

    while (scheduledTimeouts.length > 0) {
        scheduledTimeouts.shift()!.callback();
    }
}

/** One manager step is one tick of the cart's own loop, whichever tick it comes due on. */
function ticksUntil(settled: () => boolean, limit = 40): number {
    for (let i = 0; i < limit; i++) {
        system.currentTick++;
        tickManager.step();
        if (settled()) return i + 1;
    }
    throw new Error("the cart's loop never reached the state this case waits for");
}

describe("Furnace minecart", () => {
    beforeEach(() => {
        resetMocks();
        for (const taskId of tickManager.getRegisteredTaskIds()) {
            if (taskId.startsWith("furnaceMinecart:cart:")) tickManager.unregister(taskId);
        }
    });

    it("lights a cart for the era's burn time and starts its own loop from the click", () => {
        const cart = furnaceCart();

        clickWith(cart, COAL_ID);

        assert.equal(cart.getDynamicProperty(FUEL_KEY), FUEL_TICKS_PER_COAL, "one coal is the era's burn time");
        assert.equal(cart.triggeredEvents.includes("fueled"), true, "and the cart's lit state is the engine's to set");
        assert.equal(tickManager.isRegistered(cartTaskId(cart.id)), true, "the click is what starts the cart, not a sweep");
    });

    it("leaves a cart cold for a hand that is not fuel, and for one the engine reports as already burning", () => {
        const cold = furnaceCart({ x: 10, y: 64, z: 0 });
        clickWith(cold, "minecraft:stone");
        clickWith(cold);

        assert.equal(cold.getDynamicProperty(FUEL_KEY), undefined, "a stone is not fuel, and neither is an empty hand");
        assert.equal(tickManager.isRegistered(cartTaskId(cold.id)), false);

        const burning = furnaceCart({ x: 20, y: 64, z: 0 }, 1);
        clickWith(burning, COAL_ID);

        assert.equal(
            burning.getDynamicProperty(FUEL_KEY),
            undefined,
            "the coal is spent on the cart's own lit state, so an already-burning cart is not re-lit"
        );
    });

    it("spends the fuel a step at a time and brings the cart to rest when it runs out", () => {
        const cart = furnaceCart();
        railUnder(cart);
        clickWith(cart, COAL_ID);
        cart.setDynamicProperty(FUEL_KEY, 2);


        const steps = ticksUntil(() => !tickManager.isRegistered(cartTaskId(cart.id)));

        assert.equal(cart.getDynamicProperty(FUEL_KEY), 0, "the loop is what spends the fuel, and it spends it down to nothing");
        assert.equal(cart.velocityCleared, true, "an unfueled cart is stopped rather than left rolling");
        assert.equal(cart.triggeredEvents.includes("unfueled"), true, "and its lit state is reversed with it");
        assert.ok(steps <= 4, "two fuel steps cannot outlive the loop's own interval");
        retire(cart);
    });

    it("stops the loop of a cart that despawned without reading it again", () => {
        const cart = furnaceCart();
        clickWith(cart, COAL_ID);

        let staleRead = false;
        cart.isValid = false;
        Object.defineProperty(cart, "location", {
            get() {
                staleRead = true;
                return { x: 0, y: 64, z: 0 };
            }
        });

        ticksUntil(() => !tickManager.isRegistered(cartTaskId(cart.id)));

        assert.equal(tickManager.isRegistered(cartTaskId(cart.id)), false, "a cart that despawned ends its own loop");
        assert.equal(staleRead, false, "and a handle that is gone is not read for a position");
        retire(cart);
    });

    it("pushes the cart the way it was going, back when it has nearly stopped, and only forward with a cart in front", () => {
        const rolling = furnaceCart({ x: 0, y: 64, z: 0 });
        clickWith(rolling, COAL_ID);
        drift(rolling, 1);
        rolling.velocity = { x: 0.5, y: 0, z: 0 };
        ticksUntil(() => rolling.impulse !== undefined, 10);

        assert.ok(rolling.impulse.x > 0, "a cart still moving is pushed along the way it went");
        retire(rolling);

        const creeping = furnaceCart({ x: 100, y: 64, z: 0 });
        clickWith(creeping, COAL_ID);
        drift(creeping, 101);
        creeping.velocity = { x: 0.1, y: 0, z: 0 };
        ticksUntil(() => creeping.impulse !== undefined, 10);

        assert.ok(creeping.impulse.x < 0, "a cart below the era's speed threshold and alone is pushed back the way it came");
        retire(creeping);

        // Only the era's plain carts are in the pushable set: a furnace cart ahead is not furniture to
        // shunt, so the case uses the type the rule actually clears.
        const stalled = furnaceCart({ x: 200, y: 64, z: 0 });
        const ahead = dimension().spawnEntity("minecraft:minecart", { x: 202, y: 64, z: 0 }) as unknown as MockCart;
        clickWith(stalled, COAL_ID);
        drift(stalled, 201);
        stalled.velocity = { x: 0.1, y: 0, z: 0 };
        ticksUntil(() => stalled.impulse !== undefined, 10);

        assert.ok(stalled.impulse.x > 0, "and with a cart in front the reversal does not happen: the pair is shunted apart");
        assert.ok(ahead.impulse.x > 0, "the cart in front is pushed away from the one that caught up with it");
        retire(stalled);
        retire(ahead);
    });

    it("stops a cart with no rail under it instead of pushing it", () => {
        const grounded = furnaceCart({ x: 300, y: 64, z: 0 });
        clickWith(grounded, COAL_ID);
        grounded.location = { x: 301, y: 64, z: 0 };

        ticksUntil(() => grounded.velocityCleared, 10);

        assert.equal(grounded.impulse, undefined, "a cart off the rails is brought to rest, never shoved along the ground");
        retire(grounded);
    });

    it("resumes a cart whose fuel outlived the loop that spent it", () => {
        const cart = furnaceCart();
        cart.setDynamicProperty(FUEL_KEY, 100);

        ticksUntil(() => tickManager.isRegistered(cartTaskId(cart.id)), 30);

        assert.equal(
            tickManager.isRegistered(cartTaskId(cart.id)),
            true,
            "the sweep is what finds a fueled cart whose loop is not running"
        );
        retire(cart);
    });
});
