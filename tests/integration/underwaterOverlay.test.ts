import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockPlayers } from "../mocks/minecraftServer.js";
import {
    CLEAR_SENTINEL,
    UNDERWATER_SENTINEL,
    underwaterOverlayJob
} from "../../packs/BP/scripts/world/underwaterOverlay.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";

interface FakeBlock {
    typeId: string;
    isLiquid: boolean;
}

interface FakePlayerOptions {
    headBlock?: FakeBlock;
    throwOnHeadQuery?: boolean;
    /** Pin the id when a test needs the same player across a rejoin. */
    id?: string;
}

let playerSequence = 0;

function fakePlayer(name: string, options: FakePlayerOptions = {}) {
    const titles: string[] = [];

    return {
        name,
        // Ids are unique per player unless a test pins one: the driver tracks tinted players by id
        // across passes, so a reused id would carry a previous test's tint into the next one.
        id: options.id ?? `${name}#${playerSequence++}`,
        isValid: true,
        location: { x: 0, y: 64, z: 0 },
        /** Every title this player was sent, in order. */
        titles,
        /** Whether this player is tinted right now, read back off the last title they were sent. */
        get tinted() {
            return titles[titles.length - 1] === UNDERWATER_SENTINEL;
        },
        getHeadLocation() {
            if (options.throwOnHeadQuery) throw new Error("InvalidEntityError");
            return { x: 0.5, y: 65.62, z: 0.5 };
        },
        dimension: {
            id: "minecraft:overworld",
            // Real dimensions expose heightRange; the driver settles out-of-world heads against it
            // before it would ever reach getBlock.
            heightRange: { min: -64, max: 319 },
            getBlock() {
                return options.headBlock;
            }
        },
        onScreenDisplay: {
            setTitle(text: string) {
                titles.push(text);
            }
        }
    };
}

/** The titles that turn the tint on, ignoring the re-asserts. */
function sentinels(player: { titles: string[] }): string[] {
    return player.titles.filter((title) => title === UNDERWATER_SENTINEL);
}

function clears(player: { titles: string[] }): string[] {
    return player.titles.filter((title) => title === CLEAR_SENTINEL);
}

function drainJob(runs: number): void {
    for (let i = 0; i < runs; i++) underwaterOverlayJob();
}

