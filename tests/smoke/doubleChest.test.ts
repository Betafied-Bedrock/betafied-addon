import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    DOUBLE_CHEST_ID,
    DOUBLE_CHEST_SLOTS,
    INVERSE_DIRECTION,
    PAIR_LAYOUTS,
    PAIR_STATE_BY_LATCH,
    SINGLE_CHEST_ID,
    SINGLE_CHEST_SLOTS,
    clampSlots,
    dropOfflineViewers,
    mergeContents,
    pairKey,
    partHome,
    planChestPlacement,
    planClose,
    planOpen,
    planOpenBlock,
    planPair,
    planPlacement,
    planPlacementBlocked,
    planSweep,
    resolveHalf
} from "../../packs/BP/scripts/interactions/chest/chestPairing.js";

const root = process.cwd();

function readJson(path: string): any {
    return JSON.parse(readFileSync(path, "utf-8"));
}

function blockOf(name: string): any {
    return readJson(resolve(root, "packs/BP/blocks", `${name}.json`))["minecraft:block"];
}

const doubleChest = blockOf("double_chest");
const singleChest = blockOf("chest");

function texturesOf(block: any): string[] {
    const instances = [block.components, ...(block.permutations ?? []).map((p: any) => p.components)];
    return instances.flatMap(components =>
        Object.values(components["minecraft:material_instances"] ?? {}).map((instance: any) => instance.texture)
    );
}

// The viewer's left when looking at the latch: the half that must own slots 0-26.
const VIEWER_LEFT: Record<string, { x: number; z: number }> = {
    south: { x: -1, z: 0 },
    north: { x: 1, z: 0 },
    east: { x: 0, z: 1 },
    west: { x: 0, z: -1 }
};

const NEIGHBOUR_OFFSETS = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 }
];

const LATCHES = ["north", "south", "east", "west"] as const;

function permutationFor(part: number, state: string): any {
    const condition = `q.block_state('minecraft:multi_block_part') == ${part} && q.block_state('minecraft:cardinal_direction') == '${state}'`;
    return doubleChest.permutations.find((p: any) => p.condition === condition);
}

