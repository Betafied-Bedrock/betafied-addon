import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import {
    BETA_HOSTILE_TYPES,
    BETA_PASSIVE_TYPES
} from "../../packs/BP/scripts/policy/betaRegistry.js";
import { versionAtLeast } from "../support/text.js";

const LEGACY_ROSTER_IDS: Readonly<Record<string, string>> = Object.freeze({
    "minecraft:zombified_piglin": "minecraft:zombie_pigman"
});

/**
 * `[shadowSize, height]` per entity definition file, from the two Java sources named above: the
 * renderer's constructor in `RenderManager.java:27-41` and the entity's own class. `shadowSize` is both
 * the renderer constant and the radius a decal declares (Bedrock doubles it, which lands on Java's
 * `2 * shadowSize` quad), so the declared span is this number multiplied by
 * `DECAL_RADIUS_PER_SHADOW_SIZE`.
 */
const JAVA_SHADOW: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
    pig: [0.7, 0.9],           // RenderManager.java:28, EntityPig.java:7
    cow: [0.7, 1.3],           // RenderManager.java:30, EntityCow.java:7
    sheep: [0.7, 1.3],         // RenderManager.java:29, EntitySheep.java:11
    chicken: [0.3, 0.4],       // RenderManager.java:32, EntityChicken.java:15
    wolf: [0.5, 0.8],          // RenderManager.java:31, EntityWolf.java:18
    squid: [0.7, 0.95],        // RenderManager.java:40, EntitySquid.java:22
    zombie: [0.5, 1.8],        // RenderManager.java:35, EntityMob.java
    skeleton: [0.5, 1.8],      // RenderManager.java:34, EntityMob.java
    creeper: [0.5, 1.8],       // RenderCreeper.java:9, EntityMob.java
    spider: [1.0, 0.9],        // RenderSpider.java:7, EntitySpider.java:7
    slime: [0.25, 0.6],        // RenderManager.java:36, EntitySlime.java:24 (size 1)
    zombie_pigman: [0.5, 1.8], // the zombie renderer it inherits, EntityMob.java
    player: [0.5, 1.8]         // RenderPlayer.java:13, EntityPlayer.java:152
});

/**
 * A ghast's own numbers are `[0.5, 4.0]`, which make its alpha `0.5 - 4.0 / 8` -- exactly zero. Beta
 * draws no shadow for a ghast, so neither does this pack, and it declares neither number.
 */
const NO_DECAL = ["ghast"];

/**
 * How far above the ground the decal is drawn. Java uses 1/64, which is close enough to the block
 * face that the decal z-fights it in Bedrock's depth buffer. It also has to clear the one error the
 * decal cannot cancel: its offset subtracts a tick-sampled height from an emitter the client draws
 * interpolated, so any vertical motion pushes the disc under the surface by up to a tick of it, and a
 * two-centimetre lift leaves the top of the disc intersecting the ground and buzzing.
 */
const SURFACE_CLEARANCE = 0.05;

/** The eye offset a local player's decal is measured down from; for a remote player, nothing. */
const PLAYER_EYE_HEIGHT = 1.62;

const ENTITIES_DIR = "packs/BP/entities";
const ENTITY_DIR = "packs/RP/entity";
const CONTROLLER_FILE = "packs/RP/animation_controllers/entity_shadow.animation_controllers.json";
const MOB_PARTICLE_FILE = "packs/RP/particles/entity_shadow.json";
const PLAYER_PARTICLE_FILE = "packs/RP/particles/entity_shadow_player.json";
const TEXTURE_FILE = "packs/RP/textures/particle/entity_shadow.png";
const RENDER_CONTROLLERS_DIR = "packs/RP/render_controllers";

/** The query that tells a render controller whether to draw the entity at all. */
const INVISIBILITY_QUERY = "query.is_invisible";

const CONTROLLER = "controller.animation.betarock.entity_shadow";
const EFFECT_ALIAS = "bh_entity_shadow";
const MOB_PARTICLE_ID = "bh:entity_shadow";
const PLAYER_PARTICLE_ID = "bh:entity_shadow_player";
const SPAN_PROPERTY = "betarock:shadow_span";
const ALPHA_PROPERTY = "betarock:shadow_alpha";
const GROUND_PROPERTY = "betarock:shadow_ground";
const PLAYER_TYPE = "minecraft:player";
const LOCAL_PLAYER_QUERY = "query.is_local_player";
const FIRST_PERSON_QUERY = "query.is_first_person";
const DISTANCE_QUERY = "query.distance_from_camera";

