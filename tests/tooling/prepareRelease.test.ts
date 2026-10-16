import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureChangelogEntry,
  extractChangelogSection,
  notesArePlaceholder,
  releaseVersionFrom,
  RELEASE_NOTES_PLACEHOLDER
} from "../../scripts/lib/changelog.mjs";
import {
  applyManifestVersion,
  applyWelcomeVersion,
  applyWorldTemplateManifest,
  compareTriples,
  latestReleaseTag,
  nextReleaseVersion,
  versionTriple,
  worldTemplateManifestProblems
} from "../../scripts/lib/version.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Release version stepping", () => {
  it("reads a tag as a triple, treating a missing patch as zero", () => {
    assert.deepEqual(versionTriple("5.4"), [5, 4, 0]);
    assert.deepEqual(versionTriple(" 5.5.0-beta.1 "), [5, 5, 0]);
    assert.equal(versionTriple("stable"), null, "a tag that is not a release has nothing to step from");
  });

  it("steps minor and patch from the last released tag, and refuses to prepare over a higher release", () => {
    assert.equal(nextReleaseVersion("5.4", "minor"), "5.5.0");
    assert.equal(nextReleaseVersion("5.4", "patch"), "5.4.1");
    // A patch line that never shipped a patch is the `.0` of its minor, so its first
    // patch is `.1` — `.0` is already the release that shipped as the bare tag.
    assert.equal(nextReleaseVersion("5.4.0", "patch"), "5.4.1");
    assert.equal(nextReleaseVersion("nonsense", "minor"), null);

    assert.ok(compareTriples([5, 5, 0], [5, 4, 9]) > 0);
    assert.ok(compareTriples([4, 9, 0], [5, 0, 0]) < 0);
  });

  it("ignores tags that are not releases when finding the latest one", () => {
    const tags = ["Worlds", "release", "v0.2.3-9a2418b", "3.0.9", "5.4", "5.3.2", "5.3.1"];
    assert.equal(latestReleaseTag(tags), "5.4");
    assert.equal(latestReleaseTag(["Worlds", "release"]), null);
  });
});

describe("Version carriers", () => {
  const behavior = {
    header: { name: "Betafied 5.4", version: [5, 4, 0] },
    modules: [
      { type: "data", uuid: "a", version: [5, 4, 0] },
      { type: "script", uuid: "b", version: [5, 4, 0] }
    ],
    dependencies: [
      { module_name: "@minecraft/server", version: "2.11.0-beta" },
      { uuid: "c", version: [5, 4, 0] }
    ]
  };

  it("moves every pack version, including the resource-pack dependency, without mutating the manifest it was given", () => {
    const updated = applyManifestVersion(behavior, [5, 5, 0], { name: "Betafied 5.5" });

    assert.deepEqual(updated.header.version, [5, 5, 0]);
    assert.equal(updated.header.name, "Betafied 5.5");
    assert.deepEqual(
      updated.modules.map((module: any) => module.version),
      [
        [5, 5, 0],
        [5, 5, 0]
      ]
    );
    assert.deepEqual(updated.dependencies[1].version, [5, 5, 0], "the resource pack entry drives whether it loads");
    assert.equal(updated.dependencies[0].version, "2.11.0-beta", "an engine module keeps its own version");

    assert.deepEqual(behavior.header.version, [5, 4, 0], "the input manifest is left alone");
    assert.deepEqual(behavior.modules[0].version, [5, 4, 0]);
  });

  it("writes the tag into the welcome banner, since that is what a player sees", () => {
    const source = 'const CONFIG = Object.freeze({\n    VERSION: "5.4",\n    DELAY_TICKS: 70\n});\n';
    const updated = applyWelcomeVersion(source, "5.5");
    assert.ok(updated?.includes('VERSION: "5.5"'));
    assert.ok(updated?.includes("DELAY_TICKS: 70"), "the rest of the config is untouched");
    assert.equal(applyWelcomeVersion("no version here", "5.5"), null);
  });
});

describe("World template icon", () => {
  it("ships the tracked world icon, since the game overwrites the one inside a played world", () => {
    const icon = fs.readFileSync(path.join(ROOT, "assets", "world_icon.jpeg"));

    assert.equal(icon.subarray(0, 2).toString("hex"), "ffd8", "world_icon.jpeg must be a JPEG");
    assert.ok(icon.length > 1024, "a file this small is a placeholder, not the shipped icon");
  });
});

