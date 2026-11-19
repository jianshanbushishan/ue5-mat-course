import React, { useState, useEffect, useRef } from 'react';
import type { ModuleDefinition, LessonStageProps } from '../types/course';
import type { Vec3 } from '../lib/graphics';
import {
  clamp,
  saturate,
  lerp,
  lerp3,
  smoothstep,
  norm3,
  srgbToLinear,
  linearToSrgb,
  acesTonemap,
  fbm,
  shadePbrPixel,
} from '../lib/graphics';
import {
  StageSlider,
  StageSegmented,
  StageToggle,
  PitfallCompareBar,
  SplitCompareContainer,
} from '../components/ui/StageWidgets';

/* ============================================================================
 * 3.1 舞台：有限亮度台阶人眼盲测器 (HumanEyeGammaStage)
 * ============================================================================ */
type BitDepthOpt = '16' | '32' | '64' | '256';
type GammaSceneOpt = 'portrait' | 'velvet';

const HumanEyeGammaStage: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [bitOpt, setBitOpt] = useState<BitDepthOpt>('16');
  const [scene, setScene] = useState<GammaSceneOpt>('portrait');
  const [probePerceptual, setProbePerceptual] = useState<number>(0.5);
  const [focusPitfall, setFocusPitfall] = useState<boolean>(false);

  const linearCanvasRef = useRef<HTMLCanvasElement>(null);
  const srgbCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setBitOpt('16');
    setScene('portrait');
    setProbePerceptual(0.5);
    setFocusPitfall(false);
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 0) {
      setBitOpt('16');
      setFocusPitfall(true);
    } else if (stepIndex === 1) {
      setBitOpt('16');
      setFocusPitfall(false);
    } else if (stepIndex === 2) {
      setBitOpt('32');
      setProbePerceptual(0.5);
    } else if (stepIndex === 3) {
      setBitOpt('256');
    } else if (stepIndex === 4) {
      setBitOpt('32');
      setFocusPitfall(true);
    }
  }, [stepIndex]);

  const levels = parseInt(bitOpt, 10);

  // Count how many quantized steps fall into the dark half of human perception (sRGB <= 0.5, i.e. physical <= ~21.4%)
  const linearDarkSteps = Math.max(1, Math.floor(srgbToLinear(0.5) * (levels - 1)) + 1);
  const srgbDarkSteps = Math.floor(0.5 * (levels - 1)) + 1;
  const probePhys = srgbToLinear(probePerceptual);
  const probeByte = Math.round(probePerceptual * 255);

  useEffect(() => {
    onKpiUpdate([
      {
        label: '当前可用台阶总数',
        value: `${levels} 级`,
        sub: bitOpt === '256' ? '8-bit 标准图片' : `${ Math.log2(levels).toFixed(0) }-bit 极限盲测`,
        tone: levels <= 32 ? 'accent' : 'neutral',
      },
      {
        label: '暗部半程分到台阶 (平分 vs 偏心)',
        value: `${linearDarkSteps} 格 vs ${srgbDarkSteps} 格`,
        sub: '人眼最敏感暗部保护力',
        tone: focusPitfall ? 'bad' : 'good',
      },
      {
        label: `人眼 ${(probePerceptual * 100).toFixed(0)}% 亮度对应物理光`,
        value: `${(probePhys * 100).toFixed(1)}%`,
        sub: `sRGB 存值 ${probeByte}/255`,
        tone: 'warn',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels, bitOpt, linearDarkSteps, srgbDarkSteps, probePerceptual, probePhys, probeByte, focusPitfall]);

  useEffect(() => {
    const linCvs = linearCanvasRef.current;
    const srgbCvs = srgbCanvasRef.current;
    if (!linCvs || !srgbCvs) return;

    const W = 380;
    const H = 220;
    linCvs.width = W;
    linCvs.height = H;
    srgbCvs.width = W;
    srgbCvs.height = H;

    const linCtx = linCvs.getContext('2d');
    const srgbCtx = srgbCvs.getContext('2d');
    if (!linCtx || !srgbCtx) return;

    const linImg = linCtx.createImageData(W, H);
    const srgbImg = srgbCtx.createImageData(W, H);
    const linData = linImg.data;
    const srgbData = srgbImg.data;

    const maxIdx = levels - 1;

    for (let py = 0; py < H; py++) {
      const ny = (py / H) * 2 - 1; // -1..1
      for (let px = 0; px < W; px++) {
        const nx = ((px - W * 0.5) / (H * 0.5)); // aspect-corrected

        let physLum = 0.01;
        let tintR = 1.0;
        let tintG = 0.96;
        let tintB = 0.91;

        if (scene === 'portrait') {
          // Classical low-key studio bust silhouette (head + neck + shoulder + soft candle rim light)
          const headX = nx + 0.06;
          const headY = ny + 0.16;
          const headR2 = (headX * headX) / (0.48 * 0.48) + (headY * headY) / (0.58 * 0.58);

          const neckX = nx + 0.08;
          const neckY = ny - 0.36;
          const inNeck = Math.abs(neckX) < 0.21 && neckY > -0.15 && neckY < 0.38;

          const shX = nx + 0.05;
          const shY = ny - 0.88;
          const shR2 = (shX * shX) / (0.98 * 0.98) + (shY * shY) / (0.52 * 0.52);

          if (headR2 <= 1.0) {
            const hz = Math.sqrt(Math.max(0.001, 1 - headR2));
            // Subtle facial brow/cheek/nose relief
            const nose = Math.exp(-((headX - 0.24) * (headX - 0.24) * 26 + (headY + 0.02) * (headY + 0.02) * 14)) * 0.32;
            const cheek = Math.exp(-((headX - 0.04) * (headX - 0.04) * 10 + (headY - 0.08) * (headY - 0.08) * 12)) * 0.18;
            const eyeSocket = Math.exp(-((headX - 0.15) * (headX - 0.15) * 34 + (headY + 0.14) * (headY + 0.14) * 38)) * 0.28;
            const N = norm3([headX / 0.48 + nose - eyeSocket, -headY / 0.58 + cheek, hz * 0.88]);
            const L = norm3([0.78, 0.38, 0.49]);
            const ndotl = Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]);
            const rim = Math.pow(1 - hz, 3.2) * Math.max(0, headX * 1.4 + 0.35);
            const fill = 0.006 + (1 - headY * 0.5) * 0.012;
            physLum = clamp(fill + Math.pow(ndotl, 1.35) * 0.68 + rim * 0.55, 0.002, 1.0);
          } else if (shR2 <= 1.0 || inNeck) {
            const sx = inNeck ? neckX / 0.24 : shX / 0.98;
            const sy = inNeck ? 0.15 : (shY / 0.52);
            const sz = Math.sqrt(Math.max(0.05, 1 - clamp(sx * sx * 0.7 + sy * sy * 0.5, 0, 0.95)));
            const N = norm3([sx * 0.85, -sy * 0.5 + 0.25, sz]);
            const L = norm3([0.78, 0.38, 0.49]);
            const ndotl = Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]);
            physLum = clamp(0.005 + Math.pow(ndotl, 1.4) * 0.42, 0.002, 0.85);
          } else {
            // Smooth low-key studio backdrop spotlight falloff (0.001 -> 0.16 physical!)
            const dist = Math.hypot(nx - 0.32, ny + 0.18);
            physLum = clamp(0.16 * Math.exp(-dist * dist * 1.15) + 0.0015, 0.001, 0.2);
            tintR = 0.92;
            tintG = 0.95;
            tintB = 1.0;
          }
        } else {
          // Velvet sphere + ultra-smooth dark studio gradient bar at bottom
          if (py > H - 34) {
            // Pure continuous physical exponential ramp from dark shadow to bright highlight
            const u = px / (W - 1);
            physLum = Math.pow(u, 2.4);
            tintR = 1;
            tintG = 1;
            tintB = 1;
          } else {
            const sy = ny + 0.12;
            const r2 = nx * nx + sy * sy;
            if (r2 <= 0.68 * 0.68) {
              const ux = nx / 0.68;
              const uy = sy / 0.68;
              const uz = Math.sqrt(Math.max(0.001, 1 - ux * ux - uy * uy));
              const N = norm3([ux, -uy, uz]);
              const L = norm3([0.66, 0.52, 0.54]);
              const ndotl = Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]);
              const sheen = Math.pow(1 - uz, 2.6) * (0.25 + 0.75 * Math.max(0, ux * 0.7 - uy * 0.5));
              physLum = clamp(0.004 + ndotl * 0.32 + sheen * 0.48 + Math.pow(ndotl, 14) * 0.45, 0.002, 1.0);
              tintR = 0.96;
              tintG = 0.9;
              tintB = 1.0;
            } else {
              const rad = Math.hypot(nx - 0.2, sy + 0.1);
              physLum = clamp(0.14 * Math.exp(-rad * rad * 0.85) + 0.001, 0.001, 0.18);
            }
          }
        }

        // Left: Quantize evenly in PHYSICAL LINEAR space, then display on sRGB screen
        const qLinR = Math.round(saturate(physLum * tintR) * maxIdx) / maxIdx;
        const qLinG = Math.round(saturate(physLum * tintG) * maxIdx) / maxIdx;
        const qLinB = Math.round(saturate(physLum * tintB) * maxIdx) / maxIdx;

        const idx = (py * W + px) * 4;
        linData[idx] = Math.round(linearToSrgb(qLinR) * 255);
        linData[idx + 1] = Math.round(linearToSrgb(qLinG) * 255);
        linData[idx + 2] = Math.round(linearToSrgb(qLinB) * 255);
        linData[idx + 3] = 255;

        // Right: Encode to sRGB first (dense dark steps!), quantize to exact same N steps, display directly
        const sR = Math.round(linearToSrgb(saturate(physLum * tintR)) * maxIdx) / maxIdx;
        const sG = Math.round(linearToSrgb(saturate(physLum * tintG)) * maxIdx) / maxIdx;
        const sB = Math.round(linearToSrgb(saturate(physLum * tintB)) * maxIdx) / maxIdx;

        srgbData[idx] = Math.round(sR * 255);
        srgbData[idx + 1] = Math.round(sG * 255);
        srgbData[idx + 2] = Math.round(sB * 255);
        srgbData[idx + 3] = 255;
      }
    }

    linCtx.putImageData(linImg, 0, 0);
    srgbCtx.putImageData(srgbImg, 0, 0);
  }, [levels, scene, focusPitfall]);

  // Generate ruler tick marks (cap rendered SVG ticks at 64 for crispness when 256 is selected)
  const displayTickCount = Math.min(levels, 64);
  const linPerceptualTicks: number[] = [];
  const srgbPerceptualTicks: number[] = [];
  for (let i = 0; i < displayTickCount; i++) {
    const t = i / (displayTickCount - 1);
    // Physical uniform tick t sits at linearToSrgb(t) on the human eye perceptual axis!
    linPerceptualTicks.push(linearToSrgb(t) * 100);
    // sRGB tick t sits evenly at t on the human eye perceptual axis!
    srgbPerceptualTicks.push(t * 100);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={focusPitfall}
        pitfallLabel={`左半屏：按物理光子平分 ${levels} 级台阶（暗部仅分到 ${linearDarkSteps} 格，碎成等高线色带！）`}
        correctLabel={`右半屏：按人眼偏心加密 ${levels} 级台阶（暗部分满 ${srgbDarkSteps} 格，丝滑骗过眼睛！）`}
        onToggle={(p) => setFocusPitfall(p)}
      />

      <SplitCompareContainer
        key={focusPitfall ? 'pitfall-view' : 'correct-view'}
        height={224}
        initialSplit={focusPitfall ? 80 : 24}
        leftLabel={`❌ 物理平分 Linear (${levels} 级 -> 暗部断层)`}
        rightLabel={`✅ 人眼偏心 sRGB (${levels} 级 -> 暗部丝滑)`}
        leftContent={
          <canvas
            ref={linearCanvasRef}
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
        }
        rightContent={
          <canvas
            ref={srgbCanvasRef}
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
        }
      />

      {/* Interactive Tone-Allocation Ruler */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1.5px solid var(--border-soft)',
          borderRadius: 10,
          padding: '9px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, fontWeight: 700 }}>
          <span>📏 台阶分配透视尺（横轴：人眼感受到的主观黑 → 白均匀刻度）</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontSize: 11 }}>
            {levels === 256 ? '展示 64 等分抽样刻度' : `真实展示全部 ${levels} 道台阶`}
          </span>
        </div>

        {/* Ruler 1: Linear */}
        <div style={{ position: 'relative', height: 26, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-soft)', background: 'linear-gradient(90deg, #050505 0%, #777777 50%, #ffffff 100%)' }}>
          {/* Highlight sensitive dark half */}
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%', background: 'rgba(220, 60, 45, 0.16)', borderRight: '1.5px dashed #ef4444' }} />
          {linPerceptualTicks.map((pct, idx) => (
            <div
              key={idx}
              style={{
                position: 'absolute',
                left: `${pct}%`,
                top: 0,
                bottom: 0,
                width: 2,
                background: pct <= 50.1 ? '#ff6b5b' : '#38bdf8',
                opacity: 0.92,
              }}
            />
          ))}
          <span style={{ position: 'absolute', left: 6, top: 4, fontSize: 10.5, fontWeight: 800, color: '#ffd3cd', textShadow: '0 1px 2px #000' }}>
            ❌ Linear 平分：暗部半程仅 {linearDarkSteps} 道红线（空旷断层！）
          </span>
          <span style={{ position: 'absolute', right: 6, top: 4, fontSize: 10.5, fontWeight: 800, color: '#0f172a', background: 'rgba(255,255,255,0.78)', padding: '0 5px', borderRadius: 4 }}>
            亮部挤满 {levels - linearDarkSteps} 道浪费了
          </span>
        </div>

        {/* Ruler 2: sRGB */}
        <div style={{ position: 'relative', height: 26, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-soft)', background: 'linear-gradient(90deg, #050505 0%, #777777 50%, #ffffff 100%)' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%', background: 'rgba(74, 222, 128, 0.14)', borderRight: '1.5px dashed #22c55e' }} />
          {srgbPerceptualTicks.map((pct, idx) => (
            <div
              key={idx}
              style={{
                position: 'absolute',
                left: `${pct}%`,
                top: 0,
                bottom: 0,
                width: 2,
                background: '#4ade80',
                opacity: 0.9,
              }}
            />
          ))}
          {/* Probe marker */}
          <div
            style={{
              position: 'absolute',
              left: `${probePerceptual * 100}%`,
              top: 0,
              bottom: 0,
              width: 3,
              background: '#facc15',
              boxShadow: '0 0 6px #000',
            }}
          />
          <span style={{ position: 'absolute', left: 6, top: 4, fontSize: 10.5, fontWeight: 800, color: '#dcfce7', textShadow: '0 1px 2px #000' }}>
            ✅ sRGB 偏心加密：暗部半程稳占 {srgbDarkSteps} 道绿线（顺应人眼！）
          </span>
        </div>

        <div style={{ fontSize: 11.5, color: isDark ? '#d6cfc4' : '#4a433b', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <span>
            🎯 黄色探针位置：人眼主观亮度 <strong>{(probePerceptual * 100).toFixed(0)}%</strong>（8-bit 存盘值 <code>{probeByte}</code>）
          </span>
          <span>
            ⚡ 真实物理光子能量仅：<strong>{(probePhys * 100).toFixed(1)}%</strong>（相对白色 1.0）
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSegmented<BitDepthOpt>
            label="🔢 限制可用亮度台阶数 (位深)"
            value={bitOpt}
            options={[
              { value: '16', label: '16 级 (4-bit)' },
              { value: '32', label: '32 级 (5-bit)' },
              { value: '64', label: '64 级 (6-bit)' },
              { value: '256', label: '256 级 (8-bit)' },
            ]}
            onChange={setBitOpt}
          />
          <StageSegmented<GammaSceneOpt>
            label="🎭 暗调测试画面"
            value={scene}
            options={[
              { value: 'portrait', label: '暗室石膏侧像' },
              { value: 'velvet', label: '丝绒球 + 底部渐变尺' },
            ]}
            onChange={setScene}
          />
        </div>
        <StageSlider
          label="🔍 拖动黄色探针：查看人眼主观亮度对应的真实物理光能"
          value={probePerceptual}
          min={0.05}
          max={0.95}
          step={0.01}
          formatValue={(v) => `人眼 ${(v * 100).toFixed(0)}% -> 物理 ${(srgbToLinear(v) * 100).toFixed(1)}%`}
          onChange={setProbePerceptual}
        />
      </div>
    </div>
  );
};

/* ============================================================================
 * 3.2 舞台：双聚光灯交叠 + 红绿渐变混合双实验台 (SrgbVsLinearMathStage)
 * ============================================================================ */
type ColorPairOpt = 'rg' | 'ob' | 'cm';

const SrgbVsLinearMathStage: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [spotSrgb, setSpotSrgb] = useState<number>(0.5);
  const [overlapAmt, setOverlapAmt] = useState<number>(0.56);
  const [pairOpt, setPairOpt] = useState<ColorPairOpt>('rg');
  const [showWrongFocus, setShowWrongFocus] = useState<boolean>(false);

  const wrongCvsRef = useRef<HTMLCanvasElement>(null);
  const rightCvsRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setSpotSrgb(0.5);
    setOverlapAmt(0.56);
    setPairOpt('rg');
    setShowWrongFocus(false);
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 0) {
      setSpotSrgb(0.5);
      setPairOpt('rg');
      setShowWrongFocus(true);
    } else if (stepIndex === 1 || stepIndex === 2) {
      setSpotSrgb(0.5);
      setShowWrongFocus(false);
    } else if (stepIndex === 4) {
      setShowWrongFocus(true);
    }
  }, [stepIndex]);

  const singleLin = srgbToLinear(spotSrgb);
  const wrongSumSrgb = saturate(spotSrgb + spotSrgb);
  const rightSumLin = saturate(singleLin + singleLin);
  const rightSumSrgb = linearToSrgb(rightSumLin);

  useEffect(() => {
    onKpiUpdate([
      {
        label: `单灯账面 sRGB ${spotSrgb.toFixed(2)}`,
        value: `物理仅 ${(singleLin * 100).toFixed(1)}%`,
        sub: 'sRGB 0.5 → 线性 0.2140',
        tone: 'accent',
      },
      {
        label: '错误直接相加 (sRGB)',
        value: `${wrongSumSrgb.toFixed(2)} (${(srgbToLinear(wrongSumSrgb) * 100).toFixed(0)}% 光)`,
        sub: wrongSumSrgb >= 0.99 ? '严重过曝死白 + 红绿脏黑带' : '亮度虚高失真',
        tone: 'bad',
      },
      {
        label: '正确转 Linear 相加',
        value: `屏幕 ${rightSumSrgb.toFixed(4)}`,
        sub: `物理双倍光 ${(rightSumLin * 100).toFixed(1)}% · 鲜亮过渡`,
        tone: 'good',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotSrgb, singleLin, wrongSumSrgb, rightSumLin, rightSumSrgb]);

  useEffect(() => {
    const wCvs = wrongCvsRef.current;
    const rCvs = rightCvsRef.current;
    if (!wCvs || !rCvs) return;

    const W = 390;
    const H = 246;
    wCvs.width = W;
    wCvs.height = H;
    rCvs.width = W;
    rCvs.height = H;

    const wCtx = wCvs.getContext('2d');
    const rCtx = rCvs.getContext('2d');
    if (!wCtx || !rCtx) return;

    const wImg = wCtx.createImageData(W, H);
    const rImg = rCtx.createImageData(W, H);
    const wData = wImg.data;
    const rData = rImg.data;

    const splitY = 148;
    const sepPx = lerp(82, 22, overlapAmt);
    const c1x = W * 0.5 - sepPx;
    const c2x = W * 0.5 + sepPx;
    const cy = 76;
    const spotRad = 62;

    let colA_srgb: Vec3 = [1, 0, 0];
    let colB_srgb: Vec3 = [0, 1, 0];
    if (pairOpt === 'ob') {
      colA_srgb = [1.0, 0.42, 0.04];
      colB_srgb = [0.06, 0.52, 1.0];
    } else if (pairOpt === 'cm') {
      colA_srgb = [0.05, 0.92, 0.92];
      colB_srgb = [0.96, 0.08, 0.82];
    }

    const colA_lin: Vec3 = [
      srgbToLinear(colA_srgb[0]),
      srgbToLinear(colA_srgb[1]),
      srgbToLinear(colA_srgb[2]),
    ];
    const colB_lin: Vec3 = [
      srgbToLinear(colB_srgb[0]),
      srgbToLinear(colB_srgb[1]),
      srgbToLinear(colB_srgb[2]),
    ];

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;

        if (py < splitY) {
          // Experiment 1: Two overlapping spotlights on matte dark wall
          const d1 = Math.hypot(px - c1x, py - cy) / spotRad;
          const d2 = Math.hypot(px - c2x, py - cy) / spotRad;

          // Smooth soft-edged theater spotlight profile
          const mask1 = 1 - smoothstep(0.62, 1.05, d1);
          const mask2 = 1 - smoothstep(0.62, 1.05, d2);

          const wrongByte = Math.round(255 * saturate(spotSrgb * mask1 + spotSrgb * mask2));
          const rightByte = Math.round(255 * linearToSrgb(saturate(singleLin * mask1 + singleLin * mask2)));
          for (let channel = 0; channel < 3; channel++) {
            wData[idx + channel] = wrongByte;
            rData[idx + channel] = rightByte;
          }
          wData[idx + 3] = rData[idx + 3] = 255;
        } else if (py === splitY || py === splitY + 1) {
          wData[idx] = 35;
          wData[idx + 1] = 32;
          wData[idx + 2] = 29;
          wData[idx + 3] = 255;
          rData[idx] = 35;
          rData[idx + 1] = 32;
          rData[idx + 2] = 29;
          rData[idx + 3] = 255;
        } else {
          // Experiment 2: Horizontal gradient blend (margin 18px left/right)
          const t = saturate((px - 20) / (W - 40));

          // Wrong: Lerp directly in sRGB -> dark muddy valley in the middle!
          const ws = lerp3(colA_srgb, colB_srgb, t);
          // Right: Lerp in Linear -> vibrant luminous transition!
          const rl = lerp3(colA_lin, colB_lin, t);
          const rs: Vec3 = [linearToSrgb(rl[0]), linearToSrgb(rl[1]), linearToSrgb(rl[2])];

          wData[idx] = Math.round(ws[0] * 255);
          wData[idx + 1] = Math.round(ws[1] * 255);
          wData[idx + 2] = Math.round(ws[2] * 255);
          wData[idx + 3] = 255;

          rData[idx] = Math.round(rs[0] * 255);
          rData[idx + 1] = Math.round(rs[1] * 255);
          rData[idx + 2] = Math.round(rs[2] * 255);
          rData[idx + 3] = 255;
        }
      }
    }

    wCtx.putImageData(wImg, 0, 0);
    rCtx.putImageData(rImg, 0, 0);

    // Draw crisp explanatory callouts on both canvases
    const drawAnnotations = (ctx: CanvasRenderingContext2D, isWrong: boolean) => {
      ctx.font = 'bold 11px "Noto Sans SC", sans-serif';
      ctx.textBaseline = 'middle';

      // Top spotlight label
      const midText = isWrong
        ? `两灯满强度硬加：${spotSrgb.toFixed(2)}+${spotSrgb.toFixed(2)}=${wrongSumSrgb.toFixed(2)} （满强度重叠时）`
        : `两灯满强度线性相加：2 × ${singleLin.toFixed(4)} ≈ ${rightSumLin.toFixed(4)} -> 屏幕 ${rightSumSrgb.toFixed(4)}`;

      ctx.fillStyle = isWrong ? 'rgba(125, 28, 20, 0.88)' : 'rgba(24, 82, 42, 0.88)';
      const tw = ctx.measureText(midText).width + 14;
      const bx = (W - tw) * 0.5;
      ctx.fillRect(bx, 118, tw, 22);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.strokeRect(bx, 118, tw, 22);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(midText, bx + 7, 129);

      // Bottom gradient label
      const midpoint = isWrong
        ? lerp3(colA_srgb, colB_srgb, 0.5)
        : lerp3(colA_lin, colB_lin, 0.5).map(linearToSrgb);
      const gradText = `渐变中点 sRGB · (${midpoint.map(c => c.toFixed(3)).join(', ')})`;
      const gw = ctx.measureText(gradText).width + 14;
      const gx = (W - gw) * 0.5;
      ctx.fillStyle = 'rgba(18, 16, 14, 0.78)';
      ctx.fillRect(gx, H - 27, gw, 20);
      ctx.fillStyle = isWrong ? '#fca5a5' : '#bbf7d0';
      ctx.fillText(gradText, gx + 7, H - 17);
    };

    drawAnnotations(wCtx, true);
    drawAnnotations(rCtx, false);
  }, [spotSrgb, singleLin, wrongSumSrgb, rightSumLin, rightSumSrgb, overlapAmt, pairOpt, showWrongFocus]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={showWrongFocus}
        pitfallLabel="左半屏错误算法：拿拉伸过的 sRGB 数字直接相加与混合（光斑过曝 + 渐变发脏发黑）"
        correctLabel="右半屏 UE 5.8 线性管线：先做 sRGB 分段解码，在线性空间相加，再编码到屏幕"
        onToggle={(p) => setShowWrongFocus(p)}
      />

      <SplitCompareContainer
        key={showWrongFocus ? 'wrong-math' : 'right-math'}
        height={246}
        initialSplit={showWrongFocus ? 80 : 24}
        leftLabel="❌ 错误：直接在 sRGB 空间算数"
        rightLabel="✅ 正确：转 Linear 空间算光"
        leftContent={
          <canvas
            ref={wrongCvsRef}
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
        }
        rightContent={
          <canvas
            ref={rightCvsRef}
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
        }
      />

      {/* Live 3-Step Sandwich Math Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 8,
          background: 'var(--bg-card)',
          border: '1.5px solid var(--border-soft)',
          borderRadius: 10,
          padding: '8px 10px',
          fontSize: 11.5,
        }}
      >
        <div style={{ padding: '5px 8px', borderRadius: 7, background: 'var(--bg-subtle)' }}>
          <div style={{ fontWeight: 800, color: 'var(--text-secondary)' }}>① sRGB 分段解码</div>
          <div style={{ fontFamily: 'var(--font-mono)', marginTop: 2 }}>
            sRGB <strong>{spotSrgb.toFixed(2)}</strong> → 物理 <strong>{singleLin.toFixed(4)}</strong>
          </div>
        </div>
        <div style={{ padding: '5px 8px', borderRadius: 7, background: 'var(--accent-sage)', color: 'var(--accent-sage-deep)' }}>
          <div style={{ fontWeight: 800 }}>② Linear 空间做加法</div>
          <div style={{ fontFamily: 'var(--font-mono)', marginTop: 2 }}>
            {singleLin.toFixed(4)} × 2 ≈ <strong>{rightSumLin.toFixed(4)}</strong> 光能
          </div>
        </div>
        <div style={{ padding: '5px 8px', borderRadius: 7, background: 'var(--bg-subtle)' }}>
          <div style={{ fontWeight: 800, color: 'var(--text-secondary)' }}>③ sRGB 分段编码</div>
          <div style={{ fontFamily: 'var(--font-mono)', marginTop: 2 }}>
            物理 {rightSumLin.toFixed(2)} → 屏幕 <strong>{rightSumSrgb.toFixed(4)}</strong>
          </div>
        </div>
      </div>

      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSlider
            label="💡 单盏聚光灯账面读数 (sRGB)"
            value={spotSrgb}
            min={0.25}
            max={0.75}
            step={0.01}
            formatValue={(v) => `${v.toFixed(2)} (物理 ${(srgbToLinear(v) * 100).toFixed(1)}%)`}
            onChange={setSpotSrgb}
          />
          <StageSlider
            label="🔦 两盏聚光灯靠拢重叠度"
            value={overlapAmt}
            min={0.15}
            max={0.85}
            step={0.01}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onChange={setOverlapAmt}
          />
        </div>
        <StageSegmented<ColorPairOpt>
          label="🌈 下半屏双色渐变混色组"
          value={pairOpt}
          options={[
            { value: 'rg', label: '纯红 ↔ 纯绿 (最明显脏黑带)' },
            { value: 'ob', label: '暖橙 ↔ 宝蓝 (中间发灰泥)' },
            { value: 'cm', label: '亮青 ↔ 品红 (能量塌陷对比)' },
          ]}
          onChange={setPairOpt}
        />
      </div>
    </div>
  );
};

/* ============================================================================
 * 3.3 舞台：UE 5.8 贴图检查器 + 3D 复古铁箍红木宝箱 (Ue58SrgbGoldenRuleStage)
 * ============================================================================ */
const Ue58SrgbGoldenRuleStage: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [woodSrgb, setWoodSrgb] = useState<boolean>(true);
  const [roughSrgb, setRoughSrgb] = useState<boolean>(false);
  const [lightAzimuth, setLightAzimuth] = useState<number>(38);

  const chestCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setWoodSrgb(true);
    setRoughSrgb(false);
    setLightAzimuth(38);
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 0) {
      // Show chalky washed-out wood right away to spark curiosity!
      setWoodSrgb(false);
      setRoughSrgb(false);
    } else if (stepIndex === 1 || stepIndex === 3) {
      setWoodSrgb(true);
      setRoughSrgb(false);
    } else if (stepIndex === 2) {
      setWoodSrgb(true);
      setRoughSrgb(true);
    } else if (stepIndex === 4) {
      setWoodSrgb(true);
      setRoughSrgb(true);
    }
  }, [stepIndex]);

  const isAllCorrect = woodSrgb && !roughSrgb;
  const woodStored = 0.45; // Typical walnut sRGB midtone
  const woodDecoded = woodSrgb ? srgbToLinear(woodStored) : woodStored;
  const woodScreenPreview = linearToSrgb(woodDecoded);

  const roughStored = 0.52; // Matte wood/iron roughness data
  const roughDecoded = roughSrgb ? srgbToLinear(roughStored) : roughStored;

  useEffect(() => {
    let statusText = '质感纯正写实';
    let statusTone: 'good' | 'bad' | 'warn' = 'good';
    if (!woodSrgb && roughSrgb) {
      statusText = '双重翻车：惨白又泼油！';
      statusTone = 'bad';
    } else if (!woodSrgb) {
      statusText = '忘勾颜色 sRGB：粉笔灰白箱！';
      statusTone = 'bad';
    } else if (roughSrgb) {
      statusText = '误勾粗糙度 sRGB：泼油溜冰场！';
      statusTone = 'bad';
    }

    onKpiUpdate([
      {
        label: '宝箱当前渲染诊断',
        value: statusText,
        sub: isAllCorrect ? '颜色打勾 · 数据禁勾' : '点击右侧复选框一键修复',
        tone: statusTone,
      },
      {
        label: '示例木纹色样 · 线性值',
        value: woodDecoded.toFixed(4),
        sub: woodSrgb ? '0.45 正确解码为 0.17 醇厚红木' : '0.45 原样放行 -> 双重提亮惨白',
        tone: woodSrgb ? 'good' : 'bad',
      },
      {
        label: '示例粗糙度 · 采样值',
        value: roughDecoded.toFixed(4),
        sub: !roughSrgb ? '0.52 原样保留五成哑光' : '0.52 被压成 0.23 油亮镜面！',
        tone: !roughSrgb ? 'good' : 'bad',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woodSrgb, roughSrgb, isAllCorrect, woodDecoded, roughDecoded]);

  useEffect(() => {
    const cvs = chestCanvasRef.current;
    if (!cvs) return;
    const W = 300;
    const H = 220;
    cvs.width = W;
    cvs.height = H;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    const img = ctx.createImageData(W, H);
    const data = img.data;

    const rad = (lightAzimuth * Math.PI) / 180;
    const L: Vec3 = norm3([Math.sin(rad) * 0.82, 0.52, Math.cos(rad) * 0.82]);
    const V: Vec3 = [0, 0, 1];

    // Raycast a chunky curved 3D iron-bound wooden treasure barrel-chest!
    for (let py = 0; py < H; py++) {
      const y = ((H * 0.5 - py) / (H * 0.5)) * 1.12;
      for (let px = 0; px < W; px++) {
        const x = ((px - W * 0.5) / (H * 0.5)) * 1.12;
        const idx = (py * W + px) * 4;

        // Slight 3D tilt perspective transform
        const rx = x / 1.04;
        const ry = y + 0.04 - rx * rx * 0.06;

        // Chest silhouette: arched lid + sturdy curved body
        const halfW = 0.92 - ry * ry * 0.08;
        const topEdge = 0.68 - rx * rx * 0.22;
        const botEdge = -0.68 + rx * rx * 0.08;

        if (Math.abs(rx) <= halfW && ry <= topEdge && ry >= botEdge) {
          const uNorm = rx / halfW; // -1..1 across width
          const vNorm = (ry - botEdge) / (topEdge - botEdge); // 0..1 bottom to top

          // 3D curved surface normal (arched lid curves upward, front body curves forward)
          const isLid = vNorm > 0.58;
          const zCurve = Math.sqrt(Math.max(0.08, 1 - uNorm * uNorm * 0.58 - Math.pow((vNorm - 0.48) * 1.15, 2) * 0.65));

          // Horizontal oak planks (5 planks)
          const plankPhase = vNorm * 5.0;
          const plankId = Math.floor(plankPhase);
          const plankFrac = plankPhase - plankId;
          const seamDist = Math.min(plankFrac, 1 - plankFrac);
          const plankGroove = smoothstep(0.0, 0.09, seamDist);

          // Forged iron vertical bands on left, right, and center lock plate
          const absU = Math.abs(uNorm);
          const onSideBand = absU > 0.63 && absU < 0.81;
          const onLockPlate = absU < 0.15 && vNorm > 0.36 && vNorm < 0.72;
          const onLidTrim = Math.abs(vNorm - 0.58) < 0.042;
          const isIron = onSideBand || onLockPlate || onLidTrim;

          // Brass rivets along iron bands
          let isBrassRivet = false;
          let rivetNx = 0;
          let rivetNy = 0;
          if (onSideBand) {
            const rvY = ((vNorm * 6) % 1) - 0.5;
            const rvX = (absU - 0.72) * 8.5;
            const rr = rvX * rvX + rvY * rvY;
            if (rr < 0.16) {
              isBrassRivet = true;
              rivetNx = rvX * 1.8 * Math.sign(uNorm);
              rivetNy = rvY * 1.8;
            }
          }
          if (onLockPlate && Math.hypot(uNorm * 5.2, (vNorm - 0.54) * 5.2) < 0.36) {
            isBrassRivet = true;
            rivetNx = uNorm * 3.5;
            rivetNy = (vNorm - 0.54) * 3.5;
          }

          // Procedural wood grain fbm
          const grain = fbm(uNorm * 5.5 + plankId * 3.7, vNorm * 26.0, 4);
          const fineRing = Math.sin((vNorm * 34 + grain * 4.2) * Math.PI) * 0.5 + 0.5;

          // Stored sRGB color texture values (what artist painted on monitor!)
          let texColorSrgb: Vec3;
          let texRoughStored: number;
          let metallic = 0.0;
          let ao = 0.35 + 0.65 * plankGroove;

          let nx = uNorm * 0.62;
          let ny = isLid ? (vNorm - 0.52) * 1.35 : (vNorm - 0.32) * 0.42;

          if (isBrassRivet) {
            texColorSrgb = [0.86, 0.68, 0.31];
            texRoughStored = 0.34;
            metallic = 0.92;
            ao = 0.95;
            nx += rivetNx;
            ny += rivetNy;
          } else if (isIron) {
            const hammer = fbm(uNorm * 18, vNorm * 18, 3);
            texColorSrgb = [0.34 + hammer * 0.08, 0.36 + hammer * 0.08, 0.39 + hammer * 0.08];
            texRoughStored = clamp(0.49 + (hammer - 0.5) * 0.14, 0.32, 0.68);
            metallic = 0.84;
            ao = 0.92;
            nx += (hammer - 0.5) * 0.16;
            ny += (hammer - 0.5) * 0.16;
          } else {
            // Warm dark walnut sRGB (~0.45 R, 0.27 G, 0.16 B)
            const wTone = lerp(0.76, 1.16, grain * 0.65 + fineRing * 0.35);
            texColorSrgb = [
              clamp(0.46 * wTone, 0.15, 0.72),
              clamp(0.27 * wTone, 0.08, 0.5),
              clamp(0.16 * wTone, 0.04, 0.34),
            ];
            texRoughStored = clamp(0.54 - fineRing * 0.1 + (1 - plankGroove) * 0.2, 0.38, 0.78);
            metallic = 0.0;
            ny += (plankFrac < 0.09 ? -0.45 : plankFrac > 0.91 ? 0.45 : (fineRing - 0.5) * 0.08);
          }

          // KEY LESSON LOGIC:
          // 1) BaseColor: if sRGB checked -> decode via srgbToLinear; if unchecked -> raw sRGB fed as Linear!
          const baseColorLinear: Vec3 = woodSrgb
            ? [
                srgbToLinear(texColorSrgb[0]),
                srgbToLinear(texColorSrgb[1]),
                srgbToLinear(texColorSrgb[2]),
              ]
            : texColorSrgb;

          // 2) Roughness: if sRGB UNCHECKED (correct!) -> raw value; if CHECKED (pitfall!) -> wrongly crushed via srgbToLinear!
          const roughness = roughSrgb ? srgbToLinear(texRoughStored) : texRoughStored;

          const N = norm3([nx, ny, zCurve]);
          const shaded = shadePbrPixel({
            N,
            V,
            L,
            baseColorLinear,
            metallic,
            roughness,
            ao,
            lightIntensity: 2.55,
            envMode: 'studio',
          });

          data[idx] = Math.round(shaded[0] * 255);
          data[idx + 1] = Math.round(shaded[1] * 255);
          data[idx + 2] = Math.round(shaded[2] * 255);
          data[idx + 3] = 255;
        } else {
          // Warm dark workshop floor & vignette
          const floorShadow = Math.exp(-((rx * rx) * 1.5 + Math.pow((ry + 0.72) * 4.8, 2))) * 0.65;
          const bg = clamp((0.14 - (rx * rx + ry * ry) * 0.045) * (1 - floorShadow), 0.02, 0.18);
          const sBg = Math.round(linearToSrgb(bg) * 255);
          data[idx] = sBg;
          data[idx + 1] = Math.round(sBg * 0.97);
          data[idx + 2] = Math.round(sBg * 0.93);
          data[idx + 3] = 255;
        }
      }
    }

    ctx.putImageData(img, 0, 0);
  }, [woodSrgb, roughSrgb, lightAzimuth]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Quick Preset Compare Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 800 }}>⚡ 一键体验四种典型现场：</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          <button
            type="button"
            className="segmented-opt"
            style={{
              background: woodSrgb && !roughSrgb ? 'var(--accent-sage)' : 'var(--bg-card)',
              color: woodSrgb && !roughSrgb ? 'var(--accent-sage-deep)' : 'var(--text-primary)',
              border: '1.5px solid var(--border-strong)',
              fontWeight: 700,
            }}
            onClick={() => {
              setWoodSrgb(true);
              setRoughSrgb(false);
            }}
          >
            ✅ 标准正确配置
          </button>
          <button
            type="button"
            className="segmented-opt"
            style={{
              background: !woodSrgb && !roughSrgb ? 'var(--accent-coral)' : 'var(--bg-card)',
              color: !woodSrgb && !roughSrgb ? 'var(--accent-coral-deep)' : 'var(--text-primary)',
              border: '1.5px solid var(--border-strong)',
              fontWeight: 700,
            }}
            onClick={() => {
              setWoodSrgb(false);
              setRoughSrgb(false);
            }}
          >
            ❌ 颜色忘勾 (粉笔灰白)
          </button>
          <button
            type="button"
            className="segmented-opt"
            style={{
              background: woodSrgb && roughSrgb ? 'var(--accent-coral)' : 'var(--bg-card)',
              color: woodSrgb && roughSrgb ? 'var(--accent-coral-deep)' : 'var(--text-primary)',
              border: '1.5px solid var(--border-strong)',
              fontWeight: 700,
            }}
            onClick={() => {
              setWoodSrgb(true);
              setRoughSrgb(true);
            }}
          >
            ❌ 粗糙度误勾 (泼油反光)
          </button>
        </div>
      </div>

      {/* Main Split: 3D Chest Viewport + Simulated UE 5.8 Texture Details Panel */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
          gap: 10,
          alignItems: 'stretch',
        }}
      >
        {/* Left: 3D Chest */}
        <div
          style={{
            position: 'relative',
            borderRadius: 11,
            border: '1.5px solid var(--border-strong)',
            overflow: 'hidden',
            minHeight: 215,
            background: '#181512',
          }}
        >
          <canvas
            ref={chestCanvasRef}
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              padding: '2px 8px',
              borderRadius: 6,
              background: 'rgba(20,18,16,0.82)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            📦 UE 5.8 实时视口：铁箍橡木宝箱
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              right: 8,
              padding: '4px 8px',
              borderRadius: 6,
              background: isAllCorrect ? 'rgba(28, 78, 38, 0.88)' : 'rgba(128, 28, 22, 0.9)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              textAlign: 'center',
            }}
          >
            {isAllCorrect
              ? '✅ 红木醇厚沉稳，锻铁与木纹呈自然半哑光质感'
              : !woodSrgb && roughSrgb
              ? '💥 颜色发白像撒了面粉，表皮还像刚泼了色拉油！'
              : !woodSrgb
              ? '⚠️ 木纹颜色忘勾 sRGB：暗部未被还原，被屏幕二次提亮成粉笔灰！'
              : '⚠️ 粗糙度误勾 sRGB：0.52 被压成 0.23，干木头和粗铁箍全变成油亮溜冰场！'}
          </div>
        </div>

        {/* Right: Simulated UE 5.8 Texture Details Panel */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 11,
            padding: '10px 11px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 9,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-soft)', paddingBottom: 5 }}>
            🎛️ 仿真 UE 5.8 纹理属性面板 (Details · Texture)
          </div>

          {/* Slot 1: BaseColor */}
          <div
            style={{
              padding: '8px 9px',
              borderRadius: 8,
              border: `1.5px solid ${woodSrgb ? '#4d8f31' : '#c93b2b'}`,
              background: 'var(--bg-panel)',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 22, height: 22, borderRadius: 5, background: 'linear-gradient(135deg, #8b512f, #4c2814)', border: '1px solid #000', display: 'inline-block' }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>T_ChestWood_D (木纹颜色图)</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>用途：给人眼直接看的颜色照片</div>
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 800, color: woodSrgb ? '#3b7a23' : '#c93b2b' }}>
                {woodSrgb ? '✅ 必勾正确' : '❌ 漏勾发白'}
              </span>
            </div>
            <StageToggle
              label="勾选 sRGB (颜色解码)"
              checked={woodSrgb}
              onChange={setWoodSrgb}
              hint={woodSrgb ? 'Sampler: Color' : '未解码直接进材质!'}
            />
          </div>

          {/* Slot 2: Roughness */}
          <div
            style={{
              padding: '8px 9px',
              borderRadius: 8,
              border: `1.5px solid ${!roughSrgb ? '#4d8f31' : '#c93b2b'}`,
              background: 'var(--bg-panel)',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 22, height: 22, borderRadius: 5, background: 'repeating-linear-gradient(45deg, #757575, #757575 4px, #969696 4px, #969696 8px)', border: '1px solid #000', display: 'inline-block' }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>T_ChestRough_R (粗糙度图)</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>用途：给电脑算数学的百分比表</div>
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 800, color: !roughSrgb ? '#3b7a23' : '#c93b2b' }}>
                {!roughSrgb ? '✅ 禁勾正确' : '❌ 误勾泼油'}
              </span>
            </div>
            <StageToggle
              label="勾选 sRGB (颜色解码)"
              checked={roughSrgb}
              onChange={setRoughSrgb}
              hint={!roughSrgb ? 'Linear / Masks' : '0.52 被压成 0.23!'}
            />
          </div>
        </div>
      </div>

      {/* Live 3-Stage Pipeline Bar */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1.5px solid var(--border-soft)',
          borderRadius: 10,
          padding: '8px 11px',
          fontSize: 11.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        <div style={{ fontWeight: 800, color: 'var(--text-secondary)' }}>
          🔬 示例色样换算（模型每个纹素使用相同公式）：
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
          <span>🎨 颜色贴图存值: <strong>0.45</strong></span>
          <span>→ {woodSrgb ? 'sRGB 分段解码: 0.17 (真红木)' : '❌ 未解码直通: 0.45 (虚高!)'}</span>
          <span>→ 示例色块重新编码: <strong>{woodScreenPreview.toFixed(2)}</strong> {woodSrgb ? '✅' : '❌(粉笔白)'}</span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
          <span>📊 粗糙贴图存值: <strong>0.52</strong></span>
          <span>→ {!roughSrgb ? '直通不解码: 0.52 (真五成粗糙)' : '❌ 误做 sRGB 解码: 0.23 (光滑!)'}</span>
          <span>→ PBR 高光结果: <strong>{!roughSrgb ? '自然哑光 ✅' : '刺眼油亮 ❌'}</strong></span>
        </div>
      </div>

      <div className="stage-controls-panel">
        <StageSlider
          label="☀️ 左右旋转检视灯光角度（观察铁箍与木板高光流动）"
          value={lightAzimuth}
          min={-65}
          max={65}
          step={1}
          unit="°"
          onChange={setLightAzimuth}
        />
      </div>
    </div>
  );
};