/**
 * The entities that may not carry the swap at all, and keep Bedrock's own shadow.
 *
 * The wiki's recipe is two components -- the invisibility effect, which is what removes the engine's
 * own shadow, and `renders_when_invisible`, which keeps the model drawn through it -- and the pack
 * added a third to every mob: `minecraft:is_hidden_when_invisible`, documented as "The entity can hide
 * from hostile mobs while invisible". That is the pair vanilla's wandering trader uses to stand in the
 * open at night, and it is not a rendering detail. On the player it turned the swap into a permanent
 * aggro shield: every hostile mob's `nearest_attackable_target` answered "no" to an entity that is
 * always invisible, so zombies and skeletons walked past until they were hit and only retaliation --
 * a sight-free path -- landed. `target_invisible_multiplier` (0.7, times the target's armor coverage)
 * makes the effect itself cost most of a mob's range as well, so the player cannot keep the swap in any
 * shape: there is no per-entity shadow control to fall back on, only a tiny collision box, a
 * RenderDragon-dead material and an undocumented `banner_pole` model, and none of those suits a player.
 */
const KEEPS_ENGINE_SHADOW: ReadonlySet<string> = new Set([PLAYER_TYPE]);

/** The entity queries that have been seen to resolve inside a particle, and no others. */
const PARTICLE_QUERIES: readonly string[] = Object.freeze([
    DISTANCE_QUERY,
    LOCAL_PLAYER_QUERY,
    "query.property",
    "query.position"
]);

/** The sprite, measured: the disc's opaque radius over the sprite's half-width. */
const SPRITE_DISC_RADIUS = 0.9;

/**
 * How much radius a decal declares per unit of Java's `shadowSize`: one. Bedrock's billboard `size` is
 * a radius -- a size of 1 draws a 2 by 2 block plane -- and Java's sprite covers `2 * shadowSize`, so
 * the two meet at the renderer constant. Treating `size` as the quad's full width is what doubled
 * every decal on the ground and sent a build out at twice Java's width.
 */
const DECAL_RADIUS_PER_SHADOW_SIZE = 1;

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

function clientEntityPath(typeId: string): string {
    return `${ENTITY_DIR}/${definitionFile(typeId)}.entity.json`;
}

function betaRoster(): string[] {
    return [PLAYER_TYPE, ...BETA_PASSIVE_TYPES, ...BETA_HOSTILE_TYPES];
}

/** The shadow table's entry for an entity, or undefined for one that draws no decal. */
function javaShadow(typeId: string): readonly [number, number] | undefined {
    const file = definitionFile(typeId);
    return NO_DECAL.includes(file) ? undefined : JAVA_SHADOW[file];
}

function particleFile(typeId: string): string {
    return typeId === PLAYER_TYPE ? PLAYER_PARTICLE_FILE : MOB_PARTICLE_FILE;
}

function particleId(typeId: string): string {
    return typeId === PLAYER_TYPE ? PLAYER_PARTICLE_ID : MOB_PARTICLE_ID;
}

function components(path: string): Record<string, any> {
    return readJson(path).particle_effect.components;
}

function surfaceClearanceExpressions(path: string): string[] {
    return [components(path)["minecraft:emitter_shape_point"].offset[1]];
}

function controllers(): Record<string, any> {
    return readJson(CONTROLLER_FILE).animation_controllers;
}

/** Every render controller the pack ships, keyed by identifier, across the whole folder. */
function renderControllers(): Record<string, any> {
    const found: Record<string, any> = {};
    for (const file of readdirSync(resolve(root, RENDER_CONTROLLERS_DIR))) {
        if (!file.endsWith(".json")) continue;
        Object.assign(found, readJson(`${RENDER_CONTROLLERS_DIR}/${file}`).render_controllers ?? {});
    }
    return found;
}

/** Every `nearest_attackable_target` a definition declares, wherever it sits -- component groups too. */
function targetGoals(node: unknown, found: unknown[] = []): unknown[] {
    if (node === null || typeof node !== "object") return found;

    for (const [key, value] of Object.entries<any>(node)) {
        if (key === "minecraft:behavior.nearest_attackable_target") found.push(value);
        targetGoals(value, found);
    }

    return found;
}

/** Whether any of a definition's target goals names the player family. */
function huntsThePlayer(definition: unknown): boolean {
    return targetGoals(definition).some((goal) => /"value": ?"player"/.test(JSON.stringify(goal)));
}

/**
 * The legacy top-level `animation_controllers` table, when a file still routes a controller through
 * it. The engine dumps such a table to the content log and then rejects it -- `child
 * 'animation_controllers' not valid here.` -- for every 1.10.0 file, which is why the mob client
 * entities that still carry one are the ones at 1.8.0, where vanilla's own files do the same.
 */
