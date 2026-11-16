import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const W = 1024;
const H = 1024;
const SCALE = 2;
const SW = W * SCALE;
const SH = H * SCALE;
const pixels = new Uint8Array(SW * SH * 3);

function clamp(n: number): number {
  return Math.max(0, Math.min(255, n));
}

function blend(x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || y < 0 || x >= SW || y >= SH || a <= 0) return;
  const i = (y * SW + x) * 3;
  const q = 1 - a;
  pixels[i] = clamp(pixels[i] * q + r * a);
  pixels[i + 1] = clamp(pixels[i + 1] * q + g * a);
  pixels[i + 2] = clamp(pixels[i + 2] * q + b * a);
}

function drawDisk(cx: number, cy: number, radius: number, color: [number, number, number], alpha = 1): void {
  const x0 = Math.max(0, Math.floor((cx - radius) * SCALE));
  const x1 = Math.min(SW - 1, Math.ceil((cx + radius) * SCALE));
  const y0 = Math.max(0, Math.floor((cy - radius) * SCALE));
  const y1 = Math.min(SH - 1, Math.ceil((cy + radius) * SCALE));
  const rr = radius * radius;
  for (let y = y0; y <= y1; y++) {
    const py = (y + 0.5) / SCALE - cy;
    for (let x = x0; x <= x1; x++) {
      const px = (x + 0.5) / SCALE - cx;
      const d = px * px + py * py;
      if (d <= rr) {
        const edge = Math.min(1, (radius - Math.sqrt(d)) * SCALE + 0.5);
        blend(x, y, color[0], color[1], color[2], alpha * edge);
      }
    }
  }
}

function drawPolygon(points: Array<[number, number]>, color: [number, number, number], alpha = 1): void {
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) * SCALE));
  const x1 = Math.min(SW - 1, Math.ceil(Math.max(...xs) * SCALE));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) * SCALE));
  const y1 = Math.min(SH - 1, Math.ceil(Math.max(...ys) * SCALE));
  for (let y = y0; y <= y1; y++) {
    const py = (y + 0.5) / SCALE;
    for (let x = x0; x <= x1; x++) {
      const px = (x + 0.5) / SCALE;
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      if (inside) blend(x, y, color[0], color[1], color[2], alpha);
    }
  }
}

function drawLine(x1: number, y1: number, x2: number, y2: number, radius: number, color: [number, number, number], alpha = 1): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const x0 = Math.max(0, Math.floor((Math.min(x1, x2) - radius) * SCALE));
  const x1p = Math.min(SW - 1, Math.ceil((Math.max(x1, x2) + radius) * SCALE));
  const y0 = Math.max(0, Math.floor((Math.min(y1, y2) - radius) * SCALE));
  const y1p = Math.min(SH - 1, Math.ceil((Math.max(y1, y2) + radius) * SCALE));
  for (let y = y0; y <= y1p; y++) {
    const py = (y + 0.5) / SCALE;
    for (let x = x0; x <= x1p; x++) {
      const px = (x + 0.5) / SCALE;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
      const ex = px - (x1 + t * dx);
      const ey = py - (y1 + t * dy);
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d < radius) blend(x, y, color[0], color[1], color[2], alpha * Math.min(1, (radius - d) * SCALE + 0.5));
    }
  }
}

function drawCurve(points: Array<[number, number]>, radius: number, color: [number, number, number], alpha = 1): void {
  for (let i = 1; i < points.length; i++) {
    drawLine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], radius, color, alpha);
  }
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  Buffer.from(data).copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, 8 + data.length)), 8 + data.length);
  return result;
}

function encodePng(rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) {
    const row = y * (W * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < W; x++) {
      const si = ((y * SCALE * SW) + x * SCALE) * 3;
      const di = row + 1 + x * 3;
      for (let c = 0; c < 3; c++) {
        raw[di + c] = Math.round((
          pixels[si + c] +
          pixels[si + SCALE * 3 + c] +
          pixels[si + SW * 3 + c] +
          pixels[si + SW * 3 + SCALE * 3 + c]
        ) / 4);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', new Uint8Array(0))
  ]);
}

for (let y = 0; y < SH; y++) {
  const ny = y / (SH - 1);
  for (let x = 0; x < SW; x++) {
    const nx = x / (SW - 1);
    const horizonGlow = Math.max(0, 1 - Math.abs(nx - 0.55) * 1.8);
    const i = (y * SW + x) * 3;
    pixels[i] = 7 + 13 * ny + 7 * horizonGlow * (1 - ny);
    pixels[i + 1] = 11 + 12 * ny + 5 * horizonGlow * (1 - ny);
    pixels[i + 2] = 38 + 33 * ny + 18 * horizonGlow * (1 - ny);
  }
}

