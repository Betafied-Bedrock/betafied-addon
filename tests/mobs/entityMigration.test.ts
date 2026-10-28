import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Entity, resetMocks } from "../mocks/minecraftServer.js";
import { migrateEntity } from "../../packs/BP/scripts/mobs/entityMigration.js";

describe("EntityMigration - the retired swap's invisibility", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("takes the pack's own invisibility back off a Beta mob", () => {
        const cow = new Entity();
        cow.typeId = "minecraft:cow";
        cow.addEffect("invisibility", 20000000, { showParticles: false });

        // Twenty million ticks outlive the save, so the effect has to be removed rather than waited out.
        migrateEntity(cow);

        assert.equal(cow.getEffect("invisibility"), undefined, "the leftover invisibility is removed");
    });

    it("is idempotent", () => {
        const cow = new Entity();
        cow.typeId = "minecraft:cow";
        cow.addEffect("invisibility", 20000000, { showParticles: false });

        migrateEntity(cow);
        assert.doesNotThrow(() => migrateEntity(cow));
        assert.equal(cow.getEffect("invisibility"), undefined);
    });

    it("leaves a non-Beta mob and a despawned handle alone", () => {
        const sniffer = new Entity();
        sniffer.typeId = "minecraft:sniffer";
        sniffer.addEffect("invisibility", 20000000, { showParticles: false });

        migrateEntity(sniffer);
        assert.ok(sniffer.getEffect("invisibility"), "a post-Beta mob's effects are not the pack's to clear");

        const cow = new Entity();
        cow.typeId = "minecraft:cow";
        cow.isValid = false;
        cow.addEffect("invisibility", 20000000, { showParticles: false });

        assert.doesNotThrow(() => migrateEntity(cow));
        assert.ok(cow.getEffect("invisibility"), "and a despawned handle is not migrated");
    });
});
