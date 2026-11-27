import React, { useState, useEffect, useRef } from 'react';
import {
  LessonDefinition,
  LessonStageProps,
  ModuleDefinition,
  SchematicDiagram,
} from '../types/course';
import {
  StageSlider,
  StageSegmented,
  StageToggle,
  PitfallCompareBar,
} from '../components/ui/StageWidgets';
import { module11CompileIRLessons } from './module11CompileIR';

// ============================================================================
// LESSON 11.4 STAGE: 60 FPS 帧心跳示波器 & PSO 卡顿诊治工作台
// ============================================================================

type PsoStrategy = 'none' | 'bundled' | 'precaching';
type PsoTrigger = 'skill_vfx' | 'new_biome' | 'driver_update' | 'second_run';

const PSO_TRIGGER_META: Record<
  PsoTrigger,
  {
    label: string;
    newPsoCount: number;
    nonePeakMs: number;
    bundledPeakMs: number;
    precachePeakMs: number;
    startupWarmupSec: number;
    note: string;
  }
> = {
  skill_vfx: {
    label: '首次释放火焰大招特效',
    newPsoCount: 18,
    nonePeakMs: 142,
    bundledPeakMs: 15.8,
    precachePeakMs: 16.4,
    startupWarmupSec: 38,
    note: '大招瞬间引入半透明混合 + 粒子顶点工厂 + 折射 RT，无预热时显卡驱动现场编译 18 个新 PSO 直接定格 142ms！',
  },
  new_biome: {
    label: '推门进入新雪地关卡',
    newPsoCount: 44,
    nonePeakMs: 215,
    bundledPeakMs: 18.2,
    precachePeakMs: 16.2,
    startupWarmupSec: 52,
    note: '新场景材质与阴影 Pass 组合集中爆发；UE 5.8 PSO Precaching 早在流送加载资产时就已在后台线程池悄悄编完！',
  },
  driver_update: {
    label: '玩家刚更新了显卡驱动',
    newPsoCount: 65,
    nonePeakMs: 260,
    bundledPeakMs: 16.1,
    precachePeakMs: 17.5,
    startupWarmupSec: 75,
    note: '显卡驱动一升级，旧硬件 ISA 磁盘缓存全部作废！因此首发或更新驱动后常会再次看到“正在准备着色器”进度条。',
  },
  second_run: {
    label: '二次重玩同一关卡（驱动命中）',
    newPsoCount: 0,
    nonePeakMs: 15.4,
    bundledPeakMs: 15.4,
    precachePeakMs: 15.4,
    startupWarmupSec: 1.5,
    note: '显卡驱动已将首次编好的 ISA 落盘保存进 Driver Shader Cache，第二次遇到相同 PSO 组合直接 0ms 复用！',
  },
};

