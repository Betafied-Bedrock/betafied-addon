import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Entity, resetMocks, declaredEntityProperties } from "../mocks/minecraftServer.js";
import { migrateEntity } from "../../packs/BP/scripts/mobs/entityMigration.js";

describe("EntityMigration - Future-Proof Entity Property & Effect Migration", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("initializes missing shadow properties on unmigrated Beta mobs", () => {
        const cow = new Entity();
        cow.typeId = "minecraft:cow";

        migrateEntity(cow);

        assert.equal(cow.getProperty("betarock:shadow_span"), 1);
        assert.equal(cow.getProperty("betarock:shadow_alpha"), 0.5);
    });

    it("applies missing infinite invisibility effect without particles to suppress native shadow", () => {
        const cow = new Entity();
        cow.typeId = "minecraft:cow";
        cow.setComponent("minecraft:is_hidden_when_invisible", {});

        migrateEntity(cow);

        const effect = cow.getEffect("invisibility");
        assert.ok(effect, "invisibility effect should be applied");
        assert.equal(effect.duration, 20000000);
        assert.equal(effect.showParticles, false);
    });

    it("leaves the invisibility off an entity that predates the render half of the swap", () => {
        const cow = new Entity();
        cow.typeId = "minecraft:cow";

        migrateEntity(cow);

        // A permanent invisibility is only a shadow removal on an entity the current definition also
        // keeps drawn; on one that predates it the effect is the whole of what a player sees.
        assert.equal(cow.getEffect("invisibility"), undefined);
        assert.equal(cow.getProperty("betarock:shadow_span"), 1, "the properties are still migrated");
    });

    it("takes the pack's own invisibility back off an entity that no longer hides", () => {
        const player = new Entity();
        player.typeId = "minecraft:player";
        player.addEffect("invisibility", 20000000, { showParticles: false });

        // The player's definition stopped hiding from hostile mobs, and the world cannot wait the
        // effect out: twenty million ticks outlive it, so a player would stay untargetable for the
        // rest of the save. The component's absence is what marks it as this pack's leftover.
        migrateEntity(player);

        assert.equal(player.getEffect("invisibility"), undefined, "the leftover invisibility is removed");
    });

    it("is idempotent, and lands the effect once the render half arrives", () => {
        const cow = new Entity();
        cow.typeId = "minecraft:cow";

        migrateEntity(cow);
        const writeCount = cow.propertyWrites.length;
        migrateEntity(cow);
        assert.equal(cow.propertyWrites.length, writeCount, "a migrated entity earns no further writes");

        cow.setComponent("minecraft:is_hidden_when_invisible", {});
        migrateEntity(cow);
        const applied = cow.getEffect("invisibility");
        assert.ok(applied, "the effect lands as soon as the swap can carry it");

        migrateEntity(cow);
        assert.deepEqual(cow.getEffect("invisibility"), applied, "and is not re-added afterwards");
    });

    it("takes a caller's own property rules, and their default when the engine refuses the reset", () => {
        declaredEntityProperties.set("betarock:future_scale", 1.5);
        declaredEntityProperties.set("betarock:fallback_prop", 42);

        const cow = new Entity();
        cow.typeId = "minecraft:cow";

        migrateEntity(cow, {
            propertyRules: [{ identifier: "betarock:future_scale" }],
            effectRules: [],
            removalRules: []
        });
        assert.equal(cow.getProperty("betarock:future_scale"), 1.5, "a declared definition answers the reset");

        const guarded = new Entity();
        guarded.typeId = "minecraft:cow";
        guarded.resetProperty = () => {
            throw new Error("resetProperty failed");
        };

        migrateEntity(guarded, {
            propertyRules: [{ identifier: "betarock:fallback_prop", defaultValue: 42 }],
            effectRules: [],
            removalRules: []
        });
        assert.equal(guarded.getProperty("betarock:fallback_prop"), 42, "and the rule's own default covers a refusal");
    });

    it("leaves a non-Beta mob and a despawned handle alone", () => {
        const sniffer = new Entity();
        sniffer.typeId = "minecraft:sniffer";

        migrateEntity(sniffer);
        assert.equal(sniffer.propertyWrites.length, 0, "a post-Beta mob earns no Beta properties");
        assert.equal(sniffer.getEffect("invisibility"), undefined);

        const cow = new Entity();
        cow.typeId = "minecraft:cow";
        cow.isValid = false;

        assert.doesNotThrow(() => migrateEntity(cow));
        assert.equal(cow.propertyWrites.length, 0, "and a despawned handle is not migrated");
    });
});
