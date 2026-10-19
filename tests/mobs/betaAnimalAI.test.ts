import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EntityComponentTypes, ItemStack } from "@minecraft/server";
import {
    animalJumpJob,
    applyRandomHop,
    evaluateHopConditions,
    shearPunchedSheep,
    WOOL_DROP_MAX,
    WOOL_DROP_MIN
} from "../../packs/BP/scripts/mobs/betaAnimalAI.js";
import {
    resetMocks,
    scheduledTimeouts,
    world,
    Player,
    mockPlayers,
    mockEntities
} from "../mocks/minecraftServer.js";

describe("Beta Animal AI Generator Batching", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("yields part-way through the pass, completes on the last animal, and skips a despawned one", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("steve");
        player.dimension = overworld;
        player.location = { x: 0, y: 64, z: 0 };
        mockPlayers.push(player);

        for (let i = 0; i < 15; i++) {
            overworld.spawnEntity("minecraft:pig", { x: 0, y: 64, z: 0 });
        }
        overworld.spawnEntity("minecraft:pig", { x: 0, y: 64, z: 0 }).isValid = false;

        const job = animalJumpJob();
        assert.equal(job.next().done, false, "the pass yields with animals still to evaluate");

        let step = job.next();
        while (!step.done) step = job.next();
        assert.equal(step.done, true, "and finishes on the pass that evaluates the last one");
    });

    it("re-resolves animals by ID across yield boundaries without holding live references", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("steve");
        player.dimension = overworld;
        player.location = { x: 0, y: 64, z: 0 };
        mockPlayers.push(player);

        const animals: any[] = [];
        for (let i = 0; i < 15; i++) {
            animals.push(overworld.spawnEntity("minecraft:pig", { x: 0, y: 64, z: 0 }));
        }

        const job = animalJumpJob();
        job.next(); // First batch of 10

        // Despawn remaining animals and detect if stale references are touched
        let staleAccessed = false;
        for (let i = 10; i < 15; i++) {
            mockEntities.delete(animals[i].id);
            Object.defineProperty(animals[i], "typeId", {
                get() {
                    staleAccessed = true;
                    return "minecraft:pig";
                }
            });
        }

        while (!job.next().done) {}
        assert.equal(staleAccessed, false, "stale animal handles from earlier ticks must not be accessed");
    });

    it("does not re-query getAllPlayers on every animal iteration within a batch", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("steve");
        player.dimension = overworld;
        player.location = { x: 0, y: 64, z: 0 };
        mockPlayers.push(player);

        for (let i = 0; i < 5; i++) {
            overworld.spawnEntity("minecraft:pig", { x: 0, y: 64, z: 0 });
        }

        let playerQueries = 0;
        const originalGetAll = world.getAllPlayers.bind(world);
        world.getAllPlayers = () => {
            playerQueries++;
            return originalGetAll();
        };

        const job = animalJumpJob();
        while (!job.next().done) {}

        world.getAllPlayers = originalGetAll;

        assert.equal(playerQueries, 1, `expected 1 player query across the batch, got ${playerQueries}`);
    });
});


/**
 * Pins the hop roll for one case: a chance-based trigger is a threshold question, so the test asserts
 * what the mob does at a roll that clears the threshold instead of retrying until it lands.
 */
function withFixedRoll(roll: number, body: () => void): void {
    const original = Math.random;
    Math.random = () => roll;
    try {
        body();
    } finally {
        Math.random = original;
    }
}

