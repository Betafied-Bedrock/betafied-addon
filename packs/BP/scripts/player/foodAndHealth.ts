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
import { FOOD_CONVERSIONS } from "../core/normalizer.js";

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
            // This runs at import, so a missing entry is reported rather than thrown: a throw would
            // abort the script before any handler exists to report it. The food then simply keeps
            // whatever the engine does with it natively.
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

                if (!inventory || !healthComponent) return;

                const selectedSlot = player.selectedSlotIndex;
                const slotItem = inventory.getItem(selectedSlot);

                // Writing to the inventory is not legal inside the before-event, so the use is
                // cancelled one tick before the write. That is the whole revalidation window: if the
                // slot moved on in it, the cancelled use is reported rather than dropped.
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
        } catch {
            return false;
        }
    }
}

export const foodAndHealth = new FoodAndHealth();