describe("World template manifest", () => {
  const template = {
    format_version: 2,
    header: {
      name: "Betafied 5.4",
      description: "Betafied recreates Minecraft Beta 1.7.3 in Bedrock Edition.",
      uuid: "4c6e0bf1-5dfa-45c5-bf6e-6c61f2f81490",
      version: [5, 4, 0]
    },
    modules: [{ type: "world_template", uuid: "7c5e2365-2766-4c4b-b0b3-f72534594619", version: [5, 4, 0] }]
  };
  const baseGameVersion = [1, 26, 51];

  it("carries the header fields the game requires of a template, and never overrides an explicit lock", () => {
    const updated = applyWorldTemplateManifest(template, [5, 5, 0], { name: "Betafied 5.5", baseGameVersion });

    assert.equal(updated.header.lock_template_options, false, "the template is never listed without this field");
    assert.equal(updated.header.name, "Betafied 5.5");
    assert.deepEqual(
      updated.header.base_game_version,
      [1, 26, 51],
      "the import is refused without this field, not just the listing"
    );

    const locked = applyWorldTemplateManifest(
      { ...template, header: { ...template.header, lock_template_options: true } },
      [5, 5, 0]
    );
    assert.equal(locked.header.lock_template_options, true);
  });

  it("names everything that would keep the template out of the Create New list", () => {
    const problems = worldTemplateManifestProblems({ format_version: 2, header: { name: "x" }, modules: [] });

    assert.ok(problems.some((problem) => problem.includes("header.uuid")));
    assert.ok(problems.some((problem) => problem.includes("header.lock_template_options")));
    assert.ok(problems.some((problem) => problem.includes("header.base_game_version")));
    assert.ok(problems.some((problem) => problem.includes("world_template module")));

    const unversioned = worldTemplateManifestProblems(applyWorldTemplateManifest(template, [5, 5, 0]));
    assert.ok(unversioned.some((problem) => problem.includes("header.base_game_version")));

    assert.deepEqual(
      worldTemplateManifestProblems({
        ...applyWorldTemplateManifest(template, [5, 4, 0], { baseGameVersion }),
        format_version: 3
      }),
      ["format_version must be 2, not 3"],
      "an otherwise valid template reports only what is actually wrong with it"
    );
  });
});

describe("Changelog preparation", () => {
  const markdown = "# Changelog\n\nIntro that belongs to no release.\n\n## 5.4 — 2026-10-10\n\nNotes.\n";

  it("inserts the new heading above the newest release, under the intro, as an unwritten placeholder", () => {
    const updated = ensureChangelogEntry(markdown, "5.5", "2026-10-11");

    assert.ok(updated.includes("## 5.5 — 2026-10-11"));
    assert.ok(updated.includes("Intro that belongs to no release."), "the intro stays above every release");
    assert.ok(
      updated.indexOf("## 5.5") < updated.indexOf("## 5.4"),
      "the newest release must come first, or release.mjs reads the wrong section"
    );
    assert.ok(
      notesArePlaceholder(extractChangelogSection(updated, "5.5")),
      "a prepared section must not pass as finished notes"
    );
    assert.equal(notesArePlaceholder("The real notes."), false);
    assert.equal(notesArePlaceholder(null), false);
  });

  it("is a no-op when the version already has a section, so re-running never eats notes", () => {
    const written = ensureChangelogEntry(markdown, "5.5", "2026-10-11").replace(
      RELEASE_NOTES_PLACEHOLDER,
      "The real notes."
    );
    assert.equal(ensureChangelogEntry(written, "5.5", "2026-10-12"), written);
    assert.equal(extractChangelogSection(ensureChangelogEntry(written, "5.5", "2026-10-12"), "5.5"), "The real notes.");
  });

  it("does not mistake a longer version for the one being prepared", () => {
    const updated = ensureChangelogEntry(markdown, "5.40", "2026-10-11");
    assert.ok(extractChangelogSection(updated, "5.40"));
    assert.ok(extractChangelogSection(updated, "5.4"), "the existing 5.4 section is still there");
  });
});

describe("Every version carrier in the checkout agrees", () => {
  it("package.json, both manifests and the welcome banner all name the same release", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const tag = releaseVersionFrom(pkg.version);
    const triple = versionTriple(pkg.version);
    assert.ok(tag && triple, `package.json version '${pkg.version}' must reduce to a tag`);

    const behavior = JSON.parse(fs.readFileSync(path.join(ROOT, "packs/BP/manifest.json"), "utf8"));
    const resource = JSON.parse(fs.readFileSync(path.join(ROOT, "packs/RP/manifest.json"), "utf8"));
    const welcome = fs.readFileSync(path.join(ROOT, "packs/BP/scripts/player/welcome.ts"), "utf8");

    const mismatches: string[] = [];
    const check = (label: string, actual: unknown) => {
      if (JSON.stringify(actual) !== JSON.stringify(triple)) mismatches.push(`${label} is ${JSON.stringify(actual)}`);
    };

    check("packs/BP manifest header", behavior.header.version);
    behavior.modules.forEach((module: any, index: number) => check(`packs/BP module ${index}`, module.version));
    behavior.dependencies
      .filter((dependency: any) => Array.isArray(dependency.version))
      .forEach((dependency: any) => check(`packs/BP dependency ${dependency.uuid}`, dependency.version));
    check("packs/RP manifest header", resource.header.version);
    resource.modules.forEach((module: any, index: number) => check(`packs/RP module ${index}`, module.version));

    if (fs.existsSync(path.join(ROOT, "template/manifest.json"))) {
      const templateManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "template/manifest.json"), "utf8"));
      check("template manifest header", templateManifest.header?.version);
      templateManifest.modules?.forEach((module: any, index: number) =>
        check(`template module ${index}`, module.version)
      );
      assert.equal(templateManifest.modules?.[0]?.type, "world_template");
      assert.equal(
        templateManifest.header?.lock_template_options,
        false,
        "a world template needs this header field or the game never lists it"
      );
      assert.ok(
        Array.isArray(templateManifest.header?.base_game_version),
        "a world template needs base_game_version or the game refuses the import"
      );
    }

    assert.deepEqual(mismatches, [], "a release that bumps only some carriers ships a pack the engine will ignore");
    assert.ok(
      behavior.header.name.includes(tag) && resource.header.name.includes(tag),
      "each manifest names the release it ships"
    );
    assert.ok(welcome.includes(`VERSION: "${tag}"`), `the welcome banner must show ${tag}`);
  });
});
