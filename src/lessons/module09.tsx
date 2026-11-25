import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ModuleDefinition,
  LessonStageProps,
  SchematicDiagram,
} from '../types/course';
import {
  Vec3,
  clamp,
  saturate,
  lerp,
  lerp3,
  smoothstep,
  norm3,
  shadePbrPixel,
  srgbToLinear,
  valueNoise,
  fbm,
} from '../lib/graphics';
import {
  StageSlider,
  StageSegmented,
  StageToggle,
  PitfallCompareBar,
} from '../components/ui/StageWidgets';
import { module09PerfLessons } from './module09Perf';

// ============================================================================
// Shared Heatmaps & Procedural Helpers
// ============================================================================

/** UE 5.8 Shader Complexity / Overdraw ramp: Emerald Green -> Red -> Pink/White */
function sampleComplexityRamp(level: number): [number, number, number] {
  if (level <= 0) return [14, 18, 24];
  if (level <= 1) return [22, 132, 64]; // 1x 翠绿
  if (level <= 2) return [54, 192, 76]; // 2x 鲜绿
  if (level <= 3) return [158, 208, 46]; // 3x 黄绿
  if (level <= 5) {
    const t = (level - 3) / 2;
    return [
      Math.round(lerp(228, 218, t)),
      Math.round(lerp(168, 56, t)),
      Math.round(lerp(32, 28, t)),
    ]; // 橙 -> 红
  }
  if (level <= 8) {
    const t = (level - 5) / 3;
    return [
      Math.round(lerp(196, 152, t)),
      Math.round(lerp(28, 14, t)),
      Math.round(lerp(32, 58, t)),
    ]; // 暗红
  }
  if (level <= 11) {
    const t = (level - 8) / 3;
    return [
      Math.round(lerp(218, 250, t)),
      Math.round(lerp(42, 168, t)),
      Math.round(lerp(182, 232, t)),
    ]; // 品红 -> 粉白
  }
  return [255, 246, 252]; // 12x+ 粉白灾难
}

