/**
 * Download a file from URL
 * @param {string} url - URL to download
 * @param {string} destPath - Destination file path
 * @param {object} options - Download options
 * @param {Function} options.onProgress - Progress callback (bytes, total)
 * @param {number} options.timeout - Timeout in ms
 * @returns {Promise<string>} Path to downloaded file
 */
export function downloadFile(url: string, destPath: string, options?: {
    onProgress: Function;
    timeout: number;
}): Promise<string>;
/**
 * Calculate checksum of a file
 * @param {string} filePath - Path to file
 * @param {string} algorithm - Hash algorithm (sha256, sha512, md5)
 * @returns {Promise<string>} Hex checksum
 */
export function calculateChecksum(filePath: string, algorithm?: string): Promise<string>;
/**
 * Verify file checksum
 * @param {string} filePath - Path to file
 * @param {string} expected - Expected checksum (format: "algorithm:hash" or just "hash")
 * @returns {Promise<boolean>} True if checksum matches
 */
export function verifyChecksum(filePath: string, expected: string): Promise<boolean>;
/**
 * Extract a tar.gz archive
 * @param {string} archivePath - Path to archive
 * @param {string} destDir - Destination directory
 * @returns {Promise<void>}
 */
export function extractTarGz(archivePath: string, destDir: string): Promise<void>;
/**
 * Extract a zip archive
 * @param {string} archivePath - Path to archive
 * @param {string} destDir - Destination directory
 * @returns {Promise<void>}
 */
export function extractZip(archivePath: string, destDir: string): Promise<void>;
/**
 * Extract an archive (auto-detect format)
 * @param {string} archivePath - Path to archive
 * @param {string} destDir - Destination directory
 * @returns {Promise<void>}
 */
export function extractArchive(archivePath: string, destDir: string): Promise<void>;
/**
 * Create a temporary directory
 * @param {string} prefix - Directory prefix
 * @returns {Promise<string>} Path to temp directory
 */
export function createTempDir(prefix?: string): Promise<string>;
/**
 * Copy directory recursively
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 * @returns {Promise<void>}
 */
export function copyDir(src: string, dest: string): Promise<void>;
/**
 * Move directory (rename with fallback to copy+delete)
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 * @returns {Promise<void>}
 */
export function moveDir(src: string, dest: string): Promise<void>;
/**
 * Remove directory safely
 * @param {string} dir - Directory to remove
 * @returns {Promise<void>}
 */
export function removeDir(dir: string): Promise<void>;
/**
 * Check if path exists
 * @param {string} p - Path to check
 * @returns {Promise<boolean>}
 */
export function pathExists(p: string): Promise<boolean>;
/**
 * Download and extract an archive
 * @param {string} url - URL to download
 * @param {string} destDir - Destination directory
 * @param {object} options - Options
 * @param {string} options.checksum - Expected checksum
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<string>} Path to extracted directory
 */
export function downloadAndExtract(url: string, destDir: string, options?: {
    checksum: string;
    onProgress: Function;
}): Promise<string>;
/**
 * Download file to temp location
 * @param {string} url - URL to download
 * @param {object} options - Options
 * @returns {Promise<string>} Path to downloaded file
 */
export function downloadToTemp(url: string, options?: object): Promise<string>;
