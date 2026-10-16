import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    EntityComponentTypes,
    EntityEquippableComponent,
    EquipmentSlot,
    GameMode,
    ItemStack,
    Player,
    resetMocks
} from "@minecraft/server";
import { consumeHeldItem } from "../../packs/BP/scripts/core/heldItem.js";
import { PLAYER_TAGS } from "../../packs/BP/scripts/core/permissions.js";

const SLAB_ID = "bh:wooden_slab";

/** A player holding one mainhand stack, which is all the spend reads. */
function carrier(held: ItemStack | undefined, gameMode: string = GameMode.Survival) {
    const player = new Player("held_tester", "Tester");
    player.gameMode = gameMode;

    const equippable = new EntityEquippableComponent();
    player.setComponent(EntityComponentTypes.Equippable, equippable);
    if (held) equippable.setEquipment(EquipmentSlot.Mainhand, held);

    return { player, equippable };
}

function mainhand(equippable: EntityEquippableComponent): ItemStack | undefined {
    return equippable.getEquipment(EquipmentSlot.Mainhand);
}

describe("Held item - what a placement costs the survival player", () => {
    beforeEach(() => resetMocks());

    it("spends exactly one from the stack the click was made with", () => {
        const { player, equippable } = carrier(new ItemStack(SLAB_ID, 3));

        consumeHeldItem(player, typeId => typeId === SLAB_ID);

        assert.equal(mainhand(equippable)?.amount, 2, "a stack of three pays for one placement");
        assert.equal(mainhand(equippable)?.typeId, SLAB_ID, "and keeps the item the click named");
    });

    it("empties the slot when the last one is spent", () => {
        const { player, equippable } = carrier(new ItemStack(SLAB_ID, 1));

        consumeHeldItem(player, typeId => typeId === SLAB_ID);

        assert.equal(mainhand(equippable), undefined, "the last slab leaves an empty hand, not a zero stack");
    });

    it("leaves a hand holding something else alone", () => {
        const { player, equippable } = carrier(new ItemStack("minecraft:iron_sword", 1));

        consumeHeldItem(player, typeId => typeId === SLAB_ID);

        assert.equal(mainhand(equippable)?.typeId, "minecraft:iron_sword", "the rule that spent the slab is not the rule for the sword");
        assert.equal(mainhand(equippable)?.amount, 1);
    });

    it("spends nothing in Creative, where placing is free", () => {
        const { player, equippable } = carrier(new ItemStack(SLAB_ID, 3), GameMode.Creative);

        consumeHeldItem(player, typeId => typeId === SLAB_ID);

        assert.equal(mainhand(equippable)?.amount, 3, "Creative places without paying");
    });

    it("spends the plate from a tagged builder in Survival, whose tag buys no discount", () => {
        // The builder tag exempts the player from the inventory sweep and nothing else, so the one
        // reason a placement ignores is Creative.
        const { player, equippable } = carrier(new ItemStack(SLAB_ID, 2));
        player.addTag(PLAYER_TAGS.BUILDER_EXEMPT);

        consumeHeldItem(player, typeId => typeId === SLAB_ID);

        assert.equal(mainhand(equippable)?.amount, 1, "a tagged builder still pays for what they place");
    });

    it("does nothing with an empty hand", () => {
        const { player, equippable } = carrier(undefined);

        assert.doesNotThrow(() => consumeHeldItem(player, () => true));
        assert.equal(mainhand(equippable), undefined);
    });
});
