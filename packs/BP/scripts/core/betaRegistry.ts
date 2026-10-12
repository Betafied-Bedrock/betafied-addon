/**
 * Canonical Beta 1.7.3 Registry
 *
 * Defines the finite, authentic universe of Minecraft Beta 1.7.3 entities, items, and blocks.
 * Used by cleaners, spawn handlers, and inventory managers to invert filtering:
 * instead of fragile modern blacklists, everything not explicitly recognized here is normalized or removed.
 *
 * Inversion only ever applies to the vanilla namespace — see `isVanillaId`.
 */

/** Addon replacement block and item IDs. */
export const BH_FENCE_ID = "bh:fence";
export const BH_CHEST_ID = "bh:chest";
export const BH_BOW_ID = "bh:bow";
export const BH_CRAFTING_TABLE_ID = "bh:crafting_table";
export const BH_WOODEN_DOOR_ID = "bh:wooden_door";
export const BH_IRON_DOOR_ID = "bh:iron_door";
export const BH_SIGN_ID = "bh:oak_sign";
export const BH_BUCKET_ID = "bh:bucket";
export const BH_CAKE_ID = "bh:cake";

/**
 * The pack's door items, and the vanilla block each one places. Beta 1.7.3's `ItemDoor` capped itself
 * at one, so the items carry `minecraft:max_stack_size` 1 and the engine enforces the era's limit in
 * every container instead of a script sweeping chests after the fact.
 */
export const BETA_DOOR_BLOCK_OF: Readonly<Record<string, string>> = Object.freeze({
    [BH_WOODEN_DOOR_ID]: "minecraft:wooden_door",
    [BH_IRON_DOOR_ID]: "minecraft:iron_door"
});

/** Both door blocks, so a half standing in the world can be recognized from the block alone. */
export const BETA_DOOR_BLOCK_IDS: ReadonlySet<string> = Object.freeze(
    new Set(Object.values(BETA_DOOR_BLOCK_OF))
);

/**
 * Vanilla ids the era capped at one that the pack has to own, because the engine keeps its own stack
 * size for an item it defines natively: the two doors (`ItemDoor`), the sign (`ItemSign`), the bucket
 * (`ItemBucket`) and the cake (`ItemReed`). Each maps onto the pack item that replaces it, so a
 * chest, a drop and a hotbar all end up holding the same capped id.
 */
export const BETA_CAPPED_ITEM_OF: Readonly<Record<string, string>> = Object.freeze({
    "minecraft:wooden_door": BH_WOODEN_DOOR_ID,
    "minecraft:iron_door": BH_IRON_DOOR_ID,
    "minecraft:oak_sign": BH_SIGN_ID,
    "minecraft:bucket": BH_BUCKET_ID,
    "minecraft:cake": BH_CAKE_ID
});

/** The pack items above; every one of them holds a single item per slot. */
export const BETA_CAPPED_ITEM_IDS: ReadonlySet<string> = Object.freeze(
    new Set(Object.values(BETA_CAPPED_ITEM_OF))
);

export const BETA_PASSIVE_TYPES: ReadonlySet<string> = Object.freeze(new Set([
    "minecraft:chicken",
    "minecraft:cow",
    "minecraft:pig",
    "minecraft:sheep",
    "minecraft:squid",
    "minecraft:wolf"
]));

/** Zombie pigman exists under two IDs across Bedrock versions. */
export const BETA_PIGMAN_TYPES: ReadonlySet<string> = Object.freeze(new Set([
    "minecraft:zombie_pigman",
    "minecraft:zombified_piglin"
]));

export const BETA_HOSTILE_TYPES: ReadonlySet<string> = Object.freeze(new Set([
    "minecraft:zombie",
    "minecraft:skeleton",
    "minecraft:creeper",
    "minecraft:spider",
    "minecraft:slime",
    "minecraft:ghast",
    ...BETA_PIGMAN_TYPES
]));

