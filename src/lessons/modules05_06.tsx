import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAutoFitCanvas } from '../lib/useAutoFitCanvas';
import { ModuleDefinition, LessonStageProps, LessonDefinition } from '../types/course';
import {
  clamp,
  saturate,
  lerp,
  lerp3,
  smoothstep,
  norm3,
  shadePbrPixel,
  srgbToLinear,
  hash2,
  Vec3,
} from '../lib/graphics';
import {
  StageSlider,
  StageSegmented,
  StageToggle,
  PitfallCompareBar,
  SplitCompareContainer,
} from '../components/ui/StageWidgets';

function frac(v: number): number {
  return v - Math.floor(v);
}

function rgbToCss(c: Vec3): string {
  return `rgb(${Math.round(saturate(c[0]) * 255)}, ${Math.round(saturate(c[1]) * 255)}, ${Math.round(
    saturate(c[2]) * 255
  )})`;
}

function rgbToHex(c: Vec3): string {
  const toHex = (v: number) =>
    Math.round(saturate(v) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${toHex(c[0])}${toHex(c[1])}${toHex(c[2])}`;
}

/* ============================================================================
 * LESSON 5.1 STAGE: 纹素查字典、UV 缩放反直觉尺子与 Wrap / Clamp 边缘寻址
 * ========================================================================== */

type Stage51Mode = 'tiling' | 'decal';
type DecalAddressMode = 'wrap' | 'clamp-bleed' | 'clamp-safe';

const Stage5_1_UvTilingWrapClamp: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [mode, setMode] = useState<Stage51Mode>('tiling');
  const [uTiling, setUTiling] = useState<number>(2.0);
  const [vTiling, setVTiling] = useState<number>(2.0);
  const [pannerSpeed, setPannerSpeed] = useState<number>(0.0);
  const [decalMode, setDecalMode] = useState<DecalAddressMode>('clamp-bleed');
  const [wallSpan, setWallSpan] = useState<number>(2.8);
  const [cursorNorm, setCursorNorm] = useState<[number, number]>([0.66, 0.38]);
  const [animTime, setAnimTime] = useState<number>(0);

  const texelCanvasRef = useRef<HTMLCanvasElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const onKpiRef = useRef(onKpiUpdate);
  onKpiRef.current = onKpiUpdate;

  // Reset handler
  useEffect(() => {
    if (resetSignal > 0) {
      setMode('tiling');
      setUTiling(2.0);
      setVTiling(2.0);
      setPannerSpeed(0.0);
      setDecalMode('clamp-bleed');
      setWallSpan(2.8);
      setCursorNorm([0.66, 0.38]);
      setAnimTime(0);
    }
  }, [resetSignal]);

  // Gentle step-aware presetting while keeping everything freely interactive
  useEffect(() => {
    if (stepIndex === 0 || stepIndex === 1) {
      setMode('tiling');
    } else if (stepIndex === 2) {
      setMode('decal');
      setDecalMode('wrap');
    } else if (stepIndex === 4) {
      setMode('decal');
      setDecalMode('clamp-bleed');
    }
  }, [stepIndex, resetSignal]);

  // Panner animation loop (only runs when pannerSpeed > 0 in tiling mode)
  useEffect(() => {
    if (mode !== 'tiling' || Math.abs(pannerSpeed) < 0.005) return;
    let rafId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setAnimTime((prev) => (prev + dt * pannerSpeed) % 100);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [mode, pannerSpeed]);

  // Precompute 16x16 Mediterranean Courtyard Tile texel dictionary
  const tileTexels = useMemo(() => {
    const N = 16;
    const grid: Vec3[] = new Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const isMortar = x === 0 || y === 0 || x === N - 1 || y === N - 1;
        const isFrame = x === 1 || y === 1 || x === N - 2 || y === N - 2;
        const cx = (x - 7.5) / 7.5;
        const cy = (y - 7.5) / 7.5;
        const diamond = Math.abs(cx) + Math.abs(cy);
        const star = Math.max(Math.abs(cx), Math.abs(cy));

        let col: Vec3 = [0.93, 0.89, 0.79]; // Warm limestone cream
        if (isMortar) {
          col = [0.34, 0.31, 0.28]; // Grout line
        } else if (isFrame) {
          col = [0.78, 0.42, 0.24]; // Terracotta border
        } else if (diamond < 0.56) {
          col = diamond < 0.26 ? [0.92, 0.68, 0.22] : [0.18, 0.42, 0.68]; // Gold heart + Cobalt diamond
        } else if (star > 0.68 && Math.abs(Math.abs(cx) - Math.abs(cy)) < 0.22) {
          col = [0.26, 0.56, 0.52]; // Corner sage accent
        }
        // Asymmetric top-left sun pip so user clearly perceives tile orientation & scale
        if (x >= 3 && x <= 4 && y >= 3 && y <= 4) {
          col = [0.91, 0.33, 0.25];
        }
        grid[y * N + x] = col;
      }
    }
    return grid;
  }, []);

  // Precompute 24x24 Scorched Plasma Bullet Decal (both bleed and safe-border versions)
  const decalTexels = useMemo(() => {
    const N = 24;
    const makeGrid = (withEdgeBleed: boolean): { rgb: Vec3; alpha: number }[] => {
      const arr: { rgb: Vec3; alpha: number }[] = new Array(N * N);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const isOuterRing = x === 0 || y === 0 || x === N - 1 || y === N - 1;
          const dx = (x - (N - 1) / 2) / (N / 2);
          const dy = (y - (N - 1) / 2) / (N / 2);
          const r = Math.hypot(dx, dy);

          let rgb: Vec3 = [0, 0, 0];
          let alpha = 0;

          if (r < 0.28) {
            // Glowing molten crater core
            rgb = lerp3([1.0, 0.92, 0.55], [0.96, 0.38, 0.12], r / 0.28);
            alpha = 1.0;
          } else if (r < 0.58) {
            // Dark charred crater rim
            const t = (r - 0.28) / 0.3;
            rgb = lerp3([0.55, 0.18, 0.08], [0.12, 0.11, 0.1], t);
            alpha = 0.94 * (1 - t * 0.25);
          } else if (r < 0.86) {
            // Radial scorch & soot falloff
            const angle = Math.atan2(dy, dx);
            const rays = Math.sin(angle * 7) * 0.5 + 0.5;
            const fade = saturate(1 - (r - 0.58) / 0.28) * (0.45 + 0.55 * rays);
            rgb = [0.16, 0.14, 0.13];
            alpha = fade * 0.72;
          }

          // Intentional stray artist brush splatters on outermost 1px edge when unpadded!
          if (withEdgeBleed && isOuterRing) {
            if ((x === 0 && y >= 9 && y <= 14) || (x === N - 1 && y >= 10 && y <= 13)) {
              rgb = [0.98, 0.44, 0.12]; // Stray orange ember brush leak on left/right border
              alpha = 0.92;
            } else if ((y === 0 && x >= 10 && x <= 14) || (y === N - 1 && x >= 9 && x <= 13)) {
              rgb = [0.22, 0.78, 0.96]; // Stray cyan spark brush leak on top/bottom border
              alpha = 0.9;
            }
          }

          if (!withEdgeBleed && isOuterRing) {
            rgb = [0.16, 0.14, 0.13]; // Extend soot RGB under zero coverage.
            alpha = 0;
          }

          arr[y * N + x] = { rgb, alpha };
        }
      }
      return arr;
    };
    return {
      bleed: makeGrid(true),
      safe: makeGrid(false),
    };
  }, []);

  // Compute live lookup math for KPIs & annotation
  const panU = mode === 'tiling' ? animTime : 0;
  const panV = mode === 'tiling' ? animTime * 0.65 : 0;
  const rawU =
    mode === 'tiling'
      ? cursorNorm[0] * uTiling + panU
      : (cursorNorm[0] - 0.5) * wallSpan + 0.5;
  const rawV =
    mode === 'tiling'
      ? cursorNorm[1] * vTiling + panV
      : (cursorNorm[1] - 0.5) * wallSpan + 0.5;

  const sampledU =
    mode === 'tiling' || decalMode === 'wrap' ? frac(rawU) : clamp(rawU, 0, 0.9999);
  const sampledV =
    mode === 'tiling' || decalMode === 'wrap' ? frac(rawV) : clamp(rawV, 0, 0.9999);

  const texN = mode === 'tiling' ? 16 : 24;
  const hitTx = clamp(Math.floor(sampledU * texN), 0, texN - 1);
  const hitTy = clamp(Math.floor(sampledV * texN), 0, texN - 1);
  const sampledU2 = Math.round(sampledU * 100) / 100;
  const sampledV2 = Math.round(sampledV * 100) / 100;

  // Update KPI strip (depend ONLY on primitive values)
  useEffect(() => {
    if (mode === 'tiling') {
      const totalTiles = uTiling * vTiling;
      onKpiRef.current([
        {
          label: 'UV 刻度范围',
          value: `0..${uTiling.toFixed(1)} × 0..${vTiling.toFixed(1)}`,
          sub: uTiling > 1 ? '刻度变密 → 花纹缩小' : uTiling < 1 ? '刻度未走完 → 花纹放大' : '标准 1:1 铺满',
          tone: 'accent',
        },
        {
          label: '地面铺砖块数',
          value: `${totalTiles.toFixed(1)} 块`,
          sub: `${uTiling.toFixed(1)} 列 × ${vTiling.toFixed(1)} 行`,
          tone: 'good',
        },
        {
          label: 'Panner 水流偏移',
          value: pannerSpeed > 0.01 ? `${pannerSpeed.toFixed(2)} 格/秒` : '静止 (0.00)',
          sub: 'UV + Time 实时平移',
          tone: pannerSpeed > 0.01 ? 'good' : 'neutral',
        },
        {
          label: '当前命中纹素',
          value: `Texel [${hitTx}, ${hitTy}]`,
          sub: `Wrap 小数 (${sampledU2.toFixed(2)}, ${sampledV2.toFixed(2)})`,
          tone: 'neutral',
        },
      ]);
    } else {
      const modeName =
        decalMode === 'wrap'
          ? 'Wrap 循环包裹'
          : decalMode === 'clamp-bleed'
          ? 'Clamp (边缘漏色!)'
          : 'Clamp + 1px 透明边';
      const tone = decalMode === 'clamp-safe' ? 'good' : decalMode === 'wrap' ? 'warn' : 'bad';
      onKpiRef.current([
        {
          label: '边缘寻址模式',
          value: modeName,
          sub: decalMode === 'wrap' ? '越界取小数无限重复' : '越界死锁在 0 或 1 边缘',
          tone,
        },
        {
          label: '墙面 UV 跨度',
          value: `${((1 - wallSpan) * 0.5).toFixed(1)} ~ ${((1 + wallSpan) * 0.5).toFixed(1)}`,
          sub: '超出 [0,1] 触发越界寻址',
          tone: 'accent',
        },
        {
          label: '贴图最外圈 1px',
          value: decalMode === 'clamp-bleed' ? '橙/青边缘仍有覆盖率' : 'Alpha = 0',
          sub: decalMode === 'wrap' ? '越界后重复整张贴花' : decalMode === 'clamp-bleed' ? '边缘颜色拉成条带' : '越界区域露出墙面',
          tone: decalMode === 'clamp-safe' ? 'good' : 'warn',
        },
      ]);
    }
  }, [mode, uTiling, vTiling, pannerSpeed, decalMode, wallSpan, hitTx, hitTy, sampledU2, sampledV2]);

  // Draw Left Texel Dictionary Canvas & Right Plaza / Wall Canvas
  useEffect(() => {
    const texCanvas = texelCanvasRef.current;
    const scnCanvas = sceneCanvasRef.current;
    if (!texCanvas || !scnCanvas) return;

    const tCtx = texCanvas.getContext('2d');
    const sCtx = scnCanvas.getContext('2d');
    if (!tCtx || !sCtx) return;

    // 1. Render Left Source Texel Grid (192x192)
    const TW = texCanvas.width;
    const TH = texCanvas.height;
    tCtx.clearRect(0, 0, TW, TH);

    const pad = 16;
    const gridPx = TW - pad * 2;
    const cell = gridPx / texN;

    tCtx.fillStyle = isDark ? '#181614' : '#ebe5d8';
    tCtx.fillRect(0, 0, TW, TH);

    for (let ty = 0; ty < texN; ty++) {
      for (let tx = 0; tx < texN; tx++) {
        let col: Vec3 = [0, 0, 0];
        if (mode === 'tiling') {
          col = tileTexels[ty * texN + tx];
        } else {
          const src = decalMode === 'clamp-bleed' ? decalTexels.bleed : decalTexels.safe;
          const item = src[ty * texN + tx];
          const checker = (tx + ty) % 2 === 0 ? 0.18 : 0.13;
          col = lerp3([checker, checker, checker], item.rgb, item.alpha);
        }
        tCtx.fillStyle = rgbToCss(col);
        tCtx.fillRect(pad + tx * cell, pad + ty * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }

    // Texel subtle grid lines
    tCtx.strokeStyle = 'rgba(0,0,0,0.22)';
    tCtx.lineWidth = 0.75;
    for (let i = 0; i <= texN; i++) {
      const pos = pad + i * cell;
      tCtx.beginPath();
      tCtx.moveTo(pos, pad);
      tCtx.lineTo(pos, pad + gridPx);
      tCtx.stroke();
      tCtx.beginPath();
      tCtx.moveTo(pad, pos);
      tCtx.lineTo(pad + gridPx, pos);
      tCtx.stroke();
    }

    // Highlight 1px border ring in Decal mode
    if (mode === 'decal') {
      tCtx.save();
      tCtx.strokeStyle =
        decalMode === 'clamp-bleed' ? '#ff3b30' : decalMode === 'clamp-safe' ? '#22c55e' : '#38bdf8';
      tCtx.lineWidth = 2.2;
      tCtx.strokeRect(pad + 1, pad + 1, gridPx - 2, gridPx - 2);
      tCtx.restore();
    }

    // Highlight looked-up texel [hitTx, hitTy]
    tCtx.save();
    tCtx.strokeStyle = '#ffffff';
    tCtx.lineWidth = 2.5;
    tCtx.strokeRect(pad + hitTx * cell - 1, pad + hitTy * cell - 1, cell + 2, cell + 2);
    tCtx.strokeStyle = '#ef4444';
    tCtx.lineWidth = 1.2;
    tCtx.strokeRect(pad + hitTx * cell - 2.5, pad + hitTy * cell - 2.5, cell + 5, cell + 5);
    tCtx.restore();

    // U / V axis tiny labels on source texture
    tCtx.fillStyle = isDark ? '#d8cfc2' : '#3a342e';
    tCtx.font = 'bold 10px JetBrains Mono, monospace';
    tCtx.fillText('0', 5, 12);
    tCtx.fillText('U→1', TW - 30, 12);
    tCtx.fillText('V↓1', 2, TH - 4);

    // 2. Render Right Scene Canvas (360x224) with Dynamic UV Ruler
    const SW = scnCanvas.width;
    const SH = scnCanvas.height;
    const rulerTop = 26;
    const rulerLeft = 32;
    const vpW = SW - rulerLeft - 8;
    const vpH = SH - rulerTop - 8;

    sCtx.fillStyle = isDark ? '#1d1a17' : '#f2ede2';
    sCtx.fillRect(0, 0, SW, SH);

    const imgData = sCtx.createImageData(vpW, vpH);
    const data = imgData.data;

    for (let py = 0; py < vpH; py++) {
      const ny = py / vpH;
      for (let px = 0; px < vpW; px++) {
        const nx = px / vpW;
        let outCol: Vec3 = [0, 0, 0];

        if (mode === 'tiling') {
          const u = nx * uTiling + panU;
          const v = ny * vTiling + panV;
          const fu = frac(u);
          const fv = frac(v);
          const tx = clamp(Math.floor(fu * 16), 0, 15);
          const ty = clamp(Math.floor(fv * 16), 0, 15);
          outCol = tileTexels[ty * 16 + tx];

          // Add flowing water ripple overlay when pannerSpeed > 0
          if (Math.abs(pannerSpeed) > 0.005) {
            const wave1 = Math.sin((u * 2.2 + v * 1.4) * Math.PI * 2);
            const wave2 = Math.cos((u * 1.5 - v * 2.6) * Math.PI * 2);
            const caustic = Math.pow(saturate((wave1 + wave2) * 0.35 + 0.5), 3.0);
            outCol = lerp3(outCol, [0.35, 0.78, 0.92], 0.22);
            outCol = [
              saturate(outCol[0] + caustic * 0.34),
              saturate(outCol[1] + caustic * 0.42),
              saturate(outCol[2] + caustic * 0.48),
            ];
          }
        } else {
          // Concrete brick wall background + Decal overlay
          const brickRow = Math.floor(ny * 7);
          const brickU = nx * 4.5 + (brickRow % 2 === 1 ? 0.5 : 0);
          const brickV = ny * 7;
          const mortar = frac(brickU) < 0.055 || frac(brickV) < 0.09;
          const grain = (hash2(Math.floor(nx * 90), Math.floor(ny * 60)) - 0.5) * 0.05;
          const wallBase: Vec3 = mortar
            ? [0.36 + grain, 0.34 + grain, 0.31 + grain]
            : [0.54 + grain, 0.51 + grain, 0.47 + grain];

          const u = (nx - 0.5) * wallSpan + 0.5;
          const v = (ny - 0.5) * wallSpan + 0.5;
          const su = decalMode === 'wrap' ? frac(u) : clamp(u, 0, 0.9999);
          const sv = decalMode === 'wrap' ? frac(v) : clamp(v, 0, 0.9999);
          const tx = clamp(Math.floor(su * 24), 0, 23);
          const ty = clamp(Math.floor(sv * 24), 0, 23);

          const src = decalMode === 'clamp-bleed' ? decalTexels.bleed : decalTexels.safe;
          const sample = src[ty * 24 + tx];
          outCol = lerp3(wallBase, sample.rgb, sample.alpha);
        }

        const idx = (py * vpW + px) * 4;
        data[idx] = Math.round(saturate(outCol[0]) * 255);
        data[idx + 1] = Math.round(saturate(outCol[1]) * 255);
        data[idx + 2] = Math.round(saturate(outCol[2]) * 255);
        data[idx + 3] = 255;
      }
    }
    sCtx.putImageData(imgData, rulerLeft, rulerTop);

    // Draw Dynamic UV Rulers & Integer Tile Seam Lines!
    sCtx.save();
    sCtx.strokeStyle = isDark ? '#574e44' : '#231f1c';
    sCtx.lineWidth = 1.5;
    sCtx.strokeRect(rulerLeft, rulerTop, vpW, vpH);

    sCtx.font = 'bold 10.5px JetBrains Mono, monospace';
    sCtx.fillStyle = isDark ? '#f2ece1' : '#1e1b18';

    if (mode === 'tiling') {
      // Horizontal U ruler ticks (every 0.5)
      const maxU = uTiling;
      for (let uVal = 0; uVal <= maxU + 0.001; uVal += 0.5) {
        const x = rulerLeft + (uVal / maxU) * vpW;
        const isInt = Math.abs(uVal - Math.round(uVal)) < 0.01;
        sCtx.beginPath();
        sCtx.strokeStyle = isInt ? '#e11d48' : isDark ? '#8c8275' : '#6e655a';
        sCtx.lineWidth = isInt ? 1.8 : 1;
        sCtx.moveTo(x, rulerTop - (isInt ? 8 : 4));
        sCtx.lineTo(x, rulerTop);
        sCtx.stroke();

        if (isInt || maxU <= 1.5) {
          sCtx.fillStyle = isInt && uVal > 0 ? '#e11d48' : isDark ? '#e6dfd3' : '#231f1c';
          sCtx.fillText(
            uVal.toFixed(uVal % 1 === 0 ? 0 : 1),
            clamp(x - 6, rulerLeft, SW - 22),
            14
          );
        }

        // Draw dashed seam line across floor at integer UV 1, 2, 3
        if (isInt && uVal > 0.01 && uVal < maxU - 0.01) {
          sCtx.save();
          sCtx.setLineDash([4, 4]);
          sCtx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
          sCtx.lineWidth = 1.4;
          sCtx.beginPath();
          sCtx.moveTo(x, rulerTop);
          sCtx.lineTo(x, rulerTop + vpH);
          sCtx.stroke();
          sCtx.restore();
        }
      }

      // Vertical V ruler ticks
      const maxV = vTiling;
      for (let vVal = 0; vVal <= maxV + 0.001; vVal += 0.5) {
        const y = rulerTop + (vVal / maxV) * vpH;
        const isInt = Math.abs(vVal - Math.round(vVal)) < 0.01;
        sCtx.beginPath();
        sCtx.strokeStyle = isInt ? '#e11d48' : isDark ? '#8c8275' : '#6e655a';
        sCtx.lineWidth = isInt ? 1.8 : 1;
        sCtx.moveTo(rulerLeft - (isInt ? 7 : 4), y);
        sCtx.lineTo(rulerLeft, y);
        sCtx.stroke();

        if (isInt || maxV <= 1.5) {
          sCtx.fillStyle = isInt && vVal > 0 ? '#e11d48' : isDark ? '#e6dfd3' : '#231f1c';
          sCtx.fillText(
            vVal.toFixed(vVal % 1 === 0 ? 0 : 1),
            5,
            clamp(y + 4, rulerTop + 8, SH - 4)
          );
        }

        if (isInt && vVal > 0.01 && vVal < maxV - 0.01) {
          sCtx.save();
          sCtx.setLineDash([4, 4]);
          sCtx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
          sCtx.lineWidth = 1.4;
          sCtx.beginPath();
          sCtx.moveTo(rulerLeft, y);
          sCtx.lineTo(rulerLeft + vpW, y);
          sCtx.stroke();
          sCtx.restore();
        }
      }
    } else {
      // Decal mode: highlight [0, 1] UV safe zone box on the concrete wall
      const minUV = (0 - 0.5) * wallSpan + 0.5;
      const maxUV = (1 - 0.5) * wallSpan + 0.5;
      const x0 = rulerLeft + ((0 - minUV) / wallSpan) * vpW;
      const y0 = rulerTop + ((0 - minUV) / wallSpan) * vpH;
      const x1 = rulerLeft + ((1 - minUV) / wallSpan) * vpW;
      const y1 = rulerTop + ((1 - minUV) / wallSpan) * vpH;

      sCtx.fillStyle = isDark ? '#e6dfd3' : '#231f1c';
      sCtx.fillText(`U:${minUV.toFixed(1)}`, rulerLeft, 15);
      sCtx.fillText('[0..1 贴花原图框]', rulerLeft + vpW * 0.33, 15);
      sCtx.fillText(`U:${maxUV.toFixed(1)}`, SW - 44, 15);

      sCtx.save();
      sCtx.setLineDash([5, 3]);
      sCtx.strokeStyle = '#facc15';
      sCtx.lineWidth = 1.6;
      sCtx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      sCtx.restore();
    }

    // Draw interactive pixel cursor crosshair on right scene canvas
    const cx = rulerLeft + cursorNorm[0] * vpW;
    const cy = rulerTop + cursorNorm[1] * vpH;
    sCtx.beginPath();
    sCtx.arc(cx, cy, 6.5, 0, Math.PI * 2);
    sCtx.fillStyle = 'rgba(239, 68, 68, 0.28)';
    sCtx.fill();
    sCtx.lineWidth = 2;
    sCtx.strokeStyle = '#ffffff';
    sCtx.stroke();
    sCtx.beginPath();
    sCtx.arc(cx, cy, 2.2, 0, Math.PI * 2);
    sCtx.fillStyle = '#ef4444';
    sCtx.fill();

    sCtx.restore();
  }, [
    mode,
    uTiling,
    vTiling,
    pannerSpeed,
    decalMode,
    wallSpan,
    cursorNorm,
    panU,
    panV,
    texN,
    hitTx,
    hitTy,
    tileTexels,
    decalTexels,
    isDark,
  ]);

  const handleScenePointer = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = e.currentTarget.width / rect.width;
    const scaleY = e.currentTarget.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const rulerLeft = 32;
    const rulerTop = 26;
    const vpW = e.currentTarget.width - rulerLeft - 8;
    const vpH = e.currentTarget.height - rulerTop - 8;
    const nx = clamp((x - rulerLeft) / vpW, 0.01, 0.99);
    const ny = clamp((y - rulerTop) / vpH, 0.01, 0.99);
    setCursorNorm([nx, ny]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Mode Switcher */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <StageSegmented<Stage51Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'tiling', label: '🟦 模式 A：地砖平铺与水流尺子 (Tiling & Panner)' },
            { value: 'decal', label: '🎯 模式 B：墙面弹孔贴花越界 (Wrap vs Clamp)' },
          ]}
        />
      </div>

      {/* Dual Visual Stage: Left Source Texels + Right Scene Preview */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(175px, 204px) minmax(0, 1fr)',
          gap: 10,
          alignItems: 'stretch',
        }}
      >
        {/* Left: Texel Dictionary */}
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1.5px solid var(--border-soft)',
            borderRadius: 11,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
            📖 贴图纹素字典 ({texN}×{texN})
          </div>
          <canvas
            ref={texelCanvasRef}
            width={192}
            height={192}
            style={{
              width: '100%',
              maxWidth: 186,
              aspectRatio: '1 / 1',
              borderRadius: 8,
              border: '1.5px solid var(--border-strong)',
            }}
          />
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              textAlign: 'center',
              lineHeight: 1.35,
            }}
          >
            {mode === 'tiling'
              ? '红白双框 = 当前屏幕像素查到的纹素小格'
              : decalMode === 'clamp-bleed'
              ? '⚠️ 红框警告：最外圈 1px 蹭到了火星颜色！'
              : decalMode === 'clamp-safe'
              ? '✅ 绿框保护：最外圈留出 1px 透明边'
              : '🔁 越界后回到另一头循环查表'}
          </div>
        </div>

        {/* Right: UV Ruler & Plaza / Wall */}
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1.5px solid var(--border-soft)',
            borderRadius: 11,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 11.5,
              fontWeight: 700,
              color: 'var(--text-secondary)',
            }}
          >
            <span>
              {mode === 'tiling'
                ? '🏛️ 广场地面 + 动态 0..N 伸缩 UV 尺子（移动鼠标任意点选查表）'
                : '🧱 水泥砖墙贴花越界实况（黄虚线内为 [0..1] 原图范围）'}
            </span>
          </div>
          <canvas
            ref={sceneCanvasRef}
            width={392}
            height={224}
            onMouseMove={(e) => {
              if (e.buttons === 1 || e.movementX !== 0) handleScenePointer(e);
            }}
            onClick={handleScenePointer}
            style={{
              width: '100%',
              maxWidth: 560,
              height: 'auto',
              margin: '0 auto',
              borderRadius: 8,
              cursor: 'crosshair',
              display: 'block',
            }}
          />
        </div>
      </div>

      {/* Live Lookup Formula Ticker */}
      <div
        style={{
          padding: '6px 11px',
          borderRadius: 9,
          background: 'var(--bg-code)',
          border: '1px solid var(--border-soft)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11.5,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>
          📍 屏幕像素坐标 ({cursorNorm[0].toFixed(2)}, {cursorNorm[1].toFixed(2)}) → 算得 UV (
          <strong>{rawU.toFixed(2)}</strong>, <strong>{rawV.toFixed(2)}</strong>)
        </span>
        <span>
          👉 {mode === 'tiling' || decalMode === 'wrap' ? 'Wrap 取小数' : 'Clamp 锁死 [0..1]'} (
          {sampledU.toFixed(2)}, {sampledV.toFixed(2)}) → 命中纹素{' '}
          <strong>
            [{hitTx}, {hitTy}]
          </strong>
        </span>
      </div>

      {/* Controls Panel */}
      {mode === 'tiling' ? (
        <div className="stage-controls-panel">
          <div className="control-grid">
            <StageSlider
              label="横向平铺倍数 (U Tiling)"
              value={uTiling}
              min={0.5}
              max={4.0}
              step={0.5}
              unit="×"
              onChange={setUTiling}
            />
            <StageSlider
              label="纵向平铺倍数 (V Tiling)"
              value={vTiling}
              min={0.5}
              max={4.0}
              step={0.5}
              unit="×"
              onChange={setVTiling}
            />
            <StageSlider
              label="Panner 水流平移速度"
              value={pannerSpeed}
              min={0}
              max={1.2}
              step={0.05}
              formatValue={(v) => (v < 0.01 ? '0.00 (静止)' : `${v.toFixed(2)} 格/秒`)}
              onChange={setPannerSpeed}
            />
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PitfallCompareBar
            isPitfall={decalMode !== 'clamp-safe'}
            pitfallLabel={
              decalMode === 'wrap'
                ? 'Wrap 包裹：独立弹孔满墙重复穿帮'
                : 'Clamp 边缘 Alpha 非零：最外圈火星被拉成贯穿全墙的十字彩带！'
            }
            correctLabel="Clamp + 最外圈留 1px 透明安全边：干净利落的单个弹孔贴花"
            onToggle={(pitfall) => setDecalMode(pitfall ? 'clamp-bleed' : 'clamp-safe')}
          />
          <div className="stage-controls-panel">
            <div className="control-grid">
              <StageSegmented<DecalAddressMode>
                label="切换三种边缘寻址状态对比"
                value={decalMode}
                onChange={setDecalMode}
                options={[
                  { value: 'wrap', label: '🔁 Wrap 满墙重复' },
                  { value: 'clamp-bleed', label: '⚠️ Clamp 边缘 Alpha 非零' },
                  { value: 'clamp-safe', label: '✅ Clamp + 1px 透明边' },
                ]}
              />
              <StageSlider
                label="墙面超出贴花范围倍数"
                value={wallSpan}
                min={1.4}
                max={3.8}
                step={0.1}
                unit="×"
                onChange={setWallSpan}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * LESSON 5.2 STAGE: 3D 透视跑道俯仰角 + 最近点 / 双线性 / 各向异性 8x 拉帘对比
 * ========================================================================== */

type FilterMode = 'nearest' | 'bilinear' | 'aniso8' | 'aniso16';

interface MipChain {
  size: number;
  levels: Float32Array[]; // Each level is w*w*3 RGB in [0..1]
}

function buildMipChain(baseSize: number, generator: (x: number, y: number, n: number) => Vec3): MipChain {
  const levels: Float32Array[] = [];
  const lvl0 = new Float32Array(baseSize * baseSize * 3);
  for (let y = 0; y < baseSize; y++) {
    for (let x = 0; x < baseSize; x++) {
      const c = generator(x, y, baseSize);
      const idx = (y * baseSize + x) * 3;
      lvl0[idx] = c[0];
      lvl0[idx + 1] = c[1];
      lvl0[idx + 2] = c[2];
    }
  }
  levels.push(lvl0);

  let prevSize = baseSize;
  let prev = lvl0;
  while (prevSize > 1) {
    const nextSize = prevSize >> 1;
    const next = new Float32Array(nextSize * nextSize * 3);
    for (let y = 0; y < nextSize; y++) {
      for (let x = 0; x < nextSize; x++) {
        const i00 = (y * 2 * prevSize + x * 2) * 3;
        const i10 = (y * 2 * prevSize + (x * 2 + 1)) * 3;
        const i01 = ((y * 2 + 1) * prevSize + x * 2) * 3;
        const i11 = ((y * 2 + 1) * prevSize + (x * 2 + 1)) * 3;
        const dst = (y * nextSize + x) * 3;
        next[dst] = 0.25 * (prev[i00] + prev[i10] + prev[i01] + prev[i11]);
        next[dst + 1] = 0.25 * (prev[i00 + 1] + prev[i10 + 1] + prev[i01 + 1] + prev[i11 + 1]);
        next[dst + 2] = 0.25 * (prev[i00 + 2] + prev[i10 + 2] + prev[i01 + 2] + prev[i11 + 2]);
      }
    }
    levels.push(next);
    prev = next;
    prevSize = nextSize;
  }
  return { size: baseSize, levels };
}

function sampleMipNearest(chain: MipChain, mipIdx: number, u: number, v: number): Vec3 {
  const lvl = clamp(mipIdx, 0, chain.levels.length - 1);
  const w = chain.size >> lvl;
  const arr = chain.levels[lvl];
  const tx = Math.floor(frac(u) * w) % w;
  const ty = Math.floor(frac(v) * w) % w;
  const idx = (ty * w + tx) * 3;
  return [arr[idx], arr[idx + 1], arr[idx + 2]];
}

function sampleMipBilinear(chain: MipChain, mipIdx: number, u: number, v: number): Vec3 {
  const lvl = clamp(mipIdx, 0, chain.levels.length - 1);
  const w = chain.size >> lvl;
  const arr = chain.levels[lvl];
  const fx = frac(u) * w - 0.5;
  const fy = frac(v) * w - 0.5;
  const x0 = ((Math.floor(fx) % w) + w) % w;
  const y0 = ((Math.floor(fy) % w) + w) % w;
  const x1 = (x0 + 1) % w;
  const y1 = (y0 + 1) % w;
  const tx = fx - Math.floor(fx);
  const ty = fy - Math.floor(fy);

  const i00 = (y0 * w + x0) * 3;
  const i10 = (y0 * w + x1) * 3;
  const i01 = (y1 * w + x0) * 3;
  const i11 = (y1 * w + x1) * 3;

  const r = lerp(lerp(arr[i00], arr[i10], tx), lerp(arr[i01], arr[i11], tx), ty);
  const g = lerp(lerp(arr[i00 + 1], arr[i10 + 1], tx), lerp(arr[i01 + 1], arr[i11 + 1], tx), ty);
  const b = lerp(lerp(arr[i00 + 2], arr[i10 + 2], tx), lerp(arr[i01 + 2], arr[i11 + 2], tx), ty);
  return [r, g, b];
}

function sampleMipTrilinear(chain: MipChain, lod: number, u: number, v: number): Vec3 {
  const clamped = clamp(lod, 0, chain.levels.length - 1);
  const l0 = Math.floor(clamped);
  const l1 = Math.min(chain.levels.length - 1, l0 + 1);
  const f = clamped - l0;
  if (f < 0.001 || l0 === l1) return sampleMipBilinear(chain, l0, u, v);
  return lerp3(sampleMipBilinear(chain, l0, u, v), sampleMipBilinear(chain, l1, u, v), f);
}

const Stage5_2_FilteringAniso: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [pitchDeg, setPitchDeg] = useState<number>(80);
  const [leftFilter, setLeftFilter] = useState<FilterMode>('bilinear');
  const [rightFilter, setRightFilter] = useState<FilterMode>('aniso8');

  const leftCanvasRef = useRef<HTMLCanvasElement>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement>(null);
  const leftFit = useAutoFitCanvas(leftCanvasRef);
  const rightFit = useAutoFitCanvas(rightCanvasRef);
  const onKpiRef = useRef(onKpiUpdate);
  onKpiRef.current = onKpiUpdate;

  useEffect(() => {
    if (resetSignal > 0) {
      setPitchDeg(80);
      setLeftFilter('bilinear');
      setRightFilter('aniso8');
    }
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 0) {
      setPitchDeg(14);
      setLeftFilter('nearest');
      setRightFilter('bilinear');
    } else if (stepIndex >= 2) {
      setPitchDeg(81);
      setLeftFilter('bilinear');
      setRightFilter('aniso8');
    }
  }, [stepIndex, resetSignal]);

  // Build 64x64 Runway + Crosswalk + Yellow Center Line + Red-White Brick Curb MipChain
  const roadMips = useMemo(() => {
    return buildMipChain(64, (x, y, n) => {
      const u = x / n;
      const v = y / n;
      const grit = (hash2(x * 1.7, y * 2.3) - 0.5) * 0.04;

      // Red & cream curb stones on both road shoulders
      if (u < 0.11 || u > 0.89) {
        const redBlock = Math.floor(v * 4) % 2 === 0;
        return redBlock ? [0.84, 0.22, 0.18] : [0.93, 0.91, 0.85];
      }
      // Crisp white outer sideline
      if ((u >= 0.12 && u <= 0.155) || (u >= 0.845 && u <= 0.88)) {
        return [0.95, 0.95, 0.93];
      }
      // Double amber-yellow dashed center line
      if (Math.abs(u - 0.5) < 0.032 && v < 0.62) {
        return [0.98, 0.76, 0.14];
      }
      // Bright white zebra crosswalk stripes across upper half of tile
      if (v >= 0.68 && v <= 0.93) {
        const stripe = Math.floor(u * 12) % 2 === 0;
        if (stripe && u > 0.18 && u < 0.82) {
          return [0.94, 0.95, 0.96];
        }
      }
      // Subtle brick paver pattern in asphalt
      const paverBorder = x % 8 === 0 || y % 8 === 0 ? -0.045 : 0;
      return [0.21 + grit + paverBorder, 0.22 + grit + paverBorder, 0.25 + grit + paverBorder];
    });
  }, []);

  // Compute stretch ratio for current camera pitch
  const stretchRatio = useMemo(() => {
    
    const rad = (clamp(pitchDeg, 0, 85.5) * Math.PI) / 180;
    return clamp(1 / Math.max(0.06, Math.cos(rad)), 1, 16);
  }, [pitchDeg]);

  const filterLabel = (f: FilterMode) =>
    f === 'nearest'
      ? 'Nearest (最近点硬块)'
      : f === 'bilinear'
      ? 'Bilinear (双线性模糊)'
      : f === 'aniso8'
      ? 'Anisotropic 8x (各向异性)'
      : 'Anisotropic 16x (极致锐利)';

  useEffect(() => {
    const sampleCount =
      rightFilter === 'aniso16' ? '最长轴最多取 16 个样点' : rightFilter === 'aniso8' ? '最长轴最多取 8 个样点' : '1 次各向同性采样';
    onKpiRef.current([
      {
        label: '镜头俯仰角',
        value: `${pitchDeg.toFixed(0)}°`,
        sub: pitchDeg < 30 ? '近景怼脸放大模式' : '低头大斜角远眺马路',
        tone: 'accent',
      },
      {
        label: '倾角对应的近似各向异性',
        value: `${stretchRatio.toFixed(1)} : 1`,
        sub: '中心倾角估计；绘图按各像素 UV 差分取样',
        tone: stretchRatio > 4 ? 'warn' : 'neutral',
      },
      {
        label: '右侧采样策略',
        value: rightFilter.toUpperCase(),
        sub: sampleCount,
        tone: rightFilter.startsWith('aniso') || (pitchDeg < 30 && rightFilter === 'bilinear') ? 'good' : 'warn',
      },
    ]);
  }, [pitchDeg, leftFilter, rightFilter, stretchRatio]);

  // Render helper for a 3D perspective runway canvas with exact GPU filter simulation
  useEffect(() => {
    const renderRoad = (canvas: HTMLCanvasElement | null, mode: FilterMode) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      const img = ctx.createImageData(W, H);
      const data = img.data;

      // Camera orientation: pitchDeg = 5° (looking nearly straight down close to ground) -> 84° (looking toward horizon)
      const pitchRad = (pitchDeg * Math.PI) / 180;
      const sinP = Math.sin(pitchRad);
      const cosP = Math.cos(pitchRad);
      // Forward vector F = (0, -cosP, sinP), Up vector U = (0, sinP, cosP)
      const camY = lerp(0.14, 1.05, smoothstep(5, 55, pitchDeg));
      const fovScale = 0.85;
      const aspect = W / H;

      const evalRayUV = (sx: number, sy: number): [number, number, number] | null => {
        const ndcX = ((sx / W) * 2 - 1) * aspect * fovScale;
        const ndcY = (1 - (sy / H) * 2) * fovScale;
        // dir = F + ndcX * Right + ndcY * Up
        const dx = ndcX;
        const dy = -cosP + ndcY * sinP;
        const dz = sinP + ndcY * cosP;
        if (dy >= -0.003) return null;
        const t = camY / -dy;
        const wx = dx * t;
        const wz = dz * t;
        // Road spans wx in [-1.2, +1.2], repeats along wz
        const u = wx * 0.42 + 0.5;
        const v = wz * 0.42 + 0.15;
        return [u, v, t];
      };

      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const hit = evalRayUV(px + 0.5, py + 0.5);
          let col: Vec3;

          if (!hit) {
            // Sky gradient
            const skyT = saturate(py / (H * 0.55));
            col = isDark
              ? lerp3([0.09, 0.13, 0.22], [0.24, 0.28, 0.36], skyT)
              : lerp3([0.38, 0.62, 0.91], [0.84, 0.89, 0.95], skyT);
          } else {
            const [u, v, dist] = hit;
            // Grass / gravel verge outside the road [0..1]
            if (u < 0 || u > 1) {
              const turf = (Math.floor(u * 6) + Math.floor(v * 6)) % 2 === 0 ? 0.03 : -0.02;
              const grassBase: Vec3 = isDark ? [0.16 + turf, 0.23 + turf, 0.14] : [0.33 + turf, 0.46 + turf, 0.25];
              const fog = saturate(dist / 42);
              col = lerp3(grassBase, isDark ? [0.22, 0.25, 0.31] : [0.82, 0.87, 0.93], fog * 0.85);
            } else {
              const hitX = evalRayUV(px + 1.5, py + 0.5);
              const hitY = evalRayUV(px + 0.5, py + 1.5);
              const N = roadMips.size;

              const dux = hitX ? (hitX[0] - u) * N : 0.5;
              const dvx = hitX ? (hitX[1] - v) * N : 0;
              const duy = hitY ? (hitY[0] - u) * N : 0;
              const dvy = hitY ? (hitY[1] - v) * N : 0.5;

              const lenX = Math.hypot(dux, dvx);
              const lenY = Math.hypot(duy, dvy);
              const maxLen = Math.max(lenX, lenY);
              const minLen = Math.max(0.0001, Math.min(lenX, lenY));

              if (mode === 'nearest') {
                col = sampleMipNearest(roadMips, 0, u, v);
              } else if (mode === 'bilinear') {
                const isoLod = Math.log2(Math.max(1, maxLen));
                col = sampleMipBilinear(roadMips, Math.round(isoLod), u, v);
              } else {
                const maxAniso = mode === 'aniso16' ? 16 : 8;
                const ratio = Math.min(maxAniso, Math.ceil(maxLen / minLen));
                const samples = Math.max(1, ratio);
                const anisoLod = Math.log2(Math.max(1, maxLen / samples));

                // Walk along major derivative axis
                const majorU = (lenY >= lenX ? duy : dux) / N;
                const majorV = (lenY >= lenX ? dvy : dvx) / N;

                let accR = 0;
                let accG = 0;
                let accB = 0;
                for (let s = 0; s < samples; s++) {
                  const offset = samples === 1 ? 0 : (s / (samples - 1) - 0.5);
                  const sc = sampleMipTrilinear(
                    roadMips,
                    anisoLod,
                    u + majorU * offset,
                    v + majorV * offset
                  );
                  accR += sc[0];
                  accG += sc[1];
                  accB += sc[2];
                }
                col = [accR / samples, accG / samples, accB / samples];
              }

              // Subtle atmospheric horizon perspective haze so distant road feels 3D
              const fog = saturate((dist - 12) / 48) * 0.42;
              col = lerp3(col, isDark ? [0.22, 0.25, 0.32] : [0.83, 0.88, 0.94], fog);
            }
          }

          const idx = (py * W + px) * 4;
          data[idx] = Math.round(saturate(col[0]) * 255);
          data[idx + 1] = Math.round(saturate(col[1]) * 255);
          data[idx + 2] = Math.round(saturate(col[2]) * 255);
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };

    renderRoad(leftCanvasRef.current, leftFilter);
    renderRoad(rightCanvasRef.current, rightFilter);
  }, [pitchDeg, leftFilter, rightFilter, roadMips, isDark, leftFit, rightFit]);

  // Footprint diagram dimensions for SVG inspector
  const fpHeightCells = pitchDeg < 28 ? 0.35 : clamp(stretchRatio * 0.65, 1, 9.2);
  const fpWidthCells = pitchDeg < 28 ? 0.35 : 1.0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Quick Scene Presets */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className={`brutal-btn ${pitchDeg < 30 ? 'primary' : ''}`}
          style={{ padding: '5px 11px', fontSize: 12 }}
          onClick={() => {
            setPitchDeg(12);
            setLeftFilter('nearest');
            setRightFilter('bilinear');
          }}
        >
          🔍 预设 ①：近景怼脸放大（Nearest 马赛克 vs Bilinear 平滑）
        </button>
        <button
          type="button"
          className={`brutal-btn ${pitchDeg >= 30 ? 'primary' : ''}`}
          style={{ padding: '5px 11px', fontSize: 12 }}
          onClick={() => {
            setPitchDeg(81);
            setLeftFilter('bilinear');
            setRightFilter('aniso8');
          }}
        >
          🛣️ 预设 ②：81° 低头远眺公路（Bilinear 发糊 vs Anisotropic 8x 锐利）
        </button>
      </div>

      {/* Main Split Comparison + Right Pixel Footprint Microscope */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 182px',
          gap: 10,
          alignItems: 'stretch',
        }}
      >
        <SplitCompareContainer
          leftLabel={`左：${filterLabel(leftFilter)}`}
          rightLabel={`右：${filterLabel(rightFilter)}`}
          height={234}
          initialSplit={50}
          leftContent={
            <canvas
              ref={leftCanvasRef}
              width={360}
              height={220}
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
          }
          rightContent={
            <canvas
              ref={rightCanvasRef}
              width={360}
              height={220}
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
          }
        />

        {/* Pixel Footprint Visual Overlay Card */}
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1.5px solid var(--border-soft)',
            borderRadius: 11,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 4,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, textAlign: 'center' }}>
            👣 1 个像素踩在贴图上的脚印
          </div>
          <svg width="154" height="148" viewBox="0 0 154 148">
            <rect
              x="7"
              y="4"
              width="140"
              height="140"
              rx="6"
              fill={isDark ? '#1a1816' : '#f4efe4'}
              stroke={isDark ? '#574e44' : '#231f1c'}
              strokeWidth="1.4"
            />
            {/* 10x10 Texel Grid */}
            {Array.from({ length: 11 }).map((_, i) => (
              <React.Fragment key={i}>
                <line
                  x1={7 + i * 14}
                  y1={4}
                  x2={7 + i * 14}
                  y2={144}
                  stroke={isDark ? '#36302b' : '#d9d1c3'}
                  strokeWidth="0.9"
                />
                <line
                  x1={7}
                  y1={4 + i * 14}
                  x2={147}
                  y2={4 + i * 14}
                  stroke={isDark ? '#36302b' : '#d9d1c3'}
                  strokeWidth="0.9"
                />
              </React.Fragment>
            ))}

            {/* If grazing & bilinear on left: show giant isotropic blur box */}
            {pitchDeg >= 45 && (
              <rect
                x={77 - (fpHeightCells * 14) / 2}
                y={74 - (fpHeightCells * 14) / 2}
                width={fpHeightCells * 14}
                height={fpHeightCells * 14}
                fill="rgba(239, 68, 68, 0.13)"
                stroke="#ef4444"
                strokeDasharray="3 2"
                strokeWidth="1.3"
              />
            )}

            {/* Actual projected pixel footprint */}
            <rect
              x={77 - (fpWidthCells * 14) / 2}
              y={74 - (fpHeightCells * 14) / 2}
              width={fpWidthCells * 14}
              height={fpHeightCells * 14}
              rx="4"
              fill="rgba(34, 197, 94, 0.28)"
              stroke="#16a34a"
              strokeWidth="2"
            />

            {/* Sample dots */}
            {rightFilter.startsWith('aniso') && pitchDeg >= 35 ? (
              Array.from({ length: 8 }).map((_, idx) => {
                const t = idx / 7 - 0.5;
                return (
                  <circle
                    key={idx}
                    cx={77}
                    cy={74 + t * (fpHeightCells * 14 - 8)}
                    r={2.7}
                    fill="#16a34a"
                    stroke="#fff"
                    strokeWidth="0.9"
                  />
                );
              })
            ) : (
              <circle cx={77} cy={74} r={3.5} fill="#f97316" stroke="#fff" strokeWidth="1" />
            )}
          </svg>
          <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.35 }}>
            {pitchDeg < 30
              ? '怼脸时脚印极小：Bilinear 混合相邻 4 格消除锯齿'
              : '红虚框=普通滤波乱糊一锅粥；绿点=各向异性沿纵深精准采样！'}
          </div>
        </div>
      </div>

      {/* Pitfall quick bar + Sliders */}
      <PitfallCompareBar
        isPitfall={!rightFilter.startsWith('aniso') && pitchDeg >= 50}
        pitfallLabel="普通双线性滤波斜看马路：十米外斑马线全糊成灰雾"
        correctLabel="开启 Anisotropic 8x 各向异性：顺着纵深多点采样，地平线标线依旧锐利"
        onToggle={(pitfall) => {
          setPitchDeg(81);
          setLeftFilter('bilinear');
          setRightFilter(pitfall ? 'bilinear' : 'aniso8');
        }}
      />

      <div className="stage-controls-panel">
        <StageSlider
          label="🎥 镜头俯仰角（5° 怼脸俯视 ↔ 84° 贴地远眺天际线）"
          value={pitchDeg}
          min={5}
          max={84}
          step={1}
          unit="°"
          onChange={setPitchDeg}
        />
        <div className="control-grid">
          <StageSegmented<FilterMode>
            label="拉帘左侧滤波模式"
            value={leftFilter}
            onChange={setLeftFilter}
            options={[
              { value: 'nearest', label: 'Nearest 最近点' },
              { value: 'bilinear', label: 'Bilinear 双线性' },
            ]}
          />
          <StageSegmented<FilterMode>
            label="拉帘右侧滤波模式"
            value={rightFilter}
            onChange={setRightFilter}
            options={[
              { value: 'bilinear', label: 'Bilinear' },
              { value: 'aniso8', label: 'Aniso 8x' },
              { value: 'aniso16', label: 'Aniso 16x' },
            ]}
          />
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * LESSON 5.3 STAGE: 远景细砖广场闪烁 (Moiré) + Mipmap 彩虹染色镜 + 33.3% 面积拼图
 * ========================================================================== */

const MIP_RAINBOW_COLORS: Vec3[] = [
  [0.95, 0.24, 0.24], // Mip 0: Vivid Red
  [0.98, 0.56, 0.14], // Mip 1: Warm Orange
  [0.16, 0.78, 0.36], // Mip 2: Emerald Green
  [0.12, 0.65, 0.94], // Mip 3: Sky Cyan-Blue
  [0.56, 0.34, 0.95], // Mip 4+: Royal Purple
];

const Stage5_3_MipmapMoire: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [mipmapOn, setMipmapOn] = useState<boolean>(false);
  const [rainbowOn, setRainbowOn] = useState<boolean>(false);
  const [drifting, setDrifting] = useState<boolean>(true);
  const [driftSpeed, setDriftSpeed] = useState<number>(0.42);
  const [tileDensity, setTileDensity] = useState<number>(2.1);
  const [mipBias, setMipBias] = useState<number>(0.0);
  const [camPhase, setCamPhase] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasFit = useAutoFitCanvas(canvasRef);
  const onKpiRef = useRef(onKpiUpdate);
  onKpiRef.current = onKpiUpdate;

  useEffect(() => {
    if (resetSignal > 0) {
      setMipmapOn(false);
      setRainbowOn(false);
      setDrifting(true);
      setDriftSpeed(0.42);
      setTileDensity(2.1);
      setMipBias(0.0);
    }
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 0) {
      setMipmapOn(false);
      setRainbowOn(false);
    } else if (stepIndex === 1) {
      setMipmapOn(true);
      setRainbowOn(false);
    } else if (stepIndex === 2) {
      setMipmapOn(true);
      setRainbowOn(true);
    } else if (stepIndex === 4) {
      setRainbowOn(false);
    }
  }, [stepIndex, resetSignal]);

  // Smooth slow camera drift loop
  useEffect(() => {
    if (!drifting || driftSpeed < 0.01) return;
    let rafId = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setCamPhase((p) => (p + dt * driftSpeed) % 1000);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drifting, driftSpeed]);

  // High-frequency 128x128 Fine Herringbone / Checker Plaza Brick MipChain
  const plazaMips = useMemo(() => {
    return buildMipChain(128, (x, y, n) => {
      // 8x8 fine contrasting limestone vs dark slate sub-tiles per UV unit + mortar joints
      const cellX = Math.floor((x / n) * 8);
      const cellY = Math.floor((y / n) * 8);
      const localX = ((x / n) * 8) % 1;
      const localY = ((y / n) * 8) % 1;
      const isMortar = localX < 0.12 || localY < 0.12;
      if (isMortar) return [0.88, 0.85, 0.79];
      const checker = (cellX + cellY) % 2 === 0;
      return checker ? [0.76, 0.33, 0.22] : [0.22, 0.25, 0.3];
    });
  }, []);

  useEffect(() => {
    onKpiRef.current([
      {
        label: 'Mipmap 套娃状态',
        value: mipmapOn ? '✅ 已启用 (Mip 0~7)' : '❌ 已关闭 (强读 Mip 0)',
        sub: mipmapOn ? '三线性平滑过渡缩略图' : '远景 1 像素盲摸数千纹素狂闪',
        tone: mipmapOn ? 'good' : 'bad',
      },
      {
        label: '2K BC1 理论纹素数据',
        value: mipmapOn ? '2.67 MiB (+33.3%)' : '2.00 MiB (无缩略图)',
        sub: mipmapOn ? '相对基级约增加 1/3，减轻远景走样' : '比完整链约省 25%，远景易闪烁',
        tone: mipmapOn ? 'accent' : 'warn',
      },
      {
        label: '实验源纹理',
        value: '128 × 128',
        sub: '开关仅改变可采样的 mip 层级',
        tone: 'neutral',
      },
    ]);
  }, [mipmapOn, rainbowOn, mipBias]);

  // Render perspective drifting plaza
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const img = ctx.createImageData(W, H);
    const data = img.data;

    // 画布被自动加宽时按宽高比扩大水平视野，避免地砖横向拉伸
    const aspectK = (W / H) / (360 / 222);
    const horizonY = Math.floor(H * 0.22);
    const swayX = Math.sin(camPhase * 1.4) * 0.14;
    const walkZ = camPhase * 0.55;

    for (let py = 0; py < H; py++) {
      if (py <= horizonY) {
        const st = py / Math.max(1, horizonY);
        const sky = isDark
          ? lerp3([0.08, 0.11, 0.18], [0.21, 0.24, 0.31], st)
          : lerp3([0.45, 0.67, 0.92], [0.87, 0.9, 0.95], st);
        for (let px = 0; px < W; px++) {
          const idx = (py * W + px) * 4;
          data[idx] = Math.round(sky[0] * 255);
          data[idx + 1] = Math.round(sky[1] * 255);
          data[idx + 2] = Math.round(sky[2] * 255);
          data[idx + 3] = 255;
        }
        continue;
      }

      const dy = (py - horizonY) / (H - horizonY); // 0 at horizon -> 1 at bottom
      const depth = 0.85 / Math.max(0.004, dy);
      const nextDy = (py + 1 - horizonY) / (H - horizonY);
      const nextDepth = 0.85 / Math.max(0.004, nextDy);

      const v = (depth + walkZ) * tileDensity * 0.32;
      const dv = Math.abs(nextDepth - depth) * tileDensity * 0.32 * plazaMips.size;

      for (let px = 0; px < W; px++) {
        const nx = (px / W - 0.5) * 2.2 * aspectK;
        const u = (nx * depth + swayX) * tileDensity * 0.32;
        const du = (2.2 / W) * depth * tileDensity * 0.32 * plazaMips.size;

        const footprint = Math.max(du, dv * 0.55); // Mild aniso + mip
        const rawLod = clamp(Math.log2(Math.max(1, footprint)) + mipBias, 0, 7);

        let col: Vec3;
        if (!mipmapOn) {
          // Force Mip 0 point/bilinear without mip prefiltering -> authentic shimmering Moiré!
          col = sampleMipNearest(plazaMips, 0, u, v);
        } else {
          col = sampleMipTrilinear(plazaMips, rawLod, u, v);
        }

        if (rainbowOn) {
          const cIdx = Math.min(4, Math.floor(mipmapOn ? rawLod : 0));
          const cNext = Math.min(4, cIdx + 1);
          const cFrac = mipmapOn ? clamp(rawLod - Math.floor(rawLod), 0, 1) : 0;
          const tint = lerp3(MIP_RAINBOW_COLORS[cIdx], MIP_RAINBOW_COLORS[cNext], cFrac);
          const lum = col[0] * 0.3 + col[1] * 0.59 + col[2] * 0.11;
          col = lerp3(col, [tint[0] * (0.42 + lum * 0.85), tint[1] * (0.42 + lum * 0.85), tint[2] * (0.42 + lum * 0.85)], 0.78);
        }

        const haze = saturate((depth - 9) / 36) * 0.35;
        col = lerp3(col, isDark ? [0.2, 0.23, 0.29] : [0.85, 0.89, 0.94], haze);

        const idx = (py * W + px) * 4;
        data[idx] = Math.round(saturate(col[0]) * 255);
        data[idx + 1] = Math.round(saturate(col[1]) * 255);
        data[idx + 2] = Math.round(saturate(col[2]) * 255);
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);
  }, [camPhase, mipmapOn, rainbowOn, tileDensity, mipBias, plazaMips, isDark, canvasFit]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Top Toggles */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <StageToggle
          label="开启 Mipmap 套娃缩略图"
          checked={mipmapOn}
          onChange={setMipmapOn}
          hint={mipmapOn ? '远景宁静丝滑' : '已关：远景蚂蚁狂闪!'}
        />
        <StageToggle
          label="🌈 UE 5.8 Mip 层级彩虹染色镜"
          checked={rainbowOn}
          onChange={setRainbowOn}
        />
        <StageToggle
          label="漫游推进"
          checked={drifting}
          onChange={setDrifting}
        />
      </div>

      {/* Main Viewport + Right 1 + 1/3 Geometric Area Proof */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 208px',
          gap: 10,
          alignItems: 'stretch',
        }}
      >
        <div
          style={{
            position: 'relative',
            borderRadius: 11,
            border: '1.5px solid var(--border-strong)',
            overflow: 'hidden',
            minHeight: 222,
          }}
        >
          <canvas
            ref={canvasRef}
            width={360}
            height={222}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
          {/* Rainbow Legend Bar */}
          {rainbowOn && (
            <div
              style={{
                position: 'absolute',
                bottom: 8,
                left: 8,
                right: 8,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 5,
                padding: '4px 8px',
                borderRadius: 7,
                background: 'rgba(18, 16, 14, 0.82)',
                color: '#fff',
                fontSize: 10.5,
                fontFamily: 'var(--font-mono)',
                justifyContent: 'space-around',
              }}
            >
              <span style={{ color: '#f87171' }}>■ Mip0 原图</span>
              <span style={{ color: '#fb923c' }}>■ Mip1 1/2</span>
              <span style={{ color: '#4ade80' }}>■ Mip2 1/4</span>
              <span style={{ color: '#38bdf8' }}>■ Mip3 1/8</span>
              <span style={{ color: '#c084fc' }}>■ Mip4+ 远景</span>
            </div>
          )}
        </div>

        {/* Geometric Proof: 1 + 1/4 + 1/16 + 1/64... = 1 + 1/3 (+33.3%) */}
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1.5px solid var(--border-soft)',
            borderRadius: 11,
            padding: '8px 9px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, textAlign: 'center' }}>
            📐 为什么全套缩略图只多占 33.3%？
          </div>
          <svg width="188" height="142" viewBox="0 0 188 142">
            {/* Mip 0: 108 x 108 square = 100% */}
            <rect
              x="6"
              y="14"
              width="108"
              height="108"
              rx="4"
              fill="rgba(239, 68, 68, 0.22)"
              stroke="#ef4444"
              strokeWidth="1.8"
            />
            <text x="60" y="64" textAnchor="middle" fontSize="11" fontWeight="800" fill={isDark ? '#fca5a5' : '#991b1b'}>
              Mip 0 (原图)
            </text>
            <text x="60" y="80" textAnchor="middle" fontSize="10" fontFamily="monospace" fill={isDark ? '#e5e7eb' : '#374151'}>
              2048² = 100%
            </text>

            {/* +1/3 Container dashed frame: width 36 x height 108 = exact 1/3 of Mip 0!
                And right beside we draw exact geometric half-scale squares Mip1 (54x54 = 25%), Mip2 (27x27 = 6.25%), Mip3 (13.5x13.5)... */}
            <g opacity={mipmapOn ? 1 : 0.25}>
              {/* Mip 1: 54x54 = 1/4 (25%) */}
              <rect
                x="122"
                y="14"
                width="54"
                height="54"
                rx="3"
                fill="rgba(249, 115, 22, 0.28)"
                stroke="#f97316"
                strokeWidth="1.6"
              />
              <text x="149" y="40" textAnchor="middle" fontSize="9.5" fontWeight="700" fill={isDark ? '#fdba74' : '#9a3412'}>
                Mip 1
              </text>
              <text x="149" y="53" textAnchor="middle" fontSize="9" fontFamily="monospace" fill={isDark ? '#e5e7eb' : '#374151'}>
                1/4 (25%)
              </text>

              {/* Mip 2: 27x27 = 1/16 (6.25%) */}
              <rect
                x="122"
                y="73"
                width="27"
                height="27"
                rx="2"
                fill="rgba(34, 197, 94, 0.28)"
                stroke="#22c55e"
                strokeWidth="1.5"
              />
              <text x="135.5" y="90" textAnchor="middle" fontSize="8.5" fontWeight="700" fill={isDark ? '#86efac' : '#166534'}>
                1/16
              </text>

              {/* Mip 3: 13.5x13.5 = 1/64 */}
              <rect
                x="153"
                y="73"
                width="14"
                height="14"
                rx="1.5"
                fill="rgba(14, 165, 233, 0.32)"
                stroke="#0ea5e9"
                strokeWidth="1.3"
              />
              {/* Mip 4: 7x7 */}
              <rect
                x="153"
                y="90"
                width="7"
                height="7"
                fill="rgba(139, 92, 246, 0.4)"
                stroke="#8b5cf6"
                strokeWidth="1.1"
              />
              {/* Mip 5+: 3.5x3.5 */}
              <rect x="163" y="90" width="4" height="4" fill="#8b5cf6" />

              <text x="150" y="116" textAnchor="middle" fontSize="9.5" fontWeight="800" fill={isDark ? '#86efac' : '#2c551c'}>
                合计 = +33.3%
              </text>
            </g>

            {!mipmapOn && (
              <text x="149" y="116" textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#ef4444">
                NoMipmaps
              </text>
            )}
          </svg>
          <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.35 }}>
            <code>1/4 + 1/16 + 1/64 + … = 1/3</code>
            <br />
            完整 mip 链约为基级的 4/3（大正方形纹理）
          </div>
        </div>
      </div>

      {/* Pitfall Compare Bar */}
      <PitfallCompareBar
        isPitfall={!mipmapOn}
        pitfallLabel="同一张 128×128 砖纹只采基级，远处出现闪烁"
        correctLabel="同一张砖纹启用完整 mip 链，在远处采较小的层级"
        onToggle={(pitfall) => setMipmapOn(!pitfall)}
      />

      {/* Sliders */}
      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSlider
            label="广场细砖密集度"
            value={tileDensity}
            min={1.0}
            max={3.2}
            step={0.1}
            unit="×"
            onChange={setTileDensity}
          />
          <StageSlider
            label="镜头推进漫游速度"
            value={driftSpeed}
            min={0.0}
            max={1.2}
            step={0.05}
            onChange={setDriftSpeed}
          />
          <StageSlider
            label="Mip 偏移 (Mip Bias)"
            value={mipBias}
            min={-1.5}
            max={1.5}
            step={0.25}
            formatValue={(v) => (v > 0 ? `+${v.toFixed(2)} (偏糊省带宽)` : v < 0 ? `${v.toFixed(2)} (偏锐易闪)` : '0.00 (默认最佳)')}
            onChange={setMipBias}
          />
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * MODULE 05 LESSON DEFINITIONS (5.1, 5.2, 5.3)
 * ========================================================================== */

const module05Lessons: LessonDefinition[] = [
  {
    id: 'texel-uv-tiling-wrap-clamp',
    moduleId: '05',
    number: '5.1',
    title: '像素去贴图里“查字典” —— 纹素、UV 缩放反直觉规律与边缘寻址',
    subtitle: '分清屏幕像素与贴图纹素，看懂为什么 UV 乘以 2 花纹反而变小铺成 4 块，以及弹孔贴花十字拉丝的救命良方',
    duration: '12 分钟',
    difficulty: '零基础',
    steps: [
      {
        stepNumber: 1,
        shortLabel: '花纹缩小的怪事',
        tag: 'phenomenon',
        title: '想把地砖放大两倍，乘了个 2 怎么反而缩成四小块？',
        paragraphs: [
          '几乎每个刚接触材质的同学都会在同一个地方摔一跤：嫌广场地上的方砖太碎，想让每块花砖放大两倍，于是自信满满地给坐标乘了个 `2` —— 结果抬头一看，砖块非但没变大，反而缩成了四分之一小，密密麻麻铺了 `2 × 2 = 4` 块！',
          '另一边做墙面弹孔贴花的同学更抓狂：明明贴图正中间只画了一个黑漆漆的弹孔，贴到水泥墙上后，上下左右竟然射出了四道贯穿整面大墙的诡异十字彩条！这两桩怪事背后，其实藏着同一个底层动作——**屏幕像素去贴图里“查字典”**。',
        ],
        tryItPrompt:
          '👉 先在左侧「模式 A：地砖平铺与水流」里把横向和纵向平铺滑块从 2.0 拉到 1.0 再拉到 4.0，盯着上方刻度尺看砖块数量是怎么反着变的！',
      },
      {
        stepNumber: 2,
        shortLabel: '纹素与尺子刻度',
        tag: 'background',
        title: '像素 vs 纹素，以及“尺子刻度翻倍”的通俗真相',
        paragraphs: [
          '先把两个容易混的格子分清：你显示器上发光的小灯泡叫 **像素（Pixel）**；而贴图图片文件里自带的一格格色块叫 **纹素（Texel）**。“纹理采样”就是每个屏幕像素攥着自己的 `(U, V)` 坐标小纸条，跑去左侧那本纹素字典里查颜色。',
          '那为什么 `UV × 2` 花纹反而缩小？想象贴图规定“尺子从 `0` 走到 `1` 刚好画完一整块花砖”。当你把坐标乘以 `2`，地面左端到右端的尺子刻度就被改写成了 `0 → 2`！像素才走到地面正中间就已经读到了 `1`（被迫提前画完第 1 块砖），后半截 `1 → 2` 只能再重复画第 2 块！再给坐标加上不断增长的时间小数（`+ Time`），整把尺子匀速平移，图案就像溪水一样流动起来了。',
        ],
        tryItPrompt:
          '👉 把横向与纵向平铺都拉到 `0.5×`：看尺子走到右端尽头才刚到 `0.5`，地面是不是立刻只剩放大后的四分之一块巨型花砖了？',
        callout: {
          tone: 'formula',
          title: '零基础防反口诀',
          body: 'UV 乘大数 (>1) = 尺子刻度变密 = 提前走完 1 格 = 花纹缩小变多块！\nUV 乘小数 (<1) = 尺子没走完 1 格 = 花纹被撑大！',
        },
      },
      {
        stepNumber: 3,
        shortLabel: '越界寻址规矩',
        tag: 'experiment',
        title: '尺子走出 0~1 边界怎么办？循环包裹 Wrap vs 边缘夹紧 Clamp',
        paragraphs: [
          '既然尺子刻度能超过 `1`（比如 `1.6`）甚至小于 `0`（比如 `-0.4`），可贴图字典明明只有 `0 ~ 1` 这一小方格，越界之后去哪儿查颜色？显卡定下了两条寻址家规：',
          '第一条叫 **包裹循环（`Wrap`）**：直接扔掉整数只看小数部分（`1.6` 当成 `0.6` 查），图案像无缝壁纸一样铺满全世界，最适合地砖、草地与流水；第二条叫 **边缘夹紧（`Clamp`）**：凡是小于 `0` 一律死锁在最左/最上一排纹素，大于 `1` 死锁在最右/最下一排纹素——专为只准在墙上出现一次的弹孔、血迹和贴花准备！',
        ],
        tryItPrompt:
          '👉 点击舞台顶部切换到「模式 B：墙面弹孔贴花越界」，在水泥墙上任意移动鼠标，观察底部公式栏里 `Wrap 取小数` 与 `Clamp 锁死 [0..1]` 的区别！',
      },
      {
        stepNumber: 4,
        shortLabel: 'UE 5.8 采样配置',
        tag: 'ue5',
        title: '走进 UE 5.8：TexCoord、Panner 与 Shared: Clamp 妙用',
        paragraphs: [
          '在 UE 5.8 材质编辑器中，这套操作对应三个天天见面的老朋友：① 按住键盘 **`U`** 点左键呼出 **`TextureCoordinate (TexCoord)`** 节点，改 `UTiling / VTiling` 就能缩放地砖；② 按住 **`P`** 点左键呼出 **`Panner（平移器）`**，填上 `Speed X / Y` 就能驱动水波与火焰滚动。',
          '③ 想把某张弹孔贴图改成不重复的 `Clamp`？既可以双击贴图资产，在 `Texture → Advanced` 里把 **`X-axis / Y-axis Tiling Method`** 改为 `Clamp`；更省事的做法是直接选中材质里的 `Texture Sample` 节点，把 `Sampler Source` 改成 **`Shared: Clamp`**！',
        ],
        tryItPrompt:
          '👉 切回模式 A 拨动「Panner 水流平移速度」体验动态流水，再点右上角「原理图」按钮查看 UE 5.8 标准节点连线！',
        callout: {
          tone: 'ue58',
          title: 'UE 5.8 省采样器冷知识：Shared: Wrap / Shared: Clamp',
          body: '把 Texture Sample 的 Sampler Source 设为 Shared: Clamp，不仅不用修改原贴图资产设置，还能让几十张贴图共用同一个硬件采样器，彻底告别 16 采样器超限报错！',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '弹孔十字拉丝坑',
        tag: 'pitfall',
        title: '实战避坑：为什么开了 Clamp 却拉出贯穿全墙的十字彩条？',
        paragraphs: [
          '揭晓开头那个让无数美术崩溃的十字拉丝惨案！既然 `Clamp` 的规矩是“走出 `0~1` 后，永远复写贴图最外圈第 1 像素的颜色”，如果画师画火焰符文或弹孔时，笔刷不小心蹭到了画布最边缘哪怕 1 个像素的橙色火星，这一点点火星就会被 `Clamp` 硬生生拉成几米长的激光彩带！',
          '本例用 Alpha 合成弹孔。把图像四边的 Alpha 清为 0，Clamp 越界采到透明边就会露出墙面。黑色 RGB 配 Alpha=1 仍会拉出黑条。直通 Alpha 纹理可在透明区延展邻近 RGB，减少双线性和 mip 过滤产生的色边。',
        ],
        tryItPrompt:
          '👉 在模式 B 下点击橙/绿避坑横幅，一键对比「Clamp 边缘 Alpha 非零（边缘火星拉出十字彩带）」与「Clamp + 1px 透明安全边」！',
        callout: {
          tone: 'warn',
          title: '一句话防坑口诀',
          body: '平铺地砖用 Wrap。独立 Alpha 贴花用 Clamp，在边缘保留足够的透明填充，并在远景检查过滤后的边缘。',
        },
      },
    ],
    takeaways: [
      '显示器发光点叫像素（Pixel），贴图色块格叫纹素（Texel），纹理采样就是像素拿 UV 去查纹素字典。',
      'UV 乘以大于 1 的数会让刻度变密，花纹反而缩小并重复铺成多块；乘以小于 1 的小数花纹才会放大。',
      '超出 0~1 范围时，地砖草地用 Wrap（取小数无限循环），独立弹孔贴花用 Clamp（锁死最外圈像素）。',
      '使用 Alpha 合成时，Clamp 贴花需在图像边界将 Alpha 清零，并分别处理 RGB 扩色。若使用共享采样器，确认其寻址与过滤符合贴花要求，例如可兼容的 Shared: Clamp。',
    ],
    schematic: {
      title: 'UE 5.8 UV 缩放、Panner 流动与采样器寻址连线图',
      caption: 'TexCoord 控制平铺密度，Panner 叠加时间偏移，送入配置好 Wrap / Shared:Clamp 的 Texture Sample',
      nodes: [
        {
          id: 'texcoord',
          title: 'TextureCoordinate',
          subtitle: '快捷键 U · UV 尺子',
          category: 'input',
          x: 24,
          y: 48,
          width: 175,
          outputs: [{ id: 'uv', label: 'UV (RG)', color: '#eab308' }],
          note: 'UTiling / VTiling = 2.0',
        },
        {
          id: 'tiling_param',
          title: 'ScalarParameter',
          subtitle: 'Tiling 倍数参数',
          category: 'param',
          x: 24,
          y: 195,
          width: 175,
          outputs: [{ id: 'val', label: '2.0', color: '#e5e7eb' }],
        },
        {
          id: 'mul_uv',
          title: 'Multiply',
          subtitle: '快捷键 M · 缩放刻度',
          category: 'math',
          x: 245,
          y: 95,
          width: 155,
          inputs: [
            { id: 'a', label: 'A (UV)', color: '#eab308' },
            { id: 'b', label: 'B (Tiling)', color: '#e5e7eb' },
          ],
          outputs: [{ id: 'out', label: 'Scaled UV', color: '#eab308' }],
        },
        {
          id: 'panner',
          title: 'Panner',
          subtitle: '快捷键 P · 时间平移',
          category: 'math',
          x: 440,
          y: 95,
          width: 165,
          inputs: [{ id: 'coord', label: 'Coordinate', color: '#eab308' }],
          outputs: [{ id: 'out', label: 'Flow UV', color: '#eab308' }],
          note: 'Speed X=0.2, Y=0.1',
        },
        {
          id: 'tex_sample',
          title: 'Texture Sample',
          subtitle: 'Shared: Wrap / Clamp',
          category: 'texture',
          x: 645,
          y: 78,
          width: 195,
          previewColor: '#2d68a8',
          inputs: [{ id: 'uvs', label: 'UVs', color: '#eab308' }],
          outputs: [
            { id: 'rgb', label: 'RGB', color: '#e5e7eb' },
            { id: 'a', label: 'A', color: '#9ca3af' },
          ],
          note: '贴花改选 Shared: Clamp',
        },
      ],
      edges: [
        { fromNode: 'texcoord', fromPin: 'uv', toNode: 'mul_uv', toPin: 'a', color: '#eab308' },
        { fromNode: 'tiling_param', fromPin: 'val', toNode: 'mul_uv', toPin: 'b', color: '#e5e7eb' },
        { fromNode: 'mul_uv', fromPin: 'out', toNode: 'panner', toPin: 'coord', color: '#eab308' },
        { fromNode: 'panner', fromPin: 'out', toNode: 'tex_sample', toPin: 'uvs', color: '#eab308' },
      ],
    },
    StageComponent: Stage5_1_UvTilingWrapClamp,
  },

  {
    id: 'texture-filtering-aniso',
    moduleId: '05',
    number: '5.2',
    title: '怼脸马赛克与斜看马路发糊 —— 最近点、双线性与各向异性过滤',
    subtitle: '当 1 个屏幕像素对不上 1 个贴图纹素：看懂近景放大锯齿与 82° 低头远眺公路糊成白雾的终极解法',
    duration: '13 分钟',
    difficulty: '零基础',
    steps: [
      {
        stepNumber: 1,
        shortLabel: '怼脸锯齿与远路糊',
        tag: 'phenomenon',
        title: '凑近墙根全是方格马赛克，低头看远方公路又糊成白雾？',
        paragraphs: [
          '在 3D 游戏里看地面和墙壁时，你一定撞见过这两种头疼画面：第一种是把镜头贴到木箱表面怼脸细看，原本柔和的油漆花纹裂成了一格一格僵硬的方形马赛克；第二种是站在大马路中央低头望向远方，脚边两米内的斑马线还清清楚楚，可才往前延伸十来米，整条马路就像蒙了层白雾一样糊成一团灰浆！',
          '明明美术给的都是高清贴图，为什么凑太近会碎成方块、斜着往远看又会糊成近视眼呢？点击上方两个预设按钮，先亲眼验一验这两个案发现场！',
        ],
        tryItPrompt:
          '👉 先点「🔍 预设 ①：近景怼脸放大」拖动拉帘看硬马赛克 vs 柔滑过渡，再点「🛣️ 预设 ②：81° 低头远眺公路」对比远方斑马线的清晰度！',
      },
      {
        stepNumber: 2,
        shortLabel: '纹素混合与长脚印',
        tag: 'background',
        title: '像素脚印踩歪了怎么办？从 4 邻居混色到 1×16 细长脚印',
        paragraphs: [
          '病根只有一句话：**屏幕像素和贴图纹素几乎永远没法一比一严丝合缝对齐**！先看**怼脸放大**：贴图里 1 个纹素大格子要管屏幕上几十个像素。如果死板规定“离哪个纹素中心近就全抄谁的色”，交界处就会切出硬方块，叫 **最近点过滤（`Nearest`）**；如果把周围相邻 `2 × 2 = 4` 个纹素按远近温柔混色，锯齿立刻化作顺滑渐变，叫 **双线性过滤（`Bilinear`）**！',
          '那为什么**低头斜看远方马路**时双线性也彻底翻车？看舞台右侧的「像素脚印透视窗」：当你以 `80°` 大斜角平视地面，屏幕上 1 个方方正正的像素投射到贴图上，左右只跨了 `1` 格，顺着公路纵深却一口气拉长跨过了 **`16` 格**！普通滤波不分长短，直接画个 `16 × 16` 的大正方形红框一锅乱炖求平均，把旁边的黑柏油和白斑马线全搅成了灰粥！',
        ],
        tryItPrompt:
          '👉 慢慢把「镜头俯仰角」从 `15°` 往右拉到 `82°`，紧盯右侧小窗里绿色像素脚印是如何从一粒小圆点被拉成细长扁条的！',
        callout: {
          tone: 'tip',
          title: '大白话秒懂“各向异性过滤（Anisotropic Filtering）”',
          body: '普通滤波是“各向同性”（不管横竖一刀切按大圆圈糊）；而“各向异性 8x / 16x”超级聪明——发现脚印顺着马路纵深拉成了细长条，就专门顺着这条细线排一列采 8 个或 16 个绿点求平均，左右丝毫不乱糊！',
        },
      },
      {
        stepNumber: 3,
        shortLabel: '拉帘同屏实测',
        tag: 'experiment',
        title: '亲手拖动白色拉帘：一秒擦亮十米外的斑马线与双黄线',
        paragraphs: [
          '把镜头俯仰角停在 `80° ~ 84°` 之间，用手抓住跑道正中央的白色 `⇆` 对比拉帘左右滑动，仔细端详公路尽头的白色斑马线、中央双黄线和两侧红白路肩砖：',
          '左半屏 `Bilinear` 在中景处就已经糊成了灰蒙蒙一片，连双黄线都消失不见了；而右半屏 `Anisotropic 8x` 沿着纵深精准采样后，斑马线条纹与路肩红白砖块一路清晰锐利地延伸到了天际线尽头！切到 `Aniso 16x` 连最极端掠射角都稳如泰山。',
        ],
        tryItPrompt:
          '👉 左右拖动跑道中间的 `⇆` 分屏拉帘，并在右下方切换 `Bilinear / Aniso 8x / Aniso 16x`，观察顶部 KPI 中采样策略与清晰度的变化！',
      },
      {
        stepNumber: 4,
        shortLabel: 'UE 5.8 过滤设置',
        tag: 'ue5',
        title: '走进 UE 5.8：Filter 下拉框与项目各向异性画质档位',
        paragraphs: [
          '回到真实 UE 5.8 工程里，这两套机制各司其职：① 如果你正在制作《我的世界》或复古 2D 像素风独立游戏，双击导入的小尺寸像素画贴图，在 `Texture → Advanced → Filter` 下拉框里把 `Default` 手动改为 **`Nearest（最近点）`**，就能彻底关掉双线性柔化，保留清脆硬朗的像素颗粒感！',
          '② 对于写实项目的公路、大地砖、木地板、水面波浪法线，保持默认跟随纹理组（`Default from Texture Group`），并在引擎画质设置（Scalability `Textures: High/Epic` 或控制台 `r.MaxAnisotropy 8`）中启用 8 倍或 16 倍各向异性过滤即可。',
        ],
        tryItPrompt:
          '👉 切到 `12°` 近景对比 `Nearest` 与 `Bilinear`，想象一下做复古像素宝剑时如果忘了改 `Nearest` 会糊成什么样！',
        callout: {
          tone: 'ue58',
          title: 'UE 5.8 性能性价比之王',
          body: '在如今的电脑与主机显卡上，开启 8x 各向异性过滤几乎不掉帧（开销不足 1%），却能拯救全场景所有大斜角地面的清晰度，是妥妥的免费画质午餐！',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '像素风与地面糊坑',
        tag: 'pitfall',
        title: '实战避坑：斜看马路发糊别傻换 8K 贴图，开各向异性才治本！',
        paragraphs: [
          '这节课帮你省下成吨冤枉显存！很多团队发现游戏里十几米外的地面斜着看发糊，第一反应是逼着美术把 `2K` 地砖重做成 `4K` 甚至 `8K` 超大图——结果显存暴涨了 16 倍，斜着看十米外**仍可能因为不合适的过滤而模糊**！',
          '现在你一眼就能看穿病因：大斜角发糊是因为 `1 × 16` 扁长脚印触发了错误的各向同性大框模糊，跟原图是不是 `8K` 毫无关系！老老实实打开 `Anisotropic 8x`，一张轻巧的 `2K` 贴图就能跑出刀锋般的远景清晰度！',
        ],
        tryItPrompt:
          '👉 点击舞台下方的橙/绿避坑对比栏，一键在「普通双线性远景发糊」与「8x 各向异性锐利跑道」之间切换验收！',
        callout: {
          tone: 'warn',
          title: '一句话防坑口诀',
          body: '像素风必改 Nearest 保硬边；大马路斜看发糊别怪贴图不够大，开各向异性过滤（Aniso 8x）比换 8K 贴图管用十倍！',
        },
      },
    ],
    takeaways: [
      '最近点过滤（Nearest）直接取最近纹素颜色，适合复古像素风；双线性过滤（Bilinear）混合周围 4 纹素消除近景放大锯齿。',
      '低头大斜角远眺地面时，1 个屏幕像素在贴图上的脚印会被拉成 1×16 细长条，普通滤波按大正方形乱糊会导致远景发雾。',
      '各向异性过滤（Anisotropic 8x/16x）专门顺着拉长的纵深方向多点采样求平均，让公路标线直到地平线依然锐利。',
      '地面斜看发糊时盲目升级 4K/8K 贴图毫无作用且浪费显存，检查纹理组与开启 MaxAnisotropy 才是正解。',
    ],
    schematic: {
      title: 'UE 5.8 贴图过滤模式与硬件各向异性采样管线',
      caption: '显卡根据相邻像素 UV 偏导数 (ddx / ddy) 自动测算脚印长宽比，决定单点混合还是沿纵深多点采样',
      nodes: [
        {
          id: 'screen_uv',
          title: 'Screen Pixel UV',
          subtitle: 'ddx(UV) & ddy(UV)',
          category: 'input',
          x: 24,
          y: 84,
          width: 175,
          outputs: [
            { id: 'uv', label: 'UV 坐标', color: '#eab308' },
            { id: 'footprint', label: '脚印跨度 1×16', color: '#f97316' },
          ],
          note: '82° 斜看时纵深跨度激增',
        },
        {
          id: 'tex_filter',
          title: 'Texture Asset · Filter',
          subtitle: 'Nearest / Bilinear / Default',
          category: 'param',
          x: 250,
          y: 38,
          width: 195,
          inputs: [{ id: 'in_uv', label: 'UV', color: '#eab308' }],
          outputs: [{ id: 'cfg', label: 'Filter Mode', color: '#38bdf8' }],
          note: '像素画改选 Nearest',
        },
        {
          id: 'aniso_unit',
          title: 'GPU Anisotropic Unit',
          subtitle: 'r.MaxAnisotropy = 8x / 16x',
          category: 'pipeline',
          x: 250,
          y: 178,
          width: 195,
          inputs: [{ id: 'fp', label: 'Footprint', color: '#f97316' }],
          outputs: [{ id: 'taps', label: '沿纵深 8 点采样', color: '#22c55e' }],
          note: '仅顺拉长轴采样，横向不糊',
        },
        {
          id: 'slab_out',
          title: 'Substrate Slab BSDF',
          subtitle: 'Diffuse Albedo 输入',
          category: 'substrate',
          x: 505,
          y: 96,
          width: 205,
          previewColor: '#22c55e',
          inputs: [
            { id: 'albedo', label: 'Diffuse Albedo', color: '#e5e7eb' },
            { id: 'aniso_tap', label: 'Filtered Color', color: '#22c55e' },
          ],
          outputs: [{ id: 'mat', label: 'Front Material', color: '#a855f7' }],
          note: '地平线标线清晰锐利',
        },
      ],
      edges: [
        { fromNode: 'screen_uv', fromPin: 'uv', toNode: 'tex_filter', toPin: 'in_uv', color: '#eab308' },
        { fromNode: 'screen_uv', fromPin: 'footprint', toNode: 'aniso_unit', toPin: 'fp', color: '#f97316' },
        { fromNode: 'tex_filter', fromPin: 'cfg', toNode: 'slab_out', toPin: 'albedo', color: '#38bdf8' },
        { fromNode: 'aniso_unit', fromPin: 'taps', toNode: 'slab_out', toPin: 'aniso_tap', color: '#22c55e' },
      ],
    },
    StageComponent: Stage5_2_FilteringAniso,
  },

  {
    id: 'mipmap-pyramid-moire',
    moduleId: '05',
    number: '5.3',
    title: '远景为什么会像蚂蚁乱爬一样狂闪？—— Mipmap 套娃缩略图与 33% 显存账',
    subtitle: '终结远景高频噪点闪烁与摩尔纹：看懂逐级减半的套娃缩略图接力赛，以及为什么全套缩略图只多花三分之一显存',
    duration: '13 分钟',
    difficulty: '零基础',
    steps: [
      {
        stepNumber: 1,
        shortLabel: '远景蚂蚁乱爬',
        tag: 'phenomenon',
        title: '贴图越高清越好？怎么镜头一动，远方砖地像蚂蚁乱爬一样狂闪！',
        paragraphs: [
          '不少新手做高画质场景时会有个执念：“缩略图听着就像降低画质，我要把它关掉，让显卡全程只读最高清的原图！” 结果把一张精细的红白广场砖铺满大地后，只要镜头稍微往前推进半步，远方地平线一带就炸开了刺眼的雪花噪点和诡异波纹，像几万只蚂蚁在屏幕上疯狂抽搐闪烁！',
          '可神奇的是，只要勾上一个叫 **`Mipmap`** 的开关，哪怕镜头晃得再快，整片远方广场瞬间平静柔和得像丝绸一样！为什么“强读高清原图”反而会毁了远景画面？',
        ],
        tryItPrompt:
          '👉 此时舞台默认关掉了 Mipmap：盯着缓慢推进的广场远景看那片狂闪的雪花波纹；然后勾选左上角「开启 Mipmap 套娃缩略图」，感受瞬间清静的救赎感！',
      },
      {
        stepNumber: 2,
        shortLabel: '4096 选 1 的灾难',
        tag: 'background',
        title: '1 个像素底下挤着 4096 个纹素，“一锤子瞎摸”必翻车',
        paragraphs: [
          '算笔简单算术就全破案了：一面贴了 `2048 × 2048`（四百多万纹素）精细红砖图的大墙退到百米开外时，在屏幕上缩得只占 `32 × 32` 个像素。算下来，**远景 1 个屏幕像素脚底下足足挤着 `4096` 个红砖和白灰缝纹素！** 如果没有缩略图，显卡采样器一锤子下去只盲摸其中 `1` 个点：这一帧摸到红砖涂纯红，下一帧镜头挪动零点一毫米摸到白灰缝啪地跳纯白！几万个像素同时乱跳，就是刺眼的**闪烁走样与摩尔纹（Moiré）**！',
          '根治妙招就是导入贴图时提前算好一套长宽逐级减半的**“俄罗斯套娃缩略图”（`Mipmap`）**：`2048 → 1024 → 512 … → 1×1`！远景像素直接去读提前平均好的小号缩略图，减轻远景闪烁，改善纹理访问的局部性！',
        ],
        tryItPrompt:
          '👉 看舞台右侧的几何方块拼图：`Mip 1 (1/4)` + `Mip 2 (1/16)` + `Mip 3 (1/64)`……全部加起来，是不是刚好等于原图的三分之一（`+33.3%`）？',
        callout: {
          tone: 'formula',
          title: '无穷套娃为什么不会撑爆显存？',
          body: '大正方形纹理长和宽各减半，面积就缩为 1/4！把所有缩略图面积相加：\n1/4 + 1/16 + 1/64 + 1/256 + … = 1/3 ≈ +33.3%！\n对较大的正方形贴图，这约为基级的三分之一。过滤能减轻远景走样；实际占用还受块取整和驻留影响。',
        },
      },
      {
        stepNumber: 3,
        shortLabel: '彩虹染色透视镜',
        tag: 'experiment',
        title: '戴上 UE 5.8 的“彩虹眼镜”：亲眼看套娃是怎么分棒接力的',
        paragraphs: [
          '显卡在幕后悄无声息地换着缩略图，肉眼根本察觉不到接缝（因为三线性过滤把相邻两号套娃也做了丝滑过渡）。想亲眼抓拍它们的接力现场？勾选舞台顶部的 **「🌈 UE 5.8 Mip 层级彩虹染色镜」**！',
          '我们给每级套娃涂上了醒目的诊断色：脚下最近处是火红色的 **`Mip 0`（高清原图）**，往前几米温柔交棒给橙色的 **`Mip 1`（半尺寸图）**，再往远依次换成翠绿 **`Mip 2`**、天蓝 **`Mip 3`** 与深紫 **`Mip 4+`**！镜头往前走，这道彩虹接力环就稳稳护送在脚前。',
        ],
        tryItPrompt:
          '👉 打开「🌈 UE 5.8 Mip 层级彩虹染色镜」，再左右拨动下方「Mip 偏移 (Mip Bias)」滑块，观察彩虹色带是如何往近处收缩或往远处推开的！',
      },
      {
        stepNumber: 4,
        shortLabel: '尺寸与流送',
        tag: 'ue5',
        title: '走进 UE 5.8：为什么游戏贴图尺寸非得是 512、1024、2048？',
        paragraphs: [
          '在 UE 5.8.1 导入 1000×752 的 PNG，纹理编辑器默认显示 `NoMipmaps`。改为 `SimpleAverage`，保存后重新打开可以读到新设置。查看纹理编辑器的 mip 选择器，确认当前平台实际构建出的层数。',
          '常规流送以长宽各为二次幂的纹理为前提，可在资源中填充到合适尺寸。生成 mip、流送资格和块对齐分别检查。1000×752 两边都是 4 的倍数，满足常见桌面 BC 顶层尺寸对齐，但两边都不是二次幂。',
        ],
        tryItPrompt:
          '👉 试着拉高「广场细砖密集度」到 `3.0×`，再开关 Mipmap 对比：花纹越精细，没有 Mipmap 时的摩尔纹漩涡就越触目惊心！',
        callout: {
          tone: 'ue58',
          title: '在纹理编辑器核对构建结果',
          body: '记录导入尺寸、平台像素格式、mip 层数和 Never Stream 状态。更改 Mip Gen Settings 后重新构建，并检查实际资源。',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '非 2 次幂与 UI 坑',
        tag: 'pitfall',
        title: '场景贴图和 UI 何时需要 mip？',
        paragraphs: [
          '需要常规流送的场景纹理可选 1024×512 等二次幂尺寸；近景和远景都要检查清晰度、闪烁与实际驻留层级。',
          'UI 图标如果始终按原尺寸显示，可考虑关闭 mip。界面会缩小或出现在三维场景时，应观察缩小时的走样。大正方形贴图关闭完整 mip 链约节省原总量的 25%。',
        ],
        tryItPrompt:
          '点击下方横幅，用同一张广场砖纹对比只采基级和启用 mip。',
        callout: {
          tone: 'warn',
          title: '一句话防坑口诀',
          body: '完整链约为基级的 4/3；删掉附加层约省完整链的四分之一。',
        },
      },
    ],
    takeaways: [
      '远景 1 个屏幕像素底下挤着成百上千个纹素，若直接采基级可能导致镜头微动时颜色剧烈跳变（闪烁走样与摩尔纹）。',
      'Mipmap 提前生成长宽逐级减半的套娃缩略图（2048→1024→512…→1），可以减轻远景走样，改善纹理访问局部性。',
      '生成 mip 与常规流送分别检查。纹理编辑器可以修改 NPOT 资源的 Mip Gen Settings，再看本平台实际生成的层数。',
      '大正方形的完整 mip 链约为基级的 4/3，关闭后节省完整链的约 25%。',
    ],
    schematic: {
      title: 'UE 5.8 Mipmap 套娃金字塔生成与屏幕跨度自动选层流水线',
      caption: '2 的整次幂贴图导入时离线构建 Mip 0..N，渲染时按像素跨度三线性混合相邻两级缩略图',
      nodes: [
        {
          id: 'pow2_src',
          title: '2048×2048 源贴图',
          subtitle: '2 的整次幂 (2¹¹ × 2¹¹)',
          category: 'texture',
          x: 24,
          y: 80,
          width: 175,
          previewColor: '#ef4444',
          outputs: [{ id: 'mip0', label: 'Mip 0 (100%)', color: '#ef4444' }],
          note: '示例基级尺寸为 2048²',
        },
        {
          id: 'mip_gen',
          title: 'Mip Gen Settings',
          subtitle: 'FromTextureGroup',
          category: 'pipeline',
          x: 240,
          y: 80,
          width: 190,
          inputs: [{ id: 'src', label: 'Mip 0', color: '#ef4444' }],
          outputs: [
            { id: 'm1', label: 'Mip 1 (1024² · 25%)', color: '#f97316' },
            { id: 'm2', label: 'Mip 2..11 (+8.3%)', color: '#22c55e' },
          ],
          note: '全套缩略图仅 +33.3% 显存',
        },
        {
          id: 'lod_calc',
          title: 'ComputeMipLevel',
          subtitle: 'log2(像素纹素跨度) + Bias',
          category: 'math',
          x: 475,
          y: 42,
          width: 185,
          outputs: [{ id: 'lod', label: 'Continuous LOD', color: '#38bdf8' }],
        },
        {
          id: 'trilinear',
          title: 'Trilinear Sampler',
          subtitle: '相邻两层 Mip 平滑插值',
          category: 'output',
          x: 700,
          y: 78,
          width: 190,
          previewColor: '#22c55e',
          inputs: [
            { id: 'chain', label: 'Mip Chain', color: '#22c55e' },
            { id: 'lod_in', label: 'LOD', color: '#38bdf8' },
          ],
          outputs: [{ id: 'clean', label: '过滤后像素', color: '#e5e7eb' }],
          note: '远景读小图，高速不闪',
        },
      ],
      edges: [
        { fromNode: 'pow2_src', fromPin: 'mip0', toNode: 'mip_gen', toPin: 'src', color: '#ef4444' },
        { fromNode: 'mip_gen', fromPin: 'm2', toNode: 'trilinear', toPin: 'chain', color: '#22c55e' },
        { fromNode: 'lod_calc', fromPin: 'lod', toNode: 'trilinear', toPin: 'lod_in', color: '#38bdf8' },
      ],
    },
    StageComponent: Stage5_3_MipmapMoire,
  },
];

/* ============================================================================
 * LESSON 6.1 STAGE: 卷筒纸 PNG 流式解压 vs BC 4×4 独立快递柜寻址赛 + 显存账本
 * ========================================================================== */

type TexResOption = '1024' | '2048' | '4096';
type BcTierOption = 'bc1' | 'bc7' | 'rgba8';

const Stage6_1_PngVsBcBlock: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const GRID_BLOCKS = 12; // 12x12 visual lockers representing the full 2K/4K block matrix
  const [targetBlock, setTargetBlock] = useState<[number, number]>([8, 7]);
  const [pngScanIndex, setPngScanIndex] = useState<number>(7 * GRID_BLOCKS + 8);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [resOption, setResOption] = useState<TexResOption>('2048');
  const [bcTier, setBcTier] = useState<BcTierOption>('bc1');
  const [withMips, setWithMips] = useState<boolean>(true);

  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const onKpiRef = useRef(onKpiUpdate);
  onKpiRef.current = onKpiUpdate;

  useEffect(() => {
    if (resetSignal > 0) {
      setTargetBlock([8, 7]);
      setPngScanIndex(7 * GRID_BLOCKS + 8);
      setIsScanning(false);
      setResOption('2048');
      setBcTier('bc1');
      setWithMips(true);
    }
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 4) {
      setBcTier('rgba8');
    } else if (stepIndex === 2 || stepIndex === 3) {
      setBcTier('bc1');
    }
  }, [stepIndex, resetSignal]);

  const targetFlatIdx = targetBlock[1] * GRID_BLOCKS + targetBlock[0];

  // Trigger sequential PNG scan animation whenever user clicks a new block
  const triggerLookup = (bx: number, by: number) => {
    setTargetBlock([bx, by]);
    setPngScanIndex(0);
    setIsScanning(true);
  };

  useEffect(() => {
    if (!isScanning) return;
    let rafId = 0;
    let accum = 0;
    let last = performance.now();
    const speedBlocksPerSec = 95; // Takes ~1.2s to reach bottom-right block

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      accum += dt * speedBlocksPerSec;
      const advance = Math.floor(accum);
      if (advance > 0) {
        accum -= advance;
        setPngScanIndex((prev) => {
          const next = prev + advance;
          if (next >= targetFlatIdx) {
            setIsScanning(false);
            return targetFlatIdx;
          }
          return next;
        });
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [isScanning, targetFlatIdx]);

  // VRAM math
  const resNum = parseInt(resOption, 10);
  const mipFactor = withMips ? 4 / 3 : 1.0;
  const rawRgbaMB = ((resNum * resNum * 4) / (1024 * 1024)) * mipFactor;
  const bc1MB = ((resNum * resNum * 0.5) / (1024 * 1024)) * mipFactor;
  const bc7MB = ((resNum * resNum * 1.0) / (1024 * 1024)) * mipFactor;
  const activeVramMB = bcTier === 'bc1' ? bc1MB : bcTier === 'bc7' ? bc7MB : rawRgbaMB;
  const diskPngMB = resOption === '1024' ? 0.46 : resOption === '2048' ? 1.8 : 6.9;

  const realBlocksPerSide = resNum / 4;
  const realBx = Math.floor(((targetBlock[0] + 0.5) / GRID_BLOCKS) * realBlocksPerSide);
  const realBy = Math.floor(((targetBlock[1] + 0.5) / GRID_BLOCKS) * realBlocksPerSide);
  const realBlockId = realBy * realBlocksPerSide + realBx;
  const seqPixelsForced = Math.round(
    ((targetFlatIdx + 1) / (GRID_BLOCKS * GRID_BLOCKS)) * resNum * resNum
  );

  useEffect(() => {
    const savedPct = ((1 - activeVramMB / rawRgbaMB) * 100).toFixed(1);
    onKpiRef.current([
      {
        label: '假设的 PNG 磁盘体积',
        value: `${diskPngMB.toFixed(2)} MB`,
        sub: '流式连坐压缩，GPU 无法直读',
        tone: 'neutral',
      },
      {
        label: 'RGBA8 纹理数据估算',
        value: `${rawRgbaMB.toFixed(2)} MiB`,
        sub: `${resOption}² RGBA8 ${withMips ? '+ 33% Mips' : ''}`,
        tone: 'warn',
      },
      {
        label: '当前格式理论数据量',
        value: `${activeVramMB.toFixed(2)} MiB`,
        sub: bcTier === 'rgba8' ? '⚠️ 未压缩裸奔暴涨!' : `立省 ${savedPct}% · 一步寻址`,
        tone: bcTier === 'rgba8' ? 'bad' : 'good',
      },
    ]);
  }, [resOption, bcTier, withMips, diskPngMB, rawRgbaMB, activeVramMB]);

  // Draw 12x12 Block Matrix Canvas (each cell shows 4x4 texels of an ornate emblem)
  useEffect(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const cellPx = W / GRID_BLOCKS;
    const subPx = cellPx / 4;

    for (let by = 0; by < GRID_BLOCKS; by++) {
      for (let bx = 0; bx < GRID_BLOCKS; bx++) {
        const flat = by * GRID_BLOCKS + bx;
        // Draw 4x4 texels inside locker
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 4; sx++) {
            const gx = (bx * 4 + sx) / (GRID_BLOCKS * 4);
            const gy = (by * 4 + sy) / (GRID_BLOCKS * 4);
            const dx = gx - 0.5;
            const dy = gy - 0.5;
            const r = Math.hypot(dx, dy);
            const angle = Math.atan2(dy, dx);
            const sunRay = Math.cos(angle * 8) * 0.5 + 0.5;

            let col: Vec3 = [0.22, 0.25, 0.31]; // Slate stone background
            if (r < 0.16) {
              col = [0.96, 0.78, 0.24]; // Golden core
            } else if (r < 0.34) {
              col = sunRay > 0.48 ? [0.88, 0.56, 0.18] : [0.16, 0.45, 0.64]; // Sunburst & turquoise inlay
            } else if (r < 0.43) {
              col = [0.76, 0.71, 0.61]; // Carved stone ring
            }

            ctx.fillStyle = rgbToCss(col);
            ctx.fillRect(
              bx * cellPx + sx * subPx,
              by * cellPx + sy * subPx,
              Math.ceil(subPx),
              Math.ceil(subPx)
            );
          }
        }

        // Overlay PNG sequential scan trail
        if (flat < pngScanIndex) {
          ctx.fillStyle = isScanning ? 'rgba(245, 158, 11, 0.30)' : 'rgba(245, 158, 11, 0.14)';
          ctx.fillRect(bx * cellPx, by * cellPx, cellPx, cellPx);
        } else if (flat === pngScanIndex && isScanning) {
          ctx.fillStyle = 'rgba(251, 191, 36, 0.78)';
          ctx.fillRect(bx * cellPx, by * cellPx, cellPx, cellPx);
        }

        // Locker grid border
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.42)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx * cellPx, by * cellPx, cellPx, cellPx);
      }
    }

    // Highlight target 4x4 BC locker in vivid emerald green!
    const tx = targetBlock[0] * cellPx;
    const ty = targetBlock[1] * cellPx;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(tx + 1, ty + 1, cellPx - 2, cellPx - 2);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    ctx.strokeRect(tx - 0.5, ty - 0.5, cellPx + 1, cellPx + 1);
  }, [targetBlock, pngScanIndex, isScanning, isDark]);

  const pngPct = Math.round(((pngScanIndex + 1) / (targetFlatIdx + 1)) * 100);
  const maxBarMB = Math.max(25, rawRgbaMB);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Interactive Click-to-Fetch Arena + Dual Race Lanes */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '196px minmax(0, 1fr)',
          gap: 10,
          alignItems: 'stretch',
        }}
      >
        {/* Clickable 4x4 Locker Texture */}
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1.5px solid var(--border-soft)',
            borderRadius: 11,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700 }}>👆 点击任意位置点名查色</div>
          <canvas
            ref={gridCanvasRef}
            width={180}
            height={180}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const bx = clamp(
                Math.floor(((e.clientX - rect.left) / rect.width) * GRID_BLOCKS),
                0,
                GRID_BLOCKS - 1
              );
              const by = clamp(
                Math.floor(((e.clientY - rect.top) / rect.height) * GRID_BLOCKS),
                0,
                GRID_BLOCKS - 1
              );
              triggerLookup(bx, by);
            }}
            style={{
              width: 176,
              height: 176,
              borderRadius: 8,
              border: '1.5px solid var(--border-strong)',
              cursor: 'pointer',
            }}
          />
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'center' }}>
            每个小格 = 1 个独立 <code>4×4</code> 快递柜
          </div>
        </div>

        {/* Right: Dual Racing Lanes + Live VRAM Bar Chart */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Race Card */}
          <div
            style={{
              background: 'var(--bg-panel)',
              border: '1.5px solid var(--border-soft)',
              borderRadius: 11,
              padding: '9px 11px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
              <span>🏁 随机点选寻址慢放赛（目标柜号 #{realBlockId.toLocaleString()}）</span>
              <button
                type="button"
                className="brutal-btn"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => triggerLookup(targetBlock[0], targetBlock[1])}
              >
                🔄 重放寻址赛
              </button>
            </div>

            {/* Lane 1: PNG Stream */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                <span>📜 <strong>PNG 卷筒纸流式解压</strong>（被迫从 (0,0) 排队拆包）</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#d97706', fontWeight: 700 }}>
                  {isScanning
                    ? `排队中 ${pngPct}%…`
                    : `连坐解压 ${seqPixelsForced.toLocaleString()} 像素 ❌`}
                </span>
              </div>
              <div
                style={{
                  height: 10,
                  borderRadius: 999,
                  background: 'var(--bg-subtle)',
                  overflow: 'hidden',
                  border: '1px solid var(--border-soft)',
                }}
              >
                <div
                  style={{
                    width: `${clamp(pngPct, 2, 100)}%`,
                    height: '100%',
                    background: '#f59e0b',
                    transition: isScanning ? 'none' : 'width 0.15s',
                  }}
                />
              </div>
            </div>

            {/* Lane 2: BC 4x4 Locker */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                <span>📦 <strong>BC 4×4 独立快递柜</strong>（算门牌号一步开锁）</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#16a34a', fontWeight: 700 }}>
                  {bcTier === 'rgba8' ? 'RGBA8：每纹素 4 B，可直接寻址' : `固定块：每 4×4 块 ${bcTier === 'bc1' ? 8 : 16} B`}
                </span>
              </div>
              <div
                style={{
                  height: 10,
                  borderRadius: 999,
                  background: 'var(--bg-subtle)',
                  overflow: 'hidden',
                  border: '1px solid var(--border-soft)',
                }}
              >
                <div style={{ width: '100%', height: '100%', background: '#22c55e' }} />
              </div>
            </div>
          </div>

          {/* Live VRAM Bar Chart */}
          <div
            style={{
              background: 'var(--bg-panel)',
              border: '1.5px solid var(--border-soft)',
              borderRadius: 11,
              padding: '9px 11px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700 }}>
              📊 硬盘体积 vs 显卡显存账单（{resOption}×{resOption} {withMips ? '含 +33% Mipmap' : '无 Mipmap'}）
            </div>

            {/* Bar 1: Disk PNG */}
            <div style={{ display: 'grid', gridTemplateColumns: '138px 1fr 68px', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
              <span>💾 硬盘 PNG (仅存档)</span>
              <div style={{ height: 11, background: 'var(--bg-subtle)', borderRadius: 6, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${clamp((diskPngMB / maxBarMB) * 100, 3, 100)}%`,
                    height: '100%',
                    background: '#64748b',
                  }}
                />
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, textAlign: 'right' }}>
                {diskPngMB.toFixed(2)} MB
              </span>
            </div>

            {/* Bar 2: Uncompressed RGBA8 */}
            <div style={{ display: 'grid', gridTemplateColumns: '138px 1fr 68px', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
              <span>🔥 未压缩 RGBA8</span>
              <div style={{ height: 11, background: 'var(--bg-subtle)', borderRadius: 6, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${clamp((rawRgbaMB / maxBarMB) * 100, 4, 100)}%`,
                    height: '100%',
                    background: '#ef4444',
                  }}
                />
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ef4444', textAlign: 'right' }}>
                {rawRgbaMB.toFixed(2)} MiB
              </span>
            </div>

            {/* Bar 3: BC1 Compressed */}
            <div style={{ display: 'grid', gridTemplateColumns: '138px 1fr 68px', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
              <span>✅ {bcTier === 'bc7' ? 'BC7（16 B/块）' : bcTier === 'bc1' ? 'BC1（8 B/块）' : 'RGBA8（未压缩）'}</span>
              <div style={{ height: 11, background: 'var(--bg-subtle)', borderRadius: 6, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${clamp((activeVramMB / maxBarMB) * 100, 3, 100)}%`,
                    height: '100%',
                    background: '#22c55e',
                  }}
                />
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#16a34a', textAlign: 'right' }}>
                {activeVramMB.toFixed(2)} MiB
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Pitfall Bar */}
      <PitfallCompareBar
        isPitfall={bcTier === 'rgba8'}
        pitfallLabel={`手滑误选 UserInterface2D 未压缩：一张 ${resOption} 图狂吞 ${rawRgbaMB.toFixed(2)} MiB 显存！`}
        correctLabel={`标准 Default (BC1) 块压缩：仅占 ${bc1MB.toFixed(2)} MB 显存（立省 87.5%）且一步寻址`}
        onToggle={(pitfall) => setBcTier(pitfall ? 'rgba8' : 'bc1')}
      />

      {/* Bottom Controls */}
      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSegmented<TexResOption>
            label="贴图分辨率"
            value={resOption}
            onChange={setResOption}
            options={[
              { value: '1024', label: '1K (1024²)' },
              { value: '2048', label: '2K (2048²)' },
              { value: '4096', label: '4K (4096²)' },
            ]}
          />
          <StageSegmented<BcTierOption>
            label="显卡存储规格"
            value={bcTier}
            onChange={setBcTier}
            options={[
              { value: 'bc1', label: 'BC1 (8B/格)' },
              { value: 'bc7', label: 'BC7 (16B/格)' },
              { value: 'rgba8', label: '未压缩 (64B/格)' },
            ]}
          />
          <StageToggle
            label="计入 +33.3% Mipmap"
            checked={withMips}
            onChange={setWithMips}
          />
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * LESSON 6.2 STAGE: 32× 4×4 纹素块显微镜 —— BC1 ~ BC7 压缩伪影与端点调色盘拆解
 * ========================================================================== */

type TestPatchType = 'flower' | 'normal' | 'mask';
type BcFormatType = 'rgba8' | 'bc1' | 'bc4' | 'bc5' | 'bc7';

interface BlockDecodeInfo {
  compressedPixels: Vec3[]; // 16 compressed RGB pixels
  indices: number[];        // 16 palette index labels
  greenIndices?: number[];
  subsets?: number[];       // 0 or 1 for BC7 dual-subset partition
  paletteA: Vec3[];         // Primary interpolated palette (4 or 8 entries)
  paletteB?: Vec3[];        // Secondary palette (G channel for BC5, or Subset B for BC7)
  endpointLabels: [string, string];
  maxErrorPct: number;
}

function quant565(c: Vec3): Vec3 {
  return [
    Math.round(saturate(c[0]) * 31) / 31,
    Math.round(saturate(c[1]) * 63) / 63,
    Math.round(saturate(c[2]) * 31) / 31,
  ];
}

function encodeDecodeBlock4x4(
  orig16: Vec3[],
  fmt: BcFormatType,
  patchType: TestPatchType
): BlockDecodeInfo {
  if (fmt === 'rgba8') {
    return {
      compressedPixels: orig16.map((p) => [...p] as Vec3),
      indices: orig16.map((_, i) => i),
      paletteA: [orig16[0], orig16[5], orig16[10], orig16[15]],
      endpointLabels: ['无损 8-bit 原始值', '每纹素独立 4 字节 (共 64B)'],
      maxErrorPct: 0,
    };
  }

  if (fmt === 'bc4') {
    // Single R channel (or luminance on mask) 8-step interpolation
    let minR = 1;
    let maxR = 0;
    for (const p of orig16) {
      if (p[0] < minR) minR = p[0];
      if (p[0] > maxR) maxR = p[0];
    }
    minR = Math.round(minR * 255) / 255;
    maxR = Math.round(maxR * 255) / 255;
    const ramp: Vec3[] = Array.from({ length: 8 }, (_, k) => {
      const v = lerp(maxR, minR, k / 7);
      return [v, v, v];
    });
    const compressedPixels: Vec3[] = [];
    const indices: number[] = [];
    let maxErr = 0;
    for (const p of orig16) {
      let bestK = 0;
      let bestDist = 1e9;
      for (let k = 0; k < 8; k++) {
        const d = Math.abs(p[0] - ramp[k][0]);
        if (d < bestDist) {
          bestDist = d;
          bestK = k;
        }
      }
      indices.push(bestK);
      compressedPixels.push(ramp[bestK]);
      const err =
        patchType === 'mask'
          ? Math.abs(p[0] - ramp[bestK][0])
          : Math.hypot(p[0] - ramp[bestK][0], p[1] - ramp[bestK][1], p[2] - ramp[bestK][2]) / Math.sqrt(3);
      if (err > maxErr) maxErr = err;
    }
    return {
      compressedPixels,
      indices,
      paletteA: ramp,
      endpointLabels: [`R0 = ${(maxR * 255).toFixed(0)}`, `R1 = ${(minR * 255).toFixed(0)}`],
      maxErrorPct: maxErr * 100,
    };
  }

  if (fmt === 'bc5') {
    // Dual independent 8-step channels (R and G completely decoupled!), Z reconstructed on normal map
    let minR = 1,
      maxR = 0,
      minG = 1,
      maxG = 0;
    for (const p of orig16) {
      if (p[0] < minR) minR = p[0];
      if (p[0] > maxR) maxR = p[0];
      if (p[1] < minG) minG = p[1];
      if (p[1] > maxG) maxG = p[1];
    }
    minR = Math.round(minR * 255) / 255;
    maxR = Math.round(maxR * 255) / 255;
    minG = Math.round(minG * 255) / 255;
    maxG = Math.round(maxG * 255) / 255;
    const rampR: Vec3[] = Array.from({ length: 8 }, (_, k) => [lerp(maxR, minR, k / 7), 0.12, 0.12]);
    const rampG: Vec3[] = Array.from({ length: 8 }, (_, k) => [0.12, lerp(maxG, minG, k / 7), 0.12]);

    const compressedPixels: Vec3[] = [];
    const indices: number[] = [];
    const greenIndices: number[] = [];
    let maxErr = 0;
    for (const p of orig16) {
      let bestR = 0,
        distR = 1e9;
      let bestG = 0,
        distG = 1e9;
      for (let k = 0; k < 8; k++) {
        const dr = Math.abs(p[0] - rampR[k][0]);
        if (dr < distR) {
          distR = dr;
          bestR = k;
        }
        const dg = Math.abs(p[1] - rampG[k][1]);
        if (dg < distG) {
          distG = dg;
          bestG = k;
        }
      }
      const rVal = rampR[bestR][0];
      const gVal = rampG[bestG][1];
      let bVal = 0;
      if (patchType === 'normal') {
        const nx = rVal * 2 - 1;
        const ny = gVal * 2 - 1;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        bVal = nz * 0.5 + 0.5;
      } else if (patchType === 'mask') {
        bVal = rVal;
      }
      const out: Vec3 = patchType === 'mask' ? [rVal, rVal, rVal] : [rVal, gVal, bVal];
      compressedPixels.push(out);
      indices.push(bestR);
      greenIndices.push(bestG);
      const err = Math.hypot(p[0] - out[0], p[1] - out[1], p[2] - out[2]) / Math.sqrt(3);
      if (err > maxErr) maxErr = err;
    }
    return {
      compressedPixels,
      indices,
      greenIndices,
      paletteA: rampR,
      paletteB: rampG,
      endpointLabels: [
        `红通道独立 8 阶 [${(minR * 255).toFixed(0)}..${(maxR * 255).toFixed(0)}]`,
        `绿通道独立 8 阶 [${(minG * 255).toFixed(0)}..${(maxG * 255).toFixed(0)}]`,
      ],
      maxErrorPct: maxErr * 100,
    };
  }

  // Helper to fit a single 4-color linear palette to a subset of pixels
  const fitLine4 = (pts: Vec3[], use565: boolean): Vec3[] => {
    if (pts.length === 0) return [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    // Find farthest pair among subset to capture true principal diagonal (e.g. Red <-> Green!)
    let pA = pts[0];
    let pB = pts[pts.length - 1];
    let maxD = -1;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d =
          (pts[i][0] - pts[j][0]) ** 2 +
          (pts[i][1] - pts[j][1]) ** 2 +
          (pts[i][2] - pts[j][2]) ** 2;
        if (d > maxD) {
          maxD = d;
          pA = pts[i];
          pB = pts[j];
        }
      }
    }
    const c0 = use565 ? quant565(pA) : pA;
    const c1 = use565 ? quant565(pB) : pB;
    return [c0, lerp3(c0, c1, 1 / 3), lerp3(c0, c1, 2 / 3), c1];
  };

  if (fmt === 'bc1') {
    const pal = fitLine4(orig16, true);
    const compressedPixels: Vec3[] = [];
    const indices: number[] = [];
    let maxErr = 0;
    for (const p of orig16) {
      let bestK = 0;
      let bestD = 1e9;
      for (let k = 0; k < 4; k++) {
        const d =
          (p[0] - pal[k][0]) ** 2 + (p[1] - pal[k][1]) ** 2 + (p[2] - pal[k][2]) ** 2;
        if (d < bestD) {
          bestD = d;
          bestK = k;
        }
      }
      indices.push(bestK);
      compressedPixels.push(pal[bestK]);
      const err = Math.sqrt(bestD) / Math.sqrt(3);
      if (err > maxErr) maxErr = err;
    }
    return {
      compressedPixels,
      indices,
      paletteA: pal,
      endpointLabels: [`端点 C0 (${rgbToHex(pal[0])})`, `端点 C1 (${rgbToHex(pal[3])})`],
      maxErrorPct: maxErr * 100,
    };
  }

  // A fixed vertical two-subset layout illustrates palette sharing. This does not pack a BC7 bitstream.
  const subsets = orig16.map((_, i) => i % 4 < 2 ? 0 : 1);
  const groupA = orig16.filter((_, i) => subsets[i] === 0);
  const groupB = orig16.filter((_, i) => subsets[i] === 1);
  const palA = fitLine4(groupA, false);
  const palB = fitLine4(groupB, false);
  const compressedPixels: Vec3[] = [];
  const indices: number[] = [];
  let maxErr = 0;
  for (let i = 0; i < 16; i++) {
    const p = orig16[i];
    const pal = subsets[i] === 0 ? palA : palB;
    let bestK = 0;
    let bestD = 1e9;
    for (let k = 0; k < 4; k++) {
      const d = (p[0] - pal[k][0]) ** 2 + (p[1] - pal[k][1]) ** 2 + (p[2] - pal[k][2]) ** 2;
      if (d < bestD) {
        bestD = d;
        bestK = k;
      }
    }
    indices.push(bestK);
    compressedPixels.push(pal[bestK]);
    const err = Math.sqrt(bestD) / Math.sqrt(3);
    if (err > maxErr) maxErr = err;
  }

  return {
    compressedPixels,
    indices,
    subsets,
    paletteA: palA,
    paletteB: palB,
    endpointLabels: ['分区 A 独立 4 色线', '分区 B 独立 4 色线'],
    maxErrorPct: maxErr * 100,
  };
}

