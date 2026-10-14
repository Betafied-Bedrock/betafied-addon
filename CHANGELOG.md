# Changelog

Notable changes in each Betafied release. Version numbers match the behavior and resource pack manifests.

## 5.8 — 2026-10-14

5.8 fixes the death loop that sends players without a bed above the world, makes signs writable again, and keeps extended pistons intact.

### Respawn

- Fixed players without a bed being stuck in a slowly voiding world with no possibility of return.
- Added a world spawn recorded on the world's first join, where a player without a bed or respawn anchor now respawns.
- Changed a join position the dimension cannot hold to never become that world spawn.
- Changed a respawn with no bed and no recorded world spawn to leave the player where they died.

### Signs

- Fixed clicks on standing and wall signs being swallowed, which left signs nobody could write on.
- Changed the top face to place the standing sign turned to the placing player's rotation, as Beta's `ItemSign` did.
- Fixed a sign placed against a block being written twice, once by the pack and once by the item's own placer.

### Blocks

- Fixed an extended piston losing its head when a chunk loaded, which left a broken piston behind.

### Tooling

- Fixed the test mock answering a resolved world spawn, which kept the death loop passing offline.

## 5.7 — 2026-10-13

5.7 adds Beta-style death behavior, adjusts mob movement, and fixes several rendering and item-drop issues.

### Death

- Added Beta's death screen with the original gradient and `Game over!` text.
- Changed the death screen to keep the hotbar, hearts, and crosshair visible behind it.
- Added Beta-style inventory and armor drops on death.
- Changed death drops to use the era's throw behavior and spread around the player.
- Added the player death flop.
- Added the smoke effect after death.
- Added the hurt sound played on a lethal hit.
- Added Beta-style death camera behavior with the field of view narrowing from 70 degrees.
- Changed dead players to spectator mode with movement locked until respawn.
- Changed respawning to face south and restore the normal camera.
- Changed scripted player teleports to suppress the engine's `You have been teleported to ...` message.
- Removed the permanent player invisibility used by the shadow pack.
- Restored hostile mob targeting of players.
- Restored Bedrock's normal player shadow.
- Fixed players already loaded into a world remaining invisible after updating.

### Mobs

- Reduced mob walking speeds to better match Beta's pacing.
- Changed all mobs to use the same updated movement-speed baseline.
- Fixed zombies not retaliating when attacked.
- Fixed spiders rendering invisible because their controller could select the invisible material from the old shadow system.
- Changed Herobrine encounters to have a minimum eight-hour delay between sightings.
- Reduced Herobrine encounter frequency so sightings average closer to once per day.

### Blocks

- Changed leaves to use flatter Beta-style shading.
- Reduced ambient occlusion on leaf blocks.
- Added Beta-style face shading to the bottom, north/south, and east/west sides of leaves.
- Changed wooden slabs to use stone-slab sounds.
- Removed fire behavior from wooden slabs to match the slab block they were based on.

### Drops

- Fixed converted ground-item stacks losing all but the first item when processed by the background sweep.
- Changed raw iron already on the ground to convert into a single iron ore.
- Changed raw gold already on the ground to convert into a single gold ore.
- Changed raw ore conversion to match the one-ore drop produced by a mined Beta ore block.

### Tooling

- Added a lint rule limiting inline comment blocks to twelve lines.
- Removed script comments that only repeated what the code already made clear.

## 5.6.1 — 2026-10-13

5.6.1 is a small fix-up release for sugar cane, signs, crafting, and mob rendering.

### Sugar cane

- Fixed harvested and broken sugar cane being removed during item conversion.
- Changed sugar cane drops to keep their proper item identity instead of disappearing when collected.

### Signs

- Fixed signs being placeable against doors and trapdoors in cases where the block itself should handle the interaction.
- Changed door and trapdoor interactions to take priority so unusable signs are not left attached to them.

### Crafting

- Restored log-to-plank recipes to the player's 2x2 inventory crafting grid.
- Restored jack-o'-lantern crafting to the 2x2 inventory grid.
- Restored sandstone crafting to the 2x2 inventory grid.
- Restored furnace minecart crafting to the 2x2 inventory grid.
- Fixed recipes that were incorrectly moved to the custom crafting table in 5.6.

### Mobs

- Fixed mobs already present in loaded worlds becoming fully invisible.
- Changed existing entities to keep their normal render state when the updated pack is applied.

### Tooling

- Added automatic posting of new releases to the project's Discord changelog channel.

## 5.6 — 2026-10-12