describe("Classic Block Contract - Beta 1.7.3 double chest", () => {
    it("spans two blocks so the halves can share one inventory", () => {
        assert.deepEqual(doubleChest.description.traits["minecraft:multi_block"], {
            enabled_states: ["minecraft:multi_block_part"],
            parts: 2,
            direction: "east"
        });

        // `direction` is only the fallback for a pair with no state to read: the trait hands the
        // part axis to cardinal_direction, which is what lets one block pair on either axis.
        assert.deepEqual(doubleChest.description.traits["minecraft:placement_direction"], {
            enabled_states: ["minecraft:cardinal_direction"]
        });

        const container = doubleChest.components["minecraft:block_entity"].container;
        const single = singleChest.components["minecraft:block_entity"].container;
        assert.equal(container.slot_count, single.slot_count * 2, "a double chest holds exactly two singles' worth");
    });

    // The single chest's own cube is the chest block contract's case; this one is the pair's.
    it("stays one solid cube no piston can split", () => {
        assert.equal(doubleChest.components["minecraft:geometry"].identifier, "minecraft:geometry.full_block");
        assert.deepEqual(doubleChest.components["minecraft:collision_box"], { origin: [-8, 0, -8], size: [16, 16, 16] });

        // A multi-block accepts only popped or immovable, and popped would let a piston destroy one
        // half on its own, which both strands the other half and hands back the whole pair's loot.
        assert.equal(
            doubleChest.components["minecraft:movable"]["movement_type"],
            "immovable",
            "pistons must not be able to split the pair"
        );
    });

    it("dresses both halves for every layout the script can build, and registers every texture it names", () => {
        assert.equal(doubleChest.permutations.length, 8, "two halves across four layouts");

        for (const [state, layout] of Object.entries(PAIR_LAYOUTS)) {
            const back = INVERSE_DIRECTION[layout.latch];

            for (const part of [0, 1]) {
                const permutation = permutationFor(part, state);
                assert.ok(permutation, `the ${state} layout is missing its part ${part} permutation`);

                const instances = permutation.components["minecraft:material_instances"];
                const half = part === 0 ? "left" : "right";

                assert.equal(
                    instances[layout.latch].texture,
                    `bh_chest_${half}_front`,
                    `${state} part ${part} must wear its ${half} face on the ${layout.latch} side`
                );
                assert.equal(instances[back].texture, `bh_chest_${half}_back`, `${state} part ${part} back`);
                assert.equal(instances["up"].texture, "bh_chest_top");
            }
        }

        const atlas = readJson(resolve(root, "packs/RP/textures/terrain_texture.json")).texture_data;

        for (const texture of texturesOf(doubleChest)) {
            assert.ok(atlas[texture], `double_chest references '${texture}', which is missing from terrain_texture.json`);
        }
    });

    it("keeps every layout on a long latch, part 0 on the viewer's left, and an exact inverse", () => {
        for (const [state, layout] of Object.entries(PAIR_LAYOUTS)) {
            const axis = layout.step.x !== 0 ? "x" : "z";
            const latchAxis = layout.latch === "east" || layout.latch === "west" ? "x" : "z";

            assert.notEqual(latchAxis, axis, `${state}: a latch cannot sit on the end the halves run toward`);
            assert.equal(PAIR_STATE_BY_LATCH[layout.latch], state, "the latch lookup must mirror the layouts");

            // Slots 0-26 belong to the left half, so part 1 has to run from part 0 toward the
            // viewer's right when they stand in front of the latch.
            const left = VIEWER_LEFT[layout.latch];
            assert.equal(
                layout.step.x * left.x + layout.step.z * left.z,
                -1,
                `${state}: part 0 must stay on the viewer's left`
            );

            assert.deepEqual(
                PAIR_LAYOUTS[INVERSE_DIRECTION[state]].step,
                { x: 0 - layout.step.x, y: 0 - layout.step.y, z: 0 - layout.step.z },
                `${state} inverse`
            );
        }
    });

    it("breaks as one block, handing back both singles and staying axe-choppable", () => {
        const loot = doubleChest.components["minecraft:loot"];
        assert.equal(loot, "loot_tables/blocks/double_chest.json");

        const pools = readJson(resolve(root, "packs/BP", loot)).pools;
        assert.deepEqual(pools.map((pool: any) => pool.rolls), [2], "breaking a double chest must hand back two chests");
        assert.deepEqual(pools[0].entries.map((entry: any) => entry.name), [SINGLE_CHEST_ID]);

        assert.ok(
            doubleChest.components["minecraft:tags"].includes("minecraft:is_axe_item_destructible"),
            "double_chest must be chopped with an axe"
        );
    });
});

describe("Double chest mirror rules", () => {
    const idle = { masterViewers: 0, shadowViewers: 0 };

    it("mirrors the opened half's items, only for the first viewer, and never across a live session", () => {
        assert.equal(
            planOpen({ half: "shadow", firstViewer: true, masterHasItems: true, shadowHasItems: false, ...idle }),
            "master-to-shadow"
        );
        assert.equal(
            planOpen({ half: "master", firstViewer: true, masterHasItems: false, shadowHasItems: true, ...idle }),
            "shadow-to-master"
        );

        // Nothing to move when the opened half already holds them, when a second viewer joins the
        // half that is already the live container, or when the other half has a session open.
        assert.equal(
            planOpen({ half: "shadow", firstViewer: true, masterHasItems: false, shadowHasItems: true, ...idle }),
            "none",
            "the opened half already holds the items"
        );
        assert.equal(
            planOpen({ half: "shadow", firstViewer: false, masterHasItems: true, shadowHasItems: true, masterViewers: 0, shadowViewers: 1 }),
            "none",
            "the same half opened again is the live container, not a second move"
        );
        assert.equal(
            planOpen({ half: "shadow", firstViewer: true, masterHasItems: true, shadowHasItems: false, masterViewers: 1, shadowViewers: 0 }),
            "none",
            "a shadow viewer would watch the master's items vanish mid-session"
        );

        assert.equal(
            planOpenBlock({ half: "master", masterViewers: 0, shadowViewers: 1 }),
            true,
            "the live shadow session would watch this half's items vanish"
        );
        assert.equal(planOpenBlock({ half: "master", masterViewers: 1, shadowViewers: 0 }), false, "this half's own viewer joins");
    });

    it("returns the right half's leftovers to the master once its last viewer leaves, and drains only while nobody holds it", () => {
        assert.equal(planClose({ half: "shadow", remainingViewers: 0, shadowHasItems: true }), "shadow-to-master");
        assert.equal(planClose({ half: "shadow", remainingViewers: 1, shadowHasItems: true }), "none", "a remaining viewer still holds them");
        assert.equal(planClose({ half: "master", remainingViewers: 0, shadowHasItems: true }), "none", "the master half is already home");

        assert.equal(planSweep({ shadowViewers: 0, shadowHasItems: true }), "shadow-to-master");
        assert.equal(planSweep({ shadowViewers: 1, shadowHasItems: true }), "none");
    });

    it("forgets viewers whose player is no longer online", () => {
        const viewers = new Set(["alice", "bob"]);

        assert.equal(dropOfflineViewers(viewers, new Set(["alice", "bob", "carol"])), 0);
        assert.deepEqual([...viewers], ["alice", "bob"]);

        assert.equal(dropOfflineViewers(viewers, new Set(["carol"])), 2);
        assert.deepEqual([...viewers], []);
    });
});

