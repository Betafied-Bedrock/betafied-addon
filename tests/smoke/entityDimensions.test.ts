import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    BETA_HOSTILE_TYPES,
    BETA_PASSIVE_TYPES
} from "../../packs/BP/scripts/core/betaRegistry.js";
import { compareText } from "../support/text.js";

/**
 * Beta 1.7.3's entity sizes and ground speeds, against the files that declare them.
 *
 * The era's numbers come from the recovered client at `reference-docs/beta-1.7.3` (gitignored, like
 * the rest of `reference-docs/`), and every entry below cites the line it was read from. Before that
 * clone existed these files carried vanilla Bedrock's dimensions and vanilla Bedrock's speeds, which
 * is what a player notices first: a Beta zombie's box is 1.8 tall where Bedrock's is 1.9, a Beta
 * chicken is 0.3 x 0.4 where the pack had 0.6 x 0.8, and a Beta pig walks at 70% of the player's
 * walking speed where the pack had it at half of vanilla's *own* pig.
 *
 * ## Sizes
 *
 * An entity's box is set in its constructor. `Entity` declares 0.6 x 1.8 (Entity.java:86-87) and
 * `setSize` overwrites it (Entity.java:153), so a mob that never calls `setSize` is a 0.6 x 1.8
 * humanoid -- which is why the zombie, skeleton, creeper and pigman are pinned at 1.8 rather than at
 * Bedrock's 1.9. The mobs that do call it: pig 0.9 x 0.9 (EntityPig.java:7), cow and sheep
 * 0.9 x 1.3 (EntityCow.java:7, EntitySheep.java:11), chicken 0.3 x 0.4 (EntityChicken.java:15), wolf
 * 0.8 x 0.8 (EntityWolf.java:18), squid 0.95 x 0.95 (EntitySquid.java:22), spider 1.4 x 0.9
 * (EntitySpider.java:7), ghast 4.0 x 4.0 (EntityGhast.java:16), slime `0.6 * size`
 * (EntitySlime.java:24, sizes 1/2/4) and the player 0.6 x 1.8 (EntityPlayer.java:152).
 *
 * ## Speed
 *
 * Beta has exactly one ground-movement factor for every living entity:
 * `EntityLiving.moveEntityWithHeading` passes `0.1F * var9` -- 0.1 on a normal block, because
 * `var9 = 0.16277136 / 0.546^3` is 1.0 -- into `Entity.moveFlying` (Entity.java:611), which scales
 * the input by `factor / max(magnitude, 1)`. The motion a mob gains per tick is therefore
 * `min(magnitude, 1) * 0.1`, and since `EntityCreature.updatePlayerActionState` sets
 * `moveForward = moveSpeed` (EntityCreature.java:69), a mob's speed is its `moveSpeed` as a fraction
 * of the walking player's, with anything above 1 clamped to a full stride. The values: 0.7 is
 * `EntityLiving.moveSpeed`'s default (EntityLiving.java:56), the zombie and the pigman lower it to
 * 0.5 (EntityZombie.java:7, EntityPigZombie.java:13), the spider raises it to 0.8
 * (EntitySpider.java:8) and the wolf to 1.1 (EntityWolf.java:19), which Beta clamps back to the
 * player's own speed.
 *
 * Bedrock's `minecraft:movement` value is documented only as "base movement speed", so the unit is
 * calibrated where the two editions provably agree: Bedrock's own zombie is 0.23, and the zombie is
 * the one mob both eras define as *half the walking player's* speed. That makes one Beta unit 0.46
 * Bedrock units -- `0.23 / 0.5` -- and every derived value below is `0.46 * moveSpeed`, rounded to
 * three decimals. The same constant falls out of Java's AI movement term independently
 * (`0.1 / 0.216`), which is why it is the number to change if one in-game measurement says the mobs
 * are now too fast or too slow.
 *
 * Because Beta has a single ground speed, `movement * speed_multiplier` is what the engine walks,
 * and a behavior multiplier other than 1 is a claim that Beta had a *second* speed. Every one of
 * those claims was removed, except the two states Beta really did distinguish:
 *
 *  - `zombie_pigman`'s `melee_attack` keeps 1.9, which is `EntityPigZombie.java:19`: `moveSpeed`
 *    becomes 0.95 while the pigman has a target, against its own 0.5.
 *  - `mount_pathing` is left exactly as it was. A ridden mob does not use its own `moveSpeed` at all
 *    -- `EntityLiving` copies the rider's input, so a saddled pig moves at its *rider's* walking
 *    speed (0.46 here, not its own 0.322) -- and how Bedrock's mount component splits rider input
 *    from mob speed is not something this pack can check offline.
 *
 * ## What cannot be declared
 *
 * A mob's eye height is `height * 0.85` (EntityLiving.java:89), `height * 0.8` for the wolf
 * (EntityWolf.java:221), and 1.62 for the player -- the camera rides `yOffset` (EntityPlayer.java:44,
 * 152), while the player's own `getEyeHeight` answers 0.12F, which is not a camera height.
 * Bedrock exposes no component for a mob's eye height -- the entity component list has none, and the
 * head location a script can read is documented only as "the head component", with how it is
 * computed left unsaid -- so these are recorded here instead of declared. The size table above is
 * all a client can carry.
 *
 * Three mobs cannot be translated from `moveSpeed`, and keep vanilla's value:
 *
 *  - the squid drives its own drift (`EntitySquid.moveEntityWithHeading`), it does not walk;
 *  - the ghast steers toward a waypoint with `motion += direction * 0.1` every 2-6 ticks
 *    (EntityGhast.java:31-60), so no scalar `moveSpeed` describes it;
 *  - the player is client-driven, and Bedrock's file value of 0.1 is vanilla's own -- the same 0.1
 *    that Beta's shared factor happens to be, which is a coincidence, not a translation.
 */
