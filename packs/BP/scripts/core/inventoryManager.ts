import {
    world,
    ItemStack,
    Player,
    Container,
    ItemComponentTypes,
    EntityComponentTypes,
    EquipmentSlot
} from "@minecraft/server";
import { isInventoryExempt } from "./permissions.js";
import { reportError } from "./errorReporter.js";
import {
    BH_BOW_ID, BETA_CAPPED_ITEM_IDS, BETA_CAPPED_ITEM_OF, BETA_CAPPED_VANILLA_IDS,
    isBetaItem, isModItem, isVanillaId
} from "../policy/betaRegistry.js";
import { ARMOR_SLOTS } from "./equipmentSlots.js";
import { normalizeItem, resolvePlacerTarget, FOOD_CONVERSIONS } from "../policy/normalizer.js";
import { tickManager } from "./tickManager.js";
import { eventBus } from "./eventBus.js";

const CONFIG = Object.freeze({
    CHECK_INTERVAL: 1,
    PLAYERS_PER_TICK: 2,
    EQUIPMENT_SWEEP_INTERVAL: 5,
    FULL_SWEEP_INTERVAL: 20,
    MESSAGE_COOLDOWN: 60,
    REMOVE_MSG: "§c[Betafied] §7That item doesn't exist in Beta 1.7.3!",
    ENCHANT_MSG: "§c[Betafied] §7Enchantments removed! Beta 1.7.3 had no enchanting."
});

const BH_FOOD_IDS: ReadonlySet<string> = Object.freeze(new Set(Object.values(FOOD_CONVERSIONS)));

function maxBetaStackSize(typeId: string): number {
    return typeId === "bh:cookie" || typeId === "minecraft:cookie" ? 8 : 1;
}

const msgCooldowns = new Map<string, number>();
const previousExemptionState = new Map<string, boolean>();

const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = Object.freeze([
    ...ARMOR_SLOTS,
    EquipmentSlot.Offhand
]);

type SlotKey = number | EquipmentSlot;

// Key domain is fixed at construction: container slots are numbers, equipment slots are EquipmentSlot.
interface SlotAccessor<K extends SlotKey> {
    readonly keys: readonly K[];
    readonly label: string;
    get(key: K): ItemStack | undefined;
    set(key: K, item: ItemStack | undefined): void;
    split?(key: K, targetId: string, amount: number): void;
}

const STANDARD_INVENTORY_SIZE = 36;
const STANDARD_INVENTORY_KEYS: readonly number[] = Object.freeze(
    Array.from({ length: STANDARD_INVENTORY_SIZE }, (_, index) => index)
);

function inventorySlots(player: Player): SlotAccessor<number> | undefined {
    const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
    if (!container) return undefined;

    const keys = container.size === STANDARD_INVENTORY_SIZE
        ? STANDARD_INVENTORY_KEYS
        : Array.from({ length: container.size }, (_, index) => index);

    return {
        keys,
        label: "INV: Removed",
        get: (key) => container.getItem(key),
        set: (key, item) => container.setItem(key, item),
        split: (key, targetId, amount) => unstackItem(container, key, targetId, amount)
    };
}

function equipmentSlots(player: Player): SlotAccessor<EquipmentSlot> | undefined {
    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    if (!equippable) return undefined;

    return {
        keys: EQUIPMENT_SLOTS,
        label: "INV: Removed equipped",
        get: (key) => equippable.getEquipment(key),
        set: (key, item) => equippable.setEquipment(key, item)
    };
}

function sweepPlacers(accessor?: SlotAccessor<SlotKey>): void {
    if (!accessor) return;

    for (const key of accessor.keys) {
        const item = accessor.get(key);
        if (!item) continue;

        const target = resolvePlacerTarget(item.typeId);
        if (target && target.action === "convert") accessor.set(key, new ItemStack(target.targetId, item.amount));
    }
}

export function sweepExemptInventory(player: Player): void {
    sweepPlacers(inventorySlots(player));
    sweepExemptEquipment(player);
}

export function sweepExemptEquipment(player: Player): void {
    sweepPlacers(equipmentSlots(player));
}

const dirtyInventories = new Set<string>();

export function markInventoryDirty(playerId: string): void {
    dirtyInventories.add(playerId);
}

function sweepPlayer(player: Player, fullSweep: boolean, equipmentSweep: boolean): void {
    const isExempt = isInventoryExempt(player);
    const wasExempt = previousExemptionState.get(player.id) ?? false;
    const exemptionFlipped = isExempt !== wasExempt;

    previousExemptionState.set(player.id, isExempt);

    const dirty = dirtyInventories.delete(player.id);
    const sweepAll = dirty || exemptionFlipped || fullSweep;

    if (isExempt) {
        if (sweepAll) sweepExemptInventory(player);
        else if (equipmentSweep) sweepExemptEquipment(player);
        return;
    }

    if (wasExempt) msgCooldowns.delete(player.id);

    if (sweepAll) sweepInventory(player);
    else if (equipmentSweep) sweepEquipment(player);
}

