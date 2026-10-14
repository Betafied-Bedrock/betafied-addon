import { world } from "@minecraft/server";
import type { Block, ContainerAccessSource } from "@minecraft/server";
import type { ChestHalf, ChestLocation, MirrorMove, PairResolution } from "./chestPairing.js";
import {
    DOUBLE_CHEST_ID,
    INVERSE_DIRECTION,
    dropOfflineViewers,
    pairKey,
    planSweep,
    resolveHalf
} from "./chestPairing.js";
import {
    blockAt,
    containerHasItems,
    directionStateOf,
    guard,
    isHalf,
    moveContents,
    partStateOf,
    spansCells
} from "./chestCells.js";

export const SWEEP_INTERVAL_TICKS = 10;
export const CHEST_PAIRS_PER_TICK = 10;

export interface PairSession {
    dimensionId: string;
    master: ChestLocation;
    shadow: ChestLocation;
    masterViewers: Set<string>;
    shadowViewers: Set<string>;
}

export const sessions = new Map<string, PairSession>();

function sessionFor(key: string, dimensionId: string, resolution: PairResolution): PairSession {
    const existing = sessions.get(key);
    if (existing) return existing;

    const session: PairSession = {
        dimensionId,
        master: resolution.master,
        shadow: resolution.shadow,
        masterViewers: new Set(),
        shadowViewers: new Set()
    };
    sessions.set(key, session);
    return session;
}

export function applyMove(move: MirrorMove, session: PairSession): number | undefined {
    if (move === "none") return 0;

    return move === "master-to-shadow"
        ? moveContents(session.dimensionId, session.master, session.shadow)
        : moveContents(session.dimensionId, session.shadow, session.master);
}

export function dropIfIdle(session: PairSession, key: string, drained: number | undefined): void {
    if (session.masterViewers.size > 0 || session.shadowViewers.size > 0) return;
    if (drained === 0) sessions.delete(key);
}

export function releaseIdleShadow(session: PairSession, key: string): void {
    if (session.shadowViewers.size > 0) return;
    const drained = applyMove("shadow-to-master", session);
    dropIfIdle(session, key, drained);
}

export function viewerIdOf(source: ContainerAccessSource | undefined): string | undefined {
    const entity = source?.entity;
    return entity?.typeId === "minecraft:player" ? entity.id : undefined;
}

export function resolvePairRef(block: Block): { key: string; dimensionId: string; resolution: PairResolution } | undefined {
    if (block.typeId !== DOUBLE_CHEST_ID) return undefined;

    const dimensionId = block.dimension.id;
    const part = partStateOf(block);
    const state = directionStateOf(block);

    // The engine is the one that places the halves, so when the world does not match the layout the
    // state promised, the mirrored layout is the one that does.
    let resolution = resolveHalf(part, block.location, state);
    if (!resolution || !spansCells(dimensionId, resolution)) {
        resolution = resolveHalf(part, block.location, state ? INVERSE_DIRECTION[state] : undefined);
    }

    if (!resolution || !spansCells(dimensionId, resolution)) return undefined;

    return { key: pairKey(dimensionId, resolution.master), dimensionId, resolution };
}

export function resolveEventBlock(block: Block): { key: string; session: PairSession; half: ChestHalf } | undefined {
    const ref = resolvePairRef(block);
    if (!ref) return undefined;

    return {
        key: ref.key,
        session: sessionFor(ref.key, ref.dimensionId, ref.resolution),
        half: ref.resolution.half
    };
}

function onlinePlayerIds(): Set<string> | undefined {
    const players = guard("getAllPlayers", () => world.getAllPlayers());
    return players.ok ? new Set(players.value.map(player => player.id)) : undefined;
}

export function* sweepPairsJob(): Generator<void, void, unknown> {
    let processed = 0;
    for (const [key, session] of sessions) {
        if (session.masterViewers.size > 0 || session.shadowViewers.size > 0) {
            const online = onlinePlayerIds();
            if (online) {
                dropOfflineViewers(session.masterViewers, online);
                dropOfflineViewers(session.shadowViewers, online);
            }
        }

        const master = blockAt(session.dimensionId, session.master);
        const shadow = blockAt(session.dimensionId, session.shadow);
        if (!isHalf(master) || !isHalf(shadow)) {
            sessions.delete(key);
            processed++;
            if (processed % CHEST_PAIRS_PER_TICK === 0) {
                yield;
            }
            continue;
        }

        if (session.masterViewers.size > 0 || session.shadowViewers.size > 0) {
            processed++;
            if (processed % CHEST_PAIRS_PER_TICK === 0) {
                yield;
            }
            continue;
        }

        const shadowHasItems = containerHasItems(session.dimensionId, session.shadow);
        if (shadowHasItems === undefined) {
            processed++;
            if (processed % CHEST_PAIRS_PER_TICK === 0) {
                yield;
            }
            continue;
        }
        if (!shadowHasItems) {
            sessions.delete(key);
            processed++;
            if (processed % CHEST_PAIRS_PER_TICK === 0) {
                yield;
            }
            continue;
        }

        const drained = applyMove(planSweep({ shadowViewers: 0, shadowHasItems }), session);
        dropIfIdle(session, key, drained);

        processed++;
        if (processed % CHEST_PAIRS_PER_TICK === 0) {
            yield;
        }
    }
}

export function sweepPairs(): void {
    const job = sweepPairsJob();
    while (!job.next().done) {
        // This wrapper exists for callers that need the whole sweep finished before they continue,
        // unlike the time-sliced registration on `doubleChest:sweep`.
    }
}
