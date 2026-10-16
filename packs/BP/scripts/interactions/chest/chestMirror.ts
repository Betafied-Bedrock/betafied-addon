import { world } from "@minecraft/server";
import type { Block, ContainerAccessSource } from "@minecraft/server";
import { tickManager } from "../../core/tickManager.js";
import type {
    ChestHalf,
    ChestLocation,
    CloseDecisionInput,
    MirrorMove,
    OpenDecisionInput,
    PairResolution,
    SweepInput
} from "./chestPairing.js";
import {
    DOUBLE_CHEST_ID,
    INVERSE_DIRECTION,
    dropOfflineViewers,
    pairKey,
    planClose,
    planOpen,
    planOpenBlock,
    planSweep,
    resolveHalf
} from "./chestPairing.js";
import {
    blockAt,
    containerHasItems,
    guard,
    isHalf,
    moveContents,
    partStateOf,
    readLatch,
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

/**
 * This module owns the pair-session lifecycle. It holds the sessions, the sweep schedule and the
 * viewer-count invariant, and every event handler in `doubleChest.ts` goes through the operations
 * below rather than touching session state itself:
 *
 * - A session is created by `openPair`/`closePair` resolving a block, and deleted only here, always
 *   through `dropIfIdle`, which is the one place the "no viewers and nothing left to drain" rule and
 *   the per-tick sweep budget live.
 * - Viewer counts move only through `openPair` (add), `closePair` (remove) and `releaseViewer`
 *   (a player left), so a new event path cannot reproduce the bookkeeping by hand and get it wrong.
 * - The decision rule itself is pure and lives in `chestPairing.ts`; this file is what applies it.
 */
export const sessions = new Map<string, PairSession>();

/** How a mirror attempt ended: nothing to do, moved a count, or unreadable and left for a retry. */
export type MirrorOutcome = { kind: "none" } | { kind: "moved"; count: number } | { kind: "unreadable" };

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

function viewersOf(session: PairSession, half: ChestHalf): Set<string> {
    return half === "master" ? session.masterViewers : session.shadowViewers;
}

export function applyMove(move: MirrorMove, session: PairSession): MirrorOutcome {
    if (move === "none") return { kind: "none" };

    const moved =
        move === "master-to-shadow"
            ? moveContents(session.dimensionId, session.master, session.shadow)
            : moveContents(session.dimensionId, session.shadow, session.master);

    return moved.ok ? { kind: "moved", count: moved.value } : { kind: "unreadable" };
}

export function dropIfIdle(session: PairSession, key: string, outcome: MirrorOutcome): void {
    if (session.masterViewers.size > 0 || session.shadowViewers.size > 0) return;
    // An unreadable mirror keeps the session so the sweep retries; anything else means the pair
    // holds nothing and nobody is watching it.
    if (outcome.kind === "unreadable") return;
    if (outcome.kind === "moved" && outcome.count > 0) return;

    sessions.delete(key);
}

export function releaseIdleShadow(session: PairSession, key: string): void {
    if (session.shadowViewers.size > 0) return;
    dropIfIdle(session, key, applyMove("shadow-to-master", session));
}

function resolvePairRef(block: Block): { key: string; dimensionId: string; resolution: PairResolution } | undefined {
    if (block.typeId !== DOUBLE_CHEST_ID) return undefined;

    const dimensionId = block.dimension.id;
    const part = partStateOf(block);
    const state = readLatch(block);
    const partValue = part.ok ? part.value : undefined;

    // The engine is the one that places the halves, so when the world does not match the layout the
    // state promised, the mirrored layout is the one that does.
    let resolution = resolveHalf(partValue, block.location, state);
    if (!resolution || !spansCells(dimensionId, resolution)) {
        resolution = resolveHalf(partValue, block.location, state ? INVERSE_DIRECTION[state] : undefined);
    }

    if (!resolution || !spansCells(dimensionId, resolution)) return undefined;

    return { key: pairKey(dimensionId, resolution.master), dimensionId, resolution };
}

function sessionForBlock(block: Block): { key: string; session: PairSession; half: ChestHalf } | undefined {
    const ref = resolvePairRef(block);
    if (!ref) return undefined;

    return {
        key: ref.key,
        session: sessionFor(ref.key, ref.dimensionId, ref.resolution),
        half: ref.resolution.half
    };
}

export function viewerIdOf(source: ContainerAccessSource | undefined): string | undefined {
    const entity = source?.entity;
    return entity?.typeId === "minecraft:player" ? entity.id : undefined;
}

/** The open handler: record the viewer, then hand the pair's items to the half they can see. */
export function openPair(block: Block, viewerId: string | undefined): void {
    const resolved = sessionForBlock(block);
    if (!resolved) return;

    const { key, session, half } = resolved;
    const masterViewers = session.masterViewers.size;
    const shadowViewers = session.shadowViewers.size;
    const firstViewer = half === "master" ? masterViewers === 0 : shadowViewers === 0;

    if (viewerId) viewersOf(session, half).add(viewerId);

    const masterHasItems = containerHasItems(session.dimensionId, session.master);
    const shadowHasItems = containerHasItems(session.dimensionId, session.shadow);
    // An unreadable half is not an empty one. Deciding on a failed read could drain the half a
    // player is looking at, so the pair is left untouched and the sweep retries the move later.
    if (!masterHasItems.ok || !shadowHasItems.ok) return;

    const input: OpenDecisionInput = {
        half,
        firstViewer,
        masterHasItems: masterHasItems.value,
        shadowHasItems: shadowHasItems.value,
        masterViewers,
        shadowViewers
    };
    const move = planOpen(input);
    dropIfIdle(session, key, applyMove(move, session));
}

/** The close handler: drop the viewer, then return the shadow half's leftovers to the master. */
export function closePair(block: Block, viewerId: string | undefined): void {
    const resolved = sessionForBlock(block);
    if (!resolved) return;

    const { key, session, half } = resolved;
    if (viewerId) viewersOf(session, half).delete(viewerId);

    if (half !== "shadow") return;

    const shadowHasItems = containerHasItems(session.dimensionId, session.shadow);
    if (!shadowHasItems.ok) return;

    const input: CloseDecisionInput = {
        half,
        remainingViewers: session.shadowViewers.size,
        shadowHasItems: shadowHasItems.value
    };
    const move = planClose(input);
    dropIfIdle(session, key, applyMove(move, session));
}

/** The leave handler: a disconnected viewer can never close a chest, so release it here. */
export function releaseViewer(playerId: string): void {
    for (const [key, session] of sessions) {
        const leftMaster = session.masterViewers.delete(playerId);
        const leftShadow = session.shadowViewers.delete(playerId);
        if (!leftMaster && !leftShadow) continue;

        releaseIdleShadow(session, key);
    }
}

/** Whether the other half is already on someone's screen, so this open must be refused. */
export function pairInUse(block: Block): boolean {
    const ref = resolvePairRef(block);
    if (!ref) return false;

    const session = sessions.get(ref.key);
    if (!session) return false;

    return planOpenBlock({
        half: ref.resolution.half,
        masterViewers: session.masterViewers.size,
        shadowViewers: session.shadowViewers.size
    });
}

function onlinePlayerIds(): Set<string> | undefined {
    const players = guard("getAllPlayers", () => world.getAllPlayers());
    return players.ok ? new Set(players.value.map(player => player.id)) : undefined;
}

function sweepSession(key: string, session: PairSession): void {
    if (session.masterViewers.size > 0 || session.shadowViewers.size > 0) {
        const online = onlinePlayerIds();
        if (online) {
            dropOfflineViewers(session.masterViewers, online);
            dropOfflineViewers(session.shadowViewers, online);
        }
    }

    const master = blockAt(session.dimensionId, session.master);
    const shadow = blockAt(session.dimensionId, session.shadow);
    // A read that failed is not a broken pair: keeping the session lets a later sweep drain it,
    // where deleting here would strand whatever the shadow half still holds.
    if (!master.ok || !shadow.ok) return;

    if (!isHalf(master.value) || !isHalf(shadow.value)) {
        sessions.delete(key);
        return;
    }

    if (session.masterViewers.size > 0 || session.shadowViewers.size > 0) return;

    const shadowHasItems = containerHasItems(session.dimensionId, session.shadow);
    if (!shadowHasItems.ok) return;

    if (!shadowHasItems.value) {
        sessions.delete(key);
        return;
    }

    const input: SweepInput = { shadowViewers: 0, shadowHasItems: shadowHasItems.value };
    dropIfIdle(session, key, applyMove(planSweep(input), session));
}

export function* sweepPairsJob(): Generator<void, void, unknown> {
    let processed = 0;

    for (const [key, session] of sessions) {
        sweepSession(key, session);

        processed++;
        if (processed % CHEST_PAIRS_PER_TICK === 0) yield;
    }
}

tickManager.register("doubleChest:sweep", SWEEP_INTERVAL_TICKS, sweepPairsJob, 0);