describe("Chest relocation helpers", () => {
    it("puts part 0 on the cell the layout's step runs from, for every latch and every neighbour", () => {
        const origin = { x: 0, y: 0, z: 0 };

        for (const latch of LATCHES) {
            for (const offset of NEIGHBOUR_OFFSETS) {
                const plan = planPair(latch, [{ offset, latch }]);
                assert.ok(plan, `${latch} beside ${offset.x},${offset.z} must pair`);

                const step = PAIR_LAYOUTS[plan.state].step;
                const master = plan.masterOffset;
                const shadow = { x: master.x + step.x, y: master.y + step.y, z: master.z + step.z };
                const other =
                    master.x === offset.x && master.y === offset.y && master.z === offset.z ? origin : offset;

                assert.equal(PAIR_LAYOUTS[plan.state].latch, plan.latch, "the layout must wear the planned latch");
                assert.deepEqual(shadow, other, "part 1 must be the other half of the pair");
            }
        }
    });

    it("wears the latch the placer just saw, even when the placed chest's own latch is on the end", () => {
        assert.deepEqual(planPair("east", [{ offset: { x: 1, y: 0, z: 0 }, latch: "south" }]), {
            state: "east",
            latch: "south",
            masterOffset: { x: 0, y: 0, z: 0 }
        });

        // Two partners on offer: the pair forms on the one whose latch the placer was looking at.
        const plan = planPair("south", [
            { offset: { x: 0, y: 0, z: 1 }, latch: "east" },
            { offset: { x: -1, y: 0, z: 0 }, latch: "south" }
        ]);

        assert.equal(plan?.latch, "south");
        assert.equal(plan?.state, "east");
        assert.deepEqual(plan?.masterOffset, { x: -1, y: 0, z: 0 });
    });

    it("falls back to a readable side when no latch survives, and ignores anything off-axis", () => {
        // Latch north with the partner directly north leaves no latch on a long face at all.
        assert.deepEqual(planPair("north", [{ offset: { x: 0, y: 0, z: -1 }, latch: "north" }]), {
            state: "north",
            latch: "east",
            masterOffset: { x: 0, y: 0, z: 0 }
        });

        // Neither chest can offer a latch: the pair still forms on a readable side.
        assert.deepEqual(planPair(undefined, [{ offset: { x: 1, y: 0, z: 0 }, latch: undefined }]), {
            state: "east",
            latch: "south",
            masterOffset: { x: 0, y: 0, z: 0 }
        });

        // A diagonal and an empty neighbourhood are no pair at all.
        assert.equal(planPair("north", [{ offset: { x: 1, y: 0, z: 1 }, latch: "north" }]), undefined);
        assert.equal(planPair("north", []), undefined);
    });

    it("lands the left half's inventory in slots 0-26 and the right half's in 27-53", () => {
        const west = ["a", undefined, "b"];
        const east = [undefined, "c"];

        const merged = mergeContents(west, east);

        assert.deepEqual(merged.slice(0, 3), west);
        assert.deepEqual(merged.slice(3), east);
    });

    it("maps a chest onto its pair's cells, and keys that pair per dimension", () => {
        const west = { x: 5, y: 64, z: 5 };
        const east = { x: 6, y: 64, z: 5 };

        assert.deepEqual(resolveHalf(0, west, "east"), { half: "master", master: west, shadow: east });
        assert.deepEqual(resolveHalf(1, east, "east"), { half: "shadow", master: west, shadow: east });

        const location = { x: 0, y: 0, z: 0 };
        assert.equal(resolveHalf(2, location, "east"), undefined);
        assert.equal(resolveHalf(undefined, location, "east"), undefined);
        assert.equal(resolveHalf(0, location, undefined), undefined, "a half with no layout cannot be resolved");
        assert.equal(resolveHalf(0, location, "up"), undefined, "only the four cardinal layouts exist");

        assert.notEqual(
            pairKey("minecraft:overworld", { x: 1, y: 2, z: 3 }),
            pairKey("minecraft:the_nether", { x: 1, y: 2, z: 3 }),
            "the same coordinates in another dimension are a different pair"
        );
    });

    it("moves whole stacks into the destination's own slot or its first free one, and clamps slot work to the container's size", () => {
        const inOrder = planPlacement(
            [undefined, undefined, "a", undefined, "b"],
            [undefined, undefined, undefined, undefined, undefined]
        );

        assert.deepEqual(inOrder.destination, [undefined, undefined, "a", undefined, "b"]);
        assert.deepEqual(inOrder.moves, [{ from: 2, to: 2 }, { from: 4, to: 4 }]);

        const displaced = planPlacement(["a", "b"], ["c", undefined, undefined]);
        assert.deepEqual(displaced.destination, ["c", "a", "b"], "a taken own slot sends the stack to the lowest free one");
        assert.deepEqual(displaced.moves, [{ from: 0, to: 1 }, { from: 1, to: 2 }]);

        const full = planPlacement(["a", "b"], ["c", "d"]);
        assert.deepEqual(full.destination, ["c", "d"]);
        assert.deepEqual(full.source, ["a", "b"], "a stack with nowhere to go stays in its own half");
        assert.deepEqual(full.moves, []);

        // A half that kept the 27 slots of the single it was converted from must not be read past
        // slot 26: every slot the pair touches is bounded by the container's own size.
        assert.equal(clampSlots(DOUBLE_CHEST_SLOTS, SINGLE_CHEST_SLOTS), SINGLE_CHEST_SLOTS);
        assert.equal(clampSlots(DOUBLE_CHEST_SLOTS, undefined), 0, "a container with no readable size is never addressed");
    });

    it("finds the half the engine made part 0", () => {
        // The engine places the parts itself, so the merge has to read back which cell it made the
        // pair's home rather than assume the one the plan called the master.
        assert.equal(partHome(0, 1), "master");
        assert.equal(partHome("0", "1"), "master", "a part state read back as text still names its cell");
        assert.equal(partHome(0, 0), undefined, "two of the same part are not one pair");
    });

    it("lets a chest stand alone or beside one single, and refuses to open one with a block resting on it", () => {
        assert.equal(planChestPlacement([]), true, "a chest with no neighbour becomes a single");
        assert.equal(planChestPlacement([SINGLE_CHEST_ID]), true, "one single neighbour is the other half of the pair");

        // Two singles beside the new cell means only one can pair, leaving the other touching a
        // chest it is not half of - a dangling neighbour the era refused outright. A neighbour that
        // is already half of a large chest can never take a second partner either.
        assert.equal(planChestPlacement([SINGLE_CHEST_ID, SINGLE_CHEST_ID]), false);
        assert.equal(planChestPlacement([DOUBLE_CHEST_ID]), false);

        assert.equal(planPlacementBlocked({ placing: false, aboveSolid: true }), true);
        assert.equal(
            planPlacementBlocked({ placing: true, aboveSolid: true }),
            false,
            "a crouched item being placed against the face is not the chest being opened"
        );
    });
});
