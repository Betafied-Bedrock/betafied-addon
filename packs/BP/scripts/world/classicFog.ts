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

// Nether red fog only: a push outranks biome fog, and an in-memory record dies on reload, so reconcile the live stack.
const ERA_FOG_BY_DIMENSION: Readonly<Record<string, string>> = Object.freeze({
    [NETHER_ID]: "mgg:fog_hell"
});

function syncPlayerFog(player: Player): void {
    const wanted: string | undefined = ERA_FOG_BY_DIMENSION[player.dimension.id];
    const fog = player.fogSettings;
    const stack = fog.getStack();
    const tags = fog.getTags();

    const own = stack.filter((_, index) => tags[index] === CONFIG.STACK_TAG);

    // Already holding this dimension's fog: pushing again adds an entry every pass until the limit refuses it.
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