/* ============================================================================
 * 4.1 舞台：位深梯田照妖镜 + 文件格式对照台 (FileFormatsBitDepthStage)
 * ============================================================================ */
type BitStageMode = 'heightmap' | 'carhood' | 'formats';
type FormatCompareSub = 'jpg_vs_png' | 'png_vs_exr';

const FileFormatsBitDepthStage: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [mode, setMode] = useState<BitStageMode>('heightmap');
  const [formatSub, setFormatSub] = useState<FormatCompareSub>('jpg_vs_png');
  const [lightAngle, setLightAngle] = useState<number>(28);
  const [paintRough, setPaintRough] = useState<number>(0.09);
  const [hdrExposure, setHdrExposure] = useState<number>(0.18);

  const leftCvsRef = useRef<HTMLCanvasElement>(null);
  const rightCvsRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setMode('heightmap');
    setFormatSub('jpg_vs_png');
    setLightAngle(28);
    setPaintRough(0.09);
    setHdrExposure(0.18);
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 0) {
      setMode('heightmap');
    } else if (stepIndex === 1 || stepIndex === 2) {
      setMode('carhood');
    } else if (stepIndex === 3) {
      setMode('formats');
      setFormatSub('png_vs_exr');
    } else if (stepIndex === 4) {
      setMode('carhood');
    }
  }, [stepIndex]);

  useEffect(() => {
    if (mode === 'formats') {
      onKpiUpdate([
        {
          label: '当前对比组',
          value: formatSub === 'jpg_vs_png' ? 'JPG 有损 vs PNG 无损' : 'LDR 截断与浮点数值示意',
          sub: formatSub === 'jpg_vs_png' ? '同一幅徽章原图分别编码再解码' : '超过 1.0 的太阳高光细节',
          tone: 'accent',
        },
        {
          label: '左侧踩坑格式',
          value: formatSub === 'jpg_vs_png' ? '浏览器 JPEG · quality 0.25' : 'PNG 上限锁死 1.0',
          sub: formatSub === 'jpg_vs_png' ? '观察细线、色边与渐变的损失' : '压暗曝光变死灰圆饼',
          tone: 'bad',
        },
        {
          label: '右侧工业标准',
          value: formatSub === 'jpg_vs_png' ? '浏览器 PNG · 无损' : '浮点动态范围示意',
          sub: formatSub === 'jpg_vs_png' ? '解码恢复同一幅原图的 RGB' : '完整保留 25.0 倍日冕能量',
          tone: 'good',
        },
      ]);
    } else {
      onKpiUpdate([
        {
          label: '8-bit 高度台阶数',
          value: '256 级整数',
          sub: mode === 'heightmap' ? '平看灰度几乎看不出毛病' : '缓坡折角炸出梯田年轮！',
          tone: mode === 'carhood' ? 'bad' : 'warn',
        },
        {
          label: '16-bit 高度台阶数',
          value: '65,536 级整数',
          sub: '精度提升整整 256 倍',
          tone: 'good',
        },
        {
          label: '当前检视方式',
          value: mode === 'heightmap' ? '平铺直看灰度图' : '光滑车盖斜向高光',
          sub: `粗糙度 ${paintRough.toFixed(2)}`,
          tone: 'accent',
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, formatSub, paintRough]);

  useEffect(() => {
    const lCvs = leftCvsRef.current;
    const rCvs = rightCvsRef.current;
    if (!lCvs || !rCvs) return;

    const W = 384;
    const H = 224;
    lCvs.width = W;
    lCvs.height = H;
    rCvs.width = W;
    rCvs.height = H;

    const lCtx = lCvs.getContext('2d');
    const rCtx = rCvs.getContext('2d');
    if (!lCtx || !rCtx) return;

    const lImg = lCtx.createImageData(W, H);
    const rImg = rCtx.createImageData(W, H);
    const lData = lImg.data;
    const rData = rImg.data;

    if (mode === 'heightmap' || mode === 'carhood') {
      // Prebuild a 128x80 heightmap texture buffer in 8-bit vs 16-bit so bilinear sampling & finite-diff normals match real GPU textures!
      const TW = 128;
      const TH = 80;
      const h8 = new Float32Array(TW * TH);
      const h16 = new Float32Array(TW * TH);

      for (let ty = 0; ty < TH; ty++) {
        const v = (ty / (TH - 1)) * 2 - 1;
        for (let tx = 0; tx < TW; tx++) {
          const u = (tx / (TW - 1)) * 2 - 1;
          // Gentle aerodynamic sports-car hood bulge (spans ~0.32 -> 0.50 height, ~46 steps in 8-bit!)
          const r2 = u * u * 0.72 + v * v * 0.85;
          const dome = Math.max(0, 1 - r2 * 0.68);
          const rib = Math.exp(-u * u * 26) * 0.024 * (1 - Math.abs(v) * 0.4);
          const rawH = clamp(0.28 + dome * 0.21 + rib, 0, 1);

          h8[ty * TW + tx] = Math.round(rawH * 255) / 255;
          h16[ty * TW + tx] = Math.round(rawH * 65535) / 65535;
        }
      }

      const sampleBilinear = (buf: Float32Array, u01: number, v01: number): number => {
        const fx = clamp(u01, 0, 1) * (TW - 1);
        const fy = clamp(v01, 0, 1) * (TH - 1);
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(TW - 1, x0 + 1);
        const y1 = Math.min(TH - 1, y0 + 1);
        const tx = fx - x0;
        const ty = fy - y0;
        const a = buf[y0 * TW + x0];
        const b = buf[y0 * TW + x1];
        const c = buf[y1 * TW + x0];
        const d = buf[y1 * TW + x1];
        return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
      };

      const ang = (lightAngle * Math.PI) / 180;
      const L: Vec3 = norm3([Math.sin(ang) * 0.86, Math.cos(ang) * 0.44 + 0.28, 0.48]);
      const V: Vec3 = [0, 0, 1];
      const du = 1.0 / TW;
      const dv = 1.0 / TH;
      const slopeScale = 2.85;

      for (let py = 0; py < H; py++) {
        const v01 = py / (H - 1);
        for (let px = 0; px < W; px++) {
          const u01 = px / (W - 1);
          const idx = (py * W + px) * 4;

          if (mode === 'heightmap') {
            // Mode 1: Direct flat grayscale display — visually nearly identical!
            const val8 = Math.round(sampleBilinear(h8, u01, v01) * 255);
            const val16 = Math.round(sampleBilinear(h16, u01, v01) * 255);
            lData[idx] = val8;
            lData[idx + 1] = val8;
            lData[idx + 2] = val8;
            lData[idx + 3] = 255;

            rData[idx] = val16;
            rData[idx + 1] = val16;
            rData[idx + 2] = val16;
            rData[idx + 3] = 255;
          } else {
            // Mode 2: Glossy metallic car hood shaded from derived heightmap normals!
            const dx8 = (sampleBilinear(h8, u01 + du, v01) - sampleBilinear(h8, u01 - du, v01)) / (2 * du);
            const dy8 = (sampleBilinear(h8, u01, v01 + dv) - sampleBilinear(h8, u01, v01 - dv)) / (2 * dv);
            const N8 = norm3([-dx8 * slopeScale, dy8 * slopeScale, 1.0]);

            const dx16 = (sampleBilinear(h16, u01 + du, v01) - sampleBilinear(h16, u01 - du, v01)) / (2 * du);
            const dy16 = (sampleBilinear(h16, u01, v01 + dv) - sampleBilinear(h16, u01, v01 - dv)) / (2 * dv);
            const N16 = norm3([-dx16 * slopeScale, dy16 * slopeScale, 1.0]);

            const carBase: Vec3 = [0.015, 0.11, 0.36];
            const c8 = shadePbrPixel({
              N: N8,
              V,
              L,
              baseColorLinear: carBase,
              metallic: 0.68,
              roughness: paintRough,
              clearCoat: 1.0,
              clearCoatRoughness: 0.045,
              lightIntensity: 2.8,
              envMode: 'studio',
            });
            const c16 = shadePbrPixel({
              N: N16,
              V,
              L,
              baseColorLinear: carBase,
              metallic: 0.68,
              roughness: paintRough,
              clearCoat: 1.0,
              clearCoatRoughness: 0.045,
              lightIntensity: 2.8,
              envMode: 'studio',
            });

            lData[idx] = Math.round(c8[0] * 255);
            lData[idx + 1] = Math.round(c8[1] * 255);
            lData[idx + 2] = Math.round(c8[2] * 255);
            lData[idx + 3] = 255;

            rData[idx] = Math.round(c16[0] * 255);
            rData[idx + 1] = Math.round(c16[1] * 255);
            rData[idx + 2] = Math.round(c16[2] * 255);
            rData[idx + 3] = 255;
          }
        }
      }
    } else {
      // Mode 3: File Formats comparison (JPG blocky artifacts vs PNG lossless, OR 8-bit LDR clipped sun vs EXR HDR sun)
      const ang = (lightAngle * Math.PI) / 180;
      const L: Vec3 = norm3([Math.sin(ang) * 0.8, 0.55, 0.5]);
      const V: Vec3 = [0, 0, 1];

      for (let py = 0; py < H; py++) {
        const ny = (py / H) * 2 - 1;
        for (let px = 0; px < W; px++) {
          const nx = ((px - W * 0.5) / (H * 0.5));
          const idx = (py * W + px) * 4;

          if (formatSub === 'jpg_vs_png') {
            // Render the source once. Both codecs receive these same display-referred pixels.
            const ringClean = Math.sin(Math.hypot(nx, ny) * 14.0) * 0.12;
            const NClean = norm3([-nx * 0.45 + nx * ringClean, ny * 0.45 - ny * ringClean, 1]);
            const edgeDist = Math.abs(Math.hypot(nx, ny) - 0.62);
            const cleanBase: Vec3 = edgeDist < 0.07 ? [0.78, 0.12, 0.08] : [0.05, 0.22, 0.34];
            const colPng = shadePbrPixel({
              N: NClean,
              V,
              L,
              baseColorLinear: cleanBase,
              metallic: 0.45,
              roughness: 0.12,
              lightIntensity: 2.6,
              envMode: 'studio',
            });

            rData[idx] = Math.round(colPng[0] * 255);
            rData[idx + 1] = Math.round(colPng[1] * 255);
            rData[idx + 2] = Math.round(colPng[2] * 255);
            rData[idx + 3] = 255;
          } else {
            // 8-bit PNG clipped at 1.0 vs 16-bit EXR floating-point HDR sun skybox (up to 25.0!)
            const sunDist = Math.hypot(nx - 0.0, ny + 0.14);
            const skyY = clamp(0.5 - ny * 0.5, 0, 1);
            const skyBase: Vec3 = lerp3([0.08, 0.22, 0.58], [0.75, 0.52, 0.32], Math.pow(skyY, 1.8));
            const sunCore = 24.0 * Math.exp(-sunDist * sunDist * 65);
            const sunCorona = 3.8 * Math.exp(-sunDist * 5.2);
            const rays = (Math.sin(Math.atan2(ny + 0.14, nx) * 12) * 0.5 + 0.5) * Math.exp(-sunDist * 4.5) * 1.6;

            const trueHdr: Vec3 = [
              skyBase[0] + (sunCore + sunCorona + rays) * 1.15,
              skyBase[1] + (sunCore * 0.92 + sunCorona * 0.72 + rays * 0.65),
              skyBase[2] + (sunCore * 0.68 + sunCorona * 0.32),
            ];

            // Left: Saved as 8-bit PNG -> clamped hard at 1.0 BEFORE exposure adjustment!
            const clippedLdr: Vec3 = [
              Math.min(1.0, trueHdr[0]),
              Math.min(1.0, trueHdr[1]),
              Math.min(1.0, trueHdr[2]),
            ];

            const expL: Vec3 = [
              linearToSrgb(acesTonemap(clippedLdr[0] * hdrExposure)),
              linearToSrgb(acesTonemap(clippedLdr[1] * hdrExposure)),
              linearToSrgb(acesTonemap(clippedLdr[2] * hdrExposure)),
            ];
            const expR: Vec3 = [
              linearToSrgb(acesTonemap(trueHdr[0] * hdrExposure)),
              linearToSrgb(acesTonemap(trueHdr[1] * hdrExposure)),
              linearToSrgb(acesTonemap(trueHdr[2] * hdrExposure)),
            ];

            lData[idx] = Math.round(expL[0] * 255);
            lData[idx + 1] = Math.round(expL[1] * 255);
            lData[idx + 2] = Math.round(expL[2] * 255);
            lData[idx + 3] = 255;

            rData[idx] = Math.round(expR[0] * 255);
            rData[idx + 1] = Math.round(expR[1] * 255);
            rData[idx + 2] = Math.round(expR[2] * 255);
            rData[idx + 3] = 255;
          }
        }
      }
    }

    if (mode === 'formats' && formatSub === 'jpg_vs_png') {
      const source = document.createElement('canvas');
      source.width = W;
      source.height = H;
      const sourceCtx = source.getContext('2d');
      if (!sourceCtx) return;
      sourceCtx.putImageData(rImg, 0, 0);
      let cancelled = false;
      const showDecoded = (type: string, target: CanvasRenderingContext2D) => {
        const decoded = new Image();
        decoded.onload = () => { if (!cancelled) target.drawImage(decoded, 0, 0); };
        decoded.onerror = () => {
          if (!cancelled) {
            target.fillStyle = '#f97316';
            target.fillText('当前浏览器解码失败', 14, 26);
          }
        };
        decoded.src = source.toDataURL(type, 0.25);
      };
      showDecoded('image/jpeg', lCtx);
      showDecoded('image/png', rCtx);
      return () => { cancelled = true; };
    }
    lCtx.putImageData(lImg, 0, 0);
    rCtx.putImageData(rImg, 0, 0);

    if (mode === 'heightmap') {
      lCtx.font = 'bold 11.5px "Noto Sans SC", sans-serif';
      rCtx.font = 'bold 11.5px "Noto Sans SC", sans-serif';
      const msg = '👀 平铺直看：256 级和 65536 级肉眼几乎看不出差别！请点上方「模式 2」打斜光 →';
      const drawBanner = (ctx: CanvasRenderingContext2D) => {
        ctx.fillStyle = 'rgba(20, 18, 15, 0.82)';
        ctx.fillRect(12, H - 32, W - 24, 24);
        ctx.fillStyle = '#fde68a';
        ctx.fillText(msg, 18, H - 16);
      };
      drawBanner(lCtx);
      drawBanner(rCtx);
    }
  }, [mode, formatSub, lightAngle, paintRough, hdrExposure]);

  const leftTitle =
    mode === 'formats'
      ? formatSub === 'jpg_vs_png'
        ? 'JPEG · 浏览器编码质量 0.25'
        : '归一化整数范围示意 · 截断至 1.0'
      : '❌ 8-bit 高度图 (仅 256 级 -> 梯田年轮波纹)';

  const rightTitle =
    mode === 'formats'
      ? formatSub === 'jpg_vs_png'
        ? 'PNG · 同一幅原图，无损'
        : '浮点范围示意 · 保留高亮'
      : '✅ 16-bit 高度图 (65,536 级 -> 镜面般丝滑)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <StageSegmented<BitStageMode>
        value={mode}
        options={[
          { value: 'heightmap', label: '🔍 模式 1：平铺直看高度图' },
          { value: 'carhood', label: '🚗 模式 2：贴上光滑引擎盖打斜光' },
          { value: 'formats', label: '🗂️ 模式 3：JPEG / PNG 编解码与 HDR 数值示意' },
        ]}
        onChange={setMode}
      />

      <SplitCompareContainer
        height={224}
        initialSplit={52}
        leftLabel={leftTitle}
        rightLabel={rightTitle}
        leftContent={
          <canvas
            ref={leftCvsRef}
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
        }
        rightContent={
          <canvas
            ref={rightCvsRef}
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
        }
      />

      {/* Micro-section diagram explaining why 8-bit creates normal stair-stepping */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1.5px solid var(--border-soft)',
          borderRadius: 10,
          padding: '7px 11px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 10,
          alignItems: 'center',
          fontSize: 11.5,
        }}
      >
        <div>
          <div style={{ fontWeight: 800, color: 'var(--accent-coral-deep)' }}>
            🔬 放大 50 倍看 8-bit 缓坡切面：
          </div>
          <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
            256 个整数撑不起平缓大曲面，中间变成<strong>平平台阶 + 突然折角</strong>，表面法线小牙签一会儿朝天、一会儿猛歪，高光当场碎成年轮！
          </div>
        </div>
        <svg viewBox="0 0 260 54" style={{ width: '100%', height: 52, display: 'block' }}>
          {/* Left: 8-bit stairs */}
          <path
            d="M 8 46 L 34 46 L 34 34 L 62 34 L 62 22 L 90 22 L 90 10 L 116 10"
            fill="none"
            stroke="#ef4444"
            strokeWidth="2.5"
          />
          <line x1="21" y1="46" x2="21" y2="33" stroke="#f97316" strokeWidth="1.6" />
          <line x1="34" y1="40" x2="24" y2="31" stroke="#f97316" strokeWidth="1.6" />
          <line x1="48" y1="34" x2="48" y2="21" stroke="#f97316" strokeWidth="1.6" />
          <text x="10" y="13" fontSize="9.5" fontWeight="bold" fill="#ef4444">8-bit 硬台阶</text>

          {/* Right: 16-bit smooth curve */}
          <path
            d="M 142 46 Q 195 34 250 10"
            fill="none"
            stroke="#22c55e"
            strokeWidth="2.5"
          />
          <line x1="165" y1="42" x2="162" y2="30" stroke="#3b82f6" strokeWidth="1.6" />
          <line x1="196" y1="31" x2="191" y2="19" stroke="#3b82f6" strokeWidth="1.6" />
          <line x1="228" y1="19" x2="222" y2="7" stroke="#3b82f6" strokeWidth="1.6" />
          <text x="142" y="13" fontSize="9.5" fontWeight="bold" fill="#16a34a">16-bit 丝滑斜坡</text>
        </svg>
      </div>

      <div className="stage-controls-panel">
        {mode === 'formats' ? (
          <div className="control-grid">
            <StageSegmented<FormatCompareSub>
              label="选择对照"
              value={formatSub}
              options={[
                { value: 'jpg_vs_png', label: '实编码 JPEG 对 PNG' },
                { value: 'png_vs_exr', label: 'LDR 截断与 HDR 数值示意' },
              ]}
              onChange={setFormatSub}
            />
            {formatSub === 'png_vs_exr' ? (
              <StageSlider
                label="🕶️ 压低相机曝光（戴上墨镜看太阳核心）"
                value={hdrExposure}
                min={0.04}
                max={1.0}
                step={0.01}
                formatValue={(v) => `${v.toFixed(2)}x 曝光`}
                onChange={setHdrExposure}
              />
            ) : (
              <StageSlider
                label="☀️ 旋转斜射灯光角度"
                value={lightAngle}
                min={-60}
                max={60}
                step={1}
                unit="°"
                onChange={setLightAngle}
              />
            )}
          </div>
        ) : (
          <div className="control-grid">
            <StageSlider
              label="☀️ 斜射高光角度（滑动看年轮移动）"
              value={lightAngle}
              min={-65}
              max={65}
              step={1}
              unit="°"
              onChange={setLightAngle}
            />
            <StageSlider
              label="✨ 引擎盖烤漆粗糙度（越光滑越挑剔）"
              value={paintRough}
              min={0.05}
              max={0.38}
              step={0.01}
              onChange={setPaintRough}
            />
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
 * 4.2 舞台：扑克牌四通道拆页仪 + 透明 PNG 树叶白边显微镜 (RgbaFourSpreadsheetsStage)
 * ============================================================================ */
type RgbaLabTab = 'cards' | 'leafhalo';
type ChannelViewOpt = 'rgb' | 'r' | 'g' | 'b' | 'a' | 'all4';

function evalEmblemTexel(u: number, v: number): [number, number, number, number] {
  const x = u * 2 - 1;
  const y = 1 - v * 2;
  const rad = Math.hypot(x, y);

  // Outer shield circle mask (Alpha page!)
  const shieldMask = 1 - smoothstep(0.84, 0.89, rad);
  if (shieldMask <= 0.001) {
    return [0.08, 0.14, 0.28, 0.0];
  }

  // Ruby star/maple heart in center
  const angle = Math.atan2(y, x);
  const starR = 0.34 + 0.11 * Math.cos(angle * 5);
  const inGem = 1 - smoothstep(starR - 0.04, starR + 0.02, rad);

  // Emerald wreath ring around center
  const inWreath =
    smoothstep(0.42, 0.46, rad) *
    (1 - smoothstep(0.66, 0.7, rad)) *
    (0.75 + 0.25 * Math.sin(angle * 16));

  // Cobalt royal shield base + gold rim
  const inGoldRim = smoothstep(0.73, 0.76, rad);

  let r = 0.11;
  let g = 0.28;
  let b = 0.86;

  // Blend wreath (rich green)
  r = lerp(r, 0.14, inWreath);
  g = lerp(g, 0.84, inWreath);
  b = lerp(b, 0.22, inWreath);

  // Blend gold rim (R + G high, B low!)
  r = lerp(r, 0.94, inGoldRim);
  g = lerp(g, 0.76, inGoldRim);
  b = lerp(b, 0.16, inGoldRim);

  // Blend ruby center (R high, G & B low!)
  r = lerp(r, 0.95, inGem);
  g = lerp(g, 0.12, inGem);
  b = lerp(b, 0.14, inGem);

  return [saturate(r), saturate(g), saturate(b), shieldMask];
}

const RgbaFourSpreadsheetsStage: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [tab, setTab] = useState<RgbaLabTab>('cards');
  const [chanOpt, setChanOpt] = useState<ChannelViewOpt>('all4');
  const [probeUV, setProbeUV] = useState<[number, number]>([0.5, 0.5]);
  const [maskClip, setMaskClip] = useState<number>(0.33);
  const [xrayRgb, setXrayRgb] = useState<boolean>(false);

  const singleCvsRef = useRef<HTMLCanvasElement>(null);
  const unpaddedCvsRef = useRef<HTMLCanvasElement>(null);
  const paddedCvsRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setTab('cards');
    setChanOpt('all4');
    setProbeUV([0.5, 0.5]);
    setMaskClip(0.33);
    setXrayRgb(false);
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 0) {
      setTab('cards');
      setChanOpt('rgb');
    } else if (stepIndex === 1) {
      setTab('cards');
      setChanOpt('all4');
    } else if (stepIndex === 2) {
      setTab('leafhalo');
      setXrayRgb(false);
    } else if (stepIndex === 3) {
      setTab('cards');
      setChanOpt('r');
    } else if (stepIndex === 4) {
      setTab('leafhalo');
      setXrayRgb(false);
    }
  }, [stepIndex]);

  const [pR, pG, pB, pA] = evalEmblemTexel(probeUV[0], probeUV[1]);

  useEffect(() => {
    if (tab === 'cards') {
      onKpiUpdate([
        {
          label: '探针处 R / G 账本读数',
          value: `R:${pR.toFixed(2)} · G:${pG.toFixed(2)}`,
          sub: '单撕任何一页全是黑白灰度',
          tone: 'accent',
        },
        {
          label: '探针处 B / A 账本读数',
          value: `B:${pB.toFixed(2)} · A:${pA.toFixed(2)}`,
          sub: pA < 0.5 ? 'A=0 代表第四页记为 0' : 'A=1 代表第四页记为 1',
          tone: 'neutral',
        },
        {
          label: '当前通道透视模式',
          value: chanOpt === 'all4' ? '四页灰度同屏拆开' : chanOpt.toUpperCase(),
          sub: '点击贴图任意处可取色查账',
          tone: 'good',
        },
      ]);
    } else {
      onKpiUpdate([
        {
          label: '左图透明背景底色 (Alpha=0)',
          value: '纯白 (1, 1, 1)',
          sub: '双线性过滤吸进白底产生白边！',
          tone: 'bad',
        },
        {
          label: '右图边缘外扩底色 (Padding)',
          value: '叶绿 (0.15, 0.47, 0.12)',
          sub: '绿混绿 = 边缘严丝合缝无白晕',
          tone: 'good',
        },
        {
          label: 'UE 5.8 Opacity Mask Clip',
          value: maskClip.toFixed(2),
          sub: xrayRgb ? '🔬 已掀开遮罩透视底层 RGB' : '低于阈值的像素一刀切镂空',
          tone: xrayRgb ? 'warn' : 'accent',
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, chanOpt, pR, pG, pB, pA, maskClip, xrayRgb]);

  // Draw Tab 1: RGBA Four Spreadsheets
  useEffect(() => {
    if (tab !== 'cards') return;
    const cvs = singleCvsRef.current;
    if (!cvs) return;

    const W = 400;
    const H = 222;
    cvs.width = W;
    cvs.height = H;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    const img = ctx.createImageData(W, H);
    const data = img.data;

    if (chanOpt === 'all4') {
      // Render 4 side-by-side grayscale poker cards!
      const cardW = 88;
      const cardH = 148;
      const gap = 9;
      const startX = Math.floor((W - (cardW * 4 + gap * 3)) * 0.5);
      const startY = 42;

      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const idx = (py * W + px) * 4;
          data[idx] = 28;
          data[idx + 1] = 25;
          data[idx + 2] = 23;
          data[idx + 3] = 255;

          if (py >= startY && py < startY + cardH) {
            for (let c = 0; c < 4; c++) {
              const cx0 = startX + c * (cardW + gap);
              if (px >= cx0 && px < cx0 + cardW) {
                const u = (px - cx0) / (cardW - 1);
                const v = (py - startY) / (cardH - 1);
                const rgba = evalEmblemTexel(u, v);
                const gray = Math.round(rgba[c] * 255);
                data[idx] = gray;
                data[idx + 1] = gray;
                data[idx + 2] = gray;
                break;
              }
            }
          }
        }
      }
      ctx.putImageData(img, 0, 0);

      // Card titles & probe crosshairs
      const titles = ['🔴 第1页 R (红)', '🟢 第2页 G (绿)', '🔵 第3页 B (蓝)', '⬜ 第4页 A (附)'];
      const borderCols = ['#ef4444', '#22c55e', '#3b82f6', '#e5e7eb'];
      ctx.font = 'bold 11px "Noto Sans SC", sans-serif';
      for (let c = 0; c < 4; c++) {
        const cx0 = startX + c * (cardW + gap);
        ctx.strokeStyle = borderCols[c];
        ctx.lineWidth = 2;
        ctx.strokeRect(cx0, startY, cardW, cardH);
        ctx.fillStyle = borderCols[c];
        ctx.fillText(titles[c], cx0 + 4, startY - 9);

        // Probe dot on each sheet
        const dotX = cx0 + probeUV[0] * (cardW - 1);
        const dotY = startY + probeUV[1] * (cardH - 1);
        ctx.beginPath();
        ctx.arc(dotX, dotY, 4.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Numeric readout badge at bottom of card
        const val = [pR, pG, pB, pA][c];
        ctx.fillStyle = 'rgba(15,14,12,0.86)';
        ctx.fillRect(cx0 + 8, startY + cardH + 6, cardW - 16, 20);
        ctx.fillStyle = '#fde68a';
        ctx.fillText(`数值: ${val.toFixed(2)}`, cx0 + 15, startY + cardH + 20);
      }
    } else {
      // Single large emblem square on left + 4-row ledger card on right
      const boxSize = 186;
      const bx0 = 24;
      const by0 = 18;

      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const idx = (py * W + px) * 4;
          data[idx] = 28;
          data[idx + 1] = 25;
          data[idx + 2] = 23;
          data[idx + 3] = 255;

          if (px >= bx0 && px < bx0 + boxSize && py >= by0 && py < by0 + boxSize) {
            const u = (px - bx0) / (boxSize - 1);
            const v = (py - by0) / (boxSize - 1);
            const [r, g, b, a] = evalEmblemTexel(u, v);

            if (chanOpt === 'rgb') {
              // Checkerboard behind alpha=0
              const chk = ((Math.floor(px / 10) + Math.floor(py / 10)) % 2 === 0) ? 0.22 : 0.15;
              data[idx] = Math.round(lerp(chk, r, a) * 255);
              data[idx + 1] = Math.round(lerp(chk, g, a) * 255);
              data[idx + 2] = Math.round(lerp(chk, b, a) * 255);
            } else {
              const chVal = chanOpt === 'r' ? r : chanOpt === 'g' ? g : chanOpt === 'b' ? b : a;
              const gByte = Math.round(chVal * 255);
              data[idx] = gByte;
              data[idx + 1] = gByte;
              data[idx + 2] = gByte;
            }
          }
        }
      }
      ctx.putImageData(img, 0, 0);

      // Probe reticle
      const rx = bx0 + probeUV[0] * boxSize;
      const ry = by0 + probeUV[1] * boxSize;
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(rx, ry, 6, 0, Math.PI * 2);
      ctx.stroke();

      // Right-hand spreadsheet readout
      const lx = 228;
      ctx.fillStyle = '#f5f0e6';
      ctx.font = 'bold 12px "Noto Sans SC", sans-serif';
      ctx.fillText('📖 当前采样点四页账本：', lx, 36);

      const rows = [
        { name: 'R 红页', val: pR, col: '#f87171' },
        { name: 'G 绿页', val: pG, col: '#4ade80' },
        { name: 'B 蓝页', val: pB, col: '#60a5fa' },
        { name: 'A 附页', val: pA, col: '#e5e7eb' },
      ];
      rows.forEach((row, i) => {
        const yy = 56 + i * 36;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(lx, yy, 152, 26);
        ctx.fillStyle = row.col;
        ctx.fillRect(lx, yy, Math.round(152 * row.val), 26);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.strokeRect(lx, yy, 152, 26);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
        ctx.fillText(`${row.name}: ${row.val.toFixed(2)}`, lx + 8, yy + 17);
      });
    }
  }, [tab, chanOpt, probeUV, pR, pG, pB, pA]);

  // Draw Tab 2: Leaf White Halo Bilinear Filtering Microscope
  useEffect(() => {
    if (tab !== 'leafhalo') return;
    const uCvs = unpaddedCvsRef.current;
    const pCvs = paddedCvsRef.current;
    if (!uCvs || !pCvs) return;

    const W = 380;
    const H = 220;
    uCvs.width = W;
    uCvs.height = H;
    pCvs.width = W;
    pCvs.height = H;

    const uCtx = uCvs.getContext('2d');
    const pCtx = pCvs.getContext('2d');
    if (!uCtx || !pCtx) return;

    // Build a low-res 52x34 leaf texture so bilinear edge texel bleeding is zoomed in & unmistakable!
    const TW = 56;
    const TH = 36;
    const leafAlpha = new Float32Array(TW * TH);
    const rgbUnpadded = new Float32Array(TW * TH * 3);
    const rgbPadded = new Float32Array(TW * TH * 3);

    for (let ty = 0; ty < TH; ty++) {
      const ny = (ty / (TH - 1)) * 2 - 1;
      for (let tx = 0; tx < TW; tx++) {
        const nx = (tx / (TW - 1)) * 2 - 1;
        const i = ty * TW + tx;

        // Serrated botanical leaf shape
        const centerCurve = Math.sin(nx * 1.4) * 0.1;
        const widthProfile = Math.max(0, (1 - nx * nx * 1.15) * 0.68);
        const serration = Math.sin(nx * 24) * 0.065 * (1 - Math.abs(nx) * 0.5);
        const distToMidrib = Math.abs(ny - centerCurve);
        const inside = distToMidrib < widthProfile + serration && Math.abs(nx) < 0.88;

        // Leaf green color with golden midrib & side veins
        const vein = Math.exp(-distToMidrib * 16) * 0.45 + Math.exp(-Math.abs(((nx * 8) % 1) - distToMidrib * 1.8) * 14) * 0.2;
        const lr = clamp(0.14 + vein * 0.34, 0, 1);
        const lg = clamp(0.49 + vein * 0.28, 0, 1);
        const lb = clamp(0.11 + vein * 0.06, 0, 1);

        if (inside) {
          leafAlpha[i] = 1.0;
          rgbUnpadded[i * 3] = lr;
          rgbUnpadded[i * 3 + 1] = lg;
          rgbUnpadded[i * 3 + 2] = lb;

          rgbPadded[i * 3] = lr;
          rgbPadded[i * 3 + 1] = lg;
          rgbPadded[i * 3 + 2] = lb;
        } else {
          leafAlpha[i] = 0.0;
          // UNPADDED PNG PITFALL: transparent background cleared to pure white (1, 1, 1)!
          rgbUnpadded[i * 3] = 1.0;
          rgbUnpadded[i * 3 + 1] = 1.0;
          rgbUnpadded[i * 3 + 2] = 1.0;

          // PADDED TGA/PNG SOLUTION: outward-dilated green pigment fills alpha=0 background!
          rgbPadded[i * 3] = 0.15;
          rgbPadded[i * 3 + 1] = 0.47;
          rgbPadded[i * 3 + 2] = 0.11;
        }
      }
    }

    const uImg = uCtx.createImageData(W, H);
    const pImg = pCtx.createImageData(W, H);
    const uData = uImg.data;
    const pData = pImg.data;

    for (let py = 0; py < H; py++) {
      const fy = (py / (H - 1)) * (TH - 1);
      const y0 = Math.floor(fy);
      const y1 = Math.min(TH - 1, y0 + 1);
      const wy = fy - y0;

      for (let px = 0; px < W; px++) {
        const fx = (px / (W - 1)) * (TW - 1);
        const x0 = Math.floor(fx);
        const x1 = Math.min(TW - 1, x0 + 1);
        const wx = fx - x0;

        const i00 = y0 * TW + x0;
        const i10 = y0 * TW + x1;
        const i01 = y1 * TW + x0;
        const i11 = y1 * TW + x1;

        const bilerp = (arr: Float32Array, stride: number, off: number) =>
          lerp(
            lerp(arr[i00 * stride + off], arr[i10 * stride + off], wx),
            lerp(arr[i01 * stride + off], arr[i11 * stride + off], wx),
            wy
          );

        const filtA = bilerp(leafAlpha, 1, 0);
        const ur = bilerp(rgbUnpadded, 3, 0);
        const ug = bilerp(rgbUnpadded, 3, 1);
        const ub = bilerp(rgbUnpadded, 3, 2);

        const pr = bilerp(rgbPadded, 3, 0);
        const pg = bilerp(rgbPadded, 3, 1);
        const pb = bilerp(rgbPadded, 3, 2);

        // Dark forest bokeh background
        const bgWave = Math.sin(px * 0.04) * Math.cos(py * 0.05) * 0.03;
        const bgR = 0.07 + bgWave;
        const bgG = 0.11 + bgWave;
        const bgB = 0.08 + bgWave;

        const idx = (py * W + px) * 4;

        if (xrayRgb) {
          // Reveal hidden RGB sheet directly without alpha cutout!
          uData[idx] = Math.round(ur * 255);
          uData[idx + 1] = Math.round(ug * 255);
          uData[idx + 2] = Math.round(ub * 255);
          uData[idx + 3] = 255;

          pData[idx] = Math.round(pr * 255);
          pData[idx + 1] = Math.round(pg * 255);
          pData[idx + 2] = Math.round(pb * 255);
          pData[idx + 3] = 255;
        } else {
          // UE 5.8 Masked Blend Mode: Opacity Mask Clip!
          const visible = filtA >= maskClip;
          uData[idx] = Math.round((visible ? ur : bgR) * 255);
          uData[idx + 1] = Math.round((visible ? ug : bgG) * 255);
          uData[idx + 2] = Math.round((visible ? ub : bgB) * 255);
          uData[idx + 3] = 255;

          pData[idx] = Math.round((visible ? pr : bgR) * 255);
          pData[idx + 1] = Math.round((visible ? pg : bgG) * 255);
          pData[idx + 2] = Math.round((visible ? pb : bgB) * 255);
          pData[idx + 3] = 255;
        }
      }
    }

    uCtx.putImageData(uImg, 0, 0);
    pCtx.putImageData(pImg, 0, 0);
  }, [tab, maskClip, xrayRgb]);

  const handleCardCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;
    if (chanOpt !== 'all4' && xPct < 0.54) {
      const u = clamp((xPct * 400 - 24) / 186, 0, 1);
      const v = clamp((yPct * 222 - 18) / 186, 0, 1);
      setProbeUV([u, v]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <StageSegmented<RgbaLabTab>
        value={tab}
        options={[
          { value: 'cards', label: '🃏 实验一：RGBA 四页黑白灰度账本拆页仪' },
          { value: 'leafhalo', label: '🍃 实验二：透明 PNG 树叶“刺眼白边”放大镜' },
        ]}
        onChange={setTab}
      />

      {tab === 'cards' ? (
        <>
          <div
            style={{
              borderRadius: 11,
              border: '1.5px solid var(--border-strong)',
              overflow: 'hidden',
              height: 222,
              cursor: chanOpt === 'all4' ? 'default' : 'crosshair',
            }}
          >
            <canvas
              ref={singleCvsRef}
              onClick={handleCardCanvasClick}
              style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
            />
          </div>

          <div className="stage-controls-panel">
            <StageSegmented<ChannelViewOpt>
              label="📌 点击仿真 UE 5.8 采样器引脚（注意单通道全是黑白灰度！）"
              value={chanOpt}
              options={[
                { value: 'all4', label: '📚 四页同屏拆开' },
                { value: 'rgb', label: '⚪ RGB 彩色合体' },
                { value: 'r', label: '🔴 R 红页' },
                { value: 'g', label: '🟢 G 绿页' },
                { value: 'b', label: '🔵 B 蓝页' },
                { value: 'a', label: '⬜ A 第四页' },
              ]}
              onChange={setChanOpt}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 11.5 }}>
              <span style={{ fontWeight: 700 }}>🎯 快速点选徽章部位查账：</span>
              {[
                { label: '🍁 红宝石中心', uv: [0.5, 0.5] as [number, number] },
                { label: '🌿 翡翠绿花环', uv: [0.5, 0.22] as [number, number] },
                { label: '🛡️ 宝蓝盾底', uv: [0.24, 0.5] as [number, number] },
                { label: '✂️ 盾外镂空角', uv: [0.07, 0.08] as [number, number] },
              ].map((pt) => (
                <button
                  key={pt.label}
                  type="button"
                  className="segmented-opt active"
                  onClick={() => setProbeUV(pt.uv)}
                >
                  {pt.label}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <SplitCompareContainer
            height={220}
            initialSplit={52}
            leftLabel={xrayRgb ? '❌ 直出 PNG 底层真容：纯白底 (1,1,1)' : '❌ 直出透明 PNG：边缘一圈刺眼白边！'}
            rightLabel={xrayRgb ? '✅ Padding 外扩真容：绿底无缝铺满' : '✅ 颜色外扩 (Padding) 后：叶缘干净利落'}
            leftContent={
              <canvas
                ref={unpaddedCvsRef}
                style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
              />
            }
            rightContent={
              <canvas
                ref={paddedCvsRef}
                style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
              />
            }
          />

          <div className="stage-controls-panel">
            <div className="control-grid">
              <StageToggle
                label="🔬 掀开透明遮罩：透视隐藏在 Alpha=0 底下的 RGB 颜色页"
                checked={xrayRgb}
                onChange={setXrayRgb}
                hint="秒懂白边真凶"
              />
              <StageSlider
                label="✂️ Masked 镂空裁剪阈值 (Opacity Mask Clip)"
                value={maskClip}
                min={0.12}
                max={0.78}
                step={0.01}
                onChange={setMaskClip}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

/* ============================================================================
 * 4.3 舞台：ORM 集装箱三合一打包工坊 + Alpha 翻倍陷阱表 (OrmChannelPackingStage)
 * ============================================================================ */
type PackingStateOpt = 'unpacked' | 'packed';

function evalArmorMaps(u: number, v: number, wear: number): { ao: number; rough: number; metal: number; height: number } {
  const x = u * 2 - 1;
  const y = v * 2 - 1;
  const maxAbs = Math.max(Math.abs(x), Math.abs(y));

  // Outer titanium frame vs inner painted plate
  const isFrame = maxAbs > 0.66;
  const bevelSeam = Math.exp(-Math.pow((maxAbs - 0.66) * 28, 2));

  // Corner rivets
  const cx = Math.abs(x) - 0.82;
  const cy = Math.abs(y) - 0.82;
  const rivetDist = Math.hypot(cx, cy);
  const inRivet = rivetDist < 0.085;
  const rivetRing = Math.exp(-Math.pow((rivetDist - 0.095) * 45, 2));

  // Center recessed vents
  const inVentZone = Math.abs(x) < 0.42 && Math.abs(y) < 0.36;
  const ventSlot = inVentZone ? Math.pow(Math.max(0, Math.sin(y * 28)), 4) : 0;

  const scratch = fbm(u * 14, v * 14, 3);
  const edgeWear = isFrame || (bevelSeam > 0.35 && scratch > 1 - wear * 0.85);

  const ao = clamp(1.0 - bevelSeam * 0.72 - rivetRing * 0.65 - ventSlot * 0.78, 0.12, 1.0);
  const metal = inRivet || edgeWear ? 1.0 : 0.0;
  const rough = inRivet
    ? 0.24
    : metal > 0.5
    ? clamp(0.22 + scratch * 0.26, 0.14, 0.52)
    : clamp(0.68 - scratch * 0.16 * wear, 0.35, 0.82);
  const height = clamp((isFrame ? 0.78 : 0.45) + (inRivet ? 0.2 : 0) - bevelSeam * 0.28 - ventSlot * 0.32, 0.05, 1.0);

  return { ao, rough, metal, height };
}

const OrmChannelPackingStage: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [packMode, setPackMode] = useState<PackingStateOpt>('packed');
  const [packedFormat, setPackedFormat] = useState<'bc1bc3' | 'bc7'>('bc1bc3');
  const [stuffAlpha4th, setStuffAlpha4th] = useState<boolean>(false);
  const [masksNoSrgb, setMasksNoSrgb] = useState<boolean>(true);
  const [wearAmt, setWearAmt] = useState<number>(0.55);

  const ormTexCvsRef = useRef<HTMLCanvasElement>(null);
  const pbrPreviewCvsRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setPackMode('packed');
    setPackedFormat('bc1bc3');
    setStuffAlpha4th(false);
    setMasksNoSrgb(true);
    setWearAmt(0.55);
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 0) {
      setPackMode('packed');
      setStuffAlpha4th(false);
      setMasksNoSrgb(true);
    } else if (stepIndex === 1) {
      setPackMode('unpacked');
      setStuffAlpha4th(false);
    } else if (stepIndex === 2 || stepIndex === 3) {
      setPackMode('packed');
      setStuffAlpha4th(false);
      setMasksNoSrgb(true);
    } else if (stepIndex === 4) {
      setPackMode('packed');
      setStuffAlpha4th(true);
    }
  }, [stepIndex]);

  // 2048x2048 with Mipmaps (5,592,405 texels):
  // BC1 = 0.5 bytes/texel = 2.67 MB; BC3 = 1.0 byte/texel = 5.33 MB; 3x BC1 = 8.00 MB
  const vramMb = packMode === 'unpacked' ? 8.0 : packedFormat === 'bc7' || stuffAlpha4th ? 5.33 : 2.67;
  const samplerCount = packMode === 'unpacked' ? 3 : 1;
  const bcFormat = packMode === 'unpacked' ? '3 × BC1（每张约 2.67 MiB）' : packedFormat === 'bc7' ? 'BC7 · RGB/RGBA 均为 16 字节/块' : stuffAlpha4th ? 'BC3 · 16 字节/块' : 'BC1 · 8 字节/块';

  useEffect(() => {
    onKpiUpdate([
      {
        label: '2048² 完整 mip 链 · 格式预算',
        value: `${vramMb.toFixed(2)} MiB`,
        sub: bcFormat,
        tone: 'neutral',
      },
      {
        label: '每像素查表跑腿次数',
        value: `${samplerCount} 次采样`,
        sub: samplerCount === 1 ? '一趟带回 AO + 粗糙 + 金属' : '三张图分跑三趟浪费带宽',
        tone: samplerCount === 1 ? 'good' : 'warn',
      },
      {
        label: '示例 G = 0.5 的粗糙度',
        value: (masksNoSrgb ? 0.5 : srgbToLinear(0.5)).toFixed(4),
        sub: masksNoSrgb ? '线性读取 G' : '全部 RGB 分量误做 sRGB 解码',
        tone: masksNoSrgb ? 'accent' : 'bad',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packMode, stuffAlpha4th, masksNoSrgb, vramMb, samplerCount, bcFormat]);

  useEffect(() => {
    const texCvs = ormTexCvsRef.current;
    const pbrCvs = pbrPreviewCvsRef.current;
    if (!texCvs || !pbrCvs) return;

    const TW = 210;
    const TH = 190;
    texCvs.width = TW;
    texCvs.height = TH;
    pbrCvs.width = TW;
    pbrCvs.height = TH;

    const tCtx = texCvs.getContext('2d');
    const pCtx = pbrCvs.getContext('2d');
    if (!tCtx || !pCtx) return;

    const tImg = tCtx.createImageData(TW, TH);
    const pImg = pCtx.createImageData(TW, TH);
    const tData = tImg.data;
    const pData = pImg.data;

    const L: Vec3 = norm3([0.55, 0.58, 0.6]);
    const V: Vec3 = [0, 0, 1];

    for (let py = 0; py < TH; py++) {
      const v = py / (TH - 1);
      for (let px = 0; px < TW; px++) {
        const u = px / (TW - 1);
        const idx = (py * TW + px) * 4;

        if (packMode === 'packed') {
          // Draw iconic purple-green synthesized ORM texture!
          const m = evalArmorMaps(u, v, wearAmt);
          tData[idx] = Math.round(m.ao * 255);      // R = Occlusion
          tData[idx + 1] = Math.round(m.rough * 255); // G = Roughness
          tData[idx + 2] = Math.round(m.metal * 255); // B = Metallic
          tData[idx + 3] = 255;
        } else {
          // Draw 3 split horizontal bands showing the 3 separate grayscale maps (AO / Rough / Metal)
          const band = py < TH / 3 ? 0 : py < (TH * 2) / 3 ? 1 : 2;
          const localV = ((py % Math.floor(TH / 3)) / Math.floor(TH / 3));
          const m = evalArmorMaps(u, localV, wearAmt);
          const gVal = band === 0 ? m.ao : band === 1 ? m.rough : m.metal;
          const byte = Math.round(gVal * 255);
          tData[idx] = byte;
          tData[idx + 1] = byte;
          tData[idx + 2] = byte;
          tData[idx + 3] = 255;
        }

        // Right Canvas: Shaded 3D beveled sci-fi armor shield reading from the ORM values!
        const sx = ((px - TW * 0.5) / (TH * 0.45));
        const sy = ((TH * 0.5 - py) / (TH * 0.45));
        if (Math.abs(sx) < 0.92 && Math.abs(sy) < 0.92) {
          const mu = (sx / 0.92) * 0.5 + 0.5;
          const mv = (-sy / 0.92) * 0.5 + 0.5;
          const m = evalArmorMaps(mu, mv, wearAmt);
          const mR = evalArmorMaps(clamp(mu + 0.015, 0, 1), mv, wearAmt);
          const mU = evalArmorMaps(mu, clamp(mv - 0.015, 0, 1), wearAmt);

          const nx = sx * 0.28 - (mR.height - m.height) * 5.5;
          const ny = sy * 0.28 + (mU.height - m.height) * 5.5;
          const N = norm3([nx, ny, 1.0]);

          // BaseColor: tactical teal-blue paint on non-metal, bright titanium on metal
          const baseLin: Vec3 = m.metal > 0.5 ? [0.58, 0.61, 0.66] : [0.03, 0.14, 0.24];
          const usedRough = masksNoSrgb ? m.rough : srgbToLinear(m.rough);
          const usedAo = masksNoSrgb ? m.ao : srgbToLinear(m.ao);

          const shaded = shadePbrPixel({
            N,
            V,
            L,
            baseColorLinear: baseLin,
            metallic: masksNoSrgb ? m.metal : srgbToLinear(m.metal),
            roughness: usedRough,
            ao: usedAo,
            lightIntensity: 2.5,
            envMode: 'studio',
          });

          pData[idx] = Math.round(shaded[0] * 255);
          pData[idx + 1] = Math.round(shaded[1] * 255);
          pData[idx + 2] = Math.round(shaded[2] * 255);
          pData[idx + 3] = 255;
        } else {
          pData[idx] = 24;
          pData[idx + 1] = 22;
          pData[idx + 2] = 20;
          pData[idx + 3] = 255;
        }
      }
    }

    tCtx.putImageData(tImg, 0, 0);
    pCtx.putImageData(pImg, 0, 0);

    if (packMode === 'unpacked') {
      tCtx.font = 'bold 10.5px "Noto Sans SC", sans-serif';
      const labels = ['贴图1: AO遮蔽 (2.67 MiB)', '贴图2: 粗糙度 (2.67 MiB)', '贴图3: 金属度 (2.67 MiB)'];
      labels.forEach((lb, i) => {
        const yy = Math.floor((TH / 3) * i) + 4;
        tCtx.fillStyle = 'rgba(15,14,12,0.82)';
        tCtx.fillRect(5, yy, 134, 17);
        tCtx.fillStyle = '#fde68a';
        tCtx.fillText(lb, 9, yy + 12);
      });
    }
  }, [packMode, wearAmt, masksNoSrgb]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <StageSegmented<PackingStateOpt>
          value={packMode}
          options={[
            { value: 'unpacked', label: '📦 打包前：3 张独立 BC1 (8.00 MiB)' },
            { value: 'packed', label: 'ORM 三图合一' },
          ]}
          onChange={(v) => {
            setPackMode(v);
            if (v === 'unpacked') setStuffAlpha4th(false);
          }}
        />
        <StageToggle
          label="✅ UE 5.8 压缩设为 Masks (自动禁勾 sRGB)"
          checked={masksNoSrgb}
          onChange={setMasksNoSrgb}
        />
      </div>

      {/* 3-Column Visual Packing Bench */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
          gap: 9,
          alignItems: 'stretch',
        }}
      >
        {/* Column 1: Channel Assignment Cards */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 11,
            padding: '9px 10px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 6,
            fontSize: 11.5,
          }}
        >
          <div style={{ fontWeight: 800, color: 'var(--text-secondary)' }}>📥 集装箱分舱清单 (O-R-M)：</div>
          <div style={{ padding: '5px 7px', borderRadius: 7, borderLeft: '4px solid #ef4444', background: 'var(--bg-panel)' }}>
            <strong>R 红槽 ← O (AO 环境遮蔽)</strong>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>BC1 块的两个红端点各 5 位</div>
          </div>
          <div style={{ padding: '5px 7px', borderRadius: 7, borderLeft: '4px solid #22c55e', background: 'var(--accent-sage)', color: 'var(--accent-sage-deep)' }}>
            <strong>G 绿槽 ← R (粗糙度)</strong>
            <div style={{ fontSize: 10.5 }}>BC1 的两个绿端点各 <strong>6 位</strong></div>
          </div>
          <div style={{ padding: '5px 7px', borderRadius: 7, borderLeft: '4px solid #3b82f6', background: 'var(--bg-panel)' }}>
            <strong>B 蓝槽 ← M (金属度)</strong>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>BC1 块的两个蓝端点各 5 位</div>
          </div>
          {stuffAlpha4th && (
            <div style={{ padding: '5px 7px', borderRadius: 7, borderLeft: '4px solid #dc2626', background: 'var(--accent-coral)', color: 'var(--accent-coral-deep)' }}>
              <strong>A 第四槽 ← 高度数据</strong>
              <div style={{ fontSize: 10.5 }}>{packedFormat === 'bc7' ? 'BC7 保持 16 字节/块' : '本预算把目标格式切到 BC3'}</div>
            </div>
          )}
        </div>

        {/* Column 2: Synthesized ORM Purple-Green Texture */}
        <div
          style={{
            position: 'relative',
            borderRadius: 11,
            border: '1.5px solid var(--border-strong)',
            overflow: 'hidden',
            minHeight: 186,
            background: '#171513',
          }}
        >
          <canvas
            ref={ormTexCvsRef}
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
          <span
            style={{
              position: 'absolute',
              bottom: 6,
              left: 6,
              right: 6,
              padding: '3px 7px',
              borderRadius: 6,
              background: 'rgba(18,16,14,0.84)',
              color: '#fff',
              fontSize: 10.5,
              fontWeight: 700,
              textAlign: 'center',
            }}
          >
            {packMode === 'packed' ? '🎨 合体 T_Armor_ORM (紫绿花脸)' : '📚 打包前：3 张灰图各自独立'}
          </span>
        </div>

        {/* Column 3: Live Shaded 3D Sci-Fi Armor Panel */}
        <div
          style={{
            position: 'relative',
            borderRadius: 11,
            border: '1.5px solid var(--border-strong)',
            overflow: 'hidden',
            minHeight: 186,
            background: '#171513',
          }}
        >
          <canvas
            ref={pbrPreviewCvsRef}
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
          <span
            style={{
              position: 'absolute',
              bottom: 6,
              left: 6,
              right: 6,
              padding: '3px 7px',
              borderRadius: 6,
              background: masksNoSrgb ? 'rgba(22,74,36,0.86)' : 'rgba(128,28,22,0.88)',
              color: '#fff',
              fontSize: 10.5,
              fontWeight: 700,
              textAlign: 'center',
            }}
          >
            {masksNoSrgb ? '🛡️ 拆通道还原出写实机甲护板' : '❌ 漏设 Masks (误开sRGB) 护板泛油光'}
          </span>
        </div>
      </div>

      <small>预览用程序生成的 AO、粗糙度、金属度样本。下面的格式选择仅计算块存储预算，不对预览执行 BC 编码。</small>
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1.5px solid var(--border-strong)',
          borderRadius: 10,
          padding: '9px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, fontSize: 12, fontWeight: 800 }}>
          <span>💾 2048×2048 完整 mip 链估算 · {vramMb.toFixed(2)} MiB</span>
          <span style={{ color: stuffAlpha4th ? '#c93b2b' : packMode === 'packed' ? '#2e6f1e' : '#b45309' }}>
            {packMode === 'unpacked'
              ? '假设三张独立 BC1；同 UV 各采样一次'
              : bcFormat}
          </span>
        </div>
        <div style={{ height: 11, borderRadius: 999, background: 'var(--bg-subtle)', overflow: 'hidden', border: '1px solid var(--border-soft)' }}>
          <div
            style={{
              height: '100%',
              width: `${(vramMb / 8.0) * 100}%`,
              background: stuffAlpha4th ? '#dc2626' : packMode === 'packed' ? '#4d9c30' : '#d97706',
              transition: 'width 0.25s ease, background 0.2s ease',
            }}
          />
        </div>
      </div>

      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSegmented<'bc1bc3' | 'bc7'>
            label="打包纹理的目标格式假设"
            value={packedFormat}
            options={[{ value: 'bc1bc3', label: 'RGB 用 BC1 / RGBA 用 BC3' }, { value: 'bc7', label: 'RGB 与 RGBA 都用 BC7' }]}
            onChange={value => { setPackedFormat(value); setPackMode('packed'); }}
          />
          <StageToggle
            label="加入第四通道 Alpha 高度数据"
            checked={stuffAlpha4th}
            onChange={(checked) => {
              setPackMode('packed');
              setStuffAlpha4th(checked);
            }}
            hint="比较当前目标像素格式的块大小"
          />
          <StageSlider
            label="🔧 调整护甲边缘金属掉漆磨损度"
            value={wearAmt}
            min={0.0}
            max={1.0}
            step={0.02}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onChange={setWearAmt}
          />
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 模块 03 与 模块 04 完整课程定义导出
 * ============================================================================ */
export const modules03_04: ModuleDefinition[] = [
  {
    id: '03',
    number: '03',
    title: '色彩空间通识',
    subtitle: '人眼的“偏心眼”与贴图发白/死黑之谜',
    lessons: [
      {
        id: 'human-eye-and-gamma',
        moduleId: '03',
        number: '3.1',
        title: '数码图片是怎么存亮度的？—— 二进制台阶、人眼暗部偏心与 Gamma 编码起源',
        subtitle: '只有 256 级亮度台阶，人类怎么靠“偏心分配”骗过极其挑剔的眼睛？',
        duration: '9 分钟',
        difficulty: '零基础',
        StageComponent: HumanEyeGammaStage,
        steps: [
          {
            stepNumber: 1,
            shortLabel: '火柴与太阳',
            tag: 'phenomenon',
            title: '黑屋里划亮 1 根火柴 vs 正午大太阳下划亮 10 根火柴',
            paragraphs: [
              '先来做个小脑洞：走进伸手不见五指的黑卧室，咔嚓划亮 **1 根火柴**——整间屋子瞬间从漆黑变得清晰可见！可如果你站在正午烈日当头的操场上，再一口气划亮 **10 根火柴**，你的眼睛能察觉周围变亮哪怕一丁点吗？完全不能！',
              '这就是人类进化出来的生理本能：**人眼是个超级“偏心眼”——对暗部微弱的光线变化极其敏感，对亮部的强光变化却非常迟钝。** 先瞄一眼左侧舞台，为什么同样只给 16 种深浅灰色，左半张脸的阴影碎成了一圈圈难看的等高线，右半张脸却柔和得多？',
            ],
            tryItPrompt: '来回拖动画面中间的白色对比拉帘，对比石膏像暗部脸颊：左边碎成了几块生硬色斑，右边为什么过渡自然？',
          },
          {
            stepNumber: 2,
            shortLabel: '二进制台阶',
            tag: 'background',
            title: '8 个开关凑出 256 级台阶：按物理平分就会酿成暗部灾难',
            paragraphs: [
              '补一点点超好懂的电脑常识：计算机底层只认识“断电 `0`”和“通电 `1`”两种开关状态（1 个开关叫 `1-bit`）。普通图片给每种颜色配了 **8 个开关（`8-bit`）**，排列组合一共只能存下 `2⁸ = 256` **级亮度台阶**（也就是常见的 `0 ~ 255`）。',
              '如果我们耿直地按**真实物理光子数量（`Linear` 线性平分）**把这 256 级台阶均匀切开，灾难就发生了：整整一半的宝贵名额（`128 ~ 255`）全浪费在了人眼根本分不清的大亮部；而在人眼最挑剔的整个暗部半程里，居然只分到了区区几十级台阶，阴影当场断裂成丑陋的**色带断层（Banding）**！',
            ],
            tryItPrompt: '观察画面下方的「台阶分配透视尺」第一行红线：在 16 级模式下，暗部半程只分到了可怜的 4 道红线，其余全挤在右边亮部！',
            callout: {
              tone: 'tip',
              title: '大白话记住 Bit（位深）',
              body: '`4-bit` = 16 级台阶，`5-bit` = 32 级，`8-bit` = 256 级，`16-bit` = 65,536 级。开关越多，台阶越密，文件体积也越大。',
            },
          },
          {
            stepNumber: 3,
            shortLabel: '偏心加密实验',
            tag: 'experiment',
            title: '把台阶往暗部使劲挤一挤：`sRGB`（Gamma 编码）的省钱神技',
            paragraphs: [
              'sRGB 用分段传递函数为暗部保留更密的线性亮度台阶。解码时，编码值 E ≤ 0.04045 用 E / 12.92，其余用 ((E + 0.055) / 1.055) ^ 2.4。常见的 E ^ 2.2 是近似，0.5 得 0.2176；本课读数和图像统一使用标准分段函数，0.5 得 0.2140。',
              '编码和解码互为逆运算。写入有限位深时仍会量化；相同码值数量下，sRGB 通常能减轻可见暗部色带。',
            ],
            tryItPrompt: '把台阶数依次切换到 `32 级` 与 `256 级`，并切换「丝绒球 + 底部渐变尺」，亲眼见证偏心加密如何在极少台阶下消灭暗部断层！',
          },
          {
            stepNumber: 4,
            shortLabel: '照片默认sRGB',
            tag: 'ue5',
            title: '走进日常与 UE 5.8：你手机拍的、画师画的照片天生都是 `sRGB`',
            paragraphs: [
              '常见的网页图像和供 sRGB 显示使用的颜色贴图按 sRGB 编码。宽色域照片及线性 EXR 也很常见，导入前要核对源图的色彩空间。',
              '当你把这样一张颜色图片拖进 **UE 5.8** 时，引擎纹理面板里会自动帮它打上 `sRGB` 勾号，相当于贴上一张提醒条：“注意！这张图里的数字是为了省空间被拉高过的，算光照前记得先还原哦！”',
            ],
            tryItPrompt: '拖动最下方的「黄色探针滑块」停在 `50%` 处：看看人眼觉得正好一半亮的中灰色（存盘值 `128`），真实物理光子其实只有多少？',
            callout: {
              tone: 'ue58',
              title: 'UE 5.8 自动识别机制',
              body: '导入普通 8-bit 彩色 PNG/TGA 时，UE 5.8 默认开启 `sRGB = True`；若导入 16-bit EXR 高动态图，引擎会自动关闭 `sRGB` 按线性光读取。',
            },
          },
          {
            stepNumber: 5,
            shortLabel: '防坑口诀',
            tag: 'pitfall',
            title: '一句话埋下伏笔：人眼看中灰 `0.5`，对应线性值约 `0.2140`',
            paragraphs: [
              '刚才拖动黄色探针你一定发现了那个反直觉的真相：在 `sRGB` 图片里写着 **`0.5`（8 位近似码值为 128，恰好 128/255 解码约为 0.2159）** 的像素，还原回真实物理世界后，其实只反射了约 **`21.4%`（不到四分之一）** 的光能！',
              '千万记住这个“账面数字虚高”的特点——存照片看图时它是省钱大功臣，但下一节咱们进引擎拿它做灯光加减法时，如果不先换算回真实物理账本，就会闹出大笑话！',
            ],
            tryItPrompt: '点击顶部对比栏「看踩坑现象 / 切正确配置」，最后重温一遍物理平分断层与 `sRGB` 丝滑暗部的视觉冲击。',
          },
        ],
        takeaways: [
          '普通 `8-bit` 图片每个颜色通道只有 `2⁸ = 256` 级亮度台阶。',
          '人眼对暗部变化极度敏感、对亮部迟钝，若按物理光均匀平分台阶，暗部会碎成色带断层（Banding）。',
          '`sRGB`（Gamma 编码）存图时故意把暗部拉宽多占台阶，显示器播放时再自动压暗还原。',
          '`sRGB` 里看似一半亮的 `0.5` 中灰色，对应的真实物理光能其实只有约 `21.4%`（标准分段解码）。',
        ],
        schematic: {
          title: 'sRGB 偏心存图与屏幕还原闭环',
          caption: '存图时提亮暗部抢占 8-bit 台阶，屏幕发光时压暗还原，骗过挑剔的人眼',
          nodes: [
            {
              id: 'phys_world',
              title: '真实物理光能',
              subtitle: 'Linear 物理空间',
              category: 'input',
              x: 24,
              y: 70,
              width: 175,
              outputs: [{ id: 'photons', label: '物理中灰 0.2140', color: '#38bdf8' }],
              note: '真实反射 21.4% 光子',
            },
            {
              id: 'encode_srgb',
              title: '存图编码提亮',
              subtitle: '标准 sRGB 分段编码',
              category: 'pipeline',
              x: 245,
              y: 70,
              width: 180,
              inputs: [{ id: 'in', label: '物理光输入', color: '#38bdf8' }],
              outputs: [{ id: 'srgb', label: '拉高为 0.50', color: '#4ade80' }],
              note: '暗部挤占一半台阶',
            },
            {
              id: 'file_8bit',
              title: '8-bit 图片文件',
              subtitle: '0~255 共 256 级台阶',
              category: 'texture',
              x: 470,
              y: 70,
              width: 175,
              previewColor: '#808080',
              inputs: [{ id: 'in', label: '量化存盘', color: '#4ade80' }],
              outputs: [{ id: 'byte', label: '读出 128/255 ≈ 0.5020', color: '#facc15' }],
            },
            {
              id: 'screen_out',
              title: '显示器压暗发光',
              subtitle: 'sRGB 分段解码',
              category: 'output',
              x: 690,
              y: 70,
              width: 180,
              inputs: [{ id: 'in', label: '送入屏幕', color: '#facc15' }],
              note: '码值 128 解码约 21.59%',
            },
          ],
          edges: [
            { fromNode: 'phys_world', fromPin: 'photons', toNode: 'encode_srgb', toPin: 'in', color: '#38bdf8' },
            { fromNode: 'encode_srgb', fromPin: 'srgb', toNode: 'file_8bit', toPin: 'in', color: '#4ade80' },
            { fromNode: 'file_8bit', fromPin: 'byte', toNode: 'screen_out', toPin: 'in', color: '#facc15' },
          ],
        },
      },
      {
        id: 'srgb-vs-linear-math',
        moduleId: '03',
        number: '3.2',
        title: '存图用 sRGB，算光用 Linear —— 为什么“中灰 0.5”其实只反射了 21.4% 的相对亮度？',
        subtitle: '拿“打折拉高过的外币账单”直接做加法，灯光会过曝、红绿渐变会发脏发黑！',
        duration: '10 分钟',
        difficulty: '零基础',
        StageComponent: SrgbVsLinearMathStage,
        steps: [
          {
            stepNumber: 1,
            shortLabel: '红绿脏黑带',
            tag: 'phenomenon',
            title: '两桩奇案：两盏微光灯叠出刺眼死白？红配绿混出脏泥巴带？',
            paragraphs: [
              '既然 `sRGB` 存照片那么聪明，为什么一进游戏引擎算光影就闯祸了？请看左侧舞台左半屏的两桩怪现象：',
              '第一桩：墙上打两盏温和的 `0.5` 聚光灯，交叠处不是自然变亮，而是突兀地炸成一片**刺眼死白（`1.0`）**；第二桩：看底部的红绿渐变条，鲜红过渡到翠绿，正中间居然夹着一条像脏泥水一样的**暗褐色黑带**！早年无数老修图软件和老游戏都栽在这条脏黑带上。',
            ],
            tryItPrompt: '把中间的对比拉帘从左往右来回拉动：对比上半屏两盏灯交叠柔和度，再看下半屏红绿交界处是如何从“脏泥水”变成“鲜亮金黄”的！',
          },
          {
            stepNumber: 2,
            shortLabel: '外币换算账',
            tag: 'background',
            title: '`sRGB` 是拉伸过的外币账单：不换算直接相加肯定算错账！',
            paragraphs: [
              '打个比方就全通了：`sRGB` 里的数字是为了省空间被人为拉高过的“外币账单”。上一节我们刚验证过，账面写着 `0.5` 的灯，真实物理光能只有 **`0.2140`（21.4%）**！',
              '两束编码值 0.5 的灰光都满强度照在同一点，在线性空间相加得到 0.4281，重新编码约 0.6858。直接加编码值则得到 1.0。渐变中的线性红、绿分量也要各自解码后再插值。',
            ],
            tryItPrompt: '把底部混色组切换到 `暖橙 ↔ 宝蓝` 和 `亮青 ↔ 品红`，看看在错误空间直接混色是不是每一组中间都会发灰发暗！',
            callout: {
              tone: 'formula',
              title: '两行算式看穿本质',
              body: '错误硬加：0.5 + 0.5 = 1.00（100% 过曝死白） ｜ 正确线性：2 × 0.21404 ≈ 0.42808 物理光 → 转回屏幕 sRGB 编码后约 0.6858',
            },
          },
          {
            stepNumber: 3,
            shortLabel: '双实验拉帘',
            tag: 'experiment',
            title: '亲手调灯验证：物理世界 `Linear` 让光照和混色重回真实',
            paragraphs: [
              '现在看右半屏的正确做法：先把所有参与运算的颜料和灯光统一还原回**真实物理空间（`Linear` 线性空间）**。两盏灯 `2 × 0.21404 ≈ 0.42808`，算完后再打包回 `sRGB`（`0.6858`）发给屏幕——交叠区柔和通透，毫无生硬断崖！',
              '红绿各占一半时，线性 RGB 为 (0.5, 0.5, 0)。分别做 sRGB 编码，得到约 (0.7354, 0.7354, 0)，中点比直接在编码空间插值更亮。',
            ],
            tryItPrompt: '拖动「单盏聚光灯账面读数」滑块从 `0.30` 拉到 `0.70`，同步观察中间三格换算条里 `进门去伽马 → 线性相加 → 出门加伽马` 的实时数字！',
          },
          {
            stepNumber: 4,
            shortLabel: '三明治管线',
            tag: 'ue5',
            title: '走进 UE 5.8：引擎全自动“三明治”线性渲染管线',
            paragraphs: [
              'UE 在采样开启 sRGB 的颜色图时执行解码，照明与颜色混合在线性空间进行。普通 Add、Multiply、Lerp 只计算传入的数值，因此纹理的读取方式仍需要作者正确配置。',
              '引擎在后台自动帮你包好了一块“三明治”：① **进门解码**：勾了 `sRGB` 的颜色贴图一进门就自动按 sRGB 分段函数解码为线性值；② **中间算光**：所有材质节点与灯光纯粹按物理光子算数；③ **出门上屏**：画面最终送往显示器前，由色调映射器统一加上 `sRGB` 给眼睛看！',
            ],
            tryItPrompt: '调整「两盏聚光灯靠拢重叠度」滑块，感受 UE 5.8 `Lumen` 多光源叠加时右半屏那种自然柔顺的真实光感。',
          },
          {
            stepNumber: 5,
            shortLabel: '吸色器陷阱',
            tag: 'pitfall',
            title: '实战避坑：Photoshop 吸出来的色号，填进 UE 5.8 怎么突然泛白了？',
            paragraphs: [
              '新手最常踩的隐藏坑：你在修图软件里吸了一个好看的深咖啡色 `(R=128, G=80, B=50)`，除以 255 算出 `(0.5, 0.31, 0.2)`，手敲进材质的 `Constant3Vector` 三维常量数字框里——结果模型瞬间变得惨白发浅！',
              '原因一捅就破：材质常量数字框直接处于 **`Linear` 物理空间**，而修图软件给你看的是 **`sRGB` 账面数**！正确做法：双击打开 UE 5.8 拾色器（Color Picker），把色号粘贴进右下角的 **`Hex sRGB`（十六进制 sRGB）** 输入框，引擎就会自动帮你换算成准确的物理值！',
            ],
            tryItPrompt: '点击顶部对比栏切换「看踩坑现象」与「切正确配置」，牢记“存图看图用 sRGB，进引擎算数一律用 Linear”！',
            callout: {
              tone: 'warn',
              title: '拾色器粘贴色号看清后缀！',
              body: 'UE 5.8 拾色器右侧有两个十六进制框：`Hex Linear` 和 `Hex sRGB`。从网页、Figma、Photoshop 复制来的 `#RRGGBB` 色号一律粘贴到 **`Hex sRGB`** 框里！',
            },
          },
        ],
        takeaways: [
          '直接拿 `sRGB` 数字做加法或 `Lerp` 混色，会导致灯光交叠过曝、互补色渐变中间出现脏黑带。',
          '所有光照计算、颜色相乘与混合，必须在真实物理能量成正比的 **`Linear`（线性空间）** 中进行。',
          'UE 5.8 采用全自动三明治管线：颜色图进门去伽马还原 `Linear` → 纯线性算光 → 出门转回 `sRGB` 上屏。',
          '从修图软件复制 `#RRGGBB` 颜色到 UE 5.8 拾色器时，务必粘进 **`Hex sRGB`** 栏而非 `Hex Linear`。',
        ],
        schematic: {
          title: 'UE 5.8 线性空间算光“三明治”管线',
          caption: '进门脱掉 sRGB 外衣还原物理真值，在纯线性空间算完一切光照，出门再穿回 sRGB 外衣上屏',
          nodes: [
            {
              id: 'tex_in',
              title: '彩色贴图文件',
              subtitle: 'sRGB 账面存值 0.50',
              category: 'texture',
              x: 20,
              y: 35,
              width: 175,
              previewColor: '#808080',
              outputs: [{ id: 'srgb', label: 'sRGB 读数', color: '#facc15' }],
            },
            {
              id: 'decode',
              title: '① 进门去伽马解码',
              subtitle: 'sRGB → Linear（分段解码）',
              category: 'pipeline',
              x: 235,
              y: 35,
              width: 185,
              inputs: [{ id: 'in', label: '0.50', color: '#facc15' }],
              outputs: [{ id: 'lin', label: '物理 0.2140', color: '#38bdf8' }],
            },
            {
              id: 'scene_light',
              title: '场景灯光与材质常量',
              subtitle: '天生处于 Linear 空间',
              category: 'param',
              x: 235,
              y: 165,
              width: 185,
              outputs: [{ id: 'lgt', label: '物理光能', color: '#38bdf8' }],
            },
            {
              id: 'pbr_math',
              title: '② Linear 线性空间算光',
              subtitle: 'Add / Lerp / Substrate / Lumen',
              category: 'math',
              x: 465,
              y: 90,
              width: 195,
              inputs: [
                { id: 'albedo', label: '物理反射率', color: '#38bdf8' },
                { id: 'light', label: '物理照明', color: '#38bdf8' },
              ],
              outputs: [{ id: 'hdr', label: '合成物理光', color: '#a855f7' }],
            },
            {
              id: 'tonemap_out',
              title: '③ 出门色调映射 + sRGB',
              subtitle: '色调映射与显示编码',
              category: 'output',
              x: 700,
              y: 90,
              width: 185,
              inputs: [{ id: 'in', label: '最终像素', color: '#a855f7' }],
            },
          ],
          edges: [
            { fromNode: 'tex_in', fromPin: 'srgb', toNode: 'decode', toPin: 'in', color: '#facc15' },
            { fromNode: 'decode', fromPin: 'lin', toNode: 'pbr_math', toPin: 'albedo', color: '#38bdf8' },
            { fromNode: 'scene_light', fromPin: 'lgt', toNode: 'pbr_math', toPin: 'light', color: '#38bdf8' },
            { fromNode: 'pbr_math', fromPin: 'hdr', toNode: 'tonemap_out', toPin: 'in', color: '#a855f7' },
          ],
        },
      },
      {
        id: 'ue58-srgb-golden-rule',
        moduleId: '03',
        number: '3.3',
        title: 'UE 5.8 贴图第一铁律 —— 一句话分清哪些图必勾 sRGB、哪些图严禁勾！',
        subtitle: '忘勾变“粉笔灰白木箱”，误勾变“泼油溜冰场”——亲手拨动开关抓现行！',
        duration: '10 分钟',
        difficulty: '零基础',
        StageComponent: Ue58SrgbGoldenRuleStage,
        steps: [
          {
            stepNumber: 1,
            shortLabel: '宝箱变脸案',
            tag: 'phenomenon',
            title: '美术辛辛苦苦画好的复古红木宝箱，导进引擎怎么全毁了？',
            paragraphs: [
              '几乎每位虚幻新手在第一周都会撞上这两起“灵异惨案”：明明在贴图软件里调得醇厚温润的深红木宝箱，导进引擎一连上，木头竟像被人**撒了一层白面粉一样惨白发灰**（看左侧当前视口）！',
              '或者反过来，原本画的是粗糙沧桑的干木板与锻铁箍，进关卡一打光，整只箱子居然像**刚被人泼了一桶色拉油一样油亮刺眼**！贴图文件明明一个像素都没坏，罪魁祸首只是面板上一个小小的勾号！',
            ],
            tryItPrompt: '点击舞台上方的「✅ 标准正确配置」按钮，再点回「❌ 颜色忘勾」和「❌ 粗糙度误勾」，直观感受宝箱在这三种状态下的巨大反差！',
          },
          {
            stepNumber: 2,
            shortLabel: '两类贴图本质',
            tag: 'background',
            title: '灵魂分家：虽然都存成图片，但“颜色照片”和“数学表格”是两个物种！',
            paragraphs: [
              '为什么有的图必须解码，有的图一解码就完蛋？因为游戏里的贴图虽然长着一样的 `.PNG / .TGA` 后缀，骨子里却分属两大阵营：',
              '第一类叫 **颜色照片（Color）**：画师看着显示器画出来的木纹色、皮肤色、霓虹发光图案，存盘时已经被 `sRGB` 提亮过了，进门必须解码压回来；第二类叫 **纯数学表格（Data）**：画师在粗糙度图里涂 `0.5` 中灰，并不是想要“灰颜色”，而是字面意思想填 **`50%` 粗糙度这个数字**！它本来就是直来直去的线性数字，根本没被提亮过！',
            ],
            tryItPrompt: '盯着舞台底部的「实时三段数据追踪」栏，对比颜色贴图 `0.45` 和粗糙度贴图 `0.52` 在进门解码那一步截然不同的命运。',
          },
          {
            stepNumber: 3,
            shortLabel: '亲手拨勾测试',
            tag: 'experiment',
            title: '亲手拨动两个 `sRGB` 勾选框，当场抓获“算歪”全过程',
            paragraphs: [
              '现在来亲手破案！看右侧仿真的 UE 5.8 面板：当你把「木纹颜色图」的 `sRGB` 勾去掉时，原本代表 `0.17` 深红木的 `0.45` 未经压暗直接溜进材质，出门上屏时又被显示器白白提亮一遍变成 **`0.7014`**——双重提亮，红木当场变粉笔灰！',
              '再试着故意勾上「粗糙度图」的 `sRGB`：原本五成哑光的 `0.52` 一进门就被引擎自作聪明按 sRGB 分段函数解码为 **`0.23`**（同样光照下高光更集中）——干爽木箱瞬间变成油光锃亮的溜冰场！',
            ],
            tryItPrompt: '自由点击右侧两个 `勾选 sRGB` 开关，并左右拖动底部的「检视灯光角度」滑块，观察铁箍与木纹上的高光如何随开关突变！',
          },
          {
            stepNumber: 4,
            shortLabel: 'UE5.8面板设置',
            tag: 'ue5',
            title: '走进 UE 5.8 实机操作：改完贴图 `sRGB`，别忘了看材质采样器类型！',
            paragraphs: [
              '在 **UE 5.8** 中双击打开贴图资产，右侧 `Details` 面板里找到 `Texture -> sRGB` 即可开关；更省心的办法是直接把数据图的 **压缩设置（Compression Settings）** 改成 `Masks (no sRGB)` 或 `Grayscale`，引擎会自动帮你取消 `sRGB`！',
              '同时留心一个小联动：如果你把一张已经在材质里连好线的贴图取消了 `sRGB`，记得回到材质编辑器点击那颗 `Texture Sample` 节点，确认左下角 **`Sampler Type`（采样类型）** 也同步变成了 `Linear Color`、`Linear Grayscale` 或 `Masks`，否则节点底部会亮起红色报错提醒你两者不匹配！',
            ],
            tryItPrompt: '把两个开关调回「颜色图打勾 ✓、粗糙度不打勾 ✗」，看右侧仿真面板里的 `Sampler` 提示如何全部亮起绿色通过状态。',
            callout: {
              tone: 'ue58',
              title: 'UE 5.8 常见报错秒解',
              body: '若材质节点报错 `[SM6] Sampler type is Color, should be Linear Color`，说明你在贴图里关掉了 `sRGB`，只需选中该采样节点将 `Sampler Type` 改为 `Linear Color`（或删掉重拖一次）即可一秒消除！',
            },
          },
          {
            stepNumber: 5,
            shortLabel: '一秒判断口诀',
            tag: 'pitfall',
            title: '一秒判断口诀：给人看还是给机器算？',
            paragraphs: [
              '搞懂了前几步的账本换算，以后在 UE 5.8 里双击打开任何一张贴图，面对那个 **`sRGB`** 小方框再也不用死记硬背或瞎猜了，只需问自己一句话：',
              '• **给人眼直接看颜色的照片**（比如基础色 `BaseColor`、自发光图案 `Emissive`、UI 图标）👉 **必须打勾 `✓ sRGB`**！要是忘勾了，进引擎时没把拔高的暗部压回来，上屏幕前又被显示器白白提亮一遍，好好的红木箱就会像蒙了一层粉笔灰一样惨白！',
              '• **给电脑算数学用的百分比表格**（比如粗糙度 `Roughness`、金属度 `Metallic`、环境遮蔽 `AO`、法线 `Normal`、高度图、`ORM` 打包图）👉 **严禁打勾 `sRGB`**！画师填 `0.5` 就是想要字面意思的五成粗糙，要是误勾了 `sRGB`，引擎进门就把它狠狠压成 `0.2140`，粗糙铁箍与水泥地当场变成泼了油的溜冰场！',
            ],
            tryItPrompt: '试着在仿真面板里故意同时弄反两个开关（取消颜色图 `sRGB` + 勾选粗糙度 `sRGB`），记住这个“又白又油”的典型翻车长相，以后在项目里一眼就能揪出病根！',
          },
        ],
        takeaways: [
          '判断 `sRGB` 只需一问：画的是**给人眼看的颜色照片**（必勾 `✓`），还是**给电脑算数的百分比表格**（严禁勾 `✗`）？',
          '颜色图（`BaseColor`、`Emissive`）漏勾 `sRGB` → 缺少进门压暗，被屏幕二次提亮，画面惨白发灰如撒面粉。',
          '数据图（`Roughness`、`Metallic`、`AO`、`Normal`、`ORM`）误勾 `sRGB` → `0.5` 被压暗成 `0.2140`，哑光表面变成泼油反光。',
          '在 UE 5.8 修改贴图 `sRGB` 状态后，需确保材质内 `Texture Sample` 的 `Sampler Type`（`Color` vs `Linear Color / Masks`）与之对应。',
        ],
        schematic: {
          title: 'UE 5.8 颜色贴图与数据贴图分流铁律',
          caption: '颜色照片走 sRGB 解码通道，纯数据表格走 Linear 直通通道，最终在 Substrate 层板汇合',
          nodes: [
            {
              id: 'tex_albedo',
              title: 'T_Wood_D (颜色贴图)',
              subtitle: '✓ 必勾 sRGB | Sampler: Color',
              category: 'texture',
              x: 25,
              y: 30,
              width: 210,
              previewColor: '#7a4424',
              outputs: [{ id: 'rgb', label: '解码后 Linear RGB', color: '#4ade80' }],
              note: '忘勾 -> 惨白粉笔灰',
            },
            {
              id: 'tex_data',
              title: 'T_Roughness_R (数据贴图)',
              subtitle: '✗ 严禁勾 sRGB | Sampler: Linear',
              category: 'texture',
              x: 25,
              y: 175,
              width: 210,
              previewColor: '#858585',
              outputs: [{ id: 'r', label: '原汁原味 0~1 小数', color: '#38bdf8' }],
              note: '误勾 -> 0.5 解码成 0.2140',
            },
            {
              id: 'substrate_slab',
              title: 'Substrate 层板 (Slab BSDF)',
              subtitle: 'UE 5.8 默认物理材质核心',
              category: 'substrate',
              x: 345,
              y: 95,
              width: 220,
              inputs: [
                { id: 'diff', label: 'Diffuse Albedo (漫反射)', color: '#4ade80' },
                { id: 'rough', label: 'Roughness (粗糙度)', color: '#38bdf8' },
              ],
              outputs: [{ id: 'bsdf', label: 'BSDF 层板输出', color: '#a855f7' }],
            },
            {
              id: 'mat_root',
              title: '材质主节点',
              subtitle: '输出至延迟渲染管线',
              category: 'output',
              x: 660,
              y: 95,
              width: 185,
              inputs: [{ id: 'front', label: 'Front Material', color: '#a855f7' }],
            },
          ],
          edges: [
            { fromNode: 'tex_albedo', fromPin: 'rgb', toNode: 'substrate_slab', toPin: 'diff', color: '#4ade80', label: '去伽马还原' },
            { fromNode: 'tex_data', fromPin: 'r', toNode: 'substrate_slab', toPin: 'rough', color: '#38bdf8', label: '原值直通' },
            { fromNode: 'substrate_slab', fromPin: 'bsdf', toNode: 'mat_root', toPin: 'front', color: '#a855f7' },
          ],
        },
      },
    ],
  },
  {
    id: '04',
    number: '04',
    title: '纹理格式与通道打包',
    subtitle: '贴图不只是照片，更是四页数据账本',
    lessons: [
      {
        id: 'file-formats-bit-depth',
        moduleId: '04',
        number: '4.1',
        title: '图片后缀名背后的秘密 —— JPG / PNG / TGA / EXR 与 8-bit 梯田断层现象',
        subtitle: '肉眼看着一模一样的两张高度图，贴上光滑引擎盖一打斜光，怎么瞬间现出梯田年轮？',
        duration: '9 分钟',
        difficulty: '零基础',
        StageComponent: FileFormatsBitDepthStage,
        steps: [
          {
            stepNumber: 1,
            shortLabel: '梯田怪圈',
            tag: 'phenomenon',
            title: '平看一模一样的两张灰图，贴上跑车引擎盖怎么炸出一圈圈“梯田”？',
            paragraphs: [
              '先看当前舞台的「模式 1：平铺直看高度图」：左边是一张 `8-bit` 灰度穹顶图，右边是 `16-bit`，哪怕你把脸贴在显示器上找茬，两边看起来也几乎 **99.9% 一模一样**！',
              '现在，见证奇迹的时刻到了——点击舞台上方切换到 **「🚗 模式 2：贴上光滑汽车引擎盖打斜光」**！天呐，刚才还平平滑滑的左半边车盖，高光里竟然炸出了一圈圈像山坡梯田和树木年轮一样的丑陋波纹；而右半边却像液态蓝宝石一样平滑如镜！',
            ],
            tryItPrompt: '立即点击舞台顶部的「🚗 模式 2：贴上光滑汽车引擎盖打斜光」，然后拖动白色对比拉帘，亲眼看看左半边惊人的等高线梯田条纹！',
          },
          {
            stepNumber: 2,
            shortLabel: 'JPG与位深',
            tag: 'background',
            title: '揭秘两大痛点：为什么严禁用 `JPG`？为什么 `256` 级撑不起缓坡？',
            paragraphs: [
              'JPEG 的有损编码会量化 8×8 变换块中的频率信息，损失可能表现为块边、振铃或色边模糊。保留无损源文件便于后续烘焙和目标平台压缩。这里直接比较同一源图经浏览器 JPEG 与 PNG 编解码后的像素。',
              '再看刚才的车盖梯田之谜：`8-bit` 只有 **256 级整数台阶**。当曲面坡度很平缓时，屏幕每隔好几个像素才允许高度往上跳 `1` 级，中间全是平平的台阶（看下方放大 50 倍剖面图）！肉眼看灰度察觉不到 `1/255` 的跳变，可一旦用来算表面法线并打上光滑烤漆高光，每一级台阶折角都会把光线猛地弹歪，瞬间现出梯田原形！换成 **`16-bit`（`65,536` 级台阶，细腻 256 倍）**，台阶彻底化作顺滑斜坡！',
            ],
            tryItPrompt: '在「模式 2」下左右拖动「斜射高光角度」与「烤漆粗糙度」滑块：观察烤漆越光滑，左边的 `8-bit` 梯田波纹暴露得越无处遁形！',
          },
          {
            stepNumber: 3,
            shortLabel: '文件格式对照',
            tag: 'experiment',
            title: '切到模式 3：揪出 `JPG` 马赛克块，再戴墨镜看 `.EXR` 里的万倍太阳！',
            paragraphs: [
              '除了 `PNG / TGA`，你还会遇到一位重量级大佬：**`.EXR`（以及 `.HDR`）**。普通图片最高只能存到 `1.0`（纯白），正午太阳和白炽灯泡全被一刀砍平同归于尽；而 `EXR` 不用整数改用**科学计数法小数（浮点数）**，能轻松存下亮度高达 `20.0` 甚至 `10,000.0` 的真实太阳能量！',
              '切到舞台「模式 3」亲自试试这两组实验：① 浏览器把同一幅渲染好的徽章分别编码成 JPEG（quality 0.25）与 PNG，再解码到画布。对照细线和边缘，差异取决于源图与编码器；② 切到 `LDR 截断与 HDR 数值示意`，把相机曝光往低拉（相当于给镜头戴上墨镜）——左边 `8-bit` 太阳直接变成一块毫无生气的死灰铁饼，右边 `EXR` 则显现出炽热的金色日冕与太阳核心！',
            ],
            tryItPrompt: '点选顶部「🗂️ 模式 3」，先看 JPG 方块伪影，再切到「LDR 截断与 HDR 数值示意」并把曝光滑块拉低到 `0.10x` 附近！',
          },
          {
            stepNumber: 4,
            shortLabel: 'UE5.8导入规范',
            tag: 'ue5',
            title: '走进 UE 5.8：一张清单定死项目里每种贴图该存什么格式！',
            paragraphs: [
              '先按内容选择源文件位深，再在目标平台检查实际纹理格式和质量。',
              '• **常规颜色、粗糙度、遮罩、`ORM` 贴图** 👉 存 **`8-bit PNG` 或 `TGA`**（体积适中、无损干净）；',
              '• Landscape 高度可用 16-bit 单通道 PNG 或支持的 RAW 格式。精细置换可保留高位深源数据，再验证引擎的实际精度。天空照明用浮点 EXR 或 HDR 源图，在 Texture Editor 确认目标像素格式。',
            ],
            tryItPrompt: '在同一光照和粗糙度下切换平面与反光车盖，记录什么条件最容易看到高度量化误差。',
            callout: {
              tone: 'ue58',
              title: 'UE 5.8 地形系统贴心提示',
              body: 'UE 5.8 的 Landscape 地形面板导入高度图时，标准格式就是单通道 **`16-bit Grayscale PNG / RAW`**。如果误喂给它 8-bit 灰图，整座大山就会变成一层层乐高积木台阶！',
            },
          },
          {
            stepNumber: 5,
            shortLabel: '假16位防坑',
            tag: 'pitfall',
            title: '实战避坑：把已经断层的 8 位图在 PS 里“转成 16 位另存”，救得回来吗？',
            paragraphs: [
              '这是外包协作中最常闹的乌龙：上游软件导出时选错了 `8-bit`，进引擎发现车盖或山体全是梯田条纹；有人图省事在 Photoshop 里打开这张 `8-bit` 图，点菜单 `图像 -> 模式 -> 16 位/通道` 重新另存了一份交差——**结果进引擎一看，梯田纹丝不动！**',
              '道理很简单：蛋糕切坏了换个大盘子装，碎口也不会自己长回去！一旦存成 `8-bit`，中间细腻的小数早就被四舍五入砍掉了，转成 `16-bit` 只是把台阶编号乘了 257 倍，台阶本身依然是平的。**真 `16-bit` 必须从源头烘焙/雕刻软件（Substance / ZBrush / Gaea）导出那一刻就选对！**',
            ],
            tryItPrompt: '最后在「模式 1（平看）」和「模式 2（斜光）」之间点按切换一次，记住“平看灰图不显山露水，一上高光梯田现原形”的排查经验！',
          },
        ],
        takeaways: [
          '需要精确保留数据的源图使用无损格式。JPEG 对细线、色边的影响取决于内容、质量与编码器设置。',
          '8-bit UNORM 有 256 级，16-bit UNORM 有 65,536 级。高度源图的量化误差可在求导得到的法线与高光中被放大。',
          '环境天空球照明需使用浮点格式 `.EXR / .HDR`，才能记录远超 `1.0` 的真实太阳强光。',
          '已经被砍成 `8-bit` 的断层图在修图软件里单纯另存为 `16-bit` 无法恢复平滑，必须从源头软件直接导出 `16-bit`。',
        ],
        schematic: {
          title: '源文件格式与位深进 UE 5.8 分流图',
          caption: '常规贴图 8-bit PNG/TGA 足够，地形高度保留 16-bit 精度，天空照明交给浮点 EXR',
          nodes: [
            {
              id: 'src_16bit',
              title: '16-bit PNG 高度/烘焙源',
              subtitle: '65,536 级丝滑斜坡',
              category: 'texture',
              x: 25,
              y: 30,
              width: 195,
              previewColor: '#9ca3af',
              outputs: [{ id: 'h16', label: '无断层平滑斜率', color: '#4ade80' }],
            },
            {
              id: 'src_exr',
              title: '浮点 EXR / HDR 天空球',
              subtitle: '浮点记录 >1.0 万倍阳光',
              category: 'texture',
              x: 25,
              y: 170,
              width: 195,
              previewColor: '#f59e0b',
              outputs: [{ id: 'ibl', label: 'BC6H 高动态天光', color: '#facc15' }],
            },
            {
              id: 'surf_norm',
              title: '曲面法线与地形构建',
              subtitle: '告别 8-bit 梯田年轮条纹',
              category: 'math',
              x: 315,
              y: 30,
              width: 205,
              inputs: [{ id: 'in', label: '高度/法线输入', color: '#4ade80' }],
              outputs: [{ id: 'n', label: '丝滑法线 N', color: '#38bdf8' }],
            },
            {
              id: 'car_slab',
              title: '光滑清漆表面着色',
              subtitle: 'Substrate Slab + ClearCoat',
              category: 'substrate',
              x: 610,
              y: 95,
              width: 215,
              inputs: [
                { id: 'norm', label: 'Normal (法线)', color: '#38bdf8' },
                { id: 'sky', label: 'SkyLight 环境反射', color: '#facc15' },
              ],
            },
          ],
          edges: [
            { fromNode: 'src_16bit', fromPin: 'h16', toNode: 'surf_norm', toPin: 'in', color: '#4ade80' },
            { fromNode: 'surf_norm', fromPin: 'n', toNode: 'car_slab', toPin: 'norm', color: '#38bdf8' },
            { fromNode: 'src_exr', fromPin: 'ibl', toNode: 'car_slab', toPin: 'sky', color: '#facc15' },
          ],
        },
      },
      {
        id: 'rgba-four-spreadsheets',
        moduleId: '04',
        number: '4.2',
        title: '拆开彩色贴图看本质 —— RGBA 只是装订在一起的四张黑白灰度表',
        subtitle: '显卡眼里根本没有“彩色照片”，以及为什么透明背景 PNG 树叶总是自带刺眼白边？',
        duration: '9 分钟',
        difficulty: '零基础',
        StageComponent: RgbaFourSpreadsheetsStage,
        steps: [
          {
            stepNumber: 1,
            shortLabel: '彩图与树叶白边',
            tag: 'phenomenon',
            title: '两个新手必问之谜：为什么贴图节点长着 5 个圆点？为什么透明树叶总镶着白边？',
            paragraphs: [
              '刚进材质编辑器连贴图时，大家都会好奇两件事：第一，为什么每张 `Texture Sample` 贴图节点右边，最顶上是一个白圆点，底下还跟着**红、绿、蓝、灰 4 个小圆点**？而且从红圆点拉根线出去预览，出来的居然不是红图，而是一张黑白图！',
              '第二，美术师在画图软件里抠好了漂亮的绿树叶，存成透明背景 `.PNG` 导进引擎做镂空树枝，为什么每片叶子边缘都长出一圈像劣质贴纸一样的**刺眼白边**？搞懂今天这一课，两个谜底一次性全揭开！',
            ],
            tryItPrompt: '在左侧舞台点击「📚 四页同屏拆开」与「⚪ RGB 彩色合体」来回切换，看看这枚彩色皇家枫叶徽章拆开后究竟长什么样！',
          },
          {
            stepNumber: 2,
            shortLabel: '四页灰度账本',
            tag: 'background',
            title: '打破视觉幻觉：显卡眼里根本没有彩色，只有四页 `0~1` 黑白灰度账本！',
            paragraphs: [
              '请把这句话刻进直觉里：**在显卡显存里，从来就不存在什么“彩色颜料”，一张 `RGBA` 贴图只不过是用订书机钉在一起的 4 张 `0~1` 黑白灰度表格！** 第 1 页（`R`）记红光深浅，第 2 页（`G`）记绿光，第 3 页（`B`）记蓝光，第 4 页（`A` Alpha）则是顺手附赠的第四张黑白表（常用来记镂空遮罩）。',
              '只有当你把最顶上的总捆绑口 `RGB` 连给屏幕颜色时，前 3 页才会合力点亮显示器的红绿蓝灯珠变回彩图；**只要你单独揪出 `R / G / B / A` 任意一页，它就是一张彻头彻尾的单通道黑白灰度图！**',
            ],
            tryItPrompt: '在「四页同屏拆开」视图下，依次点击下方的「🍁 红宝石中心」与「🛡️ 宝蓝盾底」按钮：看红宝石在第 1 页亮成纯白（`0.95`），在第 2、3 页却黑成一团（`0.12`）！',
          },
          {
            stepNumber: 3,
            shortLabel: '拆页与白边镜',
            tag: 'experiment',
            title: '切到实验二抓真凶：透明 `PNG` 的隐形纯白底色是如何污染叶缘的？',
            paragraphs: [
              '既然 `RGB` 和第 4 页 `A` 是分开记账的四张纸，那当你在画图软件里把树叶背景擦成“全透明（`A = 0`）”存为 `PNG` 时，前 3 页 `RGB` 在透明区域填了什么数字呢？答案令人大跌眼镜：**很多软件为了压缩体积，会偷偷把 `A = 0` 区域的 `RGB` 全部涂成纯白 `(1, 1, 1)`！**',
              '平时看图时因为 `A = 0` 把白底挡住了你看不见；可一进游戏，显卡在树叶边缘做平滑混色（双线性采样）时，会把叶缘的深绿像素和旁边 `A = 0` 底下的隐藏纯白像素各取一半混在一起——镂空线一切下去，一圈刺眼的惨白镶边就漏出来了！解决办法叫 **边缘颜色外扩（Padding / Dilation）**：让树叶绿色往外蔓延铺满背景底色！',
            ],
            tryItPrompt: '切换到顶部「🍃 实验二：透明 PNG 树叶白边放大镜」，然后打开下方的「🔬 掀开透明遮罩透视底层 RGB」开关——左图刺眼的纯白背景当场人赃俱获！',
          },
          {
            stepNumber: 4,
            shortLabel: 'UE5.8单通道连线',
            tag: 'ue5',
            title: '走进 UE 5.8：单通道直连标量口，做树叶必开 `Masked` 混合模式',
            paragraphs: [
              '回到 **UE 5.8 材质编辑器**，现在看 `Texture Sample` 节点的 5 个引脚就再亲切不过了：顶上白圆点输出三维数组 `(R,G,B)` 连颜色；底下红、绿、蓝、灰 4 个圆点各自输出 `1` 个 `0~1` 小数（`Float`），可以直接插进 `Roughness`、`Lerp Alpha` 或 **`Opacity Mask`（不透明遮罩）**！',
              '做树叶、铁丝网、破布条时，选中材质主节点将左下角 **`Blend Mode`（混合模式）改为 `Masked`（遮罩镂空）**，把第 4 页 `A` 引脚连进 `Opacity Mask`：凡是高于 `Opacity Mask Clip Value`（默认 `0.333`）的像素实心保留，低于它的像素一刀切穿透！',
            ],
            tryItPrompt: '关掉透视开关恢复树叶镂空预览，左右拖动「Masked 镂空裁剪阈值」滑块，观察左图白边如何顽固跟随，而右图外扩处理后在任何阈值下都翠绿干净！',
            callout: {
              tone: 'ue58',
              title: 'Substance Painter 导出无白边贴图秘籍',
              body: '在 SP 导出带透明遮罩的贴图时，背景填充务必选择 **`Dilation + Transparent`** 或导出实心扩边 **`TGA`**（前 3 页铺满外扩颜色，第 4 页存独立 Alpha），彻底根除白边！',
            },
          },
          {
            stepNumber: 5,
            shortLabel: '防坑总结',
            tag: 'pitfall',
            title: '实战避坑：第 4 页 `Alpha` 不等于自动透明！不改混合模式它啥也不干',
            paragraphs: [
              '最后破除一个全网最高频的新手误会：“老师，我的 PNG 明明在电脑看图软件里背景是透明格子，为什么拖进 UE 5.8 连上 `BaseColor` 后，透明的地方全变成纯白或纯黑方块了？”',
              '现在你秒懂了：因为看图软件默认帮你把第 4 页当透明度用了，而 **UE 5.8 默认材质是 `Opaque`（实心不透明石块）**，只读了前 3 页 `RGB` 颜色，压根没看第 4 页 `A`！记住：**`Alpha` 只是第四张普通黑白表，你想让它管镂空就得开 `Masked` 连遮罩口，想管玻璃半透就得开 `Translucent`，甚至还能拿它去存高度或光滑度！**',
            ],
            tryItPrompt: '切回「🃏 实验一」点选单个 `A 第四页` 按钮看一眼这张黑白剪影表，彻底建立“贴图 = 四页独立黑白数据表”的技术美术思维！',
          },
        ],
        takeaways: [
          '一张 `RGBA` 彩色贴图在显卡底层只是装订在一起的 **4 张独立 `0~1` 黑白灰度表**，单独连出 `R/G/B/A` 任一引脚得到的都是单通道浮点数。',
          '直出透明背景 `PNG` 常将 `Alpha=0` 处的隐藏 `RGB` 清成纯白 `(1,1,1)`，经边缘采样混合后会在镂空树叶周围产生刺眼白边。',
          '消除镂空边缘白边的工业标准做法是 **边缘颜色外扩（Padding / Dilation）** 或用 `TGA` 独立管理实心扩边 `RGB` 与 `Alpha`。',
          '在 UE 5.8 中导入透明图片不会自动透明，必须将材质 `Blend Mode` 设为 `Masked`（连 `Opacity Mask`）或 `Translucent`。',
        ],
        schematic: {
          title: 'UE 5.8 树叶 Masked 镂空材质标准接线（外扩防白边）',
          caption: '前 3 页外扩绿叶 RGB 送入层板漫反射，第 4 页单通道灰度 A 送入材质主节点 Opacity Mask 一刀切镂空',
          nodes: [
            {
              id: 'leaf_tex',
              title: 'T_FoliageLeaf_DA',
              subtitle: '外扩 Padding TGA/PNG (✓ sRGB)',
              category: 'texture',
              x: 25,
              y: 60,
              width: 215,
              previewColor: '#2d7a24',
              outputs: [
                { id: 'rgb', label: 'RGB (前3页合体彩图)', color: '#e5e7eb' },
                { id: 'r', label: 'R (红页灰度)', color: '#ef4444' },
                { id: 'g', label: 'G (绿页灰度)', color: '#22c55e' },
                { id: 'b', label: 'B (蓝页灰度)', color: '#3b82f6' },
                { id: 'a', label: 'A (第4页镂空剪影)', color: '#9ca3af' },
              ],
            },
            {
              id: 'leaf_slab',
              title: 'Substrate 层板 (叶片)',
              subtitle: '边缘混色仍是纯净叶绿',
              category: 'substrate',
              x: 335,
              y: 35,
              width: 205,
              inputs: [{ id: 'albedo', label: 'Diffuse Albedo', color: '#e5e7eb' }],
              outputs: [{ id: 'bsdf', label: 'Front Material', color: '#a855f7' }],
            },
            {
              id: 'masked_root',
              title: '材质主节点 (Blend: Masked)',
              subtitle: 'Opacity Mask Clip = 0.333',
              category: 'output',
              x: 625,
              y: 75,
              width: 220,
              inputs: [
                { id: 'front', label: 'Front Material', color: '#a855f7' },
                { id: 'mask', label: 'Opacity Mask (遮罩口)', color: '#9ca3af' },
              ],
              note: 'A >= 0.333 留叶片，否则切空',
            },
          ],
          edges: [
            { fromNode: 'leaf_tex', fromPin: 'rgb', toNode: 'leaf_slab', toPin: 'albedo', color: '#4ade80' },
            { fromNode: 'leaf_slab', fromPin: 'bsdf', toNode: 'masked_root', toPin: 'front', color: '#a855f7' },
            { fromNode: 'leaf_tex', fromPin: 'a', toNode: 'masked_root', toPin: 'mask', color: '#9ca3af', label: '第4页灰度直连' },
          ],
        },
      },
      {
        id: 'orm-channel-packing',
        moduleId: '04',
        number: '4.3',
        title: 'ORM 通道打包 · 一次采样读取三种属性',
        subtitle: '拆解共享的块端点，并比较不同目标格式添加 Alpha 后的显存变化。',
        duration: '10 分钟',
        difficulty: '进阶',
        StageComponent: OrmChannelPackingStage,
        steps: [
          {
            stepNumber: 1,
            shortLabel: '神秘紫绿贴图',
            tag: 'phenomenon',
            title: '打开 3A 游戏工程文件夹，为什么到处都是诡异的“紫绿荧光花脸图”？',
            paragraphs: [
              '只要你下载过虚幻商城资产、Quixel Megascans 扫描模型或打开大厂项目文件夹，一定会看到这样一幕：每套材质除了正常的颜色图和蓝紫色法线图之外，必定还躺着第 3 张名字带 `_ORM`（或 `_ARM`）、长得**又紫又绿像荧光涂鸦一样怪异的贴图**（看舞台中间那张图）！',
              '机甲明明是深蓝配钛合金灰，美术师为什么要画一张紫绿花脸图？而右边读取这张花脸图渲染出来的 3D 护甲板，居然质感细腻精准得不得了！',
            ],
            tryItPrompt: '拖动舞台下方的「调整护甲边缘金属掉漆磨损度」滑块，同步观察中间紫绿花脸图里的蓝色边框变化，以及右侧 3D 机甲护板露出亮银金属的过程！',
          },
          {
            stepNumber: 2,
            shortLabel: '集装箱拼柜',
            tag: 'background',
            title: '集装箱拼柜省大钱：把三张黑白表塞进同一本账册的红、绿、蓝三页！',
            paragraphs: [
              'AO、粗糙度与金属度若共用 UV、分辨率、寻址和过滤要求，可以装入一张 RGB 图。示例中独立的三次读取合为一次。显存按原图和打包图各自的目标像素格式计算。',
              '聪明的技术美术玩起了“海运集装箱拼柜（**Channel Packing 通道打包**）”，把三张黑白表按国际通用顺序塞进同一张图：**`R` 红槽 = `O`cclusion（AO 遮蔽）**、**`G` 绿槽 = `R`oughness（粗糙度）**、**`B` 蓝槽 = `M`etallic（金属度）**，取首字母合称 **`ORM` 贴图**！非金属区红绿较高合出标志性黄绿色，金属区加上蓝光就呈现出青紫花脸！',
            ],
            tryItPrompt: '将目标设为 RGB 用 BC1 / RGBA 用 BC3，先关闭 Alpha，在三张独立 BC1 和一张打包 BC1 间切换。估算从约 8.00 MiB 到 2.67 MiB。',
          },
          {
            stepNumber: 3,
            shortLabel: '共享端点',
            tag: 'experiment',
            title: 'BC1 压缩一个 4×4 块时，绿色的 6 位用在哪里？',
            paragraphs: [
              'ORM 是约定俗成的资产布局。其他布局也可用，但导出约定和材质接线必须一致。',
              'BC1 的一个 4×4 块共享两个 RGB565 端点，16 个纹素各用一个 2 位索引选择调色板。绿色端点各 6 位，但 RGB 三通道共享索引，粗糙度误差也取决于其他通道。实例块（小端十六进制）为 FF FF 00 00 78 78 78 78。两端为白和黑，每行索引 0、2、3、1，解码灰度 255、170、85、0。若原始四行都是 255、185、75、0，每行误差依次为 0、−15、+10、0。',
            ],
            tryItPrompt: '试着取消右上角的「✅ UE 5.8 压缩设为 Masks (自动禁勾 sRGB)」勾号，重温第 3 章铁律：一旦 `ORM` 数据图误开了 `sRGB`，右侧护甲立刻泛起错误油光！',
          },
          {
            stepNumber: 4,
            shortLabel: 'UE5.8连线规范',
            tag: 'ue5',
            title: '走进 UE 5.8：导入选 `Masks (no sRGB)`，配合翻译桥直连 `Substrate`！',
            paragraphs: [
              '导出时核对各通道含义，导入后选 Masks (no sRGB)，在 Texture Editor 查看目标平台实际 Pixel Format。平台和项目设置决定最终使用哪种块格式。',
              '③ 在材质编辑器里只放 **1 颗** `Texture Sample`（自动变为 `Sampler Type: Masks`），从 `R` 连环境遮蔽、`G` 连粗糙度、`B` 连金属度（在 UE 5.8 默认 `Substrate` 模式下，基础色与金属度经过 `Metalness-To-DiffuseAlbedo-F0` 桥接节点送入层板即可）！',
            ],
            tryItPrompt: '切换到页面顶部的「节点原理图」视图（或查看本课接线图），对照一遍 `T_Armor_ORM` 的红、绿、蓝三根线是怎样一根不落地喂给材质的！',
            callout: {
              tone: 'ue58',
              title: 'UE 5.8 自动识别命名后缀小技巧',
              body: '在项目设置或编辑器导入规则中，规范命名为 `_ORM` 的贴图设为 `Masks (no sRGB)` 后，拖进材质画布会自动将采样节点设为 `Masks` 类型，彻底杜绝 `sRGB` 报错！',
            },
          },
          {
            stepNumber: 5,
            shortLabel: 'Alpha 的格式成本',
            tag: 'pitfall',
            title: '加入第四通道时，目标格式是否改变？',
            paragraphs: [
              '几乎每个聪明好学的同学学到这儿都会灵机一动：“老师！刚才 4.2 节不是说贴图有 `R, G, B, A` 四页吗？现在 `ORM` 只用了前三页，第 4 页 `Alpha` 空着也是空着，我再塞第 4 张高度图进去做成 `ORMA`，岂不是白嫖一张贴图？”',
              '在 RGB 用 BC1、RGBA 用 BC3 的配置中，每 4×4 块由 8 字节增为 16 字节，完整 mip 链约从 2.67 到 5.33 MiB。如果两种输入都用 BC7，均为 16 字节/块，添加 Alpha 后仍约 5.33 MiB。ASTC 8×8 也用 16 字节，但覆盖 64 个纹素，即 2 bpp。',
            ],
            tryItPrompt: '分别选择两种目标格式假设，各开关一次 Alpha，记下四个估算值，再到目标平台的 Texture Editor 核对实际格式。',
          },
        ],
        takeaways: [
          '本例 ORM 约定 R = AO、G = Roughness、B = Metallic。共用 UV 时一次采样得到三项数据。',
          'BC1 每个块共享两个 RGB565 端点，16 个纹素各用 2 位索引。绿色端点精度和解码后每个纹素的精度含义不同。',
          '`ORM` 属于纯数学数据表，导入 UE 5.8 必须将压缩设为 **`Masks (no sRGB)`**，严禁勾选 `sRGB`。',
          'Alpha 的成本取决于目标格式是否改变。BC1 到 BC3 的块大小翻倍，BC7 保持 16 字节/块。',
        ],
        schematic: {
          title: 'UE 5.8 标准 ORM 打包贴图对接 Substrate 完整连法',
          caption: '仅用 2 张贴图（颜色图 + ORM 打包图）完成全套次世代 PBR 物理属性输入，极省纹理读取',
          nodes: [
            {
              id: 'tex_color',
              title: 'T_Armor_D (基础色)',
              subtitle: 'BC1 | ✓ 勾选 sRGB',
              category: 'texture',
              x: 20,
              y: 20,
              width: 185,
              previewColor: '#25547a',
              outputs: [{ id: 'rgb', label: 'RGB (颜色)', color: '#e5e7eb' }],
            },
            {
              id: 'tex_orm',
              title: 'T_Armor_ORM (三合一)',
              subtitle: 'BC1 Masks | ✗ 禁勾 sRGB',
              category: 'texture',
              x: 20,
              y: 155,
              width: 185,
              previewColor: '#6ad14f',
              outputs: [
                { id: 'r', label: 'R (AO 遮蔽)', color: '#ef4444' },
                { id: 'g', label: 'G (粗糙度)', color: '#22c55e' },
                { id: 'b', label: 'B (金属度)', color: '#3b82f6' },
              ],
              note: '按平台检查最终像素格式',
            },
            {
              id: 'metal_bridge',
              title: '金属度转换桥',
              subtitle: 'Metalness-To-DiffuseAlbedo-F0',
              category: 'math',
              x: 255,
              y: 45,
              width: 205,
              inputs: [
                { id: 'base', label: 'BaseColor', color: '#e5e7eb' },
                { id: 'metal', label: 'Metallic', color: '#3b82f6' },
              ],
              outputs: [
                { id: 'diff', label: 'Diffuse Albedo', color: '#4ade80' },
                { id: 'f0', label: 'F0 (正视反射)', color: '#facc15' },
              ],
            },
            {
              id: 'orm_slab',
              title: 'Substrate Slab BSDF',
              subtitle: 'UE 5.8 物理层板',
              category: 'substrate',
              x: 505,
              y: 55,
              width: 190,
              inputs: [
                { id: 'albedo', label: 'Diffuse Albedo', color: '#4ade80' },
                { id: 'f0', label: 'F0', color: '#facc15' },
                { id: 'rough', label: 'Roughness', color: '#22c55e' },
              ],
              outputs: [{ id: 'bsdf', label: 'BSDF', color: '#a855f7' }],
            },
            {
              id: 'orm_root',
              title: '材质主节点',
              subtitle: '单趟采样配齐三大属性',
              category: 'output',
              x: 735,
              y: 110,
              width: 175,
              inputs: [
                { id: 'front', label: 'Front Material', color: '#a855f7' },
                { id: 'ao', label: 'Ambient Occlusion', color: '#ef4444' },
              ],
            },
          ],
          edges: [
            { fromNode: 'tex_color', fromPin: 'rgb', toNode: 'metal_bridge', toPin: 'base', color: '#e5e7eb' },
            { fromNode: 'tex_orm', fromPin: 'b', toNode: 'metal_bridge', toPin: 'metal', color: '#3b82f6' },
            { fromNode: 'metal_bridge', fromPin: 'diff', toNode: 'orm_slab', toPin: 'albedo', color: '#4ade80' },
            { fromNode: 'metal_bridge', fromPin: 'f0', toNode: 'orm_slab', toPin: 'f0', color: '#facc15' },
            { fromNode: 'tex_orm', fromPin: 'g', toNode: 'orm_slab', toPin: 'rough', color: '#22c55e' },
            { fromNode: 'orm_slab', fromPin: 'bsdf', toNode: 'orm_root', toPin: 'front', color: '#a855f7' },
            { fromNode: 'tex_orm', fromPin: 'r', toNode: 'orm_root', toPin: 'ao', color: '#ef4444' },
          ],
        },
      },
    ],
  },
];
