import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { packAssets } from "../../scripts/release.mjs";

// The asset-name filter (.mcaddon / .mctemplate only) is production's to assert: the case that used to
// live here rebuilt the regex in the test and compared its own output, so it could not fail when
// packAssets broke.
describe("Release asset filtering", () => {
  it("returns an empty array when the target build directory does not exist", () => {
    assert.deepEqual(packAssets("nonexistent-version-999.0.0"), []);
  });
});
