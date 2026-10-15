import { world, ItemStack, Entity, Block, Vector3 } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { tickManager } from "../core/tickManager.js";
import { reportError } from "../core/errorReporter.js";
import { OVERWORLD_KEY } from "../core/betaConstants.js";
import { normalizeXZ, scale } from "../core/vectorMath.js";

const CONFIG = Object.freeze({
    // Beta read the boat's motion at the tick its move was blocked, so a shore it rammed was only ever
    // seen from the tick before the stop. The pass therefore has to be short enough to catch the boat
    // still travelling within the block it is about to hit: at the era's 0.4 blocks a tick, two ticks
    // is 0.8, and the four cells this reads reach two blocks out.
    TICK_INTERVAL: 2,
    BOATS_PER_TICK: 10,
    // `EntityBoat.onUpdate` destroyed a boat only when the move itself was blocked at speed:
    // `isCollidedHorizontally && var6 > 0.15D`, var6 being sqrt(motionX^2 + motionZ^2) in blocks a tick
    // and read before that tick's decay. Contact below it decayed the motion and left the boat alone.
    BREAK_SPEED: 0.15,
    NON_SOLID_WHITELIST: Object.freeze(["minecraft:air", "minecraft:water", "minecraft:soul_sand"])
});

// The era's condition is a horizontal collision with a solid block's box, so nothing a boat can travel
// through may read as shoreline. `flowing_water` is its own block id on this engine and is what a
// stream's surface cell carries, so a stream was breaking boats outright.
function isSolidBlock(block: Block | undefined): boolean {
    const id = block?.typeId;
    if (!id || CONFIG.NON_SOLID_WHITELIST.includes(id)) return false;
    return !block.isLiquid;
}

function breakBoatWithParts(boat: Entity): void {
    const loc = boat.location;
    const dim = boat.dimension;
    boat.kill();
    for (let i = 0; i < 3; i++) dim.spawnItem(new ItemStack("minecraft:oak_planks", 1), loc);
    for (let i = 0; i < 2; i++) dim.spawnItem(new ItemStack("minecraft:stick", 1), loc);
}

function breakBoatWithItem(boat: Entity): void {
    const loc = boat.location;
    const dim = boat.dimension;
    boat.kill();
    dim.spawnItem(new ItemStack("minecraft:oak_boat", 1), loc);
}

export function* boatLoopJob(): Generator<void, void, unknown> {
    const overworld = world.getDimension(OVERWORLD_KEY);
    const boatIds = overworld.getEntities({ type: "minecraft:boat" }).map(b => b.id);

    let processed = 0;
    for (const boatId of boatIds) {
        const boat = world.getEntity(boatId);
        if (!boat || !boat.isValid) continue;

        try {
            const loc = boat.location;
            const x = Math.floor(loc.x);
            const y = Math.floor(loc.y);
            const z = Math.floor(loc.z);

            const offsets = [
                { x: x + 1, z }, { x: x - 1, z },
                { x, z: z + 1 }, { x, z: z - 1 }
            ];

            const vel: Vector3 = boat.getVelocity();

            let broken = false;
            if (Math.hypot(vel.x, vel.z) > CONFIG.BREAK_SPEED) {
                for (const offset of offsets) {
                    const block = overworld.getBlock({ x: offset.x, y, z: offset.z });
                    if (isSolidBlock(block)) {
                        breakBoatWithParts(boat);
                        broken = true;
                        break;
                    }
                }
            }

            if (!broken) {
                if (vel && (Math.abs(vel.x) >= 0.01 || Math.abs(vel.z) >= 0.01)) {
                    const blockBelow = overworld.getBlock({
                        x: Math.floor(loc.x),
                        y: Math.floor(loc.y - 0.3),
                        z: Math.floor(loc.z)
                    });

                    if (blockBelow?.typeId === "minecraft:water") {
                        const dir = normalizeXZ({ x: vel.x, z: vel.z });
                        const offset = scale(dir, -1);

                        const bubblePos = {
                            x: loc.x + offset.x,
                            y: loc.y + 0.1,
                            z: loc.z + offset.z
                        };

                        boat.dimension.spawnParticle("minecraft:basic_bubble_particle_gradual", bubblePos);
                    }
                }
            }
        } catch (e) {
            reportError({
                system: "boatCollision",
                operation: "processBoat",
                target: boat.id
            }, e);
        }

        processed++;
        if (processed % CONFIG.BOATS_PER_TICK === 0) {
            yield;
        }
    }
}

export function processBoats(): void {
    const job = boatLoopJob();
    while (!job.next().done) {
        // Drain generator synchronously
    }
}

tickManager.register("boatCollision", CONFIG.TICK_INTERVAL, boatLoopJob, 6);

eventBus.onEntityHitEntity((event) => {
    const { damagingEntity, hitEntity } = event;
    if (
        damagingEntity.typeId === "minecraft:player" &&
        hitEntity.typeId === "minecraft:boat"
    ) {
        breakBoatWithItem(hitEntity);
    }
});