5.6 restores authentic door mechanics, unstackable utility items, unified crafting recipes, entity blob shadows, and classic visual lighting.

### Doors

- Added Beta-style wooden and iron doors that do not stack in inventories or chests.
- Added punch-to-toggle interaction so players can open and close wooden doors by left-clicking.
- Changed wooden and iron door crafting recipes to yield a single door on the crafting table.
- Added Beta placement rules requiring doors to be placed on top faces.
- Changed existing vanilla doors in player inventories to normalize to single items.

### Unstackable utilities

- Changed oak signs, buckets, and cakes to be unstackable.
- Added Beta-style sign placement for standing and wall signs.
- Added Beta bucket mechanics so empty buckets scoop liquid source blocks and milk cows.
- Added authentic multi-bite eating mechanics to placed cakes.
- Changed sign, bucket, and cake crafting recipes to produce authentic unstackable items.
- Fixed placed oak signs so they are properly preserved as valid Beta blocks.

### Crafting

- Unified all crafting recipes to appear exclusively on the custom crafting table.
- Removed duplicate recipe entries across crafting interfaces.
- Disabled modern post-Beta recipes including nuggets and cut sandstone.

### Visual parity

- Added authentic circular entity blob shadows beneath mobs and players.
- Added authentic face dimming to light source blocks like torches, glowstone, fire, and lava.
- Added darker sand shading and ambient occlusion to match sandstone.
- Disabled entity shadow rendering on signs to prevent artificial darkness behind text.
- Disabled directional lighting on fences to eliminate unnatural vertical shading seams.
- Enforced deterministic texture alignment across block faces.
- Disabled frame interpolation on animated water, lava, and fire textures for classic stepped animation.
- Added classic fast-graphics leaf textures with opaque black backgrounds.

### Tooling

- Added automated maintenance tooling to clean up accumulated game content logs.

## 5.5 — 2026-10-11

5.5 restores Beta-style double slabs and armor protection, and fixes double chests moving items around when they close.

### Beta parity

- Added Beta-style double slabs.
- Changed matching slabs placed together to combine into double slabs.
- Changed double slabs to occupy the lower block as a full block.
- Changed armor protection to use Beta's slot-based values instead of modern material-based protection.
- Changed helmets to provide 3 armor points.
- Changed chestplates to provide 8 armor points.
- Changed leggings to provide 6 armor points.
- Changed boots to provide 3 armor points.
- Changed armor material to affect durability only, so leather and diamond provide the same protection when worn in the same slot.

### Double chests

- Fixed double chests moving stacks to different slots when the lid closed.
- Changed chest merging so items remain in the slot the player left them in.
- Changed occupied-slot conflicts to fall back to the lowest available free slot instead of reshuffling the rest of the chest.

### Tooling

- Changed printed release instructions to use the currently authenticated GitHub account instead of a hard-coded personal handle.
- Changed generated GitHub release notes to use the authenticated GitHub account as well.

## 5.4.1 — 2026-10-10

5.4.1 is a small fix-up release for mob behavior and item drops.

### Beta parity

- Added Beta-style pig loot tables.
- Changed pig porkchop drops to a maximum of 2.
- Changed saddled pigs to drop their saddle on death.
- Changed creepers to chase the player without dealing a melee hit.
- Restored creepers to explosion-only damage behavior.

### Drop conversion

- Fixed converted drops exceeding the target item's maximum stack size.
- Changed oversized converted drops to split into valid stack-sized item entities.
- Fixed cases where an oversized converted stack could not be split or consumed normally.

## 5.4 — 2026-10-10

5.4 focuses on server performance and Beta authenticity. Background maintenance now runs across ticks instead of all in one go, and armor, wolves, leaf drops, and the HUD are restored to Beta behavior.

### Performance & tick safety

- Added background task batching across ticks to improve server performance and eliminate lag spikes.
- Changed player inventory and entity sweeps to process in small batches per tick.
- Changed boat collision and animal movement checks to time-slice across ticks.
- Changed player sleep and nightmare checks to step across ticks without blocking the server.

### Chunk scrubber

- Added cleanup for modern post-Beta wood varieties in generated terrain.
- Improved chunk scanning reliability so terrain cleaning retries cleanly when blocks cannot be updated.
- Staggered chunk re-verification checks to avoid processing multiple chunks on the same tick.
- Improved bedrock floor generation to avoid unnecessary block replacements.

### Beta parity

