#!/usr/bin/env node
/**
 * Report what actually changed between two packaged releases, so release notes are drafted from
 * shipped behaviour rather than from a diff that a file move or a reformat rewrote. Run it before
 * writing a section, not after:
 *
 *   npm run release:inventory -- 5.13 5.14
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { comparePacks } from "./lib/releaseInventory.mjs";
import { releaseVersionFrom } from "./lib/changelog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `Usage: npm run release:inventory -- <from> [to]

  from   the release the range starts from, e.g. 5.13
  to     the release being drafted, defaulting to package.json's version

Both must have a build folder: build/<tag>/Betafied_<tag>_RP and _BP.`;

function fail(message) {
  console.error(`release:inventory: ${message}`);
  process.exit(1);
}

function packDir(tag, kind) {
  const directory = path.join(ROOT, "build", tag, `Betafied_${tag}_${kind}`);
  if (!fs.existsSync(directory)) {
    fail(`no packaged ${kind} for ${tag} at ${path.relative(ROOT, directory)} — build that release first`);
  }
  return directory;
}

function describeControls(controls) {
  if (controls.length === 0) return "";
  const shown = controls.slice(0, 12);
  const rest = controls.length - shown.length;
  return `: ${shown.join(", ")}${rest > 0 ? `, +${rest} more` : ""}`;
}

// These carry the version a release bumps, not a change the notes describe.
const VERSION_CARRIERS = new Set(["manifest.json", "scripts/player/welcome.js"]);

function report(label, fromDir, toDir) {
  const result = comparePacks(fromDir, toDir);
  const changed = result.changed.filter((file) => !VERSION_CARRIERS.has(file.path));
  const added = result.added.filter((file) => !VERSION_CARRIERS.has(file));
  const removed = result.removed.filter((file) => !VERSION_CARRIERS.has(file));

  console.log(`\n${label}`);

  if (changed.length + added.length + removed.length + result.moved.length === 0) {
    console.log("  nothing changed");
  }
  for (const file of changed) console.log(`  changed  ${file.path}${describeControls(file.controls)}`);
  for (const file of added) console.log(`  added    ${file}`);
  for (const file of removed) console.log(`  removed  ${file}`);
  for (const move of result.moved) console.log(`  moved    ${move.from} -> ${move.to}`);

  console.log(`  ${result.unchanged} file(s) unchanged`);
  return result;
}

const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (args.includes("--help") || args.length === 0 || args.length > 2) {
  console.log(USAGE);
  process.exit(args.length === 0 || args.includes("--help") ? 0 : 1);
}

const from = args[0];
const target = args[1] ?? releaseVersionFrom(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version);
if (!target) fail("could not derive the target tag from package.json; name it explicitly");

console.log(`release:inventory: ${from} -> ${target}`);
report("Resource pack", packDir(from, "RP"), packDir(target, "RP"));
report("Behavior pack", packDir(from, "BP"), packDir(target, "BP"));

console.log(
  "\nrelease:inventory: only the files above changed. A note about anything else, or about a control " +
    "this did not name, describes a build that already shipped."
);
