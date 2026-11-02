/**
 * dem.js - read the preprocessed elevation tiles (see scripts/build_dem.py).
 *
 * The grid is point-registered: global sample (R, C) sits at
 *     lat = north - R * step,  lon = west + C * step.
 * Tiles are tileSize x tileSize samples, named "<tileRow>_<tileCol>".
 * Each tile file is gzip( int16le, delta-encoded along rows ).
 *
 * This module is environment-agnostic: you pass in a `loadTile(name)`
 * function that returns the *decompressed* bytes (ArrayBuffer / Uint8Array)
 * or null if the tile does not exist (open sea = 0 m). See
 * `browserTileLoader` below for the browser version; the tests use Node's zlib.
 */

/**
 * Undo the row-delta encoding.
 * @param {ArrayBuffer|Uint8Array} bytes decompressed tile bytes
 * @param {number} size samples per side
 * @returns {Int16Array} heights in metres, row-major
 */
export function decodeTile(bytes, size) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength !== size * size * 2) {
    throw new Error(`tile has ${u8.byteLength} bytes, expected ${size * size * 2}`);
  }
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = new Int16Array(size * size);
  for (let r = 0; r < size; r++) {
    let acc = 0;
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      acc = (acc + view.getInt16(i * 2, true)) << 16 >> 16; // int16 wrap-around
      out[i] = acc;
    }
  }
  return out;
}

/** Bilinear interpolation inside one grid cell. fx, fy in [0, 1]. */
export function bilinear(v00, v01, v10, v11, fx, fy) {
  const top = v00 + (v01 - v00) * fx;
  const bottom = v10 + (v11 - v10) * fx;
  return top + (bottom - top) * fy;
}

export class Dem {
  /**
   * @param {object} manifest contents of public/dem/manifest.json
   * @param {(name:string) => Promise<ArrayBuffer|Uint8Array|null>} loadTile
   */
  constructor(manifest, loadTile) {
    this.m = manifest;
    this.loadTile = loadTile;
    this.available = new Set(manifest.tiles);
    /** @type {Map<string, Int16Array|null|Promise<void>>} */
    this.cache = new Map();
  }

  /** Is (lat, lon) inside the area covered by the data? */
  covers(lat, lon) {
    const { north, south, west, east } = this.m;
    return lat <= north && lat >= south && lon >= west && lon <= east;
  }

  /** Fractional global grid coordinates of a point. */
  gridPos(lat, lon) {
    return { r: (this.m.north - lat) / this.m.step, c: (lon - this.m.west) / this.m.step };
  }

  tileNameFor(R, C) {
    const T = this.m.tileSize;
    return `${Math.floor(R / T)}_${Math.floor(C / T)}`;
  }

  /**
   * Make sure every tile needed to interpolate the given points is loaded.
   * @param {{lat:number, lon:number}[]} points
   */
  async ensure(points) {
    const names = new Set();
    for (const p of points) {
      const { r, c } = this.gridPos(p.lat, p.lon);
      const R = Math.floor(r);
      const C = Math.floor(c);
      for (const [dr, dc] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
        if (this.inGrid(R + dr, C + dc)) names.add(this.tileNameFor(R + dr, C + dc));
      }
    }
    await Promise.all([...names].map((n) => this.loadOne(n)));
  }

  /**
   * Load every tile that intersects a lat/lon box (for bulk jobs such as
   * coverage maps, so each profile doesn't have to check its own tiles).
   */
  async ensureBox(south, west, north, east) {
    const T = this.m.tileSize;
    const a = this.gridPos(north, west);
    const b = this.gridPos(south, east);
    const r0 = Math.max(0, Math.floor(Math.floor(a.r) / T));
    const r1 = Math.min(Math.ceil(this.m.rows / T) - 1, Math.floor((Math.floor(b.r) + 1) / T));
    const c0 = Math.max(0, Math.floor(Math.floor(a.c) / T));
    const c1 = Math.min(Math.ceil(this.m.cols / T) - 1, Math.floor((Math.floor(b.c) + 1) / T));
    const jobs = [];
    for (let tr = r0; tr <= r1; tr++) for (let tc = c0; tc <= c1; tc++) jobs.push(this.loadOne(`${tr}_${tc}`));
    await Promise.all(jobs);
  }

  inGrid(R, C) {
    return R >= 0 && C >= 0 && R < this.m.rows && C < this.m.cols;
  }

  async loadOne(name) {
    const cached = this.cache.get(name);
    if (cached instanceof Promise) return cached;
    if (cached !== undefined) return undefined;
    if (!this.available.has(name)) {
      this.cache.set(name, null); // sea tile
      return undefined;
    }
    const p = (async () => {
      const bytes = await this.loadTile(name);
      this.cache.set(name, bytes ? decodeTile(bytes, this.m.tileSize) : null);
    })();
    this.cache.set(name, p);
    try {
      await p;
    } catch (e) {
      this.cache.delete(name);
      throw e;
    }
    return undefined;
  }

  /** Height of one grid sample (tiles must be loaded). Outside the grid: 0. */
  sample(R, C) {
    if (!this.inGrid(R, C)) return 0;
    const tile = this.cache.get(this.tileNameFor(R, C));
    if (!tile || tile instanceof Promise) {
      if (tile === undefined && this.available.has(this.tileNameFor(R, C))) {
        throw new Error(`tile ${this.tileNameFor(R, C)} not loaded - call ensure() first`);
      }
      return 0;
    }
    const T = this.m.tileSize;
    return tile[(R % T) * T + (C % T)];
  }

  /**
   * Elevation (m above sea level) at a point, bilinearly interpolated.
   * Synchronous: call `await ensure([...points])` first.
   */
  elevationAt(lat, lon) {
    const { r, c } = this.gridPos(lat, lon);
    const R = Math.floor(r);
    const C = Math.floor(c);
    return bilinear(
      this.sample(R, C),
      this.sample(R, C + 1),
      this.sample(R + 1, C),
      this.sample(R + 1, C + 1),
      c - C,
      r - R,
    );
  }
}

/**
 * Tile loader for browsers: fetches `<baseUrl><name>.i16.gz` and inflates it
 * with the built-in DecompressionStream. If the server already removed the
 * gzip layer (Content-Encoding: gzip), the magic-byte check skips inflation.
 * @param {string} baseUrl e.g. "./dem/"
 */
export function browserTileLoader(baseUrl) {
  return async (name) => {
    const res = await fetch(`${baseUrl}${name}.i16.gz`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`failed to load elevation tile ${name}: HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return buf;
  };
}

/** Load the manifest and return a ready Dem (browser). */
export async function loadBrowserDem(baseUrl) {
  const res = await fetch(`${baseUrl}manifest.json`);
  if (!res.ok) throw new Error(`failed to load elevation manifest: HTTP ${res.status}`);
  return new Dem(await res.json(), browserTileLoader(baseUrl));
}
