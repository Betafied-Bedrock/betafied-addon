import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { decodePng } from "../../scripts/lib/betaColorizer.mjs";
import { DEATH_SCREEN_COPY } from "../../packs/BP/scripts/player/deathScreen.js";

const root = process.cwd();
const DEATH_SCREEN_PATH = "packs/RP/ui/.bfui/death_screen.json";
const SERVER_FORM_PATH = "packs/RP/ui/server_form.json";

function readUiJson(path: string): any {
    const withoutComments = readFileSync(resolve(root, path), "utf-8")
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");

    return JSON.parse(withoutComments);
}

function argbToRgba(value: number): number[] {
    const packed = value >>> 0;
    return [
        (packed >>> 16 & 255) / 255,
        (packed >>> 8 & 255) / 255,
        (packed & 255) / 255,
        (packed >>> 24 & 255) / 255
    ];
}

function textArgbToRgba(value: number): number[] {
    const rgba = argbToRgba(value);
    rgba[3] = 1;
    return rgba;
}

const GRADIENT_TOP_ARGB = 1615855616; // 0x60500000
const GRADIENT_BOTTOM_ARGB = -1602211792; // 0xA0803030
const ENABLED_TEXT_ARGB = 14737632; // 0xE0E0E0
const HOVERED_TEXT_ARGB = 16777120; // 0xFFFFA0
const DISABLED_TEXT_ARGB = -6250336; // 0xFFA0A0A0

function assertRgba(actual: number[], expected: number[], what: string): void {
    assert.equal(actual.length, 4, `${what}: four channels`);
    actual.forEach((channel, index) => {
        assert.ok(
            Math.abs(channel - expected[index]) < 1e-6,
            `${what}: channel ${index} is ${channel}, expected ${expected[index]}`
        );
    });
}

