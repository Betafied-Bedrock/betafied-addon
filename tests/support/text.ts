/**
 * String and version helpers for the static contract tests. Nothing in this module may reach for
 * the engine, so a file-contract test that imports it stays a file-contract test.
 */

/** Whether a dotted format version is at least `minimum`: 1.21.60 is, 1.8.0 is not. */
export function versionAtLeast(declared: string, minimum: string): boolean {
    const mine = declared.split(".").map(Number);
    const theirs = minimum.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        if ((mine[i] ?? 0) !== (theirs[i] ?? 0)) return (mine[i] ?? 0) > (theirs[i] ?? 0);
    }
    return true;
}

/** Code-unit ordering for a string list, so `.sort(compareText)` cannot fall back to coercion. */
export function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