const Stage11_4_PSO: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [strategy, setStrategy] = useState<PsoStrategy>('precaching');
  const [trigger, setTrigger] = useState<PsoTrigger>('skill_vfx');
  const [blendDiff, setBlendDiff] = useState<boolean>(true);
  const [rtHdrDiff, setRtHdrDiff] = useState<boolean>(true);

  const kpiRef = useRef(onKpiUpdate);
  kpiRef.current = onKpiUpdate;
  const prevStepRef = useRef(stepIndex);
  const prevResetRef = useRef(resetSignal);

  useEffect(() => {
    if (prevStepRef.current === stepIndex) return;
    prevStepRef.current = stepIndex;
    if (stepIndex === 0) {
      setStrategy('none');
      setTrigger('skill_vfx');
    } else if (stepIndex === 1) {
      setStrategy('none');
      setTrigger('new_biome');
    } else if (stepIndex === 2) {
      setStrategy('precaching');
      setTrigger('skill_vfx');
    } else if (stepIndex === 3) {
      setStrategy('bundled');
      setTrigger('driver_update');
    } else if (stepIndex === 4) {
      setStrategy('precaching');
      setTrigger('second_run');
    }
  }, [stepIndex]);

  useEffect(() => {
    if (prevResetRef.current === resetSignal) return;
    prevResetRef.current = resetSignal;
    setStrategy('precaching');
    setTrigger('skill_vfx');
    setBlendDiff(true);
    setRtHdrDiff(true);
  }, [resetSignal]);

  const meta = PSO_TRIGGER_META[trigger];
  const stateMultiplier = (blendDiff ? 2 : 1) * (rtHdrDiff ? 2 : 1);
  const effectiveNewPso = Math.round(meta.newPsoCount * (0.5 + 0.25 * stateMultiplier));

  const peakMs =
    strategy === 'none'
      ? +(meta.nonePeakMs * (trigger === 'second_run' ? 1 : 0.72 + 0.14 * stateMultiplier)).toFixed(1)
      : strategy === 'bundled'
      ? meta.bundledPeakMs
      : meta.precachePeakMs;

  const isStutter = peakMs > 28;
  const warmupText =
    strategy === 'none'
      ? '0 秒（进游戏快，玩起来狂卡）'
      : strategy === 'bundled'
      ? `启动进条约 ${meta.startupWarmupSec} 秒`
      : '后台异步零感预热';

  useEffect(() => {
    kpiRef.current([
      {
        label: '事件瞬时帧耗时峰值',
        value: `${peakMs} ms`,
        sub: isStutter ? '严重掉帧定格（>16.67ms 红线）！' : '丝滑稳住 60 FPS 无明显卡顿',
        tone: isStutter ? 'bad' : 'good',
      },
      {
        label: '遭遇新 PSO 组合数',
        value: `${effectiveNewPso} 个`,
        sub: trigger === 'second_run' ? '命中显卡驱动磁盘缓存' : 'Shader × 混合 × RT × 顶点布局',
        tone: effectiveNewPso === 0 ? 'good' : strategy === 'none' ? 'bad' : 'accent',
      },
      {
        label: '启动预热代价',
        value: warmupText,
        sub:
          strategy === 'precaching'
            ? 'UE 5.8 r.PSOPrecaching=1 主力方案'
            : strategy === 'bundled'
            ? '传统录制 .spc 随包预热'
            : '放任运行期主线程现场硬编',
        tone: strategy === 'precaching' ? 'good' : strategy === 'bundled' ? 'warn' : 'bad',
      },
      {
        label: '状态组合倍率',
        value: `${stateMultiplier}× PSO`,
        sub: '同 Shader 换 Blend 或 RT 即为新 PSO',
        tone: stateMultiplier <= 2 ? 'good' : 'warn',
      },
    ]);
  }, [peakMs, isStutter, effectiveNewPso, trigger, strategy, warmupText, stateMultiplier]);

  const maxMs = isStutter ? Math.max(180, peakMs * 1.15) : 34;
  const plotL = 44;
  const plotR = 590;
  const plotT = 10;
  const plotB = 96;
  const plotW = plotR - plotL;
  const plotH = plotB - plotT;
  const msToY = (ms: number) => plotB - Math.min(1, ms / maxMs) * plotH;
  const y60 = msToY(16.67);
  const frames = 48;
  const spikeIdx = 24;
  const barGap = 2;
  const barW = plotW / frames - barGap;

  const slots = [
    { title: '1. VS + PS 字节码', sub: 'DXIL / SPIR-V', col: '#0ea5e9', hot: false },
    { title: '2. 顶点输入布局', sub: 'Static / Skel / ISM', col: '#8b5cf6', hot: false },
    { title: '3. Blend 混合状态', sub: blendDiff ? 'Opaque + Trans (×2)' : '仅 Opaque', col: blendDiff ? '#f59e0b' : '#10b981', hot: blendDiff },
    { title: '4. Depth / Stencil', sub: '深度读写与比较规则', col: '#14b8a6', hot: false },
    { title: '5. Rasterizer 光栅', sub: '双面/背面剔除/线框', col: '#6366f1', hot: false },
    { title: '6. RenderTarget 格式', sub: rtHdrDiff ? 'GBuffer + HDR (×2)' : '单一 RT 格式', col: rtHdrDiff ? '#f59e0b' : '#10b981', hot: rtHdrDiff },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={strategy === 'none'}
        pitfallLabel="关闭 PSO 预热：DX12 首次遇到新大招/新混合状态时，在渲染线程现场硬编 ISA，画面骤停卡死！"
        correctLabel="启用 UE 5.8 异步 PSO Precaching (r.PSOPrecaching=1) 或 Bundled 预热，把卡顿消灭在渲染之前！"
        onToggle={(p) => setStrategy(p ? 'none' : 'precaching')}
      />

      <div
        style={{
          borderRadius: 12,
          border: '1.5px solid var(--border-strong)',
          background: 'var(--bg-canvas)',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          userSelect: 'text',
        }}
      >
        {/* Top Panel: Frame-Time Heartbeat Oscilloscope */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 10,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
              📈 帧时间心跳示波器（当前事件：{meta.label}）
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 5,
                background: isStutter ? 'var(--accent-coral)' : 'var(--accent-sage)',
                color: isStutter ? 'var(--accent-coral-deep)' : 'var(--accent-sage-deep)',
              }}
            >
              {isStutter ? `⚡ PSO 现场编译卡死 ${peakMs}ms!` : `✓ 峰值 ${peakMs}ms (丝滑无感)`}
            </span>
          </div>

          <svg viewBox="0 0 600 106" style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="帧耗时示波器">
            <line x1={plotL} y1={y60} x2={plotR} y2={y60} stroke="rgba(239,68,68,0.8)" strokeWidth="1.3" strokeDasharray="4 4" />
            <text x="4" y={y60 + 3} fill="#ef4444" fontSize="9.5" fontWeight="700" fontFamily="var(--font-mono)">16.7ms</text>
            <text x="4" y={plotT + 8} fill="var(--text-muted)" fontSize="9.5" fontFamily="var(--font-mono)">{Math.round(maxMs)}ms</text>
            <text x="16" y={plotB} fill="var(--text-muted)" fontSize="9.5" fontFamily="var(--font-mono)">0ms</text>

            {Array.from({ length: frames }, (_, i) => {
              let ms = 14.6 + Math.sin(i * 0.7) * 1.1 + (i % 3 === 0 ? 0.4 : 0);
              if (i === spikeIdx) ms = peakMs;
              else if (i === spikeIdx + 1 && isStutter) ms = Math.max(16, peakMs * 0.48);
              else if (i === spikeIdx + 2 && isStutter) ms = Math.max(15.5, peakMs * 0.22);
              const x = plotL + i * (barW + barGap);
              const y = msToY(ms);
              const h = Math.max(2, plotB - y);
              const fill = ms > 28 ? '#ef4444' : ms > 16.67 ? '#f59e0b' : '#10b981';
              return <rect key={i} x={x} y={y} width={barW} height={h} rx="1.5" fill={fill} />;
            })}
          </svg>
        </div>

        {/* Bottom Panel: 6-Slot PSO Anatomy */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 10,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
            📦 拆开一个不可变 PSO 快换模具：不只是 Shader，必须把 6 大管线状态焊死在一起！
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
              gap: 8,
            }}
          >
            {slots.map((s) => (
              <div
                key={s.title}
                style={{
                  padding: '7px 9px',
                  borderRadius: 7,
                  background: 'var(--bg-subtle)',
                  border: `${s.hot ? 1.8 : 1}px solid ${s.col}`,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{s.title}</div>
                <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginTop: 2 }}>
                  {s.sub}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <StageSegmented<PsoTrigger>
        label="模拟玩家实机遭遇事件"
        value={trigger}
        options={[
          { value: 'skill_vfx', label: '🔥 首次放大招' },
          { value: 'new_biome', label: '❄️ 进新雪地关' },
          { value: 'driver_update', label: '🔄 更新显卡驱动' },
          { value: 'second_run', label: '✅ 二次重玩' },
        ]}
        onChange={setTrigger}
      />

      <StageSegmented<PsoStrategy>
        label="UE 5.8 PSO 治卡方案"
        value={strategy}
        options={[
          { value: 'none', label: '① 无治理（现场卡死）' },
          { value: 'bundled', label: '② Bundled Cache (.spc 启动进条)' },
          { value: 'precaching', label: '③ UE 5.8 异步 PSO Precaching' },
        ]}
        onChange={setStrategy}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <StageToggle
          label="同一 Shader 混用不同 Blend 状态"
          hint="PSO 数 ×2"
          checked={blendDiff}
          onChange={setBlendDiff}
        />
        <StageToggle
          label="输出到不同格式 RenderTarget"
          hint="PSO 数 ×2"
          checked={rtHdrDiff}
          onChange={setRtHdrDiff}
        />
      </div>
    </div>
  );
};

// ============================================================================
// LESSON 11.5 STAGE: 迷你 RenderDoc 像素履历 & HLSL 单步调试台
// ============================================================================

type DebugBugType = 'nan_div_zero' | 'tangent_space' | 'bloom_blowout';

interface DebugTraceLine {
  code: string;
  watchBug: string;
  watchFixed: string;
  isCulprit?: boolean;
}

const DEBUG_CASES: Record<
  DebugBugType,
  {
    label: string;
    pixelCoord: string;
    history: { pass: string; outBug: string; outFixed: string; alert?: boolean }[];
    lines: DebugTraceLine[];
    fixSummary: string;
  }
> = {
  nan_div_zero: {
    label: '黑块炸屏：0/0 浮点毒像素 (NaN)',
    pixelCoord: '(x=642, y=388)',
    history: [
      { pass: '1. DepthPrepass', outBug: 'Z = 0.0184', outFixed: 'Z = 0.0184' },
      { pass: '2. BasePass (M_Panel)', outBug: 'RGB = (NaN, NaN, NaN) ☠️', outFixed: 'RGB = (0.42, 0.36, 0.30)', alert: true },
      { pass: '3. Deferred Lighting', outBug: 'NaN 保持传播', outFixed: 'RGB = (0.78, 0.65, 0.51)' },
      { pass: '4. Bloom + TAA 后处理', outBug: '黑块传染扩散成 16×16 死黑洞!', outFixed: '柔和正常高光晕', alert: true },
    ],
    lines: [
      { code: 'float3 V = float3(0, 0, 0); // 退化向量', watchBug: 'V = (0, 0, 0)', watchFixed: 'V = (0, 0, 0)' },
      { code: 'float len = length(V);', watchBug: 'len = 0.0000', watchFixed: 'len = 0.0000' },
      {
        code: 'float3 dir = V / len;  // 未防除零!',
        watchBug: 'dir = (NaN, NaN, NaN) ☠️',
        watchFixed: 'SafeNormalize → (0, 0, 1)',
        isCulprit: true,
      },
      { code: 'float ndl = saturate(dot(N, dir));', watchBug: 'ndl = NaN', watchFixed: 'ndl = 0.820' },
      { code: 'OutColor = BaseColor * ndl;', watchBug: 'OutColor = NaN → 黑洞!', watchFixed: 'OutColor = (0.42, 0.36, 0.30)' },
    ],
    fixSummary: '用 SafeNormalize 或 max(len, 1e-4) 防护除零，并用 pow(max(x, 0), p) 防止负数开方生成 NaN。',
  },
  tangent_space: {
    label: '法线错乱：把切线法线当世界空间算',
    pixelCoord: '(x=512, y=420)',
    history: [
      { pass: '1. DepthPrepass', outBug: 'Z = 0.0211', outFixed: 'Z = 0.0211' },
      { pass: '2. BasePass (GBufferA)', outBug: 'WorldN = (0.12, -0.05, 0.99) ❌', outFixed: 'WorldN = (0.68, 0.24, 0.69)', alert: true },
      { pass: '3. Deferred Lighting', outBug: '模型一旋转高光就锁死在头顶!', outFixed: '高光随模型旋转自然贴合' },
      { pass: '4. Tonemap 输出', outBug: '背光面诡异发亮', outFixed: '物理明暗正确' },
    ],
    lines: [
      { code: 'float3 nTex = NormalMap.rgb * 2 - 1;', watchBug: 'nTex = (0.12, -0.05, 0.99)', watchFixed: 'nTex = (0.12, -0.05, 0.99)' },
      { code: '// 材质勾选了 Tangent Space Normal = false', watchBug: '跳过切线→世界矩阵!', watchFixed: '执行 TransformVector(T→W)' },
      {
        code: 'float3 worldN = nTex; // 空间张冠李戴!',
        watchBug: 'worldN 死指世界 +Z ❌',
        watchFixed: 'worldN = (0.68, 0.24, 0.69)',
        isCulprit: true,
      },
      { code: 'float ndl = saturate(dot(worldN, L));', watchBug: 'ndl = 0.98 (假亮)', watchFixed: 'ndl = 0.31 (侧光阴影)' },
      { code: 'GBufferA.rgb = worldN * 0.5 + 0.5;', watchBug: '写入错误的世界法线', watchFixed: '写入正确世界法线' },
    ],
    fixSummary: '用 RenderDoc 查 GBufferA（World Normal）原值一眼破案：恢复 Tangent Space Normal 或显式 TransformVector。',
  },
  bloom_blowout: {
    label: '闪瞎全屏：自发光失控飙到 12,000',
    pixelCoord: '(x=780, y=290)',
    history: [
      { pass: '1. DepthPrepass', outBug: 'Z = 0.0140', outFixed: 'Z = 0.0140' },
      { pass: '2. BasePass (Emissive)', outBug: 'SceneColor = (12800, 3200, 400) 🔥', outFixed: 'SceneColor = (14.5, 4.2, 0.8)', alert: true },
      { pass: '3. Auto Exposure 测光', outBug: '把整个场景压成一片死黑!', outFixed: '曝光稳定正常', alert: true },
      { pass: '4. Bloom 泛光', outBug: '半个屏幕炸成刺眼白球', outFixed: '精致克制的霓虹边光' },
    ],
    lines: [
      { code: 'float fres = pow(1 - NdotV, Exp);', watchBug: 'fres = 1.000 (掠射边缘)', watchFixed: 'fres = 0.960' },
      { code: 'float pulse = 1.0 / (dist + 0.0001);', watchBug: 'pulse = 8000.0 🔥', watchFixed: 'pulse = min(1/(d+0.1), 8.0)' },
      {
        code: 'Out.Emissive = Color * fres * pulse;',
        watchBug: 'HDR = (12800, 3200, 400) 🔥',
        watchFixed: 'HDR = (14.5, 4.2, 0.8)',
        isCulprit: true,
      },
      { code: 'Write SceneColor (FP16 HDR);', watchBug: '超亮值撑爆 Bloom 卷积核', watchFixed: '安全落在 HDR 泛光区' },
      { code: 'AutoExposure AvgLum;', watchBug: '全图拉黑保护眼睛', watchFixed: '亮度自然平衡' },
    ],
    fixSummary: '在 RenderDoc 中用像素探针吸取 HDR SceneColor 真实浮点值，立刻抓出倒数/指数爆炸，用 Clamp 封顶！',
  },
};

const Stage11_5_ShaderDebug: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [bugType, setBugType] = useState<DebugBugType>('nan_div_zero');
  const [debugLine, setDebugLine] = useState<number>(2);
  const [isFixed, setIsFixed] = useState<boolean>(false);
  const [dumpSymbols, setDumpSymbols] = useState<boolean>(true);

  const kpiRef = useRef(onKpiUpdate);
  kpiRef.current = onKpiUpdate;
  const prevStepRef = useRef(stepIndex);
  const prevResetRef = useRef(resetSignal);

  useEffect(() => {
    if (prevStepRef.current === stepIndex) return;
    prevStepRef.current = stepIndex;
    if (stepIndex === 0) {
      setBugType('nan_div_zero');
      setIsFixed(false);
      setDebugLine(2);
    } else if (stepIndex === 1) {
      setBugType('nan_div_zero');
      setIsFixed(false);
      setDebugLine(1);
    } else if (stepIndex === 2) {
      setBugType('nan_div_zero');
      setIsFixed(false);
      setDebugLine(2);
      setDumpSymbols(true);
    } else if (stepIndex === 3) {
      setBugType('tangent_space');
      setIsFixed(false);
      setDebugLine(2);
      setDumpSymbols(true);
    } else if (stepIndex === 4) {
      setBugType('nan_div_zero');
      setIsFixed(true);
      setDebugLine(2);
    }
  }, [stepIndex]);

  useEffect(() => {
    if (prevResetRef.current === resetSignal) return;
    prevResetRef.current = resetSignal;
    setBugType('nan_div_zero');
    setDebugLine(2);
    setIsFixed(false);
    setDumpSymbols(true);
  }, [resetSignal]);

  const info = DEBUG_CASES[bugType];
  const curLine = info.lines[debugLine];

  useEffect(() => {
    kpiRef.current([
      {
        label: 'RenderDoc 像素探针',
        value: info.pixelCoord,
        sub: isFixed ? '已修复：数值回归健康区间' : '故障像素已锁定，可看履历',
        tone: isFixed ? 'good' : 'bad',
      },
      {
        label: `HLSL 单步第 ${debugLine + 1} 行`,
        value: isFixed ? curLine.watchFixed : curLine.watchBug,
        sub: curLine.isCulprit ? '🎯 定位到真凶代码行！' : '逐行追踪变量演变',
        tone: isFixed ? 'good' : curLine.isCulprit ? 'bad' : 'accent',
      },
      {
        label: '调试符号状态',
        value: dumpSymbols ? '完整 HLSL 源码可读' : '仅裸 DXIL 汇编（难读）',
        sub: dumpSymbols ? 'r.Shaders.Symbols=1 + Optimize=0' : '未开启调试符号导出',
        tone: dumpSymbols ? 'good' : 'warn',
      },
      {
        label: '排查效率',
        value: dumpSymbols ? '3 分钟精准定位' : '盲猜连线 2 小时',
        sub: 'Pixel History + 逐行单步 + GBuffer 吸色',
        tone: dumpSymbols ? 'good' : 'warn',
      },
    ]);
  }, [info, debugLine, isFixed, dumpSymbols, curLine]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={!isFixed}
        pitfallLabel={`故障复现中：${info.label}（点击右侧任意代码行即可单步定位红色真凶！）`}
        correctLabel="已按调试结论修复：数值与 GBuffer/HDR 输出完全恢复健康！"
        onToggle={(p) => setIsFixed(!p)}
      />

      <div
        style={{
          borderRadius: 12,
          border: '1.5px solid var(--border-strong)',
          background: 'var(--bg-canvas)',
          padding: 12,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(255px, 1fr))',
          gap: 10,
          userSelect: 'text',
        }}
      >
        {/* Left: Viewport Probe + Pixel History */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 10,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)' }}>
            🎯 RenderDoc 画面探针 <code style={{ fontFamily: 'var(--font-mono)' }}>{info.pixelCoord}</code>
          </div>

          <svg viewBox="0 0 240 96" style={{ width: '100%', height: 'auto', borderRadius: 7, display: 'block' }} role="img" aria-label="RenderDoc 视口像素探针">
            <defs>
              <linearGradient id="rdocBg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#1e293b" />
                <stop offset="100%" stopColor="#334155" />
              </linearGradient>
              <radialGradient
                id="rdocSphere"
                cx={bugType === 'tangent_space' && !isFixed ? '50%' : '35%'}
                cy={bugType === 'tangent_space' && !isFixed ? '16%' : '34%'}
                r="65%"
              >
                {bugType === 'bloom_blowout' && !isFixed ? (
                  <>
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="55%" stopColor="#fef08a" />
                    <stop offset="100%" stopColor="rgba(250,204,21,0.22)" />
                  </>
                ) : (
                  <>
                    <stop offset="0%" stopColor="#f8fafc" />
                    <stop offset="46%" stopColor="#c28b5e" />
                    <stop offset="100%" stopColor="#292524" />
                  </>
                )}
              </radialGradient>
            </defs>
            <rect width="240" height="96" fill="url(#rdocBg)" />
            <circle
              cx="120"
              cy="49"
              r={bugType === 'bloom_blowout' && !isFixed ? 46 : 33}
              fill="url(#rdocSphere)"
            />
            {bugType === 'nan_div_zero' && !isFixed && (
              <rect x="109" y="38" width="22" height="22" fill="#000000" stroke="#ef4444" strokeWidth="1.4" />
            )}
            <line x1="100" y1="49" x2="140" y2="49" stroke="#38bdf8" strokeWidth="1.2" />
            <line x1="120" y1="29" x2="120" y2="69" stroke="#38bdf8" strokeWidth="1.2" />
          </svg>

          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>
            📜 Pixel History（该像素一帧履历）
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {info.history.map((h) => {
              const isBad = !isFixed && h.alert;
              return (
                <div
                  key={h.pass}
                  style={{
                    padding: '5px 8px',
                    borderRadius: 6,
                    background: isBad ? 'var(--accent-coral)' : 'var(--bg-code)',
                    border: isBad ? '1px solid var(--accent-coral-border)' : '1px solid transparent',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10.5,
                    lineHeight: 1.45,
                  }}
                >
                  <div style={{ fontWeight: 700, color: isBad ? 'var(--accent-coral-deep)' : 'var(--text-muted)' }}>
                    {h.pass}
                  </div>
                  <div style={{ fontWeight: 600, color: isBad ? 'var(--accent-coral-deep)' : 'var(--text-primary)' }}>
                    {isFixed ? h.outFixed : h.outBug}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Clickable HLSL Step-by-Step Debugger */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 10,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)' }}>
            {dumpSymbols
              ? '🐞 HLSL 源码级逐行单步调试（点击代码行可跳转）'
              : '⚠️ 无符号模式（只剩难懂的裸字节码寄存器）'}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
            {info.lines.map((ln, idx) => {
              const isCurrent = idx === debugLine;
              const isCulpritNow = !isFixed && ln.isCulprit;
              const displayCode = dumpSymbols
                ? ln.code
                : `op_${idx * 4 + 2} %r${idx + 1}, %r${idx}, #imm ; <no symbol>`;

              return (
                <div
                  key={idx}
                  onClick={() => setDebugLine(idx)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: isCurrent
                      ? isCulpritNow
                        ? 'var(--accent-coral)'
                        : 'var(--accent-sky)'
                      : 'var(--bg-code)',
                    border: `1.5px solid ${
                      isCurrent ? (isCulpritNow ? '#ef4444' : '#0ea5e9') : 'transparent'
                    }`,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10.5,
                    lineHeight: 1.45,
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontWeight: 700,
                        color: isCurrent ? (isCulpritNow ? '#ef4444' : '#0284c7') : 'var(--text-muted)',
                        minWidth: 32,
                      }}
                    >
                      {isCurrent ? `▶ L${idx + 1}` : `L${idx + 1}`}
                    </span>
                    <code style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>{displayCode}</code>
                  </div>
                  <div
                    style={{
                      marginLeft: 40,
                      marginTop: 2,
                      fontWeight: 700,
                      fontSize: 10.2,
                      color: isCulpritNow
                        ? 'var(--accent-coral-deep)'
                        : isFixed
                        ? 'var(--accent-sage-deep)'
                        : 'var(--accent-amber-deep)',
                    }}
                  >
                    Watch → {isFixed ? ln.watchFixed : ln.watchBug}
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              padding: '8px 10px',
              borderRadius: 7,
              background: 'var(--accent-sage)',
              color: 'var(--accent-sage-deep)',
              fontSize: 11,
              fontWeight: 600,
              lineHeight: 1.5,
            }}
          >
            🩺 处方：{info.fixSummary}
          </div>
        </div>
      </div>

      <StageSegmented<DebugBugType>
        label="选择经典 Shader 疑难杂症"
        value={bugType}
        options={[
          { value: 'nan_div_zero', label: '☠️ 0/0 NaN 黑块传染' },
          { value: 'tangent_space', label: '🧭 法线空间错乱' },
          { value: 'bloom_blowout', label: '💥 HDR 自发光爆表' },
        ]}
        onChange={(v) => {
          setBugType(v);
          setDebugLine(2);
        }}
      />

      <div className="stage-controls-grid">
        <StageSlider
          label="RenderDoc 单步执行行号 (Step Over)"
          value={debugLine + 1}
          min={1}
          max={5}
          step={1}
          unit=" 行"
          onChange={(v) => setDebugLine(v - 1)}
        />
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <StageToggle
            label="开启调试符号 (r.Shaders.Symbols=1)"
            hint="保留完整 HLSL 行号与变量名"
            checked={dumpSymbols}
            onChange={setDumpSymbols}
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// LESSON 11.6 STAGE: GPU 32 线程 Warp 分支发散 & VGPR 寄存器占用率实验室
// ============================================================================

type BranchStrategy = 'dynamic_if' | 'lerp_alu' | 'static_switch';

const Stage11_6_HardwareOpt: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [branchSplit, setBranchSplit] = useState<number>(4); // 0..8 columns in 8x4 Warp
  const [vgprPerThread, setVgprPerThread] = useState<number>(48); // 16..96
  const [branchMode, setBranchMode] = useState<BranchStrategy>('dynamic_if');
  const [useFastMath, setUseFastMath] = useState<boolean>(false);

  const kpiRef = useRef(onKpiUpdate);
  kpiRef.current = onKpiUpdate;
  const prevStepRef = useRef(stepIndex);
  const prevResetRef = useRef(resetSignal);

  useEffect(() => {
    if (prevStepRef.current === stepIndex) return;
    prevStepRef.current = stepIndex;
    if (stepIndex === 0) {
      setBranchSplit(4);
      setVgprPerThread(64);
      setBranchMode('dynamic_if');
      setUseFastMath(false);
    } else if (stepIndex === 1) {
      setBranchSplit(4);
      setVgprPerThread(32);
      setBranchMode('dynamic_if');
      setUseFastMath(false);
    } else if (stepIndex === 2) {
      setBranchSplit(4);
      setVgprPerThread(80);
      setBranchMode('dynamic_if');
      setUseFastMath(false);
    } else if (stepIndex === 3) {
      setBranchSplit(0);
      setVgprPerThread(24);
      setBranchMode('static_switch');
      setUseFastMath(true);
    } else if (stepIndex === 4) {
      setBranchSplit(4);
      setVgprPerThread(24);
      setBranchMode('lerp_alu');
      setUseFastMath(true);
    }
  }, [stepIndex]);

  useEffect(() => {
    if (prevResetRef.current === resetSignal) return;
    prevResetRef.current = resetSignal;
    setBranchSplit(4);
    setVgprPerThread(48);
    setBranchMode('dynamic_if');
    setUseFastMath(false);
  }, [resetSignal]);

  const isDivergent = branchMode === 'dynamic_if' && branchSplit > 0 && branchSplit < 8;
  const activeWaves = Math.max(1, Math.min(8, Math.floor(256 / vgprPerThread)));
  const occupancyPct = Math.round((activeWaves / 8) * 100);

  const latencyPenalty = activeWaves >= 6 ? 1.0 : activeWaves >= 4 ? 1.15 : activeWaves >= 2 ? 1.48 : 2.1;
  const branchCycles =
    branchMode === 'static_switch'
      ? 24
      : branchMode === 'lerp_alu'
      ? 32
      : isDivergent
      ? 56
      : 28;
  const mathFactor = useFastMath ? 0.72 : 1.0;
  const estPixelCycles = Math.round(branchCycles * mathFactor * latencyPenalty);

  const isPitfallState = isDivergent || activeWaves <= 2 || !useFastMath;

  useEffect(() => {
    kpiRef.current([
      {
        label: 'Warp (32线程) 执行态',
        value:
          branchMode === 'static_switch'
            ? '编译期已剪枝（无分支）'
            : isDivergent
            ? '⚠️ 分支发散（双路串行!）'
            : branchMode === 'lerp_alu'
            ? '无分支 Lerp（短算术最优）'
            : '✓ 队列齐步（跳过空分支）',
        sub: isDivergent
          ? `${branchSplit * 4} 人走 A + ${(8 - branchSplit) * 4} 人走 B，互相干等`
          : '32 名像素小学生步调一致',
        tone: isDivergent ? 'bad' : 'good',
      },
      {
        label: 'SM 活跃小队 (Occupancy)',
        value: `${activeWaves} / 8 Waves (${occupancyPct}%)`,
        sub: `每线程占 ${vgprPerThread} VGPR 草稿纸`,
        tone: occupancyPct >= 75 ? 'good' : occupancyPct >= 50 ? 'warn' : 'bad',
      },
      {
        label: '纹理延迟掩盖能力',
        value: activeWaves >= 4 ? '充足（无缝切队）' : '捉襟见肘（GPU 闲等贴图!）',
        sub: `延迟倍率 ×${latencyPenalty.toFixed(2)}`,
        tone: activeWaves >= 4 ? 'good' : 'bad',
      },
      {
        label: '综合像素周期估算',
        value: `${estPixelCycles} Cycles`,
        sub: useFastMath ? '已启用 x*x / 标量前置 / 半精度' : '含 pow/sin 超越函数高耗写法',
        tone: estPixelCycles <= 30 ? 'good' : estPixelCycles <= 52 ? 'warn' : 'bad',
      },
    ]);
  }, [
    branchMode,
    isDivergent,
    branchSplit,
    activeWaves,
    occupancyPct,
    vgprPerThread,
    latencyPenalty,
    estPixelCycles,
    useFastMath,
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={isPitfallState}
        pitfallLabel="分支跨界发散 + 临时变量撑爆 64+ VGPR + 滥用 pow/sin：Warp 双倍耗时且 SM 槽位腰斩！"
        correctLabel="选对分支策略 + 精简临时变量保住高 Occupancy + 数学瘦身：硬件算力与延迟掩盖拉满！"
        onToggle={(p) => {
          if (p) {
            setBranchMode('dynamic_if');
            setBranchSplit(4);
            setVgprPerThread(72);
            setUseFastMath(false);
          } else {
            setBranchMode('lerp_alu');
            setBranchSplit(4);
            setVgprPerThread(24);
            setUseFastMath(true);
          }
        }}
      />

      <div
        style={{
          borderRadius: 12,
          border: '1.5px solid var(--border-strong)',
          background: 'var(--bg-canvas)',
          padding: 12,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(265px, 1fr))',
          gap: 10,
          userSelect: 'text',
        }}
      >
        {/* Left: 8x4 Warp Lockstep Grid */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 10,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)' }}>
            👥 1 个 GPU Warp（32 名像素小学生锁步方阵）
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(8, 1fr)',
              gap: 4,
              position: 'relative',
            }}
          >
            {Array.from({ length: 32 }, (_, idx) => {
              const col = idx % 8;
              const isPathA = col < branchSplit;
              let fill = '#0ea5e9';
              let label = 'A';
              if (branchMode === 'static_switch') {
                fill = '#10b981';
                label = '✓';
              } else if (branchMode === 'lerp_alu') {
                fill = '#8b5cf6';
                label = 'L';
              } else {
                fill = isPathA ? '#0ea5e9' : '#f59e0b';
                label = isPathA ? 'A' : 'B';
              }
              const isEdgeLeft = isDivergent && col === branchSplit - 1;
              return (
                <div
                  key={idx}
                  style={{
                    height: 30,
                    borderRadius: 5,
                    background: fill,
                    color: '#ffffff',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: isEdgeLeft ? '2px 0 0 0 #ef4444' : 'none',
                  }}
                >
                  {label}
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)' }}>
            锁步执行时间轴：
          </div>
          {isDivergent ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              <div
                style={{
                  padding: '5px 8px',
                  borderRadius: 5,
                  background: '#0ea5e9',
                  color: '#fff',
                  fontSize: 10.5,
                  fontWeight: 700,
                  textAlign: 'center',
                }}
              >
                算分支 A (B组干等)
              </div>
              <div
                style={{
                  padding: '5px 8px',
                  borderRadius: 5,
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 10.5,
                  fontWeight: 700,
                  textAlign: 'center',
                }}
              >
                + 再算分支 B (A组干等!)
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: '5px 10px',
                borderRadius: 5,
                background: '#10b981',
                color: '#fff',
                fontSize: 10.5,
                fontWeight: 700,
              }}
            >
              {branchMode === 'static_switch'
                ? '单路直通（编译已剪枝）'
                : branchMode === 'lerp_alu'
                ? '无分支短算术一次走完'
                : '全员齐步单路跳过空分支!'}
            </div>
          )}

          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: isDivergent ? 'var(--accent-coral-deep)' : 'var(--text-secondary)',
            }}
          >
            {isDivergent
              ? '⚠️ 同一方阵跨过分支边界 = 两条路耗时相加！'
              : '✓ 无线程发散，32 线程算力全部用在刀刃上。'}
          </div>
        </div>

        {/* Right: VGPR Register File & Active Wave Occupancy */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 10,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)' }}>
            🗂️ 寄存器草稿纸 (VGPR) 与 SM 活跃小队槽位
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Array.from({ length: 8 }, (_, w) => {
              const active = w < activeWaves;
              const healthy = activeWaves >= 4;
              return (
                <div
                  key={w}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 5,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10.2,
                    fontWeight: 600,
                    background: active
                      ? healthy
                        ? 'var(--accent-sage)'
                        : 'var(--accent-coral)'
                      : 'var(--bg-subtle)',
                    border: `1px solid ${
                      active ? (healthy ? '#10b981' : '#ef4444') : 'var(--border-soft)'
                    }`,
                    color: active
                      ? healthy
                        ? 'var(--accent-sage-deep)'
                        : 'var(--accent-coral-deep)'
                      : 'var(--text-muted)',
                  }}
                >
                  {active
                    ? `Wave #${w + 1} · 驻留活跃 (占 ${vgprPerThread} VGPR)`
                    : `Wave #${w + 1} · 🚫 草稿纸满，被迫排队空置!`}
                </div>
              );
            })}
          </div>

          <div
            style={{
              marginTop: 2,
              padding: '7px 9px',
              borderRadius: 7,
              background: 'var(--accent-sky)',
              color: 'var(--accent-sky-deep)',
              fontSize: 10.5,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 700 }}>
              {useFastMath
                ? '⚡ 数学瘦身已开：x*x 替 pow(x,2) · 标量前置 · Half 精度'
                : '🐢 新手高耗写法：pow(x,2) + 嵌套 sin + 多次重复采样'}
            </div>
            <div>
              {activeWaves >= 4
                ? '活跃小队充足：A 队等贴图时秒切 B/C/D 队算，延迟完美隐藏！'
                : '⚠️ 仅剩极少小队：一读贴图全员干等几百周期，GPU 算力大面积闲置！'}
            </div>
          </div>
        </div>
      </div>

      <StageSegmented<BranchStrategy>
        label="条件分支实现策略"
        value={branchMode}
        options={[
          { value: 'dynamic_if', label: '① 动态 If 分支' },
          { value: 'lerp_alu', label: '② Lerp 无分支（短算术）' },
          { value: 'static_switch', label: '③ Static Switch（编译剪枝）' },
        ]}
        onChange={setBranchMode}
      />

      <div className="stage-controls-grid">
        <StageSlider
          label="分支边界切过 Warp 的位置 (0/8 = 全齐步)"
          value={branchSplit}
          min={0}
          max={8}
          step={1}
          unit=" / 8 列"
          onChange={setBranchSplit}
        />
        <StageSlider
          label="单像素临时变量压力 (VGPR 寄存器)"
          value={vgprPerThread}
          min={16}
          max={96}
          step={8}
          unit=" VGPR"
          onChange={setVgprPerThread}
        />
      </div>

      <StageToggle
        label="开启 ALU 数学瘦身（x*x 替 pow(x,2) / 标量前置 / Half 精度）"
        checked={useFastMath}
        onChange={setUseFastMath}
      />
    </div>
  );
};

