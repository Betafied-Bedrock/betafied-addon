import { Entity, EntityComponentTypes } from "@minecraft/server";
import { isBetaMob } from "../policy/betaRegistry.js";
import { reportError, runCatching } from "../core/errorReporter.js";

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
    readonly requireComponent?: string;
}

export interface EntityEffectRemovalRule {
    readonly effectType: string;
    readonly absentComponent: string;
    readonly targetTypes?: ReadonlySet<string>;
}

export const BETA_ENTITY_PROPERTY_RULES: readonly EntityPropertyRule[] = Object.freeze([
    { identifier: "betarock:shadow_span" },
    { identifier: "betarock:shadow_alpha" }
]);

export const BETA_ENTITY_EFFECT_RULES: readonly EntityEffectRule[] = Object.freeze([
    {
        effectType: "invisibility",
        duration: 20000000,
        showParticles: false,
        requireComponent: EntityComponentTypes.IsHiddenWhenInvisible
    }
]);

export const BETA_ENTITY_EFFECT_REMOVAL_RULES: readonly EntityEffectRemovalRule[] = Object.freeze([
    {
        effectType: "invisibility",
        absentComponent: EntityComponentTypes.IsHiddenWhenInvisible
    }
]);

/**
 * What one migration pass runs. Configuration arrives as a single object, the way the sibling
 * sanitizer takes it, so the two hooks a caller runs over an entity are configured alike.
 */
export interface EntityMigrationOptions {
    readonly propertyRules: readonly EntityPropertyRule[];
    readonly effectRules: readonly EntityEffectRule[];
    readonly removalRules: readonly EntityEffectRemovalRule[];
}

export const BETA_ENTITY_MIGRATION: EntityMigrationOptions = Object.freeze({
    propertyRules: BETA_ENTITY_PROPERTY_RULES,
    effectRules: BETA_ENTITY_EFFECT_RULES,
    removalRules: BETA_ENTITY_EFFECT_REMOVAL_RULES
});

/** A rule without a type list is one every entity the pass sees is asked about. */
function ruleAppliesTo(rule: { readonly targetTypes?: ReadonlySet<string> }, typeId: string): boolean {
    return rule.targetTypes === undefined || rule.targetTypes.has(typeId);
}

/**
 * A property the entity does not carry yet is the unmigrated one. The reset asks the entity's own
 * definition for it, and a refusal there is the only signal that the rule's default is what repairs
 * the value rather than the definition already agreeing with it.
 */
function repairProperty(entity: Entity, rule: EntityPropertyRule): void {
    if (entity.getProperty(rule.identifier) !== undefined) return;

    try {
        entity.resetProperty(rule.identifier);
    } catch (err) {
        // A refused reset is what routes us to the rule's default, and it is the only signal that the
        // property was repaired rather than already correct.
        reportError({
            system: "entityMigration",
            operation: "resetProperty",
            target: `${entity.typeId}:${rule.identifier}`
        }, err);

        if (rule.defaultValue !== undefined) {
            entity.setProperty(rule.identifier, rule.defaultValue);
        }
    }
}

/** The effect an entity is missing, added only where its own definition can carry the swap. */
function applyEffect(entity: Entity, rule: EntityEffectRule): void {
    if (rule.requireComponent && !entity.hasComponent(rule.requireComponent)) return;
    if (entity.getEffect(rule.effectType)) return;

    entity.addEffect(rule.effectType, rule.duration, {
        showParticles: rule.showParticles
    });
}

/**
 * An effect this pack put on an entity that no longer justifies it. Twenty million ticks outlive the
 * save, so it has to be taken back rather than waited out.
 */
function withdrawEffect(entity: Entity, rule: EntityEffectRemovalRule): void {
    if (entity.hasComponent(rule.absentComponent)) return;
    if (!entity.getEffect(rule.effectType)) return;

    entity.removeEffect(rule.effectType);
}

export function migrateEntity(
    entity: Entity | undefined,
    options: EntityMigrationOptions = BETA_ENTITY_MIGRATION
): void {
    if (!entity || !entity.isValid) return;

    if (!isBetaMob(entity.typeId)) return;

    const { propertyRules, effectRules, removalRules } = options;
    const typeId = entity.typeId;

    for (const rule of propertyRules) {
        if (!ruleAppliesTo(rule, typeId)) continue;

        runCatching({
            system: "entityMigration",
            operation: "migrateProperty",
            target: `${typeId}:${rule.identifier}`
        }, () => repairProperty(entity, rule));
    }

    for (const rule of effectRules) {
        if (!ruleAppliesTo(rule, typeId)) continue;

        runCatching({
            system: "entityMigration",
            operation: "migrateEffect",
            target: `${typeId}:${rule.effectType}`
        }, () => applyEffect(entity, rule));
    }

    for (const rule of removalRules) {
        if (!ruleAppliesTo(rule, typeId)) continue;

        runCatching({
            system: "entityMigration",
            operation: "removeEffect",
            target: `${typeId}:${rule.effectType}`
        }, () => withdrawEffect(entity, rule));
    }
}
