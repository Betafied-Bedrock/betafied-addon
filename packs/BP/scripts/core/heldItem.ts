import {
    EntityComponentTypes,
    EquipmentSlot
} from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { getPrivilegeReason } from "./permissions.js";

export function consumeHeldItem(player: Player, accepts: (typeId: string) => boolean): void {
    // Creative places without spending the item; the builder tag buys an inventory sweep, not a cost.
    if (getPrivilegeReason(player) === "creative") return;

    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    const held = equippable?.getEquipment(EquipmentSlot.Mainhand);
    if (!equippable || !held || !accepts(held.typeId)) return;

    if (held.amount > 1) {
        held.amount -= 1;
        equippable.setEquipment(EquipmentSlot.Mainhand, held);
    } else {
        equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
    }
}
