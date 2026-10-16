import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    Container,
    EntityComponentTypes,
    EntityDamageCause,
    ItemStack,
    Player,
    activeJobs,
    resetMocks,
    system
} from "@minecraft/server";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { tickManager } from "../../packs/BP/scripts/core/tickManager.js";
import "../../packs/BP/scripts/player/achievements.js";
import { mockPlayers } from "../mocks/minecraftServer.js";

/**
 * The module is driven the way the engine drives it — the bus, a first join and the hundred-tick
 * sweep — so each case is about this system's own rules: which flag an event writes, and which
 * child stays unwritten because its parent has not landed yet. Nothing here proves a toast.
 */
const ACH = Object.freeze({
    TAKING_INVENTORY: "inv",
    GETTING_WOOD: "wood",
    BENCHMARKING: "bench",
    TIME_TO_STRIKE: "sword",
    TIME_TO_FARM: "hoe",
    TIME_TO_MINE: "pick",
    MONSTER_HUNTER: "kill",
    COW_TIPPER: "cow",
    WHEN_PIGS_FLY: "pig",
    BAKE_BREAD: "bread",
    THE_LIE: "cake",
    GETTING_UPGRADE: "stone",
    DELICIOUS_FISH: "fish",
    HOT_TOPIC: "furnace",
    ACQUIRE_HARDWARE: "iron",
    ON_A_RAIL: "rail"
});

/** The flag the module writes per achievement, which is the state every case reads. */
function unlocked(player: Player, key: string): boolean {
    return player.getDynamicProperty(`ach:${key}`) === true;
}

function makePlayer(items: string[] = [], riding?: unknown): Player {
    const container = new Container(36);
    items.forEach((id, slot) => container.setItem(slot, new ItemStack(id, 1)));

    const player = new Player("achiever", "Achiever");
    player.setComponent(EntityComponentTypes.Inventory, { container });
    if (riding) {
        player.setComponent(EntityComponentTypes.Riding, { entityRidingOn: riding });
    }
    mockPlayers.push(player);
    return player;
}

function join(player: Player, initialSpawn = true): void {
    eventBus.dispatch("playerSpawn", { player, initialSpawn } as any);
}

function breakBlock(player: Player, blockId: string): void {
    eventBus.dispatch("playerBreakBlock", {
        player,
        brokenBlockPermutation: { type: { id: blockId } }
    } as any);
}

function killHostile(player: Player, victimId = "minecraft:zombie"): void {
    eventBus.dispatch("entityDie", {
        damageSource: { damagingEntity: player },
        deadEntity: { typeId: victimId }
    } as any);
}

function fallWithRider(player: Player): void {
    const pig = { typeId: "minecraft:pig", getComponent: () => ({ getRiders: () => [player] }) };
    eventBus.dispatch("entityHurt", {
        hurtEntity: pig,
        damageSource: { cause: EntityDamageCause.fall }
    } as any);
}

function chat(player: Player, message: string): void {
    eventBus.dispatch("chatSend", { sender: player, message } as any);
}

/**
 * The sweep is a tickManager task whose generator the job runner schedules, so one pass means firing
 * the schedule and then draining the job it started. A hundred and one steps fire it exactly once
 * whatever tick the manager is on, because its phase is fixed and its interval is a hundred ticks.
 */
function runSweep(): void {
    for (let step = 0; step < 101; step++) {
        tickManager.step();
    }

    let guard = 0;
    while (activeJobs.length > 0 && guard++ < 500) {
        system.advanceTicks(1);
    }
}

