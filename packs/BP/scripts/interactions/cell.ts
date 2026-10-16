/** A block's own coordinates: the cell an interaction reads, writes or plans against. */
export interface Cell {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}