- Changed armor protection to scale smoothly with durability using Beta's damage formula.
- Changed armor damage absorption to use Beta's integer math.
- Removed wolf breeding, collar dyeing, and leashing so wolves match Beta.
- Restored classic leaf decay mechanics so trees do not drop apples or sticks.
- Cleaned modern entity spawns when chunks load.
- Disabled the hunger bar and experience bar to match Beta's HUD.

### Addon compatibility

- Preserved display entities from other addons so they are not removed during cleanup.

## 5.3.2 — 2026-10-07

5.3.2 is a smaller fix-up release focused on item stacking, chest crafting, and world-boundary issues.

### Item normalization

- Fixed custom foods and bows not properly unstacking during inventory sweeps.
- Changed porkchops, bread, apples, fish, and golden apples to unstack to a maximum of 1.
- Changed cookies to unstack to Beta's stack limit of 8.
- Changed bows to split into individual unstacked items and stripped modern enchantments.
- Fixed item duplication when unstacking into full or partially full inventories.
- Changed dropped overflow items to drop in valid stack sizes instead of oversized stacks.
- Changed cakes to be unstackable.

### Chest crafting

- Changed the chest recipe to craft the custom Beta chest on all crafting tables.
- Changed the chest recipe to accept any wood plank variety.

### World fixes

- Fixed errors when calculating underwater screen tint near world height boundaries.
- Changed the underwater tint to clear properly when entering the void or flying above the world.
- Fixed chunk cleanup removing intentional bedrock above the world floor.

## 5.3.1 — 2026-10-07

5.3.1 is a fix-up update restoring authentic farmland trampling and optimizing background scripts.

### Farmland trampling

- Added Beta-style farmland trampling while walking with authentic step timing and chances.
- Added sneaking and riding exemptions to protect farmland from being trampled.
- Restored classic fence protection around farmland.
- Prevented modern jump-landing trampling from destroying farmland and crops.
- Added authentic crop drops when trampled, dropping wheat only when fully grown.
- Added mob trampling so walking animals and monsters can trample farmland.

### Performance & cleanup

- Consolidated tool mining bonus checks into a single efficient pass.
- Unified inventory and equipment sweep loops to reduce script overhead.
- Optimized leaf decay checks around trees.

## 5.3 — 2026-10-06

Ore generation now uses Beta-style distributions, charcoal is obtainable again, and custom logs work as furnace fuel.

### Ore generation

- Changed coal generation to 20 attempts of up to 16 blocks between Y=0–128.
- Changed iron generation to 20 attempts of up to 8 blocks between Y=0–64.
- Changed gold generation to 2 attempts of up to 8 blocks between Y=0–32.
- Changed redstone generation to 8 attempts of up to 7 blocks between Y=0–16.
- Changed diamond generation to 1 attempt of up to 7 blocks between Y=0–16.
- Changed lapis generation to 1 attempt of up to 6 blocks centered around Y=16.
- Disabled modern Caves & Cliffs split ore variants to preserve classic distributions.
- Restricted ore veins to stone blocks so they do not cut through surface terrain.

### Charcoal & fuel

- Added furnace smelting recipes to produce charcoal from oak, birch, and spruce logs.
- Restored crafting recipes using charcoal, including torches.
- Changed custom logs to burn as furnace fuel for 15 seconds.
- Changed furnace minecarts to accept charcoal as well as coal.

### Mob lighting

- Added authentic classic lighting to vanilla mobs.
- Restored proper shading on bats.

### Other fixes

- Changed raw copper drops to convert into cobblestone.
- Removed the world border to match Beta 1.7.3.

## 5.2 — 2026-10-02

5.2 restores authentic Beta environment art, biome coloring, and classic block generation rules.

### Sky and biome colors

- Added Beta's original grass color map and climate-based biome tinting.
- Restored temperature-based sky coloring across Overworld biomes.
- Added Beta's original cloud, sun, and pumpkin overlay textures.
- Added classic block-breaking crack textures.
- Changed moon textures to display a single classic moon without modern phases.

### World generation

- Disabled emerald and copper ore generation.
- Disabled wild vine and glow lichen generation.
- Tuned the bedrock floor height distribution for a more authentic uneven floor.

### Fixes & balance

- Fixed sheep shearing to drop 1–3 wool instead of modern amounts.
- Fixed dyed sheep dropping their correct wool color upon death.
- Removed modern zombie feather drops.
- Fixed oak fence crafting to produce authentic classic fences.
- Fixed fence connections disconnecting across chunk boundaries.
- Removed armor calculations for post-Beta netherite and turtle helmets.
- Restored authentic sword breaking speeds on leaves and wool.

