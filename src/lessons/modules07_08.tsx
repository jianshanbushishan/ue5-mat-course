import React, { useState, useEffect, useRef } from 'react';
import { ModuleDefinition, LessonStageProps, SchematicDiagram } from '../types/course';
import {
  Vec3,
  clamp,
  saturate,
  lerp,
  lerp3,
  dot3,
  norm3,
  add3,
  reflect3,
  srgbToLinear,
  linearToSrgb,
  acesTonemap,
  valueNoise,
  fbm,
  sampleEnvMap,
  shadePbrPixel,
} from '../lib/graphics';
import {
  StageSlider,
  StageSegmented,
  StageToggle,
  PitfallCompareBar,
} from '../components/ui/StageWidgets';

/* ============================================================================
 * 共享工具函数：颜色转换与抗锯齿球体画布辅助
 * ============================================================================ */

function hslToSrgb(hDeg: number, s: number, l: number): Vec3 {
  const h = ((hDeg % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return [clamp(r1 + m, 0, 1), clamp(g1 + m, 0, 1), clamp(b1 + m, 0, 1)];
}

function srgbVecToHex(c: Vec3): string {
  const toHex = (v: number) =>
    Math.round(clamp(v, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${toHex(c[0])}${toHex(c[1])}${toHex(c[2])}`;
}

function linearVecToSrgbHex(lin: Vec3): string {
  return srgbVecToHex([
    linearToSrgb(clamp(lin[0], 0, 1)),
    linearToSrgb(clamp(lin[1], 0, 1)),
    linearToSrgb(clamp(lin[2], 0, 1)),
  ]);
}

function stageBgBackdrop(
  px: number,
  py: number,
  w: number,
  h: number,
  isDark: boolean,
  mode: 'neutral' | 'sunny' | 'cave' | 'black' = 'neutral'
): Vec3 {
  const v = py / h;
  if (mode === 'black') {
    const checker = ((Math.floor(px / 14) + Math.floor(py / 14)) & 1) === 0 ? 0.045 : 0.065;
    return [checker, checker, checker + 0.008];
  }
  if (mode === 'cave') {
    return lerp3([0.11, 0.09, 0.12], [0.05, 0.045, 0.06], v);
  }
  if (mode === 'sunny') {
    return v < 0.62
      ? lerp3([0.38, 0.62, 0.91], [0.78, 0.87, 0.96], v / 0.62)
      : lerp3([0.74, 0.66, 0.52], [0.49, 0.41, 0.31], (v - 0.62) / 0.38);
  }
  return isDark
    ? lerp3([0.15, 0.14, 0.13], [0.09, 0.085, 0.08], v)
    : lerp3([0.95, 0.93, 0.89], [0.87, 0.84, 0.78], v);
}

/* ============================================================================
 * 7.1 漫反射（Diffuse）从零讲透 —— 钻进表皮乱撞的光、手电筒斜照投影与视角无关性
 * ============================================================================ */

const Stage7_1_DiffuseLambert: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [sunDeg, setSunDeg] = useState<number>(35); // 0° 正头顶 -> 130° 背光面
  const [camDeg, setCamDeg] = useState<number>(0); // -62° .. +62° 绕固定测光点旋转镜头
  const [clampNeg, setClampNeg] = useState<boolean>(true);
  const [halfLambert, setHalfLambert] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setSunDeg(35);
    setCamDeg(0);
    setClampNeg(true);
    setHalfLambert(false);
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 4) {
      setSunDeg(55);
      setClampNeg(false);
      setHalfLambert(false);
    } else if (stepIndex === 2) {
      setClampNeg(true);
    }
  }, [stepIndex, resetSignal]);

  // 世界空间固定测光点 P：法线 N_P = (0, 0, 1) 正朝前
  const sunRad = (sunDeg * Math.PI) / 180;
  const rawDotP = Math.cos(sunRad);
  const effDotP = halfLambert
    ? Math.pow(rawDotP * 0.5 + 0.5, 2)
    : clampNeg
      ? Math.max(0, rawDotP)
      : rawDotP;

  // 环境弱蓝补光（用于展示负数未截断时吃掉背光补光的踩坑现象）
  const envBlueFill: Vec3 = [0.035, 0.075, 0.165];
  const clayLinear: Vec3 = [0.62, 0.21, 0.14];
  const lightPower = 1.35;

  const pRadianceR = clayLinear[0] * effDotP * lightPower + envBlueFill[0];
  const pRadianceG = clayLinear[1] * effDotP * lightPower + envBlueFill[1];
  const pRadianceB = clayLinear[2] * effDotP * lightPower + envBlueFill[2];
  const pLumaPct = Math.round(
    clamp(
      0.2126 * Math.max(0, pRadianceR) +
        0.7152 * Math.max(0, pRadianceG) +
        0.0722 * Math.max(0, pRadianceB),
      0,
      1.5
    ) * 100
  );

  const isBacklit = rawDotP <= 0.08;
  const spreadRatioNum = !isBacklit ? 1 / rawDotP : null;
  const spreadRatio = spreadRatioNum !== null ? spreadRatioNum.toFixed(2) + '×' : '背光未照到';

  useEffect(() => {
    const modeLabel = halfLambert
      ? 'Half-Lambert 柔化'
      : clampNeg
        ? '标准 Max(0, Dot)'
        : '⚠️ 未截断负数吸光';
    onKpiUpdate([
      {
        label: 'P点 Dot(N, L)',
        value: rawDotP.toFixed(2),
        sub: rawDotP < 0 ? '太阳转入背面 (<0)' : `夹角 ${sunDeg}°`,
        tone: rawDotP < 0 && !clampNeg && !halfLambert ? 'bad' : 'accent',
      },
      {
        label: 'P点漫反射读数',
        value: `${pLumaPct}%`,
        sub: `镜头角 ${camDeg > 0 ? '+' : ''}${camDeg}° · 亮度恒定`,
        tone: 'good',
      },
      {
        label: '光斑摊开面积',
        value: spreadRatio,
        sub: rawDotP > 0.08 ? '越斜单位面积越暗' : '处于阴影背面',
        tone: rawDotP > 0.5 ? 'good' : 'warn',
      },
      {
        label: '背光处理规则',
        value: modeLabel,
        sub: !clampNeg && !halfLambert ? '负数吞噬蓝色补光!' : '暗部蓝调补光正常',
        tone: !clampNeg && !halfLambert ? 'bad' : 'neutral',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sunDeg, camDeg, clampNeg, halfLambert]);

  // 绘制右侧 3D 哑光陶土球（支持摄像机绕世界空间球体真实环绕，验证 P 点亮度完全不随视角变化）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 230;
    const H = 230;
    const img = ctx.createImageData(W, H);
    const data = img.data;

    const cx = W * 0.5;
    const cy = H * 0.5;
    const R = 84;

    const camRad = (camDeg * Math.PI) / 180;
    const cosC = Math.cos(camRad);
    const sinC = Math.sin(camRad);

    // 世界空间太阳方向 L_world（在 XZ 平面加一点上方仰角更立体，但为了与左图 cos(sunDeg) 严格一致，让 L 在 XZ 平面旋转）
    const Lw: Vec3 = norm3([Math.sin(sunRad), 0.16, Math.cos(sunRad)]);

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;
        const bg = stageBgBackdrop(px, py, W, H, isDark, 'neutral');

        // 地面柔和接触投影
        const shDx = (px - cx) / (R * 0.92);
        const shDy = (py - (cy + R + 10)) / 13;
        const shDist = shDx * shDx + shDy * shDy;
        let bgR = bg[0];
        let bgG = bg[1];
        let bgB = bg[2];
        if (shDist < 1) {
          const att = 1 - (1 - shDist) * 0.35;
          bgR *= att;
          bgG *= att;
          bgB *= att;
        }

        const dx = px + 0.5 - cx;
        const dy = cy - (py + 0.5);
        const dist = Math.hypot(dx, dy);
        const cov = clamp(R + 0.65 - dist, 0, 1);

        if (cov <= 0) {
          data[idx] = Math.round(bgR * 255);
          data[idx + 1] = Math.round(bgG * 255);
          data[idx + 2] = Math.round(bgB * 255);
          data[idx + 3] = 255;
          continue;
        }

        const rNorm = Math.min(0.9995, dist / R);
        const scaleXY = dist > 1e-5 ? rNorm / (dist / R) : 1;
        const nCamX = (dx / R) * scaleXY;
        const nCamY = (dy / R) * scaleXY;
        const nCamZ = Math.sqrt(Math.max(0.0004, 1 - nCamX * nCamX - nCamY * nCamY));

        // 摄像机绕 Y 轴环绕 camRad 后，将该像素转回固定世界空间法线 N_world
        const nwX = nCamX * cosC + nCamZ * sinC;
        const nwY = nCamY;
        const nwZ = -nCamX * sinC + nCamZ * cosC;

        const ndotlRaw = nwX * Lw[0] + nwY * Lw[1] + nwZ * Lw[2];
        const diffTerm = halfLambert
          ? Math.pow(ndotlRaw * 0.5 + 0.5, 2)
          : clampNeg
            ? Math.max(0, ndotlRaw)
            : ndotlRaw;

        // 背光侧放置一盏微弱蓝天环境补光灯（世界左后侧）
        const rimFactor = saturate(0.55 - nwX * 0.45 + nwY * 0.25);
        const fillR = envBlueFill[0] * (0.65 + 0.7 * rimFactor);
        const fillG = envBlueFill[1] * (0.65 + 0.7 * rimFactor);
        const fillB = envBlueFill[2] * (0.65 + 0.7 * rimFactor);

        // 若未截断负数，diffTerm 为负值，会直接把蓝色环境补光吞噬成死黑！
        const linR = Math.max(0, clayLinear[0] * diffTerm * lightPower + fillR);
        const linG = Math.max(0, clayLinear[1] * diffTerm * lightPower + fillG);
        const linB = Math.max(0, clayLinear[2] * diffTerm * lightPower + fillB);

        const sr = linearToSrgb(acesTonemap(linR));
        const sg = linearToSrgb(acesTonemap(linG));
        const sb = linearToSrgb(acesTonemap(linB));

        // 当处于踩坑未截断负数时，给被负数吞噬的区域画一道暗红警示微光轮廓线便于观察
        let warnTint = 0;
        if (!clampNeg && !halfLambert && ndotlRaw < -0.02 && ndotlRaw > -0.09) {
          warnTint = 0.55;
        }

        const outR = lerp(bgR, lerp(sr, 0.95, warnTint), cov);
        const outG = lerp(bgG, lerp(sg, 0.22, warnTint), cov);
        const outB = lerp(bgB, lerp(sb, 0.18, warnTint), cov);

        data[idx] = Math.round(clamp(outR, 0, 1) * 255);
        data[idx + 1] = Math.round(clamp(outG, 0, 1) * 255);
        data[idx + 2] = Math.round(clamp(outB, 0, 1) * 255);
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);

    // 在球面固定世界点 P (0, 0, 1) 的屏幕投影位置画出测光十字准星！
    // 世界点 (0, 0, 1) 在摄像机空间的坐标：x_cam = -sin(camRad), y_cam = 0, z_cam = cos(camRad)
    const pxPin = cx - R * sinC;
    const pyPin = cy;

    ctx.save();
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pxPin, pyPin, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(pxPin, pyPin, 2.3, 0, Math.PI * 2);
    ctx.fill();

    // 测光点引出标签
    const labelX = clamp(pxPin - 48, 8, W - 118);
    const labelY = pyPin - 28;
    ctx.fillStyle = 'rgba(20, 18, 16, 0.84)';
    ctx.beginPath();
    ctx.roundRect(labelX, labelY, 112, 20, 5);
    ctx.fill();
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 10.5px sans-serif';
    ctx.fillText(`📍 P点亮度: ${pLumaPct}% 恒定`, labelX + 6, labelY + 13.5);

    if (!clampNeg && !halfLambert) {
      ctx.fillStyle = 'rgba(145, 24, 18, 0.88)';
      ctx.beginPath();
      ctx.roundRect(10, H - 28, W - 20, 21, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10.5px sans-serif';
      ctx.fillText('⚠️ 负数未截断：背光侧把蓝色环境补光吸成死黑！', 16, H - 14);
    }
    ctx.restore();
  }, [sunDeg, camDeg, clampNeg, halfLambert, isDark, sunRad, pLumaPct]);

  // 左侧 SVG 几何参数：手电筒光束摊薄 + 表皮色素弹珠均匀散射（太阳在右侧 +X，与右图 3D 球严格同侧）
  const beamHalfW = 20;
  const clampedSunRad = (Math.min(82, sunDeg) * Math.PI) / 180;
  const footprintHalf = isBacklit ? 0 : Math.min(92, beamHalfW / Math.max(0.16, Math.cos(clampedSunRad)));
  const srcDist = 86;
  const srcX = 135 + Math.sin(sunRad) * srcDist;
  const srcY = 108 - Math.cos(sunRad) * srcDist;
  const beamSrcX = 135 + Math.sin(clampedSunRad) * srcDist;
  const beamSrcY = 108 - Math.cos(clampedSunRad) * srcDist;

  const camArcRad = (camDeg * Math.PI) / 180;
  const eyeX = 135 + Math.sin(camArcRad) * 74;
  const eyeY = 108 - Math.cos(camArcRad) * 74;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={!clampNeg && !halfLambert}
        pitfallLabel="踩坑：直接用裸 Dot(N,L)，背光负数(-0.8)把暗部蓝色环境补光吸成黑洞"
        correctLabel={
          halfLambert
            ? '进阶：Half-Lambert (Dot×0.5+0.5)² 柔和包裹背光暗部'
            : '正解：套上 Max(0, Dot) 截断负数，暗部安静保留蓝色环境补光'
        }
        onToggle={(pit) => {
          if (pit) {
            setHalfLambert(false);
            setClampNeg(false);
            if (sunDeg < 45) setSunDeg(62);
          } else {
            setClampNeg(true);
          }
        }}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: 10,
        }}
      >
        {/* 左舱：表皮弹珠散射 + 手电筒斜照投影摊薄图 */}
        <div
          style={{
            background: isDark ? '#1e1b18' : '#fffdf9',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700 }}>
            <span>🔬 微观剖面：表皮乱撞散射 & 手电筒摊薄</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              cos({sunDeg}°) = {rawDotP.toFixed(2)}
            </span>
          </div>

          <svg viewBox="0 0 270 198" style={{ width: '100%', height: 'auto', borderRadius: 8 }}>
            <rect
              x="0"
              y="0"
              width="270"
              height="108"
              fill={isDark ? '#171513' : '#f4efe4'}
            />
            {/* 表皮以下红苹果/陶土颗粒层 */}
            <rect x="0" y="108" width="270" height="90" fill={isDark ? '#42201a' : '#ebbfb3'} />
            <line x1="0" y1="108" x2="270" y2="108" stroke="#c2410c" strokeWidth="2.2" />

            {/* 表皮下方微米颜料颗粒 + 乱撞弹珠路径 */}
            {[32, 65, 96, 122, 148, 174, 205, 238].map((gx, i) => (
              <circle
                key={i}
                cx={gx}
                cy={124 + (i % 3) * 14}
                r={5 + (i % 2) * 2}
                fill="#dc2626"
                opacity={0.75}
              />
            ))}
            {!isBacklit && (
              <polyline
                points="135,108 124,124 142,136 131,120 135,108"
                fill="none"
                stroke="#facc15"
                strokeWidth="1.6"
                strokeDasharray="2 2"
              />
            )}

            {/* 手电筒平行光束投影区 */}
            {!isBacklit ? (
              <>
                <polygon
                  points={`${beamSrcX - Math.cos(clampedSunRad) * beamHalfW},${beamSrcY - Math.sin(clampedSunRad) * beamHalfW} ${beamSrcX + Math.cos(clampedSunRad) * beamHalfW},${beamSrcY + Math.sin(clampedSunRad) * beamHalfW} ${135 + footprintHalf},108 ${135 - footprintHalf},108`}
                  fill="rgba(250, 204, 21, 0.24)"
                  stroke="rgba(234, 179, 8, 0.65)"
                  strokeWidth="1"
                />
                {/* 受光摊开宽度高亮条 */}
                <line
                  x1={135 - footprintHalf}
                  y1={108}
                  x2={135 + footprintHalf}
                  y2={108}
                  stroke="#facc15"
                  strokeWidth="4.5"
                />
              </>
            ) : (
              <text x="58" y="64" fill="#ef4444" fontSize="10.5" fontWeight="bold">
                太阳转到地平线背面 (Dot &lt; 0)
              </text>
            )}

            {/* 漫反射均匀 180° 半球散射扇形小箭头（长度只随太阳角度变，和镜头 V 无关！） */}
            {[-72, -48, -24, 0, 24, 48, 72].map((ang) => {
              const rad = (ang * Math.PI) / 180;
              const len = Math.max(4, Math.max(0, effDotP) * 48);
              const tx = 135 + Math.sin(rad) * len;
              const ty = 108 - Math.cos(rad) * len;
              return (
                <line
                  key={ang}
                  x1={135}
                  y1={108}
                  x2={tx}
                  y2={ty}
                  stroke="#ef4444"
                  strokeWidth="2"
                  opacity={len > 5 ? 0.9 : 0.2}
                />
              );
            })}

            {/* 法线小牙签 N */}
            <line x1="135" y1="108" x2="135" y2="32" stroke="#3b82f6" strokeWidth="2.2" strokeDasharray="4 2" />
            <text x="140" y="38" fill="#3b82f6" fontSize="10.5" fontWeight="bold">
              法线 N
            </text>

            {/* 太阳图标 */}
            <circle cx={clamp(srcX, 16, 254)} cy={clamp(srcY, 16, 182)} r="9" fill="#f59e0b" stroke="#1e1b18" strokeWidth="1.5" />
            <text
              x={clamp(srcX - 18, 6, 215)}
              y={clamp(srcY - 13, 12, 192)}
              fill={isDark ? '#fde68a' : '#92400e'}
              fontSize="10"
              fontWeight="bold"
            >
              太阳 L
            </text>

            {/* 环绕移动的摄像机眼睛 V */}
            <g transform={`translate(${eyeX}, ${eyeY})`}>
              <circle cx="0" cy="0" r="9" fill="#22c55e" stroke="#1e1b18" strokeWidth="1.5" />
              <text x="-16" y="-12" fill={isDark ? '#86efac' : '#166534'} fontSize="10" fontWeight="bold">
                镜头 V
              </text>
            </g>

            <text x="10" y="168" fill={isDark ? '#f5d0c5' : '#5c1d13'} fontSize="10.5" fontWeight="bold">
              光子钻进颜料颗粒乱撞 → 朝 180° 均匀喷洒
            </text>
            <text x="10" y="184" fill={isDark ? '#d6c7b8' : '#6e473b'} fontSize="10">
              {spreadRatioNum !== null
                ? `当前光斑被拉宽到 ${spreadRatioNum.toFixed(2)} 倍，越斜光越稀薄`
                : '背光侧正面无直射光，必须截断负数防吸光'}
            </text>
          </svg>
        </div>

        {/* 右舱：3D 哑光陶土球 + 视角无关性光度计 */}
        <div
          style={{
            background: isDark ? '#1e1b18' : '#fffdf9',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            <span>🏺 3D 陶土球实测：转镜头看 P 点亮度</span>
            <span style={{ color: '#16a34a', fontFamily: 'var(--font-mono)' }}>
              波动: 0.0%
            </span>
          </div>

          <canvas
            ref={canvasRef}
            width={230}
            height={230}
            style={{
              width: 206,
              height: 206,
              borderRadius: 10,
              border: '1.5px solid var(--border-soft)',
            }}
          />
        </div>
      </div>

      {/* 底部交互控制台 */}
      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSlider
            label="☀️ 太阳倾斜角 θ (改变 L)"
            value={sunDeg}
            min={0}
            max={130}
            step={1}
            unit="°"
            onChange={setSunDeg}
          />
          <StageSlider
            label="🎥 摄像机环绕角 (只动视角 V)"
            value={camDeg}
            min={-62}
            max={62}
            step={1}
            formatValue={(v) => `${v > 0 ? '+' : ''}${v}° (P点保持 ${pLumaPct}%)`}
            onChange={setCamDeg}
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <StageToggle
            label="Max(0, Dot) 截断背光负数"
            checked={clampNeg}
            hint="防暗部吸光"
            onChange={(v) => {
              setClampNeg(v);
              if (v) setHalfLambert(false);
            }}
          />
          <StageToggle
            label="Half-Lambert 半兰伯特柔化"
            checked={halfLambert}
            hint="(Dot×0.5+0.5)² 角色常用"
            onChange={(v) => {
              setHalfLambert(v);
              if (v) setClampNeg(true);
            }}
          />
        </div>
      </div>
    </div>
  );
};

const schematic7_1: SchematicDiagram = {
  title: '兰伯特漫反射（Lambert Diffuse）核心节点流向',
  caption: '建立 Surface / Unlit 材质。LightDirWS 是手动输入、由表面指向光源的世界空间单位向量。把演示颜色接 Emissive Color。',
  nodes: [
    {
      id: 'n_normal',
      title: 'PixelNormalWS',
      subtitle: '像素表面法线小牙签 N',
      category: 'input',
      x: 20,
      y: 28,
      width: 175,
      outputs: [{ id: 'xyz', label: 'XYZ 朝向', color: '#3b82f6' }],
    },
    {
      id: 'n_light',
      title: 'Vector Parameter · LightDirWS',
      subtitle: '单位向量，例如 (0, 0, 1)',
      category: 'input',
      x: 20,
      y: 138,
      width: 175,
      outputs: [{ id: 'xyz', label: 'XYZ 阳光方向', color: '#f59e0b' }],
    },
    {
      id: 'n_dot',
      title: 'Dot (点乘)',
      subtitle: '直接算出 cos θ',
      category: 'math',
      x: 235,
      y: 72,
      width: 155,
      inputs: [
        { id: 'a', label: 'A (N)', color: '#3b82f6' },
        { id: 'b', label: 'B (L)', color: '#f59e0b' },
      ],
      outputs: [{ id: 'out', label: '-1 ~ +1', color: '#e5e7eb' }],
      note: '正对=1 · 擦边=0 · 背光<0',
    },
    {
      id: 'n_sat',
      title: 'Max(0, X) / Saturate',
      subtitle: '切掉背光负数防吸光',
      category: 'math',
      x: 425,
      y: 72,
      width: 170,
      inputs: [{ id: 'in', label: 'Input', color: '#e5e7eb' }],
      outputs: [{ id: 'out', label: '0 ~ 1 受光比', color: '#22c55e' }],
    },
    {
      id: 'n_albedo',
      title: 'BaseColor 贴图',
      subtitle: '表皮色素挑食底色',
      category: 'texture',
      x: 425,
      y: 192,
      width: 170,
      previewColor: '#b8432e',
      outputs: [{ id: 'rgb', label: 'RGB 颜料色', color: '#ef4444' }],
    },
    {
      id: 'n_mul',
      title: 'Multiply (漫反射合成)',
      subtitle: '完全不含摄像机 V！',
      category: 'output',
      x: 635,
      y: 118,
      width: 180,
      inputs: [
        { id: 'a', label: 'A (受光比)', color: '#22c55e' },
        { id: 'b', label: 'B (颜料色)', color: '#ef4444' },
      ],
      outputs: [{ id: 'out', label: '漫反射亮度', color: '#ef4444' }],
      note: '视角怎么转亮度都恒定',
    },
    { id: 'unlit', title: '材质根节点', subtitle: 'Surface / Unlit', category: 'output', x: 845, y: 118, width: 160,
      inputs: [{ id: 'em', label: 'Emissive Color', color: '#ef4444' }] },
  ],
  edges: [
    { fromNode: 'n_normal', fromPin: 'xyz', toNode: 'n_dot', toPin: 'a', color: '#3b82f6' },
    { fromNode: 'n_light', fromPin: 'xyz', toNode: 'n_dot', toPin: 'b', color: '#f59e0b' },
    { fromNode: 'n_dot', fromPin: 'out', toNode: 'n_sat', toPin: 'in', color: '#e5e7eb' },
    { fromNode: 'n_sat', fromPin: 'out', toNode: 'n_mul', toPin: 'a', color: '#22c55e' },
    { fromNode: 'n_albedo', fromPin: 'rgb', toNode: 'n_mul', toPin: 'b', color: '#ef4444' },
    { fromNode: 'n_mul', fromPin: 'out', toNode: 'unlit', toPin: 'em', color: '#ef4444' },
  ],
};

/* ============================================================================
 * 7.2 镜面反射（Specular）从零讲透 —— 表皮直接弹走的光、角平分线与“金属其实靠照镜子”
 * ============================================================================ */

const Stage7_2_SpecularIblAniso: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [envEnabled, setEnvEnabled] = useState<boolean>(true);
  const [matKind, setMatKind] = useState<'chrome' | 'redcoat'>('chrome');
  const [sunAngle, setSunAngle] = useState<number>(28); // -70 .. +70
  const [viewAngle, setViewAngle] = useState<number>(-28); // -70 .. +70
  const [roughness, setRoughness] = useState<number>(0.07);
  const [anisotropy, setAnisotropy] = useState<number>(0.0);
  const [brushStyle, setBrushStyle] = useState<'linear' | 'radial'>('linear');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setEnvEnabled(true);
    setMatKind('chrome');
    setSunAngle(28);
    setViewAngle(-28);
    setRoughness(0.07);
    setAnisotropy(0.0);
    setBrushStyle('linear');
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 4) {
      setMatKind('chrome');
      setRoughness(0.06);
      setEnvEnabled(false);
    } else if (stepIndex === 0) {
      setEnvEnabled(true);
    }
  }, [stepIndex, resetSignal]);

  // 2D 平面角平分线 H 计算（N 朝正上方 (0, 1)）
  const lRad = (sunAngle * Math.PI) / 180;
  const vRad = (viewAngle * Math.PI) / 180;
  const L2: Vec3 = [Math.sin(lRad), Math.cos(lRad), 0];
  const V2: Vec3 = [Math.sin(vRad), Math.cos(vRad), 0];
  const H2: Vec3 = norm3(add3(L2, V2));
  const ndotH = Math.max(0, H2[1]); // 与 N=(0,1,0) 的点乘
  const isGlintHit = ndotH > 0.985;

  useEffect(() => {
    onKpiUpdate([
      {
        label: '周围环境反射 (IBL)',
        value: envEnabled ? '已开启 (蓝天街道)' : '🌑 已关闭 (纯黑暗室)',
        sub: envEnabled ? '银球映出四周万物' : '纯银球瞬间变黑球！',
        tone: envEnabled ? 'good' : 'bad',
      },
      {
        label: '角平分线对准度',
        value: `Dot(N,H) = ${ndotH.toFixed(3)}`,
        sub: isGlintHit ? '⚡ 正中反射路线！' : '调对称角度可抓高光',
        tone: isGlintHit ? 'good' : 'accent',
      },
      {
        label: '各向异性拉丝',
        value: anisotropy > 0.02 ? `${Math.round(anisotropy * 100)}% (${brushStyle === 'radial' ? '锅底环纹' : '横向拉丝'})` : '0% (圆形高光)',
        sub: anisotropy > 0.02 ? '高光沿微划痕拉长' : '各向同性光滑面',
        tone: anisotropy > 0.02 ? 'accent' : 'neutral',
      },
      {
        label: '当前材质身份',
        value: matKind === 'chrome' ? '100% 纯银电镀球' : '光滑红漆塑料球',
        sub: matKind === 'chrome' ? '漫反射=0 · 全靠照镜子' : '红底漫反射 + 4%白高光',
        tone: 'neutral',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envEnabled, matKind, sunAngle, viewAngle, roughness, anisotropy, brushStyle]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 236;
    const H = 236;
    const img = ctx.createImageData(W, H);
    const data = img.data;
    const cx = W * 0.5;
    const cy = H * 0.5;
    const R = 88;

    const L3: Vec3 = norm3([Math.sin(lRad), 0.42, Math.cos(lRad)]);
    const V3: Vec3 = norm3([-Math.sin(vRad) * 0.55, 0.08, Math.cos(vRad)]);
    const baseLinear: Vec3 = matKind === 'chrome' ? [0.96, 0.95, 0.93] : [0.58, 0.05, 0.04];
    const metallic = matKind === 'chrome' ? 1.0 : 0.0;
    const envMode = envEnabled ? 'sunny' : 'black';

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;
        const bg = stageBgBackdrop(px, py, W, H, isDark, envEnabled ? 'sunny' : 'black');

        const dx = px + 0.5 - cx;
        const dy = cy - (py + 0.5);
        const dist = Math.hypot(dx, dy);
        const cov = clamp(R + 0.65 - dist, 0, 1);

        if (cov <= 0) {
          data[idx] = Math.round(bg[0] * 255);
          data[idx + 1] = Math.round(bg[1] * 255);
          data[idx + 2] = Math.round(bg[2] * 255);
          data[idx + 3] = 255;
          continue;
        }

        const rNorm = Math.min(0.9995, dist / R);
        const scaleXY = dist > 1e-5 ? rNorm / (dist / R) : 1;
        const nx = (dx / R) * scaleXY;
        const ny = (dy / R) * scaleXY;
        const nz = Math.sqrt(Math.max(0.0004, 1 - nx * nx - ny * ny));
        const N: Vec3 = [nx, ny, nz];

        let tangent: Vec3 = [1, 0, 0];
        if (brushStyle === 'radial') {
          // 锅底同心圆划痕沿圆周方向光滑、沿径向粗糙：T 取径向切线，B 为圆周方向，使高光沿径向拉成辐射状蝴蝶结光带
          const r2d = Math.hypot(nx, ny);
          tangent = r2d > 0.015 ? norm3([(nx * nz) / r2d, (ny * nz) / r2d, -r2d]) : [1, 0, 0];
        } else {
          // 横向拉丝切线正交化（使高光竖向拉长，或切线竖向使高光横向拉长）
          tangent = norm3([-nx * ny, 1 - ny * ny, -nz * ny]);
        }

        const col = shadePbrPixel({
          N,
          V: V3,
          L: L3,
          baseColorLinear: baseLinear,
          metallic,
          roughness,
          envMode,
          anisotropy,
          tangent,
          lightIntensity: 2.8,
        });

        data[idx] = Math.round(lerp(bg[0], col[0], cov) * 255);
        data[idx + 1] = Math.round(lerp(bg[1], col[1], cov) * 255);
        data[idx + 2] = Math.round(lerp(bg[2], col[2], cov) * 255);
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);

    if (!envEnabled && matKind === 'chrome') {
      ctx.save();
      ctx.fillStyle = 'rgba(18, 16, 15, 0.86)';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(10, H - 32, W - 20, 24, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fde68a';
      ctx.font = 'bold 10.5px sans-serif';
      ctx.fillText('💡 暗室无环境可照：纯银球只剩针尖白点！', 17, H - 16);
      ctx.restore();
    }
  }, [envEnabled, matKind, lRad, vRad, roughness, anisotropy, brushStyle, isDark]);

  // 角平分线 H 几何图坐标
  const ox = 130;
  const oy = 148;
  const vecLen = 92;
  const R2 = reflect3([-L2[0], -L2[1], 0], [0, 1, 0]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={!envEnabled}
        pitfallLabel="关闭环境贡献，固定当前材质、方向光与曝光；观察高光以外的区域"
        correctLabel="恢复环境贡献，观察同一表面的环境倒影"
        onToggle={(pit) => setEnvEnabled(!pit)}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 10,
        }}
      >
        {/* 左：3D 暗室黑银球 & 各向异性拉丝实验舱 */}
        <div
          style={{
            background: isDark ? '#1e1b18' : '#fffdf9',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <div
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            <span>🪞 暗室黑银球 & 拉丝高光实测</span>
            <button
              type="button"
              onClick={() => setEnvEnabled((v) => !v)}
              style={{
                padding: '3px 9px',
                borderRadius: 6,
                border: '1.5px solid var(--border-strong)',
                background: envEnabled ? 'var(--accent-sky)' : 'var(--accent-coral)',
                color: envEnabled ? 'var(--accent-sky-deep)' : 'var(--accent-coral-deep)',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {envEnabled ? '🌞 环境反射：开 (点击关灯进暗室)' : '🌑 暗室模式：关 (点击开天空球)'}
            </button>
          </div>

          <canvas
            ref={canvasRef}
            width={236}
            height={236}
            style={{
              width: 210,
              height: 210,
              borderRadius: 10,
              border: '1.5px solid var(--border-soft)',
            }}
          />
        </div>

        {/* 右：台球撞库反射与半程向量 H = normalize(L + V) 追踪仪 */}
        <div
          style={{
            background: isDark ? '#1e1b18' : '#fffdf9',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700 }}>
            <span>📐 角平分线 H = Normalize(L + V) 瞄准仪</span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                color: isGlintHit ? '#16a34a' : 'var(--text-muted)',
              }}
            >
              {isGlintHit ? '⚡ 高光刺眼命中!' : `N·H = ${ndotH.toFixed(2)}`}
            </span>
          </div>

          <svg viewBox="0 0 260 195" style={{ width: '100%', height: 'auto', borderRadius: 8 }}>
            <rect x="0" y="0" width="260" height="148" fill={isDark ? '#161412' : '#f4efe4'} />
            <rect x="0" y="148" width="260" height="47" fill={isDark ? '#2c2723' : '#dcd3c2'} />
            <line x1="0" y1="148" x2="260" y2="148" stroke="#64748b" strokeWidth="2.5" />

            {/* 镜面反射真实弹射路线 R（虚线） */}
            <line
              x1={ox}
              y1={oy}
              x2={ox + R2[0] * vecLen}
              y2={oy - R2[1] * vecLen}
              stroke="#94a3b8"
              strokeWidth="1.6"
              strokeDasharray="4 3"
            />
            <text
              x={clamp(ox + R2[0] * (vecLen + 8) - 16, 6, 215)}
              y={clamp(oy - R2[1] * (vecLen + 8), 14, 140)}
              fill="#94a3b8"
              fontSize="9.5"
            >
              反射光 R
            </text>

            {/* 表面法线小牙签 N */}
            <line x1={ox} y1={oy} x2={ox} y2={oy - vecLen - 8} stroke="#3b82f6" strokeWidth="2.4" />
            <text x={ox - 18} y={oy - vecLen - 13} fill="#3b82f6" fontSize="10.5" fontWeight="bold">
              法线 N
            </text>

            {/* 太阳向量 L */}
            <line
              x1={ox}
              y1={oy}
              x2={ox + L2[0] * vecLen}
              y2={oy - L2[1] * vecLen}
              stroke="#f59e0b"
              strokeWidth="2.6"
            />
            <circle cx={ox + L2[0] * vecLen} cy={oy - L2[1] * vecLen} r="6" fill="#f59e0b" />
            <text
              x={clamp(ox + L2[0] * vecLen - 16, 6, 220)}
              y={clamp(oy - L2[1] * vecLen - 10, 14, 142)}
              fill="#f59e0b"
              fontSize="10.5"
              fontWeight="bold"
            >
              太阳 L
            </text>

            {/* 视线向量 V */}
            <line
              x1={ox}
              y1={oy}
              x2={ox + V2[0] * vecLen}
              y2={oy - V2[1] * vecLen}
              stroke="#22c55e"
              strokeWidth="2.6"
            />
            <circle cx={ox + V2[0] * vecLen} cy={oy - V2[1] * vecLen} r="6" fill="#22c55e" />
            <text
              x={clamp(ox + V2[0] * vecLen - 16, 6, 220)}
              y={clamp(oy - V2[1] * vecLen - 10, 14, 142)}
              fill="#22c55e"
              fontSize="10.5"
              fontWeight="bold"
            >
              眼睛 V
            </text>

            {/* 角平分线 半程向量 H */}
            <line
              x1={ox}
              y1={oy}
              x2={ox + H2[0] * (vecLen * 0.92)}
              y2={oy - H2[1] * (vecLen * 0.92)}
              stroke="#ec4899"
              strokeWidth="3"
            />
            <circle
              cx={ox + H2[0] * (vecLen * 0.92)}
              cy={oy - H2[1] * (vecLen * 0.92)}
              r="4.5"
              fill="#ec4899"
            />
            <text
              x={clamp(ox + H2[0] * 70 + 6, 8, 178)}
              y={clamp(oy - H2[1] * 70, 22, 136)}
              fill="#ec4899"
              fontSize="10.5"
              fontWeight="bold"
            >
              角平分线 H
            </text>

            <text x="10" y="166" fill={isDark ? '#e7e0d6' : '#292524'} fontSize="10.5" fontWeight="bold">
              判据：当粉线 H 与蓝牙签 N 重合，高光正射入眼！
            </text>
            <text x="10" y="182" fill={isDark ? '#b8afa2' : '#57534e'} fontSize="10">
              头一歪 V 改变 → H 立刻偏离 N → 镜面高光跟着跑掉！
            </text>
          </svg>
        </div>
      </div>

      {/* 控制台 */}
      <div className="stage-controls-panel">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' }}>
          <StageSegmented
            label="材质表面类型"
            value={matKind}
            options={[
              { value: 'chrome', label: '🪞 100% 纯银电镀球' },
              { value: 'redcoat', label: '🍎 光滑红漆塑料球' },
            ]}
            onChange={setMatKind}
          />
          <StageSegmented
            label="拉丝划痕方向 (各向异性 > 0 时生效)"
            value={brushStyle}
            options={[
              { value: 'linear', label: '➖ 横向不锈钢拉丝' },
              { value: 'radial', label: '💿 锅底同心圆环纹' },
            ]}
            onChange={setBrushStyle}
          />
        </div>

        <div className="control-grid">
          <StageSlider
            label="☀️ 太阳方向角 L"
            value={sunAngle}
            min={-68}
            max={68}
            step={1}
            unit="°"
            onChange={setSunAngle}
          />
          <StageSlider
            label="👀 眼睛观察角 V"
            value={viewAngle}
            min={-68}
            max={68}
            step={1}
            unit="°"
            onChange={setViewAngle}
          />
          <StageSlider
            label="✨ 粗糙度 Roughness"
            value={roughness}
            min={0.05}
            max={0.65}
            step={0.01}
            onChange={setRoughness}
          />
          <StageSlider
            label="💿 各向异性 Anisotropy (金属拉丝)"
            value={anisotropy}
            min={0}
            max={0.92}
            step={0.02}
            onChange={setAnisotropy}
          />
        </div>
      </div>
    </div>
  );
};

const schematic7_2: SchematicDiagram = {
  title: 'UE 5.8 镜面反射、各向异性拉丝与环境倒影（IBL）协同关系',
  caption: '纯金属的 Diffuse Albedo 设 0，F0 控制反射色。Sky Light、环境捕捉和场景反射由渲染器提供。',
  nodes: [
    {
      id: 'n_color',
      title: '镜面 F0（示例 0.96）',
      subtitle: '金属把颜色赋给镜面 F0',
      category: 'param',
      x: 20,
      y: 26,
      width: 170,
      previewColor: '#e5e7eb',
      outputs: [{ id: 'rgb', label: 'F0 镜面色', color: '#e5e7eb' }],
    },
    {
      id: 'n_rough',
      title: 'Roughness (0.06)',
      subtitle: '极光滑镜面',
      category: 'param',
      x: 20,
      y: 122,
      width: 170,
      outputs: [{ id: 'val', label: '0.06', color: '#22c55e' }],
    },
    {
      id: 'n_aniso',
      title: 'Anisotropy (0.75)',
      subtitle: '顺微划痕拉伸高光',
      category: 'param',
      x: 20,
      y: 212,
      width: 170,
      outputs: [{ id: 'val', label: '拉丝强度', color: '#f59e0b' }],
    },
    {
      id: 'n_slab',
      title: 'Substrate Slab BSDF',
      subtitle: 'UE 5.8 物质层板',
      category: 'substrate',
      x: 255,
      y: 66,
      width: 195,
      inputs: [
        { id: 'f0', label: 'F0 (正视镜面率)', color: '#e5e7eb' },
        { id: 'rough', label: 'Roughness', color: '#22c55e' },
        { id: 'aniso', label: 'Anisotropy', color: '#f59e0b' },
      ],
      outputs: [{ id: 'bsdf', label: 'BSDF', color: '#a855f7' }],
      note: '将 Diffuse Albedo 设为黑色 (0,0,0)',
    },
    {
      id: 'n_root',
      title: '材质根节点',
      subtitle: '场景环境光由渲染器求值',
      category: 'output',
      x: 520,
      y: 112,
      width: 205,
      inputs: [
        { id: 'front', label: 'Front Material', color: '#a855f7' },
      ],
    },
  ],
  edges: [
    { fromNode: 'n_color', fromPin: 'rgb', toNode: 'n_slab', toPin: 'f0', color: '#e5e7eb' },
    { fromNode: 'n_rough', fromPin: 'val', toNode: 'n_slab', toPin: 'rough', color: '#22c55e' },
    { fromNode: 'n_aniso', fromPin: 'val', toNode: 'n_slab', toPin: 'aniso', color: '#f59e0b' },
    { fromNode: 'n_slab', fromPin: 'bsdf', toNode: 'n_root', toPin: 'front', color: '#a855f7' },
  ],
};

/* ============================================================================
 * 7.3 为什么老游戏材质换个地图就假得发光？—— 经验模型的“能量失恒”困局
 * ============================================================================ */

const Stage7_3_EnergyViolation: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [modelMode, setModelMode] = useState<'legacy' | 'pbr'>('legacy');
  const [sceneMode, setSceneMode] = useState<'cave' | 'desert'>('cave');
  const [diffSlider, setDiffSlider] = useState<number>(0.84);
  const [specPower, setSpecPower] = useState<number>(0.92);
  const [specWidth, setSpecWidth] = useState<number>(0.72); // 高光光斑散开宽度
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setModelMode('legacy');
    setSceneMode('cave');
    setDiffSlider(0.84);
    setSpecPower(0.92);
    setSpecWidth(0.72);
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 4) {
      setModelMode('legacy');
      setSceneMode('desert');
      setDiffSlider(0.84);
      setSpecPower(0.95);
      setSpecWidth(0.76);
    } else if (stepIndex === 0) {
      setModelMode('legacy');
      setSceneMode('cave');
    }
  }, [stepIndex, resetSignal]);

  // At normal incidence the blue-channel Phong lobe integrates to k * 2π/(n+2).
  const exponent = 1 + 100 * (1 - specWidth) ** 2;
  const lobeIntegral = 2 * Math.PI / (exponent + 2);
  const diffuseWeight = modelMode === 'legacy' ? 1 : 0.96;
  const specularAmplitude = modelMode === 'legacy' ? specPower : 0.04 / lobeIntegral;
  const curDiffPct = Math.round(100 * 0.78 * diffSlider * diffuseWeight);
  const curSpecPct = Math.round(100 * specularAmplitude * lobeIntegral);
  const totalEnergyPct = Math.round(100 * (0.78 * diffSlider * diffuseWeight + specularAmplitude * lobeIntegral));
  const isOverBudget = totalEnergyPct > 100;
  useEffect(() => {
    onKpiUpdate([
      {
        label: '归一化入射量',
        value: '100%',
        sub: sceneMode === 'cave' ? '🕯️ 幽暗山洞 (弱光)' : '☀️ 正午沙漠 (烈日)',
        tone: 'neutral',
      },
      {
        label: '蓝通道正入射积分',
        value: `${totalEnergyPct}%`,
        sub: isOverBudget ? `⚠️ 超标 +${totalEnergyPct - 100}% （模型超出单位入射）` : '✅ ≤100% 物理守恒',
        tone: isOverBudget ? 'bad' : 'good',
      },
      {
        label: '示意光强',
        value: sceneMode === 'desert' ? '3.0' : '0.35',
        sub: '换灯只改变球面亮度，反射率保持不变',
        tone: 'neutral',
      },
      {
        label: '当前着色范式',
        value: modelMode === 'legacy' ? 'Lambert+Phong' : '归一化 Phong',
        sub: `漫反射 ${curDiffPct}% + 镜面 ${curSpecPct}%`,
        tone: modelMode === 'pbr' ? 'accent' : 'neutral',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelMode, sceneMode, diffSlider, specPower, specWidth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 232;
    const H = 232;
    const img = ctx.createImageData(W, H);
    const data = img.data;
    const cx = W * 0.5;
    const cy = H * 0.5;
    const R = 86;

    const L: Vec3 = norm3([0.38, 0.56, 0.74]);
    const V: Vec3 = [0, 0, 1];
    const armorTint: Vec3 = [0.22, 0.48, 0.78]; // 皇家蓝钢甲漆面
    const baseLinear: Vec3 = [
      armorTint[0] * diffSlider,
      armorTint[1] * diffSlider,
      armorTint[2] * diffSlider,
    ];

    const isDesert = sceneMode === 'desert';
    const bgMode = isDesert ? 'sunny' : 'cave';

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;
        const bg = stageBgBackdrop(px, py, W, H, isDark, bgMode);

        const dx = px + 0.5 - cx;
        const dy = cy - (py + 0.5);
        const dist = Math.hypot(dx, dy);
        const cov = clamp(R + 0.65 - dist, 0, 1);

        if (cov <= 0) {
          data[idx] = Math.round(bg[0] * 255);
          data[idx + 1] = Math.round(bg[1] * 255);
          data[idx + 2] = Math.round(bg[2] * 255);
          data[idx + 3] = 255;
          continue;
        }

        const rNorm = Math.min(0.9995, dist / R);
        const scaleXY = dist > 1e-5 ? rNorm / (dist / R) : 1;
        const nx = (dx / R) * scaleXY;
        const ny = (dy / R) * scaleXY;
        const nz = Math.sqrt(Math.max(0.0004, 1 - nx * nx - ny * ny));
        const N: Vec3 = [nx, ny, nz];

        const ndotl = Math.max(0, dot3(N, L));
        const reflected = reflect3([-L[0], -L[1], -L[2]], N);
        const specular = specularAmplitude * Math.pow(Math.max(0, dot3(reflected, V)), exponent);
        const intensity = isDesert ? 3 : 0.35;
        const col = baseLinear.map(channel =>
          linearToSrgb(acesTonemap((channel * diffuseWeight / Math.PI + specular) * ndotl * intensity))
        ) as Vec3;

        data[idx] = Math.round(lerp(bg[0], col[0], cov) * 255);
        data[idx + 1] = Math.round(lerp(bg[1], col[1], cov) * 255);
        data[idx + 2] = Math.round(lerp(bg[2], col[2], cov) * 255);
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);

    if (isOverBudget && isDesert) {
      ctx.save();
      ctx.fillStyle = 'rgba(153, 27, 27, 0.9)';
      ctx.beginPath();
      ctx.roundRect(10, H - 30, W - 20, 22, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10.5px sans-serif';
      ctx.fillText(`正入射蓝通道半球积分 ${totalEnergyPct}%`, 15, H - 15);
      ctx.restore();
    }
  }, [modelMode, sceneMode, diffSlider, specPower, specWidth, isDark, isOverBudget, totalEnergyPct]);

  // 天平倾斜角度（左盘 100%，右盘 totalEnergyPct%）
  const tiltDeg = clamp((totalEnergyPct - 100) * 0.24, -16, 20);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={modelMode === 'legacy'}
        pitfallLabel="未归一化 Phong：保持峰值时增宽光斑，看蓝通道半球积分是否超过 100%"
        correctLabel="归一化 Phong：正入射镜面积分固定为 4%，漫反射按剩余份额计算"
        onToggle={(pit) => setModelMode(pit ? 'legacy' : 'pbr')}
      />
      <small>解析计算蓝通道正入射半球反射率。漫反射为蓝通道反照率 × 漫反射权重；镜面项 k·cosⁿθ 的余弦加权积分为 2πk/(n+2)。画面两侧使用同一光源与显示转换。</small>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 10,
        }}
      >
        {/* 左舱：跨地图实测球（山洞 ↔ 沙漠） */}
        <div
          style={{
            background: isDark ? '#1e1b18' : '#fffdf9',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <div
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 11.5, fontWeight: 700 }}>🗺️ 同材质的照明对照</span>
            <StageSegmented
              value={sceneMode}
              options={[
                { value: 'cave', label: '🕯️ 幽暗山洞' },
                { value: 'desert', label: '☀️ 正午沙漠' },
              ]}
              onChange={setSceneMode}
            />
          </div>

          <canvas
            ref={canvasRef}
            width={232}
            height={232}
            style={{
              width: 206,
              height: 206,
              borderRadius: 10,
              border: '1.5px solid var(--border-soft)',
            }}
          />
        </div>

        {/* 右舱：实时光子收支天平 */}
        <div
          style={{
            background: isDark ? '#1e1b18' : '#fffdf9',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700 }}>
            <span>⚖️ 正入射蓝通道半球反射率</span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                color: isOverBudget ? '#dc2626' : '#16a34a',
              }}
            >
              {isOverBudget ? `🚨 超支 +${totalEnergyPct - 100}%` : `✅ 守恒 (${totalEnergyPct}%)`}
            </span>
          </div>

          <svg viewBox="0 0 270 186" style={{ width: '100%', height: 'auto', borderRadius: 8 }}>
            <rect
              x="0"
              y="0"
              width="270"
              height="186"
              rx="8"
              fill={
                isOverBudget
                  ? isDark
                    ? '#2b1615'
                    : '#fff1f0'
                  : isDark
                    ? '#162318'
                    : '#f1f9ee'
              }
            />

            {/* 天平底座与支柱 */}
            <rect x="105" y="158" width="60" height="10" rx="4" fill="#57534e" />
            <polygon points="130,158 140,158 136,74 134,74" fill="#78716c" />

            {/* 随能量差摆动的横梁 */}
            <g transform={`translate(135, 78) rotate(${tiltDeg})`}>
              <line x1="-82" y1="0" x2="82" y2="0" stroke="#292524" strokeWidth="4" strokeLinecap="round" />
              {/* 左盘：100% 入射阳光 */}
              <g transform={`translate(-76, 0) rotate(${-tiltDeg})`}>
                <line x1="0" y1="0" x2="-18" y2="34" stroke="#78716c" strokeWidth="1.5" />
                <line x1="0" y1="0" x2="18" y2="34" stroke="#78716c" strokeWidth="1.5" />
                <rect x="-34" y="34" width="68" height="24" rx="6" fill="#f59e0b" stroke="#1e1b18" strokeWidth="1.5" />
                <text x="-27" y="49" fill="#1e1b18" fontSize="10" fontWeight="bold">
                  入射光 100%
                </text>
              </g>

              {/* 右盘：反弹总光能 */}
              <g transform={`translate(76, 0) rotate(${-tiltDeg})`}>
                <line x1="0" y1="0" x2="-18" y2="34" stroke="#78716c" strokeWidth="1.5" />
                <line x1="0" y1="0" x2="18" y2="34" stroke="#78716c" strokeWidth="1.5" />
                <rect
                  x="-38"
                  y="34"
                  width="76"
                  height="26"
                  rx="6"
                  fill={isOverBudget ? '#ef4444' : '#22c55e'}
                  stroke="#1e1b18"
                  strokeWidth="1.5"
                />
                <text x="-31" y="50" fill="#ffffff" fontSize="10.5" fontWeight="bold">
                  反弹 {totalEnergyPct}%
                </text>
              </g>
              <circle cx="0" cy="0" r="5.5" fill="#fbbf24" stroke="#1e1b18" strokeWidth="1.5" />
            </g>

            {/* 顶部状态横幅 */}
            <text
              x="12"
              y="22"
              fill={isOverBudget ? '#dc2626' : '#15803d'}
              fontSize="11"
              fontWeight="bold"
            >
              {isOverBudget
                ? `蓝通道正入射积分超过 1（${totalEnergyPct}%）`
                : `蓝通道积分：漫反射约 ${curDiffPct}%，镜面约 ${curSpecPct}%`}
            </text>
          </svg>

          <button
            type="button"
            className="brutal-btn primary"
            onClick={() => setModelMode((m) => (m === 'legacy' ? 'pbr' : 'legacy'))}
            style={{ width: '100%', fontSize: 12 }}
          >
            {modelMode === 'legacy'
              ? '⚖️ 切换归一化 Phong'
              : '🕰️ 切回未归一化 Phong'}
          </button>
        </div>
      </div>

      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSlider
            label="🎨 漫反射比例 (Diffuse / Albedo)"
            value={diffSlider}
            min={0.1}
            max={1.0}
            step={0.02}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onChange={setDiffSlider}
          />
          <div
            style={{
              opacity: modelMode === 'pbr' ? 0.48 : 1,
              pointerEvents: modelMode === 'pbr' ? 'none' : 'auto',
            }}
            aria-disabled={modelMode === 'pbr'}
          >
            <StageSlider
              label={
                modelMode === 'legacy'
                  ? '💡 传统高光峰值亮度 (独立滑块)'
                  : '💡 镜面峰值（归一化模式由引擎自动反算锁定）'
              }
              value={specPower}
              min={0.05}
              max={1.4}
              step={0.05}
              formatValue={(v) => (modelMode === 'pbr' ? '自动归一化' : `${Math.round(v * 100)}%`)}
              onChange={setSpecPower}
            />
          </div>
          <StageSlider
            label="🔆 光斑散开度 (Gloss 散宽 / Roughness)"
            value={specWidth}
            min={0.1}
            max={0.92}
            step={0.02}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onChange={setSpecWidth}
          />
        </div>
      </div>
    </div>
  );
};

const schematic7_3: SchematicDiagram = {
  title: '现代 PBR（Substrate Slab）内部是如何自动锁死“能量守恒”的？',
  caption: '这里画出镜面和漫反射分配的数学概念。实际 Slab 由渲染器计算这些项。',
  nodes: [
    {
      id: 'n_f',
      title: 'Fresnel 镜面分流 F',
      subtitle: '表皮直接弹走的光能占比',
      category: 'math',
      x: 20,
      y: 40,
      width: 185,
      outputs: [{ id: 'f', label: '镜面占比 F', color: '#38bdf8' }],
    },
    {
      id: 'n_oneminus',
      title: 'OneMinus (1 - F)',
      subtitle: '扣掉弹走的光，剩多少进表皮',
      category: 'math',
      x: 245,
      y: 120,
      width: 185,
      inputs: [{ id: 'x', label: 'Input F', color: '#38bdf8' }],
      outputs: [{ id: 'rem', label: '剩余光能 1-F', color: '#22c55e' }],
    },
    {
      id: 'n_albedo',
      title: 'Diffuse Albedo',
      subtitle: '物体固有漫反射率',
      category: 'param',
      x: 245,
      y: 230,
      width: 185,
      previewColor: '#3878c4',
      outputs: [{ id: 'rgb', label: 'Albedo', color: '#3b82f6' }],
    },
    {
      id: 'n_mul',
      title: 'Multiply (漫反射配平)',
      subtitle: '镜面越强，漫反射自动越少',
      category: 'math',
      x: 470,
      y: 165,
      width: 180,
      inputs: [
        { id: 'a', label: '1 - F', color: '#22c55e' },
        { id: 'b', label: 'Albedo', color: '#3b82f6' },
      ],
      outputs: [{ id: 'kd', label: '守恒漫反射项', color: '#22c55e' }],
    },
    {
      id: 'n_slab',
      title: '反射项求和（原理）',
      subtitle: '漫反射 + 归一化GGX ≤ 100%',
      category: 'substrate',
      x: 685,
      y: 88,
      width: 195,
      inputs: [
        { id: 'spec', label: 'GGX 归一化高光', color: '#38bdf8' },
        { id: 'diff', label: '守恒漫反射项', color: '#22c55e' },
      ],
      outputs: [{ id: 'out', label: '反射项', color: '#a855f7' }],
      note: '一套材质走遍山洞与沙漠！',
    },
  ],
  edges: [
    { fromNode: 'n_f', fromPin: 'f', toNode: 'n_oneminus', toPin: 'x', color: '#38bdf8' },
    { fromNode: 'n_f', fromPin: 'f', toNode: 'n_slab', toPin: 'spec', color: '#38bdf8' },
    { fromNode: 'n_oneminus', fromPin: 'rem', toNode: 'n_mul', toPin: 'a', color: '#22c55e' },
    { fromNode: 'n_albedo', fromPin: 'rgb', toNode: 'n_mul', toPin: 'b', color: '#3b82f6' },
    { fromNode: 'n_mul', fromPin: 'kd', toNode: 'n_slab', toPin: 'diff', color: '#22c55e' },
  ],
};

/* ============================================================================
 * 7.4 环境光遮蔽（AO）从零讲透 —— 阴天没太阳，为什么墙角和衣服褶皱还是暗的？
 * ============================================================================ */

const Stage7_4_AmbientOcclusion: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [probeSpot, setProbeSpot] = useState<'flat' | 'step' | 'crevice'>('crevice');
  const [texAoOn, setTexAoOn] = useState<boolean>(true);
  const [ssaoOn, setSsaoOn] = useState<boolean>(true);
  const [lumenAoOn, setLumenAoOn] = useState<boolean>(true);
  const [flashOn, setFlashOn] = useState<boolean>(true);
  const [flashX, setFlashX] = useState<number>(0.5); // 0..1 扫过中心深暗缝
  const [flashY, setFlashY] = useState<number>(0.5);
  const [isBakePitfall, setIsBakePitfall] = useState<boolean>(false); // true = BaseColor * AO 错误乘死
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setProbeSpot('crevice');
    setTexAoOn(true);
    setSsaoOn(true);
    setLumenAoOn(true);
    setFlashOn(true);
    setFlashX(0.5);
    setFlashY(0.5);
    setIsBakePitfall(false);
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 4) {
      setFlashOn(true);
      setFlashX(0.5);
      setIsBakePitfall(true);
    } else if (stepIndex === 0) {
      setFlashOn(false);
      setIsBakePitfall(false);
    } else if (stepIndex === 2) {
      setFlashOn(true);
      setIsBakePitfall(false);
    }
  }, [stepIndex, resetSignal]);

  const spotInfo =
    probeSpot === 'flat'
      ? { name: '平坦表面', deg: 180, aoPct: 100, px: 46, py: 96 }
      : probeSpot === 'step'
        ? { name: '台阶内折角', deg: 84, aoPct: 54, px: 94, py: 128 }
        : { name: '深衣褶/雕花缝底', deg: 32, aoPct: 22, px: 205, py: 162 };

  // 与岩石剖面折线做真实 2D 射线求交，确保绿线绝不穿墙、红线精准止步于挡光岩壁
  const terrainTopPoly: ReadonlyArray<readonly [number, number]> = [
    [0, 96],
    [86, 96],
    [86, 128],
    [168, 128],
    [186, 94],
    [205, 162],
    [224, 94],
    [264, 94],
  ];
  const castSkyRay = (ox: number, oy: number, rad: number, maxLen: number) => {
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    let minHit = Infinity;
    for (let i = 0; i < terrainTopPoly.length - 1; i++) {
      const [ax, ay] = terrainTopPoly[i];
      const [bx, by] = terrainTopPoly[i + 1];
      const sx = bx - ax;
      const sy = by - ay;
      const denom = dx * sy - dy * sx;
      if (Math.abs(denom) < 1e-6) continue;
      const qx = ax - ox;
      const qy = ay - oy;
      const t = (qx * sy - qy * sx) / denom;
      const u = (qx * dy - qy * dx) / denom;
      if (t > 0.8 && u >= 0 && u <= 1 && t < minHit) {
        minHit = t;
      }
    }
    const blocked = minHit < Infinity;
    return { ok: !blocked, len: blocked ? Math.min(minHit, maxLen) : maxLen };
  };

  useEffect(() => {
    onKpiUpdate([
      {
        label: `测点：${spotInfo.name}`,
        value: `可见天空 ${spotInfo.deg}°`,
        sub: `预设遮蔽权重 ${spotInfo.aoPct}%（二维示意）`,
        tone: spotInfo.aoPct > 70 ? 'good' : spotInfo.aoPct > 40 ? 'warn' : 'accent',
      },
      {
        label: '强光手电筒直射',
        value: flashOn ? `已对准 (${Math.round(flashX * 100)}%)` : '已关闭 (纯阴天)',
        sub: flashOn ? '鼠标移入右图可自由扫光' : '仅靠 180° 阴天环境漫射',
        tone: flashOn ? 'good' : 'neutral',
      },
      {
        label: 'AO 接线方式',
        value: isBakePitfall ? '⚠️ BaseColor × AO' : '✅ 连入 AO 专用口',
        sub: isBakePitfall ? '电筒照进缝里依然死黑！' : '电筒直照缝底细节清晰亮起',
        tone: isBakePitfall ? 'bad' : 'good',
      },
      {
        label: '激活的多层 AO',
        value: `${(texAoOn ? 1 : 0) + (ssaoOn ? 1 : 0) + (lumenAoOn ? 1 : 0)} / 3 层`,
        sub: '微缝贴图 + SSAO + Lumen',
        tone: 'neutral',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeSpot, texAoOn, ssaoOn, lumenAoOn, flashOn, flashX, isBakePitfall]);

  // 绘制右侧浮雕石刻 + 强光手电筒扫缝实验画布
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 256;
    const H = 208;
    const img = ctx.createImageData(W, H);
    const data = img.data;

    const stoneBase: Vec3 = [0.64, 0.56, 0.45]; // 暖砂岩本色

    // 定义石雕高度场（含中央深邃V型大暗缝 + 同心雕花环槽 + 精细刻痕噪波）
    const sampleRelief = (u: number, v: number) => {
      // 中央竖向蜿蜒深裂谷 (Lumen 短距结构级大褶皱)
      const canyonCenter = 0.5 + 0.04 * Math.sin(v * 9.0);
      const distCanyon = Math.abs(u - canyonCenter);
      const canyonDepth = Math.exp(-(distCanyon * distCanyon) / 0.0042); // 0..1 越近缝底越大

      // 四周内凹石框与中尺度浮雕圆环 (SSAO 级凹槽)
      const rad = Math.hypot(u - 0.5, v - 0.5);
      const ringGroove =
        Math.exp(-Math.pow(rad - 0.28, 2) / 0.0009) * 0.75 +
        Math.exp(-Math.pow(rad - 0.41, 2) / 0.0011) * 0.65;

      // 毫米级细微雕花裂纹与石材颗粒 (贴图微缝 AO)
      const fineGrain = valueNoise(u * 42, v * 42);
      const microCrack = Math.pow(1 - Math.abs(Math.sin((u * 18 + v * 14) * Math.PI)), 8) * 0.7;

      const h =
        1.0 -
        canyonDepth * 0.78 -
        ringGroove * 0.35 -
        microCrack * 0.16 +
        (fineGrain - 0.5) * 0.08;

      const lumenAO = lumenAoOn ? 1 - canyonDepth * 0.86 : 1.0;
      const ssao = ssaoOn ? 1 - ringGroove * 0.72 : 1.0;
      const microAO = texAoOn ? 1 - microCrack * 0.76 - (0.5 - fineGrain) * 0.18 : 1.0;

      const combinedAO = clamp(lumenAO * ssao * microAO, 0.05, 1.0);
      return { h, ao: combinedAO, grain: fineGrain };
    };

    for (let py = 0; py < H; py++) {
      const v = py / H;
      for (let px = 0; px < W; px++) {
        const u = px / W;
        const idx = (py * W + px) * 4;

        const c0 = sampleRelief(u, v);
        const cx1 = sampleRelief(Math.min(1, u + 1 / W), v);
        const cy1 = sampleRelief(u, Math.min(1, v + 1 / H));

        const dHx = (cx1.h - c0.h) * 4.5;
        const dHy = (cy1.h - c0.h) * 4.5;
        const N: Vec3 = norm3([-dHx, dHy, 1.0]);

        const albedoR = stoneBase[0] * (0.88 + 0.24 * c0.grain);
        const albedoG = stoneBase[1] * (0.88 + 0.24 * c0.grain);
        const albedoB = stoneBase[2] * (0.88 + 0.24 * c0.grain);

        // 阴天 180° 柔和蓝灰天空环境光
        const skyIrr: Vec3 = [0.24, 0.27, 0.33];

        // 强光手电筒直射光（从镜头正前方向像素点照射，能直直照进深缝底部！）
        let directR = 0;
        let directG = 0;
        let directB = 0;
        if (flashOn) {
          const lx = flashX - u;
          const ly = -(flashY - v);
          const dist2D = Math.hypot(lx, ly);
          const Ldir: Vec3 = norm3([lx * 1.3, ly * 1.3, 0.85]);
          const ndotl = Math.max(0, dot3(N, Ldir));
          const spotFalloff = Math.exp(-(dist2D * dist2D) / 0.032);
          const beamPower = 3.8 * spotFalloff * ndotl;
          directR = beamPower * 1.08;
          directG = beamPower * 0.96;
          directB = beamPower * 0.78;
        }

        let linR: number;
        let linG: number;
        let linB: number;

        if (isBakePitfall) {
          // ⚠️ 错误连法：直接把 BaseColor 乘上 AO！连手电筒直射光也被 AO(0.06) 掐死了！
          const bakedR = albedoR * c0.ao;
          const bakedG = albedoG * c0.ao;
          const bakedB = albedoB * c0.ao;
          linR = bakedR * (skyIrr[0] + directR);
          linG = bakedG * (skyIrr[1] + directG);
          linB = bakedB * (skyIrr[2] + directB);
        } else {
          // ✅ 正确连法：AO 只遮蔽阴天环境漫射光 skyIrr，绝不阻挡手电筒直射光 direct！
          linR = albedoR * (skyIrr[0] * c0.ao + directR);
          linG = albedoG * (skyIrr[1] * c0.ao + directG);
          linB = albedoB * (skyIrr[2] * c0.ao + directB);
        }

        data[idx] = Math.round(linearToSrgb(acesTonemap(linR)) * 255);
        data[idx + 1] = Math.round(linearToSrgb(acesTonemap(linG)) * 255);
        data[idx + 2] = Math.round(linearToSrgb(acesTonemap(linB)) * 255);
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);

    if (flashOn) {
      const fx = flashX * W;
      const fy = flashY * H;
      ctx.save();
      ctx.strokeStyle = isBakePitfall ? '#fca5a5' : '#fde047';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(fx, fy, 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(20, 18, 16, 0.84)';
      ctx.beginPath();
      ctx.roundRect(8, H - 27, W - 16, 20, 5);
      ctx.fill();
      ctx.fillStyle = isBakePitfall ? '#fca5a5' : '#bbf7d0';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(
        isBakePitfall
          ? '⚠️ BaseColor×AO：电筒照进中央深缝还是洗不掉的黑油漆！'
          : '✅ AO 专用口：背光深邃，电筒扫过深缝底部石纹清晰亮起！',
        13,
        H - 13.5
      );
      ctx.restore();
    }
  }, [texAoOn, ssaoOn, lumenAoOn, flashOn, flashX, flashY, isBakePitfall]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={isBakePitfall}
        pitfallLabel="错误连法：图省事写 BaseColor × AO —— 相当于拿黑油漆把衣褶墙角涂死，强光手电筒怼脸照也照不亮！"
        correctLabel="正确连法：把 AO 连入根节点 Ambient Occlusion 专用引脚 —— 阴天暗缝深邃立体，强光直照缝底细节清晰生辉"
        onToggle={(pit) => {
          setIsBakePitfall(pit);
          setFlashOn(true);
        }}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: 10,
        }}
      >
        {/* 左舱：点击切换表面 vs 深缝“一线天” 180° 天空进光扇形锥 */}
        <div
          style={{
            background: isDark ? '#1e1b18' : '#fffdf9',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700 }}>☁️ 180° 阴天半球进光扇形锥</span>
            <StageSegmented
              value={probeSpot}
              options={[
                { value: 'flat', label: '平顶 100%' },
                { value: 'step', label: '墙角 54%' },
                { value: 'crevice', label: '深缝 22%' },
              ]}
              onChange={setProbeSpot}
            />
          </div>

          <svg viewBox="0 0 264 190" style={{ width: '100%', height: 'auto', borderRadius: 8 }}>
            <rect x="0" y="0" width="264" height="190" fill={isDark ? '#16181d' : '#e6eef6'} />
            {/* 顶部阴天漫射云层弧带 */}
            <path
              d="M 10 42 Q 132 6 254 42"
              fill="none"
              stroke="#60a5fa"
              strokeWidth="6"
              strokeLinecap="round"
              opacity={0.55}
            />
            <text x="66" y="18" fill={isDark ? '#93c5fd' : '#1d4ed8'} fontSize="10" fontWeight="bold">
              ☁️ 180° 阴天穹顶无影漫射光
            </text>

            {/* 从探针向上发射 15 道天空采样射线：与岩石地形真实求交，未挡住画绿，撞上岩壁画红 */}
            {[-80, -68, -56, -44, -32, -20, -10, 0, 10, 20, 32, 44, 56, 68, 80].map((deg) => {
              const rad = (deg * Math.PI) / 180;
              const oy = spotInfo.py - 1.5;
              const { ok, len } = castSkyRay(spotInfo.px, oy, rad, 76);
              const tx = spotInfo.px + Math.sin(rad) * len;
              const ty = oy - Math.cos(rad) * len;
              return (
                <line
                  key={deg}
                  x1={spotInfo.px}
                  y1={oy}
                  x2={tx}
                  y2={ty}
                  stroke={ok ? '#22c55e' : '#ef4444'}
                  strokeWidth={ok ? '2' : '1.4'}
                  strokeDasharray={ok ? undefined : '3 2'}
                  opacity={ok ? 0.9 : 0.72}
                />
              );
            })}

            {/* 岩石剖面地形（左平顶 -> 中台阶折角 -> 右深V窄缝） */}
            <polygon
              points="0,96 86,96 86,128 168,128 186,94 205,162 224,94 264,94 264,190 0,190"
              fill={isDark ? '#3a332c' : '#c7b9a5'}
              stroke="#1e1b18"
              strokeWidth="2"
            />

            {/* 三个可点击测点圆钮 */}
            {[
              { id: 'flat' as const, x: 46, y: 96, txt: '平面' },
              { id: 'step' as const, x: 94, y: 128, txt: '折角' },
              { id: 'crevice' as const, x: 205, y: 162, txt: '深缝' },
            ].map((pt) => (
              <g
                key={pt.id}
                style={{ cursor: 'pointer' }}
                onClick={() => setProbeSpot(pt.id)}
              >
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={probeSpot === pt.id ? 6.5 : 4.5}
                  fill={probeSpot === pt.id ? '#facc15' : '#ffffff'}
                  stroke="#1e1b18"
                  strokeWidth="1.8"
                />
                <text
                  x={pt.x - 11}
                  y={pt.y + 16}
                  fill={isDark ? '#f5efe6' : '#1e1b18'}
                  fontSize="9.5"
                  fontWeight="bold"
                >
                  {pt.txt}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {/* 右舱：强光手电筒扫过雕花暗缝画布 */}
        <div
          style={{
            background: isDark ? '#1e1b18' : '#fffdf9',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            <span>🔦 鼠标悬停/拖动：拿强光手电筒照进中央深缝</span>
          </div>

          <canvas
            ref={canvasRef}
            width={256}
            height={208}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setFlashX(clamp((e.clientX - rect.left) / rect.width, 0.05, 0.95));
              setFlashY(clamp((e.clientY - rect.top) / rect.height, 0.08, 0.92));
              if (!flashOn) setFlashOn(true);
            }}
            onTouchMove={(e) => {
              if (!e.touches[0]) return;
              const rect = e.currentTarget.getBoundingClientRect();
              setFlashX(clamp((e.touches[0].clientX - rect.left) / rect.width, 0.05, 0.95));
              setFlashY(clamp((e.touches[0].clientY - rect.top) / rect.height, 0.08, 0.92));
            }}
            style={{
              width: '100%',
              maxWidth: 268,
              height: 'auto',
              borderRadius: 10,
              border: '1.5px solid var(--border-soft)',
              cursor: 'crosshair',
            }}
          />
        </div>
      </div>

      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSlider
            label="🔦 手电筒横扫位置 (50% 为中央深缝)"
            value={flashX}
            min={0.08}
            max={0.92}
            step={0.01}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => {
              setFlashX(v);
              if (!flashOn) setFlashOn(true);
            }}
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
          <StageToggle label="🔦 强光手电筒开关" checked={flashOn} onChange={setFlashOn} />
          <StageToggle label="贴图微缝 AO" checked={texAoOn} hint="毫米刻痕" onChange={setTexAoOn} />
          <StageToggle label="屏幕空间 SSAO" checked={ssaoOn} hint="浮雕环槽" onChange={setSsaoOn} />
          <StageToggle label="Lumen 短距软遮蔽" checked={lumenAoOn} hint="中央深谷" onChange={setLumenAoOn} />
        </div>
      </div>
    </div>
  );
};

const schematic7_4: SchematicDiagram = {
  title: 'UE 5.8 正确接入 AO 专用引脚（绝不污染 BaseColor 直射光）',
  caption: 'ORM 贴图的红通道（AO）单独连入材质根节点的 Ambient Occlusion 引脚，让引擎只压暗环境光、放行手电筒直射光！',
  nodes: [
    {
      id: 'n_bc',
      title: 'T_Stone_BaseColor',
      subtitle: '纯正石材本色 (sRGB)',
      category: 'texture',
      x: 20,
      y: 26,
      width: 175,
      previewColor: '#a68f72',
      outputs: [{ id: 'rgb', label: 'RGB 干净底色', color: '#f59e0b' }],
      note: '千万别拿它去乘 AO！',
    },
    {
      id: 'n_orm',
      title: 'T_Stone_ORM',
      subtitle: 'R=AO · G=粗糙 · B=金属',
      category: 'texture',
      x: 20,
      y: 162,
      width: 175,
      outputs: [
        { id: 'r', label: 'R (微缝 AO)', color: '#ef4444' },
        { id: 'g', label: 'G (Roughness)', color: '#22c55e' },
        { id: 'b', label: 'B (Metallic)', color: '#3b82f6' },
      ],
    },
    {
      id: 'n_bridge',
      title: 'Substrate Metalness-To-DiffuseAlbedo-F0',
      subtitle: '传统贴图转物理属性',
      category: 'substrate',
      x: 235,
      y: 42,
      width: 225,
      inputs: [
        { id: 'albedo', label: 'Base Color', color: '#f59e0b' },
        { id: 'metal', label: 'Metallic', color: '#3b82f6' },
      ],
      outputs: [
        { id: 'diff', label: 'Diffuse Albedo', color: '#f59e0b' },
        { id: 'f0', label: 'F0', color: '#e5e7eb' },
      ],
    },
    {
      id: 'n_slab',
      title: 'Substrate Slab BSDF',
      subtitle: '石雕表面材质层板',
      category: 'substrate',
      x: 495,
      y: 56,
      width: 185,
      inputs: [
        { id: 'diff', label: 'Diffuse Albedo', color: '#f59e0b' },
        { id: 'f0', label: 'F0', color: '#e5e7eb' },
        { id: 'rough', label: 'Roughness', color: '#22c55e' },
      ],
      outputs: [{ id: 'mat', label: 'BSDF', color: '#a855f7' }],
    },
    {
      id: 'n_root',
      title: '材质根节点 (UE 5.8)',
      subtitle: 'AO 走独立专用通道',
      category: 'output',
      x: 715,
      y: 105,
      width: 195,
      inputs: [
        { id: 'front', label: 'Front Material', color: '#a855f7' },
        { id: 'ao', label: 'Ambient Occlusion', color: '#ef4444' },
      ],
      note: '仅衰减间接环境光 · 直射光另由光源可见性决定',
    },
  ],
  edges: [
    { fromNode: 'n_bc', fromPin: 'rgb', toNode: 'n_bridge', toPin: 'albedo', color: '#f59e0b' },
    { fromNode: 'n_orm', fromPin: 'b', toNode: 'n_bridge', toPin: 'metal', color: '#3b82f6' },
    { fromNode: 'n_bridge', fromPin: 'diff', toNode: 'n_slab', toPin: 'diff', color: '#f59e0b' },
    { fromNode: 'n_bridge', fromPin: 'f0', toNode: 'n_slab', toPin: 'f0', color: '#e5e7eb' },
    { fromNode: 'n_orm', fromPin: 'g', toNode: 'n_slab', toPin: 'rough', color: '#22c55e' },
    { fromNode: 'n_slab', fromPin: 'mat', toNode: 'n_root', toPin: 'front', color: '#a855f7' },
    {
      fromNode: 'n_orm',
      fromPin: 'r',
      toNode: 'n_root',
      toPin: 'ao',
      color: '#ef4444',
      label: '直连 AO 专用口',
    },
  ],
};

/* ============================================================================
 * 7.5 阴影系统（Shadows）与材质联动 —— 本影半影、UE 5.8 VSM、镂空叶影与彩玻投影
 * ============================================================================ */

const Stage7_5_ShadowsVsmColored: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [sunSoftness, setSunSoftness] = useState<number>(0.48); // 太阳圆盘张角 & 遮挡高度半影软度
  const [leafMode, setLeafMode] = useState<'masked' | 'opaque'>('masked');
  const [windMode, setWindMode] = useState<'disabled' | 'masked' | 'active'>('disabled');
  const windOn = windMode === 'active';
  const [vsmViewOn, setVsmViewOn] = useState<boolean>(false);
  const [stainedGlassOn, setStainedGlassOn] = useState<boolean>(true);
  const [windPhase, setWindPhase] = useState<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setSunSoftness(0.48);
    setLeafMode('masked');
    setWindMode('disabled');
    setVsmViewOn(false);
    setStainedGlassOn(true);
    setWindPhase(0);
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 4) {
      setLeafMode('masked');
      setWindMode('active');
      setVsmViewOn(true);
    } else if (stepIndex === 3) {
      setLeafMode('masked');
      setVsmViewOn(true);
    }
  }, [stepIndex, resetSignal]);

  // 当风力生效时，启动轻量动画帧驱动树影摇曳
  useEffect(() => {
    if (!windOn) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setWindPhase(((now - start) / 1000) * 2.6);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [windOn]);

  const invalidatedPages = windMode === 'disabled' ? 0 : 16;

  useEffect(() => {
    onKpiUpdate([
      {
        label: '半影宽度 (Penumbra)',
        value: sunSoftness < 0.2 ? '刀切硬边' : sunSoftness > 0.7 ? '宽阔柔滑半影' : '自然近实远虚',
        sub: `太阳张角软度 ${(sunSoftness * 2.5).toFixed(1)}°`,
        tone: 'neutral',
      },
      {
        label: '树叶投影模式',
        value: leafMode === 'masked' ? '✅ Masked 镂空叶影' : '⚠️ Opaque 大黑方块',
        sub: leafMode === 'masked' ? '阳光穿过叶缝洒金斑' : '未抠透明区投出整张假纸板',
        tone: leafMode === 'masked' ? 'good' : 'bad',
      },
      {
        label: '缓存页示意（12×4）',
        value: invalidatedPages ? `🔥 ${invalidatedPages}/48 页可能重画` : '🟢 48/48 页静态命中',
        sub: '假设光源、相机、其余物体静止',
        tone: invalidatedPages ? 'warn' : 'good',
      },
      {
        label: '彩绘玻璃透射影',
        value: stainedGlassOn ? '🌈 彩色半透投影开' : '已移开彩窗',
        sub: stainedGlassOn ? '静态 Lightmass 彩影示意' : '普通直射石板地',
        tone: stainedGlassOn ? 'accent' : 'neutral',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sunSoftness, leafMode, invalidatedPages, stainedGlassOn]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 440;
    const H = 228;
    const img = ctx.createImageData(W, H);
    const data = img.data;

    const swayX = windOn ? Math.sin(windPhase) * 0.022 : 0;
    const swayY = windOn ? Math.cos(windPhase * 0.8) * 0.012 : 0;

    // 树叶集群遮罩函数：返回 0..1 遮挡密度
    const evalFoliageShadow = (u: number, v: number, blurR: number): number => {
      // 树冠面片投影落在中央石板区域 u: 0.35..0.67, v: 0.16..0.84
      const lu = (u - 0.51 - swayX) / 0.15;
      const lv = (v - 0.50 - swayY) / 0.31;

      if (leafMode === 'opaque') {
        // Opaque 踩坑：两张交叉的树叶矩形插片直接投出硬邦邦的大黑方块影子！
        const box1 = Math.max(Math.abs(lu + 0.08), Math.abs(lv - 0.05));
        const box2 = Math.max(Math.abs(lu * 0.85 - lv * 0.35), Math.abs(lu * 0.35 + lv * 0.85));
        const d = Math.min(box1, box2);
        return 1 - saturate((d - 0.82) / Math.max(0.015, blurR * 0.6));
      }

      // Masked 正解：多片掌状枫叶簇与叶缝斑驳阳光
      let occ = 0;
      const centers = [
        [-0.36, -0.35],
        [0.28, -0.38],
        [-0.08, -0.02],
        [-0.42, 0.28],
        [0.32, 0.26],
        [0.05, 0.48],
      ];
      for (let i = 0; i < centers.length; i++) {
        const dx = lu - centers[i][0];
        const dy = lv - centers[i][1];
        const r = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx) + i * 1.1;
        // 5 瓣枫叶锯齿极坐标轮廓
        const lobeRadius = 0.36 + 0.16 * Math.cos(ang * 5) + 0.05 * Math.cos(ang * 15);
        const leafHit = 1 - saturate((r - lobeRadius) / Math.max(0.025, blurR * 0.85));
        // 中间留一点点叶脉镂空孔洞感
        occ = Math.max(occ, leafHit);
      }
      return occ;
    };

    for (let py = 0; py < H; py++) {
      const v = py / H;
      for (let px = 0; px < W; px++) {
        const u = px / W;
        const idx = (py * W + px) * 4;

        // 庭院暖色石灰岩方砖地面 + 砖缝凹槽
        const tileU = (u * 8) % 1;
        const tileV = (v * 4.5) % 1;
        const mortar =
          tileU < 0.045 || tileU > 0.955 || tileV < 0.06 || tileV > 0.94 ? 0.68 : 1.0;
        const stoneNoise = 0.9 + 0.16 * valueNoise(u * 36, v * 22);
        const floorAlbedo: Vec3 = [
          0.74 * mortar * stoneNoise,
          0.69 * mortar * stoneNoise,
          0.60 * mortar * stoneNoise,
        ];

        // ① 左侧区域 (u: 0.04..0.33)：静止石柱底座 + 近实远虚斜长阴影（本影 Umbra -> 半影 Penumbra）
        // 石柱立在 (0.11, 0.78)，影子向右上斜拉到 (0.29, 0.16)
        const pillarBaseDist = Math.hypot((u - 0.11) * 1.5, v - 0.78);
        const isPillarBody = pillarBaseDist < 0.068;

        // 沿投影轴计算离柱脚的远近 tShadow (0=贴地柱根刀切硬影, 1=高处柱顶宽阔半影)
        const relX = u - 0.11;
        const relY = 0.78 - v;
        const along = clamp((relX * 0.42 + relY * 0.91) / 0.64, 0, 1.15);
        const perp = Math.abs(relX * 0.91 - relY * 0.42);
        // 半影模糊半径正比于：距遮挡物距离 along × 太阳圆盘张角 sunSoftness！
        const penumbraWidth = 0.004 + along * sunSoftness * 0.075;
        const pillarShadow =
          along >= 0 && along <= 1.02
            ? 1 - saturate((perp - 0.036) / penumbraWidth)
            : 0;
        // 贴地根部一圈微妙的屏幕接触阴影 Contact Shadow
        const contactRing = pillarBaseDist < 0.082 ? (1 - (pillarBaseDist - 0.068) / 0.014) * 0.65 : 0;

        // ② 中央区域：高处树冠投下的影子（具一定高度半影）
        const leafBlur = 0.03 + sunSoftness * 0.26;
        const foliageShadow = evalFoliageShadow(u, v, leafBlur);

        // ③ 右侧区域 (u: 0.70..0.96)：哥特教堂彩绘玻璃花窗彩色半透明投影！
        let lightTint: Vec3 = [1.0, 0.97, 0.90]; // 默认正午暖白阳光
        let glassFrameShadow = 0;
        if (stainedGlassOn && u > 0.70 && u < 0.95 && v > 0.12 && v < 0.88) {
          const gu = (u - 0.825) / 0.115; // -1..1
          const gv = (v - 0.50) / 0.36; // -1..1
          // 尖拱教堂窗外框
          const inArch =
            gv > -0.2
              ? Math.abs(gu) < 0.95 && gv < 0.95
              : Math.hypot(gu, (gv + 0.2) * 1.15) < 0.95;

          if (inArch) {
            // 铅条黑框分隔玫瑰花窗与菱形彩玻格
            const roseR = Math.hypot(gu, (gv + 0.22) * 1.35);
            const roseAng = Math.atan2(gv + 0.22, gu);
            const spoke = Math.abs(Math.sin(roseAng * 6)) < 0.11 && roseR < 0.62;
            const ringLead = Math.abs(roseR - 0.62) < 0.055 || Math.abs(roseR - 0.25) < 0.045;
            const diamondLead =
              roseR > 0.65 &&
              (Math.abs(((gu + gv * 1.2 + 4) * 2.5) % 1 - 0.5) > 0.43 ||
                Math.abs(((gu - gv * 1.2 + 4) * 2.5) % 1 - 0.5) > 0.43);

            if (spoke || ringLead || diamondLead || Math.abs(gu) > 0.88 || gv > 0.89) {
              glassFrameShadow = 0.82; // 铅条不透光黑影
            } else if (roseR < 0.25) {
              lightTint = [0.95, 0.68, 0.12]; // 琥珀金芯（透射率 ≤ 1 守恒）
            } else if (roseR < 0.62) {
              const sector = Math.floor(((roseAng + Math.PI) / (Math.PI * 2)) * 6) % 3;
              lightTint =
                sector === 0
                  ? [0.95, 0.14, 0.22] // 玫瑰红宝石
                  : sector === 1
                    ? [0.14, 0.50, 0.96] // 钴蓝彩玻
                    : [0.16, 0.92, 0.46]; // 翡翠绿彩玻
            } else {
              const cell = (Math.floor((gu + 2) * 3) + Math.floor((gv + 2) * 4)) % 3;
              lightTint =
                cell === 0
                  ? [0.18, 0.56, 0.95]
                  : cell === 1
                    ? [0.94, 0.28, 0.14]
                    : [0.78, 0.20, 0.92];
            }
          }
        }

        const totalShadow = clamp(
          Math.max(pillarShadow, foliageShadow * 0.92, glassFrameShadow, contactRing),
          0,
          0.92
        );

        const directVis = 1 - totalShadow;
        const skyAmb: Vec3 = [0.16, 0.20, 0.28]; // 阴影中保留蓝天间接光（绝不是纯黑 0！）

        let rLin: number;
        let gLin: number;
        let bLin: number;

        if (isPillarBody) {
          // 石柱顶面本体
          const pShade = 0.55 + 0.45 * saturate((0.11 - u) * 12 + (0.78 - v) * 8);
          rLin = 0.48 * pShade;
          gLin = 0.45 * pShade;
          bLin = 0.42 * pShade;
        } else {
          rLin = floorAlbedo[0] * (skyAmb[0] + directVis * lightTint[0] * 1.35);
          gLin = floorAlbedo[1] * (skyAmb[1] + directVis * lightTint[1] * 1.35);
          bLin = floorAlbedo[2] * (skyAmb[2] + directVis * lightTint[2] * 1.35);
        }

        let sr = linearToSrgb(acesTonemap(rLin));
        let sg = linearToSrgb(acesTonemap(gLin));
        let sb = linearToSrgb(acesTonemap(bLin));

        // ④ UE 5.8 VSM 虚拟阴影缓存页热力透视镜叠加！
        if (vsmViewOn) {
          const cols = 12;
          const rows = 4;
          const colIdx = Math.floor(u * cols);
          const rowIdx = Math.floor(v * rows);
          const cellLocalX = (u * cols) % 1;
          const cellLocalY = (v * rows) % 1;
          const isGridLine =
            cellLocalX < 0.035 || cellLocalX > 0.965 || cellLocalY < 0.05 || cellLocalY > 0.95;

          // 中央树冠阴影覆盖的 4x4=16 个分页：开风吹时变红 (Invalidated)，关风吹时变绿 (Cached)！
          const inFoliagePages = colIdx >= 4 && colIdx <= 7 && rowIdx >= 0 && rowIdx <= 3;
          const pageInvalid = invalidatedPages > 0 && inFoliagePages;

          if (isGridLine) {
            sr = pageInvalid ? 1.0 : 0.22;
            sg = pageInvalid ? 0.28 : 0.92;
            sb = pageInvalid ? 0.25 : 0.45;
          } else if (pageInvalid) {
            sr = lerp(sr, 0.96, 0.36);
            sg = lerp(sg, 0.18, 0.36);
            sb = lerp(sb, 0.16, 0.36);
          } else {
            sr = lerp(sr, 0.16, 0.22);
            sg = lerp(sg, 0.86, 0.22);
            sb = lerp(sb, 0.38, 0.22);
          }
        }

        data[idx] = Math.round(clamp(sr, 0, 1) * 255);
        data[idx + 1] = Math.round(clamp(sg, 0, 1) * 255);
        data[idx + 2] = Math.round(clamp(sb, 0, 1) * 255);
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);

    // 清晰分区导览角标
    ctx.save();
    const drawBadge = (x: number, y: number, text: string, bgCol: string) => {
      ctx.font = 'bold 10.5px sans-serif';
      const tw = ctx.measureText(text).width + 12;
      ctx.fillStyle = bgCol;
      ctx.beginPath();
      ctx.roundRect(x, y, tw, 19, 5);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(text, x + 6, y + 13);
    };

    drawBadge(8, 8, '① 石柱：柱根硬本影 → 柱梢软半影', 'rgba(24, 22, 20, 0.82)');
    drawBadge(
      155,
      8,
      leafMode === 'masked' ? '② 树冠：Masked 斑驳叶影' : '⚠️ 树冠：Opaque 假黑方块',
      leafMode === 'masked' ? 'rgba(22, 101, 52, 0.88)' : 'rgba(153, 27, 27, 0.9)'
    );
    if (stainedGlassOn) {
      drawBadge(312, 8, '③ 彩绘玻璃花窗投影', 'rgba(88, 28, 135, 0.86)');
    }
    if (vsmViewOn) {
      drawBadge(
        10,
        H - 26,
        invalidatedPages
          ? '🔴 树冠域仍启用 WPO，示意区域可失效（含位移乘零）'
          : '🟢 组件 WPO 已停用，其余条件静止时可复用',
        invalidatedPages ? 'rgba(153, 27, 27, 0.9)' : 'rgba(21, 128, 61, 0.9)'
      );
    }
    ctx.restore();
  }, [sunSoftness, leafMode, windOn, invalidatedPages, windPhase, vsmViewOn, stainedGlassOn]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={leafMode === 'opaque'}
        pitfallLabel="叶片使用 Opaque，包含透明背景的整张卡片会投影"
        correctLabel="同一张叶片卡使用 Masked，让光穿过遮罩裁掉的像素"
        onToggle={(pit) => setLeafMode(pit ? 'opaque' : 'masked')}
      />

      <div
        style={{
          background: isDark ? '#1e1b18' : '#fffdf9',
          border: '1.5px solid var(--border-strong)',
          borderRadius: 12,
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <canvas
          ref={canvasRef}
          width={440}
          height={228}
          style={{
            width: '100%',
            height: 'auto',
            borderRadius: 9,
            border: '1.5px solid var(--border-soft)',
          }}
        />
      </div>

      <div className="stage-controls-panel">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
          <StageSegmented
            label="② 树叶材质混合模式 (Blend Mode)"
            value={leafMode}
            options={[
              { value: 'masked', label: '🌿 Masked (一刀切镂空叶影)' },
              { value: 'opaque', label: '⬛ Opaque (不透明方块黑影)' },
            ]}
            onChange={setLeafMode}
          />
          <div style={{ flex: 1, minWidth: 200 }}>
            <StageSlider
              label="☀️ 太阳圆盘张角 & 树冠高度 (控制半影软硬)"
              value={sunSoftness}
              min={0.05}
              max={1.0}
              step={0.02}
              formatValue={(v) => (v < 0.2 ? '极硬刀切影' : v > 0.75 ? '宽柔半影' : `软度 ${Math.round(v * 100)}%`)}
              onChange={setSunSoftness}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <StageSegmented
            label="组件与材质 WPO 对照"
            value={windMode}
            onChange={setWindMode}
            options={[
              { value: 'active', label: '风力生效' },
              { value: 'masked', label: '材质位移乘零' },
              { value: 'disabled', label: '组件距离停用 WPO' },
            ]}
          />
          <StageToggle
            label="🔍 VSM 缓存页示意"
            checked={vsmViewOn}
            hint="绿=缓存 · 红=重画"
            onChange={setVsmViewOn}
          />
          <StageToggle
            label="🌈 显示静态烘焙彩窗示意"
            checked={stainedGlassOn}
            hint="彩影为 Lightmass 路径示意，叶影为动态 VSM 路径"
            onChange={setStainedGlassOn}
          />
        </div>
      </div>
    </div>
  );
};

const schematic7_5: SchematicDiagram = {
  title: 'UE 5.8 树叶镂空投影（Masked）、材质平滑停风与组件 VSM 缓存保护分工',
  caption: 'Alpha 接 Opacity Mask 抠出叶影；材质里的距离衰减负责在 35m 处平滑停风防突变，真正让 VSM 停止缓存失效的是组件上的 WPO Disable Distance！',
  nodes: [
    {
      id: 'n_tex',
      title: 'T_Foliage_Leaf (RGBA)',
      subtitle: '叶片颜色 + Alpha 轮廓',
      category: 'texture',
      x: 20,
      y: 24,
      width: 180,
      previewColor: '#2f7a3e',
      outputs: [
        { id: 'rgb', label: 'RGB 叶面色', color: '#22c55e' },
        { id: 'a', label: 'Alpha 镂空遮罩', color: '#e5e7eb' },
      ],
    },
    {
      id: 'n_wind',
      title: 'SimpleGrassWind',
      subtitle: '树枝随风摇摆顶点偏移',
      category: 'math',
      x: 20,
      y: 162,
      width: 180,
      outputs: [{ id: 'vec', label: 'XYZ 摆动位移', color: '#38bdf8' }],
    },
    {
      id: 'n_fade',
      title: '材质距离衰减遮罩',
      subtitle: '防 35m 处风力瞬间卡停',
      category: 'input',
      x: 20,
      y: 262,
      width: 180,
      outputs: [{ id: 'mask', label: '0 ~ 1 平滑过渡', color: '#f59e0b' }],
    },
    {
      id: 'n_slab',
      title: 'Substrate Slab BSDF',
      subtitle: '树叶表面着色层板',
      category: 'substrate',
      x: 260,
      y: 28,
      width: 185,
      inputs: [{ id: 'diff', label: 'Diffuse Albedo', color: '#22c55e' }],
      outputs: [{ id: 'mat', label: 'BSDF', color: '#a855f7' }],
    },
    {
      id: 'n_mul',
      title: 'Multiply（仅平滑风幅）',
      subtitle: '乘 0 防跳变，但仍算启用 WPO',
      category: 'math',
      x: 260,
      y: 192,
      width: 195,
      inputs: [
        { id: 'a', label: '风力偏移', color: '#38bdf8' },
        { id: 'b', label: '距离遮罩', color: '#f59e0b' },
      ],
      outputs: [{ id: 'wpo', label: '平滑风力位移', color: '#22c55e' }],
    },
    {
      id: 'n_root',
      title: '材质根节点 (Blend: Masked)',
      subtitle: '同步驱动画面与 VSM 太阳测距图',
      category: 'output',
      x: 515,
      y: 96,
      width: 225,
      inputs: [
        { id: 'front', label: 'Front Material', color: '#a855f7' },
        { id: 'mask', label: 'Opacity Mask', color: '#e5e7eb' },
        { id: 'wpo', label: 'World Position Offset', color: '#22c55e' },
      ],
      note: '停用 VSM 失效靠组件属性 WPO Disable Distance',
    },
  ],
  edges: [
    { fromNode: 'n_tex', fromPin: 'rgb', toNode: 'n_slab', toPin: 'diff', color: '#22c55e' },
    { fromNode: 'n_slab', fromPin: 'mat', toNode: 'n_root', toPin: 'front', color: '#a855f7' },
    { fromNode: 'n_tex', fromPin: 'a', toNode: 'n_root', toPin: 'mask', color: '#e5e7eb' },
    { fromNode: 'n_wind', fromPin: 'vec', toNode: 'n_mul', toPin: 'a', color: '#38bdf8' },
    { fromNode: 'n_fade', fromPin: 'mask', toNode: 'n_mul', toPin: 'b', color: '#f59e0b' },
    { fromNode: 'n_mul', fromPin: 'wpo', toNode: 'n_root', toPin: 'wpo', color: '#22c55e' },
  ],
};

/* ============================================================================
 * 模块 07 完整课程数据定义（5 节课 · 每节 5 步认知阶梯）
 * ============================================================================ */

const module07: ModuleDefinition = {
  id: '07',
  number: '07',
  title: '光影四大基石',
  subtitle: '漫反射、镜面反射、环境光遮蔽与阴影系统',
  lessons: [
    {
      id: 'diffuse-lambert-dot',
      moduleId: '07',
      number: '7.1',
      title: '漫反射（Diffuse）从零讲透 —— 钻进表皮乱撞的光、手电筒斜照投影与视角无关性',
      subtitle: '为什么歪着头看红苹果亮度丝毫不变？用一把手电筒看懂点乘 Dot(N, L) 与兰伯特漫反射',
      duration: '12 分钟',
      difficulty: '进阶',
      StageComponent: Stage7_1_DiffuseLambert,
      schematic: schematic7_1,
      takeaways: [
        '漫反射是光线钻入表皮微米级颜料颗粒乱撞染色后，朝 180° 四面八方均匀喷洒出来的光。',
        '因为朝四面八方均匀散开，漫反射具有绝对的“视角无关性”——只听太阳角度 L 的话，和摄像机角度 V 完全无关！',
        '斜着照变暗是因为同一束手电筒光被拉长摊薄了，单位面积分到的光子严格等于 cos θ = Dot(N, L)。',
        '背光面 Dot(N, L) 会算出负数，手写光照时必须套上 Max(0, x) 或 Saturate，否则负数会把暗部环境补光吸成黑洞！',
      ],
      steps: [
        {
          stepNumber: 1,
          shortLabel: '生活提问',
          tag: 'phenomenon',
          title: '绕着石膏像歪头走一圈，为什么它身上的明暗一点都不跟着你动？',
          paragraphs: [
            '把一颗红苹果或哑光陶土罐放在台灯底下。你试着往左歪头看、往右凑近看，会发现一个习以为常却细思极妙的现象：**罐子朝向台灯的那半边永远一样亮，它的明暗分界线死死钉在原地，根本不理睬你的眼睛往哪儿挪！**',
            '反过来，只要你把台灯从头顶慢慢挪到侧面，刚才还亮堂堂的罐子正面，立刻就像傍晚太阳落山一样渐渐暗了下去。为什么它只听灯的话、不听眼睛的话？',
          ],
          tryItPrompt: '先保持太阳角度不变，左右拖动舞台下方的「摄像机环绕角 V」滑块，紧盯陶土球上的黄色测光点 P，看看它的亮度读数会不会变！',
          callout: {
            tone: 'tip',
            title: '光打在物体上其实会“兵分两路”',
            body: '任何一束光撞上物体，都会立刻分家：第一路钻进表皮底下染上颜色再散出来（本节主角：漫反射）；第二路在表皮当场弹走变成亮斑（下节主角：镜面反射）。',
          },
        },
        {
          stepNumber: 2,
          shortLabel: '弹珠散射',
          tag: 'background',
          title: '钻进表皮打弹珠 + 手电筒斜照摊大饼',
          paragraphs: [
            '看左侧微观剖面图：钻进苹果表皮底下的光子，一头扎进密密麻麻的红色素颗粒里，像弹珠台一样左撞一下、右撞一下（绿光蓝光全被吃掉），最后从表皮朝 **180° 四面八方均匀喷洒出来**！正因为每个方向分到的红光一样多，不管你的眼睛 `V` 站在哪个角度接，接到的亮度都分毫不差！',
            '那为什么太阳斜着照会变暗？拿手电筒往桌上照就秒懂了：垂直照时，100 颗光子挤在一个小圆圈里，当然最亮；斜着 `60°` 照时，同一束光在桌上被拉长成了 **2 倍宽的大椭圆**，每平方厘米分到的光子直接腰斩只剩一半！',
          ],
          tryItPrompt: '慢慢把「太阳倾斜角 θ」从 0° 拖到 75°，观察左图黄色光斑是如何在表面被越拉越宽、越摊越薄的。',
          callout: {
            tone: 'formula',
            title: '不用量角器！点乘 Dot(N, L) 与归一化 Normalize',
            body: '把点乘 Dot(N, L) 当成两根长度为 1 的箭头“对齐度打分器”：完全同向（0°）= +1、垂直（90°）= 0、完全反向（180°）= -1，几何上刚好等于夹角余弦 cos θ（斜照 60° 正好 0.5）！如果手填的方向箭头长度不是 1，只需先过一颗 Normalize（归一化）节点把箭头缩回长度 1。',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '亲手验证',
          tag: 'experiment',
          title: '亲手实测：转灯改变一切，转镜头纹丝不动',
          paragraphs: [
            '现在把两件事连起来验证这个两百多年前由物理学家兰伯特发现的规律（**兰伯特余弦定律**）：先随便挑一个太阳角度（比如 `45°`），此时 `Dot(N, L) = 0.71`。',
            '接着疯狂左右拖动 **「摄像机环绕角 V」**——你会看到三维陶土球和它身上的 `📍 P` 测光钉真真切切地在镜头前旋转透视，但右上角光度计死死咬住 **同一百分比读数（`0.0%` 波动）**！而一旦开启 `Half-Lambert` 开关，原本漆黑的背光面会被 `(Dot × 0.5 + 0.5)²` 温柔拉亮，这是二次元与角色皮肤最爱用的柔化魔术。',
          ],
          tryItPrompt: '先来回拖动「摄像机环绕角」验证 P 点亮度 0% 波动，再勾选「Half-Lambert 半兰伯特柔化」对比背光暗部的通透感变化。',
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5落地',
          tag: 'ue5',
          title: '走进 UE 5.8：引擎替你算好了常规漫反射，什么时候需要自己连 Dot？',
          paragraphs: [
            '好消息是：在 UE 5.8 日常做写实材质时，你只需把木头或陶土的颜色送进 **`Substrate Slab BSDF`** 的 **`Diffuse Albedo`（漫反射反照率）** 插槽（我们会在第 8.4 课正式解锁它；传统默认材质上则叫 `Base Color`），引擎底层会自动帮你对关卡里成百上千盏灯跑完 `Max(0, Dot(N, L))`！',
            '但做风格化卡通或手写自定义光照时，就需要自己连这组节点了：新建一个 `Surface / Unlit` 材质，把 `PixelNormalWS`（像素表面法线）与自定义光照方向 `Vector Parameter`（先接 `Normalize` 缩成长度 1，代表由表面指向光源的世界空间方向，例如 `(0, 0, 1)`）一起送进 `DotProduct`，出口套上 `Saturate` 乘以陶土色，再连入 `Emissive Color`。改动方向参数即可自由转动明暗分界（注：普通 Surface 材质无法用 `LightVector` 直接读取场景太阳方向）。',
          ],
          tryItPrompt: '点击舞台右上角的「原理图」切换按钮，对照查看 PixelNormalWS → Dot → Saturate → Multiply 的完整无视角连线。',
          callout: {
            tone: 'ue58',
            title: 'UE 5.8 快捷键小贴士',
            body: '在材质画布里右键直接搜 Dot 或在 Math → Vector 下找到 DotProduct 即可；想把结果安全锁在 0~1，搜 Saturate 节点（开销极低，现代 GPU 编译器常将其直接合并进指令修饰符）。',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '负数防坑',
          tag: 'pitfall',
          title: '第一大暗坑：忘切背光负数，背光球面竟变成“吸光黑洞”！',
          paragraphs: [
            '手连 `Dot(N, L)` 时，十个新手九个会踩同一个坑：当太阳转到球体背面（夹角超过 `90°`）时，`Dot` 算出来的不是 `0`，而是 **`-0.1` 到 `-1.0` 的负数**！',
            '如果你忘了套一层 `Max(0, Dot)` 或 `Saturate` 就拿去跟环境补光相加，可怕的事情发生了——背光面的 **`-0.8` 负漫反射会像黑洞一样，把原本打在背面的柔和蓝天补光（`+0.2`）活活吞噬扣成负数死黑**！记住口诀：**“点乘算光先截零，背光负数会吃灯”**。',
          ],
          tryItPrompt: '点击顶部红色踩坑对比条的「看踩坑现象」（或取消勾选下方 Max(0, Dot)），看看陶土球左侧背光面原本漂亮的淡蓝色环境补光是如何瞬间被吸成死黑的！',
          callout: {
            tone: 'warn',
            title: '一句话防坑口诀',
            body: '凡是用 Dot 算受光强度，出口第一件事永远是接一颗 Saturate（锁回 0~1）或 Max(0)，绝不让负数溜进后续加法和混合节点！',
          },
        },
      ],
    },

    {
      id: 'specular-ibl-anisotropy',
      moduleId: '07',
      number: '7.2',
      title: '镜面反射（Specular）从零讲透 —— 表皮直接弹走的光、角平分线与“金属其实靠照镜子”',
      subtitle: '震撼的“暗室黑银球实验”：关掉周围环境倒影，100% 纯银电镀球为什么瞬间变成大黑球？',
      duration: '14 分钟',
      difficulty: '进阶',
      StageComponent: Stage7_2_SpecularIblAniso,
      schematic: schematic7_2,
      takeaways: [
        '镜面反射是没钻进表皮、在撞击瞬间像台球撞库一样直接弹走的光，因此头一歪高光立刻跟着跑（强视角相关）！',
        '判断高光进不进眼睛极简单：看表面法线 N 有没有对准太阳 L 与眼睛 V 正中间的“角平分线 H（半程向量）”。',
        '镜面反射不仅反射太阳那个小白点，更在 360° 反射整个周围世界（天空球 / Lumen 环境反射）！',
        '纯金属没有漫反射，光滑处会映出环境——放进全黑空关卡里，纯银球看起来就是一颗黑球！',
      ],
      steps: [
        {
          stepNumber: 1,
          shortLabel: '台球弹射',
          tag: 'phenomenon',
          title: '湖面刺眼的太阳反光，为什么你往旁边迈一步它就跟着跑了？',
          paragraphs: [
            '上一节我们看到，苹果表皮底下的红颜色怎么歪头看都不变；但苹果皮上那个**刺眼的白色亮斑（高光）**脾气却截然相反——你头往左偏一点，亮斑立刻在球面上滑走！',
            '因为这第二路光根本没钻进果皮，而是在撞上光滑表皮的第一瞬间，就像**打台球撞桌边一样“啪”地朝对面弹走了**！只有当你的眼睛刚好堵在它弹走的路上，才能被这束强光晃到眼。',
          ],
          tryItPrompt: '在保持太阳角度不变的情况下，左右拖动「眼睛观察角 V」滑块，看球面上的高光亮斑和右图的绿色眼睛箭头是如何同步游走的！',
        },
        {
          stepNumber: 2,
          shortLabel: '角平分线H',
          tag: 'background',
          title: '显卡找高光的聪明捷径：角平分线 H；以及金属闪亮的真正秘密',
          paragraphs: [
            '看右侧几何瞄准仪：怎么判断眼睛有没有堵在反射路线上？显卡用了一个绝妙的初中几何偷懒法——把长度都是 `1` 的太阳箭头 `L` 和眼睛箭头 `V` 相加再归一（`Normalize(L + V)`），刚好得到它们正中间的 **角平分线 `H`（半程向量 Halfway Vector）**！只要表面小牙签 `N` 刚好和粉色的 `H` 重合（`Dot(N, H) ≈ 1`），高光必中靶心！',
            '但更重要的常识在这里：**镜面反射绝不止头顶灯泡那一个小白点！周围的蓝天、白云、街道楼房，全都在光滑表皮上发生镜面反射！** 尤其是纯银、黄金这类金属，它们内部没有一丁点漫反射，全身上下 **全靠映出周围世界的亮暗和色彩**！',
          ],
          tryItPrompt: '拖动太阳角 L 和眼睛角 V，试着让粉色的「角平分线 H」正好与蓝色「法线 N」重合（比如 L=+30°、V=-30°），点亮高光命中提示！',
          callout: {
            tone: 'formula',
            title: '为什么金属在空地图里会变黑？',
            body: '把一面 100% 完美的浴室镜子搬进伸手不见五指的黑屋里，镜子是什么颜色？当然是纯黑色！光滑金属球就是一面弯成球形的镜子。',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '暗室银球',
          tag: 'experiment',
          title: '亲手做一次震撼的“暗室黑银球实验”与不锈钢拉丝实验',
          paragraphs: [
            '百闻不如一见！现在左侧是一颗 `100%` 纯银电镀球，映着蓝天和大地闪闪发光。请你点击球上方的 **「🌞 环境反射：开」按钮把它关掉**（模拟关进四壁漆黑、只有头顶一盏小灯的暗室）——看！整颗纯银球瞬间塌缩成了一颗**漆黑如墨的煤球，只剩针尖大一个白点**！',
            '再点开环境反射，试着拖动右下角的 **「各向异性 Anisotropy」** 滑块，并切换「横向拉丝 / 锅底圆环纹」：家里不锈钢炒锅底那圈细密的同心圆微划痕，会把原本圆溜溜的高光硬生生拉成炫酷的**辐射状蝴蝶结金属光带**！',
          ],
          tryItPrompt: '先点击球顶按钮开关「环境反射」感受纯银球秒变黑球的视觉冲击，再把「各向异性」拉到 0.80 并切到「锅底同心圆环纹」欣赏拉丝光带！',
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5落地',
          tag: 'ue5',
          title: '走进 UE 5.8：Lumen 环境反射与 Substrate 各向异性引脚',
          paragraphs: [
            '在关卡里通常用 `Sky Light` 搭配天空或场景照明提供周围环境光；项目支持并启用 `Lumen Reflections` 时，周围建筑与物件都会实时映入金属镜面。想在材质预览窗里复现“关灯进暗室”实验，可以在 `Preview Scene Settings` 中单独开关天空光。',
            '而在材质编辑器里，只需在 **`Substrate Slab BSDF`** 节点上用 **`Anisotropy`（`-1 ~ +1` 标量）** 控制高光拉长程度与方向切换，若需要自定义拉丝纹路走向（`Flow / Tangent Map`），则连入专门的 **`Tangent`** 引脚！无需切换任何特殊着色模型，就能做出拉丝铝合金、丝绸和黑胶唱片（原理图中的镜面 `F0` 与 `Substrate Slab` 我们会在第 8.2 / 8.4 课详讲）。',
          ],
          tryItPrompt: '把「材质表面类型」在「纯银电镀球」与「光滑红漆塑料球」之间来回切换，对比金属全身染色反光与非金属红底配白高光的区别。',
          callout: {
            tone: 'ue58',
            title: 'UE 5.8 预览窗快捷键',
            body: '打开 Preview Scene Settings，保持同一 HDRI（高动态范围全景环境图）、方向光和曝光，关闭 Use Sky Lighting 或将 Sky Light Intensity 设 0，然后恢复原值即可亲眼复现黑银球。注意 Show Environment 只控制背景球显示与否，与 Use Sky Lighting 是不同开关；保留方向光时金属上仍会看到直接高光。',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '实战避坑',
          tag: 'pitfall',
          title: '萌新头号冤案：“救命！我照着教程连的黄金/白银怎么全是死黑的？！”',
          paragraphs: [
            '几乎每个刚学 UE 的同学都在深夜崩溃发帖问过这个问题：新建了一个纯空的 `Empty Level`（黑漆漆一片只放了一盏太阳灯），把金属球拖进去一看，怎么变成黑铁球了？于是以为材质连错了，拼命去把金属度改小，结果调成了难看的灰塑料！',
            '做完今天的暗室实验你就彻底破案了：**不是你的金属材质错了，而是你的黑房间里没东西给它照镜子！** 记住铁律：**“调金属先布光，没有天空球寸步难行”**。',
          ],
          tryItPrompt: '点击顶部对比条切换「看踩坑现象」与「切正确配置」，牢牢记住空关卡无环境反射时纯银球变黑的真实长相！',
          callout: {
            tone: 'warn',
            title: '排查金属发黑三步法',
            body: '遇到金属死黑别乱改材质！先查关卡：① 有没有放 SkyLight 并勾选 Real Time Capture？② 有没有放 SkyAtmosphere 或 HDRI（全景环境图）天空球？③ 金属对应的固有色（BaseColor / F0）贴图是不是画得太暗了？',
          },
        },
      ],
    },

    {
      id: 'empirical-energy-violation',
      moduleId: '07',
      number: '7.3',
      title: '为什么老游戏材质换个地图就假得发光？—— 经验模型的“能量失恒”困局',
      subtitle: '漫反射和高光各算各的账：在山洞里调好看的盔甲，走到正午沙漠为什么瞬间惨白报废？',
      duration: '11 分钟',
      difficulty: '进阶',
      StageComponent: Stage7_3_EnergyViolation,
      schematic: schematic7_3,
      takeaways: [
        '物理世界铁律（能量守恒）：物体反弹出去的“漫反射光 + 镜面反射光”总和，永远不可能超过照进来的 100% 入射光（自发光除外）。',
        '早期经验模型（Lambert + Phong）把漫反射和高光做成两个互不通气的独立滑块，高光光斑调宽时不会自动压暗峰值。',
        '判断材质有没有“凭空造光”，要看整个半球方向的反射积分是否 ≤ 100%，不能只凭山洞弱光下好不好看就下结论。',
        '现代 PBR 在底层自动实现了“镜面多抢一分、漫反射就少吃一分，光斑摊宽一倍、峰值自动暗下来”，一套材质全地图通用！',
      ],
      steps: [
        {
          stepNumber: 1,
          shortLabel: '跨图翻车',
          tag: 'phenomenon',
          title: '十年前美术师的噩梦：山洞里帅气的蓝盔甲，一出门变成惨白灯泡！',
          paragraphs: [
            '十年前做游戏材质时有个让无数美术师崩溃的怪事：你在幽暗的火把山洞里花了一下午，把骑士的皇家蓝盔甲调得油光水滑、质感炸裂；结果把同一个角色拖到阳光灿烂的正午沙漠地图里一看——**盔甲居然白得像根自己通电的日光灯管，连原本的蓝色都快洗没了！**',
            '在左侧模拟器里把场景从「🕯️ 幽暗山洞」切到「☀️ 正午沙漠」试试，同时瞄一眼右侧的**能量收支天平**：换地图只改变了外部光照强度，而天平测量的**材质自身反射率**其实早就超出了 100% 红线，只是山洞里的弱光把它藏住了！',
          ],
          tryItPrompt: '先保持老式经验模型不变，把场景从「🕯️ 幽暗山洞」切到「☀️ 正午沙漠」，对比左球暴走发白与右侧天平的反射率读数！',
        },
        {
          stepNumber: 2,
          shortLabel: '能量天平',
          tag: 'background',
          title: '抓出真凶：漫反射和高光“各花各的钱”，花超了太阳总预算！',
          paragraphs: [
            '物理学里有一份专门管“光照到表面后往各个方向反弹多少能量”的反光分布规则，行话叫 **`BRDF`（双向反射分布函数）**。无论规则怎么写，总反光预算都像一盆固定水量：照进来 `100%` 的光，**漫反射和镜面反射加起来绝对不能超过 `100%`**！',
            '可老式 `Lambert + Phong` 偏偏把漫反射和高光做成了两本互不通气的糊涂账：漫反射自己先花掉一大半预算，高光不仅不扣漫反射的钱，把光斑拉宽时峰值高度还不肯降下来——结果总反射率轻轻松松突破 `100%`，等于这块盔甲自己在**凭空造光**！',
          ],
          tryItPrompt: '在老式模式下调高下方的「传统高光峰值亮度」和「光斑散开度」，看着右侧天平红盘一路沉底报警，再切回幽暗山洞看看弱光是如何掩盖破绽的。',
          callout: {
            tone: 'formula',
            title: '严谨账本：蓝通道正入射半球积分怎么算？',
            body: '给定单位白光正入射，取蓝漆最强的蓝通道对 BRDF 做余弦加权半球积分：漫反射占 0.78 × 漫反射滑块；未归一化 Phong 镜面项 k·cosⁿθ 的积分为 2πk/(n+2)。保持峰值 k 不变而把光斑拉宽（指数 n 变小）时，镜面积分会迅速暴涨并让总反射率突破 100%！（注意：强光下画面发白也受光源与曝光影响，是否违背能量守恒必须以半球反射积分判定。）',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '归一化高光',
          tag: 'experiment',
          title: '总水量固定：光斑摊宽一倍，峰值就必须自动降下来！',
          paragraphs: [
            '想治好“凭空造光”的顽疾，道理朴素极了：**把总反光预算锁死！** 镜面高光就像手头那一小盆固定的水——你想把光斑摊得又宽又柔和，峰值高度就必须自动矮下去；反过来光斑收得像针尖一样窄，峰值才能冲得又尖又亮！',
            '点击按钮切换到 **「归一化 Phong」** 教学模型试试：现在无论你怎么拖动「光斑散开度」，引擎都会在幕后自动压低或抬高峰值，并从漫反射里扣出对应的份额，右侧天平稳稳守在 `≤ 100%` 绿区！（注：这里用可解析的归一化 Phong 演示原理，UE 5.8 的 `Substrate Slab` 底层则使用更真实的 GGX 微表面模型。）',
          ],
          tryItPrompt: '保持在「☀️ 正午沙漠」场景，来回点击切换「老式经验模型」与「归一化 Phong」，并拖动光斑散开度观察天平读数与球面亮度的反差！',
          callout: {
            tone: 'formula',
            title: '归一化系数从哪来？',
            body: '为了把正入射镜面积分 2πk/(n+2) 严格锁死在 4%（0.04），归一化模型自动令峰值 k = 0.04 × (n + 2) / (2π)，同时把剩余的 96%（0.96）份额交给漫反射，从数学上保证两者之和永不越界。',
          },
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5落地',
          tag: 'ue5',
          title: '走进 UE 5.8：为什么你在材质面板里再也找不到“高光亮度”滑块了？',
          paragraphs: [
            '在 UE 5.8 的 `Substrate Slab` 里，你只需要提供 `Roughness`（控制微表面光滑度）和 `F0`（正入射镜面反射率），再也没有老引擎里那个随便乱拉的“高光强度”滑块——光源角度、光强和摄像机曝光共同决定最终画面有多亮。',
            '把 `Roughness` 调小（光滑），小镜子排齐，高光就自动变得**又小又刺眼**；把 `Roughness` 调大（粗糙），光散开摊薄，高光就自动变得**又宽又柔和**。引擎在 `Substrate Slab` 内部用 `1 - F` 自动从漫反射里扣掉了被高光抢走的光能，从根源上杜绝了材质“自己发电”。',
          ],
          tryItPrompt: '切到顶部的「原理图」标签，看看 OneMinus (1 - F) 是如何在进入漫反射之前先一步扣掉镜面反射光能的。',
          callout: {
            tone: 'ue58',
            title: '工业化协作的最大红利',
            body: '正因为全员遵守同一套物理能量账本，上海外包团队做的木箱、北京团队做的铁剑、洛杉矶团队做的角色，放进 UE 5.8 昼夜交替的开放世界里，从清晨到正午再到火把洞穴，永远和谐统一！',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '实战避坑',
          tag: 'pitfall',
          title: '实战避坑：别为了“在暗处显眼”去给 BaseColor 乘超过 1 的倍数！',
          paragraphs: [
            '有些同学发现角色在阴影里不够亮，就手痒给 `BaseColor` 乘上 `2.5` 想“强行提亮”——这等于在现代 PBR 里手动重演了老式模型的能量超标，一走到强光下就会严重失真。',
            '如果角色在暗处显得太黑，**先固定材质不动，去检查关卡入射光、天光补光和摄像机曝光**。同时也要分清：仅凭屏幕上一个过曝发白的像素不能直接断定材质违背能量守恒（强光和曝光也会压爆显示范围），但反射率超过 `100%` 的老式超界模型一旦遇上强光，就一定会把能量失恒的恶果彻底放大出来！',
          ],
          tryItPrompt: '用顶部的对比开关最后再看一眼「未归一化超界 + 沙漠强光」与「归一化守恒模型」的对比，养成敬畏能量守恒的直觉。',
          callout: {
            tone: 'warn',
            title: '一句话防坑口诀',
            body: '材质只管如实汇报物体的物理反射率（0~1 以内），画面亮暗交给灯光师和摄像机曝光（Exposure）去管，职责分明永不翻车！',
          },
        },
      ],
    },

    {
      id: 'ambient-occlusion-deep-dive',
      moduleId: '07',
      number: '7.4',
      title: '环境光遮蔽（AO）从零讲透 —— 阴天没太阳，为什么墙角和衣服褶皱还是暗的？',
      subtitle: '头顶“一线天”进光扇形锥 + 强光手电筒扫暗缝实验：彻底戒掉 BaseColor × AO 的坏习惯',
      duration: '13 分钟',
      difficulty: '进阶',
      StageComponent: Stage7_4_AmbientOcclusion,
      schematic: schematic7_4,
      takeaways: [
        '阴天没有直射太阳，但整个 180° 天空穹顶是一盏巨大的无影漫射灯；墙角与深褶皱抬头只能看见窄窄“一线天”，进光少才变暗——这就是 AO！',
        '贴图 AO、屏幕空间方法和 Lumen 的遮蔽取决于渲染路径。舞台用三个可切换遮罩示意不同尺度，并非固定叠加顺序。',
        'AO 的本质是“四面八方的柔和环境光进不去”，它绝不能阻挡迎面照进去的手电筒或太阳直射光！',
        '严禁在材质里写 BaseColor × AO（等于涂死黑油漆，电筒都照不亮），必须把 AO 单独连入根节点 Ambient Occlusion 专用口！',
      ],
      steps: [
        {
          stepNumber: 1,
          shortLabel: '阴天暗角',
          tag: 'phenomenon',
          title: '大阴天明明没有太阳也没有影子，为什么墙角、鼻翼沟和衣服褶子还是暗的？',
          paragraphs: [
            '找一个乌云密布的大阴天往窗外看：太阳被厚云挡得严严实实，马路上连半个人影都找不到。可神奇的是，你身上卫衣的深褶皱、桌腿贴地的墙角、石雕的凹坑里，依然稳稳嵌着一层柔和深邃的暗影，让你一眼看清所有立体起伏！',
            '既然没有太阳投下影子，这些凹陷处的暗色到底是怎么来的？',
          ],
          tryItPrompt: '先关掉舞台下方的「🔦 强光手电筒开关」，观察在纯阴天漫射光下，右侧砂岩石雕中央深缝与环槽自然呈现出的立体暗影。',
        },
        {
          stepNumber: 2,
          shortLabel: '一线天进光',
          tag: 'background',
          title: '抬头看“一线天”：180° 满额天空光 vs 22% 窄缝进光',
          paragraphs: [
            '看左侧的 **180° 半球天空进光剖面图**：大阴天时，整片天空穹顶就像影楼里一盏巨大的半球无影灯，从头顶 `180°` 每个角度均匀往下洒柔和的环境漫射光。',
            '从平面、墙角和深缝底部抬头看，几何遮挡使可见天空逐渐变窄。这里用 100%、54%、22% 三个预设权重标记示意强弱；实际 AO 需要在法线半球上按余弦权重统计遮挡。',
          ],
          tryItPrompt: '依次点击左图剖面上的「平顶 100%」、「墙角 54%」、「深缝 22%」三个圆点，观察绿色可见天空扇形锥是如何越收越窄的！',
          callout: {
            tone: 'tip',
            title: '为什么法线贴图的小凹坑必须配 AO 贴图？',
            body: '还记得第 6 章讲法线贴图只是“假装歪小牙签”并没有真凹下去吗？引擎自带的屏幕遮蔽看不见假凹坑，必须靠烘焙出来的微缝 AO 贴图补上这毫米级的暗缝！',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '手电扫缝',
          tag: 'experiment',
          title: '拿起强光手电筒直照暗缝：环境光进不去，直射光可进得去！',
          paragraphs: [
            '现在做个极其关键的思维实验：墙角因为头顶被挡所以平时很暗；可如果我拿一把 **强光手电筒笔直往墙角深缝里怼脸照过去**，深缝底部该不该亮起来？**当然该亮！而且应该把缝底的石纹照得一清二楚！**',
            '把鼠标移到右侧石雕画布上左右横扫（或拖动下方滑块经过 `50%` 中央深缝）：在正确模式下，手电筒没照到的暗缝依然深邃幽暗，而手电筒光斑扫过的地方，深谷底部的砂岩颗粒立刻金灿灿地亮了起来！顺手开关下方三个 AO 复选框（贴图微缝、`SSAO` 屏幕空间环境光遮蔽、以及 `Lumen` 短距遮蔽），还能看清微刻痕、浮雕槽与大裂谷三层遮蔽是怎么叠出丰富层次的。',
          ],
          tryItPrompt: '在右侧石雕上移动鼠标用手电筒扫过正中央的深裂谷，然后再依次开关下方「贴图微缝 AO / SSAO / Lumen」三个开关观察细节层次！',
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5落地',
          tag: 'ue5',
          title: '走进 UE 5.8：把 ORM 红通道请进根节点的 Ambient Occlusion 贵宾席',
          paragraphs: [
            '在启用 `Lumen GI`（UE5 实时全局光照）的工程里测试 Material AO 时，需先在 `Project Settings → Rendering` 中关闭 **`Allow Static Lighting`**，按提示重启并完成着色器编译——关掉它是为了腾出 GBuffer 通道给动态 Material AO 使用，代价是该项目不再支持静态烘焙光照（下一节 7.5 做彩绘玻璃静态烘焙时则恰好相反，需要保持它开启）。随后把线性 `ORM.R` 接根节点 `Ambient Occlusion`，在间接光照到的区域就能清楚看出对比。',
            '看「原理图」标签：在 UE 5.8 默认启用 `Substrate` 后，虽然颜色和粗糙度都连进了 `Substrate Slab`，但 **`Ambient Occlusion`（环境光遮蔽）依然作为独立专用引脚坐在最终材质根节点上**！把 `ORM` 的 `R` 通道单独连给它，引擎就只用它去压暗阴天环境光，对太阳和手电筒直射光一路绿灯放行！',
          ],
          tryItPrompt: '切换到「原理图」视图，看清 T_Stone_ORM 的红色 R 通道是如何绕开颜色节点、直奔根节点 Ambient Occlusion 专用口的。',
          callout: {
            tone: 'ue58',
            title: 'Lumen 下贴图 AO 为什么有时看起来变淡了？',
            body: '确保项目支持 Material AO，再检查间接光主导的区域。正面强直射光会降低 AO 在画面中的对比。舞台将遮蔽来源分别示意。',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '黑漆避坑',
          tag: 'pitfall',
          title: '十万火急防坑：戒掉 BaseColor × AO，别往雕花缝里刷死黑油漆！',
          paragraphs: [
            '很多老派网课教大家“拿颜色贴图乘上 AO 贴图再连进 BaseColor”，觉得这样暗缝更黑更有劲——快来点击顶部 **「看踩坑现象」** 拿手电筒照一下中央深缝看看有多恐怖！',
            '当你写下 `BaseColor × AO` 时，深缝底部的 `AO = 0.08` 直接把砂岩改造成了**比黑煤炭还黑的死黑吸光漆**！哪怕你拿一万瓦探照灯怼到缝底去照，`0.08` 的黑煤依然死黑一片，像裂缝里被人浇了一道洗不掉的黑沥青！牢记铁律：**“AO 进专口，乘进底色毁所有”**。',
          ],
          tryItPrompt: '保持手电筒停在 50% 正中央深缝上，来回切换顶部「看踩坑现象」与「切正确配置」，亲眼对比“照不亮的黑沥青缝”与“照亮见底的真实石缝”！',
          callout: {
            tone: 'warn',
            title: '一句话防坑口诀',
            body: 'BaseColor 里永远只准放干干净净的纯物质本色，绝不准混入任何阴影或 AO；AO 永远单独连进根节点的 Ambient Occlusion 引脚！',
          },
        },
      ],
    },

    {
      id: 'shadows-vsm-colored',
      moduleId: '07',
      number: '7.5',
      title: '阴影系统（Shadows）与材质联动 —— 本影半影、UE 5.8 虚拟阴影（VSM）、镂空叶影与彩玻投影',
      subtitle: '为什么树根影子硬、树梢影子软？一屏体验 Masked 叶影、风吹树动 VSM 缓存失效与教堂彩窗投影',
      duration: '15 分钟',
      difficulty: '进阶',
      StageComponent: Stage7_5_ShadowsVsmColored,
      schematic: schematic7_5,
      takeaways: [
        '太阳是有宽度的圆盘而非针尖点光源：贴地根部影子像刀切（本影 Umbra），离地面越远的树梢影子边缘越柔（半影 Penumbra）。',
        '树叶平面插片必须切到 Masked（遮罩镂空）模式，太阳测距图才会放阳光穿过叶缝，否则会投出整块假黑纸板影！',
        'VSM 缓存能复用未失效的阴影页；光源移动、模型组件（Primitive）变化、顶点风力偏移 WPO（World Position Offset）或新可见区域都会触发缓存刷新。舞台以 48 格示意页状态。',
        '透射材质可给地板留下彩影，但需选择支持彩色透射阴影的光照路径。这里示意静态 Lightmass 的效果。',
      ],
      steps: [
        {
          stepNumber: 1,
          shortLabel: '近实远虚',
          tag: 'phenomenon',
          title: '低头看公园大树的影子：为什么树干贴地处像刀刻，树梢影子却毛茸茸？',
          paragraphs: [
            '晴天走在院子里看一根石柱或大树的影子，你会发现同一个影子的边缘软硬竟然不一样：**紧贴地面的柱脚根部，影子边缘锐利得像拿美工刀刻出来的；可顺着影子往远处柱顶方向看，边缘却渐渐晕开成一圈柔和的羽毛边！**',
            '而且树叶投在地上的是星星点点的金色光斑，教堂花窗投在地上的是绚丽的红蓝彩影——这些影子跟我们的材质到底是怎么打配合的？',
          ],
          tryItPrompt: '观察舞台左侧①号石柱的斜长影子，再左右拉动下方「太阳圆盘张角 & 树冠高度」滑块，看柱梢远端影子是如何变柔变宽而柱脚始终锐利的！',
        },
        {
          stepNumber: 2,
          shortLabel: '半影与测距',
          tag: 'background',
          title: '太阳圆盘造就“半影”，显卡站上太阳拍“测距底片”造就阴影',
          paragraphs: [
            '原因很简单：天上的太阳不是针尖大小的一个点，而是一块有宽度的发光圆盘！离遮挡物越远，地面上“只被挡住半边太阳”的过渡带（**半影 Penumbra**）就越宽，影子自然近实远虚。',
            '那显卡是怎么知道地上哪儿有影子的？它用了个超聪明的办法（**阴影贴图 Shadow Map**）：先假装自己坐在太阳上往院子里拍一张“距离照片”，记下阳光最先撞上树叶是 `5米`；等画到地面（离太阳 `12米`）时一查表——哎呀，前面 `5米` 处早被树叶挡住了，当场给地面画上阴影（注意阴影里还有蓝天环境光，绝不是纯黑）！',
          ],
          tryItPrompt: '点击下方混合模式把树叶切成「⬛ Opaque」，看看当材质没告诉太阳“哪里是叶缝窟窿”时，地上会投出什么滑稽的假影子！',
          callout: {
            tone: 'tip',
            title: '本影 (Umbra) vs 半影 (Penumbra) vs 接触阴影',
            body: '太阳完全照不到的中心深影叫本影；边缘过渡灰带叫半影；而草根、鞋底紧贴地面那几毫米的极细锐利暗线，在引擎里常由屏幕接触阴影（Contact Shadows）专门补足，彻底消灭角色“飘在地上”的悬浮感！',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '叶影与彩窗',
          tag: 'experiment',
          title: '亲手切换镂空叶影、彩绘花窗与风吹动态阴影！',
          paragraphs: [
            '游戏里的树叶为了省三角形，其实是在一张正方形透明卡片上画一片枫叶。如果材质选默认 `Opaque（不透明）`，太阳测距眼看不到贴图透明区，就会老老实实在地上投出**两块丑陋的大黑方块纸板影**！一旦切回 **`Masked（遮罩镂空）`**，阳光立刻穿过叶缝洒下斑驳碎金！',
            '再看右侧③号区域：勾选 **「🌈 显示静态烘焙彩窗示意」**，阳光穿过玫瑰红、钴蓝与琥珀金玻璃薄片，把绚丽的彩色图案直接染在了石板地上！接着把下方 **「组件与材质 WPO 对照」** 切换到 **「风力生效」**（`WPO`，即 `World Position Offset` 世界位置偏移，是让材质直接推动树叶顶点随风摇摆的引脚，详见第 9.2 课），整片树影立刻随微风鲜活摇曳起来。',
          ],
          tryItPrompt: '先对比树叶的 Masked 与 Opaque 投影天壤之别，再把「组件与材质 WPO 对照」切到「风力生效」并打开「🔍 VSM 缓存页示意」准备迎接性能真相！',
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5.8 VSM',
          tag: 'ue5',
          title: '走进 UE 5.8：看懂虚拟阴影贴图（VSM）的“绿格缓存”与“红格失效”',
          paragraphs: [
            '以前老引擎远处影子锯齿严重、近处又模糊。**UE 5.8 默认启用了王牌技术 `Virtual Shadow Maps（虚拟阴影贴图 · VSM）`**（配合 `MegaLights`——UE 5.5+ 引入的海量实时动态投影光源系统）：它像手机电子地图一样把全院子切成无数小方格分页，镜头凑近哪格就自动把哪格阴影放大到极致清晰！',
            '为了省算力，只要东西不动，VSM 就会把算好的阴影页标绿缓存直接复用。网页把 12×4 个方格中的一片树冠标成可失效区域，方便你直观对比 `WPO` 与缓存的关系；在引擎里可通过视口 `Virtual Shadow Map → Cached Page` 可视化（固定灯与镜头）检查真实命中与失效。',
          ],
          tryItPrompt: '保持「🔍 VSM 缓存页示意」开启，依次切换「风力生效 / 材质位移乘零 / 组件距离停用 WPO」，观察红绿分页的切换规律！（红格是示意区域，不可直接换算为项目 GPU 耗时）',
          callout: {
            tone: 'ue58',
            title: 'UE 5.8 彩绘玻璃投影怎么做？（两种路径）',
            body: '路径① 静态烘焙（Lightmass）：需确保项目开启 Allow Static Lighting（与 7.4 测动态 Material AO 恰好相反），将 GI 设为 None，使用 Static 定向光、静态花窗与带 lightmap UV 的地板；花窗用 Default Lit / Translucent（Lighting Mode 选 Surface Translucency Volume，彩纹接 Base Color、Opacity 设 0.5，开 Two Sided 与 Cast Shadow）后执行 Build Lighting Only。路径② 离线/高质量实时：用 Path Tracer 配合 Thin Translucent（默认 Lumen GI 不支持此透射彩影）。',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '森林避坑',
          tag: 'pitfall',
          title: '开放世界救命铁律：近处迎风摇曳，百米外树林请乖乖停摆保缓存！',
          paragraphs: [
            '很多同学第一次做森林关卡时帧率暴跌一半，一查性能分析全是阴影耗时爆炸——原因正是全地图一万棵树直到两公里外都在跑 `World Position Offset` 微风摇摆，导致全屏成千上万个 `VSM` 阴影格每帧集体爆红重算！',
            '在支持的植被实例或静态网格组件上设置 `World Position Offset Disable Distance = 3500` cm，穿过距离阈值观察 VSM Cached Page。材质中把位移乘零可以令树叶看似静止，但仍可能触发 WPO 失效判断。其他物体、灯和新可见页仍会影响结果。',
          ],
          tryItPrompt: '查看原理图，区分材质风力渐变和组件距离属性。用固定灯穿过距离阈值，待视点停止后观察缓存页。',
          callout: {
            tone: 'warn',
            title: '一句话防坑口诀',
            body: '做树叶必开 Masked 抠叶影；做风吹必设远景停摆距离（WPO Disable Distance），别让看不见的远山微风毁掉整张图的 VSM 绿色缓存！',
          },
        },
      ],
    },
  ],
};

/* ============================================================================
 * 8.1 微表面理论与能量守恒 —— 放大一万倍看粗糙表面，光斑越散为什么越暗？
 * ============================================================================ */

const MICRO_JITTER = [
  -0.92, 0.74, -0.58, 0.88, -0.35, 0.61, -0.84, 0.42, -0.69, 0.95, -0.22,
  0.53, -0.77, 0.31, -0.96, 0.67, -0.48, 0.82, -0.19, 0.59, -0.73, 0.44,
];

const Stage8_1_MicrofacetEnergy: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [roughness, setRoughness] = useState<number>(0.14);
  const [isMetal, setIsMetal] = useState<boolean>(false);
  const [sunDeg, setSunDeg] = useState<number>(32);
  const [pulsePhase, setPulsePhase] = useState<number>(0);
  const sphereCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setRoughness(0.14);
    setIsMetal(false);
    setSunDeg(32);
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 1) {
      setRoughness(0.68);
    } else if (stepIndex === 0) {
      setRoughness(0.08);
    }
  }, [stepIndex, resetSignal]);

  // 22 道金色光子脉冲轻量动画
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      setPulsePhase(((now - t0) / 1000) % 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 统计 22 道微观光线的弹射与山谷自遮挡 G
  const incRad = (sunDeg * Math.PI) / 180;
  const L2: Vec3 = [-Math.sin(incRad), Math.cos(incRad), 0]; // 左上方射入

  const rayStats = MICRO_JITTER.map((jit, i) => {
    const xHit = 22 + i * 19.5;
    // 微小平面法线倾角随 Roughness 增大而剧烈起伏
    const tiltRad = jit * Math.pow(roughness, 1.05) * 0.92;
    const isValley = i % 2 === 1;
    const yHit = 128 + (isValley ? 1 : -1) * roughness * 16;
    const Nf: Vec3 = [Math.sin(tiltRad), Math.cos(tiltRad), 0];
    const Rdir = reflect3([-L2[0], -L2[1], 0], Nf);
    // 仅山谷底部的低掠射反射（或朝下钻入表面的射线）会被隔壁陡峭山坡自遮挡，山峰顶点的向上反射不会被误标为遮挡
    const trapped =
      Rdir[1] < 0 ||
      (isValley && Rdir[1] < 0.14 + roughness * 0.32 && roughness > 0.22);
    return { xHit, yHit, Nf, Rdir, trapped };
  });

  const trappedCount = rayStats.filter((r) => r.trapped).length;
  const alpha = roughness ** 2;
  const ggxPeak = 1 / (Math.PI * alpha ** 2);
  const formatGgxPeak = (v: number) =>
    v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(1) : v.toFixed(2);

  useEffect(() => {
    onKpiUpdate([
      {
        label: '粗糙度 Roughness',
        value: roughness.toFixed(2),
        sub: roughness < 0.2 ? '小镜子整齐排列' : roughness > 0.65 ? '微山谷陡峭崎岖' : '中等磨砂起伏',
        tone: 'accent',
      },
      {
        label: '微面峰值集中度 D(0)',
        value: formatGgxPeak(ggxPeak),
        sub: roughness < 0.25 ? '光束高度集中 · 小而刺眼' : '四散摊薄 · 宽而柔和',
        tone: roughness < 0.25 ? 'good' : 'neutral',
      },
      {
        label: '剖面示意中低角度出射',
        value: `${trappedCount} / 22 束被挡`,
        sub: '按图中山谷反射方向标记；非 Smith G 精确值',
        tone: trappedCount > 4 ? 'warn' : 'good',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roughness, isMetal, sunDeg]);

  // 绘制底部宏观 GGX 材质球
  useEffect(() => {
    const canvas = sphereCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 196;
    const H = 196;
    const img = ctx.createImageData(W, H);
    const data = img.data;
    const cx = W * 0.5;
    const cy = H * 0.5;
    const R = 76;

    const L3: Vec3 = norm3([-Math.sin(incRad) * 0.85, 0.52, Math.cos(incRad)]);
    const V3: Vec3 = [0, 0, 1];
    const baseLinear: Vec3 = isMetal ? [0.86, 0.72, 0.48] : [0.56, 0.11, 0.09];

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;
        const bg = stageBgBackdrop(px, py, W, H, isDark, 'neutral');

        const dx = px + 0.5 - cx;
        const dy = cy - (py + 0.5);
        const dist = Math.hypot(dx, dy);
        const cov = clamp(R + 0.65 - dist, 0, 1);

        if (cov <= 0) {
          data[idx] = Math.round(bg[0] * 255);
          data[idx + 1] = Math.round(bg[1] * 255);
          data[idx + 2] = Math.round(bg[2] * 255);
          data[idx + 3] = 255;
          continue;
        }

        const rNorm = Math.min(0.9995, dist / R);
        const scaleXY = dist > 1e-5 ? rNorm / (dist / R) : 1;
        const nx = (dx / R) * scaleXY;
        const ny = (dy / R) * scaleXY;
        const nz = Math.sqrt(Math.max(0.0004, 1 - nx * nx - ny * ny));

        const col = shadePbrPixel({
          N: [nx, ny, nz],
          V: V3,
          L: L3,
          baseColorLinear: baseLinear,
          metallic: isMetal ? 1.0 : 0.0,
          roughness,
          envMode: 'studio',
          lightIntensity: 2.9,
        });

        data[idx] = Math.round(lerp(bg[0], col[0], cov) * 255);
        data[idx + 1] = Math.round(lerp(bg[1], col[1], cov) * 255);
        data[idx + 2] = Math.round(lerp(bg[2], col[2], cov) * 255);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [roughness, isMetal, incRad, isDark]);

  // 拼接微表面 V 型山谷折线顶点
  const ridgePoints = [
    '0,170',
    '8,128',
    ...rayStats.map((r) => `${r.xHit.toFixed(1)},${r.yHit.toFixed(1)}`),
    '442,128',
    '450,170',
  ].join(' ');

  // GGX 钟形分布曲线路径（采用平滑对数纵轴，让 0.05 ~ 0.90 全区间都能清晰看到峰高剧烈升降，不再平顶截断）
  const ndfCurvePoints: string[] = [];
  const logNormDenom = Math.log1p(55000 * 3);
  for (let i = 0; i <= 80; i++) {
    const t = (i / 80) * 2 - 1; // -1..1
    const cosH = Math.cos(t * 1.15);
    const a2 = alpha ** 2;
    const denom = cosH * cosH * (a2 - 1) + 1;
    const dVal = a2 / (Math.PI * denom * denom);
    const hNorm = Math.min(1, Math.log1p(dVal * 3) / logNormDenom);
    const yPlot = 78 - hNorm * 64;
    const xPlot = 14 + (i / 80) * 192;
    ndfCurvePoints.push(`${xPlot.toFixed(1)},${yPlot.toFixed(1)}`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 上舱：10000 倍显微镜 V 型微山谷 + 22 道动态金色光子散射舱 */}
      <div
        style={{
          background: '#151311',
          border: '1.5px solid var(--border-strong)',
          borderRadius: 12,
          padding: '8px 10px',
          color: '#f5efe6',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11.5,
            fontWeight: 700,
            marginBottom: 4,
          }}
        >
          <span>🔬 放大 10,000 倍电子显微镜：22 道激光撞击微表面 V 型山谷</span>
          <span style={{ color: '#fbbf24', fontFamily: 'var(--font-mono)' }}>
            {roughness < 0.2
              ? '齐刷刷同向反射 → 极亮小高光'
              : `天女散花摊薄 + ${trappedCount} 束卡在山谷里 (G)`}
          </span>
        </div>

        <svg viewBox="0 0 450 166" style={{ width: '100%', height: 'auto', borderRadius: 8 }}>
          <rect x="0" y="0" width="450" height="166" fill="#1b1815" />

          {/* 22 道入射光线 + 弹射光线 + 动态行进光子亮珠 */}
          {rayStats.map((r, idx) => {
            const sx = r.xHit + L2[0] * 105;
            const sy = r.yHit - L2[1] * 105;
            const outLen = r.trapped ? 24 : 96;
            const ex = r.xHit + r.Rdir[0] * outLen;
            const ey = r.yHit - r.Rdir[1] * outLen;

            // 光子脉冲坐标
            const localT = (pulsePhase + (idx % 5) * 0.18) % 1;
            const px =
              localT < 0.5
                ? lerp(sx, r.xHit, localT * 2)
                : lerp(r.xHit, ex, (localT - 0.5) * 2);
            const py =
              localT < 0.5
                ? lerp(sy, r.yHit, localT * 2)
                : lerp(r.yHit, ey, (localT - 0.5) * 2);

            return (
              <g key={idx}>
                {/* 入射金色光束 */}
                <line
                  x1={sx}
                  y1={sy}
                  x2={r.xHit}
                  y2={r.yHit}
                  stroke="rgba(251, 191, 36, 0.35)"
                  strokeWidth="1.2"
                />
                {/* 反射光束：正常为亮金，撞上邻谷自遮挡为珊瑚红虚线 */}
                <line
                  x1={r.xHit}
                  y1={r.yHit}
                  x2={ex}
                  y2={ey}
                  stroke={r.trapped ? '#f87171' : '#facc15'}
                  strokeWidth={r.trapped ? '1.8' : '1.7'}
                  strokeDasharray={r.trapped ? '3 2' : undefined}
                  opacity={r.trapped ? 0.95 : 0.85}
                />
                <circle
                  cx={px}
                  cy={py}
                  r={2.2}
                  fill={r.trapped && localT >= 0.5 ? '#ef4444' : '#fef08a'}
                />
              </g>
            );
          })}

          {/* 微表面 V 型锯齿山谷基底 */}
          <polygon points={ridgePoints} fill="#38322c" stroke="#a8a29e" strokeWidth="2" />
          <text x="12" y="158" fill="#d6d3d1" fontSize="10.5" fontWeight="bold">
            微表面基底（每段小斜坡都是 100% 理想微镜子；黄线=成功弹走，红虚线=撞上隔壁山坡自遮挡 G）
          </text>
        </svg>
      </div>

      {/* 下舱：左 GGX 3D 球 + 右 GGX 峰值曲线 & 实时能量守恒分配条 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '212px minmax(0, 1fr)',
          gap: 10,
        }}
      >
        <div
          style={{
            background: isDark ? '#1e1b18' : '#fffdf9',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span style={{ fontSize: 11.5, fontWeight: 700 }}>🌐 宏观 GGX 材质球</span>
          <canvas
            ref={sphereCanvasRef}
            width={196}
            height={196}
            style={{ width: 176, height: 176, borderRadius: 10, border: '1px solid var(--border-soft)' }}
          />
        </div>

        <div
          style={{
            background: isDark ? '#1e1b18' : '#fffdf9',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700 }}>
              <span>GGX 微面朝向分布曲线 D（对数纵轴展示峰高变化）</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                D(0) ≈ {formatGgxPeak(ggxPeak)}
              </span>
            </div>
            <svg viewBox="0 0 220 88" style={{ width: '100%', height: 82, marginTop: 4 }}>
              <rect x="0" y="0" width="220" height="88" rx="6" fill={isDark ? '#151311' : '#f4efe4'} />
              <line x1="14" y1="78" x2="206" y2="78" stroke="#78716c" strokeWidth="1.2" />
              <polyline
                points={ndfCurvePoints.join(' ')}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2.6"
              />
            </svg>
          </div>

          <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45, margin: 0 }}>
            越光滑，小镜子越齐刷刷挤在正中（峰值飙升）；越粗糙，朝向摊平散开（峰值骤降）。注：峰值 D(0) = 1/(π·α²) 属立体角密度（单位 sr⁻¹），真实能量守恒由整个半球积分保证。
          </p>
        </div>
      </div>

      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSlider
            label="🔬 粗糙度 Roughness (微山谷崎岖度)"
            value={roughness}
            min={0.05}
            max={0.92}
            step={0.01}
            onChange={setRoughness}
          />
          <StageSlider
            label="☀️ 入射阳光倾角"
            value={sunDeg}
            min={10}
            max={65}
            step={1}
            unit="°"
            onChange={setSunDeg}
          />
          <StageToggle
            label="切换为纯金属表面 (钛金)"
            checked={isMetal}
            hint="漫反射归零·全看镜面散射"
            onChange={setIsMetal}
          />
        </div>
      </div>
    </div>
  );
};

const schematic8_1: SchematicDiagram = {
  title: '现代 PBR（Cook-Torrance GGX）微表面三剑客 D · F · G 协作图',
  caption: '概念图：D、G、F 是渲染器用于求值镜面 BRDF 的项。在材质编辑器中给 Slab 提供 Roughness 和 F0，渲染器在照明阶段计算这些函数。',
  nodes: [
    {
      id: 'n_rough',
      title: 'Roughness (粗糙度)',
      subtitle: '0=镜面平整 · 1=微谷崎岖',
      category: 'param',
      x: 20,
      y: 86,
      width: 175,
      outputs: [{ id: 'r', label: '0 ~ 1', color: '#22c55e' }],
    },
    {
      id: 'n_d',
      title: 'D · GGX 法线分布函数',
      subtitle: '有多少小镜子刚好朝向 H？',
      category: 'math',
      x: 245,
      y: 22,
      width: 200,
      inputs: [{ id: 'r', label: 'Roughness', color: '#22c55e' }],
      outputs: [{ id: 'd', label: '光斑宽窄与峰值', color: '#f59e0b' }],
      note: '光斑越宽，峰值自动成比例降低',
    },
    {
      id: 'n_g',
      title: 'G · Smith 几何遮蔽函数',
      subtitle: '陡峭山谷挡住了多少弹射光？',
      category: 'math',
      x: 245,
      y: 144,
      width: 200,
      inputs: [{ id: 'r', label: 'Roughness', color: '#22c55e' }],
      outputs: [{ id: 'g', label: '无遮挡存活率', color: '#ef4444' }],
    },
    {
      id: 'n_f',
      title: 'F · Schlick 菲涅尔项',
      subtitle: '表皮弹走多少 vs 钻入多少',
      category: 'math',
      x: 245,
      y: 256,
      width: 200,
      outputs: [{ id: 'f', label: '镜面分流比 F', color: '#38bdf8' }],
    },
    {
      id: 'n_slab',
      title: '镜面 BRDF 求值',
      subtitle: 'D·G·F / [4(N·L)(N·V)]',
      category: 'substrate',
      x: 500,
      y: 108,
      width: 210,
      inputs: [
        { id: 'd', label: 'D (分布)', color: '#f59e0b' },
        { id: 'g', label: 'G (几何)', color: '#ef4444' },
        { id: 'f', label: 'F (菲涅尔)', color: '#38bdf8' },
      ],
      outputs: [{ id: 'bsdf', label: '镜面 BRDF', color: '#a855f7' }],
    },
    {
      id: 'n_root',
      title: '场景光照求值',
      subtitle: '渲染器照明阶段',
      category: 'output',
      x: 745,
      y: 128,
      width: 155,
      inputs: [{ id: 'front', label: '镜面 BRDF', color: '#a855f7' }],
    },
  ],
  edges: [
    { fromNode: 'n_rough', fromPin: 'r', toNode: 'n_d', toPin: 'r', color: '#22c55e' },
    { fromNode: 'n_rough', fromPin: 'r', toNode: 'n_g', toPin: 'r', color: '#22c55e' },
    { fromNode: 'n_d', fromPin: 'd', toNode: 'n_slab', toPin: 'd', color: '#f59e0b' },
    { fromNode: 'n_g', fromPin: 'g', toNode: 'n_slab', toPin: 'g', color: '#ef4444' },
    { fromNode: 'n_f', fromPin: 'f', toNode: 'n_slab', toPin: 'f', color: '#38bdf8' },
    { fromNode: 'n_slab', fromPin: 'bsdf', toNode: 'n_root', toPin: 'front', color: '#a855f7' },
  ],
};

/* ============================================================================
 * 8.2 菲涅尔效应（Fresnel） —— 低头看湖水清澈见鱼，抬头看远方湖面全成镜子
 * ============================================================================ */

type FresnelMatKey = 'water' | 'plastic' | 'diamond' | 'gold';

const FRESNEL_MATS: Record<
  FresnelMatKey,
  { label: string; f0: number; tint: Vec3; desc: string }
> = {
  water: { label: '💧 湖水 (F0=0.02)', f0: 0.02, tint: [1, 1, 1], desc: '正看仅反射 2%，水底清澈见鱼' },
  plastic: { label: '🧱 塑料/石头 (F0=0.04)', f0: 0.04, tint: [1, 1, 1], desc: '绝大多数非金属通用黄金底数 4%' },
  diamond: { label: '💎 钻石 (F0=0.17)', f0: 0.17, tint: [1, 1, 1], desc: '高折射率宝石，正看也有 17% 强火彩' },
  gold: { label: '🪙 金属示意 (F0=0.92)', f0: 0.92, tint: [1.0, 0.84, 0.42], desc: '金属导体：哪怕 0° 低头正看也是镜子！' },
};

const Stage8_2_FresnelLakeside: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [viewDeg, setViewDeg] = useState<number>(14); // 0° 垂直低头看脚下 -> 88° 抬头平视远方掠射角
  const [matKey, setMatKey] = useState<FresnelMatKey>('water');
  const [shieldMode, setShieldMode] = useState<boolean>(false);
  const [fresnelExp, setFresnelExp] = useState<number>(4.2);
  const [isFixedPitfall, setIsFixedPitfall] = useState<boolean>(false);
  const [swimTime, setSwimTime] = useState<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setViewDeg(14);
    setMatKey('water');
    setShieldMode(false);
    setFresnelExp(4.2);
    setIsFixedPitfall(false);
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 3) {
      setShieldMode(true);
    } else if (stepIndex === 4) {
      setShieldMode(false);
      setMatKey('water');
      setIsFixedPitfall(true);
    } else if (stepIndex === 0) {
      setShieldMode(false);
      setIsFixedPitfall(false);
      setViewDeg(12);
    }
  }, [stepIndex, resetSignal]);

  // 锦鲤水下悠游动画（仅在湖畔模式下运行）
  useEffect(() => {
    if (shieldMode) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      setSwimTime((now - t0) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shieldMode]);

  const matInfo = FRESNEL_MATS[matKey];
  const shieldBaseF0 = 0.02;
  const cosTheta = Math.cos((viewDeg * Math.PI) / 180);
  const schlickF = shieldMode
    ? shieldBaseF0 + (1 - shieldBaseF0) * Math.pow(1 - cosTheta, fresnelExp)
    : isFixedPitfall
      ? 0.48 // 错误踩坑：把水面反射死板写成常数 48%
      : matInfo.f0 + (1 - matInfo.f0) * Math.pow(1 - cosTheta, 5);
  const reflPct = Math.round(schlickF * 100);
  const unreflectedPct = 100 - reflPct;

  useEffect(() => {
    onKpiUpdate([
      {
        label: '视线俯仰角 θ',
        value: `${viewDeg}°`,
        sub: viewDeg < 25 ? '👀 低头垂直看脚下' : viewDeg > 70 ? '🌅 抬头平视远方掠射' : '斜向下注视水面',
        tone: 'accent',
      },
      {
        label: shieldMode ? '护盾菲涅尔强度' : '当前镜面反射率 F(θ)',
        value: `${reflPct}%`,
        sub: shieldMode
          ? `中心底亮 BaseReflect = 2% · Exp = ${fresnelExp.toFixed(1)}`
          : `正视底数 F0 = ${(matInfo.f0 * 100).toFixed(0)}%`,
        tone: reflPct > 75 ? 'warn' : 'good',
      },
      {
        label: '界面未反射份额 1−F',
        value: `${unreflectedPct}%`,
        sub: shieldMode
          ? '球心正对镜头高透，轮廓擦边处强发光'
          : matKey === 'gold'
            ? '实心金属中的该份额被吸收'
            : matKey === 'plastic'
              ? '不透明物体内部吸收、散射'
              : '背景可见度另受吸收、散射与路程影响',
        tone: 'neutral',
      },
      {
        label: '舞台预览模式',
        value: shieldMode ? '🛡️ 角色边缘发光护盾' : '🏞️ 湖畔看鱼/看天模拟',
        sub: shieldMode ? `Fresnel 指数 = ${fresnelExp.toFixed(1)}` : matInfo.label,
        tone: shieldMode ? 'accent' : 'neutral',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDeg, matKey, shieldMode, fresnelExp, isFixedPitfall]);

  // 绘制湖畔俯仰模拟器 或 角色边缘发光护盾预览球
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 310;
    const H = 206;

    if (shieldMode) {
      // 模式 B：UE 5.8 Fresnel 节点科幻能量护盾球渲染
      const img = ctx.createImageData(W, H);
      const data = img.data;
      const cx = W * 0.5;
      const cy = H * 0.5;
      const R = 80;

      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const idx = (py * W + px) * 4;
          // 深空科幻网格背景（与球内共用线性空间 + ACES + sRGB 转换，消除中心灰阶跳变）
          const gridLin =
            px % 22 === 0 || py % 22 === 0 ? 0.022 : 0.005 + 0.004 * (1 - py / H);
          const bgLinR = gridLin * 0.78;
          const bgLinG = gridLin * 1.0;
          const bgLinB = gridLin * 1.42;

          let rOut = linearToSrgb(acesTonemap(bgLinR));
          let gOut = linearToSrgb(acesTonemap(bgLinG));
          let bOut = linearToSrgb(acesTonemap(bgLinB));

          const dx = px + 0.5 - cx;
          const dy = cy - (py + 0.5);
          const dist = Math.hypot(dx, dy);
          const cov = clamp(R + 0.7 - dist, 0, 1);

          if (cov > 0) {
            const rNorm = Math.min(0.9995, dist / R);
            const scaleXY = dist > 1e-5 ? rNorm / (dist / R) : 1;
            const nx = (dx / R) * scaleXY;
            const ny = (dy / R) * scaleXY;
            const nz = Math.sqrt(Math.max(0.001, 1 - nx * nx - ny * ny)); // N · V 正好就是 nz！

            // 护盾模式使用独立的透明底数 shieldBaseF0 = 0.02，避免被金属预设 F0 污染成实心球
            const fres = shieldBaseF0 + (1 - shieldBaseF0) * Math.pow(1 - nz, fresnelExp);
            // 六边形蜂巢能量纹理感
            const hexWave = 0.85 + 0.15 * Math.sin(nx * 26) * Math.cos(ny * 26);
            const glow = fres * hexWave * 2.4;

            const sr = linearToSrgb(acesTonemap(bgLinR + glow * 0.16));
            const sg = linearToSrgb(acesTonemap(bgLinG + glow * 0.82));
            const sb = linearToSrgb(acesTonemap(bgLinB + glow * 1.35));

            rOut = lerp(rOut, sr, cov);
            gOut = lerp(gOut, sg, cov);
            bOut = lerp(bOut, sb, cov);
          }

          data[idx] = Math.round(clamp(rOut, 0, 1) * 255);
          data[idx + 1] = Math.round(clamp(gOut, 0, 1) * 255);
          data[idx + 2] = Math.round(clamp(bOut, 0, 1) * 255);
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);

      ctx.save();
      ctx.fillStyle = 'rgba(12, 18, 28, 0.82)';
      ctx.beginPath();
      ctx.roundRect(10, H - 28, W - 20, 20, 5);
      ctx.fill();
      ctx.fillStyle = '#7dd3fc';
      ctx.font = 'bold 10.5px sans-serif';
      ctx.fillText('🛡️ 球心正对镜头(0°)透明，球边缘擦边(90°)触发菲涅尔强发光！', 16, H - 14);
      ctx.restore();
      return;
    }

    // 模式 A：湖畔低头看鱼 / 抬头看天模拟器
    ctx.clearRect(0, 0, W, H);

    // 1. 先画水下世界（河床鹅卵石、水草、焦散波纹、两条游动红白锦鲤）
    const underGrad = ctx.createLinearGradient(0, 0, 0, H);
    underGrad.addColorStop(0, '#134e4a');
    underGrad.addColorStop(1, '#0f292e');
    ctx.fillStyle = underGrad;
    ctx.fillRect(0, 0, W, H);

    // 彩色鹅卵石群
    const pebbles = [
      [42, 46, 18, 13, '#a8896c'],
      [88, 68, 22, 15, '#78716c'],
      [148, 42, 19, 14, '#c29b70'],
      [212, 62, 24, 16, '#8b735b'],
      [268, 48, 17, 12, '#a39887'],
      [62, 142, 25, 17, '#9a7b5c'],
      [132, 156, 21, 15, '#6b7280'],
      [196, 138, 26, 17, '#b5926b'],
      [256, 152, 20, 14, '#7c6f64'],
      [105, 112, 18, 13, '#b08d6a'],
    ] as const;

    for (const [px, py, rx, ry, col] of pebbles) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 摇曳水草
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (const gx of [34, 175, 282]) {
      ctx.beginPath();
      ctx.moveTo(gx, H);
      ctx.quadraticCurveTo(
        gx + Math.sin(swimTime * 2 + gx) * 12,
        H - 45,
        gx + Math.cos(swimTime * 1.6 + gx) * 16,
        H - 85
      );
      ctx.stroke();
    }

    // 两条游动锦鲤
    const drawKoi = (baseX: number, baseY: number, dir: number, phase: number, bodyCol: string) => {
      const fx = ((baseX + dir * swimTime * 26) % (W + 60) + (W + 60)) % (W + 60) - 30;
      const fy = baseY + Math.sin(swimTime * 2.4 + phase) * 6;
      const wag = Math.sin(swimTime * 7 + phase) * 5;
      ctx.save();
      ctx.translate(fx, fy);
      if (dir < 0) ctx.scale(-1, 1);

      // 鱼尾
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.lineTo(-28, -9 + wag);
      ctx.lineTo(-25, 0 + wag * 0.5);
      ctx.lineTo(-28, 9 + wag);
      ctx.closePath();
      ctx.fill();

      // 鱼身
      ctx.fillStyle = bodyCol;
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 7.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // 锦鲤红斑
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(4, -1, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // 鱼眼
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(13, -2, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    drawKoi(90, 92, 1, 0, '#fff7ed');
    drawKoi(220, 126, -0.85, 2.1, '#fed7aa');

    // Only the lake preset uses an underwater background.
    if (matKey !== 'water') {
      ctx.fillStyle = matKey === 'gold' ? '#100e0a' : matKey === 'plastic' ? '#965b42' : '#aaaeb9';
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = 'rgba(28, 81, 75, 0.25)';
      ctx.fillRect(0, 0, W, H);
    }
    // 2. 按菲涅尔反射率 schlickF 叠加“晚霞蓝天远山大镜子倒影层”！
    ctx.save();
    ctx.globalAlpha = clamp(schlickF, 0, 1);

    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    if (matKey === 'gold') {
      skyGrad.addColorStop(0, '#fef08a');
      skyGrad.addColorStop(0.55, '#f59e0b');
      skyGrad.addColorStop(1, '#b45309');
    } else {
      skyGrad.addColorStop(0, '#1d4ed8');
      skyGrad.addColorStop(0.48, '#60a5fa');
      skyGrad.addColorStop(0.78, '#fdba74');
      skyGrad.addColorStop(1, '#f97316');
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // 倒映的晚霞夕阳与远山剪影
    ctx.fillStyle = matKey === 'gold' ? '#fffbeb' : '#fef08a';
    ctx.beginPath();
    ctx.arc(W * 0.72, H * 0.36, 22, 0, Math.PI * 2);
    ctx.fill();

    // 白云倒影
    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.beginPath();
    ctx.ellipse(86, 48, 36, 11, 0, 0, Math.PI * 2);
    ctx.ellipse(112, 44, 26, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // 远山倒影
    ctx.fillStyle = matKey === 'gold' ? 'rgba(120, 53, 15, 0.55)' : 'rgba(49, 46, 129, 0.68)';
    ctx.beginPath();
    ctx.moveTo(0, H * 0.78);
    ctx.lineTo(58, H * 0.52);
    ctx.lineTo(126, H * 0.72);
    ctx.lineTo(205, H * 0.46);
    ctx.lineTo(275, H * 0.68);
    ctx.lineTo(W, H * 0.56);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // 细微波光横纹
    ctx.strokeStyle = 'rgba(255,255,255,0.38)';
    ctx.lineWidth = 1.2;
    for (let ry = 22; ry < H; ry += 18) {
      const off = Math.sin(swimTime * 2 + ry) * 8;
      ctx.beginPath();
      ctx.moveTo(25 + off, ry);
      ctx.lineTo(95 + off, ry);
      ctx.moveTo(185 - off, ry + 6);
      ctx.lineTo(265 - off, ry + 6);
      ctx.stroke();
    }
    ctx.restore();

    // 顶部实时状态说明条
    ctx.save();
    ctx.fillStyle = 'rgba(18, 16, 15, 0.82)';
    ctx.beginPath();
    ctx.roundRect(8, 8, W - 16, 22, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10.5px sans-serif';
    const msg = isFixedPitfall ? '固定反射 48% · 所有角度相同'
      : matKey === 'water' ? `清水示意 · ${viewDeg}° 界面反射 ${reflPct}%（水体颜色另计）`
      : `${matInfo.label} · ${viewDeg}° 界面反射 ${reflPct}%`;
    ctx.fillText(msg, 14, 22.5);
    ctx.restore();
  }, [viewDeg, matKey, shieldMode, fresnelExp, isFixedPitfall, swimTime, matInfo.f0, schlickF, reflPct, unreflectedPct]);

  // 生成右侧 Schlick / 护盾 Fresnel 曲线 SVG 折线
  const curvePts: string[] = [];
  for (let d = 0; d <= 90; d += 3) {
    const c = Math.cos((d * Math.PI) / 180);
    const f = shieldMode
      ? shieldBaseF0 + (1 - shieldBaseF0) * Math.pow(1 - c, fresnelExp)
      : isFixedPitfall
        ? 0.48
        : matInfo.f0 + (1 - matInfo.f0) * Math.pow(1 - c, 5);
    const x = 30 + (d / 90) * 196;
    const y = 152 - f * 124;
    curvePts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const activeStartF0 = shieldMode ? shieldBaseF0 : matInfo.f0;
  const dotX = 30 + (viewDeg / 90) * 196;
  const dotY = 152 - schlickF * 124;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={isFixedPitfall}
        pitfallLabel="踩坑做法：做水面/玻璃把反射透明度写死成固定常数 0.48 —— 近看浑浊发雾看不清鱼，远看死板没有镜面通透感"
        correctLabel="Schlick 近似：正入射由 F0 决定，朝掠射角逐渐升高"
        onToggle={(pit) => {
          setIsFixedPitfall(pit);
        }}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(245px, 1fr))',
          gap: 10,
        }}
      >
        {/* 左舱：湖畔模拟器 / 角色护盾预览 */}
        <div
          style={{
            background: isDark ? '#1e1b18' : '#fffdf9',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 11.5, fontWeight: 700 }}>
              {shieldMode ? '🛡️ Fresnel 角色边缘光护盾' : '🏞️ 上下拖动画面体验低头/抬头'}
            </span>
            <StageToggle
              label="切到角色护盾预览"
              checked={shieldMode}
              onChange={setShieldMode}
            />
          </div>

          <canvas
            ref={canvasRef}
            width={310}
            height={206}
            onMouseMove={(e) => {
              if (e.buttons === 1 && !shieldMode) {
                const rect = e.currentTarget.getBoundingClientRect();
                // 鼠标往上拖 = 抬头看远方 (88°)，往下拖 = 低头看脚下 (0°)
                const normY = 1 - clamp((e.clientY - rect.top) / rect.height, 0, 1);
                setViewDeg(Math.round(normY * 88));
              }
            }}
            style={{
              width: '100%',
              height: 'auto',
              borderRadius: 9,
              border: '1.5px solid var(--border-soft)',
              cursor: shieldMode ? 'default' : 'ns-resize',
            }}
          />
        </div>

        {/* 右舱：实时 Schlick 菲涅尔反射率曲线图 */}
        <div
          style={{
            background: isDark ? '#1e1b18' : '#fffdf9',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700 }}>
            <span>
              {shieldMode
                ? `📈 护盾菲涅尔曲线 0.02 + 0.98(1-cosθ)^${fresnelExp.toFixed(1)}`
                : '📈 菲涅尔曲线 F(θ) = F0 + (1-F0)(1-cosθ)⁵'}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', color: '#2563eb' }}>
              {shieldMode ? `Exp = ${fresnelExp.toFixed(1)}` : `F(${viewDeg}°) = ${reflPct}%`}
            </span>
          </div>

          <svg viewBox="0 0 244 182" style={{ width: '100%', height: 'auto', borderRadius: 8 }}>
            <rect x="0" y="0" width="244" height="182" fill={isDark ? '#151311' : '#f4efe4'} />
            {/* 坐标轴 */}
            <line x1="30" y1="26" x2="30" y2="152" stroke="#78716c" strokeWidth="1.4" />
            <line x1="30" y1="152" x2="228" y2="152" stroke="#78716c" strokeWidth="1.4" />
            <line x1="30" y1="28" x2="228" y2="28" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />

            <text x="4" y="32" fill="#64748b" fontSize="9.5">100%</text>
            <text x="10" y="154" fill="#64748b" fontSize="9.5">0%</text>
            <text x="26" y="168" fill="#64748b" fontSize="9.5">0°低头正视</text>
            <text x="166" y="168" fill="#64748b" fontSize="9.5">90°平视擦边</text>

            {/* F0 起点标注 */}
            <text x="35" y={clamp(148 - activeStartF0 * 124, 42, 146)} fill="#16a34a" fontSize="9.5" fontWeight="bold">
              {shieldMode ? '起点 Base = 2%' : `起点 F0 = ${(matInfo.f0 * 100).toFixed(0)}%`}
            </text>

            {/* 曲线主体 */}
            <polyline
              points={curvePts.join(' ')}
              fill="none"
              stroke={!shieldMode && isFixedPitfall ? '#ef4444' : '#3b82f6'}
              strokeWidth="2.8"
            />

            {/* 当前角度动态追踪光点 */}
            <line x1={dotX} y1="152" x2={dotX} y2={dotY} stroke="#f59e0b" strokeWidth="1.3" strokeDasharray="3 2" />
            <circle cx={dotX} cy={dotY} r="5.5" fill="#facc15" stroke="#1e1b18" strokeWidth="1.8" />
          </svg>

          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            角度从表面法线量起。掠射时界面反射增强，粗糙度仍会模糊倒影；下方物体的可见度还取决于介质。
          </div>
        </div>
      </div>

      <div className="stage-controls-panel">
        <StageSegmented
          label="切换物质体验不同的 0° 正视起点 F0"
          value={matKey}
          options={[
            { value: 'water', label: '💧 水 F0=0.02' },
            { value: 'plastic', label: '🧱 塑料/石头 F0=0.04' },
            { value: 'diamond', label: '💎 钻石 F0=0.17' },
            { value: 'gold', label: '🪙 金属示意 F0=0.92' },
          ]}
          onChange={(v) => {
            setMatKey(v);
            setIsFixedPitfall(false);
          }}
        />

        <div className="control-grid">
          {!shieldMode ? (
            <StageSlider
              label="👀 视线俯仰角 θ (0°垂直低头看鱼 → 88°抬头平视远方)"
              value={viewDeg}
              min={0}
              max={88}
              step={1}
              unit="°"
              onChange={setViewDeg}
            />
          ) : (
            <StageSlider
              label="🛡️ UE 5.8 Fresnel 节点 ExponentIn (控制发光边缘宽窄)"
              value={fresnelExp}
              min={1.0}
              max={8.0}
              step={0.1}
              onChange={setFresnelExp}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const schematic8_2: SchematicDiagram = {
  title: 'UE 5.8 Fresnel（菲涅尔）节点实现半透明能量护盾标准连线',
  caption: '写实表面的菲涅尔反射已由 Substrate Slab 自动内置；做半透明能量护盾时，材质必须设为 Blend Mode: Translucent 或 Additive，并将 Fresnel 同时驱动 Emissive 与 Opacity / Coverage！',
  nodes: [
    {
      id: 'n_exp',
      title: 'Scalar: ExponentIn (4.2)',
      subtitle: '数值越大，亮边越窄越锐利',
      category: 'param',
      x: 15,
      y: 34,
      width: 175,
      outputs: [{ id: 'val', label: '4.2', color: '#22c55e' }],
    },
    {
      id: 'n_base',
      title: 'BaseReflectFraction (0.02)',
      subtitle: '正对中心保留多少微光',
      category: 'param',
      x: 15,
      y: 136,
      width: 175,
      outputs: [{ id: 'val', label: '0.02', color: '#e5e7eb' }],
    },
    {
      id: 'n_fres',
      title: 'Fresnel (菲涅尔节点)',
      subtitle: 'BaseReflect+(1-BaseReflect)(1-N·V)^Exp',
      category: 'math',
      x: 220,
      y: 72,
      width: 215,
      inputs: [
        { id: 'exp', label: 'ExponentIn', color: '#22c55e' },
        { id: 'base', label: 'BaseReflectFractionIn', color: '#e5e7eb' },
      ],
      outputs: [{ id: 'out', label: '中心0 → 边缘1', color: '#38bdf8' }],
      note: '圆球轮廓边缘正好全是 90° 掠射角！',
    },
    {
      id: 'n_col',
      title: '护盾霓虹色 (HDR × 8)',
      subtitle: '冰晶蓝发光颜色向量',
      category: 'param',
      x: 220,
      y: 214,
      width: 215,
      previewColor: '#0ea5e9',
      outputs: [{ id: 'rgb', label: 'HDR RGB', color: '#38bdf8' }],
    },
    {
      id: 'n_mul',
      title: 'Multiply (点亮轮廓环)',
      subtitle: '中心黑=0 · 外圈亮=8',
      category: 'math',
      x: 465,
      y: 142,
      width: 165,
      inputs: [
        { id: 'a', label: 'Fresnel', color: '#38bdf8' },
        { id: 'b', label: '发光色', color: '#38bdf8' },
      ],
      outputs: [{ id: 'emit', label: 'Emissive', color: '#38bdf8' }],
    },
    {
      id: 'n_slab',
      title: 'Substrate Slab BSDF',
      subtitle: 'Blend: Translucent / Additive',
      category: 'substrate',
      x: 660,
      y: 88,
      width: 195,
      inputs: [
        { id: 'cov', label: 'Opacity / Coverage', color: '#e5e7eb' },
        { id: 'emissive', label: 'Emissive Color', color: '#38bdf8' },
      ],
      outputs: [{ id: 'bsdf', label: 'BSDF', color: '#a855f7' }],
      note: '未切 Translucent/Additive 会变实心灰球！',
    },
    {
      id: 'n_root',
      title: '材质根节点 (UE 5.8)',
      subtitle: '半透明/叠加混合模式',
      category: 'output',
      x: 885,
      y: 112,
      width: 160,
      inputs: [{ id: 'front', label: 'Front Material', color: '#a855f7' }],
    },
  ],
  edges: [
    { fromNode: 'n_exp', fromPin: 'val', toNode: 'n_fres', toPin: 'exp', color: '#22c55e' },
    { fromNode: 'n_base', fromPin: 'val', toNode: 'n_fres', toPin: 'base', color: '#e5e7eb' },
    { fromNode: 'n_fres', fromPin: 'out', toNode: 'n_mul', toPin: 'a', color: '#38bdf8' },
    { fromNode: 'n_fres', fromPin: 'out', toNode: 'n_slab', toPin: 'cov', color: '#e5e7eb' },
    { fromNode: 'n_col', fromPin: 'rgb', toNode: 'n_mul', toPin: 'b', color: '#38bdf8' },
    { fromNode: 'n_mul', fromPin: 'emit', toNode: 'n_slab', toPin: 'emissive', color: '#38bdf8' },
    { fromNode: 'n_slab', fromPin: 'bsdf', toNode: 'n_root', toPin: 'front', color: '#a855f7' },
  ],
};

/* ============================================================================
 * 8.3 金属度工作流铁律 —— 金属与非金属的光学鸿沟、“混合覆盖率”与 Specular 迷思
 * ============================================================================ */

type MetalPreset = 'gold' | 'plastic' | 'rust_shield' | 'half_pitfall' | 'custom';

const Stage8_3_MetallicThreeLaws: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [preset, setPreset] = useState<MetalPreset>('gold');
  const [hue, setHue] = useState<number>(42);
  const [albedoLum, setAlbedoLum] = useState<number>(0.82); // BaseColor 明度 0..1
  const [metallic, setMetallic] = useState<number>(1.0);
  const [roughness, setRoughness] = useState<number>(0.16);
  const [legacySpec, setLegacySpec] = useState<number>(0.5); // 默认 0.5 -> F0 = 0.04
  const [useRustMask, setUseRustMask] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const applyPreset = (p: MetalPreset) => {
    setPreset(p);
    if (p === 'gold') {
      setHue(42);
      setAlbedoLum(0.84);
      setMetallic(1.0);
      setRoughness(0.15);
      setLegacySpec(0.5);
      setUseRustMask(false);
    } else if (p === 'plastic') {
      setHue(8);
      setAlbedoLum(0.58);
      setMetallic(0.0);
      setRoughness(0.18);
      setLegacySpec(0.5);
      setUseRustMask(false);
    } else if (p === 'rust_shield') {
      setHue(210);
      setAlbedoLum(0.72);
      setMetallic(1.0);
      setRoughness(0.24);
      setLegacySpec(0.5);
      setUseRustMask(true);
    } else {
      setHue(42);
      setAlbedoLum(0.75);
      setMetallic(0.5);
      setRoughness(0.22);
      setLegacySpec(0.5);
      setUseRustMask(false);
    }
  };

  useEffect(() => {
    applyPreset('gold');
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 4) {
      applyPreset('half_pitfall');
    } else if (stepIndex === 0) {
      applyPreset('gold');
    }
  }, [stepIndex, resetSignal]);

  // HSL is a display-space control. Calibrate the gold preset from measured linear RGB.
  const goldG = linearToSrgb(0.766);
  const goldB = linearToSrgb(0.336);
  const goldHue = 60 * (goldG - goldB) / (1 - goldB);
  const tunedSrgb = preset === 'gold'
    ? hslToSrgb(hue + goldHue - 42, 1, saturate(albedoLum + (1 + goldB) / 2 - 0.84))
    : hslToSrgb(hue, preset === 'rust_shield' ? 0.08 : 0.78, albedoLum);

  const baseLin: Vec3 = [
    srgbToLinear(tunedSrgb[0]),
    srgbToLinear(tunedSrgb[1]),
    srgbToLinear(tunedSrgb[2]),
  ];

  // 核心物理公式拆解！
  const diffAlbedoLin: Vec3 = [
    baseLin[0] * (1 - metallic),
    baseLin[1] * (1 - metallic),
    baseLin[2] * (1 - metallic),
  ];
  const dielectricF0 = 0.08 * legacySpec; // Specular=0.5 时精准等于 0.04 (4%)
  const f0Lin: Vec3 = lerp3([dielectricF0, dielectricF0, dielectricF0], baseLin, metallic);

  const diffHex = linearVecToSrgbHex(diffAlbedoLin);
  const f0Hex = linearVecToSrgbHex(f0Lin);
  const diffAvgPct = Math.round(((diffAlbedoLin[0] + diffAlbedoLin[1] + diffAlbedoLin[2]) / 3) * 100);
  const f0AvgPct = Math.round(((f0Lin[0] + f0Lin[1] + f0Lin[2]) / 3) * 1000) / 10;

  // 三大物理合法性温柔体检提示（含真实 BaseColor 极暗/极亮检测）
  const inGrayMetalZone = !useRustMask && metallic > 0.12 && metallic < 0.88;
  const specTouchedOnMetal = !useRustMask && metallic === 1 && Math.abs(legacySpec - 0.5) > 0.08;
  const tooDarkDielectric = !useRustMask && metallic < 0.5 && albedoLum < 0.06;
  const tooBrightDielectric = !useRustMask && metallic < 0.5 && albedoLum > 0.90;
  const tooDarkMetal = !useRustMask && metallic >= 0.5 && albedoLum < 0.45;
  const tooBrightMetal = !useRustMask && metallic >= 0.5 && albedoLum > 0.96;
  const hasHealthWarn =
    inGrayMetalZone ||
    specTouchedOnMetal ||
    tooDarkDielectric ||
    tooBrightDielectric ||
    tooDarkMetal ||
    tooBrightMetal;

  useEffect(() => {
    onKpiUpdate([
      {
        label: '金属度 Metallic',
        value: useRustMask ? '0 / 1 二值遮罩' : metallic.toFixed(2),
        sub: useRustMask ? '好铁=1 · 铁锈氧化物=0' : inGrayMetalZone ? '⚠️ 中间值：检查覆盖混合' : metallic === 1 ? '裸金属' : metallic === 0 ? '绝缘体' : '混合覆盖',
        tone: inGrayMetalZone ? 'bad' : 'good',
      },
      {
        label: '底层实际漫反射色',
        value: useRustMask ? '铁区 0 · 锈区 (0.36, 0.09, 0.025)' : `${diffHex} (${diffAvgPct}%)`,
        sub: metallic === 1 ? '纯金属的漫反射项为零' : '光线钻入表皮染色散射',
        tone: 'accent',
      },
      {
        label: '底层正视镜面 F0',
        value: useRustMask ? `铁区 RGB 均值 66% · 锈区 ${(dielectricF0 * 100).toFixed(1)}%` : `${f0Hex} (${f0AvgPct}%)`,
        sub: metallic < 0.1 ? `由 Specular(${legacySpec.toFixed(2)}) 控无色白光` : '由 BaseColor 给镜面染上金属本色！',
        tone: 'good',
      },
      {
        label: '当前 BaseColor（线性 RGB）',
        value: useRustMask ? '裸铁与锈两组预设' : baseLin.map(v => v.toFixed(3)).join(' / '),
        sub: metallic === 1 ? '纯金属用此颜色作正入射 F0' : '结合金属度读取颜色用途',
        tone: 'neutral',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, hue, albedoLum, metallic, roughness, legacySpec, useRustMask]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 216;
    const H = 216;
    const img = ctx.createImageData(W, H);
    const data = img.data;
    const cx = W * 0.5;
    const cy = H * 0.5;
    const R = 82;

    const L: Vec3 = norm3([0.42, 0.58, 0.7]);
    const V: Vec3 = [0, 0, 1];

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;
        const bg = stageBgBackdrop(px, py, W, H, isDark, 'sunny');

        const dx = px + 0.5 - cx;
        const dy = cy - (py + 0.5);
        const dist = Math.hypot(dx, dy);
        const cov = clamp(R + 0.65 - dist, 0, 1);

        if (cov <= 0) {
          data[idx] = Math.round(bg[0] * 255);
          data[idx + 1] = Math.round(bg[1] * 255);
          data[idx + 2] = Math.round(bg[2] * 255);
          data[idx + 3] = 255;
          continue;
        }

        const rNorm = Math.min(0.9995, dist / R);
        const scaleXY = dist > 1e-5 ? rNorm / (dist / R) : 1;
        const nx = (dx / R) * scaleXY;
        const ny = (dy / R) * scaleXY;
        const nz = Math.sqrt(Math.max(0.0004, 1 - nx * nx - ny * ny));

        let pxBase = baseLin;
        let pxMetal = metallic;
        let pxRough = roughness;

        // 若处于“斑驳生锈铁盾”预设，演示好铁(Metallic=1)与铁锈(Metallic=0)通过黑白锐利遮罩共存，且精钢区响应粗糙度滑块！
        if (useRustMask) {
          const nVal = fbm(nx * 3.8 + 4.2, ny * 3.8 + 1.7, 4);
          const rustMask = nVal > 0.52 ? 1 : 0;
          if (rustMask > 0.5) {
            pxBase = [0.36, 0.09, 0.025]; // 氧化铁锈红棕（绝缘体！）
            pxMetal = 0.0;
          } else {
            pxBase = [0.64, 0.66, 0.69]; // 裸露精钢（纯导体！）
            pxMetal = 1.0;
          }
          pxRough = lerp(roughness, 0.86, rustMask);
        }

        const col = shadePbrPixel({
          N: [nx, ny, nz],
          V,
          L,
          baseColorLinear: pxBase,
          metallic: pxMetal,
          roughness: pxRough,
          specularLevel: legacySpec,
          envMode: 'sunny',
          lightIntensity: 2.5,
        });

        data[idx] = Math.round(lerp(bg[0], col[0], cov) * 255);
        data[idx + 1] = Math.round(lerp(bg[1], col[1], cov) * 255);
        data[idx + 2] = Math.round(lerp(bg[2], col[2], cov) * 255);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [preset, hue, albedoLum, metallic, roughness, legacySpec, useRustMask, isDark]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 顶部快速预设切换 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <StageSegmented
          label="一键切换经典物质解剖预设"
          value={preset}
          options={[
            { value: 'gold', label: '🪙 24K 纯金 (1.0)' },
            { value: 'plastic', label: '🧱 红乐高塑料 (0.0)' },
            { value: 'rust_shield', label: '🛡️ 生锈铁盾 (0/1遮罩)' },
            { value: 'half_pitfall', label: '⚠️ 均匀 Metallic=0.5' },
          ]}
          onChange={applyPreset}
        />
      </div>

      {/* 上区：左 3D 球 + 右自由参数滑块 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '220px minmax(0, 1fr)',
          gap: 10,
        }}
      >
        <div
          style={{
            background: isDark ? '#1e1b18' : '#fffdf9',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
          }}
        >
          <canvas
            ref={canvasRef}
            width={216}
            height={216}
            style={{ width: 196, height: 196, borderRadius: 10, border: '1px solid var(--border-soft)' }}
          />
        </div>

        <div className="stage-controls-panel" style={{ justifyContent: 'center' }}>
          <StageSlider
            label="🧲 金属度 Metallic (缓慢从 0 拉到 1 紧盯下方两张 X 光卡！)"
            value={metallic}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => {
              setUseRustMask(false);
              if (preset === 'rust_shield') setPreset('custom');
              setMetallic(v);
            }}
          />
          <div className="control-grid">
            <StageSlider
              label="🌈 BaseColor 色相"
              value={hue}
              min={0}
              max={360}
              step={1}
              unit="°"
              onChange={(v) => {
                setUseRustMask(false);
                if (preset === 'rust_shield') setPreset('custom');
                setHue(v);
              }}
            />
            <StageSlider
              label="☀️ BaseColor 显示色明度控制"
              value={albedoLum}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => {
                setUseRustMask(false);
                if (preset === 'rust_shield') setPreset('custom');
                setAlbedoLum(v);
              }}
            />
            <StageSlider
              label="✨ 粗糙度 Roughness"
              value={roughness}
              min={0.05}
              max={0.95}
              step={0.01}
              onChange={setRoughness}
            />
            <StageSlider
              label="🎛️ 旧版 Specular (默认 0.5 = 4% F0)"
              value={legacySpec}
              min={0}
              max={1}
              step={0.02}
              formatValue={(v) =>
                metallic === 1 ? `${v.toFixed(2)} (纯金属已无视它!)` : `${v.toFixed(2)} (F0=${(v * 8).toFixed(1)}%)`
              }
              onChange={setLegacySpec}
            />
          </div>
        </div>
      </div>

      {/* 下区：两张实时 X 光底层解剖卡片（亲眼看着 Metallic=1 把漫反射熄灭成纯黑、把金色塞进 F0！） */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(235px, 1fr))',
          gap: 10,
        }}
      >
        {/* X 光卡 1：底层实际漫反射色 */}
        <div
          style={{
            background: isDark ? '#1e1b18' : '#ffffff',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 11,
            padding: '9px 11px',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              minWidth: 48,
              borderRadius: 9,
              background: useRustMask
                ? 'linear-gradient(135deg, #000000 50%, #9a4722 50%)'
                : diffHex,
              border: '2px solid var(--border-strong)',
              boxShadow: 'var(--shadow-brutal)',
            }}
          />
          <div style={{ fontSize: 12, lineHeight: 1.45 }}>
            <div style={{ fontWeight: 800 }}>🔬 X光底层①：实际漫反射色 (Diffuse Albedo)</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-secondary)' }}>
              {useRustMask
                ? '铁区 #000000 (0%) | 锈区 #9A4722'
                : `${diffHex} · 线性 RGB 均值 ${diffAvgPct}%`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {metallic === 1 && !useRustMask
                ? '⚡ 纯金属的 Diffuse Albedo 为零'
                : '算式：BaseColor × (1 - Metallic)'}
            </div>
          </div>
        </div>

        {/* X 光卡 2：底层实际 0° 镜面反射色 F0 */}
        <div
          style={{
            background: isDark ? '#1e1b18' : '#ffffff',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 11,
            padding: '9px 11px',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              minWidth: 48,
              borderRadius: 9,
              background: useRustMask
                ? 'linear-gradient(135deg, #d4d7dc 50%, #383838 50%)'
                : f0Hex,
              border: '2px solid var(--border-strong)',
              boxShadow: 'var(--shadow-brutal)',
            }}
          />
          <div style={{ fontSize: 12, lineHeight: 1.45 }}>
            <div style={{ fontWeight: 800 }}>🪞 X光底层②：实际 0° 镜面反射色 (F0)</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-secondary)' }}>
              {useRustMask
                ? `铁区 F0 均值 66% | 锈区 F0 ${(dielectricF0 * 100).toFixed(1)}%`
                : `${f0Hex} · 线性 F0 通道均值 ${f0AvgPct}%`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {metallic === 1 && !useRustMask
                ? '🌟 金属接管 BaseColor，给高光和环境倒影染上金属自身颜色！'
                : `非金属端 F0 = 0.08 × Specular = ${dielectricF0.toFixed(3)}`}
            </div>
          </div>
        </div>
      </div>

      {/* 温柔合法性提示条（零锁卡，仅作实时科学反馈） */}
      <div
        style={{
          padding: '7px 11px',
          borderRadius: 9,
          border: '1.5px solid var(--border-strong)',
          background: hasHealthWarn ? 'var(--accent-amber)' : 'var(--accent-sage)',
          color: hasHealthWarn ? 'var(--accent-amber-deep)' : 'var(--accent-sage-deep)',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {inGrayMetalZone
          ? '⚠️ 金属度落入中间灰区：均匀裸金属应取 1、均匀绝缘体取 0，仅在锈蚀/灰尘覆盖过渡边缘才出现中间值。'
          : tooDarkDielectric
            ? '⚠️ 非金属 BaseColor 过暗（低于木炭约 0.02 线性下限）：现实中极少有绝对吸光的 0.00 纯黑表面，极黑底色会吞掉所有暗部细节！'
            : tooBrightDielectric
              ? '⚠️ 非金属 BaseColor 过亮（高于新雪约 0.81 线性上限）：连白雪都反射不到 100%，1.00 纯白在强光下极易过曝发白！'
              : tooDarkMetal
                ? '⚠️ 裸金属 BaseColor（F0）过暗：真实金属正视反射率多在 50%~98%，画太黑只会像怪异暗漆；想做暗钢请调高 Roughness！'
                : tooBrightMetal
                  ? '⚠️ BaseColor 明度已到 1.00 满值：即使是纯银（0.97）也不会三通道全满 1.00，留一点余量更符合真实物理！'
                  : specTouchedOnMetal
                    ? '⚠️ 纯金属会无视旧版 Specular 滑块：它的正视镜面反射 F0 完全由 BaseColor 决定。'
                    : '✅ 物理范围健康！线性参考：木炭漫反射约 0.02，新雪约 0.81；黄金正视镜面 F0 为 (1.000, 0.766, 0.336)。'}
      </div>
    </div>
  );
};

const schematic8_3: SchematicDiagram = {
  title: '一张 BaseColor 贴图如何靠 Metallic 分饰两角？（金属度工作流底层真相）',
  caption: '当 Metallic=0 时 BaseColor 当漫反射颜料用；当 Metallic=1 时漫反射乘 0 归黑，BaseColor 摇身一变成为镜面反射色 F0！',
  nodes: [
    {
      id: 'n_bc',
      title: 'BaseColor 输入',
      subtitle: '非金属填底色 · 金属填反光色',
      category: 'texture',
      x: 20,
      y: 42,
      width: 180,
      previewColor: '#eab308',
      outputs: [{ id: 'rgb', label: 'RGB', color: '#f59e0b' }],
    },
    {
      id: 'n_met',
      title: 'Metallic (0 或 1)',
      subtitle: '0=绝缘体 · 1=纯导体',
      category: 'param',
      x: 20,
      y: 186,
      width: 180,
      outputs: [{ id: 'm', label: 'Metallic', color: '#3b82f6' }],
    },
    {
      id: 'n_inv',
      title: 'OneMinus (1 - Metallic)',
      subtitle: '金属=1 时算出 0！',
      category: 'math',
      x: 245,
      y: 32,
      width: 185,
      inputs: [{ id: 'x', label: 'Metallic', color: '#3b82f6' }],
      outputs: [{ id: 'inv', label: '1 - M', color: '#22c55e' }],
    },
    {
      id: 'n_diff',
      title: 'Multiply → 实际漫反射',
      subtitle: '纯金属漫反射直接清零成纯黑',
      category: 'math',
      x: 470,
      y: 32,
      width: 195,
      inputs: [
        { id: 'bc', label: 'BaseColor', color: '#f59e0b' },
        { id: 'inv', label: '1 - M', color: '#22c55e' },
      ],
      outputs: [{ id: 'diff', label: 'Diffuse Albedo', color: '#ef4444' }],
    },
    {
      id: 'n_f0',
      title: 'Lerp(0.04, Base, Metal)',
      subtitle: '非金属给 4% 白光 · 金属给彩色镜面',
      category: 'math',
      x: 470,
      y: 176,
      width: 195,
      inputs: [
        { id: 'bc', label: 'B (BaseColor)', color: '#f59e0b' },
        { id: 'm', label: 'Alpha (Metallic)', color: '#3b82f6' },
      ],
      outputs: [{ id: 'f0', label: '实际 F0', color: '#38bdf8' }],
    },
    {
      id: 'n_slab',
      title: 'Substrate Slab BSDF',
      subtitle: '物理底层真正接收的两个颜色',
      category: 'substrate',
      x: 705,
      y: 96,
      width: 185,
      inputs: [
        { id: 'diff', label: 'Diffuse Albedo', color: '#ef4444' },
        { id: 'f0', label: 'F0 镜面色', color: '#38bdf8' },
      ],
      outputs: [{ id: 'bsdf', label: 'BSDF', color: '#a855f7' }],
      note: '连入材质根节点 Front Material',
    },
  ],
  edges: [
    { fromNode: 'n_met', fromPin: 'm', toNode: 'n_inv', toPin: 'x', color: '#3b82f6' },
    { fromNode: 'n_bc', fromPin: 'rgb', toNode: 'n_diff', toPin: 'bc', color: '#f59e0b' },
    { fromNode: 'n_inv', fromPin: 'inv', toNode: 'n_diff', toPin: 'inv', color: '#22c55e' },
    { fromNode: 'n_bc', fromPin: 'rgb', toNode: 'n_f0', toPin: 'bc', color: '#f59e0b' },
    { fromNode: 'n_met', fromPin: 'm', toNode: 'n_f0', toPin: 'm', color: '#3b82f6' },
    { fromNode: 'n_diff', fromPin: 'diff', toNode: 'n_slab', toPin: 'diff', color: '#ef4444' },
    { fromNode: 'n_f0', fromPin: 'f0', toNode: 'n_slab', toPin: 'f0', color: '#38bdf8' },
  ],
};

/* ============================================================================
 * 8.4 拥抱 UE 5.8 默认新主角 Substrate（材质层板） —— 看懂 Front Material 与传统贴图无缝桥接
 * ============================================================================ */

type SubPreset = 'copper' | 'ceramic' | 'rubber';

const Stage8_4_SubstrateBridge: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
  isDark,
}) => {
  const [preset, setPreset] = useState<SubPreset>('copper');
  const [hue, setHue] = useState<number>(22);
  const [albedoVal, setAlbedoVal] = useState<number>(0.78);
  const [metallic, setMetallic] = useState<number>(1.0);
  const [roughness, setRoughness] = useState<number>(0.18);
  const [coatLayerOn, setCoatLayerOn] = useState<boolean>(false); // 演示 Substrate 积木叠层清漆能力！
  const [wrongDirectWire, setWrongDirectWire] = useState<boolean>(false); // 踩坑：跳过翻译官把 BaseColor 误插进 F0
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const selectSubPreset = (p: SubPreset) => {
    setPreset(p);
    setWrongDirectWire(false);
    if (p === 'copper') {
      setHue(22);
      setAlbedoVal(0.78);
      setMetallic(1.0);
      setRoughness(0.18);
    } else if (p === 'ceramic') {
      setHue(204);
      setAlbedoVal(0.76);
      setMetallic(0.0);
      setRoughness(0.09);
    } else {
      setHue(30);
      setAlbedoVal(0.12);
      setMetallic(0.0);
      setRoughness(0.84);
    }
  };

  useEffect(() => {
    selectSubPreset('copper');
    setCoatLayerOn(false);
  }, [resetSignal]);

  useEffect(() => {
    if (stepIndex === 4) {
      selectSubPreset('copper');
      setCoatLayerOn(false);
      setWrongDirectWire(true);
    } else if (stepIndex === 2) {
      setWrongDirectWire(false);
    }
  }, [stepIndex, resetSignal]);

  const srgbIn =
    preset === 'rubber' && albedoVal < 0.2
      ? ([albedoVal, albedoVal, albedoVal] as Vec3)
      : hslToSrgb(hue, preset === 'rubber' ? 0.08 : 0.72, clamp(albedoVal * 0.65, 0.04, 0.88));

  const linIn: Vec3 = [
    srgbToLinear(srgbIn[0]),
    srgbToLinear(srgbIn[1]),
    srgbToLinear(srgbIn[2]),
  ];

  // 翻译官节点 Metalness-To-DiffuseAlbedo-F0 实时输出（对比误连踩坑）
  const slabDiffLin: Vec3 = wrongDirectWire
    ? linIn // 踩坑：未扣减能量直接塞入 Diffuse
    : [linIn[0] * (1 - metallic), linIn[1] * (1 - metallic), linIn[2] * (1 - metallic)];

  const slabF0Lin: Vec3 = wrongDirectWire
    ? linIn // 踩坑：误把非金属蓝色瓷器贴图也直接塞进了 F0，导致非金属变成诡异高反铬镜！
    : lerp3([0.04, 0.04, 0.04], linIn, metallic);

  const inHex = srgbVecToHex(srgbIn);
  const diffOutHex = linearVecToSrgbHex(slabDiffLin);
  const f0OutHex = linearVecToSrgbHex(slabF0Lin);

  useEffect(() => {
    onKpiUpdate([
      {
        label: '传统贴图输入',
        value: `M=${metallic.toFixed(1)} · R=${roughness.toFixed(2)}`,
        sub: `BaseColor ${inHex}`,
        tone: 'neutral',
      },
      {
        label: 'Slab · Diffuse Albedo',
        value: diffOutHex,
        sub: `[${slabDiffLin.map((v) => v.toFixed(2)).join(', ')}]`,
        tone: wrongDirectWire ? 'bad' : 'good',
      },
      {
        label: 'Slab · F0 镜面引脚',
        value: f0OutHex,
        sub: `[${slabF0Lin.map((v) => v.toFixed(2)).join(', ')}]`,
        tone: wrongDirectWire ? 'bad' : 'accent',
      },
      {
        label: 'UE 5.8 根节点总入口',
        value: coatLayerOn ? '双层 Slab 叠层清漆' : 'Front Material',
        sub: wrongDirectWire ? '⚠️ 未经翻译官误连 F0!' : '✅ Substrate 层板生效',
        tone: wrongDirectWire ? 'bad' : 'good',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, hue, albedoVal, metallic, roughness, coatLayerOn, wrongDirectWire]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 192;
    const H = 192;
    const img = ctx.createImageData(W, H);
    const data = img.data;
    const cx = W * 0.5;
    const cy = H * 0.5;
    const R = 74;

    const L: Vec3 = norm3([0.38, 0.56, 0.73]);
    const V: Vec3 = [0, 0, 1];
    const halfVector = norm3(add3(L, V));
    const roughClamped = clamp(roughness, 0.045, 1.0);
    const alpha = roughClamped * roughClamped;
    const alphaSquared = alpha * alpha;
    const vh = saturate(dot3(V, halfVector));
    const fDirectPow = Math.pow(1 - vh, 5);
    const ccRough = 0.04;
    const ccA2 = Math.pow(ccRough, 4);

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;
        const bg = stageBgBackdrop(px, py, W, H, isDark, 'neutral');

        const dx = px + 0.5 - cx;
        const dy = cy - (py + 0.5);
        const dist = Math.hypot(dx, dy);
        const cov = clamp(R + 0.65 - dist, 0, 1);

        if (cov <= 0) {
          data[idx] = Math.round(bg[0] * 255);
          data[idx + 1] = Math.round(bg[1] * 255);
          data[idx + 2] = Math.round(bg[2] * 255);
          data[idx + 3] = 255;
          continue;
        }

        const rNorm = Math.min(0.9995, dist / R);
        const scaleXY = dist > 1e-5 ? rNorm / (dist / R) : 1;
        const nx = (dx / R) * scaleXY;
        const ny = (dy / R) * scaleXY;
        const nz = Math.sqrt(Math.max(0.0004, 1 - nx * nx - ny * ny));

        // 完整 PBR（直接 GGX 镜面 + 漫反射 + 逐像素 NdotV 菲涅尔环境 IBL + 可选清漆薄层）
        const N: Vec3 = [nx, ny, nz];
        const nl = saturate(dot3(N, L));
        const nv = Math.max(0.001, dot3(N, V));
        const nh = saturate(dot3(N, halfVector));
        const fViewPow = Math.pow(1 - nv, 5);

        const denominator = nh * nh * (alphaSquared - 1) + 1;
        const d = alphaSquared / (Math.PI * denominator * denominator + 1e-6);
        const visibility =
          0.5 /
          Math.max(
            0.001,
            nl * Math.sqrt(nv * nv * (1 - alphaSquared) + alphaSquared) +
              nv * Math.sqrt(nl * nl * (1 - alphaSquared) + alphaSquared)
          );

        const Rdir = reflect3([-V[0], -V[1], -V[2]], N);
        const envSpec = sampleEnvMap(Rdir, roughClamped, 'sunny');
        const envDiff = sampleEnvMap(N, 0.95, 'sunny');
        const ccEnv = coatLayerOn ? sampleEnvMap(Rdir, ccRough, 'sunny') : null;
        const ccDenom = nh * nh * (ccA2 - 1) + 1;
        const ccD = ccA2 / (Math.PI * ccDenom * ccDenom + 1e-6);
        const ccF = 0.04 + 0.96 * fViewPow;

        const col = slabDiffLin.map((diffuse, c) => {
          const f0 = slabF0Lin[c];
          const fDirect = f0 + (1 - f0) * fDirectPow;
          const fIbl = f0 + (Math.max(1 - roughClamped, f0) - f0) * fViewPow;
          const direct = nl * 2.6 * (((1 - fDirect) * diffuse) / Math.PI + d * visibility * fDirect);
          const indirect = (1 - fIbl) * diffuse * envDiff[c] * 0.55 + envSpec[c] * fIbl;
          const base = direct + indirect;
          const coated =
            coatLayerOn && ccEnv
              ? base * (1 - ccF * 0.85) + (ccD * 0.25 * nl * 2.6 + ccEnv[c] * ccF)
              : base;
          return linearToSrgb(acesTonemap(coated));
        }) as Vec3;

        data[idx] = Math.round(lerp(bg[0], col[0], cov) * 255);
        data[idx + 1] = Math.round(lerp(bg[1], col[1], cov) * 255);
        data[idx + 2] = Math.round(lerp(bg[2], col[2], cov) * 255);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [preset, hue, albedoVal, metallic, roughness, coatLayerOn, wrongDirectWire, isDark]);

  const cardStyle: React.CSSProperties = {
    background: isDark ? '#231f1c' : '#ffffff',
    border: '1.5px solid var(--border-strong)',
    borderRadius: 10,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    fontSize: 11.5,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={wrongDirectWire}
        pitfallLabel="误连：把同一张 BaseColor 同时硬插进 Diffuse Albedo 和 F0 —— 铜球混进多余漫反射发灰失真，青花瓷变成诡异蓝铬镜！"
        correctLabel="UE 5.8 标准桥接：串入官方翻译官节点 Substrate Metalness-To-DiffuseAlbedo-F0，传统三张贴图 1 秒精准译成物理层板参数"
        onToggle={setWrongDirectWire}
      />
      <small>浏览器使用线性漫反射、GGX 直接高光与环境倒影（IBL）着色。两个配置共用光照、粗糙度、曝光和清漆设置；切换仅改变 Diffuse Albedo 和 F0。</small>
      {/* 顶部预设与叠层体验开关 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <StageSegmented
          label="选择传统 PBR 贴图套装看实时翻译数值"
          value={preset}
          options={[
            { value: 'copper', label: '🔶 紫铜 (Metal=1)' },
            { value: 'ceramic', label: '🏺 青花瓷 (Metal=0)' },
            { value: 'rubber', label: '🛞 黑橡胶 (Rough=0.84)' },
          ]}
          onChange={selectSubPreset}
        />
        <StageToggle
          label="➕ 叠一层 Vertical Layer 透明清漆薄片"
          checked={coatLayerOn}
          hint="体验 Substrate 乐高叠层威力"
          onChange={setCoatLayerOn}
        />
      </div>

      {/* 中央实时节点桥接流水线 + 3D 渲染球同屏联动 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 202px',
          gap: 10,
          alignItems: 'stretch',
        }}
      >
        <div
          style={{
            background: isDark ? '#181614' : '#f3eee3',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 12,
            padding: 10,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 8,
            alignItems: 'center',
          }}
        >
          {/* 第 1 站：传统贴图三件套 */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 800, color: '#d97706' }}>① 传统贴图三件套</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  background: inHex,
                  border: '1px solid #000',
                  display: 'inline-block',
                }}
              />
              <span style={{ fontFamily: 'var(--font-mono)' }}>Base: {inHex}</span>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)' }}>Metallic: {metallic.toFixed(2)}</div>
            <div style={{ fontFamily: 'var(--font-mono)' }}>Roughness: {roughness.toFixed(2)}</div>
          </div>

          {/* 第 2 站：翻译官节点 */}
          <div
            style={{
              ...cardStyle,
              borderColor: wrongDirectWire ? '#dc2626' : '#2563eb',
              opacity: wrongDirectWire ? 0.55 : 1,
            }}
          >
            <div style={{ fontWeight: 800, color: wrongDirectWire ? '#dc2626' : '#2563eb' }}>
              {wrongDirectWire ? '❌ 跳过翻译官 (误连!)' : '② 翻译官 Helper 节点'}
            </div>
            <div style={{ fontWeight: 700, fontSize: 10.5 }}>Substrate Metalness-To-DiffuseAlbedo-F0</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.35 }}>
              {wrongDirectWire ? 'Diff = Base，F0 = Base' : <>Diff = Base × (1 - M)<br />F0 = Lerp(0.04, Base, M)</>}
            </div>
          </div>

          {/* 第 3 站：UE 5.8 Substrate Slab BSDF */}
          <div
            style={{
              ...cardStyle,
              borderColor: '#9333ea',
              boxShadow: '2px 2px 0px #7e22ce',
            }}
          >
            <div style={{ fontWeight: 800, color: '#9333ea' }}>③ Substrate Slab 层板</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: 3,
                  background: diffOutHex,
                  border: '1px solid #000',
                  display: 'inline-block',
                }}
              />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                Diffuse: [{slabDiffLin.map((n) => n.toFixed(2)).join(',')}]
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: 3,
                  background: f0OutHex,
                  border: '1px solid #000',
                  display: 'inline-block',
                }}
              />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                F0: [{slabF0Lin.map((n) => n.toFixed(2)).join(',')}]
              </span>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
              Roughness: {roughness.toFixed(2)} | Normal: (0,0,1)
            </div>
            {coatLayerOn && (
              <div
                style={{
                  marginTop: 2,
                  padding: '2px 6px',
                  borderRadius: 5,
                  background: 'var(--accent-lavender)',
                  color: 'var(--accent-lavender-deep)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                ➕ 顶层已盖透明清漆 Slab (Rough=0.04)
              </div>
            )}
          </div>
        </div>

        {/* 第 4 站：Front Material 根节点与 3D 实时球 */}
        <div
          style={{
            background: isDark ? '#1e1b18' : '#fffdf9',
            border: '2px solid #7e22ce',
            borderRadius: 12,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: isDark ? '#e9d5ff' : '#6b21a8',
            }}
          >
            🟣 根节点 · Front Material
          </span>
          <canvas
            ref={canvasRef}
            width={192}
            height={192}
            style={{ width: 170, height: 170, borderRadius: 9, border: '1px solid var(--border-soft)' }}
          />
        </div>
      </div>

      {/* 底部自由调节滑块 */}
      <div className="stage-controls-panel">
        <div className="control-grid">
          <StageSlider
            label="🎨 BaseColor 色相"
            value={hue}
            min={0}
            max={360}
            step={1}
            unit="°"
            onChange={setHue}
          />
          <StageSlider
            label="☀️ BaseColor 明度"
            value={albedoVal}
            min={0.05}
            max={0.9}
            step={0.01}
            onChange={setAlbedoVal}
          />
          <StageSlider
            label="🧲 传统 Metallic 贴图值"
            value={metallic}
            min={0}
            max={1}
            step={0.01}
            onChange={setMetallic}
          />
          <StageSlider
            label="✨ 传统 Roughness 贴图值"
            value={roughness}
            min={0.05}
            max={0.95}
            step={0.01}
            onChange={setRoughness}
          />
        </div>
      </div>
    </div>
  );
};

const schematic8_4: SchematicDiagram = {
  title: 'UE 5.8 默认 Substrate（材质层板）标准接线图：传统贴图一秒无缝桥接',
  caption: '在启用 Substrate 的工程中，对材质根节点使用 Convert to Substrate 后，按图连接贴图、转换节点、Slab 与 Front Material。',
  nodes: [
    {
      id: 'n_bc',
      title: 'T_BaseColor (sRGB)',
      subtitle: '传统基础色贴图',
      category: 'texture',
      x: 18,
      y: 22,
      width: 170,
      previewColor: '#c87544',
      outputs: [{ id: 'rgb', label: 'RGB', color: '#f59e0b' }],
    },
    {
      id: 'n_orm',
      title: 'T_ORM (Masks 线性)',
      subtitle: 'R=AO · G=粗糙 · B=金属',
      category: 'texture',
      x: 18,
      y: 138,
      width: 170,
      outputs: [
        { id: 'r', label: 'R (AO)', color: '#ef4444' },
        { id: 'g', label: 'G (Roughness)', color: '#22c55e' },
        { id: 'b', label: 'B (Metallic)', color: '#3b82f6' },
      ],
    },
    {
      id: 'n_norm',
      title: 'T_Normal (BC5 法线)',
      subtitle: '表面凹凸小牙签',
      category: 'texture',
      x: 18,
      y: 266,
      width: 170,
      previewColor: '#8080ff',
      outputs: [{ id: 'xyz', label: 'RGB 法线', color: '#60a5fa' }],
    },
    {
      id: 'n_trans',
      title: 'Substrate Metalness-To-DiffuseAlbedo-F0',
      subtitle: '官方内置翻译官节点',
      category: 'substrate',
      x: 222,
      y: 38,
      width: 230,
      inputs: [
        { id: 'albedo', label: 'Base Color', color: '#f59e0b' },
        { id: 'metal', label: 'Metallic (接 ORM.B)', color: '#3b82f6' },
      ],
      outputs: [
        { id: 'diff', label: 'Diffuse Albedo', color: '#f59e0b' },
        { id: 'f0', label: 'F0', color: '#e5e7eb' },
      ],
    },
    {
      id: 'n_slab',
      title: 'Substrate Slab BSDF',
      subtitle: 'UE 5.8 万能物质层板积木',
      category: 'substrate',
      x: 490,
      y: 78,
      width: 195,
      inputs: [
        { id: 'diff', label: 'Diffuse Albedo', color: '#f59e0b' },
        { id: 'f0', label: 'F0', color: '#e5e7eb' },
        { id: 'rough', label: 'Roughness', color: '#22c55e' },
        { id: 'norm', label: 'Normal', color: '#60a5fa' },
      ],
      outputs: [{ id: 'bsdf', label: 'BSDF', color: '#a855f7' }],
      note: '可继续用 Vertical Layer 叠清漆/积水！',
    },
    {
      id: 'n_root',
      title: '材质根节点 (UE 5.8)',
      subtitle: 'Front Material 紫罗兰总入口',
      category: 'output',
      x: 725,
      y: 112,
      width: 180,
      inputs: [
        { id: 'front', label: 'Front Material', color: '#a855f7' },
        { id: 'ao', label: 'Ambient Occlusion', color: '#ef4444' },
      ],
    },
  ],
  edges: [
    { fromNode: 'n_bc', fromPin: 'rgb', toNode: 'n_trans', toPin: 'albedo', color: '#f59e0b' },
    { fromNode: 'n_orm', fromPin: 'b', toNode: 'n_trans', toPin: 'metal', color: '#3b82f6' },
    { fromNode: 'n_trans', fromPin: 'diff', toNode: 'n_slab', toPin: 'diff', color: '#f59e0b' },
    { fromNode: 'n_trans', fromPin: 'f0', toNode: 'n_slab', toPin: 'f0', color: '#e5e7eb' },
    { fromNode: 'n_orm', fromPin: 'g', toNode: 'n_slab', toPin: 'rough', color: '#22c55e' },
    { fromNode: 'n_norm', fromPin: 'xyz', toNode: 'n_slab', toPin: 'norm', color: '#60a5fa' },
    { fromNode: 'n_slab', fromPin: 'bsdf', toNode: 'n_root', toPin: 'front', color: '#a855f7' },
    { fromNode: 'n_orm', fromPin: 'r', toNode: 'n_root', toPin: 'ao', color: '#ef4444' },
  ],
};

/* ============================================================================
 * 模块 08 完整课程数据定义（4 节课 · 每节 5 步认知阶梯）
 * ============================================================================ */

const module08: ModuleDefinition = {
  id: '08',
  number: '08',
  title: '现代 PBR 与 Substrate',
  subtitle: '微表面、菲涅尔、金属度铁律与层板新范式',
  lessons: [
    {
      id: 'microfacet-energy-conservation',
      moduleId: '08',
      number: '8.1',
      title: '微表面理论与能量守恒 —— 放大一万倍看粗糙表面，光斑越散为什么越暗？',
      subtitle: '钻进 10000 倍电子显微镜看微型 V 字山谷：22 道激光亲证 GGX 法线分布 D 与几何自遮挡 G',
      duration: '13 分钟',
      difficulty: '进阶',
      StageComponent: Stage8_1_MicrofacetEnergy,
      schematic: schematic8_1,
      takeaways: [
        '微表面理论核心：世上没有绝对平整的表面，放大一万倍看全是由无数面“微型理想小镜子”拼成的 V 型微山谷！',
        '粗糙度 Roughness 本质上是在控制这群小镜子“排队有多乱”（法线分布函数 GGX NDF · D）。',
        '粗糙度改变法线分布和镜面瓣宽度。被动表面的能量约束涉及对方向积分，不能用分布截面的面积或单个像素的亮度代替。',
        '当微山谷过于陡峭时，部分弹起来的光还会撞上隔壁山坡被卡住（几何遮蔽函数 Smith G），与菲涅尔 F 合称微表面三剑客 D·F·G。',
      ],
      steps: [
        {
          stepNumber: 1,
          shortLabel: '磨砂之谜',
          tag: 'phenomenon',
          title: '拿砂纸把亮面塑料壳磨花，为什么那颗刺眼白点会变成一片淡淡柔光？',
          paragraphs: [
            '买来一个崭新的亮面手机壳，头顶吸顶灯在上面映出一颗针尖大、亮得晃眼的白光斑；等用久了磨出细纹，或者换成一个磨砂手机壳，同一个吸顶灯映在上面，却变成了一大片蒙蒙的柔和光晕，一点都不晃眼了。',
            '明明照在两个手机壳上的灯光强度一模一样，为什么磨砂壳的光斑变大之后，亮度会自动暗下去一大截？',
          ],
          tryItPrompt: '来回缓慢拉动下方的「🔬 粗糙度 Roughness」滑块，同时观察上方显微镜里的 22 道激光与下方材质球上的高光变化！',
        },
        {
          stepNumber: 2,
          shortLabel: '微镜子山谷',
          tag: 'background',
          title: '放大一万倍看真相：无数面“微型小镜子”排队列阵！',
          paragraphs: [
            '现代物理渲染（PBR）的基石叫 **微表面理论（Microfacet Theory）**：把任何粗糙表面放到一万倍电子显微镜底下看，其实根本没有什么“模糊反射”——**每一小块斜面依然是 100% 完美的微型小镜子，区别只在于这些小镜子排得整不整齐！**',
            '看上方显微镜舱：当 `Roughness = 0.05` 时，22 面小镜子像阅兵方阵一样平平整整，22 道阳光打下来**齐刷刷朝同一个角度弹进你眼里**，火力全集中在一个点上，当然刺眼夺目！而当 `Roughness = 0.75` 时，小镜子东倒西歪形成崎岖山谷，把这 22 道光打得**天女散花**，甚至还有好几道光（红虚线）一头撞在隔壁陡峭山坡上出不来了！',
          ],
          tryItPrompt: '把「粗糙度」拉到 0.78，数一数显微镜里出现了多少道红色的「山谷自遮挡损耗」虚线，再看右下角橙色钟形曲线是如何变矮变胖的！',
          callout: {
            tone: 'formula',
            title: '不用背公式也能秒懂 D · G · F 三剑客',
            body: '以后在技术分享里听到 Cook-Torrance DFG 别慌：D（GGX 分布）管小镜子排队有多齐；G（几何遮蔽）管陡峭微山谷挡住了多少光；F（菲涅尔）管擦边看变多亮——咱们舞台上全演出来了！',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '能量守恒',
          tag: 'experiment',
          title: '光斑越散为什么越暗？紧盯 GGX 峰值的能量守恒联动！',
          paragraphs: [
            '把粗糙度从 `0.05` 慢慢拖到 `0.90`，紧盯右侧的橙色钟形曲线和左侧材质球：**微面朝向越集中，镜面高光越亮越尖；朝向越分散，同一份总光能就被摊成一大片柔光，所以看起来变暗变哑！**',
            '再试着转动「入射阳光倾角」或勾选「切换为纯金属表面（钛金）」：金属的镜面反射整体更强，但在相同粗糙度下，小镜子朝向的整齐度（`D` 曲线）只听 `Roughness` 的话。记住，显微镜里标红的射线是用来直观理解山谷自遮挡现象的，并不直接等同于材料吸收的全部能量。',
          ],
          tryItPrompt: '勾选下方「切换为纯金属表面 (钛金)」，再从 0.05 到 0.90 拉动粗糙度，欣赏纯金属从镜面镀铬丝滑变成磨砂喷砂金属的全过程！',
          callout: {
            tone: 'formula',
            title: '严谨数学备注：为什么峰值 D(0) 会远大于 1？',
            body: 'GGX 法线分布正对峰值为 D(0) = 1 / (π·α²)（其中 α = Roughness²），它的单位是立体角密度 sr⁻¹（每球面度内的微面占比），因此极光滑时峰值可达数万并不违背物理！真正的被动表面能量守恒由整个半球上的方向反射积分决定，不能用二维曲线截面面积或单个像素亮度代替。',
          },
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5落地',
          tag: 'ue5',
          title: '走进 UE 5.8：一张 Roughness 黑白图，挑起整套材质灵魂大梁！',
          paragraphs: [
            '在 UE 5.8 的 `Substrate Slab BSDF` 里，刚才显微镜里复杂的 `GGX D` 与 `Smith G` 全由显卡在幕后自动跑完，留给你的只有一个极度直观的 **`Roughness（粗糙度，0~1）`** 引脚！',
            '记住美术黄金经验：**千万别给整件武器填死一个固定数字（比如全填 `0.3`）**！真实世界里，剑柄经常被手摩挲的地方油脂多更光滑（暗灰 `0.2`），凹槽积灰和划痕处更粗糙（亮灰 `0.75`）——**哪怕颜色图普普通通，只要把 `Roughness` 黑白变化画丰富，材质质感立刻飙升十倍！**',
          ],
          tryItPrompt: '点开右上角「原理图」标签，看清 Roughness 一个参数是如何同时指挥 GGX 分布 D 和几何遮蔽 G 两大模块的。',
          callout: {
            tone: 'ue58',
            title: '为什么拉到 Roughness = 0.0 时高光也没变成无限亮？',
            body: '细心的你可能发现了，引擎底层会把极小粗糙度安全钳制在约 0.045 左右，防止公式除以零并抑制边缘闪烁白噪点（Firefly / 镜面锯齿）；至于太阳本身发光圆盘的视觉大小，则由定向光上的 Source Angle 参数单独控制。',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '实战避坑',
          tag: 'pitfall',
          title: '实战避坑：分清 Roughness（粗糙度）与老软件的 Glossiness（光泽度）！',
          paragraphs: [
            '去网上下载第三方贴图包时，经常会遇到一张名叫 `Gloss` 或 `Smoothness（光滑度）` 的贴图。注意它跟 UE 5.8 的 `Roughness` **黑白含义正好完全相反**！',
            '在 UE 5.8 的 `Roughness` 里：**黑（`0`）= 像镜子一样光滑，白（`1`）= 像砖头一样粗糙**（记法：“有粗糙度 = 1 = 粗糙”）。如果拿到的是 `Gloss` 贴图，除了别勾 `sRGB` 之外，只需在材质里接一个 **`OneMinus (1-x)`** 反转黑白就一秒完美适配了！',
          ],
          tryItPrompt: '分别把 Roughness 拉到最左端 0.05（黑=镜面）与最右端 0.92（白=哑光砖面），把这个肌肉记忆彻底刻进脑海！',
          callout: {
            tone: 'warn',
            title: '一句话防坑口诀',
            body: 'UE 粗糙黑是镜、白是麻；拿到 Gloss 光滑图，先关 sRGB 再接 1-x 反转它！',
          },
        },
      ],
    },

    {
      id: 'fresnel-f0-lakeside',
      moduleId: '08',
      number: '8.2',
      title: '菲涅尔效应（Fresnel） —— 低头看湖水清澈见鱼，抬头看远方湖面全成镜子',
      subtitle: '万物皆有“擦边变镜子”定律：从 正入射 F0 到掠射角的界面反射，顺手学会边缘光护盾',
      duration: '13 分钟',
      difficulty: '进阶',
      StageComponent: Stage8_2_FresnelLakeside,
      schematic: schematic8_2,
      takeaways: [
        'F0 是正入射镜面反射率。这里用 Schlick 近似描绘随角度变化的界面反射。1−F 是界面未反射的份额；背景可见度还受材质吸收、内部散射和路径长度影响。',
        '清水 F0 约 0.02，常见绝缘体示例约 0.04。金属 F0 通常带色，应查 RGB；图中的金属单曲线仅示意一个通道。',
        '圆球或角色身体最外一圈轮廓边缘，视线刚好贴着皮肤擦过去（接近 90°），所以天然最亮！',
        '在 UE 5.8 中，写实表面菲涅尔已由 Substrate Slab 自动算好；做科幻护盾、选中描边、受击边缘闪光则直接调用 Fresnel 节点。',
      ],
      steps: [
        {
          stepNumber: 1,
          shortLabel: '湖边看鱼',
          tag: 'phenomenon',
          title: '站在清澈湖边：低头看脚下鱼虾历历在目，抬头看对岸怎么全成镜子了？',
          paragraphs: [
            '回想一次你在公园湖边或海边浅滩散步的画面：当你**低下头垂直往脚尖下的水里看**时，湖水就像隐形了一样透明，水底的花鹅卵石和游来游去的红白锦鲤一清二楚；',
            '可当你**抬起头平视两百米外的远方湖面**时，明明还是同一池水，水底却彻底看不见了——整片湖面变成了一面晃眼的大银镜，把远山、白云和晚霞原封不动映在上面！不光水这样，你把黑屏手机平端到眼前逆光擦边看，塑料屏也像镜子一样亮。这股神秘力量是谁？',
          ],
          tryItPrompt: '在左侧湖面画布上按住鼠标往上拖（或拖动下方「视线俯仰角 θ」从 0° 拉到 88°），亲身体验从“低头看锦鲤”平滑变成“抬头照晚霞镜”的神奇瞬间！',
        },
        {
          stepNumber: 2,
          shortLabel: 'F0与掠射',
          tag: 'background',
          title: '法国物理学家菲涅尔的发现：正看守底数 F0，光滑表面擦边反射趋近 100%！',
          paragraphs: [
            '两百年前物理学家菲涅尔算出了光的通行证规律（看右侧蓝色 **Schlick 菲涅尔曲线**）：当光或视线**垂直正对表面（`0°`）**时，只有极少一部分光在表皮弹走，这个起点叫 **基础反射率 `F0`**——清水只有 **`2%`（`0.02`）**，而木头、石头、塑料、玻璃、人类皮肤惊人地团结，全都在 **`4%`（`0.04`）** 左右！',
            '对于光滑界面，越接近 90° 时反射越强。粗糙表面仍有宽反射瓣。清水里剩余光继续传播，塑料和石头中则可能被吸收或散射。',
          ],
          tryItPrompt: '选择清水、钻石和金属示意，比较它们在曲线起点的 F0。金属示意用单一标量展示曲线形状；金属实际颜色见 8.3 的 RGB 数据。',
          callout: {
            tone: 'formula',
            title: '实时渲染史上的传奇近似式：Schlick 菲涅尔公式',
            body: '真正电磁学菲涅尔方程非常啰嗦，显卡每秒算几亿次靠的是 Schlick 大神发明的极简五次方近似：F(θ) = F0 + (1 - F0) × (1 - cos θ)⁵ —— 又快又准，误差肉眼根本分不出！',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '护盾边缘光',
          tag: 'experiment',
          title: '灵机一动：圆球和角色最外圈轮廓，不刚好全是 90° 擦边角吗？！',
          paragraphs: [
            '特效美术师看到这条规律立刻拍案叫绝：你想想看一颗圆球或一个人形角色，**正对着摄像机的肚子鼻子是 `0°`（菲涅尔接近 `0`），而角色最外一圈身体轮廓线，视线正好贴着皮肤擦过去，全都是接近 `90°` 的掠射角（菲涅尔接近 `1`）**！',
            '点击左图右上角的 **「切到角色护盾预览」** 开关试试！把这个中心为 `0`、边缘为 `1` 的渐变乘上蓝青色霓虹光，中间完全透明不挡视线，外圈自动亮起一圈丝滑立体的科幻能量护盾！无论镜头怎么绕着护盾转，亮边永远自动贴在轮廓最外圈！',
          ],
          tryItPrompt: '勾选「切到角色护盾预览」，左右拖动下方的「ExponentIn 指数」滑块（从 1.2 拉到 7.5），体验如何随心控制发光轮廓线的粗细与锐利度！',
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5落地',
          tag: 'ue5',
          title: '走进 UE 5.8：写实材质别画蛇添足，特效护盾请搜 Fresnel 节点！',
          paragraphs: [
            '在 UE 5.8 里一定要分清两种场合：① **做写实水、玻璃、车漆、金属、皮肤时，千万别自己去连 `Fresnel` 节点改高光！** 因为 `Substrate Slab BSDF` 和 `Single Layer Water` 内部已经根据 BSDF 计算反射，按所用着色模型提供要求的物理参数。',
            '② **只有做风格化特效**——比如科幻能量罩、BOSS 狂暴红边、拾取道具呼吸高亮、幽灵半透明身体时，才在材质画布里右键搜 **`Fresnel`** 节点连入 `Emissive Color（自发光）` 或 `Opacity（不透明度）`！',
          ],
          tryItPrompt: '点开右上角「原理图」标签，记住 Fresnel 节点两个黄金输入脚：ExponentIn（管边缘宽窄）与 BaseReflectFractionIn（管中心底亮）。',
          callout: {
            tone: 'ue58',
            title: '想让法线凹凸细节也带出边缘发光怎么办？',
            body: 'UE 5.8 的 Fresnel 节点上还有第三个插口 Normal！不连时默认只看平滑模型轮廓；如果把法线贴图转到世界空间（右键搜 TransformVector，设为 Tangent → World）连进去，连盔甲上的雕花凸起都会泛起流光！',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '实战避坑',
          tag: 'pitfall',
          title: '实战避坑：做水面和玻璃千万别给死板固定反射率！',
          paragraphs: [
            '很多新手第一次手搓水面或车窗材质时，直接给界面反射填了一个固定常数 `0.48`——点击顶部 **「看踩坑现象」** 瞧瞧后果：低头往脚下看像蒙了一层浑浊白塑料膜看不清锦鲤，抬头往天边看又灰扑扑毫无镜面波光感！',
            '记住这句让你作品瞬间摆脱“塑料廉价感”的秘诀：**“近看通透远成镜，真实水玻靠菲涅尔”**。',
          ],
          tryItPrompt: '切回湖畔模式，点击顶部对比条切换「死板固定 48% 反射踩坑」与「真实菲涅尔曲线正解」，拖动俯仰角感受灵动通透感的差距！',
          callout: {
            tone: 'warn',
            title: '一句话防坑口诀',
            body: '写实 PBR 表面菲涅尔交给 Substrate 自动算；半透明护盾描边搜 Fresnel 节点调 ExponentIn！',
          },
        },
      ],
    },

    {
      id: 'metallic-workflow-three-laws',
      moduleId: '08',
      number: '8.3',
      title: '金属度工作流铁律 —— 金属与非金属的光学鸿沟、“混合覆盖率”与 Specular 迷思',
      subtitle: 'X 光解剖材质球底层：看 Metallic=1 如何把漫反射清零成纯黑，并守住 PBR 三条保命家规',
      duration: '14 分钟',
      difficulty: '进阶',
      StageComponent: Stage8_3_MetallicThreeLaws,
      schematic: schematic8_3,
      takeaways: [
        '家规一（非黑即白）：均匀绝缘体取 Metallic = 0，均匀裸金属取 1；裸铁与铁锈等混合材质靠黑白遮罩分开区域，仅在覆盖边缘与过滤过渡处出现中间值，别把整块材质糊成 0.5！',
        '家规二（按物理范围填色）：非金属漫反射与金属镜面 F0 各自有真实区间——线性木炭约 0.02、新雪约 0.81，裸金属 F0 多在 0.50~0.98（黄金红通道可达 1.0），别填死黑 0.00 或过曝纯白 1.00。',
        '家规三（别乱动 Specular）：传统面板的 Specular（0~1）只覆盖非金属 0%~8% 正入射反射率（默认 0.5 精准对应 4%），对纯金属完全无效，99% 情况下保持默认不动！',
        '一张 BaseColor 靠 Metallic 分饰两角：Metallic = 0 时它当漫反射颜料；Metallic = 1 时漫反射归零，它转行去当带色的正入射镜面反射率 F0。',
      ],
      steps: [
        {
          stepNumber: 1,
          shortLabel: '真假黄金',
          tag: 'phenomenon',
          title: '同样涂了金黄色，为什么塑料玩具金元宝一眼假，真金戒指却深邃璀璨？',
          paragraphs: [
            '过年超市里卖的金色塑料元宝，和珠宝店橱窗里的 24K 纯金戒指，明明画师取色吸出来都是差不多的金黄色，为什么我们人类肉眼隔着三米远，0.1 秒就能分辨出哪个是廉价黄塑料、哪个是真黄金？',
            '答案藏在初中物理课本里：**绝缘体（塑料、石头、木头）**和**导体（金、银、铜、铁）**对待光线的脾气，根本是两个物种！',
          ],
          tryItPrompt: '点击舞台顶部的预设按钮，在「🪙 24K 纯金 (1.0)」与「🧱 红乐高塑料 (0.0)」之间来回切换，同时紧盯下方两张 X 光解剖卡片的颜色变化！',
        },
        {
          stepNumber: 2,
          shortLabel: '自由电子',
          tag: 'background',
          title: '金属里的“自由电子保安”：没收全部漫反射，并给镜面高光染上金色！',
          paragraphs: [
            '对普通厚实裸金属，进入导体的光会快速衰减。本工作流将其漫反射项设为 0，用带色的镜面 F0 表示导体的表面反射。',
            '黄金在不同波长上的镜面反射率不同，因此白光下的高光可以偏黄。黄色塑料的色素主要给漫反射着色，镜面高光通常跟随入射光颜色。',
          ],
          tryItPrompt: '把「红乐高塑料」的色相拉到 42° 金黄色，然后缓缓把「金属度 Metallic」从 0.00 一点点拖到 1.00——亲眼看着下方①号漫反射卡慢慢熄灭成纯黑，而②号镜面 F0 卡吸收金黄色亮起来！',
          callout: {
            tone: 'tip',
            title: '一句话看透一张 BaseColor 贴图的“双重身份”',
            body: '在金属度工作流里，BaseColor 省了一张贴图：哪里 Metallic=0，它就去当漫反射颜料；哪里 Metallic=1，它就转行去当镜面反射颜色 F0！',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '三大铁律',
          tag: 'experiment',
          title: '亲手验证 PBR 三条保命家规：生锈铁盾遮罩与 Specular 迷思',
          paragraphs: [
            '生锈铁盾上，裸铁区域用 1，铁锈用 0。把金属度整面填为 0.5 会丢掉锈蚀图案。过滤覆盖边缘、灰尘和混合材料时可以出现中间值。',
            '再试着切回「🪙 24K 纯金」，去拉右下角的 **「旧版 Specular 引脚」** 滑块——看到了吗？球体**纹丝不动**！因为 `Specular` 只管非金属那 `0% ~ 8%` 的正入射反射率（默认 `0.5` 正好对应物理黄金值 `4%`），纯金属根本不理它！',
          ],
          tryItPrompt: '先点「🛡️ 生锈铁盾」观察好铁亮银与铁锈哑光红棕的自然共存，再试着把 BaseColor 明度拉到极端 0.00 或 1.00 看看底部的物理体检提示！',
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5落地',
          tag: 'ue5',
          title: '走进 UE 5.8：牢记三条物理家规，查表填色告别 Specular 手痒症',
          paragraphs: [
            '**① 金属度非 0 即 1**：均匀绝缘体填 `0`、均匀裸金属填 `1`，生锈/掉漆表面用黑白遮罩贴图区分区域；**② 查物理表填 BaseColor**：用线性数值核对参考——非金属木炭约 `0.02`、新雪约 `0.81` 是漫反射强度；金属铁 `(0.560, 0.570, 0.580)`、金 `(1.000, 0.766, 0.336)` 是 RGB 镜面反射色（比较截图时先确认显示编码与曝光）。',
            '**③ 别手痒乱调旧版 Specular**：传统材质上的 `Specular`（`0 ~ 1`）只覆盖非金属 **`0% ~ 8%`** 的正入射反射率（`0.08 × Specular`），普通非金属**空着不连（保持默认 `0.5` = `4%`）**最标准；如果真的要做钻石（`F0 = 0.17`）这类超过 `8%` 上限的高折射率宝石，请直接交给 UE 5.8 **`Substrate Slab BSDF` 的 `F0`** 引脚来表达！',
          ],
          tryItPrompt: '点开右上角「原理图」标签，看清 OneMinus(1-M) 与 Lerp(0.04, BaseColor, M) 这两条算式是如何完美解释刚才两张 X 光卡的变化的。',
          callout: {
            tone: 'ue58',
            title: '常见金属线性 RGB 参考',
            body: '金 (1.000, 0.766, 0.336)，铜 (0.955, 0.637, 0.538)，银 (0.972, 0.960, 0.915)。',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '半金属坑',
          tag: 'pitfall',
          title: '覆盖的位置如何影响锈蚀外观？',
          paragraphs: [
            '用均匀 Metallic=0.5 与生锈铁盾预设比较。均匀中间值展示插值过程，铁盾则按覆盖位置取裸铁或铁锈。',
            '制作发蓝钢、氧化层或涂漆表面时，先确定实际表层材质。裸铁的金属 RGB 参考只适用于裸露区域。粗糙度改变反射分布，不能替代氧化层的吸收与着色。',
          ],
          tryItPrompt: '点击「🛡️ 生锈铁盾」或「🪙 24K 纯金」，把「✨ 粗糙度 Roughness」拖到 0.45，体验在保持 Metallic = 1 的前提下调出深沉厚重暗钢的正确方法！',
          callout: {
            tone: 'warn',
            title: '三句保命家规口诀',
            body: '① 金属度非 0 即 1（生锈掉漆靠遮罩）；② 颜色按物理范围查表（远离死黑 0.00 与纯白 1.00）；③ 传统 Specular 留默认 0.5（4% F0，高折射宝石交给 Substrate F0）！',
          },
        },
      ],
    },

    {
      id: 'ue58-substrate-slab-bridge',
      moduleId: '08',
      number: '8.4',
      title: '拥抱 UE 5.8 默认新主角 Substrate（材质层板） —— 看懂 Front Material 与传统贴图无缝桥接',
      subtitle: '告别死板着色模型下拉菜单：一颗翻译官节点打通传统三张贴图与 Substrate Slab 物理积木',
      duration: '13 分钟',
      difficulty: '进阶',
      StageComponent: Stage8_4_SubstrateBridge,
      schematic: schematic8_4,
      takeaways: [
        'UE 5.7 起新项目默认启用 Substrate。升级已有工程时应检查项目设置；UE 5.8 的空白新材质仍可从传统根节点开始。',
        '右键材质根节点选择 Convert to Substrate。检查转换生成的节点，再让所需 Slab 的 BSDF 输出连接 Front Material。',
        'Substrate Slab 直接暴露上一节刚学透的物理真名：Diffuse Albedo（漫反射色）与 F0（正视镜面反射色）！',
        '手里传统的 BaseColor + Metallic 贴图无需重画！串一颗官方翻译官节点 Substrate Metalness-To-DiffuseAlbedo-F0 即可一秒无缝桥接，还能随时像乐高一样往上叠透明清漆薄片！',
      ],
      steps: [
        {
          stepNumber: 1,
          shortLabel: '新版初见',
          tag: 'phenomenon',
          title: '创建空白材质，再切换到显式 Substrate 工作流',
          paragraphs: [
            '在启用 Substrate 的 UE 5.8 项目中新建 Material 并打开。空白材质会显示传统输入，初始表达式数为 0，Front Material 未连接。右键根节点选择 **Convert to Substrate**，再观察生成的节点。',
            '工程是否启用 Substrate、材质是否采用显式 Front Material 图，这两个状态可以分别检查。升级的工程可能保留原项目设置。',
          ],
          tryItPrompt: '观察舞台中央的四站式节点流水线，依次点击上方「🔶 紫铜」、「🏺 青花瓷」、「🛞 黑橡胶」三个预设，看参数是如何一路流进右侧紫色根节点的！',
        },
        {
          stepNumber: 2,
          shortLabel: '告别快餐',
          tag: 'background',
          title: '传统着色模型与 Substrate 的显式分层有何区别？',
          paragraphs: [
            '以前旧版引擎做材质像去快餐店点死板套餐：做石头点 `Default Lit`（1号套餐），做车漆点 `Clear Coat`（2号套餐），做绒布点 `Cloth`（3号套餐）。一旦美术总监说：“我要做一件**淋了雨、表面结了一层薄冰清漆的丝绒斗篷**”——完了，快餐店不准把 2 号和 3 号套餐混在一起点，技术美术只能去改引擎源码！',
            '于是 **UE 5.8 默认启用正式版 `Substrate（材质层板）`**：把世间万物统一抽象成一块块物理物质积木 **`Substrate Slab BSDF`**。想做普通金属瓷器用 1 块积木；想做豪车双层清漆或湿石头，直接再拿 1 块透明光滑积木用 **`Vertical Layer`（垂直叠层）** 往头顶一盖就成了！',
          ],
          tryItPrompt: '勾选舞台右上方的「➕ 叠一层 Vertical Layer 透明清漆薄片」，亲眼看看青花瓷或紫铜球表面立刻多出一层晶莹剔透的镜面清漆光泽！',
          callout: {
            tone: 'ue58',
            title: '惊喜发现：Slab 上的引脚名字全是咱们的老熟人！',
            body: '仔细看③号紫色卡片 Substrate Slab BSDF 的输入口：Diffuse Albedo（漫反射色）、F0（0°镜面反射率）、Roughness（粗糙度）、Anisotropy（各向异性）——全都是咱们模块 07 和 08 刚亲手拆解过的物理真名！',
          },
        },
        {
          stepNumber: 3,
          shortLabel: '翻译官桥接',
          tag: 'experiment',
          title: '传统贴图怎么接？请出官方翻译官节点 Substrate Metalness-To-DiffuseAlbedo-F0！',
          paragraphs: [
            '这时候你肯定会问：“那我在 Substance Painter 或贴图库里导出的全还是传统的 `BaseColor + Metallic + Roughness` 三张图，怎么插进 `Diffuse Albedo` 和 `F0` 里呀？”',
            '看舞台中央第 **② 号蓝色卡片**——Epic 官方早就贴心地内置了一颗“翻译官”辅助节点，全名叫 **`Substrate Metalness-To-DiffuseAlbedo-F0`**！你把传统 `BaseColor` 和 `Metallic` 从左边喂给它，它肚子里的两行算式瞬间帮你翻译出精准的 `Diffuse Albedo` 与 `F0` 送进右边的 `Substrate Slab`！试着拖动下方滑块，看整条桥上的数字实时跳动！',
          ],
          tryItPrompt: '把「传统 Metallic 贴图值」从 0 拖到 1，实时紧盯②号翻译官节点是如何把③号 Slab 的 Diffuse 归零并把颜色转移进 F0 的！',
        },
        {
          stepNumber: 4,
          shortLabel: 'UE5落地',
          tag: 'ue5',
          title: '走进 UE 5.8 实操：记住这套开箱即用的标准四步连法',
          paragraphs: [
            '**①** 右键材质根节点选择 **Convert to Substrate**，再拖入 `BaseColor`、`ORM` 和 `Normal` 贴图；**②** 搜索并放入 **`Substrate Metalness-To-DiffuseAlbedo-F0`**，把 `BaseColor.RGB` 接进 `Base Color`，`ORM.B` 接进 `Metallic`，`Specular` 保留默认 `0.5`。',
            '**③** 把翻译出来的 `Diffuse Albedo` 和 `F0` 连同 `ORM` 绿通道（`Roughness`）、法线一起插进 **`Substrate Slab BSDF`**；**④** 把层板的 **`BSDF`** 输出连进根节点紫色的 **`Front Material`**，再把 `ORM` 红通道单独连进根节点的 **`Ambient Occlusion`**——大功告成！',
          ],
          tryItPrompt: '点击舞台右上角的「原理图」按钮，完整浏览一遍这套 UE 5.8 最核心的工业级母材质标准连线图！',
          callout: {
            tone: 'tip',
            title: '第 10 章高阶效果提前剧透',
            body: '到了第 10 章做翡翠玉石透光时，我们只需调节同一块 Substrate Slab 上的 MFP（平均自由程）引脚；做二次元卡通还可以尝试 UE 5.8 的实验性节点 Substrate Toon BSDF 积木——学会这一块积木，后面一通百通！',
          },
        },
        {
          stepNumber: 5,
          shortLabel: '乱连避坑',
          tag: 'pitfall',
          title: '新手初见 Substrate 头号踩坑：跳过翻译官，把颜色图硬塞进 F0！',
          paragraphs: [
            '选择紫铜并设 Metallic=1、清漆关闭。切换连接方式，记录两次的 Diffuse Albedo 与 F0。正确配置中 Diffuse 为零、F0 为铜色；误连时 F0 仍为铜色，但 Diffuse 错误地获得同一颜色。',
            '切换青花瓷后重做对比。它的漫反射色可以正确，而误连会把应该接近 (0.04,0.04,0.04) 的 F0 改为底色。两种配置都没有接 Emissive，实验改变的是反射。',
          ],
          tryItPrompt: '比较紫铜与瓷器的两组读数。保持同一材质预设和光照，只切换接线。',
          callout: {
            tone: 'warn',
            title: '模块 07 & 08 通关寄语',
            body: '恭喜你彻底攻克了漫反射、镜面与环境光、AO、VSM 阴影、微表面能量守恒、菲涅尔、金属度铁律与 UE 5.8 Substrate 层板！下一章我们将揭开渲染管线深度图与 GBuffer 底片室的面纱，向真实水体、玻璃与体积雾进发！',
          },
        },
      ],
    },
  ],
};

export const modules07_08: ModuleDefinition[] = [module07, module08];
