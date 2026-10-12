import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import {
    BETA_HOSTILE_TYPES,
    BETA_PASSIVE_TYPES
} from "../../packs/BP/scripts/core/betaRegistry.js";

/**
 * Entity shadows, as Beta 1.7.3's renderer draws them.
 *
 * The feature is a texture, two particles, one controller and the numbers each entity declares --
 * there is no script behind it, and this file exists to pin the three shape rules the engine is
 * unforgiving about, because all three reached a build before they were understood:
 *
 *  1. A billboard `direction` subsection is not usable at all. The reference names two modes,
 *     `derive_from_velocity` and `custom_direction`, and this engine rejects both -- its content log
 *     reads `particle_appearance_billboard | ParticleAppearanceBillboardComponent | The 'direction'
 *     sub section is not using a valid mode!` for `{"mode": "custom", ...}` and for
 *     `{"mode": "custom_direction", ...}` alike. A rejected direction leaves the orientation
 *     unresolved, and with `direction_z` that collapses the quad to nothing: the shadows disappeared
 *     from the world entirely. A decal therefore declares no direction at all and takes its plane
 *     from the emitter's own frame.
 *  2. A controller state starts a *new* emitter every time it is entered, and the reference ends a
 *     state's effects when that state is left: "a list of particle effects to be started upon state
 *     entry, and for those particle effects to be automatically ended when leaving the state... they
 *     will be terminated at state exit" (ParticleEntityIntegration). A state that flips on a physical
 *     query therefore restarts the decal over and over. A mob's decal has nothing to restart for, so
 *     its emitting state is reached once, from an initial state that draws nothing and has no way
 *     back. Nothing restarts a decal here: not a physical query, not the view (rule 6).
 *  3. Molang variables a `pre_effect_script` sets are readable from the *appearance* subsection but
 *     not from the position ones. `variable.shadow_lift` in `emitter_shape_point` and
 *     `particle_motion_parametric` logged
 *     `unhandled request for unknown variable 'variable.shadow_lift'` every frame of every decal --
 *     millions of lines -- and evaluated to zero. The position of a decal is therefore written with
 *     literals, or with one of the few entity queries a particle resolves (rule 5).
 *  4. A query is enabled by the *file's own* format version, and one a file's version does not know
 *     evaluates to zero with nothing in the content log to say so. `query.is_local_player` needs
 *     1.19.60 while the player's particle declared 1.10.0, so the lift that brings the local
 *     player's decal down from the camera never happened: the decal stayed on the camera and the
 *     maintainer saw their own shadow in first *and* third person.
 *  5. A particle's Molang target resolves only a handful of entity queries, and asking it for one it
 *     does not know is worse than getting zero. `query.above_top_solid(x, z)` is documented for
 *     entities and is not among them: from a particle the engine logs
 *     `particles/entity_shadow.json | ... | relative_position | 0.02 + query.above_top_solid(...)`,
 *     `unrecognized token: query.above_top_solid` and `Failed to resolve query query.` (2026-10-12
 *     11:41:35), and the damage spreads past the expression that failed --
 *     `particle_motion_parametric` is dropped, so the decal falls back to the emitter's origin and
 *     z-fights the ground it should sit above, and the tint falls back to opaque, so every decal
 *     turns pitch black. Pinning a decal to the ground is therefore not something a particle can do
 *     in this build; only queries seen to resolve here belong in one.
 *  6. A decal is drawn for every player *except the one looking through it*: the local player sees
 *     none of their own shadow in either view, and still sees everyone else's. That gate sits in the
 *     particle, multiplying the opacity by `1.0 - query.is_local_player`, because the particle is
 *     where the query has been shown to resolve -- this file's eye-height lift already depends on it --
 *     while a controller at 1.10.0 is precisely the situation rule 4 describes.
 *
 * The numbers themselves come from the 1.7.3 client, whose sources and assets were recovered into
 * the local corpus at `reference-docs/beta-1.7.3` (gitignored, like the rest of `reference-docs/`):
 *
 *  - `Render.doRenderShadowAndFire` (Render.java:237) draws a shadow only under fancy graphics and
 *    only for a renderer whose `shadowSize` (`Render.java:9`) is above zero, with
 *    `alpha = (1 - distanceSquared / 256) * field_194_c`; `field_194_c` is 1.0 for every entity.
 *    `RenderManager.func_851_a` (RenderManager.java:125) is the *squared* distance to the camera, so
 *    a shadow is gone past sixteen blocks, and the entity's own opacity is *multiplied* by that
 *    falloff rather than reduced by a fixed share of it.
 *  - `Render.renderShadowOnBlock` (Render.java:135) paints the decal on the block's top face plus
 *    1/64 and gives it `((shadowAlpha - (entityCenterY - blockY) / 2) * 0.5) * light`. For an entity
 *    standing there, `entityCenterY - blockY` is half its height, so the full-light, zero-distance
 *    alpha is `0.5 - height / 8` -- the second number each entity declares.
 *  - Its UVs run `(entity - vertex) / 2 / shadowSize + 0.5` (Render.java:159-162), so the sprite Java
 *    maps spans `2 * shadowSize` of world space: the decal quad is *twice* the renderer constant.
 *    That sprite is `misc/shadow.png`, byte-identical to this pack's
 *    `textures/particle/entity_shadow.png` (one SHA-256), and its disc is nearly solid -- fully
 *    opaque out to 29 of the sprite's 32 pixels of half-width, half alpha at 30 and nothing at 31 --
 *    so the shape Java lays on the ground is `2 * 0.9375 * shadowSize`, about `1.875 * shadowSize`,
 *    across.
 *  - A decal therefore declares the renderer constant itself, because Bedrock's billboard `size` is a
 *    *radius* and not a width: Microsoft's particle tutorial reads "the width and height of this plane
 *    can be defined, where each value is the radius. This means that setting the size to 1 by 1 would
 *    make it 2 by 2 blocks". A radius of `shadowSize` draws a quad of `2 * shadowSize` -- Java's own
 *    sprite -- so the disc inside it lands at the width Java drew. That declaration has now held three
 *    different numbers: `shadowSize` (a halving made from a maintainer's eye, with no source), then
 *    `2 * shadowSize` (this file reading `size` as the quad's full width instead of its radius), and
 *    back to `shadowSize` when the doubled decals reached the game and the maintainer reported them as
 *    "at least double the size of what they should be". The radius convention is the fact that
 *    separates the two readings, and it is the one to re-read before touching a span.
 *  - `Entity.getShadowSize` (Entity.java:869) is `height / 2`, and the renderer sizes come from the
 *    constructors in `RenderManager.java:27-41`.
 *
 * What a client still cannot reproduce, and this pack therefore does not:
 *
 *  - the `getLightBrightness` multiplier and the `> 3` light test around it, so a decal here is as
 *    dark in a dark room as in daylight, where Beta faded it out and skipped it entirely;
 *  - `block.renderAsNormalBlock()`, so a decal can cover a slab, a stair or farmland that Beta
 *    clipped;
 *  - the `fancyGraphics` switch, so a fast-graphics client draws decals Beta would not have.
 */
