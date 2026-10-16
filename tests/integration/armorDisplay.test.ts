import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    getBaseArmorPoints,
    getEffectiveArmorPoints,
    updatePlayerArmorDisplay,
    damageArmor,
    computeBetaArmorMitigation
} from "../../packs/BP/scripts/combat/armor.js";
import {
    Player,
    EquipmentSlot,
    EntityComponentTypes,
    ItemComponentTypes,
    EntityDamageCause,
    GameMode
} from "../mocks/minecraftServer.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";

describe("Beta Armor Points & Titleraw HUD Display", () => {
    describe("getBaseArmorPoints", () => {
        it("gives every material the same slot protection, as Beta 1.7.3 did", () => {
            assert.equal(getBaseArmorPoints("minecraft:diamond_helmet"), 3);
            assert.equal(getBaseArmorPoints("minecraft:diamond_chestplate"), 8);
            assert.equal(getBaseArmorPoints("minecraft:diamond_leggings"), 6);
            assert.equal(getBaseArmorPoints("minecraft:diamond_boots"), 3);

            // Pre-Beta-1.9 armor indexed protection by slot alone, so leather matched diamond
            // point for point; the tier only changed how long the piece lasted.
            assert.equal(getBaseArmorPoints("minecraft:leather_chestplate"), 8);
            assert.equal(getBaseArmorPoints("minecraft:iron_helmet"), 3);

            assert.equal(getBaseArmorPoints("custom:ruby_chestplate"), 8);
            assert.equal(getBaseArmorPoints("custom:topaz_boots"), 3);
        });

        it("keeps post-Beta and non-armor items at zero points", () => {
            assert.equal(getBaseArmorPoints("minecraft:netherite_helmet"), 0);
            assert.equal(getBaseArmorPoints("minecraft:turtle_helmet"), 0);
            assert.equal(getBaseArmorPoints("minecraft:stick"), 0);
        });
    });

    describe("getEffectiveArmorPoints", () => {
        it("returns 0 when the player carries no equippable component", () => {
            const player = new Player();
            assert.equal(getEffectiveArmorPoints(player as any), 0);
        });

        it("counts the pieces as Beta's getTotalArmorValue did, scaling the total by durability", () => {
            const player = new Player();
            const chestDur = { maxDurability: 100, damage: 0 };

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Head, { typeId: "minecraft:diamond_helmet", getComponent: () => null }],
                [EquipmentSlot.Chest, {
                    typeId: "minecraft:diamond_chestplate",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? chestDur : null
                }],
                [EquipmentSlot.Legs, { typeId: "minecraft:diamond_leggings", getComponent: () => null }],
                [EquipmentSlot.Feet, { typeId: "minecraft:diamond_boots", getComponent: () => null }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null
            });

            assert.equal(getEffectiveArmorPoints(player as any), 20, "a full, undamaged set is Beta's twenty");

            // ((20 - 1) * 53) / 103 + 1 floors to ten once the chestplate is half worn.
            chestDur.damage = 50;
            assert.equal(getEffectiveArmorPoints(player as any), 10);
        });
    });

    describe("updatePlayerArmorDisplay", () => {
        it("broadcasts titleraw command with _a prefix and points to update the HUD", () => {
            const player = new Player();
            player.id = "test_player_armor_1";

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Chest, { typeId: "minecraft:diamond_chestplate", getComponent: () => null }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null
            });

            updatePlayerArmorDisplay(player as any, true);

            assert.equal(player.commandsRun.length, 1);
            assert.equal(player.commandsRun[0], 'titleraw @s title {"rawtext":[{"text":"_a8"}]}');
        });

        it("does not re-broadcast titleraw if armor points remain unchanged", () => {
            const player = new Player();
            player.id = "test_player_armor_2";

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Chest, { typeId: "minecraft:diamond_chestplate", getComponent: () => null }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null
            });

            updatePlayerArmorDisplay(player as any, true);
            assert.equal(player.commandsRun.length, 1);

            updatePlayerArmorDisplay(player as any, false);
            assert.equal(player.commandsRun.length, 1);
        });

        it("sends _a0 and suppresses armor display when player is in Creative mode", () => {
            const player = new Player();
            player.id = "test_player_creative";
            player.gameMode = GameMode.Creative;

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Chest, { typeId: "minecraft:diamond_chestplate", getComponent: () => null }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null
            });

            updatePlayerArmorDisplay(player as any, true);

            assert.equal(player.commandsRun.length, 1);
            assert.equal(player.commandsRun[0], 'titleraw @s title {"rawtext":[{"text":"_a0"}]}');
        });
    });

    describe("damageArmor - Classic Beta 1.7.3 Durability Degradation", () => {
        it("increments damage by 1 on each armored piece and leaves a non-armor item alone", () => {
            const player = new Player();
            player.id = "test_player_damage_armor";

            const helmetDur = { maxDurability: 100, damage: 10 };
            const chestDur = { maxDurability: 200, damage: 20 };
            const stickDur = { maxDurability: 100, damage: 0 };

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Head, {
                    typeId: "minecraft:diamond_helmet",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? helmetDur : null
                }],
                [EquipmentSlot.Chest, {
                    typeId: "minecraft:diamond_chestplate",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? chestDur : null
                }],
                [EquipmentSlot.Feet, {
                    typeId: "minecraft:stick",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? stickDur : null
                }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null,
                setEquipment: (slot: EquipmentSlot, item: any) => {
                    if (!item) equipment.delete(slot);
                    else equipment.set(slot, item);
                    return true;
                }
            });

            damageArmor(player as any);

            assert.equal(helmetDur.damage, 11);
            assert.equal(chestDur.damage, 21);
            assert.equal(stickDur.damage, 0, "a piece worth no armor points never wears");
        });

        it("breaks and clears armor piece when damage reaches maxDurability, playing break sound", () => {
            const player = new Player();
            player.id = "test_player_break_armor";

            const helmetDur = { maxDurability: 50, damage: 49 };

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Head, {
                    typeId: "minecraft:iron_helmet",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? helmetDur : null
                }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null,
                setEquipment: (slot: EquipmentSlot, item: any) => {
                    if (!item) equipment.delete(slot);
                    else equipment.set(slot, item);
                    return true;
                }
            });

            damageArmor(player as any);

            assert.equal(equipment.get(EquipmentSlot.Head), undefined);
            assert.equal(player.soundsPlayed.length, 1);
            assert.equal(player.soundsPlayed[0].soundId, "random.break");
        });
    });

    describe("onEntityHurt Durability Loss & Parity", () => {
        it("reduces armor durability and restores blocked health when taking combat damage", () => {
            const player = new Player();
            player.id = "test_player_combat_hurt";
            const chestDur = { maxDurability: 200, damage: 0 };

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Chest, {
                    typeId: "minecraft:diamond_chestplate",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? chestDur : null
                }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null,
                setEquipment: (slot: EquipmentSlot, item: any) => {
                    if (!item) equipment.delete(slot);
                    else equipment.set(slot, item);
                    return true;
                }
            });

            const health = { currentValue: 18, effectiveMax: 20, setCurrentValue(v: number) { this.currentValue = v; } };
            player.setComponent(EntityComponentTypes.Health, health);

            eventBus.dispatch("entityHurt", {
                hurtEntity: player,
                damage: 4,
                damageSource: { cause: EntityDamageCause.entityAttack }
            });

            assert.equal(chestDur.damage, 1);
            // Beta 1.7.3 EntityPlayer damage: weighted = 4 * (25 - 8) + 0 = 68; betaDamage = floor(68/25) = 2; blocked = 4 - 2 = 2.
            assert.equal(health.currentValue, 20);
        });

        it("wears armor for a cause Beta armors against, and never for void, starve or zero damage", () => {
            const player = new Player();
            player.id = "test_player_hurt_causes";

            const bootsDur = { maxDurability: 100, damage: 5 };
            const chestDur = { maxDurability: 200, damage: 0 };

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Feet, {
                    typeId: "minecraft:iron_boots",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? bootsDur : null
                }],
                [EquipmentSlot.Chest, {
                    typeId: "minecraft:diamond_chestplate",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? chestDur : null
                }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null,
                setEquipment: (slot: EquipmentSlot, item: any) => {
                    if (!item) equipment.delete(slot);
                    else equipment.set(slot, item);
                    return true;
                }
            });

            const health = { currentValue: 18, effectiveMax: 20, setCurrentValue(v: number) { this.currentValue = v; } };
            player.setComponent(EntityComponentTypes.Health, health);

            // The bypasses go first, while both counters are still pristine.
            for (const cause of [EntityDamageCause.void, EntityDamageCause.starve]) {
                eventBus.dispatch("entityHurt", {
                    hurtEntity: player,
                    damage: 4,
                    damageSource: { cause }
                });
                assert.equal(chestDur.damage, 0, `${cause} damage bypasses armor`);
            }

            eventBus.dispatch("entityHurt", {
                hurtEntity: player,
                damage: 0,
                damageSource: { cause: EntityDamageCause.entityAttack }
            });
            assert.equal(chestDur.damage, 0, "a zero-damage hit is not a hit");

            eventBus.dispatch("entityHurt", {
                hurtEntity: player,
                damage: 3,
                damageSource: { cause: EntityDamageCause.fall }
            });
            assert.equal(bootsDur.damage, 6, "fall damage is one of Beta's causes");
        });

        it("wears the plate on the blow that kills, and only once when both events carry it", () => {
            const player = new Player();
            player.id = "test_player_lethal_blow";
            const chestDur = { maxDurability: 200, damage: 0 };

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Chest, {
                    typeId: "minecraft:diamond_chestplate",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? chestDur : null
                }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null,
                setEquipment: (slot: EquipmentSlot, item: any) => {
                    if (!item) equipment.delete(slot);
                    else equipment.set(slot, item);
                    return true;
                }
            });

            const health = { currentValue: 0, effectiveMax: 20, setCurrentValue(v: number) { this.currentValue = v; } };
            player.setComponent(EntityComponentTypes.Health, health);

            // The pack's death verdict cancels this event, so nothing below it runs for the killing
            // blow -- the after-event this file's other cases use never arrives for it.
            eventBus.dispatch("entityHurtBefore", {
                cancel: false,
                hurtEntity: player,
                damage: 4,
                damageSource: { cause: EntityDamageCause.entityAttack }
            });

            assert.equal(chestDur.damage, 1, "the plate is worn by the blow that killed its owner");

            // A process that runs the armor feature without the death verdict delivers both events for
            // that one hit, and one hit is one point of wear.
            eventBus.dispatch("entityHurt", {
                hurtEntity: player,
                damage: 4,
                damageSource: { cause: EntityDamageCause.entityAttack }
            });

            assert.equal(chestDur.damage, 1, "the same blow never wears the plate twice");
        });
    });

    describe("computeBetaArmorMitigation", () => {
        it("returns raw damage when incoming damage or defense points are zero", () => {
            const noDmg = computeBetaArmorMitigation(0, 10, 5);
            assert.equal(noDmg.damageInflicted, 0);
            assert.equal(noDmg.updatedRemainder, 5);

            const noArmor = computeBetaArmorMitigation(10, 0, 3);
            assert.equal(noArmor.damageInflicted, 10);
            assert.equal(noArmor.damageAbsorbed, 0);
        });

        it("mitigates damage using authentic 1/25 ratio per point and carries remainders", () => {
            // 4 damage with 8 armor points:
            // penetrationFactor = 25 - 8 = 17
            // accumulatedUnits = 4 * 17 + 0 = 68
            // damageInflicted = floor(68 / 25) = 2
            // updatedRemainder = 68 % 25 = 18
            // damageAbsorbed = 4 - 2 = 2
            const hit1 = computeBetaArmorMitigation(4, 8, 0);
            assert.equal(hit1.damageInflicted, 2);
            assert.equal(hit1.damageAbsorbed, 2);
            assert.equal(hit1.updatedRemainder, 18);

            // Second hit with remainder 18:
            // accumulatedUnits = 4 * 17 + 18 = 86
            // damageInflicted = floor(86 / 25) = 3
            // updatedRemainder = 86 % 25 = 11
            const hit2 = computeBetaArmorMitigation(4, 8, hit1.updatedRemainder);
            assert.equal(hit2.damageInflicted, 3);
            assert.equal(hit2.updatedRemainder, 11);
        });
    });
});
