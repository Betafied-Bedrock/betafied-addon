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

/** A sign beside the door, carrying the lines far.land's lockette writes. */
function attachSign(cell: { x: number; y: number; z: number }, text: string) {
    const sign = dimension().getBlock(cell);
    sign.setType("minecraft:standing_sign");
    sign.getComponent = (componentId: string) =>
        componentId === "minecraft:sign" ? { getText: () => text } : undefined;
    return sign;
}

function attachWallSign(
    cell: { x: number; y: number; z: number },
    facingDirection: number,
    text: string
) {
    const sign = dimension().getBlock(cell);
    sign.setPermutation(
        BlockPermutation.resolve("minecraft:wall_sign", { facing_direction: facingDirection })
    );
    sign.getComponent = (componentId: string) =>
        componentId === "minecraft:sign" ? { getText: () => text } : undefined;
    return sign;
}

function punch(player: Player, block: unknown): void {
    eventBus.dispatch("entityHitBlock", {
        damagingEntity: player,
        hitBlock: block,
        hitBlockPermutation: (block as { permutation: unknown }).permutation,
        blockFace: Direction.North
    });
}

describe("Door Punch - Beta 1.7.3 punch-to-toggle wooden door", () => {
    beforeEach(() => {
        resetMocks();
        system.currentTick = 0;
        eventBus.init();
    });

    describe("planDoorToggle - pure planning logic", () => {
        it("plans opening when punching a closed lower half, whatever the state keys are spelled", () => {
            const plan = planDoorToggle(WOODEN_DOOR_ID, CLOSED_LOWER_STATES, { x: 10, y: 64, z: 10 });

            assert.ok(plan, "closed lower half should produce a toggle plan");
            assert.deepEqual(plan.lowerCell, { x: 10, y: 64, z: 10 });
            assert.deepEqual(plan.upperCell, { x: 10, y: 65, z: 10 });
            assert.equal(plan.newOpenState, true);
            assert.equal(plan.soundName, "random.door_open");

            const namespaced = planDoorToggle(
                WOODEN_DOOR_ID,
                { "minecraft:upper_block_bit": false, "minecraft:open_bit": false },
                { x: 5, y: 64, z: 5 }
            );

            assert.equal(namespaced?.newOpenState, true, "a namespaced key names the same state");
            assert.deepEqual(namespaced?.upperCell, { x: 5, y: 65, z: 5 });
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

        it("refuses to plan a toggle for anything but the pack's wooden door", () => {
            const cell = { x: 10, y: 64, z: 10 };

            assert.equal(planDoorToggle("minecraft:iron_door", CLOSED_LOWER_STATES, cell), undefined, "iron doors must not be punch-opened");
            assert.equal(planDoorToggle("minecraft:stone", {}, cell), undefined);
        });
    });

    describe("entityHitBlock interaction handler", () => {
        it("toggles the door from whichever half the player punched", () => {
            const first = spawnDoorInWorld({ x: 20, y: 64, z: 20 }, false);
            const second = spawnDoorInWorld({ x: 22, y: 64, z: 20 }, true);
            const player = new Player("tester", "Tester");

            eventBus.dispatch("entityHitBlock", {
                damagingEntity: player,
                hitBlock: first.lower,
                hitBlockPermutation: first.lower.permutation,
                blockFace: Direction.North
            });

            assert.equal(first.lower.permutation.getState("open_bit"), true, "both halves swing together");
            assert.equal(first.upper.permutation.getState("open_bit"), true);
            assert.equal((first.dim as any).soundsPlayed[0].soundId, "random.door_open");

            eventBus.dispatch("entityHitBlock", {
                damagingEntity: player,
                hitBlock: second.upper,
                hitBlockPermutation: second.upper.permutation,
                blockFace: Direction.South
            });

            assert.equal(second.lower.permutation.getState("open_bit"), false, "punching either half closes it");
            assert.equal(second.upper.permutation.getState("open_bit"), false);
            assert.equal((first.dim as any).soundsPlayed.length, 2, "one sound per toggle");
            assert.equal((first.dim as any).soundsPlayed[1].soundId, "random.door_close");
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

        it("leaves a door locked by a private sign closed for a stranger", () => {
            const { dim, lower, upper } = spawnDoorInWorld({ x: 40, y: 64, z: 20 }, false);
            attachSign({ x: 39, y: 64, z: 20 }, "[Private]\nAlice\n");
            const stranger = new Player("stranger", "Charlie");

            punch(stranger, lower);

            assert.equal(lower.permutation.getState("open_bit"), false, "the door must not open");
            assert.equal(upper.permutation.getState("open_bit"), false);
            assert.equal((dim as any).soundsPlayed.length, 0, "a refused punch makes no door sound");
        });

        it("lets the owner and a named guest punch their own private door", () => {
            const owned = spawnDoorInWorld({ x: 42, y: 64, z: 20 }, false);
            attachSign({ x: 41, y: 64, z: 20 }, "[Private]\nAlice\nBob");

            punch(new Player("owner", "Alice"), owned.lower);
            assert.equal(owned.lower.permutation.getState("open_bit"), true, "owner keeps the punch");

            const guestDoor = spawnDoorInWorld({ x: 44, y: 64, z: 20 }, false);
            attachSign({ x: 43, y: 64, z: 20 }, "[Private]\nAlice\nBob");

            punch(new Player("guest", "Bob"), guestDoor.lower);
            assert.equal(guestDoor.lower.permutation.getState("open_bit"), true, "guest keeps the punch");
        });

        it("finds a wall sign mounted on the door's upper half from a punch below", () => {
            const { lower } = spawnDoorInWorld({ x: 48, y: 64, z: 20 }, false);
            attachWallSign({ x: 47, y: 65, z: 20 }, 4, "[Private]\nAlice\n");

            punch(new Player("stranger", "Charlie"), lower);

            assert.equal(lower.permutation.getState("open_bit"), false, "a sign on either half governs the door");
        });

        it("ignores a private sign that is not attached to the door", () => {
            const { lower } = spawnDoorInWorld({ x: 46, y: 64, z: 20 }, false);
            attachSign({ x: 44, y: 64, z: 20 }, "[Private]\nAlice\n");

            punch(new Player("stranger", "Charlie"), lower);

            assert.equal(lower.permutation.getState("open_bit"), true, "an unrelated sign must not lock the door");
        });

        it("ignores hits from non-player entities", () => {
            const { dim, lower } = spawnDoorInWorld({ x: 30, y: 64, z: 20 }, false);
            const nonPlayer = { typeId: "minecraft:zombie" };

            eventBus.dispatch("entityHitBlock", {
                damagingEntity: nonPlayer,
                hitBlock: lower,
                hitBlockPermutation: lower.permutation,
                blockFace: Direction.West
            });

            assert.equal(lower.permutation.getState("open_bit"), false, "the door is left as it stood");
            assert.equal((dim as any).soundsPlayed.length, 0);
        });
    });
});