function legacyControllerTable(definition: any): any[] | undefined {
    const table = definition["minecraft:client_entity"]?.description?.animation_controllers;
    if (!Array.isArray(table)) return undefined;
    return table.some(
        (entry: any) => entry && typeof entry === "object" && Object.values(entry).includes(CONTROLLER)
    ) ? table : undefined;
}

/** Every `default`/`range` literal a property body declares, as written. */
function propertyLiterals(text: string, identifier: string): string[] {
    const body = new RegExp(`"${identifier}"\\s*:\\s*\\{([^}]*)\\}`).exec(text)?.[1] ?? "";
    const hit = /"default"\s*:\s*([^,}]+)/.exec(body)?.[1]?.trim();
    const range = /"range"\s*:\s*\[([^\]]*)\]/.exec(body)?.[1]?.split(",").map((part) => part.trim());
    return [hit ?? "", ...(range ?? [])];
}

/** Decodes a non-interlaced 8-bit RGBA PNG into per-pixel RGBA rows. */
function decodePng(path: string): { width: number; height: number; rows: number[][] } {
    const png = readFileSync(resolve(root, path));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "expected a PNG");

    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert.equal(png[24], 8, "the sprite has to be 8 bits per channel");
    assert.equal(png[25], 6, "colour type 6: the decal needs an alpha channel, not a key colour");

    const idat: Buffer[] = [];
    for (let offset = 8; offset + 8 <= png.length; ) {
        const length = png.readUInt32BE(offset);
        const type = png.subarray(offset + 4, offset + 8).toString("ascii");
        if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
        if (type === "IEND") break;
        offset += length + 12;
    }

    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * 4;
    const rows: number[][] = [];
    let previous = new Array(stride).fill(0);
    let cursor = 0;

    for (let y = 0; y < height; y++) {
        const filter = raw[cursor++];
        const line = Array.from(raw.subarray(cursor, cursor + stride));
        cursor += stride;

        for (let x = 0; x < stride; x++) {
            const left = x >= 4 ? line[x - 4] : 0;
            const up = previous[x];
            const upLeft = x >= 4 ? previous[x - 4] : 0;
            if (filter === 1) line[x] = (line[x] + left) & 255;
            else if (filter === 2) line[x] = (line[x] + up) & 255;
            else if (filter === 3) line[x] = (line[x] + ((left + up) >> 1)) & 255;
            else if (filter === 4) {
                const estimate = left + up - upLeft;
                const distances = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)];
                const nearest = distances[0] <= distances[1] && distances[0] <= distances[2] ? left
                    : distances[1] <= distances[2] ? up : upLeft;
                line[x] = (line[x] + nearest) & 255;
            }
        }

        rows.push(line);
        previous = line;
    }

    return { width, height, rows };
}

