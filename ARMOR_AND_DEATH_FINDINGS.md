# Armour and Death-System Findings

Measured engine behaviour from `@minecraft/server@2.11.0-beta.1.26.51-stable` (engine 1.26.51),
taken from three probe runs on 2026-10-13, plus the two defects those measurements expose in the
armour model. Written for whoever plans the fix: every claim is tagged with how it is known, so
nothing here has to be re-derived or taken on trust.

Nothing in this document is a design proposal. Facts, defects, and the questions still open.

## How to trust each claim

| Tag | Meaning |
| --- | --- |
| **Measured** | Read from the content log of a real session. Counts and numbers are verbatim. |
| **Read** | From the source or the pinned typings. Exact file and line given. |
| **Inferred** | Follows from the two above, but is reasoning rather than observation. |
| **Open** | Not established. Do not plan around an assumed answer. |

The probe that produced the measurements was `packs/BP/scripts/debug/deathProbe.ts` — a throwaway,
wired by one marked import in `packs/BP/scripts/main.ts`. It was never shipped code, and both are now
gone, so the measurements below can no longer be re-run from this tree: the open questions at the end
of this document would need the probe rebuilt, or staged in game by hand.

To reproduce while it existed: run `npm run build`, then `!test` in chat. Phases were `env`, `sweep`,
`mitigation`, `spectate`, `lethal`, `zombie`, `all`; `!test <phase>` ran one. Every record was a single
`console.warn` line prefixed `[BPROBE]` in
`com.mojang/logs/ContentLog*.txt`, which on this machine is
`~/Library/Application Support/Minecraft Bedrock Launcher/MinecraftData/games/com.mojang/logs/`.

The probe's own offline harness proves its wiring against `tests/mocks/minecraftServer.ts`. That
harness can never prove engine behaviour, and none of the **Measured** rows below come from it.

---

## Settled: how the engine actually behaves

### 1. The before-hurt event fires *after* health has already been decremented — **Measured**

`EntityHurtBeforeEvent` is not a preview of damage. At the moment it fires, the value reported in
`event.damage` has **already** been subtracted from health.

Evidence — five real skeleton arrows in sequence, each `hp` exactly the previous `hp` minus `raw`:

| `raw` | `hp` at event time |
| --- | --- |
| 5 | 15 |
| 4 | 11 |
| 3 | 8 |
| 4 | 4 |
| 4 | 0 |

And independently: a 20 HP player struck for 120 reported `hp = -100`, which is exactly `20 - 120`.

Consequences:

- Lethality needs no model. `health.currentValue <= 0` at event time is the verdict, exactly.
- Any code that reads health in this event and assumes it is pre-hit health is off by one hit.

### 2. `cancel = true` prevents the death and restores health in full — **Measured**

Four lethal applications of 120 damage (and one of 117.12), all with armour worn, all cancelling:

```
LETHAL_RESULT cause=entityAttack raw=117.12000274658203 hpAtEvent=-97.12000274658203 hpNow=20 alive=1
LETHAL_RESULT cause=fall         raw=120               hpAtEvent=-100              hpNow=20 alive=1
LETHAL_RESULT cause=void         raw=120               hpAtEvent=-100              hpNow=20 alive=1
LETHAL_RESULT cause=starve       raw=120               hpAtEvent=-100              hpNow=20 alive=1
```

Health returned to the full 20 in every case, and the after-event never fired at all
(`hpAfterEngine=-1`), i.e. the cancel is complete rather than partial.

### 3. `event.damage` is the amount the engine removes from health — **Measured**

This is the finding that invalidates the armour model's premise. Across **48** events with armour
worn — 21 of 21 sweep/mitigation result rows and 27 of 27 before-event lines carrying a pre-hit
health sample — `raw` equals `preHp - hpAfterEngine` exactly, with no exceptions. A 49th case, a
real zombie hit, checks out by hand (below).

The cleanest single record, with armour at 2 points:

```
MITIGATION_STRIKE cause=entityAttack amount=6 preHp=20 armor=2
HURT_BEFORE       cause=entityAttack raw=5.855999946594238 hp=14.144000053405762 preHp=20
```

Requested 6, the event carried **5.856**, and health went 20 → **14.144**. So the figure is the
*final applied* amount, not the raw incoming hit.

### 4. A script can hold the world owner in spectator, and restore them — **Measured**

`SPECTATE_READ mode=Spectator` then `SPECTATE_RESTORED mode=Survival`, in all three runs. No throw,
no bounce back to survival. `setGameMode` is `no-restricted-execution` **Read** (`index.d.ts:18521`),
so it must be called from `system.run`.

### 5. A real mob hit reaches the event, with armour — **Measured**

One occurrence, after armour was worn:

```
HURT_BEFORE cause=entityAttack raw=1.8239994049072266 armor=2 from=minecraft:zombie
```

The zombie's spawn recorded `hp=20` and health landed at `18.176000595092773` = 20 − 1.824, so this
is the 49th consistent case. A previous run produced no mob hit at all, so this row is worth
repeating rather than over-reading.

---

## The defects this exposes

### A. Armour arbitration happens too late to save anyone — **Read + Inferred**

`packs/BP/scripts/combat/armor.ts:176` subscribes with `eventBus.onEntityHurt`, i.e. the **after**
event. By then the engine has applied the damage and, when it was lethal, already committed the
death. The log shows the order directly: `HURT_AFTER cause=projectile raw=4 hp=0` immediately
followed by `DIE`.

The heal then sits behind `armor.ts:195`:

```ts
if (health && health.currentValue > 0) {
    const newHp = Math.min(health.currentValue + damageAbsorbed, health.effectiveMax);
```

so on a lethal hit the guard is false and nothing is applied. The guard is not the cause — moving the
condition would not help, because the death is already committed by the time the event fires. The
effect is that Beta armour cannot save a low-health player: someone at 3 HP hit for 5 raw, where
Beta's model would absorb 2 and leave them at 1, dies instead.

### B. The mitigation model is fed the wrong number — **Read + Measured**

`armor.ts:178` reads `const damage = ev.damage;` and passes it at `armor.ts:190` to
`computeBetaArmorMitigation(damage, points, carryover)` as though it were the raw incoming hit.

Per finding 3 it is not: it is the amount the engine has already reduced and is about to take off
health. So the pack computes Beta's absorption from an already-mitigated base and then adds that
absorption back on top. The player's net damage is not Beta's.

`computeBetaArmorMitigation` itself is correct and well covered — `tests/integration/armorDisplay.test.ts:450`
matches the formula. The caller's input is what is wrong.

### C. The test suite specifies the false premise, so it stays green — **Read**

