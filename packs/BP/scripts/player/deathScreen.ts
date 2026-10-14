import { ActionFormData, uiManager } from "@minecraft/server-ui";
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

export function showDeathScreen(player: Player, handlers: DeathScreenHandlers): void {
    if (!player.isValid) return;
    if (pendingScreens.has(player.id)) return;

    const generation = ++showSequence;
    pendingScreens.set(player.id, generation);

    const release = (): boolean => {
        if (pendingScreens.get(player.id) !== generation) return false;
        pendingScreens.delete(player.id);
        return true;
    };

    const form = new ActionFormData()
        .title(DEATH_SCREEN_COPY.title)
        .body(DEATH_SCREEN_COPY.body)
        .button(DEATH_SCREEN_COPY.respawnButton)
        .button(DEATH_SCREEN_COPY.titleMenuButton);

    form.show(player)
        .then((response) => {
            if (!release()) return;
            if (response.canceled) return;

            if (response.selection === 0) handlers.onRespawn(player);
            else if (response.selection === 1) handlers.onTitleMenu(player);
        })
        .catch((e) => {
            release();
            reportError({ system: "deathScreen", operation: "show", target: player.name }, e);
        });
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

