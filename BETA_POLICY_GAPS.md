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

## 10. The era's unstackables are pack items now, except the bucket

Beta 1.7.3 capped a door, a sign, a bucket and a cake at one per slot inside the engine — `ItemDoor`,
`ItemSign`, `ItemBucket` and `ItemReed` each set their own stack size — so none of them could stack in
a chest either. They kept stacking anyway, because that limit only ever existed for the pack's own
items (whose item JSON the engine reads) while those four are vanilla items a pack cannot redeclare.
The inventory sweep split those stacks in a *player's* slots and nowhere else, which is why the report
read "doors stack in chests" next to "porkchops don't" — the porkchops are pack items and the doors
were not.

Decided and implemented: the crafted result is a pack item — `bh:wooden_door`, `bh:iron_door`,
`bh:oak_sign`, `bh:cake` — carrying `minecraft:max_stack_size` 1, which the engine applies everywhere,
so the chest half of the bug is fixed at the engine rather than by a sweep over other people's
containers. `BETA_CAPPED_ITEM_OF` retypes every held vanilla one onto its pack item, splitting a stack
as it converts, so the two ids cannot drift apart, and `packs/BP/items` now holds an item for every id
in that table (asserted by a test, because a capped id with no item JSON would be a pickup the sweep
throws away). The doors stay in the table even though the crafted item is the pack's: a `bh:` door is a
`minecraft:block_placer` for the era's vanilla block, so a broken door drops the vanilla item and this
retype is what keeps that drop at the era's one per slot.

The bucket is the one of the four the pack does **not** own. It was a pack item (`bh:bucket`, one per
slot, with `interactions/bucketUse.ts` filling from a still source and milking a cow by hand) and it is
not any more, because the item's *use* is a fluid: the engine's own bucket is what fills from a water or
lava source and pours it back, and no custom item can be given that behaviour. With the vanilla item
back, filling, pouring and milking a cow are all the engine's own — `packs/BP/entities/cow.json` answers
`bucket:0` with `bucket:1` the way vanilla always did — and the era's cap is the sweep's to keep
instead of an item JSON's: `BETA_CAPPED_VANILLA_IDS` holds `minecraft:bucket` and
`inventoryManager.ts` splits a stack of them one per slot, since modern empty buckets stack to sixteen.

What the pack gave up with it, and may want back later: the era refused a *flowing* source (metadata 0
was a still source; the engine takes either), and the scripted milk answered any cow it was pointed at.
Both were the reason the item existed, so the removal is the trade, not an oversight.

The placement rules the era applied are still enforced for the sign, which the engine cannot place for
the pack: a custom item's `minecraft:block_placer` writes one block, never a wall sign, so
`interactions/signPlacement.ts` writes the standing or the wall sign the way `ItemSign` did.

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
- **Do the era's other use blocks swallow a held sign the same way a door does?** The era asked the
  clicked block's own use first (`ItemInWorldManager.onItemUse`), so a chest, a furnace, a cake and a
  workbench answered the click before `ItemSign` was reached, and no sign went down against any of
  them. `BETA_USE_CONSUMING_BLOCK_IDS` holds the doors and the trapdoor, where the engine is known to
  consume the click; the others join it once the same consumption is seen in game.
- **Does a script-placed sign open the editor for the player who placed it?** Beta's `ItemSign` called
  `EntityPlayer.func_4048_a(sign)` on the newly written tile entity, so the editor opened with the
  placement. No script API opens it, so the pack's sign cannot reproduce that half; the editor is
  reached by clicking the sign afterwards instead. If the engine ever opens the editor for a
  script-written sign, the double-open that would cause needs checking.
- **Does the cake's `minecraft:block_placer` place on the faces `ItemReed` allowed?** Beta's cake went
  down on any face of a block, which is what the component has to reproduce; it is the one capped item
  whose placement is left entirely to the engine.
- **Whether the empty bucket the engine hands back after a pour is `minecraft:bucket` straight away.**
  It has to be, now that the id means the engine's own item; a pour that returned a momentary pack item
  would be a pickup the sweep no longer recognizes.
- **Whether the swept bucket stack survives the offhand.** A container can be split; the offhand slot
  cannot, and `sweepStrict` deletes what it cannot split, so an offhand stack of two buckets would lose
  both. The same hole is open for a door or a sign, and it needs a look before it is called a bug.

Smaller, and deliberate: the wooden door recipe takes the `minecraft:planks` tag, so six planks of
mixed species craft one door where Beta wanted a single species — the tag and the difference the chest
recipe already carries. The bucket and cake recipes keep vanilla's ids and the `beta_crafting` tag
alone, so the bucket they pay is the engine's own item and the cake pays three of them back the way
Beta's milk buckets came back.

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
Bedrock documents `minecraft:movement` only as "base movement speed", so the unit is an anchor that
only the game can settle: `WALKING_PLAYER_UNITS` in `tests/smoke/entityDimensions.test.ts` is that
number, it is 0.35, and every declared speed is `0.35 x moveSpeed`, apart from the wolf, which the
response overshoots (below).

A mob's engine speed is `movement x speed_multiplier` (Microsoft's intended reading; the interaction
itself is undocumented), so the multipliers that were discounting a stroll -- 0.8 on the pig, cow,
sheep, zombie, creeper and spider, and 1.25 on the creeper's and the skeleton's attacks -- were
flattened to 1, because Beta had a single speed for wandering and chasing alike. Two states keep a
multiplier because Beta genuinely had a second speed: `zombie_pigman.melee_attack` is 1.9
(`EntityPigZombie.java:19` raises `moveSpeed` to 0.95 while it has a target, against its own 0.5), and
the five `mount_pathing` multipliers were left exactly as they were -- the wolf's has since been
flattened for the reason below.

