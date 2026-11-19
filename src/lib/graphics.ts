export type Vec3 = [number, number, number];

export function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

export function saturate(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = saturate((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function norm3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function reflect3(I: Vec3, N: Vec3): Vec3 {
  const d = 2 * dot3(I, N);
  return [I[0] - d * N[0], I[1] - d * N[1], I[2] - d * N[2]];
}

export function srgbToLinear(c: number): number {
  const v = Math.max(0, c);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  const v = Math.max(0, c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

// ACES-like filmic curve for HDR > 1 values
export function acesTonemap(x: number): number {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  return saturate((x * (a * x + b)) / (x * (c * x + d) + e));
}

// Deterministic 2D hash & fractional Brownian motion noise
export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

export function fbm(x: number, y: number, octaves = 4): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * valueNoise(x * freq, y * freq);
    freq *= 2.02;
    amp *= 0.5;
  }
  return val;
}

// Procedural studio/street environment reflection (IBL approximation)
export function sampleEnvMap(dir: Vec3, roughness: number, envMode: 'studio' | 'sunny' | 'cave' | 'black' = 'sunny'): Vec3 {
  if (envMode === 'black') return [0, 0, 0];
  const [dx, dy, dz] = dir; // dy is up
  const blur = saturate(roughness);

  if (envMode === 'cave') {
    const torch = Math.pow( Math.max(0, dx * 0.6 + dy * 0.5 + dz * 0.6), lerp(28, 2, blur) );
    const base: Vec3 = [0.03, 0.035, 0.055];
    return [base[0] + torch * 0.45, base[1] + torch * 0.24, base[2] + torch * 0.08];
  }

  if (envMode === 'studio') {
    const softbox1 = Math.pow(Math.max(0, dy * 0.7 + dx * 0.6 + dz * 0.3), lerp(36, 2.5, blur));
    const softbox2 = Math.pow(Math.max(0, -dx * 0.8 + dy * 0.3 + dz * 0.5), lerp(24, 2, blur));
    const horizon = Math.exp(-Math.abs(dy) * lerp(8, 1.8, blur)) * 0.25;
    const upper = lerp3([0.14, 0.16, 0.2], [0.28, 0.31, 0.38], Math.max(0, dy));
    const lower: Vec3 = [0.06, 0.06, 0.07];
    const base = lerp3(lower, upper, smoothstep(-0.12, 0.12, dy));
    const boost = softbox1 * 1.4 + softbox2 * 0.65 + horizon;
    return [base[0] + boost, base[1] + boost, base[2] + boost * 1.05];
  }

  // Sunny outdoor sky + warm ground bounce + horizon buildings (smooth horizon blend)
  const skyUpper = lerp3([0.62, 0.76, 0.95], [0.16, 0.38, 0.82], Math.pow(Math.max(0, dy), 0.65));
  const groundLower = lerp3([0.28, 0.24, 0.19], [0.11, 0.09, 0.07], saturate(-dy));
  const sky = lerp3(groundLower, skyUpper, smoothstep(-0.1, 0.1, dy));
  const sunGlow = Math.pow(Math.max(0, dx * 0.55 + dy * 0.68 + dz * 0.48), lerp(64, 3, blur)) * lerp(2.2, 0.35, blur);
  const cityBand = (1 - blur * 0.75) * Math.exp(-dy * dy * 28) * (Math.sin(dx * 19) * 0.5 + 0.5) * 0.14;
  return [
    sky[0] + sunGlow * 1.1 + cityBand,
    sky[1] + sunGlow * 0.98 + cityBand * 0.9,
    sky[2] + sunGlow * 0.82 + cityBand * 0.8,
  ];
}

// Cook-Torrance GGX PBR Shading for a single pixel on a sphere/mesh
export interface PbrPixelInput {
  N: Vec3;
  V: Vec3;
  L: Vec3;
  baseColorLinear: Vec3;
  emissiveLinear?: Vec3;
  metallic: number;
  roughness: number;
  specularLevel?: number; // UE default 0.5 -> F0 = 0.04
  ao?: number;
  lightIntensity?: number;
  envMode?: 'studio' | 'sunny' | 'cave' | 'black';
  anisotropy?: number;
  tangent?: Vec3;
  clearCoat?: number;
  clearCoatRoughness?: number;
  sssStrength?: number;
  sssColor?: Vec3;
  toonSteps?: number; // 0 = realistic PBR, >=2 = Substrate Toon ramp
}

export function shadePbrPixel(p: PbrPixelInput): Vec3 {
  const N = p.N;
  const V = p.V;
  const L = p.L;
  const H = norm3(add3(V, L));

  const NdotL_raw = dot3(N, L);
  let NdotL = Math.max(0, NdotL_raw);
  const NdotV = Math.max(0.001, dot3(N, V));
  const NdotH = Math.max(0, dot3(N, H));
  const VdotH = Math.max(0, dot3(V, H));

  if (p.toonSteps && p.toonSteps >= 2) {
    const q = Math.floor(NdotL * p.toonSteps) / (p.toonSteps - 1 || 1);
    NdotL = smoothstep(0, 1, q * 0.88 + 0.12 * (NdotL > 0.05 ? 1 : 0));
  }

  const rough = clamp(p.roughness, 0.045, 1.0);
  const alpha = rough * rough;
  const alpha2 = alpha * alpha;

  const dielectricF0 = 0.08 * (p.specularLevel ?? 0.5);
  const F0: Vec3 = lerp3([dielectricF0, dielectricF0, dielectricF0], p.baseColorLinear, p.metallic);

  // Fresnel Schlick
  const fPow = Math.pow(1 - VdotH, 5);
  const F: Vec3 = [
    F0[0] + (1 - F0[0]) * fPow,
    F0[1] + (1 - F0[1]) * fPow,
    F0[2] + (1 - F0[2]) * fPow,
  ];

  // GGX NDF (with optional Anisotropy stretch)
  let D: number;
  if (p.anisotropy && Math.abs(p.anisotropy) > 0.01 && p.tangent) {
    const T = p.tangent;
    const B: Vec3 = norm3([
      N[1] * T[2] - N[2] * T[1],
      N[2] * T[0] - N[0] * T[2],
      N[0] * T[1] - N[1] * T[0],
    ]);
    const aspect = Math.sqrt(1 - 0.9 * Math.abs(p.anisotropy));
    const ax = Math.max(0.002, p.anisotropy >= 0 ? alpha / aspect : alpha * aspect);
    const ay = Math.max(0.002, p.anisotropy >= 0 ? alpha * aspect : alpha / aspect);
    const TdotH = dot3(T, H);
    const BdotH = dot3(B, H);
    const denom = (TdotH * TdotH) / (ax * ax) + (BdotH * BdotH) / (ay * ay) + NdotH * NdotH;
    D = 1 / (Math.PI * ax * ay * denom * denom + 1e-6);
  } else {
    const denom = NdotH * NdotH * (alpha2 - 1) + 1;
    D = alpha2 / (Math.PI * denom * denom + 1e-6);
  }

  if (p.toonSteps && p.toonSteps >= 2) {
    D = D > 1.2 ? 2.2 : 0.0;
  }

  // Smith Schlick-GGX Geometry
  const k = ((rough + 1) * (rough + 1)) / 8;
  const G1V = NdotV / (NdotV * (1 - k) + k);
  const G1L = NdotL / (NdotL * (1 - k) + k);
  const G = G1V * G1L;

  const specScale = (D * G) / Math.max(0.001, 4 * NdotV * Math.max(0.001, NdotL));
  const kD: Vec3 = [
    (1 - F[0]) * (1 - p.metallic),
    (1 - F[1]) * (1 - p.metallic),
    (1 - F[2]) * (1 - p.metallic),
  ];

  const lightPower = p.lightIntensity ?? 2.4;
  let r = ( (kD[0] * p.baseColorLinear[0]) / Math.PI + F[0] * specScale ) * NdotL * lightPower;
  let g = ( (kD[1] * p.baseColorLinear[1]) / Math.PI + F[1] * specScale ) * NdotL * lightPower;
  let b = ( (kD[2] * p.baseColorLinear[2]) / Math.PI + F[2] * specScale ) * NdotL * lightPower;

  // Subsurface Scattering (back-lit transmission approximation for MFP/SSS)
  if (p.sssStrength && p.sssStrength > 0) {
    const backLight = Math.pow(saturate(dot3(V, [-L[0], -L[1], -L[2]]) * 0.65 + (1 - NdotV) * 0.5), 2.2);
    const wrap = saturate((NdotL_raw + 0.45) / 1.45);
    const sCol = p.sssColor ?? [0.15, 0.82, 0.42];
    const sAmt = p.sssStrength * (backLight * 1.15 + wrap * 0.35) * lightPower * 0.45;
    r += sCol[0] * sAmt;
    g += sCol[1] * sAmt;
    b += sCol[2] * sAmt;
  }

  // Environment IBL (Ambient Diffuse + Indirect Specular)
  const ao = p.ao ?? 1.0;
  const envMode = p.envMode ?? 'sunny';
  const R = reflect3([-V[0], -V[1], -V[2]], N);
  const envSpec = sampleEnvMap(R, rough, envMode);
  const envDiff = sampleEnvMap(N, 0.95, envMode);

  const fViewPow = Math.pow(1 - NdotV, 5);
  const maxOneMinusRough = Math.max(1 - rough, F0[0]);
  const F_ibl: Vec3 = [
    F0[0] + (Math.max(1 - rough, F0[0]) - F0[0]) * fViewPow,
    F0[1] + (Math.max(1 - rough, F0[1]) - F0[1]) * fViewPow,
    F0[2] + (Math.max(1 - rough, F0[2]) - F0[2]) * fViewPow,
  ];
  void maxOneMinusRough;

  const kD_ibl: Vec3 = [
    (1 - F_ibl[0]) * (1 - p.metallic),
    (1 - F_ibl[1]) * (1 - p.metallic),
    (1 - F_ibl[2]) * (1 - p.metallic),
  ];

  r += (kD_ibl[0] * p.baseColorLinear[0] * envDiff[0] * 0.65 + envSpec[0] * F_ibl[0]) * ao;
  g += (kD_ibl[1] * p.baseColorLinear[1] * envDiff[1] * 0.65 + envSpec[1] * F_ibl[1]) * ao;
  b += (kD_ibl[2] * p.baseColorLinear[2] * envDiff[2] * 0.65 + envSpec[2] * F_ibl[2]) * ao;

  // Optional Substrate Vertical Layer Clear Coat on top
  if (p.clearCoat && p.clearCoat > 0.01) {
    const ccRough = clamp(p.clearCoatRoughness ?? 0.05, 0.03, 0.6);
    const ccA2 = Math.pow(ccRough, 4);
    const ccDenom = NdotH * NdotH * (ccA2 - 1) + 1;
    const ccD = ccA2 / (Math.PI * ccDenom * ccDenom + 1e-6);
    const ccF = 0.04 + 0.96 * fViewPow;
    const ccSpec = ccD * 0.25 * NdotL * lightPower * p.clearCoat;
    const ccEnv = sampleEnvMap(R, ccRough, envMode);
    const atten = 1 - ccF * p.clearCoat * 0.85;
    r = r * atten + (ccSpec + ccEnv[0] * ccF * p.clearCoat * ao);
    g = g * atten + (ccSpec + ccEnv[1] * ccF * p.clearCoat * ao);
    b = b * atten + (ccSpec + ccEnv[2] * ccF * p.clearCoat * ao);
  }

  return [
    linearToSrgb(acesTonemap(r + (p.emissiveLinear?.[0] ?? 0))),
    linearToSrgb(acesTonemap(g + (p.emissiveLinear?.[1] ?? 0))),
    linearToSrgb(acesTonemap(b + (p.emissiveLinear?.[2] ?? 0))),
  ];
}
