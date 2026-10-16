import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    resetMocks,
    registeredBeforeEvents,
    mockPlayers,
    mockEntities,
    world,
    system,
    Player,
    CommandPermissionLevel
} from "../mocks/minecraftServer.js";
import { tickManager } from "../../packs/BP/scripts/core/tickManager.js";
import {
    MIN_REST_TICKS,
    forceAppearance,
    hasActiveSighting
} from "../../packs/BP/scripts/mobs/herobrine.js";

const OVERWORLD = "minecraft:overworld";

function layOpenGround(radius = 42): void {
    const dimension = world.getDimension(OVERWORLD);
    for (let x = -radius; x <= radius; x++) {
        for (let z = -radius; z <= radius; z++) {
            dimension.setBlock({ x, y: 64, z }, { typeId: "minecraft:air", isAir: true, isSolid: false, isLiquid: false });
            dimension.setBlock({ x, y: 65, z }, { typeId: "minecraft:air", isAir: true, isSolid: false, isLiquid: false });
        }
    }
}

function spawnTestPlayer(): Player {
    const player = new Player("herobrine_test_player", "Alex");
    player.dimension = world.getDimension(OVERWORLD);
    player.location = { x: 0.5, y: 64, z: 0.5 };
    mockPlayers.push(player);
    return player;
}

/** Advances the master scheduler one tick at a time until the sighting resolves or we give up. */
function sweepUntilResolved(limit: number): void {
    for (let i = 0; i < limit && hasActiveSighting(); i++) {
        tickManager.step();
    }
}

/** Runs the engine clock and the master scheduler together, so gap timers see the ticks the scheduler does. */
function advanceTicks(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
        system.advanceTicks(1);
        tickManager.step();
    }
}

function spawnBystander(location: { x: number; y: number; z: number }): void {
    const bystander = new Player("bystander", "Bystander");
    bystander.dimension = world.getDimension(OVERWORLD);
    bystander.location = { ...location };
    mockPlayers.push(bystander);
}

