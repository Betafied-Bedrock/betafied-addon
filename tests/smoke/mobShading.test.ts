import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Overriding a render controller replaces the vanilla definition wholesale, so the pack
 * has to re-declare geometry/materials/textures itself. The two ways that goes wrong are
 * a dropped body (the mob stops rendering) and a short-name the owning client entity never
 * declares (that layer silently disappears). Both are covered here.
 *
 * `controller.render.creeper` shades a mob whose client entity we do NOT override, so its
 * short-names come from the vanilla entity and cannot be checked against a pack file.
 */
const MOB_CONTROLLERS: Record<string, string> = {
    "controller.render.bat": "packs/RP/entity/bat.entity.json",
    "controller.render.chicken": "packs/RP/entity/chicken.entity.json",
    "controller.render.cow": "packs/RP/entity/cow.entity.json",
    "controller.render.ghast": "packs/RP/entity/ghast.entity.json",
    "controller.render.pig": "packs/RP/entity/pig.entity.json",
    "controller.render.sheep": "packs/RP/entity/sheep.entity.json",
    "controller.render.skeleton": "packs/RP/entity/skeleton.entity.json",
    "controller.render.slime": "packs/RP/entity/slime.entity.json",
    "controller.render.slime_armor": "packs/RP/entity/slime.entity.json",
    "controller.render.spider": "packs/RP/entity/spider.entity.json",
    "controller.render.squid": "packs/RP/entity/squid.entity.json",
    "controller.render.wolf": "packs/RP/entity/wolf.entity.json",
    "controller.render.zombie": "packs/RP/entity/zombie.entity.json",
    "controller.render.zombie_pigman": "packs/RP/entity/zombie_pigman.entity.json"
};

const SHADING_FILE = "packs/RP/render_controllers/beta_mob_shading.render_controllers.json";

const root = process.cwd();

function readJson(path: string): any {
    return JSON.parse(readFileSync(resolve(root, path), "utf-8").replace(/^\uFEFF/, ""));
}

function controllers(): Record<string, any> {
    return readJson(SHADING_FILE).render_controllers;
}

/** Short-name references a controller resolves, bucketed by the entity section that declares them. */
function referencedShortNames(controller: any): Map<string, Set<string>> {
    const buckets: Record<string, string> = { texture: "textures", geometry: "geometry", material: "materials" };
    const found = new Map<string, Set<string>>();
    const pattern = /\b(Texture|Geometry|Material)\.([A-Za-z0-9_]+)\b/gi;
    for (const match of JSON.stringify(controller).matchAll(pattern)) {
        const bucket = buckets[match[1].toLowerCase()];
        const names = found.get(bucket) ?? new Set<string>();
        names.add(match[2]);
        found.set(bucket, names);
    }
    return found;
}

