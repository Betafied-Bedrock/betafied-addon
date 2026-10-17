import { world } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { tickManager } from "../core/tickManager.js";
import { reportError } from "../core/errorReporter.js";
import { NETHER_ID } from "../policy/betaConstants.js";

const CONFIG = Object.freeze({
    CHECK_INTERVAL: 20,
    PLAYERS_PER_TICK: 5,
    STACK_ID: "beta"
});

/**
 * The Overworld's fog is not pushed: every Overworld biome's client biome file names the era's air
 * fog, and a fog pushed with `/fog` outranks the one a biome names, so a push here would pin one
 * entry over the whole biome layer. What is left is the Nether's red fog, which a push keeps on a
 * player whatever that layer resolves to. The stack belongs to the player rather than to the
 * dimension, so the pack has to own it: an entry pushed for the Nether and merely left un-popped is
 * the Nether's red haze sitting over the Overworld's sky.
 */
const ERA_FOG_BY_DIMENSION: Readonly<Record<string, string>> = Object.freeze({
    [NETHER_ID]: "mgg:fog_hell"
});

// The fog this sweep last put on a player's stack, so a settled player is not re-pushed every pass.
const pushedFog = new Map<string, string>();

export function* fogJob(): Generator<void, void, unknown> {
    const playerIds = world.getAllPlayers().map(p => p.id);

    let processed = 0;
    for (const playerId of playerIds) {
        const player = world.getAllPlayers().find(p => p.id === playerId);
        if (!player || !player.isValid) continue;

        const name = player.name;

        try {
            const wanted: string | undefined = ERA_FOG_BY_DIMENSION[player.dimension.id];
            const current = pushedFog.get(name);

            if (current !== wanted) {
                // The record is dropped before the commands run: a clear the engine refuses must not
                // leave this sweep believing an unwanted fog is on screen, and the push lands on top
                // of anything the clear could not take off.
                pushedFog.delete(name);

                // Script API lacks native fog controls; /fog command is required.
                if (current !== undefined) player.runCommand(`fog @s remove ${CONFIG.STACK_ID}`);
                if (wanted !== undefined) {
                    player.runCommand(`fog @s push ${wanted} ${CONFIG.STACK_ID}`);
                    pushedFog.set(name, wanted);
                }
            }
        } catch (e) {
            reportError({
                system: "classicFog",
                operation: "syncPlayerFog",
                target: name
            }, e);
        }

        processed++;
        if (processed % CONFIG.PLAYERS_PER_TICK === 0) {
            yield;
        }
    }
}

tickManager.register("classicFog", CONFIG.CHECK_INTERVAL, fogJob, 12);

eventBus.onPlayerLeave((event) => {
    pushedFog.delete(event.playerName);
});
