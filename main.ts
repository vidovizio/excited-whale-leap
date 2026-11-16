import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SIZE = 1024;
const TWO_PI = Math.PI * 2;
let seed = 0x51ea7e21;
function random(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
}

type Point = readonly [number, number];
type Color = readonly [number, number, number];
function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }
function clamp(v: number): number { return Math.max(0, Math.min(1, v)); }
function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
function segmentDistance(x: number, y: number, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
function lineDistance(x: number, y: number, points: readonly Point[]): number {
  let d = 10;
  for (let i = 1; i < points.length; i++) d = Math.min(d, segmentDistance(x, y, points[i - 1], points[i]));
  return d;
}
function inside(x: number, y: number, points: readonly Point[]): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
function over(base: Color, color: Color, alpha: number): Color {
  return [mix(base[0], color[0], alpha), mix(base[1], color[1], alpha), mix(base[2], color[2], alpha)];
}
function radial(x: number, y: number, cx: number, cy: number, radius: number): number {
  return Math.hypot(x - cx, y - cy) / radius;
}

const moon = { x: 0.705, y: 0.335, r: 0.286 };
const whaleBack: Point[] = [
  [0.285, 0.645], [0.338, 0.526], [0.407, 0.399], [0.493, 0.294],
  [0.588, 0.224], [0.682, 0.196], [0.746, 0.207], [0.794, 0.246],
];
const boatHull: Point[] = [[0.805, 0.87], [0.92, 0.87], [0.901, 0.897], [0.831, 0.897]];
const whaleBody: Point[] = [
  [0.285, 0.645], [0.317, 0.557], [0.361, 0.461], [0.421, 0.363],
  [0.495, 0.283], [0.579, 0.224], [0.667, 0.191], [0.735, 0.201],
  [0.787, 0.239], [0.806, 0.279], [0.788, 0.312], [0.754, 0.329],
  [0.716, 0.337], [0.678, 0.362], [0.642, 0.396], [0.598, 0.422],
  [0.548, 0.425], [0.496, 0.408], [0.451, 0.411], [0.411, 0.444],
  [0.376, 0.499], [0.346, 0.565], [0.319, 0.624],
];
const tail: Point[] = [
  [0.293, 0.635], [0.258, 0.618], [0.226, 0.598], [0.188, 0.599],
  [0.147, 0.624], [0.169, 0.665], [0.207, 0.681], [0.244, 0.658],
  [0.266, 0.643], [0.284, 0.665], [0.319, 0.677], [0.356, 0.655],
  [0.359, 0.615], [0.327, 0.607], [0.305, 0.624],
];
const pectoral: Point[] = [
  [0.538, 0.405], [0.586, 0.417], [0.616, 0.468], [0.638, 0.542],
  [0.633, 0.621], [0.607, 0.651], [0.589, 0.608], [0.573, 0.543],
  [0.550, 0.483], [0.517, 0.441],
];
const splashSpine: Point[] = [
  [0.104, 0.838], [0.142, 0.793], [0.173, 0.744], [0.203, 0.697],
  [0.237, 0.656], [0.285, 0.628], [0.333, 0.610], [0.389, 0.576],
  [0.438, 0.540], [0.482, 0.513],
];
const droplets: { x: number; y: number; r: number; a: number }[] = [];
for (let i = 0; i < 50; i++) {
  const t = random();
  const arcX = 0.12 + 0.36 * t;
  const arcY = 0.81 - 0.34 * Math.sin(t * Math.PI * 0.77);
  droplets.push({
    x: arcX + (random() - 0.5) * 0.095,
    y: arcY + (random() - 0.5) * 0.10,
    r: 0.0012 + random() * 0.0040,
    a: 0.4 + random() * 0.55,
  });
}
const dropletBuckets: typeof droplets[] = Array.from({ length: 24 * 24 }, () => []);
for (const droplet of droplets) dropletBuckets[Math.min(23, Math.floor(droplet.y * 24)) * 24 + Math.min(23, Math.floor(droplet.x * 24))].push(droplet);
const stars: { x: number; y: number; r: number; a: number; warm: boolean }[] = [];
for (let i = 0; i < 95; i++) {
  stars.push({ x: random(), y: random() * 0.78, r: 0.0007 + random() * 0.0025, a: 0.3 + random() * 0.7, warm: random() > 0.84 });
}
const starBuckets: typeof stars[][] = Array.from({ length: 24 * 20 }, () => []);
for (const star of stars) starBuckets[Math.min(19, Math.floor(star.y * 24)) * 24 + Math.min(23, Math.floor(star.x * 24))].push(star);

function sample(x: number, y: number): Color {
  const glow = Math.exp(-(radial(x, y, moon.x, moon.y, 0.51) ** 2) * 2.4);
  let c: Color = [
    mix(5, 23, clamp(y * 0.8)) + 18 * glow,
    mix(10, 18, clamp(y * 0.8)) + 20 * glow,
    mix(37, 83, clamp(y * 0.85)) + 34 * glow,
  ];

  const cell = 1 / 24;
  const bx0 = Math.max(0, Math.floor((x - 0.011) / cell)), bx1 = Math.min(23, Math.floor((x + 0.011) / cell));
  const by0 = Math.max(0, Math.floor((y - 0.011) / cell)), by1 = Math.min(19, Math.floor((y + 0.011) / cell));
  for (let yy = by0; yy <= by1; yy++) {
    for (let xx = bx0; xx <= bx1; xx++) {
      for (const s of starBuckets[yy * 24 + xx]) {
        const d = Math.hypot(x - s.x, y - s.y);
        if (d < s.r * 3.2) {
          const a = s.a * (1 - smooth(s.r * 0.45, s.r * 3.2, d)) * (1 - smooth(0.69, 0.89, radial(x, y, moon.x, moon.y, moon.r)));
          c = over(c, s.warm ? [255, 206, 145] : [171, 224, 246], a * 0.85);
        }
      }
    }
  }

  const md = radial(x, y, moon.x, moon.y, moon.r);
  if (md < 1.03) {
    const edge = 1 - smooth(0.985, 1.025, md);
    const shade = clamp(1 - md * 0.34 + 0.06 * Math.sin(x * 31 + y * 18));
    const gold: Color = [mix(152, 255, shade), mix(76, 195, shade), mix(37, 111, shade)];
    c = over(c, gold, edge);
    const crater1 = Math.hypot(x - 0.626, y - 0.255);
    const crater2 = Math.hypot(x - 0.767, y - 0.371);
    const crater3 = Math.hypot(x - 0.658, y - 0.444);
    for (const [d, r] of [[crater1, 0.021], [crater2, 0.031], [crater3, 0.018]] as const) {
      if (d < r) c = over(c, [181, 104, 48], (1 - smooth(r * 0.7, r, d)) * 0.22 * edge);
    }
  }

  const starA = Math.hypot(x - 0.17, y - 0.16);
  const starB = Math.hypot(x - 0.87, y - 0.105);
  if (starA < 0.22 && segmentDistance(x, y, [0.04, 0.22], [0.28, 0.095]) < 0.0025) {
    const a = 1 - smooth(0, 0.0025, segmentDistance(x, y, [0.04, 0.22], [0.28, 0.095]));
    c = over(c, [187, 240, 255], a * (1 - smooth(0.13, 0.24, starA)) * 0.9);
  }
  if (starB < 0.16 && segmentDistance(x, y, [0.78, 0.16], [0.96, 0.075]) < 0.002) {
    const d = segmentDistance(x, y, [0.78, 0.16], [0.96, 0.075]);
    c = over(c, [172, 236, 255], (1 - smooth(0, 0.002, d)) * (1 - smooth(0.09, 0.17, starB)) * 0.82);
  }

  if (x > 0.08 && x < 0.51 && y > 0.49 && y < 0.88) {
    const sd = lineDistance(x, y, splashSpine);
    const plumeWidth = 0.019 + 0.014 * (1 - smooth(0.02, 0.43, y));
    if (sd < plumeWidth) {
      const edge = 1 - smooth(plumeWidth * 0.68, plumeWidth, sd);
      c = over(c, [34, 196, 209], edge * 0.68);
      if (sd < plumeWidth * 0.28) c = over(c, [177, 251, 246], (1 - sd / (plumeWidth * 0.28)) * 0.75);
    }
  }
  const dbx0 = Math.max(0, Math.floor((x - 0.014) / cell)), dbx1 = Math.min(23, Math.floor((x + 0.014) / cell));
  const dby0 = Math.max(0, Math.floor((y - 0.014) / cell)), dby1 = Math.min(23, Math.floor((y + 0.014) / cell));
  for (let yy = dby0; yy <= dby1; yy++) {
    for (let xx = dbx0; xx <= dbx1; xx++) {
      for (const d of dropletBuckets[yy * 24 + xx]) {
        const dist = Math.hypot(x - d.x, y - d.y);
        if (dist < d.r * 2.5) c = over(c, [139, 247, 241], d.a * (1 - smooth(d.r, d.r * 2.5, dist)));
      }
    }
  }

  const inFlipper = x > 0.51 && x < 0.65 && y > 0.40 && y < 0.66 && inside(x, y, pectoral);
  const inTail = x > 0.14 && x < 0.37 && y > 0.59 && y < 0.69 && inside(x, y, tail);
  const inBody = x > 0.28 && x < 0.82 && y > 0.18 && y < 0.69 && inside(x, y, whaleBody);
  if (inFlipper) c = [5, 26, 43];
  if (inTail) c = [6, 25, 42];
  if (inBody) {
    const light = clamp((0.72 - x) * 0.9 + (y - 0.18) * 0.13);
    c = [Math.round(mix(5, 12, light)), Math.round(mix(23, 47, light)), Math.round(mix(39, 68, light))];
  }
  const rim = lineDistance(x, y, whaleBack);
  if (inBody && rim < 0.0065) {
    c = over(c, [72, 246, 225], (1 - smooth(0.0012, 0.0065, rim)) * 0.9);
  }
  if (inFlipper || inTail) {
    const finEdge = Math.min(lineDistance(x, y, pectoral), lineDistance(x, y, tail));
    if (finEdge < 0.004) c = over(c, [43, 194, 193], (1 - smooth(0.0008, 0.004, finEdge)) * 0.45);
  }
  if (Math.hypot(x - 0.783, y - 0.271) < 0.007) c = over(c, [4, 12, 24], 0.75);

  if (y > 0.76) {
    const waveY = 0.792 + 0.016 * Math.sin(x * 20 + 0.4) + 0.009 * Math.sin(x * 47);
    const waveY2 = 0.849 + 0.017 * Math.sin(x * 17 + 1.2) + 0.009 * Math.sin(x * 39 + 0.6);
    const waveY3 = 0.918 + 0.014 * Math.sin(x * 15 + 2.1) + 0.008 * Math.sin(x * 33);
    const waveY4 = 0.969 + 0.011 * Math.sin(x * 23 + 1.5) + 0.006 * Math.sin(x * 51);
    if (y > waveY4) c = over(c, [3, 29, 59], 1);
    if (y > waveY3) c = over(c, [5, 45, 80], 1);
    if (y > waveY2) c = over(c, [5, 91, 124], 1);
    if (y > waveY) c = over(c, [5, 125, 153], 1);
    const crest = Math.min(Math.abs(y - waveY), Math.abs(y - waveY2), Math.abs(y - waveY3), Math.abs(y - waveY4));
    if (crest < 0.0045) c = over(c, [93, 231, 219], (1 - crest / 0.0045) * 0.8);
  }

  if (inside(x, y, boatHull)) c = [8, 24, 35];
  if (x > 0.837 && x < 0.883 && y > 0.839 && y < 0.869) c = [19, 34, 42];
  if (Math.hypot(x - 0.849, y - 0.852) < 0.003 || Math.hypot(x - 0.871, y - 0.852) < 0.003) c = [255, 184, 75];
  if (segmentDistance(x, y, [0.818, 0.909], [0.932, 0.909]) < 0.0025) c = over(c, [75, 217, 207], 0.8);
  return c;
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);
const offsets = [-0.25, 0.25];
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let r = 0, g = 0, b = 0;
    for (const oy of offsets) for (const ox of offsets) {
      const color = sample((px + 0.5 + ox) / SIZE, (py + 0.5 + oy) / SIZE);
      r += color[0]; g += color[1]; b += color[2];
    }
    const i = (py * SIZE + px) * 4;
    pixels[i] = Math.round(r / 4); pixels[i + 1] = Math.round(g / 4); pixels[i + 2] = Math.round(b / 4); pixels[i + 3] = 255;
  }
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "entry.png"), png);
