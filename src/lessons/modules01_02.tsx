import React, { useState, useEffect, useRef } from 'react';
import { useAutoFitCanvas } from '../lib/useAutoFitCanvas';
import {
  ModuleDefinition,
  LessonDefinition,
  LessonStageProps,
} from '../types/course';
import {
  clamp,
  saturate,
  lerp,
  lerp3,
  dot3,
  norm3,
  Vec3,
} from '../lib/graphics';
import {
  StageSlider,
  StageSegmented,
  StageToggle,
  PitfallCompareBar,
} from '../components/ui/StageWidgets';

// ============================================================================
// 模块 01 · 第 1.1 课：暗室手电筒照苹果 + RGB 三原色聚光灯混色台
// ============================================================================

type LightPreset = 'white' | 'red' | 'green' | 'blue' | 'off';
type TargetObjectKey = 'apple' | 'leaf' | 'lemon' | 'mug';

const LIGHT_PRESETS: Record<LightPreset, { label: string; rgb: Vec3; desc: string }> = {
  white: { label: '☀️ 白光全开', rgb: [1, 1, 1], desc: '红+绿+蓝三束光齐全' },
  red: { label: '🔴 纯红光', rgb: [1, 0, 0], desc: '只有红光光子，无绿蓝' },
  green: { label: '🟢 纯绿光', rgb: [0, 1, 0], desc: '只有绿光光子，无红蓝' },
  blue: { label: '🔵 纯蓝光', rgb: [0, 0, 1], desc: '只有蓝光光子，无红绿' },
  off: { label: '🌑 关灯暗室', rgb: [0, 0, 0], desc: '没有任何光子射出' },
};

const TARGET_OBJECTS: Record<
  TargetObjectKey,
  { label: string; albedo: Vec3; habit: string }
> = {
  apple: {
    label: '🍎 红苹果',
    albedo: [0.92, 0.05, 0.05],
    habit: '吞掉绿光和蓝光，只把红光弹出去',
  },
  leaf: {
    label: '🍃 绿树叶',
    albedo: [0.06, 0.88, 0.08],
    habit: '吞掉红光和蓝光，只把绿光弹出去',
  },
  lemon: {
    label: '🍋 黄柠檬',
    albedo: [0.94, 0.88, 0.06],
    habit: '同时反射红光+绿光（合体成黄色），吞掉蓝光',
  },
  mug: {
    label: '☕ 白瓷杯',
    albedo: [0.92, 0.92, 0.92],
    habit: '不挑食！红绿蓝什么光来都原样弹回去',
  },
};

const LightAndColorStage: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [lightKey, setLightKey] = useState<LightPreset>('white');
  const [objKey, setObjKey] = useState<TargetObjectKey>('apple');
  const [isPitfall, setIsPitfall] = useState(false);

  // 可拖拽 RGB 聚光灯圆心（归一化坐标 0..1）
  const [spots, setSpots] = useState<{ r: [number, number]; g: [number, number]; b: [number, number] }>({
    r: [0.41, 0.38],
    g: [0.59, 0.38],
    b: [0.5, 0.62],
  });
  const [draggingKey, setDraggingKey] = useState<'r' | 'g' | 'b' | null>(null);
  const [probeColor, setProbeColor] = useState<Vec3>([1, 1, 1]);
  const [probeLabel, setProbeLabel] = useState<string>('三灯中心交叠：纯白光 (1, 1, 1)');

  const darkroomCanvasRef = useRef<HTMLCanvasElement>(null);
  const rgbCanvasRef = useRef<HTMLCanvasElement>(null);
  const darkroomFit = useAutoFitCanvas(darkroomCanvasRef);
  const rgbFit = useAutoFitCanvas(rgbCanvasRef);

  useEffect(() => {
    if (resetSignal > 0) {
      setLightKey('white');
      setObjKey('apple');
      setIsPitfall(false);
      setSpots({
        r: [0.41, 0.38],
        g: [0.59, 0.38],
        b: [0.5, 0.62],
      });
      setProbeColor([1, 1, 1]);
      setProbeLabel('三灯中心交叠：纯白光 (1, 1, 1)');
    }
  }, [resetSignal]);

  const activeLightRgb: Vec3 = isPitfall
    ? [0.06, 0.22, 0.95] // 踩坑模式：冰冷纯蓝月光且无补光
    : LIGHT_PRESETS[lightKey].rgb;

  const activeObj = TARGET_OBJECTS[objKey];
  const reflected: Vec3 = [
    activeLightRgb[0] * activeObj.albedo[0],
    activeLightRgb[1] * activeObj.albedo[1],
    activeLightRgb[2] * activeObj.albedo[2],
  ];
  const perceivedBrightness = Math.max(reflected[0], reflected[1], reflected[2]);

  useEffect(() => {
    const lightName = isPitfall ? '冷蓝月光 (0.06, 0.22, 0.95)' : LIGHT_PRESETS[lightKey].label;
    const isDarkResult = perceivedBrightness < 0.12;
    onKpiUpdate([
      {
        label: '手电筒入射光 (Light)',
        value: `(${activeLightRgb.map((v) => v.toFixed(2)).join(', ')})`,
        sub: lightName,
        tone: 'accent',
      },
      {
        label: '表皮反射率 (Albedo)',
        value: `(${activeObj.albedo.map((v) => v.toFixed(2)).join(', ')})`,
        sub: activeObj.label,
        tone: 'neutral',
      },
      {
        label: '弹入人眼的最终色',
        value: `(${reflected.map((v) => v.toFixed(2)).join(', ')})`,
        sub: isDarkResult ? '⚠️ 没有匹配色光可反射，近乎纯黑！' : '✅ 成功反射出鲜亮颜色',
        tone: isDarkResult ? 'warn' : 'good',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightKey, objKey, isPitfall, perceivedBrightness]);

  // 绘制左侧：暗室手电筒照苹果实验舱
  useEffect(() => {
    const canvas = darkroomCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // 暗室深灰黑背景
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0e1015');
    bgGrad.addColorStop(1, '#171922');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // 桌面
    ctx.fillStyle = '#20232d';
    ctx.fillRect(0, H - 42, W, 42);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(0, H - 42);
    ctx.lineTo(W, H - 42);
    ctx.stroke();

    const cx = W * 0.52;
    const cy = H * 0.58;
    const radius = 44;

    // 手电筒机身（左上角）
    ctx.save();
    ctx.translate(42, 46);
    ctx.rotate(0.46);
    ctx.fillStyle = '#3f4656';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-24, -10, 38, 20, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(12, -12, 8, 24);
    ctx.restore();

    // 光锥与三原色射线拆解
    const [lr, lg, lb] = activeLightRgb;
    const anyLight = lr + lg + lb > 0.01;
    if (anyLight) {
      const beamGrad = ctx.createLinearGradient(56, 54, cx, cy);
      const r255 = Math.round(clamp(lr) * 255);
      const g255 = Math.round(clamp(lg) * 255);
      const b255 = Math.round(clamp(lb) * 255);
      beamGrad.addColorStop(0, `rgba(${r255},${g255},${b255},0.48)`);
      beamGrad.addColorStop(1, `rgba(${r255},${g255},${b255},0.05)`);
      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(58, 46);
      ctx.lineTo(cx + 42, cy - 48);
      ctx.lineTo(cx - 46, cy + 36);
      ctx.lineTo(48, 62);
      ctx.closePath();
      ctx.fill();

      // 绘制 R / G / B 三束微观光子箭头（入射 -> 吸收或弹入人眼）
      const rayDefs: { ch: number; val: number; alb: number; color: string; offset: number }[] = [
        { ch: 0, val: lr, alb: activeObj.albedo[0], color: '#ff4d4f', offset: -12 },
        { ch: 1, val: lg, alb: activeObj.albedo[1], color: '#36d399', offset: 0 },
        { ch: 2, val: lb, alb: activeObj.albedo[2], color: '#38bdf8', offset: 12 },
      ];

      rayDefs.forEach((rd) => {
        if (rd.val < 0.05) return;
        const hitX = cx - 12 + rd.offset * 0.6;
        const hitY = cy - 18 + rd.offset * 0.5;
        ctx.strokeStyle = rd.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(60, 54 + rd.offset * 0.45);
        ctx.lineTo(hitX, hitY);
        ctx.stroke();

        // 判断反射还是被表皮吃掉
        if (rd.val * rd.alb > 0.12) {
          // 弹向右上角人眼
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(hitX, hitY);
          ctx.lineTo(W - 48, 56 + rd.offset * 0.6);
          ctx.stroke();
        } else {
          // 在表皮处画小叉号表示被吸收
          ctx.setLineDash([]);
          ctx.fillStyle = rd.color;
          ctx.font = 'bold 11px sans-serif';
          ctx.fillText('✕吞', hitX - 18, hitY - 5);
        }
      });
      ctx.setLineDash([]);
    }

    // 右上角观察者人眼图标
    const eyeX = W - 36;
    const eyeY = 56;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(eyeX - 16, eyeY);
    ctx.quadraticCurveTo(eyeX, eyeY - 13, eyeX + 16, eyeY);
    ctx.quadraticCurveTo(eyeX, eyeY + 13, eyeX - 16, eyeY);
    ctx.stroke();
    ctx.fillStyle = `rgb(${Math.round(clamp(reflected[0]) * 255)}, ${Math.round(
      clamp(reflected[1]) * 255
    )}, ${Math.round(clamp(reflected[2]) * 255)})`;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('人眼所见', eyeX, eyeY + 24);

    // 底部阴影
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx + 6, H - 36, 42, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // 逐像素小画布绘制受光立体物体（苹果/柠檬/瓷杯/树叶球体质感）
    const imgSize = radius * 2;
    const offscreen = document.createElement('canvas');
    offscreen.width = imgSize;
    offscreen.height = imgSize;
    const octx = offscreen.getContext('2d');
    if (octx) {
      const imgData = octx.createImageData(imgSize, imgSize);
      const L = norm3([-0.58, 0.62, 0.52]);
      const V: Vec3 = [0, 0, 1];
      const Hvec = norm3([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);

      for (let py = 0; py < imgSize; py++) {
        for (let px = 0; px < imgSize; px++) {
          const nx = (px + 0.5 - radius) / radius;
          const ny = (radius - (py + 0.5)) / radius;
          // 苹果造型顶部微凹
          const appleDip = objKey === 'apple' ? 0.12 * Math.exp(-nx * nx * 12) * (ny > 0 ? ny : 0) : 0;
          const r2 = nx * nx + (ny + appleDip) * (ny + appleDip);
          if (r2 > 1) continue;
          const nz = Math.sqrt(Math.max(0, 1 - r2));
          const N = norm3([nx, ny + appleDip, nz]);
          const ndotl = Math.max(0, dot3(N, L));
          const spec = Math.pow(Math.max(0, dot3(N, Hvec)), 28) * 0.28;
          const ambient = 0.04;

          // 关键光学公式：漫反射 = 入射光 RGB * 物体反射率 RGB * 受光角度；表皮高光直接反射入射光颜色
          const pr = clamp(reflected[0] * (ndotl * 1.15 + ambient) + activeLightRgb[0] * spec);
          const pg = clamp(reflected[1] * (ndotl * 1.15 + ambient) + activeLightRgb[1] * spec);
          const pb = clamp(reflected[2] * (ndotl * 1.15 + ambient) + activeLightRgb[2] * spec);

          // 转换成可见 sRGB 显示
          const sr = Math.pow(pr, 1 / 2.2);
          const sg = Math.pow(pg, 1 / 2.2);
          const sb = Math.pow(pb, 1 / 2.2);

          const idx = (py * imgSize + px) * 4;
          imgData.data[idx] = Math.round(sr * 255);
          imgData.data[idx + 1] = Math.round(sg * 255);
          imgData.data[idx + 2] = Math.round(sb * 255);
          imgData.data[idx + 3] = 255;
        }
      }
      octx.putImageData(imgData, 0, 0);
      ctx.drawImage(offscreen, cx - radius, cy - radius);

      // 轮廓微弱描边防止纯黑时找不到位置
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // 苹果果蒂小细节
      if (objKey === 'apple') {
        ctx.strokeStyle = anyLight ? '#78553a' : '#262626';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy - radius + 5);
        ctx.quadraticCurveTo(cx + 4, cy - radius - 10, cx + 10, cy - radius - 12);
        ctx.stroke();
      }
    }

    // 底部结论提示条
    ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
    ctx.fillRect(10, H - 34, W - 20, 26);
    ctx.fillStyle = perceivedBrightness < 0.12 ? '#fca5a5' : '#bbf7d0';
    ctx.font = '600 11.5px sans-serif';
    ctx.textAlign = 'left';
    const summaryText =
      !anyLight
        ? '🌑 暗室无光：红苹果自己不发光，关灯后进入人眼的是 (0,0,0) 纯黑！'
        : perceivedBrightness < 0.12
        ? `😮 神奇现象：${activeObj.label}拿不到想反射的色光，当场变成“黑炭”！`
        : `✨ 挑食反射：${activeObj.habit}`;
    ctx.fillText(summaryText, 18, H - 17);
  }, [activeLightRgb, activeObj, objKey, perceivedBrightness, reflected, darkroomFit]);

  // 绘制右侧：可拖拽 RGB 三原色聚光灯加色舞台
  useEffect(() => {
    const canvas = rgbCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const imgData = ctx.createImageData(W, H);
    const rad = Math.min(W, H) * 0.285;
    const rx = spots.r[0] * W;
    const ry = spots.r[1] * H;
    const gx = spots.g[0] * W;
    const gy = spots.g[1] * H;
    const bx = spots.b[0] * W;
    const by = spots.b[1] * H;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dr = Math.hypot(x - rx, y - ry);
        const dg = Math.hypot(x - gx, y - gy);
        const db = Math.hypot(x - bx, y - by);

        // 平滑边缘聚光灯圆斑，严格按光的加法（R + G + B）叠加
        const rVal = dr < rad ? clamp((rad - dr) / 6, 0, 1) : 0;
        const gVal = dg < rad ? clamp((rad - dg) / 6, 0, 1) : 0;
        const bVal = db < rad ? clamp((rad - db) / 6, 0, 1) : 0;

        // 背景细微暗格纹
        const bg = (x % 24 === 0 || y % 24 === 0) ? 22 : 12;
        const idx = (y * W + x) * 4;
        imgData.data[idx] = Math.min(255, bg + Math.round(rVal * 245));
        imgData.data[idx + 1] = Math.min(255, bg + Math.round(gVal * 245));
        imgData.data[idx + 2] = Math.min(255, bg + Math.round(bVal * 245));
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // 绘制三个拖拽手柄与文字标注
    const drawHandle = (hx: number, hy: number, title: string, stroke: string) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, hy, rad, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(15, 18, 25, 0.78)';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(hx - 24, hy - 11, 48, 22, 999);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(title, hx, hy + 4);
    };

    drawHandle(rx, ry, '红 R', 'rgba(255,110,110,0.65)');
    drawHandle(gx, gy, '绿 G', 'rgba(90,255,160,0.65)');
    drawHandle(bx, by, '蓝 B', 'rgba(100,190,255,0.65)');

    // 如果三圆中心接近，标注交叠色名
    const midX = (rx + gx + bx) / 3;
    const midY = (ry + gy + by) / 3;
    if (
      Math.hypot(midX - rx, midY - ry) < rad * 0.85 &&
      Math.hypot(midX - gx, midY - gy) < rad * 0.85 &&
      Math.hypot(midX - bx, midY - by) < rad * 0.85
    ) {
      ctx.fillStyle = '#111827';
      ctx.font = '800 11.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('白 (1,1,1)', midX, midY + 4);
    }
  }, [spots, rgbFit]);

  const updateSpotDrag = (clientX: number, clientY: number, isDown = false) => {
    const canvas = rgbCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nx = clamp((clientX - rect.left) / rect.width, 0.15, 0.85);
    const ny = clamp((clientY - rect.top) / rect.height, 0.18, 0.82);

    // 实时拾取鼠标所在处加色结果
    const radN = 0.285;
    const aspect = canvas.width / canvas.height;
    const dist = (a: [number, number]) =>
      Math.hypot((nx - a[0]) * aspect, ny - a[1]);

    if (isDown) {
      const dR = dist(spots.r);
      const dG = dist(spots.g);
      const dB = dist(spots.b);
      const minD = Math.min(dR, dG, dB);
      if (minD < 0.32) {
        const picked = minD === dR ? 'r' : minD === dG ? 'g' : 'b';
        setDraggingKey(picked);
        setSpots((prev) => ({ ...prev, [picked]: [nx, ny] }));
      }
      return;
    }

    const nextSpots = draggingKey ? { ...spots, [draggingKey]: [nx, ny] as [number, number] } : spots;
    if (draggingKey) {
      setSpots(nextSpots);
    }

    const rHit = Math.hypot((nx - nextSpots.r[0]) * aspect, ny - nextSpots.r[1]) < radN * aspect * 0.82 ? 1 : 0;
    const gHit = Math.hypot((nx - nextSpots.g[0]) * aspect, ny - nextSpots.g[1]) < radN * aspect * 0.82 ? 1 : 0;
    const bHit = Math.hypot((nx - nextSpots.b[0]) * aspect, ny - nextSpots.b[1]) < radN * aspect * 0.82 ? 1 : 0;
    setProbeColor([rHit, gHit, bHit]);
    const keyStr = `${rHit},${gHit},${bHit}`;
    const nameMap: Record<string, string> = {
      '0,0,0': '暗室背景：无光纯黑 (0, 0, 0)',
      '1,0,0': '单红灯区：纯红光 (1, 0, 0)',
      '0,1,0': '单绿灯区：纯绿光 (0, 1, 0)',
      '0,0,1': '单蓝灯区：纯蓝光 (0, 0, 1)',
      '1,1,0': '红 + 绿 = 鲜亮黄光 (1, 1, 0)！',
      '0,1,1': '绿 + 蓝 = 清澈青光 (0, 1, 1)！',
      '1,0,1': '红 + 蓝 = 霓虹品红 (1, 0, 1)！',
      '1,1,1': '红 + 绿 + 蓝 = 纯白光 (1, 1, 1)！',
    };
    setProbeLabel(nameMap[keyStr] || `混合色 (${keyStr})`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={isPitfall}
          pitfallLabel="纯蓝月光下只涂红底色：红苹果乘出来接近纯黑 (0.05, 0.01, 0.05)"
          correctLabel="补入含红分量的自然光/火把光：红苹果恢复鲜活反光"
          onToggle={(p) => {
            setIsPitfall(p);
            if (p) setObjKey('apple');
          }}
        />
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(265px, 1fr))',
          gap: 10,
        }}
      >
        {/* 左舱：暗室手电筒照苹果 */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid var(--border-soft)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              实验一：暗室手电筒“挑食反射”舱
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
              反射色 = 灯光 × 表皮
            </span>
          </div>
          <canvas
            ref={darkroomCanvasRef}
            width={340}
            height={226}
            style={{ width: '100%', height: 226, display: 'block' }}
          />
        </div>

        {/* 右舱：可拖拽 RGB 三原色聚光灯混色台 */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid var(--border-soft)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              实验二：拖拽 RGB 聚光灯（光的加法）
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
              按住圆灯拖动
            </span>
          </div>
          <div style={{ position: 'relative' }}>
            <canvas
              ref={rgbCanvasRef}
              width={340}
              height={226}
              style={{
                width: '100%',
                height: 226,
                display: 'block',
                cursor: draggingKey ? 'grabbing' : 'grab',
                touchAction: 'none',
              }}
              onMouseDown={(e) => updateSpotDrag(e.clientX, e.clientY, true)}
              onMouseMove={(e) => updateSpotDrag(e.clientX, e.clientY, false)}
              onMouseUp={() => setDraggingKey(null)}
              onMouseLeave={() => setDraggingKey(null)}
              onTouchStart={(e) => {
                if (e.touches[0]) updateSpotDrag(e.touches[0].clientX, e.touches[0].clientY, true);
              }}
              onTouchMove={(e) => {
                if (e.touches[0]) updateSpotDrag(e.touches[0].clientX, e.touches[0].clientY, false);
              }}
              onTouchEnd={() => setDraggingKey(null)}
            />
            <div
              style={{
                position: 'absolute',
                left: 8,
                right: 8,
                bottom: 8,
                padding: '4px 9px',
                borderRadius: 7,
                background: 'rgba(15,23,42,0.86)',
                color: '#f8fafc',
                fontSize: 11.5,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                pointerEvents: 'none',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    border: '1px solid #fff',
                    background: `rgb(${probeColor[0] * 255}, ${probeColor[1] * 255}, ${probeColor[2] * 255})`,
                  }}
                />
                {probeLabel}
              </span>
              <span style={{ opacity: 0.78, fontSize: 10.5 }}>鼠标移上去测色</span>
            </div>
          </div>
        </div>
      </div>

      {/* 底部控制台 */}
      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSegmented<LightPreset>
            label="切换手电筒灯光颜色（试试用纯绿光照红苹果！）"
            value={lightKey}
            options={(Object.keys(LIGHT_PRESETS) as LightPreset[]).map((k) => ({
              value: k,
              label: LIGHT_PRESETS[k].label,
            }))}
            onChange={(v) => {
              setIsPitfall(false);
              setLightKey(v);
            }}
          />

          <StageSegmented<TargetObjectKey>
            label="切换桌面被照物体"
            value={objKey}
            options={(Object.keys(TARGET_OBJECTS) as TargetObjectKey[]).map((k) => ({
              value: k,
              label: TARGET_OBJECTS[k].label,
            }))}
            onChange={setObjKey}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="segmented-opt active"
              onClick={() =>
                setSpots({ r: [0.41, 0.38], g: [0.59, 0.38], b: [0.5, 0.62] })
              }
            >
              🔄 聚光灯经典三环交叠
            </button>
            <button
              type="button"
              className="segmented-opt active"
              onClick={() => {
                setSpots({ r: [0.5, 0.48], g: [0.5, 0.48], b: [0.5, 0.48] });
                setProbeColor([1, 1, 1]);
                setProbeLabel('三灯完全重合：纯白光 (1, 1, 1)！');
              }}
            >
              ⚪ 三灯合一变纯白
            </button>
            <button
              type="button"
              className="segmented-opt active"
              onClick={() =>
                setSpots({ r: [0.22, 0.48], g: [0.5, 0.48], b: [0.78, 0.48] })
              }
            >
              ↔️ 三灯拉开独立看
            </button>
          </div>
          <StageToggle
            label="模拟纯蓝冷月光踩坑现场"
            checked={isPitfall}
            onChange={(v) => {
              setIsPitfall(v);
              if (v) setObjKey('apple');
            }}
          />
        </div>
      </div>
    </div>
  );
};

const lesson1_1: LessonDefinition = {
  id: 'light-and-color',
  moduleId: '01',
  number: '1.1',
  title: '我们是怎么看到世界的？—— 光的“挑食反射”与屏幕 RGB 三原色',
  subtitle: '关灯后红苹果为什么变纯黑？为什么屏幕里的红光加绿光竟然等于鲜黄色？',
  duration: '8 分钟',
  difficulty: '零基础',
  steps: [
    {
      stepNumber: 1,
      shortLabel: '关灯黑苹果',
      tag: 'phenomenon',
      title: '把一颗红苹果关进伸手不见五指的黑屋，它还是红色的吗？',
      paragraphs: [
        '在打开虚幻引擎之前，我们先聊一个每天都在发生、却很少细想的生活现象：为什么一拉电闸关掉房间里所有的灯，桌上鲜艳的红苹果、绿植物、蓝书包就统统变成了纯黑色？',
        '因为自然界里除了太阳、灯泡和火焰，**99% 的物体自己根本不会发光**！苹果表面并没有涂着会自己亮起来的“红色荧光剂”。更反直觉的是：如果你在黑屋子里拿一把**纯绿色激光手电筒**去照这颗红苹果，它既不会变绿，也不会变黄，而是会变成一颗像木炭一样的**黑苹果**！',
      ],
      tryItPrompt:
        '点击下方「切换手电筒灯光颜色」里的【🟢 纯绿光】或【🌑 关灯暗室】，亲眼看看左侧暗室里的红苹果瞬间发生了什么变化！',
    },
    {
      stepNumber: 2,
      shortLabel: '挑食与加色',
      tag: 'background',
      title: '挑食的苹果皮，以及电脑屏幕小灯泡的“加色魔法”',
      paragraphs: [
        '真相其实特别好玩：平时看起来毫无颜色的太阳白光，其实是**红（R）、绿（G）、蓝（B）**等各色光混在一起的“彩虹全家桶”。而红苹果的表皮是个超级**挑食鬼**——它把照在身上的绿光和蓝光全吞进肚子里变成了热量，唯独把红光弹进你的眼睛里！所以当屋里只有纯绿光时，苹果无红光可弹，自然就全黑了。',
        '同时请千万把小时候美术课的“水粉颜料混色”先忘掉：颜料是越混越脏越黑（减色法）；而你的电脑显示器里密密麻麻排着红、绿、蓝三色微型小灯泡，灯光叠在一起只会**越加越亮（加色法）**——**红光 + 绿光 = 鲜黄光**，**红 + 绿 + 蓝全开 = 纯白光**！游戏材质算颜色，100% 遵守光的加法规律。',
      ],
      tryItPrompt:
        '按住右侧实验舱里的红、绿、蓝三个聚光灯圆环随意拖动！看看红灯和绿灯重叠的地方是不是变成了鲜亮的黄色？三盏灯叠在中心是不是纯白色？',
      callout: {
        tone: 'tip',
        title: '一句话记住屏幕加色口诀',
        body: '红(1,0,0) + 绿(0,1,0) = 黄(1,1,0)；绿(0,1,0) + 蓝(0,0,1) = 青(0,1,1)；红(1,0,0) + 蓝(0,0,1) = 品红(1,0,1)；三原色全满 (1,1,1) = 纯白光！',
      },
    },
    {
      stepNumber: 3,
      shortLabel: '动手验算术',
      tag: 'experiment',
      title: '亲手换灯换物体：原来“看到颜色”就是一道小学乘法题！',
      paragraphs: [
        '仔细观察左上角实时跳动的三张数据卡，你会发现显卡计算物体颜色的核心逻辑简单得令人感动：**`进入人眼的光 = 手电筒入射光 × 物体表皮反射率`**（红乘红、绿乘绿、蓝乘蓝，各算各的账）。',
        '不信你把桌面物体切成 **`🍋 黄柠檬`**（它同时反射红光和绿光），再分别打上纯红光和纯绿光试试：在红光下柠檬变成了红柠檬，在绿光下变成了绿柠檬，唯独在纯蓝光下变成了黑柠檬！只有 **`☕ 白瓷杯`** 来者不拒，打什么光就显什么色。',
      ],
      tryItPrompt:
        '把物体切到【🍋 黄柠檬】和【☕ 白瓷杯】，轮流点击红、绿、蓝手电筒，对照顶部三张数值卡验证“逐通道相乘”的规律！',
    },
    {
      stepNumber: 4,
      shortLabel: '走进UE 5.8',
      tag: 'ue5',
      title: '走进 UE 5.8：为什么材质底色叫 `Diffuse Albedo（漫反射率）`？',
      paragraphs: [
        '现在你再打开 UE 5.8 的材质编辑器，看到显式添加的层板 **`Substrate Slab BSDF`** 第一个插孔写着 **`Diffuse Albedo`**（传统根节点提供 `Base Color`），就再也不会把它误当成“涂死在模型上的颜料”了！',
        '它的真实物理含义正是**“三原色各自的反射百分比”**！比如你给一颗苹果材质填上 `(0.90, 0.05, 0.05)`，其实是在向引擎申报：“以后不管关卡里打什么灯，请帮我反射 90% 的红光、只反射 5% 的绿光和蓝光”。没有关卡灯光配合，再鲜艳的 `Diffuse Albedo` 在黑屋里也是全黑的。',
      ],
      tryItPrompt:
        '点击舞台右上角的【原理图】切换钮，看看在 UE 5.8 中“表皮反射率”是如何送入 `Substrate Slab BSDF` 并与场景灯光互动的！',
      callout: {
        tone: 'ue58',
        title: 'UE 5.8 术语小贴士',
        body: '新工程可启用 Substrate，同时支持传统根节点。显式 Slab 的 Diffuse Albedo 描述漫反射，灯光由渲染器计算。',
      },
    },
    {
      stepNumber: 5,
      shortLabel: '实战防坑',
      tag: 'pitfall',
      title: '防坑口诀：灯色相加，反射按分量相乘，冷蓝夜景别怪红衣变黑炭！',
      paragraphs: [
        '很多新手做夜景关卡时会踩一个经典大坑：给主角做了一件鲜红披风 `(0.9, 0.05, 0.05)`，结果放进只有高饱和纯蓝月光 `(0.06, 0.22, 0.95)` 的森林里一看，披风黑得像块破抹布，还以为材质坏了去拼命改材质球！',
        '算一下乘法就秒懂了：`0.9 × 0.06 = 0.054`！蓝色月光里根本没几颗红光子，红披风巧妇难为无米之炊。正确做法绝不是乱改披风材质，而是让灯光师在月光里保留一点自然白光底色，或在主角身旁挂一盏温暖的橙色小提灯！',
      ],
      tryItPrompt:
        '点击舞台上方的黄色/绿色对比条切换【看踩坑现象】与【切正确配置】，感受纯蓝冷月光是如何让红苹果“哑火”的。',
      callout: {
        tone: 'warn',
        title: '一句话防坑口诀',
        body: '“物体本无光，全靠挑着弹；红绿叠出黄，打灯留余粮！”——遇到材质在特定地图偏暗发黑，先拿白瓷球（Albedo=0.8）测测是不是关卡灯光本身偏色太极端。',
      },
    },
  ],
  takeaways: [
    '绝大多数物体自己不发光，我们看到红苹果是因为它吞掉了绿蓝光、只把红光反射进眼睛',
    '显示器与 3D 渲染遵循“光的加色法”：红 + 绿 = 黄，绿 + 蓝 = 青，红 + 蓝 = 品红，三色全满 = 纯白',
    'UE 5.8 的 Diffuse Albedo（漫反射率）不是死颜料，而是物体对红、绿、蓝三束光的反射百分比',
    '最终入眼颜色 ≈ 灯光 RGB × 材质反射率 RGB；在纯蓝冷光下没有红光来源，红衣服必然变黑',
  ],
  schematic: {
    "title": "把苹果的漫反射率交给渲染器",
    "caption": "按图连接已转换的 Substrate 材质。关卡灯光由渲染器在材质图外计算。舞台单独演示入射光与反射率逐通道相乘。",
    "nodes": [
      {
        "id": "albedo",
        "title": "Constant3Vector",
        "category": "param",
        "x": 20,
        "y": 45,
        "width": 167,
        "outputs": [
          {
            "id": "p0",
            "label": "RGB",
            "color": "#38bdf8"
          }
        ],
        "note": "线性值 (0.9, 0.05, 0.05)"
      },
      {
        "id": "slab",
        "title": "Substrate Slab BSDF",
        "category": "substrate",
        "x": 245,
        "y": 45,
        "width": 167,
        "inputs": [
          {
            "id": "p0",
            "label": "Diffuse Albedo",
            "color": "#38bdf8"
          }
        ],
        "outputs": [
          {
            "id": "p0",
            "label": "BSDF",
            "color": "#38bdf8"
          }
        ]
      },
      {
        "id": "root",
        "title": "材质根节点",
        "category": "output",
        "x": 475,
        "y": 45,
        "width": 167,
        "inputs": [
          {
            "id": "p0",
            "label": "Front Material",
            "color": "#38bdf8"
          }
        ]
      },
      {
        "id": "lighting",
        "title": "图外 · 场景光照",
        "category": "pipeline",
        "x": 475,
        "y": 195,
        "width": 167,
        "note": "渲染器结合灯光、表面朝向和材质求反射光。"
      }
    ],
    "edges": [
      {
        "fromNode": "albedo",
        "fromPin": "p0",
        "toNode": "slab",
        "toPin": "p0",
        "color": "#38bdf8"
      },
      {
        "fromNode": "slab",
        "fromPin": "p0",
        "toNode": "root",
        "toPin": "p0",
        "color": "#38bdf8"
      }
    ]
  },
  StageComponent: LightAndColorStage,
};

// ============================================================================
// 模块 01 · 第 1.2 课：CPU 老教授串行 vs GPU 万名小学生并行 + 64× 像素显微镜
// ============================================================================

const GRID_N = 16; // 16 × 16 = 256 个代表性像素格

interface PixelSlipInfo {
  gx: number;
  gy: number;
  u: number;
  v: number;
  insideSphere: boolean;
  normal: Vec3;
  ndotl: number;
  spec: number;
  finalRgb: Vec3;
}

function evalSpherePixel(gx: number, gy: number, sunDeg: number): PixelSlipInfo {
  const u = (gx + 0.5) / GRID_N;
  const v = (gy + 0.5) / GRID_N;
  const nx = (u - 0.5) * 2.25;
  const ny = (0.5 - v) * 2.25;
  const r2 = nx * nx + ny * ny;

  const rad = (sunDeg * Math.PI) / 180;
  const L = norm3([Math.sin(rad) * 0.85, 0.52, Math.cos(rad) * 0.78]);
  const V: Vec3 = [0, 0, 1];
  const Hvec = norm3([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);

  if (r2 > 1) {
    // 背景柔和渐变天空
    const skyT = clamp(1 - v, 0, 1);
    const bg: Vec3 = lerp3([0.13, 0.16, 0.23], [0.24, 0.33, 0.48], skyT);
    return {
      gx,
      gy,
      u,
      v,
      insideSphere: false,
      normal: [0, 0, 1],
      ndotl: 0,
      spec: 0,
      finalRgb: bg,
    };
  }

  const nz = Math.sqrt(Math.max(0, 1 - r2));
  const N = norm3([nx, ny, nz]);
  const ndotl = Math.max(0, dot3(N, L));
  const spec = Math.pow(Math.max(0, dot3(N, Hvec)), 18) * 0.42;
  const baseCol: Vec3 = [0.22, 0.72, 0.56]; // 翡翠青绿球
  const amb = 0.12;

  const fr = clamp(baseCol[0] * (ndotl + amb) + spec);
  const fg = clamp(baseCol[1] * (ndotl + amb) + spec);
  const fb = clamp(baseCol[2] * (ndotl + amb) + spec);

  return {
    gx,
    gy,
    u,
    v,
    insideSphere: true,
    normal: N,
    ndotl,
    spec,
    finalRgb: [fr, fg, fb],
  };
}

const CpuVsGpuStage: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [cpuCount, setCpuCount] = useState<number>(42);
  const [raceRunId, setRaceRunId] = useState<number>(1);
  const [recipeMode, setRecipeMode] = useState<'clean' | 'branch'>('clean');
  const [sunDeg, setSunDeg] = useState<number>(32);
  const [selectedCell, setSelectedCell] = useState<[number, number]>([6, 5]);

  const cpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const gpuCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (resetSignal > 0) {
      setRecipeMode('clean');
      setSunDeg(32);
      setSelectedCell([6, 5]);
      setRaceRunId((n) => n + 1);
    }
  }, [resetSignal]);

  // 只为逐格涂色的教学动画计时；分支开关不修改动画节奏。
  useEffect(() => {
    setCpuCount(0);

    const cpuInterval = window.setInterval(() => {
      setCpuCount((prev) => {
        if (prev >= GRID_N * GRID_N) {
          window.clearInterval(cpuInterval);
          return GRID_N * GRID_N;
        }
        return Math.min(GRID_N * GRID_N, prev + 2);
      });
    }, 35);

    return () => {
      window.clearInterval(cpuInterval);
    };
  }, [raceRunId]);

  const slip = evalSpherePixel(selectedCell[0], selectedCell[1], sunDeg);

  useEffect(() => {
    const total = GRID_N * GRID_N;
    onKpiUpdate([
      {
        label: 'CPU 串行进度 (单人逐格)',
        value: `${cpuCount} / ${total} 格`,
        sub: cpuCount < total ? '😓 老教授正挨个格子涂色...' : '逐格动画完成',
        tone: cpuCount < total ? 'warn' : 'neutral',
      },
      {
        label: '假设的线程组执行路径',
        value: recipeMode === 'branch' ? '两种输入走 A / B' : '所有输入走 A',
        sub: '动画仅展示分组，耗时需在目标 GPU 测量',
        tone: recipeMode === 'branch' ? 'warn' : 'good',
      },
      {
        label: `显微镜像素 (${selectedCell[0]}, ${selectedCell[1]})`,
        value: `RGB(${slip.finalRgb.map((v) => v.toFixed(2)).join(',')})`,
        sub: slip.insideSphere
          ? `受光 N·L = ${slip.ndotl.toFixed(2)}`
          : '位于球体外（天空背景格）',
        tone: 'accent',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpuCount, recipeMode, selectedCell[0], selectedCell[1], sunDeg]);

  // 绘制 CPU 与 GPU 对比像素网格画布
  useEffect(() => {
    const drawGridCanvas = (
      canvas: HTMLCanvasElement | null,
      paintedLimit: number,
      highlightSel: boolean,
      showPaths: boolean
    ) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      const cellW = W / GRID_N;
      const cellH = H / GRID_N;

      ctx.fillStyle = '#14161d';
      ctx.fillRect(0, 0, W, H);

      for (let gy = 0; gy < GRID_N; gy++) {
        for (let gx = 0; gx < GRID_N; gx++) {
          const idx = gy * GRID_N + gx;
          const x0 = gx * cellW;
          const y0 = gy * cellH;

          if (idx < paintedLimit) {
            const p = evalSpherePixel(gx, gy, sunDeg);
            const r = Math.round(Math.pow(p.finalRgb[0], 1 / 2.2) * 255);
            const g = Math.round(Math.pow(p.finalRgb[1], 1 / 2.2) * 255);
            const b = Math.round(Math.pow(p.finalRgb[2], 1 / 2.2) * 255);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x0 + 0.6, y0 + 0.6, cellW - 1.2, cellH - 1.2);
          } else {
            ctx.fillStyle = '#1e222d';
            ctx.fillRect(x0 + 1, y0 + 1, cellW - 2, cellH - 2);
          }

          // CPU 当前正在涂的那一格画红色画笔框
          if (!highlightSel && idx === paintedLimit && paintedLimit < GRID_N * GRID_N) {
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2.2;
            ctx.strokeRect(x0 + 1, y0 + 1, cellW - 2, cellH - 2);
          }
        }
      }

      // GPU 选中显微镜格子高亮框
      if (highlightSel) {
        const [sx, sy] = selectedCell;
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(sx * cellW + 1, sy * cellH + 1, cellW - 2, cellH - 2);
      }

      if (showPaths) {
        ctx.fillStyle = 'rgba(15,23,42,0.85)';
        ctx.fillRect(0, H - 21, W, 21);
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(recipeMode === 'branch' ? '假设分组：左半 A，右半 B' : '假设分组：全组 A', 5, H - 6);
      }
    };

    drawGridCanvas(cpuCanvasRef.current, cpuCount, false, false);
    drawGridCanvas(
      gpuCanvasRef.current,
      GRID_N * GRID_N,
      true,
      true
    );
  }, [cpuCount, sunDeg, selectedCell, recipeMode]);

  const handleGpuCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const gx = clamp(Math.floor(((e.clientX - rect.left) / rect.width) * GRID_N), 0, GRID_N - 1);
    const gy = clamp(Math.floor(((e.clientY - rect.top) / rect.height) * GRID_N), 0, GRID_N - 1);
    setSelectedCell([gx, gy]);
  };

  const swatchCss = `rgb(${Math.round(Math.pow(slip.finalRgb[0], 1 / 2.2) * 255)}, ${Math.round(
    Math.pow(slip.finalRgb[1], 1 / 2.2) * 255
  )}, ${Math.round(Math.pow(slip.finalRgb[2], 1 / 2.2) * 255)})`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={recipeMode === 'branch'}
          pitfallLabel="假设同一组线程分别走 A、B 两条路径"
          correctLabel="假设同一组线程走相同路径 A"
          onToggle={(p) => {
            setRecipeMode(p ? 'branch' : 'clean');
            setRaceRunId((n) => n + 1);
          }}
        />
      )}

      {/* 上半区：CPU vs GPU 涂色竞速双画布 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 10,
        }}
      >
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
            <span>🧓 CPU 老教授（1 格格串行涂）</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-coral-deep)' }}>
              {Math.round((cpuCount / 256) * 100)}%
            </span>
          </div>
          <canvas
            ref={cpuCanvasRef}
            width={208}
            height={208}
            style={{
              width: 192,
              height: 192,
              borderRadius: 8,
              border: '1.5px solid var(--border-soft)',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            擅长算复杂剧情背包，挨个涂 368 万像素会累趴！
          </span>
        </div>

        <div
          style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
            <span>🧒 GPU 小学生方阵（点击任意格放大！）</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-sage-deep)' }}>
              并行网格已显示
            </span>
          </div>
          <canvas
            ref={gpuCanvasRef}
            width={208}
            height={208}
            onClick={handleGpuCanvasClick}
            style={{
              width: 192,
              height: 192,
              borderRadius: 8,
              border: '1.5px solid var(--border-strong)',
              cursor: 'crosshair',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            👆 点选上面任意一个黄色小方格，偷看它的专属算草纸
          </span>
        </div>
      </div>

      {/* 中间：64× 像素显微镜与专属算术食谱拆解卡 */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1.5px solid var(--border-strong)',
          borderRadius: 11,
          padding: '9px 12px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 800 }}>
            🔬 64× 像素显微镜：第 #{selectedCell[1] * GRID_N + selectedCell[0]} 号小学生领到的「专属小纸条」
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.65, color: 'var(--text-secondary)' }}>
            <div>• 屏幕座位号 Pixel = ({selectedCell[0]}, {selectedCell[1]})</div>
            <div>• 橘子皮坐标 UV = ({slip.u.toFixed(2)}, {slip.v.toFixed(2)})</div>
            <div>
              • 朝向小牙签 Normal = (
              {slip.insideSphere
                ? `${slip.normal[0].toFixed(2)}, ${slip.normal[1].toFixed(2)}, ${slip.normal[2].toFixed(2)}`
                : '球外背景像素'}
              )
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-subtle)',
            borderRadius: 9,
            padding: '8px 10px',
            border: '1px solid var(--border-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
              📜 全班同步执行的「材质食谱 Shader」：
            </div>
            {slip.insideSphere ? (
              <>
                <div>1. 受光 = max(0, N·太阳) = {slip.ndotl.toFixed(2)}</div>
                <div>2. 高光 = 镜面反光加成 = {slip.spec.toFixed(2)}</div>
                <div>
                  3. 交卷 RGB = ({slip.finalRgb.map((v) => v.toFixed(2)).join(', ')})
                </div>
              </>
            ) : (
              <>
                <div>1. 判定不在球面上 → 采样天空背景</div>
                <div>
                  2. 交卷 RGB = ({slip.finalRgb.map((v) => v.toFixed(2)).join(', ')})
                </div>
              </>
            )}
          </div>
          <div
            style={{
              minWidth: 46,
              height: 46,
              borderRadius: 9,
              background: swatchCss,
              border: '2px solid var(--border-strong)',
              boxShadow: 'var(--shadow-brutal)',
            }}
            title="该像素算出的最终颜色"
          />
        </div>
      </div>

      {/* 底部交互控制栏 */}
      <div className="stage-controls-panel">
        <div className="control-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              className="brutal-btn primary"
              style={{ padding: '7px 12px', fontSize: 12.5 }}
              onClick={() => setRaceRunId((n) => n + 1)}
            >
              🎺 重新吹哨！看 CPU vs GPU 分组示意
            </button>
          </div>

          <StageSlider
            label="转动示意光源（256 格重新着色）"
            value={sunDeg}
            min={-75}
            max={75}
            step={1}
            unit="°"
            onChange={setSunDeg}
          />

          <StageSegmented<'clean' | 'branch'>
            label="线程组的假设输入"
            value={recipeMode}
            options={[
              { value: 'clean', label: '全组相同路径 A' },
              { value: 'branch', label: '组内分歧 A / B' },
            ]}
            onChange={(v) => {
              setRecipeMode(v);
              setRaceRunId((n) => n + 1);
            }}
          />
        </div>
      </div>
    </div>
  );
};

