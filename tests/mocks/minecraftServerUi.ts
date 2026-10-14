/**
 * Mock implementation of @minecraft/server-ui for offline testing and integration verification.
 *
 * A form is a player-facing dialog, so the mock cannot prompt. It records the form it was handed and
 * resolves it from a queued outcome on the next macrotask. That is the one assumption every form test
 * stands on: the engine hands the player's click back as a resolved `ActionFormResponse`. The engine's
 * own rejections — a player already busy, a player who left, a form with no buttons — are *not*
 * modelled; they surface in game, not here.
 */

// A frozen object rather than an `enum`: the suite runs under Node's strip-only TypeScript mode,
// which refuses an enum because it is a runtime construct with no type-only equivalent. The real
// module's enum is a string enum, so the member values are what the source actually depends on.
export const FormCancelationReason = Object.freeze({
    UserBusy: "UserBusy",
    UserClosed: "UserClosed"
});

export type FormCancelationReason = (typeof FormCancelationReason)[keyof typeof FormCancelationReason];

export interface ActionFormResponse {
    readonly canceled: boolean;
    readonly cancelationReason?: FormCancelationReason;
    readonly selection?: number;
}

export type FormOutcome =
    | { selection: number }
    | { canceled: true; cancelationReason: FormCancelationReason };

export interface ShownForm {
    titleText?: string;
    bodyText?: string;
    buttons: string[];
    player?: any;
}

/** Every form shown this run, newest last, in the order the code built it. */
export const formsShown: ShownForm[] = [];

/** The id of each player whose open forms the code closed through `uiManager`. */
export const closedFormPlayers: string[] = [];

let nextOutcome: FormOutcome = {
    canceled: true,
    cancelationReason: FormCancelationReason.UserClosed
};

export function setNextFormOutcome(outcome: FormOutcome): void {
    nextOutcome = outcome;
}

/** Clears the record between cases; `resetMocks` cannot reach this module's state. */
export function resetUiMocks(): void {
    formsShown.length = 0;
    closedFormPlayers.length = 0;
    nextOutcome = { canceled: true, cancelationReason: FormCancelationReason.UserClosed };
}

export class ActionFormData {
    private titleText?: string;
    private bodyText?: string;
    private buttons: string[] = [];

    title(titleText: string): ActionFormData {
        this.titleText = titleText;
        return this;
    }

    body(bodyText: string): ActionFormData {
        this.bodyText = bodyText;
        return this;
    }

    button(text: string): ActionFormData {
        this.buttons.push(text);
        return this;
    }

    show(player: any): Promise<ActionFormResponse> {
        formsShown.push({
            titleText: this.titleText,
            bodyText: this.bodyText,
            buttons: [...this.buttons],
            player
        });

        const outcome = nextOutcome;
        return new Promise((resolve) => {
            setImmediate(() => {
                resolve(
                    "selection" in outcome
                        ? { canceled: false, selection: outcome.selection }
                        : { canceled: true, cancelationReason: outcome.cancelationReason }
                );
            });
        });
    }
}

export const uiManager = {
    closeAllForms(player: any): void {
        closedFormPlayers.push(player.id);
    }
};