// ============================================================================
// SCHEMATICS (11.4 ~ 11.6)
// ============================================================================

const SCHEMATIC_11_4: SchematicDiagram = {
  title: 'UE 5.8 PSO 管线状态对象组装与异步 Precaching 治卡管线',
  caption: 'Cooked 字节码只是半成品，必须与 5 项固定管线状态焊成 PSO 并由显卡驱动转成 ISA；靠异步 Precaching 与 Bundled 预热把卡顿移出主帧。',
  nodes: [
    {
      id: 'bc',
      title: 'Cooked Shader Library',
      subtitle: 'DXIL / SPIR-V (.ushaderbytecode)',
      category: 'texture',
      x: 16,
      y: 26,
      width: 196,
      outputs: [{ id: 's', label: 'VS + PS 字节码', color: '#38bdf8' }],
    },
    {
      id: 'st',
      title: '固定管线状态 (Render State)',
      subtitle: 'Blend / Depth / Cull / RT / VF',
      category: 'param',
      x: 16,
      y: 146,
      width: 196,
      outputs: [{ id: 'r', label: '状态描述符', color: '#f59e0b' }],
    },
    {
      id: 'pso',
      title: 'PSO 描述符 (不可变模具)',
      subtitle: 'Shader × State 唯一组合键',
      category: 'math',
      x: 256,
      y: 78,
      width: 186,
      inputs: [
        { id: 'a', label: '字节码', color: '#38bdf8' },
        { id: 'b', label: '管线状态', color: '#f59e0b' },
      ],
      outputs: [{ id: 'p', label: '待编译 PSO', color: '#a855f7' }],
    },
    {
      id: 'pre',
      title: 'UE 5.8 PSO Precaching',
      subtitle: 'r.PSOPrecaching=1 后台异步 + .spc',
      category: 'substrate',
      x: 482,
      y: 78,
      width: 196,
      inputs: [{ id: 'in', label: '加载期提前排队', color: '#a855f7' }],
      outputs: [{ id: 'isa', label: '写入驱动 ISA 缓存', color: '#10b981' }],
      note: '开启 r.PSOPrecache.Validation 抓漏网之鱼',
    },
    {
      id: 'draw',
      title: '60 FPS 零卡顿渲染帧',
      subtitle: '渲染线程直接复用现成硬件 PSO',
      category: 'output',
      x: 718,
      y: 88,
      width: 174,
      inputs: [{ id: 'ok', label: '0ms 切换 PSO', color: '#10b981' }],
    },
  ],
  edges: [
    { fromNode: 'bc', fromPin: 's', toNode: 'pso', toPin: 'a', color: '#38bdf8' },
    { fromNode: 'st', fromPin: 'r', toNode: 'pso', toPin: 'b', color: '#f59e0b' },
    { fromNode: 'pso', fromPin: 'p', toNode: 'pre', toPin: 'in', color: '#a855f7' },
    { fromNode: 'pre', fromPin: 'isa', toNode: 'draw', toPin: 'ok', color: '#10b981' },
  ],
};