const lesson1_2: LessonDefinition = {
  id: 'cpu-vs-gpu',
  moduleId: '01',
  number: '1.2',
  title: '为什么有了 CPU 还要买显卡（GPU）？—— 1 个老教授 vs 10000 个小学生',
  subtitle: '每秒涂色 2.2 亿次！看懂“材质”为什么根本不是墙纸，而是一份全班同步算术食谱',
  duration: '9 分钟',
  difficulty: '零基础',
  steps: [
    {
      stepNumber: 1,
      shortLabel: '2.2亿次涂色',
      tag: 'phenomenon',
      title: '算一笔吓一跳的账：玩游戏时电脑一秒钟要涂多少个格子？',
      paragraphs: [
        '凑近看你的电脑显示器，画面其实是由几百万个发光小方格拼成的，每个小方格叫一个 **像素（Pixel）**。一块主流 2K 屏幕足足有 `2560 × 1440 ≈ 368 万` 个像素！',
        '若按每秒 60 帧刷新，2560 × 1440 × 60 ≈ 2.21 亿个显示像素/秒。以下逐格与整组显示均为教学动画。',
      ],
      tryItPrompt:
        '点击舞台左下角的【🎺 重新吹哨！看 CPU vs GPU 分组示意】，直观感受“挨个格子串行涂色”与“全屏一瞬间并行显形”的震撼差距！',
    },
    {
      stepNumber: 2,
      shortLabel: '教授与小学生',
      tag: 'background',
      title: '8 个博学老教授（CPU） vs 10000 个算术小学生（GPU）',
      paragraphs: [
        '因为 CPU 和显卡（GPU）天生的性格完全不同：**CPU 就像 8 位绝顶聪明的老教授**，最擅长处理前因后果盘根错节的逻辑（比如算怪物怎么寻路、背包道具怎么排序、剧情对话往哪跳），但让老教授一格一格去涂两亿个色块，涂完第二行天都黑了！',
        'GPU 把许多片元分组成线程组，用同一段程序处理各自的输入。右侧 256 格一起显示，示意同一份食谱可以处理许多输入。实际硬件会分批调度，CPU 也可以并行。',
      ],
      tryItPrompt:
        '试着来回拖动「转动太阳方向」滑块，你会看到右侧 GPU 的 256 个像素在同一瞬间毫不费力地改完了光影！',
      callout: {
        tone: 'tip',
        title: '颠覆认知的顿悟时刻：材质到底是什么？',
        body: '材质（底层叫 Shader 着色器）根本不是一张死板糊在模型上的“花墙纸”，而是发给全屏几百万名像素小学生人手一份、同时低头照着算的「同步算术食谱」！',
      },
    },
    {
      stepNumber: 3,
      shortLabel: '偷看专属纸条',
      tag: 'experiment',
      title: '既然全班拿的是同一份食谱，为什么算出来的球却有明有暗？',
      paragraphs: [
        '你肯定会好奇：“如果几百万个小学生执行的算术公式一模一样，为什么没有把整个屏幕涂成同一个颜色，反而算出了有高光、有暗部的立体圆球呢？”',
        '秘密就在每个人桌角那张**「专属输入小纸条」**上！虽然食谱写着同一句 `亮度 = 朝向 · 太阳方向`，但球体左上角 5 号同学纸条上的朝向正对着太阳，算出来就是 `0.95`（高亮）；右下角背光同学纸条上的朝向背对太阳，算出来就是 `0.0`（暗部）！',
      ],
      tryItPrompt:
        '用鼠标在右侧【GPU 小学生方阵】的亮部、暗部和球外背景上分别点选几个格子，对比下方「64× 像素显微镜」里它们各自的专属小纸条！',
    },
    {
      stepNumber: 4,
      shortLabel: '走进UE 5.8',
      tag: 'ue5',
      title: '走进 UE 5.8：你在材质画布连的每一根线，都是在往食谱里加菜！',
      paragraphs: [
        '理解了这一点，UE 5.8 的材质编辑器在你眼里就彻底透明了：左侧那些 `TexCoord（UV）`、`PixelNormalWS（像素法线）` 节点，就是在读取每个小学生手里的**专属小纸条**；中间的加减乘除节点，就是你编写的**算术步骤**。',
        '2560×1440、60 帧/秒约对应 2.21 亿个显示像素/秒。覆盖率、过度绘制和编译优化都会改变实际工作量。打开 Material Editor 的 Platform Stats，选同一目标平台与质量级别，记录实际编译的指令与纹理采样统计。',
      ],
      tryItPrompt:
        '切换到舞台右上角的【原理图】视图，顺着从左到右的箭头看清“专属纸条输入 → 统一算术食谱 → 百万像素同时交卷”的完整流水线。',
    },
    {
      stepNumber: 5,
      shortLabel: '忌写分叉题',
      tag: 'pitfall',
      title: '如何判断分支的实际开销？',
      paragraphs: [
        '同一组线程若实际走了不同的动态路径，硬件可能分段处理；着色器编译器也可能将判断变成选择指令。网页的分组动画仅描述两种假设输入。',
        '用同一网格、灯光和相机对比两个输出相同的版本。分别记录 Platform Stats，再在目标设备用 GPU Visualizer 多帧测量同一渲染 pass 的耗时。Lerp 也可能需要计算两个输入。',
      ],
      tryItPrompt:
        '切换两种路径，读画布底部的假设分组。将自己测得的 GPU 时间和编译统计分别记下。',
      callout: {
        tone: 'warn',
        title: '一句话防坑口诀',
        body: '记录平台、着色器质量和测试场景，才能复查性能差异。',
      },
    },
  ],
  takeaways: [
    '2560×1440、60 帧/秒约对应 2.21 亿个显示像素/秒；实际着色次数由覆盖、过度绘制等决定',
    '材质编译为着色器，GPU 分组并行处理大量片元，各片元有自己的输入',
    '虽然食谱完全相同，但每个像素领到的专属小纸条（坐标、UV、法线朝向）不同，从而算出丰富光影',
    '组内路径分歧可能增加工作量。编译统计与目标设备 GPU 计时回答不同的问题',
  ],
  schematic: {
    "title": "用 Unlit 材质查看 Lambert 明暗",
    "caption": "传统 Surface 根节点选择 Unlit。创建向量参数 LightDirWS，填入从表面指向光源的世界空间单位向量 (0,0,1)。这个手动参数独立于关卡灯光。",
    "nodes": [
      {
        "id": "normal",
        "title": "PixelNormalWS",
        "category": "input",
        "x": 18,
        "y": 20,
        "width": 167,
        "outputs": [
          {
            "id": "p0",
            "label": "XYZ",
            "color": "#38bdf8"
          }
        ]
      },
      {
        "id": "light",
        "title": "LightDirWS",
        "category": "param",
        "x": 18,
        "y": 170,
        "width": 167,
        "outputs": [
          {
            "id": "p0",
            "label": "RGB",
            "color": "#38bdf8"
          }
        ],
        "note": "Vector Parameter"
      },
      {
        "id": "dot",
        "title": "DotProduct",
        "category": "math",
        "x": 233,
        "y": 80,
        "width": 167,
        "inputs": [
          {
            "id": "p0",
            "label": "A",
            "color": "#38bdf8"
          },
          {
            "id": "p1",
            "label": "B",
            "color": "#38bdf8"
          }
        ],
        "outputs": [
          {
            "id": "p0",
            "label": "N·L",
            "color": "#38bdf8"
          }
        ]
      },
      {
        "id": "sat",
        "title": "Saturate",
        "category": "math",
        "x": 442,
        "y": 80,
        "width": 167,
        "inputs": [
          {
            "id": "p0",
            "label": "Input",
            "color": "#38bdf8"
          }
        ],
        "outputs": [
          {
            "id": "p0",
            "label": "0 到 1",
            "color": "#38bdf8"
          }
        ]
      },
      {
        "id": "root",
        "title": "Unlit 材质根节点",
        "category": "output",
        "x": 653,
        "y": 80,
        "width": 167,
        "inputs": [
          {
            "id": "p0",
            "label": "Emissive Color",
            "color": "#38bdf8"
          }
        ]
      }
    ],
    "edges": [
      {
        "fromNode": "normal",
        "fromPin": "p0",
        "toNode": "dot",
        "toPin": "p0",
        "color": "#38bdf8"
      },
      {
        "fromNode": "light",
        "fromPin": "p0",
        "toNode": "dot",
        "toPin": "p1",
        "color": "#38bdf8"
      },
      {
        "fromNode": "dot",
        "fromPin": "p0",
        "toNode": "sat",
        "toPin": "p0",
        "color": "#38bdf8"
      },
      {
        "fromNode": "sat",
        "fromPin": "p0",
        "toNode": "root",
        "toPin": "p0",
        "color": "#38bdf8"
      }
    ]
  },
  StageComponent: CpuVsGpuStage,
};

