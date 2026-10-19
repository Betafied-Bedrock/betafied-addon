import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    EquipmentSlot,
    EntityComponentTypes,
    EntityEquippableComponent,
    ItemStack
} from "@minecraft/server";
import { mockPlayers, Player } from "../mocks/minecraftServer.js";
import { toolMiningJob } from "../../packs/BP/scripts/interactions/toolMining.js";

describe("Tool Mining speed effects", () => {
    beforeEach(() => {
        mockPlayers.length = 0;
    });

    it("does not perform raycasts when player is holding neither a pickaxe nor a sword", () => {
        const player = new Player();
        player.name = "Digger";
        player.id = "digger_1";

        const equippable = new EntityEquippableComponent();
        equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:dirt", 64));
        player.setComponent(EntityComponentTypes.Equippable, equippable);

        let raycastCount = 0;
        player.getBlockFromViewDirection = () => {
            raycastCount++;
            return undefined;
        };

        mockPlayers.push(player);
        toolMiningJob();

        assert.equal(raycastCount, 0, "holding dirt must bypass view direction raycasts entirely");
    });

    it("applies mining fatigue when looking at redstone ore with a pickaxe, and haste when looking at leaves with a sword", () => {
        const player = new Player();
        player.name = "Miner";
        player.id = "miner_1";

        const equippable = new EntityEquippableComponent();
        player.setComponent(EntityComponentTypes.Equippable, equippable);

        // Holding pickaxe looking at redstone ore
        equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:iron_pickaxe", 1));
        player.getBlockFromViewDirection = () => ({
            block: { typeId: "minecraft:redstone_ore" } as any,
            face: 0
        });

        mockPlayers.push(player);
        toolMiningJob();

        assert.ok(player.getEffect("mining_fatigue"), "mining fatigue should be active on redstone ore");

        // Switch to sword looking at leaves
        equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:iron_sword", 1));
        player.getBlockFromViewDirection = () => ({
            block: { typeId: "minecraft:oak_leaves" } as any,
            face: 0
        });

        toolMiningJob();

        assert.equal(player.getEffect("mining_fatigue"), undefined, "mining fatigue should clear when switching tools");
        assert.ok(player.getEffect("haste"), "haste should be active on leaves with sword");
    });
});