const SCHEMATIC_11_5: SchematicDiagram = {
  title: 'UE 5.8 Shader 四层排错工具链（从编辑器到 RenderDoc 逐像素单步）',
  caption: '遇到黑块 NaN、法线错位或 HDR 爆表时，按「编辑器自查 → 开调试符号 → RenderDoc 像素履历与单步 → Insights/RGP 硬件剖析」层层破案。',
  nodes: [
    {
      id: 'ed',
      title: '1. UE 编辑器内快查',
      subtitle: 'HLSL Code / Platform Stats / DebugFloat3',
      category: 'input',
      x: 16,
      y: 78,
      width: 196,
      outputs: [{ id: 'o', label: '定位可疑材质', color: '#38bdf8' }],
    },
    {
      id: 'sym',
      title: '2. 导出调试符号配置',
      subtitle: 'Symbols=1 · Optimize=0 · DumpDebugInfo',
      category: 'param',
      x: 248,
      y: 78,
      width: 204,
      inputs: [{ id: 'i', label: '可疑 Shader', color: '#38bdf8' }],
      outputs: [{ id: 'o', label: '可读 HLSL 符号包', color: '#f59e0b' }],
      note: '仅本地排错开启，切忌提交进发版配置！',
    },
    {
      id: 'rdoc',
      title: '3. RenderDoc 抓帧单步',
      subtitle: 'GBuffer 吸色 + Pixel History + Step',
      category: 'math',
      x: 490,
      y: 26,
      width: 202,
      inputs: [{ id: 'i', label: '单帧 Capture', color: '#f59e0b' }],
      outputs: [{ id: 'fix', label: '揪出 NaN / 空间错乱', color: '#10b981' }],
    },
    {
      id: 'rgp',
      title: '4. Insights + RGP / Nsight',
      subtitle: '抓 PSO 卡顿尖峰与硬件 Wave 占用率',
      category: 'pipeline',
      x: 490,
      y: 150,
      width: 202,
      inputs: [{ id: 'i', label: '性能剖析 Trace', color: '#f59e0b' }],
      outputs: [{ id: 'opt', label: '锁死 ALU / TEX / VGPR 瓶颈', color: '#a855f7' }],
    },
    {
      id: 'done',
      title: '精准修复并回归验收',
      subtitle: 'SafeNormalize / Clamp / 硬件瘦身',
      category: 'output',
      x: 730,
      y: 84,
      width: 168,
      inputs: [
        { id: 'a', label: '修画面 Bug', color: '#10b981' },
        { id: 'b', label: '破硬件瓶颈', color: '#a855f7' },
      ],
    },
  ],
  edges: [
    { fromNode: 'ed', fromPin: 'o', toNode: 'sym', toPin: 'i', color: '#38bdf8' },
    { fromNode: 'sym', fromPin: 'o', toNode: 'rdoc', toPin: 'i', color: '#f59e0b' },
    { fromNode: 'sym', fromPin: 'o', toNode: 'rgp', toPin: 'i', color: '#f59e0b' },
    { fromNode: 'rdoc', fromPin: 'fix', toNode: 'done', toPin: 'a', color: '#10b981' },
    { fromNode: 'rgp', fromPin: 'opt', toNode: 'done', toPin: 'b', color: '#a855f7' },
  ],
};

