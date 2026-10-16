import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    lightCheckGenerator,
    nightmareJobRunner,
    noteBedInteraction,
    handlePlayerLeave
} from "../../packs/BP/scripts/mobs/nightmares.js";
import {
    mockPlayers,
    resetMocks,
    scheduledTimeouts,
    world,
    Player
} from "../mocks/minecraftServer.js";

const BED_ID = "minecraft:bed";
const OVERWORLD = "minecraft:overworld";
const NIGHT = 15000;

type Cell = { x: number; y: number; z: number };

/**
 * One click on a bed, delivered the way the bus delivers it: the block the engine hands the handler is
 * the one standing at that cell, so a later read of the same cell answers the same bed.
 */
function clickBed(player: Player, cell: Cell): string {
    const block = world.getDimension(OVERWORLD).getBlock(cell) as any;
    block.setType(BED_ID);

    noteBedInteraction(player, block);
    return `${OVERWORLD}:${cell.x},${cell.y},${cell.z}`;
}

/** A player standing at the bed, which is what the delayed trigger re-resolves by id. */
function sleeper(id: string, cell: Cell): Player {
    const player = new Player(id);
    player.location = { ...cell };
    mockPlayers.push(player);
    return player;
}

/** Runs every callback the module parked on the tick, in the order it parked them. */
function settle(): void {
    let ran = 0;
    while (scheduledTimeouts.length > 0) {
        if (ran++ > 50) throw new Error("the delayed work never settled");
        scheduledTimeouts.shift()!.callback();
    }
}

describe("Nightmares Spatial Job Tracking & Cancellation", () => {
    beforeEach(() => {
        resetMocks();
        nightmareJobRunner.clearAll();
        world.setTimeOfDay(0);
    });

    it("slices the spatial light check and keeps the sighting running across a yield", () => {
        const cell = { x: 0, y: 64, z: 0 };
        const player = sleeper("player_1", cell);
        const bedKey = clickBed(player, cell);

        assert.equal(nightmareJobRunner.activeCount, 1, "the click is what arms the bed's light check");

        const scan = lightCheckGenerator(OVERWORLD, cell, bedKey);

        assert.equal(scan.next().done, false, "the sweep hands the tick back instead of reading every cell");
        assert.equal(
            nightmareJobRunner.activeCount,
            1,
            "and the bed's sighting is still running on the far side of that yield"
        );
    });

    it("ends the sighting when the same bed is clicked a second time", () => {
        const cell = { x: 10, y: 64, z: 10 };
        const player = sleeper("steve_id", cell);

        clickBed(player, cell);
        assert.equal(nightmareJobRunner.activeCount, 1);

        clickBed(player, cell);

        assert.equal(nightmareJobRunner.activeCount, 0, "the second click cancels the running light check");

        clickBed(player, cell);
        assert.equal(
            nightmareJobRunner.activeCount,
            1,
            "and the earlier sighting is spent, so a later click arms a fresh scan"
        );
    });

    it("cancels the sighting when the player who clicked the bed leaves", () => {
        const cell = { x: 20, y: 64, z: 20 };
        const player = sleeper("alex_id", cell);

        clickBed(player, cell);
        assert.equal(nightmareJobRunner.activeCount, 1);

        handlePlayerLeave({ playerId: player.id });

        assert.equal(nightmareJobRunner.activeCount, 0, "a player who left can never finish the sleep");

        clickBed(player, cell);
        assert.equal(
            nightmareJobRunner.activeCount,
            1,
            "and the bed holds no sighting for the player who is gone"
        );
    });

    it("spends a trigger whose viewer cannot be resolved, without crashing the tick", () => {
        const cell = { x: 30, y: 64, z: 30 };

        // The night is what the trigger asks about, and this player is deliberately absent from the
        // world: the state a trigger finds when its viewer disconnected mid-sleep.
        world.setTimeOfDay(NIGHT);
        const gone = new Player("missing_player_id");
        gone.location = { ...cell };
        const bedKey = clickBed(gone, cell);

        // The click's own pass is registered as a job; a completed scan is what arms the trigger.
        const scan = lightCheckGenerator(OVERWORLD, cell, bedKey);
        while (!scan.next().done) {
            // The pass is sliced, and this drives all of it.
        }

        assert.doesNotThrow(() => settle(), "a viewer that cannot be resolved is a skipped trigger");

        const armed = nightmareJobRunner.activeCount;
        clickBed(gone, cell);

        assert.equal(
            nightmareJobRunner.activeCount,
            armed + 1,
            "the trigger spent the sighting, so the next click arms a fresh scan rather than consuming one"
        );
    });
});
