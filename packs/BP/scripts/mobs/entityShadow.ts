import { Entity, Vector3, world } from "@minecraft/server";
import { reportError, runCatching } from "../core/errorReporter.js";
import { tickManager } from "../core/tickManager.js";
import { isBetaMob } from "../policy/betaRegistry.js";

const CONFIG = Object.freeze({
    // A tick late leaves the decal on the old surface while the body rises - the bounce players see.
    INTERVAL_TICKS: 1,
    RADIUS: 64,
    MAX_FALL: 16,
    // Sub-millimetre feet jitter would resync every pass; a write has to be a real move.
    PUBLISH_EPSILON: 0.01
});

const GROUND_PROPERTY = "betarock:shadow_ground";
const DOWN: Vector3 = Object.freeze({ x: 0, y: -1, z: 0 });

// A grounded entity's feet are the surface; the raycast is spent only on entities in the air.
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
    // One mob can be shared by several viewers; the id set keeps a pass linear.
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
            // Players declare no shadow property, so the read below would throw once per sweep.
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
