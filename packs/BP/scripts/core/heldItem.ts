import {
    EntityComponentTypes,
    EquipmentSlot,
    GameMode
} from "@minecraft/server";
import type { Player } from "@minecraft/server";

export function consumeHeldItem(player: Player, accepts: (typeId: string) => boolean): void {
    if (player.getGameMode() === GameMode.Creative) return;

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