`tests/integration/armorDisplay.test.ts:321` ("reduces armor durability and restores blocked health
when taking combat damage") dispatches a synthetic event and asserts health returns to full:

```ts
// Beta 1.7.3 EntityPlayer damage: weighted = 4 * (25 - 8) + 0 = 68; betaDamage = floor(68/25) = 2; blocked = 4 - 2 = 2.
eventBus.dispatch("entityHurt", { hurtEntity: player, damage: 4, damageSource: { cause: EntityDamageCause.entityAttack } });
assert.equal(health.currentValue, 20);   // line 353
```

The comment at line 351 states the premise outright: that `damage: 4` is the raw hit from which 2 is
blocked. The test never involves the engine, so it can observe neither the engine's own reduction nor
the event ordering.

**Any fix to A or B requires changing this assertion.** That is a change required by the requested
behaviour, not a test weakened to make a build pass, and it should be reviewed as such — the new
expectation has to state what Beta actually wants the player's health to be after a 4-damage hit,
rather than the current code's output.

---

## Open questions

### 1. The engine applies its own reduction, by a rule not yet identified — **Open**

The requested amount does not always arrive intact. Observed with armour at 2–3 points:

| requested | `raw` observed at the event |
| --- | --- |
| 4 | 3.7760009765625, 2.7840003967285156, 1.2159996032714844, 0.9920005798339844, 0.2239990234375 |
| 4 | 4 exactly — `fireTick`, `drowning`, `magic`, `selfDestruct`, `override`, `starve` |
| 6 | 5.855999946594238 |
| 120 | 117.12000274658203 (`entityAttack`); exactly 120 (`fall`, `void`, `starve`) |
| real mob hit | 1.8239994049072266 |

The reduction is **not** a consistent fraction: 5.6% at 4 damage against 2.4% at both 6 and 120 for
`entityAttack`. The rows also span differing armour point values, which is an uncontrolled variable in
this dataset. No formula is offered here, and none should be assumed.

Leading hypothesis, **not** tested: the probe's strikes land 6–8 ticks apart, inside Bedrock's
hurt-invulnerability window, which would explain both partial figures and causes that produced no
event at all. The experiment that separates the two is re-running the strikes ≥10 ticks apart with a
control hit after a long idle gap.

### 2. Does writing `event.damage` re-adjust already-decremented health? — **Open**

`event.damage` is writable — **Read**, `index.d.ts:11885`, plain `cancel: boolean` and `damage: number`
against `readonly damageSource` and `readonly hurtEntity`. But health has already been decremented by
the time the event fires (finding 1), so whether assigning to it re-adjusts health upward, downward,
or not at all is unknown. This matters because it decides how defect A and B are fixed.

### 3. The true raw hit is not recoverable from the API — **Inferred, and a hard constraint**

Since the before event carries the same already-reduced figure as the after event (finding 3), the
original pre-engine amount is not exposed anywhere. A Beta-faithful model therefore cannot compute
from the raw input; it has to either correct the reported figure or cancel and re-apply.

### 4. Cause reachability cannot be measured with `applyDamage` — **Measured**

`Entity.applyDamage(amount, { cause })` only reaches the event for some causes, and which ones depends
on the amount and on armour:

- A run at 2 damage with no armour fired for 17 of 36 causes.
- A run at 4 damage with armour fired for 21 of 36, and the sets differ in both directions — `fall`
  fired at 2 and not at 4.
- `projectile` throws `Unsupported functionality: Cause 'projectile' is not valid.`

So "no event fired" is evidence of nothing. Reachability for the remaining causes needs real staging —
an anvil, actual drowning, a real void fall — not a scripted damage call. Treat the earlier assumption
that the cause matrix could be swept programmatically as withdrawn.

### 5. Minor, unverified

- Whether a form or UI survives the spectator transition: **Open**, and it needs
  `@minecraft/server-ui`, which is not yet a dependency of this pack.
- Whether the vanilla death screen appeared on the recorded death (cause `projectile`, from
  `minecraft:skeleton`): **Open**, unobservable from a script and not yet confirmed by the operator.
- No API returns a player to the title screen. `/kick` is a disconnect screen and cannot touch the
  world owner; `kickPlayer` is BDS-only. **Read.**

---

## Constraints any fix has to respect

- `setGameMode` and `applyDamage` are `no-restricted-execution` — call them from `system.run`.
- The before-hurt event's only lever is `cancel` and a writable `damage`; health cannot be set from it
  directly, and the event gives no way to distinguish "the raw hit" from "the final amount".
- Cause reachability and the size of the engine's own reduction are both unknown (open questions 1
  and 4), so a fix must not depend on either being a specific value.
- `packs/**/*.md` is forbidden by `.githooks/pre-commit`; anything added there breaks the commit hook
  and release packaging.

## Where the earlier design material lives

`docs/superpowers/specs/2026-10-13-player-death-system-design.md` and
`docs/superpowers/plans/2026-10-13-player-death-system.md` hold the original design and plan. Both
predate these measurements and are wrong in at least two load-bearing places — they assume
`event.damage` is pre-mitigation, and they assume lethality has to be predicted rather than read.
Note that `docs/` is excluded from a fresh clone, so a planning agent working from a clean checkout
will not find them.
