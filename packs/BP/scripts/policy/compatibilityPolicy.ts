import type { Entity } from "@minecraft/server";
import { BH_CAKE_ID, TERRAIN_PLANK_SPECIES } from "./betaRegistry.js";

export const FOREIGN_OWNED_TAGS: readonly string[] = Object.freeze([
    "far:item_display",
    "far:shop_display"
]);

export function isForeignOwnedEntity(entity: Entity): boolean {
    for (const tag of FOREIGN_OWNED_TAGS) {
        if (entity.hasTag(tag)) return true;
    }
    return false;
}

export const BLOCK_BULK_REPLACEMENTS: readonly [string, string][] = [
    ["minecraft:deepslate", "minecraft:stone"],
    ["minecraft:tuff", "minecraft:gravel"],
    ["minecraft:cobbled_deepslate", "minecraft:cobblestone"],
    ["minecraft:andesite", "minecraft:stone"],
    ["minecraft:diorite", "minecraft:stone"],
    ["minecraft:granite", "minecraft:stone"],
    ["minecraft:smooth_basalt", "minecraft:stone"],
    ["minecraft:calcite", "minecraft:stone"],
    ["minecraft:amethyst_block", "minecraft:stone"],
    ["minecraft:budding_amethyst", "minecraft:stone"],
    ["minecraft:dripstone_block", "minecraft:stone"],
    ["minecraft:reinforced_deepslate", "minecraft:bedrock"],

    ["minecraft:deepslate_iron_ore", "minecraft:iron_ore"],
    ["minecraft:deepslate_gold_ore", "minecraft:gold_ore"],
    ["minecraft:deepslate_copper_ore", "minecraft:stone"],
    ["minecraft:copper_ore", "minecraft:stone"],
    ["minecraft:raw_copper_block", "minecraft:stone"],
    ["minecraft:emerald_ore", "minecraft:stone"],
    ["minecraft:deepslate_emerald_ore", "minecraft:stone"],
    ["minecraft:deepslate_coal_ore", "minecraft:coal_ore"],
    ["minecraft:deepslate_redstone_ore", "minecraft:redstone_ore"],
    ["minecraft:deepslate_lapis_ore", "minecraft:lapis_ore"],
    ["minecraft:deepslate_diamond_ore", "minecraft:diamond_ore"],

    ["minecraft:mud", "minecraft:gravel"],
    ["minecraft:packed_mud", "minecraft:gravel"],
    ["minecraft:muddy_mangrove_roots", "minecraft:gravel"],
    ["minecraft:powder_snow", "minecraft:snow"],
    ["minecraft:dirt_with_roots", "minecraft:dirt"],
    ["minecraft:coarse_dirt", "minecraft:dirt"],
    ["minecraft:red_sand", "minecraft:sand"],
    ["minecraft:suspicious_sand", "minecraft:sand"],
    ["minecraft:suspicious_gravel", "minecraft:gravel"],

    ["minecraft:hardened_clay", "minecraft:sandstone"],
    ["minecraft:stained_hardened_clay", "minecraft:sandstone"],
    ["minecraft:red_terracotta", "minecraft:sandstone"],
    ["minecraft:orange_terracotta", "minecraft:sandstone"],
    ["minecraft:yellow_terracotta", "minecraft:sandstone"],
    ["minecraft:brown_terracotta", "minecraft:sandstone"],
    ["minecraft:white_terracotta", "minecraft:sandstone"],
    ["minecraft:light_gray_terracotta", "minecraft:sandstone"],
    ["minecraft:gray_terracotta", "minecraft:sandstone"],
    ["minecraft:black_terracotta", "minecraft:sandstone"],
    ["minecraft:light_blue_terracotta", "minecraft:sandstone"],
    ["minecraft:cyan_terracotta", "minecraft:sandstone"],
    ["minecraft:blue_terracotta", "minecraft:sandstone"],
    ["minecraft:purple_terracotta", "minecraft:sandstone"],
    ["minecraft:magenta_terracotta", "minecraft:sandstone"],
    ["minecraft:pink_terracotta", "minecraft:sandstone"],
    ["minecraft:lime_terracotta", "minecraft:sandstone"],
    ["minecraft:green_terracotta", "minecraft:sandstone"],
    ["minecraft:red_sandstone", "minecraft:sandstone"],

    ["minecraft:quartz_ore", "minecraft:netherrack"],
    ["minecraft:nether_gold_ore", "minecraft:netherrack"],
    ["minecraft:ancient_debris", "minecraft:netherrack"],
    ["minecraft:magma", "minecraft:gravel"],

    ["minecraft:packed_ice", "minecraft:ice"],
    ["minecraft:blue_ice", "minecraft:ice"],
    ["minecraft:prismarine", "minecraft:stone"],
    ["minecraft:dark_prismarine", "minecraft:stone"],
    ["minecraft:sea_lantern", "minecraft:glowstone"],
    ["minecraft:melon_block", "minecraft:air"],

    ...TERRAIN_PLANK_SPECIES.map((species): [string, string] => [`minecraft:${species}_planks`, "minecraft:planks"])
];

