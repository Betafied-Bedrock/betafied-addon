import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalJson, canonicalSource, comparePacks, stripComments } from "../../scripts/lib/releaseInventory.mjs";

function write(root: string, relative: string, content: string): void {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
}

describe("Release inventory - JSON UI parsing", () => {
    it("drops comments without touching a URL or a // inside a string", () => {
        const source = [
            "{",
            '  // a whole-line comment',
            '  "url": "https://example.test/a//b",',
            '  "value": 1, /* an inline block */',
            '  "text": "a // b"',
            "}"
        ].join("\n");

        assert.deepEqual(JSON.parse(stripComments(source)), {
            url: "https://example.test/a//b",
            value: 1,
            text: "a // b"
        });
    });

    it("compares a reformatted, re-commented file as equal and a malformed one as not JSON", () => {
        const pretty = '{\r\n  "b": [ true ],\r\n  // why\r\n  "a": 1\r\n}\r\n';
        const compact = '{ "a": 1, "b": [true] }';

        assert.equal(canonicalJson(pretty), canonicalJson(compact));
        assert.equal(canonicalJson("this is not json"), null);
    });

    it("treats a rewritten script comment as the same code", () => {
        const documented = [
            "/**",
            " * Why the priority sits above the death verdict.",
            " */",
            "const LETHAL_HIT_PRIORITY = 110;"
        ].join("\n");
        const shortened = "// Above the death verdict.\nconst LETHAL_HIT_PRIORITY = 110;";

        assert.equal(canonicalSource(documented), canonicalSource(shortened));
    });
});

describe("Release inventory - packaged pack comparison", () => {
    let fromDir = "";
    let toDir = "";

    before(() => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-inventory-"));
        fromDir = path.join(root, "from");
        toDir = path.join(root, "to");

        // The 5.14 failure: a file rewritten and indented by hand, with no control changed.
        write(fromDir, "ui/screen.json", '{\n  "root_panel": {\n    "size": [ "100%", "100%" ]\n  }\n}\n');
        write(toDir, "ui/screen.json", '{ "root_panel": { "size": ["100%", "100%"] } }');

        // A real change, named at the control level.
        write(fromDir, "ui/menu.json", '{ "button_panel": { "offset": [ 0, 75 ] } }');
        write(toDir, "ui/menu.json", '{ "button_panel": { "offset": [ 0, "25%" ] } }');

        // The sources moved between folders, unchanged.
        write(fromDir, "ui/.bfui/chat.json", '{ "namespace": "chat" }');
        write(toDir, "ui/.bfui/screens/chat.json", '{ "namespace": "chat" }');

        write(fromDir, "ui/removed.json", "{}");
        write(toDir, "ui/added.json", '{ "brand_new": true }');

        // Non-JSON assets are compared byte for byte.
        fs.mkdirSync(path.join(toDir, "textures"), { recursive: true });
        fs.mkdirSync(path.join(fromDir, "textures"), { recursive: true });
        fs.writeFileSync(path.join(fromDir, "textures/icon.png"), Buffer.from([1, 2, 3]));
        fs.writeFileSync(path.join(toDir, "textures/icon.png"), Buffer.from([1, 2, 4]));
    });

    after(() => {
        fs.rmSync(path.dirname(fromDir), { recursive: true, force: true });
    });

    it("reports the change, the move and the add and remove, and stays quiet about formatting", () => {
        const result = comparePacks(fromDir, toDir);

        assert.deepEqual(result.changed, [
            { path: "textures/icon.png", controls: [] },
            { path: "ui/menu.json", controls: ["button_panel"] }
        ]);
        assert.deepEqual(result.moved, [{ from: "ui/.bfui/chat.json", to: "ui/.bfui/screens/chat.json" }]);
        assert.deepEqual(result.added, ["ui/added.json"]);
        assert.deepEqual(result.removed, ["ui/removed.json"]);
        assert.equal(result.unchanged, 1, "ui/screen.json only lost its formatting");
    });
});
