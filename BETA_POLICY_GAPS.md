# Beta policy gaps

Open decisions found while collapsing the three parallel Beta truth tables (`betaRegistry.ts`,
`normalizer.ts`, `compatibilityPolicy.ts`) into one owner each. Each item below is a place where a
declared rule and the shipped behaviour disagree. None of them is a bug in the collapse itself —
they are pre-existing, and they were previously invisible because a test asserted the declared table
rather than the code path that runs.

Deciding an item means picking one of:

- **Implement** — make the code do what the rule says (a gameplay change, needs an in-game look).
- **Drop the rule** — accept the current behaviour and delete the claim.
- **Keep written down** — leave it here as a known, intentional difference.

## 1. Inventory conversions that were declared but never implemented

`compatibilityPolicy.ITEM_CONVERSIONS` was deleted: it had no production consumer, and
`normalizeItem` — the function the inventory sweep actually calls — does not implement many of its
entries. Today these ids are **deleted on pickup** rather than converted, because they fall through
every heuristic in `normalizer.normalizeItem` to `{ action: "remove" }`:

| Item | Declared target | Current behaviour |
| --- | --- | --- |
| `minecraft:mud`, `minecraft:muddy_mangrove_roots` | `minecraft:dirt` | removed |
| `minecraft:suspicious_sand` | `minecraft:sand` | removed |
| `minecraft:suspicious_gravel` | `minecraft:gravel` | removed |
| `minecraft:bamboo_block` | `minecraft:oak_log` | removed |
| `minecraft:crafting_table` | `bh:crafting_table` | removed |
| the 18 post-Beta flowers (`cornflower`, `allium`, `lilac`, `sunflower`, …) | `minecraft:poppy` | removed |
| `minecraft:white_dye`, `black_dye`, `blue_dye`, `brown_dye` | `bone_meal`, `ink_sac`, `lapis_lazuli`, `cocoa_beans` | removed |
| `minecraft:packed_ice`, `minecraft:blue_ice` | `minecraft:ice` | removed |
| the 17 `*_terracotta` variants | `minecraft:clay` | removed |

The terracotta and brick cases are the ones to think about hardest, because world terrain *does*
repaint them: `BLOCK_BULK_REPLACEMENTS` maps every terracotta to sandstone. So a mined terracotta
block currently becomes sandstone on the ground, which is consistent — but the matching item id
silently vanishes if it arrives any other way.

## 2. `stone_bricks` has two contradictory stances

`normalizer.test.ts` asserts `normalizeBlock("minecraft:stone_bricks")` is **removed** (Beta 1.7.3
had no stone bricks), while the deleted table claimed `stone_bricks → minecraft:stone`. The collapse
kept the removal, since the scrubber's job is to erase blocks the era never had. Worth confirming
that deleting a player's stone bricks is the intent rather than converting them to stone.

## 3. Resolved: `raw_copper` lands on cobblestone on both paths

The ore-drop special case used to send `normalizeEntityDrop("minecraft:raw_copper")` to
`minecraft:iron_ore` while `normalizeItem` answered `minecraft:cobblestone`. Copper is now absent
from `ORE_DROP_CONVERSIONS`, so a ground pickup falls through to `normalizeItem` like any other
post-Beta item — both paths reach cobblestone through one owner.

## 4. Resolved: vanilla fences are moved onto `bh:fence`

`BETA_BLOCK_IDS` lists `minecraft:oak_fence` as authentic, so `normalizeItem` still answers `keep`
for it — but that layer answers "may this id exist in the world", which is true and separately
pinned by a test. A **held** item never reaches that answer alone: `inventoryManager` consults the
placer table first, which now retypes every `*_fence` and `*_fence_gate` onto `bh:fence`, and
`recipes/oak_fence.json` overrides vanilla's `minecraft:fence` recipe id so a crafted fence is already
the custom block. `tests/policy/inventoryManager.test.ts` pins the retyping.

Still open: the **chunk scrubber** keeps world-placed vanilla fences, because `normalizeBlock` treats
`minecraft:oak_fence` as authentic terrain. A fence generated into the world therefore still cannot
connect to a `bh:fence` line, which is the only remaining way two fence families can coexist. Decide
whether the scrubber should convert them.

## 6. Fence connectivity stays in script, deliberately

