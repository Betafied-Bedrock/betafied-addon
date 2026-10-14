import { Player, GameMode } from "@minecraft/server";

export const PRIVILEGED_TAGS = Object.freeze({
    BUILDER_EXEMPT: "builder_exempt"
} as const);

const auditLogCooldowns = new Map<string, number>();
const AUDIT_LOG_INTERVAL_MS = 60_000;
const AUDIT_LOG_MAX_ENTRIES = 256;

function rememberAuditLog(playerId: string, now: number): void {
    if (auditLogCooldowns.size >= AUDIT_LOG_MAX_ENTRIES) {
        const oldest = auditLogCooldowns.keys().next().value;
        if (oldest !== undefined) auditLogCooldowns.delete(oldest);
    }
    auditLogCooldowns.set(playerId, now);
}

export function isInventoryExempt(player: Player): boolean {
    if (player.getGameMode() === GameMode.Creative) {
        return true;
    }

    if (player.hasTag(PRIVILEGED_TAGS.BUILDER_EXEMPT)) {
        const now = Date.now();
        const lastLog = auditLogCooldowns.get(player.id) ?? 0;
        if (now - lastLog > AUDIT_LOG_INTERVAL_MS) {
            console.warn(`AUTH: Player '${player.name}' (${player.id}) bypassed inventory check via ${PRIVILEGED_TAGS.BUILDER_EXEMPT} tag.`);
            rememberAuditLog(player.id, now);
        }
        return true;
    }

    return false;
}
