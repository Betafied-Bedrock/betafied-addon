import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Player, mockPlayers, resetMocks, scheduledTimeouts } from "../mocks/minecraftServer.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import "../../packs/BP/scripts/player/welcome.js";

/** Runs the work the module parked on a later tick, which is when the greeting actually goes out. */
function settle(): void {
    while (scheduledTimeouts.length > 0) {
        scheduledTimeouts.shift()!.callback();
    }
}

function spawn(player: Player, initialSpawn = true): void {
    eventBus.dispatch("playerSpawn", { player, initialSpawn });
}

describe("Welcome - the first join's greeting", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("greets a first join on the tick after the spawn, naming the build", () => {
        const player = new Player("welcome_steve", "WelcomeSteve");
        mockPlayers.push(player);

        spawn(player);
        assert.equal(
            player.messagesSent.length,
            0,
            "the greeting waits, because a spawn is where the client is still reading its screen"
        );

        settle();

        assert.equal(player.messagesSent.length, 1);
        assert.match(player.messagesSent[0], /^§e§lWelcome to Betafied!/);
        // The banner carries the release tag, which drops a zero patch: 5.9.2 and 5.10 are both
        // shapes a release ships. That the tag is the checkout's own is pinned by the carrier test.
        assert.match(player.messagesSent[0], /\(v\d+(?:\.\d+)+\)/, "and says which build it runs");
    });

    it("greets a session once, however often the spawn event repeats", () => {
        const player = new Player("welcome_repeat", "WelcomeRepeat");
        mockPlayers.push(player);

        spawn(player);
        spawn(player);
        settle();

        assert.equal(
            player.messagesSent.length,
            1,
            "the engine can deliver the spawn again; the greeting is the session's, not the event's"
        );
    });

    it("greets a player who left and came back", () => {
        const player = new Player("welcome_returning", "WelcomeReturning");
        mockPlayers.push(player);

        spawn(player);
        settle();
        eventBus.dispatch("playerLeave", { playerId: player.id });

        spawn(player);
        settle();

        assert.equal(
            player.messagesSent.length,
            2,
            "leaving is what ends the session, so the next join is greeted again"
        );
    });

    it("stays quiet for a spawn that is not a join", () => {
        const player = new Player("welcome_respawn", "WelcomeRespawn");
        mockPlayers.push(player);

        spawn(player, false);
        settle();

        assert.equal(scheduledTimeouts.length, 0, "a respawn does not even park the greeting");
        assert.equal(player.messagesSent.length, 0);
    });

    it("stays quiet when the player is gone by the time the greeting runs", () => {
        const player = new Player("welcome_gone", "WelcomeGone");
        mockPlayers.push(player);

        spawn(player);
        player.isValid = false;
        settle();

        assert.equal(
            player.messagesSent.length,
            0,
            "the delay is long enough for a disconnect, and a message to a gone handle is an error"
        );
    });
});