describe("Entity shadows - what each entity declares", () => {
    it("declares Java's shadowSize as the decal's radius and its height as the opacity", () => {
        for (const typeId of betaRoster()) {
            const path = entityPath(typeId);
            const declaration = readJson(path)["minecraft:entity"].description.properties ?? {};
            const span = declaration[SPAN_PROPERTY];
            const alpha = declaration[ALPHA_PROPERTY];

            if (javaShadow(typeId) === undefined) {
                assert.equal(span, undefined, `${path} draws no decal, so it declares no span`);
                assert.equal(alpha, undefined, `${path} draws no decal, so it declares no alpha`);
                continue;
            }

            // Without client_sync the resource pack cannot read them at all, and the decal would draw
            // at whatever the client last knew -- nothing, for an entity never written to.
            assert.equal(span?.client_sync, true, `${path} must client_sync ${SPAN_PROPERTY}`);
            assert.equal(alpha?.client_sync, true, `${path} must client_sync ${ALPHA_PROPERTY}`);
            assert.equal(span?.type, "float", `${path} must declare ${SPAN_PROPERTY} as a float`);
            assert.equal(alpha?.type, "float", `${path} must declare ${ALPHA_PROPERTY} as a float`);

            // Bedrock takes the span as a radius, so Java's own constant is the number that draws
            // Java's quad; the full-light opacity is 0.5 - height / 8.
            const betaSpan = Number((DECAL_RADIUS_PER_SHADOW_SIZE * javaShadow(typeId)![0]).toFixed(3));
            assert.equal(Number(span?.default), betaSpan, `${path}: span`);
            assert.equal(Number(alpha?.default), Number((0.5 - javaShadow(typeId)![1] / 8).toFixed(5)), `${path}: alpha`);

            // The player draws no decal, so only a swapped mob declares the surface it is drawn on.
            if (!KEEPS_ENGINE_SHADOW.has(typeId)) {
                const ground = declaration[GROUND_PROPERTY];
                assert.equal(ground?.client_sync, true, `${path} must client_sync ${GROUND_PROPERTY}`);
                assert.equal(ground?.type, "float", `${path} must declare ${GROUND_PROPERTY} as a float`);
                assert.equal(Number(ground?.default), 0, `${path}: an unwritten surface is the entity's own feet`);
            }

            // The engine takes `0.7` and rejects `0` or `4` with "Error loading property
            // 'betarock:shadow_drop': 'default' value does not match the specified type 'float'"
            // followed by "'range' array should contain only 'float' type elements". A Molang default is
            // a string and the schema takes it as-is; a number without a decimal point is not.
            const text = readFileSync(resolve(root, path), "utf-8");
            const identifiers = KEEPS_ENGINE_SHADOW.has(typeId)
                ? [SPAN_PROPERTY, ALPHA_PROPERTY]
                : [SPAN_PROPERTY, ALPHA_PROPERTY, GROUND_PROPERTY];
            for (const identifier of identifiers) {
                for (const literal of propertyLiterals(text, identifier)) {
                    if (literal.startsWith('"')) continue;
                    assert.ok(
                        Number.isFinite(Number(literal)) && literal.includes("."),
                        `${path}: ${identifier} declares ${literal}, not a float literal`
                    );
                }
            }
        }
    });

    it("swaps Bedrock's own collision-box shadow out on every Beta mob", () => {
        for (const typeId of betaRoster()) {
            const path = entityPath(typeId);
            const components_ = readJson(path)["minecraft:entity"].components;

            // The player is the one entity the swap cannot serve, asserted as an absence from the side
            // that fails silently: putting it back would still render, still take hits and log nothing.
            if (KEEPS_ENGINE_SHADOW.has(typeId)) {
                for (const component of [
                    "minecraft:spell_effects",
                    "minecraft:renders_when_invisible",
                    "minecraft:is_hidden_when_invisible"
                ]) {
                    assert.equal(components_[component], undefined, `${path} may not carry ${component}`);
                }
                continue;
            }

            // Declarative, so nothing has to keep it applied: the engine draws no shadow for an
            // invisible entity, and `renders_when_invisible` is what keeps the mob itself visible.
            assert.deepEqual(
                components_["minecraft:spell_effects"]?.add_effects,
                [{ effect: "invisibility", duration: "infinite", visible: false }],
                `${path} must keep a permanent, hidden invisibility for the shadow swap`
            );
            assert.equal(
                components_["minecraft:renders_when_invisible"] !== undefined,
                true,
                `${path} needs minecraft:renders_when_invisible or the mob stops rendering`
            );
            // Invisibility alone still leaves the entity's own collision-box shadow on the ground.
            // The nine mobs that declare this draw none; the four that did not -- wolf, creeper,
            // spider and pigman -- drew Bedrock's blurry blob on top of their decal, which is what
            // reads as a shadow far too large for a 0.6-wide mob.
            assert.equal(
                components_["minecraft:is_hidden_when_invisible"] !== undefined,
                true,
                `${path} needs minecraft:is_hidden_when_invisible or Bedrock's own shadow stays`
            );

            // `duration: "infinite"` reached the schema in 1.21.70, and the engine honours a component
            // an older file's format version does not know only by ignoring it.
            const [major, minor, patch] = String(readJson(path).format_version).split(".").map(Number);
            assert.ok(
                major > 1 || (major === 1 && (minor > 21 || (minor === 21 && patch >= 70))),
                `${path} declares ${readJson(path).format_version}, too old for an infinite duration`
            );
        }
    });

    it("keeps a swapped mob drawn, whatever its render controller asks", () => {
        // The swap holds every Beta mob permanently invisible, so the model only reaches the screen
        // because `renders_when_invisible` stops the engine culling it -- a controller that reads
        // `query.is_invisible` undraws the mob that could still hit you. Vanilla's spider controller
        // does exactly that, with `Material.invisible`, and it is what made spiders invisible.
        const shipped = renderControllers();
        const offenders: string[] = [];

        for (const typeId of betaRoster()) {
            if (KEEPS_ENGINE_SHADOW.has(typeId)) continue;

            const description = readJson(clientEntityPath(typeId))["minecraft:client_entity"].description;
            for (const identifier of description.render_controllers ?? []) {
                const controller = shipped[identifier];
                // Vanilla's own controller: not a definition this pack can or needs to correct.
                if (!controller) continue;

                if (JSON.stringify(controller.materials ?? {}).includes(INVISIBILITY_QUERY)) {
                    offenders.push(`${identifier} for ${clientEntityPath(typeId)}`);
                }
            }
        }

        assert.deepEqual(
            offenders,
            [],
            "a material chosen by the invisibility query hides the mob the swap just took a shadow from"
        );
    });

    it("leaves the player nameable by every hostile mob that hunts", () => {
        // The other end of the swap's price, which is paid in targeting and says nothing in a content
        // log: the player may not carry the invisibility (the case above pins that), and every hostile
        // mob has to keep naming the player as a target.
        for (const typeId of BETA_HOSTILE_TYPES) {
            const definition = readJson(entityPath(typeId));
            if (targetGoals(definition).length === 0) continue;
            assert.ok(huntsThePlayer(definition), `${entityPath(typeId)} no longer names family "player"`);
        }
    });
});