// Wiring-only: the sweep is driven against the mock's fixed +Z view direction and its own block
// map, so these cases pin our sighting geometry, spot picker and dismissal timers rather than the
// engine's. Real facing, chunk loading and entity retention across ticks need an in-game check.
describe("Herobrine Appearance Integration", () => {
    it("registers the /appear custom command as operator-only", () => {
        const callbacks = registeredBeforeEvents.get("startup") ?? [];

        const commands: { name: string; permissionLevel: number; cheatsRequired?: boolean }[] = [];
        const registry = {
            registerCommand: (command: { name: string; permissionLevel: number; cheatsRequired?: boolean }) => {
                commands.push(command);
            }
        };

        for (const callback of callbacks) {
            callback({ customCommandRegistry: registry });
        }

        assert.equal(commands.length, 1, "a single /appear command");
        assert.equal(commands[0].name, "betafied:appear");
        assert.equal(commands[0].permissionLevel, CommandPermissionLevel.Admin, "the era's command is op-only");
        assert.equal(commands[0].cheatsRequired, false, "and it works without cheats, as Beta had none");
    });

    it("spawns a single apparition and records the sighting", () => {
        resetMocks();
        layOpenGround();
        spawnTestPlayer();

        assert.equal(forceAppearance(), true);
        assert.equal(hasActiveSighting(), true);
        assert.equal(mockEntities.size, 1);

        const [entity] = [...mockEntities.values()];
        assert.equal(entity.typeId, "bh:herobrine");
        assert.equal(entity.dimension.id, OVERWORLD);
    });

    it("ends the sighting when any player has him: in the crosshair, or on top of him", () => {
        resetMocks();
        layOpenGround();
        const witness = spawnTestPlayer();

        assert.equal(forceAppearance(), true);
        const [gazed] = [...mockEntities.values()];

        // Stand 20 blocks away on his -Z side: the mock player's view faces +Z, straight at him.
        witness.location = { x: gazed.location.x, y: gazed.location.y, z: gazed.location.z - 20 };
        sweepUntilResolved(60);

        assert.equal(hasActiveSighting(), false, "the player he appeared to can end it by looking");
        assert.equal(gazed.isValid, false);

        resetMocks();
        layOpenGround();
        const away = spawnTestPlayer();

        assert.equal(forceAppearance(), true);
        const [watched] = [...mockEntities.values()];

        away.location = { x: watched.location.x, y: watched.location.y, z: watched.location.z + 400 };
        spawnBystander({ x: watched.location.x, y: watched.location.y, z: watched.location.z - 20 });
        sweepUntilResolved(60);

        assert.equal(hasActiveSighting(), false, "a bystander's gaze must end the sighting too");
        assert.equal(watched.isValid, false);

        resetMocks();
        layOpenGround();
        const walker = spawnTestPlayer();

        assert.equal(forceAppearance(), true);
        const [cornered] = [...mockEntities.values()];

        walker.location = { ...cornered.location };
        sweepUntilResolved(60);

        assert.equal(hasActiveSighting(), false, "so does walking into him");
        assert.equal(cornered.isValid, false);
    });

    it("stays put while nobody has him in frame, then dissolves once everyone is far off", () => {
        resetMocks();
        layOpenGround();
        const player = spawnTestPlayer();

        assert.equal(forceAppearance(), true);
        const [entity] = [...mockEntities.values()];

        // Same 20 block gap, but now on his +Z side: the fixed +Z view points away from him.
        player.location = { x: entity.location.x, y: entity.location.y, z: entity.location.z + 20 };
        sweepUntilResolved(120);

        assert.equal(hasActiveSighting(), true, "looking away must not dismiss him");
        assert.equal(entity.isValid, true);

        player.location = { x: entity.location.x, y: entity.location.y, z: entity.location.z + 400 };
        sweepUntilResolved(120);

        assert.equal(hasActiveSighting(), false, "he should not linger once nobody is near");
        assert.equal(entity.isValid, false);
    });

    it("refuses to appear with nobody online, or on top of the only player there is", () => {
        resetMocks();

        assert.equal(forceAppearance(), false);
        assert.equal(hasActiveSighting(), false);

        const originalRandom = Math.random;
        // Freeze the picker so every attempt lands on the same spot.
        Math.random = () => 0.5;

        try {
            resetMocks();
            layOpenGround();
            spawnTestPlayer();

            assert.equal(forceAppearance(), true);
            const [probe] = [...mockEntities.values()];
            const spot = { ...probe.location };

            resetMocks();
            layOpenGround();
            spawnTestPlayer();
            spawnBystander(spot);

            assert.equal(forceAppearance(), false, "every candidate spot is occupied");
            assert.equal(mockEntities.size, 0);
        } finally {
            Math.random = originalRandom;
        }
    });

    it("holds the automatic sweep off for the rest period after a sighting ends", () => {
        const originalRandom = Math.random;
        // Freeze the RNG so the roll gate, the spot picker and the gap picker are all deterministic.
        Math.random = () => 0;

        try {
            resetMocks();
            layOpenGround();
            const player = spawnTestPlayer();

            assert.equal(forceAppearance(), true);
            const [entity] = [...mockEntities.values()];

            // Walking into him is what arms the rest period on the scheduled path.
            player.location = { ...entity.location };
            sweepUntilResolved(60);
            assert.equal(hasActiveSighting(), false, "close range should end the sighting");

            player.location = { x: 0.5, y: 64, z: 0.5 };
            advanceTicks(MIN_REST_TICKS - 6000);
            assert.equal(mockEntities.size, 1, "no second apparition inside the rest period");

            advanceTicks(6000 + 60);
            assert.equal(mockEntities.size, 2, "the sweep should be free to appear again once the rest elapses");
            assert.equal([...mockEntities.values()][1].typeId, "bh:herobrine");
        } finally {
            Math.random = originalRandom;
        }
    });
});