**The in-game look came back, and it moved the anchor.** 5.6 shipped 0.46, read off Bedrock's own
zombie (0.23) as the era's half-speed zombie, and the playtest read the roster as far too fast: a
creeper at 0.322 outran a walking player, and the only two mobs that felt right were the ones left on
vanilla's value. That assumption is the one part of this section the sources cannot check -- Beta's
`moveSpeed` shares are read straight out of the recovered client, but nothing documents what Bedrock's
value means physically -- so the unit is anchored on the pace the roster has to have instead: 0.35,
which puts the six 0.7-share mobs (pig, cow, sheep, chicken, skeleton, creeper) on 0.245, next to the
0.25 the vanilla animals walk at, keeps the era's ordering, and leaves the zombie and pigman at 0.175,
the spider at 0.28 and the wolf and slime at 0.35, the wolf since moved off it (below). Re-pacing is
that one constant plus the files it generates.

**The creeper is the datapoint to steer by, and it says the response is not proportional.** At 0.322 a
chasing creeper paced a *sprinting* player, where the era's 0.7 share is 3.0 blocks a second against a
walk of 4.317 -- so the engine reads that value as more than 0.7 of a walk, and more than proportional
to the zombie both anchors were read off. That curve is what no offline source measures, so 0.35 is an
anchoring guess and the shares furthest above the zombie -- spider 0.28, wolf and slime 0.35 -- are the
ones a second correction would have to move by more than the unit alone.

**The wolf's second correction landed on the wolf, not the unit.** Its `moveSpeed` is 1.1, the share
furthest above the zombie, and the playtest that moved the anchor still read it as too fast. Two things
were stacking under it. `mount_pathing` -- priority 1 with `track_target: true`, which is the goal that
drives a wolf's pursuit -- carried vanilla's 1.25
(`VanillaBehaviorPack/entities/wolf.json`), so the mob already at the top of the curve was the one mob
whose value a multiplier ran above itself; that is 1.0 now, which leaves the wolf the single pace the
era gave it, since its `random_stroll`, `melee_attack` and `follow_owner` goals were all 1.0 already.
The declared value then moved off the anchor as well, because a value above the 0.7-share tier is what
the response overshoots: reading the creeper datapoint against the 0.7 shares' 3.0 blocks a second puts
the walking stride at 0.326 with that creeper's own 1.25 attack multiplier in play and 0.287 without
it. The wolf is 0.3 -- inside both readings, Bedrock's own value for the mob, still the roster's top
and still above the spider's 0.8 share. The slime's 1.0 share is in the same tier and is untouched; if
it reads fast too, it takes the same treatment.

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
  saddled pig travels at its *rider's* walking speed (0.35 here) rather than at its own 0.245. The four
  remaining `mount_pathing` multipliers keep vanilla's values (the wolf's is 1.0), and how Bedrock
  splits rider input from mob speed is not checkable offline.
- **Health was left alone, deliberately.** Three values disagree with the era's: this pack's sheep is 8
  where `EntityLiving`'s default of 10 stood, its spider 16 and its zombie 22 where `EntityMob` sets 20.
  Boxes and speeds were the scope here; a health table is a separate gameplay decision.

## 12. One crafting interface: the custom table, and the workbench that has to stay on vanilla's tag

Decided and implemented: every recipe the pack registers serves the `beta_crafting` tag of
`bh:crafting_table`, apart from the two that also serve the player's 2x2 inventory grid (below).
`crafting_table` is the tag the *vanilla* crafting table and the player's 2x2 inventory grid both read
(they cannot be separated — Bedrock wiki, `loot/recipes`). Several crafts had been registered by more
than one file, and 5.6 collapsed each onto one: the crafting table was registered by three files, the
jack-o'-lantern by two, and the log-to-planks craft by two.

**Five recipes keep both tags: the crafts Beta 1.7.3 could make in the player's 2x2 grid.**
`crafting_table_bh.json` is the only place a survival player can make their first workbench, and
`logs_to_oak.json` is the only way to get the planks that workbench costs, so those two are the
bootstrap and the pack cannot lose either: collapsing the planks craft onto `beta_crafting` alone made
the pair a deadlock, planks needing the table and the table needing four planks. `lit_pumpkin.json`,
`sandstone.json` and `furnace_minecart.json` join them because Beta's own patterns fit a 2x2 square —
`A`/`B`, `##`/`##`, `A`/`B` (`CraftingManager.java` in the recovered client) — and 5.6 took all three
out of the inventory, deleting the jack-o'-lantern's grid recipe and narrowing the other two with the
rest of the table's. All five keep `beta_crafting` as well, so they are still the pack's recipes at the
pack's table, and a test checks that each one's shape really fits 2x2. Every other recipe is
`beta_crafting` alone.

The rest of Beta's 2x2 crafts are still table-only, which predates 5.6 and is a separate decision, not a
bug: sticks, torches, the snow/clay/brick/glowstone blocks, sugar, wool from string and the sixteen wool
dye baths, the flower and bone-meal dyes and the dye mixes, flint and steel, the lever, the redstone
torch, the stone and wooden pressure plates, the button, the sticky piston and the chest minecart —
whose vanilla grid recipe wants a `minecraft:chest` the sweep has already retyped onto `bh:chest`, so
the grid cannot make one at all. Beta served both grids from one `CraftingManager`, so every one of
these was an inventory craft there. Restoring them means deciding what the pack's grid is for.

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
  the doors. The bucket recipe pays `minecraft:bucket`, the engine's own item, since the pack's copy of
  it is gone; the cake's milk ingredient was the legacy `{"item": "minecraft:bucket", "data": 1}` and is
  now `minecraft:milk_bucket`, which is what the engine's bucket draws from a cow.

