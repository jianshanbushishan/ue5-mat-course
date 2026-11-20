import React, { useEffect, useRef, useState } from 'react';
import { KpiCard, LessonStageProps, ModuleDefinition } from '../types/course';
import {
  acesTonemap,
  clamp,
  dot3,
  fbm,
  hash2,
  lerp,
  lerp3,
  linearToSrgb,
  norm3,
  reflect3,
  sampleEnvMap,
  saturate,
  shadePbrPixel,
  smoothstep,
  valueNoise,
  Vec3,
} from '../lib/graphics';
import {
  PitfallCompareBar,
  StageSegmented,
  StageSlider,
  StageToggle,
} from '../components/ui/StageWidgets';

/* ============================================================================
 * Shared Procedural Helpers for Module 10 Flagship Visual Shaders
 * ============================================================================ */

function voronoiInfo(x: number, y: number): { edge: number; f1: number; cellId: number } {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  let minD1 = 8.0;
  let minD2 = 8.0;
  let bestId = 0;

  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = ix + i;
      const gy = iy + j;
      const ox = hash2(gx, gy);
      const oy = hash2(gx + 37.2, gy + 91.7);
      const dx = i + ox - fx;
      const dy = j + oy - fy;
      const d = Math.hypot(dx, dy);
      if (d < minD1) {
        minD2 = minD1;
        minD1 = d;
        bestId = hash2(gx * 3.1 + 7, gy * 5.7 + 13);
      } else if (d < minD2) {
        minD2 = d;
      }
    }
  }
  return { edge: minD2 - minD1, f1: minD1, cellId: bestId };
}

function hexEdgeDist(u: number, v: number): number {
  const s3 = 1.7320508;
  const hx = u;
  const hy = v;
  const ax = ((hx % 1) + 1) % 1 - 0.5;
  const ay = ((hy % s3) + s3) % s3 - s3 * 0.5;
  const bx = (((hx + 0.5) % 1) + 1) % 1 - 0.5;
  const by = (((hy + s3 * 0.5) % s3) + s3) % s3 - s3 * 0.5;

  const da = ax * ax + ay * ay;
  const db = bx * bx + by * by;
  const px = Math.abs(da < db ? ax : bx);
  const py = Math.abs(da < db ? ay : by);
  const hexMetric = Math.max(px, px * 0.5 + py * (s3 * 0.5));
  return Math.abs(0.5 - hexMetric);
}

const stageCanvasWrapStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  borderRadius: 12,
  border: '1.5px solid var(--border-strong)',
  overflow: 'hidden',
  background: 'var(--bg-canvas)',
  boxShadow: 'var(--shadow-brutal)',
};

/* ============================================================================
 * 10.1 STAGE: 🌊 真实水体（UE 5.8 Single Layer Water 阶梯泳池海湾工作台）
 * ============================================================================ */

function getPoolBedDepthMeters(u: number): number {
  // Stepped pool + emergent reef rock in the middle + deep abyssal pit on the right
  // Returns water depth in meters (>0 means underwater, <0 means dry shore/rock above water)
  let bedDepth: number;
  if (u < 0.11) {
    // Sandy beach sloping into water at u = 0.10
    bedDepth = (u - 0.1) * 3.2;
  } else if (u < 0.31) {
    // Step 1: ankle-deep white sand step (~0.26m)
    const riser = smoothstep(0.11, 0.135, u);
    bedDepth = lerp(0.03, 0.28, riser);
  } else if (u < 0.68) {
    // Step 2: mid terrace (~1.05m), interrupted by reef rock around u = 0.49
    const riser = smoothstep(0.31, 0.34, u);
    bedDepth = lerp(0.28, 1.08, riser);
    const reefBell = Math.exp(-Math.pow((u - 0.5) / 0.068, 2));
    bedDepth -= reefBell * 1.32; // Peaks -0.24m above water!
  } else if (u < 0.8) {
    // Step 3: waist/chest step (~1.95m)
    const riser = smoothstep(0.68, 0.715, u);
    bedDepth = lerp(1.08, 1.98, riser);
  } else {
    // Step 4: Deep ocean pit (~3.65m)
    const riser = smoothstep(0.8, 0.845, u);
    bedDepth = lerp(1.98, 3.65, riser);
  }
  return bedDepth;
}