export const POST_BETA_TALL_PLANTS: readonly string[] = Object.freeze([
    "minecraft:tall_grass",
    "minecraft:large_fern"
]);

/**
 * Two-block flowers that post-date 1.7.3. Both halves carry the same id, so a rewrite has to clear
 * the whole plant rather than set a flower into each half.
 */
export const POST_BETA_TALL_FLOWERS: readonly string[] = Object.freeze([
    "minecraft:lilac",
    "minecraft:peony",
    "minecraft:rose_bush",
    "minecraft:sunflower",
    "minecraft:pitcher_plant"
]);

/**
 * Flowers that post-date 1.7.3. The era grew only the rose (today's poppy) and the yellow flower
 * (today's dandelion), so bone meal's modern palette is rewritten to those two.
 */
export const POST_BETA_FLOWERS: readonly string[] = Object.freeze([
    "minecraft:azure_bluet",
    "minecraft:oxeye_daisy",
    "minecraft:cornflower",
    "minecraft:lily_of_the_valley",
    "minecraft:allium",
    "minecraft:blue_orchid",
    "minecraft:red_tulip",
    "minecraft:orange_tulip",
    "minecraft:white_tulip",
    "minecraft:pink_tulip",
    "minecraft:torchflower",
    ...POST_BETA_TALL_FLOWERS
]);