describe("Beta Water Screen Tint - sentinel driver", () => {
    beforeEach(() => {
        mockPlayers.length = 0;
    });

    it("sends the sentinel only while the player is submerged", () => {
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        const wader = fakePlayer("wader", {
            headBlock: { typeId: "minecraft:air", isLiquid: false }
        });
        const lava = fakePlayer("lava", {
            headBlock: { typeId: "minecraft:lava", isLiquid: true }
        });
        mockPlayers.push(diver, wader, lava);

        underwaterOverlayJob();

        assert.deepEqual(sentinels(diver), [UNDERWATER_SENTINEL]);
        assert.deepEqual(wader.titles, [], "a dry player must never receive the sentinel");
        assert.deepEqual(lava.titles, [], "Beta only tinted the screen for water");
    });

    it("keeps serving other players when one lookup throws", () => {
        const broken = fakePlayer("broken", { throwOnHeadQuery: true });
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        mockPlayers.push(broken, diver);

        assert.doesNotThrow(
            () => underwaterOverlayJob(),
            "a despawned or unloaded player must not kill the pass"
        );
        assert.deepEqual(broken.titles, []);
        assert.equal(sentinels(diver).length, 1);
    });

    it("re-asserts the sentinel on a timer rather than on every pass", () => {
        // The armor readout writes the same title string, so a long dive has to keep restating the
        // tint or an armor update would leave the screen untinted until the player surfaced — while a
        // short dive must not spam that shared channel.
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        mockPlayers.push(diver);

        // The refresh counter is module state the cases above have already advanced, so the claim is
        // the rate over a window rather than a count from a cold start: five passes carry the enter
        // edge plus at most one refresh, where a per-pass write would carry five.
        drainJob(5);
        const firstWindow = sentinels(diver).length;
        assert.ok(
            firstWindow <= 2,
            `a five-pass window carries one refresh at most, got ${firstWindow} sends`
        );

        drainJob(5);
        assert.equal(
            sentinels(diver).length,
            firstWindow + 1,
            "and the window after it carries exactly the next refresh, so a long dive stays tinted"
        );
    });

    it("pushes exactly one title clear when the head leaves the water, and none for a dry player", () => {
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        const wader = fakePlayer("wader", {
            headBlock: { typeId: "minecraft:air", isLiquid: false }
        });
        mockPlayers.push(diver, wader);
        underwaterOverlayJob();

        (diver.dimension as any).getBlock = () => ({ typeId: "minecraft:air", isLiquid: false });

        drainJob(6);

        assert.deepEqual(
            clears(diver),
            [CLEAR_SENTINEL],
            "surfacing must clear the title exactly once, and an empty title is the clear"
        );
        assert.equal(diver.tinted, false, "the clear is what actually takes the tint down");
        assert.deepEqual(wader.titles, [], "a dry player must never receive a clear");
    });

    it("answers dry for a head outside the world, and lifts a tint below the floor", () => {
        // Above the ceiling the engine's only possible getBlock answer is LocationOutOfWorldBoundaries,
        // so the height guard must settle the question before the lookup ever runs. The void is
        // definitively dry, so it lifts a tint — unlike an unloaded chunk, which is not an answer.
        const flying = fakePlayer("flying");
        mockPlayers.push(flying);

        let blockQueries = 0;
        (flying.dimension as any).getBlock = () => {
            blockQueries++;
            throw new Error("LocationOutOfWorldBoundariesError");
        };
        (flying as any).getHeadLocation = () => ({ x: 0.5, y: 400, z: 0.5 });

        assert.doesNotThrow(() => underwaterOverlayJob());
        assert.deepEqual(flying.titles, []);
        assert.equal(
            blockQueries,
            0,
            "an out-of-bounds head must be settled by the height guard, not by a throwing lookup"
        );

        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        mockPlayers.push(diver);
        underwaterOverlayJob();
        assert.equal(diver.tinted, true);

        (diver as any).getHeadLocation = () => ({ x: 0.5, y: -100, z: 0.5 });
        drainJob(6);

        assert.deepEqual(
            clears(diver),
            [CLEAR_SENTINEL],
            "the void is definitively dry, so it must lift the tint"
        );
        assert.equal(diver.tinted, false);
    });

    it("leaves a tinted player alone when a lookup throws", () => {
        // An unloaded chunk is not an answer about the head, so it must not be mistaken for air.
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        mockPlayers.push(diver);
        underwaterOverlayJob();

        const broken = fakePlayer("unloaded", { throwOnHeadQuery: true });
        (diver as any).dimension.getBlock = () => {
            throw new Error("chunk unloaded");
        };
        mockPlayers.push(broken);

        drainJob(3);

        assert.deepEqual(clears(diver), [], "a failed lookup must not clear a submerged player");
    });

    it("forgets tinted players on leave so their next session takes the enter edge", () => {
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        mockPlayers.push(diver);
        underwaterOverlayJob();

        eventBus.dispatch("playerLeave", { playerId: diver.id, playerName: diver.name });

        mockPlayers.length = 0;
        const rejoined = fakePlayer("diver", {
            id: diver.id,
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        mockPlayers.push(rejoined);
        underwaterOverlayJob();

        assert.equal(
            sentinels(rejoined).length,
            1,
            "a rejoined diver must be tinted again immediately"
        );
    });

    it("uses cached dimension boundaries to avoid heightRange engine property reads on standard dimensions", () => {
        let heightRangeReadCount = 0;
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        Object.defineProperty(diver.dimension, "heightRange", {
            get() {
                heightRangeReadCount++;
                return { min: -64, max: 320 };
            }
        });
        mockPlayers.push(diver);
        underwaterOverlayJob();

        assert.equal(heightRangeReadCount, 0, "standard dimensions should not invoke the heightRange engine getter");
    });
});

