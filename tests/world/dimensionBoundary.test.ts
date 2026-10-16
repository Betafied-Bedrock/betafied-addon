import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Player, resetMocks, scheduledTimeouts, world } from "@minecraft/server";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import "../../packs/BP/scripts/world/dimensionBoundary.js";

const OVERWORLD = "minecraft:overworld";
const NETHER = "minecraft:nether";
const END = "minecraft:the_end";

interface Move {
    location: { x: number; y: number; z: number };
    destinationId: string | undefined;
}

/**
 * What the move asked for. The mock's teleport applies a location and a rotation but ignores the
 * destination dimension, and where the player lands is the whole point of this rule, so the options
 * the helper passes are recorded here.
 */
function watchTeleports(player: Player): Move[] {
    const moves: Move[] = [];
    const original = player.teleport.bind(player) as (location: any, options?: any) => void;

    (player as any).teleport = (location: any, options?: any) => {
        moves.push({ location, destinationId: options?.dimension?.id });
        original(location, options);
    };

    return moves;
}

function enterDimension(player: Player, toDimensionId: string): void {
    eventBus.dispatch("playerDimensionChange", {
        player,
        fromDimension: world.getDimension(OVERWORLD),
        toDimension: world.getDimension(toDimensionId)
    });
}

/** The move is parked until the command-feedback gamerule write has landed, so the queue is driven. */
function settle(): void {
    while (scheduledTimeouts.length > 0) {
        scheduledTimeouts.shift()!.callback();
    }
}

describe("Dimension Boundary - the End is not part of the era", () => {
    beforeEach(() => {
        resetMocks();
        eventBus.init();
    });

    it("sends a player who enters the End back to the bed they slept in", () => {
        const player = new Player("bedded", "Bedded");
        player.spawnPoint = { x: 40, y: 70, z: -12, dimension: world.getDimension(OVERWORLD) };
        const moves = watchTeleports(player);

        enterDimension(player, END);
        settle();

        assert.deepEqual(
            player.location,
            { x: 40, y: 70, z: -12 },
            "the era had no End to stand in, so the only arrival is the one the player already owned"
        );
        assert.equal(moves.length, 1, "one move, not a move per tick or a move per handler");
        assert.equal(moves[0].destinationId, OVERWORLD, "and it lands in the Overworld");
        assert.equal(player.messagesSent.length, 1, "the player is told why they came back");
        assert.match(player.messagesSent[0], /does not exist in Beta 1\.7\.3/);
    });

    it("sends a player with no usable bed to the era's fixed arrival point", () => {
        const rows: [string, unknown, string][] = [
            ["never_slept", undefined, "a player who never slept has no bed, so the Overworld's own arrival point is it"],
            [
                "foreign_spawn",
                { x: 9, y: 65, z: 9, dimension: world.getDimension(NETHER) },
                "the era cannot return a player to a dimension it does not have"
            ]
        ];

        for (const [id, spawnPoint, why] of rows) {
            const player = new Player(`returned_${id}`, "Returned");
            player.spawnPoint = spawnPoint;
            const moves = watchTeleports(player);

            enterDimension(player, END);
            settle();

            assert.deepEqual(player.location, { x: 0, y: 70, z: 0 }, why);
            assert.equal(moves[0].destinationId, OVERWORLD, why);
            assert.equal(player.messagesSent.length, 1, why);
        }
    });

    it("leaves every other dimension change alone", () => {
        const rows: [string, string][] = [
            [NETHER, "the Nether is a place the era has"],
            [OVERWORLD, "a change within one dimension reaches no boundary"]
        ];

        for (const [dimensionId, why] of rows) {
            const player = new Player(`traveller_${dimensionId}`, "Traveller");
            const moves = watchTeleports(player);

            enterDimension(player, dimensionId);
            settle();

            assert.equal(moves.length, 0, `${dimensionId}: ${why}`);
            assert.equal(player.messagesSent.length, 0, `${dimensionId}: and nobody is told about a boundary`);
        }
    });

    it("leaves a player who is already gone where they are", () => {
        const player = new Player("gone", "Gone");
        player.isValid = false;
        const moves = watchTeleports(player);

        enterDimension(player, END);
        settle();

        assert.equal(moves.length, 0, "a disconnected player cannot be moved into the Overworld");
        assert.equal(player.messagesSent.length, 0);
    });
});
