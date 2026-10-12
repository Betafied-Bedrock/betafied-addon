import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    planSignPlacement,
    standingSignDirection
} from "../../packs/BP/scripts/interactions/signPlacement.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import {
    Direction,
    EntityComponentTypes,
    EntityEquippableComponent,
    EquipmentSlot,
    GameMode,
    ItemStack,
    Player,
    resetMocks,
    scheduledTimeouts,
    world
} from "@minecraft/server";

const OVERWORLD = "minecraft:overworld";

function dimension() {
    return world.getDimension(OVERWORLD);
}

function signHolder(gameMode: string = GameMode.Survival): Player {
    const player = new Player("sign_placer", "SignPlacer");
    player.gameMode = gameMode;

    const equippable = new EntityEquippableComponent();
    equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack("bh:oak_sign", 1));
    player.setComponent(EntityComponentTypes.Equippable, equippable);
    return player;
}

function heldItem(player: Player) {
    return player.getComponent(EntityComponentTypes.Equippable)?.getEquipment(EquipmentSlot.Mainhand);
}

function clickEvent(clicked: any, blockFace: string, player: Player, itemStack: any = heldItem(player)) {
    return { cancel: false, block: clicked, blockFace, dimension: clicked.dimension, itemStack, player };
}

/** The click is answered on the next tick, because a before-event cannot write to the world. */
function settle(): void {
    while (scheduledTimeouts.length > 0) {
        scheduledTimeouts.shift()!.callback();
    }
}