describe("Beta death screen - resource pack contract", () => {
    const screen = readUiJson(DEATH_SCREEN_PATH);
    const serverForm = readUiJson(SERVER_FORM_PATH);

    it("takes over the engine's form screen and drops its transitions", () => {
        assert.equal(serverForm.namespace, "server_form");

        const screenControl = serverForm["third_party_server_screen@common.base_screen"];
        assert.equal(screenControl.$screen_content, "server_form.main_screen_content");
        assert.deepEqual(screenControl.$screen_animations, []);
        assert.deepEqual(screenControl.$background_animations, []);
        assert.equal(screenControl.$use_loading_bars, false);
        assert.deepEqual(screenControl.button_mappings, [
            { from_button_id: "button.menu_cancel", to_button_id: "button.menu_exit", mapping_type: "global" }
        ]);
        assert.equal(screenControl.$screen_bg_content, "bfui-death_screen.screen_underlay");
    });

    it("keeps the factory's data context, but points it at a control of its own", () => {
        const content = serverForm.main_screen_content;
        assert.deepEqual(content.size, ["100%", "100%"]);

        const factory = content.controls[0].server_form_factory;
        assert.equal(factory.type, "factory");
        assert.deepEqual(factory.control_ids, {
            long_form: "@bfui-death_screen.form_root",
            custom_form: "@server_form.custom_form"
        });
    });

    // `server_form.long_form` is the engine's own name for the tree every ActionFormData in the game is
    // drawn through, and another pack's form router legitimately owns it. Redefining it here is what put
    // the death screen on top of every other pack's form; the router below is the death screen's, and
    // everything else has to reach the name untouched.
    it("leaves the engine's long_form name to whoever else defines it", () => {
        assert.equal(serverForm.long_form, undefined, "the pack must not claim server_form.long_form");

        const fallback = screen.form_root.controls.find((control: any) => "other_form@server_form.long_form" in control);
        assert.ok(fallback, "every other form has to be handed on to server_form.long_form");
    });

    it("shows the death tree only for the death form, and hands every other title on", () => {
        const root = screen.form_root;
        assert.deepEqual(root.size, ["100%", "100%"]);
        assert.equal(root.layer, 2, "the content's own layer is what puts it above the background slot");
        assert.equal(
            root.$death_title,
            DEATH_SCREEN_COPY.title,
            "the router keys on the title the script sends, so the two cannot drift"
        );

        const death = root.controls.find((control: any) => "death_screen@bfui-death_screen.root_panel" in control);
        assert.ok(death, "the death screen tree lives in the router");
        assert.deepEqual(death["death_screen@bfui-death_screen.root_panel"].bindings, [
            {
                binding_type: "view",
                source_property_name: "(#title_text = $death_title)",
                target_property_name: "#visible"
            },
            { binding_type: "view", source_property_name: "#visible", target_property_name: "#enabled" }
        ]);

        const other = root.controls.find((control: any) => "other_form@server_form.long_form" in control);
        assert.deepEqual(other["other_form@server_form.long_form"].bindings, [
            {
                binding_type: "view",
                source_property_name: "(not (#title_text = $death_title))",
                target_property_name: "#visible"
            },
            { binding_type: "view", source_property_name: "#visible", target_property_name: "#enabled" }
        ]);
    });

    // The background slot is shared by every form the screen draws, modal forms included, so the wash and
    // the redrawn HUD can only exist for the death form's own title. Left unset, the slot's `common.base_screen`
    // default is an empty panel - which is the whole background vanilla's `third_party_server_screen` has.
    it("draws the wash and the redrawn HUD for the death form only", () => {
        const underlay = screen.screen_underlay;
        assert.equal(underlay.$death_title, DEATH_SCREEN_COPY.title);

        const names = underlay.controls.map((control: any) => Object.keys(control)[0]);
        assert.deepEqual(names, ["death_underlay"]);

        const deathUnderlay = underlay.controls[0].death_underlay;
        assert.deepEqual(deathUnderlay.bindings, [
            {
                binding_type: "view",
                source_property_name: "(#title_text = $death_title)",
                target_property_name: "#visible"
            }
        ]);
        assert.deepEqual(
            deathUnderlay.controls.map((control: any) => Object.keys(control)[0]),
            ["hud@bfui-death_screen.hud", "wash@bfui-death_screen.wash"],
            "the era's paint order: the HUD, then the wash over it"
        );
    });

    it("registers the skin, since a custom tree is not loaded by name alone", () => {
        const defs = readUiJson("packs/RP/ui/_ui_defs.json");
        assert.ok(defs.ui_defs.includes("ui/.bfui/death_screen.json"));
        assert.ok(existsSync(resolve(root, DEATH_SCREEN_PATH)));
    });

    it("reproduces the era's gradient rectangle as a texture, not through gradient_renderer", () => {
        const gradient = screen.wash;
        assert.equal(gradient.type, "image");
        assert.equal(gradient.texture, "textures/ui/death_gradient");
        assert.deepEqual(gradient.size, ["100%", "100%"], "the wash covers the screen it is drawn on");
        assert.equal(gradient.keep_ratio, false, "keep_ratio's default fits the sprite and centres it");
        assert.equal(gradient.fill, true, "fill is what stretches the sprite to its rect");

        const texturePath = gradient.texture.replace("textures/", "packs/RP/textures/") + ".png";
        assert.ok(existsSync(resolve(root, texturePath)), `missing texture ${texturePath}`);

        const decoded = decodePng(readFileSync(resolve(root, texturePath)));
        assert.equal(decoded.channels, 4, "a wash that hides the world needs an alpha channel");
        assert.ok(decoded.height > 1, "a one-row file cannot interpolate anything");

        const top = argbToRgba(GRADIENT_TOP_ARGB).map((channel) => channel * 255);
        const bottom = argbToRgba(GRADIENT_BOTTOM_ARGB).map((channel) => channel * 255);
        for (const y of [0, Math.floor(decoded.height / 2), decoded.height - 1]) {
            const along = y / (decoded.height - 1);
            for (let channel = 0; channel < 4; channel++) {
                const actual = decoded.pixels[y * decoded.stride + channel];
                const expected = top[channel] + (bottom[channel] - top[channel]) * along;
                assert.ok(
                    Math.abs(actual - expected) <= 1,
                    `row ${y} channel ${channel}: ${actual} is not within rounding of ${expected}`
                );
            }
        }

        assert.ok(top[3] < 255 && bottom[3] < 255);
    });

    it("draws the header at the era's doubled scale", () => {
        const title = screen.title;
        assert.equal(title.text, "#title_text");
        assert.equal(title.bindings[0].binding_name, "#title_text");
        assert.equal(title.font_scale_factor, 2.0);
        assert.equal(title.shadow, true, "drawCenteredString renders with a shadow");
        assert.deepEqual(title.color, [1, 1, 1, 1]);
        assert.deepEqual(title.offset, [0, 44], "the doubled baseline at 60 puts the box top at 44");
    });

    it("draws the score row unscaled, below the header", () => {
        const score = screen.score;
        assert.equal(score.text, "#form_text");
        assert.equal(score.bindings[0].binding_name, "#form_text");
        assert.equal(
            score.property_bag["#form_text"],
            DEATH_SCREEN_COPY.body,
            "the score row's fallback and the script's copy are one string"
        );
        assert.equal(score.font_scale_factor, undefined, "the score row is the era's 8px font, not doubled");
        assert.deepEqual(score.offset, [0, 92], "baseline 100 puts the box top at 92");
        assert.equal(score.shadow, true);
    });

    it("stacks the buttons a quarter of the screen down, plus the era's 72", () => {
        const layout = screen.button_layout;
        assert.equal(layout.type, "stack_panel");
        assert.equal(layout.orientation, "vertical");
        assert.equal(layout.anchor_from, layout.anchor_to);
        assert.deepEqual(layout.offset, [0, "25%"]);
        assert.deepEqual(layout.controls[0].era_offset.size, ["0px", "72px"]);
        assert.ok("buttons@bfui-death_screen.form_buttons" in layout.controls[1]);
    });

    it("leaves no asymmetric anchor pair anywhere in the tree", () => {
        const offenders: string[] = [];
        const walk = (node: any, path: string): void => {
            if (node === null || typeof node !== "object") return;
            if (node.anchor_from !== undefined && node.anchor_to !== undefined && node.anchor_from !== node.anchor_to) {
                offenders.push(`${path}: ${node.anchor_from} / ${node.anchor_to}`);
            }

            for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
        };
        walk(screen, "$");

        assert.deepEqual(offenders, []);
    });

    it("keeps GuiButton's metrics and its three widget states", () => {
        const buttons = screen["button@common_buttons.light_text_button"];

        assert.deepEqual(buttons.size, [200, 20]);
        assert.deepEqual(buttons.$button_pressed_offset, [0, 0]);
        assert.equal(buttons.$default_button_texture, "textures/ui/vanilla_default");
        assert.equal(buttons.$hover_button_texture, "textures/ui/vanilla_pressed");
        assert.equal(buttons.$pressed_button_texture, "textures/ui/vanilla_pressed");
        assert.equal(buttons.$locked_button_texture, "textures/ui/vanilla_locked");

        for (const key of ["$default_button_texture", "$hover_button_texture", "$pressed_button_texture", "$locked_button_texture"]) {
            const texture = buttons[key].replace("textures/", "packs/RP/textures/") + ".png";
            assert.ok(existsSync(resolve(root, texture)), `missing texture ${texture}`);
        }

        assertRgba(buttons.$default_text_color, textArgbToRgba(ENABLED_TEXT_ARGB), "enabled text");
        assertRgba(buttons.$hover_text_color, textArgbToRgba(HOVERED_TEXT_ARGB), "hovered text");
        assertRgba(buttons.$pressed_text_color, textArgbToRgba(HOVERED_TEXT_ARGB), "pressed text");
        assertRgba(buttons.$locked_text_color, textArgbToRgba(DISABLED_TEXT_ARGB), "disabled text");
    });

    it("drives the button list from the engine's own form collection", () => {
        const list = screen.form_buttons;
        assert.equal(list.type, "stack_panel");
        assert.equal(list.orientation, "vertical");
        assert.equal(list.collection_name, "form_buttons");
        assert.equal(list.factory.control_ids.button, "bfui-death_screen.button_item");
        assert.deepEqual(list.bindings[0], {
            binding_name: "#form_button_contents",
            binding_name_override: "#collection_length"
        });

        const button = screen["button@common_buttons.light_text_button"];
        assert.equal(button.$button_text, "#form_button_text");
        assert.equal(button.$button_text_binding_type, "collection");
        assert.equal(button.$button_text_grid_collection_name, "form_buttons");
        assert.ok(
            (button.bindings ?? []).some((binding: any) =>
                binding.binding_type === "collection_details" && binding.binding_collection_name === "form_buttons"
            ),
            "the item has to be bound to the collection it is drawn from"
        );

        assert.equal(screen.button_item.size[1], 24);
        assert.equal(button.size[1], 20);
    });

    it("redraws the era's HUD where renderGameOverlay put it", () => {
        const controls = screen.hud.controls;
        const names = controls.map((control: any) => Object.keys(control)[0]);
        assert.equal(names[0], "hotbar@bfui-death_screen.hotbar");

        const underlay = screen.screen_underlay.controls[0].death_underlay.controls.map((control: any) => Object.keys(control)[0]);
        assert.deepEqual(underlay, ["hud@bfui-death_screen.hud", "wash@bfui-death_screen.wash"]);

        for (const name of ["title@bfui-death_screen.title", "button_layout@bfui-death_screen.button_layout"]) {
            assert.ok(
                screen.root_panel.controls.some((control: any) => name in control),
                `${name} belongs to the content, over the wash`
            );
        }

        const hotbar = screen.hotbar;
        assert.equal(hotbar.texture, "textures/gui/gui");
        assert.deepEqual(hotbar.uv, [0, 0]);
        assert.deepEqual(hotbar.size, [182, 22]);
        assert.equal(hotbar.anchor_from, "bottom_middle");
        assert.equal(hotbar.anchor_to, "bottom_middle");
        assert.equal(hotbar.offset, undefined, "the bar's own bottom edge is the screen's");

        const selector = screen.hotbar_selector;
        assert.equal(selector.texture, "textures/gui/gui");
        assert.deepEqual(selector.uv, [0, 22]);
        assert.deepEqual(selector.size, [24, 22]);
        assert.deepEqual(selector.offset, [-80, -1]);

        for (let index = 0; index < 10; index++) {
            const heart = controls.find((control: any) => `heart_${index}@bfui-death_screen.heart` in control);
            assert.ok(heart, `heart ${index} is missing from the era's row of ten`);
            assert.deepEqual(
                heart[`heart_${index}@bfui-death_screen.heart`].offset,
                [-86.5 + index * 8, -23]
            );
        }
        assert.equal(screen.heart.type, "panel");
        assert.deepEqual(screen.heart.size, [9, 9]);
        assert.equal(screen.heart.texture, undefined);
        assert.equal(screen.heart_sprite.texture, "textures/gui/icons");
        assert.deepEqual(screen.heart_sprite.uv, [16, 0]);
        assert.deepEqual(screen.heart_sprite.size, [9, 9]);

        assert.equal(screen.crosshair_pixel.renderer, "gradient_renderer");
        assert.equal(screen.crosshair_pixel.anchor_from, "center");
        assert.equal(screen.crosshair_pixel.anchor_to, "center");

        const arms: Record<string, number[]> = {};
        for (const control of controls) {
            const name = Object.keys(control)[0];
            if (name.startsWith("crosshair_")) arms[name] = control[name].size;
        }
        assert.deepEqual(arms, {
            "crosshair_arm_horizontal@bfui-death_screen.crosshair_pixel": [9, 1],
            "crosshair_arm_vertical@bfui-death_screen.crosshair_pixel": [1, 9],
            "crosshair_centre@bfui-death_screen.crosshair_pixel": [1, 1]
        });
    });

    it("shakes the hearts the way the era's low-health jitter does", () => {
        const sets = new Set<string>();

        for (let index = 0; index < 10; index++) {
            const name = `heart_${index}@bfui-death_screen.heart`;
            const entry = screen.hud.controls.find((control: any) => name in control);
            assert.ok(entry, `heart ${index} is missing from the era's row of ten`);

            const sprite = entry[name].controls[0]["heart_sprite@bfui-death_screen.heart_sprite"];
            assert.equal(sprite.anims.length, 1, `heart ${index}: one jitter set`);
            sets.add(sprite.anims[0]);

            const anim = screen[sprite.anims[0].replace("@bfui-death_screen.", "")];
            assert.ok(anim, `heart ${index}: ${sprite.anims[0]} is missing`);
            assert.equal(anim.anim_type, "offset");
            assert.deepEqual(anim.from, [0, 0]);
            assert.deepEqual(anim.to, [0, 1], "the era only ever adds 0 or 1 to y");
            assert.equal(anim.easing, "linear");
            assert.equal(anim.next, sprite.anims[0], `heart ${index}: ${sprite.anims[0]} has to loop`);
            assert.ok(
                anim.duration > 0 && anim.duration <= 0.1,
                `heart ${index}: the era re-rolls the jitter every tick, not every ${anim.duration}s`
            );
        }

        assert.equal(screen.heart_sprite.anims.length, 1);
        assert.ok(sets.size >= 3, `the hearts share only ${sets.size} jitter period(s)`);

        const periods = [...sets].map((set: string) => screen[set.replace("@bfui-death_screen.", "")].duration);
        assert.equal(new Set(periods).size, periods.length, "staggered periods, or the row moves as one");
    });

    it("draws that HUD from the era's own sprite sheets rather than a lookalike", () => {
        const eraDir = "reference-docs/beta-1.7.3/1.7.3-LTS/temp/bin/minecraft/gui";
        const crops = [
            { pack: "packs/RP/textures/gui/icons.png", era: `${eraDir}/icons.png`, control: screen.heart_sprite, label: "empty heart container" },
            { pack: "packs/RP/textures/gui/gui.png", era: `${eraDir}/gui.png`, control: screen.hotbar, label: "hotbar bar" },
            { pack: "packs/RP/textures/gui/gui.png", era: `${eraDir}/gui.png`, control: screen.hotbar_selector, label: "selection frame" }
        ];

        for (const crop of crops) {
            assert.ok(existsSync(resolve(root, crop.pack)), `missing texture ${crop.pack}`);
            assert.ok(existsSync(resolve(root, crop.era)), `missing era sheet ${crop.era}`);

            const packed = decodePng(readFileSync(resolve(root, crop.pack)));
            const era = decodePng(readFileSync(resolve(root, crop.era)));
            const [x, y] = crop.control.uv;
            const [width, height] = crop.control.size;

            assert.deepEqual(
                crop.control.uv_size,
                crop.control.size,
                `${crop.label}: the drawn crop and the verified crop have to be the same rect`
            );

            let differing = 0;
            for (let row = 0; row < height; row++) {
                for (let column = 0; column < width; column++) {
                    const at = (image: any, cx: number, cy: number): number[] =>
                        [...image.pixels.slice(
                            (y + cy) * image.stride + (x + cx) * image.channels,
                            (y + cy) * image.stride + (x + cx) * image.channels + image.channels
                        )];
                    if (at(packed, column, row).join() !== at(era, column, row).join()) differing++;
                }
            }

            assert.equal(
                differing,
                0,
                `${crop.label} at ${x},${y}: ${differing} of ${width * height} pixels differ from the era's own sheet`
            );
        }
    });
});
