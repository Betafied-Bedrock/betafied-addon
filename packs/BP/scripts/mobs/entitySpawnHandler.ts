import { world, system, ItemStack, Dimension, Entity, EntityComponentTypes } from "@minecraft/server";
import { reportError } from "../core/errorReporter.js";
import { isBetaEntity, isVanillaId } from "../core/betaRegistry.js";
import { isForeignOwnedEntity } from "../core/compatibilityPolicy.js";
import { planDropResolution } from "../core/normalizer.js";
import { eventBus } from "../core/eventBus.js";
import { migrateEntity } from "./entityMigration.js";

const recentBrokenLeaves = new Map<string, number>();
const recentBrokenChests = new Map<string, number>();
const recentPlayerDeaths = new Map<string, number>();

const dropOrigins = [recentBrokenLeaves, recentBrokenChests, recentPlayerDeaths];

const ORIGIN_RADIUS = 1;
const TREE_RADIUS = 2;

function cleanOldEntries(currentTick: number): void {
    for (const origins of dropOrigins) {
        for (const [key, tick] of origins) {
            if (currentTick - tick > 20) origins.delete(key);
        }
    }
}

function hasBetaTreeAround(dim: Dimension, x: number, y: number, z: number): boolean {
    for (let dx = -TREE_RADIUS; dx <= TREE_RADIUS; dx++) {
        for (let dy = -TREE_RADIUS; dy <= TREE_RADIUS; dy++) {
            for (let dz = -TREE_RADIUS; dz <= TREE_RADIUS; dz++) {
                try {
                    const block = dim.getBlock({ x: x + dx, y: y + dy, z: z + dz });
                    if (block && (block.typeId.includes("leaves") || block.typeId.includes("log"))) return true;
                } catch {
                    // Out of bounds or unloaded block safely ignored
                }
            }
        }
    }

    return false;
}

// Bedrock engine hardcodes leaf apple drops; Beta 1.7.3 trees never dropped apples.
export function isTreeAppleDrop(entity: Entity): boolean {
    const loc = entity.location;
    const dim = entity.dimension;

    cleanOldEntries(system.currentTick);

    const bx = Math.floor(loc.x);
    const by = Math.floor(loc.y);
    const bz = Math.floor(loc.z);

    let leafOrigin = false;
    let otherOrigin = false;

    for (let dx = -ORIGIN_RADIUS; dx <= ORIGIN_RADIUS; dx++) {
        for (let dy = -ORIGIN_RADIUS; dy <= ORIGIN_RADIUS; dy++) {
            for (let dz = -ORIGIN_RADIUS; dz <= ORIGIN_RADIUS; dz++) {
                const key = `${dim.id}:${bx + dx},${by + dy},${bz + dz}`;
                if (recentBrokenLeaves.has(key)) leafOrigin = true;
                else if (recentBrokenChests.has(key) || recentPlayerDeaths.has(key)) otherOrigin = true;
            }
        }
    }

    if (leafOrigin) return true;
    if (otherOrigin) return false;

    for (const player of world.getAllPlayers()) {
        if (!player.isValid || player.dimension.id !== dim.id) continue;

        const ploc = player.location;
        const distSq = (ploc.x - loc.x) ** 2 + (ploc.y - loc.y) ** 2 + (ploc.z - loc.z) ** 2;
        if (distSq < 2.25) return false;
    }

    return hasBetaTreeAround(dim, bx, by, bz);
}

eventBus.onPlayerBreakBlock((event) => {
    try {
        const blockId = event.brokenBlockPermutation?.type?.id ?? "";
        const locKey = `${event.block.dimension.id}:${event.block.x},${event.block.y},${event.block.z}`;
        if (blockId.includes("leaves")) {
            recentBrokenLeaves.set(locKey, system.currentTick);
        } else if (blockId.includes("chest")) {
            recentBrokenChests.set(locKey, system.currentTick);
        }
    } catch {
        // fail-safe ignore
    }
});

const UNAUTHENTIC_TREE_DROPS = new Set([
    "minecraft:apple",
    "bh:apple",
    "minecraft:stick"
]);