Recipes the era did not have are disabled the documented way — replacing the recipe with the same id
and type and setting its tags to `[""]` (Bedrock wiki, `loot/recipes`) — instead of the pack's old
grid of an unobtainable ingredient. That is `gold_nugget.json`, `iron_nugget.json`,
`cut_sandstone.json` (vanilla's `minecraft:smooth_sandstone` recipe, which pays cut sandstone) and the
two vanilla workbench ids.

Needs an in-game look, because recipe registration is engine-side:

- **Is exactly one entry shown per craft at the custom table?** The pack's own test can only prove one
  registration per craft and one interface per recipe; whether the recipe book renders it once is the
  game's answer. The two recipes that carry both tags put the question at the pack's table as well —
  the workbench and the log-to-planks craft are each shared with the 2x2 grid — so a second entry in
  the recipe book there would be visible twice over.
- **Do the `[""]` disables actually take?** The wiki documents the empty tag as the way to disable a
  recipe that a lower pack already defined; each of those five files matches vanilla's id and type, so
  they should replace rather than add. If they do not, the nuggets and cut sandstone come back and need
  the older unobtainable-ingredient trick instead.
- **Are there more vanilla workbench ids than the two the pack knows?** Mojang's samples define
  `minecraft:WorkBench_recipeId`; `minecraft:WorkBench_recipeId_from_oak` appears in the `/recipe`
  command's unlockable list but has no sample file, and the samples show no per-species workbench
  recipes. If the engine does have more, each unoverridden one is another crafting-table entry in the
  2x2 grid.

Also deliberate: no pack recipe except those five is available at a vanilla crafting table that
survives in an existing world, and the player's 2x2 grid offers only them. That is the point of a
single interface — the modern recipe set is not a second way to reach the era's items — but it does
change what an existing world can craft without the pack's table.

## 13. Resolved: sugar cane is `minecraft:reeds`, never `minecraft:sugar_cane`

Both tables registered the era's sugar cane as `minecraft:sugar_cane`, which is not the id the game
uses. Bedrock's block is `minecraft:reeds` (its only state is `age`), the era's item is `minecraft:reeds`
— Mojang's own `sugar.json` and `paper.json` recipes still name it — and `minecraft:sugar_cane` is a
second, later item id for the same plant. The mismatch was invisible where it was most expensive:
`resolveDropId("minecraft:reeds")` answered *remove*, so a broken cane was deleted at `entityLoad` (the
chunk-loading pass, which is why the cane vanished as a player walked up to it), the drop entity was
deleted again by the cleaner's 32-block sweep, and the inventory sweep reported the era's own item as
nonexistent. Only the block path was masked, by a hand-written `"minecraft:reeds"` entry in the
scrubber's exclude list.

`minecraft:reeds` now sits in both `BETA_ITEM_IDS` and `BETA_BLOCK_IDS`, the scrubber's duplicate entry
is gone so the registry owns the fact, and `normalizer.ITEM_ID_ALIASES` folds `minecraft:sugar_cane`
back onto it rather than deleting a stack that carries the newer id.

**Same shape, still open:** the scrubber's exclude list is a hand-maintained table of Bedrock's legacy
spellings for blocks the registry names the Java way — `deadbush`, `web`, `mob_spawner`,
`unpowered_repeater`/`powered_repeater`, `stone_block_slab`, `brick_block`. Only the block pass is
covered by it; the item side of those ids (a picked-up cobweb, say) falls through `normalizeItem` to
*remove*. Deciding this means either registering the Bedrock spellings beside the Java ones, or
accepting the deletions and deleting the scrubber's list with them.

## 14. Resolved: both ground passes run one policy

`entitySpawnHandler.sanitizeWorldEntity` is now the only implementation of "what does this ground
entity become". `entityCleaner` calls it instead of resolving the same ids a second way, which is the
rule `docs/agents/subsystems/mobs.md` already stated — the sweep had drifted from it in two places,
both visible only by driving one id through both passes:

- The sweep respawned a retyped stack whole, so a `minecraft:porkchop` stack of four became one
  `bh:porkchop` entity holding four. The engine clamps a stack to the item's `maxStackSize` as it is
  built, and the sweep removes the old entity before the new one exists, so three porkchops were
destroyed. It now splits through the same `spawnStackedDrop` the spawn pass uses.
- The sweep kept a raw ore stack's size where the spawn pass collapsed it to the era's one ore per
drop. `ORE_DROP_AMOUNT` names that rule in the one module, so both passes read it.

The leaf-origin rule is deliberately **not** shared. `SWEEP_SANITIZATION` runs the policy without the
apple-and-stick attribution, because that question belongs to the pass that saw the break: answering
it in the sweep would attribute a drop to a break up to five seconds old and pay a 5x5x5 block scan
per candidate in a pass that already runs every hundred ticks.

Still open, and cheap to change but not free: an already-final ground stack that exceeds the era's cap
(a `bh:porkchop` entity holding two) is left alone by both passes, while the inventory sweep splits
it. Reaching those means reading `maxAmount` for every item entity in the sweep, which is an
`ItemStack` allocation per entity per pass; the case can only reach the ground from a legacy save,
since the sweep splits before it drops anything.

Also still open: the raw-ore clamp discards the surplus of a stack that arrived from a chest or an old
save, since it reads a raw ore drop as one mined block. If the era's one-ore-per-block reading is
ever dropped, delete `ORE_DROP_AMOUNT` so the amount rides across — do not change one caller.

## 15. The shadow swap cannot be had without aggro invisibility, so the player keeps Bedrock's own

The 5.6 blob shadows take the wiki's only reliable route to a shadowless entity: a permanent
invisibility effect, which is what stops the engine drawing its own decal, plus
`minecraft:renders_when_invisible`. The pack added a third component to every mob,
`minecraft:is_hidden_when_invisible`, and that is the one with a price. Mojang documents it as "The
entity can hide from hostile mobs while invisible" -- the pair vanilla's wandering trader drinks at
night -- and `nearest_attackable_target` carries a `target_invisible_multiplier` (0.7, multiplied by
the target's armor coverage), so the effect alone already costs an invisible target most of a mob's
range.

On the player that meant hostile mobs never acquired the target they exist for: `zombie`, `skeleton`,
`creeper`, `spider`, `slime` and `ghast` all name family `player` in a `nearest_attackable_target`, and
an always-invisible player answered that filter with "no" for as long as the player lived. It read as a
targeting bug rather than a rendering one because retaliation is a sight-free path: hitting a mob still
worked, and so did standing close enough to be hit by its swing.

**Decided:** the player carries none of the three components and binds no decal, so Bedrock draws its
own shadow under players again. A world that already ran 5.6.1 has the effect applied to its players,
and it does not lapse: the migration wrote twenty million ticks, so `entityMigration` now strips the
invisibility back off any Beta mob whose definition no longer declares the component it was installed
under. Nothing else in the era grants invisibility, so the absence of that component is an exact
marker for the pack's own leftover. The swap, the decal binding and the gate that hid the local player's own
decal are gone; `entity_shadow_player.json` stays in the pack, unreferenced, as the decal a safe swap
would bind again. The two `betarock:shadow_*` properties stay declared on the player, because the
migration repairs a missing property by writing it and an entity whose definition does not declare one
leaves `resetProperty` throwing on every pass that sees it -- a declarative roster for the property
rules is the better fix if anyone wants the pair gone.

**Still open, and now load-bearing for the rest of the roster:**

- Every other Beta mob keeps the swap, so an invisible mob is equally invisible to hostile mob AI.
  `wolf.json` hunts `is_family sheep` and `is_family skeleton` with `must_see` true, which means wolves
  cannot hunt sheep or fight skeletons today: the same bug the player just had, one mob removed.
- There is no per-entity shadow control to put in the swap's place. The wiki's other routes are a tiny
  `minecraft:collision_box` (which `entityDimensions.test.ts` pins at the era's sizes), a
  `shadow_overlay` material the same page marks dead after RenderDragon, and a `banner_pole` model that
  no source anywhere documents beyond the one sentence naming it.
- `minecraft:behavior.hurt_by_target` is back on the zombie, which had lost it in the 4.0 rewrite while
  every other hostile kept it. Without it a zombie could only ever attack on sight, so the retaliation
  the era's mobs do have was missing from the one mob a player meets first.

## 16. A dead player is locked in place, not merely parked in spectator

The death design's §3.3 asserts the dead state on a slow pass, and the set it lists includes locking the
input categories (`Movement`, `LateralMovement`, `Jump`, `Sneak` and the four directions) so a
`/gamemode` command, a respawn path or another addon cannot leave a dead player walking around an empty
corpse. The first cut asserted the game mode and nothing else: on Bedrock a spectator already flies,
cannot be attacked and cannot use a block, so the lock waited on evidence that a dead player could still
act — a throwaway probe's spectate phase, and both the probe and its `!test` entry point have since
been removed.

The maintainer directed the lock back in before that measurement was read, so the code now asserts both
halves and `SPECTATE_VELOCITY … movingWhileSpectator=` is no longer gating anything.

Both halves are re-asserted together every two ticks, and each write is skipped when the player is
already in the wanted state — the pass runs for the whole length of a death, so a blind write would be
eight networked permission updates per dead player per pass. `Camera`, `Mount` and `Dismount` stay
enabled. `Camera` is deliberate: the era's death screen still let the player look around, and taking the
camera away reads as a hung game rather than a death. `deathSystem.test.ts` pins the camera rather than
leaving it as an omission someone can tighten by accident.

`respawnPlayer` is the only place the lock is released, and it releases before it restores the game mode:
an alive player left frozen is the one outcome worse than a dead one that could still walk.

The pass is also the screen's retry window: the death itself shows the form, and a dismissed or relogged
one comes back inside two ticks, so Escape does not read as an escape from a death.

Still open: whether the lock survives the spectator transition the way `setGameMode` does, and whether a
player who relogs mid-death is locked again before they can move. The pass re-asserts every two ticks,
which is what makes a refusal survivable rather than fatal.

## 17. The death drop scatters, where the era piled every stack on the corpse

Beta 1.7.3 spawned each dropped stack at the player's own position with a random throw of up to 0.5
blocks/tick, so a full inventory landed in a lump half a block across with the later stacks buried under
the first. `player/death.ts` keeps the era's throw unchanged — the 0.5 max horizontal speed and the
fixed +0.2 upward kick from the chest-height spawn point — and scatters the *spawn point* over the two
blocks around the player instead. The radius is drawn as `sqrt(random) * 2`, because a uniformly drawn
radius would oversample the inner rings and put most of the inventory back in the middle.

The spawn height is the era's own `posY - 0.3 + getEyeHeight()` (`EntityPlayer.java:257`), and not the
1.32 the design's §2.2 annotation reads it as. For a player `posY` is the eye (`yOffset` 1.62,
`EntityPlayer.java:44`) and `getEyeHeight()` answers 0.12F, so the spawn sits 0.18 below the eye — 1.44
above the feet Bedrock measures a player from. §11 already records that 0.12 answer; the design's
"eye height 1.62 → posY + 1.32" line converted `posY` as though it were the feet. `player/death.ts`
names the number `DROP_SPAWN_HEIGHT`, and `deathSystem.test.ts` pins it.

Decided by the maintainer, not derived from the recovered client: nothing in the era scatters this way.
The divergence is the spawn offset alone, which is why it is one named constant
(`DROP_SCATTER_RADIUS`) rather than a change to the throw math. `deathSystem.test.ts` asserts both
halves of that: every stack lands inside the radius, and the stacks do not share a single point.

## 18. The death screen is a rebuild of the era's screen, with three values the engine decides

The death design's §2.1 pinned the recovered client's copy verbatim — `Game over!` over `Score: &e0`,
and explicitly **not** `You Died!`, which is the modern Java wording. A first pass had replaced it with
the maintainer's own copy (a placeholder title over a `You Died` line), and this item recorded that
divergence. The JSON UI redesign below put the era's copy back, so `player/deathScreen.ts` and the
design table agree again and the divergence is closed.

The design had also declared the screen's *presentation* out of scope — §299 read "No JSON-UI or form
styling". That is no longer true. `ui/server_form.json` repoints the engine's form screen at
`ui/.bfui/death_screen.json`, which reproduces `GuiGameOver.drawScreen`: the era's gradient rectangle,
the header at its doubled scale, the unscaled score row, and `GuiButton`'s 200x20 metrics including
1.7.3's blue hover state.

`tests/smoke/deathScreenUi.test.ts` pins those numbers against the recovered client rather than against
the UI file, so a drift from the era has to change a literal in the test as well. The same test pins
that the era's quarter-height offset is a percentage offset plus a fixed spacer, and that no asymmetric
anchor pair survives anywhere in the tree.

The UI ground truth is on this machine after all. `game-versions/<version>/assets/assets/resource_packs/
vanilla/__brarchive/ui.brarchive` is a `__brarchive` container, but it is *searchable*: plaintext JSON with
a binary prologue, so `grep -a` and a byte-offset read recover any control verbatim. That is where every
engine fact in this section was confirmed - `common.base_screen`, `common.screen_panel`,
`common.screen_background`, `server_form.*` and the `$screen_*` variables. `Mojang/bedrock-samples` on
GitHub is the fallback when the installed version predates an installed pack.

What the archive settles about this screen:

- `common.base_screen` declares `$screen_content`, `$additional_screen_content`, `$screen_bg_content`,
  `$screen_animations` (eight entrance/exit push/pop and fade animations), `$background_animations`
  (four alpha fades) and `$use_loading_bars`, and its children mount the background as
  `bg_no_safezone_screen_panel@$screen_bg_content` (layer 2), the content inside the safezone stack
  matrices as `root_screen_panel@$screen_content` within `common.screen_panel` (`["100%", "fill"]`),
  and `common_dialogs.full_screen_background` at layer -1 - which draws nothing unless
  `$is_full_screen_layout`, so no engine dim sits under this form's wash.
- Vanilla's `third_party_server_screen` sets the content, Esc (`button.menu_cancel` ->
  `button.menu_exit`) and the animation lists. Redefining a screen *replaces* vanilla's copy rather than
  merging with it, so all four are restated in the pack's copy.
- `common.screen_background` - the dim every vanilla screen uses - is an image with **no size**, and the
  background slot is where it is mounted. The slot's control is the screen's rect (it is mounted outside
  the safezone stack), and that is why the death wash is served from there too.
- The rect is not the whole story: **an image does not fill the control it is given**. The engine's
  `keep_ratio` is on by default and *fits* the sprite inside its rect, centred, so a 16x512 wash draws as
  a 16-px-wide band down the middle of the screen. That was read back off a screenshot of the running
  pack rather than off the JSON: the band measures 49 device px wide by the full 1542 of height, which is
  exactly 16:512 fitted to the screen height, and the era's 200x20 buttons measure ~1000x100 device px in
  the same shot, fixing the UI scale at 5. The wash therefore declares its stretch - a full-screen size
  with `keep_ratio: false` and `fill: true`, the pair the engine's own UI uses wherever it stretches a
  sprite. An earlier revision of this item blamed the size on percentages resolving against a parent that
  never resolved; the band's aspect is what disproves that, and the fix is in `ui/.bfui/death_screen.json`.
  Unverified in game after the change, since the reading above is of the broken state.
- An `ActionFormData` body reaches a *replaced* `long_form` unreliably. The engine's own body label binds
  `#form_text`, but a label draws the value its `property_bag` declares when the binding that would fill
  it never runs, so the score row carries the era's line as that declared default and the test pins it to
  `DEATH_SCREEN_COPY.body`. The two are one string, so the row prints the era's copy either way.

### The JSON UI anchor pair runs the other way round

`.agents/mcbe-json-ui`'s property table documents `anchor_from` as the anchor on the *child* and
`anchor_to` as the anchor on the *parent*. In this engine build they resolve the opposite way:
`anchor_to` names the point on the child and `anchor_from` the point on the parent. Two in-game looks
pinned it. `[0, 72]` under a matching `top_middle` pair lands the control's top 72px below the screen
top, which either reading predicts; the same offset with `anchor_to: bottom_middle` lands the stack's
*bottom* 72px below the top, which only the reversed reading predicts — the documented one would put it
at `height / 4 + 72`, three times further down the screen. The death screen was written on the
documented reading and the buttons landed on the header. It now uses no asymmetric pair at all, and
`deathScreenUi.test.ts` rejects one anywhere in the tree.

The gradient's orientation used to rest on reading the in-game wash, but that reading was taken through
the difference blend below, so it was not evidence of anything. It is settled by construction now: the
texture's first row is the darker `0x60500000`, which is the top of the screen, as
`Gui.drawGradientRect` reads it.

### The pack's crosshair owns the engine's gradient-fill material

`materials/ui.material` redefines the engine's own `ui_fill_gradient:ui_base` with Java's crosshair blend
(`blendSrc: OneMinusDestColor`, `blendDst: OneMinusSrcColor`) — `GuiIngame`'s `glBlendFunc(775, 769)`.
The pack draws its crosshair through `gradient_renderer`, and that is the only flat-colour fill JSON UI
offers, so the material had to become a difference blend to keep the crosshair era-correct. Vanilla's
own `ui_fill_gradient` sets no blend at all, so this is the pack's deviation rather than the engine's
default.

The consequence is that `gradient_renderer` cannot draw a translucent wash: a red gradient drawn there
came out as a filter over the world, brighter than the era's overlay. The death screen's gradient is
therefore baked into `textures/ui/death_gradient.png` — the era's two ARGB literals interpolated down the
image, which `deathScreenUi.test.ts` decodes and checks row by row — and drawn as an `image`, which takes
the ordinary alpha path.

### The era's HUD is redrawn on the death screen, under the wash

`GuiGameOver` overrides `doesGuiPauseGame()` to false, so the world keeps rendering behind it, and
`EntityRenderer` goes on calling `renderGameOverlay`. That method draws the hotbar and its selection
frame and the crosshair *unconditionally*, and the hearts under `playerController.shouldDrawHUD()` - so
Beta's death screen has the era's HUD behind it: empty slots (the inventory has just been dropped), ten
empty heart containers (health is 0), the selection frame at the current slot, and the crosshair over a
live world.

This pack shows none of that. The dead state parks the player in `GameMode.Spectator`, and spectator is
what hides Bedrock's HUD - the park that makes a corpse unable to walk also erases the HUD the era left
visible. The screen therefore redraws the era's HUD itself, from `textures/gui/gui.png` and
`textures/gui/icons.png`, which the pack already carries and which are faithful conversions of the
recovered client's own sheets (crop for crop, pixel for pixel - `deathScreenUi.test.ts` reads them back
against it): the hotbar bar, the 24x22 selection frame, ten empty containers and the three fills that
make up the crosshair, on the era's own coordinates. Nothing in it is bound to the world, which the era's
own state allows: the inventory has just been dropped and the health is rolled back.