Swapping `bh:fence` onto the declarative `minecraft:connection` trait was investigated and rejected on
three points, all from the official block reference:

- The trait "requires Bedrock Edition 1.21.130 or higher, and currently requires that the 'Upcoming
  Creator Features' experimental toggle is set on". A world without that experiment would lose fence
  connectivity outright, where the script works anywhere. The pack's manifest enables no experimental
  toggles by policy.
- The trait exposes four booleans (`minecraft:connection_north` and friends), not the single 4-bit
  `bh:connections` mask the block and its Molang `bone_visibility` are built around. That makes the
  switch a rewrite that also has to drop the custom state.
- `minecraft:connection_rule.accepts_connections_from` offers only `all`, `none` and `only_fences`,
  and `only_fences` is documented as "all Vanilla fences excluding NetherBrick". A custom `bh:fence`
  is not a vanilla fence, so the rule cannot express fence-to-fence connectivity.

So the script remains the owner. Its known weakness is that it recomputes only on player place and
break, meaning a fence whose neighbour changes some other way — a command, a structure, generation —
keeps a stale connection mask.

## 5. Loot-table vocabulary (partly resolved)

The vanilla behavior pack under `reference-docs/…/VanillaBehaviorPack` settles the item-id question
this note previously left open: Bedrock's raw and cooked fish are `minecraft:fish` / `minecraft:cooked_fish`,
and a coloured wool is `minecraft:wool` with `minecraft:set_data_from_color_index`. `minecraft:cod` is
the *entity* identifier, never an item.

Resolved here:

- `normalizer.FOOD_CONVERSIONS` now also maps `minecraft:fish` / `minecraft:cooked_fish`, and
  `betaRegistry.BETA_ITEM_IDS` registers them, so a caught fish lands on `bh:cod` / `bh:cooked_cod`
  instead of being swept. The `cod` / `salmon` spellings stay as harmless aliases.
- `loot_tables/entities/sheep.json` gained the `minecraft:set_data_from_color_index` function it was
  missing, so the death drop resolves the sheep's colour the way the shear table already did.
- The zombie feather drop was removed from `entitySpawnHandler`; `loot_tables/entities/zombie.json` is
  now the single owner of that drop.
- `toolMining.SWORD_FAST_BLOCKS` dropped the legacy ids (`web`, `leaves`, `leaves2`, `wooden_stairs`,
  `wool`) that never resolve on this engine, and takes its palette from `betaRegistry.WOOL_BY_COLOR`.

Still open, and genuinely engine-dependent: the pack's own fishing tables sit at
`loot_tables/fishing.json` and `loot_tables/fishing/*.json`, not at the vanilla
`loot_tables/gameplay/fishing/*.json` path the fishing hook reads, so nothing loads them until an
override is placed on the vanilla path. Confirm in-game which tables the hook uses, then either move
these onto the vanilla path or delete them.

## 7. Ore generation (partly resolved — needs an in-game look)

Beta 1.7.3 had no emerald (arrived in 1.3) and no copper (1.17), but both still generate on modern
terrain. Two mechanisms now cover that, deliberately at different layers:

- **Generation:** `features/emerald_ore_feature.json`, `copper_ore_feature.json` and
  `dripstone_caves_copper_ore_feature.json` are inert `ore_feature` stubs, following the same
  override-by-identifier pattern as the vine, glow-lichen and fallen-tree stubs. This keeps the ores
  out of *new* chunks instead of generating and then erasing them.
- **Scrubber (the guaranteed net):** `BLOCK_BULK_REPLACEMENTS` maps `emerald_ore` and
  `deepslate_emerald_ore` to `minecraft:stone`. The old table sent `emerald_ore` through
  `normalizeBlock`, which had no entry for it and defaulted to `remove` — every emerald vein in
  already-generated ground was being scrubbed to **air**, punching ore-shaped holes in terrain.Still engine-dependent: whether a behavior pack's ore-feature stub actually pre-empts vanilla's ore feature rule has to be confirmed in-game, the same caveat the vine/lichen stubs carry. If it does not, the scrubber mapping above is what keeps the world correct.

**Retuned (needs an in-game look).** Vanilla spreads each surviving Beta ore across several modern
split rules, so overriding one file would only move part of the density. The pack now owns both
halves:

- `feature_rules/` carries one override per vanilla rule identifier — the primary rule for coal,
  iron, gold, redstone, diamond and lapis keeps its `minecraft:` identifier and scatters a new
  `bh:beta_*_ore_feature` with Beta's per-chunk attempt count and height band; the 14 split
  variants (upper/lower/middle/small/buried/large/square, plus the mesa and mountains specials)
  are neutered with a biome filter on a tag no biome carries, so nothing double-fires on top of
  Beta's counts.
- The six `features/beta_*_ore_feature.json` files set Beta's vein sizes and only replace the
  stone family, so a vein never eats surface blocks. The numbers: coal 20 attempts × 16 blocks,
  y 0–128; iron 20 × 8, y 0–64; gold 2 × 8, y 0–32; redstone 8 × 7, y 0–16; diamond 1 × 7,
  y 0–16; lapis 1 × 6, scattered as a triangle over y 0–32 so it clusters around y16 the way
  Beta's did. Y-bands are half-open and match Java's `nextInt(max - min) + min` exactly.
  The height bands and the redstone-8/diamond-1 attempt counts are verified against the
  pre-Caves-&-Cliffs distribution tables; the 7/7/6 vein sizes for redstone, diamond and lapis
  are the classic pre-1.8 figures and are the least certain entry here — confirm them in-game.

Three things to confirm in-game, in order of blast radius: (1) that a pack file overriding a
vanilla feature *rule* by identifier actually replaces it (the recipe and feature stubs rely on
the same mechanism, but no rule override has been proven yet); (2) that no modern variant rule
outside the 14 listed in `tests/smoke/fallenTrees.test.ts` still fires — the `/place` command's
rule list is where those identifiers came from; (3) that the triangle scatter lands lapis's peak
where intended.

## 8. Farmland trampling is re-added by script, and only half of it (needs an in-game look)

Beta 1.7.3's trampling lived in the engine, not in the farmland block: `Entity.moveEntity` resolved the
walked block as `floor(posY - 0.2)`, fired that block's `onEntityWalking` once per 1/0.6 blocks of
horizontal travel, and `BlockFarmland.onEntityWalking` answered with `rand.nextInt(4) == 0` → dirt.
Bedrock only tramples farmland when something *lands* on it, so the walking half was missing entirely —
`interactions/cropTrampling.ts` re-adds it, keeping the era's step cadence, its 1-in-4 roll, and both
of the exemptions that second line carried.

Decided and implemented:

- **The fence trick is fence-specific.** The maintainer described it as "a block placed under the
  farmland", but the 1.7.3 call site swapped the walked block for the block beneath it only when that
  block was `Block.fence`; every other block was irrelevant. `isFenceBlock` therefore follows the fence
  family (`bh:fence`, `minecraft:fence`, `*_fence`) and deliberately not fence gates. A vanilla gate
  left by terrain or a command protects nothing; a *placed* one is retyped onto `bh:fence` and does.
- **The sneak exemption is the era's own rule.** `var18 = this.onGround && this.isSneaking()` gated the
  callback, so a sneaking player on the ground never trampled — and a sneaking entity in mid-air still
  did. Both halves are pinned by tests.
- **A rider tramples nothing with their own feet.** The same condition carried `ridingEntity == null`, so
  a player crossing a farm on a horse left no trample behind; the mount still tramples, because it is an
  entity walking in its own right, exactly as it would have in 1.7.3.
- **Mobs trample, not only players.** `canTriggerWalking()` was true for every entity, and the mob
  sweep covers animals within 24 blocks of a player. This is the constant to reconsider first if a
  server finds animal trampling too punishing.
- **Creative and Spectator are exempt from the walking rule only.** Neither mode has a Beta
  counterpart, and a builder flying over a farm should not convert it back to dirt — but that reasoning
  belongs to the behaviour this module *adds*. The landing guard serves every mode, because it is undoing
  an engine behaviour the era never had, and the engine tramples in Creative exactly as it does in
  Survival. Gating the guard on the mode hid the whole feature from a creative-mode builder through a
  day of testing: the log read `mode=Creative watch=0 fix=0` while a farm turned to dirt under a jump.