export const BETA_ENTITY_TYPES: ReadonlySet<string> = Object.freeze(new Set([
    "minecraft:player",
    "minecraft:item",
    "minecraft:arrow",
    "minecraft:snowball",
    "minecraft:egg",
    "minecraft:fishing_hook",
    "minecraft:lightning_bolt",
    "minecraft:tnt",
    "minecraft:falling_block",
    "minecraft:painting",
    "minecraft:fireball",
    "minecraft:boat",
    "minecraft:oak_boat",
    "minecraft:minecart",
    "minecraft:chest_minecart",
    "minecraft:furnace_minecart",
    "ubd:furnace_minecart",
    "custom:furnace_minecart",
    ...BETA_PASSIVE_TYPES,
    ...BETA_HOSTILE_TYPES
]));

export const BETA_SWORD_IDS: ReadonlySet<string> = Object.freeze(new Set([
    "minecraft:wooden_sword", "minecraft:stone_sword", "minecraft:iron_sword",
    "minecraft:golden_sword", "minecraft:diamond_sword"
]));

export const BETA_PICKAXE_IDS: ReadonlySet<string> = Object.freeze(new Set([
    "minecraft:wooden_pickaxe", "minecraft:stone_pickaxe", "minecraft:iron_pickaxe",
    "minecraft:golden_pickaxe", "minecraft:diamond_pickaxe"
]));

export const BETA_ITEM_IDS: Readonly<Set<string>> = Object.freeze(new Set([
    ...BETA_SWORD_IDS,
    ...BETA_PICKAXE_IDS,
    "minecraft:wooden_axe", "minecraft:stone_axe", "minecraft:iron_axe", "minecraft:golden_axe", "minecraft:diamond_axe",
    "minecraft:wooden_shovel", "minecraft:stone_shovel", "minecraft:iron_shovel", "minecraft:golden_shovel", "minecraft:diamond_shovel",
    "minecraft:wooden_hoe", "minecraft:stone_hoe", "minecraft:iron_hoe", "minecraft:golden_hoe", "minecraft:diamond_hoe",
    "minecraft:bow", BH_BOW_ID, "minecraft:arrow",
    "minecraft:flint_and_steel", "minecraft:shears", "minecraft:fishing_rod",
    "minecraft:compass", "minecraft:clock",
    "minecraft:leather_helmet", "minecraft:leather_chestplate", "minecraft:leather_leggings", "minecraft:leather_boots",
    "minecraft:chainmail_helmet", "minecraft:chainmail_chestplate", "minecraft:chainmail_leggings", "minecraft:chainmail_boots",
    "minecraft:iron_helmet", "minecraft:iron_chestplate", "minecraft:iron_leggings", "minecraft:iron_boots",
    "minecraft:golden_helmet", "minecraft:golden_chestplate", "minecraft:golden_leggings", "minecraft:golden_boots",
    "minecraft:diamond_helmet", "minecraft:diamond_chestplate", "minecraft:diamond_leggings", "minecraft:diamond_boots",
    "minecraft:apple", "minecraft:golden_apple", "minecraft:mushroom_stew", "minecraft:bread",
    "minecraft:porkchop", "minecraft:cooked_porkchop",
    "minecraft:fish", "minecraft:cooked_fish", "minecraft:cod", "minecraft:cooked_cod",
    "minecraft:cookie", "minecraft:cake",
    "bh:apple", "bh:bread", "bh:porkchop", "bh:cooked_porkchop", "bh:cod", "bh:cooked_cod", "bh:golden_apple", "bh:cookie",
    "bh:oak_stairs", "bh:cobblestone_stairs", "bh:oak_log", "bh:birch_log", "bh:spruce_log",
    "bh:wooden_slab", "bh:cobblestone_slab", "bh:sandstone_slab", "bh:stone_slab",
    "minecraft:coal", "minecraft:charcoal", "minecraft:diamond", "minecraft:iron_ingot", "minecraft:gold_ingot",
    "minecraft:stick", "minecraft:bowl", "minecraft:string", "minecraft:feather", "minecraft:gunpowder",
    "minecraft:wheat_seeds", "minecraft:wheat", "minecraft:flint", "minecraft:leather", "minecraft:brick",
    "minecraft:clay_ball", "minecraft:sugar_cane", "minecraft:paper", "minecraft:book", "minecraft:slime_ball",
    "minecraft:egg", "minecraft:glowstone_dust", "minecraft:bone", "minecraft:sugar", "minecraft:redstone",
    "minecraft:lapis_lazuli", "minecraft:ink_sac", "minecraft:cocoa_beans", "minecraft:bone_meal",
    "minecraft:red_dye", "minecraft:green_dye", "minecraft:purple_dye", "minecraft:cyan_dye",
    "minecraft:light_gray_dye", "minecraft:gray_dye", "minecraft:pink_dye", "minecraft:lime_dye",
    "minecraft:yellow_dye", "minecraft:light_blue_dye", "minecraft:magenta_dye", "minecraft:orange_dye",
    "minecraft:saddle", "minecraft:minecart", "minecraft:chest_minecart", "minecraft:furnace_minecart", "minecraft:boat", "minecraft:oak_boat",
    "minecraft:bucket", "minecraft:water_bucket", "minecraft:lava_bucket", "minecraft:milk_bucket",
    "minecraft:snowball", "minecraft:music_disc_13", "minecraft:music_disc_cat", "minecraft:painting", "minecraft:bed",
    "minecraft:oak_sign", "minecraft:wooden_door", "minecraft:iron_door",
    BH_WOODEN_DOOR_ID, BH_IRON_DOOR_ID, BH_SIGN_ID, BH_BUCKET_ID, BH_CAKE_ID,
    "minecraft:empty_map", "minecraft:filled_map"
]));