const Stage6_2_BcMicroscope: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [patchType, setPatchType] = useState<TestPatchType>('flower');
  const [bcFormat, setBcFormat] = useState<BcFormatType>('bc1');
  const [selectedBlock, setSelectedBlock] = useState<[number, number]>([7, 7]);
  const [showIndices, setShowIndices] = useState<boolean>(true);

  const fullCanvasRef = useRef<HTMLCanvasElement>(null);
  const onKpiRef = useRef(onKpiUpdate);
  onKpiRef.current = onKpiUpdate;

  useEffect(() => {
    if (resetSignal > 0) {
      setPatchType('flower');
      setBcFormat('bc1');
      setSelectedBlock([7, 7]);
      setShowIndices(true);
    }
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 0 || stepIndex === 1) {
      setPatchType('flower');
      setBcFormat('bc1');
      setSelectedBlock([7, 7]);
    } else if (stepIndex === 2) {
      setPatchType('flower');
      setBcFormat('bc7');
    } else if (stepIndex === 4) {
      setPatchType('normal');
      setBcFormat('bc1');
      setSelectedBlock([6, 6]);
    }
  }, [stepIndex, resetSignal]);

  // Precompute 64x64 source patches (16x16 blocks)
  const sourcePatch = useMemo(() => {
    const N = 64;
    const pixels: Vec3[] = new Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = x / (N - 1);
        const v = y / (N - 1);
        if (patchType === 'flower') {
          // Vivid crimson flower petal overlapping emerald leaf + dark core right through center [7,7]
          const dx = u - 0.38;
          const dy = v - 0.42;
          const distCore = Math.hypot(dx + 0.08, dy + 0.08);
          const angle = Math.atan2(dy, dx);
          const petalR = 0.33 + 0.1 * Math.cos(angle * 5);
          const r = Math.hypot(dx, dy);

          if (distCore < 0.11) {
            pixels[y * N + x] = [0.09, 0.06, 0.08]; // Deep dark stamen core
          } else if (r < petalR) {
            const shade = saturate(0.75 + 0.25 * Math.sin(r * 22));
            pixels[y * N + x] = [0.96 * shade, 0.13 * shade, 0.2 * shade]; // Vivid crimson petal
          } else {
            const vein = Math.abs(Math.sin((u + v) * 18)) * 0.12;
            pixels[y * N + x] = [0.11 + vein * 0.4, 0.8 + vein, 0.24 + vein * 0.3]; // Lush emerald leaf
          }
        } else if (patchType === 'normal') {
          // Smooth spherical dome + concentric wave normal map (orthogonal X & Y gradients!)
          const dx = (u - 0.5) * 1.75;
          const dy = (v - 0.5) * 1.75;
          const r = Math.hypot(dx, dy);
          let nx = 0;
          let ny = 0;
          if (r < 0.85) {
            const ripple = Math.cos(r * 13) * 0.24;
            nx = clamp(dx * 0.78 + (dx / (r + 0.01)) * ripple, -0.92, 0.92);
            ny = clamp(dy * 0.78 + (dy / (r + 0.01)) * ripple, -0.92, 0.92);
          }
          const nz = Math.sqrt(Math.max(0.02, 1 - nx * nx - ny * ny));
          pixels[y * N + x] = [nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5];
        } else {
          // Smooth single-channel radial spotlight mask
          const r = Math.hypot(u - 0.5, v - 0.5) * 1.45;
          const val = smoothstep(1.0, 0.06, r);
          pixels[y * N + x] = [val, val, val];
        }
      }
    }
    return pixels.map(p => p.map(c => Math.round(saturate(c) * 255) / 255) as Vec3);
  }, [patchType]);

  // Compress all 16x16 blocks of the 64x64 patch
  const compressedData = useMemo(() => {
    const N = 64;
    const outPixels: Vec3[] = new Array(N * N);
    const blockMap: BlockDecodeInfo[][] = Array.from({ length: 16 }, () => []);

    for (let by = 0; by < 16; by++) {
      for (let bx = 0; bx < 16; bx++) {
        const blk: Vec3[] = [];
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 4; sx++) {
            blk.push(sourcePatch[(by * 4 + sy) * N + (bx * 4 + sx)]);
          }
        }
        const info = encodeDecodeBlock4x4(blk, bcFormat, patchType);
        blockMap[by][bx] = info;
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 4; sx++) {
            outPixels[(by * 4 + sy) * N + (bx * 4 + sx)] = info.compressedPixels[sy * 4 + sx];
          }
        }
      }
    }
    return { outPixels, blockMap };
  }, [sourcePatch, bcFormat, patchType]);

  const activeInfo = compressedData.blockMap[selectedBlock[1]][selectedBlock[0]];
  const origBlock16 = useMemo(() => {
    const arr: Vec3[] = [];
    const [bx, by] = selectedBlock;
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 4; sx++) {
        arr.push(sourcePatch[(by * 4 + sy) * 64 + (bx * 4 + sx)]);
      }
    }
    return arr;
  }, [sourcePatch, selectedBlock]);

  const bytesPerBlock =
    bcFormat === 'rgba8' ? 64 : bcFormat === 'bc1' || bcFormat === 'bc4' ? 8 : 16;
  const vram2kMB = ((512 * 512 * bytesPerBlock) / (1024 * 1024)) * (4 / 3);

  useEffect(() => {
    onKpiRef.current([
      {
        label: '4×4 快递柜体积',
        value: `${bytesPerBlock} Bytes / 格`,
        sub: `2K 含 Mip 占 ${vram2kMB.toFixed(2)} MiB`,
        tone: bytesPerBlock <= 16 ? 'accent' : 'warn',
      },
      {
        label: '当前格示意偏差',
        value: `${activeInfo.maxErrorPct.toFixed(1)}%`,
        sub: '本示意块最大 RGB 距离 / √3，非格式质量评分',
        tone: 'neutral',
      },
    ]);
  }, [patchType, bcFormat, bytesPerBlock, vram2kMB, activeInfo.maxErrorPct]);

  // Draw Left 64x64 Full Patch (and lit specular half-strip if normal map!)
  useEffect(() => {
    const canvas = fullCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const S = 3; // 64 * 3 = 192px
    const N = 64;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const lightDir = norm3([0.45, -0.45, 0.77]);
    const viewDir: Vec3 = [0, 0, 1];

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let c = compressedData.outPixels[y * N + x];
        // On normal map patch, show bottom 40% as real-time glossy lit preview so user sees blocky specular!
        if (patchType === 'normal' && y >= 38) {
          const nVec = norm3([c[0] * 2 - 1, -(c[1] * 2 - 1), c[2] * 2 - 1]);
          c = shadePbrPixel({
            N: nVec,
            V: viewDir,
            L: lightDir,
            baseColorLinear: [0.24, 0.27, 0.32],
            metallic: 0.75,
            roughness: 0.18,
            envMode: 'studio',
          });
        }
        ctx.fillStyle = rgbToCss(c);
        ctx.fillRect(x * S, y * S, S, S);
      }
    }

    if (patchType === 'normal') {
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 38 * S);
      ctx.lineTo(192, 38 * S);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.68)';
      ctx.fillRect(4, 38 * S + 3, 118, 15);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('✨ 法线打灯示意区', 8, 38 * S + 14);
    }

    // Draw yellow 4x4 microscope selector frame
    const [bx, by] = selectedBlock;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3.2;
    ctx.strokeRect(bx * 4 * S, by * 4 * S, 4 * S, 4 * S);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx * 4 * S, by * 4 * S, 4 * S, 4 * S);
  }, [compressedData, patchType, selectedBlock]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p>块机制示意。编号按色阶从端点到端点排列。BC1 拟合共享色线，BC4/5 独立拟合通道，BC7 示例只用固定左右分区与四级调色盘。没有生成 BC7 位流；实际质量请在同一素材与目标平台上解码比较。</p>
      {/* Top Sample & Format Selectors */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
        <StageSegmented<TestPatchType>
          label="① 选择棘手测试样本"
          value={patchType}
          onChange={(p) => {
            setPatchType(p);
            setSelectedBlock(p === 'flower' ? [7, 7] : [6, 6]);
          }}
          options={[
            { value: 'flower', label: '🌺 红花配绿叶斜边' },
            { value: 'normal', label: '🫧 细腻法线曲面' },
            { value: 'mask', label: '🌓 单通道柔光遮罩' },
          ]}
        />
        <StageSegmented<BcFormatType>
          label="② 切换 UE 5.8 压缩格式"
          value={bcFormat}
          onChange={setBcFormat}
          options={[
            { value: 'rgba8', label: '未压缩' },
            { value: 'bc1', label: 'BC1 (Default)' },
            { value: 'bc4', label: 'BC4 (灰度)' },
            { value: 'bc5', label: 'BC5 (法线)' },
            { value: 'bc7', label: 'BC7 分区示意' },
          ]}
        />
      </div>

      {/* 3-Column Microscope Workbench */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '204px minmax(0, 1fr)',
          gap: 10,
          alignItems: 'stretch',
        }}
      >
        {/* Left: 64x64 Patch with movable 4x4 yellow box */}
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1.5px solid var(--border-soft)',
            borderRadius: 11,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700 }}>🔍 点击移动 4×4 显微镜框</div>
          <canvas
            ref={fullCanvasRef}
            width={192}
            height={192}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const bx = clamp(Math.floor(((e.clientX - rect.left) / rect.width) * 16), 0, 15);
              const by = clamp(Math.floor(((e.clientY - rect.top) / rect.height) * 16), 0, 15);
              setSelectedBlock([bx, by]);
            }}
            style={{
              width: 186,
              height: 186,
              borderRadius: 8,
              border: '1.5px solid var(--border-strong)',
              cursor: 'crosshair',
              imageRendering: 'pixelated',
            }}
          />
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'center' }}>
            当前选中快递格: <code>Block [{selectedBlock[0]}, {selectedBlock[1]}]</code>
          </div>
        </div>

        {/* Right: 32x Zoomed 4x4 Grid Comparison + Endpoint Palette Decoder */}
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1.5px solid var(--border-soft)',
            borderRadius: 11,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 9,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800 }}>
              🔬 32× 放大对比：原图 16 纹素 vs {bcFormat.toUpperCase()} 机制示意
            </span>
            <StageToggle
              label={bcFormat === 'bc5' ? '显示 R/G 调色盘编号' : '显示调色盘编号'}
              checked={showIndices}
              onChange={setShowIndices}
            />
          </div>

          {/* Dual 4x4 Zoomed Grids */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-around' }}>
            {/* Original 4x4 */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>未压缩原图 (64B)</span>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 29px)',
                  gridTemplateRows: 'repeat(4, 29px)',
                  border: '1.5px solid var(--border-strong)',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                {origBlock16.map((c, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: rgbToCss(c),
                      border: '0.5px solid rgba(0,0,0,0.18)',
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-muted)' }}>➔</div>

            {/* Compressed 4x4 */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>
                {bcFormat.toUpperCase()} 示意结果（格式规格 {bytesPerBlock}B）
              </span>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 29px)',
                  gridTemplateRows: 'repeat(4, 29px)',
                  border: '1.5px solid var(--border-strong)',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                {activeInfo.compressedPixels.map((c, idx) => {
                  const lum = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
                  const subTag = activeInfo.subsets ? (activeInfo.subsets[idx] === 0 ? 'A' : 'B') : '';
                  return (
                    <div
                      key={idx}
                      style={{
                        background: rgbToCss(c),
                        border: '0.5px solid rgba(0,0,0,0.22)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9.5,
                        fontWeight: 800,
                        color: lum > 0.52 ? '#111' : '#fff',
                      }}
                    >
                      {showIndices && bcFormat !== 'rgba8' ? activeInfo.greenIndices ? `${activeInfo.indices[idx]}/${activeInfo.greenIndices[idx]}` : `${subTag}${activeInfo.indices[idx]}` : ''}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Palette Swatches Decoder Box */}
          <div
            style={{
              background: isDark ? '#181614' : '#f3efe6',
              border: '1px solid var(--border-soft)',
              borderRadius: 9,
              padding: '7px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700 }}>
              <span>🎨 快递柜内部存的代表色调色盘：</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                {activeInfo.endpointLabels[0]} · {activeInfo.endpointLabels[1]}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              {activeInfo.paletteA.map((sw, idx) => (
                <div
                  key={idx}
                  style={{
                    flex: 1,
                    height: 20,
                    borderRadius: 5,
                    background: rgbToCss(sw),
                    border:
                      idx === 0 || idx === activeInfo.paletteA.length - 1
                        ? '2px solid var(--border-strong)'
                        : '1px solid rgba(0,0,0,0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9.5,
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 800,
                    color: sw[0] * 0.3 + sw[1] * 0.59 + sw[2] * 0.11 > 0.52 ? '#111' : '#fff',
                  }}
                >
                  {idx === 0 ? '端0' : idx === activeInfo.paletteA.length - 1 ? '端1' : `#${idx}`}
                </div>
              ))}
            </div>

            {activeInfo.paletteB && (
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                {activeInfo.paletteB.map((sw, idx) => (
                  <div
                    key={idx}
                    style={{
                      flex: 1,
                      height: 18,
                      borderRadius: 5,
                      background: rgbToCss(sw),
                      border:
                        idx === 0 || idx === activeInfo.paletteB!.length - 1
                          ? '2px solid var(--border-strong)'
                          : '1px solid rgba(0,0,0,0.25)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      color: sw[0] * 0.3 + sw[1] * 0.59 + sw[2] * 0.11 > 0.52 ? '#111' : '#fff',
                    }}
                  >
                    {bcFormat === 'bc7' ? `B${idx}` : `G${idx}`}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pitfall Bar */}
      <PitfallCompareBar
        isPitfall={patchType === 'normal' && bcFormat === 'bc1'}
        pitfallLabel="法线贴图误用 Default (BC1)：红绿绑在一条直线串色，高光碎成方块麻子！"
        correctLabel="法线专用 Normalmap (BC5) / 鲜艳彩边用 BC7：双通道解耦/多子集分区，分别拟合通道或子集"
        onToggle={(pitfall) => {
          setPatchType('normal');
          setSelectedBlock([6, 6]);
          setBcFormat(pitfall ? 'bc1' : 'bc5');
        }}
      />
    </div>
  );
};

/* ============================================================================
 * LESSON 6.3 STAGE: 法线贴图三合一实验室（小牙签染色 + BC5 勾股算 Z + 翻转绿通道救弹坑）
 * ========================================================================== */

type NormalSubLab = 'toothpick' | 'bc5z' | 'flipgreen';
type ZRebuildMode = 'orig' | 'drop-broken' | 'bc5-rebuild';

const Stage6_3_NormalMapLab: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [subLab, setSubLab] = useState<NormalSubLab>('toothpick');

  // Lab 1 state: draggable tangent normal (nx, ny)
  const [pinXY, setPinXY] = useState<[number, number]>([0.0, 0.0]);

  // Lab 2 state: BC5 drop blue + DeriveNormalZ
  const [zMode, setZMode] = useState<ZRebuildMode>('bc5-rebuild');

  // Lab 3 state: Orbiting light + OpenGL/DirectX green channel flip + accidental sRGB pitfall
  const [lightAngleDeg, setLightAngleDeg] = useState<number>(270); // 270° = straight top-down light!
  const [sourceBaker, setSourceBaker] = useState<'opengl' | 'directx'>('opengl');
  const [flipGreen, setFlipGreen] = useState<boolean>(false);
  const [wrongSrgb, setWrongSrgb] = useState<boolean>(false);

  const zCanvasRef = useRef<HTMLCanvasElement>(null);
  const craterCanvasRef = useRef<HTMLCanvasElement>(null);
  const onKpiRef = useRef(onKpiUpdate);
  onKpiRef.current = onKpiUpdate;

  useEffect(() => {
    if (resetSignal > 0) {
      setSubLab('toothpick');
      setPinXY([0, 0]);
      setZMode('bc5-rebuild');
      setLightAngleDeg(270);
      setSourceBaker('opengl');
      setFlipGreen(false);
      setWrongSrgb(false);
    }
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 0 || stepIndex === 1) {
      setSubLab('toothpick');
    } else if (stepIndex === 2) {
      setSubLab('bc5z');
      setZMode('bc5-rebuild');
    } else if (stepIndex >= 3) {
      setSubLab('flipgreen');
      setSourceBaker('opengl');
      setFlipGreen(stepIndex === 3);
      setWrongSrgb(false);
    }
  }, [stepIndex, resetSignal]);

  // Lab 1 math
  const nx = pinXY[0];
  const ny = pinXY[1];
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const encR = nx * 0.5 + 0.5;
  const encG = ny * 0.5 + 0.5;
  const encB = nz * 0.5 + 0.5;
  const encodedRGB: Vec3 = [encR, encG, encB];
  const encodedHex = rgbToHex(encodedRGB);

  // Lab 3 correctness check: UE 5.8 expects DirectX (Y-). OpenGL (Y+) needs flipGreen = true; DirectX (Y-) needs flipGreen = false.
  const isGreenCorrect =
    (sourceBaker === 'opengl' && flipGreen) || (sourceBaker === 'directx' && !flipGreen);

  useEffect(() => {
    if (subLab === 'toothpick') {
      onKpiRef.current([
        {
          label: '切线空间小牙签',
          value: `(${nx.toFixed(2)}, ${ny.toFixed(2)}, ${nz.toFixed(2)})`,
          sub: '单位长度 √(X²+Y²+Z²) = 1.00',
          tone: 'accent',
        },
        {
          label: '×0.5 + 0.5 编码 RGB',
          value: `(${encR.toFixed(2)}, ${encG.toFixed(2)}, ${encB.toFixed(2)})`,
          sub: `色号 ${encodedHex}`,
          tone: Math.hypot(nx, ny) < 0.05 ? 'good' : 'neutral',
        },
        {
          label: '平坦默认色之谜',
          value: '#8080FF 浅蓝紫',
          sub: '(0,0,1) → (0.5, 0.5, 1.0)',
          tone: 'good',
        },
      ]);
    } else if (subLab === 'bc5z') {
      onKpiRef.current([
        {
          label: '蓝色 B 通道状态',
          value: zMode === 'orig' ? '存盘占用显存' : '🗑️ 已扔掉省空间',
          sub: 'BC5 为 X、Y 分别存储块端点与索引',
          tone: 'accent',
        },
        {
          label: 'Z 轴重建方式',
          value:
            zMode === 'bc5-rebuild'
              ? '√(1 - X² - Y²)'
              : zMode === 'orig'
              ? '直接读 B 通道'
              : '❌ 未重建 (Z=0.12)',
          sub: zMode === 'orig' ? '使用未压缩参考方向' : 'XY 经块端点和索引量化',
          tone: zMode === 'drop-broken' ? 'bad' : 'good',
        },
        {
          label: '法线方向来源',
          value: zMode === 'orig' ? '原始 XYZ' : zMode === 'drop-broken' ? '固定 Z = 0.12' : '量化 XY 的正半球解',
          sub: '重建保留 XY 量化误差',
          tone: zMode === 'drop-broken' ? 'bad' : 'good',
        },
      ]);
    } else {
      onKpiRef.current([
        {
          label: '绿通道朝向匹配',
          value: isGreenCorrect ? '✅ 真凹坑 (DirectX Y-)' : '⚠️ 颠倒成鼓包! (Y+ 反了)',
          sub: isGreenCorrect ? '顶光下：上壁背光暗、下壁迎光亮' : '顶光下：上壁反常发亮像凸包!',
          tone: isGreenCorrect ? 'good' : 'bad',
        },
        {
          label: 'sRGB 勾选检查',
          value: wrongSrgb ? '❌ 误勾 sRGB!' : '✅ 已关 sRGB (Linear)',
          sub: wrongSrgb ? '0.5 解码为 0.2140，平墙法线偏斜' : '0.5 映射为零切线分量',
          tone: wrongSrgb ? 'bad' : 'good',
        },
        {
          label: '太阳照射方位角',
          value: `${lightAngleDeg.toFixed(0)}°`,
          sub: '建议设 270° 正上方顶光验凹凸',
          tone: 'accent',
        },
      ]);
    }
  }, [
    subLab,
    nx,
    ny,
    nz,
    encR,
    encG,
    encB,
    encodedHex,
    zMode,
    isGreenCorrect,
    wrongSrgb,
    lightAngleDeg,
  ]);

  // Procedural stone crater + 4 corner rivets tangent-space normal field (DirectX Y- convention: +X right, +Y down)
  const evalStoneCraterNormalDX = (u: number, v: number): Vec3 => {
    const cx = (u - 0.5) * 2;
    const cy = (v - 0.5) * 2;
    const r = Math.hypot(cx, cy);

    let dHdx = 0;
    let dHdy = 0;

    // Central deep sunken impact crater (radius ~0.62) with raised outer lip (~0.62..0.78)
    if (r > 0.001 && r < 0.62) {
      // Sunken bowl: height increases with r -> inward slope!
      const slope = Math.sin((r / 0.62) * Math.PI) * 1.15;
      dHdx += (cx / r) * slope;
      dHdy += (cy / r) * slope;
    } else if (r >= 0.62 && r < 0.78) {
      // Subtle raised crater rim
      const rimT = (r - 0.62) / 0.16;
      const slope = Math.sin(rimT * Math.PI * 2) * 0.35;
      dHdx -= (cx / r) * slope;
      dHdy -= (cy / r) * slope;
    }

    // 4 raised convex corner rivets (so user can compare sunken crater vs raised rivets simultaneously!)
    const corners: [number, number][] = [
      [-0.74, -0.74],
      [0.74, -0.74],
      [-0.74, 0.74],
      [0.74, 0.74],
    ];
    for (const [rx, ry] of corners) {
      const dx = cx - rx;
      const dy = cy - ry;
      const cr = Math.hypot(dx, dy);
      if (cr > 0.001 && cr < 0.17) {
        // Convex dome: height decreases with cr -> outward slope!
        const slope = -Math.sin((cr / 0.17) * Math.PI * 0.5) * 1.05;
        dHdx += (dx / cr) * slope;
        dHdy += (dy / cr) * slope;
      }
    }

    // Fine stone micro-grain
    const microX = (hash2(Math.floor(u * 96), Math.floor(v * 96)) - 0.5) * 0.08;
    const microY = (hash2(Math.floor(u * 96) + 31, Math.floor(v * 96) + 17) - 0.5) * 0.08;
    return norm3([-dHdx + microX, -dHdy + microY, 1.0]);
  };

  // Render Lab 2 Canvas (BC5 Z-Reconstruction comparison)
  useEffect(() => {
    if (subLab !== 'bc5z') return;
    const canvas = zCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const img = ctx.createImageData(W, H);
    const data = img.data;

    const L = norm3([0.38, 0.52, 0.76]); // Warm top-right light (Y+ up in shading space)
    const V: Vec3 = [0, 0, 1];

    const compressedNormals: Vec3[] = new Array(W * H);
    if (zMode !== 'orig') {
      for (let by = 0; by < H; by += 4) {
        for (let bx = 0; bx < W; bx += 4) {
          const block = Array.from({ length: 16 }, (_, i) => {
            const n = evalStoneCraterNormalDX((bx + i % 4) / W, (by + Math.floor(i / 4)) / H);
            return n.map(v => v * 0.5 + 0.5) as Vec3;
          });
          const decoded = encodeDecodeBlock4x4(block, 'bc5', 'normal').compressedPixels;
          decoded.forEach((p, i) => { compressedNormals[(by + Math.floor(i / 4)) * W + bx + i % 4] = p; });
        }
      }
    }
    for (let py = 0; py < H; py++) {
      const v = py / H;
      for (let px = 0; px < W; px++) {
        const u = px / W;
        const nDX = zMode === 'orig' ? evalStoneCraterNormalDX(u, v)
          : compressedNormals[py * W + px].map(c => c * 2 - 1) as Vec3;
        const sx = nDX[0];
        const sy = -nDX[1];
        const szOrig = nDX[2];

        let finalN: Vec3;
        if (zMode === 'orig') {
          finalN = [sx, sy, szOrig];
        } else if (zMode === 'drop-broken') {
          // Dropped blue channel without reconstructing Z -> Z collapses near 0!
          finalN = norm3([sx, sy, 0.12]);
        } else {
          // BC5 DeriveNormalZ Pythagorean reconstruction: sqrt(1 - X^2 - Y^2)
          const rebuiltZ = Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy));
          finalN = [sx, sy, rebuiltZ];
        }

        const col = shadePbrPixel({
          N: finalN,
          V,
          L,
          baseColorLinear: [0.36, 0.34, 0.31],
          metallic: 0.15,
          roughness: 0.34,
          envMode: 'studio',
        });

        const idx = (py * W + px) * 4;
        data[idx] = Math.round(col[0] * 255);
        data[idx + 1] = Math.round(col[1] * 255);
        data[idx + 2] = Math.round(col[2] * 255);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [subLab, zMode]);

  // Render Lab 3 Canvas (Orbiting Light + Flip Green Channel + Wrong sRGB Pitfall)
  useEffect(() => {
    if (subLab !== 'flipgreen') return;
    const canvas = craterCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const img = ctx.createImageData(W, H);
    const data = img.data;

    // Light angle in screen coordinates: 270° = top (0, -1 in screen -> +Y in shading), 0° = right (+X)
    const rad = (lightAngleDeg * Math.PI) / 180;
    const lx = Math.cos(rad) * 0.76;
    const lyScreen = Math.sin(rad) * 0.76;
    const L = norm3([lx, -lyScreen, 0.65]); // Shading space: +X right, +Y up, +Z out
    const V: Vec3 = [0, 0, 1];

    for (let py = 0; py < H; py++) {
      const v = py / H;
      for (let px = 0; px < W; px++) {
        const u = px / W;
        const nDX = evalStoneCraterNormalDX(u, v);

        // Simulate baked texture RGB [0..1]
        let texR = nDX[0] * 0.5 + 0.5;
        let texG = (sourceBaker === 'opengl' ? -nDX[1] : nDX[1]) * 0.5 + 0.5;


        // UE 5.8 Flip Green Channel checkbox
        if (flipGreen) {
          texG = 1.0 - texG;
        }

        // Pitfall: Accidentally enabled sRGB on a Normal Map! (0.5 gets gamma-crushed to 0.214!)
        if (wrongSrgb) {
          texR = srgbToLinear(texR);
          texG = srgbToLinear(texG);

        }

        // Unpack [0..1] -> [-1..+1] in UE DirectX convention (+Y is down on screen, so shading Y_up = -unpackG)
        const unpackX = texR * 2 - 1;
        const unpackY_DX = texG * 2 - 1;
        const unpackZ = Math.sqrt(Math.max(0, 1 - unpackX * unpackX - unpackY_DX * unpackY_DX));

        const shadingN = norm3([unpackX, -unpackY_DX, unpackZ]);
        const grain = (hash2(px, py) - 0.5) * 0.02;
        const col = shadePbrPixel({
          N: shadingN,
          V,
          L,
          baseColorLinear: [0.38 + grain, 0.35 + grain, 0.31 + grain],
          metallic: 0.05,
          roughness: 0.42,
          envMode: 'cave',
          lightIntensity: 2.8,
        });

        const idx = (py * W + px) * 4;
        data[idx] = Math.round(col[0] * 255);
        data[idx + 1] = Math.round(col[1] * 255);
        data[idx + 2] = Math.round(col[2] * 255);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Draw glowing Sun indicator on rim
    const sunX = W / 2 + Math.cos(rad) * (W * 0.43);
    const sunY = H / 2 + Math.sin(rad) * (H * 0.43);
    ctx.save();
    ctx.beginPath();
    ctx.arc(sunX, sunY, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#fde047';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1e1b18';
    ctx.stroke();
    ctx.restore();
  }, [subLab, lightAngleDeg, sourceBaker, flipGreen, wrongSrgb]);

  const handleHemisphereDrag = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const dy = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    const len = Math.hypot(dx, dy);
    const maxR = 0.94;
    if (len > maxR) {
      setPinXY([(dx / len) * maxR, (dy / len) * maxR]);
    } else {
      setPinXY([dx, dy]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Sub-Lab Tabs */}
      <StageSegmented<NormalSubLab>
        value={subLab}
        onChange={setSubLab}
        options={[
          { value: 'toothpick', label: '📍 实验 ①：法线小牙签染色器 (#8080FF 之谜)' },
          { value: 'bc5z', label: '📐 实验 ②：BC5 砍蓝通道 & 勾股重建 Z' },
          { value: 'flipgreen', label: '🔦 实验 ③：弹坑转灯 & 翻转绿通道' },
        ]}
      />

      {/* ==================== LAB 1: TOOTHPICK HEMISPHERE ==================== */}
      {subLab === 'toothpick' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '216px minmax(0, 1fr)',
            gap: 10,
            alignItems: 'stretch',
          }}
        >
          {/* Draggable Hemisphere */}
          <div
            style={{
              background: 'var(--bg-panel)',
              border: '1.5px solid var(--border-soft)',
              borderRadius: 11,
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 700 }}>👆 按住拖动切线空间小牙签</div>
            <svg
              width="194"
              height="194"
              viewBox="-105 -105 210 210"
              onMouseMove={(e) => {
                if (e.buttons === 1) handleHemisphereDrag(e);
              }}
              onClick={handleHemisphereDrag}
              style={{ cursor: 'grab', userSelect: 'none' }}
            >
              {/* Tangent Band-Aid Patch Background */}
              <rect
                x="-98"
                y="-98"
                width="196"
                height="196"
                rx="14"
                fill={isDark ? '#1a1816' : '#f4efe4'}
                stroke={isDark ? '#574e44' : '#231f1c'}
                strokeWidth="1.6"
              />
              {/* Hemisphere circles */}
              <circle cx="0" cy="0" r="86" fill="rgba(128, 128, 255, 0.12)" stroke="#6366f1" strokeWidth="1.5" />
              <circle cx="0" cy="0" r="58" fill="none" stroke="rgba(128,128,255,0.3)" strokeDasharray="3 3" />
              <circle cx="0" cy="0" r="29" fill="none" stroke="rgba(128,128,255,0.3)" strokeDasharray="3 3" />
              <line x1="-86" y1="0" x2="86" y2="0" stroke="rgba(239,68,68,0.45)" strokeWidth="1.2" />
              <line x1="0" y1="-86" x2="0" y2="86" stroke="rgba(34,197,94,0.45)" strokeWidth="1.2" />

              {/* Axis labels */}
              <text x="72" y="-5" fontSize="10" fontWeight="800" fill="#ef4444">+X 红</text>
              <text x="-94" y="-5" fontSize="10" fontWeight="700" fill="#ef4444">-X</text>
              <text x="5" y="83" fontSize="10" fontWeight="800" fill="#22c55e">+Y 绿</text>
              <text x="5" y="-76" fontSize="10" fontWeight="700" fill="#22c55e">-Y</text>

              {/* Toothpick Shaft & Tip */}
              <line
                x1="0"
                y1="0"
                x2={nx * 82}
                y2={ny * 82}
                stroke={rgbToCss(encodedRGB)}
                strokeWidth="6"
                strokeLinecap="round"
              />
              <circle cx="0" cy="0" r="4.5" fill="#1e1b18" stroke="#fff" strokeWidth="1.5" />
              <circle
                cx={nx * 82}
                cy={ny * 82}
                r="10"
                fill={rgbToCss(encodedRGB)}
                stroke="#ffffff"
                strokeWidth="2.4"
              />
            </svg>
          </div>

          {/* Step-by-Step Arithmetic Breakdown */}
          <div
            style={{
              background: 'var(--bg-panel)',
              border: '1.5px solid var(--border-soft)',
              borderRadius: 11,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 800 }}>
              🧮 实时推导：为什么不歪不斜的法线贴图全是浅蓝紫色？
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 10,
                alignItems: 'center',
                background: 'var(--bg-code)',
                padding: '9px 11px',
                borderRadius: 9,
                border: '1px solid var(--border-soft)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                lineHeight: 1.7,
              }}
            >
              <div>
                <div>
                  ① 小牙签方向 <strong>N</strong> = (
                  <span style={{ color: '#ef4444' }}>X:{nx >= 0 ? `+${nx.toFixed(2)}` : nx.toFixed(2)}</span>,{' '}
                  <span style={{ color: '#16a34a' }}>Y:{ny >= 0 ? `+${ny.toFixed(2)}` : ny.toFixed(2)}</span>,{' '}
                  <span style={{ color: '#2563eb' }}>Z:+{nz.toFixed(2)}</span>)
                </div>
                <div>
                  ② 搬进正数贴图 <strong>N × 0.5 + 0.5</strong>：
                </div>
                <div>
                  ③ 贴图颜色 <strong>RGB</strong> = (
                  <strong>{encodedRGB[0].toFixed(2)}</strong>,{' '}
                  <strong>{encodedRGB[1].toFixed(2)}</strong>,{' '}
                  <strong>{encodedRGB[2].toFixed(2)}</strong>)
                </div>
              </div>

              {/* Giant Swatch */}
              <div
                style={{
                  width: 82,
                  height: 82,
                  borderRadius: 12,
                  background: rgbToCss(encodedRGB),
                  border: '2px solid var(--border-strong)',
                  boxShadow: 'var(--shadow-brutal)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#111',
                  fontWeight: 800,
                  fontSize: 11.5,
                }}
              >
                <span>{encodedHex}</span>
                <span style={{ fontSize: 9.5, opacity: 0.8 }}>
                  {Math.hypot(nx, ny) < 0.05 ? '经典浅蓝紫' : '歪斜染色'}
                </span>
              </div>
            </div>

            {/* Quick Presets */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button
                type="button"
                className="brutal-btn primary"
                style={{ padding: '5px 10px', fontSize: 11.5, flex: 'none' }}
                onClick={() => setPinXY([0, 0])}
              >
                🎯 回正平坦 (0, 0, 1) → #8080FF
              </button>
              <button
                type="button"
                className="brutal-btn"
                style={{ padding: '5px 9px', fontSize: 11.5 }}
                onClick={() => setPinXY([0.8, 0])}
              >
                👉 朝右斜坡 (+0.8, 0, 0.6) 偏粉红
              </button>
              <button
                type="button"
                className="brutal-btn"
                style={{ padding: '5px 9px', fontSize: 11.5 }}
                onClick={() => setPinXY([0, 0.8])}
              >
                👇 朝下斜坡 (0, +0.8, 0.6) 偏嫩绿
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== LAB 2: BC5 DROP BLUE & PYTHAGOREAN Z ==================== */}
      {subLab === 'bc5z' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 216px',
              gap: 10,
              alignItems: 'stretch',
            }}
          >
            {/* Left Explanation + Channel Cards */}
            <div
              style={{
                background: 'var(--bg-panel)',
                border: '1.5px solid var(--border-soft)',
                borderRadius: 11,
                padding: 11,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 800 }}>
                🧩 BC5 省显存绝技：扔掉整页蓝通道，靠初中勾股定理现场算回 Z！
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
                <div
                  style={{
                    padding: 8,
                    borderRadius: 8,
                    border: '1.5px solid #ef4444',
                    background: 'rgba(239,68,68,0.1)',
                    fontSize: 11,
                  }}
                >
                  <div style={{ fontWeight: 800, color: '#ef4444' }}>R 红通道 (X)</div>
                  <div>BC5 独立端点和索引</div>
                  <div style={{ opacity: 0.75 }}>管左右歪斜</div>
                </div>
                <div
                  style={{
                    padding: 8,
                    borderRadius: 8,
                    border: '1.5px solid #22c55e',
                    background: 'rgba(34,197,94,0.1)',
                    fontSize: 11,
                  }}
                >
                  <div style={{ fontWeight: 800, color: '#16a34a' }}>G 绿通道 (Y)</div>
                  <div>BC5 独立端点和索引</div>
                  <div style={{ opacity: 0.75 }}>管上下歪斜</div>
                </div>
                <div
                  style={{
                    padding: 8,
                    borderRadius: 8,
                    border: '1.5px dashed #3b82f6',
                    background: zMode === 'orig' ? 'rgba(59,130,246,0.14)' : 'var(--bg-subtle)',
                    fontSize: 11,
                  }}
                >
                  <div style={{ fontWeight: 800, color: '#2563eb' }}>B 蓝通道 (Z)</div>
                  <div>{zMode === 'orig' ? '📦 原图存盘' : '🗑️ BC5 直接扔掉!'}</div>
                  <div style={{ opacity: 0.85 }}>
                    {zMode === 'bc5-rebuild' ? '✨ 勾股算回 Z' : zMode === 'drop-broken' ? '❌ 缺失崩塌' : '占额外体积'}
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: '7px 10px',
                  borderRadius: 8,
                  background: 'var(--bg-code)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                }}
              >
                因为牙签长度恒为 1：<code>X² + Y² + Z² = 1</code> 且牙签永远朝皮肤外 <code>Z &gt; 0</code>
                <br />
                👉 UE 的 Normal 采样器自动重建 Z：<code>Z = sqrt(max(0, 1 - X² - Y²))</code>！
              </div>

              <StageSegmented<ZRebuildMode>
                value={zMode}
                onChange={setZMode}
                options={[
                  { value: 'orig', label: '① 原始三通道 RGB' },
                  { value: 'drop-broken', label: '② 扔掉蓝通道不重建 (崩坏!)' },
                  { value: 'bc5-rebuild', label: '③ 量化 XY + 重建 Z' },
                ]}
              />
            </div>

            {/* Right Lit Stone Rosette Preview */}
            <div
              style={{
                background: 'var(--bg-panel)',
                border: '1.5px solid var(--border-soft)',
                borderRadius: 11,
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 700 }}>🪨 石雕打灯示意</div>
              <canvas
                ref={zCanvasRef}
                width={192}
                height={192}
                style={{
                  width: 192,
                  height: 192,
                  borderRadius: 9,
                  border: '1.5px solid var(--border-strong)',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ==================== LAB 3: ORBIT LIGHT & FLIP GREEN CHANNEL ==================== */}
      {subLab === 'flipgreen' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '216px minmax(0, 1fr)',
              gap: 10,
              alignItems: 'stretch',
            }}
          >
            {/* Interactive Crater with Orbiting Sun */}
            <div
              style={{
                background: 'var(--bg-panel)',
                border: '1.5px solid var(--border-soft)',
                borderRadius: 11,
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 700 }}>☀️ 拖动边缘小太阳绕弹坑转灯</div>
              <canvas
                ref={craterCanvasRef}
                width={196}
                height={196}
                onMouseMove={(e) => {
                  if (e.buttons !== 1) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const dx = e.clientX - (rect.left + rect.width / 2);
                  const dy = e.clientY - (rect.top + rect.height / 2);
                  setLightAngleDeg(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360);
                }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const dx = e.clientX - (rect.left + rect.width / 2);
                  const dy = e.clientY - (rect.top + rect.height / 2);
                  setLightAngleDeg(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360);
                }}
                style={{
                  width: 192,
                  height: 192,
                  borderRadius: 9,
                  border: '1.5px solid var(--border-strong)',
                  cursor: 'pointer',
                }}
              />
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'center' }}>
                中央为<strong>凹陷弹坑</strong>，四角为<strong>凸起铆钉</strong>
              </div>
            </div>

            {/* Right Controls & Optical Explanation */}
            <div
              style={{
                background: 'var(--bg-panel)',
                border: '1.5px solid var(--border-soft)',
                borderRadius: 11,
                padding: 11,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <StageSegmented<'opengl' | 'directx'>
                label="外部软件导出的法线贴图门派"
                value={sourceBaker}
                onChange={setSourceBaker}
                options={[
                  { value: 'opengl', label: 'OpenGL 法线 (Y+ · Blender/Maya)' },
                  { value: 'directx', label: 'DirectX 法线 (Y- · UE 5.8 原生)' },
                ]}
              />

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <StageToggle
                  label="UE 5.8: Flip Green Channel (翻转绿通道)"
                  checked={flipGreen}
                  onChange={setFlipGreen}
                />
                <StageToggle
                  label="⚠️ 故意误勾 sRGB (看阴阳歪斜惨案)"
                  checked={wrongSrgb}
                  onChange={setWrongSrgb}
                />
              </div>

              <StageSlider
                label="☀️ 太阳光照射方向（270° = 正上方顶光，最易检验凹凸真假）"
                value={lightAngleDeg}
                min={0}
                max={360}
                step={5}
                unit="°"
                onChange={setLightAngleDeg}
              />

              <div
                style={{
                  padding: '7px 10px',
                  borderRadius: 8,
                  background: isGreenCorrect && !wrongSrgb ? 'var(--accent-sage)' : 'var(--accent-coral)',
                  color: isGreenCorrect && !wrongSrgb ? 'var(--accent-sage-deep)' : 'var(--accent-coral-deep)',
                  fontSize: 11.5,
                  fontWeight: 700,
                  lineHeight: 1.45,
                }}
              >
                {wrongSrgb
                  ? '❌ 致命错误：给法线勾了 sRGB！代表平坦的 0.5 被压成 0.214，整块石板法线全往左上角歪斜发黑！'
                  : isGreenCorrect
                  ? '✅ 凹凸正确：顶光往下照时，中央凹坑“上壁暗、下壁亮”，四角铆钉“上沿亮、下沿暗”！'
                  : '⚠️ 弹坑变鼓包了！OpenGL (Y+) 直接塞进 UE 5.8 没翻绿通道，上下坡全反了，快勾上 Flip Green Channel！'}
              </div>
            </div>
          </div>

          <PitfallCompareBar
            isPitfall={!isGreenCorrect || wrongSrgb}
            pitfallLabel={
              wrongSrgb
                ? '法线贴图误勾 sRGB：平坦 0.5 降至 0.214，接缝与光照彻底歪斜'
                : 'OpenGL 法线忘勾 Flip Green Channel：顶光下弹坑鼓成了大肉包！'
            }
            correctLabel="关闭 sRGB + 为 OpenGL 法线勾上 Flip Green Channel：一秒恢复深邃真弹坑"
            onToggle={(pitfall) => {
              setLightAngleDeg(270);
              setSourceBaker('opengl');
              setWrongSrgb(false);
              setFlipGreen(!pitfall);
            }}
          />
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * MODULE 06 LESSON DEFINITIONS (6.1, 6.2, 6.3)
 * ========================================================================== */

const module06Lessons: LessonDefinition[] = [
  {
    id: 'png-stream-vs-bc-block',
    moduleId: '06',
    number: '6.1',
    title: '卷筒纸 vs 快递格 —— 为什么显卡不能直接读 PNG，必须用 4×4 块压缩？',
    subtitle: '揭开“硬盘 1.8MB 贴图进引擎暴涨到 21MB”的真相：亲手点选像素，看流式解压与 BC 独立快递柜的速度对决',
    duration: '12 分钟',
    difficulty: '零基础',
    steps: [
      {
        stepNumber: 1,
        shortLabel: '1.8MB 暴涨十倍',
        tag: 'phenomenon',
        title: '硬盘里明明才 1.8 MB 的贴图，拖进引擎怎么显示占 21 MB 显存？',
        paragraphs: [
          '几乎每一位初学虚幻引擎的同学都会被贴图面板右上角的数字吓一跳：在电脑文件夹里右键看一张 `2048 × 2048` 的高清 `PNG` 贴图，体积明明只有轻巧的 **`1.8 MB`**；可一旦拖进引擎并关掉压缩，它的显存账单啪地飙到了惊人的 **`21.33 MiB`**——足足暴涨了十倍多！',
          '大家第一反应肯定是：“显卡是不是太笨了？直接把那张 `1.8 MB` 的 `PNG` 原封不动放进显存里随用随读，不就立省十倍空间了吗？” 先在左侧贴图右下角随便点一格，看一场惊心动魄的查色比赛！',
        ],
        tryItPrompt:
          '👉 用鼠标点击左侧太阳石雕贴图偏右下角的任意格子，同时盯着右侧「PNG 卷筒纸流式解压」和「BC 4×4 快递柜」两条赛道的速度差距！',
      },
      {
        stepNumber: 2,
        shortLabel: '卷筒纸与快递柜',
        tag: 'background',
        title: '抽真空卷筒纸 vs 超市快递柜：显卡根本等不起“排队拆包”！',
        paragraphs: [
          'PNG 在磁盘中使用扫描线过滤与 DEFLATE 压缩。运行时的常规 GPU 纹理采样器需要能按坐标定位的纹理布局。示意动画从文件开头逐步解开数据，对比固定块的直接寻址；动画速度、扫描数量和 PNG 体积均是示意值。',
          '桌面 BC 纹理以 4×4 纹素独立寻址，BC1 每块 8 字节；采样器由坐标求块地址，再用块内索引解码颜色。移动平台常用的 ASTC 每块 16 字节，可以选择不同块尺寸，例如 ASTC 8×8 为 2 bpp。',
        ],
        tryItPrompt:
          '分别点左上和右下角，比较目标位置如何改变示意扫描长度与 BC 块的地址计算。',
        callout: {
          tone: 'formula',
          title: '一笔算清 2048 × 2048 贴图的显存三本账',
          body: '① 未压缩 RGBA8 原图：2048 × 2048 × 4 字节 = 16 MiB，加 33.3% Mipmap = 21.33 MiB！\n② BC1 快递柜压缩：每 4×4 (16 纹素) 仅占 8 字节（均摊每纹素才 0.5 字节！），连带全套 Mipmap 约 2.67 MiB —— 立省 87.5%！',
        },
      },
      {
        stepNumber: 3,
        shortLabel: '切换分辨率算账',
        tag: 'experiment',
        title: '拨动分辨率账本：看一张未压缩 4K 图如何一口吞掉 85 MB',
        paragraphs: [
          '在舞台下方把分辨率从 `2K` 切到 **`4K (4096²)`** 看看柱状图的变化：长和宽各翻 2 倍，总像素数可是翻了整整 **`4 倍`**！如果忘了开块压缩，单单 **1 张** `4K` 贴图连带 Mipmap 就会吃掉恐怖的 **`85.33 MB`** 显存——放几十张进去显卡当场爆显存闪退！',
          '而切回 `BC1 (8B/格)` 后，同样这张 `4K` 大图立刻瘦身回温和的 **`10.67 MiB`**（高画质 `BC7` 也仅占 `21.33 MiB`），在各自固定的块大小内直接寻址。',
        ],
        tryItPrompt:
          '👉 在底部控制栏依次切换 `1K / 2K / 4K` 与 `BC1 / BC7 / 未压缩`，观察柱状图红柱与绿柱的悬殊比例！',
      },
      {
        stepNumber: 4,
        shortLabel: 'UE 5.8 压缩总览',
        tag: 'ue5',
        title: '走进 UE 5.8：看穿“硬盘大小与显存无关”的铁律',
        paragraphs: [
          'UE 读取源图并为所选平台构建纹理。给定相同尺寸、像素格式和驻留 mip，GPU 纹理数据量相同；换成更小的 JPEG 主要改变磁盘源文件和已有画质。',
          '在 Texture Editor 查看指定平台的 Format、导入尺寸、mip 与资源估算。网页给出理论数据量，实际显存还受当前驻留层级和资源对齐影响。',
        ],
        tryItPrompt:
          '👉 点击右上角「原理图」查看 UE 5.8 导入转码管线：源文件 PNG/TGA 只是原料，图中以桌面 BC 格式的 4×4 块为例！',
        callout: {
          tone: 'ue58',
          title: '按目标平台核对纹理格式',
          body: 'Compression Settings 描述纹理用途，目标平台和构建设置决定最终的像素格式。桌面常见 BC；支持 ASTC 的移动端可选择多种块尺寸。',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '压 JPG 省显存误区',
        tag: 'pitfall',
        title: '实战避坑：别拿烂画质 JPG 妄想省显存，严禁给 3D 贴图选 UserInterface2D',
        paragraphs: [
          '排掉两个最让人心疼的实战冤枉坑：① 曾有团队为了救显存，熬夜把工程里几百张无损 `TGA/PNG` 批量转成画质 40% 的高糊 `JPG` 重新导入——结果进游戏一测，**显存 `1 KB` 都没降**，画面反而叠上了 `JPG + BC1` 双重方块伪影！',
          '② 导入贴图时千万别手滑把 3D 场景贴图的压缩改成 **`UserInterface2D (RGBA)`**！这个选项等于命令显卡**拆掉所有快递柜裸奔存 `RGBA8`**，一张 `2K` 贴图显存瞬间原地暴涨 8 倍（`2.67 MiB → 21.33 MiB`）！',
        ],
        tryItPrompt:
          '👉 点击下方避坑横幅在「误选 UserInterface2D 未压缩裸奔」与「标准 BC1 块压缩」之间一键切换核对显存账单！',
        callout: {
          tone: 'warn',
          title: '一句话防坑口诀',
          body: '源图交无损 PNG/TGA 保底子，省显存全靠引擎的固定字节块（BC 或 ASTC）；3D 贴图严禁误选未压缩的 UserInterface2D！',
        },
      },
    ],
    takeaways: [
      'PNG/JPG 是前后依赖的流式压缩，无法在毫秒内随机跳读任意单点，因此显卡绝不能直接读取 PNG。',
      'GPU 块压缩支持按块独立寻址。BC 是 4×4 纹素；ASTC 块大小可选，8×8 每块 16 B，等于 2 bpp。',
      '一张 2048×2048 贴图未压缩含 Mipmap 高达 21.33 MiB，经 BC1（每格 8 字节）压缩后约占 2.67 MiB，立省 87.5%。',
      '压低源图 JPG 画质只会毁画面而不会减少半分显存；决定显存的唯有分辨率、Mipmap 开关与 BC 快递柜规格。',
    ],
    schematic: {
      title: 'UE 5.8 贴图离线导入转码与 GPU 4×4 快递柜随机寻址架构',
      caption: '源文件 PNG 在导入时拆解重编码为固定字节的 4×4 块矩阵，供上万名 GPU 着色线程一步随机读取',
      nodes: [
        {
          id: 'disk_png',
          title: '硬盘源文件 .PNG / .TGA',
          subtitle: '2048² 无损源图 (1.8 MB)',
          category: 'input',
          x: 24,
          y: 88,
          width: 180,
          outputs: [{ id: 'raw', label: '解压出 RGBA8 (21.3MB)', color: '#f97316' }],
          note: '流式压缩，显卡无法随机读',
        },
        {
          id: 'ue_cooker',
          title: 'UE 5.8 Texture Compressor',
          subtitle: '切成 512×512 个 4×4 小格',
          category: 'pipeline',
          x: 250,
          y: 88,
          width: 195,
          inputs: [{ id: 'in_raw', label: 'Raw + Mips', color: '#f97316' }],
          outputs: [{ id: 'blocks', label: 'BC1 块流 (每格 8B)', color: '#22c55e' }],
          note: '打包时离线完成，不占运行算力',
        },
        {
          id: 'vram_pool',
          title: 'GPU 显存快递柜阵列',
          subtitle: 'Resource Size = 2.67 MiB',
          category: 'texture',
          x: 490,
          y: 88,
          width: 185,
          previewColor: '#22c55e',
          inputs: [{ id: 'store', label: 'BC Blocks', color: '#22c55e' }],
          outputs: [{ id: 'fetch', label: 'O(1) 一步开柜', color: '#38bdf8' }],
          note: '立省 87.5% 显存!',
        },
        {
          id: 'shader_core',
          title: 'GPU 像素小学生方阵',
          subtitle: '硬件解码器瞬时还原颜色',
          category: 'output',
          x: 715,
          y: 88,
          width: 180,
          inputs: [{ id: 'texel', label: 'Decoded RGB', color: '#38bdf8' }],
          note: '零排队等待',
        },
      ],
      edges: [
        { fromNode: 'disk_png', fromPin: 'raw', toNode: 'ue_cooker', toPin: 'in_raw', color: '#f97316' },
        { fromNode: 'ue_cooker', fromPin: 'blocks', toNode: 'vram_pool', toPin: 'store', color: '#22c55e' },
        { fromNode: 'vram_pool', fromPin: 'fetch', toNode: 'shader_core', toPin: 'texel', color: '#38bdf8' },
      ],
    },
    StageComponent: Stage6_1_PngVsBcBlock,
  },

  {
    id: 'bc1-to-bc7-microscope',
    moduleId: '06',
    number: '6.2',
    title: '钻进 4×4 小方格看伪影 —— BC1 ~ BC7 压缩家族选型大白话指南',
    subtitle: '选择同一 4×4 区域，观察 BC1 的共享色线、BC5 的独立通道和 BC7 的固定分区示意。',
    duration: '14 分钟',
    difficulty: '进阶',
    steps: [
      {
        stepNumber: 1,
        shortLabel: '红花绿叶长杂斑',
        tag: 'phenomenon',
        title: '原图明明边缘锋利干净，导进引擎放大看怎么全是锯齿杂色块？',
        paragraphs: [
          '知道了 `4 × 4` 快递柜能一口气砍掉近九成显存后，细心的美术同学很快撞上了新烦恼：画了一朵大红花衬在翠绿树叶上（中间还夹着深色花蕊），或者导进一张光滑金属球面的法线贴图，凑近一看，交界处竟然炸出了一小块一小块灰黄浑浊的锯齿斑！',
          '是贴图画脏了吗？看看舞台中间的 **块机制显微镜**：左边未压缩原图干干净净，右边经过默认 `BC1` 压缩后，斜边和花蕊周围当场变味！秘密就藏在下方那排“4 色迷你调色盘”里。',
        ],
        tryItPrompt:
          '👉 在舞台顶部选红花样本和 BC1，沿花瓣边缘移动方框，查看同块的端点、索引与原图。',
      },
      {
        stepNumber: 2,
        shortLabel: '2 端点凑 4 色秘密',
        tag: 'background',
        title: '拆穿 BC1 省钱把戏：16 个像素只存 2 个端点色，连条直线硬凑！',
        paragraphs: [
          '`BC1` 凭什么把 `16 个像素`（原本 64 字节）塞进区区 **`8 个字节`**？它的省钱手法极其粗暴：在这 `4 × 4` 小方格里，它**只掏钱存下两个 RGB565 端点（此处用距离最远的一对）**，然后在颜色空间里拿直尺把俩端点连成一条直线，中间等分匀出 `#1、#2` 两个过渡色——凑成**总共只有 4 种颜色的调色盘**！格子里 16 个像素每人只发 `2 bit` 编号（`0~3`），被迫挑一个最接近的颜色凑合穿！',
          '如果这格画的是深棕到浅棕的木头，单一色线较易拟合，但四个色阶仍会量化；可现在格子里既有**大红**、又有**翠绿**、还有**黑花蕊**——大红连向翠绿的直线中间全是脏黄绿，根本拐不到黑色花蕊那儿去，自然炸出锯齿杂块！',
        ],
        tryItPrompt:
          '👉 点击切换到样本「🫧 细腻法线曲面」并保持 `BC1`：盯着左侧贴图下半截的「✨ 法线打灯示意区」，看法线被直线捆绑后高光碎成了多少麻子块！',
        callout: {
          tone: 'tip',
          title: '手工解码一个 8 字节 BC1 块',
          body: '可手算一个真实不透明 BC1 块：小端字节 00 F8 1F 00 E4 E4 E4 E4。两个 RGB565 端点是红和蓝；每行解包的 2-bit 索引依次为 0、1、2、3，对应 RGB8 (255,0,0)、(0,0,255)、(170,0,85)、(85,0,170)。若源色为 (160,0,95)，索引 2 的通道误差为 (+10,0,−10)。',
        },
      },
      {
        stepNumber: 3,
        shortLabel: '压缩全家桶验货',
        tag: 'experiment',
        title: '在同一块内比较单通道、独立双通道和分区色线',
        paragraphs: [
          '为了治好 `BC1` 的偏科毛病，显卡准备了三位各怀绝技的大哥，快在顶部挨个点开验货：① **`BC4`（8字节/格）**：专攻**单张黑白灰度遮罩**，把全部预算拿去存 2 个灰度端点并匀出 **8 级超丝滑台阶**；',
          'BC5 用两套独立端点和索引分别近似 X 与 Y。BC7 每个 4×4 块 16 字节，依模式可使用规定的分区和插值。这里固定左右两组，分别拟合色线，用来观察端点共享。',
        ],
        tryItPrompt:
          '选择法线样本看独立通道调色盘；再选彩色样本，移动方框观察固定分区会在什么位置跨过物体边缘。',
      },
      {
        stepNumber: 4,
        shortLabel: 'UE 5.8 选型字典',
        tag: 'ue5',
        title: '走进 UE 5.8：Compression Settings 下拉菜单一表对号入座',
        paragraphs: [
          '在支持 BC 的桌面目标，Default/Masks 可根据是否需要有效 Alpha 等条件构建为 BC1 或 BC3；Masks 按线性数据读取。Alpha (no sRGB, BC4) 用于一个数据通道。Grayscale 是另一设置，可能得到 G8。分别在目标平台预览核对。',
          'Normalmap 在这里的桌面示例使用 BC5；选择 BC7 可以对照颜色在实际素材上的重建效果。BC3、BC5 和 BC7 都是每块 16 字节。',
        ],
        tryItPrompt:
          '在不同区域打开编号，对照当前块的端点、示意索引和重建色。',
        callout: {
          tone: 'ue58',
          title: '查看目标平台的块大小',
          body: 'BC3 和 BC7 都是每 4×4 块 16 字节。BC7 有无 Alpha 均使用这个块大小。导入同一素材，在目标平台纹理预览中检查像素格式与误差。',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '空透明翻倍与错压坑',
        tag: 'pitfall',
        title: '保留 Alpha 后实际使用什么格式？法线是否被按颜色压缩？',
        paragraphs: [
          '只有编译后的像素格式从 BC1（8 B）切换为 BC3（16 B）时，块数据才翻倍。全白 Alpha 可能被忽略。先看目标平台格式；确认无需透明时再比较 Compress Without Alpha 前后的格式与体积。',
          '② 导入法线贴图时若文件名没写 `_N` 后缀，引擎可能没自动识别而当成 `Default (BC1)`，导致金属和光滑石材高光全是方块麻子——见到麻子高光先查是不是漏改了 `Normalmap (BC5)`！',
        ],
        tryItPrompt:
          '👉 点击底部避坑横幅，一键对比「法线误用 BC1 高光起方块麻子」与「正确切换 BC5 镜面丝滑高光」！',
        callout: {
          tone: 'warn',
          title: '一句话防坑口诀',
          body: '桌面可对照 BC1、BC4、BC5 和 BC7。材质语义决定通道用途，Texture Editor 的目标平台预览决定实际格式。',
        },
      },
    ],
    takeaways: [
      'BC1 在每个 4×4 方格内只存 2 个端点色并连直线插值出 4 色，遇到红绿交界或三色同格时会串色产生锯齿块。',
      'BC4（8B/格）将全部精度给单通道插值 8 级灰度，极适合单独的高度图或平滑遮罩。',
      'BC5（16B/格）为红、绿分别保存一组端点和索引。通道独立，块内两方向仍有量化误差。',
      'BC7（16B/格）支持在 4×4 格内划分多组子集分别拟合直线，可在目标平台测试彩色边缘与 Alpha 的实际重建效果。',
    ],
    schematic: {
      title: 'UE 5.8 BC1 ~ BC7 压缩选型决策树与显存规格对照',
      caption: '按贴图用途精准匹配 Compression Settings，兼顾最低显存占用与零肉眼伪影',
      nodes: [
        {
          id: 'src_tex',
          title: '待导入贴图资产',
          subtitle: '按内容语义分流',
          category: 'input',
          x: 24,
          y: 112,
          width: 165,
          outputs: [
            { id: 'col_orm', label: '普通颜色 / ORM', color: '#22c55e' },
            { id: 'gray', label: '单通道遮罩', color: '#9ca3af' },
            { id: 'nrm', label: '切线法线 _N', color: '#38bdf8' },
            { id: 'hero', label: '鲜艳彩边 / 带透明', color: '#a855f7' },
          ],
        },
        {
          id: 'bc1_node',
          title: 'Default / Masks (BC1)',
          subtitle: '8 Bytes/格 · 2K=2.67 MiB',
          category: 'texture',
          x: 255,
          y: 20,
          width: 215,
          previewColor: '#22c55e',
          inputs: [{ id: 'in', label: 'RGB', color: '#22c55e' }],
          outputs: [{ id: 'out', label: '单线 4 色最省', color: '#22c55e' }],
          note: '勾 Compress Without Alpha',
        },
        {
          id: 'bc4_node',
          title: 'Alpha (BC4)',
          subtitle: '8 Bytes/格 · 2K=2.67 MiB',
          category: 'texture',
          x: 255,
          y: 115,
          width: 215,
          previewColor: '#9ca3af',
          inputs: [{ id: 'in', label: 'R', color: '#9ca3af' }],
          outputs: [{ id: 'out', label: '单轨 8 阶丝滑', color: '#e5e7eb' }],
        },
        {
          id: 'bc5_node',
          title: 'Normalmap (BC5)',
          subtitle: '16 Bytes/格 · 2K=5.33 MiB',
          category: 'texture',
          x: 525,
          y: 55,
          width: 220,
          previewColor: '#6366f1',
          inputs: [{ id: 'in', label: 'RG 法线', color: '#38bdf8' }],
          outputs: [{ id: 'out', label: 'RG 独立 8 阶零串色', color: '#38bdf8' }],
          note: '自动关 sRGB + 勾股重建 Z',
        },
        {
          id: 'bc7_node',
          title: 'BC7 (DX11, optional A)',
          subtitle: '16 Bytes/格 · 2K=5.33 MiB',
          category: 'substrate',
          x: 525,
          y: 175,
          width: 220,
          previewColor: '#a855f7',
          inputs: [{ id: 'in', label: 'RGBA 特写', color: '#a855f7' }],
          outputs: [{ id: 'out', label: '可选固定子集布局', color: '#a855f7' }],
          note: '与 BC3 同块大小，质量按素材检查',
        },
      ],
      edges: [
        { fromNode: 'src_tex', fromPin: 'col_orm', toNode: 'bc1_node', toPin: 'in', color: '#22c55e' },
        { fromNode: 'src_tex', fromPin: 'gray', toNode: 'bc4_node', toPin: 'in', color: '#9ca3af' },
        { fromNode: 'src_tex', fromPin: 'nrm', toNode: 'bc5_node', toPin: 'in', color: '#38bdf8' },
        { fromNode: 'src_tex', fromPin: 'hero', toNode: 'bc7_node', toPin: 'in', color: '#a855f7' },
      ],
    },
    StageComponent: Stage6_2_BcMicroscope,
  },

  {
    id: 'normal-map-bc5-z-rebuild',
    moduleId: '06',
    number: '6.3',
    title: '法线贴图全解密 —— 蓝紫色之谜、绿通道翻转与 BC5 勾股定理重建 Z 轴',
    subtitle: '拨动小牙签看懂浅蓝紫色从何而来，亲证砍掉蓝通道后靠初中勾股定理白嫖还原，一招治好颠倒弹坑',
    duration: '14 分钟',
    difficulty: '进阶',
    steps: [
      {
        stepNumber: 1,
        shortLabel: '神秘的浅蓝紫色',
        tag: 'phenomenon',
        title: '明明贴在灰石头和黄皮肤上，法线贴图为什么清一色全是浅蓝紫？',
        paragraphs: [
          '只要你点开过任何一款 3D 游戏的贴图包，一定对那种色调魔幻的图片印象深刻——不管模型原本是黑铁重甲、粗糙砖墙还是细腻皮肤，配给它的法线贴图清一色铺满了**梦幻的浅蓝紫色（`#8080FF`）**，只有凹坑边缘泛着一缕粉红和嫩绿！',
          'BC5 只记录两个通道。既然蓝通道没有存下来，渲染时用什么补出向外的分量？切换下面的三个实验，分别查看颜色编码、Z 重建和绿通道方向。',
        ],
        tryItPrompt:
          '👉 在舞台「📍 实验 ①：法线小牙签染色器」里按住左边的圆盘拖动小牙签，观察牙签往右、往下歪和回正时，右侧色块是怎么实时变色的！',
      },
      {
        stepNumber: 2,
        shortLabel: '×0.5+0.5 搬家术',
        tag: 'background',
        title: '解开蓝紫之谜：把 [-1, +1] 方向硬塞进 [0, 1] 贴图的“搬家算术”',
        paragraphs: [
          '回忆第 1 章贴在皮肤上的那张隐形创可贴（切线空间）：法线贴图不存颜色，只存**每个像素表面那根“小牙签”往哪边歪**！规定往右歪是 `+X (+1)`、往左歪是 `-X (-1)`；上下歪是 `±Y`；笔直垂直皮肤朝外指是 **`+Z (+1)`**。可麻烦来了：**普通贴图只能存 `0 ~ 1` 的正数，存不了负数 `-1` 呀！**',
          '科学家用了个极巧妙的平移公式：**`贴图 RGB = 方向 × 0.5 + 0.5`**！这么一搬家，`-1` 变成 `0`，`+1` 变成 `1`，而代表“不歪不斜正中间”的 **`0` 恰好变成了 `0.5`（一半亮）**！现在算一算平平整整的桌面：小牙签笔直朝外指 **`(0, 0, 1)`**，套进公式一算正好是 **`RGB = (0.5, 0.5, 1.0)`** —— 一半红 + 一半绿 + 满格蓝，混出来正是如假包换的 **`#8080FF` 经典浅蓝紫色**！',
        ],
        tryItPrompt:
          '👉 点击实验 ① 右下角的「🎯 回正平坦 (0, 0, 1)」与「朝右/朝下斜坡」预设按钮，核对算式框里的每一步数字变化！',
        callout: {
          tone: 'formula',
          title: '法线存取双向翻译公式（UE 5.8 采样器自动完成）',
          body: '存进贴图时：RGB = Normal × 0.5 + 0.5   👉 平坦 (0, 0, 1) 编码为浅蓝紫 (0.5, 0.5, 1.0)\n采样读出时：Normal = RGB × 2.0 - 1.0   👉 浅蓝紫解码回朝外方向 (0, 0, 1)',
        },
      },
      {
        stepNumber: 3,
        shortLabel: '勾股定理白嫖 Z',
        tag: 'experiment',
        title: '从量化后的 XY 重建 Z',
        paragraphs: [
          '本例采用切线空间正半球单位法线，满足 X²+Y²+Z²=1，Z≥0。',
          'BC5 的两个通道各自按块共享端点与索引。用解码后的 XY 求 `sqrt(max(0,1-X²-Y²))`，可以省去单独存储 Z；量化引入的方向误差仍会改变高光。',
        ],
        tryItPrompt:
          '切换原始 RGB、量化 XY 后固定 Z、量化 XY 后重建 Z，观察同一光照下的石雕。',
      },
      {
        stepNumber: 4,
        shortLabel: '绿通道翻转救弹坑',
        tag: 'ue5',
        title: '走进 UE 5.8：为什么弹坑会鼓成大肉包？OpenGL (Y+) 与 DirectX (Y-) 之争',
        paragraphs: [
          '再来破获外包协作头号悬案：明明颜色图画的是凹陷陨石坑，进 UE 5.8 打上顶光一看，怎么鼓成了凸起大包？根源在于行业两大门派把绿色 `Y` 轴规定反了：**OpenGL 派（Blender、Maya、Substance 默认设置之一）** 规定向上坡涂亮绿（`Y+`），而 **DirectX 派（UE 5.8 原生标准！）** 规定向下坡涂亮绿（`Y-`）！',
          '当一张 `OpenGL` 法线直接拖进 UE 5.8，上下坡被彻底颠倒，凹坑自然翻成了鼓包！千万别让美术重烘贴图，直接在 UE 5.8 双击打开法线贴图，搜索勾上 **`Flip Green Channel（翻转绿通道）`**，一秒钟凹坑丝滑归位！',
        ],
        tryItPrompt:
          '👉 在「🔦 实验 ③：弹坑转灯 & 翻转绿通道」中绕着石板拖动小太阳，来回开关 `Flip Green Channel`，亲眼见证中央大包一秒塌陷回深邃真弹坑！',
        callout: {
          tone: 'ue58',
          title: 'UE 5.8 材质节点贴士：什么时候需要手动连 DeriveNormalZ？',
          body: '普通采样法线贴图时，Texture Sample 节点内部已自动帮你做完了 ×2-1 和勾股重建 Z！只有当你在材质里自己拿两张法线的 RG 分量做叠加混合、或者手搓程序化波浪斜率后，才需要连一颗 DeriveNormalZ 节点补齐 Z 轴。',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '法线三大翻车坑',
        tag: 'pitfall',
        title: '实战避坑：严禁给法线勾 sRGB，顶光验凹凸，强弱调节用 FlattenNormal',
        paragraphs: [
          '本例演示误将法线通道按颜色解码。标准 sRGB 的 0.5 转为线性 0.2140，再映射到有符号分量为 −0.5719。正常的 Normal 采样器按数据读取并重建方向。',
          '② **验凹凸真假用正上方顶光**：真凹坑必定是**上半壁背光暗、下半壁迎光亮**；若反了立刻勾 `Flip Green Channel`。③ 想在材质里减弱法线凹凸感时，用官方 **`FlattenNormal`** 节点（或只给 `R, G` 乘缩放系数保持 `B=1`），绝不要把整张法线直接乘以 `0.2`！',
        ],
        tryItPrompt:
          '👉 在实验 ③ 中点一下「⚠️ 故意误勾 sRGB」见识阴阳黑脸惨案，再点底部避坑横幅一键恢复完美 DirectX 法线配置！',
        callout: {
          tone: 'warn',
          title: '一句话防坑口诀',
          body: '浅蓝紫源于 ×0.5+0.5，锁死 BC5 关 sRGB 靠勾股算回 Z；顶光照凹坑若上亮下暗变鼓包，勾 Flip Green Channel 一秒反转！',
        },
      },
    ],
    takeaways: [
      '法线贴图用 RGB = Normal × 0.5 + 0.5 将 [-1, +1] 方向装进 [0, 1] 贴图；平坦朝外 (0, 0, 1) 编码后恰为 (0.5, 0.5, 1.0) 浅蓝紫色。',
      'BC5 从量化后的 XY 重建正半球法线 Z，保留量化误差。UE 的 Normal 采样器已输出解码后的 RGB 法线，直接接 Normal。',
      'UE 5.8 采用 DirectX (Y-) 法线标准；导入 Blender/Maya 等 OpenGL (Y+) 法线发现凹坑变鼓包时，勾选 Flip Green Channel 即可修复。',
      '法线贴图严禁开启 sRGB（否则 0.5 降至 0.214 导致整片法线严重歪斜），调节法线强弱应使用 FlattenNormal 节点。',
    ],
    schematic: {
      title: 'UE 5.8 BC5 法线解码、绿通道校准与 DeriveNormalZ 重建原理图',
      caption: 'UE 的 Normal 采样器会解码块内 RG 并重建 Z。保持切线空间法线设置，直接将 RGB 连到 Slab.Normal。',
      nodes: [
        {
          id: 'nrm_tex',
          title: 'Texture Sample (BC5)',
          subtitle: 'Normalmap · sRGB=OFF',
          category: 'texture',
          x: 24,
          y: 78,
          width: 190,
          previewColor: '#8080ff',
          outputs: [{ id: 'xyz', label: 'RGB（解码后的切线法线）', color: '#8080ff' }],
          note: 'Sampler Type = Normal；保持 Tangent Space Normal',
        },
        {
          id: 'slab_nrm',
          title: 'Substrate Slab BSDF',
          subtitle: '切线空间法线接入',
          category: 'substrate',
          x: 715,
          y: 78,
          width: 185,
          previewColor: '#a855f7',
          inputs: [{ id: 'normal', label: 'Normal', color: '#8080ff' }],
          outputs: [{ id: 'front', label: 'Front Material', color: '#a855f7' }],
        },
      ],
      edges: [
        { fromNode: 'nrm_tex', fromPin: 'xyz', toNode: 'slab_nrm', toPin: 'normal', color: '#8080ff' },
      ],
    },
    StageComponent: Stage6_3_NormalMapLab,
  },
];

/* ============================================================================
 * EXPORTED MODULES 05 & 06
 * ========================================================================== */

export const modules05_06: ModuleDefinition[] = [
  {
    id: '05',
    number: '05',
    title: '纹理采样与 Mipmap',
    subtitle: '把平面贴图稳稳搬进立体镜头',
    lessons: module05Lessons,
  },
  {
    id: '06',
    number: '06',
    title: '纹理显存压缩',
    subtitle: '硬盘 2MB 的图，进显卡凭什么涨到 21MB？',
    lessons: module06Lessons,
  },
];
