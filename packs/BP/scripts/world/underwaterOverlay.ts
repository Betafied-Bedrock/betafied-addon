import { world } from "@minecraft/server";
import type { Player, Vector3 } from "@minecraft/server";
import { tickManager } from "../core/tickManager.js";
import { eventBus } from "../core/eventBus.js";
import { runCatching, reportError } from "../core/errorReporter.js";
import { OVERWORLD_ID, NETHER_ID } from "../policy/betaConstants.js";

// Sentinel recognized by packs/RP/ui/hud_screen.json to drive the Beta water tint.
export const UNDERWATER_SENTINEL = "_w";

// Pushes a hidden sentinel to reset the UI binding when surfacing without clearing the title channel.
export const CLEAR_SENTINEL = "_w0";

const CONFIG = Object.freeze({
    CHECK_INTERVAL: 2,
    REFRESH_INTERVAL: 5
});

const STATIC_HEIGHT_RANGES: Readonly<Record<string, { min: number; max: number }>> = Object.freeze({
    [OVERWORLD_ID]: { min: -64, max: 320 },
    [NETHER_ID]: { min: 0, max: 256 }
});

const SCRATCH_BLOCK_POS: Vector3 = { x: 0, y: 0, z: 0 };

const tintedPlayers = new Set<string>();

let ticksSinceRefresh = 0;

export function isHeadSubmerged(player: Player): boolean {
    const head = player.getHeadLocation();
    const dimension = player.dimension;
    const range = STATIC_HEIGHT_RANGES[dimension.id] ?? dimension.heightRange;

    if (head.y < range.min || head.y >= range.max) {
        return false;
    }

    SCRATCH_BLOCK_POS.x = Math.floor(head.x);
    SCRATCH_BLOCK_POS.y = Math.floor(head.y);
    SCRATCH_BLOCK_POS.z = Math.floor(head.z);

    const block = dimension.getBlock(SCRATCH_BLOCK_POS);

    return block !== undefined && block.isLiquid && block.typeId.includes("water");
}

function sendSentinel(player: Player): void {
    runCatching({ system: "underwaterOverlay", operation: "sendSentinel", target: player.name }, () => {
        player.onScreenDisplay.setTitle(UNDERWATER_SENTINEL);
    });
}

function clearSentinel(player: Player): void {
    runCatching({ system: "underwaterOverlay", operation: "clearSentinel", target: player.name }, () => {
        player.onScreenDisplay.setTitle(CLEAR_SENTINEL);
    });
}

export function underwaterOverlayJob(): void {
    ticksSinceRefresh = (ticksSinceRefresh + 1) % CONFIG.REFRESH_INTERVAL;
    const refreshDue = ticksSinceRefresh === 0;

    for (const player of world.getAllPlayers()) {
        let submerged: boolean;
        try {
            submerged = isHeadSubmerged(player);
        } catch (e) {
            reportError({ system: "underwaterOverlay", operation: "resolveHeadSubmerged", target: player.name }, e);
            continue;
        }

        if (submerged) {
            if (refreshDue || !tintedPlayers.has(player.id)) {
                sendSentinel(player);
            }
            tintedPlayers.add(player.id);
        } else if (tintedPlayers.delete(player.id)) {
            clearSentinel(player);
        }
    }
}

eventBus.onPlayerLeave((event) => {
    tintedPlayers.delete(event.playerId);
});

tickManager.register("underwaterOverlay", CONFIG.CHECK_INTERVAL, underwaterOverlayJob, 0);
