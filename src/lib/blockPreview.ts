export type PreviewFormat = 'RGBA8' | 'BC1' | 'BC4' | 'BC5' | 'BC7';

export function textureBytes(width: number, height: number, format: PreviewFormat, mips: boolean) {
  let total = 0;
  for (;;) {
    const blocks = Math.ceil(width / 4) * Math.ceil(height / 4);
    total += format === 'RGBA8' ? width * height * 4 : blocks * (format === 'BC1' || format === 'BC4' ? 8 : 16);
    if (!mips || (width === 1 && height === 1)) return total;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
}

function nearest(pixel: number[], palette: number[][], channels: number) {
  let best = palette[0], lowest = Infinity;
  for (const color of palette) {
    let distance = 0;
    for (let c = 0; c < channels; c++) distance += (color[c] - pixel[c]) ** 2;
    if (distance < lowest) { lowest = distance; best = color; }
  }
  return best;
}

function channelPalette(block: number[][], channel: number) {
  const values = block.map(p => p[channel]);
  const high = Math.max(...values), low = Math.min(...values);
  return Array.from({ length: 8 }, (_, i) => [Math.round((high * (7 - i) + low * i) / 7)]);
}

// One legal family of BC7 mode-6 endpoints: each endpoint shares a low bit across RGBA.
function mode6Endpoint(pixel: number[]) {
  const candidates = [0, 1].map(bit => pixel.map(v => Math.max(0, Math.min(127, Math.round((v - bit) / 2))) * 2 + bit));
  return nearest(pixel, candidates, 4);
}

function colorPalette(block: number[][], format: 'BC1' | 'BC7') {
  const channels = format === 'BC1' ? 3 : 4;
  const distance = (a: number[], b: number[]) => a.slice(0, channels).reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);
  const farthest = (a: number[]) => block.reduce((best, b) => distance(a, b) > distance(a, best) ? b : best);
  let a = farthest(block[0]), b = farthest(a);
  if (format === 'BC7') {
    a = mode6Endpoint(a); b = mode6Endpoint(b);
    return [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64]
      .map(w => a.map((v, i) => Math.floor(((64 - w) * v + w * b[i] + 32) / 64)));
  }
  const rgb565 = (p: number[]) => p.slice(0, 3).map((v, i) => {
    const bits = i === 1 ? 6 : 5;
    const q = Math.round(v * ((1 << bits) - 1) / 255);
    return (q << (8 - bits)) | (q >> (2 * bits - 8));
  });
  a = rgb565(a); b = rgb565(b);
  return [0, 1, 2, 3].map(w => [...a.map((v, i) => Math.round(((3 - w) * v + w * b[i]) / 3)), 255]);
}

export function previewBlocks(source: Float32Array, width: number, height: number, format: PreviewFormat, normalZ: boolean) {
  if (format === 'RGBA8') return source;
  const result = new Float32Array(source.length);
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const offsets: number[] = [];
      for (let j = y; j < Math.min(y + 4, height); j++) {
        for (let i = x; i < Math.min(x + 4, width); i++) offsets.push((j * width + i) * 4);
      }
      const block = offsets.map(o => Array.from(source.subarray(o, o + 4), v => Math.round(v * 255)));
      if (format === 'BC1' || format === 'BC7') {
        const palette = colorPalette(block, format);
        block.forEach((p, i) => result.set(nearest(p, palette, format === 'BC1' ? 3 : 4).map(v => v / 255), offsets[i]));
      } else {
        const reds = channelPalette(block, 0);
        const greens = format === 'BC5' ? channelPalette(block, 1) : [];
        block.forEach((p, i) => {
          const r = nearest([p[0]], reds, 1)[0] / 255;
          const g = format === 'BC5' ? nearest([p[1]], greens, 1)[0] / 255 : r;
          const z = Math.sqrt(Math.max(0, 1 - (2*r - 1)**2 - (2*g - 1)**2));
          const b = format === 'BC4' ? r : normalZ ? (1 + z) / 2 : 0;
          result.set([r, g, b, 1], offsets[i]);
        });
      }
    }
  }
  return result;
}