Both sheets are drawn as `uv`/`uv_size` crops, and `uv_size` has no default: a control that sets only a
`uv` start draws its *whole* texture into its box. The first in-game pass came back with both atlases on
screen at once - every sprite in `gui.png` and `icons.png` squeezed into the era's own 182x22 and 9x9
rects. `deathScreenUi.test.ts` now pins each drawn crop to the crop it verifies against the era's sheet,
so the two cannot drift apart.

The era's paint order is world, HUD, gradient, then text - the wash goes *over* the HUD and tints it -
which is why the HUD and the wash are mounted together in the background slot with the wash second, and
the two text rows and the buttons stay in the content above them. That slot is also the one rect this
screen resolves outside the content's safezone inset (`bg_no_safezone_screen_panel@$screen_bg_content`).
An earlier revision mounted the HUD in the content and the wash in the slot, which left the HUD under the
wash's own layer and crisp rather than tinted - visible in game as a red band crossing a clean hotbar.

The hearts shake. `renderGameOverlay` adds `this.rand.nextInt(2)` to each slot's y while health is at or
below 4 - a 1px drop, per slot, every tick, out of an RNG it reseeds from the tick counter - and the dead
player's health is 0, so that condition holds for as long as the screen is up. The pattern itself is not
something a UI animation can replay, so the skin reproduces its shape instead: three self-looping
`offset` animations that drop 1px on staggered periods (0.05, 0.065 and 0.08s, against the era's one roll
per 0.05s tick), with the ten slots dealt one of the three by index so they drift rather than bounce as a
row. Each slot is a panel carrying the era's x, with the container sprite inside it carrying the jitter,
because an `offset` animation writes the whole offset. `deathScreenUi.test.ts` pins the direction (the
era only ever adds to y), the loop and the stagger.

