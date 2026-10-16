import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractChangelogSection, releaseVersionFrom } from "../../scripts/lib/changelog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Release version derivation", () => {
  it("derives the tag the packs use, and reads nothing it cannot parse", () => {
    const derivations: Array<[string | undefined, string | null]> = [
      // A .0 triple collapses to the major.minor tag; a real patch digit survives, so a fix-up
      // release can tag itself. Anything unparseable is a null rather than a guessed tag.
      ["5.2.0", "5.2"],
      ["4.3.0", "4.3"],
      [" 5.0.0 ", "5.0"],
      ["5.2.0-beta.1", "5.2"],
      ["5.3.1", "5.3.1"],
      ["5.3.2-beta.1", "5.3.2"],
      ["5", null],
      ["stable", null],
      [undefined, null]
    ];

    for (const [version, expected] of derivations) {
      assert.equal(releaseVersionFrom(version), expected, `releaseVersionFrom(${JSON.stringify(version)})`);
    }
  });
});

describe("Changelog section extraction", () => {
  const markdown = [
    "# Changelog",
    "",
    "Intro that belongs to no release.",
    "",
    "## 5.2 — 2026-10-02",
    "",
    "The 5.2 body.",
    "",
    "### A subsection",
    "",
    "- a bullet",
    "",
    "## 5.1 — 2026-10-01",
    "",
    "The 5.1 body.",
  ].join("\n");

  it("returns exactly the requested section, stopping at the next heading", () => {
    const section = extractChangelogSection(markdown, "5.1");
    assert.equal(section, "The 5.1 body.");

    const earlier = extractChangelogSection(markdown, "5.2");
    assert.ok(earlier.includes("The 5.2 body."));
    assert.ok(earlier.includes("### A subsection"));
    assert.ok(!earlier.includes("The 5.1 body."), "must not bleed into the next version's notes");
  });

  it("returns null when the changelog has no such version", () => {
    assert.equal(extractChangelogSection(markdown, "9.9"), null);
  });
});

describe("The tracked changelog covers the version about to be released", () => {
  it("has a section for package.json's version, so `npm run release` cannot publish empty notes", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const version = releaseVersionFrom(pkg.version);
    assert.ok(version, `package.json version '${pkg.version}' must reduce to a major.minor tag`);

    const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
    assert.ok(
      extractChangelogSection(changelog, version),
      `CHANGELOG.md needs a '## ${version}' entry matching package.json ${pkg.version}`,
    );
  });
});