describe("Beta achievements", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("grants the root only on a first join, and the log beyond it only once the root is there", () => {
        const player = makePlayer(["minecraft:oak_log"]);

        join(player, false);
        assert.equal(unlocked(player, ACH.TAKING_INVENTORY), false, "a respawn is not the first join");

        breakBlock(player, "minecraft:oak_log");
        assert.equal(
            unlocked(player, ACH.GETTING_WOOD),
            false,
            "the log sits behind the inventory achievement, which nothing has granted yet"
        );

        join(player);
        assert.equal(unlocked(player, ACH.TAKING_INVENTORY), true);

        breakBlock(player, "minecraft:oak_log");
        assert.equal(unlocked(player, ACH.GETTING_WOOD), true, "and the same break lands on an unlocked parent");

        const announced = player.messagesSent.length;
        breakBlock(player, "minecraft:oak_log");
        breakBlock(player, "minecraft:stone");
        assert.equal(
            player.messagesSent.length,
            announced,
            "neither a repeat of an earned one nor a block that is not a log announces anything"
        );
    });

    it("unlocks the tree from the inventory and the seat, parents before the children that need them", () => {
        const minecart = { typeId: "minecraft:minecart", isValid: true };
        const player = makePlayer([
            "minecraft:oak_log",
            "bh:crafting_table",
            "minecraft:wooden_sword",
            "minecraft:wooden_hoe",
            "minecraft:stone_pickaxe",
            "minecraft:leather",
            "bh:bread",
            "bh:cake",
            "bh:cooked_cod",
            "minecraft:furnace",
            "minecraft:iron_ingot"
        ], minecart);

        runSweep();

        // Every row here is behind at least one parent, and each one lands in the pass that read it.
        const earned = [
            ACH.TAKING_INVENTORY, ACH.GETTING_WOOD, ACH.BENCHMARKING, ACH.TIME_TO_STRIKE,
            ACH.TIME_TO_FARM, ACH.TIME_TO_MINE, ACH.COW_TIPPER, ACH.BAKE_BREAD, ACH.THE_LIE,
            ACH.GETTING_UPGRADE, ACH.HOT_TOPIC, ACH.ACQUIRE_HARDWARE, ACH.ON_A_RAIL
        ];

        for (const key of earned) {
            assert.equal(unlocked(player, key), true, `${key} is in the inventory or the seat this pass read`);
        }

        // The exception, and the reason the sweep runs twice here: the pass grants Delicious Fish
        // before it grants Hot Topic, which is the fish's own parent, so the fish waits a sweep.
        assert.equal(unlocked(player, ACH.DELICIOUS_FISH), false, "the fish is read before its parent is granted");

        runSweep();

        assert.equal(unlocked(player, ACH.DELICIOUS_FISH), true, "so it lands on the pass after the furnace");

        assert.equal(unlocked(player, ACH.MONSTER_HUNTER), false, "a kill is not in an inventory");
        assert.equal(unlocked(player, ACH.WHEN_PIGS_FLY), false, "and neither is a pig fall");

        killHostile(player);
        assert.equal(
            unlocked(player, ACH.MONSTER_HUNTER),
            true,
            "the hostile kill lands once the sword in front of it is unlocked"
        );

        fallWithRider(player);
        assert.equal(
            unlocked(player, ACH.WHEN_PIGS_FLY),
            true,
            "and so does the pig fall, behind the leather that parents it"
        );
    });

    it("refuses every child whose parent is still locked, on each path that can grant one", () => {
        // An ingot on its own reaches none of the chain above it, so this is the gate rather than the
        // trigger: each attempt is made with the conditions the module tests for, and none lands.
        const player = makePlayer(["minecraft:iron_ingot"]);

        breakBlock(player, "minecraft:oak_log");
        killHostile(player);
        fallWithRider(player);

        assert.equal(unlocked(player, ACH.GETTING_WOOD), false, "a log with no inventory achievement");
        assert.equal(unlocked(player, ACH.MONSTER_HUNTER), false, "a kill with no sword");
        assert.equal(unlocked(player, ACH.WHEN_PIGS_FLY), false, "a pig fall with no leather");

        runSweep();

        assert.equal(unlocked(player, ACH.TAKING_INVENTORY), true, "the pass still grants the root it can see");
        assert.equal(
            unlocked(player, ACH.ACQUIRE_HARDWARE),
            false,
            "while the iron stays locked behind the furnace it is waiting on"
        );
    });

    it("reads the chat command as the list of what is earned, and as the reset", () => {
        const player = makePlayer();
        join(player);

        chat(player, "!ach");
        const listing = player.messagesSent.join("\n");
        assert.ok(
            listing.includes("Getting Wood") && listing.includes("Need: Getting Wood"),
            "a child whose parent has landed is shown as reachable, and a grandchild names the parent it waits on"
        );

        chat(player, "!achievements reset");
        assert.equal(unlocked(player, ACH.TAKING_INVENTORY), false, "the reset clears every flag");

        const before = player.messagesSent.length;
        chat(player, "!ach");
        const afterReset = player.messagesSent.slice(before).join("\n");
        assert.ok(
            afterReset.includes("Need: Taking Inventory"),
            "and the list shows the root as missing again, which it was not before the reset"
        );
    });
});