const LEGACY_ROSTER_IDS: Readonly<Record<string, string>> = Object.freeze({
    // Bedrock renamed the pigman and kept the old id working; the pack ships the old definition.
    "minecraft:zombified_piglin": "minecraft:zombie_pigman"
});

const ENTITIES_DIR = "packs/BP/entities";

/**
 * Beta's `setSize(width, height)` per definition file, with the line it came from. A mob that
 * declares nothing inherits `Entity`'s 0.6 x 1.8.
 */
const BETA_SIZE: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
    pig: [0.9, 0.9],           // EntityPig.java:7
    cow: [0.9, 1.3],           // EntityCow.java:7
    sheep: [0.9, 1.3],         // EntitySheep.java:11
    chicken: [0.3, 0.4],       // EntityChicken.java:15
    wolf: [0.8, 0.8],          // EntityWolf.java:18
    squid: [0.95, 0.95],       // EntitySquid.java:22
    zombie: [0.6, 1.8],        // Entity.java:86-87, no override
    skeleton: [0.6, 1.8],      // Entity.java:86-87, no override
    creeper: [0.6, 1.8],       // Entity.java:86-87, no override
    spider: [1.4, 0.9],        // EntitySpider.java:7
    ghast: [4.0, 4.0],         // EntityGhast.java:16
    zombie_pigman: [0.6, 1.8], // Entity.java:86-87, no override
    player: [0.6, 1.8]         // EntityPlayer.java:152
});

/** Beta's box for one slime size, which the era's `setSize(0.6 * size, 0.6 * size)` defines. */
const BETA_SLIME_UNIT = 0.6;

/** Beta's `moveSpeed` per definition file; undefined where the mob's motion is not moveSpeed-driven. */
const BETA_MOVE_SPEED: Readonly<Record<string, number | undefined>> = Object.freeze({
    pig: 0.7,              // EntityLiving.java:56, the default
    cow: 0.7,
    sheep: 0.7,
    chicken: 0.7,
    wolf: 1.0,             // EntityWolf.java:19 has 1.1, clamped by Entity.java:611 to a full stride
    zombie: 0.5,           // EntityZombie.java:7
    skeleton: 0.7,
    creeper: 0.7,
    spider: 0.8,           // EntitySpider.java:8
    zombie_pigman: 0.5,    // EntityPigZombie.java:13
    slime: 1.0,            // EntitySlime.java:74 sets moveForward to `1 * size`, clamped to a stride
    squid: undefined,      // EntitySquid.java:127 drives its own drift
    ghast: undefined,      // EntityGhast.java:31-60 steers by waypoint impulses
    player: undefined      // client-driven
});

