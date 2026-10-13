import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { planDoorToggle } from "../../packs/BP/scripts/interactions/doorPunch.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import {
    BlockPermutation,
    Direction,
    Player,
    resetMocks,
    system
} from "@minecraft/server";
import { dimension } from "../support/world.js";

const WOODEN_DOOR_ID = "minecraft:wooden_door";

const CLOSED_LOWER_STATES = Object.freeze({
    direction: 0,
    door_hinge_bit: false,
    open_bit: false,
    upper_block_bit: false
});

const CLOSED_UPPER_STATES = Object.freeze({
    direction: 0,
    door_hinge_bit: false,
    open_bit: false,
    upper_block_bit: true
});

function spawnDoorInWorld(cell: { x: number; y: number; z: number }, open: boolean = false) {
    const dim = dimension();
    const lower = dim.getBlock(cell);
    const upper = dim.getBlock({ x: cell.x, y: cell.y + 1, z: cell.z });

    lower.setPermutation(
        BlockPermutation.resolve(WOODEN_DOOR_ID, { ...CLOSED_LOWER_STATES, open_bit: open })
    );
    upper.setPermutation(
        BlockPermutation.resolve(WOODEN_DOOR_ID, { ...CLOSED_UPPER_STATES, open_bit: open })
    );

    return { dim, lower, upper };
}

describe("Door Punch - Beta 1.7.3 punch-to-toggle wooden door", () => {
    beforeEach(() => {
        resetMocks();
        system.currentTick = 0;
        eventBus.init();
    });

    describe("planDoorToggle - pure planning logic", () => {
        it("plans opening when punching a closed lower half", () => {
            const cell = { x: 10, y: 64, z: 10 };
            const plan = planDoorToggle(WOODEN_DOOR_ID, CLOSED_LOWER_STATES, cell);

            assert.ok(plan, "closed lower half should produce a toggle plan");
            assert.deepEqual(plan.lowerCell, { x: 10, y: 64, z: 10 });
            assert.deepEqual(plan.upperCell, { x: 10, y: 65, z: 10 });
            assert.equal(plan.newOpenState, true);
            assert.equal(plan.soundName, "random.door_open");
        });

        it("plans closing when punching an open upper half", () => {
            const cell = { x: 10, y: 65, z: 10 };
            const plan = planDoorToggle(
                WOODEN_DOOR_ID,
                { ...CLOSED_UPPER_STATES, open_bit: true },
                cell
            );

            assert.ok(plan, "open upper half should produce a toggle plan");
            assert.deepEqual(plan.lowerCell, { x: 10, y: 64, z: 10 });
            assert.deepEqual(plan.upperCell, { x: 10, y: 65, z: 10 });
            assert.equal(plan.newOpenState, false);
            assert.equal(plan.soundName, "random.door_close");
        });

        it("recognizes namespace-prefixed block state keys", () => {
            const cell = { x: 5, y: 64, z: 5 };
            const plan = planDoorToggle(
                WOODEN_DOOR_ID,
                {
                    "minecraft:upper_block_bit": false,
                    "minecraft:open_bit": false
                },
                cell
            );

            assert.ok(plan);
            assert.equal(plan.newOpenState, true);
            assert.deepEqual(plan.upperCell, { x: 5, y: 65, z: 5 });
        });

        it("refuses to plan toggling for iron doors", () => {
            const cell = { x: 10, y: 64, z: 10 };
            const plan = planDoorToggle("minecraft:iron_door", CLOSED_LOWER_STATES, cell);

            assert.equal(plan, undefined, "iron doors must not be punch-opened");
        });

        it("refuses to plan toggling for non-door blocks", () => {
            const cell = { x: 10, y: 64, z: 10 };
            assert.equal(planDoorToggle("minecraft:stone", {}, cell), undefined);
            assert.equal(planDoorToggle("minecraft:oak_planks", {}, cell), undefined);
        });
    });

    describe("entityHitBlock interaction handler", () => {
        it("toggles wooden door open when punched by a player", () => {
            const { dim, lower, upper } = spawnDoorInWorld({ x: 20, y: 64, z: 20 }, false);
            const player = new Player("tester", "Tester");

            eventBus.dispatch("entityHitBlock", {
                damagingEntity: player,
                hitBlock: lower,
                hitBlockPermutation: lower.permutation,
                blockFace: Direction.North
            });

            assert.equal(lower.permutation.getState("open_bit"), true);
            assert.equal(upper.permutation.getState("open_bit"), true);
            assert.equal((dim as any).soundsPlayed.length, 1);
            assert.equal((dim as any).soundsPlayed[0].soundId, "random.door_open");
        });

        it("toggles wooden door closed when punched on the upper half", () => {
            const { dim, lower, upper } = spawnDoorInWorld({ x: 22, y: 64, z: 20 }, true);
            const player = new Player("tester", "Tester");

            eventBus.dispatch("entityHitBlock", {
                damagingEntity: player,
                hitBlock: upper,
                hitBlockPermutation: upper.permutation,
                blockFace: Direction.South
            });

            assert.equal(lower.permutation.getState("open_bit"), false);
            assert.equal(upper.permutation.getState("open_bit"), false);
            assert.equal((dim as any).soundsPlayed.length, 1);
            assert.equal((dim as any).soundsPlayed[0].soundId, "random.door_close");
        });

        it("debounces rapid hits within cooldown window", () => {
            const { dim, lower } = spawnDoorInWorld({ x: 24, y: 64, z: 20 }, false);
            const player = new Player("tester", "Tester");

            // First punch at tick 10
            system.currentTick = 10;
            eventBus.dispatch("entityHitBlock", {
                damagingEntity: player,
                hitBlock: lower,
                hitBlockPermutation: lower.permutation,
                blockFace: Direction.East
            });
            assert.equal(lower.permutation.getState("open_bit"), true);
            assert.equal((dim as any).soundsPlayed.length, 1);

            // Immediate second punch at tick 12 (within 8-tick cooldown)
            system.currentTick = 12;
            eventBus.dispatch("entityHitBlock", {
                damagingEntity: player,
                hitBlock: lower,
                hitBlockPermutation: lower.permutation,
                blockFace: Direction.East
            });
            assert.equal(lower.permutation.getState("open_bit"), true, "should still be open; debounced");
            assert.equal((dim as any).soundsPlayed.length, 1, "no second sound played");

            // Punch after cooldown at tick 20
            system.currentTick = 20;
            eventBus.dispatch("entityHitBlock", {
                damagingEntity: player,
                hitBlock: lower,
                hitBlockPermutation: lower.permutation,
                blockFace: Direction.East
            });
            assert.equal(lower.permutation.getState("open_bit"), false, "closed after cooldown passed");
            assert.equal((dim as any).soundsPlayed.length, 2);
        });

        it("ignores hits from non-player entities", () => {
            const { dim, lower, upper } = spawnDoorInWorld({ x: 30, y: 64, z: 20 }, false);
            const nonPlayer = { typeId: "minecraft:zombie" };

            eventBus.dispatch("entityHitBlock", {
                damagingEntity: nonPlayer,
                hitBlock: lower,
                hitBlockPermutation: lower.permutation,
                blockFace: Direction.West
            });

            assert.equal(lower.permutation.getState("open_bit"), false);
            assert.equal(upper.permutation.getState("open_bit"), false);
            assert.equal((dim as any).soundsPlayed.length, 0);
        });
    });
});
