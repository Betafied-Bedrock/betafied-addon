#!/usr/bin/env node
/**
 * Summarise a `.cpuprofile` from `/script profiler stop`.
 *
 * VS Code renders a cpuprofile as a flat function list unless the Flame Chart
 * extension is installed, and neither view answers the question this project
 * asks of it - "which of *our* files is eating the tick, and is the cost in our
 * JavaScript or in the engine calls it makes".
 *
 * The rollup is split Betafied against everything else on purpose. The server
 * runs this pack *alongside* other add-ons (such as far.land or survival utilities),
 * and the profiler knows nothing about pack boundaries, so it reports external
 * frames alongside ours. The split makes clear what belongs to Betafied versus
 * external packs or engine builtins.
 *
 * Usage: node scripts/analyze-profile.mjs <path.cpuprofile> [topN] [urlFilter]
 */

import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const scriptRoot = path.join(projectRoot, "packs", "BP", "scripts");

const file = process.argv[2];
const topN = Number(process.argv[3]) || 25;
const urlFilter = process.argv[4];
if (!file) {
  console.error("Usage: node scripts/analyze-profile.mjs <path.cpuprofile> [topN] [urlFilter]");
  process.exit(1);
}

const profile = JSON.parse(fs.readFileSync(file, "utf8"));
const nodes = profile.nodes ?? [];
const samples = profile.samples ?? [];
const timeDeltas = profile.timeDeltas ?? [];

const byId = new Map(nodes.map((node) => [node.id, node]));

const selfTime = new Map();
for (let i = 0; i < samples.length; i++) {
  const id = samples[i];
  const dt = timeDeltas[i] ?? 0;
  selfTime.set(id, (selfTime.get(id) ?? 0) + dt);
}

const parent = new Map();
for (const node of nodes) {
  for (const child of node.children ?? []) parent.set(child, node.id);
}

const inclusive = new Map();
function inclusiveOf(rootId) {
  const cached = inclusive.get(rootId);
  if (cached !== undefined) return cached;

  let total = 0;
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    total += selfTime.get(id) ?? 0;
    const node = byId.get(id);
    for (const child of node?.children ?? []) {
      if (inclusive.has(child)) total += inclusive.get(child);
      else stack.push(child);
    }
  }

  inclusive.set(rootId, total);
  return total;
}

/** Only the compiler's own frames are not a script; everything else is a pack. */
const isEngineFrame = (url) => !url || url === "(engine)";

/**
 * Source file in this repo that a transpiled profile path came from, or null.
 *
 * The profiler reports paths relative to the pack's `scripts` folder, so the
 * source that produced one is the same path with `.ts`.
 */
const sourceFileCache = new Map();
function ourSourceFile(url) {
  if (isEngineFrame(url)) return null;
  const cached = sourceFileCache.get(url);
  if (cached !== undefined) return cached;

  const candidates = [url, url.replace(/\.js$/, ".ts"), url.replace(/\.js$/, "")];
  let found = null;
  for (const relative of candidates) {
    const absolute = path.join(scriptRoot, relative);
    if (absolute.startsWith(scriptRoot) && fs.existsSync(absolute)) {
      found = absolute;
      break;
    }
  }
  sourceFileCache.set(url, found);
  return found;
}

const lineCountCache = new Map();
function lineCount(absolute) {
  const cached = lineCountCache.get(absolute);
  if (cached !== undefined) return cached;
  const count = fs.readFileSync(absolute, "utf8").split("\n").length;
  lineCountCache.set(absolute, count);
  return count;
}

/**
 * Whether a frame belongs to this repo, by source path *and* line number.
 *
 * The path alone is not enough if sibling packs happen to share directory or
 * file names (e.g., `core/`). A frame pointing past the end of the file it claims
 * to be in is therefore somebody else's.
 */
function isOurFrame(node) {
  const url = node.callFrame?.url ?? "";
  const source = ourSourceFile(url);
  if (source === null) return false;

  const line = node.callFrame?.lineNumber ?? 0;
  return line < lineCount(source);
}

const label = (node) => {
  const frame = node.callFrame ?? {};
  const name = frame.functionName || "(anonymous)";
  const where = frame.url ? `${frame.url}:${(frame.lineNumber ?? 0) + 1}` : "(engine)";
  return `${name} @ ${where}`;
};

const formatMs = (us) => `${(us / 1000).toFixed(1)}ms`;
const formatPct = (us, total) => `${((us / total) * 100).toFixed(1)}%`;

const totalUs =
  samples.reduce((sum, _, i) => sum + (timeDeltas[i] ?? 0), 0) || (profile.endTime - profile.startTime);

console.log(`profile:  ${path.basename(file)}`);
console.log(`duration: ${formatMs(totalUs)}  samples: ${samples.length}  nodes: ${nodes.length}`);
console.log(`window:   ${new Date(profile.startTime / 1000).toISOString()}`);

/** Urls with at least one frame that lands inside this repo's source. */
const ourUrls = new Set(nodes.filter(isOurFrame).map((node) => node.callFrame?.url ?? ""));

