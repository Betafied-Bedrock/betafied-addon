import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { eventBus, guarded } from "../../packs/BP/scripts/core/eventBus.js";
import { registeredBeforeEvents } from "../mocks/minecraftServer.js";

describe("Central EventBus Architecture", () => {
    it("registers and dispatches event handlers with priority ordering", () => {
        const order: number[] = [];

        const unsub2 = eventBus.onPlayerInteractWithBlock(() => {
            order.push(2);
        }, 10); // Priority 10

        const unsub1 = eventBus.onPlayerInteractWithBlock(() => {
            order.push(1);
        }, 20);

        const unsub3 = eventBus.onPlayerInteractWithBlock(() => {
            order.push(3);
        }, 0);

        eventBus.dispatch("playerInteractWithBlock", {
            cancel: false
        });

        assert.deepEqual(order, [1, 2, 3], "Handlers must execute in descending priority order");

        unsub1();
        unsub2();
        unsub3();

        order.length = 0;
        eventBus.dispatch("playerInteractWithBlock", { cancel: false });
        assert.deepEqual(order, [], "Unsubscribed handlers must not run");
    });

    it("runs equal-priority handlers in subscription order", () => {
        const order: string[] = [];

        const unsubA = eventBus.onEntitySpawn(() => {
            order.push("a");
        });
        const unsubB = eventBus.onEntitySpawn(() => {
            order.push("b");
        });
        const unsubC = eventBus.onEntitySpawn(() => {
            order.push("c");
        });
        // Subscribed last, but priority outranks registration order.
        const unsubPriority = eventBus.onEntitySpawn(() => {
            order.push("first");
        }, 5);

        eventBus.dispatch("entitySpawn", { entity: { typeId: "minecraft:pig" } });

        assert.deepEqual(
            order,
            ["first", "a", "b", "c"],
            "equal priorities keep subscription order, so main.ts import order decides the sequence"
        );

        unsubA();
        unsubB();
        unsubC();
        unsubPriority();
    });

    it("isolates errors so a throwing handler does not crash sibling handlers", () => {
        let siblingRan = false;

        const unsubFail = eventBus.onEntitySpawn(() => {
            throw new Error("Simulated handler crash");
        });

        const unsubSuccess = eventBus.onEntitySpawn(() => {
            siblingRan = true;
        });

        assert.doesNotThrow(() => {
            eventBus.dispatch("entitySpawn", { entity: { typeId: "minecraft:zombie" } });
        });

        assert.ok(siblingRan, "Sibling handler must execute despite prior handler failure");

        unsubFail();
        unsubSuccess();
    });

    it("runs the handlers above a canceller, then short-circuits the ones below it", () => {
        const seen: string[] = [];

        const unsubFirst = eventBus.onEntityHurtBefore(() => {
            seen.push("first");
        }, 100);

        const unsubCanceller = eventBus.onEntityHurtBefore((e: any) => {
            e.cancel = true;
        }, 50);

        const unsubSecond = eventBus.onEntityHurtBefore(() => {
            seen.push("second");
        }, 0);

        const event: any = { cancel: false, damage: 5 };
        eventBus.dispatch("entityHurtBefore", event);

        assert.equal(event.cancel, true, "the flag the canceller set is the one dispatch leaves behind");
        assert.deepEqual(seen, ["first"], "a cancelled beforeEvent must short-circuit lower-priority handlers");

        unsubFirst();
        unsubCanceller();
        unsubSecond();
    });

    it("reports a guarded handler's failure with its own context and spares the next handler", () => {
        const warnings: string[] = [];
        const originalWarn = console.warn;
        console.warn = (message?: unknown) => {
            warnings.push(String(message));
        };

        let siblingRan = false;
        const unsubFail = eventBus.onEntitySpawn(guarded(
            (event: { entity: { typeId: string } }) => ({
                system: "guardedTest",
                operation: "handleSpawn",
                target: event.entity.typeId
            }),
            (event) => {
                if (event.entity) throw new Error("guarded handler crash");
            }
        ));
        const unsubSibling = eventBus.onEntitySpawn(() => {
            siblingRan = true;
        });

        try {
            assert.doesNotThrow(() => {
                eventBus.dispatch("entitySpawn", { entity: { typeId: "minecraft:pig" } });
            });
        } finally {
            console.warn = originalWarn;
            unsubFail();
            unsubSibling();
        }

        assert.equal(warnings.length, 1, "the guard reports through the shared error boundary exactly once");
        assert.match(warnings[0], /^guardedTest: Error during handleSpawn/);
        assert.match(warnings[0], /target: minecraft:pig/, "the context factory reads the event it is given");
        assert.match(warnings[0], /guarded handler crash/);
        assert.equal(siblingRan, true, "a guarded failure must not stop the sibling handlers");
    });

    it("routes the engine's before-hurt event through the bus once initialised", () => {
        const seen: number[] = [];
        const unsub = eventBus.onEntityHurtBefore((e) => {
            seen.push((e as { damage: number }).damage);
        });

        eventBus.init();

        const engineHandlers = registeredBeforeEvents.get("entityHurt") ?? [];
        assert.ok(engineHandlers.length > 0, "init() must subscribe to world.beforeEvents.entityHurt");

        for (const handler of engineHandlers) {
            handler({ cancel: false, damage: 7 });
        }

        assert.ok(seen.includes(7), "an engine before-hurt event must reach bus subscribers");
        unsub();
    });
});
