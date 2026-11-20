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

// ============================================================================
// Shared Heatmaps & Procedural Helpers
// ============================================================================

/** UE 5.8 Quad Overdraw / Shader Complexity ramp: Emerald Green -> Red -> Pink/White */
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
    setBlendMode('masked');
    setClipValue(0.33);
  }, [resetSignal]);

  // Update KPI strip (depend ONLY on primitive states!)
  useEffect(() => {
    const modeLabelMap: Record<BufferViewMode, string> = {
      lit: '最终成片 (Lit)',
      depth: '测距底片 (SceneDepth)',
      normal: '法线底片 (Normal)',
      roughness: '粗糙度底片 (Roughness)',
      overdraw: '过绘制 (Quad Overdraw)',
    };
    const layerCost = blendMode === 'translucent' ? '多层混合' : blendMode === 'masked' ? '保留片段写深度' : '整张卡片写深度';
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
        label: '热图表示的处理方式',
        value: layerCost,
        tone: blendMode === 'translucent' ? 'bad' : 'good',
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
      depth: '📡 视口模式：摄像机测距雷达图 (SceneDepth · 近黑远白)',
      normal: '🧭 视口模式：GBuffer 法线底片 (World Normal)',
      roughness: '🪞 视口模式：GBuffer 粗糙度底片 (Roughness · 黑滑白糙)',
      overdraw: '🔥 教学热图 · 片元覆盖与混合累加示意',
    };
    ctx.fillStyle = 'rgba(18, 16, 15, 0.82)';
    ctx.beginPath();
    ctx.roundRect(12, 10, 412, 28, 7);
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
        drawCalloutTag(295, 225, '⚠️ Translucent 不写深度，前后叶片乱穿发灰！', 'rgba(176, 52, 22, 0.9)');
      } else {
        drawCalloutTag(295, 225, '✅ Masked 利落抠出叶缝，前后遮挡严丝合缝', 'rgba(38, 102, 42, 0.9)');
      }
      drawCalloutTag(535, 118, '玻璃窗 (单层半透明)', 'rgba(22, 74, 110, 0.85)');
    } else if (bufferMode === 'depth' || bufferMode === 'normal' || bufferMode === 'roughness') {
      if (blendMode === 'translucent') {
        drawCalloutTag(295, 195, '👻 整丛半透明灌木在底片室里直接隐形消失了！', 'rgba(155, 32, 92, 0.92)');
      } else {
        drawCalloutTag(295, 195, '✅ 镂空叶片完整写入底片室，后续 DepthFade 全靠它', 'rgba(38, 102, 42, 0.9)');
      }
      drawCalloutTag(532, 148, '视线直接穿透玻璃看到后方石柱！', 'rgba(22, 74, 110, 0.88)');
    } else if (bufferMode === 'overdraw') {
      if (blendMode === 'translucent') {
        drawCalloutTag(295, 188, '💥 5 张半透明卡片重叠，示意色加深', 'rgba(182, 22, 48, 0.94)');
      } else {
        drawCalloutTag(295, 188, '🌿 Masked 提前剔除遮挡，整片树丛保持翠绿低耗!', 'rgba(32, 98, 44, 0.92)');
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
      const lx = 450;
      const ly = 318;
      ctx.fillStyle = 'rgba(16, 15, 14, 0.84)';
      ctx.beginPath();
      ctx.roundRect(lx, ly, 218, 32, 7);
      ctx.fill();
      const grad = ctx.createLinearGradient(lx + 10, 0, lx + 206, 0);
      grad.addColorStop(0, '#101216');
      grad.addColorStop(1, '#ffffff');
      ctx.fillStyle = grad;
      ctx.fillRect(lx + 10, ly + 7, 196, 9);
      ctx.fillStyle = '#e8e2d8';
      ctx.font = '600 10.5px "Noto Sans SC", sans-serif';
      ctx.fillText('近处 4m (纯黑) ──────► 远处 25m+ (纯白)', lx + 10, ly + 28);
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
    const tagNames = ['远景天空', '石砖地面', '雕花石柱', '多层灌木丛', '玻璃铜框', '半透明玻璃窗'];
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
          isPitfall={blendMode === 'translucent'}
          pitfallLabel="树丛误用 Translucent 半透明（不进底片室乱穿 + 过绘制粉白爆表）"
          correctLabel="树丛使用 Masked 遮罩镂空（利落写深度进 GBuffer + 翠绿超省电）"
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
                {hoverInfo.depth > 100 ? '∞ (天空)' : `${hoverInfo.depth.toFixed(1)} m`}
              </strong>{' '}
              | Roughness: <strong>{hoverInfo.rough.toFixed(2)}</strong> | 重绘层数:{' '}
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
            { value: 'depth', label: '摄像机测距雷达图 (SceneDepth)' },
            { value: 'normal', label: '法线底片 (World Normal)' },
            { value: 'roughness', label: '粗糙度底片 (Roughness)' },
            { value: 'overdraw', label: '过绘制热力图 (Quad Overdraw)' },
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
                : '💡 切到 SceneDepth 或 Overdraw 看看：半透明树叶既没写深度，又把热力图烧成了粉白色！'}
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
    onKpiUpdate([
      {
        label: '两侧中央草片的顶点',
        value: '4 + 16 = 20 个',
        tone: 'good',
      },
      {
        label: '假设单次绘制覆盖',
        value: '42,000 个像素',
        tone: 'accent',
      },
      {
        label: 'GPU 耗时',
        value: '须在目标机测量',
        tone: 'good',
      },
      {
        label: '草根 (1-V) 钉死状态',
        value: pinRoot ? '✅ 草根稳扎泥土' : '⚠️ 未钉死 · 连根滑冰!',
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
      setSwitchCount(4);
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
    const visualDepth = Math.min(switchCount, 5); // Draw exact binary nodes up to depth 5 (32 nodes), then fan burst for 6..10!
    const leftX = 68;
    const rightX = switchCount > 5 ? W - 185 : W - 95;
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
      `独立静态开关的组合上限：2^${switchCount} = ${permutations.toLocaleString()} 种取值`,
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
      ctx.fillText('2⁰ = 1 种开关组合', W - 240, midY + 26);
      return;
    }

    // Draw binary tree levels 0 .. visualDepth
    for (let lv = 0; lv < visualDepth; lv++) {
      const count = 1 << lv;
      const x0 = lerp(leftX, rightX, lv / visualDepth);
      const x1 = lerp(leftX, rightX, (lv + 1) / visualDepth);

      for (let k = 0; k < count; k++) {
        const y0 = topPad + ((k + 0.5) / count) * usableH;
        const yTrue = topPad + ((2 * k + 0.5) / (count * 2)) * usableH;
        const yFalse = topPad + ((2 * k + 1.5) / (count * 2)) * usableH;

        // True branch
        ctx.strokeStyle =
          switchCount <= 3
            ? isDark
              ? 'rgba(74, 222, 128, 0.85)'
              : 'rgba(22, 163, 74, 0.85)'
            : switchCount <= 6
              ? isDark
                ? 'rgba(250, 204, 21, 0.8)'
                : 'rgba(217, 119, 6, 0.85)'
              : isDark
                ? 'rgba(248, 113, 113, 0.8)'
                : 'rgba(220, 38, 38, 0.8)';
        ctx.lineWidth = Math.max(1.0, 2.6 - lv * 0.35);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.bezierCurveTo((x0 + x1) * 0.5, y0, (x0 + x1) * 0.5, yTrue, x1, yTrue);
        ctx.stroke();

        // False branch
        ctx.strokeStyle =
          switchCount <= 3
            ? isDark
              ? 'rgba(96, 165, 250, 0.78)'
              : 'rgba(37, 99, 235, 0.8)'
            : switchCount <= 6
              ? isDark
                ? 'rgba(251, 146, 60, 0.78)'
                : 'rgba(234, 88, 12, 0.8)'
              : isDark
                ? 'rgba(232, 121, 249, 0.75)'
                : 'rgba(168, 85, 247, 0.78)';
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.bezierCurveTo((x0 + x1) * 0.5, y0, (x0 + x1) * 0.5, yFalse, x1, yFalse);
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
      ctx.fillStyle =
        switchCount <= 3
          ? isDark
            ? '#4ade80'
            : '#16a34a'
          : switchCount <= 6
            ? isDark
              ? '#facc15'
              : '#d97706'
            : isDark
              ? '#f87171'
              : '#dc2626';
      ctx.beginPath();
      ctx.arc(rightX, y, visualDepth >= 5 ? 2.4 : 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // If switchCount > 5 (64 .. 1,024), draw high-density fan burst to right edge!
    if (switchCount > 5) {
      const farRightX = W - 26;
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

      ctx.fillStyle = 'rgba(153, 27, 27, 0.92)';
      ctx.beginPath();
      ctx.roundRect(W - 166, H / 2 - 22, 148, 44, 8);
      ctx.fill();
      ctx.strokeStyle = '#fca5a5';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 13px "JetBrains Mono", monospace';
      ctx.fillText(`${permutations.toLocaleString()} 种可能组合!`, W - 154, H / 2 - 3);
      ctx.font = '600 10.5px "Noto Sans SC", sans-serif';
      ctx.fillText('项目可仅使用其中少数组合', W - 154, H / 2 + 14);
    }
  }, [tabMode, switchCount, isDark]);

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
          isPitfall={switchCount >= 8}
          pitfallLabel="10 个开关，最多 1,024 种组合"
          correctLabel="2 个开关，最多 4 种组合"
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
                    minWidth: 310,
                    boxShadow: '0 8px 28px rgba(0,0,0,0.6)',
                    color: '#fef3c7',
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 14, fontFamily: 'var(--font-mono)' }}>
                    编译等待动画 · {Math.round((1 - compileRemaining / 1420) * 100)}%
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.88, marginTop: 4 }}>
                    UE 的实际任务量和等待时间取决于材质、平台和缓存。
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

