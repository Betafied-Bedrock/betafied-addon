import {
    BH_BOW_ID, BH_CAKE_ID, BH_CHEST_ID, BH_FENCE_ID, BH_WOODEN_DOOR_ID,
    BETA_CAPPED_ITEM_OF, isBetaBlock, isBetaItem, isVanillaId, WOOD_SPECIES
} from "./betaRegistry.js";

export type NormalizationAction = "keep" | "convert" | "remove";

/**
 * One answer shape for every translation this module makes. A `convert` always carries its target,
 * so no caller re-checks a field before it can act on the decision. The id-producing entry points
 * answer `undefined` — never a fourth action — when their boundary has nothing to say about an id.
 */
export type NormalizationResult =
    | { readonly action: "keep" }
    | { readonly action: "convert"; readonly targetId: string }
    | { readonly action: "remove" };

const ORE_DROP_CONVERSIONS: Readonly<Record<string, string>> = Object.freeze({
    "minecraft:raw_iron": "minecraft:iron_ore",
    "minecraft:raw_gold": "minecraft:gold_ore"
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

// The suffix classes both boundaries classify. Only the classification is shared: a world block is
// replaced with a vanilla id while a placed or held one becomes the pack's own item, so each
// boundary keeps its own target for a class.
const isPlanksSuffix = (bareId: string): boolean => bareId.endsWith("_planks");
const isFenceSuffix = (bareId: string): boolean => bareId.endsWith("_fence") || bareId.endsWith("_fence_gate");
const isStairsSuffix = (bareId: string): boolean => bareId.endsWith("_stairs");
const isSlabSuffix = (bareId: string): boolean => bareId.endsWith("_slab");

function matchWoodBuilding(bareId: string): NormalizationResult | null {
    if (isPlanksSuffix(bareId)) return { action: "convert", targetId: "minecraft:oak_planks" };
    if (bareId.endsWith("_log") || bareId.endsWith("_stem") || bareId.endsWith("_wood") || bareId.includes("stripped_") || bareId === "wood" || bareId === "log" || bareId === "log2") {
        return { action: "convert", targetId: "minecraft:oak_log" };
    }
    if (isFenceSuffix(bareId)) return { action: "convert", targetId: BH_FENCE_ID };

    if (isStairsSuffix(bareId)) {
        return { action: "convert", targetId: isStoneCompound(bareId) ? "minecraft:cobblestone_stairs" : "minecraft:oak_stairs" };
    }
    if (isSlabSuffix(bareId)) {
        return { action: "convert", targetId: isStoneCompound(bareId) ? "minecraft:cobblestone_slab" : "bh:wooden_slab" };
    }
    return null;
}

const SIMPLE_WOOD_ITEMS: Readonly<Record<string, string>> = Object.freeze({
    _leaves: "minecraft:oak_leaves",
    _door: BH_WOODEN_DOOR_ID,
    _trapdoor: "minecraft:trapdoor",
    _sign: "minecraft:oak_sign",
    _boat: "minecraft:boat",
    _sapling: "minecraft:oak_sapling"
});

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

// The three ids the era spelled without a suffix. They are logs of the one wood it shipped, so they
// are answered before the suffix rule that reads the species out of a modern id.
const BARE_LOG_IDS: ReadonlySet<string> = Object.freeze(new Set(["wood", "log", "log2"]));

const isLogClassId = (bareId: string): boolean =>
    BARE_LOG_IDS.has(bareId) ||
    bareId.endsWith("_log") ||
    bareId.endsWith("_wood") ||
    bareId.endsWith("_stem") ||
    bareId.endsWith("_hyphae") ||
    bareId.startsWith("stripped_");

/**
 * The era kept one log per wood, and the two woods the pack ships its own block for are named in the
 * id while every other species collapses onto oak.
 */
function placerLogTarget(bareId: string): NormalizationResult | undefined {
    if (!isLogClassId(bareId)) return undefined;

    if (bareId.includes("spruce")) return { action: "convert", targetId: "bh:spruce_log" };
    if (bareId.includes("birch")) return { action: "convert", targetId: "bh:birch_log" };
    return { action: "convert", targetId: "bh:oak_log" };
}

/** The ids with one pack block apiece, by name or through the era's capped-item table. */
function placerSingleTarget(id: string, bareId: string): NormalizationResult | undefined {
    if (bareId === "chest") {
        return { action: "convert", targetId: BH_CHEST_ID };
    }

    if (bareId.endsWith("_door")) {
        return { action: "convert", targetId: BETA_CAPPED_ITEM_OF[id] ?? BH_WOODEN_DOOR_ID };
    }

    if (bareId === "cake") {
        return { action: "convert", targetId: BH_CAKE_ID };
    }

    return undefined;
}

/**
 * A stair keeps its species only where the pack ships a wooden stair for it; every other stair is
 * stone. The mosaic spelling carries the species inside a compound suffix, so the prefix is read
 * with it stripped rather than off the full id.
 */
function placerStairsTarget(bareId: string): NormalizationResult {
    const prefix = bareId.replace(/_mosaic_stairs|_stairs/, "");
    return {
        action: "convert",
        targetId: WOOD_SPECIES.has(prefix) ? "bh:oak_stairs" : "bh:cobblestone_stairs"
    };
}

/** Cobblestone and sandstone keep a slab of their own; the rest split on whether the id names stone. */
function placerSlabTarget(bareId: string): NormalizationResult {
    if (bareId.includes("cobble")) return { action: "convert", targetId: "bh:cobblestone_slab" };
    if (bareId.includes("sandstone")) return { action: "convert", targetId: "bh:sandstone_slab" };

    return {
        action: "convert",
        targetId: isStoneCompound(bareId) ? "bh:stone_slab" : "bh:wooden_slab"
    };
}

/** The building classes the placer retypes: fences collapse to one block, stairs and slabs to a family. */
function placerBuildingTarget(bareId: string): NormalizationResult | undefined {
    if (isFenceSuffix(bareId)) return { action: "convert", targetId: BH_FENCE_ID };
    if (isStairsSuffix(bareId)) return placerStairsTarget(bareId);
    if (isSlabSuffix(bareId)) return placerSlabTarget(bareId);

    return undefined;
}

/**
 * The placement boundary: the pack id a block or item becomes when it is placed or held. Answers
 * `undefined` for an id this boundary does not retype.
 */
export function resolvePlacerTarget(id: string): NormalizationResult | undefined {
    if (!id.startsWith("minecraft:")) {
        return undefined;
    }

    const bareId = id.slice(10);

    // First class to claim the id answers it, so the order is the table: the log class reads the
    // species out of an id the suffix classes would not, and the ids that answer by name are tried
    // before the classes that answer by suffix.
    return placerLogTarget(bareId)
        ?? placerSingleTarget(id, bareId)
        ?? placerBuildingTarget(bareId);
}

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

/**
 * The held-item boundary: what a player's own inventory item is retyped to, or `undefined` when no
 * table here has an opinion and the item keeps its id.
 */
export function resolveHeldItem(id: string): NormalizationResult | undefined {
    if (id === "minecraft:bow") {
        return { action: "convert", targetId: BH_BOW_ID };
    }

    const placer = resolvePlacerTarget(id);
    if (placer) return placer;

    const food = FOOD_CONVERSIONS[id];
    if (food !== undefined) return { action: "convert", targetId: food };

    const capped = BETA_CAPPED_ITEM_OF[id];
    return capped === undefined ? undefined : { action: "convert", targetId: capped };
}

/**
 * The drop boundary: an entity's drop is retyped to the pack item the player holds first, and only
 * then handed to the vanilla drop normalizer. Both answers are the module's one result shape, which
 * is what lets the caller act on the decision without decoding it first.
 */
export function resolveDropTarget(itemId: string): NormalizationResult {
    const retyped = resolveHeldItem(itemId);
    if (!retyped) return normalizeEntityDrop(itemId);
    if (retyped.action !== "convert") return retyped;

    return retyped.targetId === itemId ? { action: "keep" } : retyped;
}