const LEGACY_ROSTER_IDS: Readonly<Record<string, string>> = Object.freeze({
    // Bedrock renamed the pigman and kept the old id working; the pack ships the old definition.
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
 * face that the decal z-fights it in Bedrock's depth buffer. Two centimetres is the clearance this
 * pack has always used, and it is a deliberate deviation.
 */
const SURFACE_CLEARANCE = 0.02;

/** The eye offset a local player's decal is measured down from; for a remote player, nothing. */
const PLAYER_EYE_HEIGHT = 1.62;

const ENTITIES_DIR = "packs/BP/entities";
const ENTITY_DIR = "packs/RP/entity";
const CONTROLLER_FILE = "packs/RP/animation_controllers/entity_shadow.animation_controllers.json";
const MOB_PARTICLE_FILE = "packs/RP/particles/entity_shadow.json";
const PLAYER_PARTICLE_FILE = "packs/RP/particles/entity_shadow_player.json";
const TEXTURE_FILE = "packs/RP/textures/particle/entity_shadow.png";

const CONTROLLER = "controller.animation.betarock.entity_shadow";
const EFFECT_ALIAS = "bh_entity_shadow";
const MOB_PARTICLE_ID = "bh:entity_shadow";
const PLAYER_PARTICLE_ID = "bh:entity_shadow_player";
const SPAN_PROPERTY = "betarock:shadow_span";
const ALPHA_PROPERTY = "betarock:shadow_alpha";
const PLAYER_TYPE = "minecraft:player";
const LOCAL_PLAYER_QUERY = "query.is_local_player";
const FIRST_PERSON_QUERY = "query.is_first_person";
const DISTANCE_QUERY = "query.distance_from_camera";

/** The entity queries that have been seen to resolve inside a particle, and no others. */
const PARTICLE_QUERIES: readonly string[] = Object.freeze([DISTANCE_QUERY, LOCAL_PLAYER_QUERY]);

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

/** Whether a dotted format version is at least `minimum`: 1.21.60 is, 1.8.0 is not. */
function versionAtLeast(declared: string, minimum: string): boolean {
    const mine = declared.split(".").map(Number);
    const theirs = minimum.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        if ((mine[i] ?? 0) !== (theirs[i] ?? 0)) return (mine[i] ?? 0) > (theirs[i] ?? 0);
    }
    return true;
}

function components(path: string): Record<string, any> {
    return readJson(path).particle_effect.components;
}

function positionExpressions(path: string): string[] {
    const found = components(path);
    return [
        found["minecraft:emitter_shape_point"].offset[1],
        found["minecraft:particle_motion_parametric"].relative_position[1]
    ];
}

function controllers(): Record<string, any> {
    return readJson(CONTROLLER_FILE).animation_controllers;
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

/** The shadow controller a client entity runs, or undefined when it binds no decal. */
function wiredController(definition: any): string | undefined {
    const declared = definition["minecraft:client_entity"]?.description?.animations?.[EFFECT_ALIAS];
    if (typeof declared === "string") return declared;

    for (const entry of legacyControllerTable(definition) ?? []) {
        for (const [alias, identifier] of Object.entries<any>(entry)) {
            if (alias === EFFECT_ALIAS) return String(identifier);
        }
    }

    return undefined;
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
        }
    });

    it("writes float property numbers with a decimal point", () => {
        // The engine takes `0.7` and rejects `0` or `4` with
        // "Error loading property 'betarock:shadow_drop': 'default' value does not match the specified
        // type 'float'" followed by "'range' array should contain only 'float' type elements".
        const offenders: string[] = [];

        for (const typeId of betaRoster()) {
            if (javaShadow(typeId) === undefined) continue;
            const path = entityPath(typeId);
            const text = readFileSync(resolve(root, path), "utf-8");

            for (const identifier of [SPAN_PROPERTY, ALPHA_PROPERTY]) {
                for (const literal of propertyLiterals(text, identifier)) {
                    // A Molang default is a string and the schema takes it as-is; a number is not.
                    if (literal.startsWith('"')) continue;
                    if (!Number.isFinite(Number(literal)) || !literal.includes(".")) {
                        offenders.push(`${path}: ${identifier} declares ${literal}, not a float literal`);
                    }
                }
            }
        }

        assert.deepEqual(offenders, []);
    });

    it("swaps Bedrock's own collision-box shadow out on every Beta mob", () => {
        for (const typeId of betaRoster()) {
            const path = entityPath(typeId);
            const components_ = readJson(path)["minecraft:entity"].components;

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
});

describe("Entity shadows - how each client entity runs it", () => {
    it("binds the decal and plays the controller that draws it", () => {
        for (const typeId of betaRoster()) {
            const path = clientEntityPath(typeId);
            assert.ok(existsSync(resolve(root, path)), `no client entity at ${path}`);

            const definition = readJson(path);
            const description = definition["minecraft:client_entity"].description;

            if (javaShadow(typeId) === undefined) {
                // A ghast draws no decal in Beta, so its client entity binds no emitter -- and keeps
                // the swap all the same, or Bedrock would draw one.
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

    it("only runs the controller on entities that declare both numbers", () => {
        // The pre_effect_script reads `query.property('betarock:shadow_span')` with no guard, which is
        // only safe while every client entity wired to the controller belongs to an entity that
        // declares the pair. A stray binding is a per-frame
        // "query.property: property does not exist, consider using query.has_property." instead.
        for (const typeId of betaRoster()) {
            const definition = readJson(clientEntityPath(typeId));
            const description = definition["minecraft:client_entity"].description;
            const wired = wiredController(definition) !== undefined;
            if (!wired) continue;

            const declaration = readJson(entityPath(typeId))["minecraft:entity"].description.properties ?? {};
            assert.ok(declaration[SPAN_PROPERTY], `${typeId} runs the controller without ${SPAN_PROPERTY}`);
            assert.ok(declaration[ALPHA_PROPERTY], `${typeId} runs the controller without ${ALPHA_PROPERTY}`);
        }
    });
});

describe("Entity shadows - the decal itself", () => {
    it("draws a flat disc on the ground, one per entity, for as long as the entity lives", () => {
        for (const typeId of betaRoster()) {
            if (javaShadow(typeId) === undefined) continue;
            const path = particleFile(typeId);
            const found = components(path);

            assert.equal(readJson(path).particle_effect.description.identifier, particleId(typeId));
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
            assert.deepEqual(
                billboard.uv,
                { texture_width: 64, texture_height: 64, uv: [0, 0], uv_size: [64, 64] },
                `${path}: the whole sprite covers the quad`
            );

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
            assert.deepEqual(tint.slice(0, 3), ["1", "1", "1"], `${path}: the sprite is black`);
            assert.ok(tint[3].includes(DISTANCE_QUERY), `${path}: the renderer's distance falloff`);
            assert.ok(tint[3].includes("variable.shadow_alpha"), `${path}: the entity's own opacity`);
            // Java multiplies the entity's opacity by that falloff; reducing it by a fixed share of the
            // falloff instead makes a small decal fade out at a different rate than Beta's, so the
            // product is the part of the expression worth pinning.
            assert.ok(
                tint[3].includes("variable.shadow_alpha * (1 - "),
                `${path}: the distance falloff multiplies the entity's own opacity`
            );
        }
    });

    it("never declares a billboard direction, which no engine mode can satisfy", () => {
        for (const path of [MOB_PARTICLE_FILE, PLAYER_PARTICLE_FILE]) {
            const text = readFileSync(resolve(root, path), "utf-8");
            assert.equal(
                "direction" in components(path)["minecraft:particle_appearance_billboard"],
                false,
                `${path}: the subsection has to be absent, not merely named differently`
            );
            for (const mode of ["derive_from_velocity", "custom_direction", "custom"]) {
                assert.equal(text.includes(mode), false, `${path}: ${mode} was rejected by the engine`);
            }
        }
    });

    it("places the decal without reading a variable it cannot see", () => {
        // A `pre_effect_script` variable resolves in the appearance subsection only. Read from the
        // position ones it is unknown on every frame of every decal, and evaluates to zero.
        for (const [typeId, expected] of [
            ["minecraft:pig", `${SURFACE_CLEARANCE}`],
            [PLAYER_TYPE, `${SURFACE_CLEARANCE} - (${LOCAL_PLAYER_QUERY} ? ${PLAYER_EYE_HEIGHT} : 0.0)`]
        ] as const) {
            const path = particleFile(typeId);
            for (const expression of positionExpressions(path)) {
                // A literal is written as a number and an expression as a string; only the text matters.
                assert.equal(String(expression), expected, `${path}: the decal has to be born where it belongs`);
                assert.equal(
                    String(expression).includes("variable."),
                    false,
                    `${path}: a variable here is an unknown-variable error on every frame`
                );
            }
        }

        // The local player's emitter hangs off the camera, so its decal is measured back down to the
        // ground; every other entity's is already at its own feet, and a remote player's merely at the
        // model's origin.
        assert.equal(
            components(PLAYER_PARTICLE_FILE)["minecraft:emitter_shape_point"].offset[1],
            components(PLAYER_PARTICLE_FILE)["minecraft:particle_motion_parametric"].relative_position[1],
            "a decal that spawns inside the ground and is lifted a frame later flickers"
        );
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
        assert.equal(
            components(MOB_PARTICLE_FILE)["minecraft:particle_appearance_tinting"].color[3].includes(LOCAL_PLAYER_QUERY),
            false,
            "a mob's decal is not about the local player"
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

    it("asks a particle only what the engine resolves there", () => {
        // An unknown query is not a zero: the expression is rejected outright, the position component
        // is dropped and the tint goes opaque (rule 5). So this is an allow-list of the queries this
        // build has been seen to resolve in a particle, and adding one here is a deliberate act.
        for (const path of [MOB_PARTICLE_FILE, PLAYER_PARTICLE_FILE]) {
            const text = readFileSync(resolve(root, path), "utf-8");
            for (const found of text.matchAll(/query\.[a-z_]+/g)) {
                assert.ok(
                    PARTICLE_QUERIES.includes(found[0]),
                    `${path} asks ${found[0]}, which this particle target does not resolve`
                );
            }
        }
    });

    it("declares a format version new enough for the questions it asks", () => {
        // `query.is_local_player` reached Molang in 1.19.60, and a file whose format version predates
        // it reads the query as zero without a word anywhere.
        const gates: ReadonlyArray<readonly [string, string]> = [[LOCAL_PLAYER_QUERY, "1.19.60"]];

        for (const path of [MOB_PARTICLE_FILE, PLAYER_PARTICLE_FILE]) {
            const text = readFileSync(resolve(root, path), "utf-8");
            const declared = String(readJson(path).format_version);

            for (const [query, minimum] of gates) {
                if (!text.includes(query)) continue;
                assert.ok(
                    versionAtLeast(declared, minimum),
                    `${path} asks ${query}, which needs format version ${minimum}, but declares ${declared}`
                );
            }
        }
    });
});

describe("Entity shadows - one emitter, forever", () => {
    it("starts the emitter once, from a state nothing can return to", () => {
        const all = controllers();
        assert.deepEqual(Object.keys(all), [CONTROLLER], "one controller serves every entity");

        const controller = all[CONTROLLER];
        assert.deepEqual(Object.keys(controller.states).sort(), ["idle", "shadow"]);

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

    it("leaves the shadow to the client", () => {
        // A script that published where the ground was used to sit behind this feature. Every part of
        // that design is gone: the decal finds the ground from entity queries in its own resource-pack
        // expressions, so no server-side pass runs per tick, and the two declared numbers are read by
        // the resource pack.
        assert.equal(
            existsSync(resolve(root, "packs/BP/scripts/mobs/entityShadow.ts")),
            false,
            "the shadow must not need a server-side pass"
        );

        const main = readFileSync(resolve(root, "packs/BP/scripts/main.ts"), "utf-8");
        assert.equal(main.includes("entityShadow"), false, "and nothing may import one");

        const offenders: string[] = [];
        const walk = (directory: string): void => {
            for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
                const path = `${directory}/${entry.name}`;
                if (entry.isDirectory()) walk(path);
                else if (entry.name.endsWith(".ts")) {
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

        assert.equal(alphaAt(centre, centre), 255, "the middle of the disc is fully opaque");
        assert.ok(
            opaqueRadius / centre >= SPRITE_DISC_RADIUS,
            `the opaque disc reaches ${opaqueRadius} of ${centre} pixels; the quad is sized for a disc ` +
                "that fills it, not for the soft blob the size would otherwise assume"
        );

        // The exact profile, because it is the number the span is derived from: a sprite swapped for a
        // soft blob would still satisfy the threshold above while shrinking what a decal covers.
        assert.equal(alphaAt(centre + 30, centre), 128, "the rim fades over the last pixel of the disc");
        assert.equal(alphaAt(centre + 31, centre), 0, "the disc stops a pixel short of the sprite's edge");

        // Nothing reaches the sprite's edge, so the quad's corners are empty and no two decals meet.
        for (const [x, y] of [
            [0, 0], [63, 0], [0, 63], [63, 63],
            [0, centre], [centre, 0], [63, centre], [centre, 63]
        ] as const) {
            assert.equal(alphaAt(x, y), 0, `the disc must not reach the sprite's edge at ${x},${y}`);
        }

        // Black, so a decal can only ever darken what is under it.
        assert.deepEqual(rows[centre].slice(centre * 4, centre * 4 + 3), [0, 0, 0], "the sprite is black");

        // And the rim is a real falloff rather than an alpha cut, which is what a blend material needs.
        const alphas = new Set(rows.flatMap((row) => row.filter((_, index) => index % 4 === 3)));
        assert.ok(alphas.size > 2, "the sprite has to carry a real gradient");
        assert.equal([...alphas].some((value) => value > 0 && value < 255), true, "the rim is a fade");
    });
});
