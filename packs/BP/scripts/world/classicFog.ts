import type { Player } from "@minecraft/server";
import { world } from "@minecraft/server";
import { tickManager } from "../core/tickManager.js";
import { reportError } from "../core/errorReporter.js";
import { NETHER_ID } from "../policy/betaConstants.js";

const CONFIG = Object.freeze({
    CHECK_INTERVAL: 20,
    PLAYERS_PER_TICK: 5,
    STACK_TAG: "beta"
});

/**
 * The Overworld's fog is not pushed: every Overworld biome's client biome file names the era's air
 * fog, and a fog pushed with `/fog` outranks the one a biome names, so a push there would pin one
 * entry over the whole biome layer. What is left is the Nether's red fog.
 *
 * The command layer is saved per player and restored on world load, but the engine exposes it
 * (`player.fogSettings`) and nothing else does: an in-memory record of "what this sweep pushed" is
 * lost to every reload and blind to whatever an earlier build left on the stack. So the sweep reads
 * the real stack and reconciles against it. The tag is the pack's handle on its own entries, and
 * removing all of them before a push is what recovers a stack a previous build filled to the
 * engine's 16-entry limit — at which point a push is rejected and the old fog stays on screen.
 */
const ERA_FOG_BY_DIMENSION: Readonly<Record<string, string>> = Object.freeze({
    [NETHER_ID]: "mgg:fog_hell"
});

function syncPlayerFog(player: Player): void {
    const wanted: string | undefined = ERA_FOG_BY_DIMENSION[player.dimension.id];
    const fog = player.fogSettings;
    const stack = fog.getStack();
    const tags = fog.getTags();

    const own = stack.filter((_, index) => tags[index] === CONFIG.STACK_TAG);

    // One entry of ours, holding this dimension's fog: settled. Pushing again would add an entry
    // every pass until the stack limit refused it.
    if (wanted !== undefined && own.length === 1 && own[0] === wanted) return;

    if (own.length > 0) fog.remove(CONFIG.STACK_TAG);
    if (wanted !== undefined) fog.push(wanted, CONFIG.STACK_TAG);
}

export function* fogJob(): Generator<void, void, unknown> {
    const playerIds = world.getAllPlayers().map(p => p.id);

    let processed = 0;
    for (const playerId of playerIds) {
        const player = world.getAllPlayers().find(p => p.id === playerId);
        if (!player || !player.isValid) continue;

        try {
            syncPlayerFog(player);
        } catch (e) {
            reportError({
                system: "classicFog",
                operation: "syncPlayerFog",
                target: player.name
            }, e);
        }

        processed++;
        if (processed % CONFIG.PLAYERS_PER_TICK === 0) {
            yield;
        }
    }
}

tickManager.register("classicFog", CONFIG.CHECK_INTERVAL, fogJob, 12);
