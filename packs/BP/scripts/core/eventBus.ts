import { world } from "@minecraft/server";
import type {
    BlockContainerClosedAfterEvent,
    BlockContainerOpenedAfterEvent,
    ChatSendAfterEvent,
    EntityDieAfterEvent,
    EntityHitBlockAfterEvent,
    EntityHitEntityAfterEvent,
    EntityHurtAfterEvent,
    EntityHurtBeforeEvent,
    EntityLoadAfterEvent,
    EntitySpawnAfterEvent,
    ItemReleaseUseAfterEvent,
    ItemStartUseAfterEvent,
    ItemStopUseAfterEvent,
    ItemUseAfterEvent,
    ItemUseBeforeEvent,
    PlayerBreakBlockAfterEvent,
    PlayerBreakBlockBeforeEvent,
    PlayerDimensionChangeAfterEvent,
    PlayerGameModeChangeAfterEvent,
    PlayerInteractWithBlockBeforeEvent,
    PlayerInteractWithEntityBeforeEvent,
    PlayerInventoryItemChangeAfterEvent,
    PlayerLeaveAfterEvent,
    PlayerPlaceBlockAfterEvent,
    PlayerPlaceBlockBeforeEvent,
    PlayerSpawnAfterEvent
} from "@minecraft/server";
import { runCatching } from "./errorReporter.js";
import type { ErrorContext } from "./errorReporter.js";

/**
 * Wraps a handler in its own error envelope, so a registration reports a failure with the same
 * system/operation shape everywhere instead of hand-rolling a try/catch per call site. Pass a
 * function for the context when the report needs a target that only exists once the event is in.
 */
export function guarded<T>(
    context: ErrorContext | ((event: T) => ErrorContext),
    callback: (event: T) => void
): (event: T) => void {
    return (event: T) => {
        const resolved = typeof context === "function" ? context(event) : context;
        runCatching(resolved, () => callback(event));
    };
}

/**
 * Precedence for the handlers that share a cancellable event. Dispatch runs the highest priority first
 * and stops at the first cancel, so a rule that answers a click has to be placed against the broad
 * vetoes it shares the event with. The values live here rather than at the registration order in
 * `main.ts`, which is otherwise the only tie-break and would let a reordered import change gameplay.
 */
export const InteractPriority = Object.freeze({
    /** A rule that answers this click itself: cake, slabs, chests, bonemeal, placement, sleep. */
    RULE: 10,
    /** A veto over an area rather than the click: the era's build ceiling, applied to what no rule claimed. */
    AREA_VETO: -10
} as const);

interface RegisteredHandler<T> {
    id: number;
    priority: number;
    callback: (event: T) => void;
}

class EventBus {
    private handlers = new Map<string, RegisteredHandler<unknown>[]>();
    private initialized = false;
    private nextId = 1;

    // Private: the typed on* methods below are the module's subscription surface, so the string keys
    // exist only inside this file and cannot drift from a caller's guess at an event name.
    private subscribe<T>(eventName: string, callback: (event: T) => void, priority: number = 0): () => void {
        const id = this.nextId++;
        const list = this.handlers.get(eventName) ?? [];
        list.push({ id, priority, callback: callback as (event: unknown) => void });
        list.sort((a, b) => b.priority - a.priority || a.id - b.id);
        this.handlers.set(eventName, list);

        return () => {
            const current = this.handlers.get(eventName) ?? [];
            const filtered = current.filter(h => h.id !== id);
            this.handlers.set(eventName, filtered);
        };
    }

    dispatch<T extends object>(eventName: string, event: T): void {
        const list = this.handlers.get(eventName);
        if (!list || list.length === 0) return;

        for (const handler of list) {
            if ("cancel" in event && (event as { cancel?: boolean }).cancel === true) {
                break;
            }

            runCatching(
                { system: "EventBus", operation: `dispatch:${eventName}` },
                () => {
                    handler.callback(event);
                }
            );
        }
    }

    onPlayerInteractWithBlock(callback: (event: PlayerInteractWithBlockBeforeEvent) => void, priority: number = 0): () => void {
        return this.subscribe("playerInteractWithBlock", callback, priority);
    }

    onPlayerInteractWithEntity(callback: (event: PlayerInteractWithEntityBeforeEvent) => void, priority: number = 0): () => void {
        return this.subscribe("playerInteractWithEntity", callback, priority);
    }

    onItemUse(callback: (event: ItemUseBeforeEvent) => void, priority: number = 0): () => void {
        return this.subscribe("itemUse", callback, priority);
    }