const SCHEMATIC_11_6: SchematicDiagram = {
  title: '面向 GPU 硬件架构的 Shader 五大底层优化抓手',
  caption: '围绕 Warp 锁步、VGPR 寄存器占用率、ALU 指令效率与显存采样延迟四大硬件特性对症减负。',
  nodes: [
    {
      id: 'br',
      title: '分支策略选型',
      subtitle: 'StaticSwitch / [branch] / Lerp',
      category: 'param',
      x: 16,
      y: 16,
      width: 196,
      outputs: [{ id: 'o', label: '消灭 Warp 发散', color: '#38bdf8' }],
    },
    {
      id: 'vgpr',
      title: 'VGPR 寄存器瘦身',
      subtitle: '缩生命周期 + 启用 Half 精度',
      category: 'math',
      x: 16,
      y: 112,
      width: 196,
      outputs: [{ id: 'o', label: '拉升 SM Occupancy', color: '#10b981' }],
    },
    {
      id: 'alu',
      title: 'ALU 数学化简',
      subtitle: 'x*x 替 pow · 标量前置 · 少用 Custom',
      category: 'substrate',
      x: 16,
      y: 208,
      width: 196,
      outputs: [{ id: 'o', label: '压低指令周期', color: '#a855f7' }],
    },
    {
      id: 'tex',
      title: '采样与阶段优化',
      subtitle: '减依赖采样 + VertexInterpolator 搬家',
      category: 'texture',
      x: 268,
      y: 112,
      width: 214,
      inputs: [
        { id: 'a', label: '无发散', color: '#38bdf8' },
        { id: 'b', label: '高驻留', color: '#10b981' },
        { id: 'c', label: '低 ALU', color: '#a855f7' },
      ],
      outputs: [{ id: 'out', label: '延迟完美隐藏', color: '#f59e0b' }],
    },
    {
      id: 'gpu',
      title: '满血高效的 GPU 帧耗',
      subtitle: 'RGP / Nsight 验证 Wave 满载',
      category: 'output',
      x: 534,
      y: 118,
      width: 196,
      inputs: [{ id: 'in', label: '硬件友好 Shader', color: '#f59e0b' }],
    },
  ],
  edges: [
    { fromNode: 'br', fromPin: 'o', toNode: 'tex', toPin: 'a', color: '#38bdf8' },
    { fromNode: 'vgpr', fromPin: 'o', toNode: 'tex', toPin: 'b', color: '#10b981' },
    { fromNode: 'alu', fromPin: 'o', toNode: 'tex', toPin: 'c', color: '#a855f7' },
    { fromNode: 'tex', fromPin: 'out', toNode: 'gpu', toPin: 'in', color: '#f59e0b' },
  ],
};

// ============================================================================
// LESSONS 11.4 ~ 11.6 + MODULE 11 EXPORT
// ============================================================================