- **Bedrock's landing trample is undone, not prevented.** 1.7.3 never looked at `fallDistance`, so a
  standing jump trampled nothing; Bedrock tramples on any landing, fence or no fence, which made
  jumping on a farm destroy it. The engine converts the block inside its own tick with no script hook
  in front of it, so the module watches the column a falling entity is heading for, and puts the
  farmland (moisture included) and its crop (growth included) back from that snapshot, clearing the
  crop drops the break spawned so the restore cannot be farmed for free. This is also what makes the
  fence trick total again, as it was in the era. The snapshot is taken for every sampled entity on
  every pass and asks `Entity.isOnGround` nothing: that property is documented to behave unexpectedly,
  and skipping the pass before a landing is the one mistake this guard cannot recover from. The
  passability question during the downward scan is answered by a small set of block types rather than
  by `Block.isSolid`, which is pre-release surface — see the `betafied/no-beta-api` warnings.
- **The walking rule takes the crop down itself, and pays the era's drop for it.** Waiting for
  Bedrock's neighbour update to pop the crop is a dependency on engine behaviour this module cannot
  check offline, and a plant left standing on dirt is the visible half of the trample — so the crop is
  broken explicitly, before the farmland is set to dirt (afterwards the engine's own update would be
  free to pop it and pay the modern loot table instead). The drop is `cropDropsFor`: `BlockCrops` in
  1.7.3 answered `idDropped(meta) -> meta == 7 ? Item.wheat : -1` and then ran three independent
  `rand.nextInt(15) <= meta` seed rolls, so a ripe crop pays one wheat and up to three seeds and an
  unripe one can pay nothing at all — not the guaranteed seed modern versions hand out. **Wheat is the
  only crop this models, on purpose**: carrots, potatoes, melons and beetroot all post-date 1.7.3, the
  block registry agrees, and a post-Beta crop growing on a farm belongs to `compatibilityPolicy` — so it
  is left standing rather than silently deleted with no drop.

Still open:

- **The correction is visible for a tick.** The tile is dirt and the crop is popped until the pass
  that restores them, which is one tick if that pass lands after the engine's, two if before. Needs an
  in-game look to decide whether that flicker is acceptable.
- **The drop sweep is scoped by radius and item id.** A harvest the engine spawned when it popped a
  crop is removed from the crop cell within 0.9 blocks of its centre, so a restore cannot be farmed for
  free; a seed a player dropped into that exact spot in that same tick would go with it.
- **Mob landings are best-effort.** Mobs are swept every other pass, so a mob that crosses more
  columns between two sweeps than the lookahead covers (`LANDING_LOOKAHEAD`, three) can still trample a
  tile nothing watched. Players are watched every tick, which makes the same lookahead worth about four
  blocks of travel a tick for them — further than a sprint-jump, an elytra glide or a knockback slide
  normally moves.
- **The landing guard cannot be verified offline at all.** It was confirmed in game once, through
  temporary `cropTrampling:` traces that have since been removed: the guard watched the right tile, read
  the farmland under the crop correctly, and was skipped entirely in Creative — which is the bug those
  traces were written to find. Re-adding a trace is the way to check it again.

## 9. Doubled slabs are script-assembled, and only across the pack's own halves

Beta 1.7.3's `BlockSlab` rebuilt two halves as one full block, so `interactions/slabStacking.ts`
assembles `bh:double_*_slab` from the slab a player places against a matching one. The merged block
has no `menu_category` and no item definition on purpose: Beta's doubled slab was never a holdable
item, and mining it pays the two halves back through its loot table.

Still open: a **vanilla** half never merges with a `bh:` one. The inventory sweep retypes every held
`*_slab` onto its `bh:` id and the scrubber leaves world-placed `minecraft:*_slab` alone because
`BETA_BLOCK_IDS` calls it authentic terrain, so the only vanilla halves left are ones a structure,
an old save or a command placed — the same coexistence §4 describes for fences. Plumbing a mixed pair
would first have to answer which family the full block belongs to, so the two families stay apart
until someone decides that.

## 10. The era's unstackables are pack items now