export function* inventorySweepJob(): Generator<void, void, unknown> {
    const tick = tickManager.getCurrentTick();
    const fullSweep = tick % CONFIG.FULL_SWEEP_INTERVAL === 0;
    const equipmentSweep = tick % CONFIG.EQUIPMENT_SWEEP_INTERVAL === 0;

    if (!fullSweep && !equipmentSweep && dirtyInventories.size === 0) return;

    let processed = 0;
    for (const player of world.getAllPlayers()) {
        if (!player.isValid) continue;

        try {
            sweepPlayer(player, fullSweep, equipmentSweep);
        } catch (e) {
            reportError({
                system: "InventoryManager",
                operation: "sweepInventory",
                target: player.name
            }, e);
        }

        processed++;
        if (processed % CONFIG.PLAYERS_PER_TICK === 0) {
            yield;
        }
    }
}

export function sweepPlayers(): void {
    const job = inventorySweepJob();
    while (!job.next().done) {
        // Runs the sweep to completion, unlike the time-sliced registration above.
    }
}

tickManager.register("inventoryManager", CONFIG.CHECK_INTERVAL, inventorySweepJob, 0);

type ItemNormalizationAction =
    | { type: "keep" }
    | { type: "delete"; reason: "banned" | "unsupported" }
    | { type: "replace"; item: ItemStack }
    | { type: "unstack_food"; convertedId: string; totalAmount: number }
    | { type: "unstack_utility"; targetId: string; totalAmount: number }
    | { type: "strip_enchantments"; item: ItemStack };

function preserveDurability(sourceItem: ItemStack, targetItem: ItemStack): void {
    const oldDur = sourceItem.getComponent(ItemComponentTypes.Durability);
    const newDur = targetItem.getComponent(ItemComponentTypes.Durability);
    if (oldDur && newDur) {
        newDur.damage = oldDur.damage;
    }
}

function canHoldEnchantments(id: string): boolean {
    return id.endsWith("_sword") ||
        id.endsWith("_pickaxe") ||
        id.endsWith("_axe") ||
        id.endsWith("_shovel") ||
        id.endsWith("_hoe") ||
        id.endsWith("_helmet") ||
        id.endsWith("_chestplate") ||
        id.endsWith("_leggings") ||
        id.endsWith("_boots") ||
        id === "minecraft:bow" ||
        id === BH_BOW_ID ||
        id === "minecraft:fishing_rod" ||
        id === "minecraft:shears" ||
        id === "minecraft:flint_and_steel" ||
        id === "minecraft:book";
}

function stripEnchantments(item: ItemStack, id: string): ItemNormalizationAction | undefined {
    if (!canHoldEnchantments(id)) return undefined;

    const enchantable = item.getComponent(ItemComponentTypes.Enchantable);
    if (!enchantable || enchantable.getEnchantments().length === 0) return undefined;

    const cleanItem = new ItemStack(id, item.amount);
    preserveDurability(item, cleanItem);
    return { type: "strip_enchantments", item: cleanItem };
}

function evaluatePackItem(id: string, item: ItemStack): ItemNormalizationAction | undefined {
    if (BH_FOOD_IDS.has(id)) {
        return item.amount > maxBetaStackSize(id)
            ? { type: "unstack_food", convertedId: id, totalAmount: item.amount }
            : { type: "keep" };
    }

    if (id === BH_BOW_ID) {
        if (item.amount > 1) {
            return { type: "unstack_utility", targetId: id, totalAmount: item.amount };
        }
        return stripEnchantments(item, id) ?? { type: "keep" };
    }

    return undefined;
}

function evaluateVanillaOverride(id: string, item: ItemStack): ItemNormalizationAction | undefined {
    if (BETA_CAPPED_VANILLA_IDS.has(id)) {
        return item.amount > 1
            ? { type: "unstack_utility", targetId: id, totalAmount: item.amount }
            : { type: "keep" };
    }

    if (id === "minecraft:bow") {
        const replacement = new ItemStack(BH_BOW_ID, item.amount);
        preserveDurability(item, replacement);
        return { type: "replace", item: replacement };
    }

    return undefined;
}

function evaluateRetargetedItem(id: string, item: ItemStack): ItemNormalizationAction | undefined {
    const placer = resolvePlacerTarget(id);
    if (placer && placer.action === "convert") {
        const targetId = placer.targetId;
        return item.amount > 1 && BETA_CAPPED_ITEM_IDS.has(targetId)
            ? { type: "unstack_utility", targetId, totalAmount: item.amount }
            : { type: "replace", item: new ItemStack(targetId, item.amount) };
    }

    const cappedItem = BETA_CAPPED_ITEM_OF[id];
    if (cappedItem !== undefined) {
        return item.amount > 1
            ? { type: "unstack_utility", targetId: cappedItem, totalAmount: item.amount }
            : { type: "replace", item: new ItemStack(cappedItem, item.amount) };
    }

    if (FOOD_CONVERSIONS[id]) {
        return { type: "unstack_food", convertedId: FOOD_CONVERSIONS[id], totalAmount: item.amount };
    }

    return undefined;
}