One thing in it is deliberately not the era's:

- The selection frame sits on slot 0. `renderGameOverlay` read `currentItem` from the player, and nothing
  in a form screen binds it.

One reading about the live HUD, unverified in game and outside this screen: `hud_screen.json`'s
`crosshair_pixel` template is `ignored: true` and the three fills that instance it do not un-ignore it, so
the crosshair a player sees may be the engine's rather than the pack's. That is the same shape of gap as
the rest of this file - behaviour living in one file, the claim in another.

Still open, and engine-dependent rather than decidable from the source:

- The pack's pause background is the same shape the wash was: an unsized image
  (`textures/ui/Black`, a 2x2 texture) served from `$screen_bg_content`. If `keep_ratio` fits that one too
  it is a centred square rather than a full-screen dim, but nothing to hand settles it - the screenshots
  on this machine are all of the death screen - so it needs one look at the pause menu. The fix, if it is
  one, is the three properties the wash now carries.

- Whether a bound `#form_text` honours a `\n`. The redesign retired the question: the screen's two rows
  are separate controls, and the era's body carries no newline.
- Beta's `initGui` disables the second button when `mc.session == null`. The skin ships the era's
  disabled texture and colour but can never reach that state, because a Bedrock form has no session to
  read.
- The window a player is on decides how the era's fixed offsets read: Beta places the two text rows at
  fixed y (60 and 100) while the buttons scale with the height, so a small window pushes the text
  proportionally further down. The skin uses the era's numbers as written, which is Beta on a large
  window.