// ============================================================================
// 模块 01 · 第 1.3 课：掰弯四边形实验 + 3D 刺猬法线小牙签透视镜
// ============================================================================

interface TriFace {
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function rotateYawPitch(p: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = p[0] * cy + p[2] * sy;
  const y1 = p[1];
  const z1 = -p[0] * sy + p[2] * cy;

  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const x2 = x1;
  const y2 = y1 * cp - z1 * sp;
  const z2 = y1 * sp + z1 * cp;
  return [x2, y2, z2];
}

function buildSphereTris(): TriFace[] {
  const tris: TriFace[] = [];
  const stacks = 6;
  const slices = 10;
  for (let i = 0; i < stacks; i++) {
    const phi0 = (Math.PI * i) / stacks;
    const phi1 = (Math.PI * (i + 1)) / stacks;
    for (let j = 0; j < slices; j++) {
      const th0 = (2 * Math.PI * j) / slices;
      const th1 = (2 * Math.PI * (j + 1)) / slices;

      const pt = (phi: number, th: number): Vec3 => [
        Math.sin(phi) * Math.cos(th),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(th),
      ];

      const p00 = pt(phi0, th0);
      const p10 = pt(phi0, th1);
      const p01 = pt(phi1, th0);
      const p11 = pt(phi1, th1);

      if (i > 0) tris.push({ v0: p00, v1: p10, v2: p01 });
      if (i < stacks - 1) tris.push({ v0: p10, v1: p11, v2: p01 });
    }
  }
  return tris;
}

function buildSwordTris(): TriFace[] {
  const tris: TriFace[] = [];
  // 棱角宝石长剑：剑尖、剑身四棱面、护手、剑柄
  const tip: Vec3 = [0, 1.18, 0];
  const midL: Vec3 = [-0.24, 0.35, 0];
  const midR: Vec3 = [0.24, 0.35, 0];
  const midF: Vec3 = [0, 0.35, 0.14];
  const midB: Vec3 = [0, 0.35, -0.14];

  const baseL: Vec3 = [-0.28, -0.35, 0];
  const baseR: Vec3 = [0.28, -0.35, 0];
  const baseF: Vec3 = [0, -0.35, 0.15];
  const baseB: Vec3 = [0, -0.35, -0.15];

  // 剑尖四面（逆时针朝外）
  tris.push({ v0: tip, v1: midL, v2: midF });
  tris.push({ v0: tip, v1: midF, v2: midR });
  tris.push({ v0: tip, v1: midR, v2: midB });
  tris.push({ v0: tip, v1: midB, v2: midL });

  // 剑身四侧面（每侧切 2 个三角形）
  tris.push({ v0: midL, v1: baseL, v2: baseF }, { v0: midL, v1: baseF, v2: midF });
  tris.push({ v0: midF, v1: baseF, v2: baseR }, { v0: midF, v1: baseR, v2: midR });
  tris.push({ v0: midR, v1: baseR, v2: baseB }, { v0: midR, v1: baseB, v2: midB });
  tris.push({ v0: midB, v1: baseB, v2: baseL }, { v0: midB, v1: baseL, v2: midL });

  // 护手横翼
  const gL: Vec3 = [-0.62, -0.44, 0];
  const gR: Vec3 = [0.62, -0.44, 0];
  const gTop: Vec3 = [0, -0.34, 0.18];
  const gBot: Vec3 = [0, -0.54, 0.18];
  const gTopB: Vec3 = [0, -0.34, -0.18];
  const gBotB: Vec3 = [0, -0.54, -0.18];
  tris.push({ v0: gTop, v1: gL, v2: gBot }, { v0: gTop, v1: gBot, v2: gR });
  tris.push({ v0: gTopB, v1: gBotB, v2: gL }, { v0: gTopB, v1: gR, v2: gBotB });

  // 剑柄尾锥
  const pommel: Vec3 = [0, -1.08, 0];
  tris.push({ v0: gBot, v1: [-0.12, -0.56, 0], v2: pommel });
  tris.push({ v0: gBot, v1: pommel, v2: [0.12, -0.56, 0] });
  tris.push({ v0: gBotB, v1: pommel, v2: [-0.12, -0.56, 0] });
  tris.push({ v0: gBotB, v1: [0.12, -0.56, 0], v2: pommel });

  return tris;
}

const SPHERE_TRIS = buildSphereTris();
const SWORD_TRIS = buildSwordTris();
const SINGLE_TRI: TriFace[] = [{ v0: [-0.92, -0.72, 0], v1: [0.92, -0.72, 0], v2: [0, 0.96, 0] }];

const MeshTriangleNormalStage: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [cornerHeight, setCornerHeight] = useState<number>(0.68);
  const [quadSplit, setQuadSplit] = useState<'tri' | 'quad'>('tri');
  const [meshKind, setMeshKind] = useState<'sphere' | 'sword' | 'triangle'>('sphere');
  const [showNormals, setShowNormals] = useState<boolean>(true);
  const [showWire, setShowWire] = useState<boolean>(true);
  const [reverseWinding, setReverseWinding] = useState(false);
  const [flippedPitfall, setFlippedPitfall] = useState<boolean>(false);
  const [rot, setRot] = useState<{ yaw: number; pitch: number }>({ yaw: 0.55, pitch: 0.28 });
  const [draggingMesh, setDraggingMesh] = useState<{ x: number; y: number } | null>(null);

  const quadCanvasRef = useRef<HTMLCanvasElement>(null);
  const meshCanvasRef = useRef<HTMLCanvasElement>(null);
  const quadFit = useAutoFitCanvas(quadCanvasRef);
  const meshFit = useAutoFitCanvas(meshCanvasRef);

  useEffect(() => {
    if (resetSignal > 0) {
      setCornerHeight(0.68);
      setQuadSplit('tri');
      setMeshKind('sphere');
      setShowNormals(true);
      setShowWire(true);
      setReverseWinding(false);
      setFlippedPitfall(false);
      setRot({ yaw: 0.55, pitch: 0.28 });
    }
  }, [resetSignal]);

  const activeTris = meshKind === 'sphere' ? SPHERE_TRIS : meshKind === 'sword' ? SWORD_TRIS : SINGLE_TRI;
  const isQuadBroken = quadSplit === 'quad' && Math.abs(cornerHeight) > 0.1;

