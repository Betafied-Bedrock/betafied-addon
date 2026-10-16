import { ItemStack, EntityComponentTypes, EquipmentSlot } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { BETA_PIGMAN_TYPES } from "../core/betaRegistry.js";

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
    } catch {
        // A pigman can despawn between the spawn event and this read, so the component lookup and the
        // equipment write throw on a dead handle.
    }
});
