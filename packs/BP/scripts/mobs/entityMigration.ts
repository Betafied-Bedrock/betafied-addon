import { Entity } from "@minecraft/server";
import { isBetaMob } from "../policy/betaRegistry.js";
import { runCatching } from "../core/errorReporter.js";

// 20M ticks outlive the save, so the retired swap's invisibility has to be taken back, not waited out.
function withdrawInvisibility(entity: Entity): void {
    if (!entity.getEffect("invisibility")) return;

    entity.removeEffect("invisibility");
}

export function migrateEntity(entity: Entity | undefined): void {
    if (!entity || !entity.isValid) return;

    if (!isBetaMob(entity.typeId)) return;

    runCatching({
        system: "entityMigration",
        operation: "removeEffect",
        target: `${entity.typeId}:invisibility`
    }, () => withdrawInvisibility(entity));
}