## 19. The vetoed lethal hit takes the era's death feedback with it

`EntityLiving.attackEntityFrom` plays `getHurtSound()` on a survivable hit and `getDeathSound()` when the
hit kills, and the player inherits `random.hurt` for both
(`reference-docs/beta-1.7.3/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityLiving.java:354-359`,
`getDeathSound` at `:388`). Cancelling the lethal hit in the before-event therefore suppresses the sound
the player would have heard at the moment of death: the death never happens, so neither branch runs, and
with it goes the hurt flash and the death's own feedback.

`player/death.ts` plays it by hand instead — `random.hurt`, the volume 1 the era used, and the era's own
`(rand - rand) * 0.2 + 1` pitch jitter — through `Dimension.playSound`, which is the era's
`playSoundAtEntity`: the sound is broadcast at the corpse rather than played privately, so witnesses hear
the death too. It is called from the deferred call the veto schedules, not from the veto itself, because
`playSound` is restricted-execution like the rest of the park; the engine runs that call at the end of
the same tick, so the sound is not late by an audible amount. That delay is the one thing here the era
did not have, and it is unavoidable: nothing that produces a sound, a mode change or an item spawn can
be called from inside the before-event.

### The era's death camera is two effects, and only the zoom is reproducible

Both live in `EntityRenderer`, both keyed on `renderViewEntity.health <= 0`, both driven by `deathTime` in
ticks:

