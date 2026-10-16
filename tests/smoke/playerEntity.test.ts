import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The pack overrides `minecraft:player` to retune the first-person animations.
 * Overriding the client entity replaces the vanilla definition wholesale, so every
 * animation key the shipped vanilla controllers reference must be re-declared here.
 * A dangling reference makes `controller.animation.player.root` unresolvable, and
 * because that controller gates `first_person_attack_controller`, the arm stops
 * swinging while mining or attacking.
 *
 * The list below is the animation keys referenced by the vanilla
 * `controller.animation.player.root` and `controller.animation.player.first_person_attack`.
 */
const CONTROLLER_REQUIRED_KEYS = [
    "first_person_base_pose",
    "first_person_breathing_bob",
    "first_person_swap_item",
    "first_person_shield_block",
    "first_person_attack_controller",
    "first_person_empty_hand",
    "first_person_walk",
    "first_person_map_controller",
    "first_person_crossbow_equipped",
    "first_person_melee_spear_controller",
    "first_person_attack_rotation",
    "first_person_vr_attack_rotation",
    "humanoid_base_pose",
    "look_at_target_ui",
    "look_at_target",
    "move.arms",
    "move.legs",
    "cape",
    "riding.root",
    "riding.arms",
    "riding.legs",
    "holding",
    "brandish_spear",
    "holding_spyglass",
    "charging",
    "sneaking",
    "bob",
    "damage_nearby_mobs",
    "swimming",
    "swimming.no_right_arm",
    "swimming.legs",
    "crawling",
    "crawling.no_right_arm",
    "crawling.legs",
    "use_item_progress",
    "sleeping",
    "attack.positions",
    "attack.rotations",
    "shield_block_main_hand",
    "shield_block_off_hand",
    "crossbow_controller",
    "third_person_bow_equipped",
    "tooting_goat_horn",
    "holding_brush",
    "brushing",
    "holding_heavy_core",
    "third_person_melee_spear_controller"
];

const PUBLIC_VARIABLES = [
    "variable.attack_time",
    "variable.item_use_normalized"
];

describe("Player Client Entity - First-Person Animation Contract", () => {
    const root = process.cwd();

    function readJson(path: string): any {
        const raw = readFileSync(resolve(root, path), "utf-8").replace(/^\uFEFF/, "");
        return JSON.parse(raw);
    }

    function clientEntityDescription(): any {
        return readJson("packs/RP/entity/player.entity.json")["minecraft:client_entity"].description;
    }

    it("declares every animation key the vanilla player controllers reference", () => {
        const animations = clientEntityDescription().animations;
        const missing = CONTROLLER_REQUIRED_KEYS.filter((key) => !(key in animations));

        assert.deepEqual(missing, [], `player.entity.json is missing animation keys: ${missing.join(", ")}`);
    });

    it("stays below the version ceiling that retires per-player skins", () => {
        // The engine only hands a pack-declared player client entity its per-player skin
        // data (character-creator and uploaded skins alike) while the definition sits at
        // 1.13.0 or below. Above that the players fall back to `textures.default`, so
        // everyone in the world renders as the Steve texture this file declares.
        const declared = clientEntityDescription().min_engine_version;
        assert.ok(declared, "player.entity.json must declare min_engine_version");

        const [major, minor] = String(declared).split(".").map(Number);
        assert.ok(
            major < 1 || (major === 1 && minor <= 13),
            `min_engine_version ${declared} retires per-player skins; it must not exceed 1.13.0`
        );
    });

    it("keeps the controller aliases and the public variables the arm swing reads", () => {
        const description = clientEntityDescription();

        assert.equal(description.animations.root, "controller.animation.player.root");
        assert.equal(
            description.animations.first_person_attack_controller,
            "controller.animation.player.first_person_attack"
        );
        assert.equal(
            description.animations.first_person_attack_rotation,
            "animation.player.first_person.attack_rotation"
        );

        for (const name of PUBLIC_VARIABLES) {
            assert.equal(
                description.scripts.variables[name],
                "public",
                `${name} must stay declared as a public variable`
            );
        }
    });

    it("still ships the Java-matched first-person animation overrides", () => {
        const animations = readJson("packs/RP/animations/player_firstperson.animation.json").animations;

        for (const identifier of [
            "animation.player.first_person.attack_rotation",
            "animation.player.first_person.attack_rotation_item",
            "animation.player.first_person.empty_hand",
            "animation.player.first_person.walk"
        ]) {
            assert.ok(animations[identifier], `Expected the pack to override ${identifier}`);
        }
    });
});
