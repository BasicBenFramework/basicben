/**
 * Create seeder instance
 *
 * @param {string} seedsDir - Path to seeds directory (default: 'db/seeds')
 */
export function createSeeder(seedsDir?: string): Promise<{
    /**
     * Run all seed files
     *
     * @returns {Promise<{ ran: string[] }>}
     */
    runAll(): Promise<{
        ran: string[];
    }>;
    /**
     * Run a specific seed file
     *
     * @param {string} name - Seed file name (without extension)
     * @returns {Promise<void>}
     */
    run(name: string): Promise<void>;
    /**
     * Run a seed file by path
     *
     * @param {string} name - Seed name for logging
     * @param {string} filePath - Full path to seed file
     */
    runSeed(name: string, filePath: string): Promise<void>;
    /**
     * List all available seed files
     *
     * @returns {string[]}
     */
    list(): string[];
}>;