- a Z-roll of the whole view, `glRotatef(40 - 8000 / (t + 200), 0, 0, 1)` (`:152-158`) — 3.6° after one
  second, 20° after ten, easing towards 40°;
- a field of view that narrows, `70 / ((1 - 500 / (t + 500)) * 2 + 1)` (`:137-150`) — 65° after one
  second, 44.5° after ten, easing towards 70/3 ≈ 23.3°.

`GuiGameOver.doesGuiPauseGame()` is false, so the tick loop never stops and both easings keep running for
as long as the screen is up: the effect is a slow roll and zoom, not a snap at the moment of death.
`preparePlayerToSpawn` resets `deathTime` (`EntityPlayer.java:155`), so a respawn clears both.

`assertDeathFov` reproduces the second one on the `deathState` pass from the era's own formula, with `t`
the ticks since the death began and a half-degree deadband so the curve steps rather than streaming a
camera update every pass. It is closed out by `camera.clear()` on respawn, which is also where a relog
starts the curve over instead of resuming it.

Still open:

- **The roll cannot be reproduced.** No Bedrock API takes a camera roll: `CameraSetRotOptions.rotation` is
  a `Vector2` of pitch and yaw, no camera preset carries a roll field, and `addShake` with
  `CameraShakeType.Rotational` oscillates rather than holding a tilt. The half of the effect a player
  actually notices is therefore still missing, which makes the zoom on its own a calmer version of it.
- **The base is imposed, not scaled.** `Camera.setFov` takes an absolute FOV and the module exposes no
  getter, so the death puts the era's 70° on the view whatever the player has set for themselves. Beta had
  no FOV setting, so 70 is the era's own number rather than an override of one — but a Bedrock player who
  moved theirs will see it move, and whether `clear()` gives theirs back is an in-game question.
- **The era's underwater base is not reproduced.** It is 60° inside water material, not 70
  (`EntityRenderer.java:141-143`). `isInWater` is not `isInsideOfMaterial(Material.water)` and where it
  triggers is unverified, so a drowning death narrows from 70 rather than 60.
- **Whether the zoom is visible behind the screen at all** is unverified. The death screen is a server form
  drawn over the world, and no offline test can say whether an FOV set while one is open is honoured.

### A respawn hands the view back forward, the way the era built the player

The era does not carry a corpse's camera over a respawn: `EntityPlayer`'s constructor places every player
at the spawn through `setLocationAndAngles(x + 0.5, y + 1, z + 0.5, 0.0F, 0.0F)`
(`EntityPlayer.java:45-46`), and `Minecraft.respawn` builds a *fresh* player on every respawn
(`Minecraft.java:1456`), so the bed branch overwrites the same pair with the same zeros (`:1465`) and the
world-spawn branch simply keeps them. A respawned player therefore faces yaw 0 — south — with a level
view, and `preparePlayerToSpawn` zeroes motion and pitch on the way (`Entity.java:143-145`).

`respawnPlayer` sets that pair twice, deliberately: once as the `rotation` of the teleport, so the facing
moves with the position as it did in the era's single call, and once through `setRotation`, because a
player's camera is the client's and which of the two it follows is unverified. Without either, a respawned
player keeps whatever the death camera left them looking at, which reads as a corpse's view.

Still open: which of the two levers actually turns a player's view, and whether `getSpawnPoint()` already
carries the era's `+0.5 / +1 / +0.5` block offset or wants it added — the teleport uses its coordinates as
given.

## 20. Every player move is announced by the engine, and one helper mutes it

Bedrock tells the player it just moved. The string is command feedback — `commands.tp.successVictim`,
"You have been teleported to %1$s" (`resource_packs/vanilla/texts/en_US.lang` in the installed client) — and
the script API inherits the announcement: `TeleportOptions` carries no flag for it, and `tryTeleport` is not
a silent variant either. The pack's three move sites are the death respawn, the End boundary bounce and the
voided-player confine, and all three went through `player.teleport()` with the message still arriving.

**Settled in game:** with `sendcommandfeedback` set to `false` by hand, the report stops. The gamerule is
the lever, and the engine does route its own teleport announcement through the command-feedback check.

