import { world } from "@minecraft/server";

const OVERWORLD = "minecraft:overworld";

/**
 * The overworld a placement fixture writes its blocks into. Kept apart from the pure helpers so
 * importing one of those does not drag the engine mock into a static contract test.
 */
export function dimension() {
    return world.getDimension(OVERWORLD);
}
