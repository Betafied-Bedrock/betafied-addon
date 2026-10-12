/**
 * Beta 1.7.3's `ItemBucket` filled from a water or lava *source* — the era's metadata 0, which is
 * Bedrock's `liquid_depth` 0 — and took the source block with it, which is what made an infinite pool
 * worth building. A cow gave a milk bucket to the same empty bucket (`EntityCow.interact`).
 *
 * Only the empty bucket is the pack's item: the filled ones are engine-native and pour or drink on
 * their own, and the empty bucket they hand back is retyped by the inventory sweep.
 */

import {
    EntityComponentTypes,
    EquipmentSlot,
    ItemStack,
    Player,
    system,
    world
} from "@minecraft/server";
import type { PlayerInteractWithBlockBeforeEvent, PlayerInteractWithEntityBeforeEvent } from "@minecraft/server";
import { BH_BUCKET_ID } from "../core/betaRegistry.js";
import { eventBus } from "../core/eventBus.js";
import { reportError, runCatching } from "../core/errorReporter.js";

const AIR_ID = "minecraft:air";
const LIQUID_DEPTH_STATE = "liquid_depth";
const SOURCE_DEPTH = 0;
const COW_ID = "minecraft:cow";
const MILK_BUCKET_ID = "minecraft:milk_bucket";

/** The era's two fluids, under both the current id and the legacy flowing one. */
const FILLED_BUCKET_OF: Readonly<Record<string, string>> = Object.freeze({
    "minecraft:water": "minecraft:water_bucket",
    "minecraft:flowing_water": "minecraft:water_bucket",
    "minecraft:lava": "minecraft:lava_bucket",
    "minecraft:flowing_lava": "minecraft:lava_bucket"
});

export interface Cell {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/**
 * The bucket an empty one fills to, or undefined when the target is not a source block. A level above
 * zero is water on its way somewhere, and the era let it pass by.
 */
export function filledBucketFor(typeId: string, liquidDepth: unknown): string | undefined {
    const filled = FILLED_BUCKET_OF[typeId];
    return filled !== undefined && liquidDepth === SOURCE_DEPTH ? filled : undefined;
}

function heldEmptyBucket(player: Player): ItemStack | undefined {
    const held = player.getComponent(EntityComponentTypes.Equippable)?.getEquipment(EquipmentSlot.Mainhand);
    return held?.typeId === BH_BUCKET_ID ? held : undefined;
}

function givePlayer(player: Player, itemId: string): void {
    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    if (!equippable) return;

    equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(itemId, 1));
}

function fillBucket(player: Player, dimensionId: string, cell: Cell, filledId: string): void {
    if (!player.isValid || !heldEmptyBucket(player)) return;

    const source = world.getDimension(dimensionId).getBlock(cell);
    if (!source) return;

    source.setType(AIR_ID);
    givePlayer(player, filledId);
}

function milkCow(player: Player): void {
    if (!player.isValid || !heldEmptyBucket(player)) return;

    givePlayer(player, MILK_BUCKET_ID);
}

eventBus.onPlayerInteractWithBlock((event: PlayerInteractWithBlockBeforeEvent) => {
    const { block, itemStack, player } = event;
    if (!block || !itemStack || itemStack.typeId !== BH_BUCKET_ID) return;

    const depth = runCatching(
        { system: "bucketUse", operation: "readLiquidDepth", target: block.typeId },
        () => block.permutation.getState(LIQUID_DEPTH_STATE)
    );

    const filledId = filledBucketFor(block.typeId, depth);
    if (!filledId) return;

    event.cancel = true;

    const cell: Cell = { x: block.location.x, y: block.location.y, z: block.location.z };
    const dimensionId = block.dimension.id;

    system.run(() => {
        try {
            fillBucket(player, dimensionId, cell, filledId);
        } catch (e) {
            reportError({
                system: "bucketUse",
                operation: "fillBucket",
                target: `${cell.x},${cell.y},${cell.z}`
            }, e);
        }
    });
});

eventBus.onPlayerInteractWithEntity((event: PlayerInteractWithEntityBeforeEvent) => {
    const { target, itemStack, player } = event;
    if (!itemStack || itemStack.typeId !== BH_BUCKET_ID) return;
    if (target.typeId !== COW_ID) return;

    event.cancel = true;

    system.run(() => {
        try {
            milkCow(player);
        } catch (e) {
            reportError({ system: "bucketUse", operation: "milkCow", target: player.name }, e);
        }
    });
});
