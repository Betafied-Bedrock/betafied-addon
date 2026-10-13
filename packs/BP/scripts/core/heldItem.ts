import {
    EntityComponentTypes,
    EquipmentSlot,
    GameMode
} from "@minecraft/server";
import type { Player } from "@minecraft/server";

/**
 * Spend one item from the mainhand stack, clearing the slot when it was the last one.
 *
 * `accepts` names the ids the caller is willing to spend. Both callers spend the tick after the click
 * they validated, so the stack in hand is re-read here rather than carried over from the event: a
 * player who swapped items in that tick keeps the new stack.
 */
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
