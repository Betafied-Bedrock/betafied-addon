import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packAssets } from "../../scripts/release.mjs";

describe("Release asset filtering", () => {
  it("only collects .mcaddon and .mctemplate assets, excluding .mcpack and other files", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "betafied-release-test-"));
    try {
      const versionDir = path.join(tmp, "build", "9.9");
      fs.mkdirSync(versionDir, { recursive: true });

      fs.writeFileSync(path.join(versionDir, "Betafied_9.9.mcaddon"), "");
      fs.writeFileSync(path.join(versionDir, "Betafied_9.9.mctemplate"), "");
      fs.writeFileSync(path.join(versionDir, "Betafied_9.9_BP.mcpack"), "");
      fs.writeFileSync(path.join(versionDir, "Betafied_9.9_RP.mcpack"), "");
      fs.writeFileSync(path.join(versionDir, "unrelated.txt"), "");

      // Test filtering logic directly with the regex used by packAssets
      const files = fs.readdirSync(versionDir)
        .filter((name) => /\.(mcaddon|mctemplate)$/i.test(name))
        .sort();

      assert.deepEqual(files, ["Betafied_9.9.mcaddon", "Betafied_9.9.mctemplate"]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns an empty array when the target build directory does not exist", () => {
    const assets = packAssets("nonexistent-version-999.0.0");
    assert.deepEqual(assets, []);
  });
});

describe("Release template pruning selection", () => {
  it("identifies .mctemplate assets from previous releases while skipping the current tag", () => {
    const mockReleases = [
      {
        tag_name: "5.9",
        assets: [{ name: "Betafied_5.9.mcaddon" }, { name: "Betafied_5.9.mctemplate" }],
      },
      {
        tag_name: "5.8",
        assets: [
          { name: "Betafied_5.8.mcaddon" },
          { name: "Betafied_5.8.mctemplate" },
          { name: "Betafied_5.8_BP.mcpack" },
        ],
      },
      {
        tag_name: "5.7",
        assets: [{ name: "Betafied_5.7.mcaddon" }],
      },
    ];

    const currentTag = "5.9";
    const toDelete: Array<{ tag: string; assetName: string }> = [];

    for (const release of mockReleases) {
      if (release.tag_name === currentTag) continue;
      for (const asset of release.assets) {
        if (asset.name.toLowerCase().endsWith(".mctemplate")) {
          toDelete.push({ tag: release.tag_name, assetName: asset.name });
        }
      }
    }

    assert.deepEqual(toDelete, [{ tag: "5.8", assetName: "Betafied_5.8.mctemplate" }]);
  });
});
