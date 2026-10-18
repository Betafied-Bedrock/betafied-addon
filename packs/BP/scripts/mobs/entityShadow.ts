import { Entity, Vector3, world } from "@minecraft/server";
import { reportError, runCatching } from "../core/errorReporter.js";
import { tickManager } from "../core/tickManager.js";
import { isBetaMob } from "../policy/betaRegistry.js";

const CONFIG = Object.freeze({
    // The surface changes on the tick the entity steps, and the decal reads it against the entity's
    // own height: a pass that lands a tick late leaves the decal on the old surface while the body
    // rises, which is the bounce a player sees on every step.
    INTERVAL_TICKS: 1,
    RADIUS: 64,
    MAX_FALL: 16,
    // Feet carry sub-millimetre jitter on a slab or a moving entity, and exact equality turns that
    // into a fresh synced value every pass -- the same shiver, at rest. A write has to be a real move.
    PUBLISH_EPSILON: 0.01
});

const GROUND_PROPERTY = "betarock:shadow_ground";
const DOWN: Vector3 = Object.freeze({ x: 0, y: -1, z: 0 });

/**
 * The world Y the decal belongs on. A grounded entity's own feet are the surface, and they are the
 * only reading that is exact on a half block, which a block grid cannot be; the raycast is spent
 * only on entities the engine reports in the air, and an entity over nothing keeps its feet.
 */
export function groundFor(feetY: number, onGround: boolean, hitBlockY: number | undefined): number {
    if (onGround) return feetY;
    return hitBlockY === undefined ? feetY : hitBlockY + 1;
}

function publishGround(entity: Entity): void {
    const feet = entity.location;
    const onGround = entity.isOnGround;
    let hitBlockY: number | undefined;

    if (!onGround) {
        const hit = entity.dimension.getBlockFromRay(feet, DOWN, {
            maxDistance: CONFIG.MAX_FALL,
            includeLiquidBlocks: false,
            includePassableBlocks: false
        });
        hitBlockY = hit?.block.location.y;
    }

    const ground = groundFor(feet.y, onGround, hitBlockY);
    const published = entity.getProperty(GROUND_PROPERTY);
    if (typeof published === "number" && Math.abs(published - ground) < CONFIG.PUBLISH_EPSILON) return;

    entity.setProperty(GROUND_PROPERTY, ground);
}

function sweep(): void {
    // One player can share every mob with another, so the id set is what keeps a pass linear rather
    // than quadratic in the number of viewers.
    const seen = new Set<string>();

    for (const player of world.getAllPlayers()) {
        if (!player.isValid) continue;

        const location = player.location;
        let entities: Entity[];
        try {
            entities = player.dimension.getEntities({ location, maxDistance: CONFIG.RADIUS });
        } catch (err) {
            reportError({ system: "entityShadow", operation: "getEntities", target: player.name }, err);
            continue;
        }

        for (const entity of entities) {
            if (seen.has(entity.id) || !entity.isValid) continue;
            // The player draws no decal and declares no surface to draw one on, so the read below
            // throws for them on every pass -- one warning per player per sweep in the content log.
            if (entity.typeId === "minecraft:player") continue;
            if (!isBetaMob(entity.typeId)) continue;

            seen.add(entity.id);
            runCatching(
                { system: "entityShadow", operation: "publishGround", target: entity.typeId },
                () => publishGround(entity)
            );
        }
    }
}

tickManager.register("entityShadow", CONFIG.INTERVAL_TICKS, sweep, 7);