    onItemUseAfter(callback: (event: ItemUseAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("itemUseAfter", callback, priority);
    }

    onEntitySpawn(callback: (event: EntitySpawnAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("entitySpawn", callback, priority);
    }

    onEntityLoad(callback: (event: EntityLoadAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("entityLoad", callback, priority);
    }

    onEntityDie(callback: (event: EntityDieAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("entityDie", callback, priority);
    }

    onEntityHurt(callback: (event: EntityHurtAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("entityHurt", callback, priority);
    }

    onEntityHurtBefore(callback: (event: EntityHurtBeforeEvent) => void, priority: number = 0): () => void {
        return this.subscribe("entityHurtBefore", callback, priority);
    }

    onEntityHitEntity(callback: (event: EntityHitEntityAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("entityHitEntity", callback, priority);
    }

    onEntityHitBlock(callback: (event: EntityHitBlockAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("entityHitBlock", callback, priority);
    }

    onPlayerPlaceBlock(callback: (event: PlayerPlaceBlockAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("playerPlaceBlock", callback, priority);
    }

    onPlayerPlaceBlockBefore(callback: (event: PlayerPlaceBlockBeforeEvent) => void, priority: number = 0): () => void {
        return this.subscribe("playerPlaceBlockBefore", callback, priority);
    }

    onPlayerBreakBlock(callback: (event: PlayerBreakBlockAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("playerBreakBlock", callback, priority);
    }

    onPlayerBreakBlockBefore(callback: (event: PlayerBreakBlockBeforeEvent) => void, priority: number = 0): () => void {
        return this.subscribe("playerBreakBlockBefore", callback, priority);
    }

    onPlayerDimensionChange(callback: (event: PlayerDimensionChangeAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("playerDimensionChange", callback, priority);
    }

    onPlayerSpawn(callback: (event: PlayerSpawnAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("playerSpawn", callback, priority);
    }

    onPlayerLeave(callback: (event: PlayerLeaveAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("playerLeave", callback, priority);
    }

    onBlockContainerOpened(callback: (event: BlockContainerOpenedAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("blockContainerOpened", callback, priority);
    }

    onBlockContainerClosed(callback: (event: BlockContainerClosedAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("blockContainerClosed", callback, priority);
    }

    onPlayerGameModeChange(callback: (event: PlayerGameModeChangeAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("playerGameModeChange", callback, priority);
    }

    onPlayerInventoryItemChange(callback: (event: PlayerInventoryItemChangeAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("playerInventoryItemChange", callback, priority);
    }

    onItemStartUse(callback: (event: ItemStartUseAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("itemStartUse", callback, priority);
    }

    onItemStopUse(callback: (event: ItemStopUseAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("itemStopUse", callback, priority);
    }

    onItemReleaseUse(callback: (event: ItemReleaseUseAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("itemReleaseUse", callback, priority);
    }

    onChatSend(callback: (event: ChatSendAfterEvent) => void, priority: number = 0): () => void {
        return this.subscribe("chatSend", callback, priority);
    }

    init(): void {
        if (this.initialized) return;
        this.initialized = true;

        world.beforeEvents.playerInteractWithBlock.subscribe((e) => this.dispatch("playerInteractWithBlock", e));
        world.beforeEvents.playerInteractWithEntity.subscribe((e) => this.dispatch("playerInteractWithEntity", e));
        world.beforeEvents.itemUse.subscribe((e) => this.dispatch("itemUse", e));
        world.beforeEvents.playerBreakBlock.subscribe((e) => this.dispatch("playerBreakBlockBefore", e));
        world.beforeEvents.playerPlaceBlock.subscribe((e) => this.dispatch("playerPlaceBlockBefore", e));
        world.beforeEvents.entityHurt.subscribe((e) => this.dispatch("entityHurtBefore", e));

        world.afterEvents.itemUse.subscribe((e) => this.dispatch("itemUseAfter", e));
        world.afterEvents.entitySpawn.subscribe((e) => this.dispatch("entitySpawn", e));
        world.afterEvents.entityLoad.subscribe((e) => this.dispatch("entityLoad", e));
        world.afterEvents.entityDie.subscribe((e) => this.dispatch("entityDie", e));
        world.afterEvents.entityHurt.subscribe((e) => this.dispatch("entityHurt", e));
        world.afterEvents.entityHitEntity.subscribe((e) => this.dispatch("entityHitEntity", e));
        world.afterEvents.entityHitBlock.subscribe((e) => this.dispatch("entityHitBlock", e));
        world.afterEvents.playerPlaceBlock.subscribe((e) => this.dispatch("playerPlaceBlock", e));
        world.afterEvents.playerBreakBlock.subscribe((e) => this.dispatch("playerBreakBlock", e));
        world.afterEvents.playerDimensionChange.subscribe((e) => this.dispatch("playerDimensionChange", e));
        world.afterEvents.playerSpawn.subscribe((e) => this.dispatch("playerSpawn", e));
        world.afterEvents.playerLeave.subscribe((e) => this.dispatch("playerLeave", e));
        world.afterEvents.blockContainerOpened.subscribe((e) => this.dispatch("blockContainerOpened", e));
        world.afterEvents.blockContainerClosed.subscribe((e) => this.dispatch("blockContainerClosed", e));
        world.afterEvents.playerGameModeChange.subscribe((e) => this.dispatch("playerGameModeChange", e));
        world.afterEvents.playerInventoryItemChange.subscribe((e) => this.dispatch("playerInventoryItemChange", e));
        world.afterEvents.itemStartUse.subscribe((e) => this.dispatch("itemStartUse", e));
        world.afterEvents.itemStopUse.subscribe((e) => this.dispatch("itemStopUse", e));
        world.afterEvents.itemReleaseUse.subscribe((e) => this.dispatch("itemReleaseUse", e));
        world.afterEvents.chatSend.subscribe((e) => this.dispatch("chatSend", e));
    }
}

export const eventBus = new EventBus();