describe("Entity shadows - how each client entity runs it", () => {
    it("binds the decal and plays the controller that draws it", () => {
        for (const typeId of betaRoster()) {
            const path = clientEntityPath(typeId);
            assert.ok(existsSync(resolve(root, path)), `no client entity at ${path}`);

            const definition = readJson(path);
            const description = definition["minecraft:client_entity"].description;

            if (javaShadow(typeId) === undefined || KEEPS_ENGINE_SHADOW.has(typeId)) {
                // A ghast draws no decal in Beta, and the player may not carry the swap, so neither
                // binds an emitter -- and neither may bind the controller either, which would read a
                // pair of numbers only a decal uses. The player's particle file stays in the pack as
                // the decal a swap would bind again; nothing references it while this holds.
                assert.equal(description.particle_effects?.[EFFECT_ALIAS], undefined, `${path}: no decal`);
                assert.equal(
                    JSON.stringify(description).includes("controller.animation.betarock.entity_shadow"),
                    false,
                    `${path}: no controller`
                );
                continue;
            }

            assert.equal(
                description.particle_effects?.[EFFECT_ALIAS],
                particleId(typeId),
                `${path} has to bind ${EFFECT_ALIAS} to the decal it draws`
            );

            // The alias has to be in `animations` *and* played from `scripts.animate` -- a table entry
            // without an `animate` entry is a controller that never runs.
            const modern =
                description.animations?.[EFFECT_ALIAS] === CONTROLLER &&
                Array.isArray(description.scripts?.animate) &&
                description.scripts.animate.includes(EFFECT_ALIAS);
            const legacy = legacyControllerTable(definition) !== undefined;
            const formatVersion = String(definition.format_version);

            // The engine logs `child 'animation_controllers' not valid here.` for every 1.10.0 file
            // that carries one, so a file at 1.10.0 or above may not take that route at all.
            assert.equal(
                legacy && Number(formatVersion.split(".")[1] ?? 0) >= 10,
                false,
                `${path} routes ${CONTROLLER} through animation_controllers at ${formatVersion}`
            );
            assert.ok(legacy || modern, `${path} declares nothing that would run ${CONTROLLER}`);
        }
    });
});

