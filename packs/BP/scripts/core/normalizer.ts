import {
    BH_BOW_ID, BH_CAKE_ID, BH_CHEST_ID, BH_FENCE_ID, BH_SIGN_ID, BH_WOODEN_DOOR_ID,
    BETA_CAPPED_ITEM_OF, isBetaBlock, isBetaItem, isVanillaId, WOOD_SPECIES
} from "./betaRegistry.js";

export type NormalizationAction = "keep" | "convert" | "remove";

export interface NormalizationResult {
    readonly action: NormalizationAction;
    readonly targetId?: string;
}

const ORE_DROP_CONVERSIONS: Readonly<Record<string, string>> = Object.freeze({
    "minecraft:raw_iron": "minecraft:iron_ore",
    "minecraft:raw_gold": "minecraft:gold_ore"
});

/**
 * Exact ids Bedrock exposes under a second name for one item the era knew by one. Sugar cane is the
 * case that bit: the world still holds `minecraft:reeds`, but a drop carries `minecraft:sugar_cane`,
 * so an id the pack never registered reads as post-Beta and the drop is deleted at load.
 */
const ITEM_ID_ALIASES: Readonly<Record<string, string>> = Object.freeze({
    "minecraft:sugar_cane": "minecraft:reeds"
});

export function normalizeEntityDrop(itemId: string): NormalizationResult {
    const oreReplacement = ORE_DROP_CONVERSIONS[itemId];
    if (oreReplacement) {
        return { action: "convert", targetId: oreReplacement };
    }
    if (isBetaItem(itemId)) {
        return { action: "keep" };
    }
    return normalizeItem(itemId);
}

function matchCopper(bareId: string): NormalizationResult | null {
    if (!bareId.includes("copper")) return null;
    if (bareId.includes("ore")) return { action: "convert", targetId: "minecraft:stone" };
    if (bareId.includes("stairs")) return { action: "convert", targetId: "minecraft:cobblestone_stairs" };
    if (bareId.includes("slab")) return { action: "convert", targetId: "minecraft:cobblestone_slab" };
    return { action: "convert", targetId: "minecraft:cobblestone" };
}

const NETHER_ORES: Readonly<Record<string, string>> = Object.freeze({
    "quartz_ore": "minecraft:netherrack",
    "nether_gold_ore": "minecraft:netherrack",
    "ancient_debris": "minecraft:netherrack"
});

function matchNetherOre(bareId: string): NormalizationResult | null {
    const target = NETHER_ORES[bareId];
    return target === undefined ? null : { action: "convert", targetId: target };
}

const STONE_VARIANTS = new Set([
    "andesite", "granite", "diorite", "tuff", "calcite",
    "dripstone_block", "deepslate", "smooth_basalt"
]);

function matchStone(bareId: string): NormalizationResult | null {
    if (bareId.includes("cobbled_deepslate")) {
        return { action: "convert", targetId: "minecraft:cobblestone" };
    }
    if (STONE_VARIANTS.has(bareId) || bareId.endsWith("_deepslate_ore")) {
        return { action: "convert", targetId: "minecraft:stone" };
    }
    return null;
}

export function isStoneCompound(bareId: string): boolean {
    return bareId.includes("stone") || bareId.includes("cobble") || bareId.includes("deepslate") || bareId.includes("brick");
}

function matchWoodBuilding(bareId: string): NormalizationResult | null {
    if (bareId.endsWith("_planks")) return { action: "convert", targetId: "minecraft:oak_planks" };
    if (bareId.endsWith("_log") || bareId.endsWith("_stem") || bareId.endsWith("_wood") || bareId.includes("stripped_") || bareId === "wood" || bareId === "log" || bareId === "log2") {
        return { action: "convert", targetId: "minecraft:oak_log" };
    }
    if (bareId.endsWith("_fence") || bareId.endsWith("_fence_gate")) return { action: "convert", targetId: BH_FENCE_ID };

    if (bareId.endsWith("_stairs")) {
        return { action: "convert", targetId: isStoneCompound(bareId) ? "minecraft:cobblestone_stairs" : "minecraft:oak_stairs" };
    }
    if (bareId.endsWith("_slab")) {
        return { action: "convert", targetId: isStoneCompound(bareId) ? "minecraft:cobblestone_slab" : "bh:wooden_slab" };
    }
    return null;
}

const SIMPLE_WOOD_ITEMS: Readonly<Record<string, string>> = Object.freeze({
    _leaves: "minecraft:oak_leaves",
    _door: BH_WOODEN_DOOR_ID,
    _trapdoor: "minecraft:trapdoor",
    _sign: BH_SIGN_ID,
    _boat: "minecraft:boat",
    _sapling: "minecraft:oak_sapling"
});

// Hoisted entries to avoid per-slot allocation in inventory sweep.
const SIMPLE_WOOD_ENTRIES: readonly (readonly [string, string])[] = Object.freeze(
    Object.entries(SIMPLE_WOOD_ITEMS)
);

