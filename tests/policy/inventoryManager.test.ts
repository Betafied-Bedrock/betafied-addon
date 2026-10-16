import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    ItemStack,
    Container,
    EntityComponentTypes,
    EquipmentSlot,
    EntityEquippableComponent,
    ItemComponentTypes,
    GameMode,
    system
} from "@minecraft/server";
import {
    evaluateItemAction,
    sweepInventory,
    sweepPlayers,
    inventorySweepJob
} from "../../packs/BP/scripts/core/inventoryManager.js";
import { PLAYER_TAGS } from "../../packs/BP/scripts/core/permissions.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { mockPlayers, Player } from "../mocks/minecraftServer.js";

describe("Inventory Manager Item Normalization & Unstacking", () => {
    describe("Placer Item Normalization", () => {
        // One id per rule branch — wood stair, stone stair, species log, post-Beta log, the bark-block
        // spelling, stripped log, chest, each slab target, and the fence collapse — rather than every
        // species that reaches the same branch.
        it("replaces vanilla stairs, logs, slabs and fences with bh: equivalents", () => {
            const items = [
                { vanilla: "minecraft:oak_stairs", bh: "bh:oak_stairs" },
                { vanilla: "minecraft:stone_stairs", bh: "bh:cobblestone_stairs" },
                { vanilla: "minecraft:spruce_log", bh: "bh:spruce_log" },
                { vanilla: "minecraft:dark_oak_log", bh: "bh:oak_log" },
                { vanilla: "minecraft:wood", bh: "bh:oak_log" },
                { vanilla: "minecraft:stripped_spruce_log", bh: "bh:spruce_log" },
                { vanilla: "minecraft:chest", bh: "bh:chest" },
                { vanilla: "minecraft:smooth_stone_slab", bh: "bh:stone_slab" },
                { vanilla: "minecraft:oak_slab", bh: "bh:wooden_slab" },
                // A vanilla fence never joins a bh:fence line, so leaving one placeable puts a fence in
                // the world that will not connect to the fence beside it.
                { vanilla: "minecraft:oak_fence", bh: "bh:fence" },
                { vanilla: "minecraft:nether_brick_fence", bh: "bh:fence" }
            ];

            for (const { vanilla, bh } of items) {
                const action = evaluateItemAction(new ItemStack(vanilla, 5));
                assert.equal(action.type, "replace", `Expected ${vanilla} to have action type replace`);
                if (action.type === "replace") {
                    assert.equal(action.item.typeId, bh, `Expected ${vanilla} to convert to ${bh}`);
                    assert.equal(action.item.amount, 5, "the whole stack must ride across");
                }
            }
        });
    });

    describe("Exempt players", () => {
        it("retypes what a Creative or builder_exempt player could place, leaves their own items alone, and clears the moment the tag goes", () => {
            mockPlayers.length = 0;

            const creative = new Player();
            creative.name = "CreativeBuilder";
            creative.id = "builder_creative_1";
            creative.gameMode = GameMode.Creative;

            const creativeInv = new Container(36);
            creativeInv.setItem(0, new ItemStack("minecraft:oak_log", 64));
            creativeInv.setItem(1, new ItemStack("minecraft:elytra", 1));
            creative.setComponent(EntityComponentTypes.Inventory, { container: creativeInv });

            const builder = new Player();
            builder.name = "BuilderBob";
            builder.id = "builder_bob_1";
            builder.gameMode = GameMode.Survival;
            builder.addTag(PLAYER_TAGS.BUILDER_EXEMPT);

            const builderInv = new Container(36);
            builderInv.setItem(0, new ItemStack("minecraft:totem_of_undying", 1));
            builder.setComponent(EntityComponentTypes.Inventory, { container: builderInv });

            const equippable = new EntityEquippableComponent();
            equippable.setEquipment(EquipmentSlot.Chest, new ItemStack("minecraft:netherite_chestplate", 1));
            builder.setComponent(EntityComponentTypes.Equippable, equippable);

            mockPlayers.push(creative, builder);

            sweepPlayers();

            assert.equal(creativeInv.getItem(0)?.typeId, "bh:oak_log", "an exempt player can still only place the era's block");
            assert.equal(creativeInv.getItem(0)?.amount, 64, "the retype must keep the stack count");
            assert.equal(creativeInv.getItem(1)?.typeId, "minecraft:elytra", "the exemption is what keeps the modern item");
            assert.ok(builderInv.getItem(0), "a builder_exempt player keeps their own items too");
            assert.ok(equippable.getEquipment(EquipmentSlot.Chest), "and their equipped modern gear");

            builder.removeTag(PLAYER_TAGS.BUILDER_EXEMPT);

            sweepPlayers();
            assert.equal(builderInv.getItem(0), undefined, "losing the tag must clear on the next sweep, not the next full pass");
            assert.equal(equippable.getEquipment(EquipmentSlot.Chest), undefined);

            mockPlayers.length = 0;
        });
    });

    describe("The era's capped items", () => {
        // Doors and cake are the three items the era held one per slot under a vanilla id this engine no
        // longer spells the same way, so each is retyped onto the pack's id as it is split.
        const cappedFiles: ReadonlyArray<readonly [string, string]> = [
            ["minecraft:wooden_door", "bh:wooden_door"],
            ["minecraft:iron_door", "bh:iron_door"],
            ["minecraft:cake", "bh:cake"]
        ];

        it("retypes a capped item onto the pack id, splitting a stack and leaving a single one whole", () => {
            for (const [vanilla, pack] of cappedFiles) {
                const single = evaluateItemAction(new ItemStack(vanilla, 1));
                assert.equal(single.type, "replace", `${vanilla} alone is retyped, not split`);
                if (single.type === "replace") {
                    assert.equal(single.item.typeId, pack);
                    assert.equal(single.item.amount, 1);
                }

                const stack = evaluateItemAction(new ItemStack(vanilla, 5));
                assert.equal(stack.type, "unstack_utility", `${vanilla} in a stack must be split`);
                if (stack.type === "unstack_utility") {
                    assert.equal(stack.targetId, pack);
                    assert.equal(stack.totalAmount, 5);
                }
            }
        });

        it("splits a vanilla bucket stack without retyping it, one per slot", () => {
            const stacked = evaluateItemAction(new ItemStack("minecraft:bucket", 3));

            assert.equal(stacked.type, "unstack_utility");
            if (stacked.type === "unstack_utility") {
                assert.equal(stacked.targetId, "minecraft:bucket", "a retyped bucket could not be filled");
                assert.equal(stacked.totalAmount, 3);
            }

            assert.equal(
                evaluateItemAction(new ItemStack("minecraft:bucket", 1)).type,
                "keep",
                "a lone bucket stays the engine's own item"
            );

            const player = new Player();
            player.name = "BucketSteve";
            player.id = "bucket_steve_1";
            player.gameMode = GameMode.Survival;

            const inv = new Container(36);
            inv.setItem(0, new ItemStack("minecraft:bucket", 3));
            player.setComponent(EntityComponentTypes.Inventory, { container: inv });

            sweepInventory(player);

            for (const slot of [0, 1, 2]) {
                assert.equal(inv.getItem(slot)?.amount, 1, `slot ${slot} must hold one bucket`);
            }
            assert.equal(inv.getItem(3), undefined, "and the split must not spill past the last one");
        });
    });

    describe("Beta Food Unstacking", () => {
        it("unstacks the food the era would not stack, holding cookies to the era's own limit of eight", () => {
            const stacked = evaluateItemAction(new ItemStack("bh:porkchop", 4));

            assert.equal(stacked.type, "unstack_food", "food the era would not stack is split one per slot");
            if (stacked.type === "unstack_food") {
                assert.equal(stacked.totalAmount, 4);
            }
            assert.equal(evaluateItemAction(new ItemStack("bh:porkchop", 1)).type, "keep", "a lone one stays whole");

            assert.equal(evaluateItemAction(new ItemStack("bh:cookie", 8)).type, "keep", "eight is the era's limit");
            assert.equal(evaluateItemAction(new ItemStack("bh:cookie", 12)).type, "unstack_food", "and anything above it splits");
        });
    });

    describe("Equipment & Armor Slot Clearing", () => {
        it("clears modern armor and offhand items, keeps Beta armor, and strips its enchantments", () => {
            const player = new Player();
            player.name = "TestSteve";
            const inv = new Container(36);
            player.setComponent(EntityComponentTypes.Inventory, { container: inv });
            const equippable = new EntityEquippableComponent();
            player.setComponent(EntityComponentTypes.Equippable, equippable);

            equippable.setEquipment(EquipmentSlot.Head, new ItemStack("minecraft:turtle_helmet", 1));
            equippable.setEquipment(EquipmentSlot.Offhand, new ItemStack("minecraft:shield", 1));

            const enchanted = new ItemStack("minecraft:diamond_leggings", 1);
            enchanted.setComponent(ItemComponentTypes.Enchantable, {
                getEnchantments: () => [{ type: "protection", level: 4 }]
            });
            equippable.setEquipment(EquipmentSlot.Legs, enchanted);

            sweepInventory(player);

            assert.equal(equippable.getEquipment(EquipmentSlot.Head), undefined);
            assert.equal(equippable.getEquipment(EquipmentSlot.Offhand), undefined);

            const legs = equippable.getEquipment(EquipmentSlot.Legs);
            assert.ok(legs, "Beta armor stays equipped");
            assert.equal(legs.typeId, "minecraft:diamond_leggings");
            assert.equal(legs.getComponent(ItemComponentTypes.Enchantable), null, "worn clean of its enchantments");
        });
    });

    describe("Third-Party Namespace Preservation", () => {
        it("does not rewrite modded stacks or equipped gear during a sweep", () => {
            mockPlayers.length = 0;
            const player = new Player();
            player.name = "ModdedSteve";
            player.id = "modded_steve_1";

            const inv = new Container(36);
            inv.setItem(1, new ItemStack("gun:ammo", 64));
            player.setComponent(EntityComponentTypes.Inventory, { container: inv });

            const equippable = new EntityEquippableComponent();
            equippable.setEquipment(EquipmentSlot.Chest, new ItemStack("techmod:jetpack", 1));
            player.setComponent(EntityComponentTypes.Equippable, equippable);

            mockPlayers.push(player);
            sweepPlayers();

            assert.equal(inv.getItem(1)?.typeId, "gun:ammo", "a foreign namespace is not ours to touch");
            assert.equal(inv.getItem(1)?.amount, 64, "which includes leaving its stack size alone");
            assert.equal(equippable.getEquipment(EquipmentSlot.Chest)?.typeId, "techmod:jetpack");

            mockPlayers.length = 0;
        });
    });

    describe("GameMode Change Instant Transition", () => {
        it("immediately clears illegal items when switching from Creative to Survival", () => {
            const player = new Player();
            player.name = "CreativeCharlie";
            player.id = "charlie_1";
            player.gameMode = GameMode.Survival;

            const inv = new Container(36);
            inv.setItem(0, new ItemStack("minecraft:netherite_sword", 1));
            player.setComponent(EntityComponentTypes.Inventory, { container: inv });

            const equippable = new EntityEquippableComponent();
            equippable.setEquipment(EquipmentSlot.Chest, new ItemStack("minecraft:elytra", 1));
            player.setComponent(EntityComponentTypes.Equippable, equippable);

            eventBus.dispatch("playerGameModeChange", {
                player,
                fromGameMode: GameMode.Creative,
                toGameMode: GameMode.Survival
            });

            assert.equal(inv.getItem(0), undefined, "the sword the new mode cannot hold is cleared at once");
            assert.equal(equippable.getEquipment(EquipmentSlot.Chest), undefined, "so is the elytra");
        });
    });

    describe("Event-driven sweep gating", () => {
        function playerHolding(id: string, itemId: string): { player: Player; inv: Container } {
            const player = new Player();
            player.name = id;
            player.id = id;
            player.gameMode = GameMode.Survival;

            const inv = new Container(36);
            inv.setItem(0, new ItemStack(itemId, 1));
            player.setComponent(EntityComponentTypes.Inventory, { container: inv });

            mockPlayers.length = 0;
            mockPlayers.push(player);
            return { player, inv };
        }

        function atTick(tick: number, run: () => void): void {
            system.currentTick = tick;
            try {
                run();
            } finally {
                system.currentTick = 0;
                mockPlayers.length = 0;
            }
        }

        it("leaves an idle player's inventory unread until a safety sweep, and normalizes the moment the engine reports a change", () => {
            const { player, inv } = playerHolding("idle_builder", "minecraft:netherite_sword");

            atTick(3, () => {
                sweepPlayers();
                assert.ok(inv.getItem(0), "a player who touched nothing must not have 36 slots re-read");
            });

            atTick(20, () => {
                mockPlayers.push(player);
                sweepPlayers();
                assert.equal(inv.getItem(0), undefined, "the safety sweep must catch what the event missed");
            });

            inv.setItem(0, new ItemStack("minecraft:netherite_sword", 1));
            atTick(3, () => {
                mockPlayers.push(player);
                eventBus.dispatch("playerInventoryItemChange", { player, slot: 0, itemStack: inv.getItem(0) });
                sweepPlayers();
                assert.equal(inv.getItem(0), undefined, "a reported change must be normalized on the next sweep");
            });
        });
    });

    describe("Sugar Cane Identity", () => {
        it("keeps cane under either of the ids this engine spells it with", () => {
            // `minecraft:sugar_cane` is the item a broken cane pays and `minecraft:reeds` is the block,
            // which an old world's saved inventory can still hold. Reading either as a modern id deleted
            // the cane a player had just harvested.
            assert.equal(evaluateItemAction(new ItemStack("minecraft:sugar_cane", 64)).type, "keep");
            assert.equal(evaluateItemAction(new ItemStack("minecraft:reeds", 64)).type, "keep");
        });
    });

    describe("Inventory Sweep Generator Time-Slicing", () => {
        it("yields every 2 players during a multi-player sweep, and skips an invalid handle", () => {
            mockPlayers.length = 0;
            const p1 = new Player("p1");
            const p2 = new Player("p2");
            const p3 = new Player("p3");
            p3.isValid = false;
            mockPlayers.push(p1, p2, p3);

            system.currentTick = 0;

            const job = inventorySweepJob();
            assert.equal(job.next().done, false, "the generator yields after 2 players");
            assert.equal(job.next().done, true, "and finishes over the invalid handle without throwing");

            mockPlayers.length = 0;
        });
    });

    describe("Dispatch order between item classes", () => {
        // These pin precedence rather than the individual outcomes: each one fails if a classifier is
        // reordered, which is the regression the per-class tables above cannot catch.
        it("strips or splits the pack bow before the tables see it, and retypes the vanilla bow whole", () => {
            const enchanted = new ItemStack("bh:bow", 1);
            enchanted.setComponent(ItemComponentTypes.Enchantable, {
                getEnchantments: () => [{ type: "power", level: 3 }]
            });

            const stripped = evaluateItemAction(enchanted);
            assert.equal(stripped.type, "strip_enchantments");
            if (stripped.type === "strip_enchantments") {
                assert.equal(stripped.item.typeId, "bh:bow");
            }

            const stacked = evaluateItemAction(new ItemStack("bh:bow", 2));
            assert.equal(stacked.type, "unstack_utility");
            if (stacked.type === "unstack_utility") {
                assert.equal(stacked.targetId, "bh:bow");
            }

            assert.equal(
                evaluateItemAction(new ItemStack("bh:bow", 1)).type,
                "keep",
                "a lone unenchanted pack bow must not fall through to the tables"
            );

            const vanilla = evaluateItemAction(new ItemStack("minecraft:bow", 4));
            assert.equal(vanilla.type, "replace");
            if (vanilla.type === "replace") {
                assert.equal(vanilla.item.typeId, "bh:bow");
                assert.equal(vanilla.item.amount, 4, "a vanilla bow is retyped, never unstacked");
            }
        });
    });
});
