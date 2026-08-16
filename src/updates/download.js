/**
 * Download and extraction utilities for updates
 */

import { createWriteStream, createReadStream } from 'node:fs'
import { mkdir, rm, rename, readdir, stat, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import https from 'node:https'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'

/**
 * Download a file from URL
 * @param {string} url - URL to download
 * @param {string} destPath - Destination file path
 * @param {object} options - Download options
 * @param {Function} options.onProgress - Progress callback (bytes, total)
 * @param {number} options.timeout - Timeout in ms
 * @returns {Promise<string>} Path to downloaded file
 */
export async function downloadFile(url, destPath, options = {}) {
  const { onProgress, timeout = 300000 } = options

  // Ensure destination directory exists
  await mkdir(path.dirname(destPath), { recursive: true })

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const client = parsedUrl.protocol === 'https:' ? https : http

    const request = client.get(url, { timeout }, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, destPath, options)
          .then(resolve)
          .catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${response.statusCode}`))
        return
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10)
      let downloadedSize = 0

      const fileStream = createWriteStream(destPath)

      response.on('data', (chunk) => {
        downloadedSize += chunk.length
        if (onProgress) {
          onProgress(downloadedSize, totalSize)
        }
      })

      pipeline(response, fileStream)
        .then(() => resolve(destPath))
        .catch(reject)
    })

    request.on('error', reject)
    request.on('timeout', () => {
      request.destroy()
      reject(new Error('Download timeout'))
    })
  })
}

/**
 * Calculate checksum of a file
 * @param {string} filePath - Path to file
 * @param {string} algorithm - Hash algorithm (sha256, sha512, md5)
 * @returns {Promise<string>} Hex checksum
 */
export async function calculateChecksum(filePath, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm)
    const stream = createReadStream(filePath)

    stream.on('data', (data) => hash.update(data))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/**
 * Verify file checksum
 * @param {string} filePath - Path to file
 * @param {string} expected - Expected checksum (format: "algorithm:hash" or just "hash")
 * @returns {Promise<boolean>} True if checksum matches
 */
export async function verifyChecksum(filePath, expected) {
  let algorithm = 'sha256'
  let hash = expected

  // Parse "sha256:abc123" format
  if (expected.includes(':')) {
    const [algo, h] = expected.split(':')
    algorithm = algo
    hash = h
  }

  const actual = await calculateChecksum(filePath, algorithm)
  return actual.toLowerCase() === hash.toLowerCase()
}

/**
 * Extract a tar.gz archive
 * @param {string} archivePath - Path to archive
 * @param {string} destDir - Destination directory
 * @returns {Promise<void>}
 */
export async function extractTarGz(archivePath, destDir) {
  // Use tar command for simplicity (available on macOS/Linux)
  const { spawn } = await import('node:child_process')

  await mkdir(destDir, { recursive: true })

  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-xzf', archivePath, '-C', destDir], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stderr = ''
    tar.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    tar.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`tar extraction failed: ${stderr}`))
      }
    })

    tar.on('error', reject)
  })
}

/**
 * Extract a zip archive
 * @param {string} archivePath - Path to archive
 * @param {string} destDir - Destination directory
 * @returns {Promise<void>}
 */
export async function extractZip(archivePath, destDir) {
  const { spawn } = await import('node:child_process')

  await mkdir(destDir, { recursive: true })

  // Windows has no unzip, but its bundled bsdtar reads zip archives
  const isWindows = process.platform === 'win32'
  const command = isWindows ? 'tar' : 'unzip'
  const args = isWindows
    ? ['-xf', archivePath, '-C', destDir]
    : ['-o', '-q', archivePath, '-d', destDir]

  return new Promise((resolve, reject) => {
    const unzip = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stderr = ''
    unzip.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    unzip.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} extraction failed: ${stderr}`))
      }
    })

    unzip.on('error', reject)
  })
}

/**
 * Extract an archive (auto-detect format)
 * @param {string} archivePath - Path to archive
 * @param {string} destDir - Destination directory
 * @returns {Promise<void>}
 */
export async function extractArchive(archivePath, destDir) {
  const ext = path.extname(archivePath).toLowerCase()

  if (ext === '.zip') {
    return extractZip(archivePath, destDir)
  } else if (ext === '.gz' || archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    return extractTarGz(archivePath, destDir)
  } else {
    throw new Error(`Unsupported archive format: ${ext}`)
  }
}

/**
 * Create a temporary directory
 * @param {string} prefix - Directory prefix
 * @returns {Promise<string>} Path to temp directory
 */
export async function createTempDir(prefix = 'basicben-update-') {
  const tempDir = path.join(os.tmpdir(), `${prefix}${Date.now()}`)
  await mkdir(tempDir, { recursive: true })
  return tempDir
}

/**
 * Copy directory recursively
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 * @returns {Promise<void>}
 */
export async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true })

  const entries = await readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else {
      await copyFile(srcPath, destPath)
    }
  }
}

/**
 * Move directory (rename with fallback to copy+delete)
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 * @returns {Promise<void>}
 */
export async function moveDir(src, dest) {
  try {
    // Try atomic rename first
    await rename(src, dest)
  } catch (error) {
    // Cross-device move, fall back to copy+delete
    if (error.code === 'EXDEV') {
      await copyDir(src, dest)
      await rm(src, { recursive: true, force: true })
    } else {
      throw error
    }
  }
}

/**
 * Remove directory safely
 * @param {string} dir - Directory to remove
 * @returns {Promise<void>}
 */
export async function removeDir(dir) {
  await rm(dir, { recursive: true, force: true })
}

/**
 * Check if path exists
 * @param {string} p - Path to check
 * @returns {Promise<boolean>}
 */
export async function pathExists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/**
 * Download and extract an archive
 * @param {string} url - URL to download
 * @param {string} destDir - Destination directory
 * @param {object} options - Options
 * @param {string} options.checksum - Expected checksum
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<string>} Path to extracted directory
 */
export async function downloadAndExtract(url, destDir, options = {}) {
  const { checksum, onProgress } = options

  // Create temp directory for download
  const tempDir = await createTempDir()
  const archiveName = path.basename(new URL(url).pathname) || 'archive.zip'
  const archivePath = path.join(tempDir, archiveName)

  try {
    // Download
    await downloadFile(url, archivePath, { onProgress })

    // Verify checksum if provided
    if (checksum) {
      const valid = await verifyChecksum(archivePath, checksum)
      if (!valid) {
        throw new Error('Checksum verification failed')
      }
    }

    // Extract
    const extractDir = path.join(tempDir, 'extracted')
    await extractArchive(archivePath, extractDir)

    // Move to destination
    await rm(destDir, { recursive: true, force: true })
    await moveDir(extractDir, destDir)

    return destDir
  } finally {
    // Cleanup temp directory
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Download file to temp location
 * @param {string} url - URL to download
 * @param {object} options - Options
 * @returns {Promise<string>} Path to downloaded file
 */
export async function downloadToTemp(url, options = {}) {
  const tempDir = await createTempDir()
  const fileName = path.basename(new URL(url).pathname) || 'download'
  const filePath = path.join(tempDir, fileName)

  await downloadFile(url, filePath, options)

  return filePath
}
