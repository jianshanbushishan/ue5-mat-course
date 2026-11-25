import React, { useState, useEffect, useRef } from 'react';
import {
  LessonDefinition,
  LessonStageProps,
  SchematicDiagram,
} from '../types/course';
import { clamp, lerp } from '../lib/graphics';
import {
  StageSlider,
  StageSegmented,
  StageToggle,
  PitfallCompareBar,
} from '../components/ui/StageWidgets';

// ============================================================================
// LESSON 9.5 STAGE: Three-Thread Frame Pipeline & Draw Call Inspector
// ============================================================================

type SubmitBatchMode = 'separate' | 'merged';

const Stage9_5_DrawCallPipeline: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [propCount, setPropCount] = useState<number>(480);
  const [matSlots, setMatSlots] = useState<number>(4);
  const [castShadows, setCastShadows] = useState<boolean>(true);
  const [cullingOn, setCullingOn] = useState<boolean>(false);
  const [batchMode, setBatchMode] = useState<SubmitBatchMode>('separate');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevStepRef = useRef(stepIndex);
  const prevResetRef = useRef(resetSignal);

  useEffect(() => {
    if (prevStepRef.current === stepIndex) return;
    prevStepRef.current = stepIndex;
    if (stepIndex === 0) {
      setPropCount(480);
      setMatSlots(4);
      setCastShadows(true);
      setCullingOn(false);
      setBatchMode('separate');
    } else if (stepIndex === 1) {
      setPropCount(420);
      setMatSlots(3);
      setCastShadows(true);
      setCullingOn(false);
      setBatchMode('separate');
    } else if (stepIndex === 2) {
      setPropCount(500);
      setMatSlots(5);
      setCastShadows(true);
      setCullingOn(false);
      setBatchMode('separate');
    } else if (stepIndex === 3) {
      setPropCount(500);
      setMatSlots(1);
      setCastShadows(true);
      setCullingOn(true);
      setBatchMode('merged');
    } else if (stepIndex === 4) {
      setPropCount(500);
      setMatSlots(5);
      setCastShadows(true);
      setCullingOn(false);
      setBatchMode('separate');
    }
  }, [stepIndex]);

  useEffect(() => {
    if (prevResetRef.current === resetSignal) return;
    prevResetRef.current = resetSignal;
    setPropCount(480);
    setMatSlots(4);
    setCastShadows(true);
    setCullingOn(false);
    setBatchMode('separate');
  }, [resetSignal]);

  // Compute realistic teaching telemetry
  const visibleRatio = cullingOn ? 0.42 : 1.0;
  const visibleProps = Math.max(10, Math.round(propCount * visibleRatio));
  const effectiveSlots = batchMode === 'merged' ? 1 : matSlots;
  const basePassDraws =
    batchMode === 'merged'
      ? Math.max(4, Math.ceil(visibleProps / 80)) * effectiveSlots
      : visibleProps * effectiveSlots;
  const depthPrepassDraws = Math.round(basePassDraws * 0.72);
  const shadowPassDraws = castShadows ? Math.round(basePassDraws * 0.85) : 0;
  const totalDrawCalls = basePassDraws + depthPrepassDraws + shadowPassDraws;

  // Simulated frame timings (ms)
  const gameMs = +(4.2 + propCount * 0.0042 + (cullingOn ? -0.4 : 0)).toFixed(1);
  const drawMs = +(
    2.6 +
    totalDrawCalls * 0.0046 +
    (batchMode === 'separate' ? matSlots * 0.45 : 0.3)
  ).toFixed(1);
  const gpuMs = +(
    6.4 +
    visibleProps * 0.0062 +
    (castShadows ? 2.1 : 0.2) +
    effectiveSlots * 0.28
  ).toFixed(1);
  const frameMs = Math.max(gameMs, drawMs, gpuMs);
  const fps = Math.max(1, Math.round(1000 / frameMs));
  const bottleneck =
    drawMs >= gpuMs && drawMs >= gameMs
      ? drawMs > 16.67
        ? 'CPU Draw 线程爆红'
        : 'Draw 主导（可控）'
      : gpuMs >= gameMs
      ? gpuMs > 16.67
        ? 'GPU 渲染过载'
        : 'GPU 主导（达标）'
      : 'Game 逻辑主导';

  useEffect(() => {
    onKpiUpdate([
      {
        label: '帧耗时 / 预估 FPS',
        value: `${frameMs.toFixed(1)} ms · ${fps} FPS`,
        sub: frameMs <= 16.67 ? '稳稳跑进 60 FPS 红线内' : '超出 16.67 ms 目标预算！',
        tone: frameMs <= 16.67 ? 'good' : frameMs <= 24 ? 'warn' : 'bad',
      },
      {
        label: '总 Draw Calls (全 Pass)',
        value: `${totalDrawCalls.toLocaleString()} 次`,
        sub: `Base ${basePassDraws} + Depth ${depthPrepassDraws} + Shadow ${shadowPassDraws}`,
        tone: totalDrawCalls <= 600 ? 'good' : totalDrawCalls <= 1800 ? 'warn' : 'bad',
      },
      {
        label: '木桶最短板',
        value: bottleneck,
        sub: `Game ${gameMs}ms · Draw ${drawMs}ms · GPU ${gpuMs}ms`,
        tone: frameMs <= 16.67 ? 'good' : drawMs > gpuMs ? 'bad' : 'warn',
      },
      {
        label: '每道具材质槽倍率',
        value: `${effectiveSlots}× 槽位`,
        sub: batchMode === 'merged' ? '已合槽合批，极大减少状态切换' : '槽位越多，派工单成倍翻番',
        tone: effectiveSlots === 1 ? 'good' : effectiveSlots <= 2 ? 'warn' : 'bad',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameMs, fps, totalDrawCalls, bottleneck, effectiveSlots, batchMode, gameMs, drawMs, gpuMs]);

  // Render Timeline & Dispatch Queue Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const bg = isDark ? '#11141b' : '#f8f6f1';
    const cardBg = isDark ? '#181c26' : '#ffffff';
    const ink = isDark ? '#e6ebf4' : '#181715';
    const muted = isDark ? '#94a3b8' : '#645e56';
    const grid = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(23,22,20,0.08)';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // --- TOP PANEL: 16.67ms 3-Thread Frame Pipeline ---
    ctx.fillStyle = cardBg;
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(23,22,20,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(12, 10, W - 24, 152, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = ink;
    ctx.font = '700 12.5px "Noto Sans SC", sans-serif';
    ctx.fillText('⏱️ 单帧三线程接力时间轴（目标红线：60 FPS = 16.67 ms）', 24, 31);

    const barLeft = 148;
    const barMaxW = W - 184;
    const maxScaleMs = Math.max(28, frameMs * 1.12);
    const msToX = (ms: number) => barLeft + (ms / maxScaleMs) * barMaxW;

    // 16.67ms target line
    const targetX = msToX(16.67);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(targetX, 42);
    ctx.lineTo(targetX, 150);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ef4444';
    ctx.font = '700 10.5px "JetBrains Mono", monospace';
    ctx.fillText('60 FPS (16.67ms)', targetX - 42, 41);

    // 33.33ms line if in range
    if (maxScaleMs >= 34) {
      const x30 = msToX(33.33);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x30, 44);
      ctx.lineTo(x30, 150);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#d97706';
      ctx.fillText('30 FPS (33.3ms)', x30 - 40, 41);
    }

    const rows = [
      {
        label: 'Game (逻辑线程)',
        ms: gameMs,
        color: '#3b82f6',
        desc: '物理解算 / 移动 / AI',
      },
      {
        label: 'Draw (渲染+RHI)',
        ms: drawMs,
        color: drawMs > 16.67 ? '#ef4444' : '#f59e0b',
        desc: `剔除 & 提交 ${totalDrawCalls} 张派工单`,
      },
      {
        label: 'GPU (显卡绘制)',
        ms: gpuMs,
        color: gpuMs > 16.67 ? '#dc2626' : '#10b981',
        desc: '顶点 + 光栅化 + 像素着色',
      },
    ];

    rows.forEach((row, idx) => {
      const y = 54 + idx * 32;
      ctx.fillStyle = ink;
      ctx.font = '600 11.5px "Noto Sans SC", sans-serif';
      ctx.fillText(row.label, 24, y + 15);

      // Track
      ctx.fillStyle = grid;
      ctx.beginPath();
      ctx.roundRect(barLeft, y, barMaxW, 21, 5);
      ctx.fill();

      // Filled bar
      const fillW = Math.max(8, (row.ms / maxScaleMs) * barMaxW);
      ctx.fillStyle = row.color;
      ctx.beginPath();
      ctx.roundRect(barLeft, y, Math.min(barMaxW, fillW), 21, 5);
      ctx.fill();

      // GPU idle bubble when Draw > GPU
      if (idx === 2 && drawMs > gpuMs + 1.2) {
        const startX = barLeft + (gpuMs / maxScaleMs) * barMaxW;
        const endX = Math.min(barLeft + barMaxW, barLeft + (drawMs / maxScaleMs) * barMaxW);
        const bw = endX - startX;
        if (bw > 24) {
          ctx.fillStyle = isDark ? 'rgba(239, 68, 68, 0.22)' : 'rgba(239, 68, 68, 0.16)';
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.roundRect(startX + 2, y + 1, bw - 2, 19, 4);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = isDark ? '#fca5a5' : '#b91c1c';
          ctx.font = '700 10px "Noto Sans SC", sans-serif';
          if (bw > 86) {
            ctx.fillText('💤 GPU 闲等派工单!', startX + 8, y + 14);
          }
        }
      }

      // Value text
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 10.5px "JetBrains Mono", monospace';
      ctx.fillText(`${row.ms.toFixed(1)} ms`, barLeft + 8, y + 14.5);

      if (fillW > 135) {
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.font = '500 10px "Noto Sans SC", sans-serif';
        ctx.fillText(row.desc, barLeft + 64, y + 14.5);
      }
    });

    // --- BOTTOM LEFT: Draw Call Pass Breakdown & PSO Switches ---
    const botY = 172;
    const botH = H - botY - 12;
    const leftW = 365;
    ctx.fillStyle = cardBg;
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(23,22,20,0.12)';
    ctx.beginPath();
    ctx.roundRect(12, botY, leftW, botH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = ink;
    ctx.font = '700 12px "Noto Sans SC", sans-serif';
    ctx.fillText('📋 派工单队列与渲染状态 (PSO) 切换', 24, botY + 22);

    const passBars = [
      { name: 'Depth Prepass (深度预通)', count: depthPrepassDraws, color: '#64748b' },
      { name: 'Base Pass (写入 GBuffer)', count: basePassDraws, color: '#0f766e' },
      { name: 'Shadow / VSM Pass (阴影)', count: shadowPassDraws, color: '#7c3aed' },
    ];
    const maxPass = Math.max(100, basePassDraws, 1200);

    passBars.forEach((pb, i) => {
      const py = botY + 38 + i * 36;
      ctx.fillStyle = muted;
      ctx.font = '600 10.5px "Noto Sans SC", sans-serif';
      ctx.fillText(pb.name, 24, py + 9);

      ctx.fillStyle = ink;
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${pb.count} calls`, 12 + leftW - 14, py + 9);
      ctx.textAlign = 'left';

      const trackW = leftW - 28;
      ctx.fillStyle = grid;
      ctx.beginPath();
      ctx.roundRect(24, py + 14, trackW, 13, 4);
      ctx.fill();

      const segW = Math.min(trackW, Math.max(pb.count > 0 ? 6 : 0, (pb.count / maxPass) * trackW));
      ctx.fillStyle = pb.color;
      ctx.beginPath();
      ctx.roundRect(24, py + 14, segW, 13, 4);
      ctx.fill();

      // Visualize PSO/material state switches as white ticks when separate
      if (batchMode === 'separate' && pb.count > 0) {
        const tickCount = Math.min(34, Math.max(4, Math.floor(pb.count / 60)));
        ctx.strokeStyle = 'rgba(255,255,255,0.48)';
        ctx.lineWidth = 1;
        for (let t = 1; t < tickCount; t++) {
          const tx = 24 + (t / tickCount) * segW;
          ctx.beginPath();
          ctx.moveTo(tx, py + 14);
          ctx.lineTo(tx, py + 27);
          ctx.stroke();
        }
      }
    });

    ctx.fillStyle = batchMode === 'merged' ? (isDark ? '#6ee7b7' : '#047857') : (isDark ? '#fca5a5' : '#b91c1c');
    ctx.font = '600 10.5px "Noto Sans SC", sans-serif';
    ctx.fillText(
      batchMode === 'merged'
        ? '✅ 合槽合批后：白色状态切换刻痕几乎消失，Render 线程极度轻松'
        : `⚠️ 竖纹代表反复切换材质/状态：${visibleProps} 物体 × ${matSlots} 材质槽 × 多 Pass！`,
      24,
      botY + botH - 10
    );

    // --- BOTTOM RIGHT: Frustum Culling Mini-Map ---
    const rightX = 12 + leftW + 10;
    const rightW = W - rightX - 12;
    ctx.fillStyle = cardBg;
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(23,22,20,0.12)';
    ctx.beginPath();
    ctx.roundRect(rightX, botY, rightW, botH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = ink;
    ctx.font = '700 12px "Noto Sans SC", sans-serif';
    ctx.fillText('🎥 视锥剔除与物体分布俯视图', rightX + 12, botY + 22);

    const mapX = rightX + 12;
    const mapY = botY + 30;
    const mapW = rightW - 24;
    const mapH = botH - 46;

    ctx.fillStyle = isDark ? '#0e1117' : '#f1ede4';
    ctx.beginPath();
    ctx.roundRect(mapX, mapY, mapW, mapH, 7);
    ctx.fill();

    // Camera frustum triangle
    const camX = mapX + 20;
    const camY = mapY + mapH / 2;
    ctx.fillStyle = isDark ? 'rgba(45, 212, 191, 0.14)' : 'rgba(15, 118, 110, 0.13)';
    ctx.strokeStyle = isDark ? 'rgba(45, 212, 191, 0.6)' : 'rgba(15, 118, 110, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(camX, camY);
    ctx.lineTo(mapX + mapW - 10, mapY + 8);
    ctx.lineTo(mapX + mapW - 10, mapY + mapH - 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw deterministic prop dots
    const dotTotal = Math.min(120, Math.max(24, Math.round(propCount / 8)));
    for (let i = 0; i < dotTotal; i++) {
      const sx = ((i * 73 + 17) % 100) / 100;
      const sy = ((i * 41 + 29) % 100) / 100;
      const dx = mapX + 28 + sx * (mapW - 42);
      const dy = mapY + 8 + sy * (mapH - 16);
      const relX = (dx - camX) / Math.max(1, mapW - 30);
      const halfSpread = relX * (mapH * 0.44);
      const inFrustum = Math.abs(dy - camY) <= halfSpread;
      const isCulled = cullingOn && !inFrustum;

      ctx.fillStyle = isCulled
        ? isDark
          ? 'rgba(148,163,184,0.22)'
          : 'rgba(100,116,139,0.25)'
        : batchMode === 'merged'
        ? '#10b981'
        : matSlots >= 4
        ? '#ef4444'
        : '#f59e0b';
      ctx.beginPath();
      ctx.arc(dx, dy, isCulled ? 2.1 : 3.0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Camera icon dot
    ctx.fillStyle = '#0f766e';
    ctx.beginPath();
    ctx.arc(camX, camY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = muted;
    ctx.font = '600 10px "Noto Sans SC", sans-serif';
    ctx.fillText(
      cullingOn ? `已剔除视野外 ${propCount - visibleProps} 个物体（灰点不发单）` : '未开剔除：视野外物体仍在消耗提交预算',
      mapX,
      botY + botH - 6
    );
  }, [
    propCount,
    matSlots,
    castShadows,
    cullingOn,
    batchMode,
    visibleProps,
    basePassDraws,
    depthPrepassDraws,
    shadowPassDraws,
    totalDrawCalls,
    gameMs,
    drawMs,
    gpuMs,
    frameMs,
    isDark,
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={batchMode === 'separate' || matSlots > 1}
          pitfallLabel={`500 个独立摆件 × ${matSlots} 个材质槽，Draw Call 飙升至 ${totalDrawCalls} 次，CPU 渲染线程爆红！`}
          correctLabel="合并材质槽（1 槽图集）+ 视锥剔除 + 合批提交，Draw Call 断崖下降稳跑 60 FPS！"
          onToggle={(pit) => {
            if (pit) {
              setPropCount(500);
              setMatSlots(5);
              setCullingOn(false);
              setBatchMode('separate');
            } else {
              setPropCount(500);
              setMatSlots(1);
              setCullingOn(true);
              setBatchMode('merged');
            }
          }}
        />
      )}

      <canvas
        ref={canvasRef}
        width={680}
        height={352}
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
            label="场景同类摆件数量"
            value={propCount}
            min={60}
            max={1200}
            step={20}
            unit=" 个"
            onChange={setPropCount}
          />
          <StageSlider
            label="单模型材质槽数 (Material Slots)"
            value={matSlots}
            min={1}
            max={6}
            step={1}
            unit=" 槽"
            onChange={setMatSlots}
          />
          <StageSegmented<SubmitBatchMode>
            label="提交与材质槽策略"
            value={batchMode}
            options={[
              { value: 'separate', label: '分散多槽逐个发单' },
              { value: 'merged', label: '合槽 + 合批提交 ✅' },
            ]}
            onChange={setBatchMode}
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
          <StageToggle
            label="开启视锥 / 距离剔除 (Culling)"
            checked={cullingOn}
            onChange={setCullingOn}
            hint="视野外不发派工单"
          />
          <StageToggle
            label="物体投射实时阴影 (Cast Shadow)"
            checked={castShadows}
            onChange={setCastShadows}
            hint="会额外增加 Shadow Pass Draw Calls"
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// LESSON 9.6 STAGE: GPU Instancing & Custom Data Courtyard Lab
// ============================================================================

type InstancingMode = 'actor_mid' | 'ism_uniform' | 'ism_custom' | 'nanite_hism';

const Stage9_6_GpuInstancingLab: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [instanceCount, setInstanceCount] = useState<number>(320);
  const [mode, setMode] = useState<InstancingMode>('actor_mid');
  const [windDesync, setWindDesync] = useState<boolean>(true);
  const [highlightedIds, setHighlightedIds] = useState<number[]>([5, 14, 21]);
  const [phaseTick, setPhaseTick] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevStepRef = useRef(stepIndex);
  const prevResetRef = useRef(resetSignal);

  useEffect(() => {
    if (prevStepRef.current === stepIndex) return;
    prevStepRef.current = stepIndex;
    if (stepIndex === 0) {
      setMode('actor_mid');
      setInstanceCount(320);
    } else if (stepIndex === 1) {
      setMode('ism_uniform');
      setInstanceCount(320);
    } else if (stepIndex === 2) {
      setMode('ism_custom');
      setInstanceCount(320);
      setWindDesync(true);
    } else if (stepIndex === 3) {
      setMode('nanite_hism');
      setInstanceCount(480);
    } else if (stepIndex === 4) {
      setMode('actor_mid');
      setInstanceCount(360);
    }
  }, [stepIndex]);

  useEffect(() => {
    if (prevResetRef.current === resetSignal) return;
    prevResetRef.current = resetSignal;
    setInstanceCount(320);
    setMode('actor_mid');
    setWindDesync(true);
    setHighlightedIds([5, 14, 21]);
  }, [resetSignal]);

  // Lightweight gentle wind sway animation (~20fps timer, ultra-low CPU)
  useEffect(() => {
    const id = window.setInterval(() => {
      setPhaseTick((t) => (t + 0.14) % (Math.PI * 20));
    }, 55);
    return () => window.clearInterval(id);
  }, []);

  const drawCalls =
    mode === 'actor_mid'
      ? instanceCount
      : mode === 'ism_uniform' || mode === 'ism_custom'
      ? 1
      : 1; // Nanite Shading Bin (1 material bin)

  const midCount = mode === 'actor_mid' ? instanceCount : 0;

  useEffect(() => {
    const modeTitle: Record<InstancingMode, string> = {
      actor_mid: '独立 Actor + 逐棵 MID (破批)',
      ism_uniform: 'ISM 单批次 (同色克隆人)',
      ism_custom: 'ISM + PerInstanceRandom & CustomData',
      nanite_hism: 'UE 5.8 Nanite + HISM (1 Shading Bin)',
    };
    onKpiUpdate([
      {
        label: 'Base Pass Draw Calls',
        value: mode === 'nanite_hism' ? '1 Shading Bin' : `${drawCalls} 次`,
        sub: mode === 'actor_mid' ? '每棵树单独发派工单！' : `${instanceCount} 个实例一单团购画完`,
        tone: mode === 'actor_mid' ? 'bad' : 'good',
      },
      {
        label: '当前提交架构',
        value: modeTitle[mode],
        tone: mode === 'actor_mid' ? 'bad' : mode === 'ism_uniform' ? 'warn' : 'good',
      },
      {
        label: '运行时 MID 数量',
        value: `${midCount} 个`,
        sub: midCount > 0 ? '批量 MID 会打断合批并涨内存' : '0 个 MID · 靠显存自定义浮点变色',
        tone: midCount > 0 ? 'bad' : 'good',
      },
      {
        label: '已标记高亮实例',
        value: `${highlightedIds.length} 棵`,
        sub: '点击画布树冠可切换受击/高亮状态',
        tone: 'accent',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawCalls, mode, midCount, instanceCount, highlightedIds.length]);

  // Fixed visual grid of 36 trees (6x6) representing the forest batch
  const COLS = 6;
  const ROWS = 6;
  const VIEW_W = 416;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);
    const bg = isDark ? '#10141c' : '#f4f2ec';
    const cardBg = isDark ? '#181d28' : '#ffffff';
    const ink = isDark ? '#e6ebf4' : '#181715';
    const muted = isDark ? '#94a3b8' : '#645e56';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Left courtyard forest canvas
    const meadowGrad = ctx.createLinearGradient(0, 12, 0, H - 12);
    if (isDark) {
      meadowGrad.addColorStop(0, '#132028');
      meadowGrad.addColorStop(1, '#192a22');
    } else {
      meadowGrad.addColorStop(0, '#dbeafe');
      meadowGrad.addColorStop(0.28, '#e6f4ea');
      meadowGrad.addColorStop(1, '#cde6d2');
    }
    ctx.fillStyle = meadowGrad;
    ctx.beginPath();
    ctx.roundRect(12, 12, VIEW_W, H - 24, 10);
    ctx.fill();
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(23,22,20,0.14)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Header badge on left view
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    ctx.beginPath();
    ctx.roundRect(22, 20, 396, 26, 6);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 11.5px "Noto Sans SC", sans-serif';
    ctx.fillText(
      `🌲 实例化林地示意（代表 ${instanceCount} 棵树 · 点击任意树冠触发受击高亮）`,
      32,
      37
    );

    // Draw 36 trees with perspective rows
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const id = r * COLS + c;
        // Deterministic pseudo-random [0, 1) representing PerInstanceRandom!
        const rand = ((Math.sin(id * 12.9898 + 78.233) * 43758.5453) % 1 + 1) % 1;
        const depthT = r / (ROWS - 1);
        const cx = 50 + c * 65 + (r % 2 === 1 ? 14 : -4);
        const baseY = 92 + r * 42;
        const scale = (0.72 + depthT * 0.34) * (mode === 'ism_uniform' ? 1.0 : 0.86 + rand * 0.3);
        const isHit = highlightedIds.includes(id);

        // Wind sway: uniform vs ObjectPositionWS desync!
        const phase = windDesync ? phaseTick + cx * 0.045 + r * 0.9 : phaseTick;
        const sway = Math.sin(phase) * (4.5 * scale);

        // Shadow oval
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.beginPath();
        ctx.ellipse(cx, baseY + 2, 13 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
        ctx.fill();

        // Trunk
        ctx.strokeStyle = isDark ? '#785a46' : '#6b4423';
        ctx.lineWidth = 4.2 * scale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, baseY);
        ctx.quadraticCurveTo(cx + sway * 0.35, baseY - 12 * scale, cx + sway * 0.75, baseY - 22 * scale);
        ctx.stroke();

        // Foliage color based on mode
        let fillCol = '#2d8a4e';
        if (isHit) {
          fillCol = '#f97316'; // CustomData[0]=1 or MID highlight!
        } else if (mode === 'ism_uniform') {
          fillCol = '#2e8b57'; // Identical clone green
        } else {
          // PerInstanceRandom autumn/spring palette!
          const palette = ['#2d8a4e', '#4aa35a', '#74b449', '#c49a2c', '#d97736', '#21704c'];
          fillCol = palette[Math.floor(rand * palette.length)];
        }

        // Crown circles
        const topX = cx + sway;
        const topY = baseY - 25 * scale;
        ctx.fillStyle = fillCol;
        ctx.beginPath();
        ctx.arc(topX, topY, 13.5 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.arc(topX - 3.5 * scale, topY - 4 * scale, 5.5 * scale, 0, Math.PI * 2);
        ctx.fill();

        // Highlight ring if hit
        if (isHit) {
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(topX, topY, 16 * scale, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Draw call badge on first row when actor_mid
        if (mode === 'actor_mid' && r === 0) {
          ctx.fillStyle = 'rgba(220, 38, 38, 0.88)';
          ctx.beginPath();
          ctx.roundRect(cx - 14, baseY + 4, 28, 13, 3);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = '700 8.5px "JetBrains Mono", monospace';
          ctx.fillText(`DC#${id + 1}`, cx - 12, baseY + 13.5);
        }
      }
    }

    // Bottom status ribbon on left canvas
    const statusOk = mode !== 'actor_mid';
    ctx.fillStyle = statusOk ? 'rgba(15, 118, 110, 0.9)' : 'rgba(185, 28, 28, 0.92)';
    ctx.beginPath();
    ctx.roundRect(22, H - 40, 396, 22, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 10.5px "Noto Sans SC", sans-serif';
    const bannerText =
      mode === 'actor_mid'
        ? `❌ 破批警告：${instanceCount} 个独立 Actor + MID = ${instanceCount} 次 Draw Call！`
        : mode === 'ism_uniform'
        ? `⚡ 1 次 Draw Call 团购完成，但缺少随机数据显得像复制粘贴克隆人`
        : mode === 'ism_custom'
        ? `✅ 1 次 Draw Call！靠 PerInstanceRandom 染色 + CustomData[0] 单棵高亮！`
        : `🚀 Nanite + HISM：GPU 自动 Cluster 剔除，同材质稳走 1 个 Shading Bin！`;
    ctx.fillText(bannerText, 30, H - 25);

    // --- RIGHT PANEL: Instance Buffer Table ---
    const rx = VIEW_W + 22;
    const rw = W - rx - 12;
    ctx.fillStyle = cardBg;
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(23,22,20,0.14)';
    ctx.beginPath();
    ctx.roundRect(rx, 12, rw, H - 24, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = ink;
    ctx.font = '700 12px "Noto Sans SC", sans-serif';
    ctx.fillText(
      mode === 'actor_mid' ? '⚠️ 独立派工单 + MID 清单' : '📦 GPU 显存 Instance Buffer',
      rx + 12,
      33
    );

    ctx.fillStyle = muted;
    ctx.font = '500 10px "Noto Sans SC", sans-serif';
    ctx.fillText(
      mode === 'actor_mid'
        ? '每次改色新建 MID → 无法合批'
        : '1 份材质 + 1 张表按 ID 并发读取',
      rx + 12,
      49
    );

    // Table header
    const ty0 = 62;
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(23,22,20,0.05)';
    ctx.fillRect(rx + 8, ty0, rw - 16, 20);
    ctx.fillStyle = muted;
    ctx.font = '700 9.5px "JetBrains Mono", monospace';
    ctx.fillText('ID', rx + 14, ty0 + 13);
    ctx.fillText('Rand', rx + 48, ty0 + 13);
    ctx.fillText('Custom[0]', rx + 94, ty0 + 13);
    ctx.fillText('提交归属', rx + 162, ty0 + 13);

    const sampleIds = [0, 5, 11, 14, 21, 28, 35];
    sampleIds.forEach((sid, idx) => {
      const y = ty0 + 24 + idx * 28;
      const rand = ((Math.sin(sid * 12.9898 + 78.233) * 43758.5453) % 1 + 1) % 1;
      const isHit = highlightedIds.includes(sid);

      if (isHit) {
        ctx.fillStyle = isDark ? 'rgba(249, 115, 22, 0.16)' : 'rgba(249, 115, 22, 0.12)';
        ctx.beginPath();
        ctx.roundRect(rx + 8, y - 4, rw - 16, 23, 4);
        ctx.fill();
      }

      ctx.fillStyle = ink;
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(`#${String(sid).padStart(2, '0')}`, rx + 14, y + 11);
      ctx.fillText(mode === 'ism_uniform' ? '忽略' : rand.toFixed(2), rx + 48, y + 11);
      ctx.fillStyle = isHit ? '#ea580c' : muted;
      ctx.fillText(isHit ? '1.00 🔥' : '0.00', rx + 94, y + 11);

      ctx.fillStyle = mode === 'actor_mid' ? '#dc2626' : '#0f766e';
      ctx.font = '700 9.5px "JetBrains Mono", monospace';
      ctx.fillText(
        mode === 'actor_mid' ? `DC #${sid + 1}` : mode === 'nanite_hism' ? 'Bin #1' : 'DC #1',
        rx + 162,
        y + 11
      );
    });

    // Ellipsis & summary box
    ctx.fillStyle = muted;
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.fillText(`... 共 ${instanceCount} 条实例记录`, rx + 14, H - 56);

    ctx.fillStyle = isDark ? 'rgba(45, 212, 191, 0.12)' : 'rgba(15, 118, 110, 0.09)';
    ctx.beginPath();
    ctx.roundRect(rx + 10, H - 44, rw - 20, 24, 6);
    ctx.fill();
    ctx.fillStyle = isDark ? '#5eead4' : '#0f766e';
    ctx.font = '700 10.5px "Noto Sans SC", sans-serif';
    ctx.fillText(
      mode === 'actor_mid'
        ? `合计派工单：${instanceCount} 次 (CPU 过载)`
        : `合计派工单：1 次 (降幅 ${((1 - 1 / instanceCount) * 100).toFixed(1)}%)`,
      rx + 18,
      H - 28
    );
  }, [instanceCount, mode, windDesync, highlightedIds, phaseTick, isDark]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const cy = ((e.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    if (cx > VIEW_W + 12) return;

    let bestId = -1;
    let bestDist = 28;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const id = r * COLS + c;
        const tx = 50 + c * 65 + (r % 2 === 1 ? 14 : -4);
        const ty = 92 + r * 42 - 20;
        const d = Math.hypot(cx - tx, cy - ty);
        if (d < bestDist) {
          bestDist = d;
          bestId = id;
        }
      }
    }
    if (bestId >= 0) {
      setHighlightedIds((prev) =>
        prev.includes(bestId) ? prev.filter((x) => x !== bestId) : [...prev, bestId]
      );
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={mode === 'actor_mid'}
          pitfallLabel={`360 棵树逐棵 Create Dynamic Material Instance (MID) 改色，瞬间破批飙升到 ${instanceCount} 次 Draw Call！`}
          correctLabel="使用 HISM / ISM + PerInstanceRandom & PerInstanceCustomData，仅 1 次 Draw Call 就能千人千面！"
          onToggle={(pit) => setMode(pit ? 'actor_mid' : 'ism_custom')}
        />
      )}

      <canvas
        ref={canvasRef}
        width={680}
        height={352}
        onClick={handleCanvasClick}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          borderRadius: 11,
          border: '1.5px solid var(--border-strong)',
          cursor: 'pointer',
        }}
      />

      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSegmented<InstancingMode>
            label="实例化与材质变参模式"
            value={mode}
            options={[
              { value: 'actor_mid', label: '独立 Actor+MID' },
              { value: 'ism_uniform', label: 'ISM 同色' },
              { value: 'ism_custom', label: 'ISM+随机/CustomData ✅' },
              { value: 'nanite_hism', label: 'Nanite+HISM 🚀' },
            ]}
            onChange={setMode}
          />
          <StageSlider
            label="场景树林总实例数"
            value={instanceCount}
            min={48}
            max={600}
            step={12}
            unit=" 棵"
            onChange={setInstanceCount}
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
          <StageToggle
            label="用 ObjectPositionWS 错开风摆相位"
            checked={windDesync}
            onChange={setWindDesync}
            hint="取消后全森林像广播体操整齐齐晃"
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// LESSON 9.7 STAGE: LOD Multi-Level, 2x2 Quad Overdraw & HLOD Lab
// ============================================================================

type LodStrategy = 'no_lod' | 'mesh_lod' | 'mat_lod' | 'nanite';
type LodViewMode = 'wireframe' | 'quad' | 'coloration';

const Stage9_7_LodAndQuadOverdraw: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [distanceM, setDistanceM] = useState<number>(68);
  const [strategy, setStrategy] = useState<LodStrategy>('no_lod');
  const [viewMode, setViewMode] = useState<LodViewMode>('quad');
  const [ditherOn, setDitherOn] = useState<boolean>(false);
  const [hlodOn, setHlodOn] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevStepRef = useRef(stepIndex);
  const prevResetRef = useRef(resetSignal);

  useEffect(() => {
    if (prevStepRef.current === stepIndex) return;
    prevStepRef.current = stepIndex;
    if (stepIndex === 0) {
      setDistanceM(72);
      setStrategy('no_lod');
      setViewMode('quad');
      setHlodOn(false);
    } else if (stepIndex === 1) {
      setDistanceM(65);
      setStrategy('no_lod');
      setViewMode('quad');
      setHlodOn(false);
    } else if (stepIndex === 2) {
      setDistanceM(55);
      setStrategy('mesh_lod');
      setViewMode('wireframe');
      setDitherOn(true);
      setHlodOn(false);
    } else if (stepIndex === 3) {
      setDistanceM(85);
      setStrategy('mat_lod');
      setViewMode('coloration');
      setHlodOn(true);
    } else if (stepIndex === 4) {
      setDistanceM(82);
      setStrategy('no_lod');
      setViewMode('quad');
      setHlodOn(false);
    }
  }, [stepIndex]);

  useEffect(() => {
    if (prevResetRef.current === resetSignal) return;
    prevResetRef.current = resetSignal;
    setDistanceM(68);
    setStrategy('no_lod');
    setViewMode('quad');
    setDitherOn(false);
    setHlodOn(false);
  }, [resetSignal]);

  // Compute Screen Size (0.04..0.95) from distance (3..120m)
  const screenSize = clamp(8.5 / (distanceM + 5.5), 0.05, 0.96);

  // Determine active LOD level from Screen Size
  let lodLevel = 0;
  if (strategy === 'mesh_lod' || strategy === 'mat_lod') {
    if (screenSize < 0.14) lodLevel = 3;
    else if (screenSize < 0.28) lodLevel = 2;
    else if (screenSize < 0.52) lodLevel = 1;
    else lodLevel = 0;
  }

  const trisTable = [12800, 4200, 1100, 260];
  const activeTris =
    strategy === 'nanite'
      ? Math.max(180, Math.round(screenSize * 3800))
      : trisTable[lodLevel];

  // Material slots & WPO state
  const activeMatSlots =
    strategy === 'mat_lod' && lodLevel >= 2
      ? 1
      : strategy === 'mat_lod' && lodLevel === 1
      ? 2
      : 4;
  const wpoActive = !(strategy === 'mat_lod' && lodLevel >= 2);

  // Average projected triangle edge size in pixels -> drives 2x2 Quad Helper Lane waste!
  const approxPxDiameter = screenSize * 210;
  const approxTriAreaPx = (Math.PI * (approxPxDiameter * 0.5) ** 2) / Math.max(1, activeTris * 0.5);
  const avgTriEdgePx = Math.sqrt(Math.max(0.08, approxTriAreaPx * 2.1));

  // Helper lane waste: small triangles (<2px) waste up to ~75% of 2x2 quad lanes
  const helperWastePct = Math.round(
    clamp(
      strategy === 'nanite'
        ? 14 + (1 - screenSize) * 10
        : 76 / (1 + Math.pow(avgTriEdgePx / 2.2, 1.55)),
      8,
      78
    )
  );

  // Neighborhood draw call when HLOD is toggled (25 buildings)
  const districtDraws = hlodOn && distanceM >= 55 ? 1 : 25 * activeMatSlots;

  useEffect(() => {
    const lodLabel =
      strategy === 'nanite'
        ? 'Nanite 连续微细节'
        : `LOD ${lodLevel} (${(screenSize * 100).toFixed(0)}% 屏占比)`;
    onKpiUpdate([
      {
        label: 'Screen Size / 当前层级',
        value: lodLabel,
        sub: `视距 ${distanceM} m · 依屏幕占比自动切级`,
        tone: strategy === 'no_lod' && distanceM > 35 ? 'bad' : 'good',
      },
      {
        label: '实时面数 & 材质槽',
        value: `${activeTris.toLocaleString()} 面 · ${activeMatSlots} 槽`,
        sub: wpoActive ? '含法线/清漆/WPO 全套计算' : '远景已合槽简材并关 WPO ✅',
        tone: activeTris > 6000 && distanceM > 40 ? 'bad' : activeMatSlots === 1 ? 'good' : 'warn',
      },
      {
        label: '2×2 Quad 辅助浪费',
        value: `${helperWastePct}% 废算`,
        sub: helperWastePct >= 50 ? '⚠️ 微三角形烧白 Quad Overdraw!' : '三角形尺寸健康，2×2 利用率高',
        tone: helperWastePct >= 52 ? 'bad' : helperWastePct >= 30 ? 'warn' : 'good',
      },
      {
        label: '25 栋街区 Draw Calls',
        value: `${districtDraws} 次`,
        sub: hlodOn && distanceM >= 55 ? '✅ 远景已切为 1 个 HLOD 合并代理' : '逐栋提交（远景建议启用 HLOD）',
        tone: districtDraws === 1 ? 'good' : districtDraws <= 30 ? 'warn' : 'bad',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distanceM, strategy, lodLevel, screenSize, activeTris, activeMatSlots, wpoActive, helperWastePct, districtDraws, hlodOn]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const bg = isDark ? '#10131a' : '#f5f3ed';
    const cardBg = isDark ? '#171b24' : '#ffffff';
    const ink = isDark ? '#e6ebf4' : '#181715';
    const muted = isDark ? '#94a3b8' : '#645e56';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // --- LEFT: Viewport Preview ---
    const leftW = 372;
    ctx.fillStyle = isDark ? '#0d1118' : '#1c2330';
    ctx.beginPath();
    ctx.roundRect(12, 12, leftW, H - 24, 10);
    ctx.fill();
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(23,22,20,0.22)';
    ctx.stroke();

    // Horizon & ground perspective grid
    const horizonY = 124;
    ctx.fillStyle = isDark ? '#131b29' : '#253147';
    ctx.fillRect(13, 13, leftW - 2, horizonY - 13);
    ctx.strokeStyle = 'rgba(148,163,184,0.18)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 5; i++) {
      const gy = horizonY + i * i * 7.2;
      if (gy < H - 18) {
        ctx.beginPath();
        ctx.moveTo(14, gy);
        ctx.lineTo(12 + leftW - 2, gy);
        ctx.stroke();
      }
    }

    // UE Coloration palette: LOD0 White, LOD1 Red, LOD2 Green, LOD3 Blue
    const lodColors = ['#f8fafc', '#f87171', '#4ade80', '#60a5fa'];
    const lodNames = ['LOD 0 (精模)', 'LOD 1 (中模)', 'LOD 2 (简模)', 'LOD 3 (极简)'];

    // Draw stylized statue/tower mesh scaled by Screen Size!
    const cx = 12 + leftW / 2;
    const baseY = lerp(296, 178, (distanceM - 3) / 117);
    const radius = clamp(screenSize * 112, 16, 106);

    const isHlodMerged = hlodOn && distanceM >= 55;

    const drawStylizedMesh = (mx: number, my: number, r: number, rings: number, segs: number) => {
      // Determine fill based on viewMode
      let fill = '#64748b';
      if (viewMode === 'coloration') {
        fill = strategy === 'nanite' ? '#a855f7' : lodColors[lodLevel];
      } else if (viewMode === 'quad') {
        fill =
          helperWastePct >= 55
            ? '#ffffff'
            : helperWastePct >= 38
            ? '#f97316'
            : helperWastePct >= 22
            ? '#eab308'
            : '#22c55e';
      } else {
        fill = activeMatSlots === 1 ? '#38bdf8' : '#94a3b8';
      }

      // Outer polyhedral silhouette
      const pts: [number, number][] = [];
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2 - Math.PI / 2;
        const wob = 1 + 0.08 * Math.cos(i * 3);
        pts.push([mx + Math.cos(a) * r * wob, my - r * 0.9 + Math.sin(a) * r * wob]);
      }

      ctx.fillStyle = fill;
      ctx.globalAlpha = ditherOn && Math.abs(screenSize - 0.28) < 0.05 ? 0.78 : 0.94;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // Dithered stipple dots when near LOD boundary and ditherOn
      if (ditherOn && strategy !== 'no_lod' && strategy !== 'nanite') {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
        for (let dy = -r; dy <= r; dy += 6) {
          for (let dx = -r; dx <= r; dx += 6) {
            if (dx * dx + dy * dy < r * r * 0.85 && ((Math.floor(dx + dy) & 1) === 0)) {
              ctx.fillRect(mx + dx, my - r * 0.9 + dy, 1.8, 1.8);
            }
          }
        }
      }

      // Wireframe lines showing geometric density
      ctx.strokeStyle =
        viewMode === 'quad'
          ? 'rgba(185, 28, 28, 0.55)'
          : viewMode === 'coloration'
          ? 'rgba(15, 23, 42, 0.5)'
          : 'rgba(15, 23, 42, 0.72)';
      ctx.lineWidth = rings >= 7 ? 0.65 : 1.1;

      // Radial spokes + concentric rings
      for (let i = 0; i < segs; i++) {
        ctx.beginPath();
        ctx.moveTo(mx, my - r * 0.9);
        ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
      for (let k = 1; k <= rings; k++) {
        const f = k / rings;
        ctx.beginPath();
        pts.forEach(([px, py], i) => {
          const rx = lerp(mx, px, f);
          const ry = lerp(my - r * 0.9, py, f);
          if (i === 0) ctx.moveTo(rx, ry);
          else ctx.lineTo(rx, ry);
        });
        ctx.closePath();
        ctx.stroke();
      }

      // Material slot color bands when in wireframe mode
      if (viewMode === 'wireframe' && !isHlodMerged) {
        const slotPalette = ['#0f766e', '#f59e0b', '#ec4899', '#6366f1'];
        for (let s = 0; s < activeMatSlots; s++) {
          ctx.fillStyle = slotPalette[s];
          ctx.fillRect(mx - r * 0.7 + s * 16, my + 8, 12, 6);
        }
      }
    };

    if (isHlodMerged) {
      // Draw a merged single HLOD proxy silhouette of a whole district!
      ctx.fillStyle = viewMode === 'quad' ? '#22c55e' : viewMode === 'coloration' ? '#38bdf8' : '#34d399';
      ctx.beginPath();
      ctx.roundRect(cx - 88, baseY - 46, 176, 46, 5);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = '#0f172a';
      ctx.font = '700 11px "Noto Sans SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🏙️ HLOD 合并代理网格（25 栋 → 1 次 Draw Call）', cx, baseY - 19);
      ctx.textAlign = 'left';
    } else {
      const segs =
        strategy === 'nanite'
          ? Math.max(8, Math.round(screenSize * 20))
          : [22, 14, 9, 6][lodLevel];
      const rings =
        strategy === 'nanite'
          ? Math.max(2, Math.round(screenSize * 7))
          : [8, 5, 3, 1][lodLevel];
      drawStylizedMesh(cx, baseY, radius, rings, segs);
    }

    // Viewport top pill
    ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
    ctx.beginPath();
    ctx.roundRect(22, 20, 352, 26, 6);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 11px "Noto Sans SC", sans-serif';
    const vTitle =
      viewMode === 'quad'
        ? '🔥 视口：Quad Overdraw 热图（越白越浪费 2×2 块）'
        : viewMode === 'coloration'
        ? '🎨 视口：Mesh LOD Coloration（白0 / 红1 / 绿2 / 蓝3）'
        : '🕸️ 视口：网格密度 & 底部材质槽色块示意';
    ctx.fillText(vTitle, 30, 37);

    // Bottom HUD badge on left
    ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
    ctx.beginPath();
    ctx.roundRect(22, H - 46, 352, 26, 6);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 10.5px "JetBrains Mono", monospace';
    ctx.fillText(
      `Dist: ${distanceM}m | ScreenSize: ${screenSize.toFixed(2)} | ${
        strategy === 'nanite' ? 'Nanite' : lodNames[lodLevel]
      }`,
      30,
      H - 29
    );

    // --- RIGHT: 2×2 Quad Pixel Block Microscope ---
    const rx = leftW + 22;
    const rw = W - rx - 12;
    ctx.fillStyle = cardBg;
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(23,22,20,0.14)';
    ctx.beginPath();
    ctx.roundRect(rx, 12, rw, H - 24, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = ink;
    ctx.font = '700 12px "Noto Sans SC", sans-serif';
    ctx.fillText('🔬 2×2 Quad 像素块放大镜', rx + 12, 33);

    ctx.fillStyle = muted;
    ctx.font = '500 10px "Noto Sans SC", sans-serif';
    ctx.fillText('显卡每 4 像素一组执行着色器（算 Mipmap 偏导）', rx + 12, 49);

    // Draw 8x8 pixels = 4x4 Quads
    const gridSize = 192;
    const gx0 = rx + Math.floor((rw - gridSize) / 2);
    const gy0 = 62;
    const pxCell = gridSize / 8;

    // Simulate triangle coverage pattern based on helperWastePct
    const isMicroTri = helperWastePct >= 48;
    const isMidTri = helperWastePct >= 26 && helperWastePct < 48;

    for (let qy = 0; qy < 4; qy++) {
      for (let qx = 0; qx < 4; qx++) {
        const quadIdx = qy * 4 + qx;
        // Decide how many pixels inside this 2x2 quad are actually covered by a triangle
        const activeCount = isMicroTri
          ? 1
          : isMidTri
          ? quadIdx % 2 === 0
            ? 2
            : 3
          : quadIdx === 0 || quadIdx === 3 || quadIdx === 12 || quadIdx === 15
          ? 2
          : 4;

        for (let sy = 0; sy < 2; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            const subIdx = sy * 2 + sx;
            const px = gx0 + (qx * 2 + sx) * pxCell;
            const py = gy0 + (qy * 2 + sy) * pxCell;
            const covered = subIdx < activeCount;

            ctx.fillStyle = covered
              ? isDark
                ? 'rgba(34, 197, 94, 0.72)'
                : 'rgba(22, 163, 74, 0.76)'
              : isDark
              ? 'rgba(239, 68, 68, 0.56)'
              : 'rgba(239, 68, 68, 0.45)';
            ctx.fillRect(px + 1, py + 1, pxCell - 2, pxCell - 2);

            ctx.fillStyle = '#ffffff';
            ctx.font = '700 9px "JetBrains Mono", monospace';
            ctx.fillText(covered ? '✓' : '废', px + 6, py + 15);
          }
        }

        // Bold 2x2 Quad border
        ctx.strokeStyle = isDark ? '#e2e8f0' : '#1e293b';
        ctx.lineWidth = 2;
        ctx.strokeRect(gx0 + qx * pxCell * 2, gy0 + qy * pxCell * 2, pxCell * 2, pxCell * 2);

        // Draw overlaid tiny triangle inside micro-tri mode
        if (isMicroTri) {
          const tx = gx0 + qx * pxCell * 2 + 4;
          const ty = gy0 + qy * pxCell * 2 + 4;
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(tx + 2, ty + 14);
          ctx.lineTo(tx + 15, ty + 14);
          ctx.lineTo(tx + 8, ty + 2);
          ctx.closePath();
          ctx.stroke();
        }
      }
    }

    // Legend & Waste Readout
    const ly = gy0 + gridSize + 18;
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(rx + 14, ly - 9, 10, 10);
    ctx.fillStyle = ink;
    ctx.font = '600 10.5px "Noto Sans SC", sans-serif';
    ctx.fillText('有效像素', rx + 28, ly);

    ctx.fillStyle = '#ef4444';
    ctx.fillRect(rx + 96, ly - 9, 10, 10);
    ctx.fillStyle = ink;
    ctx.fillText('白算丢弃的辅助像素 (Helper)', rx + 110, ly);

    ctx.fillStyle =
      helperWastePct >= 50
        ? isDark
          ? 'rgba(239, 68, 68, 0.18)'
          : 'rgba(239, 68, 68, 0.12)'
        : isDark
        ? 'rgba(34, 197, 94, 0.16)'
        : 'rgba(22, 163, 74, 0.12)';
    ctx.beginPath();
    ctx.roundRect(rx + 12, ly + 10, rw - 24, 40, 7);
    ctx.fill();

    ctx.fillStyle = helperWastePct >= 50 ? (isDark ? '#fca5a5' : '#b91c1c') : (isDark ? '#6ee7b7' : '#047857');
    ctx.font = '700 11px "Noto Sans SC", sans-serif';
    ctx.fillText(
      helperWastePct >= 50
        ? `⚠️ 微三角形灾难：约 ${helperWastePct}% 着色算力白白浪费！`
        : `✅ 三角形大小健康：Quad 利用率达 ${100 - helperWastePct}%`,
      rx + 20,
      ly + 27
    );
    ctx.fillStyle = muted;
    ctx.font = '500 10px "Noto Sans SC", sans-serif';
    ctx.fillText(
      `平均三角边长 ≈ ${avgTriEdgePx.toFixed(1)} px · ${ditherOn ? '已开抖动过渡' : '直接切级'}`,
      rx + 20,
      ly + 43
    );
  }, [distanceM, strategy, viewMode, ditherOn, hlodOn, screenSize, lodLevel, activeMatSlots, helperWastePct, avgTriEdgePx, isDark]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={strategy === 'no_lod'}
          pitfallLabel={`82 米外仍死扛 12,800 面 LOD0 + 4 材质槽，2×2 Quad 辅助像素浪费高达 ${helperWastePct}%！`}
          correctLabel="按 Screen Size 自动切到 LOD2/3 + 远景合并为 1 个简配材质槽并关闭 WPO，面数与 Quad 浪费双双骤降！"
          onToggle={(pit) => {
            setDistanceM(82);
            setStrategy(pit ? 'no_lod' : 'mat_lod');
            setViewMode('quad');
            setHlodOn(!pit);
          }}
        />
      )}

      <canvas
        ref={canvasRef}
        width={680}
        height={354}
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
            label="摄像机观察距离（自动换算 Screen Size）"
            value={distanceM}
            min={3}
            max={120}
            step={1}
            unit=" m"
            onChange={setDistanceM}
          />
          <StageSegmented<LodStrategy>
            label="LOD 细节层级策略"
            value={strategy}
            options={[
              { value: 'no_lod', label: '关闭 LOD (死扛)' },
              { value: 'mesh_lod', label: '多级几何 LOD' },
              { value: 'mat_lod', label: 'LOD+合槽简材 ✅' },
              { value: 'nanite', label: 'Nanite 连续' },
            ]}
            onChange={setStrategy}
          />
          <StageSegmented<LodViewMode>
            label="诊断视口模式"
            value={viewMode}
            options={[
              { value: 'wireframe', label: '线框与材质槽' },
              { value: 'quad', label: 'Quad Overdraw' },
              { value: 'coloration', label: 'LOD 染色视图' },
            ]}
            onChange={setViewMode}
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
          <StageToggle
            label="开启 Dithered LOD Transition (抖动平滑过渡)"
            checked={ditherOn}
            onChange={setDitherOn}
            hint="防切级跳变，但会增加类似 Masked 裁剪开销"
          />
          <StageToggle
            label="远景整片街区启用 HLOD（55m+ 合为 1 网格）"
            checked={hlodOn}
            onChange={setHlodOn}
            hint="25 栋远景建筑合为 1 次 Draw Call"
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// LESSON 9.8 STAGE: UE 5.8 Performance Tuning Clinic Simulator
// ============================================================================

type PerfScenario = 'city_draw' | 'forest_overdraw' | 'museum_shader';

const Stage9_8_PerfTuningSimulator: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [scenario, setScenario] = useState<PerfScenario>('city_draw');
  const [fixBatch, setFixBatch] = useState<boolean>(false);
  const [fixLodWpo, setFixLodWpo] = useState<boolean>(false);
  const [fixOverdraw, setFixOverdraw] = useState<boolean>(false);
  const [fixShaderSlim, setFixShaderSlim] = useState<boolean>(false);
  const [fixCulling, setFixCulling] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevStepRef = useRef(stepIndex);
  const prevResetRef = useRef(resetSignal);

  const clearFixes = () => {
    setFixBatch(false);
    setFixLodWpo(false);
    setFixOverdraw(false);
    setFixShaderSlim(false);
    setFixCulling(false);
  };

  useEffect(() => {
    if (prevStepRef.current === stepIndex) return;
    prevStepRef.current = stepIndex;
    if (stepIndex === 0) {
      setScenario('city_draw');
      clearFixes();
      setFixShaderSlim(true); // Classic mistake: slimming shaders on a CPU Draw-bound scene!
    } else if (stepIndex === 1) {
      setScenario('city_draw');
      clearFixes();
    } else if (stepIndex === 2) {
      setScenario('forest_overdraw');
      clearFixes();
    } else if (stepIndex === 3) {
      setScenario('museum_shader');
      clearFixes();
    } else if (stepIndex === 4) {
      setScenario('city_draw');
      clearFixes();
      setFixShaderSlim(true);
    }
  }, [stepIndex]);

  useEffect(() => {
    if (prevResetRef.current === resetSignal) return;
    prevResetRef.current = resetSignal;
    setScenario('city_draw');
    clearFixes();
  }, [resetSignal]);

  // Baseline profiles per scenario
  const base =
    scenario === 'city_draw'
      ? {
          name: '场景 A · 繁华广场（多材质槽 + 独立道具）',
          game: 8.6,
          draw: 22.8,
          drawCalls: 4650,
          basePass: 4.8,
          shadow: 3.1,
          translucency: 1.4,
          lumen: 2.8,
          post: 1.5,
        }
      : scenario === 'forest_overdraw'
      ? {
          name: '场景 B · 迷雾森林（半透明树叶 + 无 LOD + 全图 WPO）',
          game: 7.4,
          draw: 11.2,
          drawCalls: 1480,
          basePass: 5.4,
          shadow: 7.9,
          translucency: 8.8,
          lumen: 2.9,
          post: 1.4,
        }
      : {
          name: '场景 C · 豪车展厅（多层 Substrate + 18 张无打包贴图）',
          game: 6.2,
          draw: 9.8,
          drawCalls: 920,
          basePass: 13.4,
          shadow: 2.8,
          translucency: 2.2,
          lumen: 4.4,
          post: 1.9,
        };

  // Apply prescriptions realistically
  const gameMs = +(
    base.game -
    (fixBatch ? (scenario === 'city_draw' ? 1.8 : 0.6) : 0) -
    (fixCulling ? 0.8 : 0)
  ).toFixed(1);

  const drawMs = +(
    base.draw -
    (fixBatch ? (scenario === 'city_draw' ? 9.8 : 2.8) : 0) -
    (fixCulling ? (scenario === 'city_draw' ? 4.4 : 2.1) : 0) -
    (fixLodWpo ? 0.9 : 0)
  ).toFixed(1);

  const drawCalls = Math.max(
    180,
    Math.round(
      base.drawCalls *
        (fixBatch ? 0.34 : 1) *
        (fixCulling ? 0.62 : 1) *
        (fixLodWpo ? 0.88 : 1)
    )
  );

  const basePassMs = +(
    base.basePass -
    (fixShaderSlim ? (scenario === 'museum_shader' ? 6.8 : 1.5) : 0) -
    (fixLodWpo ? (scenario === 'forest_overdraw' ? 1.8 : 0.7) : 0) -
    (fixCulling ? 0.6 : 0)
  ).toFixed(1);

  const shadowMs = +(
    base.shadow -
    (fixLodWpo ? (scenario === 'forest_overdraw' ? 4.9 : 1.0) : 0) -
    (fixCulling ? 0.7 : 0)
  ).toFixed(1);

  const transMs = +(
    base.translucency -
    (fixOverdraw ? (scenario === 'forest_overdraw' ? 6.6 : 0.7) : 0)
  ).toFixed(1);

  const lumenMs = +(base.lumen - (fixShaderSlim ? 0.9 : 0)).toFixed(1);
  const postMs = base.post;
  const gpuMs = +(basePassMs + shadowMs + transMs + lumenMs + postMs).toFixed(1);
  const frameMs = Math.max(gameMs, drawMs, gpuMs);
  const fps = Math.max(1, Math.round(1000 / frameMs));

  // Detect classic off-bottleneck effort
  const baseGpuMs = base.basePass + base.shadow + base.translucency + base.lumen + base.post;
  const offTargetWarning =
    scenario === 'city_draw' &&
    drawMs > 16.67 &&
    (fixShaderSlim || fixOverdraw) &&
    !fixBatch &&
    !fixCulling;

  const bottleneckTag =
    frameMs <= 16.67
      ? '✅ 已达 60 FPS 目标'
      : drawMs >= gpuMs && drawMs >= gameMs
      ? 'CPU Draw 线程瓶颈'
      : gpuMs >= gameMs
      ? 'GPU 渲染管线瓶颈'
      : 'CPU Game 逻辑瓶颈';

  useEffect(() => {
    onKpiUpdate([
      {
        label: 'Frame 帧耗时 / FPS',
        value: `${frameMs.toFixed(1)} ms · ${fps} FPS`,
        sub: frameMs <= 16.67 ? '🎉 成功跨进 16.67 ms 绿区' : `距 60 FPS 还差 ${(frameMs - 16.67).toFixed(1)} ms`,
        tone: frameMs <= 16.67 ? 'good' : frameMs <= 21 ? 'warn' : 'bad',
      },
      {
        label: '当前木桶短板',
        value: bottleneckTag,
        sub: `Frame = max(Game ${gameMs}, Draw ${drawMs}, GPU ${gpuMs})`,
        tone: frameMs <= 16.67 ? 'good' : 'bad',
      },
      {
        label: 'Mesh Draw Calls',
        value: `${drawCalls.toLocaleString()} 次`,
        sub: 'stat scenerendering 关键指标',
        tone: drawCalls <= 1200 ? 'good' : drawCalls <= 2500 ? 'warn' : 'bad',
      },
      {
        label: 'GPU 耗时降幅',
        value: `${(baseGpuMs - gpuMs).toFixed(1)} ms`,
        sub: offTargetWarning ? '⚠️ GPU 降了但短板在 Draw，帧率未涨！' : 'ProfileGPU 各通道实时合计',
        tone: offTargetWarning ? 'warn' : 'accent',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameMs, fps, bottleneckTag, gameMs, drawMs, gpuMs, drawCalls, baseGpuMs, offTargetWarning]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const bg = isDark ? '#0e1117' : '#f4f2ec';
    const cardBg = isDark ? '#161b24' : '#ffffff';
    const ink = isDark ? '#e6ebf4' : '#181715';
    const muted = isDark ? '#94a3b8' : '#645e56';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // --- LEFT: UE 5.8 `stat unit` HUD ---
    const lw = 314;
    ctx.fillStyle = '#0f141d';
    ctx.beginPath();
    ctx.roundRect(12, 12, lw, H - 24, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.stroke();

    ctx.fillStyle = '#5eead4';
    ctx.font = '700 12px "JetBrains Mono", monospace';
    ctx.fillText('> stat unit  &  stat scenerendering', 24, 34);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 10px "Noto Sans SC", sans-serif';
    ctx.fillText(base.name, 24, 51);

    const statRows = [
      { label: 'Frame', val: frameMs, highlight: true },
      { label: 'Game', val: gameMs, highlight: gameMs === frameMs },
      { label: 'Draw', val: drawMs, highlight: drawMs === frameMs },
      { label: 'GPU', val: gpuMs, highlight: gpuMs === frameMs },
    ];

    const scaleMs = 30;
    const bx = 86;
    const bwMax = lw - 110;
    const line60 = bx + (16.67 / scaleMs) * bwMax;

    // 16.67ms vertical guide
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(line60, 64);
    ctx.lineTo(line60, 220);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fca5a5';
    ctx.font = '700 9.5px "JetBrains Mono", monospace';
    ctx.fillText('16.67ms', line60 - 20, 232);

    statRows.forEach((sr, i) => {
      const y = 72 + i * 37;
      const isOver = sr.val > 16.67;
      ctx.fillStyle = sr.highlight ? '#ffffff' : '#cbd5e1';
      ctx.font = `${sr.highlight ? 700 : 600} 12px "JetBrains Mono", monospace`;
      ctx.fillText(sr.label, 24, y + 16);

      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.roundRect(bx, y, bwMax, 22, 5);
      ctx.fill();

      const fw = Math.min(bwMax, Math.max(8, (sr.val / scaleMs) * bwMax));
      ctx.fillStyle = isOver ? '#ef4444' : sr.val > 13.5 ? '#f59e0b' : '#10b981';
      ctx.beginPath();
      ctx.roundRect(bx, y, fw, 22, 5);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.fillText(`${sr.val.toFixed(1)} ms`, bx + 7, y + 15);
    });

    // Draw Calls & Verdict box
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.roundRect(22, 246, lw - 20, 40, 7);
    ctx.fill();
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 10.5px "JetBrains Mono", monospace';
    ctx.fillText(`Mesh draw calls: ${drawCalls.toLocaleString()}`, 32, 264);
    ctx.fillStyle = frameMs <= 16.67 ? '#4ade80' : '#f87171';
    ctx.font = '700 11px "Noto Sans SC", sans-serif';
    ctx.fillText(`诊断结论：${bottleneckTag}（${fps} FPS）`, 32, 280);

    // Formula reminder
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 10px "Noto Sans SC", sans-serif';
    ctx.fillText('木桶定律：Frame ≈ max(Game, Draw, GPU)', 24, H - 24);

    // --- RIGHT: ProfileGPU Breakdown ---
    const rx = lw + 22;
    const rw = W - rx - 12;
    ctx.fillStyle = cardBg;
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(23,22,20,0.14)';
    ctx.beginPath();
    ctx.roundRect(rx, 12, rw, H - 24, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = ink;
    ctx.font = '700 12px "Noto Sans SC", sans-serif';
    ctx.fillText('🔬 ProfileGPU 通道瀑布拆解 (Ctrl + Shift + ,)', rx + 14, 34);

    ctx.fillStyle = muted;
    ctx.font = '500 10px "Noto Sans SC", sans-serif';
    ctx.fillText(`GPU 总计 ${gpuMs.toFixed(1)} ms（找出最肥的那根柱子对症开方）`, rx + 14, 51);

    const passes = [
      { name: 'BasePass (材质/Substrate/Quad)', ms: basePassMs, col: '#0f766e' },
      { name: 'ShadowDepths / VSM (阴影与 WPO)', ms: shadowMs, col: '#7c3aed' },
      { name: 'Translucency (半透明 Overdraw)', ms: transMs, col: '#ec4899' },
      { name: 'Lumen GI & Reflections', ms: lumenMs, col: '#3b82f6' },
      { name: 'PostProcessing (后处理)', ms: postMs, col: '#64748b' },
    ];

    const pTrackW = rw - 28;
    const maxPassMs = 15;
    passes.forEach((p, idx) => {
      const py = 68 + idx * 41;
      ctx.fillStyle = ink;
      ctx.font = '600 10.5px "Noto Sans SC", sans-serif';
      ctx.fillText(p.name, rx + 14, py + 10);

      ctx.fillStyle = p.ms > 5.5 ? '#ef4444' : ink;
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${p.ms.toFixed(1)} ms`, rx + rw - 14, py + 10);
      ctx.textAlign = 'left';

      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(23,22,20,0.08)';
      ctx.beginPath();
      ctx.roundRect(rx + 14, py + 15, pTrackW, 14, 4);
      ctx.fill();

      const pw = Math.min(pTrackW, Math.max(6, (p.ms / maxPassMs) * pTrackW));
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.roundRect(rx + 14, py + 15, pw, 14, 4);
      ctx.fill();
    });

    // Contextual feedback banner
    const fbY = H - 68;
    const fbBg = offTargetWarning
      ? isDark
        ? 'rgba(245, 158, 11, 0.18)'
        : 'rgba(254, 243, 199, 0.95)'
      : frameMs <= 16.67
      ? isDark
        ? 'rgba(34, 197, 94, 0.18)'
        : 'rgba(220, 252, 231, 0.95)'
      : isDark
      ? 'rgba(56, 189, 248, 0.14)'
      : 'rgba(224, 242, 254, 0.95)';

    ctx.fillStyle = fbBg;
    ctx.beginPath();
    ctx.roundRect(rx + 14, fbY, rw - 28, 44, 8);
    ctx.fill();

    ctx.fillStyle = offTargetWarning
      ? isDark
        ? '#fcd34d'
        : '#92400e'
      : frameMs <= 16.67
      ? isDark
        ? '#6ee7b7'
        : '#166534'
      : isDark
      ? '#7dd3fc'
      : '#075985';
    ctx.font = '700 10.5px "Noto Sans SC", sans-serif';
    if (offTargetWarning) {
      ctx.fillText('⚠️ 典型白忙活：GPU 确实降了，但木桶短板是 CPU Draw！', rx + 22, fbY + 18);
      ctx.font = '500 10px "Noto Sans SC", sans-serif';
      ctx.fillText('请勾选「合槽+实例化」或「剔除/HLOD」削减 Draw 线程！', rx + 22, fbY + 34);
    } else if (frameMs <= 16.67) {
      ctx.fillText('🎉 对症下药成功！三线程全员压进 16.67 ms (60 FPS)！', rx + 22, fbY + 18);
      ctx.font = '500 10px "Noto Sans SC", sans-serif';
      ctx.fillText('可切换上方其他翻车场景，继续演练不同瓶颈的诊断思路。', rx + 22, fbY + 34);
    } else {
      ctx.fillText('🩺 诊断提示：先看左侧最长红条，再看右侧最肥通道！', rx + 22, fbY + 18);
      ctx.font = '500 10px "Noto Sans SC", sans-serif';
      ctx.fillText('勾选下方对应优化药方，观察木桶短板是否真正缩短。', rx + 22, fbY + 34);
    }
  }, [
    scenario,
    base.name,
    frameMs,
    gameMs,
    drawMs,
    gpuMs,
    fps,
    drawCalls,
    bottleneckTag,
    basePassMs,
    shadowMs,
    transMs,
    lumenMs,
    postMs,
    offTargetWarning,
    isDark,
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={offTargetWarning || frameMs > 16.67}
          pitfallLabel="未看 stat unit 就埋头精简材质节点：GPU 从 13.6 降到 11.2 ms，但短板在 Draw 22.8 ms，帧率一帧未涨！"
          correctLabel="先用 stat unit 锁定 CPU Draw 短板，再合槽 + 实例化 + 距离剔除，Frame 直降进 16.67 ms！"
          onToggle={(pit) => {
            setScenario('city_draw');
            clearFixes();
            if (pit) {
              setFixShaderSlim(true);
            } else {
              setFixBatch(true);
              setFixCulling(true);
            }
          }}
        />
      )}

      <canvas
        ref={canvasRef}
        width={680}
        height={356}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          borderRadius: 11,
          border: '1.5px solid var(--border-strong)',
        }}
      />

      <div className="stage-controls-panel">
        <StageSegmented<PerfScenario>
          label="选择待会诊的翻车关卡场景"
          value={scenario}
          options={[
            { value: 'city_draw', label: 'A · 广场多槽 (Draw 瓶颈)' },
            { value: 'forest_overdraw', label: 'B · 迷雾森林 (Overdraw+VSM)' },
            { value: 'museum_shader', label: 'C · 豪车展厅 (BasePass 重材)' },
          ]}
          onChange={(v) => {
            setScenario(v);
            clearFixes();
          }}
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 8,
            marginTop: 10,
          }}
        >
          <StageToggle
            label="① 合并材质槽 + HISM/CPD 实例化"
            checked={fixBatch}
            onChange={setFixBatch}
            hint="专治 CPU Draw 瓶颈"
          />
          <StageToggle
            label="② 距离剔除 + 远景 HLOD"
            checked={fixCulling}
            onChange={setFixCulling}
            hint="双降 Draw 与场景总量"
          />
          <StageToggle
            label="③ 补齐 LOD + WPO Disable Distance"
            checked={fixLodWpo}
            onChange={setFixLodWpo}
            hint="专治 Quad 与 VSM 阴影"
          />
          <StageToggle
            label="④ 植被改 Masked 收紧叶卡"
            checked={fixOverdraw}
            onChange={setFixOverdraw}
            hint="专治 Translucency 爆红"
          />
          <StageToggle
            label="⑤ Substrate 单层快道 + QualitySwitch"
            checked={fixShaderSlim}
            onChange={setFixShaderSlim}
            hint="专治 BasePass 重材质"
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// UE 5.8 SCHEMATICS FOR 9.5 ~ 9.8
// ============================================================================

const schematic9_5: SchematicDiagram = {
  title: 'UE 5.8 单帧三线程接力与 Draw Call 派工单流水线',
  caption:
    'Game 线程算完物体位置后交给 Render(Draw) 线程执行剔除、按材质/PSO 排序并打包成 Mesh Draw Command，经 RHI 翻译给 GPU 依次跑 Depth、Base 与 Shadow 通道。',
  nodes: [
    {
      id: 'n_game',
      title: 'Game Thread (CPU)',
      subtitle: '逻辑 / 物理 / 移动 / 蓝图',
      category: 'pipeline',
      x: 16,
      y: 78,
      width: 176,
      outputs: [{ id: 'scene', label: '更新场景变换', color: '#3b82f6' }],
      note: '独立 Actor 越多，Tick 与管理越重',
    },
    {
      id: 'n_cull',
      title: 'Render Thread · 剔除与合批',
      subtitle: 'Frustum / HZB / 距离剔除',
      category: 'pipeline',
      x: 228,
      y: 44,
      width: 204,
      inputs: [{ id: 'in_s', label: '场景图元列表', color: '#3b82f6' }],
      outputs: [
        { id: 'mdc', label: 'Mesh Draw Commands', color: '#f59e0b' },
        { id: 'pso', label: 'PSO / 材质槽状态', color: '#ec4899' },
      ],
      note: '单模型 N 个材质槽 = 至少拆 N 次提交',
    },
    {
      id: 'n_rhi',
      title: 'RHI Thread',
      subtitle: '翻译 DX12 / Vulkan 指令',
      category: 'math',
      x: 468,
      y: 66,
      width: 176,
      inputs: [
        { id: 'i1', label: '绘制命令', color: '#f59e0b' },
        { id: 'i2', label: '绑定状态', color: '#ec4899' },
      ],
      outputs: [{ id: 'cmd', label: 'GPU Command List', color: '#22c55e' }],
    },
    {
      id: 'n_gpu',
      title: 'GPU 渲染各通道',
      subtitle: 'Depth → Base → Shadow(VSM)',
      category: 'output',
      x: 680,
      y: 44,
      width: 196,
      inputs: [{ id: 'in_g', label: '多 Pass 并行光栅化', color: '#22c55e' }],
      note: '1 个投影物体往往在多 Pass 被画 2~3 次',
    },
  ],
  edges: [
    { fromNode: 'n_game', fromPin: 'scene', toNode: 'n_cull', toPin: 'in_s', color: '#3b82f6' },
    { fromNode: 'n_cull', fromPin: 'mdc', toNode: 'n_rhi', toPin: 'i1', color: '#f59e0b' },
    { fromNode: 'n_cull', fromPin: 'pso', toNode: 'n_rhi', toPin: 'i2', color: '#ec4899' },
    { fromNode: 'n_rhi', fromPin: 'cmd', toNode: 'n_gpu', toPin: 'in_g', color: '#22c55e' },
  ],
};

const schematic9_6: SchematicDiagram = {
  title: 'UE 5.8 GPU 实例化“千人千面”零破批材质接线图',
  caption:
    '所有实例共用 1 份材质与 1 次 DrawIndexedInstanced 提交：用 PerInstanceRandom 拉开自然色差，用 PerInstanceCustomData / Custom Primitive Data 精准控制单个实例受击高亮，彻底告别批量 MID 破批！',
  nodes: [
    {
      id: 'n_rand',
      title: 'PerInstanceRandom',
      subtitle: '硬件/引擎白送每实例 0~1',
      category: 'input',
      x: 16,
      y: 22,
      width: 190,
      outputs: [{ id: 'r', label: '0~1 随机数', color: '#22c55e' }],
    },
    {
      id: 'n_cd',
      title: 'PerInstanceCustomData',
      subtitle: 'Data Index = 0 (或 CPD)',
      category: 'param',
      x: 16,
      y: 134,
      width: 190,
      outputs: [{ id: 'v', label: '受击高亮 0/1', color: '#f97316' }],
      note: '普通单组件可用 Parameter 勾选 Use Custom Primitive Data',
    },
    {
      id: 'n_pos',
      title: 'ObjectPositionWS',
      subtitle: '错开每棵树风摆相位',
      category: 'input',
      x: 16,
      y: 256,
      width: 190,
      outputs: [{ id: 'p', label: '世界坐标 XYZ', color: '#38bdf8' }],
    },
    {
      id: 'n_lerp',
      title: 'Lerp (秋叶色差混合)',
      subtitle: '绿叶 A ↔ 金秋叶 B',
      category: 'math',
      x: 252,
      y: 24,
      width: 176,
      inputs: [{ id: 'a', label: 'Alpha (随机值)', color: '#22c55e' }],
      outputs: [{ id: 'c', label: '自然色差 RGB', color: '#eab308' }],
    },
    {
      id: 'n_emit',
      title: 'Multiply (受击发光)',
      subtitle: 'CustomData[0] × 橙红 HDR',
      category: 'math',
      x: 252,
      y: 142,
      width: 176,
      inputs: [{ id: 'm', label: '高亮开关', color: '#f97316' }],
      outputs: [{ id: 'e', label: 'Emissive', color: '#f97316' }],
    },
    {
      id: 'n_wind',
      title: 'Sine(Time + Pos) × 风幅',
      subtitle: '自然错落风场偏移',
      category: 'math',
      x: 252,
      y: 254,
      width: 176,
      inputs: [{ id: 'wp', label: '相位偏移', color: '#38bdf8' }],
      outputs: [{ id: 'wpo', label: 'WPO 向量', color: '#38bdf8' }],
    },
    {
      id: 'n_slab',
      title: 'Substrate Slab BSDF',
      subtitle: '全林地共用同 1 份材质',
      category: 'substrate',
      x: 472,
      y: 64,
      width: 186,
      inputs: [
        { id: 'alb', label: 'Diffuse Albedo', color: '#eab308' },
        { id: 'em', label: 'Emissive', color: '#f97316' },
      ],
      outputs: [{ id: 'bsdf', label: 'BSDF', color: '#a855f7' }],
    },
    {
      id: 'n_root',
      title: '材质根节点 (1 Draw Call)',
      subtitle: '供 ISM / HISM / Nanite 共享',
      category: 'output',
      x: 696,
      y: 86,
      width: 182,
      inputs: [
        { id: 'front', label: 'Front Material', color: '#a855f7' },
        { id: 'wpo', label: 'World Position Offset', color: '#38bdf8' },
      ],
    },
  ],
  edges: [
    { fromNode: 'n_rand', fromPin: 'r', toNode: 'n_lerp', toPin: 'a', color: '#22c55e' },
    { fromNode: 'n_cd', fromPin: 'v', toNode: 'n_emit', toPin: 'm', color: '#f97316' },
    { fromNode: 'n_pos', fromPin: 'p', toNode: 'n_wind', toPin: 'wp', color: '#38bdf8' },
    { fromNode: 'n_lerp', fromPin: 'c', toNode: 'n_slab', toPin: 'alb', color: '#eab308' },
    { fromNode: 'n_emit', fromPin: 'e', toNode: 'n_slab', toPin: 'em', color: '#f97316' },
    { fromNode: 'n_slab', fromPin: 'bsdf', toNode: 'n_root', toPin: 'front', color: '#a855f7' },
    { fromNode: 'n_wind', fromPin: 'wpo', toNode: 'n_root', toPin: 'wpo', color: '#38bdf8' },
  ],
};

const schematic9_7: SchematicDiagram = {
  title: 'UE 5.8 几何 LOD、材质级减负与远景 HLOD 联动架构',
  caption:
    '依据包围球在屏幕上的占比（Screen Size）逐级降面，并在 LOD2/3 同步合并材质槽、关闭清漆/法线/WPO；超远整片街区再由 HLOD 合并成 1 个代理网格。',
  nodes: [
    {
      id: 'l_screen',
      title: 'Screen Size 屏幕占比计算',
      subtitle: '受视距与镜头 FOV 共同驱动',
      category: 'input',
      x: 16,
      y: 112,
      width: 190,
      outputs: [
        { id: 'near', label: '> 0.52 (近景)', color: '#e5e7eb' },
        { id: 'mid', label: '0.14~0.52 (中景)', color: '#f59e0b' },
        { id: 'far', label: '< 0.14 (远景)', color: '#38bdf8' },
      ],
    },
    {
      id: 'l_lod0',
      title: 'LOD 0 · 精模全配',
      subtitle: '12,800 面 · 4 槽 · 含清漆/WPO',
      category: 'substrate',
      x: 256,
      y: 16,
      width: 212,
      inputs: [{ id: 'in0', label: '近景触发', color: '#e5e7eb' }],
      outputs: [{ id: 'out0', label: '高画质渲染', color: '#a855f7' }],
    },
    {
      id: 'l_lod1',
      title: 'LOD 1 / LOD 2 · 减面合槽',
      subtitle: '减面 + 合为 1 槽轻量化 MI_Low',
      category: 'pipeline',
      x: 256,
      y: 122,
      width: 212,
      inputs: [{ id: 'in1', label: '中景触发', color: '#f59e0b' }],
      outputs: [{ id: 'out1', label: '省面 + 省 Draw + 省像素', color: '#22c55e' }],
      note: '按需勾选 Dithered LOD Transition 防跳变',
    },
    {
      id: 'l_hlod',
      title: 'LOD 3 / 远景 HLOD 代理',
      subtitle: '整区建筑合并为 1 网格 + 1 烘焙图',
      category: 'texture',
      x: 256,
      y: 244,
      width: 212,
      inputs: [{ id: 'in2', label: '远景触发', color: '#38bdf8' }],
      outputs: [{ id: 'out2', label: '1 次 Draw Call', color: '#38bdf8' }],
    },
    {
      id: 'l_out',
      title: '健康 2×2 Quad 与稳定帧率',
      subtitle: '消灭微三角形废算与远景 WPO',
      category: 'output',
      x: 520,
      y: 112,
      width: 204,
      inputs: [
        { id: 'a', label: '近景精绘', color: '#a855f7' },
        { id: 'b', label: '中景减负', color: '#22c55e' },
        { id: 'c', label: '远景合批', color: '#38bdf8' },
      ],
      note: 'Nanite 网格在 GPU 端自动完成连续 Cluster 切级',
    },
  ],
  edges: [
    { fromNode: 'l_screen', fromPin: 'near', toNode: 'l_lod0', toPin: 'in0', color: '#e5e7eb' },
    { fromNode: 'l_screen', fromPin: 'mid', toNode: 'l_lod1', toPin: 'in1', color: '#f59e0b' },
    { fromNode: 'l_screen', fromPin: 'far', toNode: 'l_hlod', toPin: 'in2', color: '#38bdf8' },
    { fromNode: 'l_lod0', fromPin: 'out0', toNode: 'l_out', toPin: 'a', color: '#a855f7' },
    { fromNode: 'l_lod1', fromPin: 'out1', toNode: 'l_out', toPin: 'b', color: '#22c55e' },
    { fromNode: 'l_hlod', fromPin: 'out2', toNode: 'l_out', toPin: 'c', color: '#38bdf8' },
  ],
};

const schematic9_8: SchematicDiagram = {
  title: 'UE 5.8 性能友好型生产母材质架构（分级 + 下移 + 零破批）',
  caption:
    '用 QualitySwitch 按画质档位自动裁剪高耗分支，用 VertexInterpolator 将平缓运算下移至顶点阶段，用 Custom Primitive Data 承接运行时变参，最后统一汇入单层 Substrate Slab 稳走快道！',
  nodes: [
    {
      id: 'p_orm',
      title: 'ORM 打包图 + Shared: Wrap',
      subtitle: '1 次采样读 3 通道 · 省槽省带宽',
      category: 'texture',
      x: 16,
      y: 22,
      width: 206,
      outputs: [
        { id: 'g', label: 'G · Roughness', color: '#22c55e' },
        { id: 'b', label: 'B · Metallic', color: '#3b82f6' },
      ],
    },
    {
      id: 'p_cpd',
      title: 'Tint (Custom Primitive Data)',
      subtitle: 'Primitive Data Index = 0',
      category: 'param',
      x: 16,
      y: 136,
      width: 206,
      outputs: [{ id: 'c', label: '零 MID 破批换色', color: '#f59e0b' }],
    },
    {
      id: 'p_vi',
      title: 'VertexInterpolator',
      subtitle: '平缓 UV/渐变算力下移顶点',
      category: 'math',
      x: 16,
      y: 244,
      width: 206,
      outputs: [{ id: 'uv', label: '低耗插值数据', color: '#38bdf8' }],
    },
    {
      id: 'p_qs',
      title: 'QualitySwitch (画质分级)',
      subtitle: 'High 接细节法线 / Low 跳过',
      category: 'math',
      x: 268,
      y: 132,
      width: 196,
      inputs: [
        { id: 'hi', label: 'High / Epic', color: '#f59e0b' },
        { id: 'lo', label: 'Low (精简)', color: '#38bdf8' },
      ],
      outputs: [{ id: 'res', label: '分档输出', color: '#eab308' }],
    },
    {
      id: 'p_slab',
      title: '单层 Substrate Slab BSDF',
      subtitle: '稳走 Single-Slab Fast Path',
      category: 'substrate',
      x: 504,
      y: 54,
      width: 190,
      inputs: [
        { id: 'alb', label: 'Diffuse Albedo', color: '#eab308' },
        { id: 'rough', label: 'Roughness', color: '#22c55e' },
      ],
      outputs: [{ id: 'bsdf', label: 'BSDF', color: '#a855f7' }],
    },
    {
      id: 'p_root',
      title: '生产级母材质 (已体检)',
      subtitle: 'stat unit + ProfileGPU 验收',
      category: 'output',
      x: 730,
      y: 68,
      width: 180,
      inputs: [{ id: 'front', label: 'Front Material', color: '#a855f7' }],
    },
  ],
  edges: [
    { fromNode: 'p_cpd', fromPin: 'c', toNode: 'p_qs', toPin: 'hi', color: '#f59e0b' },
    { fromNode: 'p_vi', fromPin: 'uv', toNode: 'p_qs', toPin: 'lo', color: '#38bdf8' },
    { fromNode: 'p_qs', fromPin: 'res', toNode: 'p_slab', toPin: 'alb', color: '#eab308' },
    { fromNode: 'p_orm', fromPin: 'g', toNode: 'p_slab', toPin: 'rough', color: '#22c55e' },
    { fromNode: 'p_slab', fromPin: 'bsdf', toNode: 'p_root', toPin: 'front', color: '#a855f7' },
  ],
};

// ============================================================================
// EXPORTED LESSONS 9.5 ~ 9.8
// ============================================================================

export const module09PerfLessons: LessonDefinition[] = [
  // ==========================================================================
  // LESSON 9.5
  // ==========================================================================
  {
    id: 'frame-pipeline-draw-call',
    moduleId: '09',
    number: '9.5',
    title: '渲染三线程、帧预算与 Draw Call —— 为什么 1000 颗小石头比 1 座百万面大山还卡？',
    subtitle: '打通 CPU 到 GPU 的派工单全链路，彻底搞懂 16.67 ms 帧预算、材质槽倍增陷阱与多 Pass 开销',
    duration: '16 分钟',
    difficulty: '进阶',
    steps: [
      {
        stepNumber: 1,
        shortLabel: '小石头卡死谜题',
        tag: 'phenomenon',
        title: '同样是 50 万个三角形，为什么 1 座完整大山丝滑 60 帧，500 个零散多槽摆件却卡成 PPT？',
        paragraphs: [
          '这是无数 UE 新手做完场景后最困惑的一幕：放进一座足足 **50 万个三角形**的巨型山峰，显卡轻轻松松跑到 60 帧以上；可当你往广场上零零散散摆了 **480 个**只有几百面的小花盆、路灯和餐椅（总面数还不到 20 万），帧率反而暴跌到 30 帧，任务管理器里的 **GPU 占用率竟然还不到 50%**！',
          '显卡明明闲得发慌，电脑到底卡在哪里了？答案藏在我们在第 1.2 课留下的伏笔里——**CPU 老教授给 GPU 小学生递派工单（`Draw Call`）的沟通成本**，把整条流水线彻底堵死了！',
        ],
        tryItPrompt:
          '观察上方时间轴：当前 480 个摆件每个带 4 个材质槽，看看黄红色的「Draw (渲染+RHI)」长条是不是远远冲出了 16.67 ms 红线，而下方绿色的 GPU 条后面拉出了一大段「💤 GPU 闲等派工单」气泡？',
      },
      {
        stepNumber: 2,
        shortLabel: '三线程与帧预算',
        tag: 'background',
        title: '前置内功：60 FPS = 16.67 ms 帧预算，与 Game / Draw / GPU 三线程接力流水线',
        paragraphs: [
          '在谈任何性能优化前，先立一条铁律：**永远用“毫秒 `ms`（帧时间）”而不是只用 `FPS` 衡量开销**！因为帧时间 = `1000 ÷ FPS`：流畅 **60 FPS** 意味着每一帧总预算只有 **`16.67 ms`**（30 FPS 是 `33.33 ms`，120 FPS 仅 `8.33 ms`）。从 100 FPS 掉到 50 FPS 足足多花了 `10 ms`，而从 300 FPS 掉到 200 FPS 只多花了 `1.67 ms`——看毫秒才不会被倒数错觉骗到。',
          '其次，UE 渲染一帧画面靠的是**三条核心流水线并行接力**（通常差 1~2 帧重叠运转，而非干等串行相加）：① **`Game Thread`（游戏逻辑线程）**：CPU 算玩家移动、物理碰撞、蓝图逻辑；② **`Draw / Render Thread`（渲染线程 + `RHI` 图形接口翻译线程）**：CPU 检查哪些物体在镜头内（剔除），把可见物体按材质状态排好队，向显卡逐一提交绘制指令；③ **`GPU`（显卡本体）**：拿到指令后并行执行顶点、光栅化、像素着色、光照和后处理。',
        ],
        tryItPrompt:
          '试着拖动「场景同类摆件数量」滑块，紧盯三条时间柱如何各自伸缩，留意总帧时（Frame）永远等于三条柱子中**最长的那一根**（木桶短板）！',
        callout: {
          tone: 'formula',
          title: '性能优化的第一公式',
          body: '`Frame Time ≈ max(Game, Draw, GPU)`；要稳住 60 FPS，三条线必须**全员 ≤ 16.67 ms**！只要 `Draw` 线程高达 `22 ms`，哪怕 GPU 闲得只花 `9 ms`，最终画面也只能跑 45 FPS！',
        },
      },
      {
        stepNumber: 3,
        shortLabel: 'Draw Call 与材质槽',
        tag: 'experiment',
        title: '亲手拆解 Draw Call：每多开 1 个材质槽、多算 1 个阴影通道，派工单就成倍暴涨！',
        paragraphs: [
          '到底什么是 **`Draw Call`（绘制调用）**？它就是 CPU 渲染线程给 GPU 下达的一张**“施工派工单”**：上面写着“切换用哪套几何网格缓冲 + 换哪套材质着色器状态（底层叫 **`PSO`，Pipeline State Object**）+ 绑定哪几张贴图，然后开画！”。显卡真正画几万个三角形只是一眨眼，但 CPU 反复填写上千张派工单、让显卡频繁换画笔颜料（状态切换），开销极其惊人！',
          '对材质美术而言，最容易无意引爆 Draw Call 的两大隐形乘法器是：① **材质槽数（`Material Slots / Elements`）**：在非 Nanite 传统管线下，一个椅子拆了木头、坐垫、螺丝、标签 **4 个材质槽**，哪怕只是 1 个模型，同一通道也得拆成 **4 次 Draw Call**！摆 500 把椅子瞬间就是 2,000 次！② **多通道（Multi-Pass）放大**：一个投射阴影的物体一帧里绝不只画 1 次——**深度预通（`Depth Prepass`）+ 写入底片室（`Base Pass`）+ 阴影通道（`Shadow / VSM Pass`）**，1 个物体瞬间贡献 2~3 次甚至更多 Draw Call！',
        ],
        tryItPrompt:
          '把「单模型材质槽数」从 `5 槽` 一路拉回 `1 槽`，再依次勾选/取消「投射实时阴影」与「视锥剔除」，亲眼看着左下角三通道派工单队列和总 Draw Calls 断崖式暴跌！',
      },
      {
        stepNumber: 4,
        shortLabel: 'UE 5.8 减单三板斧',
        tag: 'ue5',
        title: '走进 UE 5.8：材质槽合槽、剔除系统（Culling）与查看真实 Draw Call',
        paragraphs: [
          '想把臃肿的 Draw Call 压下来，在进入下一课“GPU 实例化”之前，先掌握三板基本功：① **建模与材质侧控槽位**：尽量把小摆件的多个局部质感通过 **UV 合并、纹理图集（Texture Atlas）或饰条贴图（Trim Sheet）**收束到 **1~2 个材质槽**内，用 ORM 贴图区分金属与木头，绝不要为了换块颜色就单独多开一个材质槽！② **善用引擎剔除（`Culling`）**：UE 会自动做**视锥剔除（Frustum Culling，镜头外不画）**与 **HZB 硬件遮挡剔除（被大墙挡住不画）**，再配合在关卡里放置 **`Cull Distance Volume`**（距离剔除体积）或给小碎件设置 `Max Draw Distance`，远处的茶杯石子直接免发派工单！',
          '③ **用控制台实测**：在 UE 5.8 视口按波浪键 `` ` `` 输入 **`stat scenerendering`**，第一眼盯住 **`Mesh draw calls`** 这一行，它就是当前镜头真实的网格绘制提交总数！（再输入 **`stat unit`** 就能同时看到 `Game / Draw / GPU` 三线毫秒数。）',
        ],
        tryItPrompt:
          '将「提交与材质槽策略」切到「合槽 + 合批提交 ✅」并打开「视锥剔除」，同时点击右上角切换到「UE5.8 节点/原理图」，顺着 `Game → Render(剔除/状态) → RHI → GPU` 记住整条提交链路！',
        callout: {
          tone: 'ue58',
          title: '桌面端 Draw Call 参考心率线（非死标准，以目标平台实测为准）',
          body: '在传统非 Nanite 渲染中，桌面 60 FPS 项目常把全屏可见 `Mesh draw calls` 控制在 **2,000~3,500 次以内**（移动端甚至要死守 **100~300 次**）。在 UE 5.8 中开启 **Nanite** 后几何绘制大幅合批，但非 Nanite 物体（半透明、特效、传统植被等）依然严格遵守上述 Draw Call 规律！',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '防坑黄金口诀',
        tag: 'pitfall',
        title: '实战避坑口诀：看毫秒不盲看 FPS，小件严控材质槽，零散多物必合批！',
        paragraphs: [
          '很多外包或商城模型拿到手看起来面数不高，拖进关卡几百个却让帧率雪崩，双击打开静态网格资产一看——好家伙，一把路边长椅居然拆了 **7 个材质槽**！花十分钟把多张贴图合并或用一张遮罩统一成 **1 个母材质槽**，Draw Call 直接立省 85%！',
          '同时记得给满地的小石块、枯枝、花瓣取消勾选组件 Details 里的 **`Cast Shadow`**（省掉整整一轮 Shadow Pass 提交），并设好合理的 `Max Draw Distance`。那如果广场上确实需要摆放上千棵一模一样的树或几千块铺路石，既不想拼死合成一个不可编辑的大网格、又要只用 **1 次 Draw Call**，该怎么办？下一课（9.6）请出终极神器——**GPU 实例化**！',
        ],
        tryItPrompt:
          '点击顶部「看踩坑现象 / 切正确配置」一键对比 500 个 5 槽散件爆红 vs 1 槽合批+剔除稳跑 60 帧的巨大反差！',
      },
    ],
    takeaways: [
      '性能调优以毫秒 `ms` 为准（60 FPS = `16.67 ms`）；单帧耗时遵循木桶短板公式 `Frame ≈ max(Game, Draw, GPU)`',
      '`Draw Call` 是 CPU 渲染线程向 GPU 下发的一次带状态切换（PSO/网格/贴图绑定）的绘制派工单；过多小单会让 Draw 线程爆红、GPU 干等',
      '非 Nanite 网格每多 1 个材质槽（Material Slot）就成倍增加 Draw Call，且同一物体常在 Depth / Base / Shadow 多个 Pass 被重复提交',
      '用 `stat unit` 查三线毫秒、用 `stat scenerendering` 查 `Mesh draw calls`；养成合并材质槽、小物件关阴影与设置剔除距离的工程习惯',
    ],
    schematic: schematic9_5,
    StageComponent: Stage9_5_DrawCallPipeline,
  },

  // ==========================================================================
  // LESSON 9.6
  // ==========================================================================
  {
    id: 'gpu-instancing-custom-data',
    moduleId: '09',
    number: '9.6',
    title: 'GPU 实例化与“千人千面”材质术 —— ISM / HISM、Nanite 与不打断合批的秘密',
    subtitle: '把 500 张派工单缩成 1 张团购大单，并用 PerInstanceRandom 与 CustomData 告别克隆人且绝不破批',
    duration: '17 分钟',
    difficulty: '进阶',
    steps: [
      {
        stepNumber: 1,
        shortLabel: '克隆人与破批坑',
        tag: 'phenomenon',
        title: '树林有 500 棵同款松树：全挂同一个材质像“克隆人”，逐棵建 MID 改色又把帧率干崩了？',
        paragraphs: [
          '上一课咱们刚搞明白：500 棵松树如果各自发派工单会累趴 CPU 渲染线程。但有经验的同学很快会撞上第二堵墙：把 500 棵树合并成 **1 次绘制**后，它们全共用同一个材质球，放眼望去每一棵树绿得一模一样、连随风摇摆都像做广播体操一样整齐划一，假得像复制粘贴！',
          '于是新手灵机一动：“我在蓝图 `Construction Script` 里循环 500 次，给每棵树调用 `Create Dynamic Material Instance (MID)` 随机换个秋叶颜色不就行了？”——结果刚点运行，帧率当场腰斩！为什么为了改个颜色建 500 个 `MID` 会让合批彻底失效？有没有既保持 **1 次 Draw Call**、又能让每棵树颜色风姿各异的魔法？',
        ],
        tryItPrompt:
          '观察左侧林地默认处于「独立 Actor + MID」破批状态（每棵树都顶着红色 `DC#` 标签，总共 320 次 Draw Call）；再切到「ISM 同色」，看看派工单瞬间降为 1 次，但树林是不是变成了单调克隆人？',
      },
      {
        stepNumber: 2,
        shortLabel: '一张团购大单',
        tag: 'background',
        title: 'GPU 实例化底层原理：把 500 张单人派工单，换成 1 张“团购大单” + 显存坐标清单！',
        paragraphs: [
          '**GPU 实例化（`GPU Instancing`）**的思路朴素却极其天才：既然这 500 棵树用的是**同一份网格骨架（Mesh）**和**同一份材质食谱（Material）**，干嘛让 CPU 啰嗦 500 遍？CPU 只需把 500 棵树各自的位置、旋转、缩放矩阵提前打包成一张显存表格——**`Instance Buffer`（实例缓冲区）**，然后只发 **1 次**特殊团购指令（底层叫 **`DrawIndexedInstanced`**）：“请用这份树网格和树叶材质，照着显存表一次性画 500 份！”',
          'GPU 顶点着色器拿到这张大单后，每个线程会自动领到一个专属编号 **`InstanceID`（`0 ~ 499`）**，各去显存表里查出自己那棵树的坐标与朝向，一瞬间齐步并发画完——**500 次 Draw Call 直接坍缩成 1 次！**',
        ],
        tryItPrompt:
          '盯着画布右侧的「GPU 显存 Instance Buffer」数据表：切到「ISM+随机/CustomData ✅」，感受“1 份共享材质 + 1 张数据表按 ID 并发查表”如何把 Draw Call 压降 99% 以上！',
      },
      {
        stepNumber: 3,
        shortLabel: '千人千面三剑客',
        tag: 'experiment',
        title: '亲手变魔法：用 PerInstanceRandom、CustomData 与 CPD 在 1 个 Draw Call 里造出千人千面！',
        paragraphs: [
          '既然 500 个实例共用 1 份材质，绝不能为改色去创建 500 个独立 `MID`（那等于把 1 份材质拆成 500 份不同的渲染状态，合批瞬间报废！）。UE 5.8 在材质里专门提供了**不破合批的“千人千面三剑客”**：',
          '① **`PerInstanceRandom` 节点**：硬件/引擎白送给每个实例一个 `0~1` 专属随机数，直接连进 `Lerp` 或色带贴图，500 棵树立刻绿黄橙错落有致，**0 额外 Draw Call**！② **`PerInstanceCustomData`（ISM/HISM 专用）**：允许蓝图/C++ 在 `Instance Buffer` 里给每个实例塞入若干自定义浮点（`Num Custom Data Floats`，如 `Index 0` 存受击高亮、`Index 1` 存破损度），材质按索引读取即可精准单棵变色！③ **`Custom Primitive Data (CPD)`（普通单组件通用）**：勾选材质参数的 `Use Custom Primitive Data` 后，即便不是 ISM 的普通静态网格也能零 `MID` 改参、继续享受引擎自动合批！最后别忘了衔接第 9.2 课：给风场加上 **`ObjectPositionWS`（物体世界坐标）** 错开相位，树林立刻告别机械齐晃！',
        ],
        tryItPrompt:
          '保持在「ISM+随机/CustomData ✅」，**用鼠标点击画布上任意几棵树的树冠**，观察被点中的树瞬间亮起橙色受击光环、右侧显存表对应的 `Custom[0]` 变成 `1.00 🔥`，而底部合计派工单纹丝不动保持 **`1 次`**！再试着开关「错开风摆相位」对比广播体操 vs 自然林浪！',
      },
      {
        stepNumber: 4,
        shortLabel: 'UE 5.8 全家桶选型',
        tag: 'ue5',
        title: '走进 UE 5.8：Auto-Instancing、ISM、HISM 与 Nanite 到底怎么选？（含“有 Nanite 还用学吗？”）',
        paragraphs: [
          '在 UE 5.8 里实现实例化有四员大将，千万分清边界：① **`Auto-Instancing`（自动合批）**：UE5 默认会对场景里同 Mesh、同 Material 的普通 `StaticMeshActor` 自动合并 Mesh Draw Command；但如果你放了 3 万个独立 Actor，光 CPU 管理与遍历这 3 万个组件就会把 `Game / Render` 线程拖垮！② **`ISM`（Instanced Static Mesh）**：1 个组件打包管理成千上万实例，CPU 极轻，但全组共用 1 个整体包围盒，**传统非 Nanite 下不支持逐实例独立切 LOD 和细粒度视锥裁剪**（适合集中且同屏显示的小物件集群）。③ **`HISM`（Hierarchical ISM）**：在内部建了一棵层次包围体树，支持**逐簇裁剪 + 平滑逐簇切 LOD**（下一课 9.7 详讲！），是传统植被（Foliage）与大范围散布的主力！',
          '④ **重点解惑：UE 5.8 都有 `Nanite` 了，还要学 Draw Call 和 GPU 实例化吗？** 答案是**必须学！** Nanite 把几何绘制革新为 GPU 端按 128 三角形 Cluster 自动剔除、按材质分类（**`Shading Bins`**）着色的虚拟几何管线，极大消灭了传统几何 Draw Call 瓶颈；**但三大现实铁律依然生效**：a) 材质种类越多（过多不同母材质或 `Static Switch` 变体），Nanite 的 **Shading Bins** 全屏分类与着色开销依然上涨；b) **非 Nanite 资产**（所有 `Translucent` 半透明、特效面片、传统非 Nanite 植被、移动端项目）完全走传统 Draw Call 管线；c) 即便开了 Nanite，用 **`ISM / HISM / PCG`** 组织海量重复物件依然能大幅削减 CPU 场景管理与显存开销！',
        ],
        tryItPrompt:
          '将模式切到「Nanite+HISM 🚀」，再切换右上角「UE5.8 节点/原理图」，牢记 `PerInstanceRandom` + `PerInstanceCustomData` + `ObjectPositionWS` 汇入单一共享材质的标准连法！',
        callout: {
          tone: 'ue58',
          title: 'UE 5.8 实操速记：把旧 MID 改造成 Custom Primitive Data (CPD) 只需两步',
          body: '① 在材质中选中任意 `ScalarParameter` 或 `VectorParameter`，在 Details 勾选 **`✓ Use Custom Primitive Data`** 并设好 `Primitive Data Index`（如 `0`）；② 在蓝图里不再调用 `Create Dynamic Material Instance`，直接对网格组件调用 **`Set Custom Primitive Data Float / Vector4`**——画质一模一样，彻底保住合批！',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '防坑黄金口诀',
        tag: 'pitfall',
        title: '实战避坑口诀：海量重复上 HISM，差异改色用随机与 CPD，严禁循环批量建 MID！',
        paragraphs: [
          '回顾第 9.3 课讲的材质实例三兄弟（`MI` / `MID` / `MPC`），今天终于补齐了最后一块工程拼图：给**主角或少数几个 Boss** 做受击闪红、技能变身，用 `MID` 方便又直观；但一旦对象是**成百上千个同类小兵、箱子、路灯、草木**，千万别写 `ForEachLoop → Create Dynamic Material Instance`，一律改用 **`PerInstanceRandom` / `PerInstanceCustomData` / `Custom Primitive Data (CPD)`**！',
          '另一个隐蔽坑点：**`ISM` 与远景 LOD 的冲突**——在非 Nanite 管线下，如果把整张大地图上相距 500 米的几千棵树全塞进同一个普通 `ISM`，只要镜头近处有 1 棵树，整组可能被迫一起卡在最高面数 `LOD0` 上！想要远近各切各的细节层级，请换用 **`HISM`**（或直接启用 **Nanite**）——而关于 **LOD 究竟是怎么省面、省算力、又怎么治理 `2×2 Quad` 微三角形灾难的**，下一课（9.7）立刻为你全景揭晓！',
        ],
        tryItPrompt:
          '点击顶部「看踩坑现象 / 切正确配置」一键对比 360 棵树批量 MID 破批 vs 1 次 Draw Call 千人千面，把这套零破批架构刻进肌肉记忆！',
      },
    ],
    takeaways: [
      'GPU 实例化将 $N$ 次独立提交合并为 1 次 `DrawIndexedInstanced` 团购大单 + 显存 `Instance Buffer`，GPU 按 `InstanceID` 并发绘制',
      '批量给同类物体创建 `MID` 或不同 `MI` 会打断合批；零破批差异化请用 `PerInstanceRandom`、`PerInstanceCustomData`（ISM/HISM）与 `Custom Primitive Data (CPD)`（单组件）',
      '选型速记：集中小群用 `ISM`，大范围需逐簇剔除与 LOD 用 `HISM`，海量独立 Actor 即便有 `Auto-Instancing` 也仍会压垮 CPU 管理',
      'UE 5.8 `Nanite` 极大压缩了几何 Draw Call，但过多材质变体仍增加 `Shading Bins` 开销，且非 Nanite/半透明与 CPU 场景组织仍高度依赖实例化体系',
    ],
    schematic: schematic9_6,
    StageComponent: Stage9_6_GpuInstancingLab,
  },

  // ==========================================================================
  // LESSON 9.7
  // ==========================================================================
  {
    id: 'lod-quad-overdraw-hlod',
    moduleId: '09',
    number: '9.7',
    title: 'LOD 多细节层次全景 —— 从 2×2 Quad 微三角形陷阱、屏幕占比减面、材质级 LOD 到 HLOD 与 Nanite',
    subtitle: '揭开 Mipmap 的几何孪生兄弟：为什么远处高模不仅费顶点，还会烧白 Quad Overdraw？',
    duration: '17 分钟',
    difficulty: '进阶',
    steps: [
      {
        stepNumber: 1,
        shortLabel: '远景高模烧白之谜',
        tag: 'phenomenon',
        title: '80 米外一座在屏幕上只有指甲盖大小的高模雕像，为什么反而比贴脸看时更费 GPU？',
        paragraphs: [
          '直觉往往会骗人：大家总觉得“物体离镜头远了、占的屏幕像素变少了，显卡肯定更轻松吧？”可现实做项目时经常出现反直觉奇观——当你把镜头拉远、俯瞰满山遍野的高模雕像和密林时，打开 UE 视口的 **`Quad Overdraw`** 诊断视图，那些远得只剩指甲盖大的物体居然**全部烧成了刺眼的纯白色**，GPU 耗时暴涨！',
          '明明总共才盖住了屏幕上百十来个像素，为什么显卡反而算得直冒烟？原因就藏在硬件光栅化的一个核心潜规则里——**`2×2 Quad` 像素块**！',
        ],
        tryItPrompt:
          '盯着当前 72 米外的雕像（关闭 LOD 死扛 12,800 面）以及右侧「2×2 Quad 像素块放大镜」：看看微小的黄色三角形只盖住 1 个绿格，却强迫旁边 3 个红格（「废」）陪跑白算，浪费率高达 75%！',
      },
      {
        stepNumber: 2,
        shortLabel: '2×2 Quad 与 Screen Size',
        tag: 'background',
        title: '前置内功：Mipmap 的几何孪生兄弟（LOD）、2×2 Quad 浪费机制与 Screen Size 屏幕占比',
        paragraphs: [
          '回想第 5.3 课的 **`Mipmap`**：贴图太高清缩到远处会摩尔纹闪烁，所以我们预存了逐级减半的贴图缩略版——**Mipmap 就是“贴图的 LOD”**！而今天的主角 **`LOD`（Level of Detail，多细节层次）**，就是 **3D 模型与材质的套娃缩略版**：近看用精模 `LOD0`，拉远自动依次降级到 `LOD1 → LOD2 → LOD3`！',
          '为什么要死磕远景减面？除了省顶点算力，更致命的是**`2×2 Quad` 辅助像素浪费**：为了算出相邻像素的 UV 变化率（偏导数 `ddx / ddy`）来决定读哪一级 Mipmap，显卡像素着色器从不“单画 1 个像素”，而是强行把屏幕按 **`2×2` 四个像素捆成一组（Quad）**齐步运行！当远处高模的三角形缩到比 1 像素还小时，就算它只盖住 4 格里的 1 格，剩下 3 个**辅助像素（Helper Lanes）**照样完整跑完一整遍复杂材质代码再扔掉结果——**算力当场白烧 75%**！此外记住：**UE 切换 LOD 不是死看“离镜头几米”**，而是看模型包围球投影到屏幕上的**屏幕占比（`Screen Size`，0~1）**——所以同样 50 米外，摩天大楼还在 `LOD0`，小茶杯早已切到 `LOD3`；且你开狙击镜拉近焦距（FOV 变窄）时它会自动切回精模，绝不糊成马赛克！',
        ],
        tryItPrompt:
          '来回拖动「摄像机观察距离」滑块，再把策略从「关闭 LOD」切到「多级几何 LOD」，盯着右侧 `2×2 Quad` 放大镜里刺眼的红色「废」格如何大片退散变成健康绿格！',
        callout: {
          tone: 'tip',
          title: '一句话记住 Mipmap 与 LOD 的双生关系',
          body: '**`Mipmap`** 防的是“1 个像素底下挤太多**纹素**”；**`LOD`** 防的是“1 个 `2×2 Quad` 像素块里塞太多**三角形**”！两者一软一硬，共同守住远景清晰度与 GPU 效率。',
        },
      },
      {
        stepNumber: 3,
        shortLabel: '材质级 LOD 瘦身',
        tag: 'experiment',
        title: '进阶杀手锏：LOD 不只减三角形，更要在远景“合并材质槽 + 换轻材质 + 关 WPO”！',
        paragraphs: [
          '很多同学以为配好自动减面就大功告成了，却忽略了 UE 5.8 里收益最高的一招——**材质级 LOD（Material LOD）**！试想一栋精致木屋在近处 `LOD0` 用了 4 个材质槽（砖墙、瓦片、带双层清漆的漆木窗、飘动风旗 `WPO`）。当它退到 60 米外在屏幕上只有两厘米宽时，肉眼根本看不见窗框清漆高光，也看不清细微风摆！',
          '如果此时我们在静态网格编辑器的 `LOD2 / LOD3` 里，把原本 4 个材质槽**重新映射合并为 1 个轻量化材质槽**（换成不带清漆、不带细节法线、**关闭 `WPO`** 的 `MI_Low`），一箭三雕的奇迹就发生了：**三角形降了 90%（消灭 Quad Overdraw）+ 材质槽 4→1（Draw Call 狂降 75%）+ 关掉远景 WPO（让 VSM 虚拟阴影缓存稳稳复用）**！',
        ],
        tryItPrompt:
          '把策略切到「LOD+合槽简材 ✅」，把距离拉过 `55 m`，观察顶部 KPI 里「实时面数 & 材质槽」如何从 4 槽缩为 1 槽且关闭 WPO；再切换「诊断视口模式」体验 UE 5.8 的 `LOD 染色视图`（白0/红1/绿2/蓝3）！',
      },
      {
        stepNumber: 4,
        shortLabel: '防跳变、HLOD 与 Nanite',
        tag: 'ue5',
        title: '走进 UE 5.8：Dithered LOD 防跳变、远景整区 HLOD，以及 Nanite 连续细节的适用边界',
        paragraphs: [
          '落地 UE 5.8 资产配置，掌握三件趁手工具：① **自动生成与配比**：双击静态网格，在 `LOD Settings` 里选好 `LOD Group`（如 `SmallProp` / `Foliage` / `Architecture`），即可一键按 `Percent Triangles` 与 `Screen Size` 阈值生成多级 LOD，并可在每级单独指定更轻的材质。② **告别切级“啪一下跳变（Popping）”**：在材质 `Details` 勾选 **`✓ Dithered LOD Transition`**，UE 会用像素点阵抖动配合 TSR/TAA 把 `LOD0 → LOD1` 融化成丝滑淡变（**注意代价**：开启后会引入类似 `Masked` 裁剪的额外开销，切忌全游戏所有石头墙面盲目全勾，仅给跳变明显的大树、关键植被开启！）。',
          '③ **宏观远景双翼——`HLOD` 与 `Nanite`**：当远处一整片街区有 50 栋房子时，就算每栋切到 `LOD3` 依然有 50 次 Draw Call；UE 的 **`HLOD`（Hierarchical LOD，层次合并细节）**能把整片远景离线合并成 **1 个低模代理网格 + 1 张烘焙纹理 = 1 次 Draw Call**！而 UE 5.8 招牌 **`Nanite`** 则在 GPU 端以 128 三角形 **Cluster** 为单位实现**像素级无缝连续 LOD**——零 Popping、零微三角形 Quad 灾难！不过仍要牢记边界：**半透明物体、非 Nanite 植被/特效、旧骨骼路径与移动端**依然离不了传统 LOD/HLOD；且即便开了 Nanite，也依然可以用 `CameraDepthFade` 在远景淡出高耗细节法线来给像素着色器减负！',
        ],
        tryItPrompt:
          '勾选「远景整片街区启用 HLOD（55m+ 合为 1 网格）」并把距离拉到 `70 m` 以上，看 25 栋街区如何瞬间合成 1 个代理网格、Draw Call 归 1！再试切「Nanite 连续」对比它的像素级平滑减面！',
        callout: {
          tone: 'ue58',
          title: 'UE 5.8 验收 LOD 的两大官方视图快捷键路径',
          body: '① **看切级距离是否合理**：视口左上角 `Lit → Level of Detail Coloration → Mesh LODs`（经典四色：**白=LOD0、红=LOD1、绿=LOD2、蓝=LOD3**）；② **抓微三角形元凶**：`Lit → Optimization Viewmodes → Quad Overdraw`（发现远景小物体发白发红，十有八九是缺 LOD 或 Screen Size 设得太晚！）。',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '防坑黄金口诀',
        tag: 'pitfall',
        title: '实战避坑口诀：近精远简看屏占比，微三角烧白必配 LOD，远景合槽去 WPO，抖动过渡别滥开！',
        paragraphs: [
          '最后把跨课知识点全部串起来，避开四个新手高频深坑：① **只配减面不删远景槽**：`LOD3` 面数虽少，却依然挂着 4 个材质槽和复杂 WPO，结果 Draw Call 和 VSM 阴影一个没省；② **全项目无脑开 `Dithered LOD Transition`**：把原本走最快的纯 `Opaque` 材质强行拖进了类似 `Masked` 的裁剪路径，反而拉低了帧率；③ **把大范围多 LOD 树林塞进普通 `ISM`**：呼应 9.6 课，非 Nanite 植被必须用 **`HISM`** 才能逐簇按屏幕占比各自切 LOD！④ **忽略 `Quad Overdraw`**：只看 `Alt+8` 着色复杂度发绿以为万事大吉，切到 `Quad Overdraw` 才发现远处满屏细密栏杆和雕塑早已烧成一片白！',
        ],
        tryItPrompt:
          '点击顶部「看踩坑现象 / 切正确配置」一键对比 82 米外死扛 12,800 面烧白 Quad vs 合槽简材 + HLOD 全线转绿的震撼对比！',
      },
    ],
    takeaways: [
      '`LOD` 是第 5.3 课 `Mipmap`（纹理 LOD）的几何孪生兄弟；UE 按物体在屏幕上的占比 **`Screen Size`**（而非死看米数）自动切换 `LOD0~LOD3`',
      'GPU 按 **`2×2 Quad`** 像素块执行像素着色器以计算 Mipmap 偏导；远景未减面的微三角形会导致高达 **75%** 的辅助像素（Helper Lanes）废算，在 `Quad Overdraw` 视图烧成纯白',
      '高阶 **材质级 LOD** 在 `LOD2/3` 同步合并材质槽、换成轻量化材质并关闭 `WPO`，一举省下面数、Draw Call、像素指令与 VSM 阴影缓存',
      '`Dithered LOD Transition` 可消除切级跳变但有裁剪开销（勿滥用）；大世界远景整区合批用 `HLOD`，UE 5.8 `Nanite` 提供 GPU 端连续 Cluster 切级但不能覆盖半透明/非 Nanite 管线',
    ],
    schematic: schematic9_7,
    StageComponent: Stage9_7_LodAndQuadOverdraw,
  },

  // ==========================================================================
  // LESSON 9.8
  // ==========================================================================
  {
    id: 'ue58-perf-tuning-workflow',
    moduleId: '09',
    number: '9.8',
    title: 'UE 5.8 性能调优实战闭环 —— 从 stat unit 找木桶短板到 ProfileGPU 对症开方',
    subtitle: '终结“瞎改一整天帧率一帧不涨”！掌握三级体检工具箱与 CPU / GPU 全链路对症优化 SOP',
    duration: '18 分钟',
    difficulty: '实战',
    steps: [
      {
        stepNumber: 1,
        shortLabel: '白忙活的教训',
        tag: 'phenomenon',
        title: '熬夜把场景所有材质砍掉一半节点，为什么帧率还是死死卡在 44 FPS 一帧没涨？',
        paragraphs: [
          '这是游戏开发团队里几乎每周都在上演的悲剧：策划反馈广场卡顿只有 44 帧，地编和材质美术立刻通宵加班——删法线、砍粗糙度贴图、把材质指令从 220 条硬生生压到 110 条，满心期待进关卡验收，结果左上角 FPS 依然纹丝不动停在 **44 FPS**！',
          '为什么辛辛苦苦省了这么多 GPU 算力，玩家却完全感受不到提速？因为优化界有一条价值千金的铁律：**“没有定位瓶颈的优化，等于闭着眼睛给发烧病人打石膏！”** 看看此时模拟器的左侧面板，真相立刻大白！',
        ],
        tryItPrompt:
          '当前「场景 A · 广场多槽」已特意勾选了「⑤ Substrate 单层快道 + QualitySwitch」：仔细看左侧 `stat unit`，GPU 确实降到了 11.2 ms，但为什么最顶上的 `Frame` 依然死死卡在 `22.8 ms (44 FPS)`？',
      },
      {
        stepNumber: 2,
        shortLabel: '三级体检工具箱',
        tag: 'background',
        title: 'UE 5.8 性能体检“望闻问切”三级工具箱：10 秒定方向，1 分钟抓真凶！',
        paragraphs: [
          '大厂技术美术（TA）调优从不靠猜，而是严格按**从粗到细三级漏斗**推进：',
          '① **第一级 · 10 秒找木桶短板**：控制台输入 **`stat unit`**（或带折线图的 `stat unitgraph`），对比 `Game / Draw / GPU` 谁最接近或超过 `16.67 ms`，立刻判定是 **CPU 逻辑瓶颈**、**CPU 渲染提交瓶颈**，还是 **GPU 瓶颈**！若是 Draw 偏高，紧接着输入 **`stat scenerendering`** 看 `Mesh draw calls` 与图元数。② **第二级 · 视口热图抓热点资产**：若是 GPU 偏高，依次用视口热图扫一遍——**`Alt + 8`（`Shader Complexity`）**抓重材质与多层半透明 Overdraw、**`Quad Overdraw`** 抓缺 LOD 的微三角形、**`Substrate Material Classification`** 抓多层板慢道、**`Light Complexity`** 抓光源重叠。③ **第三级 · 毫秒级手术刀**：按 **`Ctrl + Shift + ,`** 运行 **`ProfileGPU`**，直接展开当前帧每个渲染通道的精确毫秒数（`BasePass`、`ShadowDepths/VSM`、`Translucency`、`Lumen`、`PostProcessing`）！跨帧掉帧尖刺用 **Unreal Insights**，单帧逐条查 Draw Call 与显存绑定用 **RenderDoc**。',
        ],
        tryItPrompt:
          '先把场景 A 中不对症的「⑤ 材质瘦身」取消掉，改为勾选专治 CPU Draw 短板的「① 合槽+HISM/CPD」与「② 距离剔除+HLOD」，亲眼见证 `Draw` 柱骤降、总 `Frame` 一举闯进 60 FPS 绿区！',
      },
      {
        stepNumber: 3,
        shortLabel: '三大战场会诊',
        tag: 'experiment',
        title: '亲手坐诊三大真实翻车关卡：迷雾森林、繁华广场、豪车展厅逐一药到病除！',
        paragraphs: [
          '光看理论不够过瘾，现在请你亲自接诊模拟器里的**另外两大经典 GPU 翻车现场**：切到 **「B · 迷雾森林」**，先看左侧 `stat unit` 确认短板在 **`GPU (26.4 ms)`**，再看右侧 `ProfileGPU` 瀑布图——一眼就能揪出两根最肥的红柱：**`Translucency (8.8 ms)`**（树叶误用半透明叠层 Overdraw！）和 **`ShadowDepths / VSM (7.9 ms)`**（满山远景草无 LOD 且全开 WPO，导致每帧 VSM 阴影缓存大面积失效重绘！）。',
          '再切到 **「C · 豪车展厅」**，右侧 `ProfileGPU` 里一柱擎天的是 **`BasePass (13.4 ms)`**——展厅用了堆叠多层 Substrate 慢道与未打包的多张高分辨率贴图，这时就该对症请出单层板快道、ORM 通道打包、`VertexInterpolator` 算力下移以及 **`QualitySwitch`** 画质分级！',
        ],
        tryItPrompt:
          '依次切换「B · 迷雾森林」与「C · 豪车展厅」，坚持“先读 `stat unit` → 再找 `ProfileGPU` 最肥柱子 → 最后只勾对症药方”的顺序，把三个翻车关卡全部调进 60 FPS 绿区！',
      },
      {
        stepNumber: 4,
        shortLabel: 'UE 5.8 分级与流送',
        tag: 'ue5',
        title: '走进 UE 5.8：用 QualitySwitch 做画质分级，并守住纹理流送与显存带宽底线',
        paragraphs: [
          '除了前面各课掌握的实例化、LOD、合槽、Masked 替代半透明与 `Shared: Wrap`，生产级 UE 5.8 材质还有两招收官利器：① **`QualitySwitch`（画质质量分级节点）**：同一份母材质要同时跑在 RTX 旗舰显卡（Epic 档）和轻薄本/掌机（Low/Medium 档）上？只需放一颗 `QualitySwitch` 节点——在 `High / Epic` 引脚接上精细的视差、多层法线或复杂噪波，在 `Low` 引脚直接连轻量纯贴图甚至常量，引擎切换画质等级（`Settings → Material Quality Level`）时自动按档位编译精简版着色器，兼顾顶配惊艳与低配流畅！',
          '② **守住纹理带宽与显存池**：如果视口左上角冒出刺眼红字 **`TEXTURE STREAMING POOL OVER ... MiB`**，说明当前镜头塞进了太多 4K/未压缩贴图，不仅显存爆池导致贴图糊成马赛克，还大幅拖慢 GPU 纹理采样带宽！回顾第 4~6 章铁律：3D 贴图一律 2 次幂开 Mipmap 与常规流送、黑白数据打包成 ORM、合理限制非主角物件的 `Maximum Texture Size`（小石子 512/1024 足够，绝不滥用 4K）！',
        ],
        tryItPrompt:
          '切换到右上角「UE5.8 节点/原理图」，总览一套集齐 `ORM + Shared: Wrap`、`Custom Primitive Data`、`VertexInterpolator`、`QualitySwitch` 与单层 `Substrate Slab` 的满分生产母材质蓝图！',
        callout: {
          tone: 'ue58',
          title: '固定对照测试三原则（没有对照就没有真相！）',
          body: '在 UE 5.8 里验收任何性能优化，务必遵守：① **同视角同分辨率**（用书签 `Ctrl+1` 存固定机位，且在 `Standalone` 或打包版本实测，不要只信带编辑器 UI 的 Viewport 读数）；② **关掉垂直同步与帧率上限（`t.MaxFPS 0`）** 避免被锁死在 60 帧看不出真实余量；③ **同时记录 `stat unit`、`Mesh draw calls` 与 `ProfileGPU` 截图**做前后量化留档！',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '终极优化口诀',
        tag: 'pitfall',
        title: '终极避坑口诀：先测再改不盲猜，按短板对症开方，固定机位看毫秒验收！',
        paragraphs: [
          '把整套模块 09 凝聚成一张随身调优决策表：**`Draw` 爆红** → 查 `stat scenerendering` → 减材质槽、上 HISM/Nanite、CPD 替 MID、配剔除与 HLOD；**`GPU BasePass` 爆红** → 查 `Alt+8`、`Quad Overdraw`、`Substrate` 视图 → 补 LOD、走单层快道、ORM 打包、算力下移与 `QualitySwitch`；**`Translucency` 爆红** → 植被改 `Masked`、收紧特效透明边、限制半透明叠层；**`Shadow/VSM` 爆红** → 设 `WPO Disable Distance`、小物件关 `Cast Shadow`、限制远处动态光阴影！',
          '🎉 **恭喜你彻底打通《渲染管线、实例化、LOD 与性能调优》全部 8 节硬核工程内功！** 从下一章（模块 10）开始，我们将把光影、贴图、PBR 层板与性能思维全面融会贯通，亲手实现水、玻璃、体积雾、溶解护盾、自动积雪、玉石与车漆等七大商业级材质效果！',
        ],
        tryItPrompt:
          '点击顶部「看踩坑现象 / 切正确配置」重温“不对症白忙活 vs 对症下药立达 60 帧”的深刻对比，然后迈入模块 10 开启实战特效之旅！',
      },
    ],
    takeaways: [
      '调优第一铁律是“先找木桶短板、再对症开方”：用 `stat unit` 区分 `Game / Draw / GPU` 瓶颈，避免在 CPU Draw 瓶颈场景盲目砍 GPU 材质节点',
      '三级体检 SOP：`stat unit` + `stat scenerendering` 定性 → 视口热图（`Alt+8` / `Quad Overdraw` / `Substrate`）抓热点 → `ProfileGPU (Ctrl+Shift+,)` / `Unreal Insights` / `RenderDoc` 毫秒级拆解',
      '生产母材质善用 `QualitySwitch` 按画质档位自动裁剪高耗分支，并严控贴图分辨率、ORM 打包与 `Texture Streaming Pool` 显存预算',
      '所有优化必须在固定机位、固定分辨率、关闭帧率锁限下对比优化前后的 `ms` 耗时与 `Mesh draw calls` 实测验收',
    ],
    schematic: schematic9_8,
    StageComponent: Stage9_8_PerfTuningSimulator,
  },
];
