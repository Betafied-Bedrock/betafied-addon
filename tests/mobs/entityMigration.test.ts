import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Entity, resetMocks, declaredEntityProperties } from "../mocks/minecraftServer.js";
import {
    migrateEntity,
    BETA_ENTITY_PROPERTY_RULES,
    BETA_ENTITY_EFFECT_RULES,
    type EntityPropertyRule,
    type EntityEffectRule
} from "../../packs/BP/scripts/mobs/entityMigration.js";

describe("EntityMigration - Future-Proof Entity Property & Effect Migration", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("initializes missing shadow properties on unmigrated Beta mobs", () => {
        const cow = new Entity();
        cow.typeId = "minecraft:cow";

        assert.equal(cow.getProperty("betarock:shadow_span"), undefined);
        assert.equal(cow.getProperty("betarock:shadow_alpha"), undefined);

        migrateEntity(cow);

        assert.equal(cow.getProperty("betarock:shadow_span"), 1);
        assert.equal(cow.getProperty("betarock:shadow_alpha"), 0.5);
        assert.equal(cow.propertyWrites.length, 2);
    });

    it("applies missing infinite invisibility effect without particles to suppress native shadow", () => {
        const cow = new Entity();
        cow.typeId = "minecraft:cow";

        assert.equal(cow.getEffect("invisibility"), undefined);

        migrateEntity(cow);

        const effect = cow.getEffect("invisibility");
        assert.ok(effect, "invisibility effect should be applied");
        assert.equal(effect.duration, 20000000);
        assert.equal(effect.showParticles, false);
    });

    it("is idempotent and leaves already-migrated entities untouched", () => {
        const cow = new Entity();
        cow.typeId = "minecraft:cow";

        migrateEntity(cow);
        const writeCount = cow.propertyWrites.length;

        // Second pass
        migrateEntity(cow);
        assert.equal(cow.propertyWrites.length, writeCount, "no additional property writes on migrated entity");
    });

    it("future-proof: seamlessly applies custom property rules to unmigrated mobs", () => {
        declaredEntityProperties.set("betarock:future_scale", 1.5);
        const cow = new Entity();
        cow.typeId = "minecraft:cow";

        const customPropertyRules: EntityPropertyRule[] = [
            { identifier: "betarock:future_scale" }
        ];

        migrateEntity(cow, customPropertyRules, []);

        assert.equal(cow.getProperty("betarock:future_scale"), 1.5);
    });

    it("falls back to defaultValue if resetProperty throws for undeclared definition", () => {
        const cow = new Entity();
        cow.typeId = "minecraft:cow";

        const customPropertyRules: EntityPropertyRule[] = [
            { identifier: "betarock:fallback_prop", defaultValue: 42 }
        ];
        declaredEntityProperties.set("betarock:fallback_prop", 42);

        // Temporarily make resetProperty throw to test fallback
        cow.resetProperty = () => {
            throw new Error("resetProperty failed");
        };

        migrateEntity(cow, customPropertyRules, []);

        assert.equal(cow.getProperty("betarock:fallback_prop"), 42);
    });

    it("safely skips non-Beta or non-mob entities", () => {
        const sniffer = new Entity();
        sniffer.typeId = "minecraft:sniffer";

        migrateEntity(sniffer);
        assert.equal(sniffer.propertyWrites.length, 0);
        assert.equal(sniffer.getEffect("invisibility"), undefined);

        const item = new Entity();
        item.typeId = "minecraft:item";

        migrateEntity(item);
        assert.equal(item.propertyWrites.length, 0);
    });

    it("safely handles invalid or destroyed entities without throwing", () => {
        const cow = new Entity();
        cow.typeId = "minecraft:cow";
        cow.isValid = false;

        assert.doesNotThrow(() => {
            migrateEntity(cow);
        });
        assert.equal(cow.propertyWrites.length, 0);
    });
});