export const BLOCK_FINE_REPLACEMENTS: Readonly<Record<string, string>> = {
    ...Object.fromEntries(POST_BETA_TALL_PLANTS.map((id): [string, string] => [id, "minecraft:air"])),
    "minecraft:cake": BH_CAKE_ID,
    "minecraft:seagrass": "minecraft:water",
    "minecraft:kelp": "minecraft:water",
    "minecraft:amethyst_cluster": "minecraft:air",
    "minecraft:glow_lichen": "minecraft:air",
    "minecraft:sculk": "minecraft:stone",
    "minecraft:sculk_vein": "minecraft:air",
    "minecraft:sculk_catalyst": "minecraft:stone",
    "minecraft:sculk_shrieker": "minecraft:stone",
    "minecraft:sculk_sensor": "minecraft:stone",
    "minecraft:calibrated_sculk_sensor": "minecraft:stone",
    "minecraft:moss_block": "minecraft:stone",
    "minecraft:moss_carpet": "minecraft:air",
    "minecraft:spore_blossom": "minecraft:air",
    "minecraft:azalea": "minecraft:air",
    "minecraft:flowering_azalea": "minecraft:air",
    "minecraft:mangrove_roots": "minecraft:gravel",

    "minecraft:beacon": "minecraft:obsidian",
    "minecraft:respawn_anchor": "minecraft:obsidian",
    "minecraft:conduit": "minecraft:stone",
    "minecraft:stonecutter_block": "minecraft:stone",
    "minecraft:prismarine": "minecraft:stone",
    "minecraft:sea_lantern": "minecraft:glowstone",
    "minecraft:bamboo": "minecraft:air",
    "minecraft:sweet_berry_bush": "minecraft:air",
    "minecraft:vine": "minecraft:air",
    "minecraft:cave_vines": "minecraft:air",
    "minecraft:cave_vines_body_with_berries": "minecraft:air",
    "minecraft:cave_vines_head_with_berries": "minecraft:air",
    "minecraft:big_dripleaf": "minecraft:air",
    "minecraft:small_dripleaf_block": "minecraft:air",
    "minecraft:mangrove_propagule": "minecraft:air",
    "minecraft:cherry_sapling": "minecraft:air",
    "minecraft:azalea_leaves": "minecraft:leaves",
    "minecraft:azalea_leaves_flowered": "minecraft:leaves",
    "minecraft:pitcher_crop": "minecraft:air",
    "minecraft:torchflower_crop": "minecraft:air",
    "minecraft:pink_petals": "minecraft:air",

    ...Object.fromEntries(POST_BETA_FLOWERS.map((id): [string, string] => [id, "minecraft:air"])),
    "minecraft:hanging_roots": "minecraft:air",

    "minecraft:leaf_litter": "minecraft:air",
    "minecraft:infested_deepslate": "minecraft:stone",
    "minecraft:infested_stone": "minecraft:stone",
    "minecraft:brain_coral": "minecraft:water",
    "minecraft:bubble_coral": "minecraft:water",
    "minecraft:fire_coral": "minecraft:water",
    "minecraft:horn_coral": "minecraft:water",
    "minecraft:tube_coral": "minecraft:water",
    "minecraft:brain_coral_fan": "minecraft:water",
    "minecraft:bubble_coral_fan": "minecraft:water",
    "minecraft:fire_coral_fan": "minecraft:water",
    "minecraft:horn_coral_fan": "minecraft:water",
    "minecraft:bee_nest": "minecraft:air",
    "minecraft:beehive": "minecraft:air",

    "minecraft:basalt": "minecraft:air",
    "minecraft:polished_basalt": "minecraft:air",
    // Nether brick arrived after 1.7.3 and the only thing that generates it is a fortress, which the
    // era never had. Left to the suffix rules its trim came back as a wooden fence and cobblestone
    // stairs, so the shape of a fortress stood in cleared ground.
    "minecraft:nether_brick": "minecraft:air",
    "minecraft:nether_brick_fence": "minecraft:air",
    "minecraft:nether_brick_stairs": "minecraft:air",
    "minecraft:red_nether_brick": "minecraft:air",
    "minecraft:red_nether_brick_stairs": "minecraft:air",
    "minecraft:chiseled_nether_bricks": "minecraft:air",
    "minecraft:cracked_nether_bricks": "minecraft:air",
    "minecraft:blackstone": "minecraft:air",
    "minecraft:polished_blackstone": "minecraft:air",
    "minecraft:chiseled_polished_blackstone": "minecraft:air",
    "minecraft:gilded_blackstone": "minecraft:air",
    "minecraft:crimson_nylium": "minecraft:netherrack",
    "minecraft:warped_nylium": "minecraft:netherrack",
    "minecraft:soul_soil": "minecraft:soul_sand",
    "minecraft:shroomlight": "minecraft:air",
    "minecraft:crimson_fungus": "minecraft:air",
    "minecraft:warped_fungus": "minecraft:air",
    "minecraft:crimson_roots": "minecraft:air",
    "minecraft:warped_roots": "minecraft:air",
    "minecraft:nether_sprouts": "minecraft:air",
    "minecraft:weeping_vines": "minecraft:air",
    "minecraft:twisting_vines": "minecraft:air",
    "minecraft:warped_wart_block": "minecraft:netherrack",
    "minecraft:nether_wart_block": "minecraft:netherrack",
    "minecraft:bone_block": "minecraft:netherrack",
    "minecraft:crying_obsidian": "minecraft:obsidian",
    "minecraft:target": "minecraft:air",
    "minecraft:lodestone": "minecraft:stone",
    "minecraft:chain": "minecraft:air"
};