const module11PsoDebugLessons: LessonDefinition[] = [
  {
    id: 'pso-pipeline-state-stutter',
    moduleId: '11',
    number: '11.4',
    title: 'PSO（管线状态对象）与着色器卡顿终结战 —— 为什么打包编完 Shader，玩家放大招还是“定格掉帧”？',
    subtitle: '补齐“固定管线状态”前置知识，彻底区分 Shader 编译与 PSO 编译，掌握 UE 5.8 PSO Precaching 与 Bundled Cache',
    duration: '13 分钟',
    difficulty: '进阶',
    StageComponent: Stage11_4_PSO,
    steps: [
      {
        stepNumber: 1,
        shortLabel: '大招定格谜案',
        tag: 'phenomenon',
        title: '游戏打包时明明把 Shader 全编完了，为什么玩家第一次放技能画面还是骤停 0.15 秒？',
        paragraphs: [
          '哪怕用上了最高级的 RTX 旗舰显卡，玩家也常常吐槽某些 DX12 游戏有种怪病：平时跑着丝滑的 100 FPS，可每逢**第一次释放新大招、第一次推门进新区域、或者刚更新完显卡驱动**，画面就像被人按了暂停键一样突然定格 100~200 毫秒；奇妙的是，再放第二次同一招，就彻底丝滑了！',
          '既然 11.2 和 11.3 课讲过，游戏出包时早就把全部 DXIL / SPIR-V 塞进 `.ushaderbytecode` 了，这 150 毫秒的“首见定格（Shader Stutter）”到底卡在哪一步？答案就在 **PSO（Pipeline State Object，管线状态对象）**！',
        ],
        tryItPrompt:
          '先点击顶部【看踩坑现象】，再切换下方「🔥 首次放大招」与「✅ 二次重玩」，亲眼看示波器那根刺眼的红色 140ms+ 定格尖峰！',
      },
      {
        stepNumber: 2,
        shortLabel: '固定状态前置课',
        tag: 'background',
        title: '前置通俗课：除了 Shader 代码，显卡还有 5 组“机床夹具开关”必须焊死成 PSO！',
        paragraphs: [
          '先补齐一块最容易被忽视的前置拼图：显卡画一个三角形，光有 Shader（DXIL/SPIR-V 字节码）还远远不够！显卡流水线上还有一堆**固定管线状态（Fixed-Function Render States）**，例如：① 顶点数据长什么样（Vertex Input Layout）；② 新颜色和背景怎么叠加（Blend 混合状态）；③ 深度测试开不开、谁挡谁（Depth/Stencil）；④ 背面剔不剔除、画实心还是线框（Rasterizer）；⑤ 最终画到 8-bit 还是 16-bit HDR 底片（RenderTarget 格式）。',
          '可以把显卡想象成一台**全自动数控机床**：Shader 只是“刀头加工程序”，而那 5 项管线状态就是“传送带宽度、夹具角度与喷漆槽型号”。**DX11 时代**，引擎边跑边临时拆装夹具，驱动猜不到完整组合只能边画边凑合编译；而现代 **DX12 / Vulkan** 为了压榨极致吞吐，规定必须提前把「VS/PS 字节码 + 5 项固定管线状态」打包焊死成一个不可变模具，这就是 **PSO**！显卡驱动也正是在创建 PSO 的那一刻，才把 DXIL/SPIR-V 结合这 5 项状态真正翻译成硬件 **ISA 机器码**——如果这一步发生在了玩家激战时的渲染帧里，整条管线就会被硬生生憋住，形成肉眼可见的卡顿定格！',
        ],
        tryItPrompt:
          '看看舞台下半部分的「📦 PSO 快换模具 6 格拆解」，并开关下方两个复选框（混用 Blend / 不同 RT 格式），体会为什么同一个 Shader 会衍生成倍的 PSO 组合！',
        callout: {
          tone: 'tip',
          title: '一句话分清“编 Shader”和“编 PSO”',
          body: '**编 Shader** = 开发者电脑上把材质图编成跨显卡字节码（DXIL/SPIR-V）存进 DDC/安装包；**编 PSO** = 玩家电脑上显卡驱动把字节码 + 5 项固定管线状态焊死并翻成硬件 ISA 机器码！',
        },
      },
      {
        stepNumber: 3,
        shortLabel: '示波器治卡对比',
        tag: 'experiment',
        title: '三大方案同台 PK：无治理硬卡 vs Bundled 启动进条 vs UE 5.8 异步 PSO Precaching',
        paragraphs: [
          '怎么把 150ms 的红色卡顿峰抹平？游戏工业演进出了两代治卡方案：',
          '① **Bundled PSO Cache（传统录制收集）**：QA 测试人员把游戏从头到尾打通一遍，录制下所有遇过的 PSO 组合（`.rec.upipelinecache`），离线合并成 `.spc` 随包发布；玩家首次启动游戏时弹个“正在编译着色器”进度条，提前全部喂给驱动编完；② **UE 5.8 PSO Precaching（现代主力自动方案）**：不再完全依赖人工跑图录漏网之鱼，而是由引擎在**加载资产/关卡流送时自动推算出需要的 PSO**，丢进后台多线程异步编译，彻底解放主帧！',
        ],
        tryItPrompt:
          '在「🔥 首次放大招」和「❄️ 进新雪地关」下，依次点击三种治理方案，观察示波器红峰瞬间消失，并留意 KPI 里的「启动预热代价」差异！',
      },
      {
        stepNumber: 4,
        shortLabel: '走进 UE 5.8',
        tag: 'ue5',
        title: '走进 UE 5.8：r.PSOPrecaching、兜底跳过策略与 Driver Shader Cache',
        paragraphs: [
          '在 UE 5.8 中，**`r.PSOPrecaching=1`** 是现代项目的治卡核心（需配合项目设置里的 `Share Material Shader Code` 与 `Shared Material Native Libraries`）。当某个极其冷门的特效在后台异步 PSO 尚未编完的那几十毫秒里突然要画时，UE 5.8 还支持配置 **兜底策略**（如延迟创建渲染代理 `r.PSOPrecache.ProxyCreationWhenPSOReady` 或暂用默认兜底材质/跳过该帧绘制），宁可晚出现 1 帧也绝不让整场游戏卡死 150ms！',
          '同时，项目上线前可用 **`r.PSOPrecache.Validation=2`** 与 **`stat pso`** 审计有哪些漏网 PSO 没被提前预编。此外，对于极高画质主机/PC 3A，常见做法是 **PSO Precaching + 关键过场 Bundled `.spc` 预热双保险**；至于玩家二次进图秒开，则是靠显卡厂商自动维护的 **Driver Shader Cache（驱动磁盘缓存）**——一旦玩家升级驱动，驱动缓存失效，你的预热机制就会再次挺身而出！',
        ],
        tryItPrompt:
          '点击「🔄 更新显卡驱动」事件，直观感受为什么升级驱动后 Bundled 预热条会重新跑一遍，以及异步 Precaching 如何兜底！',
        callout: {
          tone: 'ue58',
          title: '如何用 Unreal Insights 抓实机 PSO 卡顿？',
          body: '启动游戏时带上 `-trace=default,gpu,rhicommands` 并用 **Unreal Insights** 打开，在渲染线程 / RHI 线程时间轴上如果看到动辄几十毫秒的 `CreateGraphicsPipelineState` 长条，100% 实锤就是漏网 PSO 卡顿！',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '防坑黄金口诀',
        tag: 'pitfall',
        title: '实战避坑口诀：Shader 瘦身源头控量，Precaching 异步兜底，发版必跑干净驱动实机验收！',
        paragraphs: [
          '牢记三条防 PSO 卡顿铁律：① **源头减负**：少造花哨的母材质变体与无谓的混合状态切换，PSO 组合基数自然小一半；② **绝不在自己编过 10 遍的开发机上宣布“我这不卡”**——你的本地显卡驱动早把旧 ISA 缓存得严严实实，验收 PSO 卡顿必须**清空显卡驱动缓存（或换一台未跑过的新机）**跑实机；③ **结合 `r.PSOPrecaching=1` 与 Unreal Insights 实测**，把所有运行期 `CreateGraphicsPipelineState` 尖峰清零！',
          '至此，从连线 → 编译 → IR → DDC → PSO 的全生命周期已经彻底打通。最后两课，我们化身“显卡外科医生”：先学 **Shader 调试工具链（RenderDoc 单步抓 Bug）**，再攻克 **GPU 硬件底层优化**！',
        ],
        tryItPrompt:
          '切换右上角「UE5.8 原理图」，再完整复习一遍字节码 + 固定管线状态 → PSO → 异步预热 → 60 FPS 丝滑帧的全流程！',
      },
    ],
    takeaways: [
      'PSO（管线状态对象）= Shader 字节码 + 5 项固定管线状态（顶点布局/Blend/Depth/光栅/RT 格式），DX12/Vulkan 必须将其焊死成不可变对象',
      '首见卡顿（Shader Stutter）的本质是显卡驱动在渲染帧内同步将 PSO 编译为硬件 ISA，堵死了渲染管线',
      'UE 5.8 推荐以异步 **PSO Precaching (`r.PSOPrecaching=1`)** 为主力，必要时配合 **Bundled PSO Cache (`.spc`)** 双保险',
      '验收 PSO 卡顿必须清空本机显卡驱动 Shader Cache，并用 **Unreal Insights** 检查 RHI 线程是否残留 `CreateGraphicsPipelineState` 尖峰',
    ],
    schematic: SCHEMATIC_11_4,
  },
  {
    id: 'shader-debugging-renderdoc',
    moduleId: '11',
    number: '11.5',
    title: 'Shader 调试工具链实战 —— 从 HLSL 源码对照、Debug Dump 到 RenderDoc 逐像素单步抓 Bug',
    subtitle: '补齐“GPU 抓帧、像素履历与 NaN 浮点毒像素”前置常识，学会像调试代码一样单步解剖材质 Bug',
    duration: '12 分钟',
    difficulty: '实战',
    StageComponent: Stage11_5_ShaderDebug,
    steps: [
      {
        stepNumber: 1,
        shortLabel: '黑块炸屏悬案',
        tag: 'phenomenon',
        title: '材质画面突然炸出扩散黑洞、法线旋转锁死或整屏闪白，光靠肉眼瞪着 80 个节点能查出来吗？',
        paragraphs: [
          '做复杂材质或特效时，每个人都撞见过“灵异现场”：视角一转到某个刁钻角度，模型边缘突然冒出一个漆黑方块，几帧之内竟然像墨水一样晕染成一大片黑洞；或者自发光粒子一凑近，整个关卡瞬间被自动曝光拉成漆黑一片！',
          '新手只会不断断开连线“二分法瞎猜”，猜两小时还找不到根源。专业 TA 和图形程序根本不靠猜——他们会直接用 **GPU 抓帧调试工具（RenderDoc）** 定格那一帧，对着出问题的那个像素**逐行单步执行 HLSL**，三分钟揪出元凶！',
        ],
        tryItPrompt:
          '先看舞台左侧小视口球体正中那块不断扩散的黑色方块（NaN 毒像素），再对照右侧标红的 `L3` 代码行，体验“一秒锁定真凶”的爽感！',
      },
      {
        stepNumber: 2,
        shortLabel: '抓帧与 NaN 前置课',
        tag: 'background',
        title: '前置通俗课：什么是“GPU 抓帧”、“Pixel History 像素履历”与“NaN 浮点毒像素”？',
        paragraphs: [
          '动手调试前，先扫清三个零基础最容易犯怵的名词：① **GPU 抓帧（Frame Capture）**：相当于给显卡按下“时空静止器”，把这一帧发给显卡的**每一次 Draw Call、每一张输入贴图、每一张中间底片（GBuffer/Depth/SceneColor）和全部 Shader 代码**完整录成一个 `.rdc` 档案，你可以离线反复回放解剖；② **Pixel History（像素履历表）**：选中屏幕某个坐标 `(x, y)`，它按时间顺序列出这一帧里先后是谁涂过这个点（Depth → BasePass → 光照 → Bloom），每一步输出了什么精确浮点数值！',
          '③ **NaN 浮点毒像素（Not a Number）**：电脑算数里如果出现 `0 / 0`（比如对零向量做归一化 `Normalize`）或 `sqrt(负数)` / `pow(负数, 小数)`，算出来既不是 0 也不是 1，而是一个叫 `NaN` 的**“剧毒数值”**——任何正常数跟 `NaN` 做加减乘除都会变成 `NaN`！一旦它混进 Bloom 泛光模糊或 TAA 跨帧抗锯齿，相邻像素一平均就集体中毒，瞬间在屏幕上扩散成一大块吓人的死黑洞！',
        ],
        tryItPrompt:
          '依次切换舞台下方的三个经典疑难杂症（「0/0 NaN 黑块」「法线空间错乱」「HDR 自发光爆表」），观察左侧 Pixel History 履历如何逐 Pass 暴露真相！',
        callout: {
          tone: 'warn',
          title: '材质里最容易造出 NaN 的三大隐蔽写法',
          body: '① `Normalize(0,0,0)` 或自定义除法没给分母加 `max(d, 1e-4)`；② `Power(Base, Exp)` 的 `Base` 出现微小负值（务必先 `max(Base, 0.0001)` 或 `saturate`）；③ `acos(x)` 输入越界超过 `[-1, 1]`！',
        },
      },
      {
        stepNumber: 3,
        shortLabel: '亲手单步排错',
        tag: 'experiment',
        title: '化身显卡侦探：拖动单步滑块逐行盯住 Watch 变量，并体会“有没有调试符号”的天壤之别',
        paragraphs: [
          '在右侧迷你调试器里，你可以像程序员用 Visual Studio 调试代码一样，把行号从 `L1` 一步步步进到 `L5`，紧盯每一行下方橙/红/绿色的 **`Watch` 实时变量值**，看看正常数值到底是在哪一行突然翻车变成 `NaN` 或 `12800` 的。',
          '同时务必试着关掉下方的 **`开启调试符号 (r.Shaders.Symbols=1)`** 开关：在默认发版/优化编译下，变量名和源码行号全被剥离，RenderDoc 里只能看到晦涩的汇编指令 `%r1, %r2`；只有打开 UE 调试符号配置后，你才能享受源码级逐行单步的丝滑体验！',
        ],
        tryItPrompt:
          '拖动「RenderDoc 单步执行行号」从 1 走到 5，再开关「开启调试符号」，最后点顶部【切正确配置】验证修复后的 Watch 数值！',
      },
      {
        stepNumber: 4,
        shortLabel: '走进 UE 5.8',
        tag: 'ue5',
        title: '走进 UE 5.8：四层排错工具箱（从 DebugFloat3Values 到 RenderDoc 与 RGP/Nsight）',
        paragraphs: [
          '在真实 UE 5.8 工程中，推荐按**“由轻到重”四层工具链**排错：① **材质编辑器内快查**：临时把怀疑的节点直接连到 `Emissive` 看颜色，或用官方内置材质函数 **`DebugFloat3Values` / `DebugScalarValues`** 直接把精确数字打印在模型表面；② **导出可读 HLSL 调试符号**：在 `ConsoleVariables.ini` 中临时取消注释 `r.Shaders.Optimize=0`、`r.Shaders.Symbols=1`、`r.DumpShaderDebugInfo=1`（或开启 `r.ShaderDevelopmentMode=1` 让报错直接弹窗）；',
          '③ **RenderDoc 抓帧**：在 UE 5.8 插件库启用官方 **RenderDoc Plugin**，视口右上角就会多出一个绿色抓帧按钮（默认 `Alt + F12`），一键捕获当前帧并在 RenderDoc 中检查 GBuffer、Pixel History 与 HLSL 单步；④ **硬件级深度剖析**：画面没错但想查显卡硬件算力卡在哪？用 **Unreal Insights** 查编译/PSO，用 **AMD RGP (Radeon GPU Profiler)** 或 **NVIDIA Nsight Graphics** 查看真实 GPU Wave 占用率与指令停顿！',
        ],
        tryItPrompt:
          '切换右上角「UE5.8 原理图」，记住从轻量编辑器快查 → 开调试符号 → RenderDoc 抓 Bug → RGP/Nsight 抓硬件瓶颈的四层进阶路线。',
        callout: {
          tone: 'ue58',
          title: '为什么开 RenderDoc 插件前先看下 SM6 / 调试开关？',
          body: '修改 `ConsoleVariables.ini` 开启 `r.Shaders.Symbols=1` 会触发带符号的重编（也会使帧率下降），**切记只改本地配置文件、绝对不要提交到团队版本库**，查完 Bug 立刻注释还原！',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '防坑黄金口诀',
        tag: 'pitfall',
        title: '实战避坑口诀：黑洞先抓 NaN、光乱查 GBuffer、过曝吸 HDR、查完必关调试开关！',
        paragraphs: [
          '收好这套四句排错速查心法：① **画面出现黑方格扩散** → 99% 是 `NaN` 毒像素，用 `SafeNormalize`、`max(x, 1e-4)`、`saturate` 封死除零与负数开方；② **光照/反射随旋转错乱** → 进 RenderDoc 吸取 `GBufferA (WorldNormal)` 原值，一眼验证切线/世界空间转换；③ **自动曝光抽风或全屏爆白** → 吸取 HDR `SceneColor` 真实浮点值，给倒数和自发光加 `Clamp` 封顶；④ **排错收尾** → 务必恢复 `r.Shaders.Optimize=1` 并关闭 `DumpShaderDebugInfo`，防止污染打包性能与塞爆硬盘！',
          '揪出画面 Bug 之后，如果画面完全正确、Draw Call 也很健康，但 GPU 像素耗时还是偏高怎么办？下一课（本章压轴），我们直潜 GPU 芯片内部，学会面向 **Warp 锁步与 VGPR 寄存器** 写硬件最爱跑的极致优化 Shader！',
        ],
        tryItPrompt:
          '点回「💥 HDR 自发光爆表」和「🧭 法线空间错乱」各单步走一遍，确保三种经典排错思路烂熟于心！',
      },
    ],
    takeaways: [
      'GPU 抓帧（RenderDoc）能冻结单帧全部 Draw Call、GBuffer 底片与 Shader，通过 **Pixel History + HLSL 单步调试** 精准定位故障行',
      '黑洞扩散通常是 `0/0` 或负数开方产生的 **NaN 毒像素** 经 Bloom / TAA 传染所致，用 `SafeNormalize` 与 `max(x, 1e-4)` 彻底防毒',
      '本地排错可临时在 `ConsoleVariables.ini` 开启 `r.Shaders.Symbols=1` 与 `r.Shaders.Optimize=0`，但严禁提交进发版配置',
      '画面排错用 **RenderDoc**，编译/PSO 卡顿查 **Unreal Insights**，硬件底层算力瓶颈用 **RGP / Nsight Graphics**',
    ],
    schematic: SCHEMATIC_11_5,
  },
  {
    id: 'shader-hardware-opt-warp-vgpr',
    moduleId: '11',
    number: '11.6',
    title: 'Shader 底层硬件优化 —— 32/64 线程锁步（Warp）、VGPR 寄存器占用率与指令/采样瘦身',
    subtitle: '承接 1.2 小学生方阵，正式补齐 Warp 锁步、VGPR 草稿纸与延迟掩盖原理，掌握硬件级优化五大法则',
    duration: '13 分钟',
    difficulty: '实战',
    StageComponent: Stage11_6_HardwareOpt,
    steps: [
      {
        stepNumber: 1,
        shortLabel: '加 If 反变更慢',
        tag: 'phenomenon',
        title: '我在材质里特意写了 If 分支想“跳过不用算的那一半”，为什么帧率不升反降？',
        paragraphs: [
          '很多从写普通 CPU 程序转来学材质的同学，特别喜欢在材质里放 `If` 节点：“左边像素算岩石，右边像素算泥土，用 `If` 隔开不是刚好各自省掉一半计算量吗？”结果一上真机实测，帧率不仅没涨，有时甚至比不用 `If` 还慢！',
          '还有另一种怪现象：两个材质的指令数在 `Platform Stats` 里差不多，可 A 材质跑得飞快，B 材质（只是同时暂存了好几张贴图和中间向量）却把显卡拖得气喘吁吁。要看穿这两个“反直觉陷阱”，必须回到第 1.2 课的**一万名小学生方阵**，再往前迈出关键一步！',
        ],
        tryItPrompt:
          '观察舞台左半边那支 8×4（32 人）方阵：当红线从中间切开（A 组 16 人 + B 组 16 人），注意下方时间轴怎么变成了「算 A + 再算 B」的双倍耗时！',
      },
      {
        stepNumber: 2,
        shortLabel: 'Warp 与 VGPR 前置课',
        tag: 'background',
        title: '前置通俗课：32/64 人齐步方阵（Warp）、课桌草稿纸（VGPR）与“等快递切队干活”（Occupancy）',
        paragraphs: [
          '记住 GPU 硬件干活的三条底层铁律，就能瞬间看穿一切底层优化：① **Warp / Wavefront 锁步执行**：显卡不是每个像素单干，而是把相邻的 **32 个（NVIDIA 叫 Warp）或 64 个（AMD 叫 Wavefront）像素**编成一个大班，共用 1 位体育老师喊同一句口令齐步走！如果班里哪怕有 1 个人走 `If` 的左路、31 个人走右路，体育老师没办法同时喊两句口令，只能先让左路算、右路全体戴上“屏蔽面具”干等，再反过来让右路算、左路干等——这就是臭名昭著的 **Branch Divergence（分支发散）**！',
          '② **VGPR 寄存器（每个小学生的课桌草稿纸）与 Occupancy（活跃小队占用率）**：每算一步中间结果，像素都要记在芯片上最快的一块私人草稿纸 **VGPR** 上；但一个计算单元（SM/CU）里草稿纸总量是写死的！同时，从显存读一张贴图慢得像等快递（要等几百个时钟周期）。GPU 掩盖漫长等贴图延迟的绝招叫 **Latency Hiding（延迟掩盖）**：把 6~8 支小队塞进同一个教室，A 队刚下单等贴图，老师 0 秒立刻切 B 队算，等一圈轮回来 A 队的贴图刚好送到！可一旦你的材质临时变量太多、每像素霸占了 80 张草稿纸，教室瞬间从能塞 **8 支小队暴跌成只塞得下 2~3 支**——两队全在等贴图时，整块昂贵的显卡核心只能集体发呆！',
        ],
        tryItPrompt:
          '来回拖动右侧「VGPR 寄存器」滑块（从 24 拖到 80），亲眼看 SM 里的 8 个活跃 Wave 槽位如何被一个个挤爆变灰，导致纹理延迟倍率飙升！',
        callout: {
          tone: 'formula',
          title: '一句话秒懂三大硬件术语',
          body: '**Warp/Wavefront** = 32/64 像素齐步方阵；**VGPR** = 每像素私人草稿纸；**Occupancy** = 教室能同时轮班掩盖等贴图延迟的活跃小队数！',
        },
      },
      {
        stepNumber: 3,
        shortLabel: '三大分支选型实验',
        tag: 'experiment',
        title: '亲手对比三种分支策略 + 数学瘦身：什么时候用 Static Switch、Lerp 还是动态 Branch？',
        paragraphs: [
          '现在把左边的分支边界滑块和顶部的三种策略结合起来实测，记住工程界公认的**分支选型黄金三角**：',
          '① **材质变体开关（每个物体固定不变）→ 用 `Static Switch`**（前提是总数可控），编译期直接把死路剪光，运行期 0 成本；② **两边都是短短几条加减乘算术 → 直接用 `Lerp` 无分支混合**（哪怕两边都算，也比插一个动态跳转分支更快更省事）；③ **分支内部藏着巨昂贵的 8 次视差循环/多次贴图采样，且屏幕上大块连续区域走同一条路（边界滑块在 0 或 8，相干性高）→ 才适合在 HLSL 中用 `[branch]` 动态分支**，让整支 32 人方阵齐刷刷跳过昂贵采样！',
        ],
        tryItPrompt:
          '先把策略留在「① 动态 If」，拖动分支边界到 0 或 8（大块相干跳过）vs 停在 4（交错发散翻倍），再切换「② Lerp」与「③ Static Switch」对比周期数！',
      },
      {
        stepNumber: 4,
        shortLabel: '走进 UE 5.8',
        tag: 'ue5',
        title: '走进 UE 5.8：五大底层优化落地抓手（ALU 瘦身、半精度、依赖采样与 Custom 节点边界）',
        paragraphs: [
          '把硬件原理直接翻译成你在 UE 5.8 材质编辑器里每天都能用的五把手术刀：① **ALU 数学瘦身**：用 `Multiply(x, x)` 代替 `Power(x, 2)`（超越函数 `pow / sin / cos / exp / sqrt / acos` 昂贵数倍）；标量相乘先括号括起来再乘三维向量（`(a * b) * RGB` 只需 4 次乘法，而非 `a * RGB * b` 的 6 次）；省掉对已经是单位向量的二次 `Normalize`；② **压低 VGPR 寄存器压力**：别把十几张贴图全在开头一次性采完再慢慢混（所有颜色被迫长期霸占草稿纸），尽量随采随混缩短变量生命周期，并在移动端/兼容通道合理勾选 **`Use Full Precision` 关闭（让引擎启用 16-bit Half 精度 `min16float`）**，草稿纸压力直接减半！',
          '③ **警惕依赖纹理采样（Dependent Texture Read）**：先采 A 图算出偏移再采 B 图，会让两段漫长显存延迟被迫串行叠加；④ **算力搬家**：平滑渐变类计算放进 **`VertexInterpolator`** 挪到顶点阶段（回顾 9.2）；⑤ **慎用 `Custom` HLSL 节点**：因为 `Custom` 节点对 UE 材质翻译器而言是不透明黑盒，容易阻断跨节点公共子表达式合并（CSE）与静态折叠——能用内置原生节点组合的绝不轻易写进 `Custom`！',
        ],
        tryItPrompt:
          '勾选舞台最下方的「开启 ALU 数学瘦身」，配合将 VGPR 压到 24、消除分支发散，把综合像素周期从 80+ 压到 25 以内！',
        callout: {
          tone: 'ue58',
          title: '实测高于一切：如何确认优化真的生效了？',
          body: '修改完材质后，先在 UE `Platform Stats` 看指令与采样器变化，再进 **ProfileGPU** 看对应 `BasePass` 毫秒数；对于重度像素瓶颈，抓一帧 **AMD RGP / NVIDIA Nsight** 直接核对真实硬件 **VGPR 数与 Wave Occupancy**！',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '第 11 章通关总结',
        tag: 'pitfall',
        title: '第 11 章全景收官：从连线图到 GPU 硅片，你已打通 UE 5.8 Shader 工程全链路！',
        paragraphs: [
          '🎉 **恭喜通关整章最硬核的《第 11 章 · Shader 编译、中间表示、DDC、PSO 与底层调试优化》！** 把六节课串成一条线：连线图经 **HLSL / Material IR** 按 `Usage × VF × Pass × 2^Switch` 展开由 **SCW / UBA** 编译成 **DXIL / SPIR-V / Metal AIR**，借 **DDC 哈希指纹与 Zen 共享缓存**团队复用，打包后靠 **PSO Precaching** 提前交给驱动译成 **GPU ISA** 消灭首见卡顿，遇到 Bug 用 **RenderDoc 像素履历 + 单步调试**秒破案，最后围绕 **Warp 锁步、VGPR 占用率与 ALU/采样瘦身**压榨出满血帧率！',
          '接下来，马上进入 **第 12 章综合练习与关卡验收**——除了经典的检验板制作（12.1）与 200 块阵列性能验收（12.2），我们还为你准备了全新的 **12.3 Shader 编译审计、PSO Precaching 验证与 RenderDoc 抓帧实操验收**！',
        ],
        tryItPrompt:
          '点击下一课进入第 12 章实战总验收，也可以先去「🩺 实战排错」体验新增的编译/PSO/分支发散/DDC 四大新案例！',
      },
    ],
    takeaways: [
      'GPU 以 32（Warp）/ 64（Wavefront）像素锁步执行：动态 `If` 跨界会产生分支发散（双路耗时相加），短算术优先 `Lerp`，静态配置用 `Static Switch`',
      '单像素临时变量过多会撑爆 VGPR 寄存器、拉低 SM/CU 活跃 Wave 数（Occupancy），使显卡失去掩盖纹理采样延迟的能力',
      'ALU 瘦身三件套：`x*x` 替 `pow(x,2)`、标量先算再乘向量、减少冗余 `Normalize` 与超越函数，并尽量启用 Half 精度减半寄存器占用',
      '慎用 `Custom` 节点避免阻断前端优化，避免非必要的链式依赖采样，最终以 `ProfileGPU` / RGP / Nsight 实测为准',
    ],
    schematic: SCHEMATIC_11_6,
  },
];

export const module11: ModuleDefinition = {
  id: '11',
  number: '11',
  title: 'Shader 编译、中间表示、DDC、PSO 与调试优化',
  subtitle: '打通从材质连线、HLSL/IR 字节码、DDC 缓存、PSO 治卡到 RenderDoc 调试与 Warp/VGPR 硬件优化的全链路',
  lessons: [...module11CompileIRLessons, ...module11PsoDebugLessons],
};
