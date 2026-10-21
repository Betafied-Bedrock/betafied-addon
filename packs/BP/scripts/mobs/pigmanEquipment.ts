import { ItemStack, EntityComponentTypes, EquipmentSlot } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { BETA_PIGMAN_TYPES } from "../policy/betaRegistry.js";
import { reportError } from "../core/errorReporter.js";

eventBus.onEntitySpawn((event) => {
    const entity = event.entity;
    if (!entity || !BETA_PIGMAN_TYPES.has(entity.typeId)) return;

    try {
        const equippable = entity.getComponent(EntityComponentTypes.Equippable);
        if (!equippable) return;

        const mainHand = equippable.getEquipment(EquipmentSlot.Mainhand);
        if (!mainHand || mainHand.typeId !== "minecraft:golden_sword") {
            equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:golden_sword"));
        }
    } catch (err) {
        // A despawn between the spawn event and this read throws; the pigman stays unarmed.
        reportError({
            system: "pigmanEquipment",
            operation: "equipGoldenSword"
        }, err);
    }
});
