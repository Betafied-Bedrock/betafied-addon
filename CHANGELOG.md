# Changelog

Notable changes in each Betafied release. Version numbers match the behavior and resource pack manifests.

## 5.6 — 2026-10-12

5.6 introduces authentic doors with punch-to-toggle interaction, one-per-slot utility items (signs, buckets, and cakes), unified crafting table recipes, circular entity blob shadows, and classic visual lighting and texture parity.

### Doors

- Added `bh:wooden_door` and `bh:iron_door`: the era's door items, capped at one per slot by their own item JSON, so the engine itself keeps a door out of a stack in a chest instead of a sweep cleaning up afterwards. Each one places the vanilla `minecraft:wooden_door` / `minecraft:iron_door` block and wears the vanilla door texture.
- Added punch-to-toggle interaction for wooden doors, allowing players to open and close them with left-click attacks as well as interactions, while iron doors remain redstone-operated.
- Changed the door recipes to override vanilla's `minecraft:wooden_door` and `minecraft:iron_door` recipes, so the custom crafting table offers the Beta result instead of a vanilla door; the wooden door recipe now takes the plank tag, and the iron door pays Beta's single door rather than three.
- Changed held vanilla doors to retype onto the `bh:` items during the inventory sweep, spreading a modern stack one per slot; a door broken out of the world, dropped by a mob or handed over by another addon lands on the same item.
- Added Beta's placement rule to the crafted doors: a door goes down on the top face only, and the half the engine did not place is written from the half it did.

### Unstackable utilities

- Added `bh:oak_sign`, `bh:bucket` and `bh:cake`, the rest of the era's one-per-slot items: each carries `minecraft:max_stack_size` 1 in its own item JSON, so a sign, a bucket or a cake can no longer stack in a chest the way the doors used to. The cake places the vanilla `minecraft:cake` block; the sign and the bucket place nothing of their own.
- Added Beta's sign placement: a sign goes up on the top face as a standing sign turned to the placer's rotation, and against any of the four sides as a wall sign. Both are written by `interactions/signPlacement.ts`, because one block placer cannot cover the era's two sign blocks, and the interaction is cancelled only for the clicks that actually place a sign.
- Added Beta's bucket filling: the empty `bh:bucket` lifts a water or lava source and takes it with it, matching the metadata-0 rule that made an infinite pool work, and a cow answers it with a milk bucket.
- Changed the sign, bucket and cake recipes to yield the pack items, to take vanilla's own recipe ids (`minecraft:sign_oak`, `minecraft:bucket`, `minecraft:cake`) so vanilla's version is replaced rather than offered beside them, and — for the cake — to hand its three empty buckets back as `bh:bucket`.
- Changed held vanilla signs, buckets and cakes to retype onto the pack items during the inventory sweep, spreading a modern stack one per slot; each pack item wears the vanilla texture and is named in the language file.
- Fixed a placed oak sign reading as modern terrain: Bedrock keeps the oak sign's two blocks under the legacy `minecraft:standing_sign` / `minecraft:wall_sign` ids, which the block registry now recognizes, so a sign is no longer rewritten to an item id the scrubber cannot place.

### Crafting