`core/quietTeleport.ts` is the one place that answers it, so the message cannot return at a single call
site: it mutes `world.gameRules.sendCommandFeedback` across the move, restoring only what it turned off. The
deadline is extended rather than replaced when a second move lands inside the window — the last move out
puts feedback back — and a world that arrives with `sendcommandfeedback` already `false` is left alone:
writing `true` over it would be a worse trade than the message, since every command in the world would start
reporting again.

**The window is not the variable, and the 200-tick one is not the answer.** A first version held the mute two
ticks and the message still arrived, which the note here read as "too short": it was widened to 20 ticks,
and the message arrives under that window too, on the respawn, in game. A full second of mute across the move
therefore silences nothing, so "too short" was wrong twice over — the other half of that reading, "the mute
itself confirmed applied", rested on the content log carrying no `[Scripting][warning]` from
`quietTeleport`, which shows the setter did not throw and says nothing about the engine's rule.

**Read in game at a ten-second window, the mute was on and the announcement came anyway.** The probes
bracket the write, the call and the restore, and they report the API's own view on each line: `mute on`
`rule=false` — the value the setter left behind, read back in the same call — `called` `rule=false`, and
`mute off` `rule=false` two hundred ticks later, so the mute held for the window's whole length. Inside it
the engine sent both halves of the announcement, `commands.tp.successVictim` ("You have been teleported to
3.02, 100.00, 499.71") and `commands.tp.success` ("Teleported cen0b to …"), the pair a player who runs `/tp`
on themselves sees. So the script's rule reads off across the move and the move is announced regardless,
which leaves the write's reach and the write's timing, and they want different fixes:

- **The write lands after the tick that makes it.** Then every version so far has missed by one tick — 2, 20
  and 200 ticks all write the rule and issue the move in the same tick, which is the one tick the write
  cannot cover, and lengthening a window that opens too late changes nothing. The fix is a mute that leads
  the move: rule off, move on the next tick.
- **The write never reaches the engine's rule.** Then the mute is a no-op in every window. The only setting
  path confirmed in game is the command — `/gamerule sendcommandfeedback false` typed by hand — which both
  sets the rule and broadcasts it to clients, where the script setter only writes the API's own value. A
  script-driven `runCommand` of that same gamerule is the next lever if leading the move does not silence it.

Command feedback is the lever either way: with the rule off by hand the report stops, so the engine does
route its own teleport line through the check once the check is genuinely off. What is unverified is whether
the script's write makes it off anywhere the announcement is decided.

Also worth knowing before reading the move sites: the confine path is unreachable today — `island.ts` acts
only on players tagged `voided`, and nothing in the pack sets that tag — so in practice the report can only
come from the respawn and the End bounce.

What is still open:

- **Which of the two survives.** The build in the tree now mutes and then issues the move on the next tick,
  leaving the window at 20 ticks and keeping the probes, so one respawn separates them: silent means the
  write was a tick late and the helper keeps the leading mute; announced again means the write does not
  reach the announcement's check at all, and the mute has to go through the command path. Nothing in the
  pack should be changed on a guess here: the window has already been tuned once against a reading that did
  not hold.
- **The mute is world-wide for its window.** Another player running a command inside those 20 ticks gets no
  feedback for it. `sendCommandFeedback` has no per-player form, and the window is a compromise between
  covering the placement and holding the rule off for as little time as possible.

## 21. The corpse flops, puffs, and then does not leave

Beta's death has three parts and only two of them can be copied. `RenderLiving.rotateCorpse` turns a dead
entity up to `getDeathMaxRotation` degrees about Z on a `sqrt(((deathTime + partialTicks - 1) / 20) * 1.6)`
curve - 90 for a player, which `RenderPlayer` does not override for a dead one
(`RenderLiving.java:120-132`) - so the body falls onto its side over about 0.7s. On the tick `deathTime`
passes 20 the entity is deleted and twenty `explode` particles are scattered through its box
(`EntityLiving.java:152-167`).

Bedrock ships no player death animation at all, so the curve is authored into the pack:
`animation.player.death_flop` in `packs/RP/animations/`, a frame per tick on the entity's `root` bone - the
one bone whose pivot is `[0, 0, 0]`, the origin the era's `glRotatef` turned the corpse about - played from
`enterDeathState` through `Entity.playAnimation`, with the aliases `player.entity.json` declares the way its
own `place_swing` is declared. The puff is the same twenty particles at `deathTime` 21: `minecraft:explode`
is not a spawnable Bedrock identifier, so `minecraft:basic_smoke_particle` stands in for Java's particle.

Two divergences, both forced by a player being a live entity rather than a deleted one:

- **The body stays.** The era deletes the corpse as it puffs, so there is nothing left lying there. A player
  cannot be removed and respawned, so the flop holds its last frame and `respawnPlayer` plays
  `animation.player.death_flop_reset` to stand the body back up.
- **The puff fills the standing box.** The era reads the entity's box at the puff, and its client player has
  already shrunk to 0.2 by then (`EntityPlayer.onDeath`). That is smaller than the corpse the puff is
  marking, so this scatters through the era's standing 0.6 x 1.8 player box instead.

What is still open:

- **Whether a script can animate a player at all in practice.** `playAnimation` is documented on `Entity`,
  inherited by `Player`, and processed client-side, so a call that returns proves nothing by itself; one
  in-game death decides it.
- **Whether that flop is visible.** The death state holds the player in Spectator on purpose, which hides
  Bedrock's HUD, and vanilla's spectator render controller draws only a translucent head - so the body the
  animation turns is not the body on screen. Leaving the death state alone was the explicit choice here;
  making the corpse visible is a separate change.

## Why this file exists

The failure mode these items share is the one worth guarding against: a rule was written down in one
file, the behaviour lived in another, and a test in a third asserted the rule rather than the
behaviour. Every case above was green in CI while the game did something else.
