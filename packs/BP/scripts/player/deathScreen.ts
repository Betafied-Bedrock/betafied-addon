import { ActionFormData, uiManager } from "@minecraft/server-ui";
import type { ActionFormResponse } from "@minecraft/server-ui";
import type { Player } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { reportError } from "../core/errorReporter.js";

export const DEATH_SCREEN_COPY = Object.freeze({
    title: "Game over!",
    body: "Score: &e0",
    respawnButton: "Respawn",
    titleMenuButton: "Title menu"
});

export interface DeathScreenHandlers {
    onRespawn: (player: Player) => void;
    onTitleMenu: (player: Player) => void;
}

const pendingScreens = new Map<string, number>();
let showSequence = 0;

export function isDeathScreenPending(playerId: string): boolean {
    return pendingScreens.has(playerId);
}

// Generation-guarded: a form resolving after a re-death, leave or respawn belongs to a screen nobody is looking at.
function releasePendingScreen(playerId: string, generation: number): boolean {
    if (pendingScreens.get(playerId) !== generation) return false;
    pendingScreens.delete(playerId);
    return true;
}

function applyScreenResponse(
    player: Player,
    generation: number,
    handlers: DeathScreenHandlers,
    response: ActionFormResponse
): void {
    if (!releasePendingScreen(player.id, generation)) return;
    if (response.canceled) return;

    if (response.selection === 0) handlers.onRespawn(player);
    else if (response.selection === 1) handlers.onTitleMenu(player);
}

function reportScreenFailure(player: Player, generation: number, error: unknown): void {
    releasePendingScreen(player.id, generation);
    reportError({ system: "deathScreen", operation: "show", target: player.name }, error);
}

export function showDeathScreen(player: Player, handlers: DeathScreenHandlers): void {
    if (!player.isValid) return;
    if (pendingScreens.has(player.id)) return;

    const generation = ++showSequence;
    pendingScreens.set(player.id, generation);

    const form = new ActionFormData()
        .title(DEATH_SCREEN_COPY.title)
        .body(DEATH_SCREEN_COPY.body)
        .button(DEATH_SCREEN_COPY.respawnButton)
        .button(DEATH_SCREEN_COPY.titleMenuButton);

    form.show(player)
        .then((response) => applyScreenResponse(player, generation, handlers, response))
        .catch((e) => reportScreenFailure(player, generation, e));
}

export function dismissDeathScreen(player: Player): void {
    pendingScreens.delete(player.id);

    try {
        uiManager.closeAllForms(player);
    } catch (e) {
        reportError({ system: "deathScreen", operation: "dismiss", target: player.name }, e);
    }
}

eventBus.onPlayerLeave((ev) => {
    pendingScreens.delete(ev.playerId);
});

