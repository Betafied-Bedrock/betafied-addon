import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    EquipmentSlot,
    EntityComponentTypes,
    EntityEquippableComponent,
    ItemStack,
    GameMode
} from "@minecraft/server";
import { mockPlayers, Player, resetMocks } from "../mocks/minecraftServer.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { toolMiningJob, swordMiningJob } from "../../packs/BP/scripts/interactions/toolMining.js";

interface Miner {
    readonly player: Player;
    readonly block: any;
    /** The options of the last view raycast, so a case can pin what the engine was asked for. */
    readonly raycastOptions: () => any;
}

function swordMiner(blockTypeId: string, gameMode: string = GameMode.Survival): Miner {
    const player = new Player();
    player.name = "Digger";
    player.id = `digger_${blockTypeId}`;
    player.setGameMode(gameMode);

    const equippable = new EntityEquippableComponent();
    equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:iron_sword", 1));
    player.setComponent(EntityComponentTypes.Equippable, equippable);

    const dimension = player.dimension;
    const block = dimension.getBlock({ x: 5, y: 64, z: 5 });
    block.setType(blockTypeId);

    let lastOptions: any;
    player.getBlockFromViewDirection = ((options?: any) => {
        lastOptions = options;
        return { block, face: 0 };
    }) as any;

    mockPlayers.push(player);
    return { player, block, raycastOptions: () => lastOptions };
}

function startBreaking({ player, block }: Miner): void {
    eventBus.dispatch("playerStartBreakingBlock", {
        player,
        block,
        blockPermutation: block.permutation,
        face: "Up"
    } as any);
}

function advance(ticks: number): void {
    for (let tick = 0; tick < ticks; tick++) swordMiningJob();
}

/** The dimension is shared by every miner in this file, so a case reads only its own commands. */
function commandsSince(miner: Miner, mark: number): string[] {
    return miner.player.dimension.commandsRun.slice(mark);
}

describe("Tool Mining speed effects", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("does not perform raycasts when player is holding neither a pickaxe nor a sword", () => {
        const player = new Player();
        player.name = "Digger";
        player.id = "digger_1";

        const equippable = new EntityEquippableComponent();
        equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:dirt", 64));
        player.setComponent(EntityComponentTypes.Equippable, equippable);

        let raycastCount = 0;
        player.getBlockFromViewDirection = () => {
            raycastCount++;
            return undefined;
        };

        mockPlayers.push(player);
        toolMiningJob();

        assert.equal(raycastCount, 0, "holding dirt must bypass view direction raycasts entirely");
    });

    it("applies mining fatigue when looking at redstone ore with a pickaxe", () => {
        const player = new Player();
        player.name = "Miner";
        player.id = "miner_1";

        const equippable = new EntityEquippableComponent();
        equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:iron_pickaxe", 1));
        player.setComponent(EntityComponentTypes.Equippable, equippable);
        player.getBlockFromViewDirection = () => ({
            block: { typeId: "minecraft:redstone_ore" } as any,
            face: 0
        });

        mockPlayers.push(player);
        toolMiningJob();

        assert.ok(player.getEffect("mining_fatigue"), "mining fatigue should be active on redstone ore");
    });

    it("never applies haste, because the sword's speed is the break clock itself", () => {
        const miner = swordMiner("minecraft:oak_planks");
        startBreaking(miner);

        advance(1);

        assert.equal(miner.player.getEffect("haste"), undefined, "the effect was replaced by the break clock");
    });

    it("breaks the web on the sword's 15x swing and wood-class blocks on its 1.5x swing", () => {
        // Beta 1.7.3: ticks = hardness * 30 / sword speed, at 15 against web and 1.5 everywhere else.
        const targets: [string, number][] = [["minecraft:cobweb", 8], ["minecraft:oak_planks", 40]];

        for (const [blockTypeId, ticks] of targets) {
            const miner = swordMiner(blockTypeId);
            const mark = miner.player.dimension.commandsRun.length;
            startBreaking(miner);

            advance(ticks - 1);
            assert.deepEqual(commandsSince(miner, mark), [], `${blockTypeId} must not break before tick ${ticks}`);

            // A web is passable, and the engine's raycast skips passable blocks unless asked not to.
            assert.equal(
                miner.raycastOptions().includePassableBlocks,
                true,
                `${blockTypeId} must be found by the swing's raycast`
            );

            advance(1);
            assert.deepEqual(
                commandsSince(miner, mark),
                [`setblock 5 64 5 air destroy`],
                `${blockTypeId} must break on tick ${ticks} and let the block's loot table drop it`
            );

            advance(20);
            assert.equal(commandsSince(miner, mark).length, 1, "a finished break must not fire twice");
        }
    });

    it("resets the clock when the block leaves the sword's sight or the swing is cancelled", () => {
        for (const interrupt of ["look away", "cancel"] as const) {
            const miner = swordMiner("minecraft:oak_planks");
            const mark = miner.player.dimension.commandsRun.length;
            startBreaking(miner);
            advance(20);

            if (interrupt === "look away") {
                miner.player.getBlockFromViewDirection = () => ({ block: { typeId: "minecraft:stone" }, face: 0 }) as any;
            } else {
                eventBus.dispatch("playerCancelBreakingBlock", {
                    player: miner.player,
                    block: miner.block,
                    blockPermutation: miner.block.permutation,
                    breakProgress: 0.5,
                    face: "Up"
                } as any);
            }

            swordMiningJob();
            advance(60);

            assert.deepEqual(
                commandsSince(miner, mark),
                [],
                `${interrupt} must drop the progress instead of finishing a swing nobody is making`
            );
        }
    });

    it("leaves blocks the sword does not shorten to the engine", () => {
        const miner = swordMiner("minecraft:stone");
        startBreaking(miner);

        advance(100);

        assert.deepEqual(miner.player.dimension.commandsRun, [], "a sword must not shorten a pickaxe block");
    });

    it("records nothing in creative, where the engine already breaks a block on the first tick", () => {
        const miner = swordMiner("minecraft:cobweb", GameMode.Creative);
        startBreaking(miner);

        advance(20);

        assert.deepEqual(miner.player.dimension.commandsRun, []);
    });
});
