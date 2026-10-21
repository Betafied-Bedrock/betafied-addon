import {
    world,
    system,
    ItemStack,
    Player,
    Container,
    EntityHealthComponent,
    ItemUseBeforeEvent,
    EntityComponentTypes
} from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { reportError } from "../core/errorReporter.js";
import { FOOD_CONVERSIONS } from "../policy/normalizer.js";

interface FoodConfig {
    health: number;
    returnContainer?: string;
}

const FOOD_HEALTH: Readonly<Record<string, FoodConfig>> = Object.freeze({
    "bh:apple": { health: 4 },
    "bh:bread": { health: 5 },
    "bh:cookie": { health: 1 },
    "bh:cod": { health: 2 },
    "bh:cooked_cod": { health: 5 },
    "bh:golden_apple": { health: 42 },
    "bh:porkchop": { health: 3 },
    "bh:cooked_porkchop": { health: 8 }
});

// Engine consumes mushroom stew natively, so it bypasses normalizer conversion.
const NATIVE_FOODS: Readonly<Record<string, FoodConfig>> = Object.freeze({
    "minecraft:mushroom_stew": { health: 10, returnContainer: "minecraft:bowl" }
});

function buildFoodItems(): Record<string, FoodConfig> {
    const items: Record<string, FoodConfig> = { ...NATIVE_FOODS };
    for (const convertedId of Object.values(FOOD_CONVERSIONS)) {
        const config = FOOD_HEALTH[convertedId];
        if (!config) {
            // Runs at import, so report instead of throw: the food then keeps whatever the engine does natively.
            reportError(
                { system: "foodAndHealth", operation: "buildFoodItems", target: convertedId },
                "converted food has no configured health"
            );
            continue;
        }
        items[convertedId] = config;
    }
    return items;
}

const FOOD_ITEMS: Readonly<Record<string, FoodConfig>> = Object.freeze(buildFoodItems());

class FoodAndHealth {
    constructor() {
        this.disableNaturalRegeneration();
        this.registerEventHandlers();
    }

    private disableNaturalRegeneration(): void {
        system.run(() => {
            try {
                if (world.gameRules) {
                    world.gameRules.naturalRegeneration = false;
                }
            } catch (e) {
                reportError({
                    system: "foodAndHealth",
                    operation: "disableNaturalRegeneration"
                }, e);
            }
        });
    }

    private registerEventHandlers(): void {
        eventBus.onItemUse(this.handleItemUse.bind(this));
    }

    private handleItemUse(event: ItemUseBeforeEvent): void {
        const player = event.source;
        const itemStack = event.itemStack;

        if (!(player instanceof Player) || !itemStack || !FOOD_ITEMS[itemStack.typeId]) {
            return;
        }

        event.cancel = true;

        const foodId = itemStack.typeId;

        system.run(() => {
            try {
                if (!player.isValid) return;

                const invComp = player.getComponent(EntityComponentTypes.Inventory);
                const inventory = invComp?.container;
                const healthComponent = player.getComponent(EntityComponentTypes.Health);

                if (!inventory || !healthComponent) {
                    reportError(
                        { system: "foodAndHealth", operation: "consumeFoodDeferred", target: player.name },
                        `the cancelled use of ${foodId} found no inventory or health component to consume it`
                    );
                    return;
                }

                const selectedSlot = player.selectedSlotIndex;
                const slotItem = inventory.getItem(selectedSlot);

                // Inventory writes are illegal in the before-event, so the use is cancelled a tick early; a slot that moved on is reported.
                if (slotItem?.typeId !== foodId) {
                    reportError(
                        { system: "foodAndHealth", operation: "consumeFoodDeferred", target: player.name },
                        `slot ${selectedSlot} no longer holds ${foodId}, so the cancelled use consumed nothing`
                    );
                    return;
                }

                this.consumeFoodItem(player, inventory, healthComponent, slotItem, selectedSlot);
            } catch (e) {
                reportError({
                    system: "foodAndHealth",
                    operation: "consumeFoodDeferred",
                    target: player.name
                }, e);
            }
        });
    }

    private consumeFoodItem(
        player: Player,
        inventory: Container,
        healthComponent: EntityHealthComponent,
        item: ItemStack,
        slot: number
    ): void {
        const foodData = FOOD_ITEMS[item.typeId];
        if (!foodData) return;

        const currentHealth = healthComponent.currentValue;
        const maxHealth = healthComponent.defaultValue;
        const isGoldenApple = item.typeId.includes("golden_apple");

        if (currentHealth >= maxHealth && !isGoldenApple) {
            return;
        }

        const newHealth = Math.min(currentHealth + foodData.health, maxHealth);
        if (newHealth > currentHealth) {
            healthComponent.setCurrentValue(newHealth);
        }
        player.playSound("random.burp", { volume: 0.5, pitch: 1.0 });

        const newAmount = item.amount - 1;
        inventory.setItem(slot, newAmount > 0
            ? new ItemStack(item.typeId, newAmount)
            : undefined);

        if (foodData.returnContainer && newAmount <= 0) {
            this.tryAddItemToInventory(inventory, new ItemStack(foodData.returnContainer, 1));
        }
    }

    private tryAddItemToInventory(inventory: Container, itemStack: ItemStack): boolean {
        try {
            if (inventory.emptySlotsCount > 0) {
                return inventory.addItem(itemStack) === undefined;
            }
            return false;
        } catch (err) {
            // The bowl is already spent from the stack, so a failed return loses it without any other trace.
            reportError(
                { system: "foodAndHealth", operation: "returnContainer", target: itemStack.typeId },
                err
            );
            return false;
        }
    }
}

export const foodAndHealth = new FoodAndHealth();
