/**
 * A QR code encoder, small enough to keep the CMS free of a dependency for it.
 *
 * Byte mode at error-correction level M, any version 1–40: enough for an
 * otpauth:// URI, which is all the admin draws one for. It follows ISO/IEC
 * 18004 the way Project Nayuki's reference encoder lays it out — function
 * patterns, then the codewords in the zig-zag, then the mask with the lowest
 * penalty.
 */

// Level M, by version (index 0 unused).
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
// Level M's two format bits are 00.
const ECC_FORMAT_BITS = 0

const bit = (value: number, i: number) => ((value >>> i) & 1) !== 0

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2
    result -= (25 * align - 10) * align - 55
    if (version >= 7) result -= 36
  }
  return result
}

const dataCodewords = (version: number) =>
  Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version]

// Reed–Solomon over GF(2^8) with the polynomial 0x11D.
function gfMultiply(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function rsDivisor(degree: number): number[] {
  const result = new Array(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMultiply(root, 0x02)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor) })
  }
  return result
}

/** The data codewords split into blocks, each given its error correction, then interleaved. */
function withErrorCorrection(data: number[], version: number): number[] {
  const numBlocks = BLOCKS[version]
  const eccLen = ECC_PER_BLOCK[version]
  const raw = Math.floor(rawDataModules(version) / 8)
  const shortBlocks = numBlocks - (raw % numBlocks)
  const shortLen = Math.floor(raw / numBlocks)

  const divisor = rsDivisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, divisor)
    if (i < shortBlocks) dat.push(0)
    blocks.push(dat.concat(ecc))
  }

  const result: number[] = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      // The padding byte added to short blocks is not part of the symbol.
      if (i !== shortLen - eccLen || j >= shortBlocks) result.push(block[i])
    })
  }
  return result
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2
  const result = [6]
  for (let pos = version * 4 + 10; result.length < count; pos -= step) result.splice(1, 0, pos)
  return result
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
]

/**
 * The modules of a QR code for `text`: true is dark. Row-major, without the
 * quiet zone, which the renderer adds.
 */
export function qrModules(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text))

  let version = 1
  for (; ; version++) {
    if (version > 40) throw new Error('Too long for a QR code')
    const countBits = version <= 9 ? 8 : 16
    if (4 + countBits + bytes.length * 8 <= dataCodewords(version) * 8) break
  }

  // Byte mode, the length, the bytes, a terminator, then padding.
  const bits: number[] = []
  const push = (value: number, length: number) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  const capacity = dataCodewords(version) * 8
  push(0b0100, 4)
  push(bytes.length, version <= 9 ? 8 : 16)
  bytes.forEach((b) => push(b, 8))
  push(0, Math.min(4, capacity - bits.length))
  push(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8)

  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  const all = withErrorCorrection(codewords, version)

  const size = version * 4 + 17
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; reserved[y][x] = true }

  // Timing patterns.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }

  // Finder patterns, with their separators.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4)
      }
    }
  }

  // Alignment patterns, except where they would sit on a finder.
  const align = alignmentPositions(version)
  align.forEach((ay, i) => align.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }))

  const drawFormat = (mask: number) => {
    const data = (ECC_FORMAT_BITS << 3) | mask
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const format = ((data << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) set(8, i, bit(format, i))
    set(8, 7, bit(format, 6))
    set(8, 8, bit(format, 7))
    set(7, 8, bit(format, 8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(format, i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(format, i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(format, i))
    set(8, size - 8, true)
  }
  drawFormat(0)

  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const info = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, bit(info, i))
      set(b, a, bit(info, i))
    }
  }

  // The codewords, two columns at a time, up and down, right to left.
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert
        if (!reserved[y][x] && i < all.length * 8) {
          modules[y][x] = bit(all[i >>> 3], 7 - (i & 7))
          i++
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!reserved[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x]
      }
    }
  }

  let best = 0
  let bestPenalty = Infinity
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask)
    drawFormat(mask)
    const score = penalty(modules)
    if (score < bestPenalty) { best = mask; bestPenalty = score }
    applyMask(mask) // XOR again to undo
  }
  applyMask(best)
  drawFormat(best)

  return modules
}

/**
 * How hard a symbol is to read: long runs, 2×2 blocks, finder look-alikes and
 * an uneven dark/light balance. Any mask decodes; this picks the kindest.
 */
function penalty(modules: boolean[][]): number {
  const size = modules.length
  let result = 0
  const at = (x: number, y: number, vertical: boolean) => (vertical ? modules[x][y] : modules[y][x])

  for (const vertical of [false, true]) {
    for (let y = 0; y < size; y++) {
      let run = 1
      for (let x = 1; x <= size; x++) {
        if (x < size && at(x, y, vertical) === at(x - 1, y, vertical)) {
          run++
        } else {
          if (run >= 5) result += run - 2
          run = 1
        }
      }
      // 1:1:3:1:1 with four light modules on one side.
      for (let x = 0; x + 10 < size; x++) {
        const line = Array.from({ length: 11 }, (_, k) => at(x + k, y, vertical))
        const finder = [true, false, true, true, true, false, true]
        const matches = (offset: number) => finder.every((d, k) => line[offset + k] === d)
        const light = (from: number) => line.slice(from, from + 4).every((d) => !d)
        if ((matches(0) && light(7)) || (matches(4) && light(0))) result += 40
      }
    }
  }

  let dark = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) dark++
      if (x + 1 < size && y + 1 < size) {
        const c = modules[y][x]
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3
      }
    }
  }
  const total = size * size
  result += Math.ceil(Math.abs(dark * 20 - total * 10) / total - 1) * 10

  return result
}

/** An SVG path of the dark modules, offset by a four-module quiet zone. */
export function qrPath(modules: boolean[][], border = 4): string {
  let d = ''
  modules.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) d += `M${x + border} ${y + border}h1v1h-1z`
  }))
  return d
}
