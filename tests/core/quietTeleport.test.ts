import test from "node:test";
import assert from "node:assert/strict";
import {
    Player,
    commandFeedbackWrites,
    resetMocks,
    scheduledTimeouts,
    world
} from "../mocks/minecraftServer.js";
import { TELEPORT_DELAY_TICKS, teleportQuietly } from "../../packs/BP/scripts/core/quietTeleport.js";

/**
 * The mock's `sendcommandfeedback` write log is the whole observable here, and Bedrock is what decides
 * whether a muted gamerule actually silences the engine's teleport message — a question no offline test
 * can answer. So these cases pin the helper's wiring (order, extent, restore) and nothing about the game.
 */
function drainDeferred(): void {
    const due = scheduledTimeouts.splice(0, scheduledTimeouts.length);
    for (const item of due) {
        item.callback();
    }
}

function takeDeferred(predicate: (item: { timeout: number }) => boolean) {
    const taken = scheduledTimeouts.filter(predicate);
    for (const item of taken) {
        scheduledTimeouts.splice(scheduledTimeouts.indexOf(item), 1);
    }
    return taken;
}

function takeOneDeferred(predicate: (item: { timeout: number }) => boolean) {
    const [taken] = scheduledTimeouts.splice(scheduledTimeouts.findIndex(predicate), 1);
    return taken;
}

const isMove = (item: { timeout: number }) => item.timeout === TELEPORT_DELAY_TICKS;
const isRestore = (item: { timeout: number }) => item.timeout >= 10;

function makePlayer(id: string): Player {
    const player = new Player(id, "fyreic");
    player.location = { x: 0, y: 64, z: 0 };
    return player;
}

test("Quiet teleport", async (t) => {
    t.beforeEach(() => {
        resetMocks();
    });

    await t.test("turns the rule off a tick before the move, and puts it back after the window", () => {
        const player = makePlayer("quiet_move");

        teleportQuietly(player, { x: 12, y: 70, z: -4 });

        assert.deepEqual(commandFeedbackWrites, [false], "feedback is off before the move is issued");
        assert.equal(world.gameRules.sendCommandFeedback, false);
        assert.deepEqual(player.location, { x: 0, y: 64, z: 0 }, "the move waits for the rule to land");

        drainDeferred();

        assert.deepEqual(player.location, { x: 12, y: 70, z: -4 }, "the move still happens");
        assert.deepEqual(commandFeedbackWrites, [false, true], "the restore ends the mute");
        assert.equal(world.gameRules.sendCommandFeedback, true);
    });

    await t.test("says nothing in the player's chat", () => {
        const player = makePlayer("quiet_silent");

        teleportQuietly(player, { x: 12, y: 70, z: -4 });
        drainDeferred();

        assert.deepEqual(player.messagesSent, [], "a teleport is not an announcement of its own");
    });

    await t.test("holds the mute past the call, because the engine reports the placement", () => {
        const player = makePlayer("quiet_placement");

        teleportQuietly(player, { x: 5, y: 64, z: 5 });

        assert.deepEqual(commandFeedbackWrites, [false]);
        assert.equal(takeDeferred(isMove).length, 1, "the move is the only work the mute pushes to the next tick");
        assert.equal(
            takeDeferred(isRestore).length,
            1,
            "a shorter window cannot cover a placement that lands after the call returns"
        );
    });

    await t.test("holds the mute until the last move in the window is done", () => {
        const first = makePlayer("quiet_first");
        const second = makePlayer("quiet_second");

        teleportQuietly(first, { x: 1, y: 64, z: 1 });
        teleportQuietly(second, { x: 2, y: 64, z: 2 });

        assert.deepEqual(commandFeedbackWrites, [false], "one mute covers both moves");
        assert.deepEqual(
            second.location,
            { x: 0, y: 64, z: 0 },
            "a move inside the window still waits, because the rule write it follows is a tick behind"
        );

        for (const move of takeDeferred(isMove)) move.callback();

        assert.equal(scheduledTimeouts.filter(isRestore).length, 2, "each move inside the window arms its own restore");

        // The first move's restore must not unmute the second one's window.
        takeOneDeferred(isRestore).callback();

        assert.deepEqual(commandFeedbackWrites, [false]);
        assert.equal(world.gameRules.sendCommandFeedback, false, "feedback stays off until the last move is out");

        drainDeferred();

        assert.deepEqual(commandFeedbackWrites, [false, true]);
    });

    await t.test("leaves a world that had feedback off alone", () => {
        // A world can arrive with `sendcommandfeedback false`, and the helper is not the thing that may
        // switch it back on: it writes `false` only over an actual `true`.
        world.gameRules.sendCommandFeedback = false;
        commandFeedbackWrites.length = 0;

        const player = makePlayer("quiet_world_off");
        teleportQuietly(player, { x: 3, y: 64, z: 3 });
        drainDeferred();

        assert.deepEqual(commandFeedbackWrites, []);
        assert.equal(world.gameRules.sendCommandFeedback, false);
    });

    await t.test("moves the player even when the gamerule write is refused", () => {
        const player = makePlayer("quiet_refused");
        const original = Object.getOwnPropertyDescriptor(world, "gameRules");

        // A restricted-execution refusal is the one way the mute can fail, and the move must not fail with it.
        Object.defineProperty(world, "gameRules", {
            configurable: true,
            get: () => ({
                get sendCommandFeedback() {
                    return true;
                },
                set sendCommandFeedback(_value: boolean) {
                    throw new Error("restricted execution");
                }
            })
        });

        try {
            teleportQuietly(player, { x: 9, y: 64, z: 9 });
        } finally {
            if (original) Object.defineProperty(world, "gameRules", original);
        }

        assert.deepEqual(player.location, { x: 9, y: 64, z: 9 }, "a refused mute must not cost the teleport");
    });
});