/** Addon-owned namespaces exempt from modern-item filtering. */
export const MOD_NAMESPACES: ReadonlySet<string> = Object.freeze(new Set([
    "bh",
    "ubd",
    "beta",
    "betafied"
]));

export const VANILLA_NAMESPACE = "minecraft";

function getNamespace(typeId: string): string | undefined {
    const separator = typeId.indexOf(":");
    if (separator <= 0) return undefined;
    return typeId.slice(0, separator);
}

export function isModItem(itemId: string): boolean {
    const namespace = getNamespace(itemId);
    return namespace !== undefined && MOD_NAMESPACES.has(namespace);
}

export function isVanillaId(typeId: string): boolean {
    return getNamespace(typeId) === VANILLA_NAMESPACE;
}

/** Bedrock color-component index order matching sheep dye values. */
export const WOOL_BY_COLOR: readonly string[] = Object.freeze([
    "minecraft:white_wool",
    "minecraft:orange_wool",
    "minecraft:magenta_wool",
    "minecraft:light_blue_wool",
    "minecraft:yellow_wool",
    "minecraft:lime_wool",
    "minecraft:pink_wool",
    "minecraft:gray_wool",
    "minecraft:light_gray_wool",
    "minecraft:cyan_wool",
    "minecraft:purple_wool",
    "minecraft:blue_wool",
    "minecraft:brown_wool",
    "minecraft:green_wool",
    "minecraft:red_wool",
    "minecraft:black_wool"
]);

export const BETA_WOOD_SPECIES: ReadonlySet<string> = Object.freeze(new Set([
    "oak", "birch", "spruce"
]));

export const TERRAIN_PLANK_SPECIES: readonly string[] = Object.freeze([
    "mangrove", "cherry", "bamboo", "crimson", "warped", "pale_oak"
]);

export const POST_BETA_WOOD_SPECIES: ReadonlySet<string> = Object.freeze(new Set([
    ...TERRAIN_PLANK_SPECIES,
    "jungle", "acacia", "dark_oak"
]));

export const WOOD_SPECIES: ReadonlySet<string> = Object.freeze(new Set([
    ...BETA_WOOD_SPECIES,
    ...POST_BETA_WOOD_SPECIES
]));

