// Bakes PBR surface maps (albedo / ORM / normal) for an equirectangular lon-lat window
// straight from the release's PMTiles: physical-context (MVT), bathymetric-depth-bands (MVT)
// and terrain-surface (Terrarium PNG).
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const archives = {
  physical: new PMTiles('data/physical-context.pmtiles'),
  bathy: new PMTiles('data/bathymetric-depth-bands.pmtiles'),
  terrain: new PMTiles('data/terrain-surface.pmtiles'),
};

const MAX_MERC_LAT = 85.0511287798066;
const DEG = Math.PI / 180;

function lonToTileX(lon, z) { return ((lon + 180) / 360) * 2 ** z; }
function latToTileY(lat, z) {
  const clamped = Math.max(-MAX_MERC_LAT, Math.min(MAX_MERC_LAT, lat)) * DEG;
  return ((1 - Math.log(Math.tan(clamped) + 1 / Math.cos(clamped)) / Math.PI) / 2) * 2 ** z;
}
function mercYToLat(my) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) / DEG; }

function tileRange(bounds, z) {
  const n = 2 ** z;
  return {
    x0: Math.max(0, Math.floor(lonToTileX(bounds.lonMin, z))),
    x1: Math.min(n - 1, Math.floor(lonToTileX(bounds.lonMax, z) - 1e-9)),
    y0: Math.max(0, Math.floor(latToTileY(bounds.latMax, z))),
    y1: Math.min(n - 1, Math.floor(latToTileY(bounds.latMin, z) - 1e-9)),
  };
}

function tilesIn(range) {
  const out = [];
  for (let y = range.y0; y <= range.y1; y++) for (let x = range.x0; x <= range.x1; x++) out.push({ x, y });
  return out;
}

function projector(bounds, W, H) {
  const ppd = W / (bounds.lonMax - bounds.lonMin);
  return {
    ppd,
    x: (lon) => (lon - bounds.lonMin) * ppd,
    y: (lat) => (bounds.latMax - lat) * (H / (bounds.latMax - bounds.latMin)),
  };
}

async function loadVectorTiles(archive, bounds, z) {
  const tiles = tilesIn(tileRange(bounds, z));
  const loaded = await Promise.all(tiles.map(async ({ x, y }) => {
    const res = await archive.getZxy(z, x, y);
    if (!res) return null;
    return { x, y, z, vt: new VectorTile(new PbfReader(new Uint8Array(res.data))) };
  }));
  return loaded.filter(Boolean);
}

// Iterate a layer's features in a tile, handing back rings already projected to canvas px.
function forEachFeature(tile, layerName, proj, fn) {
  const layer = tile.vt.layers[layerName];
  if (!layer) return;
  const n = 2 ** tile.z;
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const extent = feature.extent;
    const rings = feature.loadGeometry().map((ring) => ring.map((p) => {
      const lon = ((tile.x + p.x / extent) / n) * 360 - 180;
      const lat = mercYToLat((tile.y + p.y / extent) / n);
      return [proj.x(lon), proj.y(lat)];
    }));
    fn(feature, rings);
  }
}

function tracePath(ctx, rings) {
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  }
}

function clipToTile(ctx, tile, proj) {
  const n = 2 ** tile.z;
  const x0 = proj.x((tile.x / n) * 360 - 180) - 1;
  const x1 = proj.x(((tile.x + 1) / n) * 360 - 180) + 1;
  const y0 = proj.y(mercYToLat(tile.y / n)) - 1;
  const y1 = proj.y(mercYToLat((tile.y + 1) / n)) + 1;
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();
}