drawDisk(706, 345, 315, [247, 158, 69], 0.12);
drawDisk(706, 345, 282, [255, 190, 96]);
drawDisk(706, 345, 266, [255, 202, 119]);
drawDisk(706, 345, 245, [250, 177, 83], 0.42);
drawDisk(608, 271, 24, [255, 222, 154], 0.18);
drawDisk(772, 400, 18, [188, 106, 52], 0.19);
drawDisk(820, 274, 12, [255, 224, 159], 0.14);

const stars: Array<[number, number, number]> = [
  [88, 112, 2.2], [180, 218, 1.4], [273, 83, 1.8], [389, 173, 1.5],
  [483, 72, 2.2], [551, 185, 1.4], [930, 110, 2], [866, 178, 1.2],
  [102, 329, 1.5], [294, 291, 1.4], [960, 363, 1.7], [908, 495, 1.2],
  [138, 443, 1.4], [390, 350, 1.1], [66, 523, 1.3]
];
for (const [x, y, r] of stars) {
  drawDisk(x, y, r, [205, 233, 255], 0.9);
}

drawLine(150, 195, 205, 184, 1.5, [182, 224, 255], 0.65);
drawLine(148, 196, 160, 194, 3.2, [227, 246, 255], 0.38);
drawLine(866, 230, 918, 207, 1.7, [114, 204, 255], 0.7);
drawLine(862, 232, 876, 226, 3.8, [206, 241, 255], 0.4);
drawLine(321, 258, 351, 243, 1.2, [152, 217, 255], 0.58);
drawLine(317, 260, 326, 255, 2.8, [226, 246, 255], 0.34);
drawLine(95, 393, 126, 381, 1.1, [155, 219, 255], 0.55);

const seaTop = (x: number) => 774 + 18 * Math.sin(x * 0.012) + 10 * Math.sin(x * 0.027 + 1.4);
for (let y = 0; y < SH; y++) {
  const py = y / SCALE;
  for (let x = 0; x < SW; x++) {
    const px = x / SCALE;
    if (py >= seaTop(px)) blend(x, y, 4, 102, 128, 1);
  }
}

function wave(base: number, amplitude: number, phase: number, color: [number, number, number]): void {
  for (let x = 0; x < SW; x++) {
    const px = x / SCALE;
    const top = base + amplitude * Math.sin(px * 0.014 + phase) + amplitude * 0.42 * Math.sin(px * 0.031 + phase * 1.7);
    const y0 = Math.max(0, Math.floor(top * SCALE));
    for (let y = y0; y < SH; y++) blend(x, y, color[0], color[1], color[2], 0.92);
  }
}
wave(842, 24, 0.8, [5, 151, 164]);
wave(906, 31, 2.1, [4, 110, 143]);
wave(965, 18, 1.2, [3, 63, 101]);
drawCurve([[0, 856], [72, 850], [145, 853], [218, 862], [285, 850], [348, 829], [420, 817], [494, 819]], 1.7, [143, 251, 232], 0.63);
drawCurve([[520, 839], [590, 849], [661, 855], [729, 850], [799, 837], [866, 825], [938, 828], [1024, 840]], 1.5, [134, 245, 231], 0.58);
drawCurve([[0, 928], [64, 919], [128, 913], [194, 916], [255, 930]], 1.2, [50, 193, 205], 0.48);
drawDisk(885, 886, 2.2, [184, 255, 233], 0.72);
drawDisk(904, 890, 1.5, [184, 255, 233], 0.68);
drawDisk(948, 878, 2, [184, 255, 233], 0.68);

drawCurve([[278, 765], [260, 746], [255, 724], [263, 703], [281, 684], [302, 668]], 5.2, [42, 212, 219], 0.3);
drawCurve([[278, 765], [260, 746], [255, 724], [263, 703], [281, 684], [302, 668]], 2, [210, 249, 255], 0.78);

const whale: Array<[number, number]> = [
  [339, 698], [367, 666], [395, 620], [424, 567], [454, 510], [485, 454],
  [516, 401], [547, 357], [579, 328], [611, 314], [642, 321], [669, 342],
  [691, 371], [711, 405], [733, 434], [756, 452], [775, 469], [780, 485],
  [772, 501], [753, 513], [729, 518], [706, 530], [687, 552], [665, 576],
  [638, 596], [606, 611], [571, 617], [534, 611], [497, 597], [463, 576],
  [433, 550], [408, 519], [386, 556], [366, 601], [349, 647]
];
drawPolygon(whale, [5, 18, 36]);

