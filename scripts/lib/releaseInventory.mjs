/**
 * Release notes are written from what the packs do, not from what their files looked like.
 * 5.14 rewrote and moved every UI source it touched, and the drafted notes read controls that
 * 5.13 already shipped (the dirt loading screen, the pause button stack, the HUD chat corner)
 * as new. Comparing the packaged builds is the only inventory that separates a move or a
 * reformat from a change a player can see.
 */
import fs from "node:fs";
import path from "node:path";

/** JSON UI and the transpiled scripts both carry `//` and block comments; JSON.parse refuses them. */
export function stripComments(text) {
  let output = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      } else if (char === "\n") {
        output += char;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (char === "\\") {
        output += text[i + 1] ?? "";
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      inLineComment = true;
      i += 1;
    } else if (char === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
    } else {
      output += char;
    }
  }

  return output;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])])
    );
  }
  return value;
}

/** A file's meaning with comments, member order and formatting removed; null when it is not JSON. */
export function canonicalJson(text) {
  try {
    return JSON.stringify(sortKeys(JSON.parse(stripComments(text))));
  } catch {
    return null;
  }
}

/** A script's meaning with comments and layout removed, so a comment rewrite does not read as a change. */
export function canonicalSource(text) {
  return stripComments(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function readPack(root) {
  const files = new Map();

  const walk = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full, relative);
      else files.set(relative, readRecord(fs.readFileSync(full), path.extname(entry.name).toLowerCase()));
    }
  };

  walk(root, "");
  return files;
}

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts"]);

function readRecord(bytes, extension) {
  if (SOURCE_EXTENSIONS.has(extension)) {
    return { bytes, canonical: canonicalSource(bytes.toString("utf8")), value: null };
  }

  const canonical = canonicalJson(bytes.toString("utf8"));
  return { bytes, canonical, value: canonical === null ? null : JSON.parse(canonical) };
}

function sameContent(before, after) {
  if (before.canonical !== null && after.canonical !== null) return before.canonical === after.canonical;
  return before.bytes.equals(after.bytes);
}

function changedControls(before, after) {
  if (!before.value || !after.value) return [];
  if (Array.isArray(before.value) || Array.isArray(after.value)) return [];

  const keys = new Set([...Object.keys(before.value), ...Object.keys(after.value)]);
  return [...keys]
    .filter((key) => JSON.stringify(before.value[key]) !== JSON.stringify(after.value[key]))
    .sort();
}

/**
 * Classify every file of two packaged packs. A file that only lost its formatting is not
 * reported at all; a file that changed names with identical content is a move; a changed JSON
 * file carries the top-level controls whose content differs.
 */
export function comparePacks(fromDir, toDir) {
  const before = readPack(fromDir);
  const after = readPack(toDir);

  const changed = [];
  const added = [];
  const removed = [];
  let unchanged = 0;

  for (const [relative, record] of after) {
    const previous = before.get(relative);
    if (!previous) {
      added.push(relative);
      continue;
    }
    if (sameContent(previous, record)) {
      unchanged += 1;
      continue;
    }
    changed.push({ path: relative, controls: changedControls(previous, record) });
  }

  for (const relative of before.keys()) {
    if (!after.has(relative)) removed.push(relative);
  }

  const moved = [];
  for (const relative of [...added]) {
    const source = removed.find((candidate) => sameContent(before.get(candidate), after.get(relative)));
    if (source === undefined) continue;
    moved.push({ from: source, to: relative });
    added.splice(added.indexOf(relative), 1);
    removed.splice(removed.indexOf(source), 1);
  }

  return {
    changed: changed.sort((a, b) => a.path.localeCompare(b.path)),
    added: added.sort(),
    removed: removed.sort(),
    moved: moved.sort((a, b) => a.to.localeCompare(b.to)),
    unchanged
  };
}