describe("Beta Mob Shading - resource pack contract", () => {
    it("shades every declared beta mob without dropping the vanilla render body", () => {
        const shipped = controllers();

        for (const identifier of Object.keys(MOB_CONTROLLERS)) {
            const definition = shipped[identifier];
            assert.ok(definition, `missing shaded render controller for ${identifier}`);

            for (const required of ["geometry", "materials", "textures"]) {
                assert.ok(required in definition, `${identifier} must keep its vanilla ${required} mapping`);
            }

            const rawMultiplier = String(definition.light_color_multiplier);
            const isDarkened = rawMultiplier.includes("0.8") || Number(rawMultiplier) < 1;
            assert.ok(
                isDarkened,
                `${identifier} must darken directional shading (got ${definition.light_color_multiplier})`
            );

            assert.ok(
                Number(definition.is_hurt_color?.a) > 0,
                `${identifier} must keep a visible hurt tint`
            );
        }
    });

    it("darkens wolves further when wet in water or rain", () => {
        const wolf = controllers()["controller.render.wolf"];
        assert.ok(
            String(wolf.light_color_multiplier).includes("is_in_water_or_rain"),
            "wolf must darken when wet"
        );
    });

    it("keeps the wolf on Beta's one skin set instead of the modern coat variants", () => {
        // Beta 1.7.3 has a single wolf skin in three states. Vanilla's current client entity indexes
        // the coat by query.variant and, apart from pale, points every coat at art only vanilla's
        // own resource pack ships, so a wolf still carrying variant data draws a modern coat.
        const entityPath = "packs/RP/entity/wolf.entity.json";
        const description = readJson(entityPath)["minecraft:client_entity"].description;
        const shipped = controllers();

        for (const identifier of description.render_controllers) {
            const definition = shipped[identifier];
            assert.ok(definition, `${entityPath} references ${identifier}, which the pack does not define`);
            assert.ok(
                !JSON.stringify(definition).includes("query.variant"),
                `${identifier} must not pick a coat by variant`
            );
        }

        assert.deepEqual(
            Object.keys(description.textures),
            ["default", "angry", "tame"],
            "an unused coat slot would fall through to vanilla's own wolf art"
        );

        for (const path of Object.values(description.textures) as string[]) {
            const onDisk = ["png", "tga"].some(ext => existsSync(resolve(root, `packs/RP/${path}.${ext}`)));
            assert.ok(onDisk, `${entityPath} points at ${path}, which the pack does not ship`);
        }
    });

    it("shades the player with UI paperdoll protection and disables on-fire overlay", () => {
        const shipped = controllers();
        const requiredControllers = [
            "controller.render.player.first_person",
            "controller.render.player.third_person",
            "controller.render.player.first_person_spectator",
            "controller.render.player.third_person_spectator",
            "controller.render.player.map"
        ];

        for (const id of requiredControllers) {
            assert.ok(shipped[id], `missing player render controller: ${id}`);
        }

        const thirdPerson = shipped["controller.render.player.third_person"];
        assert.ok(
            String(thirdPerson.light_color_multiplier).includes("is_in_ui"),
            "third person player must protect paperdoll from darkening in UI"
        );
        assert.ok(
            String(thirdPerson.on_fire_color?.a).includes("is_in_ui"),
            "third person player must disable on-fire overlay outside UI"
        );
    });

    it("shades minecarts, custom minecarts, arrows, and fishing hooks without hurt or fire tints", () => {
        const shipped = controllers();
        const customControllers = readJson("packs/RP/render_controllers/custom_minecart.render_controller.json").render_controllers;

        const vehiclesAndProjectiles = [
            shipped["controller.render.minecart"],
            shipped["controller.render.arrow"],
            shipped["controller.render.fishing_hook"],
            customControllers["controller.render.custom_minecart_default"],
            customControllers["controller.render.custom_minecart_fueled"]
        ];

        for (const controller of vehiclesAndProjectiles) {
            assert.ok(controller, "vehicle/projectile controller must exist");
            assert.ok(
                String(controller.light_color_multiplier).includes("0.8") || Number(controller.light_color_multiplier) < 1,
                "must darken directional shading"
            );
            assert.ok(
                Number(controller.is_hurt_color?.a) < 0,
                "must suppress hurt tint"
            );
            assert.ok(
                Number(controller.on_fire_color?.a) < 0,
                "must suppress fire tint"
            );
        }
    });

    it("removes the orange on-fire model overlay the way Java does", () => {
        for (const [identifier, controller] of Object.entries(controllers())) {
            // The creeper and player use expressions here.
            if (identifier === "controller.render.creeper" || identifier.startsWith("controller.render.player.")) continue;

            assert.ok(
                Number(controller.on_fire_color?.a) < 0,
                `${identifier} should disable the on-fire overlay`
            );
        }
    });

    it("only references short-names its client entity actually declares", () => {
        const shipped = controllers();

        for (const [identifier, entityPath] of Object.entries(MOB_CONTROLLERS)) {
            const description = readJson(entityPath)["minecraft:client_entity"].description;

            for (const [bucket, names] of referencedShortNames(shipped[identifier])) {
                const declared = description[bucket] ?? {};
                for (const name of names) {
                    assert.ok(
                        name in declared,
                        `${identifier} references ${bucket}.${name}, which ${entityPath} does not declare`
                    );
                }
            }
        }
    });

    it("wires the bat override into a client entity that names it", () => {
        const description = readJson("packs/RP/entity/bat.entity.json")["minecraft:client_entity"].description;
        assert.deepEqual(
            description.render_controllers,
            ["controller.render.bat"],
            "an unwired override would leave bats on vanilla shading"
        );
    });
});