drawPolygon([
  [499, 537], [535, 545], [579, 562], [623, 588], [661, 618],
  [685, 650], [692, 670], [679, 678], [653, 666], [618, 644],
  [579, 616], [541, 584], [512, 558]
], [4, 17, 34]);

drawPolygon([
  [355, 694], [337, 676], [314, 660], [285, 646], [295, 669],
  [317, 687], [292, 706], [274, 727], [307, 717], [337, 701], [358, 710]
], [5, 18, 36]);

drawCurve([[347, 698], [373, 656], [405, 599], [438, 536], [471, 475], [505, 418], [539, 369], [572, 335], [606, 319]], 3.7, [73, 236, 220], 0.4);
drawCurve([[373, 667], [407, 611], [442, 548], [478, 488], [513, 432], [548, 384], [582, 348], [614, 328]], 2.1, [70, 233, 207], 0.75);
drawCurve([[375, 658], [412, 604], [453, 559], [493, 537], [532, 546], [574, 567], [618, 591], [659, 592], [696, 568], [731, 529]], 3.5, [221, 250, 255], 0.9);
drawCurve([[389, 646], [426, 593], [466, 551], [501, 540], [540, 552], [582, 574], [624, 596], [664, 592], [699, 564]], 2.1, [117, 230, 238], 0.8);
drawCurve([[508, 550], [541, 568], [579, 600], [618, 630], [653, 652], [680, 661]], 1.6, [84, 214, 203], 0.55);
drawDisk(760, 481, 3.1, [255, 213, 147], 0.95);
drawDisk(760, 481, 1.25, [22, 38, 48], 0.95);
drawDisk(718, 459, 3.2, [255, 200, 126], 0.68);
drawDisk(730, 463, 2.1, [255, 200, 126], 0.58);
drawDisk(741, 468, 1.7, [255, 200, 126], 0.5);

drawCurve([[352, 694], [381, 648], [415, 587], [450, 523], [484, 463], [519, 407], [552, 360], [585, 329], [617, 317]], 6.3, [15, 196, 190], 0.28);
drawCurve([[508, 548], [545, 563], [588, 586], [632, 601], [670, 590], [707, 555]], 1.3, [44, 196, 187], 0.45);

drawCurve([[275, 734], [262, 717], [265, 699], [280, 683], [299, 676]], 3.5, [221, 250, 255], 0.9);
drawCurve([[288, 752], [279, 733], [285, 714], [302, 699]], 2.1, [117, 230, 238], 0.8);
drawCurve([[380, 660], [414, 624], [451, 594], [484, 584]], 2.5, [235, 251, 255], 0.9);
drawCurve([[397, 671], [428, 648], [460, 631]], 1.4, [112, 227, 235], 0.8);

const droplets: Array<[number, number, number]> = [
  [270, 680, 3.2], [260, 699, 2.4], [248, 724, 3.1], [269, 744, 2.3],
  [290, 730, 2.8], [311, 742, 2], [324, 722, 2.5], [344, 736, 2],
  [359, 719, 2.6], [378, 701, 1.8], [396, 682, 2.1], [414, 670, 1.7],
  [432, 689, 2.3], [452, 704, 1.7], [469, 685, 1.8], [490, 701, 1.5],
  [506, 679, 1.8], [529, 663, 1.5], [382, 631, 1.8], [439, 575, 1.6],
  [493, 526, 1.8], [537, 517, 1.5], [572, 531, 1.8], [618, 554, 1.5],
  [665, 565, 1.8], [700, 539, 1.5], [786, 516, 2.4], [800, 493, 1.8]
];
for (const [x, y, r] of droplets) drawDisk(x, y, r, [204, 249, 255], 0.9);

for (let i = 0; i < 10; i++) {
  const x = 72 + i * 102;
  const y = 820 + 8 * Math.sin(i * 1.7);
  drawLine(x, y, x + 36 + (i % 3) * 9, y - 2, 1.3, [103, 241, 220], 0.52);
}

drawPolygon([[115, 858], [145, 849], [175, 858], [166, 872], [125, 872]], [5, 22, 38]);
drawPolygon([[130, 856], [143, 838], [157, 856]], [8, 29, 48]);
drawLine(112, 874, 180, 874, 2, [126, 234, 229], 0.75);
drawDisk(135, 862, 2, [255, 196, 100], 1);
drawDisk(150, 862, 2, [255, 196, 100], 1);
drawDisk(165, 862, 2, [255, 196, 100], 1);
drawCurve([[92, 881], [119, 878], [149, 881], [181, 878], [207, 880]], 1.1, [104, 221, 214], 0.65);

const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), encodePng(pixels));
