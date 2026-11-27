import React, { useState, useEffect, useRef } from 'react';
import {
  LessonDefinition,
  LessonStageProps,
  SchematicDiagram,
} from '../types/course';
import {
  StageSlider,
  StageSegmented,
  StageToggle,
  PitfallCompareBar,
} from '../components/ui/StageWidgets';

// ============================================================================
// LESSON 11.1 STAGE: Shader 编译全链路与变体裂变模拟器
// ============================================================================

type CompileBackend = 'single' | 'scw16' | 'uba';

const Stage11_1_ShaderCompile: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [usageSkeletal, setUsageSkeletal] = useState<boolean>(true);
  const [usageInstanced, setUsageInstanced] = useState<boolean>(true);
  const [usageNiagara, setUsageNiagara] = useState<boolean>(true);
  const [usageSpline, setUsageSpline] = useState<boolean>(false);
  const [staticSwitches, setStaticSwitches] = useState<number>(3);
  const [qualityTiers, setQualityTiers] = useState<number>(2);
  const [backend, setBackend] = useState<CompileBackend>('scw16');
  const [isPitfall, setIsPitfall] = useState<boolean>(false);

  const kpiRef = useRef(onKpiUpdate);
  kpiRef.current = onKpiUpdate;
  const prevStepRef = useRef(stepIndex);
  const prevResetRef = useRef(resetSignal);

  useEffect(() => {
    if (prevStepRef.current === stepIndex) return;
    prevStepRef.current = stepIndex;
    if (stepIndex === 0) {
      setIsPitfall(true);
      setUsageSkeletal(true);
      setUsageInstanced(true);
      setUsageNiagara(true);
      setUsageSpline(true);
      setStaticSwitches(5);
      setQualityTiers(3);
      setBackend('scw16');
    } else if (stepIndex === 1) {
      setIsPitfall(false);
      setUsageSkeletal(false);
      setUsageInstanced(true);
      setUsageNiagara(false);
      setUsageSpline(false);
      setStaticSwitches(1);
      setQualityTiers(2);
      setBackend('scw16');
    } else if (stepIndex === 2) {
      setIsPitfall(false);
      setUsageSkeletal(true);
      setUsageInstanced(true);
      setUsageNiagara(true);
      setUsageSpline(false);
      setStaticSwitches(3);
      setQualityTiers(2);
      setBackend('scw16');
    } else if (stepIndex === 3) {
      setIsPitfall(false);
      setUsageSkeletal(false);
      setUsageInstanced(true);
      setUsageNiagara(false);
      setUsageSpline(false);
      setStaticSwitches(2);
      setQualityTiers(2);
      setBackend('uba');
    } else if (stepIndex === 4) {
      setIsPitfall(false);
      setUsageSkeletal(false);
      setUsageInstanced(true);
      setUsageNiagara(false);
      setUsageSpline(false);
      setStaticSwitches(1);
      setQualityTiers(2);
      setBackend('scw16');
    }
  }, [stepIndex]);

  useEffect(() => {
    if (prevResetRef.current === resetSignal) return;
    prevResetRef.current = resetSignal;
    setIsPitfall(false);
    setUsageSkeletal(true);
    setUsageInstanced(true);
    setUsageNiagara(true);
    setUsageSpline(false);
    setStaticSwitches(3);
    setQualityTiers(2);
    setBackend('scw16');
  }, [resetSignal]);

  const effSkel = isPitfall ? true : usageSkeletal;
  const effInst = isPitfall ? true : usageInstanced;
  const effNiag = isPitfall ? true : usageNiagara;
  const effSpln = isPitfall ? true : usageSpline;
  const effSwitches = isPitfall ? 6 : staticSwitches;
  const effQuality = isPitfall ? 3 : qualityTiers;
  const effBackend: CompileBackend = isPitfall ? 'scw16' : backend;

  const vfCount =
    2 +
    (effSkel ? 2 : 0) +
    (effInst ? 1 : 0) +
    (effNiag ? 2 : 0) +
    (effSpln ? 1 : 0);
  const passesPerVf = 7;
  const switchCombos = Math.pow(2, effSwitches);
  const totalShaders = vfCount * passesPerVf * effQuality * switchCombos;

  const throughputPerSec =
    effBackend === 'single' ? 14 : effBackend === 'scw16' ? 145 : 680;
  const compileSec = +(totalShaders / throughputPerSec).toFixed(1);
  const shaderMapMB = +((totalShaders * 14.5) / 1024).toFixed(1);

  useEffect(() => {
    kpiRef.current([
      {
        label: '总 Shader 编译数',
        value: `${totalShaders.toLocaleString()} 个`,
        sub: `${vfCount} 顶点工厂 × ${passesPerVf} Pass × ${effQuality} 画质 × ${switchCombos} 分支`,
        tone: totalShaders <= 320 ? 'good' : totalShaders <= 1500 ? 'warn' : 'bad',
      },
      {
        label: '预估首次全编耗时',
        value: compileSec >= 60 ? `${(compileSec / 60).toFixed(1)} 分钟` : `${compileSec} 秒`,
        sub:
          effBackend === 'uba'
            ? 'UBA 分布式编译农场加速'
            : effBackend === 'scw16'
            ? '本地 16 线程 SCW 并行'
            : '单核串行编译（极慢）',
        tone: compileSec <= 6 ? 'good' : compileSec <= 25 ? 'warn' : 'bad',
      },
      {
        label: '静态分支上限 (2^N)',
        value: `${switchCombos} 份`,
        sub: effSwitches <= 2 ? '克制可控' : '指数翻倍风险！',
        tone: effSwitches <= 2 ? 'good' : effSwitches <= 4 ? 'warn' : 'bad',
      },
      {
        label: 'ShaderMap 产物估算',
        value: `${shaderMapMB} MB`,
        sub: '将写入 DDC 并影响内存与出包体积',
        tone: shaderMapMB <= 8 ? 'good' : shaderMapMB <= 25 ? 'warn' : 'bad',
      },
    ]);
  }, [totalShaders, vfCount, effQuality, switchCombos, compileSec, effBackend, effSwitches, shaderMapMB]);

  const stages = [
    { title: '1. 材质节点图', sub: '1 份 .uasset', col: '#0ea5e9' },
    { title: '2. HLSL 翻译', sub: 'MaterialTemplate.ush', col: '#8b5cf6' },
    { title: '3. 变体乘法展开', sub: `${totalShaders.toLocaleString()} 份`, col: totalShaders > 1500 ? '#ef4444' : '#f59e0b' },
    { title: '4. 并发编译', sub: effBackend === 'uba' ? 'UBA 农场' : effBackend === 'scw16' ? 'SCW ×16' : '单核 ×1', col: '#10b981' },
    { title: '5. ShaderMap', sub: `${shaderMapMB} MB`, col: '#14b8a6' },
  ];

  const factors = [
    { label: 'VertexFactory (网格卡车)', val: `${vfCount} 类`, pct: (vfCount / 8) * 100, col: '#38bdf8' },
    { label: 'Render Passes (渲染工序)', val: `${passesPerVf} 个`, pct: 72, col: '#8b5cf6' },
    { label: 'Quality Tiers (画质档位)', val: `${effQuality} 档`, pct: (effQuality / 3) * 100, col: '#14b8a6' },
    { label: `Static Switch (2^${effSwitches} 指数!)`, val: `${switchCombos} 倍`, pct: Math.min(100, (effSwitches / 6) * 100), col: effSwitches >= 4 ? '#ef4444' : '#f59e0b' },
  ];

  const statusTone = totalShaders <= 320 ? '#10b981' : totalShaders <= 1500 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={isPitfall}
        pitfallLabel="全勾 4 个 Usage Flags + 堆 6 个静态开关：1 个材质裂变成 10,752 个 Shader，右下角转圈到天荒地老！"
        correctLabel="只勾选实际用到的网格 Usage + 克制静态开关（≤2 个）+ SCW/UBA 并发编译，秒级完成！"
        onToggle={setIsPitfall}
      />

      <div
        style={{
          borderRadius: 12,
          border: '1.5px solid var(--border-strong)',
          background: 'var(--bg-canvas)',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          userSelect: 'text',
        }}
      >
        {/* Top 5-Stage Pipeline */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 6 }}>
          {stages.map((st, idx) => (
            <React.Fragment key={st.title}>
              <div
                style={{
                  flex: '1 1 106px',
                  minWidth: 0,
                  background: 'var(--bg-card)',
                  border: `1.5px solid ${st.col}`,
                  borderTopWidth: 4,
                  borderRadius: 8,
                  padding: '8px 9px',
                }}
              >
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.35 }}>
                  {st.title}
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-secondary)',
                    marginTop: 4,
                    wordBreak: 'break-all',
                  }}
                >
                  {st.sub}
                </div>
              </div>
              {idx < stages.length - 1 && (
                <div
                  aria-hidden
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    color: 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: 13,
                    userSelect: 'none',
                  }}
                >
                  →
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Bottom 2-Column Panel */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 10,
          }}
        >
          {/* Left: Node <-> HLSL Code Card */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-strong)',
              borderRadius: 10,
              padding: 11,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
              🔍 消除神秘感：材质节点本质就是 HLSL 代码
            </div>
            <pre
              style={{
                margin: 0,
                padding: '9px 10px',
                borderRadius: 7,
                background: 'var(--bg-code)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                lineHeight: 1.55,
                overflowX: 'auto',
                whiteSpace: 'pre',
              }}
            >
              <span style={{ color: 'var(--text-muted)' }}>{'// 节点: BaseColor × Tint + Lerp\n'}</span>
              <span style={{ color: '#0284c7' }}>{'float3 c = Texture2DSample(Tex, S, UV).rgb;\n'}</span>
              <span style={{ color: '#7c3aed' }}>{'float3 lit = c * Material.VectorExpressions[0];\n'}</span>
              <span style={{ color: '#d97706' }}>{'#if USE_SNOW_SWITCH  // 静态开关→宏裁剪\n'}</span>
              <span style={{ color: '#059669' }}>{'  lit = lerp(lit, float3(0.82, 0.82, 0.82), Mask);\n'}</span>
              <span style={{ color: '#d97706' }}>{'#endif'}</span>
            </pre>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              图形 API 分工：引擎产出 HLSL → DX12 / Vulkan / Metal 标准字节码 → 显卡驱动翻译成硬件机器码交给 GPU 执行。
            </div>
          </div>

          {/* Right: Permutation Explosion Matrix */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-strong)',
              borderRadius: 10,
              padding: 11,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
              💥 为什么 1 个材质球会炸出成百上千个 Shader？
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
              {factors.map((f) => (
                <div key={f.label}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      fontSize: 11,
                      marginBottom: 3,
                    }}
                  >
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{f.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {f.val}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 4,
                      background: 'var(--bg-subtle)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(5, f.pct)}%`,
                        height: '100%',
                        background: f.col,
                        borderRadius: 4,
                        transition: 'width 0.2s ease',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                background: 'var(--bg-subtle)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                fontWeight: 700,
                color: statusTone,
              }}
            >
              Compiling Shaders ({totalShaders.toLocaleString()}) · ≈ {compileSec}s
            </div>
          </div>
        </div>
      </div>

      <div className="stage-controls-grid">
        <StageSlider
          label="Static Switch 静态开关数量 (2^N)"
          value={effSwitches}
          min={0}
          max={6}
          step={1}
          unit=" 个"
          onChange={(v) => {
            setIsPitfall(false);
            setStaticSwitches(v);
          }}
        />
        <StageSlider
          label="目标画质档位 (QualitySwitch 组合)"
          value={effQuality}
          min={1}
          max={3}
          step={1}
          unit=" 档"
          onChange={(v) => {
            setIsPitfall(false);
            setQualityTiers(v);
          }}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <StageToggle
          label="Used with Skeletal Mesh"
          hint="骨骼蒙皮"
          checked={effSkel}
          onChange={(v) => {
            setIsPitfall(false);
            setUsageSkeletal(v);
          }}
        />
        <StageToggle
          label="Used with Instanced Static Meshes"
          hint="ISM/HISM"
          checked={effInst}
          onChange={(v) => {
            setIsPitfall(false);
            setUsageInstanced(v);
          }}
        />
        <StageToggle
          label="Used with Niagara Sprites/Mesh"
          hint="粒子特效"
          checked={effNiag}
          onChange={(v) => {
            setIsPitfall(false);
            setUsageNiagara(v);
          }}
        />
        <StageToggle
          label="Used with Spline Meshes"
          hint="样条变形"
          checked={effSpln}
          onChange={(v) => {
            setIsPitfall(false);
            setUsageSpline(v);
          }}
        />
      </div>

      <StageSegmented<CompileBackend>
        label="编译执行后端"
        value={effBackend}
        options={[
          { value: 'single', label: '① 单核串行（教学对照）' },
          { value: 'scw16', label: '② 本地 ShaderCompileWorker (16核)' },
          { value: 'uba', label: '③ UE 5.8 UBA 分布式编译农场' },
        ]}
        onChange={(v) => {
          setIsPitfall(false);
          setBackend(v);
        }}
      />
    </div>
  );
};

