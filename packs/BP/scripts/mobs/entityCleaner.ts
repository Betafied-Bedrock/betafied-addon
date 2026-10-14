import { world } from "@minecraft/server";
import { reportError } from "../core/errorReporter.js";
import { tickManager } from "../core/tickManager.js";
import { migrateEntity } from "./entityMigration.js";
import { SWEEP_SANITIZATION, sanitizeWorldEntity } from "./entitySpawnHandler.js";

const CONFIG = Object.freeze({
    CHECK_INTERVAL: 100,
    CHECK_RADIUS: 32,
    ENTITIES_PER_TICK: 20
});

export function* cleanerJob(): Generator<void, void, unknown> {
    const players = world.getAllPlayers();
    let processed = 0;

    for (const player of players) {
        if (!player.isValid) continue;

        try {
            const entities = player.dimension.getEntities({
                location: player.location,
                maxDistance: CONFIG.CHECK_RADIUS
            });

            for (const ent of entities) {
                if (!ent.isValid) continue;

                // The sweep is the backstop for entities that were already resident before this pass
                // could see them spawn, so it runs the same policy rather than a second copy of it.
                sanitizeWorldEntity(ent, SWEEP_SANITIZATION);
                migrateEntity(ent);

                processed++;
                if (processed % CONFIG.ENTITIES_PER_TICK === 0) {
                    yield;
                    if (!player.isValid) break;
                }
            }
        } catch (e) {
            reportError({
                system: "entityCleaner",
                operation: "cleanNearbyEntities",
                target: player.name
            }, e);
        }

        yield;
    }
}

tickManager.register("entityCleaner", CONFIG.CHECK_INTERVAL, cleanerJob, 10);