function evaluateNormalizedItem(id: string, item: ItemStack): ItemNormalizationAction {
    const norm = normalizeItem(id);
    if (norm.action === "remove") {
        return { type: "delete", reason: "banned" };
    }

    if (norm.action === "convert") {
        const replacement = new ItemStack(norm.targetId, item.amount);
        preserveDurability(item, replacement);
        return { type: "replace", item: replacement };
    }

    return stripEnchantments(item, id)
        ?? (isBetaItem(id) ? { type: "keep" } : { type: "delete", reason: "unsupported" });
}

export function evaluateItemAction(item: ItemStack): ItemNormalizationAction {
    const id = item.typeId;

    if (!isVanillaId(id) && !isModItem(id)) {
        return { type: "keep" };
    }

    return evaluatePackItem(id, item)
        ?? (isVanillaId(id) ? undefined : { type: "keep" })
        ?? evaluateVanillaOverride(id, item)
        ?? evaluateRetargetedItem(id, item)
        ?? evaluateNormalizedItem(id, item);
}

function freeSlots(inv: Container, slotIndex: number): number {
    let free = 0;
    for (let slot = 0; slot < inv.size; slot++) {
        if (slot !== slotIndex && !inv.getItem(slot)) free++;
    }
    return free;
}

// Never drop the spill: the engine merges a drop back into the capped slot and the next sweep evicts it again.
function unstackItem(inv: Container, slotIndex: number, targetId: string, amount: number): void {
    const maxStack = maxBetaStackSize(targetId);
    const slotAmount = Math.min(amount, maxStack);
    const spill = amount - slotAmount;

    if (spill > maxStack * freeSlots(inv, slotIndex)) return;

    inv.setItem(slotIndex, new ItemStack(targetId, slotAmount));

    let remaining = spill;
    for (let slot = 0; slot < inv.size && remaining > 0; slot++) {
        if (inv.getItem(slot)) continue;
        const place = Math.min(remaining, maxStack);
        inv.setItem(slot, new ItemStack(targetId, place));
        remaining -= place;
    }
}

function sweepStrict(player: Player, accessor?: SlotAccessor<SlotKey>): { removed: boolean; stripped: boolean } {
    if (!accessor) return { removed: false, stripped: false };

    let removed = false;
    let stripped = false;

    for (const key of accessor.keys) {
        const item = accessor.get(key);
        if (!item) continue;

        const action = evaluateItemAction(item);

        switch (action.type) {
            case "keep":
                break;
            case "delete":
                accessor.set(key, undefined);
                removed = true;
                if (action.reason === "unsupported") console.log(`${accessor.label} ${item.typeId} from ${player.name}`);
                break;
            case "replace":
            case "strip_enchantments":
                accessor.set(key, action.item);
                stripped ||= action.type === "strip_enchantments";
                break;
            case "unstack_food":
            case "unstack_utility":
                if (!accessor.split) {
                    accessor.set(key, undefined);
                    removed = true;
                    break;
                }
                accessor.split(key, action.type === "unstack_food" ? action.convertedId : action.targetId, action.totalAmount);
                break;
            default:
                break;
        }
    }

    return { removed, stripped };
}

function reportSweep(player: Player, { removed, stripped }: { removed: boolean; stripped: boolean }): void {
    if (removed) notifyPlayer(player, CONFIG.REMOVE_MSG);
    if (stripped) notifyPlayer(player, CONFIG.ENCHANT_MSG);
}

export function sweepInventory(player: Player): void {
    reportSweep(player, sweepStrict(player, inventorySlots(player)));
    sweepEquipment(player);
}

export function sweepEquipment(player: Player): void {
    reportSweep(player, sweepStrict(player, equipmentSlots(player)));
}

function notifyPlayer(player: Player, msg: string): void {
    const now = tickManager.getCurrentTick();
    const last = msgCooldowns.get(player.id) ?? 0;
    if (now - last >= CONFIG.MESSAGE_COOLDOWN) {
        player.sendMessage(msg);
        msgCooldowns.set(player.id, now);
    }
}

eventBus.onPlayerInventoryItemChange((ev) => {
    if (ev.player?.isValid) {
        markInventoryDirty(ev.player.id);
    }
});

eventBus.onPlayerGameModeChange((ev) => {
    if (!ev.player?.isValid) return;
    markInventoryDirty(ev.player.id);
    if (!isInventoryExempt(ev.player)) {
        msgCooldowns.delete(ev.player.id);
        previousExemptionState.set(ev.player.id, false);
        sweepInventory(ev.player);
    }
});

eventBus.onPlayerLeave((ev) => {
    msgCooldowns.delete(ev.playerId);
    previousExemptionState.delete(ev.playerId);
    dirtyInventories.delete(ev.playerId);
});
