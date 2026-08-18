/**
 * Create migrator instance
 *
 * @param {string} migrationsDir - Directory holding migration files
 * @param {Object} [connection] - Adapter to use instead of the configured
 *   connection. Tests pass one in to exercise the Postgres dialect, which is
 *   where the bookkeeping SQL differs, without a Postgres server.
 */
export function createMigrator(migrationsDir?: string, connection?: any): Promise<{
    /**
     * Run all pending migrations
     */
    migrate(): Promise<{
        ran: any[];
        message: string;
        batch?: undefined;
    } | {
        ran: string[];
        batch: number;
        message?: undefined;
    }>;
    /**
     * Roll back the last batch of migrations
     */
    rollback(): Promise<{
        rolledBack: any[];
        message: string;
        batch?: undefined;
    } | {
        rolledBack: any[];
        batch: number;
        message?: undefined;
    }>;
    /**
     * Drop all tables and re-run all migrations
     */
    fresh(): Promise<{
        ran: any[];
        message: string;
        batch?: undefined;
    } | {
        ran: string[];
        batch: number;
        message?: undefined;
    }>;
    /**
     * Get migration status
     */
    status(): Promise<{
        name: string;
        ran: boolean;
        batch: any;
    }[]>;
}>;
