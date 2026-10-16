import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ANIMATION_PATH = "packs/RP/animations/player_death.animation.json";
const ENTITY_PATH = "packs/RP/entity/player.entity.json";
const GEOMETRY_PATH = "packs/RP/models/entity/player.armor.geo.json";

/** The pack's geometry files carry inline comments, which `JSON.parse` will not take. */
function stripComments(text: string): string {
    return text
        .split(/\r?\n/)
        .map((line) => {
            let inString = false;

            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (inString && char === "\\") {
                    i += 1;
                } else if (char === '"') {
                    inString = !inString;
                } else if (!inString && char === "/" && line[i + 1] === "/") {
                    return line.slice(0, i);
                }
            }

            return line;
        })
        .join("\n");
}

function readJson(path: string): any {
    return JSON.parse(stripComments(readFileSync(resolve(process.cwd(), path), "utf-8")));
}

/**
 * `RenderLiving.rotateCorpse` turns a corpse `sqrt(((deathTime + partialTicks - 1) / 20) * 1.6)` of
 * `getDeathMaxRotation` - capped at 1, 90 degrees for a player - about Z. Ticks are 20/s, so the frame
 * at tick `t` is `(t - 1) / 20` seconds into the animation.
 */
function eraRotationDegrees(deathTick: number): number {
    const curve = Math.min(1, Math.sqrt(((deathTick - 1) / 20) * 1.6));
    return curve * 90;
}

describe("Beta corpse flop - resource pack contract", () => {
    const animations = readJson(ANIMATION_PATH).animations;
    const flop = animations["animation.player.death_flop"];
    const bones = readJson(GEOMETRY_PATH)["geometry.player.armor.base1"].bones;

    it("turns the entity's root, the pivot the era rotated around", () => {
        assert.deepEqual(Object.keys(flop.bones), ["root"]);

        // The player's own skeleton puts `root` at [0, 0, 0] and hangs everything else off it, so this
        // is the one bone whose rotation moves the whole corpse about the era's own origin. `body`
        // pivots at the waist, which would swing the limbs around the wrong point.
        const root = bones.find((bone: any) => bone.name === "root");
        assert.deepEqual(root.pivot, [0, 0, 0]);
    });

    it("replays the era's sqrt curve, a frame per tick until the 90-degree cap", () => {
        const frames = Object.entries(flop.bones.root.rotation) as [string, number[]][];
        assert.equal(frames.length, 14, "ticks 1 to 14, the frames before the curve flattens at 90");

        for (const [seconds, rotation] of frames) {
            const deathTick = Number(seconds) * 20 + 1;
            assert.deepEqual(
                rotation,
                [0, 0, Number(eraRotationDegrees(deathTick).toFixed(2))],
                `tick ${deathTick} of the era's curve`
            );
        }
    });

    it("holds the fallen pose, and gives the respawn a way to undo it", () => {
        assert.equal(flop.loop, "hold_on_last_frame", "the corpse stays down until it is revived");
        assert.deepEqual(
            animations["animation.player.death_flop_reset"].bones.root.rotation["0.0"],
            [0, 0, 0]
        );
    });

    it("is aliased on the player entity the way the pack's own player animation is", () => {
        const aliases = readJson(ENTITY_PATH)["minecraft:client_entity"].description.animations;

        assert.equal(aliases.death_flop, "animation.player.death_flop");
        assert.equal(aliases.death_flop_reset, "animation.player.death_flop_reset");
        assert.equal(aliases.place_swing, "animation.player.place_swing");
    });
});
