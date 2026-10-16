import { world, system, Dimension, Entity, Vector3, EntityComponentTypes } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { tickManager } from "../core/tickManager.js";
import { reportError } from "../core/errorReporter.js";
import { END_KEY, NETHER_KEY, OVERWORLD_KEY } from "../core/betaConstants.js";
import { magnitude, normalizeXZ, scale } from "../core/vectorMath.js";

const CONFIG = Object.freeze({
    FURNACE_TYPE_ID: "ubd:furnace_minecart",
    FUEL_TICKS_PER_COAL: 720,
    IMPULSE_FORCE: 9,
    TICK_INTERVAL: 2,
    SCAN_INTERVAL: 20,
    MAX_INTERACTION_DISTANCE: 2,
    MIN_SPEED_THRESHOLD: 0.35
});

const PUSHABLE_CART_TYPES = Object.freeze(new Set([
    "minecraft:minecart",
    "minecraft:chest_minecart",
    "minecraft:hopper_minecart",
    "minecraft:tnt_minecart"
]));

/** One task per moving cart: the tick manager owns the schedule the cart's own loop used to hold. */
function cartTaskId(entityId: string): string {
    return `furnaceMinecart:cart:${entityId}`;
}

const DIMENSION_IDS = Object.freeze([OVERWORLD_KEY, NETHER_KEY, END_KEY] as const);

function getAvailableDimensions(): Dimension[] {
    const resolved: Dimension[] = [];
    for (const dimId of DIMENSION_IDS) {
        try {
            resolved.push(world.getDimension(dimId));
        } catch (e) {
            reportError({
                system: "furnaceMinecart",
                operation: "getDimension",
                target: dimId
            }, e);
        }
    }
    return resolved;
}

function isValidFuelTime(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isValidPositionJson(raw: unknown): Vector3 | null {
    if (typeof raw !== "string") return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (
            typeof parsed === "object" &&
            parsed !== null &&
            "x" in parsed &&
            "y" in parsed &&
            "z" in parsed
        ) {
            const pos = parsed;
            if (
                typeof pos.x === "number" && Number.isFinite(pos.x) &&
                typeof pos.y === "number" && Number.isFinite(pos.y) &&
                typeof pos.z === "number" && Number.isFinite(pos.z)
            ) {
                return { x: pos.x, y: pos.y, z: pos.z };
            }
        }
    } catch {
        // A malformed value is the repair path, not a failure: readProperty reports it and rewrites
        // the key, so a report here would double the log for one bad value.
        return null;
    }
    return null;
}

const FUEL_KEY = "fuelTime";
const POSITION_KEY = "lastPosition";

// The engine inlines this union on setDynamicProperty instead of exporting a type for it.
type PropertyValue = string | number | boolean | Vector3;

/**
 * One cart property read: a value the key's own parser rejects is repaired to what the key expects and
 * reported, because the engine hands back whatever the last build wrote.
 */
function readProperty<T>(
    entity: Entity,
    key: string,
    parse: (raw: unknown) => T | undefined,
    repair: () => PropertyValue
): T | undefined {
    try {
        const raw = entity.getDynamicProperty(key);
        if (raw === undefined) return undefined;

        const parsed = parse(raw);
        if (parsed !== undefined) return parsed;

        reportError({
            system: "furnaceMinecart",
            operation: "readProperty",
            target: entity.id,
            details: { key, raw: typeof raw === "object" ? JSON.stringify(raw) : String(raw) }
        }, "Malformed dynamic property");
        entity.setDynamicProperty(key, repair());
    } catch (e) {
        reportError({
            system: "furnaceMinecart",
            operation: "readProperty",
            target: entity.id,
            details: { key }
        }, e);
    }
    return undefined;
}

function writeProperty(entity: Entity, key: string, value: PropertyValue): void {
    try {
        entity.setDynamicProperty(key, value);
    } catch (e) {
        reportError({
            system: "furnaceMinecart",
            operation: "writeProperty",
            target: entity.id,
            details: { key }
        }, e);
    }
}

const FurnaceState = {
    getFuel(entity: Entity): number {
        const fuel = readProperty(
            entity,
            FUEL_KEY,
            (raw) => (isValidFuelTime(raw) ? Math.floor(raw) : undefined),
            () => 0
        );
        return fuel ?? 0;
    },
    setFuel(entity: Entity, ticks: number): void {
        writeProperty(entity, FUEL_KEY, isValidFuelTime(ticks) ? Math.floor(ticks) : 0);
    },
    decrementFuel(entity: Entity): number {
        const updated = Math.max(0, FurnaceState.getFuel(entity) - 1);
        FurnaceState.setFuel(entity, updated);
        return updated;
    },
    getLastPosition(entity: Entity): Vector3 {
        const lastPosition = readProperty(
            entity,
            POSITION_KEY,
            (raw) => isValidPositionJson(raw) ?? undefined,
            () => JSON.stringify(entity.location)
        );
        return lastPosition ?? entity.location;
    },
    updateLastPosition(entity: Entity, currentPos: Vector3, lastPos: Vector3): void {
        const moved = currentPos.x !== lastPos.x || currentPos.y !== lastPos.y || currentPos.z !== lastPos.z;
        if (moved) writeProperty(entity, POSITION_KEY, JSON.stringify(currentPos));
    }
};

