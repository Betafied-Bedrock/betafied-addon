import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    formatBytes,
    listContentLogs,
    pruneContentLogs,
    staleContentLogs,
    totalBytes
} from "../../scripts/lib/contentLogs.mjs";
import { compareText } from "../support/text.js";

const DIR = "/logs";
const MINUTE = 60 * 1000;

interface FakeFile {
    mtimeMs: number;
    size?: number;
    directory?: boolean;
}

/** A filesystem that only knows the names it was given; anything else does not exist. */
function fakeIo(files: Record<string, FakeFile>) {
    return {
        readdir: () => Object.keys(files).map((file) => file.replace(`${DIR}/`, "")),
        stat: (file: string) => {
            const entry = files[file];
            if (!entry) throw new Error("ENOENT");
            return { isFile: () => !entry.directory, size: entry.size ?? 0, mtimeMs: entry.mtimeMs };
        }
    };
}

function entry(name: string, ageMs: number, size = 1024, now = Date.now()) {
    return { name, file: `${DIR}/${name}`, size, mtimeMs: now - ageMs };
}

describe("Which content logs a launch makes redundant", () => {
    it("keeps the newest and offers the rest, oldest first out", () => {
        const now = Date.now();
        const entries = [
            entry("ContentLog_session_3.txt", 2 * MINUTE, 300, now),
            entry("ContentLog_session_1.txt", 2 * 60 * MINUTE, 100, now),
            entry("ContentLog_session_2.txt", 30 * MINUTE, 200, now)
        ];

        const stale = staleContentLogs(entries, { now });

        assert.deepEqual(
            stale.map((log) => log.name).sort(compareText),
            ["ContentLog_session_1.txt", "ContentLog_session_2.txt"],
            "every session but the one running now"
        );
    });

    it("keeps as many sessions as asked for", () => {
        const now = Date.now();
        const entries = [
            entry("ContentLog_a.txt", 10 * MINUTE, 1, now),
            entry("ContentLog_b.txt", 20 * MINUTE, 1, now),
            entry("ContentLog_c.txt", 30 * MINUTE, 1, now)
        ];

        assert.deepEqual(staleContentLogs(entries, { now, keep: 2 }).map((log) => log.name), ["ContentLog_c.txt"]);
        assert.deepEqual(staleContentLogs(entries, { now, keep: 3 }), []);
    });

    it("never offers a log the client may still be appending to", () => {
        // Bedrock rotates its content log mid-session, so the second-newest file can hold the first
        // half of the session in progress.
        const now = Date.now();
        const entries = [
            entry("ContentLog_now.txt", 0, 1, now),
            entry("ContentLog_just_rotated.txt", 30 * 1000, 1, now),
            entry("ContentLog_earlier.txt", 90 * MINUTE, 1, now)
        ];

        assert.deepEqual(
            staleContentLogs(entries, { now }).map((log) => log.name),
            ["ContentLog_earlier.txt"]
        );
    });

    it("keeps the newest log even when asked to keep none", () => {
        const now = Date.now();
        const entries = [entry("ContentLog_new.txt", 10 * MINUTE, 1, now), entry("ContentLog_old.txt", MINUTE * 60, 1, now)];

        assert.deepEqual(staleContentLogs(entries, { now, keep: 0 }).map((log) => log.name), ["ContentLog_old.txt"]);
    });

    it("finds nothing to prune in a single-session directory", () => {
        assert.deepEqual(staleContentLogs([entry("ContentLog_only.txt", 10 * MINUTE)]), []);
    });
});

describe("Listing the content logs", () => {
    it("takes only content logs, newest first", () => {
        const now = Date.now();
        const io = fakeIo({
            [`${DIR}/ContentLog_old.txt`]: { mtimeMs: now - 10 * MINUTE, size: 10 },
            [`${DIR}/ContentLog_new.txt`]: { mtimeMs: now - MINUTE, size: 20 },
            [`${DIR}/latest.log`]: { mtimeMs: now, size: 30 },
            [`${DIR}/ContentLog_not_a_file.txt`]: { mtimeMs: now, size: 40, directory: true }
        });

        const logs = listContentLogs(DIR, io);

        assert.deepEqual(logs.map((log) => log.name), ["ContentLog_new.txt", "ContentLog_old.txt"]);
        assert.equal(totalBytes(logs), 30);
    });

    it("ignores a log that vanished between the listing and the stat", () => {
        const io = {
            readdir: () => ["ContentLog_gone.txt", "ContentLog_here.txt"],
            stat: (file: string) => {
                if (file.endsWith("gone.txt")) throw new Error("ENOENT");
                return { isFile: () => true, size: 5, mtimeMs: 1 };
            }
        };

        assert.deepEqual(listContentLogs(DIR, io).map((log) => log.name), ["ContentLog_here.txt"]);
    });

    it("treats a missing directory as nothing to prune", () => {
        const io = {
            readdir: () => {
                throw new Error("ENOENT");
            },
            stat: () => {
                throw new Error("ENOENT");
            }
        };

        assert.deepEqual(listContentLogs(DIR, io), []);
    });
});

describe("Deleting the logs", () => {
    it("removes every entry it was handed, and reports them", () => {
        const entries = [entry("ContentLog_a.txt", 10 * MINUTE, 512), entry("ContentLog_b.txt", 20 * MINUTE, 512)];
        const removed: string[] = [];

        const result = pruneContentLogs(entries, { remove: (file: string) => removed.push(file) });

        assert.deepEqual(removed, entries.map((log) => log.file));
        assert.equal(result.length, 2);
        assert.equal(totalBytes(result), 1024);
    });

    it("deletes nothing on a dry run", () => {
        const removed: string[] = [];

        const result = pruneContentLogs([entry("ContentLog_a.txt", 10 * MINUTE)], {
            dryRun: true,
            remove: (file: string) => removed.push(file)
        });

        assert.deepEqual(removed, []);
        assert.equal(result[0].name, "ContentLog_a.txt", "a dry run still reports what would go");
    });
});

describe("Formatting a freed total", () => {
    it("scales through the units a day of logs actually reaches", () => {
        assert.equal(formatBytes(0), "0 B");
        assert.equal(formatBytes(999), "999 B");
        assert.equal(formatBytes(1024), "1.0 KiB");
        assert.equal(formatBytes(1024 * 1024), "1.0 MiB");
        assert.equal(formatBytes(1024 * 1024 * 1024), "1.0 GiB");
        assert.equal(formatBytes(6.2 * 1024 * 1024 * 1024), "6.2 GiB");
        assert.equal(formatBytes(42 * 1024 * 1024), "42 MiB");
    });
});