/**
 * Bedrock units per Beta unit: the walking player is 1.0 in Beta and 0.46 here, calibrated on the
 * zombie -- Beta's 0.5 against Bedrock's own 0.23 -- and reproduced by Java's `0.1 / 0.216`.
 */
const WALKING_PLAYER_UNITS = 0.46;

/** Beta's eye height per definition file, as the rule each one follows. */
const BETA_EYE_HEIGHT: Readonly<Record<string, number>> = Object.freeze({
    pig: 0.9 * 0.85,           // EntityLiving.java:89, `height * 0.85`
    cow: 1.3 * 0.85,
    sheep: 1.3 * 0.85,
    chicken: 0.4 * 0.85,
    wolf: 0.8 * 0.8,           // EntityWolf.java:221, `height * 0.8`
    squid: 0.95 * 0.85,
    zombie: 1.8 * 0.85,
    skeleton: 1.8 * 0.85,
    creeper: 1.8 * 0.85,
    spider: 0.9 * 0.85,
    ghast: 4.0 * 0.85,
    zombie_pigman: 1.8 * 0.85,
    player: 1.62               // EntityPlayer.java:44,152, the camera's `yOffset`
});

/** The few Beta mobs whose eye height does not follow `height * 0.85`. */
const EYE_HEIGHT_FACTOR: Readonly<Record<string, number>> = Object.freeze({ wolf: 0.8 });

/** Slime sizes 1, 2 and 4, and the component group each spawns into. */
const SLIME_GROUPS: readonly (readonly [string, number])[] = Object.freeze([
    ["minecraft:slime_small", 1],
    ["minecraft:slime_medium", 2],
    ["minecraft:slime_large", 4]
]);

/**
 * The behavior multipliers that are not 1, keyed `file.behavior`. Each is either a state Beta really
 * gave its own speed to, or a mechanic this pack cannot derive -- never an ambling discount, which
 * is what the 0.8 strolls were.
 */
const MULTIPLIER_EXCEPTIONS: Readonly<Record<string, number>> = Object.freeze({
    "zombie_pigman.melee_attack": 1.9, // EntityPigZombie.java:19, 0.95 against its own 0.5
    "pig.mount_pathing": 1.25,
    "cow.mount_pathing": 1.5,
    "sheep.mount_pathing": 1.5,
    "chicken.mount_pathing": 1.5,
    "wolf.mount_pathing": 1.25,
    "zombie_pigman.mount_pathing": 1.25
});

/** The multiplier a ridden mob's own speed is wrong for, so only its presence is pinned. */
const MOUNT_PATHING = "minecraft:behavior.mount_pathing";

const root = process.cwd();

function readJson(path: string): any {
    return JSON.parse(readFileSync(resolve(root, path), "utf-8").replace(/^\uFEFF/, ""));
}

function definitionFile(typeId: string): string {
    return (LEGACY_ROSTER_IDS[typeId] ?? typeId).replace(/^minecraft:/, "");
}

function entityPath(typeId: string): string {
    return `${ENTITIES_DIR}/${definitionFile(typeId)}.json`;
}

function entityOf(typeId: string): any {
    return readJson(entityPath(typeId))["minecraft:entity"];
}

function roster(): string[] {
    return ["minecraft:player", ...BETA_PASSIVE_TYPES, ...BETA_HOSTILE_TYPES];
}

/** Three decimals, so `0.46 * 0.7` compares equal to the 0.322 the file declares. */
function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function closeTo(actual: number, expected: number, message: string): void {
    assert.ok(
        Math.abs(actual - expected) < 1e-4,
        `${message}: expected ${expected}, got ${actual}`
    );
}

/** Every `speed_multiplier` a definition declares, with the behavior it belongs to. */
function declaredMultipliers(typeId: string): { behavior: string; value: number }[] {
    const entity = entityOf(typeId);
    const found: { behavior: string; value: number }[] = [];

    const scan = (components: Record<string, any>): void => {
        for (const [name, body] of Object.entries<any>(components)) {
            if (!name.startsWith("minecraft:behavior")) continue;
            if (body && typeof body.speed_multiplier === "number") {
                found.push({ behavior: name, value: body.speed_multiplier });
            }
        }
    };

    scan(entity.components ?? {});
    for (const group of Object.values<any>(entity.component_groups ?? {})) scan(group);
    return found;
}

