import { system, world } from "@minecraft/server";
import type { Player, TeleportOptions, Vector3 } from "@minecraft/server";
import { reportError, runCatching } from "./errorReporter.js";

const MUTE_TICKS = 20;

/** The gamerule write lands a tick after the call, so the move has to follow it rather than precede it. */
export const TELEPORT_DELAY_TICKS = 2;

let mutedByUs = false;
let pendingRestores = 0;

type MuteState = "ours" | "external";

function muteCommandFeedback(): MuteState {
    const rules = world.gameRules;

    // Feedback was already disabled by something else.
    // Don't touch it and don't restore it later.
    if (!rules.sendCommandFeedback && !mutedByUs) {
        return "external";
    }

    if (rules.sendCommandFeedback) {
        rules.sendCommandFeedback = false;
        mutedByUs = true;
        pendingRestores = 0;
    }

    pendingRestores += 1;

    system.runTimeout(() => {
        pendingRestores -= 1;

        if (pendingRestores > 0) {
            return;
        }

        mutedByUs = false;
        world.gameRules.sendCommandFeedback = true;
    }, MUTE_TICKS);

    return "ours";
}

export function teleportQuietly(
    player: Player,
    location: Vector3,
    options?: TeleportOptions,
): void {
    let mute: MuteState = "external";

    try {
        mute = muteCommandFeedback();
    } catch (e) {
        reportError(
            {
                system: "quietTeleport",
                operation: "mute",
                target: player.name,
            },
            e,
        );
    }

    const move = () => {
        runCatching(
            {
                system: "quietTeleport",
                operation: "teleport",
                target: player.name,
            },
            () => {
                player.teleport(location, options);
            },
        );
    };

    // If feedback was already disabled externally, there is no synchronization
    // problem and we can teleport immediately.
    if (mute === "external") {
        move();
        return;
    }

    system.runTimeout(move, TELEPORT_DELAY_TICKS);
}