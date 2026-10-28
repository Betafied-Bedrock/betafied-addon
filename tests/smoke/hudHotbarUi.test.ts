import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HUD_SCREEN_PATH = "packs/RP/ui/hud_screen.json";

function readUiJson(path: string): any {
    const withoutComments = readFileSync(resolve(process.cwd(), path), "utf-8")
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");

    return JSON.parse(withoutComments);
}

describe("Beta HUD hotbar - resource pack contract", () => {
    const hud = readUiJson(HUD_SCREEN_PATH);

    it("adds its padding by modification instead of re-listing vanilla's hotbar children", () => {
        // 1.26.60 moved the slot painting into hotbar_grid_frame; a pinned controls list silently
        // drops whatever vanilla adds, which is what made the bar disappear in that version.
        const panel = hud.hotbar_panel;
        assert.equal(
            panel?.controls,
            undefined,
            "re-listing hotbar_panel.controls drops children a future vanilla version adds"
        );

        const addedBy = (name: string) => (panel?.modifications ?? [])
            .filter((modification: any) => modification.value.some((control: any) => name in control))
            .map((modification: any) => modification.operation);

        assert.deepEqual(addedBy("left_pudding"), ["insert_front"], "left padding belongs before the caps");
        assert.deepEqual(addedBy("right_pudding"), ["insert_back"], "right padding belongs after the caps");
    });
});