## 5.1 — 2026-10-02

5.1 cleans up post-5.0 terrain leftovers, removes modern fallen trees, and fixes log stacking.

### World spawn

- Restored standard seed-based world spawning mechanics.
- Removed fallback spawn coordinates that could strand players above water or the void.

### Fallen trees

- Disabled modern fallen tree generation to match Beta's upright-only trees.
- Added terrain cleanup to remove sideways fallen logs from generated chunks.

### Plants & flowers

- Removed modern tall flowers, vines, and post-Beta plants from generated terrain.
- Added visual masking for tall plants so uncleaned chunks do not show transparent holes.

### Item drops

- Fixed chopped wood logs failing to stack together after being picked up.
- Restored normal item stacking for converted log drops.

## 5.0 — 2026-10-02

5.0 is a major terrain overhaul featuring authentic Beta 1.7.3 biomes, classic double chests, full-screen underwater tint, and bedrock world limits.

### Terrain & biomes

- Overrode Overworld biomes with authentic Beta-style terrain definitions.
- Limited Overworld biomes to Forest, Plains, Desert, Taiga, and Swampland.
- Restored dirt and gravel ocean floors.
- Restored sandy and gravel beaches.
- Removed modern biome tags and village generation.

### Flowers & structures

- Limited naturally generating flowers to classic poppies and dandelions.
- Disabled modern double plants and structure generation.
- Erased post-Beta structure blocks from generated worlds while preserving Beta-legal materials.

### The Nether

- Overrode Nether biomes with classic netherrack, lava, soul sand, and gravel terrain.
- Removed modern Nether mobs, quartz, gold, and ancient debris.

### World height & floor

- Added a rough bedrock floor around Y=0 recreating Beta's 128-block world depth.
- Blocked digging below Y=0 in survival mode.

### Chests

- Added classic double chest merging with latches facing the placer.
- Allowed double chests to merge along both north-south and east-west axes.
- Fixed double chest contents disappearing or corrupting during merges.

### Visuals & HUD

- Restored full-screen blue underwater screen tinting.
- Restored classic dense Nether fog.
- Restored classic inventory auto-place and coalescing shortcuts.

## 4.3 — 2026-10-02

Betafied 4.3 restores classic double chest mechanics, authentic block states, and classic tool speeds.

### Double chests

- Merged adjacent chests into authentic 54-slot double chests.
- Fixed chest opening and closing interactions across both halves.

### Block placement

- Restored classic flat four-rotation stairs without modern corner or upside-down states.
- Restricted slabs to bottom-only placement.
- Restricted logs to vertical-only placement with classic top and side bark textures.

### Fixes & balance

- Restored classic tool mining speeds, allowing swords to mine wooden stairs at Beta speeds.
- Cleaned up post-Beta mob spawns in generated terrain.
- Updated chunk cleaning to erase blocks that did not exist in Beta.

## 4.2 — 2026-10-02

Betafied 4.2 enhances mod compatibility and substantially optimizes pack size.

### Features & improvements

- Scoped all cleaner and conversion rules strictly to vanilla identifiers so modded content remains untouched.
- Cleaned up duplicate and unreferenced assets, reducing pack size by over 40 MB without visual differences.
- Preserved custom entities and dropped items from other addons.

## 4.1 — 2026-10-02

Betafied 4.1 focuses on parity fixes, block placement corrections, and mob spawning.

### Features & additions

- Added classic cobblestone stairs with authentic textures and crafting recipes.
- Added block normalization converting modern wood and stone variants into classic equivalents.

### Tweaks & fixes

- Restored classic mob spawning conditions across plains and desert biomes.
- Corrected stair placement orientation.
- Restored armor durability damage from falls, fire, and lava.
- Fixed tree leaf decay to prevent modern apple drops.
- Cleaned up pause screen passthrough and enabled command autocomplete.

## 4.0 — 2026-10-02

The 4.0 engine rewrite, updating Betafied for modern Bedrock Edition while restoring authentic Beta 1.7.3 mechanics.

### Highlights

- Staggered background tasks across ticks to prevent lag spikes and watchdog timeouts.
- Replaced rigid block lists with dynamic normalization for modern content.
- Restored classic placement rules for stairs, slabs, and logs.
- Restored bare-handed sheep punching to drop 1–3 wool.
- Restored classic animal panic behavior when struck.
- Restored instant crop growth with bonemeal.
- Restored authentic Java Beta first-person item holding and swing angles.
