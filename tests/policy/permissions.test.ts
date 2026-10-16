import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GameMode } from "@minecraft/server";
import {
    getPrivilegeReason,
    isInventoryExempt,
    PLAYER_TAGS
} from "../../packs/BP/scripts/core/permissions.js";

function playerHandle(id: string, gameMode: string, tagged = false): any {
    return {
        id,
        name: id,
        getGameMode: () => gameMode,
        hasTag: (tag: string) => tagged && tag === PLAYER_TAGS.BUILDER_EXEMPT
    };
}

describe("Permissions & Authorization Policy Tests", () => {
    let lines: string[];
    let restoreWarnings: () => void;

    // The bypass audit writes through the ambient Bedrock console, so capture it rather than let every
    // privileged case print a line into the test output.
    beforeEach(() => {
        lines = [];
        const original = console.warn;
        console.warn = (message?: unknown) => {
            lines.push(String(message));
        };
        restoreWarnings = () => {
            console.warn = original;
        };
    });

    afterEach(() => {
        restoreWarnings();
    });

    it("exempts only Creative and tagged Survival players from the sweep", () => {
        const cases: [string, string, boolean, boolean][] = [
            ["player_creative_1", GameMode.Creative, false, true],
            ["player_staff_1", GameMode.Survival, true, true],
            ["player_survival_1", GameMode.Survival, false, false],
            ["player_adv_1", GameMode.Adventure, false, false]
        ];

        for (const [id, mode, tagged, exempt] of cases) {
            assert.equal(isInventoryExempt(playerHandle(id, mode, tagged)), exempt, `${id} in ${mode}`);
        }
    });

    it("names the reason behind each privileged player, and none behind a survival one", () => {
        assert.equal(getPrivilegeReason(playerHandle("reason_creative", GameMode.Creative)), "creative");
        assert.equal(getPrivilegeReason(playerHandle("reason_spectator", GameMode.Spectator)), "spectator");
        assert.equal(getPrivilegeReason(playerHandle("reason_tagged", GameMode.Survival, true)), "tag");
        assert.equal(getPrivilegeReason(playerHandle("reason_plain", GameMode.Survival)), null);
    });

    it("reads a handle that answers no game mode as an unprivileged player", () => {
        const shapeless = { id: "reason_shapeless", name: "Shapeless", hasTag: () => false };

        assert.equal(getPrivilegeReason(shapeless as any), null);
    });

    it("records each bypass once per cooldown window, naming the privilege it took", () => {
        const player = playerHandle("audited_creative", GameMode.Creative);

        isInventoryExempt(player);
        isInventoryExempt(player);
        isInventoryExempt(playerHandle("audited_tagged", GameMode.Survival, true));

        assert.equal(lines.length, 2, "a repeat inside the cooldown window is silent");
        assert.match(
            lines[0],
            /^AUTH: Player 'audited_creative' \(audited_creative\) bypassed inventory check via creative mode\.$/
        );
        assert.match(lines[1], /bypassed inventory check via builder_exempt tag\.$/);
    });
});