describe("Beta Animal AI - Hop Triggers", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("fires for an obstacle, a liquid footing and a crowded pen, and stays quiet when the roll misses", () => {
        const cow = {
            id: "cow_1",
            typeId: "minecraft:cow",
            isValid: true,
            location: { x: 10.5, y: 64, z: 10.5 },
            getViewDirection: () => ({ x: 1, y: 0, z: 0 })
        };
        const obstacleField = {
            getBlock: (loc: { x: number }) => loc.x === 10
                ? { isSolid: false, isLiquid: false, typeId: "minecraft:air" }
                : { isSolid: true, isLiquid: false, typeId: "minecraft:stone" },
            getEntities: () => []
        };

        withFixedRoll(0, () => {
            assert.equal(evaluateHopConditions(cow as any, obstacleField as any), true, "the block ahead earns the hop");
        });
        withFixedRoll(0.99, () => {
            assert.equal(
                evaluateHopConditions(cow as any, obstacleField as any),
                false,
                "and earns nothing when the roll misses the threshold"
            );
        });

        const pig = {
            id: "pig_1",
            typeId: "minecraft:pig",
            isValid: true,
            location: { x: 5, y: 60, z: 5 },
            getViewDirection: () => ({ x: 0, y: 0, z: 1 })
        };
        const waterField = {
            getBlock: () => ({ isSolid: false, isLiquid: true, typeId: "minecraft:water" }),
            getEntities: () => []
        };

        // Each branch is pinned at a roll only that branch answers: 0.5 clears the water chance but
        // not the wander fallback, so removing the branch would flip the assertion.
        withFixedRoll(0.5, () => {
            assert.equal(evaluateHopConditions(pig as any, waterField as any), true, "a liquid footing earns the surface bob");
        });

        const sheep = {
            id: "sheep_1",
            typeId: "minecraft:sheep",
            isValid: true,
            location: { x: 20, y: 64, z: 20 },
            getViewDirection: () => ({ x: 0, y: 0, z: 0 })
        };
        const penField = {
            getBlock: () => ({ isSolid: false, isLiquid: false, typeId: "minecraft:air" }),
            getEntities: () => [
                { id: "sheep_2", typeId: "minecraft:sheep", isValid: true },
                { id: "cow_2", typeId: "minecraft:cow", isValid: true }
            ]
        };

        withFixedRoll(0.3, () => {
            assert.equal(evaluateHopConditions(sheep as any, penField as any), true, "neighbours of its own kind earn the crowd hop");
        });
    });

    it("stops at the water answer instead of asking the questions a dry animal asks", () => {
        const wadingCow = {
            id: "cow_wading",
            typeId: "minecraft:cow",
            isValid: true,
            location: { x: 10.5, y: 63, z: 10.5 },
            getViewDirection: () => ({ x: 1, y: 0, z: 0 })
        };
        const wadingField = {
            getBlock: (loc: { x: number }) => loc.x === 10
                ? { isSolid: false, isLiquid: true, typeId: "minecraft:water" }
                : { isSolid: true, isLiquid: false, typeId: "minecraft:stone" },
            getEntities: () => []
        };

        // 0.8 is above the water chance (0.70) and below the obstacle chance (0.85), so a true answer
        // here could only come from consulting the block ahead: the water roll is what decides.
        withFixedRoll(0.8, () => {
            assert.equal(
                evaluateHopConditions(wadingCow as any, wadingField as any),
                false,
                "the water roll is the answer, and does not hand the hop to the block ahead"
            );
        });
    });

    it("applies an upward and forward impulse when the hop runs", () => {
        let appliedImpulse: { x: number; y: number; z: number } | null = null;
        const mob = {
            id: "cow_test",
            typeId: "minecraft:cow",
            isValid: true,
            getVelocity: () => ({ x: 0, y: -0.078, z: 0 }),
            getViewDirection: () => ({ x: 0.8, y: 0, z: 0.6 }),
            applyImpulse: (vec: { x: number; y: number; z: number }) => {
                appliedImpulse = vec;
            }
        };

        applyRandomHop(mob as any);

        // The hop runs through a scheduled callback, so the test drains the queue itself.
        for (const scheduled of [...scheduledTimeouts]) {
            scheduled.callback();
        }

        assert.ok(appliedImpulse !== null, "a grounded mob receives the hop impulse");
        assert.ok((appliedImpulse as any).y > 0.35, "the impulse clears the ground");
        assert.ok((appliedImpulse as any).x > 0 && (appliedImpulse as any).z > 0, "and carries the mob along its view direction");
    });

    it("leaves a mob that is already falling alone", () => {
        let appliedImpulse = false;
        const fallingMob = {
            id: "cow_falling",
            typeId: "minecraft:cow",
            isValid: true,
            getVelocity: () => ({ x: 0, y: -0.5, z: 0 }),
            getViewDirection: () => ({ x: 1, y: 0, z: 0 }),
            applyImpulse: () => {
                appliedImpulse = true;
            }
        };

        applyRandomHop(fallingMob as any);
        for (const scheduled of [...scheduledTimeouts]) {
            scheduled.callback();
        }

        assert.equal(appliedImpulse, false, "a falling mob already has its momentum");
    });
});

