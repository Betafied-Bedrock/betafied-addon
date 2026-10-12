#!/usr/bin/env node
/**
 * Deletes the previous sessions' Bedrock content logs.
 *
 * Bedrock writes a fresh `ContentLog<date>_<n>.txt` on every launch and keeps every one of them, so
 * a day of playtesting leaves gigabytes behind -- one here reached 6 GB, which is a disk problem and
 * the reason a real content error is impossible to find in the noise.
 *
 * `npm run build` runs this first (`prebuild`), which is the moment a stale log is worth nothing:
 * the client is about to be launched against a fresh build and will start a log of its own. Run it
 * by hand with `npm run logs:prune`, or keep it watching with `npm run logs:watch`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";
import { resolveComMojang } from "./lib/comMojang.mjs";
import {
  contentLogDir,
  formatBytes,
  listContentLogs,
  pruneContentLogs,
  staleContentLogs,
  totalBytes
} from "./lib/contentLogs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  dir: undefined,
  keep: 1,
  dryRun: false,
  watch: false,
  quiet: false
};

function usage() {
  process.stdout.write(
    [
      "Usage: node scripts/pruneContentLogs.mjs [options]",
      "",
      "  --dir <path>        content-log directory (default: the resolved com.mojang/logs)",
      "  --keep <n>          sessions to keep, newest first (default: 1, the one running now)",
      "  --dry-run           report what would go, delete nothing",
      "  --watch             stay up and prune again whenever a new log appears",
      "  --quiet             no output unless something was deleted",
      ""
    ].join("\n")
  );
}

function parseArgs(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dir") options.dir = argv[++index];
    else if (arg === "--keep") options.keep = Number(argv[++index]);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--watch") options.watch = true;
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      process.stderr.write(`[logs] unknown option '${arg}'\n`);
      usage();
      process.exit(2);
    }
  }

  if (!Number.isInteger(options.keep) || options.keep < 0) {
    process.stderr.write("[logs] --keep takes a whole number of sessions\n");
    process.exit(2);
  }
}

function resolveLogDir() {
  if (options.dir) return path.resolve(options.dir);

  const comMojang = resolveComMojang({ ...loadEnv(ROOT), ...process.env });
  if (comMojang) return contentLogDir(comMojang);

  // A machine that has never run the client has nothing to prune, and a build must not fail over it.
  if (options.watch) {
    process.stderr.write(
      "[logs] cannot find the Bedrock data directory: pass --dir, or set COM_MOJANG to the\n" +
        "[logs] com.mojang folder that contains its logs/ directory.\n"
    );
    process.exit(2);
  }

  return undefined;
}

function say(message) {
  if (!options.quiet) process.stdout.write(`${message}\n`);
}

function pruneOnce(dir) {
  const entries = listContentLogs(dir);
  const stale = staleContentLogs(entries, { keep: options.keep });

  if (stale.length === 0) {
    if (entries.length === 0) say(`[logs] no content logs in ${dir}`);
    else say(`[logs] nothing to prune in ${dir} (${entries.length} kept)`);
    return;
  }

  const freed = totalBytes(stale);
  const removed = pruneContentLogs(stale, { dryRun: options.dryRun });
  say(
    `[logs] ${options.dryRun ? "would delete" : "deleted"} ${removed.length} previous content log(s), ` +
      `${options.dryRun ? "would free" : "freeing"} ${formatBytes(freed)}`
  );
}

function watch(dir) {
  if (!fs.existsSync(dir)) {
    process.stderr.write(`[logs] ${dir} does not exist yet: launch the client once, then watch again\n`);
    process.exit(2);
  }

  say(`[logs] watching ${dir} for a new session log (ctrl-c to stop)`);
  pruneOnce(dir);

  let timer = null;
  fs.watch(dir, () => {
    // A launch writes the log and then writes into it, and the deletes this makes change the
    // directory again, so the burst is collapsed into one pass.
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      pruneOnce(dir);
    }, 500);
  });
}

parseArgs(process.argv.slice(2));

if (options.watch) watch(resolveLogDir());
else {
  const dir = resolveLogDir();
  if (dir) pruneOnce(dir);
  else say("[logs] no Bedrock data directory on this machine, so there are no logs to prune");
}