describe("Sign Placement - Beta 1.7.3 two sign blocks", () => {
    beforeEach(() => {
        resetMocks();
        eventBus.init();
    });

    describe("standingSignDirection - the era's rotation maths", () => {
        it("maps the cardinal facings onto the sixteen sign rotations", () => {
            assert.equal(standingSignDirection(0), 8);
            assert.equal(standingSignDirection(90), 12);
            assert.equal(standingSignDirection(-90), 4);
            assert.equal(standingSignDirection(270), 4);
        });

        it("wraps a half turn back onto the first rotation", () => {
            assert.equal(standingSignDirection(180), 0);
            assert.equal(standingSignDirection(-180), 0);
        });

        it("stays inside a nibble for any facing the engine can report", () => {
            for (let yaw = -360; yaw <= 360; yaw += 5) {
                const direction = standingSignDirection(yaw);
                assert.ok(direction >= 0 && direction <= 15, `${yaw} produced ${direction}`);
            }
        });
    });

    describe("planSignPlacement - which of the two blocks goes up", () => {
        it("puts a standing sign on the top face, above the block that was clicked", () => {
            const plan = planSignPlacement(Direction.Up, 90);

            assert.ok(plan);
            assert.deepEqual(plan.offset, { x: 0, y: 1, z: 0 });
            assert.equal(plan.blockId, "minecraft:standing_sign");
            assert.equal(plan.states.ground_sign_direction, 12);
        });

        it("hangs a wall sign off each of the four sides, facing the way the era's aux said", () => {
            const walls = [
                { face: Direction.North, offset: { x: 0, y: 0, z: -1 }, facing: 2 },
                { face: Direction.South, offset: { x: 0, y: 0, z: 1 }, facing: 3 },
                { face: Direction.West, offset: { x: -1, y: 0, z: 0 }, facing: 4 },
                { face: Direction.East, offset: { x: 1, y: 0, z: 0 }, facing: 5 }
            ];

            for (const wall of walls) {
                const plan = planSignPlacement(wall.face, 0);

                assert.ok(plan, `${wall.face} has to take a sign`);
                assert.deepEqual(plan.offset, wall.offset, `${wall.face} placed the sign in the wrong cell`);
                assert.equal(plan.blockId, "minecraft:wall_sign");
                assert.equal(plan.states.facing_direction, wall.facing);
            }
        });

        it("refuses the underside of a block", () => {
            assert.equal(planSignPlacement(Direction.Down, 0), undefined);
        });
    });

    describe("placing the pack's sign", () => {
        it("puts a standing sign on the ground and spends the item", () => {
            const dim = dimension();
            const ground = dim.getBlock({ x: 2, y: 64, z: 2 });
            const above = dim.getBlock({ x: 2, y: 65, z: 2 });
            above.setType("minecraft:air");

            const player = signHolder();
            player.setRotation({ x: 0, y: 90 });

            const event = clickEvent(ground, Direction.Up, player);
            eventBus.dispatch("playerInteractWithBlock", event);
            settle();

            assert.equal(event.cancel, true, "the engine's own sign placement must be suppressed");
            assert.equal(above.typeId, "minecraft:standing_sign");
            assert.equal(above.permutation.getState("ground_sign_direction"), 12);
            assert.equal(heldItem(player), undefined, "Beta spent the sign it placed");
            assert.ok(player.soundsPlayed.some(sound => sound.soundId === "use.wood"));
        });

        it("hangs a wall sign on the block that was clicked", () => {
            const dim = dimension();
            const wall = dim.getBlock({ x: 4, y: 64, z: 4 });
            const hanging = dim.getBlock({ x: 4, y: 64, z: 3 });
            hanging.setType("minecraft:air");

            const player = signHolder();
            const event = clickEvent(wall, Direction.North, player);
            eventBus.dispatch("playerInteractWithBlock", event);
            settle();

            assert.equal(event.cancel, true);
            assert.equal(hanging.typeId, "minecraft:wall_sign");
            assert.equal(hanging.permutation.getState("facing_direction"), 2);
            assert.equal(heldItem(player), undefined);
        });

        it("leaves the sign in hand when the era would have placed none", () => {
            const dim = dimension();
            const ceiling = dim.getBlock({ x: 6, y: 64, z: 6 });
            const below = dim.getBlock({ x: 6, y: 63, z: 6 });
            below.setType("minecraft:air");

            const player = signHolder();
            const event = clickEvent(ceiling, Direction.Down, player);
            eventBus.dispatch("playerInteractWithBlock", event);
            settle();

            assert.equal(event.cancel, false, "a refused sign must not swallow the click");
            assert.equal(below.typeId, "minecraft:air");
            assert.ok(heldItem(player), "a sign that was never placed stays in hand");
        });

        it("leaves a click alone when the cell the sign wants is taken", () => {
            const dim = dimension();
            const ground = dim.getBlock({ x: 8, y: 64, z: 8 });

            const player = signHolder();
            const event = clickEvent(ground, Direction.Up, player);
            eventBus.dispatch("playerInteractWithBlock", event);
            settle();

            assert.equal(event.cancel, false, "the engine's stone above must not be overwritten");
            assert.equal(dim.getBlock({ x: 8, y: 65, z: 8 }).typeId, "minecraft:stone");
            assert.ok(heldItem(player));
        });

        it("keeps the sign in Creative", () => {
            const dim = dimension();
            const ground = dim.getBlock({ x: 10, y: 64, z: 10 });
            dim.getBlock({ x: 10, y: 65, z: 10 }).setType("minecraft:air");

            const player = signHolder(GameMode.Creative);
            const event = clickEvent(ground, Direction.Up, player);
            eventBus.dispatch("playerInteractWithBlock", event);
            settle();

            assert.equal(dim.getBlock({ x: 10, y: 65, z: 10 }).typeId, "minecraft:standing_sign");
            assert.ok(heldItem(player), "Creative places without spending the stack");
        });

        it("ignores every other item in hand", () => {
            const dim = dimension();
            const ground = dim.getBlock({ x: 12, y: 64, z: 12 });
            dim.getBlock({ x: 12, y: 65, z: 12 }).setType("minecraft:air");

            const player = signHolder();
            const event = clickEvent(ground, Direction.Up, player, new ItemStack("minecraft:stick", 4));
            eventBus.dispatch("playerInteractWithBlock", event);
            settle();

            assert.equal(event.cancel, false);
            assert.equal(dim.getBlock({ x: 12, y: 65, z: 12 }).typeId, "minecraft:air");
        });
    });
});