describe("Beta Animal AI - Sheep Punching", () => {
    it("shears the sheep and drops wool of the sheep's color", () => {
        let triggeredEvent: string | null = null;
        let spawnedItem: ItemStack | null = null;

        const fakeSheep = {
            isValid: true,
            typeId: "minecraft:sheep",
            location: { x: 10, y: 64, z: 20 },
            getComponent(type: string) {
                if (type === EntityComponentTypes.Health) {
                    return { currentValue: 8 };
                }
                if (type === EntityComponentTypes.Color) {
                    return { value: 14 }; // Red wool
                }
                return null;
            },
            hasComponent() {
                return false;
            },
            triggerEvent(event: string) {
                triggeredEvent = event;
            },
            dimension: {
                spawnItem(item: ItemStack) {
                    spawnedItem = item;
                }
            }
        };

        shearPunchedSheep(fakeSheep as any);

        assert.equal(triggeredEvent, "minecraft:on_sheared", "Sheep should be sheared");
        assert.ok(spawnedItem !== null, "Wool item should be spawned");
        assert.equal((spawnedItem as ItemStack).typeId, "minecraft:red_wool", "Wool color should match sheep red color");
        const amount = (spawnedItem as ItemStack).amount;
        assert.ok(
            amount >= WOOL_DROP_MIN && amount <= WOOL_DROP_MAX,
            `Should drop ${WOOL_DROP_MIN}-${WOOL_DROP_MAX} wool blocks, got ${amount}`
        );
    });

    it("drops the same amount whether the sheep is punched or sheared", () => {
        // Shears run the engine's `minecraft:interact`, which spawns from this loot table, while a punch
        // spawns the stack from the script. The number therefore lives in two files and had already
        // drifted apart — 2-4 by shears against 1-3 by punch — so it is pinned by agreement here.
        const table = JSON.parse(
            readFileSync(resolve(process.cwd(), "packs/BP/loot_tables/entities/sheep_shear.json"), "utf-8")
        );

        const entries = table.pools.flatMap((pool: any) => pool.entries);
        const wool = entries.find((entry: any) => entry.name === "minecraft:wool");
        assert.ok(wool, "the shear table must still yield wool");

        const setCount = wool.functions.find((fn: any) => fn.function === "set_count");
        assert.ok(setCount, "the shear table must still declare a count");

        assert.equal(setCount.count.min, WOOL_DROP_MIN, "the shears drop floor must match the punch path");
        assert.equal(setCount.count.max, WOOL_DROP_MAX, "the shears drop ceiling must match the punch path");
    });

    it("does not drop extra wool if the sheep died from the hit", () => {
        let spawnedItem: ItemStack | null = null;

        const fakeDeadSheep = {
            isValid: true,
            typeId: "minecraft:sheep",
            location: { x: 10, y: 64, z: 20 },
            getComponent(type: string) {
                if (type === EntityComponentTypes.Health) {
                    return { currentValue: 0 };
                }
                return null;
            },
            hasComponent() {
                return false;
            },
            dimension: {
                spawnItem(item: ItemStack) {
                    spawnedItem = item;
                }
            }
        };

        shearPunchedSheep(fakeDeadSheep as any);

        assert.equal(spawnedItem, null, "Death loot table handles dead sheep, punch should not duplicate drop");
    });
});
