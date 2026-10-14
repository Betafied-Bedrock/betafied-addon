import type { Vector3 } from "@minecraft/server";

export function normalizeXZ(v: { x: number; y?: number; z: number }): Vector3 {
    const length = Math.sqrt(v.x ** 2 + v.z ** 2);
    return length === 0
        ? { x: 0, y: 0, z: 0 }
        : { x: v.x / length, y: 0, z: v.z / length };
}

export function scale(v: Vector3, scalar: number): Vector3 {
    return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

export function magnitude(v: Vector3): number {
    return Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
}