Beta 1.7.3 capped a door, a sign, a bucket and a cake at one per slot inside the engine — `ItemDoor`,
`ItemSign`, `ItemBucket` and `ItemReed` each set their own stack size — so none of them could stack in
a chest either. They kept stacking anyway, because that limit only ever existed for the pack's own
items (whose item JSON the engine reads) while those four are vanilla items a pack cannot redeclare.
The inventory sweep split those stacks in a *player's* slots and nowhere else, which is why the report
read "doors stack in chests" next to "porkchops don't" — the porkchops are pack items and the doors
were not.

Decided and implemented: the crafted result is a pack item — `bh:wooden_door`, `bh:iron_door`,
`bh:oak_sign`, `bh:bucket`, `bh:cake` — carrying `minecraft:max_stack_size` 1, which the engine
applies everywhere, so the chest half of the bug is fixed at the engine rather than by a sweep over
other people's containers. `BETA_CAPPED_ITEM_OF` retypes every held vanilla one onto its pack item,
splitting a stack as it converts, so the two ids cannot drift apart, and `packs/BP/items` now holds an
item for every id in that table (asserted by a test, because a capped id with no item JSON would be a
pickup the sweep throws away).

The placement rules the era applied are enforced for the sign and the bucket, which the engine cannot
place for the pack (a custom item's `minecraft:block_placer` writes one block, never a wall sign, and
never a source block's fluid): `interactions/signPlacement.ts` writes the standing or the wall sign the
way `ItemSign` did, and `interactions/bucketUse.ts` fills from a still source only — the era's metadata
0, so water on its way somewhere is still refused — and answers a cow the same way `EntityCow` did.

Still open, all of it engine-dependent and needing an in-game look:

- **Does `minecraft:block_placer` place a two-block door?** The component's contract is "place a
  block", and the era's `ItemDoor` wrote both halves itself, so `interactions/doorPlacement.ts`
  completes the pair from whichever half the engine left. If the engine places both halves on its own,
  that completion is a no-op and can be deleted; if it places only the lower half, the completion is
  what makes the item usable at all. A door left half-built because the cell above was taken is
  deliberately left standing: that block is not the pack's to delete.
- **Does `playerPlaceBlockBefore` fire for a `block_placer` placement?** Beta's top-face-only rule is
  enforced there. If the event does not fire for a custom item, a door can land on a side face and the
  completion would then hang a top half over it with nothing underneath.
- **Does a script-placed sign open the editor for the player who placed it?** Beta's `ItemSign` called
  `EntityPlayer.func_4048_a(sign)` on the newly written tile entity, so the editor opened with the
  placement. No script API opens it, so the pack's sign cannot reproduce that half; the editor is
  reached by clicking the sign afterwards instead. If the engine ever opens the editor for a
  script-written sign, the double-open that would cause needs checking.
- **Does the cake's `minecraft:block_placer` place on the faces `ItemReed` allowed?** Beta's cake went
  down on any face of a block, which is what the component has to reproduce; it is the one capped item
  whose placement is left entirely to the engine.
- **Whether a filled vanilla bucket that is emptied comes back as `minecraft:bucket` or as something
  else.** The sweep retypes whatever empty bucket the engine hands back onto `bh:bucket`, so a
  momentary vanilla bucket is expected and fine; what needs a look is that water, lava and milk are all
  covered, since only the empty id appears in `BETA_CAPPED_ITEM_OF`.
- **The cake recipe's milk ingredient is still spelled the legacy way**, `{"item":
  "minecraft:bucket", "data": 1}`. Milk buckets remain vanilla items, so the ingredient was left
  alone; if that spelling no longer resolves, the cake is uncraftable and the ingredient needs to be
  `minecraft:milk_bucket`.

Smaller, and deliberate: the wooden door recipe takes the `minecraft:planks` tag, so six planks of
mixed species craft one door where Beta wanted a single species — the tag and the difference the chest
recipe already carries. The sign, bucket and cake recipes keep their own `bh:` identifiers and the
`beta_crafting` tag alone rather than overriding vanilla's recipe ids, so the vanilla crafting table
can still hand the player a vanilla stack — which the sweep then retypes and splits on pickup.

## 11. Mob boxes and speeds come from the recovered 1.7.3 client, with one calibrated unit

Thirteen entity files were corrected against the 1.7.3 sources recovered into the gitignored corpus at
`reference-docs/beta-1.7.3`, and `tests/smoke/entityDimensions.test.ts` now pins each number to the line
it was read from. The boxes that were wrong, and the era's own value for each:

| Entity | Beta's box | Was | Now | Source |
| --- | --- | --- | --- | --- |
| chicken | 0.3 x 0.4 | 0.6 x 0.8 | 0.3 x 0.4 | `EntityChicken.java:15` |
| wolf | 0.8 x 0.8 | 0.6 x 0.8 | 0.8 x 0.8 | `EntityWolf.java:18` |
| spider | 1.4 x 0.9 | 1.1 x 0.7 | 1.4 x 0.9 | `EntitySpider.java:7` |
| zombie, skeleton, pigman | 0.6 x 1.8 | 0.6 x 1.9 | 0.6 x 1.8 | `Entity.java:86-87`, no override |
| slime, sizes 1/2/4 | 0.6 x size | 0.52 x size | 0.6 x size | `EntitySlime.java:24` |
| ghast | 4.0 x 4.0 | 4.02 x 4.0 | 4.0 x 4.0 | `EntityGhast.java:16` |

Pig, cow, sheep, squid, creeper and the player already matched. A mob that never calls `setSize` is a
0.6 x 1.8 humanoid, which is why the undead are now shorter than Bedrock's 1.9.

Speeds are a translation rather than a copy, because Beta has one ground factor for every living
entity: `EntityLiving.moveEntityWithHeading` passes `0.1F * var9` (1.0 on a normal block) into
`Entity.moveFlying` (`Entity.java:611`), which scales the input by `factor / max(magnitude, 1)`, and
`EntityCreature.updatePlayerActionState` sets `moveForward = moveSpeed` (`EntityCreature.java:69`). A
mob's speed is therefore its `moveSpeed` as a share of the walking player's -- 0.5 for the zombie and
pigman, 0.7 by default, 0.8 for the spider, 1.1 for the wolf, which Beta clamps back to a full stride.
Bedrock documents `minecraft:movement` only as "base movement speed", so the unit is calibrated on the
mob both editions define as *half the walking player*: Bedrock's own zombie is 0.23, making one Beta
unit 0.46 (`0.23 / 0.5`) -- the same figure Java's AI movement term (`0.1 / 0.216`) produces -- and
every other value is `0.46 x moveSpeed`.

A mob's engine speed is `movement x speed_multiplier` (Microsoft's intended reading; the interaction
itself is undocumented), so the multipliers that were discounting a stroll -- 0.8 on the pig, cow,
sheep, zombie, creeper and spider, and 1.25 on the creeper's and the skeleton's attacks -- were
flattened to 1, because Beta had a single speed for wandering and chasing alike. Two states keep a
multiplier because Beta genuinely had a second speed: `zombie_pigman.melee_attack` is 1.9
(`EntityPigZombie.java:19` raises `moveSpeed` to 0.95 while it has a target, against its own 0.5), and
the five `mount_pathing` multipliers were left exactly as they were.

**Needs an in-game look, and it is one number.** The 0.46 anchor cannot be confirmed offline: nothing
in the documentation says what Bedrock's movement value means physically, and the two derivations above
agree only because both editions share the zombie's number. Walking a pig beside a walking player
settles it. If the mobs now read as too fast or too slow, `WALKING_PLAYER_UNITS` in the test is the one
place to change, since every declared speed is derived from it.

Still open:

- **A mob's eye height cannot be declared.** Beta's is `height * 0.85` (`EntityLiving.java:89`), `height
  * 0.8` for the wolf (`EntityWolf.java:221`) and 1.62 for the player's camera
  (`EntityPlayer.java:44,152`; the player's own `getEyeHeight` answers 0.12F, which is not a camera).
  Bedrock's entity component list has nothing that sets a mob's eye height, and how the head location a
  script reads is computed is undocumented, so these values live in the test file and nowhere else.
- **Two mobs are not `moveSpeed`-driven and keep vanilla's movement value**: the squid drifts under its
  own code (`EntitySquid.java:127`) and the ghast steers by waypoint impulses of 0.1 every 2-6 ticks
  (`EntityGhast.java:37-46`), so no scalar describes either. The ghast's *box* is Beta's now; its motion
  is not.
- **A ridden mob's speed is not translated.** Beta copies the rider's own input into the mount, so a
  saddled pig travels at its *rider's* walking speed (0.46 here) rather than at its own 0.322. The
  `mount_pathing` multipliers keep vanilla's values, and how Bedrock splits rider input from mob speed
  is not checkable offline.
- **Health was left alone, deliberately.** Three values disagree with the era's: this pack's sheep is 8
  where `EntityLiving`'s default of 10 stood, its spider 16 and its zombie 22 where `EntityMob` sets 20.
  Boxes and speeds were the scope here; a health table is a separate gameplay decision.

## 12. One crafting interface: the custom table, and the workbench that has to stay on vanilla's tag

Decided and implemented: every recipe the pack registers serves the `beta_crafting` tag of
`bh:crafting_table` and nothing else. `crafting_table` is the tag the *vanilla* crafting table and the
player's 2x2 inventory grid both read (they cannot be separated — Bedrock wiki, `loot/recipes`), so a
recipe that carried both was two entries for one craft, which is what the duplicates were: the
crafting table registered three times, the jack-o'-lantern twice, and the any-log-to-oak-planks
conversion twice.

**The one exception is the crafting table itself.** `crafting_table_bh.json` keeps both tags, because
the 2x2 inventory grid is the only place a survival player can make their first workbench, and it is
the only recipe in the pack that serves that grid. Every other recipe is `beta_crafting` alone. If the
pack ever hands out a workbench some other way, that recipe can drop back to one tag.

Several recipes were also not overriding what they claimed to. A pack recipe replaces vanilla's only
when the identifier **and** the recipe type both match; otherwise it is registered beside it, which is
the same visible duplicate. Read from Mojang's sample behavior pack
(`github.com/Mojang/bedrock-samples`, `behavior_pack/recipes`):

- Vanilla's chest recipe id is `minecraft:Chest_recipeId`, not `minecraft:chest`, so the chest recipe
  left vanilla's chest craftable next to `bh:chest`.
- Vanilla's sign recipe id is `minecraft:sign_oak` and it pays three signs, so `bh:sign_oak` left the
  vanilla three-sign recipe in place.
- Vanilla's jack-o'-lantern recipe is *shaped* (carved pumpkin over a torch); the pack's was shapeless,
  so it registered beside vanilla's rather than replacing it. The pack's is now shaped to match, with
  its own ingredient (the carved pumpkin) and the era's yield.
- The bucket and cake recipes were named `bh:bucket` / `bh:cake` and now take vanilla's ids, matching
  the doors.

Recipes the era did not have are disabled the documented way — replacing the recipe with the same id
and type and setting its tags to `[""]` (Bedrock wiki, `loot/recipes`) — instead of the pack's old
grid of an unobtainable ingredient. That is `gold_nugget.json`, `iron_nugget.json`,
`cut_sandstone.json` (vanilla's `minecraft:smooth_sandstone` recipe, which pays cut sandstone) and the
two vanilla workbench ids.

Needs an in-game look, because recipe registration is engine-side:

- **Is exactly one entry shown per craft at the custom table?** The pack's own test can only prove one
  registration per craft and one interface per recipe; whether the recipe book renders it once is the
  game's answer.
- **Do the `[""]` disables actually take?** The wiki documents the empty tag as the way to disable a
  recipe that a lower pack already defined; each of those five files matches vanilla's id and type, so
  they should replace rather than add. If they do not, the nuggets and cut sandstone come back and need
  the older unobtainable-ingredient trick instead.
- **Are there more vanilla workbench ids than the two the pack knows?** Mojang's samples define
  `minecraft:WorkBench_recipeId`; `minecraft:WorkBench_recipeId_from_oak` appears in the `/recipe`
  command's unlockable list but has no sample file, and the samples show no per-species workbench
  recipes. If the engine does have more, each unoverridden one is another crafting-table entry in the
  2x2 grid.

Also deliberate: the pack's recipes are no longer available at a vanilla crafting table that survives
in an existing world, and the player's 2x2 grid now offers only the workbench. That is the point of a
single interface — the modern recipe set is not a second way to reach the era's items — but it does
change what an existing world can craft without the pack's table.

## Why this file exists

The failure mode these items share is the one worth guarding against: a rule was written down in one
file, the behaviour lived in another, and a test in a third asserted the rule rather than the
behaviour. Every case above was green in CI while the game did something else.