const Stage9_4_LandscapeSamplerRescue: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  // Default: all 6 layers enabled (6 * 3 = 18 / 16 samplers -> classic [SM5] compile error!)
  const [layerMask, setLayerMask] = useState<number>(0b111111);
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
      setLayerMask(0b111111); // 6 layers => 18/16 error!
      setSamplerSource('asset');
      setViewMode('lit');
      setMultiSlabSlowPath(false);
    } else if (stepIndex === 1) {
      setLayerMask(0b111111); // Keep the six-layer example for the budget explanation.
      setSamplerSource('asset');
      setViewMode('lit');
    } else if (stepIndex === 2) {
      setLayerMask(0b111111); // 6 layers => let user flip Shared: Wrap!
      setSamplerSource('asset');
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
    setLayerMask(0b111111);
    setSamplerSource('shared_wrap');
    setViewMode('lit');
    setMultiSlabSlowPath(false);
  }, [resetSignal]);

  const activeLayerCount = countBits(layerMask);
  const totalTextures = activeLayerCount * 3;
  const usedSamplers = samplerSource === 'shared_wrap' ? 1 : totalTextures;
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
        label: '样例采样器槽位',
        value: `${usedSamplers} / 16`,
        tone: isCompileError ? 'bad' : usedSamplers >= 14 ? 'warn' : 'good',
      },
      {
        label: '示例预算检查',
        value: isCompileError ? '超出假定的 16 槽' : '在假定的预算内',
        tone: isCompileError ? 'bad' : 'good',
      },
      {
        label: '示例纹理读取 / 像素',
        value: `${totalTextures} 次（每图一次）`,
        tone: 'neutral',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayerCount, totalTextures, usedSamplers, isCompileError]);

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

        // If [SM5] Exceeded 16 samplers compile failure -> UE Default WorldGrid Gray Checkerboard!
        if (isCompileError) {
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
          // Multi-slab slow-path evaluates 6 full BSDF closures -> explodes into red/magenta (8~11)!
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
          // Cyan-Green = Single Simple/Standard Slab (Fast Path, 1 Closure/pixel)
          // Amber/Magenta = Multi-Slab Complex Closure (Slow Path, multiple BSDF evaluations)
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
    ctx.fillStyle = 'rgba(16, 16, 18, 0.85)';
    ctx.beginPath();
    ctx.roundRect(12, 10, 456, 28, 7);
    ctx.fill();
    ctx.fillStyle = isCompileError ? '#fca5a5' : '#86efac';
    ctx.font = '700 12px "JetBrains Mono", "Noto Sans SC", sans-serif';
    const modeTitle =
      viewMode === 'lit'
        ? '地形彩色成片 (Lit)'
        : viewMode === 'complexity'
        ? 'Shader Complexity（教学热图）'
        : 'UE 5.8 Substrate 层板分类体检视图';
    ctx.fillText(
      `${modeTitle}  |  独立采样器: ${usedSamplers} / 16 ${
        samplerSource === 'shared_wrap' ? '(Shared: Wrap 共享 ✅)' : ''
      }`,
      22,
      28
    );

    // Classic UE [SM5] Exceeded 16 Samplers Compile Failure Banner!
    if (isCompileError) {
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
        `❌ [SM5] Error: Exceeded 16 samplers! (${usedSamplers} / 16 独立硬件采样器超限)`,
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
    } else if (viewMode === 'substrate') {
      ctx.fillStyle = 'rgba(18, 20, 24, 0.88)';
      ctx.beginPath();
      ctx.roundRect(22, 266, 636, 36, 8);
      ctx.fill();
      ctx.fillStyle = multiSlabSlowPath ? '#f9a8d4' : '#5eead4';
      ctx.font = '700 12px "Noto Sans SC", sans-serif';
      ctx.fillText(
        multiSlabSlowPath
          ? '多层板示意。实际闭包数由项目 GBuffer 格式与编译结果决定。'
          : `先混合 ${totalTextures} 张纹理的属性，再送入一个 Slab。`,
        34,
        289
      );
    }
  }, [layerMask, samplerSource, viewMode, multiSlabSlowPath, isCompileError, activeLayerCount, usedSamplers]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={isCompileError || multiSlabSlowPath}
          pitfallLabel="默认独立采样器爆表报错 (18/16) 或堆叠多个 Substrate 层板慢道"
          correctLabel="开启 Shared: Wrap (仅占 1/16 采样器) + 先混贴图再进单个层板快道"
          onToggle={(pit) => {
            setLayerMask(0b111111);
            if (pit) {
              setSamplerSource('asset');
              setMultiSlabSlowPath(true);
            } else {
              setSamplerSource('shared_wrap');
              setMultiSlabSlowPath(false);
            }
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
              ① 点击增减地形图层（每层含颜色+法线+ORM 共 3 张贴图，超过 5 层即达 18 张）：
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => setLayerMask(0b011111)}
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
                设为 5 层 (15/16 临界)
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
                全开 6 层 (18 张贴图!)
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
              { value: 'shared_wrap', label: 'Shared: Wrap (共享包裹 · 仅占 1/16 ✅)' },
            ]}
          />

          <StageSegmented<LandscapeViewMode>
            label="③ 材质性能与 UE 5.8 层板体检视图"
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: 'lit', label: '地形画面 (Lit)' },
              { value: 'complexity', label: 'Shader Complexity' },
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
    '树叶用 Masked 一刀切丢弃空白像素，保留下来的叶片完整写入 SceneDepth 与 GBuffer 各张底片，过绘制翠绿低耗。',
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
      outputs: [{ id: 'mat', label: 'Substrate 数据', color: '#a855f7' }],
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
      subtitle: '统一算一遍灯光 · 告别爆红过绘制',
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
      subtitle: '风向量如 (15,0,0) cm',
      category: 'input',
      x: 24,
      y: 36,
      width: 178,
      outputs: [{ id: 'wave', label: 'XYZ 风偏移', color: '#38bdf8' }],
    },
    {
      id: 'in_uv',
      title: 'TexCoord[0] → Mask (G/V)',
      subtitle: '草尖 V=0 · 草根 V=1',
      category: 'input',
      x: 24,
      y: 176,
      width: 178,
      outputs: [{ id: 'v', label: '纵向 V 坐标', color: '#22c55e' }],
    },
    {
      id: 'math_inv',
      title: 'OneMinus (1 - x)',
      subtitle: '反转成草根 0 · 草尖 1',
      category: 'math',
      x: 242,
      y: 176,
      width: 172,
      inputs: [{ id: 'in_v', label: 'Input V', color: '#22c55e' }],
      outputs: [{ id: 'grad', label: '钉根渐变遮罩', color: '#eab308' }],
    },
    {
      id: 'math_mul',
      title: 'Multiply (乘风力幅度)',
      subtitle: '对网格顶点求位移',
      category: 'math',
      x: 448,
      y: 108,
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
      x: 448,
      y: 24,
      width: 182,
      outputs: [{ id: 'mat', label: 'Front Material', color: '#a855f7' }],
    },
    {
      id: 'out_wpo',
      title: '材质主节点 (Root)',
      subtitle: '顶点位移连入 WPO 专用口',
      category: 'output',
      x: 664,
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
      outputs: [{ id: 'mat', label: 'Substrate 输出', color: '#a855f7' }],
    },
    {
      id: 'out_master',
      title: 'M_Prop_Master (母材质)',
      subtitle: '按平台、用途和静态配置编译',
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
      subtitle: '普通参数可独立更新',
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
    '示例假设 16 槽且全部纹理支持相同寻址与过滤。18 张平铺贴图可共享 1 种采样状态，每像素依然读取 18 次。',
  nodes: [
    {
      id: 'shared_samp',
      title: 'Sampler Source: Shared: Wrap',
      subtitle: '全局共用 1 名查字典专员 (1/16)',
      category: 'pipeline',
      x: 24,
      y: 68,
      width: 194,
      note: 'Texture Sample 的 Details 属性。',
    },
    {
      id: 'tex_18',
      title: '6 层地表 × 3 张贴图 (共18张)',
      subtitle: '草地 / 湿泥 / 碎石 / 雪 / 苔藓 / 沙',
      category: 'texture',
      x: 252,
      y: 68,
      width: 198,
      previewColor: '#3f7a38',
      outputs: [
        { id: 'cols', label: '各层 Albedo 颜色', color: '#22c55e' },
        { id: 'orms', label: '各层法线与粗糙度', color: '#eab308' },
      ],
    },
    {
      id: 'layer_blend',
      title: 'LandscapeLayerBlend',
      subtitle: '先在贴图数据层面完成权重混合!',
      category: 'math',
      x: 484,
      y: 68,
      width: 192,
      inputs: [
        { id: 'in_c', label: '6 路颜色输入', color: '#22c55e' },
        { id: 'in_r', label: '6 路粗糙度输入', color: '#eab308' },
      ],
      outputs: [
        { id: 'out_c', label: '合成 Albedo', color: '#22c55e' },
        { id: 'out_r', label: '合成 Roughness', color: '#eab308' },
      ],
    },
    {
      id: 'single_slab',
      title: '单个 Substrate Slab BSDF',
      subtitle: '已混合的地表属性进入一个 Slab',
      category: 'substrate',
      x: 706,
      y: 44,
      width: 186,
      inputs: [
        { id: 'albedo', label: 'Diffuse Albedo', color: '#22c55e' },
        { id: 'rough', label: 'Roughness', color: '#eab308' },
      ],
      outputs: [{ id: 'mat', label: 'Front Material', color: '#a855f7' }],
    },
    {
      id: 'out_terrain',
      title: 'M_Landscape (编译绿灯)',
      subtitle: '样例状态 1 种，读取 18 次',
      category: 'output',
      x: 706,
      y: 204,
      width: 186,
      inputs: [{ id: 'front', label: 'Front Material', color: '#a855f7' }],
    },
  ],
  edges: [
    { fromNode: 'tex_18', fromPin: 'cols', toNode: 'layer_blend', toPin: 'in_c', color: '#22c55e' },
    { fromNode: 'tex_18', fromPin: 'orms', toNode: 'layer_blend', toPin: 'in_r', color: '#eab308' },
    { fromNode: 'layer_blend', fromPin: 'out_c', toNode: 'single_slab', toPin: 'albedo', color: '#22c55e' },
    { fromNode: 'layer_blend', fromPin: 'out_r', toNode: 'single_slab', toPin: 'rough', color: '#eab308' },
    { fromNode: 'single_slab', fromPin: 'mat', toNode: 'out_terrain', toPin: 'front', color: '#a855f7' },
  ],
};

