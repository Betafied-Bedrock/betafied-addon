import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
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

    it("routes container access events to their subscribers", () => {
        let opened = 0;
        let closed = 0;

        const unsubOpen = eventBus.onBlockContainerOpened(() => {
            opened++;
        });
        const unsubClose = eventBus.onBlockContainerClosed(() => {
            closed++;
        });

        eventBus.dispatch("blockContainerOpened", {});
        eventBus.dispatch("blockContainerClosed", {});

        assert.equal(opened, 1, "blockContainerOpened handlers must receive the open event");
        assert.equal(closed, 1, "blockContainerClosed handlers must receive the close event");

        unsubOpen();
        unsubClose();
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

    it("supports beforeEvents short-circuiting when event is cancelled", () => {
        let secondHandlerRan = false;

        const unsubCanceller = eventBus.onPlayerInteractWithBlock((e: any) => {
            e.cancel = true;
        }, 100);

        const unsubSecondary = eventBus.onPlayerInteractWithBlock(() => {
            secondHandlerRan = true;
        }, 10);

        const eventObj = { cancel: false };
        eventBus.dispatch("playerInteractWithBlock", eventObj);

        assert.equal(eventObj.cancel, true);
        assert.equal(secondHandlerRan, false, "Cancelled beforeEvent must short-circuit lower priority handlers");

        unsubCanceller();
        unsubSecondary();
    });

    it("dispatches the hurt before-event and short-circuits a cancelled hit", () => {
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

        assert.equal(event.cancel, true);
        assert.deepEqual(seen, ["first"], "A cancelled hurt must short-circuit lower-priority handlers");

        unsubFirst();
        unsubCanceller();
        unsubSecond();
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