export const BETA_BLOCK_IDS: Readonly<Set<string>> = Object.freeze(new Set([
    "minecraft:stone", "minecraft:cobblestone", "minecraft:mossy_cobblestone",
    "minecraft:dirt", "minecraft:grass_block", "minecraft:sand", "minecraft:gravel",
    "minecraft:bedrock", "minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava",
    "minecraft:sandstone", "minecraft:clay", "minecraft:obsidian", "minecraft:sponge",
    "minecraft:ice", "minecraft:snow", "minecraft:snow_layer",
    "minecraft:netherrack", "minecraft:soul_sand", "minecraft:glowstone",
    "minecraft:coal_ore", "minecraft:iron_ore", "minecraft:gold_ore",
    "minecraft:diamond_ore", "minecraft:redstone_ore", "minecraft:lit_redstone_ore", "minecraft:lapis_ore",
    "minecraft:oak_log", "minecraft:birch_log", "minecraft:spruce_log",
    "minecraft:oak_leaves", "minecraft:birch_leaves", "minecraft:spruce_leaves",
    "minecraft:oak_sapling", "minecraft:birch_sapling", "minecraft:spruce_sapling",
    "minecraft:oak_planks", "minecraft:birch_planks", "minecraft:spruce_planks",
    "minecraft:dandelion", "minecraft:poppy", "minecraft:brown_mushroom", "minecraft:red_mushroom",
    "minecraft:cactus", "minecraft:sugar_cane", "minecraft:wheat", "minecraft:carved_pumpkin", "minecraft:pumpkin",
    "minecraft:lit_pumpkin", "minecraft:jack_o_lantern", "minecraft:short_grass", "minecraft:fern", "minecraft:dead_bush", "minecraft:cobweb",
    "minecraft:oak_stairs", "minecraft:cobblestone_stairs", "minecraft:stone_stairs",
    "minecraft:oak_slab", "minecraft:cobblestone_slab", "minecraft:stone_slab", "minecraft:smooth_stone_slab", "minecraft:sandstone_slab",
    "bh:oak_stairs", "bh:cobblestone_stairs", "bh:oak_log", "bh:birch_log", "bh:spruce_log",
    "bh:wooden_slab", "bh:cobblestone_slab", "bh:sandstone_slab", "bh:stone_slab",
    "bh:double_wooden_slab", "bh:double_cobblestone_slab", "bh:double_sandstone_slab", "bh:double_stone_slab",
    "minecraft:oak_fence", BH_FENCE_ID,
    "minecraft:bricks", "minecraft:brick_block", "minecraft:bookshelf",
    "minecraft:glass", "minecraft:ladder", "minecraft:torch",
    ...WOOL_BY_COLOR,
    "minecraft:chest", "minecraft:crafting_table", "minecraft:furnace", "minecraft:lit_furnace",
    "minecraft:jukebox", "minecraft:noteblock", "minecraft:dispenser", "minecraft:monster_spawner", "minecraft:spawner",
    "minecraft:iron_block", "minecraft:gold_block", "minecraft:diamond_block", "minecraft:lapis_block", "minecraft:tnt",
    "minecraft:lever", "minecraft:stone_button", "minecraft:stone_pressure_plate", "minecraft:wooden_pressure_plate",
    "minecraft:redstone_torch", "minecraft:unlit_redstone_torch", "minecraft:redstone_wire", "minecraft:repeater",
    "minecraft:piston", "minecraft:sticky_piston", "minecraft:rail", "minecraft:golden_rail", "minecraft:detector_rail",
    "minecraft:trapdoor", "minecraft:bed", "minecraft:wooden_door", "minecraft:iron_door", "minecraft:cake",
    // Bedrock keeps the oak sign's two blocks under their legacy ids; only the later species carry a
    // wood prefix. Without them the scrubber reads a placed sign as modern terrain and rewrites it to
    // the item id, which is not a block at all — and a wall sign is a second block, not a state.
    "minecraft:standing_sign", "minecraft:wall_sign"
]));

export function isBetaEntity(typeId: string): boolean {
    return BETA_ENTITY_TYPES.has(typeId);
}

export function isBetaItem(itemId: string): boolean {
    return isModItem(itemId) || BETA_ITEM_IDS.has(itemId) || BETA_BLOCK_IDS.has(itemId);
}

export function isBetaBlock(blockId: string): boolean {
    return BETA_BLOCK_IDS.has(blockId);
}