// ============================================================================
// MODULE 09 EXPORT DEFINITION
// ============================================================================

export const module09: ModuleDefinition = {
  id: '09',
  number: '09',
  title: '渲染管线背景与工程架构',
  subtitle: '深度图、GBuffer 底片室、母材质与性能调优',
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
      difficulty: '零基础',
      steps: [
        {
          stepNumber: 1,
          shortLabel: '树叶穿帮之谜',
          tag: 'phenomenon',
          title: '为什么新手做一丛树叶，不是套着黑方框，就是让整张地图卡成幻灯片？',
          paragraphs: [
            '很多同学第一次往场景里种灌木树丛时，都会撞上两难怪圈：直接把带透明背景的树叶贴图塞进普通材质，结果每根树枝四周都顶着一大块丑陋的**纯黑长方形纸板**，把后面的石柱挡得严严实实。',
            '心想“树叶边缘是透明的，那我把材质改成半透明不就好了？”——黑框是没了，可仔细一看，后排树叶竟然莫名其妙画到了前排树叶脸上，而且才摆了十几丛灌木，原本流畅的画面帧率直接腰斩！这背后究竟踩中了显卡的什么机关？',
          ],
          tryItPrompt:
            '观察中央视口里的灌木丛：先看默认 Opaque 下的黑方框穿帮，再点选 ② 里的 Translucent（半透明），留意叶片前后穿插错乱的现象。',
        },
        {
          stepNumber: 2,
          shortLabel: '测距眼与底片室',
          tag: 'background',
          title: '显卡暗房里的两件法宝：测距雷达底片（SceneDepth）与延迟底片室（GBuffer）',
          paragraphs: [
            '原来显卡每画一帧画面，都在后台悄悄干两件极聪明的事：第一件是给镜头装一只“测距眼”，同步画一张**近黑远白的距离底片（`SceneDepth`）**，记下每个像素离镜头有几米远。后面新画的物体只要比底片远，说明被挡住了，当场跳过不画！',
            '第二件是开一间**“延迟渲染底片室”（`GBuffer`）**：想象剧组给 100 个演员打 50 盏灯，显卡先把最前面不透明物体的颜色、**法线小牙签**、**粗糙度**拍成几张底片存进暗房，最后对着底片统一算 1 遍灯光！可**半透明物体（如玻璃窗）**隔着它还能看见后面的石柱，一张底片根本存不下两层东西，所以半透明没资格进底片室，只能拎出来一层层硬叠重算！',
          ],
          tryItPrompt:
            '在 ① 中依次点击「摄像机测距雷达图 (SceneDepth)」、「法线底片」和「粗糙度底片」，观察右侧玻璃窗是不是在这些底片里完全透明隐形、直接看穿到了后面的石柱？',
          callout: {
            tone: 'tip',
            title: '为下一章水、玻璃、雾埋下关键伏笔！',
            body: '记住这张近黑远白的 `SceneDepth` 测距底片！第 10 章我们做“岸边浅水变白深水变蓝”和“雾片插地柔和消退”，靠的全是拿水底的 `SceneDepth` 减去水面的距离！',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '过绘制爆红灾难',
          tag: 'experiment',
          title: '亲眼见证帧率杀手 Overdraw：为什么叠五层半透明会把显卡烧成“粉白色”？',
          paragraphs: [
            '当一丛灌木由五六张交叉的半透明面片叠在一起时，灾难就发生了：因为半透明不写测距底片，显卡没法提前剔除被挡住的部分，甚至连树叶贴图四角空白透明的地方，也得老老实实把整套灯光算一遍再叠上去！',
            '同一个屏幕像素被反复重涂十几次，就叫**过绘制（`Overdraw`）**。打开热力图一看：翠绿色代表只算一两遍极省电，暗红代表吃力，一旦烧成**刺眼的粉白色**，就是显卡正在原地空转冒烟的求救信号！',
          ],
          tryItPrompt:
            '保持在「过绘制热力图 (Quad Overdraw)」下，把树丛从 Translucent 切到 Masked（一刀切镂空），亲眼见证粉白灾难区一秒退烧变成清爽翠绿！',
        },
        {
          stepNumber: 4,
          shortLabel: '三大混合模式',
          tag: 'ue5',
          title: '走进 UE 5.8：对号入座 Opaque、Masked 与 Translucent 三大混合模式',
          paragraphs: [
            '懂了底片室原理，UE 5.8 材质左下角 `Details` 面板里的 **`Blend Mode（混合模式）`** 从此一眼选对：实心砖墙石头选默认的 **`Opaque（不透明）`**，跑得最快；真正的窗户玻璃、轻烟薄雾才选 **`Translucent（半透明）`**，且层数越少越好。',
            '而树叶、铁丝网、破布条这类“要么完全实心、要么完全镂空”的物体，天生属于 **`Masked（遮罩镂空）`**！它拿 `Opacity Mask Clip Value`（默认 `0.3333`）当剪刀，低于门槛的像素直接丢弃，留下来的叶片堂堂正正写进 `SceneDepth` 和 `GBuffer` 底片室，不乱穿也不爆红！',
          ],
          tryItPrompt:
            '切到 Lit 并保持 Masked，拖动滑块观察轮廓。在 UE 中贴图 Alpha 连 Opacity Mask；Opacity Mask Clip Value 在材质 Details 中设置裁剪门槛。',
          callout: {
            tone: 'ue58',
            title: 'UE 5.8 面板位置速记',
            body: '选中材质主节点 → 左下角 `Details` → `Material` 分类下修改 `Blend Mode = Masked` → 此时主节点上的 `Opacity Mask` 插孔会自动点亮解锁！',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '防坑黄金口诀',
          tag: 'pitfall',
          title: '实战避坑口诀：实心不透明，树叶一刀切，玻璃烟雾才用半透明！',
          paragraphs: [
            '很多外包资产拖进引擎性能暴跌，十有八九是因为美术导出时顺手把所有带 Alpha 通道的树叶、草丛、铁栅栏全设成了 `Translucent`——不仅导致远近树叶前后穿插闪烁，连第 7 章学的 `VSM` 镂空树影也会丢失！',
            '养成进图第一反应：遇到帧率莫名下降，立刻在视口左上角切到 `Optimization Viewmodes → Quad Overdraw` 扫一眼。看到植被冒粉白光，马上改成 `Masked`，帧率往往当场暴涨一大截！',
          ],
          tryItPrompt:
            '点击舞台顶部的「看踩坑现象 / 切正确配置」一键对比条，最后重温一遍半透明爆红与遮罩翠绿的震撼反差！',
          callout: {
            tone: 'warn',
            title: '半透明卡片空白区也别留太大！',
            body: '做篝火烟雾等必须用 `Translucent` 的特效时，尽量让面片贴合烟雾轮廓裁剪，减少四周纯透明大白边，能大幅压低过绘制面积。',
          },
        },
      ],
      takeaways: [
        '`SceneDepth` 是摄像机拍下的近黑远白测距底片，既负责遮挡剔除省算力，也是后续做水深与软边雾的标尺',
        '`GBuffer` 是延迟渲染暗房底片室，把不透明与镂空物体的颜色、法线、粗糙度存成底片统一算一次光',
        '树叶、草丛、铁丝网严禁用 `Translucent`，必须用 `Masked`（遮罩一刀切）才能写入深度不乱穿且省性能',
        '`Translucent` 进不了 GBuffer 底片室，多层叠加会引发严重的 `Quad Overdraw`（热力图从翠绿烧成粉白）',
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
      subtitle: '在 4 顶点与 16 顶点草片上比较同一个风场',
      duration: '14 分钟',
      difficulty: '进阶',
      steps: [
        {
          stepNumber: 1,
          shortLabel: '风吹草动魔法',
          tag: 'phenomenon',
          title: '漫山遍野十万棵随风摇摆的青草，难道要请动画师给每棵草绑骨头调动画吗？',
          paragraphs: [
            '站在开放世界游戏的山坡上，风吹过草甸泛起层层绿浪。如果像做角色动作那样给十万棵草每棵绑一套骨骼动画，CPU 光算骨头位置就会当场死机！',
            '更神奇的是，有时候美术拿两块一样的草材质贴到不同模型上，右边的草弯得像真柳条一样柔美，左边的草却像一块硬邦邦的木牌子直挺挺斜着晃。不用骨骼，材质是怎么让静止模型自己动起来的？为什么两棵草弯腰姿势差这么多？',
          ],
          tryItPrompt:
            '观察中央风洞里的左右两株小草：拉动「风力摆动幅度」滑块，对比左边硬纸板草直挺挺斜歪与右边柔韧草优雅弯腰的区别。',
        },
        {
          stepNumber: 2,
          shortLabel: '显卡上下半场',
          tag: 'background',
          title: '显卡干活分上下半场：先搬十几个骨架钉子（顶点），再涂四万个小格子（像素）',
          paragraphs: [
            '回忆第 1 章学的模型零件，显卡画一棵草严格分**上下两个半场**：**上半场（顶点阶段）**只找模型骨架上的那十几颗钉子（顶点），决定它们站在屏幕哪儿；**下半场（像素阶段）**再把钉子围出来的成千上万个屏幕小格子逐一涂上颜色。',
            '只数左右两株中央草片：左侧有 4 个角点，右侧有 8 排、每排 2 个顶点，共 20 个顶点。假设一次绘制覆盖 42,000 个像素，两项数据描述网格规模和屏幕覆盖；实际着色器调用还受裁剪、遮挡与渲染通道影响。',
          ],
          tryItPrompt:
            '打开线框，数两株草的顶点。保持相同风场，比较每排顶点相连后形成的轮廓。',
        },
        {
          stepNumber: 3,
          shortLabel: '钉死草根实验',
          tag: 'experiment',
          title: '新手必笑翻车现场：忘了给草根乘以 0，整片草原在泥土上“连根滑冰”！',
          paragraphs: [
            '如果我们在上半场直接拿一个随时间左右摆动的正弦波（`Sine`），原封不动加到整棵草所有钉子上，会发生什么滑稽一幕？从草尖到草根每一颗钉子都一起往左平移 30 厘米、再往右平移 30 厘米——整棵草当场拔根而起，在地面上跳起了太空步！',
            '怎么把草根死死钉在土里？请出第 2 章学的 UV 坐标！建模师展草叶 UV 时，习惯把草尖放在顶部 `V = 0`，草根放在底部 `V = 1`。拿 **`OneMinus (1 - V)`** 反转一下，草根刚好变成 **`0`**，草尖变成 **`1`**，再跟风波相乘，草根纹丝不动，越往草尖摆幅越大！',
          ],
          tryItPrompt:
            '试着取消勾选下方的「乘上高度渐变钉死草根 (1-V 遮罩)」，亲眼看看两株草瞬间脱根在土堆上左右滑冰的穿帮现场，再勾回来钉牢它！',
        },
        {
          stepNumber: 4,
          shortLabel: 'WPO 与算力下移',
          tag: 'ue5',
          title: '走进 UE 5.8：连入 World Position Offset 与算力搬家神器 VertexInterpolator',
          paragraphs: [
            '在 UE 5.8 材质主节点上，专门负责上半场搬钉子的插孔就叫 **`World Position Offset`（世界位置偏移，简称 `WPO`）**，传进去一个三维向量 `(ΔX, ΔY, ΔZ)`，就能让树叶迎风摇曳、水面起伏呼吸、甚至怪兽心脏跳动！',
            '做一组插值测试：在 4 顶点草片上将 TexCoord.G 乘自身，先直接送给颜色，再通过 VertexInterpolator 输出。V=0.5 处逐像素计算得 0.25，端点 0 和 1 线性插值得 0.5。增加细分后比较误差，再在目标平台测两种材质的 GPU 耗时。',
          ],
          tryItPrompt:
            '点击右上角切换到「原理连线图」视图，顺着 `TexCoord → OneMinus → Multiply → World Position Offset` 理清整条风场链路。',
          callout: {
            tone: 'ue58',
            title: 'UE 5.8 远景风场省电开关',
            body: '在支持该属性的组件上设置 World Position Offset Disable Distance（单位 cm，如 3000）。保持相机路线不变，通过 VSM 缓存可视化检查远处的阴影页能否复用。',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '防坑黄金口诀',
          tag: 'pitfall',
          title: '实战避坑口诀：弯曲先看钉子够不够，位移必乘遮罩钉住根！',
          paragraphs: [
            '以后遇到“连了风场节点但模型死活弯不自然”或者“整座帐篷连着地钉一起飘走了”，按两步排查百试百灵：第一看网格线框里有没有足够的细分横节顶点；第二看位移向量在进 `WPO` 前有没有乘上 `1 - V` 或**顶点色（Vertex Color）**遮罩把底座清零。',
            '另外留个心眼：显卡上半场搬动了钉子，但引擎判断物体“有没有走出屏幕外”默认还是看它原来的盒子大小（包围盒 Bounds）。如果用 `WPO` 把顶点拉出去好几米远，记得在模型组件里把 `Bounds Scale` 稍微调大一点，防止边缘突然闪没！',
          ],
          tryItPrompt:
            '用顶部的「看踩坑现象 / 切正确配置」一键切换，再次确认 `(1-V)` 钉根遮罩对风场真实感的决定性作用。',
        },
      ],
      takeaways: [
        '顶点数取决于网格，像素覆盖取决于画面；实际着色成本需结合渲染通道、着色指令和目标 GPU 测量。',
        '`World Position Offset (WPO)` 工作在顶点阶段；模型必须有足够的多段细分顶点才能弯出柔顺弧度',
        '做植被风摆必须乘上 `1 - V` 高度渐变或顶点色遮罩把根部偏移清为 `0`，否则整棵植物会脱根滑行',
        'VertexInterpolator 在顶点求值再插值；平方、正弦等非线性函数在粗网格上可产生明显误差。',
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
      subtitle: '区分实例参数更新、静态组合与编译任务',
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
            '在实验台一更改普通材质常量，再用实例参数完成相同操作。网页固定播放 1.8 秒等待动画，编辑器的编译时间取决于目标、缓存与材质。',
        },
        {
          stepNumber: 2,
          shortLabel: '菜谱与配料碗',
          tag: 'background',
          title: '底层揭秘：重印整本外文菜谱（母材质编译）vs 只换碗里的调料（材质实例 MI）',
          paragraphs: [
            '原因很简单：咱们连的节点图是给人看的中文菜谱，显卡一个字也不认识，每次你直接改动普通节点点保存，引擎都得请编译器翻译官把整张图重新全文翻译成显卡底层机器码！',
            '把颜色、粗糙度或纹理暴露为参数，由同一个母材质派生不同材质实例。在相同静态配置下修改普通实例参数可以复用已有着色器。',
          ],
          tryItPrompt:
            '选中酒桶、宝珠或圆盾并调节实例的粗糙度。观察哪些物体用了当前实例。',
        },
        {
          stepNumber: 3,
          shortLabel: '静态开关双刃剑',
          tag: 'experiment',
          title: '10 个独立布尔静态开关有多少种可能的取值组合？',
          paragraphs: [
            '既然母材质这么好用，很多同学一上头：“干脆我把积雪、风摆、溶解、清漆、视差十种功能全塞进同一个超级母材质里，再加 10 个**静态开关（`Static Switch Parameter`）**，哪个实例不用就关掉省性能！”',
            'N 个独立布尔静态开关最多有 2^N 种取值组合。10 个开关给出 1,024 种可能，而三个实例即使颜色各异，也可以共享同一种静态配置。实际用到哪些组合取决于母材质和实例，编译任务还取决于平台、质量、顶点工厂与渲染通道。',
          ],
          tryItPrompt:
            '把开关数调到 10，比较上限与三个示例实例实际引用的组合数。让第三个实例也使用前两个实例的配置，观察实际组合数从 2 变为 1。',
        },
        {
          stepNumber: 4,
          shortLabel: '工业命名与规范',
          tag: 'ue5',
          title: '走进 UE 5.8：3 秒建好母子材质流与工业界命名前缀规范',
          paragraphs: [
            '在 UE 5.8 里落地这套架构只需三步：① 在母材质里右键任意颜色、常数或贴图节点，点 **`Convert to Parameter`（转换为参数）** 并起个好懂的中文或英文分组名（设置 `Group` 分组能让面板整整齐齐）；② 保存母材质后，在内容浏览器右键它选 **`Create Material Instance`（创建材质实例）**；③ 把生成的实例拖给场景里的模型！',
            '顺手养成专业命名习惯：母材质统一标 **`M_`**（如 `M_Prop_Master`），材质实例统一标 **`MI_`**（如 `MI_Barrel_Wood`），通用材质函数标 **`MF_`**——团队协作一眼分清谁是模具、谁是成品。',
          ],
          tryItPrompt:
            '复用 2.4 的 `M_FirstSurface`，在内容浏览器右键选择 Create Material Instance，命名 `MI_FirstSurface`。在实例中勾选 `Tint` 覆盖并改色，把实例赋给第二个网格，比较母材质和实例。综合练习再用同样步骤建立 `M_Panel` / `MI_Panel`，只覆盖 `RoughnessScale` 观察高光。',
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
          title: '按使用场景选择实例参数与静态开关',
          paragraphs: [
            '需要独立调色或调粗糙度的道具可建立材质实例；资源列表中记录母材质、实例和各自使用的静态开关值。',
            '需要编译时移除整条采样或着色分支时，考虑静态开关。运行时只需调强度可使用普通标量，乘零仍可能执行输入分支。选择时检查目标平台编译与运行成本。',
          ],
          tryItPrompt:
            '在材质编辑器打开 Platform Stats 并选定目标平台和质量。给两个实例设置相同开关，第三个使用另一值，比较对应的着色器统计。要测耗时，再在同一镜头用 ProfileGPU 对照。',
        },
      ],
      takeaways: [
        '直接修改普通材质（`M_`）会触发底层着色器机器码重编译；项目实战应统一采用「母材质 + 材质实例（`MI_`）」架构',
        '相同静态配置下，多个实例能复用编译结果；普通标量和向量参数可独立调整。',
        '10 个独立布尔静态开关提供最多 1,024 种取值。实际编译多少着色器，还要看使用的组合、平台与渲染通道。',
        '记录项目用到的静态组合，按功能和实际开销决定是否拆分母材质。',
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
          title: '满怀欢喜给大山画上第 6 层沙地，为什么整座青山突然变成灰白棋盘格报错罢工了？',
          paragraphs: [
            '做开放世界地形（`Landscape`）时，几乎人人都会在深夜撞上这盆冷水：前五层草地、湿泥、碎石、积雪、苔藓画得好好的，刚兴冲冲加上第 6 层河滩沙地，整座大山咔嚓一下全变成了灰白相间的默认棋盘格！',
            '低头一看日志栏，赫然飘着一行鲜红英文报错：**`[SM5] Error: Exceeded 16 samplers`**！明明电脑显卡有十几个 G 的大显存，凭什么才用了十几张贴图就不让画了？',
          ],
          tryItPrompt:
            '看中央视口里正处于 6 层全开（`18 / 16`）报错灰棋盘格状态的大山：先点一下右上方的「设为 5 层 (15/16 临界)」，看大山是不是立刻恢复正常了？再点回「全开 6 层」复现故障！',
        },
        {
          stepNumber: 2,
          shortLabel: '16名查字典专员',
          tag: 'background',
          title: '采样器状态、纹理资源和采样次数分别计数',
          paragraphs: [
            '回想第 5 章学的纹理采样：贴图是字典，而决定“越界是包裹循环 `Wrap` 还是夹紧边缘 `Clamp`、滤波用双线性还是最近点”的那套规矩，由硬件里的**采样器（`Sampler`）**负责执行——你可以把它想象成坐在显卡窗口的**查字典专员**。',
            '本实验假设一个有 16 个采样器槽位的着色阶段，6 层 × 3 张不同纹理，每张采样一次，均可使用同一平铺与过滤规则。独立状态计 18 个，共享状态计 1 个，样本读取仍是 18 次。引擎其余占用和平台预算以 Platform Stats 为准。',
          ],
          tryItPrompt:
            '保持在「全开 6 层 (18 张贴图!)」报错状态下，准备下一步亲手按响那个一秒救活整座大山的开关！',
        },
        {
          stepNumber: 3,
          shortLabel: '一秒救活地形',
          tag: 'experiment',
          title: '救场神技实操：切为 Shared: Wrap，采样器从 18/16 骤降到 1/16！',
          paragraphs: [
            '先核对每张纹理坐标越界后的预期，以及过滤方式。在支持共享采样器的平台，把需要相同 Wrap 寻址且接受共享过滤的地形 Texture Sample 的 Sampler Source 设为 Shared: Wrap。',
            '这组地形示例的 18 次读取只需 1 种共享状态。贴花、色阶或图集如需夹紧可按条件选 Shared: Clamp；需要特殊过滤或不同轴寻址时保留 From Texture Asset。',
          ],
          tryItPrompt:
            '现在点击 ② 中的「Shared: Wrap (共享包裹 · 仅占 1/16 ✅)」，亲眼看着报错横幅瞬间消失、采样器读数掉回 `1 / 16` 并重现六层锦绣山河！',
          callout: {
            tone: 'tip',
            title: 'Shared: Wrap 与 Shared: Clamp 怎么选？',
            body: '共享状态会覆盖纹理自身的寻址与过滤选项。Wrap 适合可平铺图像，Clamp 适合需保持边缘颜色的图像。按目标平台验证共享支持、过滤结果与引擎占用。',
          },
        },
        {
          stepNumber: 4,
          shortLabel: 'UE 5.8 双重体检',
          tag: 'ue5',
          title: '走进 UE 5.8：用 Shader Complexity 与专属 Substrate 层板视图给材质做全身体检',
          paragraphs: [
            'Shader Complexity（Alt+8）用着色指令等信息形成视口热图，可据此挑选待测区域。网页按层数着色，真实耗时还受采样、带宽、可见面积与 GPU 影响。',
            '在 Substrate 可视化中查看实际编译出的材质分类。地表属性能共用同一着色响应时，可先混合颜色、法线与粗糙度，再进入一个 Slab。确实需要多层物理响应的材质应保留分层，比较目标平台编译后的表现。',
          ],
          tryItPrompt:
            '切换两种实现，观察网页示意。再固定 UE 相机与灯光，对照 Substrate 分类、Platform Stats 和 GPU 计时。',
          callout: {
            tone: 'ue58',
            title: '别忘了看材质编辑器左下角的 Stats 体检单',
            body: '打开 Material Editor → Platform Stats，勾选实际着色平台及质量，比较修改前后的 Texture Samplers 和 Texture Lookups。再对固定镜头运行 ProfileGPU；二者分别反映编译统计和运行耗时。',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '防坑黄金口诀',
          tag: 'pitfall',
          title: '实战避坑口诀：多图必开共享包裹，层板先混贴图再封箱！',
          paragraphs: [
            '本例所有地形纹理都需要平铺且使用相同过滤。生产中逐组核对寻址、过滤、平台与其他槽位占用；对使用不同规则的贴花做 UV 越界检查。尝试合并地表属性时保留材质原有的光照表现，再比较统计。',
            '至此，光影、色彩、纹理、PBR 层板与深度管线五大内功你已全部融会贯通！下一章（模块 10），我们将把前面攒下的每一块积木全数派上用场，亲手造出清澈海水、通透水晶玻璃、森林丁达尔体积雾、溶解护盾与温润美玉！',
          ],
          tryItPrompt:
            '点击顶部「看踩坑现象 / 切正确配置」一键切换，体验从“报错罢工 + 慢道飙红”到“1/16 共享 + 快道翠绿”的满血优化闭环！',
        },
      ],
      takeaways: [
        '本例假定该着色阶段有 16 个槽。不同平台、渲染路径和材质特性会改变实际可用预算。',
        '可兼容的纹理能共享 Wrap 或 Clamp 采样状态；采样指令仍会读取每个被采样的纹理。',
        '善用 `Alt + 8`（`Shader Complexity`）与材质编辑器 `Stats` 面板检查指令数，绿区健康、红粉白区需重点瘦身',
        '在 UE 5.8 `Substrate` 中做多层地表或污渍混合，应先混合贴图属性再连入单个 `Substrate Slab`，稳走单层板快道',
      ],
      schematic: schematic9_4,
      StageComponent: Stage9_4_LandscapeSamplerRescue,
    },
  ],
};
