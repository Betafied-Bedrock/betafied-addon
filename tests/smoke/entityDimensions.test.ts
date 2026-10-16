import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    BETA_HOSTILE_TYPES,
    BETA_PASSIVE_TYPES
} from "../../packs/BP/scripts/core/betaRegistry.js";

const LEGACY_ROSTER_IDS: Readonly<Record<string, string>> = Object.freeze({
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
 * Bedrock units per Beta unit: one `moveSpeed` unit is one share of the walking player's speed.
 *
 * It read 0.46, from taking Bedrock's own zombie (0.23) as Beta's half-speed zombie. That extrapolated
 * past what the engine does -- the 5.6 playtest had a creeper at 0.322 outrunning a walking player -- so
 * the unit is anchored on what the roster has to pace like instead: the 0.7-share mobs land on 0.245,
 * next to the 0.25 the vanilla animals walk at. Still the one number to move if the era's shares need
 * re-pacing, and every declared speed is read off it -- apart from the shares at a full stride, which
 * `ENGINE_PACE_CORRECTION` below carries off it because the engine overshoots them.
 */
const WALKING_PLAYER_UNITS = 0.35;

/**
 * The declared value for a share the anchor cannot pin, because the engine's response is not
 * proportional across the range: the 5.6 creeper at 0.322 paced a *sprinting* player where Beta's 0.7
 * share is 3.0 blocks a second against a walk of 4.317. That leaves the shares furthest above the
 * zombie as the ones the anchor overshoots, and Beta's wolf is the worst of them
 * (`EntityWolf.java:19` is 1.1, the roster's highest, clamped to a full walking stride).
 *
 * Both readings of that one datapoint, with the 0.7 shares on the era's 3.0 blocks a second: 0.326 if
 * the creeper's own 1.25 attack multiplier was in play, 0.287 if it was not. 0.3 is Bedrock's own wolf
 * and sits inside both. See BETA_POLICY_GAPS.md §11.
 */
const ENGINE_PACE_CORRECTION: Readonly<Record<string, number>> = Object.freeze({ wolf: 0.3 });

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
    "zombie_pigman.mount_pathing": 1.25
});

/**
 * The wolf's own `mount_pathing` multiplier is deliberately absent above: Beta's wolf has one speed,
 * a clamped full stride, so the goal that drives its pursuit may not run it above the walking
 * player's pace. Its `random_stroll`, `melee_attack` and `follow_owner` goals are all 1.0 already.
 */

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

/** Three decimals, so `0.35 * 0.7` compares equal to the 0.245 the file declares. */
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
                ENGINE_PACE_CORRECTION[file] ?? round(WALKING_PLAYER_UNITS * speed),
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

});
