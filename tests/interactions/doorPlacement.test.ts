import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    planDoorCompletion
} from "../../packs/BP/scripts/interactions/doorPlacement.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import {
    BlockPermutation,
    Direction,
    EntityComponentTypes,
    EntityEquippableComponent,
    EquipmentSlot,
    ItemStack,
    Player,
    resetMocks,
    world
} from "@minecraft/server";

const OVERWORLD = "minecraft:overworld";

const LOWER_STATES = Object.freeze({
    direction: 1,
    door_hinge_bit: false,
    open_bit: false,
    upper_block_bit: false
});

function dimension() {
    return world.getDimension(OVERWORLD);
}

function placeLowerHalf(cell: { x: number; y: number; z: number }) {
    const dim = dimension();
    const lower = dim.getBlock(cell);
    lower.setPermutation(BlockPermutation.resolve("minecraft:wooden_door", { ...LOWER_STATES }));

    // The mock hands out stone for a cell nothing has written yet, so the space above has to be
    // cleared for the pair to be completable.
    const upper = dim.getBlock({ x: cell.x, y: cell.y + 1, z: cell.z });
    upper.setType("minecraft:air");

    return { dim, lower, upper };
}

function doorPlacer(): Player {
    const player = new Player("door_placer", "DoorPlacer");
    const equippable = new EntityEquippableComponent();
    equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack("bh:wooden_door", 1));
    player.setComponent(EntityComponentTypes.Equippable, equippable);
    return player;
}

describe("Door Placement - Beta 1.7.3 two-block door", () => {
    beforeEach(() => {
        resetMocks();
        eventBus.init();
    });

    describe("planDoorCompletion - which half is missing", () => {
        it("asks for the upper half when only the lower one stands", () => {
            const plan = planDoorCompletion("minecraft:wooden_door", LOWER_STATES, "minecraft:air");

            assert.ok(plan, "a lone lower half has to be completed");
            assert.deepEqual(plan.upperStates, { ...LOWER_STATES, upper_block_bit: true });
        });

        it("leaves a door the engine already placed whole", () => {
            const plan = planDoorCompletion(
                "minecraft:iron_door",
                { ...LOWER_STATES, upper_block_bit: true },
                "minecraft:iron_door"
            );

            assert.equal(plan, undefined);
        });

        it("leaves a door standing under a taken cell instead of destroying the block above", () => {
            assert.equal(
                planDoorCompletion("minecraft:wooden_door", LOWER_STATES, "minecraft:stone"),
                undefined
            );
        });

        it("ignores blocks that are not doors", () => {
            assert.equal(planDoorCompletion("minecraft:oak_sign", LOWER_STATES, "minecraft:air"), undefined);
            assert.equal(planDoorCompletion("bh:chest", LOWER_STATES, "minecraft:air"), undefined);
        });

        it("reads the upper-half state off the placed block rather than assuming its spelling", () => {
            const plan = planDoorCompletion(
                "minecraft:wooden_door",
                { "minecraft:upper_block_bit": false, direction: 2 },
                "minecraft:air"
            );

            assert.ok(plan);
            assert.deepEqual(plan.upperStates, { "minecraft:upper_block_bit": true, direction: 2 });
        });
    });

    describe("completing the pair the engine left half-built", () => {
        it("writes the upper half from the half the engine placed", () => {
            const { dim, lower, upper } = placeLowerHalf({ x: 4, y: 64, z: 4 });

            eventBus.dispatch("playerPlaceBlock", { block: lower, dimension: dim, player: new Player() });

            assert.equal(upper.typeId, "minecraft:wooden_door");
            assert.equal(upper.permutation.getState("upper_block_bit"), true);
            assert.equal(upper.permutation.getState("direction"), 1, "the pair must face the same way");
            assert.equal(upper.permutation.getState("door_hinge_bit"), false);
            assert.equal(upper.permutation.getState("open_bit"), false);
        });

        it("writes nothing when the engine already placed both halves", () => {
            const { dim, lower, upper } = placeLowerHalf({ x: 5, y: 64, z: 4 });
            upper.setPermutation(BlockPermutation.resolve("minecraft:wooden_door", {
                ...LOWER_STATES,
                upper_block_bit: true,
                direction: 3
            }));
            const placed = upper.permutation;

            eventBus.dispatch("playerPlaceBlock", { block: lower, dimension: dim, player: new Player() });

            assert.equal(upper.permutation, placed, "an intact door must not be rewritten");
            assert.equal(upper.permutation.getState("direction"), 3);
        });

        it("writes nothing into an occupied cell above", () => {
            const { dim, lower, upper } = placeLowerHalf({ x: 6, y: 64, z: 4 });
            upper.setPermutation(BlockPermutation.resolve("minecraft:stone"));
            const placed = upper.permutation;

            eventBus.dispatch("playerPlaceBlock", { block: lower, dimension: dim, player: new Player() });

            assert.equal(upper.typeId, "minecraft:stone");
            assert.equal(upper.permutation, placed);
        });

        it("ignores a placed block that is not a door", () => {
            const dim = dimension();
            const block = dim.getBlock({ x: 7, y: 64, z: 4 });
            block.setPermutation(BlockPermutation.resolve("minecraft:oak_log"));
            const placed = block.permutation;

            eventBus.dispatch("playerPlaceBlock", { block, dimension: dim, player: new Player() });

            assert.equal(block.permutation, placed);
        });
    });

    describe("the era's top-face-only placement rule", () => {
        function placeEvent(face: string, permutationToPlace: BlockPermutation, player: Player) {
            const dim = dimension();
            return {
                cancel: false,
                face,
                permutationToPlace,
                player,
                block: dim.getBlock({ x: 8, y: 63, z: 4 }),
                dimension: dim
            };
        }

        it("cancels a door put up against a wall", () => {
            const event = placeEvent(
                Direction.North,
                BlockPermutation.resolve("minecraft:wooden_door"),
                doorPlacer()
            );

            eventBus.dispatch("playerPlaceBlockBefore", event);

            assert.equal(event.cancel, true, "Beta refused a door on anything but the top face");
        });

        it("allows a door placed on the ground", () => {
            const event = placeEvent(
                Direction.Up,
                BlockPermutation.resolve("minecraft:wooden_door"),
                doorPlacer()
            );

            eventBus.dispatch("playerPlaceBlockBefore", event);

            assert.equal(event.cancel, false);
        });

        it("leaves placements that are not the pack's doors alone", () => {
            const withoutDoor = placeEvent(
                Direction.North,
                BlockPermutation.resolve("minecraft:wooden_door"),
                new Player("empty_hands", "EmptyHands")
            );
            const otherBlock = placeEvent(
                Direction.North,
                BlockPermutation.resolve("minecraft:oak_planks"),
                doorPlacer()
            );

            eventBus.dispatch("playerPlaceBlockBefore", withoutDoor);
            eventBus.dispatch("playerPlaceBlockBefore", otherBlock);

            assert.equal(withoutDoor.cancel, false);
            assert.equal(otherBlock.cancel, false);
        });
    });
});