- Changed every recipe the pack registers to a single interface: the `beta_crafting` tag of the custom crafting table. The second copy of each recipe that existed for the vanilla table and the player's 2x2 grid is gone, so a craft appears once, at the pack's table.
- Removed the recipes that duplicated another recipe of the pack: the crafting table was registered three times (two vanilla-id overrides plus the pack's own), the jack-o'-lantern twice, and the any-log-to-oak-planks conversion twice.
- Fixed the chest and oak sign recipes naming themselves ids vanilla does not use — `minecraft:chest` beside vanilla's real `minecraft:Chest_recipeId`, and `bh:sign_oak` beside `minecraft:sign_oak` — which left vanilla's own recipe live next to the pack's. A recipe now replaces vanilla's only when its identifier and recipe type both match, which is also why the jack-o'-lantern recipe became shaped: vanilla's is shaped, so a shapeless recipe with the same id is registered alongside it instead of replacing it.
- Changed the recipes the era did not have to the documented empty tag (`[""]`) instead of an unobtainable-ingredient grid: golden nuggets, iron nuggets, cut sandstone and both vanilla crafting-table recipe ids are now suppressed by replacing the recipe itself and offering it nowhere.
- Kept one deliberate exception: the crafting table recipe still serves `crafting_table` as well, because that tag is what the player's 2x2 inventory grid reads. Without it no survival player could craft the pack's table in the first place.
- Fixed `furnace_minecart.json` carrying a byte-order mark, which strict JSON readers reject.

### Visual parity & shading

- Added authentic circular entity blob shadows to mobs and players using particle controllers.
- Added authentic face dimming on Beta light source blocks including torches, redstone torches, glowstone, jack-o'-lanterns, fire, and lava.
- Enforced deterministic texture UV alignment across block faces.
- Disabled frame interpolation on flipbook texture animations (water, lava, fire) for authentic stepped frame playback.
- Added fast graphics opaque black-backed leaf textures.

### Tooling

- Added `scripts/pruneContentLogs.mjs` and `npm run logs:prune` to automatically clean up accumulated Bedrock content logs.
- Added automated smoke test contracts for block appearance, entity shadows, and recipe interfaces.

## 5.5 — 2026-10-11

5.5 restores Beta-style double slabs and armor protection, and fixes double chests moving items around when they close.

### Beta parity

- Added Beta-style double slabs.
- Changed matching `bh:` slabs placed together to combine into the corresponding `bh:double_*_slab`.
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

### Performance & Tick Safety

- Added `JobRunner`, a shared wrapper that steps long-running sweeps across ticks through `system.runJob`, with error containment and tracked job handles.
- Changed `TickManager` to run generator tasks through `JobRunner`, and to skip a task's next interval while its previous run is still stepping.
- Changed `TickManager` teardown to cancel all in-flight jobs with `system.clearJob`.
- Changed the inventory sweep to process 2 players per tick.
- Changed the entity cleaner to process 20 entities per tick.
- Changed the double chest session sweep to process 10 pairs per tick.
- Changed boat collision checks to process 10 boats per tick.
- Changed the animal hop scan to process 10 animals per tick.
- Changed the fog sync to process 5 players per tick.
- Changed batched sweeps to re-resolve entities and players by ID after each yield so no live handle is held across a tick.
- Changed the nightmare light check into a tracked, cancellable job that re-resolves the player and bed from stored IDs and coordinates.

### Chunk Scrubber

- Added cleanup for the full post-Beta wood building set, including planks, stairs, slabs, fences, gates, doors, trapdoors, signs, saplings, logs, stems, wood, hyphae, leaves, and stripped logs and stems, generated from the shared species list.
- Changed the fine-pass block filter to validate each identifier against `BlockPermutation.resolve` before use, because Bedrock's filter parser rejects unregistered IDs.
- Changed chunk re-verification to spread each chunk's next check across a 600-tick window so a player's nine chunks no longer come due on the same tick.
- Changed the one-chunk-per-pass budget to rotate its starting player so one player's chunks cannot starve the others.
- Changed the bedrock floor seal to skip a chunk whose Y=0 layer is already solid bedrock instead of re-laying the ragged cap above it.
- Changed the fine scrub so a refused volume query or a single refused block write is reported for that band and no longer un-marks the whole chunk.
- Changed the refused-query error to be reported once per session instead of once per band.

### Beta Parity

- Changed the armor value to Beta's `((points - 1) * remaining / max) + 1` formula.
- Changed armor damage absorption to Beta's integer math, carrying the remainder into the next hit.
- Removed wolf breeding, collar dyeing, and leashing so wolves match Beta.
- Fixed the engine's leaf-decay apple drops and removed the sticks that come with them, while keeping apple drops from chests, deaths, and players.
- Changed entities to be cleaned when a chunk loads as well as when they spawn.
- Added suppression for the hunger and XP bars, which Beta did not show.

### Other Addons

- Fixed far.land item and shop displays being deleted by the drop conversion and entity cleaner; entities tagged `far:item_display` or `far:shop_display` are now left untouched.

### Tooling

- Added a Regolith `agents-md-strip` filter that removes the nested `AGENTS.md` files from the exported pack, which 5.3.2 shipped by mistake.
- Changed the world push to align each pack pair's declared version with the version installed on the server.
- Changed the script-permissions push to write the pack config directories as well.
- Changed `pushWorld.mjs` to fall back to `gargamel_merged_unsmoothed.mcworld` when the smoothed world file is missing.
- Added the AGPL-3.0 license.

## 5.3.2 — 2026-10-07

5.3.2 is a smaller fix-up release focused on item stacking, chest crafting, and a few world-boundary issues.

### Item normalization

- Fixed custom foods and bows not being checked for Beta stack limits during the inventory sweep.
- Changed custom porkchop, bread, apple, cod, and golden apple items to unstack to a maximum of 1.
- Changed cookies to unstack to Beta's maximum stack size of 8.
- Changed stacked `bh:bow` items to split into individual bows.
- Changed normalized bows to remove modern enchantments.
- Fixed item duplication when unstacking into partially available inventories.
- Changed overflow handling to respect each item's maximum stack size when filling empty slots.
- Changed excess items dropped into the world to use valid stack sizes instead of one oversized stack.
- Added `minecraft:cake` to `UNSTACKABLE_UTILITIES`.

### Chest crafting

- Changed the chest recipe to override the vanilla `minecraft:chest` recipe directly.
- Changed the recipe to produce `bh:chest`.
- Added both `crafting_table` and `beta_crafting` tags so the modern chest recipe cannot still appear on either crafting table.
- Changed the recipe to accept the `minecraft:planks` tag instead of oak planks only.
- Changed the unlock requirement to use the plank tag as well, allowing every plank variety to craft the Beta chest.

### World fixes

- Fixed recurring `LocationOutOfWorldBoundariesError` errors from the underwater overlay when a player's head was outside the dimension height range.
- Changed `isHeadSubmerged` to check the world's minimum and maximum Y before calling `getBlock`.
- Changed the underwater tint to clear normally when entering the void or moving above the world boundary.
- Changed the chunk scrubber to stop removing bedrock above the generated floor ceiling.
- Preserved intentional bedrock above Y=2 during terrain scans.

## 5.3.1 — 2026-10-07

5.3.1 is a script-only update. Blocks, items, recipes, and world generation are unchanged from 5.3.

The main fix is farmland trampling, along with some cleanup to reduce duplicated script.

### Farmland trampling

- Added Beta-style farmland trampling while walking.
- Changed trampling to use Beta's step timing and one-in-four chance.
- Added the sneak exemption.
- Added the rider exemption so the mount can trample farmland without also counting the rider.
- Restored the old fence behavior because the walking check respects blocked movement.
- Removed modern landing-based trampling by restoring farmland after Bedrock converts it.
- Added farmland snapshots so moisture and crop growth are restored after a landing trample.
- Removed crop drops created by the modern landing behavior so restored crops cannot be duplicated.
- Added Beta-style crop drops when walking tramples farmland.
- Changed ripe crops to drop one wheat plus up to three seed rolls.
- Changed unripe crops so they can drop nothing.
- Changed walked-on crops to be broken by the script instead of relying on the modern crop loot table.
- Changed manually placed dirt on watched farmland tiles to remain untouched.
- Added mob trampling because Beta allowed walking entities to trigger farmland.
- Added animal-trampling balance checks to `BETA_POLICY_GAPS.md` for server testing.

### Script cleanup

- Merged the separate pickaxe and sword tool-bonus modules into `toolMining.ts`.
- Changed `toolMining.ts` to handle both redstone mining fatigue and sword leaf/wool speed in one shared pass.
- Removed one module load from `main.ts`.
- Reworked the inventory sweep so inventory and equipment slots use the same shared loop.
- Changed the apple-drop check to read its 27-block neighbourhood once instead of three times.
- Reduced the shipped script by 32 lines and one module.
- Kept the full test suite passing at 393 tests.

### Tooling

- Added three Betafied-specific ESLint rules under `eslint-rules/`.
- Added `no-beta-api` to warn when script uses members marked `@beta` in the pinned `@minecraft/server` typings.
- Changed Beta API usage to be caught during linting instead of only being discovered in-game.

## 5.3 — 2026-10-06

Ore generation now uses Beta-style counts and height ranges, charcoal is obtainable again, and custom logs work as furnace fuel. Mob lighting and a few smaller systems also got fixes.

### Ore generation

- Changed coal generation to 20 attempts of up to 16 blocks between Y=0–128.
- Changed iron generation to 20 attempts of up to 8 blocks between Y=0–64.
- Changed gold generation to 2 attempts of up to 8 blocks between Y=0–32.
- Changed redstone generation to 8 attempts of up to 7 blocks between Y=0–16.
- Changed diamond generation to 1 attempt of up to 7 blocks between Y=0–16.
- Changed lapis generation to 1 attempt of up to 6 blocks centered around Y=16.
- Added `bh:beta_*_ore_feature` definitions for all six Beta ores.
- Changed the main vanilla ore feature rules to use the Beta ore features instead of modern Caves & Cliffs distributions.
- Disabled the 14 extra modern ore variants (upper, lower, buried, large, small, mesa, mountain and other split rules) so they don't generate ore on top of the Beta counts.
- Changed ore features to replace only stone-family blocks, so veins don't cut through surface terrain.
- Added the vanilla feature-rule override behavior to `BETA_POLICY_GAPS`, since it's still unconfirmed.
- Added the redstone, diamond and lapis vein sizes to `BETA_POLICY_GAPS` until their exact Beta values are confirmed.

### Charcoal

- Added furnace recipes for oak, birch and spruce logs that produce `minecraft:charcoal`.
- Restored charcoal crafting paths such as torches by using vanilla charcoal and its existing `minecraft:coals` tag.
- Added furnace fuel components to all three custom log items.
- Changed custom logs to burn for 15 seconds.
- Changed furnace minecarts to accept charcoal as well as coal.
- Changed furnace minecart charcoal fuel time to 1600 ticks, the same as coal.
- Added custom-item furnace input behavior to the in-game confirmation list.

### Mob lighting

- Added pack-owned render controller overrides for vanilla mobs, so their lighting no longer depends on the modern default controllers.
- Re-declared each controller's geometry, materials and textures, because render-controller overrides replace the full definition.
- Added explicit render-controller wiring for bats.
- Added a smoke test that checks render-controller short names against the client entities that use them.

### Other fixes

- Changed raw copper ground drops to resolve through the normal compatibility rules instead of being disguised as iron ore.
- Changed raw copper to become cobblestone, consistent with the inventory sweep.
- Removed the finite world-border module, since Beta 1.7.3 did not have one.
- Added `npm run release` tooling that publishes directly from the current changelog and built packs, so both come from the same tree.
- Changed `regolith.sh` to load `.env` with the same precedence as the push tooling.
- Changed environment loading so explicitly inherited values override `.env` values in both paths.

## 5.2 — 2026-10-02

5.2 is mostly a visual and cleanup update.

The Overworld now uses more of Beta's original environment art and biome colouring, and a lot of duplicated internal rules have been consolidated so different systems stop maintaining their own slightly different idea of what is and isn't valid Beta content.

### Sky and biome colour

- Added Beta's original grass colormap at `textures/colormap/grass.png`.
- Added generated grass, foliage, and sky colours for every Overworld biome.
- Changed Forest, Plains, Desert, Taiga, and Swampland to use their own climate-based colouring instead of sharing the same general Bedrock tint.
- Added `scripts/derive-biome-colors.mjs` to generate the 84 client biome definitions.
- Added `npm run generate:client-biomes` and a smoke test to keep generated biome colours in sync.
- Changed sky colour generation to use Beta's original temperature-based formula.
- Added Beta's original cloud texture.
- Added Beta's original sun texture.
- Added Beta-style block-breaking crack textures from the original ten `destroy_stage_*` tiles.
- Added Beta's pumpkin overlay.
- Changed the moon texture to use the same Beta moon across all eight Bedrock moon-phase slots because Beta did not have moon phases.
- Added smoke tests for the environment texture paths and texture layouts.

### Internal cleanup

- Removed duplicated entity, item, ore, and drop rules from `compatibilityPolicy`.
- Changed `compatibilityPolicy` to only handle world-block replacement.
- Moved passive, hostile, and Zombie Pigman entity lists into `betaRegistry`.
- Moved sword and pickaxe tier definitions into `betaRegistry`.
- Moved wood-species groups into `betaRegistry`.
- Moved the Beta wool palette into `betaRegistry` so blocks, sheep drops, shears, and combat logic all use the same list.
- Added `betaConstants.ts` for dimension identifiers, `getDimension` keys, and vertical world limits.
- Added a runtime check that fails if a full dimension ID is accidentally passed to `getDimension`.
- Added `equipmentSlots.ts` for the shared armor-slot list.
- Added `vectorMath.ts` for shared boat and minecart movement helpers.
- Moved `FOOD_CONVERSIONS` into `normalizer`.
- Changed `FOOD_ITEMS` to be derived from the conversion table instead of being maintained separately.
- Added a load-time check for invalid food conversions.
- Added `resolveDropId` so dropped items and inventory conversions resolve through the same path.
- Added `BETA_POLICY_GAPS.md` to document known places where intended Beta behavior still differs from what the pack currently does.

### World generation

- Disabled emerald ore generation.
- Disabled copper ore generation.
- Disabled dripstone-cave copper generation.
- Changed existing emerald ore cleanup to replace the ore with stone instead of air.
- Disabled vine generation.
- Disabled glow lichen generation.
- Removed the old `vine_feature.json` stub because its identifier did not match an actual vanilla feature.
- Retuned the Y=0 bedrock-floor height distribution so the upper bedrock layer appears more often and the floor looks less flat.
- Kept the three-block maximum bedrock cap.

### Other fixes

- Fixed sheep shearing drops from 2–4 wool to Beta's correct 1–3 wool.
- Changed sheep punch and shearing drops to use the same shared wool-count bounds.
- Fixed killed sheep dropping wool without preserving their colour.
- Added `set_data_from_color_index` to the sheep death loot table.
- Removed the scripted zombie feather drop because the zombie loot table already handled it.
- Changed the oak fence recipe to override vanilla's `minecraft:fence` recipe instead of adding a separate duplicate recipe.
- Changed crafted fences to directly produce the custom Betafied fence block.
- Added the `crafting_table` tag to the fence recipe.
- Fixed fence connections becoming stale when a neighbouring chunk was unloaded.
- Removed armor-point handling for Netherite and turtle helmets.
- Changed the armor fallback heuristic so it only applies to vanilla armor identifiers.
- Removed obsolete sword fast-break IDs including `web`, `leaves`, `wooden_stairs`, and `wool`.
- Changed sword wool checks to use the shared wool palette from `betaRegistry`.
- Removed slab, stair, log, plank, and fence placement-normalization code from the interaction guards because those items are already converted before placement.
- Changed `push.mjs` to add or update the content-logging settings in `server.properties` instead of only changing them when the keys already exist.
- Fixed fresh server deployments starting with content logging disabled.

## 5.1 — 2026-10-02

5.1 is mostly cleanup after 5.0.

It fixes some terrain leftovers that were still getting through, removes modern fallen trees, fixes fresh-world spawning, and fixes logs refusing to stack properly after being picked up.

### World spawn

- Removed the custom spawn coordinator and returned spawning to Minecraft's normal seed-based spawn system.
- Removed the old random spawn search because the new Y=0 bedrock floor could make it fail to find valid ground.
- Removed the fallback spawn at `{0, 80, 0}`, which could drop players into water or leave them falling.
- Deleted the old spawn module entirely instead of leaving it disabled.

### Fallen trees

- Removed modern fallen-tree generation because Beta 1.7.3 only generated upright logs.
- Disabled the five `fallen_*_tree_feature` features and their five `optional_fallen_*` variants.
- Removed the old `fallen_acacia_tree_feature` stub because that feature does not actually exist.
- Added scrubber cleanup for fallen logs in already-generated terrain.
- Changed cleanup to only remove sideways logs, leaving upright logs untouched.
- Added a presence check before writing so chunks with only normal upright logs do not pay for an unnecessary fill.

### Plants and flowers

- Fixed some modern plants and flowers surviving a complete scrub pass.
- Merged the old bulk and fine replacement tables into the same native-fill probe path so both sets of blocks are actually reached.
- Changed duplicate replacement entries so the first matching rule wins instead of processing the same block twice.
- Added cleanup for lilac, peony, rose bush, sunflower, cornflower, lily of the valley, azure bluet, oxeye daisy, allium, blue orchid, pitcher plant, torchflower, hanging roots, leaf litter, vines, and other post-Beta plants.
- Masked tall modern plants in the resource pack so an unscrubbed chunk does not show see-through holes before cleanup runs.

### Item drops

- Fixed chopped logs refusing to stack after pickup.
- Changed log drops to spawn directly as their final `bh:` item instead of dropping as a vanilla log and being converted after pickup.
- Changed drop conversion to use the same placer table as the inventory sweeper so ground items and inventory items always use the same identifier.
- Restored normal native item stacking for converted log drops.

## 5.0 — 2026-10-02

Sorry for the wait on this one. Partway through development the drive this project was on failed. Most of it was recovered, but some files were lost or corrupted and had to be rebuilt.

5.0 is the largest terrain release so far, with a rewritten chunk scrubber, more accurate Beta 1.7.3 terrain, and a large number of fixes.

### Terrain performance

- Rewrote the chunk scrubber to use `Dimension.fillBlocks` instead of `/fill`, greatly reducing the number of script calls needed per chunk.
- Changed terrain scanning to work in bounded bands so large scans can yield cleanly between ticks.
- Changed cleaned chunks to use a long recheck timer instead of being rescanned constantly.
- Changed failed or unloaded chunk passes so they remain unmarked and retry later instead of being treated as clean.
- Changed inventory cleanup to react to inventory changes instead of reading all 36 slots every tick.
- Added slower equipment and full inventory sweeps as fallback checks.

### Terrain accuracy

- Removed modern Overworld biome behavior by overriding every vanilla biome with a Beta-style definition.
- Limited visible Beta biomes to Forest, Plains, Desert, Taiga, and Swampland.
- Changed most modern cold biomes to Forest or Plains so every cold zone does not become snowy Taiga.
- Changed ocean floors back to dirt and gravel instead of modern sand and clay. (verification needed if this is accurate.)
- Changed beaches to use sand or gravel.
- Changed cave walls back to plain stone.
- Changed jungles and mushroom islands to Forest.
- Changed savannas to Plains.
- Changed badlands to sand and sandstone.
- Changed frozen oceans and rivers back to normal water.
- Removed modern biome tags such as `bamboo`, `cherry_grove`, `bee_habitat`, `mesa`, and `lush_caves`.
- Removed village generation by emitting biomes without `minecraft:village_type`.
- Moved the biome mapping table into `scripts/lib/betaBiomes.mjs` and added generated JSON plus a smoke test so the definitions stay in sync.

### Flowers

- Removed all modern flower generation except poppies and dandelions.
- Changed `minecraft:flower_feature` to a 50/50 poppy and dandelion picker.
- Changed red and yellow flower features to place those blocks directly.
- Restricted flowers to grass so they do not generate in deserts or beaches.
- Disabled the vanilla double-plant aggregate to stop lilacs, peonies, rose bushes, and sunflowers from generating.
- Kept the scrubber fallback for any post-Beta flowers that still appear.

### Structures

- Removed village generation.
- Removed tag-driven modern structures such as trail ruins and abandoned camps by removing the biome tags they depend on.
- Changed the scrubber to erase post-Beta structure blocks where structures cannot be disabled at generation time.
- Left Beta-legal blocks such as obsidian, lava, and gold blocks untouched when cleaning structures.
- Removed the unused structure-set overrides because vanilla structure sets cannot actually be replaced by behavior packs.

### Nether

- Removed the old `minecraft:replace_biomes` system because it does not properly replace the Nether.
- Added direct overrides for `hell`, `soulsand_valley`, `crimson_forest`, `warped_forest`, and `basalt_deltas`.
- Changed all Nether biomes to the same Beta-style netherrack, lava, soul sand, and gravel setup.
- Removed piglin, Enderman, and magma cube spawn tags.
- Changed Nether quartz, gold, and ancient debris back into netherrack.
- Changed magma around lava seas into gravel instead of air so shorelines are not left full of holes.

### Deep world
- Added a rough bedrock floor around Y=0 to recreate Beta's 128-block world height.
- Changed the floor to use a deterministic uneven heightmap instead of a perfectly flat layer.
- Stopped the fine scrub pass from scanning the sub-zero world because it is hidden below the bedrock floor.
- Added a block-break guard below Y=0 so survival players cannot open the modern underground.
- Added repair logic for bedrock left too high by older floor-generation math.
- Changed floor sealing to process nearby chunks first and claim chunks while they are being worked on.

### Chests

- Added `cardinal_direction` to `bh:chest` so the latch faces the player who placed it.
- Changed chest pairing so double chests can form on both north-south and east-west axes.
- Changed chest merging to happen one tick after placement so the block entity exists before inventory data is read.
- Fixed cases where chests merged with the wrong contents or refused to merge.
- Changed failed merges to restore both original chests, their facing direction, and their contents.
- Changed unrecoverable restored items to drop on the ground instead of being lost.

### Underwater tint

- Fixed the underwater tint so it fills the entire screen instead of rendering as a small 32×32 box.
- Changed the tint to attach to a screen-sized HUD element and scale while keeping its aspect ratio.
- Changed the clear behavior so leaving water no longer depends on another HUD system overwriting the same binding.
- Added a hidden marker specifically for clearing the water overlay.
- Changed the water check to run every tick so entering and leaving water updates immediately.
- Kept lava excluded because Beta only used the tint underwater.

### Something in the fog

- Added a very rare Overworld encounter that appears near the edge of the player's vision and disappears when looked at directly.
- Added an operator command for testing it.
- Added a code note for anyone who goes looking!

### Other fixes

- Changed masked post-Beta blocks to render as their eventual Beta replacement instead of becoming temporarily invisible.
- Changed failed fine-pass replacements to fall back to a real block instead of air.
- Fixed a block-atlas texture collision that could make gravel inherit animated magma-related graphics.
- Fixed swamp water tinting for the biome identifier the engine actually uses.
- Changed Nether biomes to use dense Nether fog instead of Overworld water fog.
- Fixed the skeleton attack animation referencing a nonexistent `default` animation.
- Removed the `crafting_table` tag from the wooden slab recipe so it only appears under Beta crafting rules.
- Restored inventory auto-place and coalesce bindings.
- Fixed chat input focus on touch platforms.
- Removed the old single-file Nether overrides.
- Removed unused structure-set stubs.
- Removed the dead `netherSpawnProtection` and `ruinedPortalScrubber` modules.

## 4.3 — 2026-10-02

The big feature this time is chests! Finally got them working right.

### Features
* **Double Chests:** If you place two chests next to each other, they actually merge into one massive 54-slot chest.
* **Stairs as Real Blocks:** Removed extra modern states (no corner stairs, no upside-down placement). Just flat stairs with four rotations, exactly how it was in Beta 1.7.3.
* **Bottom-Only Slabs:** Slabs only place flat on the bottom now. No top slabs at all (which also eliminated the geometry y-axis bug).
* **Vertical-Only Logs:** No sideways logs. Each wood type gets its own classic top and side textures.

### Tweaks & Fixes
* **Tool Classes:** Swords mine wooden stairs at the proper speed, matching old Beta tool classes.
* **Post-Beta Mob Cleanup:** Sulfur cubes, bees, armadillos, creakings, and breezes will no longer spawn naturally.
* **Chunk Scrubber:** Now works in reverse — blocks that did not exist in Beta are wiped out entirely.

### Behind the Scenes
* Updated tag schema to `minecraft:tags` across the pack.
* Cleaned up legacy placers: removed `structurePlacer` and overriding item blueprints.
* Offline test suite expanded to 176 tests.

## 4.2 — 2026-10-02

Betafied 4.2 makes the addon play nicely with other mods and cuts the download size by ~40MB!

### Features & Improvements
* **Mod Compatibility:** Everything Betafied removes, converts, or culls is now strictly scoped to the `minecraft:` namespace. Modded items, blocks, dropped entities, and mobs pass straight through untouched.
* **Huge Pack Size Reduction:** Removed 511 duplicate textures and unused music files from the resource pack. Pack size dropped from 41MB down to 1.3MB with zero in-game visual change.
* **Scoped Scrubbing:** The cleaner no longer touches non-vanilla items like firearms or custom entities.

## 4.1 — 2026-10-02

Betafied 4.1 focuses on parity fixes, block placement corrections, and mob spawning fixes.

### Features & Additions
* **Cobblestone Stairs:** Added as a real Beta block with authentic structure and texture. Crafting recipe yields classic Beta cobblestone stairs.
* **Block Normalization:** Wood stairs convert to oak stairs, modern stone stairs convert to cobblestone stairs, and logs/stems normalize to classic Beta logs.

### Tweaks & Fixes
* **Mob Spawning:** Restored missing biome `minecraft:tags` so plains and desert mob spawn rules function properly.
* **Stair Placement:** Reworked stair placement so they face correctly without flipping upside-down.
* **Armor Durability:** Armor takes damage and wears down properly from falls, fire, and lava.
* **Inventory Cleaner:** Now scrubs armor and offhand slots every tick.
* **Apple Drops:** Trees no longer drop apples, matching Beta mechanics.
* **UI Polish:** Cleaned up pause screen passthrough and enabled command autocomplete.

### Behind the Scenes
* Test suite expanded to 124 tests, including smoke tests for tags and spawn rules.

## 4.0 — 2026-10-02

The massive 4.0 rewrite! Fully ported to TypeScript with Regolith and updated for Bedrock 1.26.51+ (Script API 2.11).

### Highlights
* **Engine Rewrite & EventBus:** Unified tick manager and event bus staggering tasks across ticks to prevent CPU spikes and watchdog timeouts.
* **Inverse Cleaner & Normalizer:** Swapped rigid block lists for an inverse allowlist and heuristic normalizer.
* **Block Placement:** Fixed stairs, slabs, and logs placement to match classic Beta.
* **Sheep Punching:** Bare-handed sheep punching drops 1–3 wool without shears.
* **Classic Animal AI:** Animals wander freely and panic when struck.
* **Instant Bonemeal:** Crops grow instantly with classic mechanics.
* **Java Beta Angles:** Restored original first-person swing and holding angles.
* **Automated Test Suite:** Initial offline test suite with 78 tests.