// ============================================================================
// LESSON 11.2 STAGE: 中间表示 (IR) 四阶段代码变形透视镜
// ============================================================================

type IrPlatform = 'dx12' | 'vulkan' | 'metal';
type IrStageTab = 'all' | 'frontend' | 'bytecode' | 'isa';

const Stage11_2_ShaderIR: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [platform, setPlatform] = useState<IrPlatform>('dx12');
  const [optimizeOn, setOptimizeOn] = useState<boolean>(true);
  const [includeDeadBranch, setIncludeDeadBranch] = useState<boolean>(true);
  const [focusStage, setFocusStage] = useState<IrStageTab>('all');

  const kpiRef = useRef(onKpiUpdate);
  kpiRef.current = onKpiUpdate;
  const prevStepRef = useRef(stepIndex);
  const prevResetRef = useRef(resetSignal);

  useEffect(() => {
    if (prevStepRef.current === stepIndex) return;
    prevStepRef.current = stepIndex;
    if (stepIndex === 0) {
      setPlatform('dx12');
      setOptimizeOn(true);
      setFocusStage('all');
    } else if (stepIndex === 1) {
      setPlatform('dx12');
      setOptimizeOn(true);
      setFocusStage('frontend');
    } else if (stepIndex === 2) {
      setPlatform('dx12');
      setOptimizeOn(false);
      setIncludeDeadBranch(true);
      setFocusStage('bytecode');
    } else if (stepIndex === 3) {
      setPlatform('vulkan');
      setOptimizeOn(true);
      setFocusStage('isa');
    } else if (stepIndex === 4) {
      setPlatform('dx12');
      setOptimizeOn(true);
      setFocusStage('all');
    }
  }, [stepIndex]);

  useEffect(() => {
    if (prevResetRef.current === resetSignal) return;
    prevResetRef.current = resetSignal;
    setPlatform('dx12');
    setOptimizeOn(true);
    setIncludeDeadBranch(true);
    setFocusStage('all');
  }, [resetSignal]);

  const irFormat =
    platform === 'dx12'
      ? 'DXIL (LLVM IR)'
      : platform === 'vulkan'
      ? 'SPIR-V (二进制流)'
      : 'Metal AIR (Apple IR)';
  const isaTarget =
    platform === 'dx12'
      ? 'NVIDIA SASS / AMD RDNA ISA'
      : platform === 'vulkan'
      ? 'Adreno / Mali / RDNA ISA'
      : 'Apple Silicon GPU ISA';

  const baseInstr = includeDeadBranch ? 28 : 19;
  const finalInstr = optimizeOn ? 9 : baseInstr;
  const vgprCount = optimizeOn ? 14 : includeDeadBranch ? 32 : 24;
  const savedPct = Math.round(((baseInstr - finalInstr) / baseInstr) * 100);

  useEffect(() => {
    kpiRef.current([
      {
        label: '目标标准字节码 IR',
        value: irFormat,
        sub: '引擎 Cook 打包随游戏分发的跨硬件中间表示',
        tone: 'accent',
      },
      {
        label: '后端 GPU 硬件 ISA',
        value: isaTarget,
        sub: '由玩家本机显卡驱动现场翻译生成',
        tone: 'neutral',
      },
      {
        label: '优化后估算指令数',
        value: `${finalInstr} 条 ISA`,
        sub: optimizeOn
          ? `常量折叠 + 死代码消除省下 ${savedPct}% 指令`
          : 'r.Shaders.Optimize=0：保留全部冗余计算',
        tone: optimizeOn ? 'good' : 'bad',
      },
      {
        label: '寄存器占用 (VGPR)',
        value: `${vgprCount} 个槽位`,
        sub: vgprCount <= 16 ? '轻量高效，高占用率' : '调试未优化模式，草稿纸翻倍',
        tone: vgprCount <= 16 ? 'good' : 'warn',
      },
    ]);
  }, [irFormat, isaTarget, finalInstr, optimizeOn, savedPct, vgprCount]);

  const cols = [
    {
      key: 'frontend' as const,
      title: '① 引擎前端 (Material / HLSL)',
      badge: 'UE 编辑器 · MIR / HLSL',
      accent: '#0ea5e9',
      lines: [
        { t: 'c = 0.5 * 2.0; // 常量表达式', dim: false },
        { t: 'rough = RoughMap.g * c;', dim: false },
        {
          t: includeDeadBranch ? 'unused = sin(UV.x * 9.0);' : '// 无多余死节点',
          dim: includeDeadBranch && optimizeOn,
        },
        { t: 'spec = pow(NdotH, 2.0);', dim: false },
        { t: 'Out.Rough = saturate(rough);', dim: false },
      ],
    },
    {
      key: 'bytecode' as const,
      title: `② 跨硬件字节码 (${platform === 'dx12' ? 'DXIL' : platform === 'vulkan' ? 'SPIR-V' : 'AIR'})`,
      badge: 'DXC 输出 · 写入 DDC 与包体',
      accent: '#8b5cf6',
      lines: optimizeOn
        ? [
            { t: '; 常量折叠: 0.5*2.0 → 1.0', dim: false },
            { t: '; DCE 删掉未连线的 sin()', dim: false },
            { t: '%1 = call dx.op.sample(%tex)', dim: false },
            { t: '%2 = fmul fast %nh, %nh', dim: false },
            { t: '%3 = call dx.op.saturate(%1)', dim: false },
          ]
        : [
            { t: '; 未优化 (Debug 模式)', dim: false },
            { t: '%0 = fmul float 0.5, 2.0', dim: false },
            { t: '%dead = call dx.op.sin(%u9)', dim: false },
            { t: '%1 = fmul %tex_g, %0', dim: false },
            { t: '%2 = call dx.op.pow(%nh, 2.0)', dim: false },
          ],
    },
    {
      key: 'isa' as const,
      title: '③ GPU 硬件机器码 (ISA)',
      badge: '显卡驱动在玩家电脑编译',
      accent: '#10b981',
      lines: optimizeOn
        ? [
            { t: 'SAMPLE     v0, v[2:3], s[0:7]', dim: false },
            { t: 'V_MUL_F32  v1, v4, v4  ; x*x', dim: false },
            { t: 'V_MED3_F32 v0, 0, 1, v0', dim: false },
            { t: '; 仅占 14 VGPR · 9 条指令', dim: false },
            { t: 'EXP_MRT0   v0, v1  ; 写底片', dim: false },
          ]
        : [
            { t: 'V_MUL_F32  v8, 0.5, 2.0', dim: false },
            { t: 'V_SIN_F32  v9, v10 ; 废算!', dim: false },
            { t: 'V_LOG_F32 + V_EXP_F32 (pow)', dim: false },
            { t: '; 占 32 VGPR · 28 条指令!', dim: false },
            { t: 'EXP_MRT0   v0, v1', dim: false },
          ],
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={!optimizeOn}
        pitfallLabel="关闭编译优化 (r.Shaders.Optimize=0)：死节点 sin() 与 0.5×2.0 全被傻算一遍，指令暴涨 3 倍！"
        correctLabel="正常编译优化开启：前端 + DXC 自动完成常量折叠、死代码消除 (DCE) 与乘方化简！"
        onToggle={(p) => setOptimizeOn(!p)}
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
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))',
            gap: 10,
          }}
        >
          {cols.map((col) => {
            const isActive = focusStage === 'all' || focusStage === col.key;
            return (
              <div
                key={col.key}
                onClick={() => setFocusStage(focusStage === col.key ? 'all' : col.key)}
                style={{
                  background: 'var(--bg-card)',
                  border: `1.5px solid ${isActive ? col.accent : 'var(--border-strong)'}`,
                  borderTopWidth: 4,
                  borderRadius: 10,
                  padding: 10,
                  opacity: isActive ? 1 : 0.48,
                  transition: 'opacity 0.18s ease, border-color 0.18s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  minWidth: 0,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {col.title}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 600 }}>
                  {col.badge}
                </div>
                <div
                  style={{
                    background: 'var(--bg-code)',
                    borderRadius: 7,
                    padding: '8px 9px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10.8,
                    lineHeight: 1.65,
                    overflowX: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  {col.lines.map((ln, li) => {
                    const isComment = ln.t.startsWith(';') || ln.t.startsWith('//');
                    return (
                      <code
                        key={li}
                        style={{
                          whiteSpace: 'pre',
                          color: ln.dim
                            ? '#ef4444'
                            : isComment
                            ? '#10b981'
                            : 'var(--text-primary)',
                          textDecoration: ln.dim ? 'line-through' : 'none',
                        }}
                      >
                        {ln.t}
                      </code>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Ownership Strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 8,
            padding: 8,
            borderRadius: 8,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
          }}
        >
          <div
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              background: 'var(--accent-sky)',
              color: 'var(--accent-sky-deep)',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            🏢 开发者电脑 / 构建机完成：①+② 编成标准 IR 写入 DDC 与游戏安装包
          </div>
          <div
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              background: 'var(--accent-sage)',
              color: 'var(--accent-sage-deep)',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            🎮 玩家显卡驱动：③ 译成硬件 ISA（点击上方卡片可聚焦）
          </div>
        </div>
      </div>

      <StageSegmented<IrPlatform>
        label="目标图形 API / 字节码标准"
        value={platform}
        options={[
          { value: 'dx12', label: 'DirectX 12 → DXIL' },
          { value: 'vulkan', label: 'Vulkan → SPIR-V' },
          { value: 'metal', label: 'Apple Metal → AIR' },
        ]}
        onChange={setPlatform}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <StageSegmented<IrStageTab>
          label="聚焦透视阶段"
          value={focusStage}
          options={[
            { value: 'all', label: '全链路对照' },
            { value: 'frontend', label: '① 前端 IR' },
            { value: 'bytecode', label: '② 字节码 IR' },
            { value: 'isa', label: '③ 硬件 ISA' },
          ]}
          onChange={setFocusStage}
        />
        <StageToggle
          label="画布含未连线死节点 sin()"
          hint="体验 DCE 死代码消除"
          checked={includeDeadBranch}
          onChange={setIncludeDeadBranch}
        />
      </div>
    </div>
  );
};

// ============================================================================
// LESSON 11.3 STAGE: DDC 哈希指纹与三级缓存命中演练台
// ============================================================================

type DdcEvent = 'mi_param' | 'master_node' | 'new_teammate' | 'edit_ush' | 'engine_upgrade';

const DDC_EVENTS: Record<
  DdcEvent,
  {
    label: string;
    changed: [boolean, boolean, boolean, boolean]; // [asset, graph, ush, engine]
    hashHex: [string, string, string, string];
    tierNoShared: 'local' | 'compile';
    tierWithShared: 'local' | 'zen' | 'compile';
    affectedShaders: number;
    desc: string;
  }
> = {
  mi_param: {
    label: '调材质实例 (MI) 颜色参数',
    changed: [false, false, false, false],
    hashHex: ['A4F2', '9C10', 'E7B3', '5800'],
    tierNoShared: 'local',
    tierWithShared: 'local',
    affectedShaders: 0,
    desc: 'MI 普通参数不改 Shader 代码，DDC Key 纹丝不动，0ms 直接复用！',
  },
  new_teammate: {
    label: '新同事拉库首次打开工程',
    changed: [false, false, false, false],
    hashHex: ['A4F2', '9C10', 'E7B3', '5800'],
    tierNoShared: 'compile',
    tierWithShared: 'zen',
    affectedShaders: 14800,
    desc: '本机 Local DDC 为空；有 Zen/共享 DDC 时秒中团队缓存，无共享则苦等全编！',
  },
  master_node: {
    label: '给母材质新增一个噪波节点',
    changed: [false, true, false, false],
    hashHex: ['A4F2', '3D8E', 'E7B3', '5800'],
    tierNoShared: 'compile',
    tierWithShared: 'compile',
    affectedShaders: 240,
    desc: '仅该母材质的 GraphHash 变化，重编这 1 个母材质（约 240 变体）并回写共享 DDC。',
  },
  edit_ush: {
    label: '改了一行 Common.ush 引擎头文件',
    changed: [false, false, true, false],
    hashHex: ['A4F2', '9C10', 'FF01', '5800'],
    tierNoShared: 'compile',
    tierWithShared: 'compile',
    affectedShaders: 14800,
    desc: '几乎所有材质都包含 Common.ush！基础头文件哈希一变，全工程缓存瞬间雪崩失效！',
  },
  engine_upgrade: {
    label: '引擎从 UE 5.7 升级到 UE 5.8',
    changed: [false, false, false, true],
    hashHex: ['A4F2', '9C10', 'E7B3', '5801'],
    tierNoShared: 'compile',
    tierWithShared: 'zen',
    affectedShaders: 14800,
    desc: 'Engine Shader Version 变更；若构建机夜间已提前构建写入 Zen/Cloud DDC，美术上班即秒开！',
  },
};

const Stage11_3_DDC: React.FC<LessonStageProps> = ({
  stepIndex,
  onKpiUpdate,
  resetSignal,
}) => {
  const [eventKey, setEventKey] = useState<DdcEvent>('new_teammate');
  const [hasSharedZen, setHasSharedZen] = useState<boolean>(true);

  const kpiRef = useRef(onKpiUpdate);
  kpiRef.current = onKpiUpdate;
  const prevStepRef = useRef(stepIndex);
  const prevResetRef = useRef(resetSignal);

  useEffect(() => {
    if (prevStepRef.current === stepIndex) return;
    prevStepRef.current = stepIndex;
    if (stepIndex === 0) {
      setEventKey('new_teammate');
      setHasSharedZen(false);
    } else if (stepIndex === 1) {
      setEventKey('master_node');
      setHasSharedZen(true);
    } else if (stepIndex === 2) {
      setEventKey('new_teammate');
      setHasSharedZen(true);
    } else if (stepIndex === 3) {
      setEventKey('engine_upgrade');
      setHasSharedZen(true);
    } else if (stepIndex === 4) {
      setEventKey('edit_ush');
      setHasSharedZen(true);
    }
  }, [stepIndex]);

  useEffect(() => {
    if (prevResetRef.current === resetSignal) return;
    prevResetRef.current = resetSignal;
    setEventKey('new_teammate');
    setHasSharedZen(true);
  }, [resetSignal]);

  const ev = DDC_EVENTS[eventKey];
  const hitTier = hasSharedZen ? ev.tierWithShared : ev.tierNoShared;

  const waitLabel =
    ev.affectedShaders === 0
      ? '0 秒（免编译）'
      : hitTier === 'local'
      ? '0.4 秒（本机秒读）'
      : hitTier === 'zen'
      ? '18 秒（Zen 局域网拉取）'
      : ev.affectedShaders > 1000
      ? '42 分钟（本地 SCW 全编！）'
      : '4.5 秒（单母材质重编）';

  const hitRate =
    ev.affectedShaders === 0 || hitTier === 'local'
      ? '100% Local Hit'
      : hitTier === 'zen'
      ? '99.2% Zen Shared Hit'
      : '0% Cache Miss (触发重编)';

  useEffect(() => {
    kpiRef.current([
      {
        label: '缓存命中层级',
        value:
          ev.affectedShaders === 0
            ? '无需查询（直读参数）'
            : hitTier === 'local'
            ? 'L1 本地 Local DDC'
            : hitTier === 'zen'
            ? 'L2 团队 Zen / Shared DDC'
            : 'L3 Cache Miss → 本地 SCW 编译',
        tone: hitTier === 'compile' && ev.affectedShaders > 1000 ? 'bad' : hitTier === 'compile' ? 'warn' : 'good',
      },
      {
        label: '预计等待时间',
        value: waitLabel,
        sub: ev.affectedShaders > 0 ? `涉及约 ${ev.affectedShaders.toLocaleString()} 个 Shader 产物` : '仅更新材质参数缓冲区',
        tone: hitTier === 'compile' && ev.affectedShaders > 1000 ? 'bad' : hitTier === 'compile' ? 'warn' : 'good',
      },
      {
        label: 'DDC 命中率状态',
        value: hitRate,
        sub: hasSharedZen ? '已接入团队 Zen / Cloud DDC' : '仅本地 DDC（单兵作战）',
        tone: hitTier !== 'compile' ? 'good' : 'warn',
      },
      {
        label: '变更哈希段',
        value: ev.changed.some(Boolean)
          ? ['资产', '材质图', '.ush源码', '引擎版本'].filter((_, i) => ev.changed[i]).join(' + ')
          : '全部一致（指纹未变）',
        tone: ev.changed[2] ? 'bad' : ev.changed.some(Boolean) ? 'warn' : 'good',
      },
    ]);
  }, [ev, hitTier, waitLabel, hitRate, hasSharedZen]);

  const segLabels = ['AssetHash (资产)', 'GraphHash (材质连线)', 'USH_Hash (.ush头文件)', 'EngineVer (引擎版本)'];

  const tiers = [
    {
      id: 'local' as const,
      title: 'L1 · 本地 Local DDC',
      metaphor: '家门口鞋柜 (本机 SSD)',
      speed: '~5 ms',
      active: hitTier === 'local',
      passed: hitTier !== 'local',
      enabled: true,
      col: '#10b981',
    },
    {
      id: 'zen' as const,
      title: 'L2 · Zen / 共享 DDC',
      metaphor: '小区丰巢柜 (团队服务器/云)',
      speed: '~45 ms',
      active: hitTier === 'zen',
      passed: hitTier === 'compile',
      enabled: hasSharedZen,
      col: '#0ea5e9',
    },
    {
      id: 'compile' as const,
      title: 'L3 · 本地 SCW 现场编译',
      metaphor: '工厂现做现烤 (CPU 满载)',
      speed: '数秒 ~ 42 分钟',
      active: hitTier === 'compile',
      passed: false,
      enabled: true,
      col: '#ef4444',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PitfallCompareBar
        isPitfall={!hasSharedZen}
        pitfallLabel="未配置团队 Zen / Shared DDC：每位新同事拉库或构建机升级后，各自苦等 40 分钟重编！"
        correctLabel="已启用 UE 5.8 Zen Storage Server / 共享 DDC：一人编译、全组秒中缓存，打包直接复用！"
        onToggle={(p) => setHasSharedZen(!p)}
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
        {/* Top: DDC Key Hash Fingerprint Strip */}
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
            🔑 DDC Key 数字指纹（任意一段哈希变化 = 二维码失效 = 重新查库/重编）
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
              gap: 8,
            }}
          >
            {segLabels.map((lbl, i) => {
              const isDiff = ev.changed[i];
              return (
                <div
                  key={lbl}
                  style={{
                    padding: '7px 9px',
                    borderRadius: 7,
                    background: isDiff ? 'var(--accent-coral)' : 'var(--accent-sage)',
                    border: `1.5px solid ${isDiff ? '#ef4444' : '#10b981'}`,
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)' }}>{lbl}</div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
                      color: isDiff ? 'var(--accent-coral-deep)' : 'var(--accent-sage-deep)',
                      marginTop: 2,
                    }}
                  >
                    0x{ev.hashHex[i]} {isDiff ? '⚡变!' : '✓'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Middle: 3-Tier DDC Lookup Waterfall */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
          }}
        >
          {tiers.map((t) => {
            const badgeText = !t.enabled
              ? '未配置团队共享'
              : t.active
              ? ev.affectedShaders === 0
                ? '✓ 零编译直通'
                : t.id === 'compile'
                ? '🔥 缺失→现场重编并回写'
                : '🎯 命中！直接读取字节码'
              : t.passed
              ? '× Miss → 查下一级'
              : '— 未触达';

            return (
              <div
                key={t.id}
                style={{
                  background: 'var(--bg-card)',
                  border: `${t.active ? 2 : 1}px solid ${t.active ? t.col : 'var(--border-strong)'}`,
                  borderTopWidth: 5,
                  borderTopColor: t.active ? t.col : 'var(--text-muted)',
                  borderRadius: 10,
                  padding: '10px 11px',
                  opacity: t.enabled ? 1 : 0.42,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{t.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{t.metaphor}</div>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  速度：{t.speed}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    color: t.active ? t.col : 'var(--text-muted)',
                  }}
                >
                  {badgeText}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Diagnosis Strip */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            padding: '8px 11px',
            fontSize: 11.5,
            fontWeight: 600,
            color: 'var(--text-primary)',
            lineHeight: 1.5,
          }}
        >
          💡 诊断结论：{ev.desc}
        </div>
      </div>

      <StageSegmented<DdcEvent>
        label="模拟团队日常开发事件"
        value={eventKey}
        options={[
          { value: 'mi_param', label: '调 MI 参数' },
          { value: 'new_teammate', label: '新同事拉库' },
          { value: 'master_node', label: '改母材质节点' },
          { value: 'edit_ush', label: '改 Common.ush' },
          { value: 'engine_upgrade', label: '升级 UE 5.8' },
        ]}
        onChange={setEventKey}
      />
    </div>
  );
};

// ============================================================================
// SCHEMATICS (11.1 ~ 11.3)
// ============================================================================

const SCHEMATIC_11_1: SchematicDiagram = {
  title: 'UE 5.8 材质节点图到 ShaderMap 变体编译全链路',
  caption: '1 份材质资产会经 HLSL 翻译模板按「顶点工厂 × 渲染 Pass × 画质档 × 静态开关」乘法展开，再交由 SCW/UBA 并行编译为 ShaderMap。',
  nodes: [
    {
      id: 'graph',
      title: 'Material Graph (.uasset)',
      subtitle: '美术连好的节点与参数',
      category: 'substrate',
      x: 16,
      y: 42,
      width: 182,
      outputs: [{ id: 'ast', label: '材质表达式树', color: '#a855f7' }],
    },
    {
      id: 'trans',
      title: 'HLSL Translator',
      subtitle: '拼入 MaterialTemplate.ush',
      category: 'math',
      x: 234,
      y: 26,
      width: 192,
      inputs: [{ id: 'in', label: '节点树', color: '#a855f7' }],
      outputs: [{ id: 'hlsl', label: '完整 HLSL 源码', color: '#38bdf8' }],
      note: '可从 Window → HLSL Code 查看',
    },
    {
      id: 'usage',
      title: 'Usage Flags + Static Switch',
      subtitle: 'VF × Pass × Quality × 2^N',
      category: 'param',
      x: 234,
      y: 168,
      width: 192,
      outputs: [{ id: 'perm', label: '宏定义变体矩阵', color: '#f59e0b' }],
      note: '取消未用 Usage 是编译瘦身第一刀',
    },
    {
      id: 'scw',
      title: 'SCW / UE 5.8 UBA',
      subtitle: '本地多核 / 局域网分布式编译',
      category: 'pipeline',
      x: 470,
      y: 76,
      width: 186,
      inputs: [
        { id: 'src', label: 'HLSL 源码', color: '#38bdf8' },
        { id: 'def', label: '变体宏组合', color: '#f59e0b' },
      ],
      outputs: [{ id: 'bin', label: '字节码队列', color: '#10b981' }],
    },
    {
      id: 'map',
      title: 'FMaterialShaderMap',
      subtitle: '按变体索引打包进 DDC',
      category: 'output',
      x: 694,
      y: 86,
      width: 176,
      inputs: [{ id: 'in', label: '全部编译产物', color: '#10b981' }],
    },
  ],
  edges: [
    { fromNode: 'graph', fromPin: 'ast', toNode: 'trans', toPin: 'in', color: '#a855f7' },
    { fromNode: 'trans', fromPin: 'hlsl', toNode: 'scw', toPin: 'src', color: '#38bdf8' },
    { fromNode: 'usage', fromPin: 'perm', toNode: 'scw', toPin: 'def', color: '#f59e0b' },
    { fromNode: 'scw', fromPin: 'bin', toNode: 'map', toPin: 'in', color: '#10b981' },
  ],
};

const SCHEMATIC_11_2: SchematicDiagram = {
  title: '三段式编译架构：从材质前端 IR 到跨平台字节码与 GPU 硬件 ISA',
  caption: '中间表示（IR）让引擎只需维护一套 HLSL/MIR 前端，通过标准字节码对接全宇宙不同厂商显卡，最后由本机驱动落成硬件 ISA。',
  nodes: [
    {
      id: 'fe',
      title: 'UE 前端 (HLSL / Material IR)',
      subtitle: '常量折叠 · 死代码消除 (DCE)',
      category: 'substrate',
      x: 16,
      y: 82,
      width: 196,
      outputs: [{ id: 'ir', label: '优化后 HLSL / MIR', color: '#38bdf8' }],
    },
    {
      id: 'dxc',
      title: 'DXC / 平台编译器',
      subtitle: '编成跨厂商标准字节码 IR',
      category: 'math',
      x: 248,
      y: 74,
      width: 186,
      inputs: [{ id: 'in', label: 'HLSL 源码', color: '#38bdf8' }],
      outputs: [
        { id: 'dxil', label: 'DXIL (DX12)', color: '#a855f7' },
        { id: 'spv', label: 'SPIR-V (Vulkan)', color: '#f59e0b' },
        { id: 'air', label: 'Metal AIR (Apple)', color: '#22c55e' },
      ],
    },
    {
      id: 'drv',
      title: '玩家本机显卡驱动',
      subtitle: '指令调度 + VGPR 寄存器分配',
      category: 'pipeline',
      x: 478,
      y: 74,
      width: 190,
      inputs: [
        { id: 'a', label: 'DXIL', color: '#a855f7' },
        { id: 'b', label: 'SPIR-V', color: '#f59e0b' },
        { id: 'c', label: 'Metal AIR', color: '#22c55e' },
      ],
      outputs: [{ id: 'isa', label: '厂商专属机器码', color: '#10b981' }],
    },
    {
      id: 'gpu',
      title: 'GPU 硬件执行单元',
      subtitle: 'NVIDIA SASS / AMD RDNA / Apple',
      category: 'output',
      x: 706,
      y: 86,
      width: 188,
      inputs: [{ id: 'in', label: '最终硬件 ISA', color: '#10b981' }],
    },
  ],
  edges: [
    { fromNode: 'fe', fromPin: 'ir', toNode: 'dxc', toPin: 'in', color: '#38bdf8' },
    { fromNode: 'dxc', fromPin: 'dxil', toNode: 'drv', toPin: 'a', color: '#a855f7' },
    { fromNode: 'dxc', fromPin: 'spv', toNode: 'drv', toPin: 'b', color: '#f59e0b' },
    { fromNode: 'dxc', fromPin: 'air', toNode: 'drv', toPin: 'c', color: '#22c55e' },
    { fromNode: 'drv', fromPin: 'isa', toNode: 'gpu', toPin: 'in', color: '#10b981' },
  ],
};

const SCHEMATIC_11_3: SchematicDiagram = {
  title: 'UE 5.8 DDC（派生数据缓存）哈希计算与三级命中链路',
  caption: '源资产与依赖头文件共同算出唯一 DDC Key；优先读 Local SSD，其次拉取团队 Zen/Cloud DDC，全部缺失才本地编译并回写。',
  nodes: [
    {
      id: 'src',
      title: '源资产 + .ush/.usf 源码',
      subtitle: '连线拓扑 + 头文件 + 引擎版本',
      category: 'input',
      x: 16,
      y: 74,
      width: 190,
      outputs: [{ id: 'h', label: '内容哈希输入', color: '#38bdf8' }],
    },
    {
      id: 'key',
      title: 'DDC Key 哈希指纹',
      subtitle: '任意改动即触发雪崩变更',
      category: 'param',
      x: 240,
      y: 74,
      width: 176,
      inputs: [{ id: 'in', label: '依赖项', color: '#38bdf8' }],
      outputs: [{ id: 'k', label: '唯一 Key', color: '#f59e0b' }],
    },
    {
      id: 'l1',
      title: 'L1 Local DDC (SSD)',
      subtitle: '本机秒读 (~5ms)',
      category: 'texture',
      x: 454,
      y: 16,
      width: 184,
      inputs: [{ id: 'q', label: '查询 Key', color: '#f59e0b' }],
      outputs: [{ id: 'hit', label: 'Hit 直读字节码', color: '#10b981' }],
    },
    {
      id: 'l2',
      title: 'L2 Zen / Cloud DDC',
      subtitle: '团队共享 (~45ms)',
      category: 'math',
      x: 454,
      y: 112,
      width: 184,
      inputs: [{ id: 'q', label: 'L1 Miss 后查询', color: '#f59e0b' }],
      outputs: [{ id: 'hit', label: 'Hit 拉回本机', color: '#38bdf8' }],
    },
    {
      id: 'l3',
      title: 'L3 SCW 现场编译',
      subtitle: '全缺失→编译并回写 L1/L2',
      category: 'pipeline',
      x: 454,
      y: 208,
      width: 184,
      inputs: [{ id: 'q', label: 'L2 Miss 回源', color: '#ef4444' }],
      outputs: [{ id: 'out', label: '新编译字节码', color: '#f97316' }],
    },
    {
      id: 'cook',
      title: '编辑器渲染 / 出包 Cook',
      subtitle: '打包生成 .ushaderbytecode',
      category: 'output',
      x: 684,
      y: 102,
      width: 186,
      inputs: [
        { id: 'a', label: 'L1 命中', color: '#10b981' },
        { id: 'b', label: 'L2 命中', color: '#38bdf8' },
        { id: 'c', label: 'L3 新产物', color: '#f97316' },
      ],
    },
  ],
  edges: [
    { fromNode: 'src', fromPin: 'h', toNode: 'key', toPin: 'in', color: '#38bdf8' },
    { fromNode: 'key', fromPin: 'k', toNode: 'l1', toPin: 'q', color: '#f59e0b' },
    { fromNode: 'key', fromPin: 'k', toNode: 'l2', toPin: 'q', color: '#f59e0b', dashed: true },
    { fromNode: 'key', fromPin: 'k', toNode: 'l3', toPin: 'q', color: '#ef4444', dashed: true },
    { fromNode: 'l1', fromPin: 'hit', toNode: 'cook', toPin: 'a', color: '#10b981' },
    { fromNode: 'l2', fromPin: 'hit', toNode: 'cook', toPin: 'b', color: '#38bdf8' },
    { fromNode: 'l3', fromPin: 'out', toNode: 'cook', toPin: 'c', color: '#f97316' },
  ],
};

// ============================================================================
// EXPORT LESSONS 11.1 ~ 11.3
// ============================================================================

export const module11CompileIRLessons: LessonDefinition[] = [
  {
    id: 'shader-compile-pipeline-permutations',
    moduleId: '11',
    number: '11.1',
    title: 'Shader 编译全链路与变体爆炸 —— 从材质连线图到 HLSL、顶点工厂与编译农场',
    subtitle: '彻底拆解“改一根线为什么要编几千个 Shader”，先补齐 HLSL、图形 API 与顶点工厂底层常识',
    duration: '12 分钟',
    difficulty: '进阶',
    StageComponent: Stage11_1_ShaderCompile,
    steps: [
      {
        stepNumber: 1,
        shortLabel: '千份编译之谜',
        tag: 'phenomenon',
        title: '我就连了一个普通的金属材质，为什么点 Apply 后右下角突然提示 Compiling Shaders (3,600)？',
        paragraphs: [
          '在 9.3 课里我们知道：修改**母材质**连线会触发重编译，而改**材质实例（MI）**颜色参数几乎是 0 毫秒。但很多人真正做项目时还会冒出一个更大的问号：',
          '“我明明只建了 **1 个** 材质球，哪怕里面没放几个 `Static Switch`，为什么 UE 右下角一转圈就是几百甚至几千个 Shader 在排队？多出来的几千份到底是谁造出来的？”',
        ],
        tryItPrompt:
          '先点击舞台顶部的【看踩坑现象】，看看全勾 Usage Flags 并堆叠 6 个静态开关时，短短 1 个材质球如何瞬间裂变成 10,752 个 Shader！',
      },
      {
        stepNumber: 2,
        shortLabel: '前置全景补课',
        tag: 'background',
        title: '消除黑箱：先看懂 HLSL、图形 API（DX12/Vulkan）、顶点工厂与渲染 Pass 的分工',
        paragraphs: [
          '在深入编译前，先补齐四个零基础最容易卡壳的前置概念：① **HLSL（High-Level Shading Language）** 就是第 1.2 课说的“小学生算术食谱”的真实文字版——你在 UE 画布里连一个 `Multiply` 节点，引擎底层只是自动帮你写了一行 `A * B;`；② **编译（Compile）** 就是把人能看懂的 HLSL 文字翻译成机器能执行的二进制指令；③ **图形 API（DirectX 12 / Vulkan / Metal）与显卡驱动** 是引擎和各家显卡之间的“标准翻译合同”——引擎按标准发指令，各家显卡驱动再落到硬件执行。',
          '那为什么 1 个材质要印成百上千份食谱？因为引擎里存在一套**乘法矩阵**：① **Vertex Factory（顶点工厂 / 送货卡车）**：静态网格、带骨骼蒙皮的角色、Niagara 粒子、HISM 实例化网格送到显卡的顶点数据格式完全不同，每勾选一个 `Usage Flag`，就要为该类卡车单印一套 Shader；② **Render Pass（渲染工序）**：同一材质要分别给 `Depth` 测距、`BasePass` 写底片、`ShadowDepth` 投阴影、`Velocity` 算动态模糊各印一份专属版本；③ 再乘以 **画质档位** 和 **`Static Switch` 的 2ⁿ 分支**，总数就瞬间起飞了！',
        ],
        tryItPrompt:
          '看看画布左下角的 3 行节点 ↔ HLSL 对照，再逐个勾选或取消下方 4 个 `Used with ...` 复选框，观察 VertexFactory 柱条如何联动总编译数。',
        callout: {
          tone: 'tip',
          title: '一句话记住 ShaderMap',
          body: '同一个母材质裂变出来的所有变体（不同顶点工厂 × 不同 Pass × 不同静态分支），最终会被打包收进一张总索引表，UE 源码里叫 `FMaterialShaderMap`。',
        },
      },
      {
        stepNumber: 3,
        shortLabel: '亲手压测裂变',
        tag: 'experiment',
        title: '乘法爆炸实验：看看 Usage Flags、静态开关与编译农场如何左右你的下班时间',
        paragraphs: [
          '现在把注意力放到右侧的**「变体乘法展开」**面板：即使一个材质的单个 Pass 编译只要几十毫秒，一旦勾选了用不上的 `Skeletal Mesh`、`Niagara`、`Spline`，再放任美术在母材质里加 5~6 个 `Static Switch`，总数会呈乘法雪崩式飙升。',
          '同时对比最底部的三种**编译执行后端**：本地单核只能一个个排队慢吞吞地烤；UE 默认会拉起多个 **`ShaderCompileWorker (SCW)`** 后台进程吃满你本机的多核 CPU；而大型团队在 UE 5.8 中会接入 **`UBA（Unreal Build Accelerator）`**，把编译任务瞬间分发给局域网里所有空闲电脑一起算！',
        ],
        tryItPrompt:
          '把 `Static Switch` 从 1 拉到 6，再切换下方编译后端从「单核 → SCW 16核 → UBA 分布式农场」，体会工程架构带来的十倍提速！',
      },
      {
        stepNumber: 4,
        shortLabel: '走进 UE 5.8',
        tag: 'ue5',
        title: '走进 UE 5.8：亲自掀开材质盖子看 HLSL 源码，并学会审计 Usage Flags',
        paragraphs: [
          '在 UE 5.8 材质编辑器顶部菜单点击 **`Window → Shader Code → HLSL Code`**，你就能亲眼看到 `FHLSLMaterialTranslator` 把你连的节点嵌进引擎模板 `MaterialTemplate.ush` 后拼出的真实代码——搜索 `CalcPixelMaterialInputs`，里面清清楚楚写着你的每个节点算式。',
          '在材质左侧 Details 面板搜索 **`Usage`**，你会看到一长串 `Used with Skeletal Mesh / Niagara / Spline / Instanced Static Meshes ...` 复选框。默认勾选了 **`Automatically Set Usage in Editor`**：只要有人手滑把这个静态石头材质拖到角色身上预览了一秒，UE 就会自动替你永久勾上 `Skeletal Mesh`，白白让后续每次修改都多编译一大批骨骼变体！',
        ],
        tryItPrompt:
          '切换右上角「UE5.8 原理图」，理顺 `Material Graph → HLSL Translator → 变体矩阵 → SCW/UBA → ShaderMap` 五大站点的流向。',
        callout: {
          tone: 'ue58',
          title: 'UE 5.8 编译提速实用命令',
          body: '在控制台输入 `stat shadercompiling` 可实时查看排队任务数、活跃 SCW 进程数与单任务耗时；大型母材质修改前，记得顺手取消 `Usage` 里早已不用的勾选项！',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '防坑黄金口诀',
        tag: 'pitfall',
        title: '实战避坑口诀：小改用实例、Usage 勤打扫、静态开关严卡红线！',
        paragraphs: [
          '总结本课三条工程保命线：① **定期清理母材质 `Usage Flags`**——静态建筑绝不留 `Skeletal Mesh` 和 `Niagara` 勾选；② **控制 `Static Switch` 组合数**——尽量合并互斥选项或用材质层/独立母材质拆分，别造“万能宇宙超级母材质”；③ **善用 `Material Quality Level` 与 `Platform Stats`**——在编辑器预览时可先只编当前常用画质，提交前再核对全平台编译总数。',
          '看到这里你可能会接着追问：“`SCW` 把 HLSL 编译出来的那个二进制产物，已经是显卡直接能跑的最终机器码了吗？”——答案竟然是 **NO**！下一课我们就揭开现代渲染架构最核心的缓冲层：**中间表示（IR）**！',
        ],
        tryItPrompt:
          '点回【切正确配置】，记下把 10,752 个变体压回百级规模的两个最猛抓手：精简 Usage Flags + 克制 Static Switch。',
      },
    ],
    takeaways: [
      '材质连线图底层会被 `FHLSLMaterialTranslator` 翻译并拼入 `MaterialTemplate.ush` 生成完整 HLSL 源码',
      '1 个材质的编译总量 ≈ `VertexFactory (Usage Flags) × Render Passes × Quality × 2^StaticSwitch`，呈乘法膨胀',
      'UE 5.8 本地靠 `ShaderCompileWorker (SCW)` 多核并行，团队级靠 `UBA` 分布式编译农场提速',
      '定期审查并取消未使用的 `Material Usage Flags`，是降低编译时间与 ShaderMap 体积最立竿见影的手段',
    ],
    schematic: SCHEMATIC_11_1,
  },
  {
    id: 'shader-ir-hlsl-dxil-spirv-isa',
    moduleId: '11',
    number: '11.2',
    title: '中间表示（IR）全解码 —— 为什么不一步编成机器码？从 Material IR / HLSL 到 DXIL / SPIR-V 与 GPU ISA',
    subtitle: '用三段式翻译接力讲透编译器前端优化（常量折叠/死代码消除）、标准字节码 IR 与显卡原生机器码',
    duration: '12 分钟',
    difficulty: '进阶',
    StageComponent: Stage11_2_ShaderIR,
    steps: [
      {
        stepNumber: 1,
        shortLabel: '显卡巴别塔',
        tag: 'phenomenon',
        title: '全世界有几十代 NVIDIA、AMD、Intel、Apple 显卡，游戏打包时难道要分别编译几十套机器码？',
        paragraphs: [
          '仔细一想就会发现一个恐怖的工程难题：NVIDIA RTX 50 系、AMD RDNA 4、Intel Arc、Apple Silicon、甚至高通和联发科手机 GPU，它们芯片内部的电路设计和指令集（专业叫 **ISA 机器码**）完全不同，甚至同一家厂商隔两代显卡都不兼容！',
          '如果 UE 打包时直接把材质编译成具体某张显卡的最终机器码，一款游戏就得自带几十套互不兼容的二进制包，且明年新显卡一发布老游戏立刻罢工。现代图形工业靠什么优雅化解了这座“巴别塔”？答案就是 **中间表示（Intermediate Representation，简称 IR）**！',
        ],
        tryItPrompt:
          '先观察舞台最下方那条蓝/绿分界条：弄清楚哪两步是在开发者电脑上提前完成的，哪一步是在玩家电脑里由显卡驱动完成的！',
      },
      {
        stepNumber: 2,
        shortLabel: '三段翻译接力',
        tag: 'background',
        title: '前置通俗课：什么是编译器与 IR？像“世界语半成品图纸”一样的三段接力',
        paragraphs: [
          '可以把 **IR（中间表示）** 想象成联合国通用的“**标准化半成品工程蓝图**”——它不像人类语言那么啰嗦，也不绑定某一台特定工厂的机床，但极其规整、机器一扫就懂。UE 5.8 的 Shader 编译正是经典的 **三段式接力**：',
          '① **引擎前端 IR**：UE 把材质节点翻译成 HLSL（同时 UE 5.x 也在演进更现代的 **Material IR / MIR** 前端中间表示，便于在引擎侧直接做跨节点分析与裁剪）；② **跨硬件标准字节码 IR**：微软开源编译器 **DXC** 把 HLSL 编成图形 API 规定的标准字节码——DirectX 12 用 **DXIL**（基于著名的 LLVM IR），Vulkan 用 **SPIR-V**，Apple 生态用 **Metal AIR**。这就是写入 DDC 和塞进游戏安装包的真正产物；③ **驱动后端编译**：玩家运行游戏时，本机显卡驱动接过这份 DXIL / SPIR-V，瞬间翻译成当前这块显卡专属的硬件 **ISA 机器码**（如 NVIDIA SASS、AMD RDNA ISA）并分配硬件寄存器！',
        ],
        tryItPrompt:
          '点击舞台下方的【DirectX 12 → DXIL / Vulkan → SPIR-V / Apple Metal → AIR】三个按钮，对比三大生态各自的标准字节码格式与最终硬件 ISA。',
        callout: {
          tone: 'tip',
          title: '编译器偷偷帮你做的三大免费瘦身',
          body: '在前端与 DXC 生成字节码 IR 期间，优化器会自动做：① **常量折叠（Constant Folding）**：把 `0.5 * 2.0` 直接算死成 `1.0`；② **死代码消除（DCE）**：把画布上连了一堆但最终没接到主节点的运算整块删光；③ **公共子表达式消除（CSE）**：两个地方都算了同一个 `dot(N, L)`，只算一次复用结果！',
        },
      },
      {
        stepNumber: 3,
        shortLabel: '透视代码变形',
        tag: 'experiment',
        title: '亲手开关优化器：看同一段材质如何从 28 条废指令被榨干到 9 条精华 ISA！',
        paragraphs: [
          '舞台中间三栏完整展示了同一段小材质在三个阶段的形态：假设画布里不小心留了一颗没接输出的 `sin(UV * 9)` 死节点，写了一个常量乘法 `0.5 * 2.0`，还用 `pow(NdotH, 2.0)` 算平方。',
          '当你开启正常编译优化时，注意看第二栏字节码与第三栏 ISA：没连线的 `sin()` 被直接划红线删除（DCE），`0.5 * 2.0` 消失无踪（常量折叠），连昂贵的 `pow(x, 2)` 都被智能替换成了单条乘法 `x * x`！反之，如果误把调试开关 `r.Shaders.Optimize=0` 留着，所有废算都会原封不动冲进 GPU，指令数和寄存器（VGPR）瞬间翻倍！',
        ],
        tryItPrompt:
          '来回切换顶部【看踩坑现象 (Optimize=0) ↔ 切正确配置 (优化开启)】，并开关「画布含未连线死节点 sin()」，观察三栏代码与 KPI 指令数变化！',
      },
      {
        stepNumber: 4,
        shortLabel: '走进 UE 5.8',
        tag: 'ue5',
        title: '走进 UE 5.8：DXC 后端、Material IR (MIR) 演进与 Platform Stats 读数来源',
        paragraphs: [
          'UE 5.8 在 Windows（SM6）默认通过 **DXC（DirectX Shader Compiler）** 把 HLSL 编译为 **DXIL**；在 Android / Linux / Switch 等 Vulkan 平台同样用 DXC（开启 `-spirv`）产出 **SPIR-V**；而在 macOS / iOS 则经由 Metal 工具链生成 **Metal AIR**。正因为有了这一层统一字节码，同一套 UE 材质才能一键打包横跨 PC、主机与手机。',
          '另外，你在 9.4 课看过的 **`Platform Stats`** 面板里显示的“Base pass shader: 148 instructions”，其实就是引擎统计完这一层字节码 IR / 平台离线编译器估算出的指令规模（注意：不同显卡驱动后端做完 ISA 调度后，真实硬件指令数会有一定差异，最终帧耗以真实 GPU 实测为准）。',
        ],
        tryItPrompt:
          '切换右上角「UE5.8 原理图」，看清 DXC 如何作为枢纽把一套 HLSL 分叉输出为 DXIL / SPIR-V / Metal AIR 三大平台字节码。',
      },
      {
        stepNumber: 5,
        shortLabel: '防坑黄金口诀',
        tag: 'pitfall',
        title: '实战避坑口诀：别替编译器操心常量，但千万别用黑盒写法蒙住它的眼！',
        paragraphs: [
          '懂了 IR 和优化器，就能避开两类极端误区：① **不必过度焦虑静态常量连线**——比如为了可读性把两个 `Constant` 乘在一起，或者画布角落留着断开未接的临时测试节点，编译器前端早就把它们折叠/剪干净了，不会浪费运行期一丁点 GPU 算力；② **但要警惕会“蒙住优化器双眼”的写法**：滥用外部参数包裹本可静态确定的值、在 `Custom` HLSL 节点里塞黑盒循环，或测试完调试后忘了把 `r.Shaders.Optimize=0` 改回 `1`，都会让 IR 瘦身大打折扣。',
          '既然编译出 DXIL / SPIR-V 这么耗时，每次打开工程难道都要从头再编一遍吗？下一课，认识让千人团队“秒开工程”的幕后大管家：**DDC（派生数据缓存）**！',
        ],
        tryItPrompt:
          '点击「聚焦透视阶段」逐个复盘 ①前端 IR → ②字节码 IR → ③硬件 ISA 的职责边界，再进入 11.3 课！',
      },
    ],
    takeaways: [
      'IR（中间表示）是解决“多平台显卡指令集不兼容”的关键缓冲层，分为前端 IR（HLSL/MIR）与 API 标准字节码 IR（DXIL/SPIR-V/Metal AIR）',
      '引擎在开发与 Cook 期只编到标准字节码 IR，真正贴合芯片电路的硬件 ISA（SASS / RDNA ISA）由玩家显卡驱动在本地完成翻译',
      '编译器在 IR 阶段会自动执行常量折叠、死代码消除（DCE）与公共子表达式消除（CSE），但绝不能带着 `r.Shaders.Optimize=0` 上线',
      '同一套 HLSL 通过 DXC 等工具链分发多平台，既保证了跨端兼容，也为后面的 DDC 缓存和 PSO 机制打下基础',
    ],
    schematic: SCHEMATIC_11_2,
  },
  {
    id: 'ddc-derived-data-cache',
    moduleId: '11',
    number: '11.3',
    title: 'DDC（派生数据缓存）机制 —— 哈希指纹、三级缓存与告别“拉库重编两小时”的秘密',
    subtitle: '先从零讲懂 Hash 数字指纹与缓存命中原理，再彻底掌握 UE 5.8 Local / Zen Storage / Cloud DDC 团队架构',
    duration: '11 分钟',
    difficulty: '进阶',
    StageComponent: Stage11_3_DDC,
    steps: [
      {
        stepNumber: 1,
        shortLabel: '拉库两小时之痛',
        tag: 'phenomenon',
        title: '为什么新同事拉完工程要编 15,000 个 Shader 苦等一小时，而老员工重启编辑器只要 5 秒？',
        paragraphs: [
          '每个进过大中型 UE 项目组的新人几乎都经历过这场“入职仪式”：早上满怀激动从 Git / Perforce 拉下最新工程，双击打开 `.uproject`，进度条卡在 `45%` 或左下角弹出 **`Compiling Shaders (14,800)`**，风扇狂转一小时，中午吃完饭回来还没进场景！',
          '可隔壁老员工昨天明明刚打开过一模一样的工程，今天双击只花了 5 秒钟就丝滑进了主关卡。更离谱的是，某天渲染程序只改了一行引擎底层代码，全组 50 个人电脑同时开始狂转重新编译！背后操控这一切的，正是 UE 的 **DDC（Derived Data Cache，派生数据缓存）**。',
        ],
        tryItPrompt:
          '先看舞台顶部的「故障状态」：模拟没有团队共享 DDC 时，新同事拉库命中 L3 本地 SCW 全编的惨烈等待！',
      },
      {
        stepNumber: 2,
        shortLabel: '哈希与缓存前置课',
        tag: 'background',
        title: '前置通俗课：什么是“源资产 vs 派生数据”、哈希指纹（Hash）与三级取件驿站？',
        paragraphs: [
          '先补齐两个超级实用的计算机基础概念：① **源资产 vs 派生数据**：美术画的 PNG 原图和材质连线图（`.uasset`）叫**源资产**，它们提交进版本库（Git/P4）；而根据目标平台算出来的 DXIL/SPIR-V 字节码、BC1~BC7 压缩贴图、Nanite 簇数据，全都可以从源资产重新推导出来，所以叫 **派生数据（Derived Data）**，它们体积庞大且因平台而异，**绝不提交进版本库**，而是存进 **DDC**！',
          '② **哈希指纹（Hash）与缓存命中（Hit/Miss）**：UE 会把“资产内容 + 材质连线 + 依赖的 `.ush` 引擎源码 + 引擎版本号”一起放进哈希算法榨出一串唯一指纹叫 **DDC Key**（就像食品出厂防伪码，哪怕只改一个逗号，指纹都会彻底面目全非！）。打开材质时，UE 拿着这张 Key 依次去三级驿站取货：**L1 本机 Local DDC（家门口鞋柜，5ms 秒取）→ L2 团队 Zen / 共享网络 DDC（小区丰巢柜，45ms 拉取）→ L3 全部 Miss 缺失，只能叫 SCW 工厂现做现烤（耗时数秒到数十分钟），做完后顺手回写放进 L1 和 L2 给下一个人复用！**',
        ],
        tryItPrompt:
          '在舞台下方依次点击「调 MI 参数」「改母材质节点」「改 Common.ush」「升级 UE 5.8」，观察顶部 4 段哈希指纹哪一段变红，以及底部三级缓存的流转变化！',
        callout: {
          tone: 'tip',
          title: '为什么改一行 Common.ush 会引发“全员核爆”？',
          body: '因为几乎所有材质翻译出的 HLSL 都 `#include` 了基础头文件 `Common.ush`！它的文件哈希就嵌在全工程 1.5 万个材质的 DDC Key 里——它一动，全工程 Key 集体变脸，L1/L2 全员 Cache Miss！',
        },
      },
      {
        stepNumber: 3,
        shortLabel: '演练三级缓存',
        tag: 'experiment',
        title: '亲手切换“单兵作战 vs 团队 Zen 共享”：体验一人编译、全组秒开的威力',
        paragraphs: [
          '现在把模拟事件切到 **「新同事拉库首次打开工程」** 或 **「引擎从 UE 5.7 升级到 UE 5.8」**，然后点击顶部的 `PitfallCompareBar` 来回切换是否启用团队共享 DDC：',
          '没有共享 DDC 时，50 个人各自把相同的 14,800 个 Shader 重复编译 50 遍，浪费几十小时工时和电费；一旦架起团队共享 DDC，只需要 CI 构建机在半夜自动跑一遍 `DerivedDataCache` 预热把产物塞进 L2 共享柜，第二天早上 50 个美术策划一打开编辑器，L1 缺失后 18 秒就从局域网 L2 把现成字节码拉回本机，直接开工！',
        ],
        tryItPrompt:
          '重点对比「新同事拉库」事件下开关共享 DDC 的耗时差距（42 分钟 vs 18 秒），再点一下「改 Common.ush」体会基础头文件变动的雪崩效应。',
      },
      {
        stepNumber: 4,
        shortLabel: '走进 UE 5.8',
        tag: 'ue5',
        title: '走进 UE 5.8：Zen Storage Server、Unreal Cloud DDC 与打包时的 Cooked Shader Library',
        paragraphs: [
          '在 UE 5.8 中，官方已全面主推 **Zen Storage Server（`ZenServer`）** 替代早期老旧的散文件共享文件夹（传统 SMB 共享盘在数万小文件并发读写时极易卡死），搭配 **Unreal Cloud DDC** 还能让远程办公同事通过 HTTP 高速拉取缓存。你可以在编辑器右下角点击 **`Derived Data`** 状态图标，随时查看当前的 **Total Cache Hit Rate（缓存命中率）**、Local 与 Remote 吞吐状态。',
          '那游戏真正发给玩家时，玩家电脑上并没有 DDC 啊？别忘了打包流程中的 **Cook（烘焙）**：UE 在 Cook 阶段会直接从 DDC 取出所有目标平台编好的 DXIL / SPIR-V 字节码，去重压缩后打成整块的 **Shader Library（`.ushaderbytecode` / IoStore `.ucas`）** 随安装包一起发布！',
        ],
        tryItPrompt:
          '切换右上角「UE5.8 原理图」，核对从源资产算 Hash 到三级 DDC 查询、最终流入编辑器与 Cook 出包 `.ushaderbytecode` 的完整闭环。',
        callout: {
          tone: 'ue58',
          title: '编辑器内实时查 DDC 健康度',
          body: '留意 UE 5.8 编辑器右下角状态栏的 **Derived Data** 菜单：正常团队环境下打开已有工程，命中率应长期维持在 `95%+`；若暴跌且一直在编译，先检查 ZenServer 连接或是否有人改了全局 `.ush` / 渲染设置！',
        },
      },
      {
        stepNumber: 5,
        shortLabel: '防坑黄金口诀',
        tag: 'pitfall',
        title: '实战避坑口诀：源资产入库、派生进缓存，动引擎全局配置前先喊构建机预热！',
        paragraphs: [
          '收好四条团队协作铁律：① **绝不把 `Saved/`、`Intermediate/`、`DerivedDataCache/` 提交到 Git/P4**（它们全是派生缓存）；② **别把 Local DDC 放在剩余空间告急的机械硬盘上**，建议独立高速 NVMe SSD 并留足空间防止旧缓存被频繁挤出淘汰；③ **修改 `DefaultEngine.ini` 里的全局渲染宏（如开启/关闭某全局光照特性）或引擎 `.ush` 文件前务必团队同步**，最好由夜间 CI 先跑通预热进共享 DDC；④ **善用材质实例 MI**——正如本课实验所示，调 MI 参数压根不改 DDC Key！',
          '到这里，我们好像已经把“从连线到出包字节码”全链路走通了……等等！如果打包时已经把全部 DXIL / SPIR-V 塞进 `.ushaderbytecode` 了，为什么很多 3A 大作发售首日，玩家第一次看到爆炸特效还是会画面定格 0.2 秒？下一课，直击现代 DX12/Vulkan 时代最臭名昭著的元凶：**PSO（管线状态对象）**！',
        ],
        tryItPrompt:
          '点回「调 MI 参数」对比「改母材质节点」与「改 Common.ush」三种事件的影响面，牢记 DDC Key 的雪崩边界！',
      },
    ],
    takeaways: [
      '源资产（`.uasset` / 原图）进版本库，编译好的 Shader 字节码与压缩纹理属于派生数据，存进 DDC 复用',
      'DDC Key 由资产内容、材质拓扑、依赖 `.ush/.usf` 与引擎版本共同哈希算出，任何一段变化都会触发 Cache Miss',
      'UE 5.8 推荐通过 Local SSD + **Zen Storage Server / Unreal Cloud DDC** 搭建三级缓存，并由夜间 CI 预热',
      '游戏打包（Cook）阶段会从 DDC 直接收集字节码打包进 `.ushaderbytecode` / `.ucas` 随游戏发布',
    ],
    schematic: SCHEMATIC_11_3,
  },
];