function isOnRail(entity: Entity): boolean {
    try {
        const block = entity.dimension.getBlock(entity.location);
        return Boolean(block?.typeId.includes("minecraft:") && block?.typeId.includes("rail"));
    } catch (err) {
        // A cart crossing an unloaded chunk throws on the block read, and the false below is what
        // clears its velocity: the reason it stopped has to be visible.
        reportError({ system: "furnaceMinecart", operation: "isOnRail", target: entity.id }, err);
        return false;
    }
}

function pushNearbyCarts(furnaceCart: Entity): boolean {
    let pushedCart = false;
    try {
        const nearbyEntities = furnaceCart.dimension.getEntities({
            location: furnaceCart.location,
            maxDistance: CONFIG.MAX_INTERACTION_DISTANCE
        }).filter((target) => PUSHABLE_CART_TYPES.has(target.typeId) && target.id !== furnaceCart.id);

        for (const nearbyCart of nearbyEntities) {
            const dir = normalizeXZ({
                x: nearbyCart.location.x - furnaceCart.location.x,
                z: nearbyCart.location.z - furnaceCart.location.z
            });
            const pushVector = scale(dir, CONFIG.IMPULSE_FORCE);
            nearbyCart.applyImpulse(pushVector);
            pushedCart = true;
        }
    } catch (e) {
        reportError({
            system: "furnaceMinecart",
            operation: "pushNearbyCarts",
            target: furnaceCart.id
        }, e);
    }
    return pushedCart;
}

function applyMovementImpulse(entity: Entity, movementDir: Vector3, onRail: boolean): void {
    if (!onRail) {
        entity.clearVelocity();
        return;
    }

    const currentVelocity = entity.getVelocity();
    const currentSpeed = magnitude(currentVelocity);

    const hasMovement = Math.abs(movementDir.x) > 0.01 || Math.abs(movementDir.z) > 0.01;
    if (!hasMovement && currentSpeed >= CONFIG.MIN_SPEED_THRESHOLD) {
        return;
    }

    const hitCart = pushNearbyCarts(entity);
    const impulseMultiplier = (currentSpeed < CONFIG.MIN_SPEED_THRESHOLD && !hitCart) ? -1 : 1;
    const impulse = scale(scale(movementDir, impulseMultiplier), CONFIG.IMPULSE_FORCE);

    entity.applyImpulse(impulse);
}

function stopMinecartMovement(entityId: string, entity?: Entity): void {
    tickManager.unregister(cartTaskId(entityId));

    if (entity?.isValid) {
        try {
            entity.clearVelocity();
            entity.triggerEvent("unfueled");
        } catch (e) {
            reportError({
                system: "furnaceMinecart",
                operation: "stopMovement",
                target: entityId
            }, e);
        }
    }
}

function runMinecartStep(entity: Entity, entityId: string): void {
    if (!entity.isValid) {
        stopMinecartMovement(entityId);
        return;
    }

    const remainingFuel = FurnaceState.decrementFuel(entity);
    if (remainingFuel <= 0) {
        stopMinecartMovement(entityId, entity);
        return;
    }

    const currentPos = entity.location;
    const lastPos = FurnaceState.getLastPosition(entity);
    const movementDir = normalizeXZ({
        x: currentPos.x - lastPos.x,
        z: currentPos.z - lastPos.z
    });

    FurnaceState.updateLastPosition(entity, currentPos, lastPos);

    try {
        const onRail = isOnRail(entity);
        applyMovementImpulse(entity, movementDir, onRail);
    } catch (e) {
        reportError({
            system: "furnaceMinecart",
            operation: "runStep",
            target: entityId
        }, e);
    }
}

function startMinecartMovement(entity: Entity): void {
    const entityId = entity.id;
    if (tickManager.isRegistered(cartTaskId(entityId))) return;

    tickManager.register(cartTaskId(entityId), CONFIG.TICK_INTERVAL, () => {
        runMinecartStep(entity, entityId);
    });
}

const FUEL_ITEM_IDS: ReadonlySet<string> = Object.freeze(new Set(["minecraft:coal", "minecraft:charcoal"]));

function startFueledMinecart(entity: Entity): void {
    FurnaceState.setFuel(entity, CONFIG.FUEL_TICKS_PER_COAL);
    writeProperty(entity, POSITION_KEY, JSON.stringify(entity.location));
    startMinecartMovement(entity);
}

eventBus.onPlayerInteractWithEntity((e) => {
    const { target: entity, itemStack } = e;
    // Beta burned any fuel item in the hand; charcoal and coal were interchangeable (1600 ticks each).
    if (!itemStack || !FUEL_ITEM_IDS.has(itemStack.typeId)) return;
    if (entity.typeId !== CONFIG.FURNACE_TYPE_ID) return;

    const variant = entity.getComponent(EntityComponentTypes.Variant);
    if (variant && variant.value === 0) {
        system.runTimeout(() => {
            if (entity.isValid) {
                entity.triggerEvent("fueled");
                startFueledMinecart(entity);
            }
        }, 1);
    }
});

function sweeperJob(): void {
    const dimensions = getAvailableDimensions();
    if (dimensions.length === 0) return;

    for (const dimension of dimensions) {
        try {
            const entities = dimension.getEntities({ type: CONFIG.FURNACE_TYPE_ID });
            for (const entity of entities) {
                if (FurnaceState.getFuel(entity) > 0 && !tickManager.isRegistered(cartTaskId(entity.id))) {
                    startMinecartMovement(entity);
                }
            }
        } catch (e) {
            reportError({
                system: "furnaceMinecart",
                operation: "sweeperScan",
                target: dimension.id
            }, e);
        }
    }
}

tickManager.register("furnaceMinecart:sweeper", CONFIG.SCAN_INTERVAL, sweeperJob, 7);