const WaterPoolStage: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [isPitfall, setIsPitfall] = useState(false);
  const [absorption, setAbsorption] = useState(1.15); // ① Beer-Lambert red absorption
  const [waveMode, setWaveMode] = useState<'single' | 'dual'>('dual'); // ② Single vs Dual counter-panning normals
  const [refractionAmt, setRefractionAmt] = useState(0.75); // ③ IOR 1.33 underwater wobble
  const [foamWidthCm, setFoamWidthCm] = useState(30); // ④ DepthFade soft shoreline & foam width (cm)
  const [showLightRays, setShowLightRays] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const kpiRef = useRef(onKpiUpdate);
  kpiRef.current = onKpiUpdate;

  const lastResetRef = useRef(resetSignal);
  useEffect(() => {
    if (lastResetRef.current !== resetSignal) {
      lastResetRef.current = resetSignal;
      setIsPitfall(false);
      setAbsorption(1.15);
      setWaveMode('dual');
      setRefractionAmt(0.75);
      setFoamWidthCm(30);
      setShowLightRays(false);
    }
  }, [resetSignal]);

  const effAbs = isPitfall ? 0 : absorption;
  const effWave = isPitfall ? 'single' : waveMode;
  const effRefract = isPitfall ? 0 : refractionAmt;
  const effFoamCm = isPitfall ? 0 : foamWidthCm;
  const raysOverlay = showLightRays || stepIndex === 1;

  useEffect(() => {
    const shallowRedPct = isPitfall
      ? '硬涂死蓝 (失真)'
      : `${(Math.exp(-effAbs * 1.95 * 0.28 * 2.05) * 100).toFixed(1)}% 留存`;
    const deepRedPct = isPitfall
      ? '与浅滩同色!'
      : `${(Math.exp(-effAbs * 1.95 * 3.6 * 2.05) * 100).toFixed(2)}% 留存`;

    kpiRef.current([
      {
        label: '浅阶(0.28m)红光',
        value: shallowRedPct,
        tone: isPitfall ? 'bad' : 'good',
      },
      {
        label: '深水坑(3.6m)红光',
        value: deepRedPct,
        tone: isPitfall ? 'bad' : effAbs > 0.4 ? 'accent' : 'warn',
      },
      {
        label: '波浪法线混合',
        value: effWave === 'dual' ? '双层反向交错' : '单向死板平推',
        tone: effWave === 'dual' ? 'good' : 'warn',
      },
      {
        label: '浅水带岸沫',
        value: effFoamCm > 0 ? `${effFoamCm} cm 水深范围` : '0 cm 无泡沫',
        tone: effFoamCm >= 12 ? 'good' : 'bad',
      },
    ]);
  }, [isPitfall, effAbs, effWave, effFoamCm]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 640;
    const H = 272;
    const bufW = 320;
    const bufH = 136;
    const offCanvas = document.createElement('canvas');
    offCanvas.width = bufW;
    offCanvas.height = bufH;
    const offCtx = offCanvas.getContext('2d');
    if (!offCtx) return;
    const imgData = offCtx.createImageData(bufW, bufH);
    const data = imgData.data;

    let animId = 0;
    const startTime = performance.now();

    const render = (now: number) => {
      const t = (now - startTime) * 0.001;
      const waterLineV = 0.24; // Top 24% is sky & emergent rock/beach, bottom 76% is perspective water + cross-section

      for (let py = 0; py < bufH; py++) {
        const v = py / bufH;
        for (let px = 0; px < bufW; px++) {
          const u = px / bufW;
          const idx = (py * bufW + px) * 4;

          const rawDepth = getPoolBedDepthMeters(u);
          // Add slight perspective Z variation across vertical axis for rich 3D cove feel
          const zPersp = clamp((v - waterLineV) / (1 - waterLineV), 0, 1);

          // Sky background above water horizon
          if (v < waterLineV) {
            // Check if emergent reef crest pokes into sky band
            const rockCrestH = -rawDepth; // >0 when above water
            const skySurfaceV = waterLineV - Math.max(0, rockCrestH) * 0.26;
            if (v >= skySurfaceV && rawDepth < 0) {
              const rockNoise = fbm(u * 28, v * 28, 3);
              const lit = 0.52 + 0.42 * smoothstep(skySurfaceV + 0.05, skySurfaceV, v);
              const isBeach = u < 0.2;
              const baseCol: Vec3 = isBeach
                ? [0.88 * lit, 0.81 * lit, 0.66 * lit]
                : [(0.42 + rockNoise * 0.16) * lit, (0.4 + rockNoise * 0.14) * lit, (0.38 + rockNoise * 0.12) * lit];
              data[idx] = Math.round(clamp(baseCol[0]) * 255);
              data[idx + 1] = Math.round(clamp(baseCol[1]) * 255);
              data[idx + 2] = Math.round(clamp(baseCol[2]) * 255);
              data[idx + 3] = 255;
              continue;
            }

            // Sunny coastal sky + sun glow
            const skyT = v / waterLineV;
            const skyCol = lerp3([0.32, 0.58, 0.92], [0.76, 0.89, 0.98], skyT);
            const sunDist = Math.hypot(u - 0.78, v - 0.09);
            const sun = Math.exp(-sunDist * sunDist * 260) * 0.48;
            data[idx] = Math.round(clamp(skyCol[0] + sun) * 255);
            data[idx + 1] = Math.round(clamp(skyCol[1] + sun * 0.95) * 255);
            data[idx + 2] = Math.round(clamp(skyCol[2] + sun * 0.75) * 255);
            data[idx + 3] = 255;
            continue;
          }

          // Split bottom strip (v > 0.87) as subtle geological depth cross-section ruler, and v in [0.24..0.87] as 3D oblique top-down water surface!
          const localDepth =
            rawDepth - (1 - zPersp) * 0.06 * Math.sin(u * 14); // Gentle natural shoreline curve

          // Dry sand / emergent reef rock above water
          if (localDepth <= 0) {
            const isBeach = u < 0.22;
            const grain = valueNoise(u * 65, v * 65);
            const wetBand = smoothstep(-0.09, 0.0, localDepth); // Wet dark sand near water
            let rCol: Vec3 = isBeach
              ? [0.9 - wetBand * 0.22 + grain * 0.05, 0.83 - wetBand * 0.21 + grain * 0.04, 0.68 - wetBand * 0.18]
              : [0.44 - wetBand * 0.14 + grain * 0.08, 0.42 - wetBand * 0.13 + grain * 0.07, 0.39 - wetBand * 0.11 + grain * 0.06];
            data[idx] = Math.round(clamp(rCol[0]) * 255);
            data[idx + 1] = Math.round(clamp(rCol[1]) * 255);
            data[idx + 2] = Math.round(clamp(rCol[2]) * 255);
            data[idx + 3] = 255;
            continue;
          }

          // Wave Normal calculation: Single directional scroll vs Dual counter-panning waves
          const uvScaleX = u * 15;
          const uvScaleY = zPersp * 11;
          let nx = 0;
          let ny = 0;
          if (effWave === 'single') {
            const w1 = Math.sin(uvScaleX * 3.4 - t * 2.8) * 0.5 + Math.cos(uvScaleX * 6.8 - t * 5.6) * 0.22;
            nx = w1 * 0.34;
            ny = 0.03;
          } else {
            // Layer 1: NE travel; Layer 2: NW travel at golden-ratio scale
            const n1x =
              Math.cos(uvScaleX * 2.5 + uvScaleY * 1.6 - t * 2.1) * 0.22 +
              (valueNoise(uvScaleX * 2.8 - t * 1.1, uvScaleY * 2.4 + t * 0.8) - 0.5) * 0.35;
            const n2x =
              Math.sin(-uvScaleX * 3.7 + uvScaleY * 2.9 - t * 1.75) * 0.18 +
              (valueNoise(uvScaleX * 4.9 + t * 1.35, uvScaleY * 4.3 - t * 1.05) - 0.5) * 0.28;
            nx = (n1x + n2x) * 0.68;
            ny = (n1x - n2x) * 0.58;
          }
          const N = norm3([nx, 1.0, ny]);

          // ③ Underwater Refraction offset (IOR 1.33 wobble scaled by depth)
          const refractFade = clamp(localDepth / 0.35, 0, 1);
          const refU = u + nx * 0.036 * effRefract * refractFade;
          const refV = zPersp + ny * 0.045 * effRefract * refractFade;

          // Pool bed pattern: white sand tiles + pebbles + step risers + caustic shimmer
          const tileGrid =
            Math.abs(((refU * 22) % 1 + 1) % 1 - 0.5) > 0.46 ||
            Math.abs(((refV * 14) % 1 + 1) % 1 - 0.5) > 0.46
              ? 0.82
              : 1.0;
          const pebbleHash = voronoiInfo(refU * 26, refV * 18);
          const isPebble = pebbleHash.f1 < 0.24 && pebbleHash.cellId > 0.68;
          let bedCol: Vec3 = [0.91 * tileGrid, 0.86 * tileGrid, 0.74 * tileGrid];
          if (isPebble) {
            bedCol =
              pebbleHash.cellId > 0.85
                ? [0.76, 0.48, 0.36]
                : [0.55, 0.62, 0.66];
          }
          // Darken step vertical risers slightly for clear 3D step readability
          const riserShadow =
            Math.exp(-Math.pow((refU - 0.32) / 0.014, 2)) * 0.26 +
            Math.exp(-Math.pow((refU - 0.69) / 0.015, 2)) * 0.28 +
            Math.exp(-Math.pow((refU - 0.81) / 0.018, 2)) * 0.32;
          bedCol = [
            bedCol[0] * (1 - riserShadow),
            bedCol[1] * (1 - riserShadow),
            bedCol[2] * (1 - riserShadow),
          ];

          // Underwater dancing sunlight caustics (stronger when dual waves + refraction on)
          const causticVor = voronoiInfo(
            refU * 18 + Math.sin(t * 1.4) * 0.5,
            refV * 14 - t * 0.9
          );
          const causticLine = Math.pow(saturate(1 - causticVor.edge * 3.2), 3.0);
          const causticAmp = effRefract * (effWave === 'dual' ? 0.36 : 0.14) * Math.exp(-localDepth * 0.35);
          bedCol = [
            bedCol[0] + causticLine * causticAmp * 1.05,
            bedCol[1] + causticLine * causticAmp * 1.0,
            bedCol[2] + causticLine * causticAmp * 0.85,
          ];

          let finalCol: Vec3;

          if (isPitfall) {
            // PITFALL: Flat uniform sky-blue plastic translucent sheet!
            const flatBlue: Vec3 = [0.16, 0.54, 0.92];
            const plasticAlpha = 0.62;
            const spec = Math.pow(Math.max(0, N[0] * 0.35 + N[1] * 0.92), 42) * 0.35;
            finalCol = [
              lerp(bedCol[0], flatBlue[0], plasticAlpha) + spec,
              lerp(bedCol[1], flatBlue[1], plasticAlpha) + spec,
              lerp(bedCol[2], flatBlue[2], plasticAlpha) + spec,
            ];
          } else {
            // ① UE 5.8 Single Layer Water BSDF: Beer-Lambert absorption + water volume scattering!
            // Two-way optical path (down from sun + up to camera)
            const opticalPath = localDepth * 2.05;
            // Water absorbs Red ~1.95x, Green ~0.34x, Blue ~0.085x
            const transR = Math.exp(-effAbs * 1.95 * opticalPath);
            const transG = Math.exp(-effAbs * 0.34 * opticalPath);
            const transB = Math.exp(-effAbs * 0.085 * opticalPath);

            // In-scattered emerald/azure water volume glow where light hasn't reached bottom
            const inScat: Vec3 = [
              0.025 * (1 - transR),
              0.27 * (1 - transG),
              0.44 * (1 - transB),
            ];

            const subWater: Vec3 = [
              bedCol[0] * transR + inScat[0],
              bedCol[1] * transG + inScat[1],
              bedCol[2] * transB + inScat[2],
            ];

            // Water surface Fresnel (F0 = 0.02 for water!) + Sky reflection + Sun sparkle
            const V = norm3([0, lerp(0.82, 0.38, 1 - zPersp), 0.58]);
            const NdotV = clamp(dot3(N, V), 0.02, 1);
            const fresnel = 0.02 + 0.98 * Math.pow(1 - NdotV, 5);
            const R = reflect3([-V[0], -V[1], -V[2]], N);
            const skyRefl = sampleEnvMap(R, 0.06, 'sunny');
            const L = norm3([0.46, 0.74, 0.48]);
            const Hvec = norm3([V[0] + L[0], V[1] + L[1], V[2] + L[2]]);
            const sunSpec = Math.pow(Math.max(0, dot3(N, Hvec)), 150) * 1.65;

            const shadedWater: Vec3 = [
              lerp(subWater[0], skyRefl[0] * 0.85, fresnel) + sunSpec,
              lerp(subWater[1], skyRefl[1] * 0.88, fresnel) + sunSpec * 0.97,
              lerp(subWater[2], skyRefl[2] * 0.92, fresnel) + sunSpec * 0.88,
            ];

            // The course scene supplies water depth directly from its modelled seabed.
            const fadeMeters = effFoamCm * 0.01;
            let foamMask = 0;
            if (fadeMeters > 0 && localDepth < fadeMeters) {
              const band = 1 - saturate(localDepth / fadeMeters);
              const foamCells = voronoiInfo(u * 48 + t * 0.45, zPersp * 32 - t * 0.35);
              const rippleRing = Math.sin(localDepth * 42 - t * 3.8) * 0.5 + 0.5;
              const lacy = smoothstep(0.22, 0.03, foamCells.edge) * 0.75 + rippleRing * 0.45;
              foamMask = saturate(band * lacy);
            }
            finalCol = lerp3(shadedWater, [0.96, 0.98, 1.0], foamMask);
          }

          data[idx] = Math.round(clamp(finalCol[0]) * 255);
          data[idx + 1] = Math.round(clamp(finalCol[1]) * 255);
          data[idx + 2] = Math.round(clamp(finalCol[2]) * 255);
          data[idx + 3] = 255;
        }
      }

      offCtx.putImageData(imgData, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(offCanvas, 0, 0, W, H);

      // Vector Depth Badges & Step Labels overlaid cleanly
      ctx.font = '700 11px "Noto Sans SC", sans-serif';
      const drawBadge = (x: number, y: number, text: string, bg = 'rgba(16,22,30,0.76)', fg = '#fff') => {
        const w = ctx.measureText(text).width + 12;
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - 10, w, 20, 6);
        ctx.fill();
        ctx.fillStyle = fg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y);
      };

      drawBadge(W * 0.21, H - 18, '浅水台阶 0.28m (白沙透亮)');
      drawBadge(W * 0.5, H * 0.21, '露出礁石');
      drawBadge(W * 0.89, H - 18, '深水海沟 3.6m (红光吸收)');

      if (effFoamCm === 0) {
        drawBadge(W * 0.13, H * 0.48, '未添加岸沫', 'rgba(185,38,26,0.9)', '#fff');
      }

      // Optional Step 2 Microscopic RGB Beer-Lambert Ray Diagram Overlay!
      if (raysOverlay) {
        const drawRayBundle = (cx: number, topY: number, botY: number, isDeep: boolean) => {
          const colors = [
            { col: '#ff4d4d', label: 'R', stopFrac: isDeep ? clamp(0.32 / Math.max(0.35, effAbs), 0.18, 0.95) : 0.95 },
            { col: '#34d399', label: 'G', stopFrac: 1.0 },
            { col: '#60a5fa', label: 'B', stopFrac: 1.0 },
          ];
          ctx.save();
          ctx.fillStyle = 'rgba(12, 18, 28, 0.72)';
          ctx.beginPath();
          ctx.roundRect(cx - 46, topY - 8, 92, botY - topY + 28, 8);
          ctx.fill();

          colors.forEach((c, i) => {
            const rx = cx + (i - 1) * 20;
            const endY = lerp(topY + 12, botY, c.stopFrac);
            ctx.strokeStyle = c.col;
            ctx.lineWidth = 2.6;
            ctx.beginPath();
            ctx.moveTo(rx, topY + 8);
            ctx.lineTo(rx, endY);
            ctx.stroke();

            // Arrowhead or X if absorbed
            ctx.fillStyle = c.col;
            if (isDeep && i === 0 && effAbs > 0.35) {
              ctx.font = '800 11px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText('✕被水吃掉', rx + 8, endY + 10);
            } else {
              // Bounce up dashed arrow
              ctx.setLineDash([3, 3]);
              ctx.beginPath();
              ctx.moveTo(rx + 4, botY);
              ctx.lineTo(rx + 6, topY + 14);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          });
          ctx.restore();
        };

        drawRayBundle(W * 0.22, H * 0.3, H * 0.62, false);
        drawRayBundle(W * 0.88, H * 0.3, H * 0.84, true);
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [isPitfall, effAbs, effWave, effRefract, effFoamCm, raysOverlay, isDark]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={isPitfall}
        pitfallLabel="死板蓝塑料片（Translucent 硬涂蓝 · 单向平移波纹 · 岸边刀割硬切线）"
        correctLabel="UE 5.8 Single Layer Water（红光深度吸收 · 双层交错波浪 · 浅水带岸沫）"
        onToggle={setIsPitfall}
      />

      <div style={stageCanvasWrapStyle}>
        <canvas
          ref={canvasRef}
          width={640}
          height={272}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </div>

      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSlider
            label="① 红光深度吸收浓度 (Beer-Lambert)"
            value={absorption}
            min={0}
            max={2.0}
            step={0.05}
            formatValue={(v) => (v < 0.08 ? `${v.toFixed(2)} (无吸收清水)` : `${v.toFixed(2)}×`)}
            onChange={(v) => {
              setIsPitfall(false);
              setAbsorption(v);
            }}
          />

          <StageSegmented
            label="② 波浪法线滚动方式"
            value={waveMode}
            options={[
              { value: 'single', label: '单向死板平移' },
              { value: 'dual', label: '双层反向交错波浪' },
            ]}
            onChange={(v) => {
              setIsPitfall(false);
              setWaveMode(v);
            }}
          />

          <StageSlider
            label="③ 水下折射扰动（网页振幅）"
            value={refractionAmt}
            min={0}
            max={1.2}
            step={0.05}
            formatValue={(v) => (v === 0 ? '关闭折射' : `${v.toFixed(2)}×`)}
            onChange={(v) => {
              setIsPitfall(false);
              setRefractionAmt(v);
            }}
          />

          <StageSlider
            label="④ 岸沫覆盖的浅水深度"
            value={foamWidthCm}
            min={0}
            max={60}
            step={2}
            unit=" cm"
            onChange={(v) => {
              setIsPitfall(false);
              setFoamWidthCm(v);
            }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <StageToggle
            label="显示 RGB 阳光入水衰减透视图"
            checked={raysOverlay}
            onChange={setShowLightRays}
            hint="看红光如何半路被吃掉"
          />
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 10.2 STAGE: 🍷 清透玻璃（“灰塑料膜”四步蜕变水晶与彩绘花窗实验台）
 * ============================================================================ */

function sampleGalleryRoom(rx: number, ry: number): Vec3 {
  // rx in [-1.5..1.5], ry in [-1..1] (ry > 0 upper colorful wall, ry < -0.35 sunlit floor)
  if (ry < -0.36) {
    // Warm wooden parquet floor
    const fx = rx / Math.max(0.18, -ry);
    const fz = 1.0 / Math.max(0.18, -ry);
    const check = (Math.floor(fx * 1.8) + Math.floor(fz * 1.8)) & 1;
    return check ? [0.58, 0.44, 0.3] : [0.44, 0.33, 0.22];
  }

  // Colorful stained-gallery backdrop tiles + diagonal brass drinking-straw rod!
  const strawLine = Math.abs(rx - (ry * 0.62 + 0.05));
  if (strawLine < 0.048) {
    // Bright striped coral/gold straw behind the glass so bending & inversion is super clear!
    const stripe = Math.sin((rx + ry) * 38) > 0 ? 1 : 0;
    return stripe ? [0.98, 0.34, 0.22] : [0.99, 0.92, 0.72];
  }

  const colIdx = ((Math.floor((rx + 2.4) * 2.6) % 4) + 4) % 4;
  const rowIdx = ((Math.floor((ry + 1.4) * 2.6) % 3) + 3) % 3;
  const gridMortar =
    Math.abs((((rx + 2.4) * 2.6) % 1) - 0.5) > 0.44 ||
    Math.abs((((ry + 1.4) * 2.6) % 1) - 0.5) > 0.44;
  if (gridMortar) return [0.92, 0.9, 0.86];

  const palette: Vec3[] = [
    [0.86, 0.38, 0.28], // Terracotta
    [0.2, 0.56, 0.78],  // Cobalt sky
    [0.9, 0.72, 0.26],  // Warm gold
    [0.24, 0.66, 0.48], // Emerald
  ];
  const c = palette[(colIdx + rowIdx) % 4];
  return [c[0], c[1], c[2]];
}

const GlassRefractionStage: React.FC<LessonStageProps> = ({
  onKpiUpdate,
  resetSignal,
}) => {
  const [isPitfall, setIsPitfall] = useState(false);
  const [lightingMode, setLightingMode] = useState<'unlit_trans' | 'forward_surface'>('forward_surface'); // ①
  const [useFresnel, setUseFresnel] = useState(true); // ②
  const [roughness, setRoughness] = useState(0.04); // ③ Frosted blur 0..0.6
  const [glassMode, setGlassMode] = useState<'thick_crystal' | 'thin_stained'>('thick_crystal'); // ④
  const [ior, setIor] = useState(1.52); // 1.00 .. 2.40
  const [bakedShadow, setBakedShadow] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const kpiRef = useRef(onKpiUpdate);
  kpiRef.current = onKpiUpdate;

  const lastResetRef = useRef(resetSignal);
  useEffect(() => {
    if (lastResetRef.current !== resetSignal) {
      lastResetRef.current = resetSignal;
      setIsPitfall(false);
      setLightingMode('forward_surface');
      setUseFresnel(true);
      setRoughness(0.04);
      setGlassMode('thick_crystal');
      setIor(1.52);
      setBakedShadow(true);
    }
  }, [resetSignal]);

  const effLight = isPitfall ? 'unlit_trans' : lightingMode;
  const effFresnel = useFresnel;
  const effRough = roughness;
  const effIor = glassMode === 'thin_stained' ? 1.0 : ior;

  useEffect(() => {
    kpiRef.current([
      {
        label: '半透明照明模式',
        value: effLight === 'forward_surface' ? 'Surface ForwardShading' : '无高光 (灰塑料膜)',
        tone: effLight === 'forward_surface' ? 'good' : 'bad',
      },
      {
        label: '菲涅尔边缘控透',
        value: effFresnel ? '掠射角反射增强' : '全表面死板均透',
        tone: effFresnel ? 'good' : 'warn',
      },
      {
        label: '磨砂粗糙度 Roughness',
        value: effRough < 0.08 ? `${effRough.toFixed(2)} (清透水晶)` : `${effRough.toFixed(2)} (冰镇毛玻璃)`,
        tone: 'accent',
      },
      {
        label: '形态与折射率 IOR',
        value:
          glassMode === 'thin_stained'
            ? (bakedShadow ? '静态灯 / Lightmass 彩影' : 'Lumen GI · 无透射彩影')
            : `IOR ${effIor.toFixed(2)}${effIor > 1.85 ? ' (钻石强倒置)' : ''}`,
        tone: isPitfall ? 'bad' : 'good',
      },
    ]);
  }, [isPitfall, effLight, effFresnel, effRough, glassMode, effIor, bakedShadow]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 640;
    const H = 272;
    const bufW = 320;
    const bufH = 136;
    const off = document.createElement('canvas');
    off.width = bufW;
    off.height = bufH;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    const img = offCtx.createImageData(bufW, bufH);
    const d = img.data;

    // 9-tap Poisson kernel for frosted glass transmission blur
    const taps: [number, number][] = [
      [0, 0],
      [0.85, 0.15],
      [-0.78, 0.35],
      [0.25, -0.88],
      [-0.32, 0.82],
      [0.62, 0.65],
      [-0.68, -0.58],
      [0.95, -0.42],
      [-0.12, -0.45],
    ];

    const cx = 0.0;
    const cy = 0.08;
    const rad = 0.56;

    for (let py = 0; py < bufH; py++) {
      const nyScreen = 1.0 - (py / bufH) * 2.0; // +1 top, -1 bottom
      for (let px = 0; px < bufW; px++) {
        const nxScreen = ((px / bufW) * 2.0 - 1.0) * (W / H) * 0.56;
        const idx = (py * bufW + px) * 4;

        // Background room + floor shadow / stained-glass colored projection!
        let bg = sampleGalleryRoom(nxScreen, nyScreen);

        // Floor shadow / stained caustic projection beneath the glass object
        if (nyScreen < -0.36) {
          const shX = (nxScreen - 0.18) / 0.52;
          const shY = (nyScreen + 0.64) / 0.19;
          const shDist = Math.hypot(shX, shY);
          if (shDist < 1.05) {
            const mask = smoothstep(1.05, 0.55, shDist);
            if (bakedShadow && glassMode === 'thin_stained') {
              // Colorful stained rose-window shadow patch on wooden floor!
              const ang = Math.atan2(shY, shX);
              const seg = ((Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 8) % 4) + 4) % 4;
              const stainCols: Vec3[] = [
                [1.35, 0.28, 0.35],
                [0.25, 0.95, 1.35],
                [1.35, 1.05, 0.22],
                [0.32, 1.28, 0.65],
              ];
              const sc = stainCols[seg];
              bg = [
                bg[0] * lerp(1, sc[0] * 1.15, mask * 0.88),
                bg[1] * lerp(1, sc[1] * 1.15, mask * 0.88),
                bg[2] * lerp(1, sc[2] * 1.15, mask * 0.88),
              ];
            } else if (effIor > 1.15) {
              // Thick crystal focusing caustic bright core + darker outer shadow ring!
              const causticFocus = Math.exp(-shDist * shDist * 5.2) * (1 - effRough) * 0.65;
              bg = [
                bg[0] * (1 - mask * 0.42) + causticFocus * 0.55,
                bg[1] * (1 - mask * 0.42) + causticFocus * 0.52,
                bg[2] * (1 - mask * 0.42) + causticFocus * 0.45,
              ];
            } else {
              bg = [bg[0] * (1 - mask * 0.32), bg[1] * (1 - mask * 0.32), bg[2] * (1 - mask * 0.32)];
            }
          }
        }

        // Check goblet stem & foot at bottom of sphere for thick_crystal, or gothic frame for thin_stained
        const dx = nxScreen - cx;
        const dy = nyScreen - cy;
        const r2 = dx * dx + dy * dy;

        if (r2 <= rad * rad) {
          const uDisk = dx / rad;
          const vDisk = dy / rad;
          const zDisk = Math.sqrt(Math.max(0.001, 1 - uDisk * uDisk - vDisk * vDisk));

          // Normal: flat window with slight bevel for thin_stained, true 3D sphere for thick_crystal
          const N: Vec3 =
            glassMode === 'thin_stained'
              ? norm3([uDisk * 0.14, vDisk * 0.14, 0.98])
              : norm3([uDisk, vDisk, zDisk]);
          const V: Vec3 = [0, 0, 1];
          const NdotV = clamp(dot3(N, V), 0.01, 1);

          // Refracted lookup ray via Snell's law
          let refrX = nxScreen;
          let refrY = nyScreen;
          if (effIor > 1.005) {
            // Double-interface thick crystal sphere bending (inverts cleanly at high IOR!)
            const eta = 1.0 / effIor;
            const k = 1 - eta * eta * (1 - NdotV * NdotV);
            if (k > 0) {
              const refrCoeff = eta * NdotV - Math.sqrt(k);
              const dirX = refrCoeff * N[0];
              const dirY = refrCoeff * N[1];
              // Ray travels through sphere thickness ~ 2 * zDisk and bends again on exit
              const bendScale = (effIor - 1.0) * 1.28;
              refrX = nxScreen + dirX * bendScale * 1.45 - uDisk * Math.max(0, effIor - 1.55) * 1.15;
              refrY = nyScreen + dirY * bendScale * 1.45 - vDisk * Math.max(0, effIor - 1.55) * 1.15;
            }
          }

          // Sample background with Roughness blur kernel (frosted glass!)
          const blurRadius = effRough * effRough * 0.62 + effRough * 0.08;
          let transCol: Vec3 = [0, 0, 0];
          const numTaps = effRough > 0.02 ? taps.length : 1;
          for (let ti = 0; ti < numTaps; ti++) {
            const sx = refrX + taps[ti][0] * blurRadius;
            const sy = refrY + taps[ti][1] * blurRadius;
            const s = sampleGalleryRoom(sx, sy);
            transCol[0] += s[0];
            transCol[1] += s[1];
            transCol[2] += s[2];
          }
          transCol = [transCol[0] / numTaps, transCol[1] / numTaps, transCol[2] / numTaps];

          // Apply stained rose-window color absorption (Transmittance-To-MFP) or subtle crystal green-cyan edge absorption
          if (glassMode === 'thin_stained') {
            const ang = Math.atan2(vDisk, uDisk);
            const ringR = Math.hypot(uDisk, vDisk);
            const leadLine =
              Math.abs(ringR - 0.52) < 0.028 ||
              ringR > 0.94 ||
              Math.abs(Math.sin(ang * 4)) < 0.045 / Math.max(0.18, ringR);
            if (leadLine) {
              d[idx] = 36;
              d[idx + 1] = 34;
              d[idx + 2] = 38;
              d[idx + 3] = 255;
              continue;
            }
            const seg = ((Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 8) % 4) + 4) % 4;
            const tints: Vec3[] = [
              [0.96, 0.25, 0.32],
              [0.24, 0.78, 0.98],
              [0.98, 0.78, 0.2],
              [0.26, 0.9, 0.52],
            ];
            const tint = ringR < 0.52 ? tints[(seg + 1) % 4] : tints[seg];
            transCol = [transCol[0] * tint[0], transCol[1] * tint[1], transCol[2] * tint[2]];
          } else {
            // Subtle thick optical glass iron tint on thicker path
            const path = 1 - zDisk * 0.6;
            transCol = [transCol[0] * (1 - 0.08 * path), transCol[1] * (1 - 0.02 * path), transCol[2] * (1 - 0.04 * path)];
          }

          let outCol: Vec3;
          if (effLight === 'unlit_trans') {
            // ① PITFALL / Volumetric NonDirectional: NO specular highlight, looks like murky grey plastic wrap!
            const greyFilm: Vec3 = [0.58, 0.6, 0.63];
            const flatOpacity = effFresnel ? lerp(0.18, 0.68, Math.pow(1 - NdotV, 3.5)) : 0.38;
            outCol = lerp3(transCol, greyFilm, flatOpacity);
          } else {
            // ① Surface ForwardShading: Crisp arched studio window reflection + GGX sun highlight + Fresnel!
            const opticalIor = glassMode === 'thin_stained' ? 1.52 : effIor;
            const f0 = Math.pow((opticalIor - 1) / (opticalIor + 1), 2);
            const fresnel = effFresnel
              ? f0 + (1 - f0) * Math.pow(1 - NdotV, 5)
              : 0.16;

            const R = reflect3([0, 0, -1], N);
            const envSpec = sampleEnvMap(R, effRough, 'studio');

            // Studio arched window highlight on upper-left of crystal!
            const L = norm3([-0.46, 0.54, 0.7]);
            const Hvec = norm3([L[0], L[1], L[2] + 1]);
            const specExp = lerp(240, 9, clamp(effRough / 0.6, 0, 1));
            const specPeak = lerp(2.6, 0.35, clamp(effRough / 0.6, 0, 1));
            const winSpec = Math.pow(Math.max(0, dot3(N, Hvec)), specExp) * specPeak;

            // Secondary rim bounce on lower-right
            const L2 = norm3([0.58, -0.45, 0.68]);
            const H2 = norm3([L2[0], L2[1], L2[2] + 1]);
            const rimSpec = Math.pow(Math.max(0, dot3(N, H2)), lerp(90, 6, clamp(effRough / 0.6, 0, 1))) * 0.65;

            const reflTotal: Vec3 = [
              envSpec[0] + winSpec + rimSpec * 0.9,
              envSpec[1] + winSpec * 0.99 + rimSpec * 0.95,
              envSpec[2] + winSpec * 0.96 + rimSpec * 1.05,
            ];

            outCol = [
              transCol[0] * (1 - fresnel) + reflTotal[0] * fresnel + winSpec * 0.55,
              transCol[1] * (1 - fresnel) + reflTotal[1] * fresnel + winSpec * 0.55,
              transCol[2] * (1 - fresnel) + reflTotal[2] * fresnel + winSpec * 0.55,
            ];
            outCol = [
              linearToSrgb(acesTonemap(outCol[0])),
              linearToSrgb(acesTonemap(outCol[1])),
              linearToSrgb(acesTonemap(outCol[2])),
            ];
          }

          d[idx] = Math.round(clamp(outCol[0]) * 255);
          d[idx + 1] = Math.round(clamp(outCol[1]) * 255);
          d[idx + 2] = Math.round(clamp(outCol[2]) * 255);
          d[idx + 3] = 255;
        } else {
          d[idx] = Math.round(clamp(bg[0]) * 255);
          d[idx + 1] = Math.round(clamp(bg[1]) * 255);
          d[idx + 2] = Math.round(clamp(bg[2]) * 255);
          d[idx + 3] = 255;
        }
      }
    }

    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, W, H);

    // Annotations
    ctx.font = '700 11.5px "Noto Sans SC", sans-serif';
    ctx.fillStyle = 'rgba(18, 16, 15, 0.78)';
    ctx.beginPath();
    ctx.roundRect(12, 10, 215, 24, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('背景斜插彩吸管 + 暖色格纹墙', 20, 26);

    if (glassMode === 'thin_stained') {
      ctx.fillStyle = 'rgba(18, 16, 15, 0.8)';
      ctx.beginPath();
      ctx.roundRect(W - 228, H - 34, 216, 24, 6);
      ctx.fill();
      ctx.fillStyle = '#fde68a';
      ctx.fillText(bakedShadow ? '静态灯 / Lightmass 彩影示意' : 'Lumen GI · 无透射彩影', W - 220, H - 18);
    } else if (effLight === 'unlit_trans') {
      ctx.fillStyle = 'rgba(180, 36, 24, 0.9)';
      ctx.beginPath();
      ctx.roundRect(W - 235, 10, 223, 24, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText('⚠️ 丢失窗户高光 → 像灰蒙蒙保鲜膜!', W - 226, 26);
    }
  }, [isPitfall, effLight, effFresnel, effRough, glassMode, effIor, bakedShadow]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={isPitfall}
        pitfallLabel="体积照明近似（无表面高光）"
        correctLabel="Surface ForwardShading 表面高光"
        onToggle={setIsPitfall}
      />

      <div style={stageCanvasWrapStyle}>
        <canvas
          ref={canvasRef}
          width={640}
          height={272}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </div>

      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSegmented
            label="① Lighting Mode 半透明照明模式"
            value={lightingMode}
            options={[
              { value: 'unlit_trans', label: '默认无高光(灰塑料膜)' },
              { value: 'forward_surface', label: 'Surface ForwardShading' },
            ]}
            onChange={(v) => {
              setIsPitfall(false);
              setLightingMode(v);
            }}
          />

          <StageSegmented
            label="④ 薄彩窗 vs 厚实心水晶"
            value={glassMode}
            options={[
              { value: 'thick_crystal', label: '厚实心水晶折射球' },
              { value: 'thin_stained', label: '薄窗彩玻 (投彩色光影)' },
            ]}
            onChange={(v) => {
              setIsPitfall(false);
              setGlassMode(v);
            }}
          />

          <StageSlider
            label="③ Roughness 磨砂毛玻璃模糊度"
            value={roughness}
            min={0}
            max={0.6}
            step={0.02}
            formatValue={(v) => (v < 0.06 ? `${v.toFixed(2)} (清透)` : `${v.toFixed(2)} (雾面磨砂)`)}
            onChange={(v) => {
              setIsPitfall(false);
              setRoughness(v);
            }}
          />

          <StageSlider
            label="④ 实心折射率 IOR (1.0无偏折 → 2.4钻石)"
            value={ior}
            min={1.0}
            max={2.4}
            step={0.02}
            formatValue={(v) =>
              glassMode === 'thin_stained'
                ? '薄窗固定 1.00'
                : v < 1.05
                  ? '1.00 (空气)'
                  : v < 1.4
                    ? `${v.toFixed(2)} (水)`
                    : v < 1.75
                      ? `${v.toFixed(2)} (玻璃)`
                      : `${v.toFixed(2)} (钻石倒置)`
            }
            onChange={(v) => {
              setIsPitfall(false);
              setGlassMode('thick_crystal');
              setIor(v);
            }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {glassMode === 'thin_stained' && (
            <StageToggle label="地面彩影示意：静态灯 + CPU Lightmass" hint="关闭模拟 Lumen GI，窗面继续染色" checked={bakedShadow} onChange={setBakedShadow} />
          )}
          <StageToggle
            label="② 菲涅尔边缘控透 (Fresnel)"
            checked={useFresnel}
            onChange={(c) => {
              setIsPitfall(false);
              setUseFresnel(c);
            }}
            hint="正视高透 · 边缘掠射强反光"
          />
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 10.3 STAGE: 🌫️ 雾效与体积材质（丁达尔光柱 + Local Fog Volume + DepthFade 软雾片）
 * ============================================================================ */

const FogVolumetricsStage: React.FC<LessonStageProps> = ({
  onKpiUpdate,
  resetSignal,
}) => {
  const [isPitfall, setIsPitfall] = useState(false);
  const [sunAngleDeg, setSunAngleDeg] = useState(18); // -45 .. +45
  const [anisotropyG, setAnisotropyG] = useState(0.72); // 0 .. 0.88 Henyey-Greenstein g
  const [localFogOn, setLocalFogOn] = useState(true); // Volume-domain particle material with procedural density
  const [cardFadeCm, setCardFadeCm] = useState(85); // Foreground fog billboard DepthFade (0 .. 140 cm)

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const kpiRef = useRef(onKpiUpdate);
  kpiRef.current = onKpiUpdate;

  const lastResetRef = useRef(resetSignal);
  useEffect(() => {
    if (lastResetRef.current !== resetSignal) {
      lastResetRef.current = resetSignal;
      setIsPitfall(false);
      setSunAngleDeg(18);
      setAnisotropyG(0.72);
      setLocalFogOn(true);
      setCardFadeCm(85);
    }
  }, [resetSignal]);

  const effG = isPitfall ? 0.05 : anisotropyG;
  const effLocalFog = isPitfall ? false : localFogOn;
  const effCardFade = isPitfall ? 0 : cardFadeCm;

  useEffect(() => {
    kpiRef.current([
      {
        label: '前向散射系数 (g)',
        value: effG > 0.5 ? `g = ${effG.toFixed(2)} (丁达尔强光柱)` : `g = ${effG.toFixed(2)} (均匀平雾)`,
        tone: effG > 0.5 ? 'good' : 'neutral',
      },
      {
        label: '局部山谷迷雾',
        value: effLocalFog ? '粒子体积材质（噪声）' : '关闭 (仅全局平雾)',
        tone: effLocalFog ? 'accent' : 'neutral',
      },
      {
        label: '前景雾片 DepthFade',
        value: effCardFade === 0 ? '0 cm (穿地硬切线!)' : `${effCardFade} cm (无缝羽化)`,
        tone: effCardFade >= 35 ? 'good' : 'bad',
      },
      {
        label: 'UE 5.8 三级造雾组合',
        value: isPitfall ? '踩坑状态' : '体积雾 + 粒子 + 雾片',
        tone: isPitfall ? 'bad' : 'good',
      },
    ]);
  }, [isPitfall, effG, effLocalFog, effCardFade]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 640;
    const H = 272;
    const bufW = 320;
    const bufH = 136;
    const off = document.createElement('canvas');
    off.width = bufW;
    off.height = bufH;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    const img = offCtx.createImageData(bufW, bufH);
    const d = img.data;

    let animId = 0;
    const t0 = performance.now();

    // Canopy shadow gap mask along top of forest
    const isCanopyGap = (xCanopy: number): number => {
      // Returns [0..1] sunlight transmittance through forest canopy branches
      const wave =
        Math.sin(xCanopy * 23.0) * 0.5 +
        Math.cos(xCanopy * 41.0 + 1.2) * 0.35 +
        Math.sin(xCanopy * 11.0 - 0.6) * 0.35;
      return smoothstep(0.05, 0.38, wave);
    };

    const render = (now: number) => {
      const t = (now - t0) * 0.001;
      const sunX = 0.5 + (sunAngleDeg / 55) * 0.36;
      const sunY = 0.14;
      const slopeTan = Math.tan((sunAngleDeg * Math.PI) / 180) * 0.65;

      for (let py = 0; py < bufH; py++) {
        const v = py / bufH;
        for (let px = 0; px < bufW; px++) {
          const u = px / bufW;
          const idx = (py * bufW + px) * 4;

          // 1. Base layered forest valley + distant mountains (aerial perspective extinction)
          const sunDist = Math.hypot((u - sunX) * 1.45, v - sunY);
          const skyGlow = Math.exp(-sunDist * sunDist * 14);
          let col: Vec3 = lerp3([0.16, 0.25, 0.34], [0.95, 0.78, 0.46], skyGlow * 0.85 + (1 - v) * 0.18);

          // Mountain layer 1 (far, heavy extinction haze)
          const m1 = 0.42 + Math.sin(u * 5.5 + 0.4) * 0.08 + Math.cos(u * 13) * 0.03;
          if (v > m1) {
            col = lerp3([0.18, 0.26, 0.3], col, 0.68); // Faded by atmospheric extinction!
          }
          // Mountain layer 2 (mid pine ridge)
          const m2 = 0.54 + Math.sin(u * 8.2 + 2.1) * 0.07 + valueNoise(u * 28, 3.2) * 0.04;
          if (v > m2) {
            col = lerp3([0.09, 0.16, 0.15], col, 0.38);
          }

          // Foreground dark pine trunks & upper canopy leaves casting shadow gaps
          const trunkPattern = Math.abs(((u * 6.5 + 0.18) % 1) - 0.5);
          const isTrunk = trunkPattern < 0.042 && v < 0.84;
          const canopyBottom = 0.17 + valueNoise(u * 34, 1.7) * 0.09 - isCanopyGap(u) * 0.08;
          const inSolidTree = v < canopyBottom || isTrunk;
          if (inSolidTree) {
            col = [0.05, 0.08, 0.07];
          }

          // Sloped rocky valley ground at bottom (especially rising mound on right for Fog Card test!)
          const groundHeightV =
            0.84 -
            0.18 * smoothstep(0.46, 0.96, u) -
            0.03 * Math.sin(u * 19);
          const isGround = v >= groundHeightV;
          if (isGround) {
            const moss = fbm(u * 26, v * 26, 3);
            col = [0.11 + moss * 0.09, 0.14 + moss * 0.11, 0.09 + moss * 0.06];
          }

          // 2. Volumetric Fog Tyndall God Rays!
          // Trace pixel back toward canopy along sun ray direction
          if (!isGround && !inSolidTree) {
            const canopyHitU = u - (v - 0.12) * slopeTan;
            const shaftLight = isCanopyGap(canopyHitU);
            // Henyey-Greenstein forward scattering phase factor
            const cosTheta = clamp(1 - sunDist * 0.72, -1, 1);
            const g2 = effG * effG;
            const hg = (1 - g2) / Math.pow(Math.max(0.12, 1 + g2 - 2 * effG * cosTheta), 1.35);
            const hgNorm = clamp(hg * 0.18, 0.06, 1.65);

            const beamFade = smoothstep(0.95, 0.12, v);
            const godRay = shaftLight * hgNorm * beamFade * 0.52 + 0.06 * hgNorm;
            col = [
              col[0] + godRay * 1.05,
              col[1] + godRay * 0.84,
              col[2] + godRay * 0.48,
            ];
          }

          // 3. Volume-domain particle material with procedural density Swirling Lowland Mist in valley basin (v in 0.52..groundHeightV)
          if (effLocalFog && v > 0.48) {
            const heightMask =
              smoothstep(0.48, 0.68, v) * smoothstep(groundHeightV + 0.04, groundHeightV - 0.05, v);
            const n3d = fbm(u * 7.5 + t * 0.38, v * 9.0 - t * 0.18, 4);
            const wisp = smoothstep(0.32, 0.76, n3d) * heightMask;
            const mistLit: Vec3 = lerp3([0.52, 0.64, 0.68], [0.92, 0.84, 0.66], skyGlow * 0.6);
            col = lerp3(col, mistLit, clamp(wisp * 0.82, 0, 0.85));
          }

          // 4. Foreground Low-Cost Translucent Fog Billboard Card (placed at u in [0.50..0.95], v in [0.56..0.92])
          // Intersects the rising ground mound right along v == groundHeightV!
          if (u > 0.48 && u < 0.96 && v > 0.54 && v < 0.92 && v <= groundHeightV) {
            // Card soft radial vignette horizontally & top, BUT bottom hits ground before card's bottom edge!
            const cardU = (u - 0.48) / 0.48;
            const cardV = (v - 0.54) / 0.38;
            const cardEdgeFade =
              smoothstep(0, 0.18, cardU) *
              smoothstep(1, 0.82, cardU) *
              smoothstep(0, 0.28, cardV);
            const puffNoise = 0.55 + 0.45 * fbm(cardU * 5 - t * 0.22, cardV * 4, 3);

            // SceneDepth - PixelDepth proportional to vertical clearance above sloped ground mound!
            const groundDistCm = (groundHeightV - v) * 420; // in cm
            const depthFadeFactor =
              effCardFade > 1 ? saturate(groundDistCm / effCardFade) : 1.0;

            const cardAlpha = clamp(cardEdgeFade * puffNoise * 0.66 * depthFadeFactor, 0, 1);
            const cardCol: Vec3 = [0.78, 0.85, 0.88];
            col = lerp3(col, cardCol, cardAlpha);
          }

          d[idx] = Math.round(clamp(acesTonemap(col[0] * 1.15)) * 255);
          d[idx + 1] = Math.round(clamp(acesTonemap(col[1] * 1.15)) * 255);
          d[idx + 2] = Math.round(clamp(acesTonemap(col[2] * 1.15)) * 255);
          d[idx + 3] = 255;
        }
      }

      offCtx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, W, H);

      // Clean UI callout on the foreground Fog Billboard Card
      ctx.save();
      ctx.strokeStyle = effCardFade < 12 ? '#ff5a4f' : 'rgba(212, 236, 252, 0.65)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(W * 0.48, H * 0.54, W * 0.48, H * 0.36);
      ctx.setLineDash([]);

      ctx.font = '700 11px "Noto Sans SC", sans-serif';
      ctx.fillStyle = effCardFade < 12 ? 'rgba(185, 36, 24, 0.92)' : 'rgba(16, 24, 28, 0.8)';
      ctx.beginPath();
      ctx.roundRect(W * 0.52, H * 0.84, 265, 22, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(
        effCardFade < 12
          ? '⚠️ 前景雾片无 DepthFade：露出丑陋穿地刀割线!'
          : `✅ 前景雾片 DepthFade (${effCardFade}cm)：贴地柔和消隐`,
        W * 0.535,
        H * 0.84 + 15
      );
      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [sunAngleDeg, effG, effLocalFog, effCardFade, isPitfall]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={isPitfall}
        pitfallLabel="无前向散射死板平雾 + 前景雾片插进地面露出刀割直切线"
        correctLabel="丁达尔前向散射体积光柱 + 粒子材质噪声山岚 + DepthFade 软边雾片"
        onToggle={setIsPitfall}
      />

      <div style={stageCanvasWrapStyle}>
        <canvas
          ref={canvasRef}
          width={640}
          height={272}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </div>

      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSlider
            label="林间太阳角度"
            value={sunAngleDeg}
            min={-42}
            max={42}
            step={1}
            unit="°"
            onChange={setSunAngleDeg}
          />

          <StageSlider
            label="水滴前向散射系数 (Anisotropy g)"
            value={anisotropyG}
            min={0}
            max={0.86}
            step={0.02}
            formatValue={(v) => (v < 0.2 ? `${v.toFixed(2)} (平淡雾)` : `${v.toFixed(2)} (逆光金柱)`)}
            onChange={(v) => {
              setIsPitfall(false);
              setAnisotropyG(v);
            }}
          />

          <StageSlider
            label="前景雾片 DepthFade 软边距离"
            value={cardFadeCm}
            min={0}
            max={130}
            step={5}
            unit=" cm"
            onChange={(v) => {
              setIsPitfall(false);
              setCardFadeCm(v);
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center' }}>
            <StageToggle
              label="粒子体积材质 · 噪声山岚"
              checked={localFogOn}
              onChange={(c) => {
                setIsPitfall(false);
                setLocalFogOn(c);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 10.4 STAGE: ✨ 溶解消融与科幻能量护盾（水位切割双视图 + 穿石柱电弧护盾）
 * ============================================================================ */

const DissolveShieldStage: React.FC<LessonStageProps> = ({
  onKpiUpdate,
  resetSignal,
}) => {
  const [mode, setMode] = useState<'dissolve' | 'shield'>('dissolve');
  const [isPitfall, setIsPitfall] = useState(false);

  // Mode A: Dissolve states
  const [dissolveLevel, setDissolveLevel] = useState(0.46); // 0..1 water-level cut
  const [edgeWidth, setEdgeWidth] = useState(0.07); // glowing rim width
  const [hdrMultiplier, setHdrMultiplier] = useState(12); // ×1 dull paint vs ×12 HDR glow

  // Mode B: Sci-Fi Energy Shield states
  const [shieldPosX, setShieldPosX] = useState(0.54); // Drag across stone pillar at x=0.63!
  const [intersectWidth, setIntersectWidth] = useState(0.11); // 1 - DepthFade width
  const [fresnelRim, setFresnelRim] = useState(1.25);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const kpiRef = useRef(onKpiUpdate);
  kpiRef.current = onKpiUpdate;

  const lastResetRef = useRef(resetSignal);
  useEffect(() => {
    if (lastResetRef.current !== resetSignal) {
      lastResetRef.current = resetSignal;
      setIsPitfall(false);
      setDissolveLevel(0.46);
      setEdgeWidth(0.07);
      setHdrMultiplier(12);
      setShieldPosX(0.54);
      setIntersectWidth(0.11);
      setFresnelRim(1.25);
    }
  }, [resetSignal]);

  const effHdr = isPitfall ? 1.0 : hdrMultiplier;
  const effIntersectW = isPitfall ? 0.0 : intersectWidth;

  useEffect(() => {
    if (mode === 'dissolve') {
      kpiRef.current([
        {
          label: '当前特效台',
          value: '噪波烧蚀溶解 (Masked)',
          tone: 'accent',
        },
        {
          label: '溶解水位线进度',
          value: `Noise ≥ ${dissolveLevel.toFixed(2)} 保留`,
          tone: 'neutral',
        },
        {
          label: '蚀刻火边 HDR 倍率',
          value: effHdr <= 1.2 ? `×${effHdr.toFixed(0)} (死板橘油漆)` : `×${effHdr.toFixed(0)} (触发璀璨辉光)`,
          tone: effHdr > 3 ? 'good' : 'bad',
        },
        {
          label: '样本 Noise = 0.49',
          value: 0.49 < dissolveLevel ? '已裁掉' : 0.49 < dissolveLevel + edgeWidth ? '保留且发光' : '保留，无火边',
          tone: 'good',
        },
      ]);
    } else {
      const distToPillar = Math.abs(shieldPosX - 0.62);
      const touchingPillar = distToPillar < 0.27;
      kpiRef.current([
        {
          label: '当前特效台',
          value: '科幻六边形能量护盾',
          tone: 'accent',
        },
        {
          label: '石柱碰撞检测',
          value: touchingPillar ? '⚡ 正在穿插石柱!' : '未接触石柱 (仅贴地面)',
          tone: touchingPillar ? 'good' : 'neutral',
        },
        {
          label: '反转 DepthFade 电弧环',
          value: effIntersectW > 0.01 ? `开启 (宽 ${(effIntersectW * 100).toFixed(0)}cm)` : '关闭 (穿墙生硬死切!)',
          tone: effIntersectW > 0.01 ? 'good' : 'bad',
        },
        {
          label: '轮廓通透控制',
          value: `Fresnel ×${fresnelRim.toFixed(2)}`,
          tone: 'good',
        },
      ]);
    }
  }, [mode, isPitfall, dissolveLevel, edgeWidth, effHdr, shieldPosX, effIntersectW, fresnelRim]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 640;
    const H = 272;
    const off = document.createElement('canvas');
    off.width = 320;
    off.height = 136;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    const img = offCtx.createImageData(320, 136);
    const d = img.data;

    let animId = 0;
    const t0 = performance.now();

    const render = (now: number) => {
      const t = (now - t0) * 0.001;

      if (mode === 'dissolve') {
        // Left half (px < 164): 3D Obsidian/Titanium Sentinel Armor Orb dissolving!
        // Right half (px >= 164): Live background dark panel for crisp 2D Noise Water-Level Cross-Section!
        const L = norm3([-0.45, 0.65, 0.61]);
        for (let py = 0; py < 136; py++) {
          const ny = 1 - (py / 136) * 2;
          for (let px = 0; px < 320; px++) {
            const idx = (py * 320 + px) * 4;
            if (px >= 166) {
              d[idx] = 20;
              d[idx + 1] = 23;
              d[idx + 2] = 29;
              d[idx + 3] = 255;
              continue;
            }

            const nx = ((px / 166) * 2 - 1) * 1.15;
            const r2 = nx * nx + ny * ny;
            // Subtle dark workshop grid behind armor orb
            const grid = px % 14 === 0 || py % 14 === 0 ? 0.14 : 0.09;
            let col: Vec3 = [grid, grid * 1.05, grid * 1.2];

            if (r2 <= 0.76) {
              const rad = Math.sqrt(0.76);
              const uSphere = nx / rad;
              const vSphere = ny / rad;
              const zSphere = Math.sqrt(Math.max(0.001, 1 - uSphere * uSphere - vSphere * vSphere));

              // Sample continuous 2D fbm noise across rotating armor shell
              const rotAng = Math.atan2(uSphere, zSphere) + t * 0.35;
              const nVal = clamp(
                fbm(Math.cos(rotAng) * 2.2 + 3.1, vSphere * 2.4 + Math.sin(rotAng) * 1.2 + 1.7, 4) * 1.18,
                0.02,
                0.98
              );

              if (nVal >= dissolveLevel) {
                // Surviving armor surface (`OpacityMask = 1`)
                const panelGroove = Math.abs(Math.sin(vSphere * 9)) < 0.06 ? 0.45 : 1.0;
                const N = norm3([uSphere, vSphere, zSphere]);
                const rim = 1 - saturate((nVal - dissolveLevel) / edgeWidth);
                col = shadePbrPixel({
                  N,
                  V: [0, 0, 1],
                  L,
                  baseColorLinear: [0.18 * panelGroove, 0.21 * panelGroove, 0.27 * panelGroove],
                  emissiveLinear: [rim * effHdr, rim * effHdr * 0.28, rim * effHdr * 0.03],
                  metallic: 0.85,
                  roughness: 0.26,
                  envMode: 'studio',
                });
              }
            }

            d[idx] = Math.round(clamp(col[0]) * 255);
            d[idx + 1] = Math.round(clamp(col[1]) * 255);
            d[idx + 2] = Math.round(clamp(col[2]) * 255);
            d[idx + 3] = 255;
          }
        }

        offCtx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(off, 0, 0, W, H);

        // Rising sparks on left armor orb when HDR active
        if (effHdr > 3 && dissolveLevel > 0.05 && dissolveLevel < 0.95) {
          for (let s = 0; s < 12; s++) {
            const phase = ((t * 0.7 + s * 0.23) % 1);
            const sx = 95 + Math.sin(s * 4.1 + t) * 58;
            const sy = 195 - phase * 145;
            ctx.fillStyle = `rgba(255, ${150 + (s % 3) * 30}, 50, ${(1 - phase) * 0.85})`;
            ctx.beginPath();
            ctx.arc(sx, sy, 2.2 * (1 - phase * 0.5), 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Right Half: Live 2D Noise Reef Water-Level Cross-Section Diagram!
        const gx0 = 346;
        const gw = 274;
        const gyTop = 38;
        const gh = 186;
        const gyBot = gyTop + gh;

        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.lineWidth = 1;
        ctx.strokeRect(gx0, gyTop, gw, gh);

        // Water level Y
        const waterY = gyBot - dissolveLevel * gh;
        const rimTopY = gyBot - clamp(dissolveLevel + edgeWidth, 0, 1) * gh;

        // Fill submerged discard zone
        ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
        ctx.fillRect(gx0, waterY, gw, gyBot - waterY);

        // Fill narrow fire rim zone just above water level
        if (edgeWidth > 0.005) {
          ctx.fillStyle = effHdr > 3 ? 'rgba(251, 146, 60, 0.34)' : 'rgba(180, 95, 45, 0.25)';
          ctx.fillRect(gx0, rimTopY, gw, waterY - rimTopY);
        }

        // Plot 1D slice of Noise(x)礁石海拔曲线 coloring segments by fate!
        ctx.lineWidth = 3;
        let prevX = gx0;
        let prevY = gyBot;
        for (let i = 0; i <= 90; i++) {
          const uSlice = i / 90;
          const hVal = clamp(fbm(uSlice * 4.2 + 1.3, 2.6, 4) * 1.18, 0.04, 0.96);
          const cx = gx0 + uSlice * gw;
          const cy = gyBot - hVal * gh;
          if (i > 0) {
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(cx, cy);
            if (hVal < dissolveLevel) {
              ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
              ctx.setLineDash([3, 3]);
            } else if (hVal < dissolveLevel + edgeWidth) {
              ctx.strokeStyle = effHdr > 3 ? '#ff8c24' : '#b8622a';
              ctx.setLineDash([]);
            } else {
              ctx.strokeStyle = '#a3e635';
              ctx.setLineDash([]);
            }
            ctx.stroke();
          }
          prevX = cx;
          prevY = cy;
        }
        ctx.setLineDash([]);

        // Horizontal Water Cut Line
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(gx0, waterY);
        ctx.lineTo(gx0 + gw, waterY);
        ctx.stroke();

        ctx.font = '700 11.5px "Noto Sans SC", sans-serif';
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText('噪波礁石海拔剖面 (Noise 0~1)', gx0, gyTop - 11);

        ctx.font = '700 11px "Noto Sans SC", sans-serif';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`▲ 溶解水位线 = ${dissolveLevel.toFixed(2)} (水下 Masked 丢弃)`, gx0 + 6, Math.min(gyBot - 6, waterY + 14));
        ctx.fillStyle = effHdr > 3 ? '#fb923c' : '#cbd5e1';
        ctx.fillText(
          effHdr > 3 ? `🔥 岸边窄带 ×${effHdr.toFixed(0)} HDR 燃烧边` : '⚠️ 未乘 HDR 倍数：像死板橘色油漆',
          gx0 + 6,
          Math.max(gyTop + 14, rimTopY - 5)
        );
        ctx.restore();
      } else {
        // MODE B: Sci-Fi Hexagonal Energy Shield intersecting Stone Pillar & Courtyard Floor!
        // Stone pillar centered at u = 0.62, width radius = 0.075; Floor plane at v = 0.76
        const pillarU = 0.62;
        const pillarHalfW = 0.075;
        const floorStartV = 0.64;

        // Shield sphere centered at (shieldPosX, 0.64) with radius R = 0.25 in normalized aspect coords
        const aspect = 320 / 136;

        for (let py = 0; py < 136; py++) {
          const v = py / 136;
          for (let px = 0; px < 320; px++) {
            const u = px / 320;
            const idx = (py * 320 + px) * 4;

            // 1. Render opaque scene behind/inside shield + record pseudo SceneDepth zScene!
            // Lower z means closer to camera.
            let sceneCol: Vec3 = lerp3([0.07, 0.09, 0.14], [0.13, 0.16, 0.22], v);
            let zScene = 3.5; // Far background wall

            // Perspective floor from v = 0.64 (far z=1.65) to v = 1.0 (near z=0.45)
            if (v >= floorStartV) {
              const floorT = (v - floorStartV) / (1 - floorStartV);
              zScene = lerp(1.55, 0.45, floorT);
              const tileX = (u - 0.5) / Math.max(0.22, floorT + 0.22);
              const tileZ = 1.6 / Math.max(0.22, floorT + 0.22);
              const mortar =
                Math.abs(((tileX * 5) % 1 + 1) % 1 - 0.5) > 0.45 ||
                Math.abs(((tileZ * 5) % 1 + 1) % 1 - 0.5) > 0.45;
              const stone = mortar ? 0.12 : 0.22 + 0.05 * valueNoise(tileX * 12, tileZ * 12);
              sceneCol = [stone * 0.95, stone, stone * 1.12];
            }

            // Carved cylindrical stone pillar standing at z = 0.98, u in [pillarU +- pillarHalfW], v in [0.14..0.84]
            const duPillar = (u - pillarU) / pillarHalfW;
            if (Math.abs(duPillar) <= 1.0 && v >= 0.14 && v <= 0.84) {
              const cylZ = 0.98 - Math.sqrt(Math.max(0, 1 - duPillar * duPillar)) * 0.16;
              if (cylZ < zScene) {
                zScene = cylZ;
                const nxP = duPillar;
                const lightDot = Math.max(0.18, -nxP * 0.55 + 0.65);
                const flute = Math.sin(duPillar * 12) * 0.06;
                const rune = Math.abs(v - 0.42) < 0.015 ? 0.15 : 0;
                sceneCol = [
                  (0.34 + flute) * lightDot,
                  (0.35 + flute) * lightDot + rune * 0.4,
                  (0.39 + flute) * lightDot + rune * 0.6,
                ];
              }
            }

            // 2. Raycast Translucent Hex Energy Shield Sphere centered at (shieldPosX, 0.58, zCenter = 0.98)
            const sx = (u - shieldPosX) * aspect;
            const sy = v - 0.58;
            const shieldRad = 0.42;
            const sr2 = sx * sx + sy * sy;

            if (sr2 <= shieldRad * shieldRad) {
              const sz = Math.sqrt(Math.max(0.0005, shieldRad * shieldRad - sr2));
              const zShieldFront = 0.98 - sz * 0.62;

              // Depth test: only visible where shield front skin is in front of opaque scene!
              const depthDiff = zScene - zShieldFront;
              if (depthDiff >= 0) {
                const NdotV = clamp(sz / shieldRad, 0.02, 1);
                const fresnel = Math.pow(1 - NdotV, 2.8) * fresnelRim;

                // Animated hexagonal energy comb on sphere surface
                const hexU = Math.atan2(sx, sz) * 6.5;
                const hexV = (sy / shieldRad) * 9.5 - t * 0.55;
                const hEdge = hexEdgeDist(hexU, hexV);
                const hexLine = smoothstep(0.08, 0.015, hEdge);
                const scanWave = Math.pow(Math.sin(sy * 14 - t * 3.2) * 0.5 + 0.5, 6) * 0.35;

                // Magic: Inverted DepthFade (`1 - saturate(depthDiff / effIntersectW)`)!
                const invDepthFade =
                  effIntersectW > 0.005 ? Math.pow(1 - saturate(depthDiff / (effIntersectW * 2.1)), 2.2) : 0;

                const shieldIntensity =
                  fresnel * 0.92 + hexLine * (0.28 + fresnel * 0.55) + scanWave + invDepthFade * 2.65;
                const shieldAlpha = clamp(0.08 + fresnel * 0.62 + hexLine * 0.25 + invDepthFade * 0.92, 0, 1);

                const cyanCore: Vec3 = lerp3(
                  [0.08, 0.72, 1.0],
                  [0.75, 0.98, 1.0],
                  clamp(invDepthFade * 1.1 + fresnel * 0.35, 0, 1)
                );

                const outR = sceneCol[0] * (1 - shieldAlpha * 0.45) + cyanCore[0] * shieldIntensity * 0.68;
                const outG = sceneCol[1] * (1 - shieldAlpha * 0.45) + cyanCore[1] * shieldIntensity * 0.68;
                const outB = sceneCol[2] * (1 - shieldAlpha * 0.45) + cyanCore[2] * shieldIntensity * 0.68;

                sceneCol = [
                  linearToSrgb(acesTonemap(outR)),
                  linearToSrgb(acesTonemap(outG)),
                  linearToSrgb(acesTonemap(outB)),
                ];
              }
            }

            d[idx] = Math.round(clamp(sceneCol[0]) * 255);
            d[idx + 1] = Math.round(clamp(sceneCol[1]) * 255);
            d[idx + 2] = Math.round(clamp(sceneCol[2]) * 255);
            d[idx + 3] = 255;
          }
        }

        offCtx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(off, 0, 0, W, H);

        ctx.font = '700 11.5px "Noto Sans SC", sans-serif';
        ctx.fillStyle = 'rgba(15, 23, 34, 0.82)';
        ctx.beginPath();
        ctx.roundRect(12, 10, 272, 24, 6);
        ctx.fill();
        ctx.fillStyle = '#7dd3fc';
        ctx.fillText('💡 提示：可直接在画面上左右拖动能量护盾撞击石柱！', 20, 26);
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [mode, dissolveLevel, edgeWidth, effHdr, shieldPosX, effIntersectW, fresnelRim]);

  const updateShieldFromPointer = (clientX: number) => {
    if (mode !== 'shield' || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const u = clamp((clientX - rect.left) / rect.width, 0.18, 0.84);
    setShieldPosX(u);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <StageSegmented
          value={mode}
          options={[
            { value: 'dissolve', label: '🔥 模式 A：噪波烧蚀溶解 + 水位剖面' },
            { value: 'shield', label: '🛡️ 模式 B：科幻能量护盾穿石柱' },
          ]}
          onChange={(v) => {
            setIsPitfall(false);
            setMode(v);
          }}
        />
      </div>

      <PitfallCompareBar
        isPitfall={isPitfall}
        pitfallLabel={
          mode === 'dissolve'
            ? '溶解发光未乘 HDR 倍数（≤1.0 像涂了一圈死板的橘色颜料）'
            : '忘了加反转 DepthFade（护盾插进石柱与地板处死板生切，毫无交互感）'
        }
        correctLabel={
          mode === 'dissolve'
            ? 'Masked 水位切割 + 临水窄带乘 ×12 HDR 触发璀璨灼烧辉光'
            : 'Fresnel 外圈亮中间透 + (1 - DepthFade) 碰墙交界自动亮起高能电弧环'
        }
        onToggle={setIsPitfall}
      />

      <div
        style={{
          ...stageCanvasWrapStyle,
          cursor: mode === 'shield' ? 'ew-resize' : 'default',
        }}
        onMouseDown={(e) => {
          draggingRef.current = true;
          updateShieldFromPointer(e.clientX);
        }}
        onMouseMove={(e) => {
          if (draggingRef.current) updateShieldFromPointer(e.clientX);
        }}
        onMouseUp={() => {
          draggingRef.current = false;
        }}
        onMouseLeave={() => {
          draggingRef.current = false;
        }}
        onTouchMove={(e) => {
          if (e.touches[0]) updateShieldFromPointer(e.touches[0].clientX);
        }}
      >
        <canvas
          ref={canvasRef}
          width={640}
          height={272}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </div>

      <div className="stage-controls-panel">
        {mode === 'dissolve' ? (
          <div className="control-grid">
            <StageSlider
              label="溶解水位进度 (0 → 1)"
              value={dissolveLevel}
              min={0}
              max={1}
              step={0.01}
              onChange={setDissolveLevel}
            />
            <StageSlider
              label="发光火边宽度"
              value={edgeWidth}
              min={0.01}
              max={0.18}
              step={0.01}
              onChange={setEdgeWidth}
            />
            <StageSlider
              label="自发光 HDR 强度倍增"
              value={hdrMultiplier}
              min={1}
              max={20}
              step={1}
              formatValue={(v) => `×${v.toFixed(0)} HDR`}
              onChange={(v) => {
                setIsPitfall(false);
                setHdrMultiplier(v);
              }}
            />
          </div>
        ) : (
          <div className="control-grid">
            <StageSlider
              label="护盾横向位置 (拖过石柱测试!)"
              value={shieldPosX}
              min={0.18}
              max={0.84}
              step={0.01}
              onChange={setShieldPosX}
            />
            <StageSlider
              label="碰墙亮环宽度 (1 - DepthFade)"
              value={intersectWidth}
              min={0}
              max={0.22}
              step={0.01}
              formatValue={(v) => (v === 0 ? '关闭交界环' : `${(v * 100).toFixed(0)} cm`)}
              onChange={(v) => {
                setIsPitfall(false);
                setIntersectWidth(v);
              }}
            />
            <StageSlider
              label="Fresnel 边缘发光强度"
              value={fresnelRim}
              min={0.3}
              max={2.2}
              step={0.05}
              onChange={setFresnelRim}
            />
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
 * 10.5 STAGE: ❄️ 世界空间自动积雪与免 UV 三平面投射（翻滚巨石 + 拉伸砖墙双景台）
 * ============================================================================ */

const WorldSnowTriplanarStage: React.FC<LessonStageProps> = ({
  onKpiUpdate,
  resetSignal,
}) => {
  const [isPitfall, setIsPitfall] = useState(false);
  const [rockAngleDeg, setRockAngleDeg] = useState(145); // 0..360 arbitrary boulder roll!
  const [snowThreshold, setSnowThreshold] = useState(0.32); // -0.2 (heavy snow) .. 0.78 (light snow cap)
  const [useTriplanar, setUseTriplanar] = useState(true); // WorldAlignedTexture vs Stretched UV
  const [wallStretch, setWallStretch] = useState(4.6); // 1x .. 5x

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRockRef = useRef(false);
  const dragStartAngleRef = useRef({ x: 0, deg: 0 });

  const kpiRef = useRef(onKpiUpdate);
  kpiRef.current = onKpiUpdate;

  const lastResetRef = useRef(resetSignal);
  useEffect(() => {
    if (lastResetRef.current !== resetSignal) {
      lastResetRef.current = resetSignal;
      setIsPitfall(false);
      setRockAngleDeg(145);
      setSnowThreshold(0.32);
      setUseTriplanar(true);
      setWallStretch(4.6);
    }
  }, [resetSignal]);

  const effTriplanar = isPitfall ? false : useTriplanar;

  useEffect(() => {
    const coverPct = Math.round(clamp((1 - snowThreshold) * 62, 5, 95));
    kpiRef.current([
      {
        label: '岩石翻滚姿态',
        value: `${Math.round(rockAngleDeg)}° ${rockAngleDeg > 110 && rockAngleDeg < 250 ? '(已倒置翻面!)' : ''}`,
        tone: 'neutral',
      },
      {
        label: '积雪参照坐标系',
        value: isPitfall ? '局部贴图画死 (翻滚掉肚底!)' : 'WorldNormal.Z (永远朝天)',
        tone: isPitfall ? 'bad' : 'good',
      },
      {
        label: '积雪覆盖面积',
        value: `约 ${coverPct}% 顶面`,
        tone: 'accent',
      },
      {
        label: `${wallStretch.toFixed(1)}× 拉伸砖墙投射`,
        value: effTriplanar ? 'WorldAligned 方正复原' : '传统 UV 拉成宽面条!',
        tone: effTriplanar ? 'good' : 'bad',
      },
    ]);
  }, [isPitfall, rockAngleDeg, snowThreshold, wallStretch, effTriplanar]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 640;
    const H = 272;
    const bufW = 320;
    const bufH = 136;
    const off = document.createElement('canvas');
    off.width = bufW;
    off.height = bufH;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    const img = offCtx.createImageData(bufW, bufH);
    const d = img.data;

    const splitPx = 166; // Left 52%: Tumbling Snow Boulder; Right 48%: Stretched Brick Wall
    const radAngle = (rockAngleDeg * Math.PI) / 180;
    const cosA = Math.cos(radAngle);
    const sinA = Math.sin(radAngle);
    const L = norm3([-0.38, 0.78, 0.49]);

    const sampleBrick = (bu: number, bv: number): Vec3 => {
      const row = Math.floor(bv);
      const staggeredU = bu + (row & 1 ? 0.5 : 0.0);
      const fu = ((staggeredU % 1) + 1) % 1;
      const fv = ((bv % 1) + 1) % 1;
      const isMortar = fu < 0.08 || fv < 0.13;
      if (isMortar) return [0.76, 0.74, 0.7];
      const id = hash2(Math.floor(staggeredU), row);
      return [0.62 + id * 0.18, 0.25 + id * 0.09, 0.18 + id * 0.06];
    };

    for (let py = 0; py < bufH; py++) {
      const vNorm = py / bufH;
      for (let px = 0; px < bufW; px++) {
        const idx = (py * bufW + px) * 4;

        if (px < splitPx) {
          // LEFT VIEWPORT: 3D Craggy Boulder with WorldNormal.Z Snow!
          const nx = ((px / splitPx) * 2 - 1) * 1.12;
          const ny = 1 - vNorm * 2;
          // Snowy mountain sky backdrop
          let col: Vec3 = lerp3([0.22, 0.31, 0.44], [0.13, 0.17, 0.24], vNorm);

          // Rotate query coordinates into rock's local object space to give the boulder an irregular silhouette!
          const lx = nx * cosA + ny * sinA;
          const ly = -nx * sinA + ny * cosA;
          const angLocal = Math.atan2(ly, lx);
          const silhouetteR =
            0.72 +
            0.065 * Math.sin(angLocal * 3 + 0.8) +
            0.045 * Math.cos(angLocal * 5 - 0.4) +
            0.025 * Math.sin(angLocal * 8);
          const dist = Math.hypot(lx, ly);

          if (dist <= silhouetteR) {
            const uR = lx / silhouetteR;
            const vR = ly / silhouetteR;
            const zR = Math.sqrt(Math.max(0.01, 1 - uR * uR - vR * vR));

            // Procedural craggy rock bumps in local space
            const eps = 0.03;
            const h0 = fbm(uR * 4.5 + 2.1, vR * 4.5 + 5.3, 4);
            const hx = fbm((uR + eps) * 4.5 + 2.1, vR * 4.5 + 5.3, 4);
            const hy = fbm(uR * 4.5 + 2.1, (vR + eps) * 4.5 + 5.3, 4);
            const dHx = ((hx - h0) / eps) * 0.26;
            const dHy = ((hy - h0) / eps) * 0.26;

            const localN = norm3([uR - dHx, vR - dHy, zR]);
            // Transform localN back to World Space (+Y is Sky/World +Z here!)
            const worldNx = localN[0] * cosA - localN[1] * sinA;
            const worldNy = localN[0] * sinA + localN[1] * cosA; // This is UE WorldNormal.Z (Up)!
            const worldNz = localN[2];
            const worldN: Vec3 = [worldNx, worldNy, worldNz];

            // Snow mask: WorldNormal.Z vs Pitfall (LocalNormal.Y baked onto rock texture!)
            const upComponent = isPitfall ? localN[1] : worldN[1];
            const snowAlpha = smoothstep(snowThreshold - 0.14, snowThreshold + 0.14, upComponent);

            // Snow thickens & softens underlying rock normal!
            const softWorldN = norm3(lerp3(worldN, norm3([nx, ny, zR * silhouetteR]), snowAlpha * 0.68));
            const rockBase: Vec3 = [0.16 + h0 * 0.14, 0.15 + h0 * 0.13, 0.14 + h0 * 0.12];
            const snowBase: Vec3 = [0.84, 0.89, 0.96];

            // Small painted red arrow marker on rock's original "local top" so user clearly sees the rock spinning!
            const isMarker = Math.abs(uR) < 0.06 && vR > 0.35 && vR < 0.72;
            const finalAlbedo = isMarker
              ? lerp3([0.85, 0.22, 0.18], snowBase, snowAlpha * 0.78)
              : lerp3(rockBase, snowBase, snowAlpha);

            col = shadePbrPixel({
              N: softWorldN,
              V: [0, 0, 1],
              L,
              baseColorLinear: finalAlbedo,
              metallic: 0,
              roughness: lerp(0.82, 0.58, snowAlpha),
              envMode: 'sunny',
            });
          }

          d[idx] = Math.round(clamp(col[0]) * 255);
          d[idx + 1] = Math.round(clamp(col[1]) * 255);
          d[idx + 2] = Math.round(clamp(col[2]) * 255);
          d[idx + 3] = 255;
        } else {
          // RIGHT VIEWPORT: Isometric 3D Stretched Brick Wall (Front, Side, and Top faces!)
          const rx = (px - splitPx) / (bufW - splitPx); // 0..1
          const ry = vNorm; // 0..1
          let col: Vec3 = [0.14, 0.16, 0.2];

          // Divider line
          if (px === splitPx) {
            d[idx] = 65;
            d[idx + 1] = 72;
            d[idx + 2] = 82;
            d[idx + 3] = 255;
            continue;
          }

          // Isometric box stretched horizontally along front face width by factor (0.42..0.78)
          const stretchVisualW = lerp(0.22, 0.62, (wallStretch - 1) / 4);
          const xLeft = 0.5 - stretchVisualW * 0.58;
          const xMid = xLeft + stretchVisualW;
          const xRight = xMid + 0.19;
          const yTopBase = 0.3;
          const wallH = 0.44;

          // Front face: x in [xLeft .. xMid], skewed slightly down-right
          const frontSkewY = yTopBase + ((rx - xLeft) / Math.max(0.05, stretchVisualW)) * 0.09;
          // Side face: x in [xMid .. xRight], skewed up-right
          const sideTopY = yTopBase + 0.09 - ((rx - xMid) / 0.19) * 0.11;

          if (rx >= xLeft && rx <= xMid && ry >= frontSkewY && ry <= frontSkewY + wallH) {
            // FRONT FACE (+X projector in WorldAlignedTexture, or stretched 0..1 UV!)
            const u01 = (rx - xLeft) / stretchVisualW;
            const v01 = (ry - frontSkewY) / wallH;
            const brickU = effTriplanar ? u01 * 2.2 * wallStretch : u01 * 2.2; // UV stretches when !effTriplanar!
            const brickV = v01 * 5.0;
            const bCol = sampleBrick(brickU, brickV);
            col = [bCol[0] * 0.96, bCol[1] * 0.96, bCol[2] * 0.96];
          } else if (rx > xMid && rx <= xRight && ry >= sideTopY && ry <= sideTopY + wallH) {
            // RIGHT SIDE FACE (+Y projector, unstretched depth)
            const uSide = (rx - xMid) / 0.19;
            const vSide = (ry - sideTopY) / wallH;
            const bCol = sampleBrick(uSide * 2.0, vSide * 5.0);
            col = [bCol[0] * 0.68, bCol[1] * 0.68, bCol[2] * 0.72];
          } else {
            // Check TOP ROOF PARALLELOGRAM (+Z projector)
            // Inverse transform of top face spanned by frontvec (stretchVisualW, 0.09) and sidevec (0.19, -0.11) from (xLeft, yTopBase - 0.11 + ...)
            const ox = rx - (xLeft + 0.19);
            const oy = ry - (yTopBase - 0.11);
            // Solve ox = a * stretchVisualW - b * 0.19, oy = a * 0.09 + b * 0.11
            const det = stretchVisualW * 0.11 + 0.19 * 0.09;
            const a = (ox * 0.11 + oy * 0.19) / det;
            const b = (stretchVisualW * oy - 0.09 * ox) / det;
            if (a >= 0 && a <= 1 && b >= 0 && b <= 1) {
              const topU = effTriplanar ? a * 2.2 * wallStretch : a * 2.2;
              const topV = b * 2.0;
              const bCol = sampleBrick(topU, topV);
              col = [bCol[0] * 1.12, bCol[1] * 1.12, bCol[2] * 1.1];
            }
          }

          d[idx] = Math.round(clamp(col[0]) * 255);
          d[idx + 1] = Math.round(clamp(col[1]) * 255);
          d[idx + 2] = Math.round(clamp(col[2]) * 255);
          d[idx + 3] = 255;
        }
      }
    }

    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, W, H);

    // Vector Labels & World +Z Sky Arrow
    ctx.save();
    ctx.font = '700 11.5px "Noto Sans SC", sans-serif';
    ctx.fillStyle = 'rgba(15, 22, 32, 0.8)';
    ctx.beginPath();
    ctx.roundRect(10, 10, 212, 24, 6);
    ctx.fill();
    ctx.fillStyle = '#e0f2fe';
    ctx.fillText('❄️ 拖拽巨石翻滚 (红条为岩石原顶面)', 18, 26);

    // World +Z Up Arrow
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(298, 76);
    ctx.lineTo(298, 26);
    ctx.lineTo(292, 34);
    ctx.moveTo(298, 26);
    ctx.lineTo(304, 34);
    ctx.stroke();
    ctx.fillStyle = '#93c5fd';
    ctx.font = '800 11px monospace';
    ctx.fillText('+Z 天空', 276, 90);

    // Right viewport label
    ctx.font = '700 11.5px "Noto Sans SC", sans-serif';
    ctx.fillStyle = effTriplanar ? 'rgba(20, 48, 32, 0.86)' : 'rgba(165, 34, 24, 0.88)';
    ctx.beginPath();
    ctx.roundRect(344, 10, 284, 24, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(
      effTriplanar
        ? `✅ WorldAlignedTexture 三向幻灯机 (${wallStretch.toFixed(1)}× 不拉丝)`
        : `⚠️ 传统模型 UV：墙拉长 ${wallStretch.toFixed(1)}× 砖缝拉成宽面条!`,
      352,
      26
    );

    if (effTriplanar) {
      ctx.fillStyle = '#bbf7d0';
      ctx.font = '700 11px "Noto Sans SC", sans-serif';
      ctx.fillText('📽️ Z向顶投射', 452, 54);
      ctx.fillText('📽️ X向正投射', 415, 248);
      ctx.fillText('📽️ Y向侧投射', 548, 232);
    }
    ctx.restore();
  }, [isPitfall, rockAngleDeg, snowThreshold, effTriplanar, wallStretch]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={isPitfall}
        pitfallLabel="雪画死在局部贴图上（石头翻面雪挂在肚子底） + 拉伸墙体砖缝拉成面条"
        correctLabel="WorldNormal.Z 自动识别朝天面落雪 + WorldAlignedTexture 三平面免 UV 方正投射"
        onToggle={setIsPitfall}
      />

      <div
        style={{ ...stageCanvasWrapStyle, cursor: 'grab' }}
        onMouseDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (e.clientX - rect.left < rect.width * 0.52) {
            draggingRockRef.current = true;
            dragStartAngleRef.current = { x: e.clientX, deg: rockAngleDeg };
          }
        }}
        onMouseMove={(e) => {
          if (!draggingRockRef.current) return;
          const delta = (e.clientX - dragStartAngleRef.current.x) * 1.2;
          setRockAngleDeg(((dragStartAngleRef.current.deg + delta) % 360 + 360) % 360);
        }}
        onMouseUp={() => {
          draggingRockRef.current = false;
        }}
        onMouseLeave={() => {
          draggingRockRef.current = false;
        }}
      >
        <canvas
          ref={canvasRef}
          width={640}
          height={272}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </div>

      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSlider
            label="岩石旋转角度 (0° ~ 360° 任意翻滚)"
            value={rockAngleDeg}
            min={0}
            max={360}
            step={1}
            unit="°"
            onChange={setRockAngleDeg}
          />

          <StageSlider
            label="积雪覆盖斜率阈值"
            value={snowThreshold}
            min={-0.15}
            max={0.75}
            step={0.02}
            formatValue={(v) => (v < 0.15 ? '暴雪厚盖' : v > 0.55 ? '薄雪覆顶' : `Z > ${v.toFixed(2)}`)}
            onChange={setSnowThreshold}
          />

          <StageSlider
            label="砖墙横向拉伸倍数"
            value={wallStretch}
            min={1.0}
            max={5.0}
            step={0.1}
            unit="×"
            onChange={setWallStretch}
          />

          <StageSegmented
            label="变形砖墙投射方式"
            value={useTriplanar ? 'triplanar' : 'uv'}
            options={[
              { value: 'uv', label: '传统 UV (拉成面条)' },
              { value: 'triplanar', label: 'WorldAligned 三平面' },
            ]}
            onChange={(v) => {
              setIsPitfall(false);
              setUseTriplanar(v === 'triplanar');
            }}
          />
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 10.6 STAGE: 🧊 温润玉石透光（SSS MFP）与跑车双层清漆（Substrate Vertical Layer）
 * ============================================================================ */

function getSculptureGeometry(
  nx: number,
  ny: number,
  model: 'jade' | 'ear'
): { inside: boolean; thicknessMm: number; N: Vec3 } {
  if (model === 'jade') {
    // Ornate archaic Jade Ring/Dragon Pendant:
    // Thin outer dragon-fin scallops (1.4mm), carved ring body (5mm), central boss medallion (13mm), carved openwork hole!
    const r = Math.hypot(nx, ny);
    const ang = Math.atan2(ny, nx);
    const finWave = 0.08 * Math.sin(ang * 7 + Math.sin(ang * 2) * 0.8);
    const outerR = 0.74 + finWave;
    const holeDist = Math.hypot(nx - 0.18 * Math.cos(ang * 2), ny + 0.05) - 0.11;

    if (r > outerR || (r > 0.24 && r < 0.35 && Math.sin(ang * 3) > 0.15)) {
      return { inside: false, thicknessMm: 0, N: [0, 0, 1] };
    }
    void holeDist;

    // Variable thickness: razor-thin carved outer fins (1.3mm) -> mid scroll ring (5.2mm) -> thick central boss (13.8mm)
    const edgeThin = saturate((outerR - r) / 0.22);
    const centerBoss = Math.exp(-r * r * 14) * 9.2;
    const scrollCarve = Math.sin(r * 26 + ang * 3) * 1.1;
    const thicknessMm = clamp(1.5 + edgeThin * 4.8 + centerBoss + scrollCarve * edgeThin, 1.5, 13.0);

    const nxGrad = (nx / Math.max(0.08, r)) * (0.55 - centerBoss * 0.02) + Math.cos(r * 26 + ang * 3) * 0.18;
    const nyGrad = (ny / Math.max(0.08, r)) * 0.55 + Math.sin(r * 26 + ang * 3) * 0.18;
    const N = norm3([nxGrad, nyGrad, 0.82]);
    return { inside: true, thicknessMm, N };
  } else {
    // Organic Human Ear Cartilage Silhouette!
    // Vertical oval pinched slightly at lower lobe, thin outer helix & central concha bowl, thicker antihelix ridge
    const ex = nx * 1.28;
    const ey = ny * 0.96;
    const ang = Math.atan2(ey, ex);
    const earBound = 0.68 + 0.12 * Math.sin(ang - 0.5) - 0.08 * Math.cos(ang * 2) * (ex < 0 ? 1.4 : 0.5);
    const r = Math.hypot(ex, ey);
    if (r > earBound || (ex < -0.36 && Math.abs(ey) < 0.24)) {
      return { inside: false, thicknessMm: 0, N: [0, 0, 1] };
    }

    const helixRim = Math.exp(-Math.pow((earBound - r) / 0.09, 2)); // Folded outer rim
    const antiHelix = Math.exp(-Math.pow((r - 0.34) / 0.11, 2)) * (ex > -0.15 ? 1 : 0.3);
    const conchaThin = Math.exp(-Math.pow((r - 0.16) / 0.14, 2)); // Thin inner ear bowl (1.6mm!)
    const lobeThick = ey < -0.32 ? 2.8 : 0;

    const thicknessMm = clamp(
      2.2 + helixRim * 2.6 + antiHelix * 5.8 - conchaThin * 1.1 + lobeThick,
      1.2,
      11.5
    );
    const slope = (helixRim - antiHelix * 0.8) * 0.48;
    const N = norm3([(ex / Math.max(0.1, r)) * (0.45 + slope), (ey / Math.max(0.1, r)) * 0.45, 0.84]);
    return { inside: true, thicknessMm, N };
  }
}

const SssClearCoatStage: React.FC<LessonStageProps> = ({
  onKpiUpdate,
  resetSignal,
}) => {
  const [mode, setMode] = useState<'jade_sss' | 'clearcoat'>('jade_sss');
  const [isPitfall, setIsPitfall] = useState(false);

  // Mode A: Jade / Ear SSS MFP
  const [sssSubject, setSssSubject] = useState<'jade' | 'ear'>('jade');
  const [lightOrbitDeg, setLightOrbitDeg] = useState(152); // +-180 is pure backlight!
  const [mfpMm, setMfpMm] = useState(6.8); // Mean Free Path in mm (0..15)

  // Mode B: Supercar Clear Coat (Substrate Vertical Layer)
  const [coatPlaced, setCoatPlaced] = useState(true);
  const [baseRoughness, setBaseRoughness] = useState(0.45);
  const [coatRoughness, setCoatRoughness] = useState(0.04);
  const [paintPreset, setPaintPreset] = useState<'red' | 'blue' | 'emerald'>('red');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const kpiRef = useRef(onKpiUpdate);
  kpiRef.current = onKpiUpdate;

  const lastResetRef = useRef(resetSignal);
  useEffect(() => {
    if (lastResetRef.current !== resetSignal) {
      lastResetRef.current = resetSignal;
      setIsPitfall(false);
      setSssSubject('jade');
      setLightOrbitDeg(152);
      setMfpMm(6.8);
      setCoatPlaced(true);
      setBaseRoughness(0.45);
      setCoatRoughness(0.04);
      setPaintPreset('red');
    }
  }, [resetSignal]);

  const effCoat = isPitfall ? false : coatPlaced;

  useEffect(() => {
    if (mode === 'jade_sss') {
      const isBacklit = Math.abs(lightOrbitDeg) > 95;
      kpiRef.current([
        {
          label: '当前实验台',
          value: sssSubject === 'jade' ? '冰种翠玉雕件 (SSS)' : '人耳软骨透血光 (SSS)',
          tone: 'accent',
        },
        {
          label: '聚光灯方位',
          value: isBacklit ? `${lightOrbitDeg}° (强背光透射!)` : `${lightOrbitDeg}° (正面照明)`,
          tone: isBacklit ? 'good' : 'neutral',
        },
        {
          label: '自由程倍率对应的基准距离',
          value: isPitfall ? '自发光示例' : `${mfpMm.toFixed(1)} mm = ${(mfpMm / 10).toFixed(2)} cm`,
          tone: isPitfall ? 'bad' : mfpMm > 1.5 ? 'good' : 'warn',
        },
        {
          label: '薄边(1.5mm) vs 厚芯(13mm)',
          value: isPitfall ? '自发光与厚度无关' : isBacklit && mfpMm > 1.5 ? '背光下比较两处透射' : '调整背光方向和自由程',
          tone: mfpMm > 1.5 && !isPitfall ? 'good' : 'warn',
        },
      ]);
    } else {
      kpiRef.current([
        {
          label: 'Substrate 垂直叠层',
          value: effCoat ? '已盖上透明清漆 Slab' : '仅单层粗糙底漆',
          tone: effCoat ? 'good' : 'warn',
        },
        {
          label: '底层金属闪粉漆',
          value: `Roughness ${baseRoughness.toFixed(2)} (宽散闪耀)`,
          tone: 'neutral',
        },
        {
          label: '顶层透明清漆',
          value: effCoat ? `Roughness ${coatRoughness.toFixed(2)} (镜面灯管)` : '未覆盖',
          tone: effCoat ? 'accent' : 'bad',
        },
        {
          label: '双高光包浆感',
          value: effCoat ? '闪粉+锐利灯影共存' : '发闷哑光车壳',
          tone: effCoat ? 'good' : 'bad',
        },
      ]);
    }
  }, [mode, isPitfall, sssSubject, lightOrbitDeg, mfpMm, effCoat, baseRoughness, coatRoughness]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 640;
    const H = 272;
    const bufW = 320;
    const bufH = 136;
    const off = document.createElement('canvas');
    off.width = bufW;
    off.height = bufH;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    const img = offCtx.createImageData(bufW, bufH);
    const d = img.data;

    if (mode === 'jade_sss') {
      const orbitRad = (lightOrbitDeg * Math.PI) / 180;
      // 0 deg = directly in front (+Z = +1); 180 deg = directly behind sculpture (-Z = -1)!
      const L = norm3([Math.sin(orbitRad), 0.24, Math.cos(orbitRad)]);

      for (let py = 0; py < bufH; py++) {
        const ny = 1 - (py / bufH) * 2;
        for (let px = 0; px < bufW; px++) {
          const nx = ((px / bufW) * 2 - 1) * (W / H) * 0.52;
          const idx = (py * bufW + px) * 4;

          // Dark velvet museum showcase + spotlight glow cone when orbiting behind!
          const spotScreenX = Math.sin(orbitRad) * 0.65;
          const spotDist = Math.hypot(nx - spotScreenX, ny - 0.14);
          const bgCone =
            L[2] < 0.2 ? Math.exp(-spotDist * spotDist * 4.5) * saturate(-L[2] + 0.25) * 0.75 : 0.04;
          let col: Vec3 = [0.05 + bgCone * 0.9, 0.055 + bgCone * 0.85, 0.07 + bgCone * 0.7];

          const geo = getSculptureGeometry(nx, ny, sssSubject);
          if (geo.inside) {
            const baseAlbedo: Vec3 =
              sssSubject === 'jade' ? [0.07, 0.34, 0.19] : [0.58, 0.36, 0.29];
            const surfaceRough = sssSubject === 'jade' ? 0.16 : 0.42;

            // Surface direct + studio ambient shading
            const surf = shadePbrPixel({
              N: geo.N,
              V: [0, 0, 1],
              L,
              baseColorLinear: baseAlbedo,
              metallic: 0,
              roughness: surfaceRough,
              lightIntensity: 2.2,
              envMode: 'cave',
            });

            if (isPitfall) {
              // PITFALL: Faking jade/skin glow with flat Emissive Color! Glows flat green/red everywhere regardless of thickness or light angle!
              const fakeGlow: Vec3 = sssSubject === 'jade' ? [0.06, 0.55, 0.26] : [0.55, 0.14, 0.1];
              col = [
                clamp(surf[0] * 0.4 + fakeGlow[0]),
                clamp(surf[1] * 0.4 + fakeGlow[1]),
                clamp(surf[2] * 0.4 + fakeGlow[2]),
              ];
            } else if (mfpMm > 0.05) {
              // Distance-dependent transmission approximation with prescribed thickness.
              // Channel-specific MFP ratios: Jade lets green travel far; Human skin/blood lets red travel 4x farther than blue/green!
              const mfpVec: Vec3 =
                sssSubject === 'jade'
                  ? [mfpMm * 0.28, mfpMm * 1.18, mfpMm * 0.55]
                  : [mfpMm * 1.35, mfpMm * 0.38, mfpMm * 0.18];

              const attenR = Math.exp(-geo.thicknessMm / Math.max(0.05, mfpVec[0]));
              const attenG = Math.exp(-geo.thicknessMm / Math.max(0.05, mfpVec[1]));
              const attenB = Math.exp(-geo.thicknessMm / Math.max(0.05, mfpVec[2]));

              // Back-lighting alignment: peaks when L is behind object (L.z < 0) + forward wrap scattering
              const backPhase = Math.pow(saturate(-L[2] * 0.72 + 0.36), 1.65);
              const localSpotProx = Math.exp(-Math.hypot(nx - spotScreenX * 0.65, ny - 0.1) * 1.25);
              const transPower = (backPhase * 3.4 * (0.45 + 0.55 * localSpotProx) + 0.28);

              const sssTint: Vec3 =
                sssSubject === 'jade' ? [0.18, 1.0, 0.48] : [1.0, 0.26, 0.12];

              col = [
                linearToSrgb(acesTonemap(surf[0] + sssTint[0] * attenR * transPower)),
                linearToSrgb(acesTonemap(surf[1] + sssTint[1] * attenG * transPower)),
                linearToSrgb(acesTonemap(surf[2] + sssTint[2] * attenB * transPower)),
              ];
            } else {
              col = surf;
            }
          }

          d[idx] = Math.round(clamp(col[0]) * 255);
          d[idx + 1] = Math.round(clamp(col[1]) * 255);
          d[idx + 2] = Math.round(clamp(col[2]) * 255);
          d[idx + 3] = 255;
        }
      }

      offCtx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, W, H);

      // Top-down mini orbit compass in top-right showing Light vs Object vs Camera!
      ctx.save();
      const compX = W - 64;
      const compY = 58;
      ctx.fillStyle = 'rgba(14, 18, 24, 0.82)';
      ctx.beginPath();
      ctx.arc(compX, compY, 42, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.stroke();

      // Object center dot + Light sun dot
      ctx.fillStyle = sssSubject === 'jade' ? '#34d399' : '#fb7185';
      ctx.beginPath();
      ctx.arc(compX, compY, 7, 0, Math.PI * 2);
      ctx.fill();

      const lxComp = compX + Math.sin(orbitRad) * 29;
      const lyComp = compY + Math.cos(orbitRad) * 29; // +cos is bottom (front toward camera), -cos is top (behind object!)
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(lxComp, lyComp, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '700 10px "Noto Sans SC", sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.textAlign = 'center';
      ctx.fillText('背光区', compX, compY - 30);
      ctx.fillText('👁️镜头', compX, compY + 37);
      ctx.restore();
    } else {
      // MODE B: Supercar Clear Coat (Left 60%: Curved Fender under Garage Tubes; Right 40%: Exploded Substrate Vertical Layer!)
      const splitPx = 194;
      const baseColors: Record<'red' | 'blue' | 'emerald', Vec3> = {
        red: [0.68, 0.04, 0.06],
        blue: [0.05, 0.22, 0.72],
        emerald: [0.04, 0.46, 0.24],
      };
      const carPigment = baseColors[paintPreset];
      const L = norm3([-0.32, 0.74, 0.59]);

      for (let py = 0; py < bufH; py++) {
        const ny = 1 - (py / bufH) * 2;
        for (let px = 0; px < bufW; px++) {
          const idx = (py * bufW + px) * 4;
          if (px >= splitPx) {
            d[idx] = 22;
            d[idx + 1] = 24;
            d[idx + 2] = 30;
            d[idx + 3] = 255;
            continue;
          }

          const nx = ((px / splitPx) * 2 - 1) * 1.12;
          // Sleek curved supercar hood/fender silhouette
          const hoodArch = 0.62 - nx * nx * 0.28;
          let col: Vec3 = [0.08, 0.09, 0.12];

          // Overhead garage fluorescent light strip visible in background ceiling
          if (ny > 0.76 && Math.abs(nx + 0.15) < 0.65 && Math.abs(ny - 0.85) < 0.035) {
            col = [0.95, 0.97, 1.0];
          }

          if (ny < hoodArch && ny > -0.78 && Math.abs(nx) < 0.96) {
            const vHood = (ny + 0.78) / (hoodArch + 0.78);
            const macroN = norm3([nx * 0.68, (vHood - 0.35) * 0.78, 0.85]);

            // Metallic micro-flakes via high-frequency Voronoi cells!
            const flake = voronoiInfo(nx * 52, ny * 52);
            const flakeTiltX = (hash2(flake.cellId * 91, 3.1) - 0.5) * 0.28;
            const flakeTiltY = (hash2(7.3, flake.cellId * 57) - 0.5) * 0.28;
            const flakeN = norm3([macroN[0] + flakeTiltX, macroN[1] + flakeTiltY, macroN[2]]);

            // Bottom Slab: Rough Metallic Flake Base
            const V: Vec3 = [0, 0, 1];
            const Hvec = norm3([L[0], L[1], L[2] + 1]);
            const flakeGlint = Math.pow(Math.max(0, dot3(flakeN, Hvec)), 26) * 1.35;

            const bottomLinear = shadePbrPixel({
              N: macroN,
              V,
              L,
              baseColorLinear: [
                carPigment[0] * (0.85 + flake.cellId * 0.45),
                carPigment[1] * (0.85 + flake.cellId * 0.45),
                carPigment[2] * (0.85 + flake.cellId * 0.45),
              ],
              metallic: 0.88,
              roughness: baseRoughness,
              envMode: 'studio',
            });

            let r = bottomLinear[0] + carPigment[0] * flakeGlint * 0.55;
            let g = bottomLinear[1] + carPigment[1] * flakeGlint * 0.55;
            let b = bottomLinear[2] + carPigment[2] * flakeGlint * 0.55;

            // Top Slab: Substrate Vertical Layer Smooth Clear Coat!
            if (effCoat) {
              const NdotV = clamp(dot3(macroN, V), 0.02, 1);
              const ccFresnel = 0.04 + 0.96 * Math.pow(1 - NdotV, 5);
              const R = reflect3([0, 0, -1], macroN);
              const ccEnv = sampleEnvMap(R, coatRoughness, 'studio');

              // Crisp twin garage fluorescent light tube reflections stretched across smooth clear coat!
              const tube1 = Math.exp(-Math.pow((R[1] - 0.48 - R[0] * 0.18) / (0.022 + coatRoughness * 0.35), 2));
              const tube2 = Math.exp(-Math.pow((R[1] - 0.22 - R[0] * 0.18) / (0.022 + coatRoughness * 0.35), 2));
              const tubeMask = smoothstep(0.75, 0.55, Math.abs(R[0])) * (tube1 + tube2) * lerp(1.35, 0.25, coatRoughness * 3);

              // Interface darkening/richness under clear coat + crisp specular layer on top
              const interfaceTrans = 1 - ccFresnel * 0.85;
              r = r * interfaceTrans * 0.92 + ccEnv[0] * ccFresnel * 0.65 + tubeMask;
              g = g * interfaceTrans * 0.92 + ccEnv[1] * ccFresnel * 0.65 + tubeMask * 0.99;
              b = b * interfaceTrans * 0.92 + ccEnv[2] * ccFresnel * 0.68 + tubeMask * 1.02;
            }

            col = [clamp(r), clamp(g), clamp(b)];
          }

          d[idx] = Math.round(col[0] * 255);
          d[idx + 1] = Math.round(col[1] * 255);
          d[idx + 2] = Math.round(col[2] * 255);
          d[idx + 3] = 255;
        }
      }

      offCtx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, W, H);

      // Right 40% (x = 392..630): Interactive Exploded Substrate Vertical Layer Diagram!
      ctx.save();
      const drawIsoSlab = (cx: number, cy: number, fillTop: string, fillSide: string, stroke: string, label: string) => {
        const hw = 86;
        const hh = 26;
        const thick = 14;
        // Top diamond
        ctx.fillStyle = fillTop;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy - hh);
        ctx.lineTo(cx + hw, cy);
        ctx.lineTo(cx, cy + hh);
        ctx.lineTo(cx - hw, cy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Bottom thickness skirt
        ctx.fillStyle = fillSide;
        ctx.beginPath();
        ctx.moveTo(cx - hw, cy);
        ctx.lineTo(cx, cy + hh);
        ctx.lineTo(cx + hw, cy);
        ctx.lineTo(cx + hw, cy + thick);
        ctx.lineTo(cx, cy + hh + thick);
        ctx.lineTo(cx - hw, cy + thick);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = '700 11px "Noto Sans SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, cx, cy + 4);
      };

      const stackX = 514;
      const bottomY = 186;
      const topY = effCoat ? 156 : 86; // Tightly laminated when placed, lifted high when removed!

      ctx.font = '700 12px "Noto Sans SC", sans-serif';
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.fillText('UE 5.8 Substrate Vertical Layer', stackX, 28);

      // Bottom metallic flake slab
      const bottomColorHex =
        paintPreset === 'red' ? '#991b1b' : paintPreset === 'blue' ? '#1e40af' : '#065f46';
      drawIsoSlab(
        stackX,
        bottomY,
        bottomColorHex,
        '#334155',
        '#94a3b8',
        `Bottom: 闪粉底漆 (Rough ${baseRoughness.toFixed(2)})`
      );

      // Top glossy clear coat slab
      drawIsoSlab(
        stackX,
        topY,
        effCoat ? 'rgba(186, 230, 253, 0.52)' : 'rgba(148, 163, 184, 0.22)',
        'rgba(125, 211, 252, 0.32)',
        effCoat ? '#38bdf8' : '#64748b',
        `Top: 透明清漆 (Rough ${coatRoughness.toFixed(2)})`
      );

      ctx.font = '700 11px "Noto Sans SC", sans-serif';
      ctx.fillStyle = effCoat ? '#86efac' : '#fca5a5';
      ctx.fillText(
        effCoat ? '✅ 清漆已贴合：点击画面右侧可揭开对比!' : '⬆️ 清漆已揭开：点击画面右侧重新盖上!',
        stackX,
        248
      );
      ctx.restore();
    }
  }, [mode, isPitfall, sssSubject, lightOrbitDeg, mfpMm, effCoat, baseRoughness, coatRoughness, paintPreset]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <StageSegmented
          value={mode}
          options={[
            { value: 'jade_sss', label: '🐉 模式 A：翡翠玉雕 / 耳廓背光透射 (MFP)' },
            { value: 'clearcoat', label: '🏎️ 模式 B：跑车双层清漆 (Vertical Layer)' },
          ]}
          onChange={(v) => {
            setIsPitfall(false);
            setMode(v);
          }}
        />

        {mode === 'jade_sss' ? (
          <StageSegmented
            value={sssSubject}
            options={[
              { value: 'jade', label: '翠玉瑞兽佩' },
              { value: 'ear', label: '温润人耳廓' },
            ]}
            onChange={setSssSubject}
          />
        ) : (
          <StageSegmented
            value={paintPreset}
            options={[
              { value: 'red', label: '竞速红' },
              { value: 'blue', label: '星际蓝' },
              { value: 'emerald', label: '祖母绿' },
            ]}
            onChange={setPaintPreset}
          />
        )}
      </div>

      <PitfallCompareBar
        isPitfall={isPitfall}
        pitfallLabel={
          mode === 'jade_sss'
            ? '拿 Emissive 自发光假冒玉石透光（不分薄厚、哪怕关灯也在像绿灯泡发光）'
            : '单层粗糙车漆无清漆叠层（高光散成一片雾，丢失镜面车库灯管倒影）'
        }
        correctLabel={
          mode === 'jade_sss'
            ? 'Substrate Slab MFP 物理自由程（背光时薄边缘翠绿通透，厚肚子沉稳浑厚）'
            : 'Substrate Vertical Layer 双层物理叠合（底层金属闪粉 + 顶层镜面清漆共存）'
        }
        onToggle={setIsPitfall}
      />

      <div
        style={{ ...stageCanvasWrapStyle, cursor: 'pointer' }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (mode === 'clearcoat' && e.clientX - rect.left > rect.width * 0.58) {
            setIsPitfall(false);
            setCoatPlaced((prev) => !prev);
          }
        }}
      >
        <canvas
          ref={canvasRef}
          width={640}
          height={272}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </div>

      <div className="stage-controls-panel">
        {mode === 'jade_sss' ? (
          <div className="control-grid">
            <StageSlider
              label="聚光灯环绕角度 (拉到 ±150° 看背光!)"
              value={lightOrbitDeg}
              min={-180}
              max={180}
              step={2}
              unit="°"
              onChange={setLightOrbitDeg}
            />
            <StageSlider
              label="自由程基准值（网页 mm，UE 引脚 cm）"
              value={mfpMm}
              min={0}
              max={15}
              step={0.2}
              unit=" mm"
              onChange={(v) => {
                setIsPitfall(false);
                setMfpMm(v);
              }}
            />
          </div>
        ) : (
          <div className="control-grid">
            <StageToggle
              label="盖上顶层光滑透明清漆薄片"
              checked={effCoat}
              onChange={(c) => {
                setIsPitfall(false);
                setCoatPlaced(c);
              }}
              hint="Substrate Vertical Layer"
            />
            <StageSlider
              label="底层金属闪粉粗糙度"
              value={baseRoughness}
              min={0.18}
              max={0.75}
              step={0.02}
              onChange={setBaseRoughness}
            />
            <StageSlider
              label="顶层透明清漆粗糙度"
              value={coatRoughness}
              min={0.02}
              max={0.35}
              step={0.01}
              onChange={setCoatRoughness}
            />
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
 * 10.7 STAGE: 🎨 冰层内裂纹视差（BumpOffset）与 UE 5.8 原生卡通渲染（Toon BSDF）
 * ============================================================================ */

const IceParallaxToonStage: React.FC<LessonStageProps> = ({
  onKpiUpdate,
  resetSignal,
}) => {
  const [mode, setMode] = useState<'ice_parallax' | 'toon_bsdf'>('ice_parallax');
  const [isPitfall, setIsPitfall] = useState(false);

  // Mode A: Three-Foot Deep Frozen Ice Slab (BumpOffset on 2 flat triangles!)
  const [viewAngleDeg, setViewAngleDeg] = useState(28); // -55 .. +55 camera tilt!
  const [parallaxLayers, setParallaxLayers] = useState<'1' | '2' | '3'>('3');
  const [heightRatio, setHeightRatio] = useState(0.09); // 0.00 .. 0.32 (>0.22 triggers swimming warning!)
  const [showFlatWireframe, setShowFlatWireframe] = useState(true);

  // Mode B: UE 5.8 Substrate Toon BSDF
  const [shadeStyle, setShadeStyle] = useState<'pbr' | 'toon'>('toon');
  const [toonThreshold, setToonThreshold] = useState(0.45); // 0.15 .. 0.82
  const [edgeSoftness, setEdgeSoftness] = useState(0.03); // 0.005 (razor anime cut) .. 0.28 (soft)
  const [stylizedRimSpec, setStylizedRimSpec] = useState(true);
  const [toonLightDeg, setToonLightDeg] = useState(38);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingIceRef = useRef(false);
  const kpiRef = useRef(onKpiUpdate);
  kpiRef.current = onKpiUpdate;

  const lastResetRef = useRef(resetSignal);
  useEffect(() => {
    if (lastResetRef.current !== resetSignal) {
      lastResetRef.current = resetSignal;
      setIsPitfall(false);
      setViewAngleDeg(28);
      setParallaxLayers('3');
      setHeightRatio(0.09);
      setShowFlatWireframe(true);
      setShadeStyle('toon');
      setToonThreshold(0.45);
      setEdgeSoftness(0.03);
      setStylizedRimSpec(true);
      setToonLightDeg(38);
    }
  }, [resetSignal]);

  const effHeightRatio = isPitfall ? 0.34 : heightRatio;

  useEffect(() => {
    if (mode === 'ice_parallax') {
      const overStretched = effHeightRatio > 0.2;
      kpiRef.current([
        {
          label: '冰面真实几何顶点数',
          value: '仅 4 顶点 · 2 个纯平三角形!',
          tone: 'good',
        },
        {
          label: '视差深度层数',
          value: `${parallaxLayers} 层深冰错位`,
          tone: 'accent',
        },
        {
          label: 'BumpOffset HeightRatio',
          value: overStretched ? `${effHeightRatio.toFixed(2)} (过大断层漂移!)` : `${effHeightRatio.toFixed(2)} (黄金舒适区)`,
          tone: overStretched ? 'bad' : 'good',
        },
        {
          label: '当前视线斜角',
          value: `${Math.round(viewAngleDeg)}°`,
          tone: 'neutral',
        },
      ]);
    } else {
      kpiRef.current([
        {
          label: '着色层板模型',
          value: shadeStyle === 'toon' ? 'Toon Profile 曲线示意' : '标准 PBR 柔顺渐变',
          tone: 'accent',
        },
        {
          label: '明暗二分阈值',
          value: shadeStyle === 'toon' ? `N·L = ${toonThreshold.toFixed(2)}` : '连续余弦曲线',
          tone: 'neutral',
        },
        {
          label: '交界软硬度',
          value: edgeSoftness < 0.05 ? '赛璐璐硬切刀锋' : '半厚涂柔边过渡',
          tone: 'good',
        },
        {
          label: '二次元暗部染色',
          value: isPitfall ? '纯灰黑死暗部 (显脏!)' : '通透冷紫/暖粉环境色',
          tone: isPitfall ? 'bad' : 'good',
        },
      ]);
    }
  }, [mode, isPitfall, parallaxLayers, effHeightRatio, viewAngleDeg, shadeStyle, toonThreshold, edgeSoftness]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 640;
    const H = 272;
    const bufW = 320;
    const bufH = 136;
    const off = document.createElement('canvas');
    off.width = bufW;
    off.height = bufH;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    const img = offCtx.createImageData(bufW, bufH);
    const d = img.data;

    if (mode === 'ice_parallax') {
      // Left 65% (px < 208): Flat 2-Triangle Frozen Abyss Slab with multi-layer BumpOffset!
      // Right 35% (px >= 208): Ray-Parallax Sightline Cross-Section Diagram!
      const splitPx = 208;
      const viewRad = (viewAngleDeg * Math.PI) / 180;
      const viewTanX = Math.tan(viewRad); // Tangent-space camera lateral shift!
      const numLayers = parseInt(parallaxLayers, 10);

      for (let py = 0; py < bufH; py++) {
        const vNorm = py / bufH;
        for (let px = 0; px < bufW; px++) {
          const idx = (py * bufW + px) * 4;
          if (px >= splitPx) {
            d[idx] = 17;
            d[idx + 1] = 22;
            d[idx + 2] = 31;
            d[idx + 3] = 255;
            continue;
          }

          // Perspective foreshortened flat quad sitting in polar cavern
          const sx = (px / splitPx) * 2 - 1;
          const sy = vNorm;
          if (sy < 0.14) {
            // Polar cavern sky strip
            const sky = lerp3([0.08, 0.14, 0.24], [0.18, 0.32, 0.48], sy / 0.14);
            d[idx] = Math.round(sky[0] * 255);
            d[idx + 1] = Math.round(sky[1] * 255);
            d[idx + 2] = Math.round(sky[2] * 255);
            d[idx + 3] = 255;
            continue;
          }

          const quadV = (sy - 0.14) / 0.86; // 0 (far) .. 1 (near)
          const perspScale = lerp(1.55, 0.85, quadV);
          const uBase = sx * perspScale * 1.4 + 2.0;
          const vBase = quadV * 2.2 + 1.0;

          // Deep sub-glacial dark ocean bed
          let iceCol: Vec3 = [0.02, 0.07, 0.16];

          // Layer 3 (Abyssal depth = -1.0): Deep sapphire wide fissures (shifted strongest by BumpOffset!)
          if (numLayers >= 3) {
            const u3 = uBase + viewTanX * effHeightRatio * 3.1;
            const v3 = vBase + 0.18 * effHeightRatio;
            const vor3 = voronoiInfo(u3 * 2.4, v3 * 2.4);
            const crack3 = smoothstep(0.11, 0.01, vor3.edge);
            iceCol = [
              iceCol[0] + crack3 * 0.08,
              iceCol[1] + crack3 * 0.38,
              iceCol[2] + crack3 * 0.72,
            ];
          }

          // Layer 2 (Mid-deep depth = -0.55): Glowing cyan sharp jagged ice fractures + Beer-Lambert ice fog!
          if (numLayers >= 2) {
            const u2 = uBase + viewTanX * effHeightRatio * 1.75;
            const v2 = vBase + 0.09 * effHeightRatio;
            const vor2 = voronoiInfo(u2 * 3.8 + 4.2, v2 * 3.8 + 1.7);
            const crack2 = smoothstep(0.065, 0.008, vor2.edge);
            // If HeightRatio is pitfall-huge (>0.22), simulate ugly BumpOffset ghosting/tearing!
            const tearGhost =
              effHeightRatio > 0.22
                ? smoothstep(0.06, 0.01, voronoiInfo((u2 + viewTanX * 0.28) * 3.8 + 4.2, v2 * 3.8 + 1.7).edge) * 0.55
                : 0;
            iceCol = lerp3(iceCol, [0.06, 0.22, 0.38], 0.32);
            iceCol = [
              iceCol[0] + (crack2 + tearGhost) * 0.26,
              iceCol[1] + (crack2 + tearGhost) * 0.78,
              iceCol[2] + (crack2 + tearGhost) * 0.98,
            ];
          }

          // Layer 1 (Shallow subsurface depth = -0.22): Frozen trapped air bubbles & primary crack!
          const u1 = uBase + viewTanX * effHeightRatio * 0.72;
          const vor1 = voronoiInfo(u1 * 5.2 + 9.1, vBase * 5.2 + 3.4);
          const crack1 = smoothstep(0.042, 0.005, vor1.edge);
          const bubbles = voronoiInfo(u1 * 13.5, vBase * 13.5);
          const isBubble = bubbles.f1 < 0.13 && bubbles.cellId > 0.62 ? (0.13 - bubbles.f1) * 5.5 : 0;

          iceCol = [
            iceCol[0] + crack1 * 0.65 + isBubble * 0.65,
            iceCol[1] + crack1 * 0.92 + isBubble * 0.82,
            iceCol[2] + crack1 * 1.0 + isBubble * 0.95,
          ];

          // Layer 0 (True flat surface height = 0.0, ZERO parallax offset!): White surface frost patches + sky specular sheen!
          const frost = smoothstep(0.58, 0.82, fbm(uBase * 4.5, vBase * 4.5, 3));
          const specGlint = Math.exp(-Math.pow(sx - Math.sin(viewRad) * 0.45, 2) * 5.5) * (1 - frost * 0.7) * 0.32;
          iceCol = lerp3(iceCol, [0.84, 0.92, 0.98], frost * 0.58);
          iceCol = [iceCol[0] + specGlint, iceCol[1] + specGlint * 1.02, iceCol[2] + specGlint * 1.06];

          d[idx] = Math.round(clamp(iceCol[0]) * 255);
          d[idx + 1] = Math.round(clamp(iceCol[1]) * 255);
          d[idx + 2] = Math.round(clamp(iceCol[2]) * 255);
          d[idx + 3] = 255;
        }
      }

      offCtx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, W, H);

      // Optional Flat 2-Triangle Quad Wireframe Overlay to prove 0 extra vertices!
      const slabW = (208 / 320) * W;
      if (showFlatWireframe) {
        ctx.save();
        ctx.strokeStyle = 'rgba(163, 230, 53, 0.82)';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([6, 4]);
        const pad = 16;
        const yTop = H * 0.16;
        const yBot = H - 14;
        ctx.strokeRect(pad, yTop, slabW - pad * 2, yBot - yTop);
        ctx.beginPath();
        ctx.moveTo(pad, yTop);
        ctx.lineTo(slabW - pad, yBot);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(20, 32, 18, 0.85)';
        ctx.beginPath();
        ctx.roundRect(14, 8, 258, 22, 6);
        ctx.fill();
        ctx.fillStyle = '#bef264';
        ctx.font = '700 11px "Noto Sans SC", sans-serif';
        ctx.fillText('📐 线框揭秘：总共只有 2 个纯平三角形 (拖动冰面晃视角!)', 20, 23);
        ctx.restore();
      }

      // Right 35% (x = 424..632): Live BumpOffset Sightline Cross-Section Diagram!
      ctx.save();
      const rx0 = 428;
      const rw = 198;
      const surfY = 92;

      ctx.font = '700 11.5px "Noto Sans SC", sans-serif';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText('BumpOffset 视线错位剖面', rx0 + 18, 26);

      // Draw ice block depth bands
      ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.fillRect(rx0, surfY, rw, 152);
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rx0, surfY);
      ctx.lineTo(rx0 + rw, surfY);
      ctx.stroke();

      // Depth layer lines
      const depths = [
        { y: surfY, label: '表层白霜 (0m)', col: '#f8fafc' },
        { y: surfY + 42, label: '浅层气泡 (-0.2m)', col: '#bae6fd' },
        { y: surfY + 92, label: '中层冰裂 (-0.5m)', col: '#38bdf8' },
        { y: surfY + 140, label: '深渊裂谷 (-1.0m)', col: '#3b82f6' },
      ];
      depths.slice(0, numLayers + 1).forEach((dl, idxL) => {
        if (idxL > 0) {
          ctx.strokeStyle = 'rgba(125, 211, 252, 0.28)';
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(rx0, dl.y);
          ctx.lineTo(rx0 + rw, dl.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = dl.col;
        ctx.font = '600 10px "Noto Sans SC", sans-serif';
        ctx.fillText(dl.label, rx0 + 6, dl.y - 4);
      });

      // Eye + slanted sight ray piercing surface center and hitting offset UV points deeper down!
      const hitX = rx0 + rw * 0.52;
      const eyeX = hitX - viewTanX * 42;
      const eyeY = 48;
      const deepX = clamp(hitX + viewTanX * effHeightRatio * 520, rx0 + 8, rx0 + rw - 8);

      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(eyeX, eyeY);
      ctx.lineTo(hitX, surfY);
      ctx.lineTo(deepX, surfY + 140);
      ctx.stroke();

      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText('👁️', eyeX - 7, eyeY - 8);
      ctx.restore();
    } else {
      // MODE B: UE 5.8 Substrate Toon BSDF Cel-Shading vs Smooth PBR!
      const lRad = (toonLightDeg * Math.PI) / 180;
      const L = norm3([Math.sin(lRad) * 0.85, 0.42, Math.cos(lRad) * 0.85]);

      for (let py = 0; py < bufH; py++) {
        const ny = 1 - (py / bufH) * 2;
        for (let px = 0; px < bufW; px++) {
          const nx = ((px / bufW) * 2 - 1) * (W / H) * 0.52;
          const idx = (py * bufW + px) * 4;

          // Stylized anime sky gradient background
          let col: Vec3 = lerp3([0.16, 0.15, 0.26], [0.26, 0.22, 0.36], py / bufH);

          // Character bust silhouette: Main head/orb + stylized anime hair bangs crest for rich cel-shadow shapes!
          const rOrb = Math.hypot(nx + 0.12, ny - 0.02);
          const rad = 0.68;

          if (rOrb <= rad) {
            const ux = (nx + 0.12) / rad;
            const uy = (ny - 0.02) / rad;
            const uz = Math.sqrt(Math.max(0.001, 1 - ux * ux - uy * uy));

            // Hair vs warm anime skin/armor two-material zones on the bust orb!
            const bangWave = 0.22 + 0.16 * Math.sin(ux * 7.5 + 0.4) - ux * ux * 0.25;
            const isHair = uy > bangWave;

            const N = isHair
              ? norm3([ux + Math.cos(ux * 14) * 0.16, uy, uz])
              : norm3([ux, uy, uz]);
            const V: Vec3 = [0, 0, 1];
            const NdotV = clamp(dot3(N, V), 0.01, 1);

            const litColor: Vec3 = isHair ? [0.26, 0.56, 0.94] : [0.98, 0.82, 0.74];
            // PITFALL: dirty grey-black shadow vs CORRECT: clean vibrant cool-lavender / warm-coral shadow!
            const shadowColor: Vec3 = isPitfall
              ? isHair
                ? [0.06, 0.11, 0.18]
                : [0.32, 0.26, 0.24]
              : isHair
                ? [0.18, 0.24, 0.64]
                : [0.84, 0.54, 0.56];

            if (shadeStyle === 'pbr') {
              col = shadePbrPixel({
                N,
                V,
                L,
                baseColorLinear: isHair ? [0.08, 0.28, 0.78] : [0.85, 0.58, 0.46],
                metallic: 0,
                roughness: isHair ? 0.32 : 0.48,
                envMode: 'sunny',
              });
            } else {
              // UE 5.8 Substrate Toon BSDF: Crisp step/smoothstep ramp + stylized specular halo + ink outline!
              const ndl = dot3(N, L) * 0.5 + 0.5;
              const ramp = smoothstep(
                toonThreshold - edgeSoftness,
                toonThreshold + edgeSoftness,
                ndl
              );
              col = lerp3(shadowColor, litColor, ramp);

              if (stylizedRimSpec) {
                // Crisp quantized anime specular dot / hair angel-ring!
                const Hvec = norm3([L[0], L[1], L[2] + 1]);
                const ndh = Math.max(0, dot3(N, Hvec));
                if (isHair) {
                  const angelRing = smoothstep(0.76, 0.8, uy + Math.sin(ux * 8) * 0.03) * smoothstep(0.89, 0.85, uy);
                  if (angelRing > 0.2 && ramp > 0.3) {
                    col = lerp3(col, [0.92, 0.98, 1.0], angelRing * 0.85);
                  }
                } else if (ndh > 0.94) {
                  col = [1.0, 0.98, 0.96];
                }

                // Stylized backlit Fresnel rim cut
                const rim = smoothstep(0.72, 0.78, 1 - NdotV) * saturate(dot3(N, L) + 0.4);
                col = lerp3(col, [0.96, 0.94, 1.0], rim * 0.75);

                // Crisp cel ink outline at grazing silhouette!
                if (NdotV < 0.22) {
                  col = [0.11, 0.08, 0.14];
                }
              }
            }
          }

          d[idx] = Math.round(clamp(col[0]) * 255);
          d[idx + 1] = Math.round(clamp(col[1]) * 255);
          d[idx + 2] = Math.round(clamp(col[2]) * 255);
          d[idx + 3] = 255;
        }
      }

      offCtx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, W, H);

      // Right inset: Live Cel-Shading Scissor Curve Graph (Input N·L -> Output Ramp)!
      ctx.save();
      const gx = 436;
      const gy = 38;
      const gw = 180;
      const gh = 165;

      ctx.fillStyle = 'rgba(16, 15, 24, 0.85)';
      ctx.beginPath();
      ctx.roundRect(gx - 12, gy - 22, gw + 24, gh + 48, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.strokeRect(gx, gy, gw, gh);

      // Reference dashed smooth PBR curve
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(gx, gy + gh);
      ctx.lineTo(gx + gw, gy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Active Toon / PBR curve
      ctx.strokeStyle = shadeStyle === 'toon' ? '#f472b6' : '#60a5fa';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const x01 = i / 60;
        const y01 =
          shadeStyle === 'toon'
            ? smoothstep(toonThreshold - edgeSoftness, toonThreshold + edgeSoftness, x01)
            : x01;
        const pxCurve = gx + x01 * gw;
        const pyCurve = gy + gh - y01 * gh;
        if (i === 0) ctx.moveTo(pxCurve, pyCurve);
        else ctx.lineTo(pxCurve, pyCurve);
      }
      ctx.stroke();

      ctx.font = '700 11px "Noto Sans SC", sans-serif';
      ctx.fillStyle = '#fbcfe8';
      ctx.fillText('✂️ 色阶二分曲线 (N·L → 亮暗)', gx, gy - 7);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`背光 0.0       阈值 ${toonThreshold.toFixed(2)}       受光 1.0`, gx, gy + gh + 16);
      ctx.restore();
    }
  }, [
    mode,
    viewAngleDeg,
    parallaxLayers,
    effHeightRatio,
    showFlatWireframe,
    shadeStyle,
    toonThreshold,
    edgeSoftness,
    stylizedRimSpec,
    toonLightDeg,
    isPitfall,
  ]);

  const updateIceAngleFromPointer = (clientX: number) => {
    if (mode !== 'ice_parallax' || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const rel = clamp((clientX - rect.left) / (rect.width * 0.65), 0, 1);
    setViewAngleDeg(lerp(-52, 52, rel));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <StageSegmented
        value={mode}
        options={[
          { value: 'ice_parallax', label: '🧊 模式 A：三尺寒冰 BumpOffset 视差窗' },
          { value: 'toon_bsdf', label: '🎨 模式 B：写实秒切二次元 UE 5.8 Toon BSDF' },
        ]}
        onChange={(v) => {
          setIsPitfall(false);
          setMode(v);
        }}
      />

      <PitfallCompareBar
        isPitfall={isPitfall}
        pitfallLabel={
          mode === 'ice_parallax'
            ? 'BumpOffset 深度倍率贪心拉到 0.34（大斜角出现重影断层与裂纹漂移穿帮!）'
            : '二次元暗部直接乘纯黑灰（角色脸部发闷显脏，失去动漫通透感）'
        }
        correctLabel={
          mode === 'ice_parallax'
            ? '适度 HeightRatio (0.04~0.12) 多层叠合，2 个平面三角形骗出三尺深冰!'
            : '实验性 Toon Profile 曲线示意 · 网页另绘轮廓线'
        }
        onToggle={setIsPitfall}
      />

      <div
        style={{
          ...stageCanvasWrapStyle,
          cursor: mode === 'ice_parallax' ? 'ew-resize' : 'default',
        }}
        onMouseDown={(e) => {
          draggingIceRef.current = true;
          updateIceAngleFromPointer(e.clientX);
        }}
        onMouseMove={(e) => {
          if (draggingIceRef.current) updateIceAngleFromPointer(e.clientX);
        }}
        onMouseUp={() => {
          draggingIceRef.current = false;
        }}
        onMouseLeave={() => {
          draggingIceRef.current = false;
        }}
        onTouchMove={(e) => {
          if (e.touches[0]) updateIceAngleFromPointer(e.touches[0].clientX);
        }}
      >
        <canvas
          ref={canvasRef}
          width={640}
          height={272}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </div>

      <div className="stage-controls-panel">
        {mode === 'ice_parallax' ? (
          <div className="control-grid">
            <StageSlider
              label="摄像机左右观察斜角"
              value={viewAngleDeg}
              min={-55}
              max={55}
              step={1}
              unit="°"
              onChange={setViewAngleDeg}
            />
            <StageSegmented
              label="视差深度叠层数"
              value={parallaxLayers}
              options={[
                { value: '1', label: '单层薄冰' },
                { value: '2', label: '双层冰裂' },
                { value: '3', label: '三层深渊寒冰' },
              ]}
              onChange={setParallaxLayers}
            />
            <StageSlider
              label="BumpOffset 深度倍率 HeightRatio"
              value={heightRatio}
              min={0}
              max={0.32}
              step={0.01}
              formatValue={(v) => (v > 0.2 ? `${v.toFixed(2)} (过猛重影!)` : `${v.toFixed(2)}`)}
              onChange={(v) => {
                setIsPitfall(false);
                setHeightRatio(v);
              }}
            />
            <StageToggle
              label="显示 2-三角形纯平线框"
              checked={showFlatWireframe}
              onChange={setShowFlatWireframe}
            />
          </div>
        ) : (
          <div className="control-grid">
            <StageSegmented
              label="着色模式切换"
              value={shadeStyle}
              options={[
                { value: 'pbr', label: '写实 PBR 柔顺渐变' },
                { value: 'toon', label: 'UE 5.8 Toon BSDF 二次元' },
              ]}
              onChange={setShadeStyle}
            />
            <StageSlider
              label="Diffuse Ramp 过渡位置（示意）"
              value={toonThreshold}
              min={0.15}
              max={0.82}
              step={0.01}
              onChange={(v) => {
                setShadeStyle('toon');
                setToonThreshold(v);
              }}
            />
            <StageSlider
              label="Diffuse Ramp 过渡宽度（示意）"
              value={edgeSoftness}
              min={0.005}
              max={0.28}
              step={0.005}
              formatValue={(v) => (v < 0.04 ? '刀切硬边' : v < 0.14 ? '微柔赛璐璐' : '厚涂柔边')}
              onChange={(v) => {
                setShadeStyle('toon');
                setEdgeSoftness(v);
              }}
            />
            <StageSlider
              label="主光源方向角"
              value={toonLightDeg}
              min={-110}
              max={110}
              step={2}
              unit="°"
              onChange={setToonLightDeg}
            />
            <StageToggle
              label="网页附加效果 · 环形高光与轮廓线"
              checked={stylizedRimSpec}
              onChange={setStylizedRimSpec}
            />
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
 * MODULE 10 DEFINITION (7 Flagship Lessons: 10.1 – 10.7)
 * ============================================================================ */

export const module10: ModuleDefinition = {
  id: '10',
  number: '10',
  title: '常见材质效果从原理到实现',
  subtitle: '水、玻璃、雾与经典次世代特效全拆解',
  lessons: [
    /* ----------------------------------------------------------------------
     * LESSON 10.1: 🌊 真实水体（Water）
     * ---------------------------------------------------------------------- */
    {
      id: 'effect-single-layer-water',
      moduleId: '10',
      number: '10.1',
      title: '🌊 真实水体（Water）',
      subtitle: '先懂浅滩发白深水发蓝，再搭 UE 5.8 Single Layer Water',
      duration: '14 分钟',
      difficulty: '实战',
      steps: [
        {
          stepNumber: 1,
          shortLabel: '浅白深蓝',
          tag: 'phenomenon',
          title: '为什么泳池浅水台阶是白色的，深水区却自动变蓝了？',
          paragraphs: [
            '端起手边的一杯白开水看看，它明明像空气一样无色透明；可当你走到海边沙滩或阶梯泳池旁，奇怪的现象发生了：刚没过脚踝的第一级台阶清澈见底，白沙还是白沙；可越往三米深的池底走，水色竟然没人滴墨水就自己变成了翡翠绿与深海蓝！',
            '不仅如此，再低头看水面贴着沙滩和礁石的边缘——它从来没有像刀切一样生硬的分界线，而是温柔地越浅越透，还镶着一圈细碎的白色浪沫。同样都是透明的水，凭什么深的地方会自动变蓝呢？',
          ],
          tryItPrompt:
            '先点击舞台顶部的「看踩坑现象」，观察整片涂成天蓝色的“死板塑料片”有多假，再切回「正确配置」感受深浅自然渐变的清透海湾！',
        },
        {
          stepNumber: 2,
          shortLabel: '挑食吃红光',
          tag: 'background',
          title: '一杯水明明是透明的，为什么深水池底会自动变蓝？',
          paragraphs: [
            '很多新手做水的第一步，是建一个半透明材质球，然后把颜色涂成天蓝色——结果放进场景里一看，浅水滩也蓝得像倒了蓝墨水，假得像铺了一张蓝色塑料布。',
            '真相藏在阳光里：阳光是红、绿、蓝混在一起的白光，而**水是一个极其“挑食”的吃货——它最爱吃红光和橙光，最不爱吃蓝绿光**！在刚没过脚踝的**浅水台阶**，阳光刚下水就撞上白沙弹回你眼里，红绿蓝全须全尾都在，所以浅水看着几乎透明发白；到了三米深的**深水区**，阳光往返跑了六米远，红光半路早被水吃得干干净净，只剩蓝光和绿光活着浮出水面！',
            '至于波光粼粼与岸边软边：一张波纹朝一个方向滑行就像传送带运塑料瓦，**两层不同尺度的水波朝相反方向交错碰撞**才会灵动翻涌；再用摄像机测出“水底沙子距离减去水面距离 = 水深”，让水深趋近 0 厘米的岸边自动变透明并铺上白沫，硬切线就彻底消失了！',
          ],
          tryItPrompt:
            '👉 拖动舞台下方的「① 红光深度吸收浓度」滑块（此时已自动为你开启 RGB 光束透视图），看左侧浅滩台阶保持清澈的同时，右侧深水坑是如何自动染上翡翠深蓝的！',
          callout: {
            tone: 'formula',
            title: '比尔-朗伯（Beer-Lambert）挑食吸收规律',
            body: '水下光线留存率随距离呈指数衰减：红光走一两米就被水分子吸收殆尽，蓝绿光却能穿透十几米——所以水色根本不是表皮油漆，而是“厚度吃出来的”！',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '四步造真水',
          tag: 'experiment',
          title: '亲手拨动四大机关，把死板塑料片点化成真海湾',
          paragraphs: [
            '现在把舞台下方的 4 个核心控件挨个玩一遍，亲眼拆解次世代水体的四块拼图：先把 `① 红光深度吸收浓度` 拉到 `0`，你会发现连三米深渊都变得像抽干水一样惨白，推回 `1.2` 瞬间层次分明。',
            '保持其他参数不变，在单路和双路滚动法线之间切换，观察太阳高光。再单独调节水下折射扰动，观察池底图案的偏移。',
            '把岸沫覆盖的浅水深度设为 0 cm，再设为 30 cm。白沫只出现在水深低于阈值的区域，深水的颜色保持原样。',
          ],
          tryItPrompt:
            '试着把第 ② 项切到「单向死板平移」并把第 ④ 项拉到 `0 cm`，感受一下少了这两个细节水面会有多出戏！',
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5.8 单层水',
          tag: 'ue5',
          title: '走进 UE 5.8：用 Single Layer Water BSDF 一站式落地',
          paragraphs: [
            '在桌面延迟渲染、启用 Substrate 的场景里放一个浅色斜坡当池底，让水平水面与斜坡相交。新建 Surface / Opaque 材质，将 Substrate Single Layer Water BSDF 接到 Front Material。此路径使用水体专用通道读取水后场景。',
            '给 WaterAlbedo 单次散射反照率 (0.025, 0.27, 0.44)，WaterExtinction 消光系数先试 (0.0195, 0.0034, 0.00085)，单位 1/cm，红通道衰减最快。两枚 Panner 的速度分别为 (0.03, 0.02) 和 (−0.02, 0.025)，分别接同一张法线贴图的两个 Texture Sample 的 UVs，两个 RGB 经 BlendAngleCorrectedNormals 接 Normal。',
            '岸沫需要知道哪里是浅水。网页已知池底高度，用 1 − Saturate(水深 / 白沫宽度) 提取浅水。UE 中最容易复现的是给水面 UV 画一张灰度岸线遮罩，近岸白、深水黑，关闭 sRGB。R 接 TopMaterialOpacity，BaseColor 给白色，Roughness 给 0.1。遮罩为 0 处看水体，白带处出现浅色表层。',
          ],
          tryItPrompt:
            '打开原理图，沿两路 UV 找到各自的法线采样，再找到独立控制岸沫的岸线遮罩。',
          callout: {
            tone: 'ue58',
            title: 'UE 5.8 水体参数小贴士',
            body: 'Roughness 从 0.08 开始。用白沫测试遮罩先全黑、再全白，确认表层覆盖有效后换回画好的岸线。移动岸线或改变水位时需要更新遮罩。',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '造水防坑口诀',
          tag: 'pitfall',
          title: '检查池底、法线和岸线遮罩',
          paragraphs: [
            '固定水面与灯光，移动池底坡度，比较浅区与深区的颜色。观察红通道随光程增加而衰减。',
            '调试岸沫时先用常量替换遮罩 R。能看见白色表层后，复查 UV、遮罩极性与岸线位置。需要带 DepthFade 的普通半透明雾片，见 10.3。',
          ],
          tryItPrompt:
            '最后再点一次顶部的「看踩坑现象 ↔ 切正确配置」对比开关，把这四个视觉特征稳稳印在脑海里！',
        },
      ],
      takeaways: [
        '深水变蓝不是表面涂了蓝颜料，而是水分子优先吸收长波红光（比尔-朗伯定律），随水底深度自然滤出蓝绿色',
        '真实水波必须用至少两层不同缩放与相反斜向的 Panner 滚动法线贴图并混合，彻底告别单向平移塑料感',
        '网页用已知水深生成浅水带。手工岸线纹理可在不透明单层水中通过 TopMaterialOpacity 控制泡沫覆盖。',
        'UE 5.8 中优先使用 Single Layer Water BSDF，兼顾物理体积吸收、水下折射、焦散与不透明级高光性能',
      ],
      schematic: {
        title: '单层水的法线、消光与岸沫',
        caption: '沿两条 UV 路径分别采样同一法线图。岸线 R 覆盖白色表层，体积参数决定水下颜色。',
        nodes: [
          {
            id: 'panA',
            title: 'Panner A',
            subtitle: 'Speed (0.03, 0.02)',
            category: 'math',
            x: 20, y: 20, width: 215,
            outputs: [{ id: 'uv', label: 'UV', color: '#38bdf8' }],
          },
          {
            id: 'panB',
            title: 'Panner B',
            subtitle: 'Speed (−0.02, 0.025)',
            category: 'math',
            x: 20, y: 140, width: 215,
            outputs: [{ id: 'uv', label: 'UV', color: '#38bdf8' }],
          },
          {
            id: 'texA',
            title: 'Texture Sample A',
            subtitle: '同一张切线空间法线纹理',
            category: 'texture',
            x: 265, y: 20, width: 215,
            inputs: [{ id: 'uv', label: 'UVs', color: '#38bdf8' }],
            outputs: [{ id: 'n', label: 'RGB 法线', color: '#3b82f6' }],
          },
          {
            id: 'texB',
            title: 'Texture Sample B',
            subtitle: 'Sampler Type = Normal',
            category: 'texture',
            x: 265, y: 140, width: 215,
            inputs: [{ id: 'uv', label: 'UVs', color: '#38bdf8' }],
            outputs: [{ id: 'n', label: 'RGB 法线', color: '#3b82f6' }],
          },
          {
            id: 'mix',
            title: 'BlendAngleCorrectedNormals',
            subtitle: '混合两次采样得到的法线',
            category: 'math',
            x: 510, y: 35, width: 215,
            inputs: [{ id: 'a', label: 'BaseNormal', color: '#3b82f6' }, { id: 'b', label: 'AdditionalNormal', color: '#3b82f6' }],
            outputs: [{ id: 'n', label: '混合法线', color: '#3b82f6' }],
          },
          {
            id: 'volume',
            title: '水体体积参数',
            subtitle: '消光单位 1/cm',
            category: 'param',
            x: 510, y: 185, width: 215,
            outputs: [{ id: 'a', label: '单次散射反照率', color: '#22c55e' }, { id: 'ext', label: '消光系数 RGB', color: '#22c55e' }],
          },
          {
            id: 'shore',
            title: '岸线遮罩 Texture Sample',
            subtitle: '近岸白、深水黑 · sRGB 关',
            category: 'texture',
            x: 510, y: 315, width: 215,
            outputs: [{ id: 'r', label: 'R', color: '#e5e7eb' }],
          },
          {
            id: 'water',
            title: 'Substrate Single Layer Water BSDF',
            subtitle: 'BaseColor = 白，Roughness = 0.1',
            category: 'substrate',
            x: 770, y: 110, width: 215,
            inputs: [{ id: 'n', label: 'Normal', color: '#3b82f6' }, { id: 'a', label: 'WaterAlbedo', color: '#22c55e' }, { id: 'ext', label: 'WaterExtinction', color: '#22c55e' }, { id: 'f', label: 'TopMaterialOpacity', color: '#e5e7eb' }],
            outputs: [{ id: 'm', label: 'BSDF', color: '#a855f7' }],
          },
          {
            id: 'out',
            title: '水面材质',
            subtitle: 'Surface / Opaque',
            category: 'output',
            x: 1020, y: 120, width: 215,
            inputs: [{ id: 'm', label: 'Front Material', color: '#a855f7' }],
          },
        ],
        edges: [
          { fromNode: 'panA', fromPin: 'uv', toNode: 'texA', toPin: 'uv', color: '#38bdf8' },
          { fromNode: 'panB', fromPin: 'uv', toNode: 'texB', toPin: 'uv', color: '#38bdf8' },
          { fromNode: 'texA', fromPin: 'n', toNode: 'mix', toPin: 'a', color: '#3b82f6' },
          { fromNode: 'texB', fromPin: 'n', toNode: 'mix', toPin: 'b', color: '#3b82f6' },
          { fromNode: 'mix', fromPin: 'n', toNode: 'water', toPin: 'n', color: '#3b82f6' },
          { fromNode: 'volume', fromPin: 'a', toNode: 'water', toPin: 'a', color: '#22c55e' },
          { fromNode: 'volume', fromPin: 'ext', toNode: 'water', toPin: 'ext', color: '#22c55e' },
          { fromNode: 'shore', fromPin: 'r', toNode: 'water', toPin: 'f', color: '#e5e7eb' },
          { fromNode: 'water', fromPin: 'm', toNode: 'out', toPin: 'm', color: '#a855f7' },
        ],
      },
      StageComponent: WaterPoolStage,
    },

    /* ----------------------------------------------------------------------
     * LESSON 10.2: 🍷 清透玻璃（Glass）
     * ---------------------------------------------------------------------- */
    {
      id: 'effect-glass-refraction',
      moduleId: '10',
      number: '10.2',
      title: '🍷 清透玻璃（Glass）',
      subtitle: '先懂吸管入水变弯与窗户反光，再拯救“灰塑料膜”',
      duration: '14 分钟',
      difficulty: '实战',
      steps: [
        {
          stepNumber: 1,
          shortLabel: '吸管弯折与窗影',
          tag: 'phenomenon',
          title: '明明无色透明的玻璃杯，你的眼睛是靠什么看清它的？',
          paragraphs: [
            '把一只干干净净的高脚玻璃杯放在花格桌布前，仔细想想：清玻璃本身既没有红颜料也没有蓝颜料，为什么它没有像空气一样彻底隐形，反而一眼就显得晶莹剔透、立体感十足？',
            '盯着真杯子看三秒，你会抓到三个关键破绽：① 杯肚子上映着一道**亮得发白的窗户反光**；② 杯子正中心最透，可**左右两侧边缘明显变厚发亮**；③ 杯子背后斜插着的那根彩条吸管，透过杯肚看过去竟然**像折断了一样错位放大**！少了这三样里的任何一样，玻璃就不再像玻璃。',
          ],
          tryItPrompt:
            '点击顶部「看踩坑现象」，看看丢掉窗户反光和边缘变化的圆球，是不是一秒退化成了一层死气沉沉的灰塑料保鲜膜？',
        },
        {
          stepNumber: 2,
          shortLabel: '塑料膜真凶',
          tag: 'background',
          title: '揪出“灰蒙蒙塑料膜”真凶：被省掉的高光与折射拐弯',
          paragraphs: [
            '90% 的新手第一次在引擎里做玻璃都会崩溃：“我已经把不透明度调到 0.2、粗糙度调到 0 了，怎么看着还是像块脏塑料膜？” 真凶咱们在第 9 章刚抓到过：半透明物体进不了 `GBuffer` 底片室，引擎为了省电，**默认把半透明材质的表面镜面高光直接阉割关掉了**！没了那道清亮的窗户反光，再怎么调透明度都是白费劲。',
            '那吸管为什么会变弯？因为光在空气里跑得最快（定为基准 **`1.0`**），一头钻进水（**`1.33`**）、玻璃（**`1.52`**）或钻石（**`2.42`**）里速度骤降，斜着进去就会发生偏折拐弯——这个数字就叫**折射率（IOR）**！如果再把玻璃表面用砂纸打磨出微山谷，穿过去的光被乱撞打散，就变成了雾蒙蒙的**冰镇磨砂毛玻璃**。',
          ],
          tryItPrompt:
            '试着把第 ① 项切到 `默认无高光(灰塑料膜)` 再切回 `Surface ForwardShading`，亲眼见证那道救命窗户高光浮现的瞬间！',
          callout: {
            tone: 'tip',
            title: '常见透明材质真实折射率（IOR）速记',
            body: '空气 = 1.00（完全不拐弯） · 纯水/冰 = 1.31~1.33 · 普通窗户/酒杯玻璃 = 1.50~1.52 · 水晶 = 1.8~2.0 · 钻石 = 2.42。',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '四步变水晶',
          tag: 'experiment',
          title: '亲手调教水晶球：菲涅尔控透、磨砂模糊与彩窗投影',
          paragraphs: [
            '高光救回来后，接着体验另外三个点睛开关：开关 `② 菲涅尔边缘控透`，观察玻璃正面与掠射角处反光的强弱。正入射界面反射约 4%，吸管的可见度还会受吸收、厚度与折射影响。',
            '缓缓拉高 `③ Roughness 磨砂毛玻璃模糊度`：从 `0.02` 锐利水晶一路拉到 `0.55`，背后的彩条吸管和格纹墙被温柔打散成高级浴室毛玻璃质感！',
            '最后玩转第 ④ 项：在「厚实心水晶折射球」下把 `IOR` 从 `1.0` 拉向 `2.4` 看吸管从笔直、错位放大直到**光学上下倒置**；再切到「薄窗彩玻」，观察背景完全不扭曲、地板上却投下一片绚丽的教堂彩色玻璃光斑！',
          ],
          tryItPrompt:
            '切到薄窗彩玻，只切换「地面彩影示意」。窗面保持相同颜色，静态灯 + CPU Lightmass 一侧有彩影，Lumen GI 一侧没有地面透射彩影。',
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5.8 玻璃落地',
          tag: 'ue5',
          title: '走进 UE 5.8：Surface ForwardShading 与薄/厚双路线',
          paragraphs: [
            '表面玻璃示例使用桌面 Surface 域、Substrate Slab 和 Translucent - Colored Transmittance，Translucency Lighting Mode 选 Surface ForwardShading。将透射颜色经 Substrate Transmittance-To-MeanFreePath 接 SSS MFP，选择 Simple Volume；将 Slab 接 Front Material。',
            '薄窗示例选择关闭屏幕折射，观察背景直线与有色透视。网页地面上的彩斑是对静态灯透射的绘制示意。默认 Lumen GI 和 VSM 无法从窗面染色这一步得到同样的地面彩影。',
            '另做可烘焙的彩影对照：新建支持静态光照的普通非 World Partition 关卡，启用 Allow Static Lighting，关闭 Force No Precomputed Lighting，设 Dynamic Global Illumination Method = None。用传统引脚工作流的 Surface / Translucent / Default Lit 材质，彩色纹理接 Base Color，Opacity 设 0.5，单面窗勾 Two Sided。把窗和有有效光照 UV 的浅色地板设为 Static。',
          ],
          tryItPrompt:
            '放一盏 Static Directional Light 斜照窗面，让阴影落到地板上。执行 Build → Build Lighting Only，观察地板出现彩色窗格。改变窗色后重新烘焙，再比较地面。',
          callout: {
            tone: 'ue58',
            title: 'UE 5.8 薄玻璃彩色阴影怎么开？',
            body: '图中是玻璃表面材质。地板彩影另用 CPU Lightmass 和静态灯烘焙；另一条官方支持路径是 Path Tracer 配 Thin Translucent。',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '玻璃防坑口诀',
          tag: 'pitfall',
          title: '实战避坑：做玻璃先开前向高光，区分介质 IOR 与屏幕扰动',
          paragraphs: [
            '记住这句价值千金的玻璃防坑口诀：**“玻璃发灰先查前向高光，实心杯球给折射，薄薄平窗折射留 1.0”**！',
            '普通玻璃的物理 IOR 约为 1.5。平行薄窗的出射方向近似保持不变，单层屏幕空间折射缺少两个界面的完整信息。薄窗示例关闭屏幕扭曲，保留玻璃表面反射。',
          ],
          tryItPrompt:
            '把模式切回「厚实心水晶」，故意把 `IOR` 拉到 `1.00` 再拉到 `1.52`，想象一下如果整扇落地窗都像 `1.52` 这样扭曲窗外街道会有多吓人！',
        },
      ],
      takeaways: [
        '半透明材质默认关闭表面高光导致像“灰塑料膜”，做玻璃第一步必改 Lighting Mode 为 Surface ForwardShading',
        '薄窗可关闭屏幕折射以保持直线；地面彩影需匹配支持透射彩影的光照路径。',
        '彩窗自身透射由玻璃材质决定，静态彩影示例还需 Static 灯、静态接收面与重新烘焙。',
        '实心酒杯、水晶与宝石填入真实 IOR（玻璃 1.52 / 钻石 2.42），拉高 Roughness 即可平滑过渡为冰镇磨砂毛玻璃',
      ],
      schematic: {
        title: 'UE 5.8 清透水晶与彩绘玻璃材质核心节点图',
        caption: '开启 Surface ForwardShading 救回高光，利用 Transmittance-To-MFP 与 IOR 分治薄彩窗与厚水晶',
        nodes: [
          {
            id: 'glassColor',
            title: '玻璃透射色 & 粗糙度',
            subtitle: '清玻纯白(1,1,1) / 彩玻贴图',
            category: 'param',
            x: 20,
            y: 30,
            width: 195,
            previewColor: '#38bdf8',
            outputs: [
              { id: 'col', label: 'Transmittance', color: '#38bdf8' },
              { id: 'rough', label: 'Roughness', color: '#22c55e' },
            ],
          },
          {
            id: 'transMfp',
            title: 'Transmittance-To-MFP',
            subtitle: '透射色转物理自由程',
            category: 'substrate',
            x: 260,
            y: 25,
            width: 200,
            inputs: [{ id: 'inCol', label: 'Transmittance', color: '#38bdf8' }],
            outputs: [{ id: 'mfp', label: 'MFP', color: '#a855f7' }],
          },
          {
            id: 'fresnelGlass',
            title: 'Fresnel / F0 参数',
            subtitle: 'F0 ≈ 0.04 (玻璃折射边缘亮)',
            category: 'input',
            x: 260,
            y: 150,
            width: 200,
            outputs: [{ id: 'f0', label: 'F0 (0.04)', color: '#e5e7eb' }],
          },
          {
            id: 'iorNode',
            title: '折射率 IOR 参数',
            subtitle: '薄平窗 1.0 / 实心杯 1.52',
            category: 'param',
            x: 260,
            y: 265,
            width: 200,
            outputs: [{ id: 'ior', label: 'IOR', color: '#f59e0b' }],
          },
          {
            id: 'glassSlab',
            title: 'Substrate Slab BSDF',
            subtitle: '清透介质层板',
            category: 'substrate',
            x: 505,
            y: 80,
            width: 205,
            inputs: [
              { id: 'mfp', label: 'SSS MFP', color: '#a855f7' },
              { id: 'rough', label: 'Roughness', color: '#22c55e' },
              { id: 'f0', label: 'F0', color: '#e5e7eb' },
            ],
            outputs: [{ id: 'mat', label: 'Glass Slab', color: '#a855f7' }],
          },
          {
            id: 'glassRoot',
            title: '材质根节点 (Translucent)',
            subtitle: '必开 Surface ForwardShading!',
            category: 'output',
            x: 755,
            y: 120,
            width: 185,
            inputs: [
              { id: 'front', label: 'Front Material', color: '#a855f7' },
              { id: 'refr', label: 'Refraction (IOR)', color: '#f59e0b' },
            ],
          },
        ],
        edges: [
          { fromNode: 'glassColor', fromPin: 'col', toNode: 'transMfp', toPin: 'inCol', color: '#38bdf8' },
          { fromNode: 'transMfp', fromPin: 'mfp', toNode: 'glassSlab', toPin: 'mfp', color: '#a855f7' },
          { fromNode: 'glassColor', fromPin: 'rough', toNode: 'glassSlab', toPin: 'rough', color: '#22c55e' },
          { fromNode: 'fresnelGlass', fromPin: 'f0', toNode: 'glassSlab', toPin: 'f0', color: '#e5e7eb' },
          { fromNode: 'glassSlab', fromPin: 'mat', toNode: 'glassRoot', toPin: 'front', color: '#a855f7' },
          { fromNode: 'iorNode', fromPin: 'ior', toNode: 'glassRoot', toPin: 'refr', color: '#f59e0b' },
        ],
      },
      StageComponent: GlassRefractionStage,
    },

    /* ----------------------------------------------------------------------
     * LESSON 10.3: 🌫️ 雾效与体积材质（Fog）
     * ---------------------------------------------------------------------- */
    {
      id: 'effect-fog-volumetrics',
      moduleId: '10',
      number: '10.3',
      title: '🌫️ 雾效与体积材质（Fog）',
      subtitle: '先懂清晨树林光柱，再玩转体积雾与 Local Fog Volume',
      duration: '15 分钟',
      difficulty: '实战',
      steps: [
        {
          stepNumber: 1,
          shortLabel: '清晨林间光柱',
          tag: 'phenomenon',
          title: '空气明明看不见摸不着，为什么雨后树林会射出金色光柱？',
          paragraphs: [
            '晴朗干燥的大中午，阳光从窗户照进来，你只能看到地板上的亮斑，半空中的光线本身是完全隐形的；可到了雨后初晴的清晨树林，或者有人在阳光斜照的老屋里抖了抖被子，一道道神圣的金色光柱就像舞台追光灯一样凭空显形！',
            '与此同时，远处的层层青山变得越来越淡雅朦胧，山谷低洼处还翻滚着一团团浓淡不均的白雾。这空气里究竟多了什么魔法，既点亮了光束，又柔化了群山？',
          ],
          tryItPrompt:
            '轻轻左右拖动舞台下方的「林间太阳角度」滑块，欣赏阳光穿过松树冠缝隙切出一束束流动金色光柱的美景！',
        },
        {
          stepNumber: 2,
          shortLabel: '水滴散射与消光',
          tag: 'background',
          title: '往清水里滴半滴牛奶：散射点亮光柱，消光朦胧远山',
          paragraphs: [
            '拿激光笔照一杯纯净水，从侧面看水里什么都没有；只要往水里滴半滴牛奶，整条笔直的光束瞬间亮了起来——这就是著名的**丁达尔效应**！',
            '森林晨雾里的无数微小水滴干了两件大事：① **散射（Scattering）**：阳光穿过树叶缝隙往下走时撞上水滴，被水滴半路弹进你的眼睛里；而树干挡住阳光的阴影条里水滴没被照亮，一亮一暗瞬间切出了神圣的**体积光柱（God Rays）**！而且水滴很偏心，最爱顺着阳光前进的方向往前弹（叫**前向散射 `g > 0`**），所以逆光迎着太阳看时光柱最耀眼！',
            '② **消光（Extinction）**：远处青山反射过来的光在半路被水滴撞散消耗掉，山影就一层比一层朦胧深远。',
          ],
          tryItPrompt:
            '把「水滴前向散射系数 (Anisotropy g)」拉到 `0.05` 再推高到 `0.82`，直观对比“平淡均匀白雾”与“逆光璀璨丁达尔金柱”的戏剧性反差！',
          callout: {
            tone: 'tip',
            title: '前向散射（Anisotropy g）怎么理解？',
            body: 'g = 0 代表水滴向四面八方平均乱弹光（整片雾灰蒙蒙一片）；g 接近 0.7~0.85 代表光几乎全顺着太阳视线方向集中弹射，逆光光束瞬间拉满电影感！',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '远中近造雾台',
          tag: 'experiment',
          title: '亲手组合三级造雾神器，再抹掉雾片插地的穿帮硬线！',
          paragraphs: [
            '除了漫天均匀的体积光柱，真实山谷里还有贴着地面翻滚的浓雾团——点击开关 `粒子体积材质 · 噪声山岚`，看谷底瞬间涌起丝丝缕缕流动的立体云雾！',
            '再把目光投向画面右下角虚线框里的**前景省电雾片（把一张画着白雾的半透明平面卡片插在斜坡上）**：试着把 `前景雾片 DepthFade 软边距离` 拉到 `0 cm`！看见那条像硬纸板插进泥土里的刺眼直切线了吗？再缓缓推回 `85 cm`，贴近地面的几厘米自动羽化变透，纸片瞬间化作真雾！',
          ],
          tryItPrompt:
            '重点拉动「前景雾片 DepthFade 软边距离」在 `0 cm` 和 `90 cm` 之间对比，看右下角斜坡上的穿帮切线是如何彻底隐形的！',
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5.8 三级雾箱',
          tag: 'ue5',
          title: '走进 UE 5.8：全局体积雾、Local Fog Volume 与软边雾片分工',
          paragraphs: [
            '在 UE 5.8 商业大作里，美术师绝不会只靠一招吃遍天，而是按远中近精准分工：',
            '在桌面延迟场景添加 Exponential Height Fog，开启 Volumetric Fog，Scattering Distribution 设 0.6。放一盏投影的 Directional Light，Volumetric Scattering Intensity 设 1，用有缝隙的遮挡物挡在光路上。逆光观察光柱。',
            '均匀雾团可直接放 Local Fog Volume Actor 调 Radial Fog Density；动态噪声雾另建 Volume 域材质，用 Substrate Volumetric-Fog-Cloud BSDF 接 Front Material（Volume / Additive）。Albedo 设 (0.8, 0.8, 0.8)，将世界坐标缩放 0.01 后采样 Noise，Saturate 后乘 0.5，再乘 SphereMask(AbsoluteWorldPosition, ParticlePositionWS, ParticleRadius, 0.5) 控制粒子边界，连 Extinction。',
            '在 Niagara 新建一个 CPU 发射器，Spawn Burst Instantaneous 生成 1 个静止粒子，给足寿命与尺寸（如 800 cm）。将体积材质指定给 Sprite Renderer 的 Material，系统放入镜头前。开关该系统，应只有此处的雾团消失。近景雾片另用 Surface 半透明平面，把雾纹理 Alpha 接 DepthFade 的 Opacity，FadeDistance 设 85 cm，输出接 Substrate Coverage Weight 的 Weight，A 接 Unlit BSDF（透射色设黑）。',
          ],
          tryItPrompt:
            '切到右上角「原理图」查看 UE 5.8 体积材质域（Volumetric-Fog-Cloud BSDF）与近景软边雾片的双路线连法！',
          callout: {
            tone: 'ue58',
            title: 'UE 5.8 Local Fog Volume 为什么备受推崇？',
            body: 'Local Fog Volume 通过组件自己的径向和高度密度生成均匀雾团。需要自定义空间噪声时，用注入体积雾的粒子和 Volume 域材质。',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '造雾防坑口诀',
          tag: 'pitfall',
          title: '实战避坑：局部浓雾别硬叠百张半透明，雾片落地必加 DepthFade',
          paragraphs: [
            '收好这句造雾防翻车口诀：**“大光柱开体积雾调前向散射，局部团雾找 Local Fog Volume，凡摆半透明雾片必接 DepthFade”**！',
            '千万别在玩家必经的山谷里密集摆放几十张巨大的半透明烟雾广告牌——多层 `Translucent` 叠在全屏像素上会让显卡 Overdraw（重复涂色）直接爆红掉帧！改用 `Local Fog Volume` 配合少量带 `DepthFade` 的点缀雾片，画面既通透立体，帧率又稳如泰山。',
          ],
          tryItPrompt:
            '点击顶部「看踩坑现象 ↔ 切正确配置」，一眼看清“无前向散射 + 雾片插地硬线”与完整次世代山谷晨雾的差距！',
        },
      ],
      takeaways: [
        '丁达尔体积光柱源于水滴把阳光散射进人眼 + 树木阴影切割明暗，调高前向散射（Anisotropy g）可显著增强逆光神光',
        '远山变淡源于消光（Extinction）沿途吞噬反射光，天然拉开画面近实远虚的大气透视层次',
        '全局光柱用 Volumetric Fog，均匀雾团用 Local Fog Volume，需要纹理噪声的示例用 Niagara 粒子搭载 Volume 材质。',
        '任何半透明烟雾面片/粒子靠近地面墙壁时，必须在 Opacity 乘上 DepthFade 抹除穿插硬边',
      ],
      schematic: {
        title: '粒子体积材质与半透明雾片',
        caption: '上下两路分别建立材质资产。上方给 Niagara Sprite Renderer，下方赋给与地面相交的面片。',
        nodes: [
          {
            id: 'field',
            title: 'Noise × SphereMask',
            subtitle: '世界坐标噪声 × 粒子球形范围',
            category: 'math',
            x: 20, y: 20, width: 215,
            outputs: [{ id: 'rho', label: '0.5 × 局部密度', color: '#e5e7eb' }],
          },
          {
            id: 'vol',
            title: 'Substrate Volumetric-Fog-Cloud BSDF',
            subtitle: 'Albedo = (0.8, 0.8, 0.8)',
            category: 'substrate',
            x: 280, y: 20, width: 215,
            inputs: [{ id: 'rho', label: 'Extinction', color: '#e5e7eb' }],
            outputs: [{ id: 'm', label: 'BSDF', color: '#a855f7' }],
          },
          {
            id: 'particle',
            title: '体积材质',
            subtitle: 'Volume / Additive · 粒子 Sprite',
            category: 'output',
            x: 540, y: 20, width: 215,
            inputs: [{ id: 'm', label: 'Front Material', color: '#a855f7' }],
          },
          {
            id: 'fogAlpha',
            title: '雾纹理',
            subtitle: '平面卡片的 UV',
            category: 'texture',
            x: 20, y: 170, width: 215,
            outputs: [{ id: 'a', label: 'Alpha', color: '#e5e7eb' }],
          },
          {
            id: 'df',
            title: 'DepthFade',
            subtitle: 'Fade Distance = 85 cm',
            category: 'math',
            x: 280, y: 170, width: 215,
            inputs: [{ id: 'a', label: 'Opacity', color: '#e5e7eb' }],
            outputs: [{ id: 'soft', label: '渐隐覆盖', color: '#e5e7eb' }],
          },
          {
            id: 'unlit',
            title: 'Substrate Unlit BSDF',
            subtitle: 'Emissive Color = 灰白，透射色设黑',
            category: 'substrate',
            x: 20, y: 300, width: 215,
            outputs: [{ id: 'm', label: 'BSDF', color: '#a855f7' }],
          },
          {
            id: 'weight',
            title: 'Substrate Coverage Weight',
            subtitle: '雾片自身的材质图',
            category: 'substrate',
            x: 540, y: 190, width: 215,
            inputs: [{ id: 'w', label: 'Weight', color: '#e5e7eb' }, { id: 'm', label: 'A', color: '#a855f7' }],
            outputs: [{ id: 'm', label: 'BSDF', color: '#a855f7' }],
          },
          {
            id: 'plane',
            title: '半透明平面',
            subtitle: 'Surface / Translucent Grey Transmittance',
            category: 'output',
            x: 800, y: 190, width: 215,
            inputs: [{ id: 'm', label: 'Front Material', color: '#a855f7' }],
          },
        ],
        edges: [
          { fromNode: 'field', fromPin: 'rho', toNode: 'vol', toPin: 'rho', color: '#e5e7eb' },
          { fromNode: 'vol', fromPin: 'm', toNode: 'particle', toPin: 'm', color: '#a855f7' },
          { fromNode: 'fogAlpha', fromPin: 'a', toNode: 'df', toPin: 'a', color: '#e5e7eb' },
          { fromNode: 'df', fromPin: 'soft', toNode: 'weight', toPin: 'w', color: '#e5e7eb' },
          { fromNode: 'unlit', fromPin: 'm', toNode: 'weight', toPin: 'm', color: '#a855f7' },
          { fromNode: 'weight', fromPin: 'm', toNode: 'plane', toPin: 'm', color: '#a855f7' },
        ],
      },
      StageComponent: FogVolumetricsStage,
    },

    /* ----------------------------------------------------------------------
     * LESSON 10.4: ✨ 溶解消融与科幻能量护盾
     * ---------------------------------------------------------------------- */
    {
      id: 'effect-dissolve-energy-shield',
      moduleId: '10',
      number: '10.4',
      title: '✨ 溶解消融与科幻能量护盾',
      subtitle: '退潮礁石切割法与穿墙自动亮边魔法',
      duration: '15 分钟',
      difficulty: '实战',
      steps: [
        {
          stepNumber: 1,
          shortLabel: '化灰与护盾亮环',
          tag: 'phenomenon',
          title: '怪兽化为火星消散、护盾碰墙自动亮光圈，难道是手绘动画吗？',
          paragraphs: [
            '在动作游戏里击败强敌时，它全身厚重的装甲会从不规则的缝隙泛起炽热的金红火边，像一张点着的宣纸一样一点点烧蚀化为虚无；而在科幻射击游戏里，一颗半透明的六边形能量罩扣在地面和石柱上，凡是罩子切进石柱的交界处，竟然像装了感应器一样自动亮起一圈紧贴石柱轮廓的高能电弧！',
            '更神奇的是，不管你把能量罩拖到哪根石柱、哪块台阶上，那圈发光交界环都会实时跟着地形走——这显然不可能提前画死在贴图里，显卡是怎么当场算出来的？',
          ],
          tryItPrompt:
            '先在「模式 A」拖动溶解水位看装甲烧蚀，再点上方按钮切到「模式 B」，直接用鼠标抓住蓝色能量护盾左右拖动去撞击石柱！',
        },
        {
          stepNumber: 2,
          shortLabel: '涨潮淹礁与测距',
          tag: 'background',
          title: '两个绝妙算术巧思：海水涨潮淹礁石，与把测距尺反过来使',
          paragraphs: [
            '**溶解消融 = 涨潮淹没高低不平的礁石滩**：拿一张黑白云雾噪波图（`Noise`），黑坑当成海拔 `0.1` 米，白峰当成海拔 `0.9` 米。再拿一个从 `0` 慢慢涨到 `1` 的“水位线”数字去比对：凡是比水位低的像素，直接命令显卡一刀切扔掉！那熊熊燃烧的火边呢？只需把**“噪声值在进度到进度 + 0.07 的范围”的那一圈临水岸线**单独圈出来，乘上 **`12 倍` 超亮橙红光（HDR）**，灼烧边就活了！',
            '**能量护盾碰墙亮环 = 把 `DepthFade` 反过来使**：护盾球本身用 `Fresnel` 做出“正中透明、外轮廓发光”；当护盾球皮插进石柱时，上一节刚用的测距神器 `DepthFade` 在紧贴石柱处算出 `0`、远离处算出 `1`。给它套个 **`OneMinus (1 - x)`** 颠倒黑白，交界处瞬间变成 `1` 亮起耀眼电弧！',
          ],
          tryItPrompt:
            '在「模式 A」一边拉动「溶解水位进度」，一边盯着右侧的 **2D 噪波礁石海拔剖面图**，看蓝色水位线如何吃掉水下虚线、点燃岸边橙色火带！',
          callout: {
            tone: 'formula',
            title: '一行算式看懂反转 DepthFade 交界亮环',
            body: '交界电弧遮罩 = Pow( 1.0 - DepthFade(FadeDistance = 12cm), 2.0 )。距离墙面越趋近 0cm，结果越冲向 1.0 峰值！',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '双特效实验室',
          tag: 'experiment',
          title: '亲手对比 HDR 辉光倍增，再调教护盾碰墙电弧宽度！',
          paragraphs: [
            '在「模式 A：噪波烧蚀溶解」下做个关键实验：把 `自发光 HDR 强度倍增` 拉低到 `×1 HDR`！你会惊讶地发现，原本炽热刺眼的岩浆火边瞬间蔫了，变成一条像拿橘黄色水彩笔画上去的死板塑料边！推回 `×12 HDR`，超界亮度触发色调映射与泛光，烈焰质感立刻回归。',
            '再切换到「模式 B：科幻能量护盾」：把护盾拖到正好切过右侧石柱肚子中间，来回拖动 `碰墙亮环宽度 (1 - DepthFade)` 从 `0 cm` 到 `18 cm`，观察没有亮环时的生硬穿模感与加上电弧环后的浑然一体感！',
          ],
          tryItPrompt:
            '分别在模式 A 和模式 B 下点击顶部的「看踩坑现象」，比较火边的两档线性发光强度及护盾的交界环！',
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5.8 节点拆解',
          tag: 'ue5',
          title: '走进 UE 5.8：Masked 一刀切镂空与 Substrate 自发光连法',
          paragraphs: [
            '溶解用 Surface / Masked，材质的 Opacity Mask Clip Value 保持默认 0.3333。Noise 和进度 L 进 If 的 A、B，A>B 和 A=B 填 1，A<B 填 0；将 Equals Threshold 设 0，输出 Keep 接根节点 Opacity Mask。边带强度用 Keep × (1 − Saturate((Noise − L) / Width))，Width 设 0.07，再乘橙色与 12，接 Slab 的 Emissive Color。',
            '验收时设 L=0.46：Noise=0.45 裁掉，0.49 可见且发光，0.53 及更高值可见但没有火边。护盾另用 Surface / Translucent 材质，以 Fresnel 控制 Coverage Weight 的 Weight，DepthFade（Opacity=1）→ OneMinus 作为交界发光权重。',
          ],
          tryItPrompt:
            '切到右上角「原理图」视图，对照查看溶解切割支路与反转 DepthFade 护盾支路是如何汇入 Substrate 层板的！',
          callout: {
            tone: 'ue58',
            title: '动态驱动溶解进度的小技巧',
            body: '把 DissolveLevel 设为 Scalar Parameter，在蓝图 Timeline 或 Niagara 粒子 Dynamic Material Parameters 中从 0 推到 1，角色即可丝滑化灰消散！',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '特效防坑口诀',
          tag: 'pitfall',
          title: '固定溶解轮廓，再比较火边的线性发光强度',
          paragraphs: [
            '先将火边强度设为 0，检查几何裁剪；再逐步增加强度。UE 中 Bloom 还受后处理和曝光影响，可在固定曝光下开关 Bloom 比较轮廓和泛光。',
            'DepthFade 在半透明雾片靠近不透明地面时减弱覆盖；用 OneMinus 反转后，同一段深度差能给护盾与墙面的交界加亮。',
          ],
          tryItPrompt:
            '试着把护盾的 `Fresnel 边缘发光强度` 拉低再拉高，体会外轮廓 Fresnel 与碰墙 DepthFade 两圈光环是如何默契配合的！',
        },
      ],
      takeaways: [
        '溶解消融本质是用上涨的阈值切割黑白噪波地形图：低于水位用 Masked 丢弃，高于水位窄带赋予高倍燃烧自发光',
        '硬边溶解务必选用 Masked 混合模式而非 Translucent，零排序错乱且自动拥有随溶解收缩的精准动态阴影',
        '提高线性发光强度可提亮火边，是否出现可见 Bloom 还取决于曝光与后处理设置。',
        '科幻能量护盾将 Fresnel（外轮廓亮中间透）与 OneMinus(DepthFade)（碰墙交界距离趋零处爆亮）结合，实现全自动地形感应光环',
      ],
      schematic: {
        title: '溶解与护盾使用两个独立材质',
        caption: '上方 Keep 同时控制裁剪与发光。L=0.46、Width=0.07 时，Noise=0.49 的像素保留并发光。下方用半透明材质绘制护盾。',
        nodes: [
          {
            id: 'in',
            title: 'Noise 与溶解进度',
            subtitle: '灰度纹理 R；标量 L = 0.46',
            category: 'param',
            x: 20, y: 20, width: 215,
            outputs: [{ id: 'n', label: 'Noise', color: '#e5e7eb' }, { id: 'l', label: 'L', color: '#e5e7eb' }],
          },
          {
            id: 'keep',
            title: 'If（Equals Threshold = 0）',
            subtitle: '大于 / 等于填 1，小于填 0',
            category: 'math',
            x: 280, y: 20, width: 215,
            inputs: [{ id: 'a', label: 'A', color: '#e5e7eb' }, { id: 'b', label: 'B', color: '#e5e7eb' }],
            outputs: [{ id: 'k', label: 'Keep ∈ {0,1}', color: '#e5e7eb' }],
          },
          {
            id: 'band',
            title: '计算保留侧火边',
            subtitle: 'Keep × (1 − Saturate((N−L)/0.07))',
            category: 'math',
            x: 545, y: 155, width: 215,
            inputs: [{ id: 'n', label: 'N', color: '#e5e7eb' }, { id: 'l', label: 'L', color: '#e5e7eb' }, { id: 'k', label: 'Keep', color: '#e5e7eb' }],
            outputs: [{ id: 'e', label: '乘橙色与强度 12', color: '#f59e0b' }],
          },
          {
            id: 'slab',
            title: 'Substrate Slab BSDF',
            subtitle: '装甲表面',
            category: 'substrate',
            x: 805, y: 160, width: 215,
            inputs: [{ id: 'e', label: 'Emissive Color', color: '#f59e0b' }],
            outputs: [{ id: 'm', label: 'BSDF', color: '#a855f7' }],
          },
          {
            id: 'out',
            title: '溶解材质',
            subtitle: 'Surface / Masked · Clip 0.3333',
            category: 'output',
            x: 1065, y: 70, width: 215,
            inputs: [{ id: 'k', label: 'Opacity Mask', color: '#e5e7eb' }, { id: 'm', label: 'Front Material', color: '#a855f7' }],
          },
          {
            id: 'df',
            title: 'DepthFade → OneMinus',
            subtitle: 'Opacity = 1，Fade Distance = 12 cm',
            category: 'math',
            x: 20, y: 355, width: 215,
            outputs: [{ id: 's', label: '交界亮环', color: '#e5e7eb' }],
          },
          {
            id: 'rim',
            title: 'Fresnel + 交界亮环',
            subtitle: '组合并限幅；另乘青色作 HDR 发光',
            category: 'math',
            x: 280, y: 355, width: 215,
            inputs: [{ id: 's', label: '交界亮环', color: '#e5e7eb' }],
            outputs: [{ id: 'rgb', label: 'HDR 电光色', color: '#f59e0b' }, { id: 'a', label: '覆盖率 0…1', color: '#e5e7eb' }],
          },
          {
            id: 'shield',
            title: 'Substrate Unlit BSDF',
            subtitle: 'TransmittanceColor 设黑，另控覆盖',
            category: 'substrate',
            x: 545, y: 355, width: 215,
            inputs: [{ id: 'e', label: 'Emissive Color', color: '#f59e0b' }],
            outputs: [{ id: 'm', label: 'BSDF', color: '#a855f7' }],
          },
          {
            id: 'weight',
            title: 'Substrate Coverage Weight',
            subtitle: '透明护盾覆盖',
            category: 'substrate',
            x: 805, y: 355, width: 215,
            inputs: [{ id: 'm', label: 'A', color: '#a855f7' }, { id: 'a', label: 'Weight', color: '#e5e7eb' }],
            outputs: [{ id: 'm', label: 'BSDF', color: '#a855f7' }],
          },
          {
            id: 'shieldroot',
            title: '护盾材质',
            subtitle: 'Surface / Translucent Grey Transmittance',
            category: 'output',
            x: 1065, y: 355, width: 215,
            inputs: [{ id: 'm', label: 'Front Material', color: '#a855f7' }],
          },
        ],
        edges: [
          { fromNode: 'in', fromPin: 'n', toNode: 'keep', toPin: 'a', color: '#e5e7eb' },
          { fromNode: 'in', fromPin: 'l', toNode: 'keep', toPin: 'b', color: '#e5e7eb' },
          { fromNode: 'in', fromPin: 'n', toNode: 'band', toPin: 'n', color: '#e5e7eb' },
          { fromNode: 'in', fromPin: 'l', toNode: 'band', toPin: 'l', color: '#e5e7eb' },
          { fromNode: 'keep', fromPin: 'k', toNode: 'band', toPin: 'k', color: '#e5e7eb' },
          { fromNode: 'keep', fromPin: 'k', toNode: 'out', toPin: 'k', color: '#e5e7eb' },
          { fromNode: 'band', fromPin: 'e', toNode: 'slab', toPin: 'e', color: '#f59e0b' },
          { fromNode: 'slab', fromPin: 'm', toNode: 'out', toPin: 'm', color: '#a855f7' },
          { fromNode: 'df', fromPin: 's', toNode: 'rim', toPin: 's', color: '#e5e7eb' },
          { fromNode: 'rim', fromPin: 'rgb', toNode: 'shield', toPin: 'e', color: '#f59e0b' },
          { fromNode: 'rim', fromPin: 'a', toNode: 'weight', toPin: 'a', color: '#e5e7eb' },
          { fromNode: 'shield', fromPin: 'm', toNode: 'weight', toPin: 'm', color: '#a855f7' },
          { fromNode: 'weight', fromPin: 'm', toNode: 'shieldroot', toPin: 'm', color: '#a855f7' },
        ],
      },
      StageComponent: DissolveShieldStage,
    },

    /* ----------------------------------------------------------------------
     * LESSON 10.5: ❄️ 世界空间自动积雪与免 UV 三平面投射
     * ---------------------------------------------------------------------- */
    {
      id: 'effect-world-snow-triplanar',
      moduleId: '10',
      number: '10.5',
      title: '❄️ 世界空间自动积雪与免 UV 三平面投射',
      subtitle: '滚石不掉雪与告别贴图拉丝',
      duration: '14 分钟',
      difficulty: '进阶',
      steps: [
        {
          stepNumber: 1,
          shortLabel: '滚石顶面落雪',
          tag: 'phenomenon',
          title: '雪山关卡摆了五百块歪七扭八的石头，难道要一块块手画积雪吗？',
          paragraphs: [
            '设想你正在搭建一座暴风雪山谷：关卡设计师拿同一块大石头模型复制了 500 份，有的横着放、有的倒立插进土里、有的斜着搭成石拱门。如果白雪是画死在石头贴图上的，一旦把石头翻个底朝天，白雪就会滑稽地粘在不见天日的石头肚子底下！',
            '转身再看旁边的挡土砖墙：设计师为了省事把一块 1 米宽的墙模型直接横向拉长了 5 倍，结果上面的红砖和灰缝全被拽成了五米长的“宽面条”！有没有办法让材质自己认得天空在哪、自己拿尺子量好一米贴几块砖？',
          ],
          tryItPrompt:
            '直接用鼠标抓住左侧大石头来回翻滚旋转（注意看石头上的红色标记条跟着石头360°打转），看看白雪是不是像长了眼睛一样永远稳稳盖在朝天的顶面上！',
        },
        {
          stepNumber: 2,
          shortLabel: '朝天轴与幻灯机',
          tag: 'background',
          title: '世界空间永远认得头顶天空，三台幻灯机彻底解放橘子皮 UV',
          paragraphs: [
            '把第 1 章学的「空间参考系」掏出来，这两个难题一秒迎刃而解！**第一招（滚石不掉雪）**：不管石头模型自己的局部坐标怎么翻跟头，整个游戏**世界空间（World Space）的正上方天空永远是 `+Z` 轴（蓝通道 `B`）**！只要读取每个像素表面小牙签在世界空间里的朝天值（`WorldNormal.Z`）：笔直朝天是 `+1.0`，垂直侧面是 `0.0`，朝地底面是 `-1.0`！先用 Saturate 限制为 0 到 1，再送入 Lerp；朝下 Z=−1 时权重为 0，取回岩石色。',
            '**第二招（拉墙不拉丝）**：既然拉长模型会把自带的“橘子皮 UV”拽变形，那就干脆扔掉模型 UV！改拿像素在世界里的真实米数，从**头顶（Z）、正面（X）、侧面（Y）架起三台隐形幻灯机**往墙上投射砖块——这就是**三平面投射（Triplanar / `WorldAlignedTexture`）**！',
          ],
          tryItPrompt:
            '点击顶部「看踩坑现象」，看看把雪画死在局部空间时石头翻到 145° 雪挂在肚子底下的穿帮画面，以及右侧砖墙拉成面条的惨状！',
          callout: {
            tone: 'tip',
            title: '为什么连岩石侧面的朝天小凹坑也能积雪？',
            body: '如果读贴了法线贴图之后的像素级世界法线（PixelNormalWS），连石头侧面微微朝天凸起的小石棱也会精准积上一小撮白雪，真实感爆棚！',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '翻滚巨石与拉墙',
          tag: 'experiment',
          title: '亲手调节暴雪覆盖厚度，再把墙体拉长 5 倍考验幻灯机！',
          paragraphs: [
            '切回正确配置后，试试拖动 `积雪覆盖斜率阈值`：往左拉到 `-0.1`，连陡峭侧壁都裹上厚厚暴雪（同时积雪会自动把底下尖锐的岩石法线填平变得蓬松圆润！）；往右拉到 `0.65`，只剩最平坦的石顶留下一层薄霜。',
            '接着看右侧砖墙：先把投射方式切到 `传统 UV (拉成面条)` 并拉动 `砖墙横向拉伸倍数` 从 `1.0×` 到 `5.0×`，亲眼看着好好的红砖被生生扯成面条；再点一下 `WorldAligned 三平面`，三台世界幻灯机瞬间接管，无论你怎么拉长缩短模型，每一块砖都永远严守标准尺寸！',
          ],
          tryItPrompt:
            '开启「WorldAligned 三平面」后，来回拉动「砖墙横向拉伸倍数 (1.0× ~ 5.0×)」，看墙体变宽时砖块是不是自动增加数量而绝不变形！',
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5.8 节点落地',
          tag: 'ue5',
          title: '走进 UE 5.8：PixelNormalWS.B 控雪与 WorldAlignedTexture',
          paragraphs: [
            '在 UE 5.8 材质编辑器里实现这两招干净利落：① **自动积雪 / 自动长青苔**：拖出 **`PixelNormalWS`** 节点 → 连入 **`ComponentMask (只勾 B)`** 拿到世界朝天值 → 基础做法用 `Saturate` 锁回 `0~1`；要复现网页的阈值控件，先算 t=Saturate((Z−阈值+0.14)/0.28)，再取 SmoothStep 的结果 t²(3−2t)，连入 `Lerp` 的 `Alpha` 混合岩石与白雪的漫反射色（注意白雪物理亮度填 `0.82~0.88`，别填 `1.0` 纯白过曝！）。',
            '② **免 UV 三平面投射**：右键直接搜内置函数 **`WorldAlignedTexture`**（法线贴图用配套的 **`WorldAlignedNormal`**），注意它要求拖入 **`Texture Object`（纹理对象）** 而非普通 Texture Sample，在 `TextureSize` 填 `200`（代表世界每 200 厘米铺满一次），悬崖地形与灰盒白模当场起飞！',
          ],
          tryItPrompt:
            '点击右上角「原理图」视图，查看 WorldAlignedTexture 配合 PixelNormalWS.B 组合成“免展 UV 自动覆雪悬崖母材质”的经典工业连法！',
          callout: {
            tone: 'ue58',
            title: 'VertexNormalWS vs PixelNormalWS 选哪个？',
            body: '想省算力或做柔和过渡用 VertexNormalWS（顶点世界法线）；想要积雪卡进法线贴图的凹凸石缝里，用 PixelNormalWS（像素世界法线）！',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '空间防坑口诀',
          tag: 'pitfall',
          title: '实战避坑：会滚的动态雪球别用世界法线，三平面等于采三次图',
          paragraphs: [
            '这两招虽爽，但有两个必须心里有数的工程边界：**① 动态滚动的物体别用世界积雪**！这套魔法专供**静止岩石、房屋、地形**——如果你给一颗正往山下骨碌碌滚的物理滚石用了世界法线积雪，石头在转，白雪却像头顶打下来的舞台灯光一样钉在上方不跟着石头转，一秒穿帮！',
            '**② 三平面投射吃 3 倍采样算力**：`WorldAlignedTexture` 底层从 X、Y、Z 三个方向各读了一次贴图再混合（1 张颜色 + 1 张法线就等于采了 6 次图！），所以专留给悬崖峭壁、洞穴和白盒关卡，普通规整小道具还是乖乖用自带 UV 最省电。',
          ],
          tryItPrompt:
            '试着快速连续拖动「岩石旋转角度」模拟滚石下山，观察白雪始终留在正上方不随岩石翻滚的现象，秒懂为什么它专属于静态环境资产！',
        },
      ],
      takeaways: [
        '读取 PixelNormalWS 的蓝通道（B / 世界 +Z 轴）即可实时获知每个像素是否朝向天空，任意旋转静态岩石积雪永远在顶面',
        '积雪覆盖处应同步 Lerp 降低法线凹凸强度并调整粗糙度，模拟厚雪填平石缝的蓬松质感（白雪反照率约 0.85）',
        'WorldAlignedTexture（三平面投射）按世界真实米数从 X/Y/Z 三向投影贴图，彻底解决模型非均匀缩放导致的 UV 拉丝',
        '注意工程边界：动态翻滚道具禁用世界法线积雪（雪不会随物体转），且三平面投射消耗 3 倍纹理采样性能',
      ],
      schematic: {
        title: 'UE 5.8 免 UV 三平面岩石 + 世界空间自动积雪母材质图',
        caption: 'WorldAlignedTexture 消除拉伸，PixelNormalWS (Mask B) 精准识别朝天面驱动 Lerp 落雪',
        nodes: [
          {
            id: 'texObj',
            title: 'WorldAlignedTexture',
            subtitle: 'X/Y/Z 三向幻灯机 (Size=200)',
            category: 'texture',
            x: 20,
            y: 25,
            width: 205,
            outputs: [{ id: 'xyzCol', label: 'XYZ 岩石色', color: '#e5e7eb' }],
          },
          {
            id: 'snowConst',
            title: '白雪材质参数',
            subtitle: 'Albedo ≈ 0.85 · Rough ≈ 0.6',
            category: 'param',
            x: 20,
            y: 150,
            width: 205,
            previewColor: '#f1f5f9',
            outputs: [{ id: 'sCol', label: '白雪颜色', color: '#38bdf8' }],
          },
          {
            id: 'pixWs',
            title: 'PixelNormalWS → Mask(B)',
            subtitle: '提取世界 +Z 朝天分量',
            category: 'input',
            x: 20,
            y: 270,
            width: 205,
            outputs: [{ id: 'zUp', label: 'World Z (-1~1)', color: '#3b82f6' }],
          },
          {
            id: 'snowBias',
            title: 'SmoothStep（内部 Saturate）',
            subtitle: '阈值 ± 0.14，输出 0…1',
            category: 'math',
            x: 270,
            y: 265,
            width: 200,
            inputs: [{ id: 'z', label: 'World Z', color: '#3b82f6' }],
            outputs: [{ id: 'alpha', label: '积雪 Alpha', color: '#e5e7eb' }],
          },
          {
            id: 'lerpRockSnow',
            title: 'Lerp (冷热水混水阀)',
            subtitle: '0=岩石 · 1=朝天白雪',
            category: 'math',
            x: 280,
            y: 80,
            width: 195,
            inputs: [
              { id: 'a', label: 'A (岩石)', color: '#e5e7eb' },
              { id: 'b', label: 'B (白雪)', color: '#38bdf8' },
              { id: 'al', label: 'Alpha', color: '#e5e7eb' },
            ],
            outputs: [{ id: 'outCol', label: '混合颜色', color: '#22c55e' }],
          },
          {
            id: 'snowSlab',
            title: 'Substrate Slab BSDF',
            subtitle: '同步混合颜色/粗糙度/法线',
            category: 'substrate',
            x: 520,
            y: 110,
            width: 200,
            inputs: [{ id: 'diff', label: 'Diffuse Albedo', color: '#22c55e' }],
            outputs: [{ id: 'mat', label: 'Slab Out', color: '#a855f7' }],
          },
          {
            id: 'snowRoot',
            title: '材质根节点',
            subtitle: '悬崖/雪山万用母材质',
            category: 'output',
            x: 760,
            y: 115,
            width: 175,
            inputs: [{ id: 'front', label: 'Front Material', color: '#a855f7' }],
          },
        ],
        edges: [
          { fromNode: 'texObj', fromPin: 'xyzCol', toNode: 'lerpRockSnow', toPin: 'a', color: '#e5e7eb' },
          { fromNode: 'snowConst', fromPin: 'sCol', toNode: 'lerpRockSnow', toPin: 'b', color: '#38bdf8' },
          { fromNode: 'pixWs', fromPin: 'zUp', toNode: 'snowBias', toPin: 'z', color: '#3b82f6' },
          { fromNode: 'snowBias', fromPin: 'alpha', toNode: 'lerpRockSnow', toPin: 'al', color: '#e5e7eb' },
          { fromNode: 'lerpRockSnow', fromPin: 'outCol', toNode: 'snowSlab', toPin: 'diff', color: '#22c55e' },
          { fromNode: 'snowSlab', fromPin: 'mat', toNode: 'snowRoot', toPin: 'front', color: '#a855f7' },
        ],
      },
      StageComponent: WorldSnowTriplanarStage,
    },

    /* ----------------------------------------------------------------------
     * LESSON 10.6: 🧊 温润玉石透光（SSS）与跑车双层清漆
     * ---------------------------------------------------------------------- */
    {
      id: 'effect-sss-jade-clearcoat',
      moduleId: '10',
      number: '10.6',
      title: '🧊 温润玉石透光（SSS）与跑车双层清漆',
      subtitle: '手指透红光与 Substrate 物理叠层',
      duration: '15 分钟',
      difficulty: '实战',
      steps: [
        {
          stepNumber: 1,
          shortLabel: '手指透红与车漆',
          tag: 'phenomenon',
          title: '为什么手电筒贴着手指肚会透红光，豪车烤漆却像包了一层薄水晶？',
          paragraphs: [
            '现在不妨拿手机闪光灯贴紧你的手指肚或者耳垂试试：强光并没有像照在铁块上那样被严严实实挡死，而是钻进肉里跑了好几毫米，把薄薄的指尖和耳廓照得通红透亮！同样的“温润生气”，也出现在逆光下的冰种翡翠、白蜡烛与嫩树叶上。',
            '再看停在展厅灯管下的百万级跑车引擎盖：你低头既能看清底下颗粒闪烁、光斑柔和的金属色粉，又能同时看清最表层像镜子一样锐利笔直的白色灯管倒影！普通单层材质粗糙度要么全糊要么全亮，怎么可能同时既柔和又锐利？',
          ],
          tryItPrompt:
            '先在「模式 A」把聚光灯转到玉佩背面看薄边透翠绿（还可切到「温润人耳廓」看耳垂透红血色！），再切「模式 B」点击画面右侧揭开跑车清漆薄片对比！',
        },
        {
          stepNumber: 2,
          shortLabel: '自由程与双叠层',
          tag: 'background',
          title: '光在肉里能跑几毫米（MFP），以及物理世界真正的“双层叠罗汉”',
          paragraphs: [
            '**温润美玉与皮肤的秘密 —— 次表面散射（SSS）与平均自由程（`MFP`）**：半透明固体既不像铁块完全挡光，也不像清水一览无余，光线钻进去后会在内部微粒间弹跳几毫米再散出来。衡量它有多透的物理尺子就叫**平均自由程（Mean Free Path，简称 `MFP`）**——代表光子在里面平均能跑几毫米！所以 `1.5 毫米` 薄的玉雕龙鳍和耳廓一照就透亮，而 `13 毫米` 厚的玉佩肚子光穿不过去，自然保持沉稳浑厚！',
            '**豪车烤漆的秘密 —— 物理双层涂层**：真实跑车漆本来就是两层物质叠在一起！底层是较粗糙（`Roughness ≈ 0.45`）的彩色金属闪粉底漆，头顶实打实喷涂了一层极光滑（`Roughness ≈ 0.04`）的无色透明清漆，两层各自反射各的高光！',
          ],
          tryItPrompt:
            '在「模式 A」下把聚光灯停在 `155°` 背光位，缓缓把 `MFP 平均自由程` 从 `0 mm` 拉到 `10 mm`，看死硬绿石头如何从薄雕花边缘一点点化为冰种美玉！',
          callout: {
            tone: 'tip',
            title: '为什么耳朵背光透出的是红光而不是白光？',
            body: '人体皮肤与血液对蓝绿光吸收极强（MFP 仅零点几毫米），唯独红光的 MFP 长达数毫米能穿透耳垂——所以填皮肤 MFP 时红通道最大、绿蓝极小！',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '美玉与清漆实验室',
          tag: 'experiment',
          title: '亲手转灯验薄厚透光，再动手揭盖 Substrate 清漆积木！',
          paragraphs: [
            '在「模式 A」里，把 `聚光灯环绕角度` 从 `155°`（背光）慢慢转回 `0°`（正对镜头正面光）：注意看右上角小罗盘！当灯转到正面时，背光透射自然消退，玉佩恢复温润内敛；一旦点击顶部「看踩坑现象（用自发光假冒透光）」，不管灯在哪甚至关灯，整块玉都在像廉价绿塑料灯泡一样不分薄厚瞎发光！',
            '切换到「模式 B：跑车双层清漆」：直接点击画面右侧那块悬空的蓝色透明薄片（或拨动下方开关），对比单层粗糙车壳的“哑光塑料感”与盖上 `Roughness 0.04` 清漆后两条锐利车库灯管倒影浮现的高级“包浆感”！',
          ],
          tryItPrompt:
            '在「模式 B」盖上透明清漆后，试着单独拉高「底层金属闪粉粗糙度」到 `0.65` 而保持「顶层清漆粗糙度」为 `0.03`，感受底层越柔散、表层越清亮的双重纵深！',
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5.8 层板积木',
          tag: 'ue5',
          title: '走进 UE 5.8：Substrate 最耀眼的主场 —— MFP 与 Vertical Layer',
          paragraphs: [
            '先做一个能控制厚度的背光样片：桌面延迟场景放一张平面，让 Spot Light 从平面后方向镜头照。材质使用 Surface / Opaque，勾选 Two Sided 与 Is Thin Surface。选中 Slab，将 Sub-Surface Type 设为 Two-Sided Wrap，接到 Front Material。',
            'SSS MFP 的 RGB 分量都是厘米。网页滑块 10 mm 即基准 1 cm，玉石示例乘通道系数后接 (0.28, 1.18, 0.55) cm。用线性灰度厚度图 R 作 Lerp 权重，将 0.15 cm（薄边）到 1.30 cm（厚芯）的插值接根节点 Surface Thickness。先背光查看薄处透绿，再转到正面。厚度来自你指定的尺寸图；网页用预设形状生成同一类厚度分布。',
            '② 做**跑车漆 / 打蜡木地板 / 雨淋湿鹅卵石**：建两块 `Substrate Slab BSDF`，用一颗 **`Substrate Vertical Layer（垂直叠层）`** 把光滑透明顶层（`Top`）盖在粗糙底层（`Bottom`）之上连入 `Front Material`，界面折损与能量守恒全自动精准搞定！',
          ],
          tryItPrompt:
            '打开右上角「原理图」视图，看看两块 Substrate Slab 是如何像搭乐高积木一样通过 Substrate Vertical Layer 叠在一起的！',
          callout: {
            tone: 'ue58',
            title: '雨天淋湿地面怎么用 Vertical Layer 一秒做出来？',
            body: '底层还是原本粗糙干燥的砖石 Slab，下雨时用雨水遮罩控制顶层光滑水膜 Slab 的覆盖权重（Top Coverage），干湿过渡比传统改粗糙度真实十倍！',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '透光叠层避坑',
          tag: 'pitfall',
          title: '实战避坑：严禁拿自发光冒充 SSS，清漆顶层必须是透明电介质',
          paragraphs: [
            '牢记这两条物理材质避坑准则：**“真玉透光靠 MFP 听灯光与厚度指挥，自发光进暗室会穿帮成鬼火；双层清漆顶层必是透明非金属，涂实了底漆全白做！”**',
            '用 `Substrate Vertical Layer` 做清漆时，顶层 `Top` 积木必须保持非金属且具备高透射率（清澈透明或带一点点有色清漆滤镜），千万别误把顶层设成不透明漫反射或 `Metallic = 1`，否则就像往跑车漆上又刷了一层厚银粉漆，底下的金属闪粉连一丝光都透不出来了！',
          ],
          tryItPrompt:
            '在「模式 B」切换「竞速红 / 星际蓝 / 祖母绿」三种跑车底漆，欣赏同一片无色透明清漆盖在不同底色上自动呈现的深邃烤漆光泽！',
        },
      ],
      takeaways: [
        '本例的 Two-Sided Wrap 是薄片近似。SSS MFP 和 Surface Thickness 均以厘米输入，透射随给定厚度与背光条件变化。',
        '通道差异化 MFP 决定透射色调：人耳/手指红通道 MFP 最长故背光透红；翡翠绿通道 MFP 最长故背光透翠',
        '跑车烤漆、上釉陶瓷与潮湿岩石本质是“粗糙底层 + 光滑透明表层”，用 Substrate Vertical Layer 垂直叠层物理还原双高光',
        '切忌用 Emissive 自发光伪造玉石透光（无光暗室也会发光穿帮），且清漆顶层 Slab 必须保持透明电介质属性',
      ],
      schematic: {
        title: '玉石薄片与车漆的独立材质图',
        caption: '玉石薄片使用给定的厚度图与厘米单位的自由程。另建材质比较底漆与覆有透明清漆的表面。',
        nodes: [
          {
            id: 'mfp',
            title: 'Vector Parameter',
            subtitle: '10 mm 基准 × 玉石各通道系数',
            category: 'param',
            x: 20, y: 20, width: 215,
            outputs: [{ id: 'r', label: '(0.28, 1.18, 0.55) cm', color: '#22c55e' }],
          },
          {
            id: 'thickness',
            title: '厚度图 R → Lerp',
            subtitle: '黑 0.15 cm，白 1.30 cm',
            category: 'math',
            x: 280, y: 135, width: 215,
            outputs: [{ id: 't', label: '厚度 cm', color: '#e5e7eb' }],
          },
          {
            id: 'jade',
            title: 'Substrate Slab BSDF',
            subtitle: 'Sub-Surface Type = Two-Sided Wrap',
            category: 'substrate',
            x: 280, y: 20, width: 215,
            inputs: [{ id: 'r', label: 'SSS MFP', color: '#22c55e' }],
            outputs: [{ id: 'm', label: 'BSDF', color: '#a855f7' }],
          },
          {
            id: 'jadeRoot',
            title: '玉石薄片材质',
            subtitle: 'Opaque · Two Sided · Is Thin Surface',
            category: 'output',
            x: 550, y: 45, width: 215,
            inputs: [{ id: 'm', label: 'Front Material', color: '#a855f7' }, { id: 't', label: 'Surface Thickness', color: '#e5e7eb' }],
          },
          {
            id: 'top',
            title: '透明清漆 Slab',
            subtitle: '漫反射黑，F0 0.04，粗糙度 0.04',
            category: 'substrate',
            x: 20, y: 285, width: 215,
            outputs: [{ id: 'm', label: 'BSDF', color: '#a855f7' }],
          },
          {
            id: 'base',
            title: '金属底漆 Slab',
            subtitle: '有色 F0，漫反射黑，粗糙度 0.45',
            category: 'substrate',
            x: 20, y: 405, width: 215,
            outputs: [{ id: 'm', label: 'BSDF', color: '#a855f7' }],
          },
          {
            id: 'layer',
            title: 'Substrate Vertical Layer',
            subtitle: 'Top Thickness = 0.01 cm',
            category: 'substrate',
            x: 280, y: 310, width: 215,
            inputs: [{ id: 't', label: 'Top', color: '#a855f7' }, { id: 'b', label: 'Bottom', color: '#a855f7' }],
            outputs: [{ id: 'm', label: 'BSDF', color: '#a855f7' }],
          },
          {
            id: 'coatRoot',
            title: '车漆材质',
            subtitle: 'Surface / Opaque',
            category: 'output',
            x: 550, y: 310, width: 215,
            inputs: [{ id: 'm', label: 'Front Material', color: '#a855f7' }],
          },
        ],
        edges: [
          { fromNode: 'mfp', fromPin: 'r', toNode: 'jade', toPin: 'r', color: '#22c55e' },
          { fromNode: 'jade', fromPin: 'm', toNode: 'jadeRoot', toPin: 'm', color: '#a855f7' },
          { fromNode: 'thickness', fromPin: 't', toNode: 'jadeRoot', toPin: 't', color: '#e5e7eb' },
          { fromNode: 'top', fromPin: 'm', toNode: 'layer', toPin: 't', color: '#a855f7' },
          { fromNode: 'base', fromPin: 'm', toNode: 'layer', toPin: 'b', color: '#a855f7' },
          { fromNode: 'layer', fromPin: 'm', toNode: 'coatRoot', toPin: 'm', color: '#a855f7' },
        ],
      },
      StageComponent: SssClearCoatStage,
    },

    /* ----------------------------------------------------------------------
     * LESSON 10.7: 🎨 冰层内裂纹视差与 UE 5.8 原生卡通渲染
     * ---------------------------------------------------------------------- */
    {
      id: 'effect-bumpoffset-ice-toon',
      moduleId: '10',
      number: '10.7',
      title: '🎨 冰层内裂纹视差与 UE 5.8 原生卡通渲染',
      subtitle: '平面造三尺冰冻景深与二次元色阶刀',
      duration: '15 分钟',
      difficulty: '实战',
      steps: [
        {
          stepNumber: 1,
          shortLabel: '深冰与二次元',
          tag: 'phenomenon',
          title: '两块纯平三角形怎么冻出三尺深冰？写实模型又怎么一秒变动漫？',
          paragraphs: [
            '欢迎来到压轴收官课！先看第一个视觉魔术：在极地冒险游戏里低头看冰封湖面，表层结着白霜，往下半米冻着气泡，再往下两米蜿蜒着幽蓝深渊冰裂——你左右晃动视角，深处的冰裂竟然真的跟表层白霜错开滑动！可打开网格线框一看，整片冰面明明只是**两块薄如蝉翼的纯平三角形**！',
            '再看第二个魔术：同样一颗三维角色模型，写实游戏里光影柔顺过渡，而《原神》《罪恶装备》这类二次元动漫风里，亮部与暗部却像动画师拿马克笔一刀切出来一样干净利落！这两大终极幻术，背后其实都只隔着一层窗户纸。',
          ],
          tryItPrompt:
            '直接用鼠标在左侧冰面上左右来回拖动晃动视角（注意看绿色的 2-三角形纯平线框！），再切换到「模式 B」一键把写实球切成二次元动漫风！',
        },
        {
          stepNumber: 2,
          shortLabel: '视差与色阶剪刀',
          tag: 'background',
          title: '坐高铁看窗外的“运动视差”，以及一刀剪断渐变的“色阶刀”',
          paragraphs: [
            '**平面造三尺寒冰 —— 运动视差（Parallax）骗眼术**：回想你坐高铁往窗外看，铁轨边的护栏飞速往后退，远方的大山几乎不动——人脑天生靠“晃头时不同深度的东西错位速度不同”来感知立体纵深！在纯平冰面上，表层白霜钉在原位不动；对于假装在冰下 50 厘米的裂纹贴图，只要顺着你的视线斜角把它的 **`UV` 坐标偷偷往视线延长线方向挪一点点**（越深挪越多），你一晃镜头，大脑当场就被骗出了三尺厚冰的深邃景深！',
            '**写实秒变二次元 —— 色阶剪刀（Cel-Shading）**：第 7 章学的漫反射 `Dot(N, L)` 原本是从 `1` 到 `0` 的平滑斜坡；二次元只需拿一把“色阶剪刀”卡在阈值（比如 `0.45`）一刀剪断——大于它全给干净亮色，小于它全给通透阴影色，三维体积瞬间化作手绘赛璐璐！',
          ],
          tryItPrompt:
            '在「模式 A」拖动视角时盯住右侧的 **视线错位剖面图**，看黄色视线穿过冰面后，是如何在浅层气泡与深渊裂谷处落到不同横向坐标上的！',
          callout: {
            tone: 'formula',
            title: 'BumpOffset 视差偏移极简原理',
            body: 'UV 偏移 = ViewTS.xy × (Height − ReferencePlane) × HeightRatio。Height 等于参考平面时采样坐标保持原位。',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '晃镜头与切画风',
          tag: 'experiment',
          title: '亲手叠出三层深渊寒冰，再挥动二次元明暗二分剪刀！',
          paragraphs: [
            '在「模式 A」下，把 `视差深度叠层数` 从「单层薄冰」切到「三层深渊寒冰」，晃动视角感受表层白霜、浅层冰泡、中层青裂纹与深渊蓝裂谷四重速度差织出的震撼空间感！接着故意把 `HeightRatio` 猛拉到 `0.30` 以上——看到冰裂纹在大斜角下撕裂成双影了吗？这就是为什么实战中 `0.04 ~ 0.12` 才是黄金甜点区！',
            '切换到「模式 B」：来回切换 `写实 PBR` 与 `UE 5.8 Toon BSDF`，拖动 `明暗色阶二分阈值` 与 `阴影边缘软硬度`（对照右侧实时跳动的粉色色阶曲线！），再点一下顶部「看踩坑现象」对比“脏黑灰阴影”与“通透冷紫暖粉动漫阴影”的天壤之别！',
          ],
          tryItPrompt:
            '在「模式 B」把「阴影边缘软硬度」拉到最左 `0.005` 体验硬派日漫刀切影，再拉到 `0.20` 体验柔美插画厚涂风！',
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5.8 视差与卡通',
          tag: 'ue5',
          title: '走进 UE 5.8：BumpOffset 分层技巧与全新原生 Toon BSDF',
          paragraphs: [
            '① 冰面可用 BumpOffset：ReferencePlane=0.5，HeightRatio=0.08，浅层 Height=0.3、深层 Height=0.1。输出分别接裂纹 Texture Sample 的 UVs，将采样色混合后接冰面 Slab。转动视角观察深层裂纹产生较大的偏移。',
            '② Toon 使用 UE 5.8 的实验性功能。在 Project Settings → Rendering 启用 Substrate，Substrate GBuffer Format (Project) 设为 Blendable GBuffer，按提示重启。内容浏览器新增资产时搜索 Toon Profile 并创建 TP_Cel。在 Diffuse Ramp 把 0.44 及以前设为冷紫系数、0.46 及以后设为白色，中间用线性过渡。需要分层高光时再改 Specular Ramp。',
            '新建 Surface / Opaque 材质，接 Substrate Toon BSDF → Front Material。选中 Toon 节点，在 Details 的 Toon Profile 资产栏选择 TP_Cel。BaseColor 给浅色，Roughness 设 0.4；使用 Profile 图案时可将 TexCoord 接 PatternUVs。将材质赋给球，旋转白色 Directional Light，并移动曲线过渡区，观察明暗分界移动。网页的阈值与软硬度用于模拟这条曲线。',
          ],
          tryItPrompt:
            '打开右上角「原理图」视图，欣赏 BumpOffset 冰裂采样与 UE 5.8 全新 Substrate Toon BSDF 的收官节点图！',
          callout: {
            tone: 'ue58',
            title: '什么时候用 BumpOffset，什么时候上 POM？',
            body: '冰下裂纹、宝石内絮、科幻双层仪表盘用极省电的 BumpOffset 最佳；若要做明显遮挡凸起的鹅卵石深沟，再调用进阶材质函数 ParallaxOcclusionMapping (POM)。',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '毕业防坑锦囊',
          tag: 'pitfall',
          title: '全课程通关总结：从光与三角形出发，你已打通材质任督二脉！',
          paragraphs: [
            '收好最后两句实战锦囊：**“平面造深景 BumpOffset 别贪大（`0.05~0.12` 防撕裂），二次元暗部忌死黑、混入冷紫暖粉才通透！”**',
            '🎉 **恭喜你圆满走完《UE 5.8 材质系统零基础交互工坊》全部 10 大模块！** 回头看，不管是深海吸收红光的水、开前向高光的玻璃、反用 `DepthFade` 的护盾、认得世界 `+Z` 轴的积雪，还是 `Substrate` 双层清漆与视差寒冰——世上从来没有死记硬背的神秘连线，有的只是**光的物理常识 + 空间几何直觉 + 显卡并行账本**。现在打开 UE 5.8，去创造属于你的惊艳世界吧！',
          ],
          tryItPrompt:
            '随时点击顶部导航栏前往「🩺 实战排错」、「🧪 材质实验室」或「📋 速查手册」，在自由沙盒里继续检验你的技术美术直觉！',
        },
      ],
      takeaways: [
        'BumpOffset 利用切线空间视线斜角偏移深层贴图 UV，无需增加任何几何顶点即可在纯平网格上骗出多层冰封景深',
        'BumpOffset 是轻量单步近似，HeightRatio 宜控制在 0.04~0.12 黄金区间，过大在大斜角下会产生重影断层',
        '二次元卡通着色核心是用阶跃阈值（Step / SmoothStep）剪断连续的 N·L 光照斜坡，实现干净利落的明暗二分',
        'UE 5.8 的实验性 Toon 配合 Blendable GBuffer。Toon Profile 资产定义 Diffuse Ramp、Specular Ramp，材质节点提供 BaseColor、Roughness 与可选 PatternUVs。',
      ],
      schematic: {
        title: '分层视差冰面与 Toon Profile 明暗曲线',
        caption: '两路分别建材质。Toon Profile 在 Toon 节点 Details 中指定，明暗与高光来自资产曲线。',
        nodes: [
          {
            id: 'bump',
            title: 'BumpOffset',
            subtitle: 'Height = 0.2，ReferencePlane = 0.5',
            category: 'math',
            x: 20, y: 20, width: 215,
            outputs: [{ id: 'uv', label: '偏移 UV', color: '#38bdf8' }],
          },
          {
            id: 'ice',
            title: '冰裂纹 Texture Sample',
            subtitle: '冰面材质；HeightRatio = 0.08',
            category: 'texture',
            x: 280, y: 20, width: 215,
            inputs: [{ id: 'uv', label: 'UVs', color: '#38bdf8' }],
            outputs: [{ id: 'c', label: 'RGB', color: '#22c55e' }],
          },
          {
            id: 'slab',
            title: 'Substrate Slab BSDF',
            subtitle: '冰面表层',
            category: 'substrate',
            x: 540, y: 20, width: 215,
            inputs: [{ id: 'c', label: 'Diffuse Albedo', color: '#22c55e' }],
            outputs: [{ id: 'm', label: 'BSDF', color: '#a855f7' }],
          },
          {
            id: 'iceRoot',
            title: '冰面材质',
            subtitle: 'Surface / Opaque',
            category: 'output',
            x: 800, y: 20, width: 215,
            inputs: [{ id: 'm', label: 'Front Material', color: '#a855f7' }],
          },
          {
            id: 'toonValues',
            title: '材质参数与 UV0',
            subtitle: '浅色底色；粗糙度 0.4',
            category: 'param',
            x: 20, y: 210, width: 215,
            outputs: [{ id: 'rgb', label: 'Vector Parameter', color: '#22c55e' }, { id: 's', label: 'Scalar Parameter', color: '#e5e7eb' }, { id: 'uv', label: 'TextureCoordinate', color: '#38bdf8' }],
          },
          {
            id: 'toon',
            title: 'Substrate Toon BSDF',
            subtitle: 'Details → Toon Profile = TP_Cel',
            category: 'substrate',
            x: 280, y: 210, width: 215,
            inputs: [{ id: 'rgb', label: 'BaseColor', color: '#22c55e' }, { id: 's', label: 'Roughness', color: '#e5e7eb' }, { id: 'uv', label: 'PatternUVs（图案可选）', color: '#38bdf8' }],
            outputs: [{ id: 'm', label: 'BSDF', color: '#a855f7' }],
          },
          {
            id: 'toonRoot',
            title: 'Toon 材质',
            subtitle: 'Surface / Opaque · Blendable GBuffer',
            category: 'output',
            x: 540, y: 210, width: 215,
            inputs: [{ id: 'm', label: 'Front Material', color: '#a855f7' }],
          },
          {
            id: 'profile',
            title: 'TP_Cel · Toon Profile 资产',
            subtitle: '编辑 Diffuse Ramp 与 Specular Ramp',
            category: 'param',
            x: 280, y: 435, width: 215,
          },
        ],
        edges: [
          { fromNode: 'bump', fromPin: 'uv', toNode: 'ice', toPin: 'uv', color: '#38bdf8' },
          { fromNode: 'ice', fromPin: 'c', toNode: 'slab', toPin: 'c', color: '#22c55e' },
          { fromNode: 'slab', fromPin: 'm', toNode: 'iceRoot', toPin: 'm', color: '#a855f7' },
          { fromNode: 'toonValues', fromPin: 'rgb', toNode: 'toon', toPin: 'rgb', color: '#22c55e' },
          { fromNode: 'toonValues', fromPin: 's', toNode: 'toon', toPin: 's', color: '#e5e7eb' },
          { fromNode: 'toonValues', fromPin: 'uv', toNode: 'toon', toPin: 'uv', color: '#38bdf8' },
          { fromNode: 'toon', fromPin: 'm', toNode: 'toonRoot', toPin: 'm', color: '#a855f7' },
        ],
      },
      StageComponent: IceParallaxToonStage,
    },
  ],
};
