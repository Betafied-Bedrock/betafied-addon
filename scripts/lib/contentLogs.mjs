import fs from "node:fs";
import path from "node:path";

/**
 * Bedrock's content logs: one `ContentLog<date>_<n>.txt` per client launch, and it never prunes
 * them. This machine collected 6 GB in a single day, which is a disk problem and the reason a real
 * content error is impossible to find in the noise.
 *
 * What "stale" means here is deliberately narrow: a launch makes every *other* session's log
 * redundant, and never the one the client is still writing to.
 */
export const CONTENT_LOG_DIR = "logs";

const CONTENT_LOG_NAME = /^ContentLog.*\.txt$/;

/**
 * A log the client may still be appending to is not stale, however old the rest are. Bedrock rotates
 * its content log mid-session, so the file that is second-newest can be the one holding the first
 * half of the session you are in the middle of.
 */
export const KEEP_RECENT_MS = 5 * 60 * 1000;

/** The content-log directory inside a resolved `com.mojang`. */
export function contentLogDir(comMojang) {
  return path.join(comMojang, CONTENT_LOG_DIR);
}

/**
 * The content logs under `dir`, newest first.
 *
 * `io` is injectable so the selection rules can be exercised without a filesystem, and a missing
 * directory is an empty list rather than an error: a client that has never run has no logs to prune.
 */
export function listContentLogs(dir, io = { readdir: fs.readdirSync, stat: fs.statSync }) {
  let names;
  try {
    names = io.readdir(dir);
  } catch {
    return [];
  }

  const entries = [];
  for (const name of names) {
    if (!CONTENT_LOG_NAME.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const stats = io.stat(file);
      if (!stats.isFile()) continue;
      entries.push({ name, file, size: stats.size, mtimeMs: stats.mtimeMs });
    } catch {
      // A log that vanished between the listing and the stat has nothing left to delete.
    }
  }

  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** The entries a launch makes redundant: everything but the `keep` newest, and nothing recent. */
export function staleContentLogs(entries, { keep = 1, now = Date.now(), keepRecentMs = KEEP_RECENT_MS } = {}) {
  return [...entries]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(Math.max(keep, 1))
    .filter((entry) => now - entry.mtimeMs >= keepRecentMs);
}

export function totalBytes(entries) {
  return entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** Deletes them, returning what went. `remove` is injectable for the same reason `io` is. */
export function pruneContentLogs(entries, { dryRun = false, remove = fs.rmSync } = {}) {
  const removed = [];
  for (const entry of entries) {
    if (!dryRun) remove(entry.file, { force: true });
    removed.push(entry);
  }
  return removed;
}