console.log(`\n=== self time by source file (top ${topN}) ===`);
const byUrl = new Map();
for (const node of nodes) {
  const url = node.callFrame?.url || "(engine)";
  byUrl.set(url, (byUrl.get(url) ?? 0) + (selfTime.get(node.id) ?? 0));
}
const urls = [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
for (const [url, us] of urls) {
  const mark = isEngineFrame(url) ? " " : ourUrls.has(url) ? "B" : ".";
  console.log(`  ${mark} ${formatMs(us).padStart(11)}  ${formatPct(us, totalUs).padStart(6)}  ${url}`);
}

console.log(`\n=== Betafied vs everything else (self time, by file ownership) ===`);
let mine = 0;
let theirs = 0;
let engine = 0;
for (const node of nodes) {
  const us = selfTime.get(node.id) ?? 0;
  const url = node.callFrame?.url ?? "";
  if (isEngineFrame(url)) engine += us;
  else if (isOurFrame(node)) mine += us;
  else theirs += us;
}
console.log(`  ${formatMs(mine).padStart(11)}  ${formatPct(mine, totalUs).padStart(6)}  Betafied (this repo)`);
console.log(`  ${formatMs(theirs).padStart(11)}  ${formatPct(theirs, totalUs).padStart(6)}  other packs (far.land and any other)`);
if (engine > 0) console.log(`  ${formatMs(engine).padStart(11)}  ${formatPct(engine, totalUs).padStart(6)}  (no source file)`);

console.log(`\n=== top ${topN} by SELF time ===`);
const bySelf = nodes
  .map((node) => ({ label: label(node), us: selfTime.get(node.id) ?? 0 }))
  .sort((a, b) => b.us - a.us)
  .slice(0, topN);
for (const row of bySelf) {
  console.log(`  ${formatMs(row.us).padStart(11)}  ${formatPct(row.us, totalUs).padStart(6)}  ${row.label}`);
}

console.log(`\n=== top ${topN} by INCLUSIVE time ===`);
const roots = nodes.filter((node) => !parent.has(node.id));
console.log(`  (${roots.length} roots: ${roots.map((node) => label(node)).join(" | ")})`);
const byInclusive = nodes
  .map((node) => ({ label: label(node), us: inclusiveOf(node.id) }))
  .sort((a, b) => b.us - a.us)
  .slice(0, topN);
for (const row of byInclusive) {
  console.log(`  ${formatMs(row.us).padStart(11)}  ${formatPct(row.us, totalUs).padStart(6)}  ${row.label}`);
}

if (urlFilter === "--api") {
  // Native API calls are traced per invocation rather than sampled, so their
  // counts are the one figure in this format that is not diluted by idle time:
  // a gap between two records is attributed to whichever frame was current, and
  // the outermost frame is current for every tick nobody was scripting. A frame
  // called in a tight loop has no gaps and its duration is honest; one called
  // once a tick absorbs the rest of the tick.
  console.log(`\n=== native API invocations, most-called first ===`);
  const calls = nodes
    .filter((node) => /^[A-Z][A-Za-z]*::/.test(node.callFrame?.functionName ?? ""))
    .map((node) => ({
      label: label(node),
      hits: node.hitCount ?? 0,
      us: selfTime.get(node.id) ?? 0
    }))
    .sort((a, b) => b.hits - a.hits);
  for (const row of calls) {
    const perCall = row.hits > 0 ? (row.us / row.hits / 1000).toFixed(1) : "-";
    console.log(
      `  ${String(row.hits).padStart(8)} calls  ${formatMs(row.us).padStart(10)}  ` +
        `${perCall.padStart(8)}ms/call  ${row.label}`
    );
  }
} else if (urlFilter === "--ours") {
  console.log(`\n=== every Betafied frame, by inclusive time ===`);
  const matched = nodes
    .filter((node) => isOurFrame(node))
    .map((node) => ({
      label: label(node),
      us: selfTime.get(node.id) ?? 0,
      incl: inclusiveOf(node.id),
      hits: node.hitCount ?? 0
    }))
    .sort((a, b) => b.incl - a.incl);
  for (const row of matched) {
    console.log(
      `  self ${formatMs(row.us).padStart(10)}  incl ${formatMs(row.incl).padStart(10)}  ` +
        `hits ${String(row.hits).padStart(6)}  ${row.label}`
    );
  }
} else if (urlFilter) {
  console.log(`\n=== every frame in files matching "${urlFilter}" ===`);
  const matched = nodes
    .filter((node) => (node.callFrame?.url ?? "").includes(urlFilter))
    .map((node) => ({
      label: label(node),
      us: selfTime.get(node.id) ?? 0,
      incl: inclusiveOf(node.id),
      hits: node.hitCount ?? 0
    }))
    .sort((a, b) => b.incl - a.incl);
  for (const row of matched) {
    console.log(
      `  self ${formatMs(row.us).padStart(10)}  incl ${formatMs(row.incl).padStart(10)}  ` +
        `hits ${String(row.hits).padStart(6)}  ${row.label}`
    );
  }
}
