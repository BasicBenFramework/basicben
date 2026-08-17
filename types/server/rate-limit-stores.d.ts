/**
 * In-process storage.
 *
 * The default, and the right choice for smoothing traffic. **Not** the right
 * choice for a security control: a restart clears it, and a second instance has
 * its own copy, so a lockout it enforces is neither durable nor shared.
 */
export class MemoryStore {
    /**
     * @param {Object} [options]
     * @param {number} [options.sweepInterval] - ms between sweeps of stale keys
     */
    constructor(options?: {
        sweepInterval?: number;
    });
    sweepInterval: number;
    hit(key: any, { windowMs, now, limit, blockMs }: {
        windowMs: any;
        now: any;
        limit: any;
        blockMs: any;
    }): Promise<{
        count: any;
        blocked: boolean;
        blockedUntil: any;
        resetAt?: undefined;
    } | {
        count: any;
        blocked: boolean;
        resetAt: any;
        blockedUntil?: undefined;
    }>;
    peek(key: any, { windowMs, now }: {
        windowMs: any;
        now: any;
    }): Promise<{
        count: any;
        blocked: boolean;
        blockedUntil: any;
        resetAt?: undefined;
    } | {
        count: any;
        blocked: boolean;
        resetAt: any;
        blockedUntil?: undefined;
    }>;
    reset(key: any): Promise<void>;
    /** Drop keys with nothing left inside their window. */
    sweep(now?: number): void;
    /** Stop the sweep timer. */
    close(): void;
    get size(): number;
    #private;
}
/**
 * Database-backed storage.
 *
 * Survives a restart and is shared between instances, which is what a lockout
 * needs. Requires the `rate_limits` table.
 */
export class DatabaseStore {
    /**
     * @param {Object} options
     * @param {Function} options.getDb - resolves the database connection
     * @param {string} [options.table]
     */
    constructor({ getDb, table }?: {
        getDb: Function;
        table?: string;
    });
    getDb: Function;
    table: string;
    hit(key: any, { windowMs, now, limit, blockMs }: {
        windowMs: any;
        now: any;
        limit: any;
        blockMs: any;
    }): Promise<{
        count: number;
        blocked: boolean;
        blockedUntil: any;
        resetAt?: undefined;
    } | {
        count: number;
        blocked: boolean;
        resetAt: any;
        blockedUntil?: undefined;
    }>;
    peek(key: any, { windowMs, now }: {
        windowMs: any;
        now: any;
    }): Promise<{
        count: number;
        blocked: boolean;
        blockedUntil: number;
        resetAt?: undefined;
    } | {
        count: number;
        blocked: boolean;
        resetAt: any;
        blockedUntil?: undefined;
    }>;
    reset(key: any): Promise<void>;
    /** Remove rows whose window and block have both lapsed. */
    sweep(now?: number): Promise<any>;
    #private;
}