  useEffect(() => {
    onKpiUpdate([
      {
        label: '四边形折弯检测',
        value: isQuadBroken ? '⚠️ 非共面扭曲！' : '✅ 100% 绝对平整',
        sub:
          quadSplit === 'tri'
            ? '切成 2 个三角形，三点永远共面'
            : Math.abs(cornerHeight) <= 0.1
            ? '暂时水平共面'
            : '4 个钉子不在同一平面，法线错乱',
        tone: isQuadBroken ? 'bad' : 'good',
      },
      {
        label: '当前模型三角面数',
        value: meshKind === 'triangle' ? `可见 ${reverseWinding ? 0 : 1} / 1` : `${activeTris.length} 个三角形`,
        sub: meshKind === 'sphere' ? '空心多面体圆球' : meshKind === 'sword' ? '空心棱角宝剑' : '固定相机与灯光',
        tone: 'neutral',
      },
      {
        label: '法线小牙签朝向',
        value: flippedPitfall ? '❌ 朝肚子内部扎反' : '✅ 垂直表皮朝外',
        sub: reverseWinding ? '绕序反转，原正面剔除' : '原始绕序，保留原正面',
        tone: flippedPitfall ? 'bad' : 'accent',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cornerHeight, quadSplit, meshKind, flippedPitfall, reverseWinding]);

  // 绘制左舱：掰弯四边形 vs 三角形稳定实验
  useEffect(() => {
    const canvas = quadCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#13161f';
    ctx.fillRect(0, 0, W, H);

    // 投影辅助函数（Z 朝上）
    const proj = (p: Vec3): [number, number] => {
      const isoX = (p[0] - p[1]) * 64;
      const isoY = (p[0] + p[1]) * 32 - p[2] * 68;
      return [W * 0.5 + isoX, H * 0.6 + isoY];
    };

    // 地面参考底座虚线框
    const gA = proj([-1, -1, 0]);
    const gB = proj([1, -1, 0]);
    const gC = proj([1, 1, 0]);
    const gD = proj([-1, 1, 0]);
    ctx.strokeStyle = 'rgba(148,163,184,0.25)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(gA[0], gA[1]);
    ctx.lineTo(gB[0], gB[1]);
    ctx.lineTo(gC[0], gC[1]);
    ctx.lineTo(gD[0], gD[1]);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    const pA: Vec3 = [-0.95, -0.95, 0];
    const pB: Vec3 = [0.95, -0.95, 0];
    const pC: Vec3 = [0.95, 0.95, cornerHeight];
    const pD: Vec3 = [-0.95, 0.95, 0];

    const sA = proj(pA);
    const sB = proj(pB);
    const sC = proj(pC);
    const sD = proj(pD);

    // 垂直高度标尺虚线
    const sCFloor = proj([0.95, 0.95, 0]);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(sCFloor[0], sCFloor[1]);
    ctx.lineTo(sC[0], sC[1]);
    ctx.stroke();
    ctx.setLineDash([]);

    const L = norm3([-0.4, -0.5, 0.78]);

    const drawNormalNeedle = (center3: Vec3, n3: Vec3, color: string, label: string) => {
      const start = proj(center3);
      const end = proj([
        center3[0] + n3[0] * 0.62,
        center3[1] + n3[1] * 0.62,
        center3[2] + n3[2] * 0.62,
      ]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(start[0], start[1]);
      ctx.lineTo(end[0], end[1]);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(end[0], end[1], 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(label, end[0] + 6, end[1] - 4);
    };

    if (quadSplit === 'tri') {
      // 对角线 A-C 切成两个绝对平面的三角形：T1(A, B, C) 与 T2(A, C, D)
      const n1 = norm3(cross3(sub3(pB, pA), sub3(pC, pA)));
      const n2 = norm3(cross3(sub3(pC, pA), sub3(pD, pA)));

      const lit1 = clamp(dot3(n1, L) * 0.7 + 0.28, 0.15, 1);
      const lit2 = clamp(dot3(n2, L) * 0.7 + 0.28, 0.15, 1);

      ctx.fillStyle = `rgb(${Math.round(55 * lit1)}, ${Math.round(185 * lit1)}, ${Math.round(135 * lit1)})`;
      ctx.beginPath();
      ctx.moveTo(sA[0], sA[1]);
      ctx.lineTo(sB[0], sB[1]);
      ctx.lineTo(sC[0], sC[1]);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = `rgb(${Math.round(65 * lit2)}, ${Math.round(165 * lit2)}, ${Math.round(220 * lit2)})`;
      ctx.beginPath();
      ctx.moveTo(sA[0], sA[1]);
      ctx.lineTo(sC[0], sC[1]);
      ctx.lineTo(sD[0], sD[1]);
      ctx.closePath();
      ctx.fill();

      // 边框与对角线切割缝
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sA[0], sA[1]);
      ctx.lineTo(sB[0], sB[1]);
      ctx.lineTo(sC[0], sC[1]);
      ctx.lineTo(sD[0], sD[1]);
      ctx.closePath();
      ctx.stroke();

      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(sA[0], sA[1]);
      ctx.lineTo(sC[0], sC[1]);
      ctx.stroke();

      // 各自稳稳立着一根蓝色法线小牙签
      const c1: Vec3 = [(pA[0] + pB[0] + pC[0]) / 3, (pA[1] + pB[1] + pC[1]) / 3, (pA[2] + pB[2] + pC[2]) / 3];
      const c2: Vec3 = [(pA[0] + pC[0] + pD[0]) / 3, (pA[1] + pC[1] + pD[1]) / 3, (pA[2] + pC[2] + pD[2]) / 3];
      drawNormalNeedle(c1, n1, '#38bdf8', '法线 N1');
      drawNormalNeedle(c2, n2, '#60a5fa', '法线 N2');
    } else {
      // 硬当成单个四边形：扭曲马鞍面 + 法线朝向冲突报警
      ctx.fillStyle = isQuadBroken ? 'rgba(239, 68, 68, 0.34)' : 'rgba(52, 211, 153, 0.45)';
      ctx.beginPath();
      ctx.moveTo(sA[0], sA[1]);
      ctx.lineTo(sB[0], sB[1]);
      ctx.lineTo(sC[0], sC[1]);
      ctx.lineTo(sD[0], sD[1]);
      ctx.closePath();
      ctx.fill();

      // 画出内部扭曲网格线表示弯曲不定
      ctx.strokeStyle = isQuadBroken ? '#fca5a5' : '#cbd5e1';
      ctx.lineWidth = 1.2;
      for (let k = 1; k <= 3; k++) {
        const t = k / 4;
        const pLeft: Vec3 = lerp3(pA, pD, t);
        const pRight: Vec3 = lerp3(pB, pC, t);
        const sL = proj(pLeft);
        const sR = proj(pRight);
        ctx.beginPath();
        ctx.moveTo(sL[0], sL[1]);
        ctx.lineTo(sR[0], sR[1]);
        ctx.stroke();
      }

      ctx.strokeStyle = isQuadBroken ? '#ef4444' : '#f8fafc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sA[0], sA[1]);
      ctx.lineTo(sB[0], sB[1]);
      ctx.lineTo(sC[0], sC[1]);
      ctx.lineTo(sD[0], sD[1]);
      ctx.closePath();
      ctx.stroke();

      const centerQ: Vec3 = [0, 0, cornerHeight * 0.25];
      if (isQuadBroken) {
        drawNormalNeedle(centerQ, norm3([-0.38, -0.25, 0.88]), '#f87171', '？歪左');
        drawNormalNeedle(centerQ, norm3([0.28, -0.45, 0.85]), '#fb923c', '？歪右');
      } else {
        drawNormalNeedle(centerQ, [0, 0, 1], '#38bdf8', '法线 N');
      }
    }

    // 四个顶点钉子圆点
    const drawPin = (pt: [number, number], name: string, active = false) => {
      ctx.fillStyle = active ? '#fbbf24' : '#f8fafc';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], active ? 6.5 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = active ? '#fde047' : '#cbd5e1';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(name, pt[0] - 14, pt[1] - 9);
    };
    drawPin(sA, 'A');
    drawPin(sB, 'B');
    drawPin(sC, `C (高 ${cornerHeight.toFixed(2)})`, true);
    drawPin(sD, 'D');

    ctx.fillStyle = isQuadBroken ? '#fca5a5' : '#bbf7d0';
    ctx.font = '600 11.5px sans-serif';
    ctx.fillText(
      isQuadBroken
        ? '⚠️ 4 个钉子一掰就弯折，显卡根本算不出唯一平面朝向！'
        : '✅ 三条腿板凳永不晃：任意 3 个顶点永远锁死在唯一平面！',
      12,
      H - 12
    );
  }, [cornerHeight, quadSplit, isQuadBroken, quadFit]);

  // 绘制右舱：可 360° 旋转的 3D 刺猬法线小牙签透视镜
  useEffect(() => {
    const canvas = meshCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#13161f';
    ctx.fillRect(0, 0, W, H);

    const scale = meshKind === 'sphere' ? 68 : 64;
    const L = norm3([0.45, 0.65, 0.61]);

    interface ProjectedTri {
      p0: Vec3;
      p1: Vec3;
      p2: Vec3;
      center: Vec3;
      normal: Vec3;
      depth: number;
      backfacing: boolean;
    }

    const projected: ProjectedTri[] = [];
    for (const tri of activeTris) {
      const r0 = meshKind === 'triangle' ? tri.v0 : rotateYawPitch(tri.v0, rot.yaw, rot.pitch);
      const r1 = meshKind === 'triangle' ? tri.v1 : rotateYawPitch(tri.v1, rot.yaw, rot.pitch);
      const r2 = meshKind === 'triangle' ? tri.v2 : rotateYawPitch(tri.v2, rot.yaw, rot.pitch);

      const faceNormal = norm3(cross3(sub3(r1, r0), sub3(r2, r0)));
      let n = faceNormal;
      if (flippedPitfall) {
        n = [-n[0], -n[1], -n[2]];
      }
      const center: Vec3 = [
        (r0[0] + r1[0] + r2[0]) / 3,
        (r0[1] + r1[1] + r2[1]) / 3,
        (r0[2] + r1[2] + r2[2]) / 3,
      ];
      // 在固定正交相机下，交换两顶点会改变投影有向面积的符号。
      const backfacing = (reverseWinding ? -faceNormal[2] : faceNormal[2]) <= 0;
      projected.push({
        p0: r0,
        p1: reverseWinding ? r2 : r1,
        p2: reverseWinding ? r1 : r2,
        center,
        normal: n,
        depth: center[2],
        backfacing,
      });
    }

    // 画家算法从远到近排序
    projected.sort((a, b) => a.depth - b.depth);

    const toScreen = (v: Vec3): [number, number] => [
      W * 0.5 + v[0] * scale,
      H * 0.52 - v[1] * scale,
    ];

    for (const item of projected) {
      // 根据投影绕序剔除，然后用独立的着色法线计算亮度。
      if (item.backfacing) continue;

      const s0 = toScreen(item.p0);
      const s1 = toScreen(item.p1);
      const s2 = toScreen(item.p2);

      const ndotl = Math.max(0, dot3(item.normal, L));
      const base: Vec3 =
        meshKind === 'sphere' ? [0.24, 0.68, 0.88] : [0.88, 0.68, 0.25];
      const shade = ndotl * 0.82 + 0.18;
      const cr = Math.round(clamp(base[0] * shade) * 255);
      const cg = Math.round(clamp(base[1] * shade) * 255);
      const cb = Math.round(clamp(base[2] * shade) * 255);

      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.beginPath();
      ctx.moveTo(s0[0], s0[1]);
      ctx.lineTo(s1[0], s1[1]);
      ctx.lineTo(s2[0], s2[1]);
      ctx.closePath();
      ctx.fill();

      if (showWire) {
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.38)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // 第二遍绘制所有朝前或扎反的“法线小牙签”，保证针尖清晰可见
    if (showNormals) {
      const needleLen = 0.28;
      for (const item of projected) {
        // 只画上半圈可见附近的牙签避免过密重叠
        if (item.backfacing) continue;

        const cScr = toScreen(item.center);
        const tip3: Vec3 = [
          item.center[0] + item.normal[0] * needleLen,
          item.center[1] + item.normal[1] * needleLen,
          item.center[2] + item.normal[2] * needleLen,
        ];
        const tScr = toScreen(tip3);

        ctx.strokeStyle = flippedPitfall ? '#f87171' : '#38bdf8';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(cScr[0], cScr[1]);
        ctx.lineTo(tScr[0], tScr[1]);
        ctx.stroke();

        ctx.fillStyle = flippedPitfall ? '#fca5a5' : '#bae6fd';
        ctx.beginPath();
        ctx.arc(tScr[0], tScr[1], 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = flippedPitfall ? '#fca5a5' : '#93c5fd';
    ctx.font = '600 11.5px sans-serif';
    ctx.fillText(
      `绕序${reverseWinding ? '反转' : '原始'} · 着色法线${flippedPitfall ? '反转' : '原始'} · 可见三角形 ${projected.filter(face => !face.backfacing).length}`,
      12,
      H - 12
    );
  }, [activeTris, meshKind, rot, showNormals, showWire, flippedPitfall, reverseWinding, meshFit]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={flippedPitfall}
          pitfallLabel="仅翻转着色法线，观察同一表面的明暗"
          correctLabel="所有法线小牙签垂直朝外：模型饱满闭合、受光自然立体"
          onToggle={setFlippedPitfall}
        />
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(265px, 1fr))',
          gap: 10,
        }}
      >
        {/* 左：掰弯四边形实验 */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '7px 11px',
              borderBottom: '1px solid var(--border-soft)',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <span>📐 实验一：掰弯四边形（为什么显卡只认三角形）</span>
          </div>
          <canvas
            ref={quadCanvasRef}
            width={340}
            height={224}
            style={{ width: '100%', height: 224, display: 'block' }}
          />
        </div>

        {/* 右：3D 刺猬法线小牙签透视仪 */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '7px 11px',
              borderBottom: '1px solid var(--border-soft)',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <span>🦔 实验二：3D 刺猬法线透视镜（按住拖动旋转！）</span>
          </div>
          <canvas
            ref={meshCanvasRef}
            width={340}
            height={224}
            style={{
              width: '100%',
              height: 224,
              display: 'block',
              cursor: draggingMesh ? 'grabbing' : 'grab',
              touchAction: 'none',
            }}
            onMouseDown={(e) => setDraggingMesh({ x: e.clientX, y: e.clientY })}
            onMouseMove={(e) => {
              if (!draggingMesh) return;
              const dx = e.clientX - draggingMesh.x;
              const dy = e.clientY - draggingMesh.y;
              setDraggingMesh({ x: e.clientX, y: e.clientY });
              setRot((prev) => ({
                yaw: prev.yaw + dx * 0.012,
                pitch: clamp(prev.pitch + dy * 0.012, -1.1, 1.1),
              }));
            }}
            onMouseUp={() => setDraggingMesh(null)}
            onMouseLeave={() => setDraggingMesh(null)}
            onTouchStart={(e) => {
              if (e.touches[0]) setDraggingMesh({ x: e.touches[0].clientX, y: e.touches[0].clientY });
            }}
            onTouchMove={(e) => {
              if (!draggingMesh || !e.touches[0]) return;
              const dx = e.touches[0].clientX - draggingMesh.x;
              const dy = e.touches[0].clientY - draggingMesh.y;
              setDraggingMesh({ x: e.touches[0].clientX, y: e.touches[0].clientY });
              setRot((prev) => ({
                yaw: prev.yaw + dx * 0.012,
                pitch: clamp(prev.pitch + dy * 0.012, -1.1, 1.1),
              }));
            }}
            onTouchEnd={() => setDraggingMesh(null)}
          />
        </div>
      </div>

      {/* 控制面板 */}
      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSlider
            label="上下掰动右上角 C 钉子高度"
            value={cornerHeight}
            min={-0.95}
            max={0.95}
            step={0.05}
            onChange={setCornerHeight}
          />

          <StageSegmented<'tri' | 'quad'>
            label="四边形切分方式"
            value={quadSplit}
            options={[
              { value: 'tri', label: '✅ 切成 2 个三角形' },
              { value: 'quad', label: '❌ 硬当 1 个四边形' },
            ]}
            onChange={setQuadSplit}
          />

          <StageSegmented<'sphere' | 'sword' | 'triangle'>
            label="右侧 3D 模型切换"
            value={meshKind}
            options={[
              { value: 'sphere', label: '🌐 多面体圆球' },
              { value: 'sword', label: '🗡️ 棱角宝石剑' },
              { value: 'triangle', label: '单三角形对照' },
            ]}
            onChange={setMeshKind}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <StageToggle
            label="显示法线小牙签 (Normals)"
            checked={showNormals}
            onChange={setShowNormals}
          />
          <StageToggle
            label="显示三角形网格线"
            checked={showWire}
            onChange={setShowWire}
          />
          <StageToggle
            label="翻转着色法线（改变光照）"
            checked={flippedPitfall}
            onChange={setFlippedPitfall}
          />
          <StageToggle label="翻转顶点绕序（交换 B、C）" checked={reverseWinding} onChange={setReverseWinding} />
        </div>
      </div>
    </div>
  );
};

const lesson1_3: LessonDefinition = {
  id: 'mesh-triangle-normal',
  moduleId: '01',
  number: '1.3',
  title: '3D 模型的骨架与朝向 —— 顶点、为什么全是三角形、以及“法线小牙签”',
  subtitle: '切开游戏里的宝剑竟然全是空心纸壳！掰弯四边形实验，秒懂最重要的“法线”',
  duration: '10 分钟',
  difficulty: '零基础',
  steps: [
    {
      stepNumber: 1,
      shortLabel: '空心纸壳秘密',
      tag: 'phenomenon',
      title: '切开游戏里威风凛凛的巨龙和宝剑，肚子里面装的是什么？',
      paragraphs: [
        '如果拿一把虚拟电锯把游戏里的石头、角色或宝剑劈成两半，你会惊讶地发现：**里面一滴血肉和钢铁都没有，100% 是空心的薄纸壳**！',
        '无论多么逼真的次时代模型，拆到底只由三个极简零件拼成：① 空间里的定位钉子叫 **顶点（Vertex）**；② 三个钉子连起来蒙上一层纸叫 **三角形面（Triangle）**；③ 插在每张纸正中心的一根隐形方向针——**法线（Normal）**。',
      ],
      tryItPrompt:
        '按住右侧实验舱里的圆球或切换成【🗡️ 棱角宝石剑】上下左右拖动旋转，观察整把宝剑是如何由一块块空心三角形薄片拼出来的！',
    },
    {
      stepNumber: 2,
      shortLabel: '三脚凳与牙签',
      tag: 'background',
      title: '为什么全世界显卡死活只认三角形？什么叫“法线小牙签”？',
      paragraphs: [
        '你一定纳闷：用正方形拼地板不是更整齐吗，为什么显卡非要把所有模型全切成三角形？想想农村的**三条腿板凳 vs 四条腿方桌**就全懂了：空间里任意 3 个点**永远在同一个平整平面上**，绝不会晃；而 4 个点只要把其中一个角往上掰一点点，纸片就弯折了——显卡当场懵圈：“这到底是往左歪还是往右歪？”',
        '那什么又是吓退无数新手的 **法线（Normal）** 呢？把它翻译成人话就是：**垂直插在每个三角形面（或顶点）正中心、笔直朝外指的一根蓝色隐形小牙签**！它的唯一使命就是向太阳汇报：“报告太阳！我这张脸正朝着这个方向！”',
      ],
      tryItPrompt:
        '在左侧实验舱把切分方式切到【❌ 硬当 1 个四边形】并拉动「掰动右上角 C 钉子高度」，看它如何瞬间扭曲报警；再切回【✅ 切成 2 个三角形】看两根蓝色小牙签稳稳立住！',
      callout: {
        tone: 'tip',
        title: '记住“小牙签”比喻，后面十章全通了！',
        body: '以后在课程里只要看到「法线 Normal」，脑海里立刻浮现那根垂直扎在物体表皮朝外指的小牙签：牙签正对太阳最亮，侧对太阳变暗，背对太阳全黑！',
      },
    },
    {
      stepNumber: 3,
      shortLabel: '刺猬透视镜',
      tag: 'experiment',
      title: '给模型插满刺猬小牙签，亲手验证“朝向决定明暗”',
      paragraphs: [
        '现在把目光移向右侧的 3D 透视镜：像小刺猬一样密密麻麻竖立的浅蓝色细针，就是每个三角形面真实的 **`法线 Normal`**！',
        '当你按住鼠标慢慢旋转圆球或宝石剑时，请重点盯住右上角阳光照过来的位置：凡是**蓝色小牙签正指着右上角太阳**的那几块三角形，颜色最明亮；牙签指往侧边和下方的三角形，则自然暗下去。没有这根小牙签，显卡连哪里受光、哪里背光都算不出来！',
      ],
      tryItPrompt:
        '开关底部的【显示法线小牙签】按钮并拖动旋转宝石剑，观察每当一块剑面转到正对阳光时，它的蓝色小牙签指向哪里！',
    },
    {
      stepNumber: 4,
      shortLabel: '走进UE 5.8',
      tag: 'ue5',
      title: '走进 UE 5.8：为什么钻进石头肚子里往外看，石头竟然消失了？',
      paragraphs: [
        '默认单面材质会做背面剔除。光栅器检查三角形投影后的顶点绕序，交换两个索引就会调换正反面。着色法线决定光照方向。',
        '从内部看封闭单面网格，朝外的面会被剔除。薄叶片、披风若需要两面可见，可在材质 Details 中启用 Two Sided。',
      ],
      tryItPrompt:
        '点击右上角切到【原理图】视图，追踪顶点绕序与着色法线分别在哪一步生效。',
      callout: {
        tone: 'ue58',
        title: 'UE 5.8 常用法线节点预告',
        body: '`VertexNormalWS` 读取模型自带的骨架小牙签；而 `PixelNormalWS` 则连同后面要学的“法线贴图凹凸细节”一起读出来，做积雪和边缘光最常用它！',
      },
    },
    {
      stepNumber: 5,
      shortLabel: '法线反了大坑',
      tag: 'pitfall',
      title: '防坑口诀：导入模型破洞隐身或莫名全黑？分别检查绕序和着色法线',
      paragraphs: [
        '新手从 Blender 或 Maya 导出模型进 UE 5.8 时，十个人里有八个遇到过这种灵异事件：明明建模软件里好好的盔甲，一进虚幻引擎，正面整块消失露出了后背内壁，或者打光怎么照都是死黑的！',
        '选“单三角形对照”。保持相机与光源固定，只翻转着色法线，图形仍在但亮度改变。再还原法线、只翻转绕序，同一三角形被剔除。遇到破面查索引绕序，形状完整而明暗异常时查顶点法线、切线和法线图。',
      ],
      tryItPrompt:
        '让两个开关各取开、关两种状态，记录四次可见三角形数。原始绕序应为 1，反转绕序应为 0。',
      callout: {
        tone: 'warn',
        title: '一句话防坑口诀',
        body: '“三点成平面，牙签朝外站；单面省算力，破洞查反面！”',
      },
    },
  ],
  takeaways: [
    '3D 模型内部是空心的，显卡底层一律将网格切分为三角形，因为任意三点永远共面不扭曲',
    '法线（Normal）就是垂直插在每个表面朝外指的“隐形小牙签”，专门用来计算受光角度与反射方向',
    '引擎默认开启“背面剔除”按投影绕序保留正面；薄树叶或披风需在材质中勾选 Two Sided（双面）',
    '模型导入引擎后若出现正面透明破洞或光照死黑，分别检查三角形绕序与着色法线',
  ],
  schematic: {
    "title": "单面三角形的两次判断",
    "caption": "渲染流程示意。先在屏幕投影中按顶点绕序判定正反面，对保留的片元用着色法线计算光照。",
    "nodes": [
      {
        "id": "tri",
        "title": "网格顶点索引",
        "category": "pipeline",
        "x": 20,
        "y": 40,
        "width": 167,
        "outputs": [
          {
            "id": "p0",
            "label": "顶点顺序",
            "color": "#38bdf8"
          }
        ]
      },
      {
        "id": "cull",
        "title": "光栅化",
        "category": "pipeline",
        "x": 251,
        "y": 40,
        "width": 167,
        "inputs": [
          {
            "id": "p0",
            "label": "投影绕序",
            "color": "#38bdf8"
          }
        ],
        "outputs": [
          {
            "id": "p0",
            "label": "保留的片元",
            "color": "#38bdf8"
          }
        ],
        "note": "单面材质剔除背面"
      },
      {
        "id": "normal",
        "title": "网格着色法线",
        "category": "input",
        "x": 251,
        "y": 196,
        "width": 167,
        "outputs": [
          {
            "id": "p0",
            "label": "法线方向",
            "color": "#38bdf8"
          }
        ],
        "note": "随网格提供并插值到像素"
      },
      {
        "id": "light",
        "title": "像素着色",
        "category": "pipeline",
        "x": 521,
        "y": 100,
        "width": 167,
        "inputs": [
          {
            "id": "p0",
            "label": "片元",
            "color": "#38bdf8"
          },
          {
            "id": "p1",
            "label": "着色法线",
            "color": "#38bdf8"
          }
        ],
        "note": "同一片元可因法线变化呈现不同明暗"
      }
    ],
    "edges": [
      {
        "fromNode": "tri",
        "fromPin": "p0",
        "toNode": "cull",
        "toPin": "p0",
        "color": "#38bdf8"
      },
      {
        "fromNode": "cull",
        "fromPin": "p0",
        "toNode": "light",
        "toPin": "p0",
        "color": "#38bdf8"
      },
      {
        "fromNode": "normal",
        "fromPin": "p0",
        "toNode": "light",
        "toPin": "p1",
        "color": "#38bdf8"
      }
    ]
  },
  StageComponent: MeshTriangleNormalStage,
};

// ============================================================================
// 模块 01 · 第 1.4 课：翻跟头武术木偶 + 四大空间坐标系切换透视仪
// ============================================================================

type CoordSpaceKey = 'world' | 'local' | 'tangent' | 'screen';

const SPACE_META: Record<
  CoordSpaceKey,
  { label: string; originDesc: string; blueZDesc: string; usage: string }
> = {
  world: {
    label: '🌍 世界空间',
    originDesc: '原点钉死在舞台大地中心',
    blueZDesc: '蓝 +Z 永远笔直指着头顶天空，雷打不动！',
    usage: '典型用途：石头顶面自动落白雪、大世界水位高度线',
  },
  local: {
    label: '🤖 局部空间',
    originDesc: '原点钉在木偶自己的肚脐眼上',
    blueZDesc: '蓝 +Z 顺着木偶脊椎指头顶，木偶倒立它也跟着倒立！',
    usage: '典型用途：角色从脚底到头顶发光扫描、固定在身上的腰带花纹',
  },
  tangent: {
    label: '🩹 切线空间',
    originDesc: '贴在木偶右肩皮肤上的“小创可贴”',
    blueZDesc: '不管胳膊怎么挥，蓝 +Z 永远垂直皮肤笔直朝外指！',
    usage: '典型用途：法线贴图（Normal Map）！让凹凸皮肤跟着怪兽跑跳不穿帮',
  },
  screen: {
    label: '📷 屏幕空间',
    originDesc: '摄像机扁平取景玻璃左上角 (0, 0)',
    blueZDesc: '只看镜头画面左→右 U、上→下 V，不管 3D 怎么转',
    usage: '典型用途：全屏赛博扫描线、狙击镜准星、水下屏幕扭曲',
  },
};

const FourCoordinateSpacesStage: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [space, setSpace] = useState<CoordSpaceKey>('world');
  const [bodyTiltDeg, setBodyTiltDeg] = useState<number>(28);
  const [armSwingDeg, setArmSwingDeg] = useState<number>(45);
  const [autoPlay, setAutoPlay] = useState<boolean>(false);
  const [snowTest, setSnowTest] = useState<boolean>(false);
  const [snowPitfallLocal, setSnowPitfallLocal] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasFit = useAutoFitCanvas(canvasRef);

  useEffect(() => {
    if (resetSignal > 0) {
      setSpace('world');
      setBodyTiltDeg(28);
      setArmSwingDeg(45);
      setAutoPlay(false);
      setSnowTest(false);
      setSnowPitfallLocal(false);
    }
  }, [resetSignal]);

  // 自动挥手翻滚演示动画
  useEffect(() => {
    if (!autoPlay) return;
    let rafId = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const sec = (now - t0) / 1000;
      setBodyTiltDeg(Math.round(Math.sin(sec * 1.1) * 135));
      setArmSwingDeg(Math.round(Math.sin(sec * 2.4) * 75 + 15));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [autoPlay]);

  const meta = SPACE_META[space];
  const headWorldZ = Math.cos(bodyTiltDeg * Math.PI / 180);
  const snowWeight = saturate(snowPitfallLocal ? 1 : headWorldZ);
  const headGray = lerp(0.2, 0.9, snowWeight);

  useEffect(() => {
    onKpiUpdate([
      {
        label: '当前观察参考系',
        value: meta.label,
        sub: meta.originDesc,
        tone: 'accent',
      },
      {
        label: '头顶采样点 · 积雪权重',
        value: `${snowWeight.toFixed(2)} → 灰度 ${headGray.toFixed(2)}`,
        sub: `世界法线 Z = ${headWorldZ.toFixed(2)}，${snowPitfallLocal ? '误用局部 Z = 1' : '权重 = Saturate(Z)'}`,
        tone: 'neutral',
      },
      {
        label: '蓝色 +Z 轴当前指向',
        value:
          space === 'world'
            ? '正上方天空 (0°)'
            : space === 'local'
            ? `随脊椎偏转 (${bodyTiltDeg}°)`
            : space === 'tangent'
            ? `垂直肩膀皮肤朝外`
            : '指向镜头外 (平面UV)',
        sub: snowPitfallLocal ? '⚠️ 局部积雪踩坑：倒立时雪贴在头顶朝地！' : '✅ 坐标定义清晰',
        tone: snowPitfallLocal ? 'bad' : 'good',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, bodyTiltDeg, armSwingDeg, snowPitfallLocal]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // 舞台夜空渐变背景
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#101624');
    bg.addColorStop(1, '#1c2436');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 舞台木地板（世界地面）
    const floorY = H - 36;
    ctx.fillStyle = '#292524';
    ctx.fillRect(0, floorY, W, 36);
    ctx.strokeStyle = '#78716c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, floorY);
    ctx.lineTo(W, floorY);
    ctx.stroke();

    // 绘制带箭头的坐标轴通用函数（画布上 2D 直观呈现：红 +X，蓝 +Z 向上/法向，绿 +Y 斜向透视）
    const drawTriad = (
      ox: number,
      oy: number,
      upAngleRad: number, // +Z 轴在屏幕上的角度（0 代表正朝上）
      len: number,
      tagPrefix: string
    ) => {
      // 蓝 +Z 轴（沿 upAngleRad 朝上偏转）
      const zx = ox + Math.sin(upAngleRad) * len;
      const zy = oy - Math.cos(upAngleRad) * len;

      // 红 +X 轴（与 +Z 顺时针垂直）
      const xx = ox + Math.cos(upAngleRad) * len;
      const xy = oy + Math.sin(upAngleRad) * len;

      // 绿 +Y 轴（透视斜前 45 度示意第 3 维）
      const yAngle = upAngleRad + Math.PI * 0.72;
      const yx = ox + Math.sin(yAngle) * (len * 0.68);
      const yy = oy - Math.cos(yAngle) * (len * 0.68);

      const arrow = (tx: number, ty: number, col: string, text: string) => {
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        const ang = Math.atan2(ty - oy, tx - ox);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - 9 * Math.cos(ang - 0.45), ty - 9 * Math.sin(ang - 0.45));
        ctx.lineTo(tx - 9 * Math.cos(ang + 0.45), ty - 9 * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();

        ctx.font = 'bold 11.5px sans-serif';
        ctx.fillText(text, tx + Math.cos(ang) * 10 - 12, ty + Math.sin(ang) * 10 + 4);
      };

      arrow(yx, yy, '#22c55e', '绿+Y');
      arrow(xx, xy, '#ef4444', '红+X');
      arrow(zx, zy, '#38bdf8', `${tagPrefix}蓝+Z`);

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ox, oy, 4.5, 0, Math.PI * 2);
      ctx.fill();
    };

    const puppetX = W * 0.44;
    const puppetY = H * 0.54;
    const bodyRad = (bodyTiltDeg * Math.PI) / 180;
    const armRelRad = (armSwingDeg * Math.PI) / 180;

    // 1. 绘制武术木偶身体
    ctx.save();
    ctx.translate(puppetX, puppetY);
    ctx.rotate(bodyRad);

    // 双腿
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-11, 28);
    ctx.lineTo(-20, 72);
    ctx.moveTo(11, 28);
    ctx.lineTo(20, 72);
    ctx.stroke();

    // 左臂（平衡摆手）
    ctx.beginPath();
    ctx.moveTo(-22, -22);
    ctx.lineTo(-54, -4);
    ctx.stroke();

    // 躯干木偶胸甲
    ctx.fillStyle = '#475569';
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-22, -32, 44, 62, 10);
    ctx.fill();
    ctx.stroke();

    // 肚脐眼原点小圆标
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(0, 6, 4, 0, Math.PI * 2);
    ctx.fill();

    // 木偶圆脑袋 + 练功发带
    ctx.fillStyle = '#f1f5f9';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -52, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-18, -59, 36, 6);

    // Draw each sample in head-local coordinates; both modes use the same pose and inputs.
    if (snowTest || stepIndex === 4) {
      const segments = 72;
      for (let i = 0; i < segments; i++) {
        const angle = (i + 0.5) * 2 * Math.PI / segments;
        const normalZ = -Math.sin(angle + (snowPitfallLocal ? 0 : bodyRad));
        const gray = Math.round(255 * lerp(0.2, 0.9, saturate(normalZ)));
        ctx.strokeStyle = `rgb(${gray} ${gray} ${gray})`;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(0, -52, 19, angle - Math.PI / segments, angle + Math.PI / segments);
        ctx.stroke();
      }
    }

    // 右肩关节与挥舞右臂（贴着切线空间“小创可贴”！）
    ctx.save();
    ctx.translate(22, -22);
    // 让右臂往右侧抬挥：0° 水平向右，正角度往上挥，负角度往下摆
    ctx.rotate(-armRelRad);

    // 手臂主体
    ctx.fillStyle = '#64748b';
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(0, -8, 66, 16, 8);
    ctx.fill();
    ctx.stroke();

    // 贴在手臂外侧表皮上的米黄色「小创可贴 Band-Aid」
    ctx.fillStyle = '#fde68a';
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(20, -13, 26, 7, 3);
    ctx.fill();
    ctx.stroke();

    // 创可贴上的凸起小痦子/铆钉（朝皮肤外 +Z 鼓起）
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(33, -15, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // 结束右臂
    ctx.restore(); // 结束木偶身体

    if (snowTest || stepIndex === 4) {
      // 飘落雪花点缀
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 18; i++) {
        const sx = ((i * 53 + 17) % (W - 30)) + 15;
        const sy = ((i * 37 + 11) % (floorY - 30)) + 15;
        ctx.beginPath();
        ctx.arc(sx, sy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 2. 根据当前选中的空间绘制对应坐标轴与高亮说明
    if (space === 'world') {
      // 世界网格背景线（永远横平竖直）
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.lineWidth = 1;
      for (let x = 40; x < W; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, floorY);
        ctx.stroke();
      }
      drawTriad(84, floorY - 6, 0, 66, '世界 ');
    } else if (space === 'local') {
      // 原点在木偶肚脐，随 bodyRad 同步倾斜
      const navelX = puppetX - Math.sin(bodyRad) * 6;
      const navelY = puppetY + Math.cos(bodyRad) * 6;
      drawTriad(navelX, navelY, bodyRad, 66, '局部 ');
    } else if (space === 'tangent') {
      // 计算右臂上创可贴在屏幕上的精确世界位置与外法向角度
      // 局部肩膀偏移 (22, -22)，再沿旋转后右臂走 (33, -13)
      const shX = 22;
      const shY = -22;
      const armWorldAngle = bodyRad - armRelRad; // 右臂向右方向角度
      const shoulderWX = puppetX + shX * Math.cos(bodyRad) - shY * Math.sin(bodyRad);
      const shoulderWY = puppetY + shX * Math.sin(bodyRad) + shY * Math.cos(bodyRad);
      const patchWX = shoulderWX + 33 * Math.cos(armWorldAngle) - -13 * Math.sin(armWorldAngle);
      const patchWY = shoulderWY + 33 * Math.sin(armWorldAngle) + -13 * Math.cos(armWorldAngle);

      // 创可贴的蓝 +Z 永远垂直手臂表皮朝外（即 armWorldAngle）
      drawTriad(patchWX, patchWY, armWorldAngle, 58, '皮肤外 ');

      // 右上角创可贴特写气泡框
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(W - 196, 12, 184, 68, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 11.5px sans-serif';
      ctx.fillText('🩹 切线空间 = 肩膀小创可贴', W - 186, 31);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '11px sans-serif';
      ctx.fillText('不管身体怎么翻、胳膊怎么挥，', W - 186, 49);
      ctx.fillText('蓝 +Z 永远垂直皮肤往外鼓！', W - 186, 66);
    } else if (space === 'screen') {
      // 摄像机扁平取景框 UV 网格覆层
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 2;
      ctx.strokeRect(18, 16, W - 36, H - 32);

      ctx.strokeStyle = 'rgba(244, 114, 182, 0.28)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const gx = 18 + ((W - 36) * i) / 4;
        const gy = 16 + ((H - 32) * i) / 4;
        ctx.beginPath();
        ctx.moveTo(gx, 16);
        ctx.lineTo(gx, H - 16);
        ctx.moveTo(18, gy);
        ctx.lineTo(W - 18, gy);
        ctx.stroke();
      }

      ctx.fillStyle = '#fbcfe8';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('📷 左上 (0, 0)', 26, 34);
      ctx.fillText('U 向右 →', W * 0.46, 34);
      ctx.fillText('↓ V 向下', 26, H * 0.5);
      ctx.fillText('右下 (1, 1)', W - 98, H - 24);
    }

    // 左下角当前空间一句话说明条
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(10, H - 31, W - 20, 24);
    ctx.fillStyle = '#bae6fd';
    ctx.font = '600 11.5px sans-serif';
    ctx.fillText(`${meta.label}：${meta.blueZDesc}`, 18, H - 15);
  }, [space, bodyTiltDeg, armSwingDeg, meta, snowTest, snowPitfallLocal, stepIndex, canvasFit]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={snowPitfallLocal}
          pitfallLabel="误用「局部空间 +Z」做积雪：木偶倒立翻跟头时，白雪竟然违反重力粘在朝地的头顶！"
          correctLabel="用「世界空间 +Z」做积雪：不管木偶怎么倒立翻滚，按各处世界法线的朝上分量混合雪色"
          onToggle={(p) => {
            setSnowPitfallLocal(p);
            setSnowTest(true);

          }}
        />
      )}

      <div
        style={{
          background: 'var(--bg-card)',
          border: '1.5px solid var(--border-strong)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '7px 12px',
            borderBottom: '1px solid var(--border-soft)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 12,
            fontWeight: 700,
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          <span>🎭 舞台翻跟头木偶 · 四大参考系实时透视仪</span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{meta.usage}</span>
        </div>
        <canvas
          ref={canvasRef}
          width={640}
          height={246}
          style={{ width: '100%', height: 246, display: 'block' }}
        />
      </div>

      <div className="stage-controls-panel">
        <StageSegmented<CoordSpaceKey>
          label="一键切换四大空间参考系（重点看蓝色 +Z 轴跟谁走！）"
          value={space}
          options={[
            { value: 'world', label: '🌍 世界空间 (+Z永远朝天)' },
            { value: 'local', label: '🤖 局部空间 (随身体肚脐转)' },
            { value: 'tangent', label: '🩹 切线空间 (肩膀小创可贴)' },
            { value: 'screen', label: '📷 屏幕空间 (镜头取景框)' },
          ]}
          onChange={setSpace}
        />

        <div>头顶采样点 · 岩石 0.20 与雪 0.90 的线性混合
          <span style={{ display: 'inline-block', width: 28, height: 14, margin: '0 8px', backgroundColor: `rgb(${Math.round(headGray * 255)} ${Math.round(headGray * 255)} ${Math.round(headGray * 255)})` }} />
          世界 Z {headWorldZ.toFixed(2)} · 权重 {snowWeight.toFixed(2)} · 灰度 {headGray.toFixed(2)}
        </div>
        <div className="control-grid">
          <StageSlider
            label="木偶身体翻滚角（拉到 180° 观察朝下权重）"
            value={bodyTiltDeg}
            min={-180}
            max={180}
            step={1}
            unit="°"
            onChange={(v) => {
              setAutoPlay(false);
              setBodyTiltDeg(v);
            }}
          />

          <StageSlider
            label="挥舞右臂角度（看肩膀创可贴！）"
            value={armSwingDeg}
            min={-75}
            max={105}
            step={1}
            unit="°"
            onChange={(v) => {
              setAutoPlay(false);
              setArmSwingDeg(v);
            }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <StageToggle
            label="🎬 自动挥手翻跟头演示"
            checked={autoPlay}
            onChange={setAutoPlay}
          />
          <StageToggle
            label="❄️ 开启头顶积雪实验"
            checked={snowTest}
            onChange={setSnowTest}
          />
          {snowTest && (
            <StageToggle
              label="踩坑：错拿局部空间算积雪"
              checked={snowPitfallLocal}
              onChange={(p) => {
                setSnowPitfallLocal(p);

              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const lesson1_4: LessonDefinition = {
  id: 'four-coordinate-spaces',
  moduleId: '01',
  number: '1.4',
  title: '3D 世界的四个“参考系” —— 世界、局部、切线与屏幕空间大白话指南',
  subtitle: '用“翻跟头武术木偶”和“肩膀上的小创可贴”，一次打通材质里最让人头大的四个空间词',
  duration: '11 分钟',
  difficulty: '零基础',
  steps: [
    {
      stepNumber: 1,
      shortLabel: '往哪边算上？',
      tag: 'phenomenon',
      title: '当舞台上的演员倒立翻跟头时，“往上指”到底是指哪边？',
      paragraphs: [
        '新手看材质教程，最容易被“世界空间”、“局部空间”、“切线空间”这几个词唬住。其实它们一点都不玄乎，全是因为一个生活常识：**不先约好以谁当参照物，“上下左右”就全乱套了**！',
        '想象舞台上有一位正在倒立的武术木偶。如果导演喊一句“往上举！”，究竟是指向**剧场天花板的天空**，还是指向**木偶自己的头顶**（此时正对着地板）？为了不吵架，3D 引擎把这两个参照物分成了清清楚楚的两个空间。',
      ],
      tryItPrompt:
        '把下方「木偶身体翻滚角」拉到 `140°` 左右让木偶倒立，来回点击切换【🌍 世界空间】与【🤖 局部空间】，看蓝色 `+Z` 箭头分别指着哪边！',
    },
    {
      stepNumber: 2,
      shortLabel: '世界与局部',
      tag: 'background',
      title: '先认前两个空间：雷打不动的「世界」与跟人走的「局部」',
      paragraphs: [
        '• **世界空间（World Space）**：把原点钉死在整个关卡大地的中心。在 UE 5.8 里，**天空正上方永远是蓝色的 `+Z` 轴**！不管场景里的石头怎么 360° 乱滚、角色怎么翻跟头，“天空在头顶上方”永远不变——后面做“石头朝天那一面自动落白雪”全靠它！',
        '• **局部/物体空间（Local Space）**：把原点钉在木偶自己的**肚脐眼**上！不管木偶跳多高、歪多少度，他的脑袋永远在他局部空间的 `+Z` 方向 0.5 米处——想给宝剑从剑柄到剑尖涂一道固定渐变色，选局部空间最稳当。',
      ],
      tryItPrompt:
        '勾选底部的【❄️ 开启头顶积雪实验】并随意翻滚木偶，观察在世界空间规则下，白雪是不是随每个采样点的朝向变化；对照头顶权重？',
    },
    {
      stepNumber: 3,
      shortLabel: '肩膀小创可贴',
      tag: 'experiment',
      title: '贴在演员肩膀上的“小创可贴”——切线空间与屏幕空间',
      paragraphs: [
        '既然已经有了整个舞台的「世界空间」和跟着演员走的「局部空间」，为什么做材质还要折腾出第 3 个词叫 **切线空间（Tangent Space）** 呢？想象木偶正在剧烈挥舞右胳膊：如果我们在他肩膀皮肤上画了一颗凸起 2 毫米的小铆钉，在世界或局部空间里看，这颗铆钉随着挥臂一会儿朝天、一会儿朝右，方向乱变一气，根本没法存成一张固定贴图！',
        '聪明的办法是：直接往他肩膀皮肤上**贴一张小创可贴**！规定：**不管胳膊怎么挥，永远把“垂直皮肤往外鼓”叫做蓝色 `+Z` 方向，顺着皮肤横着叫红 `X`，竖着叫绿 `Y`**。这张死死贴着表皮起伏的隐形创可贴就是「切线空间」！而第 4 个 **屏幕空间（Screen Space）** 则最简单：就是摄像机扁平取景玻璃上的左上角 `(0,0)` 到右下角 `(1,1)`。',
      ],
      tryItPrompt:
        '切到【🩹 切线空间 (肩膀小创可贴)】，再开启【🎬 自动挥手翻跟头演示】，盯住木偶右臂上那张米黄色创可贴——看蓝色 +Z 箭头是不是永远乖乖垂直皮肤朝外指？',
      callout: {
        tone: 'tip',
        title: '为什么法线贴图全靠这张“创可贴”？',
        body: '后面第 6 章你会学到大名鼎鼎的蓝紫色「法线贴图」——它记录的正是这张创可贴上的凹凸方向！正因如此，同一张龙鳞法线贴图贴在会跑、会跳、会扇翅膀的巨龙身上，光影永远严丝合缝！',
      },
    },
    {
      stepNumber: 4,
      shortLabel: '走进UE 5.8',
      tag: 'ue5',
      title: '走进 UE 5.8：四个空间在节点库里分别叫什么名字？',
      paragraphs: [
        '把大白话和 UE 5.8 节点名字对上号，以后搜节点稳准狠：\n1. **世界空间**：`Absolute World Position`（世界位置）与 `PixelNormalWS`（末尾的 `WS` 就是 World Space 缩写！）；\n2. **局部空间**：`Local Position`（物体自身坐标）；\n3. **切线空间**：材质层板上的 `Normal` 插孔默认接收的就是切线空间数据！如需把创可贴方向翻译成世界方向，只需连一颗 **`TransformVector（空间转换翻译官）`** 节点；\n4. **屏幕空间**：`ScreenPosition`（常用于全屏特效与瞄准镜）。',
      ],
      tryItPrompt:
        '切换到右上角【原理图】视图，查看 PixelNormalWS → ComponentMask B → Saturate → Lerp Alpha。将木偶转至 180°，头顶 Z = −1，世界空间积雪权重为 0，灰度回到岩石的 0.20。',
    },
    {
      stepNumber: 5,
      shortLabel: '混穿空间翻车',
      tag: 'pitfall',
      title: '防坑口诀：不同空间别硬算，就像人民币不能直接加美元！',
      paragraphs: [
        '实战中最常见的翻车，就是把两个不同参考系的方向直接拿去相加或点乘——比如想做“大石头顶面落雪”，却误用了局部空间的朝向：一旦关卡美术在地图里把这块石头倒过来摆，白雪竟然像涂了强力胶一样反重力粘在石头底面上！',
        '连线前养成好习惯：默念一句“这根线现在是世界空间还是切线创可贴空间？”，不同币种先过一遍 `TransformVector` 换算成同一空间再算！',
      ],
      tryItPrompt:
        '点击舞台上方黄色/绿色对比条切换【看踩坑现象】，看看误用局部空间做积雪时，倒立木偶头顶反重力挂雪的滑稽穿帮画面！',
      callout: {
        tone: 'warn',
        title: '一句话防坑口诀',
        body: '“世界认天地，局部认肚脐，切线是张创可贴，跨界先找翻译官（Transform）！”',
      },
    },
  ],
  takeaways: [
    '世界空间（World Space）原点固定在关卡中心，+Z 永远指向正上方天空，最适合做自动积雪与水位线',
    '局部空间（Local Space）原点跟随物体自身移动旋转，适合做绑定在模型身上的局部渐变特效',
    '切线空间（Tangent Space）就像贴在皮肤表面的“小创可贴”，+Z 永远垂直表皮朝外，是法线贴图的基石',
    '屏幕空间（Screen Space）对应摄像机拍出的 2D 画面 (0,0)~(1,1)；不同空间的数据混合前必须先用 Transform 转换',
  ],
  schematic: {
    "title": "世界空间积雪权重",
    "caption": "PixelNormalWS 已提供世界空间单位法线。取 B 通道得到 Z，经 Saturate 限制到 0–1；将 Lerp 输出接传统根节点 Base Color 或 Slab 的 Diffuse Albedo。",
    "nodes": [
      {
        "id": "normal",
        "title": "PixelNormalWS",
        "category": "input",
        "x": 12,
        "y": 30,
        "width": 167,
        "outputs": [
          {
            "id": "p0",
            "label": "XYZ",
            "color": "#38bdf8"
          }
        ]
      },
      {
        "id": "mask",
        "title": "ComponentMask",
        "category": "math",
        "x": 209,
        "y": 30,
        "width": 167,
        "inputs": [
          {
            "id": "p0",
            "label": "Input",
            "color": "#38bdf8"
          }
        ],
        "outputs": [
          {
            "id": "p0",
            "label": "B",
            "color": "#38bdf8"
          }
        ],
        "note": "仅勾选 B"
      },
      {
        "id": "sat",
        "title": "Saturate",
        "category": "math",
        "x": 408,
        "y": 30,
        "width": 167,
        "inputs": [
          {
            "id": "p0",
            "label": "Input",
            "color": "#38bdf8"
          }
        ],
        "outputs": [
          {
            "id": "p0",
            "label": "权重",
            "color": "#38bdf8"
          }
        ]
      },
      {
        "id": "rock",
        "title": "Constant",
        "category": "param",
        "x": 408,
        "y": 149,
        "width": 167,
        "outputs": [
          {
            "id": "p0",
            "label": "0.20",
            "color": "#38bdf8"
          }
        ],
        "note": "岩石灰度"
      },
      {
        "id": "snow",
        "title": "Constant",
        "category": "param",
        "x": 408,
        "y": 255,
        "width": 167,
        "outputs": [
          {
            "id": "p0",
            "label": "0.90",
            "color": "#38bdf8"
          }
        ],
        "note": "积雪灰度"
      },
      {
        "id": "lerp",
        "title": "LinearInterpolate",
        "category": "math",
        "x": 634,
        "y": 115,
        "width": 167,
        "inputs": [
          {
            "id": "p0",
            "label": "A 岩石",
            "color": "#38bdf8"
          },
          {
            "id": "p1",
            "label": "B 雪",
            "color": "#38bdf8"
          },
          {
            "id": "p2",
            "label": "Alpha",
            "color": "#38bdf8"
          }
        ],
        "outputs": [
          {
            "id": "p0",
            "label": "混合灰度",
            "color": "#38bdf8"
          }
        ]
      }
    ],
    "edges": [
      {
        "fromNode": "normal",
        "fromPin": "p0",
        "toNode": "mask",
        "toPin": "p0",
        "color": "#38bdf8"
      },
      {
        "fromNode": "mask",
        "fromPin": "p0",
        "toNode": "sat",
        "toPin": "p0",
        "color": "#38bdf8"
      },
      {
        "fromNode": "rock",
        "fromPin": "p0",
        "toNode": "lerp",
        "toPin": "p0",
        "color": "#38bdf8"
      },
      {
        "fromNode": "snow",
        "fromPin": "p0",
        "toNode": "lerp",
        "toPin": "p1",
        "color": "#38bdf8"
      },
      {
        "fromNode": "sat",
        "fromPin": "p0",
        "toNode": "lerp",
        "toPin": "p2",
        "color": "#38bdf8"
      }
    ]
  },
  StageComponent: FourCoordinateSpacesStage,
};

// ============================================================================
// 模块 02 · 第 2.1 课：-1~+4 超界 HDR 调色台 + 颜色(RGB) ↔ 空间箭头(XYZ) 双胞胎切换镜
// ============================================================================

type DualViewMode = 'split' | 'color' | 'vector';

const NormalizedNumbersVectorsStage: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [valR, setValR] = useState<number>(0.0);
  const [valG, setValG] = useState<number>(0.0);
  const [valB, setValB] = useState<number>(1.0);
  const [normalEncoded, setNormalEncoded] = useState(false);
  const [viewMode, setViewMode] = useState<DualViewMode>('split');
  const [albedoOverflowPitfall, setAlbedoOverflowPitfall] = useState<boolean>(false);

  const colorCanvasRef = useRef<HTMLCanvasElement>(null);
  const vectorCanvasRef = useRef<HTMLCanvasElement>(null);
  const colorFit = useAutoFitCanvas(colorCanvasRef);
  const vectorFit = useAutoFitCanvas(vectorCanvasRef);

  useEffect(() => {
    if (resetSignal > 0) {
      setValR(0.0);
      setValG(0.0);
      setValB(1.0);
      setNormalEncoded(false);
      setViewMode('split');
      setAlbedoOverflowPitfall(false);
    }
  }, [resetSignal]);

  const maxChannel = Math.max(valR, valG, valB);
  const minChannel = Math.min(valR, valG, valB);
  const x = normalEncoded ? valR * 2 - 1 : valR;
  const y = normalEncoded ? valG * 2 - 1 : valG;
  const z = normalEncoded ? valB * 2 - 1 : valB;
  const vecLen = Math.hypot(x, y, z);
  const isHdr = maxChannel > 1.001;
  const hasNegative = minChannel < -0.001;

  useEffect(() => {
    onKpiUpdate([
      {
        label: normalEncoded ? '法线纹理 · 编码 RGB' : '输入三分量',
        value: `(${valR.toFixed(2)}, ${valG.toFixed(2)}, ${valB.toFixed(2)})`,
        sub: normalEncoded ? '方向 = 2 × RGB − 1' : '当前直接读取 XYZ',
        tone: 'accent',
      },
      {
        label: normalEncoded ? '解码方向 XYZ' : '当成颜色看 (RGB 状态)',
        value: normalEncoded ? `(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})` : hasNegative
          ? '含负分量'
          : isHdr
          ? `✨ HDR 超界辉光 (${maxChannel.toFixed(1)}x)`
          : '✅ 0~1 标准表面色',
        sub: hasNegative
          ? '颜色预览将负分量截为 0'
          : isHdr
          ? '超过白纸 1.0 上限，触发霓虹泛光'
          : `相当于旧版 (${Math.round(clamp(valR) * 255)}, ${Math.round(clamp(valG) * 255)}, ${Math.round(clamp(valB) * 255)})`,
        tone: hasNegative ? 'bad' : isHdr ? 'warn' : 'good',
      },
      {
        label: normalEncoded ? '解码法线长度' : '向量长度',
        value: `|V| = ${vecLen.toFixed(2)}`,
        sub: `XYZ = (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`,
        tone: Math.abs(vecLen - 1) < 0.04 ? 'good' : 'neutral',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valR, valG, valB, isHdr, hasNegative, maxChannel, vecLen, normalEncoded, x, y, z]);

  // 显示原始 RGB 色块和材质响应示意。
  useEffect(() => {
    const canvas = colorCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    // 暗房摄影棚背景
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#11131a');
    bg.addColorStop(1, '#1c202c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 固定背景，比较输入端口的显示效果。
    ctx.fillStyle = '#2b3142';
    ctx.fillRect(0, H - 52, W, 52);

    const cx = W * 0.5;
    const cy = H * 0.48;
    const rad = 46;

    // HDR 自发光的可视化近似。
    if (isHdr && !albedoOverflowPitfall) {
      const bloomAmt = clamp((maxChannel - 1) / 3, 0.08, 1);
      const glowR = Math.round(clamp(valR / maxChannel) * 255);
      const glowG = Math.round(clamp(valG / maxChannel) * 255);
      const glowB = Math.round(clamp(valB / maxChannel) * 255);

      const bloomRadius = rad * (1.5 + bloomAmt * 1.6);
      const bloomGrad = ctx.createRadialGradient(cx, cy, rad * 0.5, cx, cy, bloomRadius);
      bloomGrad.addColorStop(
        0,
        `rgba(255, 255, 255, ${0.65 * bloomAmt})`
      );
      bloomGrad.addColorStop(
        0.35,
        `rgba(${glowR}, ${glowG}, ${glowB}, ${0.52 * bloomAmt})`
      );
      bloomGrad.addColorStop(1, `rgba(${glowR}, ${glowG}, ${glowB}, 0)`);
      ctx.fillStyle = bloomGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, bloomRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. 绘制中心 3D 球体
    const off = document.createElement('canvas');
    off.width = rad * 2;
    off.height = rad * 2;
    const octx = off.getContext('2d');
    if (octx) {
      const img = octx.createImageData(rad * 2, rad * 2);
      const L = norm3([-0.45, 0.65, 0.6]);
      for (let py = 0; py < rad * 2; py++) {
        for (let px = 0; px < rad * 2; px++) {
          const nx = (px + 0.5 - rad) / rad;
          const ny = (rad - (py + 0.5)) / rad;
          const r2 = nx * nx + ny * ny;
          if (r2 > 1) continue;
          const nz = Math.sqrt(1 - r2);
          const ndotl = Math.max(0.18, dot3([nx, ny, nz], L));

          // 当值 > 1 时球核趋向炽白（真实 ACES 高光漂白感）
          const mapHdr = (v: number) => {
            if (v <= 0) return 0;
            if (albedoOverflowPitfall && v > 1) return 1 - Math.exp(-ndotl * 1.15);
            const lit = v <= 1 ? v * ndotl : v * 0.85;
            return clamp(1 - Math.exp(-lit * 1.15), 0, 1);
          };

          const cr = Math.pow(mapHdr(valR), 1 / 2.2);
          const cg = Math.pow(mapHdr(valG), 1 / 2.2);
          const cb = Math.pow(mapHdr(valB), 1 / 2.2);

          const idx = (py * rad * 2 + px) * 4;
          img.data[idx] = Math.round(cr * 255);
          img.data[idx + 1] = Math.round(cg * 255);
          img.data[idx + 2] = Math.round(cb * 255);
          img.data[idx + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      ctx.drawImage(off, cx - rad, cy - rad);
    }

    // 左上角纯平色块参考签
    ctx.fillStyle = `rgb(${Math.round(clamp(valR) * 255)}, ${Math.round(
      clamp(valG) * 255
    )}, ${Math.round(clamp(valB) * 255)})`;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.fillRect(14, 14, 34, 34);
    ctx.strokeRect(14, 14, 34, 34);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`RGB(${valR.toFixed(2)}, ${valG.toFixed(2)}, ${valB.toFixed(2)})`, 56, 28);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.fillText(
      hasNegative
        ? '负分量可表示方向；普通显示颜色截到 0'
        : isHdr
        ? albedoOverflowPitfall
          ? '❌ 误连进底色 Albedo：本预览将反射率限幅至 1'
          : '✨ 超出 1.0：化身自发光霓虹灯 (HDR)！'
        : '0~1 区间：正常反射的物理表面颜色',
      56,
      45
    );
  }, [valR, valG, valB, isHdr, hasNegative, maxChannel, minChannel, albedoOverflowPitfall, viewMode, colorFit]);

  // 绘制右舱：同一个三维数组解释为 3D 空间箭头 (X, Y, Z)
  useEffect(() => {
    const canvas = vectorCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#11131a';
    ctx.fillRect(0, 0, W, H);

    const ox = W * 0.5;
    const oy = H * 0.58;
    // 自适应缩放保证 +4.0 也能画在框内
    const maxAbs = Math.max(1.2, Math.abs(x), Math.abs(y), Math.abs(z));
    const unitPx = Math.min(64, 82 / maxAbs);

    const proj3 = (x: number, y: number, z: number): [number, number] => {
      // X 向右下(红)，Y 向左下(绿)，Z 正朝天(蓝)
      const sx = ox + (x * 0.86 - y * 0.72) * unitPx;
      const sy = oy + (x * 0.42 + y * 0.42 - z * 1.0) * unitPx;
      return [sx, sy];
    };

    // 地面参考网格 (-1..+1)
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 1;
    for (let g = -2; g <= 2; g++) {
      const p1 = proj3(g, -2, 0);
      const p2 = proj3(g, 2, 0);
      const p3 = proj3(-2, g, 0);
      const p4 = proj3(2, g, 0);
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.moveTo(p3[0], p3[1]);
      ctx.lineTo(p4[0], p4[1]);
      ctx.stroke();
    }

    // 三条标准坐标轴（长度 1.5）
    const drawAxis = (tx: number, ty: number, tz: number, col: string, name: string) => {
      const end = proj3(tx, ty, tz);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(end[0], end[1]);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(name, end[0] + 4, end[1] + 4);
    };
    drawAxis(1.6, 0, 0, '#ef4444', '+X(红)');
    drawAxis(0, 1.6, 0, '#22c55e', '+Y(绿)');
    drawAxis(0, 0, 1.6, '#38bdf8', '+Z(蓝·朝天)');

    // 投影垂足虚线（帮助零基础看清三维立体落点）
    const floorPt = proj3(x, y, 0);
    const tipPt = proj3(x, y, z);
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
    ctx.lineWidth = 1.3;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(floorPt[0], floorPt[1]);
    ctx.lineTo(tipPt[0], tipPt[1]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 主角：当前三维向量大箭头！
    ctx.strokeStyle = '#fde047';
    ctx.fillStyle = '#fde047';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(tipPt[0], tipPt[1]);
    ctx.stroke();

    if (vecLen > 0.04) {
      const ang = Math.atan2(tipPt[1] - oy, tipPt[0] - ox);
      ctx.beginPath();
      ctx.moveTo(tipPt[0], tipPt[1]);
      ctx.lineTo(tipPt[0] - 11 * Math.cos(ang - 0.45), tipPt[1] - 11 * Math.sin(ang - 0.45));
      ctx.lineTo(tipPt[0] - 11 * Math.cos(ang + 0.45), tipPt[1] - 11 * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ox, oy, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fef08a';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`XYZ(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`, 14, 26);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.fillText(`箭头总长度 |V| = ${vecLen.toFixed(2)}`, 14, 44);
  }, [x, y, z, vecLen, viewMode, vectorFit]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={albedoOverflowPitfall}
          pitfallLabel="踩坑：把 3.5 的超界高亮直接塞进 Diffuse Albedo 底色（反射 350% 阳光，预览按反射率上限显示）"
          correctLabel="正解：底色守在 0~1 以内，超界 3.5 送进 Emissive 自发光口（柔和霓虹泛光）"
          onToggle={(p) => {
            setAlbedoOverflowPitfall(p);
            if (p && maxChannel <= 1) {
              setNormalEncoded(false);
              setValR(3.5);
              setValG(1.2);
              setValB(0.2);
            }
          }}
        />
      )}

      {/* 顶部醒目一体切换器 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <StageSegmented<DualViewMode>
          value={viewMode}
          options={[
            { value: 'split', label: '👀 左右同屏：输入与方向' },
            { value: 'color', label: '🎨 只看颜色色块与 HDR 辉光 (RGB)' },
            { value: 'vector', label: '🧭 只看三维空间方向箭头 (XYZ)' },
          ]}
          onChange={setViewMode}
        />

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="segmented-opt active"
            onClick={() => {
              setNormalEncoded(false);
              setValR(0);
              setValG(0);
              setValB(1);
            }}
          >
            🔵 (0,0,1) 纯蓝/朝天
          </button>
          <button
            type="button"
            className="segmented-opt active"
            onClick={() => {
              setNormalEncoded(true);
              setValR(0.5);
              setValG(0.5);
              setValB(1.0);
            }}
          >
            🟣 (0.5,0.5,1) 法线紫
          </button>
          <button
            type="button"
            className="segmented-opt active"
            onClick={() => {
              setNormalEncoded(false);
              setValR(3.5);
              setValG(1.2);
              setValB(0.2);
            }}
          >
            🔥 (3.5,1.2,0.2) HDR辉光
          </button>
          <button
            type="button"
            className="segmented-opt active"
            onClick={() => {
              setNormalEncoded(false);
              setValR(-0.8);
              setValG(0.2);
              setValB(0.4);
            }}
          >
            🕳️ (-0.8,0.2,0.4) 负分量
          </button>
        </div>
      </div>

      {/* 双联视口 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            viewMode === 'split' ? 'repeat(auto-fit, minmax(260px, 1fr))' : '1fr',
          gap: 10,
        }}
      >
        {(viewMode === 'split' || viewMode === 'color') && (
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1.5px solid var(--border-strong)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '7px 11px',
                borderBottom: '1px solid var(--border-soft)',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              🎨 视角 A：把这三个数当成「颜色亮度 RGB」看
            </div>
            <canvas
              ref={colorCanvasRef}
              width={360}
              height={216}
              style={{ width: '100%', height: 216, display: 'block' }}
            />
          </div>
        )}

        {(viewMode === 'split' || viewMode === 'vector') && (
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1.5px solid var(--border-strong)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '7px 11px',
                borderBottom: '1px solid var(--border-soft)',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              🧭 视角 B：{normalEncoded ? '编码 RGB 解码为切线方向（2 × RGB − 1）' : '直接读取三维向量 XYZ'}
            </div>
            <canvas
              ref={vectorCanvasRef}
              width={360}
              height={216}
              style={{ width: '100%', height: 216, display: 'block' }}
            />
          </div>
        )}
      </div>

      {/* 三通道超界滑块 */}
      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSlider
            label="第 1 个数：红 R / 空间 X"
            value={valR}
            min={normalEncoded ? 0 : -1}
            max={normalEncoded ? 1 : 4}
            step={0.05}
            onChange={setValR}
          />
          <StageSlider
            label="第 2 个数：绿 G / 空间 Y"
            value={valG}
            min={normalEncoded ? 0 : -1}
            max={normalEncoded ? 1 : 4}
            step={0.05}
            onChange={setValG}
          />
          <StageSlider
            label="第 3 个数：蓝 B / 空间 Z (朝天)"
            value={valB}
            min={normalEncoded ? 0 : -1}
            max={normalEncoded ? 1 : 4}
            step={0.05}
            onChange={setValB}
          />
        </div>
      </div>
    </div>
  );
};

const lesson2_1: LessonDefinition = {
  id: 'normalized-numbers-vectors',
  moduleId: '02',
  number: '2.1',
  title: '材质里的数字语言 —— 为什么用 0~1？颜色与方向为什么是一回事？',
  subtitle: '告别 0~255！揭秘超界霓虹发光 (>1)、带符号方向 (<0)，以及纯蓝色变身朝天箭头的真相',
  duration: '9 分钟',
  difficulty: '零基础',
  steps: [
    {
      stepNumber: 1,
      shortLabel: '告别0~255',
      tag: 'phenomenon',
      title: '修图软件里纯白是 255，为什么进材质编辑器全变成了 1.0？',
      paragraphs: [
        '用过画图或 Photoshop 的朋友都知道，纯红是 `(255, 0, 0)`，纯白是 `(255, 255, 255)`。可一旦走进 UE 5.8 材质编辑器，你会发现所有数字全变成了 **`0.0` 到 `1.0` 的小数**——甚至还会看到大佬往颜色框里直接敲进 `5.0` 或者 `-0.5`！',
        '为什么要抛弃亲切的 `255` 改用小数？如果填了比 `1.0` 还大的数字，电脑不会报错死机吗？',
      ],
      tryItPrompt:
        '试着把下方「红 R」滑块一路往右拉过 `1.0` 推到 `3.5`，看看左侧材质球发生了什么惊艳变化！',
    },
    {
      stepNumber: 2,
      shortLabel: '百分比与双胞胎',
      tag: 'background',
      title: '0~1 百分比乘法的爽快感，以及“颜色 = 方向”的底层大揭秘',
      paragraphs: [
        '先看改成 **`0~1` 百分比（专业名叫归一化）** 有多爽：假如用 `255` 做乘法，`255 × 255 = 65025` 当场爆表！而换成 `0~1` 后，任何颜色 **`× 1` 原封不动，`× 0` 瞬间归黑，`× 0.5` 刚好减半**！而且小数没有天花板：**超过 `1.0`（比如 `3.5`）代表它比反光白纸亮 3.5 倍，就是刺眼的霓虹灯与太阳（HDR 高动态范围）**；方向分量可小于 0，普通显示色将负分量截为 0。',
        '再揭开第二个让新手拍大腿的秘密：为什么材质里同一个 `(0, 0, 1)`，连进颜色口是**纯蓝色**，连进法线口就变成了**朝天竖立的小牙签**？因为在显卡内存里，根本不区分什么“颜色”或“坐标”，它只存了**一模一样的三个小数 `float3`**！',
      ],
      tryItPrompt:
        '点击舞台上方的【🔵 (0,0,1) 纯蓝/朝天】和【🕳️ (-0.8,0.2,0.4) 负分量】预设钮，左右对照看看同一串数字在颜色眼中和空间眼中的双胞胎身份！',
      callout: {
        tone: 'tip',
        title: '一秒看懂通道外号对应表',
        body: '第 1 个数：红 `R` = 横坐标 `X` = 贴图 `U`\n第 2 个数：绿 `G` = 纵坐标 `Y` = 贴图 `V`\n第 3 个数：蓝 `B` = 高度朝天 `Z` = 切线朝外 `W/N`',
      },
    },
    {
      stepNumber: 3,
      shortLabel: '动手调双胞胎',
      tag: 'experiment',
      title: '亲手拨动三根滑块，提前破解“法线贴图为什么是蓝紫色”！',
      paragraphs: [
        '我们来提前做个超有成就感的小剧透：点击上方预设钮 **`🟣 (0.5, 0.5, 1.0) 法线紫`**！',
        '你看左边：`(0.5, 0.5, 1.0)` 红绿各半、蓝色拉满，混出来正是游戏文件夹里最常见的那种**浅蓝紫色法线贴图底色**；再看右边箭头：把 编码 `RGB` 逐通道做 `2 × RGB − 1` 解码后，它正好是一根不偏不倚笔直朝上指的蓝色小牙签！此时 `(0,0,1)` 在切线空间沿表面朝外，长度为 1。UE 的 Normal 采样器已执行相应解码，连线时避免再解码一次。原来神秘的法线贴图，不过是把小牙签的方向借着颜色外衣存进了图片里而已！',
      ],
      tryItPrompt:
        '点击上方视图切换钮单独放大【🎨 只看颜色】与【🧭 只看三维箭头】，在法线紫预设下，先核对编码 (0.5,0.5,1)、解码 (0,0,1) 和长度 1，再拖动三个滑块观察箭头长度 `|V|` 的实时变化。',
    },
    {
      stepNumber: 4,
      shortLabel: '走进UE 5.8',
      tag: 'ue5',
      title: '走进 UE 5.8：数字三兄弟 `Constant 1 / 2 / 3Vector`',
      paragraphs: [
        '在 UE 5.8 材质画布里，按住键盘左上角的数字键点鼠标左键，就能一秒召唤最常用的数字三兄弟：\n• 按住 **`1` + 左键** = `Constant`（1 个小数，代表黑白灰度，常连粗糙度、金属度）；\n• 按住 **`2` + 左键** = `Constant2Vector`（2 个小数，常用来缩放平移二维 `UV`）；\n• 按住 **`3` + 左键** = `Constant3Vector`（3 个小数，双击可弹出调色盘，也可手动输入 `>1` 的发光值连入 `Substrate Slab` 的 **`Emissive Color（自发光）`** 插孔）。',
      ],
      tryItPrompt:
        '切到右上角【原理图】视图，看清 `0~1` 常规底色与 `>1` 超界自发光在 `Substrate Slab BSDF` 上的不同归宿。',
    },
    {
      stepNumber: 5,
      shortLabel: '超界乱塞大坑',
      tag: 'pitfall',
      title: '防坑口诀：自发光尽管超 1，漫反射底色千万别超 1！',
      paragraphs: [
        '新手学会填大于 `1` 的数字后，常犯两个致命错误：\n1. **把 `3.5` 这种超界值误连进 `Diffuse Albedo（漫反射底色）`**：底色代表反射阳光的百分比，填 `3.5` 等于射进来 1 份阳光弹出去 3.5 份，严重违背物理能量守恒，超出漫反射率的物理范围；本预览把底色限幅至 1。想发光一定要连进 **`Emissive Color`**。\n2. **拿 2 个数硬加 3 个数**：在 UE 5.8 中，`2Vector` 直接加 `3Vector` 会当场红字报错（维度不对齐），只有单独 `1` 个数（标量）才能和任意维度的向量自由加减乘除！',
      ],
      tryItPrompt:
        '点击顶部避坑对比条切换【看踩坑现象】，对比“把 3.5 误塞进底色在预览中被限幅”与“正确连入 Emissive 产生柔美辉光”的区别！',
      callout: {
        tone: 'warn',
        title: '一句话防坑口诀',
        body: '“零到一算比例，超出一去发光（Emissive）；方向分量可为负，两维三维别乱撞！”',
      },
    },
  ],
  takeaways: [
    '材质统一使用 0~1 归一化小数：乘 1 不变、乘 0 归黑；超过 1.0 代表 HDR 高亮自发光，小于 0 可表示方向的反向分量',
    '底层内存中 RGB 颜色与 XYZ 空间向量完全等价，同一个 (0, 0, 1) 既是纯蓝色也是朝正上方的单位箭头',
    'UE 5.8 快捷键 1 / 2 / 3 + 左键分别生成一维灰度、二维 UV 向量与三维颜色/方向向量',
    'Diffuse Albedo（底色）必须严格守在 0~1 内守住能量守恒，需要霓虹辉光请连入 Emissive Color',
  ],
  schematic: {
    title: 'UE 5.8 标准底色 (0~1) 与 HDR 自发光 (>1) 正确接线法',
    caption: '漫反射底色经 Clamp/Saturate 守住物理上限，超界高倍数值专走 Emissive 通道触发镜头泛光。',
    nodes: [
      {
        id: 'base_c3',
        title: 'Constant3Vector [快捷键3]',
        subtitle: '标准表面色 (0.15, 0.45, 0.85)',
        category: 'param',
        x: 30,
        y: 55,
        width: 205,
        previewColor: '#2563eb',
        outputs: [{ id: 'rgb', label: 'RGB (0~1)', color: '#3b82f6' }],
      },
      {
        id: 'hdr_c3',
        title: 'Constant3Vector × 4.0',
        subtitle: '超界霓虹发光 (3.5, 1.2, 0.2)',
        category: 'math',
        x: 30,
        y: 195,
        width: 205,
        previewColor: '#f97316',
        outputs: [{ id: 'hdr', label: 'HDR (>1.0)', color: '#fb923c' }],
        note: '亮度超过 1.0，触发 Bloom 辉光',
      },
      {
        id: 'slab',
        title: 'Substrate Slab BSDF',
        subtitle: '底色与自发光各司其职',
        category: 'substrate',
        x: 315,
        y: 110,
        width: 220,
        inputs: [
          { id: 'albedo', label: 'Diffuse Albedo (限 0~1)', color: '#3b82f6' },
          { id: 'emissive', label: 'Emissive Color (允许 >1)', color: '#fb923c' },
        ],
        outputs: [{ id: 'out', label: 'Front Material', color: '#a855f7' }],
      },
      {
        id: 'root',
        title: '材质根节点',
        subtitle: '送入后期泛光管线',
        category: 'output',
        x: 605,
        y: 120,
        width: 170,
        inputs: [{ id: 'front', label: 'Front Material', color: '#a855f7' }],
      },
    ],
    edges: [
      {
        fromNode: 'base_c3',
        fromPin: 'rgb',
        toNode: 'slab',
        toPin: 'albedo',
        color: '#3b82f6',
        label: '0~1 反射率',
      },
      {
        fromNode: 'hdr_c3',
        fromPin: 'hdr',
        toNode: 'slab',
        toPin: 'emissive',
        color: '#fb923c',
        label: 'HDR 发光',
      },
      {
        fromNode: 'slab',
        fromPin: 'out',
        toNode: 'root',
        toPin: 'front',
        color: '#a855f7',
      },
    ],
  },
  StageComponent: NormalizedNumbersVectorsStage,
};

// ============================================================================
// 模块 02 · 第 2.2 课：算术五件套 —— 可手绘黑白遮罩画板 + 冷热水混水阀 Lerp 台
// ============================================================================

type MathOpMode = 'lerp' | 'multiply' | 'add';
type MaskPresetKind = 'noise' | 'frame' | 'gradient' | 'clear';

const MASK_RES = 64;

function sampleCleanIron(u: number, v: number): Vec3 {
  // 拉丝精钢铁板质感：带横向细微金属拉丝与四角铆钉
  const brush = Math.sin(v * 180 + Math.sin(u * 25) * 1.5) * 0.035;
  const sheen = 0.62 + 0.12 * Math.cos((u - v) * 4.5) + brush;
  return [clamp(sheen * 0.92), clamp(sheen * 0.96), clamp(sheen * 1.04)];
}

function sampleHeavyRust(u: number, v: number): Vec3 {
  // 斑驳氧化铁锈质感：橙褐深浅颗粒交错
  const n1 = Math.sin(u * 19.3) * Math.cos(v * 23.7) * 0.5 + 0.5;
  const n2 = Math.sin((u + v) * 43.1) * 0.5 + 0.5;
  const mix = n1 * 0.65 + n2 * 0.35;
  return lerp3([0.36, 0.13, 0.05], [0.82, 0.36, 0.09], mix);
}

function createPresetMask(kind: MaskPresetKind): Float32Array {
  const arr = new Float32Array(MASK_RES * MASK_RES);
  for (let y = 0; y < MASK_RES; y++) {
    for (let x = 0; x < MASK_RES; x++) {
      const u = x / (MASK_RES - 1);
      const v = y / (MASK_RES - 1);
      let val = 0;
      if (kind === 'noise') {
        const w1 = Math.sin(u * 9.5 + 0.7) * Math.cos(v * 8.8 - 0.4);
        const w2 = Math.sin((u - v) * 18.2) * 0.35;
        val = saturate((w1 + w2) * 0.9 + 0.45);
        val = val > 0.48 ? saturate((val - 0.42) * 2.2) : 0;
      } else if (kind === 'frame') {
        const edgeDist = Math.min(u, 1 - u, v, 1 - v);
        const ring = Math.abs(Math.hypot(u - 0.5, v - 0.5) - 0.26) < 0.07 ? 1 : 0;
        val = edgeDist < 0.14 ? 1 : ring;
      } else if (kind === 'gradient') {
        val = v;
      } else {
        val = 0;
      }
      arr[y * MASK_RES + x] = val;
    }
  }
  return arr;
}

const FiveMathNodesStage: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [opMode, setOpMode] = useState<MathOpMode>('lerp');
  const [invertMask, setInvertMask] = useState<boolean>(false);
  const [useClamp, setUseClamp] = useState<boolean>(true);
  const [maskGain, setMaskGain] = useState<number>(1.0);
  const [brushVal, setBrushVal] = useState<1 | 0>(1);
  const [paintVersion, setPaintVersion] = useState<number>(0);
  const [isPainting, setIsPainting] = useState<boolean>(false);
  const [show3DSphere, setShow3DSphere] = useState<boolean>(true);

  const maskDataRef = useRef<Float32Array>(createPresetMask('noise'));
  const ironCanvasRef = useRef<HTMLCanvasElement>(null);
  const rustCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (resetSignal > 0) {
      maskDataRef.current = createPresetMask('noise');
      setOpMode('lerp');
      setInvertMask(false);
      setUseClamp(true);
      setMaskGain(1.0);
      setBrushVal(1);
      setShow3DSphere(true);
      setPaintVersion((v) => v + 1);
    }
  }, [resetSignal]);

  // 初始绘制固定 A（精钢铁板）与 B（斑驳铁锈）缩略图
  useEffect(() => {
    const drawThumb = (
      canvas: HTMLCanvasElement | null,
      fn: (u: number, v: number) => Vec3
    ) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const S = canvas.width;
      const img = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const c = fn(x / S, y / S);
          const idx = (y * S + x) * 4;
          img.data[idx] = Math.round(c[0] * 255);
          img.data[idx + 1] = Math.round(c[1] * 255);
          img.data[idx + 2] = Math.round(c[2] * 255);
          img.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };
    drawThumb(ironCanvasRef.current, sampleCleanIron);
    drawThumb(rustCanvasRef.current, sampleHeavyRust);
  }, []);

  // 计算遮罩统计与超界状态供 KPI 展示
  const maskStats = (() => {
    const arr = maskDataRef.current;
    let sum = 0;
    let maxRaw = 0;
    for (let i = 0; i < arr.length; i++) {
      let m = arr[i];
      if (invertMask) m = 1 - m;
      m = m * maskGain;
      if (m > maxRaw) maxRaw = m;
      if (useClamp) m = clamp(m, 0, 1);
      sum += m;
    }
    return {
      avg: sum / arr.length,
      overflowed: !useClamp && maxRaw > 1.02,
      maxRaw,
    };
  })();

  useEffect(() => {
    const opNames: Record<MathOpMode, string> = {
      lerp: 'Lerp 冷热水混水阀',
      multiply: 'Multiply 剪纸镂空板',
      add: 'Add 强行相加变亮',
    };
    onKpiUpdate([
      {
        label: '当前算术核心节点',
        value: opNames[opMode],
        sub: invertMask ? '已串联 OneMinus (1-x 黑白反转)' : '正向读取遮罩',
        tone: 'accent',
      },
      {
        label: '遮罩白色占比 (Alpha)',
        value: `${Math.round(maskStats.avg * 100)}% 区域生效`,
        sub: `倍增系数 ×${maskGain.toFixed(1)}`,
        tone: 'neutral',
      },
      {
        label: '0~1 护栏检测 (Clamp)',
        value: maskStats.overflowed
          ? `⚠️ 超界达 ${maskStats.maxRaw.toFixed(2)}！`
          : '✅ 数值安全锁在 0~1',
        sub: maskStats.overflowed
          ? '未加 Clamp 护栏，颜色发生反向过曝失真！'
          : useClamp
          ? 'Clamp / Saturate 护栏保护中'
          : '当前数值未越界',
        tone: maskStats.overflowed ? 'bad' : 'good',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opMode, invertMask, useClamp, maskGain, paintVersion]);

  // 绘制手绘遮罩画布 + 右侧实时合成大图（支持平面 / 3D 铁球视图）
  useEffect(() => {
    // 1. 绘制遮罩预览
    const mCanvas = maskCanvasRef.current;
    if (mCanvas) {
      const mctx = mCanvas.getContext('2d');
      if (mctx) {
        const S = mCanvas.width;
        const img = mctx.createImageData(S, S);
        for (let py = 0; py < S; py++) {
          for (let px = 0; px < S; px++) {
            const mx = Math.min(MASK_RES - 1, Math.floor((px / S) * MASK_RES));
            const my = Math.min(MASK_RES - 1, Math.floor((py / S) * MASK_RES));
            let m = maskDataRef.current[my * MASK_RES + mx];
            if (invertMask) m = 1 - m;
            m = m * maskGain;
            if (useClamp) m = clamp(m, 0, 1);
            const g = Math.round(clamp(m, 0, 1) * 255);
            const idx = (py * S + px) * 4;
            img.data[idx] = g;
            img.data[idx + 1] = g;
            img.data[idx + 2] = g;
            img.data[idx + 3] = 255;
          }
        }
        mctx.putImageData(img, 0, 0);
      }
    }

    // 2. 绘制最终运算合成结果
    const rCanvas = resultCanvasRef.current;
    if (!rCanvas) return;
    const rctx = rCanvas.getContext('2d');
    if (!rctx) return;
    const W = rCanvas.width;
    const H = rCanvas.height;
    const img = rctx.createImageData(W, H);

    const evalCompositeAt = (u: number, v: number): { col: Vec3; rustFactor: number; overflow: boolean } => {
      const mx = clamp(Math.floor(u * MASK_RES), 0, MASK_RES - 1);
      const my = clamp(Math.floor(v * MASK_RES), 0, MASK_RES - 1);
      let m = maskDataRef.current[my * MASK_RES + mx];
      if (invertMask) m = 1 - m;
      m = m * maskGain;
      const rawOver = m > 1.001 || m < -0.001;
      if (useClamp) m = clamp(m, 0, 1);

      const colA = sampleCleanIron(u, v);
      const colB = sampleHeavyRust(u, v);

      let out: Vec3;
      if (opMode === 'lerp') {
        // Lerp(A, B, m) = A + (B - A) * m —— 当 m > 1 且没 Clamp 时，精钢色被过度减成诡异深绿/刺眼亮橘！
        out = [
          colA[0] + (colB[0] - colA[0]) * m,
          colA[1] + (colB[1] - colA[1]) * m,
          colA[2] + (colB[2] - colA[2]) * m,
        ];
      } else if (opMode === 'multiply') {
        // 剪纸遮罩：A × m（白色保留好铁，黑色直接抠成纯黑！）
        out = [colA[0] * m, colA[1] * m, colA[2] * m];
      } else {
        // Add 相加：好铁 + 铁锈 × m（两张图光能硬叠，极易 >1 过曝发白！）
        out = [colA[0] + colB[0] * m, colA[1] + colB[1] * m, colA[2] + colB[2] * m];
      }

      if (useClamp) {
        out = [clamp(out[0]), clamp(out[1]), clamp(out[2])];
      }
      return { col: out, rustFactor: clamp(m), overflow: rawOver && !useClamp };
    };

    const L = norm3([-0.45, 0.62, 0.64]);
    const V: Vec3 = [0, 0, 1];
    const Hvec = norm3([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;
        if (!show3DSphere) {
          const u = px / W;
          const v = py / H;
          const { col } = evalCompositeAt(u, v);
          // 模拟未 Clamp 时超出 1 的刺眼色偏或负值断层
          img.data[idx] = Math.round(clamp(col[0], 0, 1) * 255);
          img.data[idx + 1] = Math.round(clamp(col[1], 0, 1) * 255);
          img.data[idx + 2] = Math.round(clamp(col[2], 0, 1) * 255);
          img.data[idx + 3] = 255;
        } else {
          // 3D 铁球实时打光预览（精钢处高光锐利，铁锈处哑光粗糙！）
          const rad = Math.min(W, H) * 0.44;
          const nx = (px + 0.5 - W * 0.5) / rad;
          const ny = (H * 0.5 - (py + 0.5)) / rad;
          const r2 = nx * nx + ny * ny;
          if (r2 > 1) {
            img.data[idx] = 20;
            img.data[idx + 1] = 23;
            img.data[idx + 2] = 31;
            img.data[idx + 3] = 255;
            continue;
          }
          const nz = Math.sqrt(1 - r2);
          const u = clamp(Math.atan2(nx, nz) / (Math.PI * 0.9) + 0.5, 0, 0.999);
          const v = clamp(0.5 - Math.asin(clamp(ny, -1, 1)) / Math.PI, 0, 0.999);
          const { col, rustFactor } = evalCompositeAt(u, v);

          const N: Vec3 = [nx, ny, nz];
          const ndotl = Math.max(0, dot3(N, L));
          const shininess = lerp(42, 6, rustFactor);
          const specStr = lerp(0.55, 0.05, rustFactor);
          const spec = Math.pow(Math.max(0, dot3(N, Hvec)), shininess) * specStr;

          const litR = col[0] * (ndotl * 0.95 + 0.22) + spec;
          const litG = col[1] * (ndotl * 0.95 + 0.22) + spec;
          const litB = col[2] * (ndotl * 0.95 + 0.22) + spec;

          img.data[idx] = Math.round(clamp(litR, 0, 1) * 255);
          img.data[idx + 1] = Math.round(clamp(litG, 0, 1) * 255);
          img.data[idx + 2] = Math.round(clamp(litB, 0, 1) * 255);
          img.data[idx + 3] = 255;
        }
      }
    }
    rctx.putImageData(img, 0, 0);
  }, [opMode, invertMask, useClamp, maskGain, paintVersion, show3DSphere]);

  const paintAtClient = (clientX: number, clientY: number) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((clientX - rect.left) / rect.width) * MASK_RES;
    const cy = ((clientY - rect.top) / rect.height) * MASK_RES;
    const brushR = 5.2;

    const arr = maskDataRef.current;
    const xMin = Math.max(0, Math.floor(cx - brushR));
    const xMax = Math.min(MASK_RES - 1, Math.ceil(cx + brushR));
    const yMin = Math.max(0, Math.floor(cy - brushR));
    const yMax = Math.min(MASK_RES - 1, Math.ceil(cy + brushR));

    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= brushR) {
          const falloff = clamp(1 - d / brushR, 0, 1);
          const idx = y * MASK_RES + x;
          arr[idx] = lerp(arr[idx], brushVal, falloff * 0.85);
        }
      }
    }
    setPaintVersion((v) => v + 1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={!useClamp && maskGain > 1.5}
          pitfallLabel="踩坑：遮罩放大到 2.2 倍且未套 Clamp 护栏，Lerp 超界算出刺眼怪色！"
          correctLabel="正解：进 Alpha 拧手前套上 Clamp / Saturate (0~1 护栏)，铁锈过渡干净稳重"
          onToggle={(p) => {
            if (p) {
              setOpMode('lerp');
              setMaskGain(2.2);
              setUseClamp(false);
            } else {
              setUseClamp(true);
            }
          }}
        />
      )}

      {/* 核心实验台：左三原料 -> 右实时合成大窗 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 1.05fr) minmax(220px, 1fr)',
          gap: 10,
          alignItems: 'stretch',
        }}
      >
        {/* 左侧：A冷水 + B热水 + 可手绘遮罩 */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <canvas
                ref={ironCanvasRef}
                width={76}
                height={76}
                style={{ width: 68, height: 68, borderRadius: 8, border: '1.5px solid var(--border-soft)' }}
              />
              <div style={{ fontSize: 11, fontWeight: 700 }}>冷水 A：精钢铁板</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <canvas
                ref={rustCanvasRef}
                width={76}
                height={76}
                style={{ width: 68, height: 68, borderRadius: 8, border: '1.5px solid var(--border-soft)' }}
              />
              <div style={{ fontSize: 11, fontWeight: 700 }}>热水 B：斑驳铁锈</div>
            </div>
            <div style={{ flex: 1, fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <strong>混水阀口诀：</strong>
              <br />• 遮罩黑 `0` → 出冷水 A（好铁）
              <br />• 遮罩白 `1` → 出热水 B（铁锈）
            </div>
          </div>

          <div
            style={{
              borderTop: '1px dashed var(--border-soft)',
              paddingTop: 8,
              display: 'flex',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <canvas
              ref={maskCanvasRef}
              width={128}
              height={128}
              style={{
                width: 116,
                height: 116,
                borderRadius: 9,
                border: '2px solid var(--border-strong)',
                cursor: 'crosshair',
                touchAction: 'none',
                flexShrink: 0,
              }}
              onMouseDown={(e) => {
                setIsPainting(true);
                paintAtClient(e.clientX, e.clientY);
              }}
              onMouseMove={(e) => {
                if (isPainting) paintAtClient(e.clientX, e.clientY);
              }}
              onMouseUp={() => setIsPainting(false)}
              onMouseLeave={() => setIsPainting(false)}
              onTouchStart={(e) => {
                if (e.touches[0]) {
                  setIsPainting(true);
                  paintAtClient(e.touches[0].clientX, e.touches[0].clientY);
                }
              }}
              onTouchMove={(e) => {
                if (isPainting && e.touches[0]) {
                  paintAtClient(e.touches[0].clientX, e.touches[0].clientY);
                }
              }}
              onTouchEnd={() => setIsPainting(false)}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 800 }}>
                🖌️ 亲手在左框涂抹黑白遮罩！
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`segmented-opt ${brushVal === 1 ? 'active' : ''}`}
                  onClick={() => setBrushVal(1)}
                >
                  ⚪ 涂白笔 (1.0 长锈)
                </button>
                <button
                  type="button"
                  className={`segmented-opt ${brushVal === 0 ? 'active' : ''}`}
                  onClick={() => setBrushVal(0)}
                >
                  ⚫ 涂黑擦 (0.0 还原铁)
                </button>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(
                  [
                    ['noise', '斑驳锈斑'],
                    ['frame', '圆环边框'],
                    ['gradient', '上下渐变'],
                    ['clear', '全黑清空'],
                  ] as [MaskPresetKind, string][]
                ).map(([k, title]) => (
                  <button
                    key={k}
                    type="button"
                    className="segmented-opt active"
                    style={{ fontSize: 11, padding: '2px 7px' }}
                    onClick={() => {
                      maskDataRef.current = createPresetMask(k);
                      setPaintVersion((v) => v + 1);
                    }}
                  >
                    {title}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：合成结果实时预览 */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
          }}
        >
          <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 800 }}>⚡ 算术五件套实时输出</span>
            <button
              type="button"
              className="segmented-opt active"
              style={{ fontSize: 11 }}
              onClick={() => setShow3DSphere((s) => !s)}
            >
              {show3DSphere ? '🌐 切换看平面贴图' : '🌐 切换裹上 3D 铁球'}
            </button>
          </div>
          <canvas
            ref={resultCanvasRef}
            width={196}
            height={196}
            style={{
              width: 184,
              height: 184,
              borderRadius: 10,
              border: '1.5px solid var(--border-soft)',
            }}
          />
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center' }}>
            {opMode === 'lerp' && '🚿 Lerp 混水阀：在涂白处精准长出粗糙铁锈，涂黑处保留光滑精钢！'}
            {opMode === 'multiply' && '✂️ Multiply 抠图：白处 ×1 保留精钢，黑处 ×0 一刀剪成纯黑！'}
            {opMode === 'add' && '💡 Add 相加：把铁锈亮光硬加到铁板上，像铁锈自己在通电发光！'}
          </div>
        </div>
      </div>

      {/* 五件套算术切换栏 */}
      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSegmented<MathOpMode>
            label="切换核心算术节点"
            value={opMode}
            options={[
              { value: 'lerp', label: '🚿 Lerp (冷热水混水阀)' },
              { value: 'multiply', label: '✂️ Multiply (剪纸遮罩)' },
              { value: 'add', label: '➕ Add (叠加变亮)' },
            ]}
            onChange={setOpMode}
          />

          <StageSlider
            label="遮罩对比倍增（拉过 1.5 并关掉护栏试试！）"
            value={maskGain}
            min={0.5}
            max={2.4}
            step={0.1}
            unit="x"
            onChange={setMaskGain}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <StageToggle
            label="反转遮罩 OneMinus (1 - x)"
            checked={invertMask}
            onChange={setInvertMask}
            hint="生锈与好铁位置瞬间对调"
          />
          <StageToggle
            label="安全护栏 Clamp (锁回 0~1)"
            checked={useClamp}
            onChange={setUseClamp}
            hint="防止超界颜色炸裂"
          />
        </div>
      </div>
    </div>
  );
};

const lesson2_2: LessonDefinition = {
  id: 'five-math-nodes',
  moduleId: '02',
  number: '2.2',
  title: '材质算术五件套 —— 加、乘（剪纸遮罩）、反转、混水阀 Lerp 与护栏 Clamp',
  subtitle: '拆开大佬上百个节点的蜘蛛网材质，90% 全在翻来覆去重复这 5 个小学算术！',
  duration: '12 分钟',
  difficulty: '零基础',
  steps: [
    {
      stepNumber: 1,
      shortLabel: '拆穿纸老虎',
      tag: 'phenomenon',
      title: '看到几百根连线的“蜘蛛网材质”就腿软？其实全是纸老虎！',
      paragraphs: [
        '很多零基础同学一打开别人做好的高级材质球，看到密密麻麻上百个方块连来连去，当场就想打退堂鼓：“我数学不好，是不是学不会材质了？”',
        '今天给你吃一颗最大的定心丸：**做材质根本不用微积分，90% 的神仙效果拆到底，全在重复拼搭 5 个连小学生都会的算术积木**！只要把这“五件套”玩成肌肉记忆，再庞大的材质网你也能一眼看穿。',
      ],
      tryItPrompt:
        '直接按住左侧黑白小画板随便涂几笔白线，看看右边立体的精钢铁球是不是立刻顺着你的笔迹长出了逼真的橙红铁锈！',
    },
    {
      stepNumber: 2,
      shortLabel: '剪纸与混水阀',
      tag: 'background',
      title: '为什么“乘法”能当剪刀抠图？“Lerp”为什么是浴室混水阀？',
      paragraphs: [
        '用大白话一次认齐这五位黄金搭档：\n1. **`相加 Add (A + B)`**：两盏手电筒叠在一起，越加越亮；\n2. **`相乘 Multiply (A × B)` —— 剪纸镂空板**！拿一张铁板图乘上一张黑白图案：白色地方是 `1`（`铁板 × 1 = 完好保留`），黑色地方是 `0`（`铁板 × 0 = 瞬间抠成纯黑`）！\n3. **`一减 OneMinus (1 - x)` —— 底片反转**！黑 `0` 变白 `1`，白 `1` 变黑 `0`，一键颠倒选区；\n4. **`线性插值 Lerp` —— 家里浴室的冷热水混水阀**！左边管接冷水 `A`（干净好铁），右边管接热水 `B`（斑驳铁锈），中间拧手 `Alpha` 为 `0` 全出好铁，为 `1` 全出铁锈，连入黑白遮罩就能指哪锈哪！\n5. **`截断护栏 Clamp / Saturate`**：把超界野马乖乖锁回 `0~1` 安全围栏里。',
      ],
      tryItPrompt:
        '在下方轮流点击切换【🚿 Lerp】、【✂️ Multiply】与【➕ Add】，再勾上【反转遮罩 OneMinus】，亲眼对比三种运算的巨大差异！',
      callout: {
        tone: 'formula',
        title: 'Lerp 混水阀背后的极简算式',
        body: 'Lerp(A, B, Alpha) = A × (1 - Alpha) + B × Alpha\n当 Alpha = 0 时得 A；当 Alpha = 1 时得 B；当 Alpha = 0.5 时各占一半！',
      },
    },
    {
      stepNumber: 3,
      shortLabel: '亲手涂铁锈',
      tag: 'experiment',
      title: '动手体验：做生锈铁板，为什么不能用 Add 而必须用 Lerp？',
      paragraphs: [
        '新手最容易犯的直觉错误是：“我想往铁板上**加**点铁锈，那我连个 **`Add（相加）`** 不就行了？”',
        '快切到 `➕ Add` 看看右边铁球变成了什么样——好铁的银白色光加上铁锈的橙光，铁锈不仅没有盖住精钢，反而像烧红的烙铁一样在表面发光！因为铁锈在现实中是**替换覆盖**掉原本的铁皮，而不是往铁皮上打手电筒。**凡是“把两种材质按区域拼在一起”，永远认准混水阀 `Lerp`！**',
      ],
      tryItPrompt:
        '点击遮罩下方的【圆环边框】或【上下渐变】预设，再切换涂黑橡皮擦在圆环上擦出几个缺口，感受“用黑白图精准指挥材质”的快乐！',
    },
    {
      stepNumber: 4,
      shortLabel: '走进UE 5.8',
      tag: 'ue5',
      title: '走进 UE 5.8：左手四个黄金快捷键，连线快得像弹钢琴！',
      paragraphs: [
        '在 UE 5.8 材质画布里，老手从来不右键打字搜这几个节点，左手往键盘上一搭点左键就出来了：\n• 按住 **`A` + 左键** = `Add（加）`\n• 按住 **`M` + 左键** = `Multiply（乘）`\n• 按住 **`O` + 左键** = `OneMinus（1-x 反转）`\n• 按住 **`L` + 左键** = `LinearInterpolate（即 Lerp 混水阀）`\n至于 `0~1` 护栏，在 UE 5.8 中推荐搜 **`Saturate`**（它专门锁死 `0~1`，目标编译器有时可将限幅合入指令，可用 Platform Stats 查看目标平台结果。）。',
      ],
      tryItPrompt:
        '切换到右上角【原理图】视图，看清 `好铁 A`、`铁锈 B` 与经过 `OneMinus → Saturate` 处理的遮罩是如何接入 `Lerp` 的三个插孔的。',
      callout: {
        tone: 'ue58',
        title: 'UE 5.8 省性能冷知识：优先用 Saturate 代替 Clamp',
        body: '如果你只是想把数字锁在标准的 `0.0 ~ 1.0` 之间，用 `Saturate` 节点不仅不用填 Min/Max，在 GPU 硬件指令里还能顺手免费捎带完成！只有锁 `0.2 ~ 0.8` 这种特殊范围才需要 `Clamp`。',
      },
    },
    {
      stepNumber: 5,
      shortLabel: '拧手超界坑',
      tag: 'pitfall',
      title: '防坑口诀：混水阀拧手 Alpha 一旦超界，颜色当场反向炸裂！',
      paragraphs: [
        '很多同学为了追求硬朗的生锈边缘，会把黑白遮罩乘以 `2.5` 倍拉高对比度，然后**忘了加 `Saturate / Clamp` 护栏**就直接捅进了 `Lerp` 的 `Alpha` 拧手里！',
        '看看算式会发生什么恐怖的事：当 `Alpha = 2.2` 时，`好铁 × (1 - 2.2) + 铁锈 × 2.2 = -1.2 倍好铁 + 2.2 倍铁锈`！好铁的银蓝色被扣成了负数，画面上当场爆出一块块诡异刺眼的荧光橘红！切记：**任何经过加减乘除折腾的遮罩，进 `Lerp` 的 `Alpha` 口之前，随手串一颗 `Saturate` 保平安！**',
      ],
      tryItPrompt:
        '点击顶部避坑对比条切换【看踩坑现象】（或把遮罩倍增拉到 `2.2x` 并取消勾选安全护栏 Clamp），亲眼看看没有护栏的 Lerp 颜色炸裂现场！',
      callout: {
        tone: 'warn',
        title: '一句话防坑口诀',
        body: '“抠图用乘（M）反转（O），混材质认准混水阀（L），拧手进门先上锁（Saturate）！”',
      },
    },
  ],
  takeaways: [
    'Multiply（相乘）是最常用的“剪纸遮罩”：乘 1 原样保留，乘 0 瞬间归黑；OneMinus（1-x）一键反转黑白选区',
    '合并两种表面材质（如好铁与铁锈、草地与泥路）必须用 Lerp（混水阀），误用 Add 会导致颜色过曝发光',
    '记住左手黄金快捷键：A = Add，M = Multiply，O = OneMinus，L = Lerp',
    '遮罩在调高对比度后极易超出 0~1，连入 Lerp 的 Alpha 前务必串上 Saturate / Clamp 护栏防止反向失真',
  ],
  schematic: {
    title: '算术五件套实战：精钢铁板与斑驳铁锈遮罩混合节点图',
    caption: '遮罩经 OneMinus 与 Saturate 安全护栏整备后控制 Lerp 混水阀，精准驱动底色混合。',
    nodes: [
      {
        id: 'tex_iron',
        title: 'Texture Sample (精钢铁板)',
        subtitle: '连入冷水口 A (Alpha=0)',
        category: 'texture',
        x: 25,
        y: 30,
        width: 195,
        previewColor: '#94a3b8',
        outputs: [{ id: 'rgb', label: 'RGB', color: '#cbd5e1' }],
      },
      {
        id: 'tex_rust',
        title: 'Texture Sample (斑驳铁锈)',
        subtitle: '连入热水口 B (Alpha=1)',
        category: 'texture',
        x: 25,
        y: 145,
        width: 195,
        previewColor: '#c2410c',
        outputs: [{ id: 'rgb', label: 'RGB', color: '#fb923c' }],
      },
      {
        id: 'tex_mask',
        title: '污渍遮罩 → OneMinus [O]',
        subtitle: '再串 Saturate 锁死 0~1',
        category: 'math',
        x: 25,
        y: 260,
        width: 195,
        previewColor: '#e5e7eb',
        outputs: [{ id: 'alpha', label: 'Clamped 0~1', color: '#f8fafc' }],
        note: '护栏防止 >1 反向爆色！',
      },
      {
        id: 'lerp_node',
        title: 'LinearInterpolate (Lerp) [L]',
        subtitle: '冷热水混水阀核心',
        category: 'math',
        x: 295,
        y: 130,
        width: 210,
        inputs: [
          { id: 'a', label: 'A (好铁)', color: '#cbd5e1' },
          { id: 'b', label: 'B (铁锈)', color: '#fb923c' },
          { id: 'al', label: 'Alpha (拧手)', color: '#f8fafc' },
        ],
        outputs: [{ id: 'res', label: 'Mixed RGB', color: '#34d399' }],
      },
      {
        id: 'slab_out',
        title: 'Substrate Slab BSDF',
        subtitle: '输出生锈精钢材质',
        category: 'substrate',
        x: 575,
        y: 135,
        width: 195,
        inputs: [{ id: 'diff', label: 'Diffuse Albedo', color: '#34d399' }],
        outputs: [{ id: 'front', label: 'Front Material', color: '#a855f7' }],
      },
    ],
    edges: [
      {
        fromNode: 'tex_iron',
        fromPin: 'rgb',
        toNode: 'lerp_node',
        toPin: 'a',
        color: '#94a3b8',
      },
      {
        fromNode: 'tex_rust',
        fromPin: 'rgb',
        toNode: 'lerp_node',
        toPin: 'b',
        color: '#fb923c',
      },
      {
        fromNode: 'tex_mask',
        fromPin: 'alpha',
        toNode: 'lerp_node',
        toPin: 'al',
        color: '#e5e7eb',
        label: '0~1 权重',
      },
      {
        fromNode: 'lerp_node',
        fromPin: 'res',
        toNode: 'slab_out',
        toPin: 'diff',
        color: '#34d399',
      },
    ],
  },
  StageComponent: FiveMathNodesStage,
};


// ============================================================================
// 模块 02 · 第 2.3 课：2D 橘子皮 UV 画布 ↔ 3D 模型双向同步画笔与拉伸实验
// ============================================================================

interface PaintStrokePoint {
  u: number;
  v: number;
  color: Vec3;
}

const UvUnwrapOrangeStage: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [rotDeg, setRotDeg] = useState<number>(25);
  const [uvSquash, setUvSquash] = useState<number>(1.0);
  const [brushColorKey, setBrushColorKey] = useState<'gold' | 'cyan' | 'coral'>('gold');
  const [showSeam, setShowSeam] = useState<boolean>(true);
  const [hoverUv, setHoverUv] = useState<[number, number] | null>([0.48, 0.45]);
  const [strokes, setStrokes] = useState<PaintStrokePoint[]>(() => {
    // 默认画一个可爱的笑脸在橘子正面，打开就能直观看到 2D -> 3D 映射！
    const pts: PaintStrokePoint[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 23) * Math.PI * 0.8 + Math.PI * 0.1;
      pts.push({ u: 0.5 + Math.cos(a) * 0.14, v: 0.54 + Math.sin(a) * 0.1, color: [1, 0.84, 0.2] });
    }
    pts.push({ u: 0.43, v: 0.4, color: [0.2, 0.9, 1] });
    pts.push({ u: 0.57, v: 0.4, color: [0.2, 0.9, 1] });
    return pts;
  });

  const uvCanvasRef = useRef<HTMLCanvasElement>(null);
  const meshCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (resetSignal > 0) {
      setRotDeg(25);
      setUvSquash(1.0);
      setShowSeam(true);
      const pts: PaintStrokePoint[] = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 23) * Math.PI * 0.8 + Math.PI * 0.1;
        pts.push({ u: 0.5 + Math.cos(a) * 0.14, v: 0.54 + Math.sin(a) * 0.1, color: [1, 0.84, 0.2] });
      }
      pts.push({ u: 0.43, v: 0.4, color: [0.2, 0.9, 1] });
      pts.push({ u: 0.57, v: 0.4, color: [0.2, 0.9, 1] });
      setStrokes(pts);
    }
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 4 && uvSquash === 1.0) {
      setUvSquash(3.2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  useEffect(() => {
    onKpiUpdate([
      {
        label: 'UE 5.8 UV 原点标准',
        value: '左上角 (0, 0)',
        sub: 'DirectX 规范：U向右，V向下',
        tone: 'accent',
      },
      {
        label: '探针实时 UV 坐标',
        value: hoverUv ? `(${hoverUv[0].toFixed(2)}, ${hoverUv[1].toFixed(2)})` : '(0.50, 0.50)',
        tone: 'good',
      },
      {
        label: '棋盘格长宽比 (拉伸检测)',
        value: uvSquash > 1.35 ? `⚠️ 严重拉丝 (${uvSquash.toFixed(1)}x)` : '✅ 1:1 均匀方格',
        tone: uvSquash > 1.35 ? 'bad' : 'good',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverUv?.[0], hoverUv?.[1], uvSquash]);

  const brushRgb: Vec3 =
    brushColorKey === 'gold'
      ? [1.0, 0.84, 0.18]
      : brushColorKey === 'cyan'
      ? [0.16, 0.92, 1.0]
      : [1.0, 0.36, 0.32];

  // 把屏幕坐标换算成画布像素，再映射到 UV 方框（padL/padT = 26，方框宽高 = 画布尺寸 - 38）
  const clientToUv = (c: HTMLCanvasElement, clientX: number, clientY: number): [number, number] => {
    const rect = c.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * c.width;
    const py = ((clientY - rect.top) / rect.height) * c.height;
    return [clamp((px - 26) / (c.width - 38), 0, 1), clamp((py - 26) / (c.height - 38), 0, 1)];
  };

  const paintAt = (clientX: number, clientY: number) => {
    const c = uvCanvasRef.current;
    if (!c) return;
    const [u, v] = clientToUv(c, clientX, clientY);
    setHoverUv([u, v]);
    setStrokes((prev) => [...prev.slice(-260), { u, v, color: brushRgb }]);
  };

  useEffect(() => {
    const uvC = uvCanvasRef.current;
    const meshC = meshCanvasRef.current;
    if (!uvC || !meshC) return;
    const uctx = uvC.getContext('2d');
    const mctx = meshC.getContext('2d');
    if (!uctx || !mctx) return;

    // 1. Draw 2D [0,1] UV Canvas
    const uw = uvC.width;
    const uh = uvC.height;
    uctx.fillStyle = '#181a20';
    uctx.fillRect(0, 0, uw, uh);

    const padL = 26;
    const padT = 26;
    const boxW = uw - 38;
    const boxH = uh - 38;

    // Draw 8x8 UV Checkerboard inside [0,1]
    for (let gy = 0; gy < 8; gy++) {
      for (let gx = 0; gx < 8; gx++) {
        const even = (gx + gy) % 2 === 0;
        uctx.fillStyle = even ? '#323846' : '#232733';
        uctx.fillRect(padL + (gx * boxW) / 8, padT + (gy * boxH) / 8, boxW / 8 + 0.5, boxH / 8 + 0.5);
      }
    }

    // Show squashed UV island grid lines
    uctx.strokeStyle = 'rgba(196, 223, 178, 0.45)';
    uctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const warpedU = Math.pow(t, uvSquash);
      const x = padL + warpedU * boxW;
      uctx.beginPath();
      uctx.moveTo(x, padT);
      uctx.lineTo(x, padT + boxH);
      uctx.stroke();
    }

    // Seam highlight on left/right border (U=0 & U=1)
    if (showSeam) {
      uctx.strokeStyle = '#f97316';
      uctx.lineWidth = 3;
      uctx.setLineDash([5, 4]);
      uctx.beginPath();
      uctx.moveTo(padL, padT);
      uctx.lineTo(padL, padT + boxH);
      uctx.moveTo(padL + boxW, padT);
      uctx.lineTo(padL + boxW, padT + boxH);
      uctx.stroke();
      uctx.setLineDash([]);
    }

    // Draw painted strokes on 2D UV
    for (const st of strokes) {
      uctx.fillStyle = `rgb(${Math.round(st.color[0] * 255)}, ${Math.round(st.color[1] * 255)}, ${Math.round(st.color[2] * 255)})`;
      uctx.beginPath();
      uctx.arc(padL + st.u * boxW, padT + st.v * boxH, 5.5, 0, Math.PI * 2);
      uctx.fill();
    }

    // Hover crosshair
    if (hoverUv) {
      const hx = padL + hoverUv[0] * boxW;
      const hy = padT + hoverUv[1] * boxH;
      uctx.strokeStyle = '#ffffff';
      uctx.lineWidth = 1.5;
      uctx.beginPath();
      uctx.arc(hx, hy, 8, 0, Math.PI * 2);
      uctx.stroke();
    }

    // Rulers: U -> Right, V -> Down, Origin (0,0) Top-Left
    uctx.fillStyle = '#fde68a';
    uctx.font = 'bold 11px JetBrains Mono, monospace';
    uctx.fillText('(0,0)', 3, 16);
    uctx.fillText('U → 1.0', padL + boxW - 52, 16);
    uctx.fillText('V↓1', 2, padT + boxH);

    // 2. Render 3D Peeled Orange / Sphere with live UV lookup
    const mw = meshC.width;
    const mh = meshC.height;
    const img = mctx.createImageData(mw, mh);
    const data = img.data;
    const rotRad = (rotDeg * Math.PI) / 180;
    const L = norm3([0.45, 0.62, 0.65]);
    const aspect = mw / mh;

    for (let py = 0; py < mh; py++) {
      for (let px = 0; px < mw; px++) {
        const sx = ((px / mw) - 0.5) * 2 * aspect;
        const sy = (0.5 - py / mh) * 2;
        const r2 = sx * sx + sy * sy;

        let r = 0.09;
        let g = 0.1;
        let b = 0.13;

        if (r2 <= 0.76) {
          const sz = Math.sqrt(0.76 - r2);
          const N = norm3([sx, sy, sz]);

          // Rotate around Y axis to get object-space spherical UV
          const cosR = Math.cos(rotRad);
          const sinR = Math.sin(rotRad);
          const ox = N[0] * cosR + N[2] * sinR;
          const oz = -N[0] * sinR + N[2] * cosR;

          const rawU = (Math.atan2(ox, oz) / (2 * Math.PI)) + 0.5;
          // Apply UV squash distortion
          const u = Math.pow(clamp(rawU, 0, 1), 1 / uvSquash);
          const v = Math.acos(clamp(N[1], -1, 1)) / Math.PI;

          // Base orange peel + checkerboard pattern
          const chk = ((Math.floor(u * 8) + Math.floor(v * 8)) & 1) ? 1.0 : 0.72;
          let colR = 0.92 * chk;
          let colG = 0.48 * chk;
          let colB = 0.12 * chk;

          // Check painted strokes in UV space
          for (let si = strokes.length - 1; si >= 0; si--) {
            const st = strokes[si];
            const du = u - st.u;
            const dv = v - st.v;
            if (du * du + dv * dv < 0.0012) {
              colR = st.color[0];
              colG = st.color[1];
              colB = st.color[2];
              break;
            }
          }

          // Highlight UV Seam line at rawU near 0 or 1
          const nearSeam = showSeam && (rawU < 0.018 || rawU > 0.982);
          if (nearSeam) {
            colR = 1.0;
            colG = 0.95;
            colB = 0.25;
          }

          // Highlight hover laser dot on 3D mesh
          if (hoverUv) {
            const hdu = u - hoverUv[0];
            const hdv = v - hoverUv[1];
            if (hdu * hdu + hdv * hdv < 0.0007) {
              colR = 1.0;
              colG = 1.0;
              colB = 1.0;
            }
          }

          const diff = Math.max(0.18, dot3(N, L));
          const rim = Math.pow(1 - Math.max(0, N[2]), 3) * 0.22;
          r = clamp(colR * diff + rim, 0, 1);
          g = clamp(colG * diff + rim, 0, 1);
          b = clamp(colB * diff + rim, 0, 1);
        }

        const idx = (py * mw + px) * 4;
        data[idx] = Math.round(r * 255);
        data[idx + 1] = Math.round(g * 255);
        data[idx + 2] = Math.round(b * 255);
        data[idx + 3] = 255;
      }
    }
    mctx.putImageData(img, 0, 0);
  }, [strokes, rotDeg, uvSquash, showSeam, hoverUv]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stepIndex === 4 && (
        <PitfallCompareBar
          isPitfall={uvSquash > 1.3}
          pitfallLabel="UV 岛面积分配不均：大量三维表面挤在狭窄 UV 区，棋盘格被严重拉成面条！"
          correctLabel="均匀展平 UV 网格：每个三维区域分到等比例棋盘格，贴图清晰不拉伸"
          onToggle={(p) => setUvSquash(p ? 3.2 : 1.0)}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 11,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
            <span>🍊 剥平的 2D 橘子皮 [0,1] (按住鼠标涂鸦！)</span>
            <button
              type="button"
              onClick={() => setStrokes([])}
              style={{ fontSize: 11, padding: '1px 7px', borderRadius: 5, border: '1px solid var(--border-soft)', background: 'var(--bg-subtle)', cursor: 'pointer' }}
            >
              清空画布
            </button>
          </div>
          <canvas
            ref={uvCanvasRef}
            width={256}
            height={220}
            onMouseDown={(e) => paintAt(e.clientX, e.clientY)}
            onMouseMove={(e) => {
              setHoverUv(clientToUv(e.currentTarget, e.clientX, e.clientY));
              if (e.buttons === 1) paintAt(e.clientX, e.clientY);
            }}
            style={{ width: '100%', maxWidth: 360, height: 'auto', margin: '0 auto', borderRadius: 8, cursor: 'crosshair', display: 'block', touchAction: 'none' }}
          />
        </div>

        <div
          style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 11,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700 }}>
            🌐 实时包回 3D 橘子球 (转到背面 180° 看剪刀接缝)
          </div>
          <canvas
            ref={meshCanvasRef}
            width={256}
            height={220}
            style={{ width: '100%', maxWidth: 360, height: 'auto', margin: '0 auto', borderRadius: 8, display: 'block' }}
          />
        </div>
      </div>

      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSlider
            label="旋转 3D 橘子球 (转到 180° 看接缝)"
            value={rotDeg}
            min={-180}
            max={180}
            step={1}
            unit="°"
            onChange={setRotDeg}
          />
          <StageSlider
            label="局部 UV 挤压程度 (测试拉伸变形)"
            value={uvSquash}
            min={1.0}
            max={3.6}
            step={0.1}
            unit="x"
            onChange={setUvSquash}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <StageSegmented
            value={brushColorKey}
            onChange={setBrushColorKey}
            options={[
              { value: 'gold', label: '🟡 金色画笔' },
              { value: 'cyan', label: '🔵 青色画笔' },
              { value: 'coral', label: '🔴 珊瑚红画笔' },
            ]}
          />
          <StageToggle label="高亮剪刀接缝线 (UV Seam)" checked={showSeam} onChange={setShowSeam} />
        </div>
      </div>
    </div>
  );
};

const lesson2_3: LessonDefinition = {
  id: 'uv-unwrap-orange',
  moduleId: '02',
  number: '2.3',
  title: '把 3D 橘子皮剥平 —— 什么是 UV 坐标（TexCoord）与接缝拉伸？',
  subtitle: '亲手在 2D 橘子皮上画笑脸同步贴回立体圆球，彻底搞懂 TexCoord 原点、剪刀接缝与棋盘格拉伸',
  duration: '9 min',
  difficulty: '零基础',
  steps: [
    {
      stepNumber: 1,
      shortLabel: '剥橘子皮难题',
      tag: 'phenomenon',
      title: '照片明明是平面的，怎么严丝合缝包到圆滚滚的橘子和人脸上？',
      paragraphs: [
        '手机拍出来的木纹、布料照片全都是扁平的长方形，而游戏里的宝剑、木桶和怪兽脑袋却是凹凸立体的。如果硬拿平面照片往圆球上拍，四周一定会起皱折成一团！',
        '想想过年吃橘子或剥巧克力锡纸的过程：只要拿一把小剪刀在橘子皮背面剪开一道口子，就能把整张立体橘子皮摊平在桌面上——**先在平面皮上画好图案，再原路包回橘子上**，难题就迎刃而解了！',
      ],
      tryItPrompt: '按住鼠标在左侧「2D 橘子皮画布」上随意写字或画几笔，看右侧 3D 圆球对应位置是不是同一瞬间长出了你的笔迹！',
    },
    {
      stepNumber: 2,
      shortLabel: '为什么叫UV？',
      tag: 'background',
      title: '为什么不叫 XY 而偏偏改名叫 U 和 V？原点 (0,0) 在哪一角？',
      paragraphs: [
        '因为字母 `X, Y, Z` 已经被三维空间占用了！为了不混淆，图形学家把上面那张 `0 到 1` 的正方形平面图纸的**横坐标改名叫 `U`**，**纵坐标改名叫 `V`**——合起来就是大名鼎鼎的 **UV 坐标**！',
        '⚠️ **UE 5.8 必背细节**：由于虚幻引擎遵循微软 DirectX 标准，UV 图纸的起点 **`(0, 0)` 固定在左上角**！`U` 从左往右数到 `1.0`，`V` 从上往下数到 `1.0`（跟某些左下角起步的软件刚好上下颠倒，记准左上角能少走无数弯路！）。',
      ],
      tryItPrompt: '把鼠标轻轻滑到左侧画布的左上角、正中心和右下角，观察顶部实时探针读数如何从 `(0.00, 0.00)` 变到 `(1.00, 1.00)`。',
    },
    {
      stepNumber: 3,
      shortLabel: '剪刀口与接缝',
      tag: 'experiment',
      title: '剪刀剪开的地方藏哪儿去了？认识 UV 接缝（Seam）',
      paragraphs: [
        '既然球面不可能毫无破损地压成正方形（就像地球仪剪开成世界地图总有边界），小剪刀剪开的那道口子在 3D 模型上就叫 **UV 接缝（Seam）**——在左图里它是左右两条虚线边（`U=0` 和 `U=1`），包回圆球后它们会在背面重新嘴对嘴缝合在一起。',
        '所以老练的建模师在展 UV 时，总会把接缝偷偷藏在**角色腋下、后脑勺头发底下、裤腿内侧**等镜头不容易怼脸直视的隐蔽角落！',
      ],
      tryItPrompt: '拖动下方「旋转 3D 橘子球」滑块转到 `180°` 或 `-180°` 背面，找到那条黄色的剪刀缝合线，并在左图紧贴左边缘画一笔看看背面怎么断开！',
    },
    {
      stepNumber: 4,
      shortLabel: '走进UE 5.8',
      tag: 'ue5',
      title: '走进 UE 5.8：按住快捷键 U 召唤 TexCoord 节点',
      paragraphs: [
        '在 UE 5.8 材质编辑器里，你不需要自己算橘子皮怎么剥（建模软件导出模型时已经把每个顶点的 UV 算好存进模型里了）。',
        '你只需按住键盘 **`U` 键点鼠标左键**，就能召唤出红色的 **`TexCoord (TextureCoordinate)`** 节点！它吐出来的双通道数据（红 `R = U`，绿 `G = V`）默认会自动连进每一张 `Texture Sample` 贴图的 `UVs` 插孔里，指挥每个像素去正确位置取颜色。',
      ],
      tryItPrompt: '点击右上角切换到【UE5.8 节点/原理图】视图，看看红色的 `TexCoord [0]` 节点是如何把 UV 坐标喂给纹理采样器的。',
      callout: {
        tone: 'ue58',
        title: '一套模型还能带多套 UV！（Coordinate Index）',
        body: '点击 `TexCoord` 节点可见 `Coordinate Index`：`0` 号通常是主贴图 UV，而 `1` 号常用来存互不重叠的光照烘焙或特殊全身污渍 UV！',
      },
    },
    {
      stepNumber: 5,
      shortLabel: '棋盘格测拉伸',
      tag: 'pitfall',
      title: '防坑口诀：为什么建模师总爱给模型贴一张黑白棋盘格？',
      paragraphs: [
        '你肯定见过美术师给没上色的白模贴满像国际象棋一样的方格子——那可不是为了好看，而是**拉伸照妖镜**！',
        '如果模型上很大一块脸蛋，在 2D UV 图纸上被委屈地挤成了窄窄一条缝，那么只有几个纹素能分给整张脸，贴图贴上去就会像拉面一样糊成面条！只有当全身棋盘格都接近**大小均匀的正方形**时，贴图清晰度才最完美。',
      ],
      tryItPrompt: '拖动「局部 UV 挤压程度」滑块到 `3.0x`（或点顶部踩坑对比按钮），亲眼看看圆球上的正方形格子是如何被拉成扁长面条的！',
      callout: {
        tone: 'warn',
        title: '一句话防坑口诀',
        body: '“左上零零右下壹，剪刀接缝藏暗处；先贴棋盘查方正，莫把贴图拉成面！”',
      },
    },
  ],
  takeaways: [
    'UV 坐标就是把 3D 立体表皮剪开摊平在 0~1 正方形图纸上的二维坐标（横轴 U，纵轴 V）',
    'UE 5.8 遵循 DirectX 标准，UV 原点 (0, 0) 位于左上角，U 向右递增、V 向下递增',
    '剪开表皮的边界称为 UV 接缝（Seam），实战中应尽量藏在角色后背、腋下等隐蔽处',
    '在材质中按 U + 左键可创建 TexCoord 节点；展 UV 时需用棋盘格检查，防止局部挤压导致贴图拉糊',
  ],
  schematic: {
    title: 'UE 5.8 标准 UV 坐标读取与贴图采样链路',
    caption: 'TexCoord 读取模型自带的 0~1 橘子皮坐标，送入 Texture Sample 查出颜色后交由 Substrate Slab 渲染。',
    nodes: [
      {
        id: 'texcoord',
        title: 'TexCoord [0] (快捷键 U)',
        subtitle: '读取模型 UV 坐标',
        category: 'input',
        x: 30,
        y: 95,
        width: 185,
        outputs: [{ id: 'uv', label: 'UV (RG)', color: '#eab308' }],
        note: '左上(0,0) → 右下(1,1)',
      },
      {
        id: 'tex_sample',
        title: 'Texture Sample (快捷键 T)',
        subtitle: '按 UV 坐标去贴图查颜色',
        category: 'texture',
        x: 270,
        y: 95,
        width: 200,
        inputs: [{ id: 'uvs', label: 'UVs', color: '#eab308' }],
        outputs: [{ id: 'rgb', label: 'RGB 颜色', color: '#f97316' }],
      },
      {
        id: 'slab',
        title: 'Substrate Slab BSDF',
        subtitle: 'UE 5.8 物质层板',
        category: 'substrate',
        x: 525,
        y: 95,
        width: 205,
        inputs: [{ id: 'albedo', label: 'Diffuse Albedo', color: '#f97316' }],
        outputs: [{ id: 'front', label: 'Front Material', color: '#a855f7' }],
      },
    ],
    edges: [
      { fromNode: 'texcoord', fromPin: 'uv', toNode: 'tex_sample', toPin: 'uvs', color: '#eab308', label: '(U, V)' },
      { fromNode: 'tex_sample', fromPin: 'rgb', toNode: 'slab', toPin: 'albedo', color: '#f97316' },
    ],
  },
  StageComponent: UvUnwrapOrangeStage,
};

// ============================================================================
// 模块 02 · 第 2.4 课：第一次认门 —— 走进 UE 5.8 材质编辑器的工作流全景
// ============================================================================

const FIRST_SURFACE_COLORS = { 青绿: '#35a6a1', 橙色: '#e18244', 紫色: '#a682d1' };
type FirstTint = keyof typeof FIRST_SURFACE_COLORS;

const Ue58EditorTourStage: React.FC<LessonStageProps> = ({ onKpiUpdate, resetSignal }) => {
  const [tint, setTint] = useState<FirstTint>('青绿');
  const [connected, setConnected] = useState(false);
  const [converted, setConverted] = useState(false);
  const [applied, setApplied] = useState<FirstTint | null>(null);
  const [assigned, setAssigned] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTint('青绿');
    setConnected(false);
    setConverted(false);
    setApplied(null);
    setAssigned(false);
    setSaved(false);
  }, [resetSignal]);

  useEffect(() => {
    onKpiUpdate([
      { label: '当前资产', value: 'M_FirstSurface', sub: converted ? '已另存 Substrate 副本' : '传统根节点', tone: 'accent' },
      { label: '材质预览', value: connected ? tint : '空白图', sub: saved ? '已保存' : '编辑中', tone: 'neutral' },
      { label: '关卡 Cube · Element 0', value: assigned && applied ? applied : '默认材质', sub: '关卡显示已应用的版本', tone: assigned ? 'good' : 'neutral' },
    ]);
  }, [converted, connected, tint, saved, applied, assigned, onKpiUpdate]);

  const previewColor = connected ? FIRST_SURFACE_COLORS[tint] : '#62676b';
  const levelColor = assigned && applied ? FIRST_SURFACE_COLORS[applied] : '#62676b';
  return <div className="stage-controls-panel">
    <p><strong>M_FirstSurface · Surface / Opaque</strong></p>
    <div className="control-grid">
      <div><div aria-label="材质预览球" style={{ width: 94, height: 94, borderRadius: '50%', background: `radial-gradient(at 35% 30%, ${previewColor} 15%, #242831 110%)` }} />材质预览 · {connected ? tint : '默认'}</div>
      <div><div aria-label="关卡立方体" style={{ width: 94, height: 94, background: levelColor, border: '9px outset rgba(0,0,0,.18)' }} />关卡 Cube · {assigned && applied ? applied : '默认'}</div>
    </div>
    <p>{connected ? 'Tint (Vector Parameter) → Base Color' : '图中只有传统材质根节点。Base Color、Roughness 等输入可见，Front Material 未连接。'}</p>
    {converted && <p><strong>M_FirstSurface_Sub · 转换后的副本</strong>：Tint → 转换的表面网络 → Substrate Slab BSDF → Front Material。下方的颜色和应用操作仍控制原资产。</p>}
    <div className="control-grid">
      <button className="brutal-btn" onClick={() => { setConnected(true); setSaved(false); }} disabled={connected}>创建 Tint 并连接 Base Color</button>
      <StageSegmented<FirstTint> label="Tint 参数" value={tint} options={(Object.keys(FIRST_SURFACE_COLORS) as FirstTint[]).map(value => ({ value, label: value }))} onChange={v => { setTint(v); setSaved(false); }} />
      <button className="brutal-btn" disabled={!connected} onClick={() => { setApplied(tint); setSaved(false); }}>Apply 应用</button>
      <button className="brutal-btn" disabled={!connected || applied !== tint || saved} onClick={() => setSaved(true)}>Save 保存</button>
      <button className="brutal-btn" disabled={!applied || assigned} onClick={() => setAssigned(true)}>赋给 Cube · Element 0</button>
      <button className="brutal-btn" disabled={!saved || converted || !assigned} onClick={() => setConverted(true)}>复制资产，在副本根节点 Convert to Substrate</button>
    </div>
  </div>;
};

const lesson2_4: LessonDefinition = {
  id: 'ue58-editor-tour',
  moduleId: '02',
  number: '2.4',
  title: '第一次进引擎 · 给关卡里的立方体换色',
  subtitle: '创建 M_FirstSurface，验证材质预览、Apply 与关卡赋材质的区别，再在副本中观察 Substrate 转换。',
  duration: '10 分钟',
  difficulty: '零基础',
  steps: [
  {
    "stepNumber": 1,
    "shortLabel": "创建材质",
    "tag": "phenomenon",
    "title": "从空工程创建 M_FirstSurface",
    "paragraphs": [
      "打开一个带默认光照的 Basic 关卡（File → New Level → Basic）。在 Content Browser 空白处右键，选择 Material，命名为 M_FirstSurface，双击打开。"
    ],
    "tryItPrompt": "看预览球和画布。普通新建材质只有传统根节点，表达式数量为 0，Front Material 尚未连接。"
  },
  {
    "stepNumber": 2,
    "shortLabel": "连接颜色",
    "tag": "background",
    "title": "让预览球变成青绿色",
    "paragraphs": [
      "选中根节点，在 Details 确认 Material Domain 为 Surface、Blend Mode 为 Opaque、Shading Model 为 Default Lit。在画布空白处右键搜索 Vector Parameter，命名 Tint，把默认值设成青绿色。将它的 RGB 输出连到根节点 Base Color。"
    ],
    "tryItPrompt": "在舞台创建 Tint 并接线，更换颜色。此时预览球上的颜色会变，右侧关卡立方体仍用默认材质。"
  },
  {
    "stepNumber": 3,
    "shortLabel": "赋给网格",
    "tag": "experiment",
    "title": "在关卡验证颜色",
    "paragraphs": [
      "点击材质编辑器 Apply 并等待编译完成，然后 Save。在关卡中从 Place Actors → Shapes 放一个 Cube，把 M_FirstSurface 从内容浏览器拖到 Cube 上，或在 Details → Materials → Element 0 指定该资产。"
    ],
    "tryItPrompt": "关卡用 Lit 模式观察 Cube。将 Tint 由青绿改为橙色，Apply 后立方体也应变橙，再 Save。若未变化，核对 Element 0 指向的资产与是否完成编译。"
  },
  {
    "stepNumber": 4,
    "shortLabel": "转换副本",
    "tag": "ue5",
    "title": "检查项目设置，在副本中转换",
    "paragraphs": [
      "UE 5.8 新工程默认启用 Substrate；从旧版升级的项目沿用原配置，可在 Project Settings → Rendering 检查 Substrate materials。启用后按提示重启。启用此框架的项目仍可用传统根节点编写材质。"
    ],
    "tryItPrompt": "复制 M_FirstSurface 为 M_FirstSurface_Sub，只在副本上右键根节点选择 Convert to Substrate。找到新增的 Slab 以及通往 Front Material 的 BSDF 连线，核对转换前后的外观。"
  },
  {
    "stepNumber": 5,
    "shortLabel": "留给实例",
    "tag": "pitfall",
    "title": "保留父材质与关卡中的立方体",
    "paragraphs": [
      "保存关卡和 M_FirstSurface。后面的实例练习会从这个父材质创建 MI_FirstSurface，通过 Tint 参数在保持同一套接线时获得另一种颜色。"
    ],
    "tryItPrompt": "验收时指出预览球、材质图和 Details，在关卡中选中 Cube 读出 Element 0 的父材质名，并能从青绿切换到橙色。"
  }
],
  takeaways: [
    '常规新建材质先从传统根节点接线，项目启用 Substrate 与资产显式转换是两个操作。',
    'Apply 编译并更新资产的场景用法，Save 将修改写入资产。网格 Element 0 决定关卡中使用的材质。',
    '保留带 Tint 参数的 M_FirstSurface，后续作为实例的父材质。',
  ],
  schematic: {
    "title": "首个材质与转换后的副本",
    "caption": "上排可直接照接。下排显示副本转换后的终点；转换器会按原材质的属性建立相应的表面网络。",
    "nodes": [
      {
        "id": "param",
        "title": "Tint · Vector Parameter",
        "category": "param",
        "x": 20,
        "y": 40,
        "width": 167,
        "outputs": [
          {
            "id": "p0",
            "label": "RGB",
            "color": "#38bdf8"
          }
        ]
      },
      {
        "id": "root",
        "title": "M_FirstSurface",
        "category": "output",
        "x": 263,
        "y": 40,
        "width": 167,
        "inputs": [
          {
            "id": "p0",
            "label": "Base Color",
            "color": "#38bdf8"
          }
        ]
      },
      {
        "id": "slab",
        "title": "Substrate Slab BSDF",
        "category": "substrate",
        "x": 20,
        "y": 215,
        "width": 167,
        "outputs": [
          {
            "id": "p0",
            "label": "BSDF",
            "color": "#38bdf8"
          }
        ],
        "note": "转换后观察此输出"
      },
      {
        "id": "sub",
        "title": "M_FirstSurface_Sub",
        "category": "output",
        "x": 263,
        "y": 215,
        "width": 167,
        "inputs": [
          {
            "id": "p0",
            "label": "Front Material",
            "color": "#38bdf8"
          }
        ]
      }
    ],
    "edges": [
      {
        "fromNode": "param",
        "fromPin": "p0",
        "toNode": "root",
        "toPin": "p0",
        "color": "#38bdf8"
      },
      {
        "fromNode": "slab",
        "fromPin": "p0",
        "toNode": "sub",
        "toPin": "p0",
        "color": "#38bdf8"
      }
    ]
  },
  StageComponent: Ue58EditorTourStage,
};

export const modules01_02: ModuleDefinition[] = [
  {
    id: '01',
    number: '01',
    title: '万物归零背景课',
    subtitle: '光、显卡与 3D 世界的底层常识',
    lessons: [lesson1_1, lesson1_2, lesson1_3, lesson1_4],
  },
  {
    id: '02',
    number: '02',
    title: '材质编辑器初体验',
    subtitle: '数字语言、算术五件套与剥橘子皮 UV',
    lessons: [lesson2_1, lesson2_2, lesson2_3, lesson2_4],
  },
];