function hexToLinearRgb(hex: string): Vec3 {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

// ============================================================================
// LESSON 9.1 STAGE: UE 5.8 Buffer & Overdraw Inspector
// ============================================================================

type BufferViewMode = 'lit' | 'depth' | 'normal' | 'roughness' | 'overdraw';
type BushBlendMode = 'opaque' | 'masked' | 'translucent';

interface BushCardDef {
  cx: number;
  cy: number;
  zBase: number;
  zSlopeX: number;
  halfW: number;
  halfH: number;
  seed: number;
  tint: Vec3;
  litBoost: number;
}

const BUSH_CARDS: BushCardDef[] = [
  { cx: -0.48, cy: -0.34, zBase: 5.55, zSlopeX: 0.45, halfW: 0.72, halfH: 0.66, seed: 1.1, tint: [0.16, 0.46, 0.1], litBoost: 1.12 },
  { cx: 0.08, cy: -0.28, zBase: 5.85, zSlopeX: -0.52, halfW: 0.76, halfH: 0.7, seed: 2.7, tint: [0.11, 0.36, 0.08], litBoost: 0.96 },
  { cx: -0.22, cy: -0.16, zBase: 6.18, zSlopeX: 0.38, halfW: 0.78, halfH: 0.74, seed: 4.3, tint: [0.2, 0.5, 0.12], litBoost: 1.18 },
  { cx: 0.32, cy: -0.36, zBase: 6.52, zSlopeX: -0.42, halfW: 0.7, halfH: 0.64, seed: 5.9, tint: [0.09, 0.3, 0.07], litBoost: 0.84 },
  { cx: -0.06, cy: -0.42, zBase: 6.88, zSlopeX: 0.3, halfW: 0.82, halfH: 0.62, seed: 7.4, tint: [0.07, 0.25, 0.06], litBoost: 0.74 },
];

/** Procedural serrated leaf cluster mask (0..1) inside a [0,1]x[0,1] quad */
function evalFoliageClusterMask(u: number, v: number, seed: number): { alpha: number; vein: number; nx: number; ny: number } {
  // Center around bottom-middle stem
  const dx = (u - 0.5) * 2.0;
  const dy = (1.0 - v) * 1.95 - 0.12; // 0 at bottom, ~1.8 at top
  let maxA = 0;
  let bestVein = 0;
  let bestNx = 0;
  let bestNy = 0.35;

  // 7 radiating leaf blades per card
  for (let i = 0; i < 7; i++) {
    const frac = i / 6 - 0.5;
    const angle = frac * 1.95 + Math.sin(seed * 3.1 + i * 1.7) * 0.14;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    // Rotate point around stem root (0, 0.08)
    const rx = dx * ca - (dy - 0.08) * sa;
    const ry = dx * sa + (dy - 0.08) * ca;

    const bladeLen = 1.18 - Math.abs(frac) * 0.28 + Math.cos(seed + i * 2.3) * 0.08;
    const t = ry / bladeLen;
    if (t > -0.04 && t < 1.08) {
      const tc = clamp(t, 0, 1);
      // Pointed leaf width envelope + serrated teeth
      const serrate = 1 + 0.11 * Math.sin(tc * 28 + seed * 2);
      const widthEnv = Math.sin(Math.pow(tc, 0.72) * Math.PI) * 0.34 * serrate;
      const distRatio = Math.abs(rx) / Math.max(0.025, widthEnv);
      const leafVal = clamp((1.16 - distRatio) * 1.55, 0, 1);
      if (leafVal > maxA) {
        maxA = leafVal;
        bestVein = Math.exp(-Math.abs(rx) * 18) * 0.35;
        bestNx = clamp(rx / Math.max(0.08, widthEnv) * 0.55 + sa * 0.25, -0.85, 0.85);
        bestNy = clamp(0.45 + (1 - tc) * 0.35, 0.1, 0.95);
      }
    }
  }

  return { alpha: maxA, vein: bestVein, nx: bestNx, ny: bestNy };
}

const Stage9_1_GBufferBlend: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [bufferMode, setBufferMode] = useState<BufferViewMode>('lit');
  const [blendMode, setBlendMode] = useState<BushBlendMode>('opaque');
  const [clipValue, setClipValue] = useState<number>(0.33);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    depth: number;
    rough: number;
    overdraw: number;
    tag: string;
  } | null>(null);

  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const prevResetRef = useRef(resetSignal);
  const prevStepRef = useRef(stepIndex);

  // Sync stage view gently when user clicks through the 5 narrative steps
  useEffect(() => {
    if (prevStepRef.current === stepIndex) return;
    prevStepRef.current = stepIndex;
    if (stepIndex === 0) {
      setBufferMode('lit');
      setBlendMode('opaque');
    } else if (stepIndex === 1) {
      setBufferMode('depth');
      setBlendMode('masked');
    } else if (stepIndex === 2) {
      setBufferMode('overdraw');
      setBlendMode('translucent');
    } else if (stepIndex === 3) {
      setBufferMode('lit');
      setBlendMode('masked');
      setClipValue(0.33);
    } else if (stepIndex === 4) {
      setBufferMode('overdraw');
      setBlendMode('masked');
    }
  }, [stepIndex]);

  useEffect(() => {
    if (prevResetRef.current === resetSignal) return;
    prevResetRef.current = resetSignal;
    setBufferMode('lit');
    setBlendMode(prevStepRef.current === 0 ? 'opaque' : 'masked');
    setClipValue(0.33);
  }, [resetSignal]);

  // Update KPI strip (depend ONLY on primitive states!)
  useEffect(() => {
    const modeLabelMap: Record<BufferViewMode, string> = {
      lit: '最终成片 (Lit)',
      depth: '测距底片 (SceneDepth)',
      normal: '法线底片 (Normal)',
      roughness: '粗糙度底片 (Roughness)',
      overdraw: '着色复杂度 (Shader Complexity)',
    };
    const layerCost =
      blendMode === 'translucent'
        ? '多层半透明叠加爆红'
        : blendMode === 'masked'
        ? '写深度防叠层（clip 略贵于 Opaque）'
        : '最快 Early-Z（但黑框穿帮）';
    const gbufferWrite =
      blendMode === 'translucent' ? '不进底片室 / 不写深度' : '完整写入 GBuffer + 深度';
    const tone =
      blendMode === 'masked' ? 'good' : blendMode === 'opaque' ? 'warn' : 'bad';

    onKpiUpdate([
      { label: '当前检视底片', value: modeLabelMap[bufferMode], tone: 'accent' },
      {
        label: '树丛混合模式',
        value:
          blendMode === 'opaque'
            ? 'Opaque 不透明'
            : blendMode === 'masked'
            ? `Masked (${clipValue.toFixed(2)})`
            : 'Translucent 半透明',
        tone,
      },
      { label: 'GBuffer 与深度写入', value: gbufferWrite, tone },
      {
        label: '管线绘制开销特性',
        value: layerCost,
        tone: blendMode === 'translucent' ? 'bad' : blendMode === 'masked' ? 'good' : 'warn',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bufferMode, blendMode, clipValue]);

  // Compute full mini-GBuffer & all 5 buffer views at crisp 340x180 resolution
  const renderedBuffers = useMemo(() => {
    const W = 340;
    const H = 180;
    const total = W * H;

    const litImg = new Uint8ClampedArray(total * 4);
    const depthImg = new Uint8ClampedArray(total * 4);
    const normImg = new Uint8ClampedArray(total * 4);
    const roughImg = new Uint8ClampedArray(total * 4);
    const overImg = new Uint8ClampedArray(total * 4);

    const depthBuf = new Float32Array(total);
    const roughBuf = new Float32Array(total);
    const overBuf = new Uint8Array(total);
    const tagBuf = new Uint8Array(total); // 0 sky, 1 floor, 2 pillar, 3 bush, 4 glassFrame, 5 glassPane

    const sunDir: Vec3 = norm3([0.52, 0.68, -0.51]);
    const fovScale = 0.58;
    const aspect = W / H;

    // Pillar definitions: [cx, cz, radius, topY, rough]
    const pillars: [number, number, number, number, number][] = [
      [-1.58, 4.75, 0.48, 1.45, 0.78], // Left near pillar
      [0.05, 10.6, 0.66, 2.25, 0.74], // Center-mid pillar behind bushes
      [2.25, 9.2, 0.56, 1.95, 0.76], // Right pillar behind glass pane
      [-0.85, 21.5, 0.85, 3.3, 0.84], // Distant obelisk
    ];

    // Scrambled order for translucent sorting artifact demonstration
    const translucentOrder = [1, 3, 0, 4, 2];

    for (let py = 0; py < H; py++) {
      const ndcY = (0.5 - py / H) * 2 * fovScale;
      for (let px = 0; px < W; px++) {
        const idx = py * W + px;
        const ndcX = ((px / W - 0.5) * 2) * aspect * fovScale;

        // Camera at (0, 0.22, 0) looking toward +Z (slightly tilted down)
        const camY = 0.24;
        const rd: Vec3 = norm3([ndcX, ndcY - 0.07, 1.0]);
        const viewVec: Vec3 = [-rd[0], -rd[1], -rd[2]];

        let zBest = 999;
        let N: Vec3 = [0, 1, 0];
        let rough = 0.0;
        let albedo: Vec3 = [0.5, 0.65, 0.9];
        let overdraw = 1;
        let objTag = 0; // Sky

        // Sky background gradient
        const skyT = saturate(rd[1] * 2.4 + 0.25);
        let colorSrgb: Vec3 = lerp3([0.74, 0.82, 0.92], [0.27, 0.49, 0.82], skyT);

        // 1. Checkered Courtyard Floor at y = -0.95
        if (rd[1] < -0.004) {
          const tFloor = (-0.95 - camY) / rd[1];
          if (tFloor > 1.2 && tFloor < 34) {
            const wx = rd[0] * tFloor;
            const wz = rd[2] * tFloor;
            zBest = wz;
            const gx = Math.floor(wx * 1.15);
            const gz = Math.floor(wz * 1.15);
            const fx = Math.abs((wx * 1.15) - gx - 0.5);
            const fz = Math.abs((wz * 1.15) - gz - 0.5);
            const isGrout = fx > 0.45 || fz > 0.45;
            const checker = (gx + gz) & 1;
            const nVal = valueNoise(wx * 4.2, wz * 4.2);
            albedo = isGrout
              ? [0.09, 0.085, 0.075]
              : checker
              ? [0.28 + nVal * 0.05, 0.26 + nVal * 0.05, 0.23 + nVal * 0.04]
              : [0.16 + nVal * 0.03, 0.155 + nVal * 0.03, 0.145 + nVal * 0.03];
            rough = isGrout ? 0.92 : checker ? 0.36 : 0.58;
            N = norm3([(fx > 0.43 ? 0.18 : 0), 1.0, (fz > 0.43 ? -0.18 : 0)]);
            objTag = 1;
          }
        }

        // 2. Ray-Cylinder Stone Pillars
        const rayA = rd[0] * rd[0] + rd[2] * rd[2];
        for (let pi = 0; pi < pillars.length; pi++) {
          const [cx, cz, rad, topY, pRough] = pillars[pi];
          const ocX = -cx;
          const ocZ = -cz;
          const b = 2 * (ocX * rd[0] + ocZ * rd[2]);
          const c = ocX * ocX + ocZ * ocZ - rad * rad;
          const disc = b * b - 4 * rayA * c;
          if (disc > 0) {
            const tHit = (-b - Math.sqrt(disc)) / (2 * rayA);
            if (tHit > 1.0) {
              const hitY = camY + rd[1] * tHit;
              const hitZ = rd[2] * tHit;
              if (hitY >= -0.95 && hitY <= topY && hitZ < zBest) {
                zBest = hitZ;
                const hitX = rd[0] * tHit;
                const nxRaw = (hitX - cx) / rad;
                const nzRaw = (hitZ - cz) / rad;
                const ang = Math.atan2(nzRaw, nxRaw);
                const flute = Math.sin(ang * 14);
                const band = Math.abs(((hitY + 2) * 1.4) % 1 - 0.5) > 0.46 ? -0.15 : 0;
                N = norm3([nxRaw + Math.cos(ang) * flute * 0.18, band, nzRaw - Math.sin(ang) * flute * 0.18]);
                const stoneNoise = valueNoise(ang * 5 + pi * 3, hitY * 6);
                albedo = [
                  0.31 + stoneNoise * 0.08 + flute * 0.02,
                  0.28 + stoneNoise * 0.07 + flute * 0.02,
                  0.24 + stoneNoise * 0.06,
                ];
                rough = clamp(pRough - stoneNoise * 0.12, 0.3, 0.95);
                objTag = 2;
                overdraw = 1;
              }
            }
          }
        }

        // 3. Glass Bronze Frame (Opaque! Writes to GBuffer & Depth at z = 4.35)
        {
          const zGlass = 4.35;
          if (zGlass < zBest) {
            const tG = zGlass / rd[2];
            const gx = rd[0] * tG;
            const gy = camY + rd[1] * tG;
            if (gx >= 0.62 && gx <= 1.62 && gy >= -0.88 && gy <= 0.62) {
              const borderX = Math.min(gx - 0.62, 1.62 - gx);
              const borderY = Math.min(gy - -0.88, 0.62 - gy);
              if (borderX < 0.065 || borderY < 0.065) {
                zBest = zGlass;
                N = norm3([(borderX < 0.065 ? (gx < 1.1 ? -0.35 : 0.35) : 0), 0.15, -0.92]);
                albedo = [0.22, 0.15, 0.08];
                rough = 0.28;
                objTag = 4;
              }
            }
          }
        }

        // 4. Overlapping Bush Cards when Opaque or Masked (writes GBuffer & SceneDepth!)
        if (blendMode === 'opaque' || blendMode === 'masked') {
          for (let bi = 0; bi < BUSH_CARDS.length; bi++) {
            const card = BUSH_CARDS[bi];
            // Intersect angled plane: z = card.zBase + (x - card.cx) * card.zSlopeX
            // x = rd[0]*t, z = rd[2]*t => t * (rd[2] - rd[0]*zSlopeX) = zBase - cx*zSlopeX
            const denom = rd[2] - rd[0] * card.zSlopeX;
            if (Math.abs(denom) > 1e-4) {
              const tCard = (card.zBase - card.cx * card.zSlopeX) / denom;
              const zCard = rd[2] * tCard;
              if (tCard > 1.0) {
                const hx = rd[0] * tCard;
                const hy = camY + rd[1] * tCard;
                const u = (hx - (card.cx - card.halfW)) / (card.halfW * 2);
                const v = 1.0 - (hy - (card.cy - card.halfH)) / (card.halfH * 2);
                if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
                  const leaf = evalFoliageClusterMask(u, v, card.seed);
                  if (blendMode === 'opaque') {
                    // Black box artifact: whole quad is opaque!
                    if (zCard < zBest) {
                      zBest = zCard;
                      const isLeaf = leaf.alpha >= 0.32;
                      albedo = isLeaf
                        ? [
                            card.tint[0] + leaf.vein * 0.08,
                            card.tint[1] + leaf.vein * 0.14,
                            card.tint[2] + leaf.vein * 0.04,
                          ]
                        : [0.008, 0.01, 0.008]; // Pitch-black unmasked background!
                      N = isLeaf ? norm3([leaf.nx, leaf.ny, -0.78]) : [0, 0, -1];
                      rough = isLeaf ? 0.46 : 0.92;
                      objTag = 3;
                    } else {
                      // Early-Z rejected behind nearer opaque card -> minimal overdraw
                      if (u < 0.06 || u > 0.94 || v < 0.06 || v > 0.94) overdraw += 1;
                    }
                  } else {
                    // Masked mode: clip below clipValue, only silhouette 2x2 helper quads add +1 overdraw
                    if (Math.abs(leaf.alpha - clipValue) < 0.11) {
                      overdraw += 1;
                    }
                    if (leaf.alpha >= clipValue && zCard < zBest) {
                      zBest = zCard;
                      // Low clipValue reveals dark unpadded fringe around leaves!
                      const fringe = smoothstep(0.08, 0.28, leaf.alpha);
                      albedo = [
                        (card.tint[0] + leaf.vein * 0.08) * fringe,
                        (card.tint[1] + leaf.vein * 0.14) * fringe,
                        (card.tint[2] + leaf.vein * 0.04) * fringe,
                      ];
                      N = norm3([leaf.nx, leaf.ny, -0.76]);
                      rough = 0.45;
                      objTag = 3;
                    }
                  }
                }
              }
            }
          }
        }

        // Shade Deferred GBuffer Base Pass (if not sky)
        if (objTag !== 0) {
          colorSrgb = shadePbrPixel({
            N,
            V: viewVec,
            L: sunDir,
            baseColorLinear: albedo,
            metallic: objTag === 4 ? 0.75 : 0.0,
            roughness: rough,
            ao: objTag === 1 ? 0.92 : 1.0,
            lightIntensity: 2.55,
            envMode: 'sunny',
            sssStrength: objTag === 3 && blendMode === 'masked' ? 0.35 : 0,
            sssColor: [0.22, 0.72, 0.15],
          });
          // Atmospheric aerial perspective haze for distant stone
          const fogT = saturate((zBest - 9.0) / 24.0) * 0.42;
          colorSrgb = lerp3(colorSrgb, [0.68, 0.78, 0.9], fogT);
        }

        // 5. Forward Translucent Pass! (Does NOT write zBest, N, or rough!)
        if (blendMode === 'translucent') {
          for (let oi = 0; oi < translucentOrder.length; oi++) {
            const card = BUSH_CARDS[translucentOrder[oi]];
            const denom = rd[2] - rd[0] * card.zSlopeX;
            if (Math.abs(denom) > 1e-4) {
              const tCard = (card.zBase - card.cx * card.zSlopeX) / denom;
              const zCard = rd[2] * tCard;
              if (tCard > 1.0 && zCard < zBest) {
                const hx = rd[0] * tCard;
                const hy = camY + rd[1] * tCard;
                const u = (hx - (card.cx - card.halfW)) / (card.halfW * 2);
                const v = 1.0 - (hy - (card.cy - card.halfH)) / (card.halfH * 2);
                if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
                  // Every translucent quad pixel executes full shader & blending -> massive Overdraw!
                  overdraw += 2;
                  const leaf = evalFoliageClusterMask(u, v, card.seed);
                  if (leaf.alpha > 0.04) {
                    overdraw += 1;
                    // Flat non-directional translucent shading + scrambled sorting order!
                    const leafSrgb: Vec3 = [
                      clamp((0.24 + leaf.vein * 0.12) * card.litBoost, 0, 1),
                      clamp((0.56 + leaf.vein * 0.16) * card.litBoost, 0, 1),
                      clamp((0.2 + leaf.vein * 0.05) * card.litBoost, 0, 1),
                    ];
                    const aBlend = saturate(leaf.alpha * 0.92);
                    colorSrgb = lerp3(colorSrgb, leafSrgb, aBlend);
                  }
                }
              }
            }
          }
        }

        // 6. Right-side Decorative Glass Pane Interior (Legitimate Translucent example at z = 4.35)
        {
          const zGlass = 4.35;
          if (zGlass < zBest) {
            const tG = zGlass / rd[2];
            const gx = rd[0] * tG;
            const gy = camY + rd[1] * tG;
            if (gx > 0.685 && gx < 1.555 && gy > -0.815 && gy < 0.555) {
              overdraw += 2; // Single glass layer adds gentle +2 overdraw
              const diag = Math.sin((gx * 3.8 + gy * 2.9) * 2.2);
              const specStreak = diag > 0.82 ? 0.36 : diag > 0.45 ? 0.12 : 0.0;
              const edgeFresnel =
                Math.pow(
                  saturate(
                    1 -
                      Math.min(
                        Math.min(gx - 0.685, 1.555 - gx),
                        Math.min(gy - -0.815, 0.555 - gy)
                      ) *
                        3.5
                  ),
                  2
                ) * 0.22;
              // Tinted transmission + crisp window reflection
              colorSrgb = [
                clamp(colorSrgb[0] * 0.78 + 0.06 + specStreak + edgeFresnel, 0, 1),
                clamp(colorSrgb[1] * 0.88 + 0.12 + specStreak + edgeFresnel, 0, 1),
                clamp(colorSrgb[2] * 0.94 + 0.16 + specStreak * 1.05 + edgeFresnel, 0, 1),
              ];
              objTag = 5;
            }
          }
        }

        depthBuf[idx] = zBest;
        roughBuf[idx] = rough;
        overBuf[idx] = overdraw;
        tagBuf[idx] = objTag;

        const p4 = idx * 4;
        // Lit Image
        litImg[p4] = Math.round(colorSrgb[0] * 255);
        litImg[p4 + 1] = Math.round(colorSrgb[1] * 255);
        litImg[p4 + 2] = Math.round(colorSrgb[2] * 255);
        litImg[p4 + 3] = 255;

        // SceneDepth Image (近黑远白!)
        const dNorm = zBest > 100 ? 1.0 : Math.pow(saturate((zBest - 3.8) / 22.0), 0.78);
        const dByte = Math.round(dNorm * 255);
        depthImg[p4] = dByte;
        depthImg[p4 + 1] = dByte;
        depthImg[p4 + 2] = Math.min(255, dByte + 6);
        depthImg[p4 + 3] = 255;

        // World Normal Image (UE convention: X->R, Z->G, Y(up)->B so floor is blue-violet!)
        if (zBest > 100) {
          normImg[p4] = 18;
          normImg[p4 + 1] = 20;
          normImg[p4 + 2] = 28;
        } else {
          normImg[p4] = Math.round((N[0] * 0.5 + 0.5) * 255);
          normImg[p4 + 1] = Math.round((-N[2] * 0.5 + 0.5) * 255);
          normImg[p4 + 2] = Math.round((N[1] * 0.5 + 0.5) * 255);
        }
        normImg[p4 + 3] = 255;

        // Roughness Image
        const rByte = zBest > 100 ? 12 : Math.round(saturate(rough) * 255);
        roughImg[p4] = rByte;
        roughImg[p4 + 1] = rByte;
        roughImg[p4 + 2] = rByte;
        roughImg[p4 + 3] = 255;

        // Quad Overdraw Image
        const [orR, orG, orB] = sampleComplexityRamp(zBest > 100 && overdraw <= 1 ? 0 : overdraw);
        overImg[p4] = orR;
        overImg[p4 + 1] = orG;
        overImg[p4 + 2] = orB;
        overImg[p4 + 3] = 255;
      }
    }

    return {
      W,
      H,
      litImg,
      depthImg,
      normImg,
      roughImg,
      overImg,
      depthBuf,
      roughBuf,
      overBuf,
      tagBuf,
    };
  }, [blendMode, clipValue]);

  // Draw active buffer + HUD labels onto main display canvas
  useEffect(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { W, H, litImg, depthImg, normImg, roughImg, overImg } = renderedBuffers;
    const srcArr =
      bufferMode === 'lit'
        ? litImg
        : bufferMode === 'depth'
        ? depthImg
        : bufferMode === 'normal'
        ? normImg
        : bufferMode === 'roughness'
        ? roughImg
        : overImg;

    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const octx = off.getContext('2d');
    if (octx) {
      const imgData = new ImageData(new Uint8ClampedArray(srcArr), W, H);
      octx.putImageData(imgData, 0, 0);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

    // Top-left UE 5.8 Viewport Pill
    const titleMap: Record<BufferViewMode, string> = {
      lit: '🎥 视口模式：最终彩色画面 (Lit)',
      depth: '📡 视口模式：摄像机测距底片 (SceneDepth · cm · 近黑远白)',
      normal: '🧭 视口模式：GBuffer 法线底片 (World Normal)',
      roughness: '🪞 视口模式：GBuffer 粗糙度底片 (Roughness · 黑滑白糙)',
      overdraw: '🔥 视口模式：着色复杂度热图 (Shader Complexity · Alt+8)',
    };
    ctx.fillStyle = 'rgba(18, 16, 15, 0.82)';
    ctx.beginPath();
    ctx.roundRect(12, 10, 446, 28, 7);
    ctx.fill();
    ctx.fillStyle = '#f8f5ee';
    ctx.font = '700 12.5px "Noto Sans SC", sans-serif';
    ctx.fillText(titleMap[bufferMode], 22, 29);

    // Contextual scene callout pointers
    const drawCalloutTag = (x: number, y: number, text: string, bg: string) => {
      ctx.font = '700 11.5px "Noto Sans SC", sans-serif';
      const tw = ctx.measureText(text).width + 16;
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(x - tw / 2, y - 13, tw, 24, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x - tw / 2 + 8, y + 3);
    };

    if (bufferMode === 'lit') {
      if (blendMode === 'opaque') {
        drawCalloutTag(295, 225, '⚠️ Opaque 把透明空白全涂成了死黑方框！', 'rgba(168, 36, 26, 0.9)');
      } else if (blendMode === 'translucent') {
        drawCalloutTag(295, 225, '⚠️ Translucent 按中心点排序不写深度，前后叶片乱穿发灰！', 'rgba(176, 52, 22, 0.9)');
      } else {
        drawCalloutTag(295, 225, '✅ Masked 利落抠出叶缝，前后遮挡严丝合缝', 'rgba(38, 102, 42, 0.9)');
      }
      drawCalloutTag(535, 118, '玻璃窗 (单层半透明)', 'rgba(22, 74, 110, 0.85)');
    } else if (bufferMode === 'depth' || bufferMode === 'normal' || bufferMode === 'roughness') {
      if (blendMode === 'translucent') {
        drawCalloutTag(295, 195, '👻 整丛半透明灌木在底片室里直接隐形消失了！', 'rgba(155, 32, 92, 0.92)');
      } else if (blendMode === 'opaque') {
        drawCalloutTag(295, 195, '⚠️ Opaque 整张黑方框卡片直接写入底片室！', 'rgba(180, 83, 9, 0.92)');
      } else {
        drawCalloutTag(295, 195, '✅ Masked 镂空叶片精准写入底片室，供深度测距使用', 'rgba(38, 102, 42, 0.9)');
      }
      drawCalloutTag(532, 148, '视线直接穿透玻璃看到后方石柱！', 'rgba(22, 74, 110, 0.88)');
    } else if (bufferMode === 'overdraw') {
      if (blendMode === 'translucent') {
        drawCalloutTag(295, 188, '💥 5 张半透明卡片重叠，Shader Complexity 烧成粉红/粉白！', 'rgba(182, 22, 48, 0.94)');
      } else if (blendMode === 'opaque') {
        drawCalloutTag(295, 188, '🟦 Opaque 整块方框挡住后方（最快，但叶片黑板穿帮）', 'rgba(180, 83, 9, 0.92)');
      } else {
        drawCalloutTag(295, 188, '🌿 Masked 写深度防多层重绘（clip 略贵于 Opaque，远省于半透明）', 'rgba(32, 98, 44, 0.92)');
      }
    }

    // Legend bar at bottom-right for SceneDepth or Overdraw
    if (bufferMode === 'overdraw') {
      const lx = 435;
      const ly = 318;
      ctx.fillStyle = 'rgba(16, 15, 14, 0.84)';
      ctx.beginPath();
      ctx.roundRect(lx, ly, 232, 32, 7);
      ctx.fill();
      const stops = [1, 2, 4, 6, 9, 12];
      stops.forEach((lv, i) => {
        const [r, g, b] = sampleComplexityRamp(lv);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(lx + 10 + i * 24, ly + 8, 22, 9);
      });
      ctx.fillStyle = '#e8e2d8';
      ctx.font = '600 10.5px "Noto Sans SC", sans-serif';
      ctx.fillText('翠绿1x(极省)  →  暗红  →  粉白12x+(爆表)', lx + 10, ly + 28);
    } else if (bufferMode === 'depth') {
      const lx = 398;
      const ly = 318;
      ctx.fillStyle = 'rgba(16, 15, 14, 0.84)';
      ctx.beginPath();
      ctx.roundRect(lx, ly, 270, 32, 7);
      ctx.fill();
      const grad = ctx.createLinearGradient(lx + 10, 0, lx + 258, 0);
      grad.addColorStop(0, '#101216');
      grad.addColorStop(1, '#ffffff');
      ctx.fillStyle = grad;
      ctx.fillRect(lx + 10, ly + 7, 248, 9);
      ctx.fillStyle = '#e8e2d8';
      ctx.font = '600 10.5px "Noto Sans SC", sans-serif';
      ctx.fillText('近处 400 cm (4m·黑) ───► 远处 2500 cm+ (25m+·白)', lx + 10, ly + 28);
    }

    // Hover crosshair
    if (hoverInfo) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hoverInfo.x, hoverInfo.y, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [renderedBuffers, bufferMode, blendMode, hoverInfo]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const cy = ((e.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    const bx = clamp(Math.floor((cx / canvas.width) * renderedBuffers.W), 0, renderedBuffers.W - 1);
    const by = clamp(Math.floor((cy / canvas.height) * renderedBuffers.H), 0, renderedBuffers.H - 1);
    const idx = by * renderedBuffers.W + bx;
    const tagNames = [
      '远景天空',
      '石砖地面',
      '雕花石柱',
      '多层灌木丛',
      '玻璃铜框',
      '半透明玻璃窗（底片读数来自背后不透明石柱）',
    ];
    setHoverInfo({
      x: cx,
      y: cy,
      depth: renderedBuffers.depthBuf[idx],
      rough: renderedBuffers.roughBuf[idx],
      overdraw: renderedBuffers.overBuf[idx],
      tag: tagNames[renderedBuffers.tagBuf[idx]] || '场景物体',
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={blendMode !== 'masked'}
          pitfallLabel={
            blendMode === 'opaque'
              ? '树丛误用 Opaque 不透明（透明空白区全变死黑方框穿帮）'
              : '树丛误用 Translucent 半透明（不进底片室乱穿 + Shader Complexity 粉白爆表）'
          }
          correctLabel="树丛使用 Masked 遮罩镂空（利落写深度进 GBuffer + 翠绿可控低耗）"
          onToggle={(pit) => {
            setBlendMode(pit ? 'translucent' : 'masked');
            setBufferMode('overdraw');
          }}
        />
      )}

      <div style={{ position: 'relative' }}>
        <canvas
          ref={mainCanvasRef}
          width={680}
          height={360}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverInfo(null)}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            borderRadius: 11,
            border: '1.5px solid var(--border-strong)',
            cursor: 'crosshair',
            background: '#141312',
          }}
        />
        {/* Live Pixel Probe Bar */}
        <div
          style={{
            marginTop: 6,
            padding: '5px 10px',
            borderRadius: 8,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-soft)',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: 8,
            fontSize: 11.5,
            fontFamily: 'var(--font-mono)',
          }}
        >
          <span>
            🔍 鼠标探针：
            <strong>{hoverInfo ? hoverInfo.tag : '移入视口查看像素底片读数'}</strong>
          </span>
          {hoverInfo && (
            <span>
              SceneDepth:{' '}
              <strong>
                {hoverInfo.depth > 100
                  ? '∞ (天空)'
                  : `${Math.round(hoverInfo.depth * 100)} cm (${hoverInfo.depth.toFixed(1)} m)`}
              </strong>{' '}
              | Roughness: <strong>{hoverInfo.rough.toFixed(2)}</strong> | 叠加层数:{' '}
              <strong style={{ color: hoverInfo.overdraw >= 8 ? '#d92d20' : '#2f7a24' }}>
                {hoverInfo.overdraw}x
              </strong>
            </span>
          )}
        </div>
      </div>

      <div className="stage-controls-panel">
        <StageSegmented<BufferViewMode>
          label="① 切换 UE 5.8 视口缓冲底片视图（暗房透视镜）"
          value={bufferMode}
          onChange={setBufferMode}
          options={[
            { value: 'lit', label: '最终彩色画面 (Lit)' },
            { value: 'depth', label: '摄像机测距底片 (SceneDepth)' },
            { value: 'normal', label: '法线底片 (World Normal)' },
            { value: 'roughness', label: '粗糙度底片 (Roughness)' },
            { value: 'overdraw', label: '着色复杂度热图 (Shader Complexity)' },
          ]}
        />

        <div className="control-grid">
          <StageSegmented<BushBlendMode>
            label="② 切换前景灌木树丛的混合模式 (Blend Mode)"
            value={blendMode}
            onChange={setBlendMode}
            options={[
              { value: 'opaque', label: 'Opaque (黑方框穿帮)' },
              { value: 'masked', label: 'Masked (一刀切镂空 ✅)' },
              { value: 'translucent', label: 'Translucent (乱穿爆红 💥)' },
            ]}
          />

          {blendMode === 'masked' ? (
            <StageSlider
              label="Opacity Mask Clip Value (一刀切裁剪阈值)"
              value={clipValue}
              min={0.08}
              max={0.85}
              step={0.01}
              formatValue={(v) => `${v.toFixed(2)} (小于此值直接丢弃)`}
              onChange={setClipValue}
            />
          ) : (
            <div
              style={{
                padding: '7px 10px',
                borderRadius: 8,
                background: blendMode === 'translucent' ? 'var(--accent-coral)' : 'var(--accent-amber)',
                color:
                  blendMode === 'translucent'
                    ? 'var(--accent-coral-deep)'
                    : 'var(--accent-amber-deep)',
                fontSize: 12,
                fontWeight: 600,
                border: '1px solid var(--border-strong)',
              }}
            >
              {blendMode === 'opaque'
                ? '💡 Opaque 完全无视透明通道，把整张长方形面片连同黑底一起画了出来！'
                : '💡 切到 SceneDepth 或 Shader Complexity 看看：半透明树叶既没写深度，又把热图烧成了粉白色！'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// LESSON 9.2 STAGE: Vertex WPO Wind Tunnel vs Pixel Stage
// ============================================================================

const Stage9_2_VertexVsPixel: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [windSpeed, setWindSpeed] = useState<number>(1.8);
  const [windAmp, setWindAmp] = useState<number>(36);
  const [showWireframe, setShowWireframe] = useState<boolean>(true);
  const [pinRoot, setPinRoot] = useState<boolean>(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevResetRef = useRef(resetSignal);
  const prevStepRef = useRef(stepIndex);

  useEffect(() => {
    if (prevStepRef.current === stepIndex) return;
    prevStepRef.current = stepIndex;
    if (stepIndex === 0) {
      setPinRoot(true);
      setShowWireframe(false);
    } else if (stepIndex === 1) {
      setPinRoot(true);
      setShowWireframe(true);
    } else if (stepIndex === 2) {
      setPinRoot(false);
      setShowWireframe(true);
    } else if (stepIndex === 3 || stepIndex === 4) {
      setPinRoot(true);
      setShowWireframe(true);
    }
  }, [stepIndex]);

  useEffect(() => {
    if (prevResetRef.current === resetSignal) return;
    prevResetRef.current = resetSignal;
    setWindSpeed(1.8);
    setWindAmp(36);
    setShowWireframe(true);
    setPinRoot(true);
  }, [resetSignal]);

  // Update KPI strip (depend ONLY on primitives)
  useEffect(() => {
    const activeDisp = windSpeed <= 0.05 ? 0 : windAmp;
    const recMaxWpo = Math.ceil(activeDisp * 1.25);
    onKpiUpdate([
      {
        label: '当前 WPO 峰值位移',
        value:
          activeDisp === 0
            ? '0 cm (风已静止)'
            : `±${activeDisp} cm · ${windSpeed.toFixed(1)}x 频速`,
        tone: activeDisp > 48 ? 'warn' : 'accent',
      },
      {
        label: '单株顶点 : 像素规模比',
        value: '16 顶点 vs 42,000 像素 (1:2625)',
        tone: 'good',
      },
      {
        label: '建议 Max WPO 位移上限',
        value:
          activeDisp === 0
            ? '0 cm (无位移)'
            : `${recMaxWpo} cm (${activeDisp > 45 ? '需调大防闪灭' : '安全'})`,
        tone: activeDisp > 45 ? 'warn' : 'good',
      },
      {
        label: '草根 (1-V) 钉死状态',
        value: pinRoot ? '✅ 草根乘 0 稳扎泥土' : '⚠️ 未钉死 · 连根滑冰!',
        tone: pinRoot ? 'good' : 'bad',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windSpeed, windAmp, showWireframe, pinRoot]);

  // 60fps Animated Wind Tunnel Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const startTime = performance.now();

    const drawBladeMesh = (
      baseX: number,
      baseY: number,
      height: number,
      baseHalfW: number,
      segments: number, // 1 => 4 vertices (2 tris); 7 => 16 vertices (14 tris)
      timeSec: number,
      phaseOffset: number,
      isHero: boolean
    ) => {
      const leftPts: { x: number; y: number; weight: number }[] = [];
      const rightPts: { x: number; y: number; weight: number }[] = [];

      for (let i = 0; i <= segments; i++) {
        const hFrac = i / segments; // 0 at root (V=1), 1 at tip (V=0)
        const maskWeight = pinRoot ? hFrac : 1.0;
        const bendFactor = pinRoot ? Math.pow(hFrac, 1.62) : 1.0;

        const wave =
          Math.sin(timeSec * windSpeed * 2.4 - (pinRoot ? hFrac * 1.25 : 0) + phaseOffset) * 0.78 +
          Math.sin(timeSec * windSpeed * 4.3 + phaseOffset * 1.7) * 0.22;

        const dx = wave * windAmp * bendFactor + (pinRoot ? windAmp * 0.22 * bendFactor : 0);
        // Natural arc-length vertical dip so flexible grass doesn't stretch unnaturally
        const arcDrop = pinRoot ? (dx * dx) / Math.max(80, height * 2.3) : 0;
        const cy = baseY - hFrac * height + arcDrop;
        const cx = baseX + dx;

        // Taper blade width toward tip
        const taper = Math.cos(hFrac * Math.PI * 0.46);
        const hw = Math.max(2.2, baseHalfW * taper);

        // Slight perpendicular normal tilt on curved blade
        const slopeAngle = pinRoot ? clamp(dx / height, -0.55, 0.55) * 0.65 : 0;
        const nx = Math.cos(slopeAngle) * hw;
        const ny = Math.sin(slopeAngle) * hw;

        leftPts.push({ x: cx - nx, y: cy - ny, weight: maskWeight });
        rightPts.push({ x: cx + nx, y: cy + ny, weight: maskWeight });
      }

      // Draw filled triangles per segment
      for (let i = 0; i < segments; i++) {
        const l0 = leftPts[i];
        const r0 = rightPts[i];
        const l1 = leftPts[i + 1];
        const r1 = rightPts[i + 1];
        const hMid = (i + 0.5) / segments;

        const rCol = Math.round(lerp(34, 118, hMid));
        const gCol = Math.round(lerp(92, 198, hMid));
        const bCol = Math.round(lerp(28, 56, hMid));
        ctx.fillStyle = isHero
          ? `rgb(${rCol}, ${gCol}, ${bCol})`
          : `rgba(${rCol - 12}, ${gCol - 28}, ${bCol - 8}, 0.55)`;

        ctx.beginPath();
        ctx.moveTo(l0.x, l0.y);
        ctx.lineTo(r0.x, r0.y);
        ctx.lineTo(r1.x, r1.y);
        ctx.lineTo(l1.x, l1.y);
        ctx.closePath();
        ctx.fill();

        // If 4-vertex cardboard (segments===1) & unmasked/masked, draw dark card outline to emphasize stiffness
        if (segments === 1 && isHero && !showWireframe) {
          ctx.strokeStyle = 'rgba(20, 42, 16, 0.65)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Triangle wireframe overlay
        if (showWireframe && isHero) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.lineWidth = 1.35;
          // Triangle 1: l0 -> r0 -> l1
          ctx.beginPath();
          ctx.moveTo(l0.x, l0.y);
          ctx.lineTo(r0.x, r0.y);
          ctx.lineTo(l1.x, l1.y);
          ctx.closePath();
          ctx.stroke();
          // Triangle 2: r0 -> r1 -> l1
          ctx.beginPath();
          ctx.moveTo(r0.x, r0.y);
          ctx.lineTo(r1.x, r1.y);
          ctx.lineTo(l1.x, l1.y);
          ctx.closePath();
          ctx.stroke();
        }
      }

      // Draw root anchor socket on the ground mound
      if (isHero) {
        ctx.strokeStyle = pinRoot ? '#4ade80' : '#f87171';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(baseX, baseY, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        if (!pinRoot) {
          // Draw red displacement arrow showing uprooted sliding!
          const curRootX = (leftPts[0].x + rightPts[0].x) * 0.5;
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(baseX, baseY + 13);
          ctx.lineTo(curRootX, baseY + 13);
          ctx.stroke();
        }
      }

      // Draw glowing vertices color-coded by (1-V) weight
      if (showWireframe && isHero) {
        for (let i = 0; i <= segments; i++) {
          for (const pt of [leftPts[i], rightPts[i]]) {
            const w = pt.weight;
            // Weight 0 (locked root) = dark slate/amber; Weight 1 (free tip) = bright lime/yellow
            ctx.fillStyle = w < 0.05 ? '#18181b' : `rgb(${Math.round(lerp(56, 250, w))}, ${Math.round(lerp(189, 224, w))}, 48)`;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 4.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }
    };

    const renderFrame = (now: number) => {
      const t = (now - startTime) * 0.001;
      const W = canvas.width;
      const H = canvas.height;

      // Sky dusk/meadow backdrop
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      if (isDark) {
        bgGrad.addColorStop(0, '#14202e');
        bgGrad.addColorStop(0.75, '#1e312b');
        bgGrad.addColorStop(1, '#1a1814');
      } else {
        bgGrad.addColorStop(0, '#dbeafe');
        bgGrad.addColorStop(0.75, '#e0f2fe');
        bgGrad.addColorStop(1, '#ecfdf5');
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Animated wind streamlines across both chambers
      if (windSpeed > 0.05 && windAmp > 1) {
        ctx.strokeStyle = isDark ? 'rgba(186, 230, 253, 0.18)' : 'rgba(14, 116, 144, 0.22)';
        ctx.lineWidth = 1.5;
        for (let s = 0; s < 9; s++) {
          const sy = 56 + s * 22;
          const travel = ((t * windSpeed * 110 + s * 97) % (W + 140)) - 70;
          const len = 36 + windAmp * 0.85;
          ctx.beginPath();
          ctx.moveTo(travel, sy);
          ctx.quadraticCurveTo(travel + len * 0.5, sy - 5 * Math.sin(t * 3 + s), travel + len, sy);
          ctx.stroke();
        }
      }

      // Center divider line
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(23,22,20,0.16)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(W / 2, 12);
      ctx.lineTo(W / 2, H - 12);
      ctx.stroke();

      // Soil mounds for Left & Right chambers
      const groundY = 262;
      for (const centerX of [W * 0.25, W * 0.75]) {
        ctx.fillStyle = isDark ? '#3b2c20' : '#785a40';
        ctx.beginPath();
        ctx.ellipse(centerX, groundY + 18, 142, 32, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = isDark ? '#291f17' : '#5c432e';
        ctx.fillRect(centerX - 155, groundY + 15, 310, 45);
      }

      // Left Chamber: 4-Vertex Cardboard Grass (segments = 1 => 4 vertices, 2 triangles)
      drawBladeMesh(W * 0.25 - 48, groundY, 132, 15, 1, t, 0.9, false);
      drawBladeMesh(W * 0.25 + 52, groundY, 122, 14, 1, t, 2.1, false);
      drawBladeMesh(W * 0.25, groundY, 168, 22, 1, t, 0, true);

      // Right Chamber: 16-Vertex Multi-Segment Grass (segments = 7 => 16 vertices, 14 triangles)
      drawBladeMesh(W * 0.75 - 48, groundY, 132, 15, 7, t, 0.9, false);
      drawBladeMesh(W * 0.75 + 52, groundY, 122, 14, 7, t, 2.1, false);
      drawBladeMesh(W * 0.75, groundY, 168, 22, 7, t, 0, true);

      // Top Chamber Headers
      const drawHeader = (x: number, title: string, sub: string, badgeBg: string) => {
        ctx.fillStyle = isDark ? 'rgba(15, 16, 18, 0.84)' : 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.roundRect(x, 12, 316, 46, 8);
        ctx.fill();
        ctx.strokeStyle = badgeBg;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.fillStyle = isDark ? '#f8fafc' : '#171614';
        ctx.font = '800 13px "Noto Sans SC", sans-serif';
        ctx.fillText(title, x + 12, 31);
        ctx.fillStyle = isDark ? '#cbd5e1' : '#475569';
        ctx.font = '600 11px "Noto Sans SC", sans-serif';
        ctx.fillText(sub, x + 12, 48);
      };

      drawHeader(
        12,
        '📦 4 顶点硬纸板草 (2 个三角形)',
        pinRoot ? '中间无横节钉子，只能像硬木板一样直挺挺斜歪' : '⚠️ 未乘 (1-V) 遮罩：整张硬纸板脱根在地上滑冰！',
        pinRoot ? '#eab308' : '#ef4444'
      );

      drawHeader(
        W / 2 + 12,
        '🌿 16 顶点多段细分柔韧草 (14 个三角形)',
        pinRoot ? '✅ 草根乘 0 钉牢泥土，8 排顶点逐节弯出柔顺风浪弧线' : '⚠️ 未乘 (1-V) 遮罩：再多顶点也会连根拔起乱滑！',
        pinRoot ? '#22c55e' : '#ef4444'
      );

      // UV V-coordinate & Mask weight legend on Right Hero Blade
      if (showWireframe) {
        ctx.fillStyle = isDark ? 'rgba(15, 18, 22, 0.82)' : 'rgba(255, 255, 255, 0.92)';
        ctx.beginPath();
        ctx.roundRect(W - 146, 72, 134, 52, 7);
        ctx.fill();
        if (!isDark) {
          ctx.strokeStyle = 'rgba(23, 22, 20, 0.14)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.fillStyle = isDark ? '#fde047' : '#b45309';
        ctx.font = '700 11px "JetBrains Mono", monospace';
        ctx.fillText('草尖 V=0 → 1-V=1.0', W - 138, 91);
        ctx.fillStyle = isDark ? '#94a3b8' : '#475569';
        ctx.fillText(pinRoot ? '草根 V=1 → 1-V=0.0' : '草根未乘0 → 权重1.0!', W - 138, 112);
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [windSpeed, windAmp, showWireframe, pinRoot, isDark]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={!pinRoot}
          pitfallLabel="忘记乘高度遮罩 (1-V)，整棵草连根拔起在地面滑冰"
          correctLabel="乘上 (1-V) 把草根位移清零钉牢，仅草尖随风柔顺摇曳"
          onToggle={(pit) => setPinRoot(!pit)}
        />
      )}

      {/* Live Vertex vs Pixel Counter Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 8,
        }}
      >
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 10,
            border: '1.5px solid var(--border-strong)',
            background: 'var(--accent-sage)',
            color: 'var(--accent-sage-deep)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 700 }}>⚡ 上半场 · World Position Offset</div>
            <div style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
              两侧中央草片共 4 + 16 = 20 个顶点
            </div>
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 800 }}>每株 2 / 14 个三角形</span>
        </div>

        <div
          style={{
            padding: '8px 12px',
            borderRadius: 10,
            border: '1.5px solid var(--border-soft)',
            background: 'var(--bg-panel)',
            color: 'var(--text-primary)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
              🎨 下半场 · 屏幕光栅化填色
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
              假设覆盖 42,000 个像素
            </div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
            覆盖随镜头和分辨率改变
          </span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={680}
        height={308}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          borderRadius: 11,
          border: '1.5px solid var(--border-strong)',
        }}
      />

      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSlider
            label="🌬️ 风速 (Wind Speed)"
            value={windSpeed}
            min={0}
            max={4.0}
            step={0.1}
            unit="x"
            onChange={setWindSpeed}
          />
          <StageSlider
            label="🌊 风力摆动幅度 (Wind Strength)"
            value={windAmp}
            min={0}
            max={65}
            step={1}
            unit=" cm"
            onChange={setWindAmp}
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <StageToggle
            label="显示顶点与三角形线框"
            checked={showWireframe}
            onChange={setShowWireframe}
            hint="看清骨架钉子数量"
          />
          <StageToggle
            label="乘上高度渐变钉死草根 (1-V 遮罩)"
            checked={pinRoot}
            onChange={setPinRoot}
            hint="取消勾选看脱根滑冰!"
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// LESSON 9.3 STAGE: Master Material vs Material Instance + 2^N Switch Tree
// ============================================================================

interface PropInstanceConfig {
  id: string;
  name: string;
  colorHex: string;
  roughness: number;
  metallic: number;
}

const SWATCH_PALETTE: { label: string; hex: string }[] = [
  { label: '绯红漆', hex: '#c83e32' },
  { label: '翡翠玉', hex: '#2a9d68' },
  { label: '深海蓝', hex: '#2c6cb8' },
  { label: '皇家金', hex: '#d9a438' },
  { label: '紫晶釉', hex: '#7c4cc9' },
  { label: '曜石铁', hex: '#47505c' },
];

const STATIC_SWITCH_NAMES = [
  'bUseDetailNormal (细节法线)',
  'bUseWorldSnow (顶部积雪)',
  'bUseVertexWind (风吹摆动)',
  'bUseEmissivePulse (呼吸发光)',
  'bUseTriplanarUV (免UV投射)',
  'bUseRainWetness (雨水打湿)',
  'bUseEdgeWear (边缘磨损)',
  'bUseParallax (视差裂纹)',
  'bUseDissolve (死亡溶解)',
  'bUseClearCoat (双层清漆)',
];

const Stage9_3_MasterInstanceWorkbench: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [tabMode, setTabMode] = useState<'instance' | 'switches'>('instance');
  const [workflowMode, setWorkflowMode] = useState<'hardcoded' | 'mi'>('hardcoded');
  const [selectedPropIdx, setSelectedPropIdx] = useState<number>(0);

  const [propsData, setPropsData] = useState<PropInstanceConfig[]>([
    { id: 'MI_Prop_Barrel', name: '① 储物酒桶 (MI_Barrel)', colorHex: '#c83e32', roughness: 0.58, metallic: 0.05 },
    { id: 'MI_Prop_Orb', name: '② 遗迹宝珠 (MI_Relic)', colorHex: '#2a9d68', roughness: 0.16, metallic: 0.0 },
    { id: 'MI_Prop_Shield', name: '③ 皇家圆盾 (MI_Shield)', colorHex: '#d9a438', roughness: 0.22, metallic: 0.92 },
  ]);

  // Hardcoded compile freeze simulation state (1.8 seconds!)
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [compileRemaining, setCompileRemaining] = useState<number>(0);
  const [compileCount, setCompileCount] = useState<number>(0);

  // Tab 2: Static Switch count (0..10)
  const [shareStaticSettings, setShareStaticSettings] = useState(false);
  const [switchCount, setSwitchCount] = useState<number>(3);

  const propsCanvasRef = useRef<HTMLCanvasElement>(null);
  const treeCanvasRef = useRef<HTMLCanvasElement>(null);
  const compileTimerRef = useRef<number | null>(null);
  const prevResetRef = useRef(resetSignal);
  const prevStepRef = useRef(stepIndex);

  useEffect(() => {
    if (prevStepRef.current === stepIndex) return;
    prevStepRef.current = stepIndex;
    if (stepIndex === 0) {
      setTabMode('instance');
      setWorkflowMode('hardcoded');
    } else if (stepIndex === 1 || stepIndex === 3) {
      setTabMode('instance');
      setWorkflowMode('mi');
    } else if (stepIndex === 2) {
      setTabMode('switches');
      setSwitchCount(3);
    } else if (stepIndex === 4) {
      setTabMode('switches');
      setSwitchCount(2);
    }
  }, [stepIndex]);

  useEffect(() => {
    if (prevResetRef.current === resetSignal) return;
    prevResetRef.current = resetSignal;
    setTabMode('instance');
    setWorkflowMode('mi');
    setSelectedPropIdx(0);
    setSwitchCount(3);
    setShareStaticSettings(false);
    setCompileCount(0);
    setIsCompiling(false);
    setPropsData([
      { id: 'MI_Prop_Barrel', name: '① 储物酒桶 (MI_Barrel)', colorHex: '#c83e32', roughness: 0.58, metallic: 0.05 },
      { id: 'MI_Prop_Orb', name: '② 遗迹宝珠 (MI_Relic)', colorHex: '#2a9d68', roughness: 0.16, metallic: 0.0 },
      { id: 'MI_Prop_Shield', name: '③ 皇家圆盾 (MI_Shield)', colorHex: '#d9a438', roughness: 0.22, metallic: 0.92 },
    ]);
  }, [resetSignal]);

  // Cleanup any active compile interval on unmount
  useEffect(() => {
    return () => {
      if (compileTimerRef.current !== null) window.clearInterval(compileTimerRef.current);
    };
  }, []);

  const activeProp = propsData[selectedPropIdx];

  // KPI Updates (primitive dependencies ONLY)
  useEffect(() => {
    const permutations = Math.pow(2, switchCount);
    if (tabMode === 'instance') {
      onKpiUpdate([
        {
          label: '当前材质工作流',
          value: workflowMode === 'mi' ? '母材质 + 材质实例 (MI)' : '直接改普通材质常量',
          tone: workflowMode === 'mi' ? 'good' : 'warn',
        },
        {
          label: '网页工作流演示',
          value: workflowMode === 'mi' ? '直接更新参数' : '1.8 秒等待动画',
          tone: workflowMode === 'mi' ? 'good' : 'bad',
        },
        {
          label: '示例编辑操作',
          value: workflowMode === 'mi' ? '复用当前静态配置' : `已触发重编 ${compileCount} 次`,
          tone: workflowMode === 'mi' ? 'accent' : 'warn',
        },
        {
          label: '布尔静态组合上限',
          value: `${permutations.toLocaleString()} 种可能`,
          tone: switchCount <= 3 ? 'good' : switchCount <= 6 ? 'warn' : 'bad',
        },
      ]);
    } else {
      // Three example instances use bit patterns 0, 0 and optionally 1.
      const usedCombinations = new Set([0, 0, switchCount > 0 && !shareStaticSettings ? 1 : 0]).size;
      onKpiUpdate([
        {
          label: '静态开关数 (N)',
          value: `${switchCount} 个开关`,
          tone: switchCount <= 3 ? 'good' : switchCount <= 6 ? 'warn' : 'bad',
        },
        {
          label: '布尔静态组合上限',
          value: `${permutations.toLocaleString()} 种可能组合`,
          tone: switchCount <= 3 ? 'good' : switchCount <= 6 ? 'warn' : 'bad',
        },
        {
          label: '三个示例实例的静态组合',
          value: `${usedCombinations} 种实际引用`,
          tone: 'accent',
        },
        {
          label: '目标平台编译统计',
          value: '在 Platform Stats 查看',
          tone: 'neutral',
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tabMode,
    workflowMode,
    compileCount,
    isCompiling,
    switchCount,
    shareStaticSettings,
    activeProp.roughness,
    activeProp.metallic,
    activeProp.colorHex,
  ]);

  // Trigger 1.8s realistic UE 5.8 Shader Compilation freeze when editing hardcoded constants!
  const applyPropPatch = (patch: Partial<PropInstanceConfig>) => {
    if (workflowMode === 'mi') {
      setPropsData((prev) =>
        prev.map((item, idx) => (idx === selectedPropIdx ? { ...item, ...patch } : item))
      );
      return;
    }

    if (isCompiling) return;
    setIsCompiling(true);
    setCompileRemaining(1420);

    const start = performance.now();
    const duration = 1800; // 1.8 seconds realistic freeze
    if (compileTimerRef.current !== null) window.clearInterval(compileTimerRef.current);

    compileTimerRef.current = window.setInterval(() => {
      const elapsed = performance.now() - start;
      const leftRatio = clamp(1 - elapsed / duration, 0, 1);
      setCompileRemaining(Math.round(1420 * leftRatio));
      if (elapsed >= duration) {
        if (compileTimerRef.current !== null) {
          window.clearInterval(compileTimerRef.current);
          compileTimerRef.current = null;
        }
        setIsCompiling(false);
        setCompileRemaining(0);
        setCompileCount((c) => c + 1);
        setPropsData((prev) =>
          prev.map((item, idx) =>
            // Hardcoded material either edits that single material or forces full recompile!
            idx === selectedPropIdx ? { ...item, ...patch } : item
          )
        );
      }
    }, 45);
  };

  // Render the 3 PBR Props in Tab 1
  useEffect(() => {
    if (tabMode !== 'instance') return;
    const canvas = propsCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 340;
    const H = 135;
    const img = new Uint8ClampedArray(W * H * 4);
    const L: Vec3 = norm3([0.48, 0.65, 0.58]);
    const V: Vec3 = [0, 0, 1];

    const centersX = [60, 170, 280];
    const centerY = 66;
    const rad = 41;

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const p4 = (py * W + px) * 4;
        // Studio backdrop + soft floor reflection
        const bgGrad = isDark ? lerp(0.11, 0.19, py / H) : lerp(0.95, 0.87, py / H);
        let r = bgGrad * 255;
        let g = (bgGrad - (isDark ? 0.005 : 0.01)) * 255;
        let b = (bgGrad + (isDark ? 0.01 : -0.02)) * 255;

        for (let i = 0; i < 3; i++) {
          const prop = propsData[i];
          const dx = (px - centersX[i]) / rad;
          const dy = (centerY - py) / rad;

          let hit = false;
          let N: Vec3 = [0, 0, 1];
          let localAlbedo = hexToLinearRgb(prop.colorHex);
          let localRough = prop.roughness;
          let localMetal = prop.metallic;

          if (i === 0) {
            // Prop 0: Barrel Cylinder with two iron/brass hoops!
            if (Math.abs(dy) < 0.88) {
              const barrelBulge = 0.76 * (1 - 0.16 * dy * dy);
              if (Math.abs(dx) <= barrelBulge) {
                hit = true;
                const nx = dx / barrelBulge;
                const nz = Math.sqrt(Math.max(0.01, 1 - nx * nx));
                const stave = Math.sin(nx * 16) * 0.08;
                const isHoop = Math.abs(Math.abs(dy) - 0.48) < 0.095;
                N = norm3([nx + stave, isHoop ? (dy > 0 ? 0.15 : -0.15) : -dy * 0.18, nz]);
                if (isHoop) {
                  localAlbedo = lerp3(localAlbedo, [0.55, 0.48, 0.36], 0.45);
                  localMetal = clamp(localMetal + 0.55, 0, 1);
                  localRough = clamp(localRough * 0.65, 0.08, 0.9);
                }
              }
            }
          } else if (i === 1) {
            // Prop 1: Carved Relic Orb with equatorial ring
            const r2 = dx * dx + dy * dy;
            if (r2 <= 1.0) {
              hit = true;
              const nz = Math.sqrt(Math.max(0.01, 1 - r2));
              const groove = Math.abs(dy) < 0.09 ? -0.25 : 0;
              N = norm3([dx, dy + groove, nz]);
            }
          } else {
            // Prop 2: Royal Beveled Shield Dome + Boss
            const r2 = dx * dx + dy * dy;
            if (r2 <= 1.02) {
              hit = true;
              const dist = Math.sqrt(r2);
              const isRim = dist > 0.82;
              const isBoss = dist < 0.28;
              const nz = isBoss
                ? Math.sqrt(Math.max(0.05, 1 - (dist / 0.28) * 0.55))
                : Math.sqrt(Math.max(0.08, 1 - r2 * 0.45));
              N = norm3([dx * (isRim ? 1.15 : 0.65), dy * (isRim ? 1.15 : 0.65), nz]);
              if (isRim) {
                localRough = clamp(localRough * 0.75, 0.06, 0.95);
              }
            }
          }

          if (hit) {
            const shaded = shadePbrPixel({
              N,
              V,
              L,
              baseColorLinear: localAlbedo,
              metallic: localMetal,
              roughness: localRough,
              lightIntensity: 2.4,
              envMode: 'studio',
            });
            r = shaded[0] * 255;
            g = shaded[1] * 255;
            b = shaded[2] * 255;
          }
        }

        img[p4] = Math.round(r);
        img[p4 + 1] = Math.round(g);
        img[p4 + 2] = Math.round(b);
        img[p4 + 3] = 255;
      }
    }

    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const octx = off.getContext('2d');
    if (octx) octx.putImageData(new ImageData(img, W, H), 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

    // Draw selection brackets and prop labels
    const dispCenters = [120, 340, 560];
    propsData.forEach((prop, idx) => {
      const cx = dispCenters[idx];
      const active = idx === selectedPropIdx;
      if (active) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2.2;
        ctx.strokeRect(cx - 92, 22, 184, 198);
      }
      ctx.fillStyle = active
        ? 'rgba(251, 191, 36, 0.95)'
        : isDark
          ? 'rgba(20, 19, 18, 0.8)'
          : 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.roundRect(cx - 84, 228, 168, 26, 6);
      ctx.fill();
      if (!active && !isDark) {
        ctx.strokeStyle = 'rgba(23, 22, 20, 0.14)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = active ? '#1c1917' : isDark ? '#e7e5e4' : '#1e293b';
      ctx.font = '700 11.5px "Noto Sans SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(prop.name, cx, 245);
    });
    ctx.textAlign = 'start';

    // Top status pill
    ctx.fillStyle = isDark ? 'rgba(15, 15, 16, 0.84)' : 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    ctx.roundRect(12, 10, 440, 26, 6);
    ctx.fill();
    if (!isDark) {
      ctx.strokeStyle = 'rgba(23, 22, 20, 0.14)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle =
      workflowMode === 'mi'
        ? isDark
          ? '#86efac'
          : '#15803d'
        : isDark
          ? '#fca5a5'
          : '#b91c1c';
    ctx.font = '700 12px "Noto Sans SC", sans-serif';
    ctx.fillText(
      workflowMode === 'mi'
        ? '⚡ 材质实例模式：点选任意道具滑块实时换装 (普通参数可复用着色器)'
        : '🐢 普通材质模式：点击道具切换目标，改常量播放 1.8 秒等待动画',
      22,
      27
    );
  }, [tabMode, propsData, selectedPropIdx, workflowMode, isDark]);

  // Render Dynamic 2^N Permutation Tree in Tab 2
  useEffect(() => {
    if (tabMode !== 'switches') return;
    const canvas = treeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = isDark ? '#151619' : '#f7f5f0';
    ctx.fillRect(0, 0, W, H);

    const permutations = Math.pow(2, switchCount);
    const usedCombinations = new Set([0, 0, switchCount > 0 && !shareStaticSettings ? 1 : 0]).size;
    const visualDepth = Math.min(switchCount, 5); // Draw exact binary nodes up to depth 5 (32 nodes), then fan burst for 6..10!
    const leftX = 68;
    const rightX = switchCount > 5 ? W - 210 : W - 155;
    const topPad = 46;
    const botPad = 24;
    const usableH = H - topPad - botPad;

    // Header summary inside canvas
    ctx.fillStyle = isDark ? 'rgba(28, 30, 36, 0.92)' : 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.roundRect(12, 8, W - 24, 28, 7);
    ctx.fill();
    if (!isDark) {
      ctx.strokeStyle = 'rgba(23, 22, 20, 0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle =
      switchCount <= 3
        ? isDark
          ? '#86efac'
          : '#15803d'
        : switchCount <= 6
          ? isDark
            ? '#fde047'
            : '#b45309'
          : isDark
            ? '#fca5a5'
            : '#b91c1c';
    ctx.font = '700 12px "JetBrains Mono", "Noto Sans SC", sans-serif';
    ctx.fillText(
      `组合上限 2^${switchCount} = ${permutations.toLocaleString()} 种  |  3 个示例实例实际使用：${usedCombinations} 种组合 ${
        shareStaticSettings ? '(已合并共享 ✅)' : '(分叉独立)'
      }`,
      22,
      26
    );

    if (switchCount === 0) {
      // Single clean line from Root to 1 Shader
      const midY = topPad + usableH / 2;
      ctx.strokeStyle = isDark ? '#4ade80' : '#16a34a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(leftX, midY);
      ctx.lineTo(W - 150, midY);
      ctx.stroke();

      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(leftX, midY, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(W - 150, midY, 9, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = isDark ? '#f8fafc' : '#1e293b';
      ctx.font = '700 12.5px "Noto Sans SC", sans-serif';
      ctx.fillText('M_Master 母材质', leftX - 42, midY + 26);
      ctx.fillText('2⁰ = 1 种开关组合 (3 个实例共享)', W - 260, midY + 26);
      return;
    }

    // Draw binary tree levels 0 .. visualDepth
    // Active path A (all False -> top branch k=0 at every level) is always used by MI_Barrel + MI_Relic.
    // Active path B (first switch True -> k=1 at lv=1 then all False, i.e. leaf index 1<<(visualDepth-1)) is used by MI_Shield when !shareStaticSettings.
    const pathBLeaf = 1 << (visualDepth - 1);
    const isEdgeOnPathA = (lv: number, k: number, isTrueBranch: boolean) => k === 0 && !isTrueBranch && lv >= 0;
    const isEdgeOnPathB = (lv: number, k: number, isTrueBranch: boolean) => {
      if (shareStaticSettings) return false;
      if (lv === 0) return k === 0 && isTrueBranch;
      return k === (1 << (lv - 1)) && !isTrueBranch;
    };

    for (let lv = 0; lv < visualDepth; lv++) {
      const count = 1 << lv;
      const x0 = lerp(leftX, rightX, lv / visualDepth);
      const x1 = lerp(leftX, rightX, (lv + 1) / visualDepth);

      for (let k = 0; k < count; k++) {
        const y0 = topPad + ((k + 0.5) / count) * usableH;
        const yFalse = topPad + ((2 * k + 0.5) / (count * 2)) * usableH;
        const yTrue = topPad + ((2 * k + 1.5) / (count * 2)) * usableH;

        // False branch (top child)
        const activeAF = isEdgeOnPathA(lv, k, false);
        const activeBF = isEdgeOnPathB(lv, k, false);
        ctx.strokeStyle = activeAF
          ? '#22c55e'
          : activeBF
            ? '#38bdf8'
            : switchCount <= 3
              ? isDark
                ? 'rgba(74, 222, 128, 0.34)'
                : 'rgba(22, 163, 74, 0.34)'
              : switchCount <= 6
                ? isDark
                  ? 'rgba(250, 204, 21, 0.36)'
                  : 'rgba(217, 119, 6, 0.36)'
                : isDark
                  ? 'rgba(248, 113, 113, 0.38)'
                  : 'rgba(220, 38, 38, 0.38)';
        ctx.lineWidth = activeAF || activeBF ? 3.2 : Math.max(1.0, 2.2 - lv * 0.3);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.bezierCurveTo((x0 + x1) * 0.5, y0, (x0 + x1) * 0.5, yFalse, x1, yFalse);
        ctx.stroke();

        // True branch (bottom child)
        const activeBT = isEdgeOnPathB(lv, k, true);
        ctx.strokeStyle = activeBT
          ? '#38bdf8'
          : switchCount <= 3
            ? isDark
              ? 'rgba(96, 165, 250, 0.32)'
              : 'rgba(37, 99, 235, 0.32)'
            : switchCount <= 6
              ? isDark
                ? 'rgba(251, 146, 60, 0.34)'
                : 'rgba(234, 88, 12, 0.34)'
              : isDark
                ? 'rgba(232, 121, 249, 0.34)'
                : 'rgba(168, 85, 247, 0.34)';
        ctx.lineWidth = activeBT ? 3.2 : Math.max(1.0, 2.2 - lv * 0.3);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.bezierCurveTo((x0 + x1) * 0.5, y0, (x0 + x1) * 0.5, yTrue, x1, yTrue);
        ctx.stroke();

        ctx.fillStyle = isDark ? '#f8fafc' : '#1e293b';
        ctx.beginPath();
        ctx.arc(x0, y0, Math.max(2.5, 5.5 - lv * 0.7), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw nodes at visualDepth
    const leafVisCount = 1 << visualDepth;
    for (let k = 0; k < leafVisCount; k++) {
      const y = topPad + ((k + 0.5) / leafVisCount) * usableH;
      const isA = k === 0;
      const isB = !shareStaticSettings && k === pathBLeaf;
      ctx.fillStyle = isA
        ? '#22c55e'
        : isB
          ? '#38bdf8'
          : switchCount <= 3
            ? isDark
              ? 'rgba(74, 222, 128, 0.45)'
              : 'rgba(22, 163, 74, 0.45)'
            : switchCount <= 6
              ? isDark
                ? 'rgba(250, 204, 21, 0.55)'
                : 'rgba(217, 119, 6, 0.55)'
              : isDark
                ? 'rgba(248, 113, 113, 0.65)'
                : 'rgba(220, 38, 38, 0.65)';
      ctx.beginPath();
      ctx.arc(rightX, y, isA || isB ? 5.2 : visualDepth >= 5 ? 2.4 : 3.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Instance path badges on the right for clear shareStaticSettings visual feedback
    const yLeafA = topPad + (0.5 / leafVisCount) * usableH;
    const yLeafB = topPad + ((pathBLeaf + 0.5) / leafVisCount) * usableH;
    const drawBranchPill = (bx: number, by: number, text: string, bg: string, border: string) => {
      ctx.font = '700 10.5px "Noto Sans SC", sans-serif';
      const w = ctx.measureText(text).width + 14;
      const clampedY = clamp(by, topPad + 12, H - 22);
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(bx, clampedY - 11, w, 22, 6);
      ctx.fill();
      ctx.strokeStyle = border;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, bx + 7, clampedY + 3.5);
    };

    if (switchCount <= 5) {
      if (shareStaticSettings) {
        drawBranchPill(
          rightX + 10,
          yLeafA,
          '✅ 3 个实例合并共享 1 路',
          'rgba(21, 128, 61, 0.92)',
          '#86efac'
        );
        drawBranchPill(
          rightX + 10,
          yLeafB,
          '○ 重复分支已归零省编',
          isDark ? 'rgba(51, 65, 85, 0.72)' : 'rgba(100, 116, 139, 0.72)',
          'rgba(148, 163, 184, 0.6)'
        );
      } else {
        drawBranchPill(
          rightX + 10,
          yLeafA,
          '🌿 组合 A：酒桶 + 宝珠',
          'rgba(21, 128, 61, 0.92)',
          '#86efac'
        );
        drawBranchPill(
          rightX + 10,
          yLeafB,
          '🛡️ 组合 B：圆盾独立分叉',
          'rgba(3, 105, 161, 0.92)',
          '#7dd3fc'
        );
      }
    }

    // If switchCount > 5 (64 .. 1,024), draw high-density fan burst to right edge!
    if (switchCount > 5) {
      const farRightX = W - 18;
      const fanLines = Math.min(permutations, 192);
      for (let f = 0; f < fanLines; f++) {
        const srcIdx = Math.floor((f / fanLines) * leafVisCount);
        const y0 = topPad + ((srcIdx + 0.5) / leafVisCount) * usableH;
        const y1 = topPad + ((f + 0.5) / fanLines) * usableH;
        ctx.strokeStyle =
          switchCount >= 8
            ? isDark
              ? 'rgba(244, 63, 94, 0.52)'
              : 'rgba(225, 29, 72, 0.45)'
            : isDark
              ? 'rgba(251, 146, 60, 0.5)'
              : 'rgba(234, 88, 12, 0.45)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(rightX, y0);
        ctx.lineTo(farRightX, y1);
        ctx.stroke();
      }

      const boxW = 188;
      const boxX = W - boxW - 12;
      const boxY = H / 2 - 26;
      ctx.fillStyle = 'rgba(153, 27, 27, 0.94)';
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, 52, 8);
      ctx.fill();
      ctx.strokeStyle = '#fca5a5';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = '800 13px "JetBrains Mono", "Noto Sans SC", sans-serif';
      ctx.fillText(`${permutations.toLocaleString()} 种可能组合!`, boxX + boxW / 2, boxY + 21);
      ctx.font = '600 10.5px "Noto Sans SC", sans-serif';
      ctx.fillStyle = '#fde68a';
      ctx.fillText(
        shareStaticSettings ? '当前 3 实例已合并为 1 种组合' : '当前 3 实例已分叉出 2 种组合',
        boxX + boxW / 2,
        boxY + 40
      );
      ctx.textAlign = 'start';
    }
  }, [tabMode, switchCount, shareStaticSettings, isDark]);

  const handlePropCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = propsCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / Math.max(1, rect.width);
    if (rx < 0.34) setSelectedPropIdx(0);
    else if (rx < 0.67) setSelectedPropIdx(1);
    else setSelectedPropIdx(2);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={switchCount >= 7}
          pitfallLabel={
            switchCount >= 7
              ? `${switchCount} 个开关，理论组合上限飙升至 ${Math.pow(2, switchCount).toLocaleString()} 种`
              : '10 个开关，最多 1,024 种组合'
          }
          correctLabel={
            switchCount < 7
              ? `${switchCount} 个开关，最多 ${Math.pow(2, switchCount).toLocaleString()} 种组合（精简可控）`
              : '2 个精简开关，最多 4 种组合'
          }
          onToggle={(pit) => {
            setTabMode('switches');
            setSwitchCount(pit ? 10 : 2);
          }}
        />
      )}

      <StageSegmented<'instance' | 'switches'>
        value={tabMode}
        onChange={setTabMode}
        options={[
          { value: 'instance', label: '⚡ 实验台一：改普通材质常量 vs 材质实例 (MI_Prop) 更新参数' },
          { value: 'switches', label: '🌳 实验台二：Static Switch (静态开关) 2^N 可能组合树' },
        ]}
      />

      {tabMode === 'instance' ? (
        <>
          <div style={{ position: 'relative' }}>
            <canvas
              ref={propsCanvasRef}
              width={680}
              height={264}
              onClick={handlePropCanvasClick}
              style={{
                width: '100%',
                height: 'auto',
                display: 'block',
                borderRadius: 11,
                border: '1.5px solid var(--border-strong)',
                cursor: 'pointer',
              }}
            />

            {/* Realistic 1.8s UE 5.8 Compiling Shaders Freeze Overlay */}
            {isCompiling && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 11,
                  background: 'rgba(15, 14, 13, 0.74)',
                  backdropFilter: 'blur(2px)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  padding: 20,
                }}
              >
                <div
                  style={{
                    background: '#262320',
                    border: '2px solid #f59e0b',
                    borderRadius: 11,
                    padding: '14px 22px',
                    minWidth: 320,
                    boxShadow: '0 8px 28px rgba(0,0,0,0.6)',
                    color: '#fef3c7',
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 14, fontFamily: 'var(--font-mono)' }}>
                    Compiling Shaders ({compileRemaining})... ·{' '}
                    {Math.round((1 - compileRemaining / 1420) * 100)}%
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.88, marginTop: 4 }}>
                    演示重编阻塞：UE 实际任务数与耗时取决于材质复杂度、平台与缓存。
                  </div>
                  <div
                    style={{
                      height: 7,
                      borderRadius: 999,
                      background: '#3f3a34',
                      marginTop: 10,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${((1420 - compileRemaining) / 1420) * 100}%`,
                        background: '#f59e0b',
                        transition: 'width 0.06s linear',
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="stage-controls-panel">
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <StageSegmented<'hardcoded' | 'mi'>
                label="选择换装工作流对比"
                value={workflowMode}
                onChange={(m) => {
                  if (compileTimerRef.current !== null) {
                    window.clearInterval(compileTimerRef.current);
                    compileTimerRef.current = null;
                  }
                  setIsCompiling(false);
                  setWorkflowMode(m);
                }}
                options={[
                  { value: 'hardcoded', label: '🐢 直接改普通材质常量 (播放编译等待动画)' },
                  { value: 'mi', label: '🚀 在材质实例 (MI_Prop) 中调参数 (复用着色器)' },
                ]}
              />

              <StageSegmented<'0' | '1' | '2'>
                label="当前编辑道具"
                value={String(selectedPropIdx) as '0' | '1' | '2'}
                onChange={(v) => setSelectedPropIdx(Number(v))}
                options={[
                  { value: '0', label: '① 酒桶' },
                  { value: '1', label: '② 宝珠' },
                  { value: '2', label: '③ 圆盾' },
                ]}
              />
            </div>

            {/* Color Swatches */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>
                {workflowMode === 'mi' ? '✓ BaseColor 参数色板 (修改实例参数):' : '点选常量颜色 (每次点都会重编译!):'}
              </span>
              {SWATCH_PALETTE.map((sw) => (
                <button
                  key={sw.hex}
                  type="button"
                  disabled={isCompiling}
                  onClick={() => applyPropPatch({ colorHex: sw.hex })}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '4px 9px',
                    borderRadius: 7,
                    border:
                      activeProp.colorHex === sw.hex
                        ? '2px solid var(--border-strong)'
                        : '1px solid var(--border-soft)',
                    background: 'var(--bg-card)',
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: isCompiling ? 'wait' : 'pointer',
                  }}
                >
                  <span
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: '50%',
                      background: sw.hex,
                      border: '1px solid rgba(0,0,0,0.35)',
                    }}
                  />
                  {sw.label}
                </button>
              ))}
            </div>

            {workflowMode === 'mi' ? (
              <div className="control-grid">
                <StageSlider
                  label="✓ ScalarParameter: Roughness (粗糙度)"
                  value={activeProp.roughness}
                  min={0.05}
                  max={0.95}
                  step={0.01}
                  onChange={(v) => applyPropPatch({ roughness: v })}
                />
                <StageSlider
                  label="✓ ScalarParameter: Metallic (金属度)"
                  value={activeProp.metallic}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => applyPropPatch({ metallic: v })}
                />
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                💡 在普通材质中连拖滑块都没法实时做——每改一个常数点保存，引擎就得把整棵节点树重新翻译成显卡机器码！切到右侧 <strong>在材质实例 (MI_Prop) 中调参数</strong> 立即解锁丝滑推子。
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <canvas
            ref={treeCanvasRef}
            width={680}
            height={264}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              borderRadius: 11,
              border: '1.5px solid var(--border-strong)',
            }}
          />

          <div className="stage-controls-panel">
            <StageSlider
              label="Static Switch Parameter (静态开关数量 N)"
              value={switchCount}
              min={0}
              max={10}
              step={1}
              formatValue={(n) => `${n} 个开关  →  2^${n} = ${Math.pow(2, n).toLocaleString()} 种可能组合`}
              onChange={setSwitchCount}
            />
            <StageToggle label="第三个实例也使用前两个实例的静态配置" checked={shareStaticSettings} onChange={setShareStaticSettings} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {STATIC_SWITCH_NAMES.map((name, idx) => {
                const enabled = idx < switchCount;
                return (
                  <span
                    key={name}
                    style={{
                      padding: '2px 7px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 600,
                      border: '1px solid var(--border-soft)',
                      background: enabled
                        ? idx >= 6
                          ? 'var(--accent-coral)'
                          : 'var(--accent-sage)'
                        : 'var(--bg-subtle)',
                      color: enabled
                        ? idx >= 6
                          ? 'var(--accent-coral-deep)'
                          : 'var(--accent-sage-deep)'
                        : 'var(--text-muted)',
                      opacity: enabled ? 1 : 0.55,
                    }}
                  >
                    {enabled ? '✓ ' : '○ '}
                    {name}
                  </span>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================================
// LESSON 9.4 STAGE: Multi-Layer Landscape Sampler Rescue & Complexity Lab
// ============================================================================

type LandscapeViewMode = 'lit' | 'complexity' | 'substrate';
type SamplerSourceMode = 'asset' | 'shared_wrap';

interface TerrainLayerInfo {
  bit: number;
  label: string;
  color: Vec3;
  rough: number;
}

const TERRAIN_LAYERS: TerrainLayerInfo[] = [
  { bit: 1 << 0, label: '🌿 草地', color: [0.11, 0.34, 0.08], rough: 0.72 },
  { bit: 1 << 1, label: '🟫 湿泥', color: [0.14, 0.09, 0.05], rough: 0.22 },
  { bit: 1 << 2, label: '🪨 碎石', color: [0.24, 0.22, 0.2], rough: 0.86 },
  { bit: 1 << 3, label: '❄️ 积雪', color: [0.78, 0.83, 0.9], rough: 0.38 },
  { bit: 1 << 4, label: '🌱 苔藓', color: [0.06, 0.24, 0.1], rough: 0.8 },
  { bit: 1 << 5, label: '🏜️ 沙地', color: [0.52, 0.41, 0.24], rough: 0.64 },
];

function countBits(mask: number): number {
  let c = 0;
  let m = mask;
  while (m > 0) {
    c += m & 1;
    m >>= 1;
  }
  return c;
}

const ENGINE_RESERVED_SAMPLERS = 3; // Lightmap / Shadows / Landscape Weightmap

const Stage9_4_LandscapeSamplerRescue: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  // Default: 5 layers enabled (3 engine-reserved + 5*3 = 18 / 16 samplers -> classic [SM5] compile error!)
  const [layerMask, setLayerMask] = useState<number>(0b011111);
  const [samplerSource, setSamplerSource] = useState<SamplerSourceMode>('asset');
  const [viewMode, setViewMode] = useState<LandscapeViewMode>('lit');
  const [multiSlabSlowPath, setMultiSlabSlowPath] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevResetRef = useRef(resetSignal);
  const prevStepRef = useRef(stepIndex);

  useEffect(() => {
    if (prevStepRef.current === stepIndex) return;
    prevStepRef.current = stepIndex;
    if (stepIndex === 0) {
      setLayerMask(0b011111); // 5 layers => 3 + 15 = 18/16 error!
      setSamplerSource('asset');
      setViewMode('lit');
      setMultiSlabSlowPath(false);
    } else if (stepIndex === 1) {
      // Preserve user's layer exploration in Step 2; only make sure we're in Lit view
      setViewMode('lit');
    } else if (stepIndex === 2) {
      // Step 3: ensure at least 5 layers so user can rescue the 18/16 compile error with Shared: Wrap
      setLayerMask((prev) => (countBits(prev) < 5 ? 0b011111 : prev));
      setViewMode('lit');
    } else if (stepIndex === 3) {
      setLayerMask(0b111111);
      setSamplerSource('shared_wrap');
      setViewMode('complexity');
      setMultiSlabSlowPath(false);
    } else if (stepIndex === 4) {
      setLayerMask(0b111111);
      setSamplerSource('shared_wrap');
      setViewMode('substrate');
      setMultiSlabSlowPath(false);
    }
  }, [stepIndex]);

  useEffect(() => {
    if (prevResetRef.current === resetSignal) return;
    prevResetRef.current = resetSignal;
    setLayerMask(prevStepRef.current === 0 ? 0b011111 : 0b111111);
    setSamplerSource(prevStepRef.current <= 2 ? 'asset' : 'shared_wrap');
    setViewMode('lit');
    setMultiSlabSlowPath(false);
  }, [resetSignal]);

  const activeLayerCount = countBits(layerMask);
  const totalTextures = activeLayerCount * 3;
  const usedSamplers =
    ENGINE_RESERVED_SAMPLERS + (samplerSource === 'shared_wrap' ? 1 : totalTextures);
  const isCompileError = usedSamplers > 16;

  // Update KPI cards (primitive dependencies ONLY)
  useEffect(() => {
    onKpiUpdate([
      {
        label: '已启用地形层数',
        value: `${activeLayerCount} 层 (${totalTextures} 张贴图)`,
        tone: 'neutral',
      },
      {
        label: '已占采样器槽位 (含引擎 3 槽)',
        value:
          samplerSource === 'shared_wrap'
            ? `${usedSamplers} / 16 (Shared: Wrap 共享 ✅)`
            : `${usedSamplers} / 16 (引擎 3 + 独立 ${totalTextures})`,
        tone: isCompileError ? 'bad' : usedSamplers >= 14 ? 'warn' : 'good',
      },
      {
        label: 'UE 5.8 编译与层板状态',
        value: isCompileError
          ? '❌ 超过 16 槽报错罢工'
          : multiSlabSlowPath
          ? '⚠️ 多层板慢道 (高耗红/品红)'
          : '✅ 单层板合并快道 (青绿低耗)',
        tone: isCompileError || multiSlabSlowPath ? 'bad' : 'good',
      },
      {
        label: '每像素纹理读取 (Lookups)',
        value: `${totalTextures} 次 (共享不减读取次数)`,
        tone: 'accent',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayerCount, totalTextures, usedSamplers, isCompileError, samplerSource, multiSlabSlowPath]);

  const toggleLayerBit = (bit: number) => {
    setLayerMask((prev) => {
      const next = prev ^ bit;
      return next === 0 ? prev : next; // keep at least 1 layer
    });
  };

  // Render 3D Rolling Landscape / WorldGrid Error / Shader Complexity / UE 5.8 Substrate View
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 340;
    const H = 172;
    const img = new Uint8ClampedArray(W * H * 4);
    const sunDir: Vec3 = norm3([0.55, 0.62, -0.56]);

    // Terrain height function h(wx, wz)
    const sampleTerrainHeight = (wx: number, wz: number): number => {
      const ridge = fbm(wx * 0.36 + 1.4, wz * 0.32 + 0.7, 4);
      const valley = Math.cos(wx * 0.65 + Math.sin(wz * 0.25)) * 0.35;
      const distBoost = smoothstep(3.5, 18.0, wz) * 1.35;
      return (ridge * 2.35 + valley * 0.65) * (0.55 + distBoost) - 1.15;
    };

    for (let py = 0; py < H; py++) {
      const ndcY = (0.5 - py / H) * 1.12;
      for (let px = 0; px < W; px++) {
        const p4 = (py * W + px) * 4;
        const ndcX = ((px / W - 0.5) * 2) * (W / H) * 0.56;

        const camY = 1.45;
        const rd: Vec3 = norm3([ndcX, ndcY - 0.22, 1.0]);
        const viewVec: Vec3 = [-rd[0], -rd[1], -rd[2]];

        // Raymarch heightfield (26 fast steps + binary refine)
        let hit = false;
        let tPrev = 2.2;
        let tHit = 2.2;
        for (let step = 0; step < 28; step++) {
          const t = 2.2 + step * 0.68 + step * step * 0.018;
          const wx = rd[0] * t;
          const wy = camY + rd[1] * t;
          const wz = rd[2] * t;
          const th = sampleTerrainHeight(wx, wz);
          if (wy <= th) {
            // Refine once
            const tMid = (tPrev + t) * 0.5;
            tHit = camY + rd[1] * tMid <= sampleTerrainHeight(rd[0] * tMid, rd[2] * tMid) ? tMid : t;
            hit = true;
            break;
          }
          tPrev = t;
        }

        if (!hit) {
          // Sky background
          if (viewMode === 'complexity' || viewMode === 'substrate') {
            img[p4] = 15;
            img[p4 + 1] = 18;
            img[p4 + 2] = 24;
          } else {
            const skyT = saturate(rd[1] * 2.5 + 0.35);
            const skyCol = lerp3([0.76, 0.84, 0.94], [0.26, 0.5, 0.84], skyT);
            img[p4] = Math.round(skyCol[0] * 255);
            img[p4 + 1] = Math.round(skyCol[1] * 255);
            img[p4 + 2] = Math.round(skyCol[2] * 255);
          }
          img[p4 + 3] = 255;
          continue;
        }

        const wx = rd[0] * tHit;
        const wz = rd[2] * tHit;
        const hCenter = sampleTerrainHeight(wx, wz);
        const eps = 0.14;
        const hRight = sampleTerrainHeight(wx + eps, wz);
        const hFwd = sampleTerrainHeight(wx, wz + eps);
        const N: Vec3 = norm3([(hCenter - hRight) / eps, 1.0, (hCenter - hFwd) / eps]);

        // In Lit view, [SM5] Exceeded 16 samplers compile failure falls back to UE Default WorldGrid Gray Checkerboard!
        // In complexity/substrate views, keep showing the heatmap/classification so slow-path cost remains clearly visible!
        if (isCompileError && viewMode === 'lit') {
          const g1 = (Math.floor(wx * 1.6) + Math.floor(wz * 1.6)) & 1;
          const subG = (Math.floor(wx * 6.4) + Math.floor(wz * 6.4)) & 1;
          const checkerVal = g1 ? (subG ? 0.42 : 0.36) : subG ? 0.22 : 0.18;
          const nDotL = Math.max(0.22, N[0] * sunDir[0] + N[1] * sunDir[1] + N[2] * sunDir[2]);
          const vGray = Math.round(saturate(checkerVal * nDotL * 1.45) * 255);
          // Subtle red warning scanline every 14 rows
          const errTint = py % 14 === 0 ? 48 : 0;
          img[p4] = Math.min(255, vGray + errTint);
          img[p4 + 1] = vGray;
          img[p4 + 2] = vGray;
          img[p4 + 3] = 255;
          continue;
        }

        // Compute natural biome weights across the 6 terrain layers
        const slope = 1.0 - N[1]; // 0 flat, >0.25 steep cliff
        const detail = valueNoise(wx * 3.1, wz * 3.1);
        const rawWeights = [
          (layerMask & (1 << 0)) ? clamp(1.1 - slope * 2.8 - smoothstep(0.65, 1.35, hCenter), 0.05, 1) : 0, // Grass
          (layerMask & (1 << 1)) ? smoothstep(-0.25, -0.78, hCenter) * 1.35 : 0, // Wet Mud (low valley)
          (layerMask & (1 << 2)) ? smoothstep(0.14, 0.36, slope) * 1.6 : 0, // Rock (steep slope)
          (layerMask & (1 << 3)) ? smoothstep(0.55, 1.15, hCenter) * (1 - slope * 0.9) * 1.8 : 0, // Snow (high peaks)
          (layerMask & (1 << 4)) ? smoothstep(0.45, 0.85, detail) * 0.85 : 0, // Moss patches
          (layerMask & (1 << 5)) ? smoothstep(-0.05, -0.45, hCenter) * (1 - detail * 0.5) * 1.15 : 0, // Sand bank
        ];

        let wSum = 0;
        let overlappingLayersHere = 0;
        for (let li = 0; li < 6; li++) {
          wSum += rawWeights[li];
          if (rawWeights[li] > 0.12) overlappingLayersHere++;
        }
        if (wSum < 1e-4) {
          const firstIdx = TERRAIN_LAYERS.findIndex((l) => (layerMask & l.bit) !== 0);
          rawWeights[Math.max(0, firstIdx)] = 1;
          wSum = 1;
          overlappingLayersHere = 1;
        }

        let blendedAlbedo: Vec3 = [0, 0, 0];
        let blendedRough = 0;
        for (let li = 0; li < 6; li++) {
          const nw = rawWeights[li] / wSum;
          if (nw > 0) {
            const texVar = 0.86 + detail * 0.28;
            blendedAlbedo[0] += TERRAIN_LAYERS[li].color[0] * texVar * nw;
            blendedAlbedo[1] += TERRAIN_LAYERS[li].color[1] * texVar * nw;
            blendedAlbedo[2] += TERRAIN_LAYERS[li].color[2] * texVar * nw;
            blendedRough += TERRAIN_LAYERS[li].rough * nw;
          }
        }

        if (viewMode === 'lit') {
          let litCol = shadePbrPixel({
            N,
            V: viewVec,
            L: sunDir,
            baseColorLinear: blendedAlbedo,
            metallic: 0.0,
            roughness: clamp(blendedRough, 0.12, 0.95),
            lightIntensity: 2.5,
            envMode: 'sunny',
          });
          const aerial = saturate((tHit - 9.5) / 18.0) * 0.36;
          litCol = lerp3(litCol, [0.68, 0.78, 0.92], aerial);
          img[p4] = Math.round(litCol[0] * 255);
          img[p4 + 1] = Math.round(litCol[1] * 255);
          img[p4 + 2] = Math.round(litCol[2] * 255);
        } else if (viewMode === 'complexity') {
          // Shader Complexity Heatmap: Fast-path blended single slab stays emerald/lime (2~4);
          // Multi-slab slow-path evaluates multiple full BSDF slabs -> explodes into red/magenta (8~11)!
          const costLevel = multiSlabSlowPath
            ? 4.2 + activeLayerCount * 0.95 + overlappingLayersHere * 0.85
            : 1.1 + activeLayerCount * 0.32 + overlappingLayersHere * 0.25;
          const [cr, cg, cb] = sampleComplexityRamp(costLevel);
          const shadeHint = 0.82 + 0.18 * N[1];
          img[p4] = Math.round(cr * shadeHint);
          img[p4 + 1] = Math.round(cg * shadeHint);
          img[p4 + 2] = Math.round(cb * shadeHint);
        } else {
          // UE 5.8 Substrate Material Classification Debug View!
          // Cyan-Green = Single Simple/Standard Slab (Fast Path)
          // Amber/Magenta = Multi-Slab Complex Path (Slow Path)
          const shadeHint = 0.75 + 0.25 * Math.max(0.2, N[0] * sunDir[0] + N[1] * sunDir[1] + N[2] * sunDir[2]);
          if (!multiSlabSlowPath) {
            img[p4] = Math.round(34 * shadeHint);
            img[p4 + 1] = Math.round(212 * shadeHint);
            img[p4 + 2] = Math.round(168 * shadeHint);
          } else {
            const isHeavyMix = overlappingLayersHere >= 2;
            img[p4] = Math.round((isHeavyMix ? 236 : 245) * shadeHint);
            img[p4 + 1] = Math.round((isHeavyMix ? 58 : 158) * shadeHint);
            img[p4 + 2] = Math.round((isHeavyMix ? 186 : 42) * shadeHint);
          }
        }
        img[p4 + 3] = 255;
      }
    }

    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const octx = off.getContext('2d');
    if (octx) octx.putImageData(new ImageData(img, W, H), 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

    // Top-left UE 5.8 Viewport & Sampler Meter Badge
    ctx.fillStyle = 'rgba(16, 16, 18, 0.86)';
    ctx.beginPath();
    ctx.roundRect(12, 10, 520, 28, 7);
    ctx.fill();
    ctx.fillStyle = isCompileError ? '#fca5a5' : '#86efac';
    ctx.font = '700 12px "JetBrains Mono", "Noto Sans SC", sans-serif';
    const modeTitle =
      viewMode === 'lit'
        ? '地形彩色成片 (Lit)'
        : viewMode === 'complexity'
        ? 'Shader Complexity (Alt+8)'
        : 'UE 5.8 Substrate 层板分类视图';
    ctx.fillText(
      `${modeTitle}  |  已占采样器槽位: ${usedSamplers} / 16 ${
        samplerSource === 'shared_wrap' ? '(Shared: Wrap 共享 ✅)' : '(引擎3+独立)'
      }`,
      22,
      28
    );

    // Classic UE [SM5] Exceeded 16 Samplers Compile Failure Banner!
    if (isCompileError && viewMode === 'lit') {
      ctx.fillStyle = 'rgba(127, 29, 29, 0.94)';
      ctx.beginPath();
      ctx.roundRect(22, 232, 636, 68, 10);
      ctx.fill();
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fef2f2';
      ctx.font = '800 13.5px "JetBrains Mono", monospace';
      ctx.fillText(
        `❌ [SM5] Error: Exceeded 16 samplers! (引擎3 + 贴图${totalTextures} = ${usedSamplers} / 16 槽位超限)`,
        38,
        256
      );
      ctx.fillStyle = '#fde68a';
      ctx.font = '600 12px "Noto Sans SC", sans-serif';
      ctx.fillText(
        '材质编译罢工退化为默认灰棋盘格！👉 请在下方把 Sampler Source 切为 Shared: Wrap 一秒恢复青山绿水！',
        38,
        282
      );
    } else if (viewMode === 'substrate' || viewMode === 'complexity') {
      ctx.fillStyle = 'rgba(18, 20, 24, 0.88)';
      ctx.beginPath();
      ctx.roundRect(22, 266, 636, 36, 8);
      ctx.fill();
      ctx.fillStyle = multiSlabSlowPath ? '#f9a8d4' : '#5eead4';
      ctx.font = '700 12px "Noto Sans SC", sans-serif';
      const errPrefix = isCompileError ? '⚠️ [采样器超16槽] ' : '';
      ctx.fillText(
        multiSlabSlowPath
          ? `${errPrefix}多层板慢道：每层独立进 Slab 再强行混合，层板合并复杂度飙升变红/品红！`
          : `${errPrefix}单层板快道：先混合 ${totalTextures} 张贴图属性，再统一送入 1 个 Substrate Slab！`,
        34,
        289
      );
    }
  }, [layerMask, samplerSource, viewMode, multiSlabSlowPath, isCompileError, activeLayerCount, totalTextures, usedSamplers]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={isCompileError || multiSlabSlowPath}
          pitfallLabel={
            isCompileError
              ? `采样器超限报错 (${usedSamplers}/16) 或多层板慢道飙红`
              : '反面教材：每层各建一个 Substrate Slab 再混合（层板复杂度飙红/品红）'
          }
          correctLabel="正确优化：Shared: Wrap (占 4/16 槽) + 先混贴图再进单个层板快道"
          onToggle={(pit) => {
            setLayerMask(0b111111);
            // Keep Shared: Wrap enabled during fast-path vs slow-path visual compare so slow-path red/magenta is never hidden!
            setSamplerSource('shared_wrap');
            setMultiSlabSlowPath(pit);
            if (viewMode === 'lit') setViewMode('substrate');
          }}
        />
      )}

      <canvas
        ref={canvasRef}
        width={680}
        height={314}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          borderRadius: 11,
          border: '1.5px solid var(--border-strong)',
          background: '#141518',
        }}
      />

      <div className="stage-controls-panel">
        {/* Layer Toggle Pills */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>
              ① 点击增减地形图层（引擎预留 3 槽 + 每层 3 张贴图；第 5 层起即 18/16 超限）：
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => setLayerMask(0b001111)}
                style={{
                  padding: '2px 8px',
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: '1px solid var(--border-strong)',
                  background: 'var(--bg-card)',
                  cursor: 'pointer',
                }}
              >
                设为 4 层 (15/16 临界)
              </button>
              <button
                type="button"
                onClick={() => setLayerMask(0b011111)}
                style={{
                  padding: '2px 8px',
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: '1px solid var(--border-strong)',
                  background: 'var(--accent-coral)',
                  color: 'var(--accent-coral-deep)',
                  cursor: 'pointer',
                }}
              >
                开 5 层 (18/16 报错!)
              </button>
              <button
                type="button"
                onClick={() => setLayerMask(0b111111)}
                style={{
                  padding: '2px 8px',
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: '1px solid var(--border-strong)',
                  background: 'var(--accent-amber)',
                  color: 'var(--accent-amber-deep)',
                  cursor: 'pointer',
                }}
              >
                全开 6 层 (18张贴图)
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TERRAIN_LAYERS.map((layer) => {
              const on = (layerMask & layer.bit) !== 0;
              return (
                <button
                  key={layer.label}
                  type="button"
                  onClick={() => toggleLayerBit(layer.bit)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 8,
                    border: on ? '1.5px solid var(--border-strong)' : '1px solid var(--border-soft)',
                    background: on ? 'var(--accent-sage)' : 'var(--bg-card)',
                    color: on ? 'var(--accent-sage-deep)' : 'var(--text-muted)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {on ? '✓ ' : '+ '}
                  {layer.label} (3张)
                </button>
              );
            })}
          </div>
        </div>

        <div className="control-grid">
          <StageSegmented<SamplerSourceMode>
            label="② Sampler Source (采样器来源 · 救场开关!)"
            value={samplerSource}
            onChange={setSamplerSource}
            options={[
              { value: 'asset', label: 'From Texture Asset (独立占用)' },
              { value: 'shared_wrap', label: 'Shared: Wrap (共享包裹 · 仅占 4/16 ✅)' },
            ]}
          />

          <StageSegmented<LandscapeViewMode>
            label="③ 材质性能与 UE 5.8 层板体检视图"
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: 'lit', label: '地形画面 (Lit)' },
              { value: 'complexity', label: 'Shader Complexity (Alt+8)' },
              { value: 'substrate', label: 'UE 5.8 Substrate 层板视图' },
            ]}
          />
        </div>

        {(viewMode === 'complexity' || viewMode === 'substrate') && (
          <StageToggle
            label="反面教材实验：每层各建一个 Substrate Slab 再混合（勾选看复杂度与层板视图变红/变品红！）"
            checked={multiSlabSlowPath}
            onChange={setMultiSlabSlowPath}
          />
        )}
      </div>
    </div>
  );
};

// ============================================================================
// SCHEMATICS FOR MODULE 09 (4 LESSONS)
// ============================================================================

const schematic9_1: SchematicDiagram = {
  title: 'UE 5.8 遮罩镂空植被 (Masked) 写入 GBuffer 底片室与深度图管线',
  caption:
    '树叶用 Masked 一刀切丢弃空白像素，保留下来的叶片完整写入 SceneDepth 与 GBuffer 各张底片，避免半透明乱穿与爆红重绘。',
  nodes: [
    {
      id: 'tex_leaf',
      title: 'Texture Sample (树叶贴图)',
      subtitle: 'RGBA 叶片颜色与轮廓',
      category: 'texture',
      x: 28,
      y: 48,
      width: 185,
      previewColor: '#2d7a31',
      outputs: [
        { id: 'rgb', label: 'RGB 叶片颜色', color: '#22c55e' },
        { id: 'a', label: 'A 黑白叶形遮罩', color: '#e5e7eb' },
      ],
    },
    {
      id: 'param_clip',
      title: 'Opacity Mask Clip Value',
      subtitle: '材质属性 · 默认 0.3333',
      category: 'param',
      x: 28,
      y: 205,
      width: 185,
      note: '材质属性，在 Details 中修改。',
    },
    {
      id: 'slab_leaf',
      title: 'Substrate Slab BSDF',
      subtitle: 'UE 5.8 物理叶片层板',
      category: 'substrate',
      x: 258,
      y: 42,
      width: 190,
      inputs: [{ id: 'albedo', label: 'Diffuse Albedo', color: '#22c55e' }],
      outputs: [{ id: 'mat', label: 'BSDF', color: '#a855f7' }],
    },
    {
      id: 'out_root',
      title: '材质主节点 (Blend: Masked)',
      subtitle: '开启遮罩镂空混合模式',
      category: 'output',
      x: 492,
      y: 68,
      width: 195,
      inputs: [
        { id: 'front', label: 'Front Material', color: '#a855f7' },
        { id: 'mask', label: 'Opacity Mask', color: '#e5e7eb' },
      ],
      outputs: [{ id: 'pass', label: 'Base Pass 输出', color: '#38bdf8' }],
    },
    {
      id: 'pipe_gbuf',
      title: 'SceneDepth + GBuffer 底片室',
      subtitle: '统一算一遍灯光 · 告别半透明爆红',
      category: 'pipeline',
      x: 492,
      y: 222,
      width: 195,
      inputs: [{ id: 'in', label: '深度/法线/粗糙度写入', color: '#38bdf8' }],
    },
  ],
  edges: [
    { fromNode: 'tex_leaf', fromPin: 'rgb', toNode: 'slab_leaf', toPin: 'albedo', color: '#22c55e' },
    { fromNode: 'slab_leaf', fromPin: 'mat', toNode: 'out_root', toPin: 'front', color: '#a855f7' },
    { fromNode: 'tex_leaf', fromPin: 'a', toNode: 'out_root', toPin: 'mask', color: '#e5e7eb' },
    { fromNode: 'out_root', fromPin: 'pass', toNode: 'pipe_gbuf', toPin: 'in', color: '#38bdf8' },
  ],
};

const schematic9_2: SchematicDiagram = {
  title: 'UE 5.8 顶点阶段风场 (World Position Offset) 与草根 (1-V) 钉牢连线图',
  caption:
    '上半场只搬动十几个骨架顶点即可让整株草柔顺摆动；切记乘上 (1 - V) 让草根偏移归零稳扎泥土。',
  nodes: [
    {
      id: 'in_wind',
      title: 'Sine(Time × 风速) × 风向量',
      subtitle: 'Sine 默认周期=1.0 · 单位 cm',
      category: 'input',
      x: 24,
      y: 36,
      width: 186,
      outputs: [{ id: 'wave', label: 'XYZ 风偏移', color: '#38bdf8' }],
    },
    {
      id: 'in_uv',
      title: 'TexCoord[0] → ComponentMask(G)',
      subtitle: '拆出纵向 V（草尖0 · 草根1）',
      category: 'input',
      x: 24,
      y: 176,
      width: 186,
      outputs: [{ id: 'v', label: '纵向 V 坐标', color: '#22c55e' }],
    },
    {
      id: 'math_inv',
      title: 'OneMinus (1 - V)',
      subtitle: '反转成草根 0 · 草尖 1（可自乘柔化）',
      category: 'math',
      x: 246,
      y: 176,
      width: 176,
      inputs: [{ id: 'in_v', label: 'Input V', color: '#22c55e' }],
      outputs: [{ id: 'grad', label: '钉根渐变遮罩', color: '#eab308' }],
    },
    {
      id: 'math_mul',
      title: 'Multiply (乘风力幅度)',
      subtitle: '对网格顶点求位移',
      category: 'math',
      x: 454,
      y: 112,
      width: 182,
      inputs: [
        { id: 'a', label: 'A 风波偏移', color: '#38bdf8' },
        { id: 'b', label: 'B 钉根遮罩 (1-V)', color: '#eab308' },
      ],
      outputs: [{ id: 'offset', label: 'XYZ 空间位移', color: '#f97316' }],
    },
    {
      id: 'slab_grass',
      title: 'Substrate Slab BSDF',
      subtitle: '草叶物理颜色与粗糙度',
      category: 'substrate',
      x: 454,
      y: 22,
      width: 182,
      outputs: [{ id: 'mat', label: 'BSDF', color: '#a855f7' }],
    },
    {
      id: 'out_wpo',
      title: '材质主节点 (Root)',
      subtitle: '顶点位移连入 WPO 专用口',
      category: 'output',
      x: 668,
      y: 66,
      width: 185,
      inputs: [
        { id: 'front', label: 'Front Material', color: '#a855f7' },
        { id: 'wpo', label: 'World Position Offset', color: '#f97316' },
      ],
    },
  ],
  edges: [
    { fromNode: 'in_uv', fromPin: 'v', toNode: 'math_inv', toPin: 'in_v', color: '#22c55e' },
    { fromNode: 'in_wind', fromPin: 'wave', toNode: 'math_mul', toPin: 'a', color: '#38bdf8' },
    { fromNode: 'math_inv', fromPin: 'grad', toNode: 'math_mul', toPin: 'b', color: '#eab308' },
    { fromNode: 'slab_grass', fromPin: 'mat', toNode: 'out_wpo', toPin: 'front', color: '#a855f7' },
    { fromNode: 'math_mul', fromPin: 'offset', toNode: 'out_wpo', toPin: 'wpo', color: '#f97316' },
  ],
};

const schematic9_3: SchematicDiagram = {
  title: '母材质模具 (M_Prop_Master) 与材质实例 (MI) 零编译工程架构',
  caption:
    '把颜色、粗糙度暴露为 Parameter 活口，1 个母材质派生百个子实例均只需改显存参数表，可复用相同静态配置的着色器。',
  nodes: [
    {
      id: 'p_col',
      title: 'VectorParameter (BaseTint)',
      subtitle: '右键 Convert to Parameter',
      category: 'param',
      x: 26,
      y: 36,
      width: 192,
      previewColor: '#c83e32',
      outputs: [{ id: 'rgb', label: '颜色参数活口', color: '#ef4444' }],
    },
    {
      id: 'p_rough',
      title: 'ScalarParameter (Roughness)',
      subtitle: '默认 0.5 · 实例滑块可覆写',
      category: 'param',
      x: 26,
      y: 162,
      width: 192,
      outputs: [{ id: 'val', label: '粗糙度参数活口', color: '#22c55e' }],
    },
    {
      id: 'sw_snow',
      title: 'StaticSwitchParameter',
      subtitle: 'bUseSnow；True 接浅灰雪色常量',
      category: 'param',
      x: 256,
      y: 36,
      width: 192,
      inputs: [{ id: 'f', label: 'False (常规分支)', color: '#ef4444' }, { id: 't', label: 'True (雪色常量)', color: '#e5e7eb' }],
      outputs: [{ id: 'res', label: '编译期分支选择', color: '#f59e0b' }],
    },
    {
      id: 'snow_color',
      title: 'Constant3Vector',
      subtitle: '示例雪色 (0.82, 0.82, 0.82)',
      category: 'param',
      x: 26, y: 265, width: 192,
      outputs: [{ id: 'c', label: 'RGB', color: '#e5e7eb' }],
    },
    {
      id: 'slab_m',
      title: 'Substrate Slab BSDF',
      subtitle: '母材质统一物理层板',
      category: 'substrate',
      x: 482,
      y: 78,
      width: 182,
      inputs: [
        { id: 'albedo', label: 'Diffuse Albedo', color: '#f59e0b' },
        { id: 'rough', label: 'Roughness', color: '#22c55e' },
      ],
      outputs: [{ id: 'mat', label: 'BSDF', color: '#a855f7' }],
    },
    {
      id: 'out_master',
      title: 'M_Prop_Master (母材质)',
      subtitle: '按平台、画质与静态配置编译',
      category: 'output',
      x: 694,
      y: 44,
      width: 186,
      inputs: [{ id: 'front', label: 'Front Material', color: '#a855f7' }],
      outputs: [{ id: 'derive', label: '右键 Create MI', color: '#38bdf8' }],
    },
    {
      id: 'pipe_mi',
      title: 'MI_Wood / MI_Jade / MI_Gold',
      subtitle: '普通参数 0ms 独立更新',
      category: 'pipeline',
      x: 694,
      y: 194,
      width: 186,
      inputs: [{ id: 'parent', label: '继承母材质机器码', color: '#38bdf8' }],
    },
  ],
  edges: [
    { fromNode: 'snow_color', fromPin: 'c', toNode: 'sw_snow', toPin: 't', color: '#e5e7eb' },
    { fromNode: 'p_col', fromPin: 'rgb', toNode: 'sw_snow', toPin: 'f', color: '#ef4444' },
    { fromNode: 'sw_snow', fromPin: 'res', toNode: 'slab_m', toPin: 'albedo', color: '#f59e0b' },
    { fromNode: 'p_rough', fromPin: 'val', toNode: 'slab_m', toPin: 'rough', color: '#22c55e' },
    { fromNode: 'slab_m', fromPin: 'mat', toNode: 'out_master', toPin: 'front', color: '#a855f7' },
    {
      fromNode: 'out_master',
      fromPin: 'derive',
      toNode: 'pipe_mi',
      toPin: 'parent',
      color: '#38bdf8',
      dashed: true,
    },
  ],
};

const schematic9_4: SchematicDiagram = {
  title: '多层地形 Shared: Wrap 突破 16 采样器上限 + 单层板合并快道',
  caption:
    '引擎预留 3 个采样器槽位；18 张平铺贴图开启 Shared: Wrap 后仅共占 1 槽（总计 4/16，上限最高支持 128 张贴图），并各自通过独立的 LandscapeLayerBlend 合并后送入单个 Substrate Slab。',
  nodes: [
    {
      id: 'shared_samp',
      title: 'Sampler Source: Shared: Wrap',
      subtitle: '共用 1 槽（引擎 3 + 共享 1 = 4/16）',
      category: 'pipeline',
      x: 20,
      y: 204,
      width: 202,
      note: '在每个平铺 Texture Sample 的 Details 面板勾选。',
    },
    {
      id: 'tex_18',
      title: '6 层地表 × 3 张贴图 (共18张)',
      subtitle: '草地 / 湿泥 / 碎石 / 雪 / 苔藓 / 沙',
      category: 'texture',
      x: 20,
      y: 44,
      width: 202,
      previewColor: '#3f7a38',
      outputs: [
        { id: 'cols', label: '6 路 Albedo 颜色', color: '#22c55e' },
        { id: 'orms', label: '6 路 Roughness 通道', color: '#eab308' },
      ],
    },
    {
      id: 'layer_blend_albedo',
      title: 'LandscapeLayerBlend (Albedo)',
      subtitle: '每个 Blend 节点输出 1 路合成颜色',
      category: 'math',
      x: 262,
      y: 28,
      width: 204,
      inputs: [{ id: 'in_c', label: '6 层 Albedo 贴图', color: '#22c55e' }],
      outputs: [{ id: 'out_c', label: '合成 Albedo', color: '#22c55e' }],
    },
    {
      id: 'layer_blend_rough',
      title: 'LandscapeLayerBlend (Roughness)',
      subtitle: '独立 Blend 节点输出 1 路粗糙度',
      category: 'math',
      x: 262,
      y: 162,
      width: 204,
      inputs: [{ id: 'in_r', label: '6 层 Roughness 通道', color: '#eab308' }],
      outputs: [{ id: 'out_r', label: '合成 Roughness', color: '#eab308' }],
    },
    {
      id: 'single_slab',
      title: '单个 Substrate Slab BSDF',
      subtitle: '先混贴图数据，再统一进 1 个 Slab',
      category: 'substrate',
      x: 504,
      y: 78,
      width: 184,
      inputs: [
        { id: 'albedo', label: 'Diffuse Albedo', color: '#22c55e' },
        { id: 'rough', label: 'Roughness', color: '#eab308' },
      ],
      outputs: [{ id: 'mat', label: 'BSDF', color: '#a855f7' }],
    },
    {
      id: 'out_terrain',
      title: 'M_Landscape (编译绿灯)',
      subtitle: '4/16 槽位 · 每像素仍读 18 次',
      category: 'output',
      x: 716,
      y: 88,
      width: 176,
      inputs: [{ id: 'front', label: 'Front Material', color: '#a855f7' }],
    },
  ],
  edges: [
    { fromNode: 'tex_18', fromPin: 'cols', toNode: 'layer_blend_albedo', toPin: 'in_c', color: '#22c55e' },
    { fromNode: 'tex_18', fromPin: 'orms', toNode: 'layer_blend_rough', toPin: 'in_r', color: '#eab308' },
    { fromNode: 'layer_blend_albedo', fromPin: 'out_c', toNode: 'single_slab', toPin: 'albedo', color: '#22c55e' },
    { fromNode: 'layer_blend_rough', fromPin: 'out_r', toNode: 'single_slab', toPin: 'rough', color: '#eab308' },
    { fromNode: 'single_slab', fromPin: 'mat', toNode: 'out_terrain', toPin: 'front', color: '#a855f7' },
  ],
};

// ============================================================================
// MODULE 09 EXPORT DEFINITION
// ============================================================================

export const module09: ModuleDefinition = {
  id: '09',
  number: '09',
  title: '渲染管线、实例化、LOD 与性能调优',
  subtitle: '深度图、GBuffer、母材质、Draw Call、GPU 实例化、LOD 与全局调优',
  lessons: [
    // ========================================================================
    // LESSON 9.1
    // ========================================================================
    {
      id: 'scenedepth-gbuffer-blendmodes',
      moduleId: '09',
      number: '9.1',
      title: '必备管线背景：摄像机的测距眼（SceneDepth）、底片室（GBuffer）与三大混合模式',
      subtitle: '推开显卡暗房看四张神秘底片，彻底搞懂为什么树叶严禁用半透明、水与雾靠什么量深浅',
      duration: '16 分钟',
      difficulty: '进阶',
      steps: [
        {
          stepNumber: 1,
          shortLabel: '树叶穿帮之谜',
          tag: 'phenomenon',
          title: '7.5 见过黑纸板穿帮了——那为什么也不能图省事用 Translucent 半透明，偏偏要选 Masked？',
          paragraphs: [
            '在第 7.5 课里，咱们已经亲眼见过：把带透明轮廓的树叶贴图直接放进默认 **`Opaque（不透明）`** 材质，每根树枝四周都会顶着一块丑陋的**死黑长方形纸板**，把后方的石柱挡得严严实实。',
            '很多同学顺理成章会想：“树叶边缘是透明的，那我图省事直接改成 **`Translucent（半透明）`** 不就好了？”——黑方框确实消失了，可凑近一看却出大事了：因为半透明物体不逐像素记录前后遮挡，引擎只能粗略按每个模型的**物体中心点（Pivot）**从远到近排队绘制，结果交叉的灌木卡片后排直接画到了前排脸上！更糟的是，摆上十几丛树帧率立刻腰斩。这背后究竟踩中了显卡渲染管线的什么机关？',
          ],
          tryItPrompt:
            '观察中央视口里的灌木丛：先看默认 Opaque 下的黑方框穿帮，再点选 ② 里的 Translucent（半透明），留意叶片前后穿插错乱的现象。',
        },
        {
          stepNumber: 2,
          shortLabel: '测距眼与底片室',
          tag: 'background',
          title: '显卡暗房里的两件法宝：测距底片（SceneDepth）与延迟底片室（GBuffer）',
          paragraphs: [
            '原来显卡每画一帧画面，都在后台干两件极聪明的事：第一件是先做深度遮挡裁决——硬件底层用高精度反向深度缓冲（Reversed-Z Depth Buffer）判断谁在前谁在后，被挡住的像素当场跳过不画；而在材质节点里，引擎贴心地把它换算成了近黑远白的真实距离底片 **`SceneDepth`**（记住：**UE5 距离单位统一是厘米 `cm`，`1 m = 100 cm`**，比如 `420 cm` 就是 `4.2 m`）。',
            '第二件是开一间**“延迟渲染底片室”（`GBuffer`）**：想象剧组给 100 个演员打 50 盏灯，显卡先把最前面不透明物体的颜色、法线、粗糙度拍成底片存进暗房，最后对着底片统一算 1 遍灯光！衔接第 8.4 课：**UE 5.8 `Substrate` 把传统固定底片室升级成了按复杂度弹性分配字节的自适应底片（Adaptive / Blendable GBuffer），但“不透明与镂空能进底片室，半透明进不去”的铁律完全不变**——因为透过玻璃窗还能看见后面的石柱，一张底片存不下两层，半透明只能被拎到最后一层层硬叠重算！',
          ],
          tryItPrompt:
            '在 ① 中依次点击「摄像机测距底片 (SceneDepth)」、「法线底片」和「粗糙度底片」，再把鼠标移到右侧玻璃窗上，观察探针读数是不是直接穿透玻璃读到了背后石柱的距离（cm）？',
          callout: {
            tone: 'tip',
            title: '认识 SceneDepth 的黄金搭档：PixelDepth（第 10 章水与雾的底层钥匙！）',
            body: '底片里的 `SceneDepth` 记录的是“背后不透明水底/地面到镜头的距离（cm）”，而 **`PixelDepth`** 记录的是“当前正在画的水面或雾片像素自己到镜头的距离（cm）”。两者一相减——**`SceneDepth - PixelDepth`** 就是水深或雾片贴地的接触距离！这就是第 10 章 `DepthFade`（深度渐变）让岸边浅水变白、雾片柔化消退的全部秘密。',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '过绘制爆红灾难',
          tag: 'experiment',
          title: '亲眼见证帧率杀手 Overdraw：为什么叠五层半透明会把热力图烧成“粉白色”？',
          paragraphs: [
            '当一丛灌木由五六张交叉的半透明面片叠在一起时，灾难就爆发了：半透明既不写测距底片，也没法提前把被遮住的后排树叶剔除，哪怕是贴图四角完全透明的空白区，显卡也得老老实实把整套光照公式从头算一遍再叠上去！同一个屏幕像素被反复重涂十几次，就是**过绘制（`Overdraw`）**。',
            '在 UE 5.8 里排查这种多层半透明叠加灾难，首选视口热图 **`Shader Complexity`（快捷键 `Alt + 8`）**（或 `Shader Complexity & Quads`）：翠绿极省、橙红吃力、一旦烧成**刺眼的粉白色**就是显卡在原地冒烟！（顺便分清：`Quad Overdraw` 视图专门用来查极细密、比像素还小的三角形在 2×2 像素块上的边角浪费，别和半透明叠层混为一谈。）',
          ],
          tryItPrompt:
            '保持在「着色复杂度热图 (Shader Complexity)」下，把树丛从 Translucent 切到 Masked（一刀切镂空），亲眼见证粉白灾难区一秒退烧变成可控翠绿！',
        },
        {
          stepNumber: 4,
          shortLabel: '三大混合模式',
          tag: 'ue5',
          title: '走进 UE 5.8：对号入座 Opaque、Masked、Translucent（外加 Additive）',
          paragraphs: [
            '摸清底片室规则后，UE 5.8 材质左下角 `Details` 面板的 **`Blend Mode（混合模式）`** 一眼就能选对：实心砖墙石头选默认 **`Opaque（不透明）`**，吃满硬件 Early-Z 跑得最快；真正的玻璃窗、轻烟薄雾才选 **`Translucent（半透明）`**；如果是能量护盾、激光束或体积光柱这类“像两束手电筒光叠加变亮”的发光体，还可以选 **`Additive（叠加发光）`**。',
            '而树叶、草丛、铁丝网这类“非实即空”的物体，必须选 **`Masked（遮罩镂空）`**！它拿 `Opacity Mask Clip Value`（默认 `0.3333`）当剪刀，低于门槛的像素直接丢弃，留下来的叶片堂堂正正写进深度和 GBuffer 底片室，绝不乱穿也避免多层半透明重绘。不过也要实事求是：**`Masked` 依然比 `Opaque` 略贵**——因为逐像素执行 `clip/discard` 会打断标准硬件 Early-Z，还会让 Nanite 植被退离最快的纯不透明光栅化路径，所以建模时仍应把叶卡边缘尽量贴着实心叶片裁紧！',
          ],
          tryItPrompt:
            '切回 Lit 并保持 Masked，拖动 Opacity Mask Clip Value 滑块观察叶片边缘黑边与镂空胖瘦的变化；在 UE 5.8 中贴图 Alpha 通道连入主节点的 Opacity Mask。',
          callout: {
            tone: 'ue58',
            title: 'UE 5.8 面板位置速记（附 Material Domain 预告）',
            body: '选中材质主节点 → 左下角 `Details` → `Material` 分类：最上方 **`Material Domain`** 默认是 `Surface`（物体表面，后续第 10 章体积雾与后期特效还会见到 `Volume`、`Post Process`）；紧挨着下方就是 **`Blend Mode`**，切为 `Masked` 后主节点上的 `Opacity Mask` 插孔会自动点亮解锁！',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '防坑黄金口诀',
          tag: 'pitfall',
          title: '实战避坑口诀：实心不透明，树叶一刀切，玻璃烟雾才用半透明！',
          paragraphs: [
            '很多外包资产拖进引擎帧率暴跌，十有八九是导出时把所有带 Alpha 通道的树叶、草丛、铁栅栏全误设成了 `Translucent`——不仅导致远近树叶按中心点排序前后乱穿，而且半透明材质**默认不参与常规 `VSM` 镂空阴影投射**，树下斑驳光影也会丢得一干二净！',
            '养成进图体检第一反应：发现帧率异常掉帧，立刻按 **`Alt + 8`**（或视口左上角 `Lit → Optimization Viewmodes → Shader Complexity` / `Shader Complexity & Quads`）扫一眼。只要看到植被烧成红粉白，马上改回 `Masked` 并收紧叶卡轮廓，帧率往往立竿见影地起死回生！',
          ],
          tryItPrompt:
            '点击舞台顶部的「看踩坑现象 / 切正确配置」一键对比条，最后重温一遍半透明爆红与遮罩翠绿的震撼反差！',
          callout: {
            tone: 'warn',
            title: '无论 Translucent 还是 Masked，别留大片空白透明边！',
            body: '做烟雾特效（`Translucent`）留大白边会白白扩大过绘制热区；做树叶卡片（`Masked`）留大白边则会让更多像素执行 `clip/discard` 并拖慢 Nanite 光栅化。多切两刀收紧网格贴合轮廓，收益远大于省那几个三角形！',
          },
        },
      ],
      takeaways: [
        '`SceneDepth` 是换算成厘米（`cm`，`1 m = 100 cm`）的不透明表面测距底片；与当前像素距离 `PixelDepth` 相减（`SceneDepth - PixelDepth`）就是第 10 章水深与软边雾的标尺',
        'UE 5.8 `Substrate` 升级为自适应 GBuffer，但“不透明/镂空进底片室、半透明进不去”的管线铁律不变',
        '树叶、草丛、铁丝网应选 `Masked`（写入深度不乱穿），但因其 `clip/discard` 会打断标准 Early-Z 并略贵于 `Opaque`，叶卡网格仍应紧贴轮廓裁剪',
        '排查多层 `Translucent` 叠层过绘制请按 `Alt + 8` 看 `Shader Complexity`（`Quad Overdraw` 专查 2×2 像素块在极小三角形上的边角浪费）',
      ],
      schematic: schematic9_1,
      StageComponent: Stage9_1_GBufferBlend,
    },

    // ========================================================================
    // LESSON 9.2
    // ========================================================================
    {
      id: 'vertex-wpo-vs-pixel',
      moduleId: '09',
      number: '9.2',
      title: '顶点阶段 vs 像素阶段 —— World Position Offset 让风吹草动与算力下移巧思',
      subtitle: '拆解显卡先搬顶点再涂像素的上下半场，手把手用 WPO 做出柔顺风吹草动与顶点算力搬家',
      duration: '14 分钟',
      difficulty: '进阶',
      steps: [
        {
          stepNumber: 1,
          shortLabel: '风吹草动魔法',
          tag: 'phenomenon',
          title: '漫山遍野十万棵随风摇摆的青草，难道要请动画师给每棵草绑骨头调动画吗？',
          paragraphs: [
            '站在开放世界游戏的山坡上，微风拂过草甸泛起层层绿浪。如果像做角色动作那样给十万棵草每棵绑一套骨骼动画，CPU 光算骨头矩阵就会当场死机！',
            '更神奇的是，有时候美术拿同一份草材质贴到两个模型上，右边的草弯得像真柳条一样柔美，左边的草却像一块硬邦邦的木牌子直挺挺斜着晃。不用骨骼，材质是怎么让静止模型自己动起来的？为什么两棵草弯腰的优雅程度差这么多？',
          ],
          tryItPrompt:
            '观察中央风洞里的左右两株小草：拉动「风力摆动幅度」和「风速」滑块，对比左边硬纸板草直挺挺斜歪与右边柔韧草优雅弯腰的区别。',
        },
        {
          stepNumber: 2,
          shortLabel: '显卡上下半场',
          tag: 'background',
          title: '显卡干活分上下半场：先搬十几个骨架钉子（顶点），再涂四万个小格子（像素）',
          paragraphs: [
            '回忆第 1 章学的网格结构，显卡画一棵草严格分**上下两个半场**：**上半场（顶点着色器 Vertex Shader）**只找模型骨架上的那十几颗钉子（顶点），决定它们这一帧挪到世界空间的哪儿；**下半场（像素着色器 Pixel Shader）**再把钉子连成的三角形光栅化成成千上万个屏幕小格子，逐一涂色算光。',
            '看看舞台中央这两株草：左侧硬纸板只有上下 4 个角点，中间没有横节钉子，再强的风也只能把它推成一块歪斜的平木板；右侧细分草片有 8 排共 16 个顶点，每一排都能弯出不同的偏移角度！更惊人的是数量级悬殊——这株草骨架只有 **16 个顶点**，贴近镜头时却可能覆盖 **42,000 个屏幕像素**（相差两千多倍！当然，最终 GPU 耗时还要结合可见面积、遮挡剔除与渲染通道在目标设备上实测）。',
          ],
          tryItPrompt:
            '勾选「显示顶点与三角形线框」，数清左右两株草的骨架钉子数；保持风场开启，看看顶部 KPI 栏里峰值位移与 16 顶点 vs 42,000 像素的巨大悬殊。',
        },
        {
          stepNumber: 3,
          shortLabel: '钉死草根实验',
          tag: 'experiment',
          title: '新手必笑翻车现场：忘了给草根乘以 0，整片草原在泥土上“连根滑冰”！',
          paragraphs: [
            '怎么让风一波波吹起来？先请出两位时间老搭档：**`Time`**（游戏运行累计秒数）连进 **`Sine`**（正弦波，在 `-1` 到 `+1` 之间平滑来回摆动——**特别留意：UE 材质里的 `Sine` 默认周期 `Period = 1.0`**，也就是每 `1` 秒完成一个完整来回，并不是中学数学里的 `2π`！）。如果直接把这股风波加到所有顶点上，从草尖到草根每一颗钉子都会同步左右平移几十厘米——整棵草当场拔根而起，在地面跳起了太空步！',
            '怎么把草根死死钉在泥土里？拿出第 2 章学的 UV 坐标，用 **`ComponentMask`** 节点（通道过滤器的真名：`TexCoord` 的 `R = U` 横向、`G = V` 纵向）只勾选 `G` 拆出纵向 `V`！建模师展草叶 UV 习惯把草尖放顶部 `V = 0`、草根放底部 `V = 1`。套一个 **`OneMinus (1 - V)`** 反转成草根 `0`、草尖 `1` 再乘以风波，草根就被彻底归零钉死！想要像舞台右侧那样底部挺拔、越靠近草尖越柔顺弯曲，再把 `(1 - V)` **自乘一次或接 `Power(2)` 平方**，弧度立刻以假乱真！',
          ],
          tryItPrompt:
            '取消勾选下方的「乘上高度渐变钉死草根 (1-V 遮罩)」，亲眼看看两株草瞬间脱根在土堆上左右滑冰的穿帮现场，再勾回来钉牢它！',
        },
        {
          stepNumber: 4,
          shortLabel: 'WPO 与算力下移',
          tag: 'ue5',
          title: '走进 UE 5.8：World Position Offset 与“算力搬家神器” VertexInterpolator',
          paragraphs: [
            '在 UE 5.8 材质主节点上，专门在上半场搬动骨架顶点的插孔就叫 **`World Position Offset`（世界位置偏移，简称 `WPO`）**，传进去一个单位为厘米（`cm`）的三维向量 `(ΔX, ΔY, ΔZ)`，就能零骨骼成本驱动漫山草浪、旗帜飘扬、水面起伏甚至心跳鼓动！',
            '既然上半场只算 **16 个顶点**、下半场要苦哈哈算 **42,000 个像素**，一个绝妙的省电思路就诞生了——**`VertexInterpolator`（顶点插值器，“算力搬家神器”）**！凡是随空间**变化平缓、低频柔和**的计算（比如 UV 匀速滚动、远近淡出渐变、基础底色过渡），只要在连线中途插一个 `VertexInterpolator`，就能把它从像素阶段“搬家”到顶点阶段：显卡只需在 16 个顶点上算 16 遍，中间 4 万多个像素直接由硬件**免费线性插值（平滑过渡）**出来，视觉几乎无差，像素着色器却瞬间轻松一大截！',
          ],
          tryItPrompt:
            '点击右上角切换到「原理连线图」视图，顺着 `TexCoord → ComponentMask(G) → OneMinus → Multiply → World Position Offset` 理清整条风场链路。',
          callout: {
            tone: 'warn',
            title: 'VertexInterpolator 使用边界：只搬“平滑运算”，别搬剧烈弯曲的公式！',
            body: '硬件在三角形内部做的是**直线线性插值**。如果你把 `V²`（平方）或高频正弦波这类弯曲剧烈的公式搬进 `VertexInterpolator`，在只有 4 个顶点的粗面片上，中点 `V = 0.5` 会被硬生生从端点 `0` 和 `1` 插成 `0.5`，而不是精确的 `0.25`！遇到高曲率运算请增加网格细分，或乖乖留在像素阶段，并在目标平台实测 GPU 耗时。',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '防坑黄金口诀',
          tag: 'pitfall',
          title: '实战避坑口诀：弯曲看细分，根部必钉零，大幅变形别忘修法线与防闪灭！',
          paragraphs: [
            '实战排查风场怪象按两步走：弯得生硬先切线框看有没有足够的横节细分；底座漂移先查进 `WPO` 前有没有乘上 `(1 - V)` 或 **`Vertex Color`（顶点色——在建模软件里直接刷在模型每个顶点上的 RGBA 颜色通道，美术最常用它把草根刷黑=0、草尖刷白=1 来当万能防脱根遮罩）**。',
            '还有两大老手必知暗坑：① **法线不会跟着自动转！** `WPO` 只改了顶点坐标，并不会自动重新计算表面法线（Normal）——轻轻摇曳的小草人眼看不出来，但如果你用 WPO 做剧烈弯折、翻卷旗帜或波涛海浪，受光会明显发假，必须用 `FixRotateAboutAxisNormals` 或在数学公式里同步推导新法线！② **大幅偏移易被误裁闪灭！** 引擎判断物体“有没有走出镜头外”默认只看原包围盒，在 UE 5.8 中请优先在材质 `Details` 设置 **`Max World Position Offset Displacement`（单位 cm）** 来安全外扩边界（组件上的 `Bounds Scale` 仅作兜底备选）！',
          ],
          tryItPrompt:
            '用顶部的「看踩坑现象 / 切正确配置」一键切换，再试着把「风力摆动幅度」拉到 55 cm 以上，观察顶部 KPI 里的「建议 Max WPO 位移上限」如何亮起防闪灭提醒！',
          callout: {
            tone: 'ue58',
            title: 'UE 5.8 远景风场与 VSM 阴影省电开关',
            body: '在静态网格体或植被组件上设置 **`World Position Offset Disable Distance`**（单位 `cm`，例如 `3000` cm = 30 米），让远处看不清摆动细节的草丛自动停摆，不仅省顶点算力，更能让 UE 5.8 的 **VSM（虚拟阴影贴图）**安心复用静态阴影缓存页，大幅降低大世界阴影开销！',
          },
        },
      ],
      takeaways: [
        '显卡渲染分顶点（上半场）与像素（下半场）：一株草常只有十几个顶点却覆盖数万像素，用 `VertexInterpolator` 把变化平缓的低频计算搬到顶点阶段可省去海量重复像素计算（高曲率公式在粗网格上线性插值会有误差，需按需取舍）',
        '`World Position Offset (WPO)` 驱动顶点位移；UE 材质的 `Sine` 默认周期 `Period = 1.0`（非 `2π`），且网格必须有足够细分才能弯出柔顺弧度',
        '用 `ComponentMask (G)` 取纵向 `V` 配合 `OneMinus (1 - V)`（可平方柔化）或 `Vertex Color`（顶点色）把根部偏移清为 `0`，防止连根滑行',
        'WPO 不会自动重算法线（大变形需手动修正法线）；防边缘闪灭在 UE 5.8 优先设置材质的 `Max World Position Offset Displacement`（cm），并配合 `WPO Disable Distance` 助力 VSM 缓存复用',
      ],
      schematic: schematic9_2,
      StageComponent: Stage9_2_VertexVsPixel,
    },

    // ========================================================================
    // LESSON 9.3
    // ========================================================================
    {
      id: 'master-material-instances',
      moduleId: '09',
      number: '9.3',
      title: '母材质模具与材质实例（MI） —— 告别“改个颜色等编译十分钟”与静态开关变体控制',
      subtitle: '像做菜一样理解母材质、零重编材质实例（MI）与静态开关变体控制',
      duration: '15 分钟',
      difficulty: '进阶',
      steps: [
        {
          stepNumber: 1,
          shortLabel: '改色等编译之痛',
          tag: 'phenomenon',
          title: '为什么我只是把红色改成了绿色，UE 右下角就要转半天圈提示 Compiling Shaders？',
          paragraphs: [
            '几乎所有初学 UE 的同学都被这件事折磨过：场景里有木桶、石雕、铜盾五十个道具，如果给每个道具建一个独立材质球，哪怕只是进去把粗糙度从 `0.5` 改成 `0.6` 点一下保存，编辑器右下角立刻弹出 `Compiling Shaders (1,420)...`，风扇狂转干等十几秒！',
            '更崩溃的是，大型商业游戏动辄有上万种不同颜色质感的物件——难道大厂美术每天上班八小时，有七个小时都在盯着编译读条发呆吗？他们是怎么做到拉滑块一秒换装毫不卡顿的？',
          ],
          tryItPrompt:
            '在实验台一先停在「直接改普通材质常量」，点选颜色色板体会一下被 Compiling Shaders 进度条卡住的痛苦，再切到右侧「在材质实例 (MI_Prop) 中调参数」感受丝滑瞬改！（网页固定模拟 1.8 秒等待，真实编译时长取决于材质复杂度、平台与缓存）',
        },
        {
          stepNumber: 2,
          shortLabel: '菜谱与配料碗',
          tag: 'background',
          title: '底层揭秘：重印整本外文菜谱（母材质编译）vs 只换碗里的调料（材质实例 MI）',
          paragraphs: [
            '原因一听就透：咱们在编辑器里连的节点图是给人看的中文菜谱，显卡一个字也不认识；每次你直接改普通节点里的固定数字点保存，就等于改了菜谱正文，引擎必须请编译器翻译官把整本菜谱重新全文翻译印刷成显卡底层机器码！',
            '商业项目的解法优雅得多——把固定数值做成**参数活口（`Scalar / Vector / Texture Parameter`）**，编译出一份通用**母材质模具（`Master Material`）**！它就像一张把“放多少盐、用什么酱油”留成空白填空的精装菜谱，编译好的显卡机器码从此纹丝不动；而派生的成百上千个**材质实例（`Material Instance`，简称 `MI`）**，只是极轻量的参数清单，你拉滑块换颜色、换粗糙度甚至换贴图时，引擎只需把新数字填进显存里那张小小的参数表——**显卡代码一字未改，当然 `0ms` 瞬间生效、零着色器重编译！**',
          ],
          tryItPrompt:
            '在实验台一保持「材质实例 (MI_Prop)」模式，依次点选 ① 酒桶、② 宝珠、③ 圆盾，随心所欲狂拖粗糙度、金属度滑块和色板，感受同一套母材质零等待变出木、玉、金三种质感！',
        },
        {
          stepNumber: 3,
          shortLabel: '静态开关双刃剑',
          tag: 'experiment',
          title: '编译期大剪刀的双刃剑：为什么滥用 10 个 Static Switch 会让变体上限飙到 1,024？',
          paragraphs: [
            '既然母材质这么神，很多同学会忍不住动起“做一套全能宇宙超级母材质”的念头：把积雪、风摆、溶解、清漆、视差十种功能全塞进去，再配 10 个 **`Static Switch Parameter`（静态开关）**，谁不用就关掉！',
            '先看清它的本质：**`Static Switch` 是一把“编译期大剪刀”**——它在编译阶段就把 `False` 那一侧没用到的节点直接咔嚓剪掉，所以最终跑在显卡上的着色器更精简更快；但天下没有免费午餐：**项目里实例实际用到的每一种开关组合，都必须单独编译出一份独立的着色器变体（Permutation）**！如果有 $N$ 个独立布尔开关，理论组合上限就会按 $2^N$ 指数爆炸（`10` 个开关就是最多 `1,024` 种组合），再乘以不同**平台、画质档位与渲染路径**，编译时间和包体会轻松失控！而且特别注意：**在 `MI` 里修改普通参数不重编译，但只要你在 `MI` 里拨动了 `Static Switch` 或勾选了 `Material Property Overrides`（如覆写混合模式 `Blend Mode`、双面 `Two Sided`），一样会立刻触发新变体编译！**',
          ],
          tryItPrompt:
            '把实验台二的开关数滑到 10，观察组合上限如何从 8 暴涨到 1,024；再反复勾选/取消勾选「第三个实例也使用前两个实例的静态配置」，观察画布上分叉路径如何从 2 条合并为 1 条！',
        },
        {
          stepNumber: 4,
          shortLabel: '工业命名与规范',
          tag: 'ue5',
          title: '走进 UE 5.8：3 秒建好母子材质流与工业界命名前缀规范',
          paragraphs: [
            '在 UE 5.8 里落地这套架构只需三步：① 在母材质里右键任意颜色、常数或贴图节点，点 **`Convert to Parameter`（转换为参数）** 并设置清晰的 `Group` 分组名让实例面板井井有条（小提示：**`Constant2Vector` 不能直接右键转换为参数**，需要二维参数时请改用 `VectorParameter` 取 `RG`，或用两个 `ScalarParameter` 接 `AppendVector` 拼装）；② 保存母材质后，在内容浏览器右键它选 **`Create Material Instance`（创建材质实例）**；③ 把实例拖给场景模型！',
            '顺手养成工业界铁打的命名前缀规范：母材质标 **`M_`**（如 `M_Prop_Master`），材质实例标 **`MI_`**（如 `MI_Barrel_Wood`），通用材质函数标 **`MF_`**（`Material Function`，把常用节点网络打包复用的子积木，类似编程里的封装函数）——团队打开文件夹一眼就能分清谁是模具、谁是积木、谁是成品。',
          ],
          tryItPrompt:
            '实战练手：复用第 2.4 课的 `M_FirstSurface`，右键 Create Material Instance 命名 `MI_FirstSurface`，在实例中勾选覆盖 `Tint` 改色并赋给第二个网格对比秒改体验；后续第 11 章综合练习中，我们也会用同样流程建立 `M_Panel` / `MI_Panel` 并单独覆写 `RoughnessScale`！',
          callout: {
            tone: 'tip',
            title: '快捷键一秒出参数节点',
            body: '在 UE 5.8 画布空白处按住 **`S` + 左键** 直接生成标量参数（`ScalarParameter`），按住 **`V` + 左键** 直接生成四维颜色参数（`VectorParameter`），比先建常量再右键转换快一倍！',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '防坑黄金口诀',
          tag: 'pitfall',
          title: '实战避坑口诀：小改用参数，大类拆母材，重分支才上静态开关！',
          paragraphs: [
            '别追求把全游戏所有效果塞进一个“万能超级母材质”——按大类拆成 3~5 个清爽母材质（如硬表面道具、植被、布料、特效），每个只保留真正必要的 2~3 个静态开关，既好维护又绝不会炸出上千变体。',
            '那什么时候用 `Static Switch`、什么时候用普通 `Scalar` 参数调权重？记一条金标准：**只有当某条分支包含昂贵的额外贴图采样或重型计算时，才用 `Static Switch` 在编译期彻底剪掉**；如果只是轻量的颜色混合或强度调节，用普通 `Scalar` 参数即可 0ms 随心调（同时记住：乘 0 仍会执行输入分支，所以重分支才值得上开关）。',
          ],
          tryItPrompt:
            '点击顶部「看踩坑现象 / 切正确配置」一键对比 10 个静态开关（最多 1,024 种组合）与 2 个精简开关（最多 4 种组合）的树状反差；在 UE 5.8 实战里想核对实际编译变体数，请打开材质编辑器顶部工具栏的 `Platform Stats`（下一课 9.4 详解）。',
          callout: {
            tone: 'ue58',
            title: '一表分清材质实例三兄弟：MI、MID 与 MPC',
            body: '① **`MI`（Material Instance，静态材质实例）**：在编辑器里离线建好、批量给资产换装，游戏运行中不能改值；② **`MID`（Dynamic Material Instance，动态材质实例）**：在蓝图/C++ 中运行时动态创建，适合主角/少量关键物体受击闪红、技能充能（注意：严禁给成百上千同类小物件循环批量建 `MID`，否则会打断合批——批量差异化改参请见 **9.6 课** 的 `Custom Primitive Data` 与 `PerInstanceCustomData`！）；③ **`MPC`（Material Parameter Collection，材质参数集）**：全关卡共享的全局调色板，改一次风速、积雪量或昼夜色温，场景里上百个材质瞬间同步联动！',
          },
        },
      ],
      takeaways: [
        '直接修改普通材质常量会重编整份着色器机器码；项目实战应统一用「母材质（`M_`）+ 材质实例（`MI_`）」，改普通参数只更新显存参数表，0ms 生效零重编',
        '`Static Switch` 是编译期剪刀，能剪掉无用分支提速，但在 `MI` 中切换它（或覆写 `Blend Mode` 等材质属性）会触发重编译并生成新变体',
        '$N$ 个独立静态开关的理论上限为 $2^N$（10 个即 1,024 种），实际编译量取决于实例用到了多少种唯一组合以及目标平台、画质档位与渲染路径',
        '牢记三兄弟分工：`MI` 离线静态换装、`MID` 蓝图运行时单物改参、`MPC` 全局一改全关卡联动；`MF_` 为可复用材质函数',
      ],
      schematic: schematic9_3,
      StageComponent: Stage9_3_MasterInstanceWorkbench,
    },

    // ========================================================================
    // LESSON 9.4
    // ========================================================================
    {
      id: 'shader-complexity-shared-wrap',
      moduleId: '09',
      number: '9.4',
      title: '材质体检与救场神技 —— 复杂度热力图、Substrate 视图与 Shared: Wrap 突破采样器上限',
      subtitle: '读懂绿红粉白体检图与 UE 5.8 层板快慢道，一键拯救多层地形“[SM5] 超过 16 采样器”报错罢工',
      duration: '16 分钟',
      difficulty: '实战',
      steps: [
        {
          stepNumber: 1,
          shortLabel: '地形灰格罢工',
          tag: 'phenomenon',
          title: '满怀欢喜给大山画上第 5 层苔藓，为什么整座青山突然变成灰白棋盘格报错罢工了？',
          paragraphs: [
            '做开放世界地形（`Landscape`）时，几乎人人都会在深夜撞上这盆冷水：前四层草地、湿泥、碎石、积雪（每层含颜色、法线、ORM 共 3 张贴图，4 层共 12 张）画得好好的，刚兴冲冲加上第 5 层苔藓，整座大山咔嚓一下全变成了灰白相间的默认棋盘格！',
            '低头一看日志栏，赫然飘着一行鲜红英文报错：**`[SM5] Error: Exceeded 16 samplers`**！明明电脑显卡有十几个 G 的大显存，连 16 张贴图都还没堆满，凭什么加到第 5 层就不让画了？',
          ],
          tryItPrompt:
            '看中央视口里正处于 5 层（引擎 3 + 贴图 15 = `18 / 16`）报错灰棋盘格状态的大山：先点一下「设为 4 层 (15/16 临界)」，看大山是不是立刻恢复正常了？再点回「开 5 层 (18/16 报错!)」复现故障！',
        },
        {
          stepNumber: 2,
          shortLabel: '16名查字典专员',
          tag: 'background',
          title: '破案：16 个硬件采样器窗口里，引擎自己先占了 3 个——而且“窗口数”≠“读图次数”！',
          paragraphs: [
            '回想第 5 章学的纹理采样：贴图是字典，而决定“越界是包裹循环 `Wrap` 还是夹紧边缘 `Clamp`、滤波用平滑还是硬边”的那套规矩，由显卡硬件里的**采样器（`Sampler`）**负责执行——你可以把它想象成坐在窗口里的**查字典专员**。在经典着色器模型 **`SM5`（Shader Model 5）** 规范下，单个材质最多只有 **16 个** 硬件采样器窗口，而且引擎自己还得先预留约 **3 个窗口**（用来给光照贴图 Lightmap、阴影和地形权重图干活），真正留给你的只剩 **13 个空位**！',
            '默认状态下每张贴图独占 1 位专员：4 层（`3 + 12 = 15 / 16`）刚好卡线过关；一加第 5 层（`3 + 15 = 18 / 16`）立刻爆表罢工！顺便科普一下 **`SM5 / SM6`**：它们代表 DirectX 着色器模型代际，**UE 5.8 桌面端默认已升级为 `SM6`**（放宽了部分桌面端限制），但保持干净的采样器预算、开启共享采样器依然是跨平台安全与兼容 SM5/移动端的必守铁律！此外务必分清两个指标：**`Texture Samplers`** 是“占了几个查表窗口”，而 **`Texture Lookups`** 是“每个像素实际翻了几次贴图”！',
          ],
          tryItPrompt:
            '在 ① 中交替点击「设为 4 层 (15/16 临界)」和「开 5 层 (18/16 报错!)」，对照顶部 KPI 卡片看清「已占采样器槽位 (Samplers)」与「每像素纹理读取 (Lookups)」的本质区别！',
        },
        {
          stepNumber: 3,
          shortLabel: '一秒救活地形',
          tag: 'experiment',
          title: '救场神技实操：切为 Shared: Wrap，把 18 张平铺贴图合并进同 1 个共享采样器！',
          paragraphs: [
            '既然地形的草地、泥土、碎石、积雪、苔藓、沙地全都是无缝平铺图、用的全是同一套 `Wrap` 循环包裹与平滑滤波规则，为什么非要请 18 位专员各管一本字典？只要选中所有地形 `Texture Sample` 节点，在左下角 `Details` 里把 **`Sampler Source`** 从默认的 `From Texture Asset` 改成 **`Shared: Wrap`（共享包裹）**，18 张贴图瞬间合用 **1 个**共享采样器窗口（加上引擎自留的 3 个，总共只占 **`4 / 16`**）！',
            '开启 `Shared: Wrap` / `Shared: Clamp` 后，在 SM5/SM6 桌面平台上单个材质最高可突破 16 张贴图魔咒、支持多达 **128 张贴图**（注意是 128 上限，并非无限；且每像素实际 `Texture Lookups` 读图次数依然是 18 次，只是突破了采样器窗口上限！）。',
          ],
          tryItPrompt:
            '现在点击 ② 中的「Shared: Wrap (共享包裹 · 仅占 4/16 ✅)」，看着报错横幅瞬间消失并重现青山绿水，再大胆点一下「全开 6 层 (18张贴图)」享受 6 层锦绣山河！',
          callout: {
            tone: 'warn',
            title: '何时千万别用 Shared: Wrap？（回想第 5 章贴图规则！）',
            body: '共享采样器会**强行覆盖**贴图资产原本的滤波和寻址设置！① 做像素画风格贴图（需要第 5 章讲的 **`Nearest` 最近邻硬边过滤**）千万别开 `Shared: Wrap`，否则像素格子会被强行平滑变糊；② 边缘不能重复平铺的**贴花（Decal）**、UI 图标或色阶图，用 `Shared: Wrap` 会导致边缘鬼影漏色，应改选 **`Shared: Clamp`** 或保留 `From Texture Asset`！',
          },
        },
        {
          stepNumber: 4,
          shortLabel: 'UE 5.8 双重体检',
          tag: 'ue5',
          title: '走进 UE 5.8：用 Shader Complexity（Alt+8）与 Substrate 层板视图做全身体检',
          paragraphs: [
            '编译绿灯只是第一步，上线前一定要给材质做两次全身体检！第一项是按 **`Alt + 8`**（菜单路径 `Lit → Optimization Viewmodes → Shader Complexity`）看指令复杂度热力图，记住这条经典色阶：**深绿 / 翠绿（极省）→ 浅绿 / 黄（正常）→ 红（偏贵）→ 粉红 / 白（严重爆表）**，一旦发现大片发红发白就得赶紧给节点瘦身。',
            '第二项是 UE 5.8 专属体检视图：**`Lit → Substrate → Material Classification`（层板分类视图）**！它能一眼照出哪些像素走在清爽的**单层板快道（Simple / Single-Slab Fast Path）**，哪些被拖进了昂贵的**多层板慢道（Complex Multi-Slab Slow Path）**。做多层地形或污渍混合时，记住黄金法则：**先用 `LandscapeLayerBlend` 或 `Lerp` 把各层的颜色、法线、粗糙度在贴图数据阶段混成一套，最后统一送进 1 个 `Substrate Slab BSDF`**——千万别每层各建一个 `Slab` 再强行混合，否则复杂度和层板视图立刻双双飙红变品红！',
          ],
          tryItPrompt:
            '在 ③ 中分别切换「Shader Complexity (Alt+8)」和「UE 5.8 Substrate 层板视图」，反复勾选/取消勾选底部的「反面教材实验（多层板慢道）」，直观对比单层板快道青绿与多层板慢道飙红/品红的惊人反差！',
          callout: {
            tone: 'ue58',
            title: '精准量化体检双神器：Platform Stats 与 ProfileGPU',
            body: '① **看编译体检单**：点击材质编辑器顶部工具栏的 **`Platform Stats`** 按钮（或在左下角 `Stats` 面板），勾选目标平台后重点核对 **`Texture Samplers`**（占用几个查表窗口）与 **`Texture Lookups`**（每像素实际读图次数）；② **看真实帧耗时**：在视口按 **`Ctrl + Shift + ,`** 运行 **`ProfileGPU`**，抓拍当前镜头 Base Pass 的真实毫秒开销！',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '防坑黄金口诀',
          tag: 'pitfall',
          title: '实战避坑口诀：平铺多图开共享包裹，层板先混贴图再封箱！',
          paragraphs: [
            '总结多层材质与大地形优化铁律：① 所有无缝平铺贴图养成随手设为 `Shared: Wrap` 的肌肉记忆（特殊 `Nearest` 像素画或 `Clamp` 贴花除外），把 16 个硬件采样器窗口省得干干净净；② 在 UE 5.8 `Substrate` 中，只要地表各层共用同一套基础物理响应，就先混完颜色/法线/粗糙度再进单个 `Substrate Slab`，只有真正需要物理分层（如车漆清漆、冰雪覆膜）时才使用多层混合！',
            '恭喜你！至此你已经彻底掌握了单个材质的体检与救场神技。但真实大场景卡顿时，真凶常常藏在单个材质之外——比如数千张派工单堵死 CPU、批量改色破坏合批，或远景高模烧白 Quad Overdraw。接下来 **9.5 ~ 9.8 四节重磅工程课**，我们将从单个材质球跃升到全关卡视角，一举打通 **`Draw Call`、`GPU 实例化`、`LOD / HLOD` 与 `stat unit / ProfileGPU` 性能调优闭环**！',
          ],
          tryItPrompt:
            '点击顶部「看踩坑现象 / 切正确配置」一键对比单层板快道（青绿）与多层板慢道（品红/红），再切换右上角「原理连线图」记住双 `LandscapeLayerBlend` 汇入单 `Substrate Slab` 的标准画法！',
        },
      ],
      takeaways: [
        'SM5 下硬件限制 16 个采样器槽位（引擎自身需预留约 3 槽），默认每张图占 1 槽会导致 5 层地形（18/16）编译报错；UE 5.8 桌面虽默认 SM6，开启共享采样器仍是跨平台与预算管理的必修课',
        '将无缝平铺贴图的 `Sampler Source` 设为 `Shared: Wrap` 可共用 1 槽并解锁最高 **128 张贴图**上限（但每像素 `Texture Lookups` 读取次数不变；像素画 `Nearest` 与贴花 `Clamp` 切勿误用 `Shared: Wrap`）',
        '体检材质善用 **`Alt + 8`（`Shader Complexity`）**（深绿极省 → 浅绿/黄正常 → 红偏贵 → 粉/白爆表）、材质编辑器 **`Platform Stats`** 与 **`ProfileGPU`（`Ctrl + Shift + ,`）**',
        '用 **`Lit → Substrate → Material Classification`** 检视 UE 5.8 层板路径：多层地形应先用各自独立的 `LandscapeLayerBlend` 混完贴图属性，再统一送入单个 `Substrate Slab BSDF`（`BSDF` → `Front Material`）稳走快道',
      ],
      schematic: schematic9_4,
      StageComponent: Stage9_4_LandscapeSamplerRescue,
    },
    ...module09PerfLessons,
  ],
};