export interface SanitizationOptions {
    readonly attributeLeafOrigin: boolean;
}

export const SPAWN_TIME_SANITIZATION: SanitizationOptions = Object.freeze({ attributeLeafOrigin: true });

export const SWEEP_SANITIZATION: SanitizationOptions = Object.freeze({ attributeLeafOrigin: false });

const ORE_DROP_AMOUNT: Readonly<Record<string, number>> = Object.freeze({
    "minecraft:raw_iron": 1,
    "minecraft:raw_gold": 1
});

function handleItemDrop(entity: Entity, options: SanitizationOptions): void {
    const itemComp = entity.getComponent(EntityComponentTypes.Item);
    if (!itemComp?.itemStack) return;

    const itemId = itemComp.itemStack.typeId;
    const amount = itemComp.itemStack.amount;

    if (options.attributeLeafOrigin && UNAUTHENTIC_TREE_DROPS.has(itemId) && isTreeAppleDrop(entity)) {
        entity.remove();
        return;
    }

    // Convert to bh: identifier so drops merge into existing converted inventory stacks.
    const resolution = planDropResolution(itemId);
    if (resolution.action === "remove") {
        entity.remove();
    } else if (resolution.action === "convert" && resolution.targetId !== undefined) {
        const stacks = planStackedDrops(resolution.targetId, ORE_DROP_AMOUNT[itemId] ?? amount);

        // The entity holds the only copy of the item, so a target this engine cannot build leaves the
        // drop as the engine spawned it rather than removing it for a replacement that never lands.
        if (stacks === undefined) return;

        const loc = entity.location;
        const dim = entity.dimension;
        entity.remove();
        for (const stack of stacks) dim.spawnItem(stack, loc);
    }
}

// Splits drops exceeding target item max stack size (e.g. unstackable bh:porkchop).
function planStackedDrops(itemId: string, amount: number): ItemStack[] | undefined {
    const stacks: ItemStack[] = [];

    try {
        const maxStack = Math.max(1, new ItemStack(itemId, 1).maxAmount);
        for (let remaining = amount; remaining > 0; ) {
            const stackSize = Math.min(remaining, maxStack);
            stacks.push(new ItemStack(itemId, stackSize));
            remaining -= stackSize;
        }
    } catch {
        // An id this engine has no item for: the caller keeps the engine's own drop instead.
        return undefined;
    }

    return stacks;
}

export function sanitizeWorldEntity(
    entity: Entity | undefined,
    options: SanitizationOptions = SPAWN_TIME_SANITIZATION
): void {
    if (!entity || !entity.isValid) return;

    if (isForeignOwnedEntity(entity)) return;

    if (entity.typeId === "minecraft:item") {
        handleItemDrop(entity, options);
        return;
    }

    if (isVanillaId(entity.typeId) && !isBetaEntity(entity.typeId)) {
        entity.remove();
    }
}

eventBus.onEntitySpawn((event) => {
    try {
        sanitizeWorldEntity(event.entity);
        migrateEntity(event.entity);
    } catch (e) {
        reportError({
            system: "entitySpawnHandler",
            operation: "entitySpawnSanitization",
            target: event.entity?.typeId
        }, e);
    }
});

eventBus.onEntityLoad((event) => {
    try {
        sanitizeWorldEntity(event.entity);
        migrateEntity(event.entity);
    } catch (e) {
        reportError({
            system: "entitySpawnHandler",
            operation: "entityLoadSanitization",
            target: event.entity?.typeId
        }, e);
    }
});

eventBus.onEntityDie((event) => {
    try {
        const deadEntity = event.deadEntity;
        if (!deadEntity) return;

        const type = deadEntity.typeId;

        if (type === "minecraft:player") {
            const loc = deadEntity.location;
            const locKey = `${deadEntity.dimension.id}:${Math.floor(loc.x)},${Math.floor(loc.y)},${Math.floor(loc.z)}`;
            recentPlayerDeaths.set(locKey, system.currentTick);
        }
    } catch (e) {
        reportError({
            system: "entitySpawnHandler",
            operation: "trackDeath",
            target: event.deadEntity?.typeId
        }, e);
    }
});
