import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Linter } from "eslint";
import type { Linter as LinterTypes } from "eslint";
import plugin from "../../eslint-rules/index.mjs";

/**
 * The betafied rules read source text and answer a question about it, with no engine involved, so a
 * pass here is real evidence rather than a mirror of our own assumptions. Each case pins a boundary
 * the rule documents, including the ones it deliberately does *not* reach.
 */
function findings(code: string, options?: { max: number }): LinterTypes.LintMessage[] {
    const linter = new Linter({ configType: "flat" });
    const rule = options
        ? (["error", options] as const)
        : ("error" as const);

    return linter.verify(code, {
        plugins: { betafied: plugin },
        rules: { "betafied/comment-budget": rule },
        languageOptions: { ecmaVersion: 2022, sourceType: "module" }
    });
}

describe("The comment budget rule", () => {
    it("reports a run of own-line comments once, not once per line", () => {
        const code = `${["// one", "// two", "// three", "// four", "// five"].join("\n")}\n`;

        const messages = findings(code, { max: 4 });

        assert.equal(messages.length, 1, "one report for the block");
        assert.match(messages[0].message, /runs 5 lines/, "and it names the size it found");
        assert.equal(messages[0].line, 1, "reported at the start of the block, which is what a waiver above it needs");
    });

    it("measures a block comment by its whole extent, not by its opening line", () => {
        const code = `/**\n * a\n * b\n * c\n * d\n */\nconst x = 1;\n`;

        const messages = findings(code, { max: 4 });

        assert.equal(messages.length, 1);
        assert.match(messages[0].message, /runs 6 lines/);
    });

    it("treats a blank line as a paragraph break, so two short runs are not one long one", () => {
        const code = `// a\n// b\n// c\n\n// d\n// e\n// f\n`;

        assert.deepEqual(findings(code, { max: 4 }), [], "two blocks of three, under a cap of four");
    });

    it("leaves a trailing comment on a code line alone, because that annotates the line", () => {
        const code = ["const a = 1; // first", "const b = 2; // second", "const c = 3; // third", "const d = 4; // fourth", "const e = 5; // fifth"].join("\n");

        assert.deepEqual(findings(code, { max: 2 }), []);
    });

    it("lets a waiver suppress the block under it", () => {
        const code = `// eslint-disable-next-line betafied/comment-budget -- measured in the design spec\n/**\n * a\n * b\n * c\n * d\n */\nconst x = 1;\n`;

        assert.deepEqual(findings(code, { max: 4 }), [], "a six-line block under a waiver, and the waiver counts as used");
    });

    it("does not count a waiver as prose, so it cannot push a legal block over the cap", () => {
        const code = `// eslint-disable-next-line betafied/comment-budget -- reason\n/**\n * a\n * b\n */\nconst x = 1;\n`;

        const messages = findings(code, { max: 4 });

        assert.equal(messages.length, 1, "the block is legal, so the waiver has nothing to suppress");
        assert.equal(messages[0].ruleId, null, "and being unneeded is the proof this rule never merged the directive into the block");
    });

    it("allows one line and flags the second when nothing overrides the cap", () => {
        assert.deepEqual(findings("// one\nconst x = 1;\n"), [], "one line is the ceiling the config sets");
        assert.equal(
            findings("// one\n// two\nconst x = 1;\n").length,
            1,
            "a second line is a block, and the block is the finding"
        );
    });
});