describe("Entity shadows - the decal itself", () => {
    it("draws a flat disc on the ground, one per entity, for as long as the entity lives", () => {
        for (const typeId of betaRoster()) {
            if (javaShadow(typeId) === undefined) continue;
            const path = particleFile(typeId);
            const found = components(path);

            assert.equal(
                readJson(path).particle_effect.description.basic_render_parameters.material,
                "particles_blend",
                `${path}: a decal needs the blending material, not the alpha-cutout one`
            );
            assert.equal(
                readJson(path).particle_effect.description.basic_render_parameters.texture,
                "textures/particle/entity_shadow"
            );

            // A horizontal quad comes from the emitter's own frame, not from a direction vector:
            // `emitter_transform_xz` matches the billboard plane to that frame's XZ plane, which is
            // the ground while the emitter does not rotate with its entity (`emitter_local_space`
            // below keeps rotation false). Beta's own decal is axis-aligned to the block grid too.
            const billboard = found["minecraft:particle_appearance_billboard"];
            assert.equal(billboard.facing_camera_mode, "emitter_transform_xz", `${path}: a decal lies flat`);
            assert.deepEqual(billboard.size, ["variable.shadow_span", "variable.shadow_span"], `${path}: quad`);

            // Local space is what makes the decal glide with the entity instead of stepping.
            assert.deepEqual(found["minecraft:emitter_local_space"], { position: true, rotation: false });

            // `max_particles` is the promise that one emitter draws one decal; two at once would
            // blend over each other and read as a darker shadow. The emitter never expires on its own
            // (the controller owns its life) and the particle never does either -- an entity's decal
            // has no reason to blink.
            assert.equal(found["minecraft:emitter_rate_steady"].max_particles, 1, `${path}: one decal`);
            assert.ok(Number(found["minecraft:emitter_rate_steady"].spawn_rate) >= 20, `${path}: replace within a tick`);
            assert.equal(found["minecraft:emitter_lifetime_expression"].expiration_expression, "0", `${path}: never expires itself`);
            assert.ok(Number(found["minecraft:particle_lifetime_expression"].max_lifetime) >= 3600, `${path}: an immortal decal`);

            // Java fades by the squared distance to the camera (Render.java:240 with
            // RenderManager.func_851_a), so a decal is gone past sixteen blocks.
            const tint = found["minecraft:particle_appearance_tinting"].color;
            assert.ok(tint[3].includes(DISTANCE_QUERY), `${path}: the renderer's distance falloff`);
            assert.ok(tint[3].includes("variable.shadow_alpha"), `${path}: the entity's own opacity`);
            // Java multiplies the entity's opacity by that falloff; reducing it by a fixed share of the
            // falloff instead makes a small decal fade out at a different rate than Beta's, so the
            // product is the part of the expression worth pinning.
            assert.ok(
                tint[3].includes("variable.shadow_alpha * (1 - "),
                `${path}: the distance falloff multiplies the entity's own opacity`
            );

            // No engine billboard mode can satisfy a direction vector, so the subsection has to be
            // absent rather than merely spelled differently.
            assert.equal(
                "direction" in billboard,
                false,
                `${path}: the subsection has to be absent, not merely named differently`
            );
        }
    });

    it("fades with the entity's height above the surface", () => {
        // Beta draws one block's shadow at `((opacity - (height + 1) / 2) * 0.5)` (Render.java:137),
        // which is the ground-level opacity less a quarter per block of clearance: a mob two blocks up
        // carries half the decal it carries standing, and a long fall ends with none. The clamp is
        // part of the curve -- a negative height would brighten the decal as the mob rose.
        const tint = String(components(MOB_PARTICLE_FILE)["minecraft:particle_appearance_tinting"].color[3]);
        assert.ok(
            tint.includes(
                `- 0.25 * math.max(query.position(1) - query.property('${GROUND_PROPERTY}'), 0)`
            ),
            `${MOB_PARTICLE_FILE}: the decal has to fade with the entity's height above the surface`
        );
    });

    it("places the decal without reading a variable it cannot see", () => {
        // A `pre_effect_script` variable resolves in the appearance subsection only. Read from the
        // position ones it is unknown on every frame of every decal, and evaluates to zero.
        for (const [typeId, expected] of [
            ["minecraft:pig", `${SURFACE_CLEARANCE}`],
            [PLAYER_TYPE, `${SURFACE_CLEARANCE} - (${LOCAL_PLAYER_QUERY} ? ${PLAYER_EYE_HEIGHT} : 0.0)`]
        ] as const) {
            const path = particleFile(typeId);
            for (const expression of surfaceClearanceExpressions(path)) {
                // A literal is written as a number and an expression as a string; only the text matters.
                assert.equal(String(expression), expected, `${path}: the decal has to be born where it belongs`);
                assert.equal(
                    String(expression).includes("variable."),
                    false,
                    `${path}: a variable here is an unknown-variable error on every frame`
                );
            }
        }
    });

    it("projects onto the published surface instead of riding the entity's feet", () => {
        // A local-space particle simulates in the entity's frame, so there is no terrain under it to
        // collide with, and a particle's Molang has no world queries at all -- `above_top_solid` and
        // `heightmap` are both rejected there. The ground therefore arrives as an entity property a
        // server pass keeps current, and the decal turns it into a per-frame offset itself, because
        // `query.position` is read on every frame while a synced property only lands every tick.
        const path = MOB_PARTICLE_FILE;
        const found = components(path);
        assert.equal(found["minecraft:particle_motion_dynamic"], undefined, `${path}: physics cannot find terrain here`);
        assert.equal(found["minecraft:particle_motion_collision"], undefined, `${path}: physics cannot find terrain here`);

        const height = String(found["minecraft:particle_motion_parametric"].relative_position[1]);
        assert.equal(
            height,
            `math.min(${SURFACE_CLEARANCE}, query.property('${GROUND_PROPERTY}') - query.position(1) + ${SURFACE_CLEARANCE})`,
            `${path}: the decal drops to the published surface and never rises above its clearance`
        );

        // The player's decal is unbound while the swap is off, so it stays the plain pinned offset
        // instead of reading a property the player may not declare.
        const playerHeight = String(
            components(PLAYER_PARTICLE_FILE)["minecraft:particle_motion_parametric"].relative_position[1]
        );
        assert.equal(playerHeight.includes(GROUND_PROPERTY), false, `${PLAYER_PARTICLE_FILE}: no ground to read`);
    });

    it("draws nothing for the local player and everyone else's shadow anyway", () => {
        // Beta draws no shadow for the entity the player is looking through, and this pack wants none of
        // the player's own in third person either. The gate is the decal's opacity, multiplied away by
        // `1.0 - query.is_local_player`, in the file that has already been shown to resolve that query:
        // the eye-height lift below is what proves it, and a 1.10.0 controller is rule 4's problem.
        const tint = components(PLAYER_PARTICLE_FILE)["minecraft:particle_appearance_tinting"].color[3];
        assert.ok(
            tint.includes(`(1.0 - ${LOCAL_PLAYER_QUERY})`),
            "the player's own decal has to be invisible in first *and* third person"
        );

        // The intent is "no shadow for the entity you are looking through", not "no shadow in first
        // person": no decal is gated on the view, and no controller is gated on either question.
        for (const path of [MOB_PARTICLE_FILE, PLAYER_PARTICLE_FILE]) {
            assert.equal(
                readFileSync(resolve(root, path), "utf-8").includes(FIRST_PERSON_QUERY),
                false,
                `${path}: the view is not what gates a decal`
            );
        }
        const wiring = readFileSync(resolve(root, CONTROLLER_FILE), "utf-8");
        for (const query of [FIRST_PERSON_QUERY, LOCAL_PLAYER_QUERY]) {
            assert.equal(
                wiring.includes(query),
                false,
                `${CONTROLLER_FILE}: the gate belongs in the particle, where the query resolves`
            );
        }
    });

    it("asks a particle only what the engine resolves there, at a format version that knows it", () => {
        // An unknown query is not a zero: the expression is rejected outright, the position component
        // is dropped and the tint goes opaque (rule 5). So this is an allow-list of the queries this
        // build has been seen to resolve in a particle, and adding one here is a deliberate act.
        // `query.is_local_player` reached Molang in 1.19.60, and a file whose format version predates it
        // reads the query as zero without a word anywhere.
        const NEEDS_LOCAL_PLAYER = "1.19.60";

        for (const path of [MOB_PARTICLE_FILE, PLAYER_PARTICLE_FILE]) {
            const text = readFileSync(resolve(root, path), "utf-8");
            for (const found of text.matchAll(/query\.[a-z_]+/g)) {
                assert.ok(
                    PARTICLE_QUERIES.includes(found[0]),
                    `${path} asks ${found[0]}, which this particle target does not resolve`
                );
            }

            if (!text.includes(LOCAL_PLAYER_QUERY)) continue;
            const declared = String(readJson(path).format_version);
            assert.ok(
                versionAtLeast(declared, NEEDS_LOCAL_PLAYER),
                `${path} asks ${LOCAL_PLAYER_QUERY}, which needs format version ${NEEDS_LOCAL_PLAYER}, but declares ${declared}`
            );
        }
    });
});

