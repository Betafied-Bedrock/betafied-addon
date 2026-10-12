import { Entity } from "@minecraft/server";
import { isBetaMob } from "../core/betaRegistry.js";
import { runCatching } from "../core/errorReporter.js";

export interface EntityPropertyRule {
    readonly identifier: string;
    readonly targetTypes?: ReadonlySet<string>;
    readonly defaultValue?: boolean | number | string;
}

export interface EntityEffectRule {
    readonly effectType: string;
    readonly duration: number;
    readonly showParticles: boolean;
    readonly targetTypes?: ReadonlySet<string>;
}

export const BETA_ENTITY_PROPERTY_RULES: readonly EntityPropertyRule[] = Object.freeze([
    { identifier: "betarock:shadow_span" },
    { identifier: "betarock:shadow_alpha" }
]);

export const BETA_ENTITY_EFFECT_RULES: readonly EntityEffectRule[] = Object.freeze([
    { effectType: "invisibility", duration: 20000000, showParticles: false }
]);

export function migrateEntity(
    entity: Entity | undefined,
    propertyRules: readonly EntityPropertyRule[] = BETA_ENTITY_PROPERTY_RULES,
    effectRules: readonly EntityEffectRule[] = BETA_ENTITY_EFFECT_RULES
): void {
    if (!entity || !entity.isValid) return;

    if (!isBetaMob(entity.typeId)) return;

    for (const rule of propertyRules) {
        if (rule.targetTypes && !rule.targetTypes.has(entity.typeId)) continue;

        runCatching({
            system: "entityMigration",
            operation: "migrateProperty",
            target: `${entity.typeId}:${rule.identifier}`
        }, () => {
            if (entity.getProperty(rule.identifier) === undefined) {
                try {
                    entity.resetProperty(rule.identifier);
                } catch {
                    if (rule.defaultValue !== undefined) {
                        entity.setProperty(rule.identifier, rule.defaultValue);
                    }
                }
            }
        });
    }

    for (const rule of effectRules) {
        if (rule.targetTypes && !rule.targetTypes.has(entity.typeId)) continue;

        runCatching({
            system: "entityMigration",
            operation: "migrateEffect",
            target: `${entity.typeId}:${rule.effectType}`
        }, () => {
            if (!entity.getEffect(rule.effectType)) {
                entity.addEffect(rule.effectType, rule.duration, {
                    showParticles: rule.showParticles
                });
            }
        });
    }
}