function canvas2d(W, H) {
  const c = new OffscreenCanvas(W, H);
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

async function loadTerrainHeights(bounds, W, H, z) {
  const range = tileRange(bounds, z);
  const cols = range.x1 - range.x0 + 1;
  const rows = range.y1 - range.y0 + 1;
  const [mosaic, mctx] = canvas2d(cols * 256, rows * 256);
  mctx.fillStyle = 'rgb(128,0,0)'; // Terrarium 0 m (ocean is exactly 0 in this release)
  mctx.fillRect(0, 0, cols * 256, rows * 256);
  await Promise.all(tilesIn(range).map(async ({ x, y }) => {
    const res = await archives.terrain.getZxy(z, x, y);
    if (!res) return;
    const bmp = await createImageBitmap(new Blob([res.data], { type: 'image/png' }), {
      colorSpaceConversion: 'none', premultiplyAlpha: 'none',
    });
    mctx.drawImage(bmp, (x - range.x0) * 256, (y - range.y0) * 256);
    bmp.close();
  }));
  const mw = cols * 256;
  const mh = rows * 256;
  const px = mctx.getImageData(0, 0, mw, mh).data;
  const metres = new Float32Array(mw * mh);
  for (let i = 0, j = 0; i < metres.length; i++, j += 4) metres[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;

  const heights = new Float32Array(W * H);
  const proj = { lonAt: (i) => bounds.lonMin + ((i + 0.5) / W) * (bounds.lonMax - bounds.lonMin), latAt: (j) => bounds.latMax - ((j + 0.5) / H) * (bounds.latMax - bounds.latMin) };
  const colX = new Float32Array(W);
  for (let i = 0; i < W; i++) colX[i] = (lonToTileX(proj.lonAt(i), z) - range.x0) * 256 - 0.5;
  for (let j = 0; j < H; j++) {
    const fy = Math.max(0, Math.min(mh - 1.001, (latToTileY(proj.latAt(j), z) - range.y0) * 256 - 0.5));
    const y0 = Math.floor(fy); const ty = fy - y0; const r0 = y0 * mw; const r1 = Math.min(mh - 1, y0 + 1) * mw;
    for (let i = 0; i < W; i++) {
      const fx = Math.max(0, Math.min(mw - 1.001, colX[i]));
      const x0 = Math.floor(fx); const tx = fx - x0;
      const a = metres[r0 + x0], b = metres[r0 + x0 + 1], c = metres[r1 + x0], d = metres[r1 + x0 + 1];
      heights[j * W + i] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return heights;
}

// Separable box blur (run twice ~ gaussian). Removes bilinear facets when the bake is
// denser than the terrain source.
function boxBlur(src, W, H, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const norm = 1 / (2 * r + 1);
  for (let j = 0; j < H; j++) {
    const row = j * W; let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(W - 1, Math.max(0, i))];
    for (let i = 0; i < W; i++) {
      tmp[row + i] = acc * norm;
      acc += src[row + Math.min(W - 1, i + r + 1)] - src[row + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < W; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += tmp[Math.min(H - 1, Math.max(0, j)) * W + i];
    for (let j = 0; j < H; j++) {
      out[j * W + i] = acc * norm;
      acc += tmp[Math.min(H - 1, j + r + 1) * W + i] - tmp[Math.max(0, j - r) * W + i];
    }
  }
  return out;
}

// Hash-based value noise in lon/lat space so the global and regional bakes share the same field.
function hash(ix, iy) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

const OCEAN_LABELS = [
  { text: 'I N D I A N   O C E A N', lon: 78, lat: -14, size: 2.3 },
  { text: 'P A C I F I C   O C E A N', lon: -150, lat: 6, size: 2.6 },
  { text: 'A T L A N T I C', lon: -38, lat: 24, size: 2.3 },
  { text: 'Bay of Bengal', lon: 88.5, lat: 14.5, size: 1.4, italic: true },
  { text: 'Arabian Sea', lon: 64, lat: 14, size: 1.4, italic: true },
  { text: 'Java Sea', lon: 111.5, lat: -4.9, size: 0.62, italic: true },
  { text: 'Flores Sea', lon: 121, lat: -7.2, size: 0.5, italic: true },
  { text: 'Banda Sea', lon: 127.5, lat: -5.6, size: 0.6, italic: true },
  { text: 'South China Sea', lon: 113, lat: 12, size: 1.0, italic: true },
  { text: 'Timor Sea', lon: 126.5, lat: -11.5, size: 0.62, italic: true },
];

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => srgbToLinear(v / 255));

// Art direction palette (linear). Metal albedo == specular tint.
const PAL = {
  lacquerShallow: hex(0x2c3d50),
  lacquerDeep: hex(0x111b26),
  lacquerShelf: hex(0x2e3d44),
  patina: hex(0x3a2913),
  bronze: hex(0x87632e),
  brassHi: hex(0xcaa45e),
  inlay: hex(0x9c7a40),
  river: hex(0x2a1d0e),
};

export async function bakeSurface({ bounds, width: W, height: H, vectorZoom, terrainZoom, tune = {} }) {
  const t0 = performance.now();
  const proj = projector(bounds, W, H);
  const ppd = proj.ppd;
  const [physTiles, bathyTiles, rawHeights] = await Promise.all([
    loadVectorTiles(archives.physical, bounds, vectorZoom),
    loadVectorTiles(archives.bathy, bounds, vectorZoom),
    loadTerrainHeights(bounds, W, H, terrainZoom),
  ]);
  const tFetch = performance.now();
  const terrainPpd = (256 * 2 ** terrainZoom) / 360;
  const blurR = Math.max(1, Math.round((ppd / terrainPpd) * 1.2));
  const heights = boxBlur(boxBlur(rawHeights, W, H, blurR), W, H, blurR);

  // Land mask (R) with lakes punched out.
  const [landC, landX] = canvas2d(W, H);
  landX.fillStyle = '#000'; landX.fillRect(0, 0, W, H);
  landX.fillStyle = '#fff';
  for (const tile of physTiles) {
    landX.save(); clipToTile(landX, tile, proj);
    forEachFeature(tile, 'land', proj, (_, rings) => { tracePath(landX, rings); landX.fill('nonzero'); });
    landX.fillStyle = '#000';
    forEachFeature(tile, 'lakes', proj, (_, rings) => { tracePath(landX, rings); landX.fill('nonzero'); });
    landX.fillStyle = '#fff';
    landX.restore();
  }
  // Antarctic plateau beyond Web Mercator's reach.
  if (bounds.latMin < -MAX_MERC_LAT) landX.fillRect(0, proj.y(-MAX_MERC_LAT) - 1, W, H);

  // Blurred land for the cast "bevel" and coastal shading.
  const [blurC, blurX] = canvas2d(W, H);
  blurX.filter = `blur(${Math.max(1.5, (tune.bevelDeg ?? 0.28) * ppd)}px)`;
  blurX.drawImage(landC, 0, 0);
  const [wideC, wideX] = canvas2d(W, H);
  wideX.filter = `blur(${Math.max(3, 1.6 * ppd)}px)`;
  wideX.drawImage(landC, 0, 0);

  // Lines: R = coastline, G = rivers, B = graticule.
  const [lineC, lineX] = canvas2d(W, H);
  lineX.fillStyle = '#000'; lineX.fillRect(0, 0, W, H);
  lineX.globalCompositeOperation = 'lighter';
  lineX.lineJoin = 'round'; lineX.lineCap = 'round';
  const px = Math.max(1, ppd / 11.4);
  for (const tile of physTiles) {
    lineX.save(); clipToTile(lineX, tile, proj);
    lineX.strokeStyle = 'rgb(255,0,0)'; lineX.lineWidth = 1.1 * Math.sqrt(px);
    forEachFeature(tile, 'coastline', proj, (_, rings) => { tracePath(lineX, rings); lineX.stroke(); });
    forEachFeature(tile, 'rivers', proj, (f, rings) => {
      const w = Number(f.properties.stroke_weight ?? 1);
      lineX.strokeStyle = `rgb(0,${Math.round(150 + 60 * Math.min(1, w))},0)`;
      lineX.lineWidth = Math.max(0.7, 0.45 * w * Math.sqrt(px));
      tracePath(lineX, rings); lineX.stroke();
    });
    lineX.restore();
  }
  lineX.strokeStyle = 'rgb(0,0,255)';
  lineX.lineWidth = Math.max(1, 0.07 * ppd);
  for (let lon = -180; lon <= 180; lon += 15) {
    if (lon < bounds.lonMin - 1 || lon > bounds.lonMax + 1) continue;
    lineX.beginPath(); lineX.moveTo(proj.x(lon), 0); lineX.lineTo(proj.x(lon), H); lineX.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    if (lat < bounds.latMin - 1 || lat > bounds.latMax + 1) continue;
    lineX.lineWidth = Math.max(1, (lat === 0 ? 0.13 : 0.07) * ppd);
    lineX.beginPath(); lineX.moveTo(0, proj.y(lat)); lineX.lineTo(W, proj.y(lat)); lineX.stroke();
  }

  // Bathymetry depth (R, deeper polygons painted over shallower) + engraved ocean names (G).
  const [bathC, bathX] = canvas2d(W, H);
  bathX.fillStyle = '#000'; bathX.fillRect(0, 0, W, H);
  for (const tile of bathyTiles) {
    bathX.save(); clipToTile(bathX, tile, proj);
    const feats = [];
    forEachFeature(tile, 'bathymetry', proj, (f, rings) => feats.push([Number(f.properties.depth_m || 0), rings]));
    feats.sort((a, b) => a[0] - b[0]);
    for (const [depth, rings] of feats) {
      const v = Math.round(Math.min(1, depth / 8000) * 255);
      bathX.fillStyle = `rgb(${v},0,0)`; tracePath(bathX, rings); bathX.fill('nonzero');
    }
    bathX.restore();
  }
  bathX.globalCompositeOperation = 'lighter';
  bathX.fillStyle = 'rgb(0,255,0)';
  bathX.textAlign = 'center'; bathX.textBaseline = 'middle';
  for (const label of OCEAN_LABELS) {
    const sizePx = label.size * ppd;
    if (sizePx < 7) continue;
    if (label.lon < bounds.lonMin - 20 || label.lon > bounds.lonMax + 20 || label.lat < bounds.latMin - 5 || label.lat > bounds.latMax + 5) continue;
    bathX.font = `${label.italic ? 'italic ' : ''}${sizePx.toFixed(1)}px "Hoefler Text", Baskerville, Georgia, serif`;
    bathX.fillText(label.text, proj.x(label.lon), proj.y(label.lat));
  }
  const tRaster = performance.now();

  const land = landX.getImageData(0, 0, W, H).data;
  const blur = blurX.getImageData(0, 0, W, H).data;
  const wide = wideX.getImageData(0, 0, W, H).data;
  const lines = lineX.getImageData(0, 0, W, H).data;
  const bath = bathX.getImageData(0, 0, W, H).data;

  const albedo = new Uint8Array(W * H * 4);
  const orm = new Uint8Array(W * H * 4);
  const relief = new Float32Array(W * H);
  const reliefGain = tune.relief ?? 1;

  const octaves = [0.35, 1.3, 4.5, 14, 42].filter((f) => f < ppd / 2.2);
  for (let j = 0; j < H; j++) {
    const lat = bounds.latMax - ((j + 0.5) / H) * (bounds.latMax - bounds.latMin);
    for (let i = 0; i < W; i++) {
      const lon = bounds.lonMin + ((i + 0.5) / W) * (bounds.lonMax - bounds.lonMin);
      const k = j * W + i; const q = k * 4;
      const isLand = land[q] / 255;
      const bevel = blur[q] / 255;
      const coastal = wide[q] / 255;
      const coast = lines[q] / 255, river = lines[q + 1] / 255, grat = lines[q + 2] / 255;
      const depth = (bath[q] / 255) * 8000;
      const text = bath[q + 1] / 255;
      const elev = Math.max(0, heights[k]);

      // Multi-octave noise evaluated in degrees, amplitude falling off with frequency.
      let mottle = 0, fine = 0.5;
      for (let o = 0; o < octaves.length; o++) {
        const f = octaves[o];
        const n = vnoise(lon * f + o * 17.3, lat * f * 1.1 - o * 9.1);
        if (o < 2) mottle += (n - 0.5) * (o === 0 ? 0.7 : 0.45);
        else fine = 0.5 + (n - 0.5) * Math.min(1, 4.5 / f); // equalise slope energy across bakes
      }
      const speck = hash(i * 7 + 3, j * 13 + 1) > 0.9975 ? 1 : 0;

      const r = Math.pow(elev / 6500, 0.55); // compress: lowlands still read
      const worn = Math.max(0, Math.min(1, 0.25 + r * 0.9 + mottle * 0.35 + (fine - 0.5) * 0.25));

      let cr, cg, cb, rough, metal, h;
      if (isLand > 0.5) {
        const t1 = smooth(0.0, 0.55, worn), t2 = smooth(0.55, 1.0, worn);
        cr = mix(mix(PAL.patina[0], PAL.bronze[0], t1), PAL.brassHi[0], t2 * 0.75);
        cg = mix(mix(PAL.patina[1], PAL.bronze[1], t1), PAL.brassHi[1], t2 * 0.75);
        cb = mix(mix(PAL.patina[2], PAL.bronze[2], t1), PAL.brassHi[2], t2 * 0.75);
        const dark = 1 - 0.55 * river - 0.35 * coast;
        cr *= dark; cg *= dark; cb *= dark;
        rough = 0.7 - 0.24 * t1 - 0.1 * t2 + (fine - 0.5) * 0.14 + river * 0.2;
        metal = 0.75 + 0.25 * t1;
        h = bevel * 1.0 + r * 1.35 * reliefGain + (fine - 0.5) * 0.06 - river * 0.12;
      } else {
        const d = Math.min(1, depth / 6000);
        const shelf = depth < 150 ? 1 - coastal * 0.2 : 0;
        cr = mix(PAL.lacquerShallow[0], PAL.lacquerDeep[0], Math.sqrt(d));
        cg = mix(PAL.lacquerShallow[1], PAL.lacquerDeep[1], Math.sqrt(d));
        cb = mix(PAL.lacquerShallow[2], PAL.lacquerDeep[2], Math.sqrt(d));
        const shelfMix = shelf * 0.55;
        cr = mix(cr, PAL.lacquerShelf[0], shelfMix); cg = mix(cg, PAL.lacquerShelf[1], shelfMix); cb = mix(cb, PAL.lacquerShelf[2], shelfMix);
        const m = Math.max(0.35, 1 + mottle * 1.4 + (fine - 0.5) * 0.35);
        cr *= m; cg *= m; cb *= m;
        const inlay = Math.max(grat * 0.5, text * 0.75, coast * 0.55);
        cr = mix(cr, PAL.inlay[0], inlay); cg = mix(cg, PAL.inlay[1], inlay); cb = mix(cb, PAL.inlay[2], inlay);
        cr += speck * 0.08; cg += speck * 0.06; cb += speck * 0.03;
        rough = 0.62 + mottle * 0.3 + (fine - 0.5) * 0.18 - inlay * 0.2;
        metal = 0.08 + inlay * 0.85;
        // Depth terraces engrave the band edges; coast ramps up into the bevel.
        h = bevel * 1.0 - Math.floor(depth / 1000) * 0.022 * reliefGain + (fine - 0.5) * 0.025 - grat * 0.05 - text * 0.06;
      }

      albedo[q] = Math.round(linearToSrgb(Math.max(0, Math.min(1, cr))) * 255);
      albedo[q + 1] = Math.round(linearToSrgb(Math.max(0, Math.min(1, cg))) * 255);
      albedo[q + 2] = Math.round(linearToSrgb(Math.max(0, Math.min(1, cb))) * 255);
      albedo[q + 3] = 255;
      orm[q] = 255;
      orm[q + 1] = Math.round(Math.max(0.05, Math.min(1, rough)) * 255);
      orm[q + 2] = Math.round(Math.max(0, Math.min(1, metal)) * 255);
      orm[q + 3] = 255;
      relief[k] = h;
    }
  }

  // Tangent-space normals from the engraved relief. Equirect x spacing shrinks with cos(lat).
  const normal = new Uint8Array(W * H * 4);
  // Slope per degree (dh * ppd) keeps relief consistent between the global and regional bakes.
  const strength = (tune.normalStrength ?? 1) * 0.9 * ppd;
  for (let j = 0; j < H; j++) {
    const lat = bounds.latMax - ((j + 0.5) / H) * (bounds.latMax - bounds.latMin);
    const cosLat = Math.max(0.12, Math.cos(lat * DEG));
    const jn = Math.max(0, j - 1), js = Math.min(H - 1, j + 1);
    for (let i = 0; i < W; i++) {
      const iw = Math.max(0, i - 1), ie = Math.min(W - 1, i + 1);
      const dx = (relief[j * W + ie] - relief[j * W + iw]) / (2 * cosLat);
      const dyNorth = (relief[jn * W + i] - relief[js * W + i]) / 2;
      let nx = -dx * strength, ny = -dyNorth * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
      const q = (j * W + i) * 4;
      normal[q] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[q + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[q + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[q + 3] = 255;
    }
  }
  const tBake = performance.now();
  return {
    width: W, height: H, albedo, orm, normal,
    stats: { tiles: physTiles.length + bathyTiles.length, fetchMs: Math.round(tFetch - t0), rasterMs: Math.round(tRaster - tFetch), bakeMs: Math.round(tBake - tRaster) },
  };
}