describe("Entity shadows - one emitter, forever", () => {
    it("starts the emitter once, from a state nothing can return to", () => {
        const all = controllers();
        assert.deepEqual(Object.keys(all), [CONTROLLER], "one controller serves every entity");

        const controller = all[CONTROLLER];

        // An emitter starts when a state is entered, so the decal lives in a state the controller
        // moves into -- a state's own particle_effects are not something to rely on firing.
        assert.equal(controller.initial_state, "idle");
        assert.equal(controller.states.idle.particle_effects, undefined, "the initial state draws nothing");

        // The invariant that keeps decals from stacking: a state can only be entered once, because
        // there is no path back to it and no state transitions to itself. The one condition is a
        // lifetime test rather than a physical one, because a physical query that flips over broken
        // terrain -- `query.is_on_ground` -- leaks one more decal per flip.
        assert.deepEqual(controller.states.idle.transitions, [{ shadow: "query.life_time >= 0.0" }]);
        assert.equal(controller.states.shadow.transitions, undefined, "the emitting state is permanent");
        for (const [name, state] of Object.entries<any>(controller.states)) {
            const targets = (state.transitions ?? []).map((transition: any) => Object.keys(transition)[0]);
            assert.equal(targets.includes(name), false, `${name} must not transition to itself`);
        }

        const effects = controller.states.shadow.particle_effects;
        assert.equal(effects?.length, 1, "exactly one emitter, and it is the decal");
        assert.equal(effects[0].effect, EFFECT_ALIAS);
        assert.equal(
            effects[0].pre_effect_script,
            `variable.shadow_span = query.property('${SPAN_PROPERTY}'); ` +
                `variable.shadow_alpha = query.property('${ALPHA_PROPERTY}');`,
            "the two numbers a particle cannot read for itself, handed over at emitter startup"
        );
    });

    it("publishes the surface from one scheduled pass, and nothing else", () => {
        // The ground cannot come from the decal's own Molang: `above_top_solid` and `heightmap` are
        // both rejected in a particle's context, and a local-space particle never collides with
        // terrain. So the surface is a server fact again -- one synced property, written only when
        // the column under a mob changes, and read per frame by the decal.
        const modulePath = "packs/BP/scripts/mobs/entityShadow.ts";
        assert.equal(
            existsSync(resolve(root, modulePath)),
            true,
            "the decal has to be given the surface it draws itself on"
        );

        const main = readFileSync(resolve(root, "packs/BP/scripts/main.ts"), "utf-8");
        assert.ok(main.includes("./mobs/entityShadow.js"), "a pass nothing imports never runs");

        const module = readFileSync(resolve(root, modulePath), "utf-8");
        assert.ok(module.includes(GROUND_PROPERTY), "the pass has to write the property the decal reads");
        assert.ok(module.includes("getBlockFromRay"), "an airborne mob's surface has to be found, not assumed");

        // The decal reads the surface against the entity's own height on every frame, so a pass that
        // lands a tick after the step leaves the decal on the old surface while the body rises -- the
        // bounce on every step. And a write on any difference at all re-syncs the property for feet
        // jitter a player cannot see, which is a bounce while standing still.
        assert.ok(/INTERVAL_TICKS: 1\b/.test(module), "the surface has to be current on the tick it changes");
        assert.ok(/PUBLISH_EPSILON/.test(module), "a write has to be a real move, not jitter");

        // The player binds no decal and declares no surface, so asking them for one throws once per
        // player per sweep. The guard is the difference between a quiet pass and a log full of
        // `publishGround [target: minecraft:player]` warnings.
        assert.ok(
            /if \(entity\.typeId === "minecraft:player"\) continue;/.test(module),
            "the sweep has to skip the player"
        );

        const offenders: string[] = [];
        const walk = (directory: string): void => {
            for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
                const path = `${directory}/${entry.name}`;
                if (entry.isDirectory()) walk(path);
                else if (entry.name.endsWith(".ts")) {
                    if (entry.name === "entityMigration.ts") continue;
                    const text = readFileSync(resolve(root, path), "utf-8");
                    for (const identifier of [SPAN_PROPERTY, ALPHA_PROPERTY]) {
                        if (text.includes(identifier)) offenders.push(`${path}: ${identifier}`);
                    }
                }
            }
        };
        walk("packs/BP/scripts");

        // Both numbers are declarations the resource pack reads. A script writing either of them
        // would be a shadow dependency, and the whole point of this pass was to have none.
        assert.deepEqual(offenders, []);
    });
});

