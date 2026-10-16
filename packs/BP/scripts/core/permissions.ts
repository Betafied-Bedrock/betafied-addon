import { Player, GameMode } from "@minecraft/server";

/** Every player tag the pack reads, so a gate in another module cannot drift from its writer. */
export const PLAYER_TAGS = Object.freeze({
    BUILDER_EXEMPT: "builder_exempt",
    VOIDED: "voided"
} as const);

export type PrivilegeReason = "creative" | "spectator" | "tag";

const auditLogCooldowns = new Map<string, number>();
const AUDIT_LOG_INTERVAL_MS = 60_000;
const AUDIT_LOG_MAX_ENTRIES = 256;

function rememberAuditLog(playerId: string, now: number): void {
    // Re-inserting on refresh keeps the map ordered least-recently-seen first, which is the entry the
    // bound below is meant to drop.
    auditLogCooldowns.delete(playerId);

    if (auditLogCooldowns.size >= AUDIT_LOG_MAX_ENTRIES) {
        const oldest = auditLogCooldowns.keys().next().value;
        if (oldest !== undefined) auditLogCooldowns.delete(oldest);
    }
    auditLogCooldowns.set(playerId, now);
}

function auditBypass(player: Player, reason: "creative" | "tag"): void {
    const now = Date.now();
    const lastLog = auditLogCooldowns.get(player.id) ?? 0;
    if (now - lastLog <= AUDIT_LOG_INTERVAL_MS) return;

    const via = reason === "creative" ? "creative mode" : `${PLAYER_TAGS.BUILDER_EXEMPT} tag`;
    console.warn(`AUTH: Player '${player.name}' (${player.id}) bypassed inventory check via ${via}.`);
    rememberAuditLog(player.id, now);
}

/**
 * Whether a game mode is one the era's survival rules do not reach. An absent mode — a mob, or a
 * handle that answers none — reads as a survival player.
 */
export function eraRulesApply(mode: GameMode | undefined): boolean {
    return mode !== GameMode.Creative && mode !== GameMode.Spectator;
}

/**
 * The privileged question in one place: which reason puts this player outside a rule the survival
 * player is held to, or null when it does not. A caller honours only the reasons its own rule
 * exempts — a placed item's cost ignores the builder tag, the inventory sweep honours it.
 */
export function getPrivilegeReason(player: Player): PrivilegeReason | null {
    const mode = typeof player.getGameMode === "function" ? player.getGameMode() : undefined;

    if (!eraRulesApply(mode)) {
        return mode === GameMode.Spectator ? "spectator" : "creative";
    }

    return player.hasTag(PLAYER_TAGS.BUILDER_EXEMPT) ? "tag" : null;
}

/** Whether the inventory sweep leaves this player alone, and records the bypass it granted. */
export function isInventoryExempt(player: Player): boolean {
    const reason = getPrivilegeReason(player);
    if (reason !== "creative" && reason !== "tag") return false;

    auditBypass(player, reason);
    return true;
}
