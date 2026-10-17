import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fogJob } from "../../packs/BP/scripts/world/classicFog.js";
import { resetMocks, world, Player, mockPlayers } from "../mocks/minecraftServer.js";

const NETHER = "minecraft:nether";
const NETHER_FOG = "fog @s push mgg:fog_hell beta";
const CLEAR_OWN_ENTRY = "fog @s remove beta";

/**
 * The mock registers its nether under Java's `minecraft:the_nether`, which is not the id a real
 * `Dimension` reports, so this asks for the dimension whose id matches what the engine answers.
 */
function nether() {
    return world.getDimension(NETHER) as any;
}

function drain(job: Generator<void, void, unknown>): void {
    while (!job.next().done) {}
}

describe("Classic Fog Dimension Table", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("pushes the era's own fog for the Nether, not the Overworld's", () => {
        const player = new Player("nether_fog_player", "nether_fog_player");
        player.dimension = nether();
        mockPlayers.push(player);

        drain(fogJob());

        assert.deepEqual(player.commandsRun, [NETHER_FOG]);
    });

    it("leaves the Overworld alone, because the biome layer already names its fog", () => {
        // Every Overworld biome's client biome file claims the era's air fog, and a pushed entry would
        // outrank that layer and pin one colour over every biome.
        const player = new Player("overworld_fog_player", "overworld_fog_player");
        player.dimension = world.getDimension("minecraft:overworld") as any;
        mockPlayers.push(player);

        drain(fogJob());
        drain(fogJob());

        assert.deepEqual(player.commandsRun, []);
    });

    it("hands the stack back when the player crosses into the Nether and out again", () => {
        const player = new Player("fog_crosser", "fog_crosser");
        player.dimension = world.getDimension("minecraft:overworld") as any;
        mockPlayers.push(player);

        drain(fogJob());
        drain(fogJob());
        assert.deepEqual(player.commandsRun, [], "a settled player is not re-pushed every pass");

        player.dimension = nether();
        drain(fogJob());
        assert.deepEqual(player.commandsRun, [NETHER_FOG], "nothing of the pack's was on the stack to clear");

        player.dimension = world.getDimension("minecraft:overworld") as any;
        drain(fogJob());
        assert.deepEqual(
            player.commandsRun,
            [NETHER_FOG, CLEAR_OWN_ENTRY],
            "the Nether's entry must come off the player's own stack on the way back"
        );
    });

    it("takes the pack's entry off a player in a dimension the era had no fog for", () => {
        const player = new Player("end_fog_player", "end_fog_player");
        player.dimension = nether();
        mockPlayers.push(player);

        drain(fogJob());

        player.dimension = world.getDimension("minecraft:the_end") as any;
        drain(fogJob());

        assert.deepEqual(player.commandsRun, [NETHER_FOG, CLEAR_OWN_ENTRY]);
    });
});

describe("Classic Fog Player Sweep Batching", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("batches player fog sync and yields every 5 players", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        for (let i = 0; i < 12; i++) {
            const player = new Player(`player_${i}`);
            player.dimension = overworld;
            mockPlayers.push(player);
        }

        const job = fogJob();

        // Batch 1: 5 players
        const step1 = job.next();
        assert.equal(step1.done, false, "yields after 5 players");

        // Batch 2: next 5 players (10 total)
        const step2 = job.next();
        assert.equal(step2.done, false, "yields after 10 players");

        // Remaining 2 players
        const step3 = job.next();
        assert.equal(step3.done, true, "completes after remaining 2 players");
    });

    it("safely skips invalid players without throwing", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("disconnected_player");
        player.dimension = overworld;
        player.isValid = false;
        mockPlayers.push(player);

        const job = fogJob();
        assert.doesNotThrow(() => {
            while (!job.next().done) {}
        });
    });

    it("re-resolves players by ID across yield boundaries without holding live references", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const players: Player[] = [];
        for (let i = 0; i < 10; i++) {
            const player = new Player(`player_${i}`);
            player.dimension = overworld;
            players.push(player);
            mockPlayers.push(player);
        }

        const job = fogJob();
        job.next(); // First batch of 5

        // Disconnect remaining players from mockPlayers and detect if stale references are touched
        let staleAccessed = false;
        mockPlayers.length = 5; // remove remaining players from world
        for (let i = 5; i < 10; i++) {
            Object.defineProperty(players[i], "dimension", {
                get() {
                    staleAccessed = true;
                    return overworld;
                }
            });
        }

        while (!job.next().done) {}
        assert.equal(staleAccessed, false, "stale player handles from earlier ticks must not be accessed");
    });
});