describe("Entity shadows - Beta's own sprite", () => {
    it("ships misc/shadow.png's solid black disc", () => {
        const { width, height, rows } = decodePng(TEXTURE_FILE);

        // 64x64, pure black, and a *hard* disc: the alpha is 255 out to 29 of the 32 pixels of
        // half-width, 128 at 30 and nothing at 31. That fill is what ties the quad to the width drawn
        // on the ground -- there is almost no room between the disc and the sprite's edge, so a
        // declared radius maps the disc onto Java's own 2 * shadowSize quad, not something smaller.
        assert.equal(width, 64, "sprite width");
        assert.equal(height, 64, "sprite height");

        const alphaAt = (x: number, y: number) => rows[y][x * 4 + 3];
        const centre = 32;
        const opaqueRadius = (() => {
            let radius = 0;
            for (let step = 0; step < centre; step++) {
                if (alphaAt(centre + step, centre) < 250) break;
                radius = step;
            }
            return radius;
        })();

        assert.ok(
            opaqueRadius / centre >= SPRITE_DISC_RADIUS,
            `the opaque disc reaches ${opaqueRadius} of ${centre} pixels; the quad is sized for a disc ` +
                "that fills it, not for the soft blob the size would otherwise assume"
        );

        // Black, so a decal can only ever darken what is under it.
        assert.deepEqual(rows[centre].slice(centre * 4, centre * 4 + 3), [0, 0, 0], "the sprite is black");

        // And the rim is a real falloff rather than an alpha cut, which is what a blend material needs.
        const alphas = new Set(rows.flatMap((row) => row.filter((_, index) => index % 4 === 3)));
        assert.equal([...alphas].some((value) => value > 0 && value < 255), true, "the rim is a fade");
    });
});