function matchWoodItem(bareId: string): NormalizationResult | null {
    for (const [suffix, target] of SIMPLE_WOOD_ENTRIES) {
        if (bareId.endsWith(suffix)) {
            return { action: "convert", targetId: target };
        }
    }
    return null;
}

export function normalizeItem(itemId: string): NormalizationResult {
    const alias = ITEM_ID_ALIASES[itemId];
    if (alias !== undefined) {
        return { action: "convert", targetId: alias };
    }

    if (isBetaItem(itemId)) {
        return { action: "keep" };
    }

    if (!isVanillaId(itemId)) {
        return { action: "keep" };
    }

    const bareId = itemId.slice(10);

    return matchCopper(bareId)
        ?? matchStone(bareId)
        ?? matchNetherOre(bareId)
        ?? matchWoodBuilding(bareId)
        ?? matchWoodItem(bareId)
        ?? { action: "remove" };
}

export function normalizeBlock(blockId: string): NormalizationResult {
    if (isBetaBlock(blockId)) {
        return { action: "keep" };
    }
    return normalizeItem(blockId);
}

/** Maps vanilla placer item to custom bh: replacement block. */
export function resolvePlacerReplacement(id: string): string | undefined {
    if (!id.startsWith("minecraft:")) {
        return undefined;
    }

    const bareId = id.slice(10);

    if (bareId === "wood" || bareId === "log" || bareId === "log2") {
        return "bh:oak_log";
    }
    if (bareId.endsWith("_log") || bareId.endsWith("_wood") || bareId.endsWith("_stem") || bareId.endsWith("_hyphae") || bareId.startsWith("stripped_")) {
        if (bareId.includes("spruce")) return "bh:spruce_log";
        if (bareId.includes("birch")) return "bh:birch_log";
        return "bh:oak_log";
    }

    if (bareId === "chest") {
        return BH_CHEST_ID;
    }

    // Every post-Beta species collapses onto the era's oak door; the iron door only ever answered to
    // its own id, so the table decides between the two and the suffix catches the rest.
    if (bareId.endsWith("_door")) {
        return BETA_CAPPED_ITEM_OF[id] ?? BH_WOODEN_DOOR_ID;
    }

    // Beta had one sign, cut from any of its three woods, and one cake.
    if (bareId.endsWith("_sign")) {
        return BH_SIGN_ID;
    }

    if (bareId === "cake") {
        return BH_CAKE_ID;
    }

    if (bareId.endsWith("_fence") || bareId.endsWith("_fence_gate")) {
        return BH_FENCE_ID;
    }

    if (bareId.endsWith("_stairs")) {
        const prefix = bareId.replace(/_mosaic_stairs|_stairs/, "");
        return WOOD_SPECIES.has(prefix) ? "bh:oak_stairs" : "bh:cobblestone_stairs";
    }

    if (bareId.endsWith("_slab")) {
        if (bareId.includes("cobble")) return "bh:cobblestone_slab";
        if (bareId.includes("sandstone")) return "bh:sandstone_slab";
        return isStoneCompound(bareId) ? "bh:stone_slab" : "bh:wooden_slab";
    }

    return undefined;
}

/** Vanilla foods retyped into instant-consumption bh: items. */
export const FOOD_CONVERSIONS: Readonly<Record<string, string>> = Object.freeze({
    "minecraft:apple": "bh:apple",
    "minecraft:bread": "bh:bread",
    "minecraft:porkchop": "bh:porkchop",
    "minecraft:cooked_porkchop": "bh:cooked_porkchop",
    "minecraft:cod": "bh:cod",
    "minecraft:cooked_cod": "bh:cooked_cod",
    "minecraft:golden_apple": "bh:golden_apple",
    "minecraft:cookie": "bh:cookie",
    "minecraft:salmon": "bh:cod",
    "minecraft:cooked_salmon": "bh:cooked_cod",
    "minecraft:fish": "bh:cod",
    "minecraft:cooked_fish": "bh:cooked_cod"
});

/** Returns replacement ID for held or picked-up items, or undefined if untouched. */
export function resolveHeldItemReplacement(id: string): string | undefined {
    if (id === "minecraft:bow") {
        return BH_BOW_ID;
    }
    return resolvePlacerReplacement(id) ?? FOOD_CONVERSIONS[id] ?? BETA_CAPPED_ITEM_OF[id];
}

/** Resolves normalized drop ID, or null if removed. */
export function resolveDropId(itemId: string): string | null {
    const retyped = resolveHeldItemReplacement(itemId);
    if (retyped !== undefined) {
        return retyped;
    }

    const drop = normalizeEntityDrop(itemId);
    if (drop.action === "remove") {
        return null;
    }
    if (drop.action === "convert" && drop.targetId) {
        return drop.targetId;
    }
    return itemId;
}
