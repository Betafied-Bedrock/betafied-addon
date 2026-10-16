import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    Entity,
    EntityComponentTypes,
    EntityEquippableComponent,
    EquipmentSlot,
    ItemStack,
    resetMocks,
    world
} from "@minecraft/server";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import "../../packs/BP/scripts/mobs/pigmanEquipment.js";

const GOLDEN_SWORD = "minecraft:golden_sword";

interface Spawned {
    equip: EntityEquippableComponent;
    mainHand: () => ItemStack | undefined;
}

/** One spawn of `typeId`, with whatever that entity already held in its main hand. */
function spawn(typeId: string, held?: ItemStack): Spawned {
    const entity = new Entity();
    entity.typeId = typeId;
    entity.dimension = world.getDimension("minecraft:nether");

    const equip = new EntityEquippableComponent();
    if (held !== undefined) equip.setEquipment(EquipmentSlot.Mainhand, held);

    entity.setComponent(EntityComponentTypes.Equippable, equip);
    eventBus.dispatch("entitySpawn", { entity });

    return { equip, mainHand: () => equip.getEquipment(EquipmentSlot.Mainhand) };
}

describe("Pigman Equipment - the era's sword", () => {
    beforeEach(() => {
        resetMocks();
        eventBus.init();
    });

    it("arms the pigman and no other mob that spawns", () => {
        const rows: [string, boolean][] = [
            ["minecraft:zombie_pigman", true],
            ["minecraft:zombified_piglin", true],
            ["minecraft:zombie", false],
            ["minecraft:pig", false],
            ["minecraft:player", false]
        ];

        for (const [typeId, armed] of rows) {
            const { mainHand } = spawn(typeId);

            assert.equal(
                mainHand()?.typeId,
                armed ? GOLDEN_SWORD : undefined,
                armed
                    ? `${typeId} is a pigman, so it spawns holding the era's sword`
                    : `${typeId} is not a pigman, and nothing else carries the sword`
            );
        }
    });

    it("keeps the sword the pigman spawned in with", () => {
        const held = new ItemStack(GOLDEN_SWORD, 1);
        const { mainHand } = spawn("minecraft:zombie_pigman", held);

        assert.equal(
            mainHand(),
            held,
            "a pigman that already carries the sword keeps that very stack rather than a fresh one"
        );
    });

    it("keeps the spawn pass alive when the pigman is gone before the read", () => {
        const entity = new Entity();
        entity.typeId = "minecraft:zombie_pigman";
        entity.dimension = world.getDimension("minecraft:nether");
        (entity as any).getComponent = () => {
            throw new Error("InvalidEntityError: the pigman despawned");
        };

        // The read is the race a spawn pass cannot afford to lose: the entity is gone between the
        // event and the component lookup, and the pass has to carry on to the next spawn.
        assert.doesNotThrow(() => eventBus.dispatch("entitySpawn", { entity }));
    });
});