describe("entity dimensions and speed", () => {
    it("pins every mob's box at the one Beta's constructor set", () => {
        for (const typeId of roster()) {
            const file = definitionFile(typeId);
            // A slime's box is a function of its size, and is pinned by the test below.
            if (file === "slime") continue;

            const [width, height] = BETA_SIZE[file];
            const box = entityOf(typeId).components["minecraft:collision_box"];

            closeTo(box.width, width, `${file}: width`);
            closeTo(box.height, height, `${file}: height`);
        }
    });

    it("grows a slime by Beta's 0.6 a size, and gives every size the same hop", () => {
        for (const [group, size] of SLIME_GROUPS) {
            const declared = entityOf("minecraft:slime").component_groups[group];
            const side = BETA_SLIME_UNIT * size;

            closeTo(declared["minecraft:collision_box"].width, side, `${group}: width`);
            closeTo(declared["minecraft:collision_box"].height, side, `${group}: height`);
            // Beta's jump sets `moveForward` to `1 * size` (EntitySlime.java:74), which the stride
            // clamp turns back into one full stride for every size, so size does not change speed.
            closeTo(
                declared["minecraft:movement"].value,
                round(WALKING_PLAYER_UNITS * BETA_MOVE_SPEED.slime!),
                `${group}: movement`
            );
        }
    });

    it("gives every other walking mob Beta's own speed against the walking player", () => {
        for (const typeId of roster()) {
            const file = definitionFile(typeId);
            const speed = BETA_MOVE_SPEED[file];
            if (speed === undefined || file === "slime") continue;

            const { value } = entityOf(typeId).components["minecraft:movement"];
            assert.equal(
                round(value),
                round(WALKING_PLAYER_UNITS * speed),
                `${file}: movement`
            );
        }
    });

    it("declares no multiplier Beta had no second speed for", () => {
        for (const typeId of roster()) {
            const file = definitionFile(typeId);
            for (const { behavior, value } of declaredMultipliers(typeId)) {
                const keyed = `${file}.${behavior.replace("minecraft:behavior.", "")}`;
                const expected = MULTIPLIER_EXCEPTIONS[keyed] ?? 1.0;
                closeTo(value, expected, `${keyed}: speed_multiplier`);
            }
        }
    });

    it("rides a mouthful of exceptions rather than letting one rot", () => {
        // A ridden mob's speed is its rider's, and how Bedrock splits the two is uncheckable
        // offline, so mount_pathing keeps vanilla's multiplier instead of a derived one.
        for (const [keyed] of Object.entries(MULTIPLIER_EXCEPTIONS)) {
            const [file, behavior] = keyed.split(".");
            const declared = declaredMultipliers(`minecraft:${file}`).find(
                (entry) => entry.behavior === `minecraft:behavior.${behavior}`
            );

            assert.ok(declared, `${keyed}: the exception has no matching behavior to sit on`);
            if (behavior === MOUNT_PATHING.replace("minecraft:behavior.", "")) {
                assert.ok(declared!.value > 1, `${keyed}: a ridden mob still travels faster than it walks`);
            }
        }
    });

    it("records the eye height Beta reads and no file can declare", () => {
        // A slime's eye height follows whichever box its size declares, so it is derived from that
        // box rather than fixed here -- the size test above is what pins the box itself.
        // Two pigman ids share one definition file, so the roster maps onto fewer files than ids.
        const covered = [...new Set(roster().map(definitionFile))]
            .filter((file) => file !== "slime")
            .sort(compareText);
        assert.deepEqual(
            Object.keys(BETA_EYE_HEIGHT).sort(compareText),
            covered,
            "every Beta mob has to have an eye height recorded, and nothing else"
        );

        for (const [file, recorded] of Object.entries(BETA_EYE_HEIGHT)) {
            const factor = EYE_HEIGHT_FACTOR[file];
            const height = BETA_SIZE[file][1];
            const expected = file === "player" ? recorded : height * (factor ?? 0.85);

            closeTo(recorded, expected, `${file}: eye height`);
            assert.ok(
                recorded <= height,
                `${file}: an eye above the box would be a different mob`
            );
        }
    });
});
