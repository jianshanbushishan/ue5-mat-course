import React, { useEffect, useState } from 'react';
import { StageSegmented, StageSlider, StageToggle } from '../components/ui/StageWidgets';
import type { LessonStageProps, ModuleDefinition } from '../types/course';

const maps = [
  { name: 'Panel_BaseColor', label: '颜色', settings: 'Default · sRGB 开 · Color' },
  { name: 'Panel_Normal', label: '法线', settings: 'Normalmap · sRGB 关 · Normal' },
  { name: 'Panel_ORM', label: 'ORM', settings: 'Masks · sRGB 关 · Masks' },
] as const;

const regions = ['左上 · 漆面', '右上 · 裸金属', '左下 · 漆面', '右下 · 裸金属'];

function PanelPractice({ onKpiUpdate, resetSignal }: LessonStageProps) {
  const [map, setMap] = useState('Panel_ORM');
  const [region, setRegion] = useState(0);
  const [scale, setScale] = useState(1);
  useEffect(() => { setMap('Panel_ORM'); setRegion(0); setScale(1); }, [resetSignal]);
  const source = maps.find(item => item.name === map)!;
  const rough = (region < 2 ? 64 : 192) / 255;
  const metal = region % 2;
  const px = metal ? 96 : 32, py = region < 2 ? 8 : 88;
  const orm = [255, region < 2 ? 64 : 192, metal * 255];
  const channels = map === 'Panel_ORM' ? orm : map === 'Panel_Normal'
    ? [128, region < 2 ? 198 : 57, 234] : metal ? [198, 199, 200] : [153, 65, 37];
  useEffect(() => {
    onKpiUpdate([
      { label: '源图 AO / Metallic', value: `1 / ${metal}` },
      { label: '实例 Roughness', value: Math.min(1, rough * scale).toFixed(3) },
    ]);
  }, [metal, rough, scale, onKpiUpdate]);

  return <div className="practice-stage">
    <div className="practice-textures">{maps.map(item => <a key={item.name} download={item.name + '.png'} href={`./practice/${item.name}.png`}>
      <strong>下载 {item.label} PNG</strong><small>{item.name} · 128×128</small>
    </a>)}</div>
    <StageSegmented label="检查源文件" value={map} onChange={setMap} options={maps.map(item => ({ value: item.name, label: item.label }))} />
    <div className="practice-inspector">
      <div className="practice-map">
        <img src={`./practice/${source.name}.png`} alt={source.name + ' 原始纹素'} />
        {regions.map((label, i) => <button type="button" aria-label={label} aria-pressed={i === region} key={label} onClick={() => setRegion(i)} />)}
      </div>
      <div><strong>{source.name}</strong><p>{source.settings}</p><p>点选象限，以左上角为原点核对源纹素。</p>
        <p>{regions[region]}<br/>像素 ({px}, {py}) 的 RGB = ({channels.join(', ')})<br/>同位置 ORM = ({orm.join(', ')})</p>
        <p>线性粗糙度 {rough.toFixed(3)} × {scale.toFixed(2)}，限幅后为 <b>{Math.min(1, rough * scale).toFixed(3)}</b>。</p>
      </div>
    </div>
    <StageSlider label="材质实例参数 RoughnessScale" value={scale} min={0.25} max={2} step={0.25} onChange={setScale} />
    <p>数值取自压缩前的源图；在 UE 中抽查时选象限内部，避开过滤边界。</p>
  </div>;
}

function PerfAcceptanceStage({ onKpiUpdate, resetSignal }: LessonStageProps) {
  const [count, setCount] = useState(200);
  const [arch, setArch] = useState<'actors_mid' | 'hism_cpd' | 'nanite_hism'>('actors_mid');
  const [lodEnabled, setLodEnabled] = useState(false);
  const [qualityLevel, setQualityLevel] = useState<'epic' | 'medium' | 'low'>('epic');

  useEffect(() => {
    setCount(200);
    setArch('actors_mid');
    setLodEnabled(false);
    setQualityLevel('epic');
  }, [resetSignal]);

  const baseDrawCalls = arch === 'actors_mid' ? count * 2 : 1;
  const shadowDrawCalls = arch === 'actors_mid' ? Math.round(count * 1.4) : 1;
  const totalDrawCalls = baseDrawCalls + shadowDrawCalls;
  const drawMs = +(arch === 'actors_mid' ? 5.8 + totalDrawCalls * 0.018 : 4.2 + (count / 200) * 0.4).toFixed(1);
  const qualityFactor = qualityLevel === 'epic' ? 1.0 : qualityLevel === 'medium' ? 0.78 : 0.56;
  const lodFactor = lodEnabled || arch === 'nanite_hism' ? 0.62 : 1.0;
  const gpuMs = +(4.5 + (count / 200) * 11.2 * lodFactor * qualityFactor).toFixed(1);
  const frameMs = Math.max(drawMs, gpuMs);
  const fps = Math.max(1, Math.round(1000 / frameMs));

  useEffect(() => {
    onKpiUpdate([
      {
        label: '模拟 Frame / FPS',
        value: `${frameMs.toFixed(1)} ms · ${fps} FPS`,
        tone: frameMs <= 16.67 ? 'good' : 'bad',
      },
      {
        label: 'Mesh Draw Calls (阵列)',
        value: `${totalDrawCalls} 次`,
        tone: totalDrawCalls <= 10 ? 'good' : 'bad',
      },
      {
        label: 'Draw / GPU 毫秒',
        value: `${drawMs} / ${gpuMs} ms`,
        tone: frameMs <= 16.67 ? 'good' : 'warn',
      },
      {
        label: '当前画质与 LOD',
        value: `${qualityLevel.toUpperCase()} · ${lodEnabled || arch === 'nanite_hism' ? '已减负' : '未配 LOD'}`,
        tone: lodEnabled || arch === 'nanite_hism' ? 'good' : 'warn',
      },
    ]);
  }, [frameMs, fps, totalDrawCalls, drawMs, gpuMs, qualityLevel, lodEnabled, arch, onKpiUpdate]);

  return (
    <div className="practice-stage">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 10,
          padding: 12,
          borderRadius: 10,
          background: 'var(--bg-card)',
          border: '1.5px solid var(--border-strong)',
        }}
      >
        <div>
          <strong style={{ fontSize: 12.5 }}>📊 模拟 UE 5.8 验收读数（对照实测）</strong>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.8, marginTop: 6 }}>
            <div>stat unit · Frame: <b style={{ color: frameMs <= 16.67 ? 'var(--accent-sage-deep)' : 'var(--accent-coral-deep)' }}>{frameMs.toFixed(1)} ms</b> ({fps} FPS)</div>
            <div>stat unit · Draw : <b>{drawMs.toFixed(1)} ms</b></div>
            <div>stat unit · GPU  : <b>{gpuMs.toFixed(1)} ms</b></div>
            <div>Mesh draw calls  : <b>{totalDrawCalls}</b></div>
          </div>
        </div>
        <div>
          <strong style={{ fontSize: 12.5 }}>✅ 验收达标核对项</strong>
          <div style={{ fontSize: 12, lineHeight: 1.75, marginTop: 6, color: 'var(--text-secondary)' }}>
            <div>{arch !== 'actors_mid' ? '✅' : '⬜'} 阵列 Draw Call 压缩至单批/单 Shading Bin</div>
            <div>{arch !== 'actors_mid' ? '✅' : '⬜'} PerInstanceRandom + CustomData/CPD 实现零破批差异</div>
            <div>{lodEnabled || arch === 'nanite_hism' ? '✅' : '⬜'} 远景 Quad Overdraw 通过 LOD / Nanite 收敛</div>
            <div>{frameMs <= 16.67 ? '✅' : '⬜'} 固定机位 Frame ≤ 16.67 ms (60 FPS)</div>
          </div>
        </div>
      </div>

      <StageSegmented<'actors_mid' | 'hism_cpd' | 'nanite_hism'>
        label="阵列提交架构"
        value={arch}
        options={[
          { value: 'actors_mid', label: '① 独立 Actor + MID (改造前)' },
          { value: 'hism_cpd', label: '② HISM + PerInstanceRandom/CustomData' },
          { value: 'nanite_hism', label: '③ Nanite + HISM (UE 5.8)' },
        ]}
        onChange={setArch}
      />
      <StageSlider label="检验板阵列数量" value={count} min={50} max={400} step={25} unit=" 块" onChange={setCount} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
        <StageToggle
          label="配置多级 LOD0~LOD2（远景简材去 WPO）"
          checked={lodEnabled}
          onChange={setLodEnabled}
        />
        <StageSegmented<'epic' | 'medium' | 'low'>
          label="QualitySwitch 画质档"
          value={qualityLevel}
          options={[
            { value: 'epic', label: 'Epic' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
          ]}
          onChange={setQualityLevel}
        />
      </div>
      <p>提示：网页数值为教学趋势模拟；实际验收请在 UE 5.8 中按固定书签机位、关闭帧率锁限后记录真实 `stat unit`、`stat scenerendering` 与 `ProfileGPU`。</p>
    </div>
  );
}

function ShaderAuditAcceptanceStage({ onKpiUpdate, resetSignal }: LessonStageProps) {
  const [usageCleaned, setUsageCleaned] = useState(false);
  const [psoPrecacheOn, setPsoPrecacheOn] = useState(false);
  const [mathFixed, setMathFixed] = useState(false);
  const [debugFlagsRestored, setDebugFlagsRestored] = useState(false);

  useEffect(() => {
    setUsageCleaned(false);
    setPsoPrecacheOn(false);
    setMathFixed(false);
    setDebugFlagsRestored(false);
  }, [resetSignal]);

  const shaderCount = usageCleaned ? 168 : 1120;
  const psoPeakMs = psoPrecacheOn ? 15.9 : 138.4;
  const basePassInstr = !debugFlagsRestored ? 264 : mathFixed ? 112 : 148;
  const ddcHitPct = usageCleaned ? 98.6 : 94.2;

  useEffect(() => {
    onKpiUpdate([
      {
        label: 'M_Panel 变体编译数',
        value: `${shaderCount} 个`,
        tone: shaderCount <= 250 ? 'good' : 'bad',
      },
      {
        label: '首见 PSO 帧耗时峰值',
        value: `${psoPeakMs} ms`,
        tone: psoPeakMs <= 16.67 ? 'good' : 'bad',
      },
      {
        label: 'BasePass 估算指令',
        value: `${basePassInstr} 条`,
        tone: debugFlagsRestored && mathFixed ? 'good' : !debugFlagsRestored ? 'bad' : 'warn',
      },
      {
        label: 'DDC 缓存命中率',
        value: `${ddcHitPct}%`,
        tone: 'good',
      },
    ]);
  }, [shaderCount, psoPeakMs, basePassInstr, ddcHitPct, debugFlagsRestored, mathFixed, onKpiUpdate]);

  return (
    <div className="practice-stage">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 10,
          padding: 12,
          borderRadius: 10,
          background: 'var(--bg-card)',
          border: '1.5px solid var(--border-strong)',
        }}
      >
        <div>
          <strong style={{ fontSize: 12.5 }}>🔬 模拟 UE 5.8 编译 / PSO / RenderDoc 验收读数</strong>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.8, marginTop: 6 }}>
            <div>Platform Stats · Shaders: <b style={{ color: usageCleaned ? 'var(--accent-sage-deep)' : 'var(--accent-coral-deep)' }}>{shaderCount}</b></div>
            <div>Platform Stats · BasePass: <b>{basePassInstr} instr</b></div>
            <div>Insights · PSO Peak     : <b style={{ color: psoPrecacheOn ? 'var(--accent-sage-deep)' : 'var(--accent-coral-deep)' }}>{psoPeakMs} ms</b></div>
            <div>RenderDoc · NaN Check   : <b style={{ color: mathFixed ? 'var(--accent-sage-deep)' : 'var(--accent-coral-deep)' }}>{mathFixed ? '0 NaN (Clean)' : 'NaN 风险 / pow 未简'}</b></div>
          </div>
        </div>
        <div>
          <strong style={{ fontSize: 12.5 }}>✅ 工程上线四关核对项</strong>
          <div style={{ fontSize: 12, lineHeight: 1.75, marginTop: 6, color: 'var(--text-secondary)' }}>
            <div>{usageCleaned ? '✅' : '⬜'} 已审计并清理 M_Panel 冗余 Usage Flags</div>
            <div>{mathFixed ? '✅' : '⬜'} RenderDoc 验收无 NaN，且 pow/标量已瘦身</div>
            <div>{psoPrecacheOn ? '✅' : '⬜'} 开启 r.PSOPrecaching=1 并用 Insights 验过无尖峰</div>
            <div>{debugFlagsRestored ? '✅' : '⬜'} 排错结束已还原 Optimize=1 并关闭调试符号导出</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <StageToggle
          label="① 清理冗余 Material Usage Flags（取消未用骨骼/粒子勾选）"
          checked={usageCleaned}
          onChange={setUsageCleaned}
        />
        <StageToggle
          label="② RenderDoc 抓帧验证无 NaN，并用 x*x 替代 pow(x,2) 完成数学瘦身"
          checked={mathFixed}
          onChange={setMathFixed}
        />
        <StageToggle
          label="③ 开启 r.PSOPrecaching=1 与 Validation=2，清空驱动缓存实测无尖峰"
          checked={psoPrecacheOn}
          onChange={setPsoPrecacheOn}
        />
        <StageToggle
          label="④ 还原本地 ConsoleVariables.ini（恢复 r.Shaders.Optimize=1，关闭 Dump）"
          checked={debugFlagsRestored}
          onChange={setDebugFlagsRestored}
        />
      </div>

      <p>提示：请务必在真实 UE 5.8 工程中完成四项实操并留存 `Platform Stats`、RenderDoc 抓帧与 Unreal Insights 截图，切勿将本地调试开关提交到团队代码库。</p>
    </div>
  );
}

export const capstone: ModuleDefinition = {
  id: '12', number: '12', title: '综合练习与关卡验收', subtitle: '检验板制作验收 + 阵列性能调优 + Shader/PSO/RenderDoc 工程验收',
  lessons: [{
    id: 'panel-project-acceptance', moduleId: '12', number: '12.1', title: '从空工程到关卡验收 —— 漆面与金属检验板',
    subtitle: '用同一套可下载贴图完成导入、材质、实例、关卡打光和平台统计，并保存可重开的关卡。',
    duration: '30–45 分钟', difficulty: '实战', StageComponent: PanelPractice,
    steps: [
      { stepNumber: 1, tag: 'phenomenon', shortLabel: '建工程', title: '搭一个能比较材质的场景',
        paragraphs: ['用 UE 5.8 新建 Games → Blank 蓝图桌面项目。打开 File → New Level → Basic，在默认光源、天空和地面都可见时，按 Ctrl + Space 打开 Content Drawer（内容抽屉），将关卡另存到 /Game/PanelPractice/L_PanelCheck。', '点击顶部工具栏「+（Quickly Add）→ Shapes → Cube」（或在 Place Actors 中拖入 Cube），命名为 Panel 并抬离地面。将视口切为 Lit，面朝立方体一侧观察。后续对照保持同一个观察方向和曝光。'],
        tryItPrompt: '在内容浏览器建立 PanelPractice 文件夹，下载上方三张 PNG。验收时应能从内容浏览器重新打开 L_PanelCheck 并看到 Panel。' },
      { stepNumber: 2, tag: 'background', shortLabel: '导贴图', title: '按纹素所存的数据选择导入设置',
        paragraphs: ['把三张 PNG 一起拖进 PanelPractice。逐张打开纹理资产，Panel_BaseColor 用 Default 并开启 sRGB，Panel_Normal 用 Normalmap 并关闭 sRGB，Panel_ORM 用 Masks 并关闭 sRGB，保存。', 'ORM 的 R 在全图为 255，G 在上、下半部分别为 64 和 192，B 在左、右半部分别为 0 和 255。法线图采用 DirectX 切线空间约定，示例保留默认绿色方向。'],
        tryItPrompt: '在网页中切换三张源图；在 UE 纹理编辑器中分别单看 ORM 的 G 和 B，应看到横向分区和纵向分区。' },
      { stepNumber: 3, tag: 'experiment', shortLabel: '接材质', title: '让一张 ORM 分别控制三种属性',
        paragraphs: ['在 PanelPractice 新建 Material，命名 M_Panel，使用 Surface、Opaque、Default Lit。保留新材质的传统根节点输入。本练习在 Substrate 已启用的项目中也可使用该布局。', '将三张纹理拖入材质图。颜色样本 RGB → Base Color，法线样本 RGB → Normal，ORM.R → Ambient Occlusion，ORM.B → Metallic。创建 Scalar Parameter，命名 RoughnessScale，默认 1。将 ORM.G 与 RoughnessScale 相乘，经 Saturate 接入 Roughness。点击 Apply，再 Save。'],
        tryItPrompt: '打开本课节点图逐线核对。把 M_Panel 拖到 Panel 上；右半面应呈现金属的环境反射。若整个右半面都黑，先检查场景的天空光和反射环境。' },
      { stepNumber: 4, tag: 'ue5', shortLabel: '建实例', title: '在关卡里验证实例参数和凹凸方向',
        paragraphs: ['右键 M_Panel → Create Material Instance，命名 MI_Panel。将实例指定到 Panel 的 Materials → Element 0。打开实例，勾选 RoughnessScale，先设 1，再设 0.5，保存。', '保持光照不动，上半部目标粗糙度应从约 0.251 降至 0.125，下半部从 0.753 降至 0.376。在面板的 UV 平面内沿 V 轴布光。取左上漆面同一列的 (32,8) 和 (32,24)，法线 G 分别是 198 和 57，解码 Y 约 +0.553 和 −0.553。固定曝光，从切线 +Y 一侧照向面板，前者的直射漫反射应更亮；光向移至 −Y 后两点明暗互换。在同一光向下翻转绿通道也应互换，验收后恢复原设置。'],
        tryItPrompt: '将网页的 RoughnessScale 切到 0.5，核对四个象限，再在 UE 中来回切换这个参数。若全表面一起变成金属，检查是否误将 ORM.G 接入 Metallic。' },
      { stepNumber: 5, tag: 'pitfall', shortLabel: '验收', title: '复查保存结果并记录目标平台统计',
        paragraphs: ['在 M_Panel 的 Material Editor 打开 Stats / Platform Stats，启用当前目标平台和实际渲染路径（例如 Windows Desktop SM6）。待编译完成，记录平台、独立采样器数和纹理采样数；不同平台、渲染路径和统计口径会产生不同读数。', 'Save All，重新打开 L_PanelCheck。核对 Panel 的 Element 0 仍为 MI_Panel、实例参数仍为 0.5、上下粗糙差异可见、斜光切换会改变法线细节。保留两张相同视角的对照和一份平台统计，作为此次关卡验收记录。'],
        tryItPrompt: '出现棋盘格时先读材质编译错误；上下高光对比异常先查 ORM 的 sRGB 和 G 通道；只有斜光方向反常时才检查法线约定。' },
    ],
    takeaways: ['在同一 UV 上用 ORM 三个通道驱动独立属性。','用可回读的实例参数和两种光向验收材质。','重开关卡并记录目标平台统计。'],
    schematic: { title: 'M_Panel 的传统根节点接线', caption: '三个纹理样本、一个标量参数，图中的输入名称对应新建表面材质。',
      nodes: [
        { id:'c', title:'Panel_BaseColor', category:'texture', x:12,y:12, outputs:[{id:'rgb',label:'RGB · Color'}] },
        { id:'n', title:'Panel_Normal', category:'texture', x:12,y:102, outputs:[{id:'rgb',label:'RGB · Normal'}] },
        { id:'o', title:'Panel_ORM', category:'texture', x:12,y:192, outputs:[{id:'r',label:'R · AO'},{id:'g',label:'G · Roughness'},{id:'b',label:'B · Metallic'}] },
        { id:'s', title:'RoughnessScale', category:'param', x:12,y:325, outputs:[{id:'v',label:'默认 1.0'}] },
        { id:'m', title:'Multiply', category:'math', x:224,y:260, width:115, inputs:[{id:'a',label:'A'},{id:'b',label:'B'}],outputs:[{id:'v',label:'×'}] },
        { id:'sat', title:'Saturate', category:'math', x:370,y:275,width:112,inputs:[{id:'i',label:'输入'}],outputs:[{id:'v',label:'0–1'}] },
        { id:'root', title:'M_Panel', category:'output', x:525,y:95,inputs:[{id:'c',label:'Base Color'},{id:'n',label:'Normal'},{id:'r',label:'Ambient Occlusion'},{id:'b',label:'Metallic'},{id:'g',label:'Roughness'}] },
      ], edges: [
        {fromNode:'c',fromPin:'rgb',toNode:'root',toPin:'c'},{fromNode:'n',fromPin:'rgb',toNode:'root',toPin:'n'},
        {fromNode:'o',fromPin:'r',toNode:'root',toPin:'r'},{fromNode:'o',fromPin:'b',toNode:'root',toPin:'b'},
        {fromNode:'o',fromPin:'g',toNode:'m',toPin:'a'},{fromNode:'s',fromPin:'v',toNode:'m',toPin:'b'},
        {fromNode:'m',fromPin:'v',toNode:'sat',toPin:'i'},{fromNode:'sat',fromPin:'v',toNode:'root',toPin:'g'},
      ],
    },
  },
  {
    id: 'panel-perf-tuning-acceptance',
    moduleId: '12',
    number: '12.2',
    title: '关卡性能实战验收 —— 200 块检验板的实例化合批、LOD 减负与 ProfileGPU 验收',
    subtitle: '把 9.5~9.8 的全链路性能功法落到真实 UE 5.8 工程：造出卡顿基线、完成 HISM/CPD/LOD 改造并产出量化验收单',
    duration: '30–40 分钟',
    difficulty: '实战',
    StageComponent: PerfAcceptanceStage,
    steps: [
      {
        stepNumber: 1,
        tag: 'phenomenon',
        shortLabel: '录卡顿基线',
        title: '搭出 200 块独立检验板阵列，固定机位记录改造前基线',
        paragraphs: [
          '复用 12.1 的关卡 `L_PanelCheck`（另存一份 `L_PanelPerfTest`），先故意制造一个典型“反面教材”场景：用蓝图或编辑器复制出 `200` 个独立静态网格 Actor 摆成阵列，并给每个检验板在 `Construction Script` 中单独创建 `Dynamic Material Instance (MID)` 随机修改 `RoughnessScale`。',
          '在能俯瞰整片阵列的位置按 `Ctrl + 1` 保存固定书签机位，输入 `t.MaxFPS 0` 解除帧率锁限，依次输入 `stat unit`、`stat scenerendering` 并按 `Ctrl + Shift + ,` 跑一次 `ProfileGPU`。截图记下改造前的 `Frame / Draw / GPU (ms)` 与 `Mesh draw calls` 作为基线。',
        ],
        tryItPrompt: '在上方模拟器保持「① 独立 Actor + MID (改造前)」，观察 Draw Call 与 Draw 线程如何冲高，然后在你的 UE 5.8 关卡中复现并记录改造前读数。',
      },
      {
        stepNumber: 2,
        tag: 'background',
        shortLabel: 'HISM 实例化',
        title: '改造为 HISM（或对比 Nanite），亲眼见证 Mesh draw calls 断崖暴跌',
        paragraphs: [
          '新建一个蓝图 Actor `BP_PanelArray`，添加 `Hierarchical Instanced Static Mesh (HISM)` 组件，指定相同的检验板网格与单一材质 `MI_Panel`，在 `Construction Script` 中用双重循环调用 `Add Instance` 生成同样的 `200` 块阵列（隐藏或删掉旧的 200 个独立 Actor）。',
          '按数字 `1` 回到完全相同的书签机位，再次核对 `stat scenerendering` 中的 `Mesh draw calls` 与 `stat unit` 中的 `Draw` 毫秒数——你也可以额外勾选静态网格的 `Enable Nanite Support` 对比传统 HISM 与 UE 5.8 Nanite 的提交差异。',
        ],
        tryItPrompt: '在模拟器中将提交架构切换为「② HISM」或「③ Nanite + HISM」，对比 Draw 线程与 Mesh draw calls 的剧烈回落。',
      },
      {
        stepNumber: 3,
        tag: 'experiment',
        shortLabel: '零破批改参',
        title: '接入 PerInstanceRandom 与 CustomData，让 200 块板子千人千面且不破合批',
        paragraphs: [
          '打开母材质 `M_Panel`，拖入 **`PerInstanceRandom`** 节点通过 `Lerp` 给每块检验板叠加细微的明暗色差；再放一颗 **`PerInstanceCustomData`**（`Data Index = 0`）驱动粗糙度倍率或高亮标记（如果是单个独立网格则可给标量参数勾选 **`Use Custom Primitive Data`**）。',
          '在 `BP_PanelArray` 中将 HISM 的 `Num Custom Data Floats` 设为 `1`，在循环生成后调用 `Set Custom Data Value` 为随机几块板子写入 `1.0`。回到书签机位 `1` 复查：200 块检验板呈现各异质感，但 `Mesh draw calls` 纹丝不动保持单批！',
        ],
        tryItPrompt: '切换右上角「UE5.8 节点/原理图」，对照 `PerInstanceRandom + PerInstanceCustomData + QualitySwitch` 的接线升级你的 `M_Panel`。',
      },
      {
        stepNumber: 4,
        tag: 'ue5',
        shortLabel: 'LOD 与分级',
        title: '配置多级 LOD 与 QualitySwitch，并用 Quad Overdraw 视图复查',
        paragraphs: [
          '若测试传统非 Nanite 网格：双击网格资产配置 `LOD0 → LOD1 → LOD2`（设置合理的 `Percent Triangles` 与 `Screen Size`），并在远景 `LOD2` 上移除昂贵的额外槽位或关闭 WPO；切换视口到 `Level of Detail Coloration → Mesh LODs` 与 `Optimization Viewmodes → Quad Overdraw` 拉远镜头验收。',
          '回到 `M_Panel`，放一颗 **`QualitySwitch`** 节点：在 `High / Epic` 保留完整法线与细节运算，在 `Low` 档位简化输入。通过工具栏 `Settings → Material Quality Level` 切换不同档位，在 `Platform Stats` 中核对各档指令数变化。',
        ],
        tryItPrompt: '在模拟器勾选「配置多级 LOD」并切换 `QualitySwitch` 画质档，体验 GPU 毫秒随 LOD 与画质分级逐步下探的规律。',
      },
      {
        stepNumber: 5,
        tag: 'pitfall',
        shortLabel: '前后验收单',
        title: '固定机位产出前后对比验收报告，闭环全部材质与性能课程',
        paragraphs: [
          '按数字 `1` 回到最初的书签机位，在相同分辨率下再次抓取 `stat unit`、`stat scenerendering`、`ProfileGPU` 与 `Alt + 8`（Shader Complexity）截图，整理一份两列对比表（改造前 vs 改造后：Frame ms、Draw ms、GPU ms、Mesh draw calls、Quad Overdraw 表现）。',
          '特别复查两项工程底线：① 没有把 `MID` 残留留在批量循环里；② 所有更改已 `Save All`，重开 `L_PanelPerfTest` 后阵列的实例化差异、LOD 切级与帧率表现均完整复现。至此，你已经具备从零做材质到全关卡性能调优的完整 UE 5.8 实战能力！',
        ],
        tryItPrompt: '核对上方四项「✅ 验收达标核对项」全部亮绿，并在自己的 UE 5.8 工程中完成真实前后截图留档！',
      },
    ],
    takeaways: [
      '养成“固定书签机位 + 解除锁帧 + 先录基线再优化”的科学调优验收流程',
      '用 `HISM`（或 `Nanite + HISM`）配合 `PerInstanceRandom` / `PerInstanceCustomData` / `CPD` 实现海量资产零破批差异化',
      '结合多级 `LOD`（`Mesh LOD Coloration` + `Quad Overdraw` 验收）与 `QualitySwitch` 画质分级守住 16.67 ms 帧预算',
    ],
    schematic: {
      title: 'M_Panel 性能升级版接线（PerInstance + CustomData + QualitySwitch）',
      caption: '在 12.1 基础检验板材质上零破批接入实例化随机色差、自定义浮点覆写与画质分级，供 HISM 阵列 1 次 Draw Call 共享。',
      nodes: [
        { id: 'pr', title: 'PerInstanceRandom', subtitle: '0~1 逐实例随机', category: 'input', x: 14, y: 16, width: 176, outputs: [{ id: 'r', label: 'Random' }] },
        { id: 'cd', title: 'PerInstanceCustomData', subtitle: 'Index = 0 (Rough倍率)', category: 'param', x: 14, y: 120, width: 176, outputs: [{ id: 'v', label: 'Float[0]' }] },
        { id: 'orm', title: 'Panel_ORM (Shared:Wrap)', subtitle: 'R:AO / G:Rough / B:Metal', category: 'texture', x: 14, y: 224, width: 176, outputs: [{ id: 'g', label: 'G · Roughness' }] },
        { id: 'mul', title: 'Multiply → Saturate', subtitle: '零 MID 改单板粗糙度', category: 'math', x: 238, y: 164, width: 168, inputs: [{ id: 'a', label: 'Custom[0]' }, { id: 'b', label: 'ORM.G' }], outputs: [{ id: 'o', label: 'Roughness' }] },
        { id: 'qs', title: 'QualitySwitch', subtitle: 'High 精算 / Low 精简', category: 'math', x: 238, y: 24, width: 168, inputs: [{ id: 'hi', label: 'High (随机色差)' }], outputs: [{ id: 'c', label: 'BaseColor' }] },
        { id: 'root', title: 'M_Panel (1 Draw Call)', subtitle: '供 HISM 200 块阵列共享', category: 'output', x: 456, y: 84, width: 184, inputs: [{ id: 'bc', label: 'Base Color' }, { id: 'rg', label: 'Roughness' }] },
      ],
      edges: [
        { fromNode: 'pr', fromPin: 'r', toNode: 'qs', toPin: 'hi', color: '#22c55e' },
        { fromNode: 'cd', fromPin: 'v', toNode: 'mul', toPin: 'a', color: '#f97316' },
        { fromNode: 'orm', fromPin: 'g', toNode: 'mul', toPin: 'b', color: '#eab308' },
        { fromNode: 'qs', fromPin: 'c', toNode: 'root', toPin: 'bc', color: '#22c55e' },
        { fromNode: 'mul', fromPin: 'o', toNode: 'root', toPin: 'rg', color: '#eab308' },
      ],
    },
  },
  {
    id: 'panel-shader-pso-debug-acceptance',
    moduleId: '12',
    number: '12.3',
    title: 'Shader 编译审计、PSO Precaching 验证与 RenderDoc 抓帧实操验收',
    subtitle: '把第 11 章的 HLSL 源码对照、Usage 瘦身、DDC 检查、PSO 预热验收与 RenderDoc 单步调试完整落到真实 UE 5.8 工程',
    duration: '30–40 分钟',
    difficulty: '实战',
    StageComponent: ShaderAuditAcceptanceStage,
    steps: [
      {
        stepNumber: 1,
        tag: 'phenomenon',
        shortLabel: '查 HLSL 与变体',
        title: '掀开 M_Panel 盖子对照 HLSL 源码，记录 Usage Flags 与编译变体基线',
        paragraphs: [
          '打开 12.1 / 12.2 制作的母材质 `M_Panel`，点击顶部菜单 **`Window → Shader Code → HLSL Code`**，按 `Ctrl + F` 搜索 `CalcPixelMaterialInputs`，对照找出你的 `Panel_ORM` 采样与 `RoughnessScale` 乘法对应的真实 HLSL 语句。',
          '再打开左侧 Details 面板搜索 `Usage`，故意勾选 `Used with Skeletal Mesh` 与 `Used with Niagara Sprites` 点一次 Apply（观察右下角编译任务数暴涨），用控制台 `stat shadercompiling` 与 `Platform Stats` 记下改造前变体基线。',
        ],
        tryItPrompt: '对照上方模拟器未勾选前的基线读数，在你的 UE 5.8 工程中完成 `HLSL Code` 对照与 `Usage` 变体膨胀记录。',
      },
      {
        stepNumber: 2,
        tag: 'background',
        shortLabel: 'Usage 瘦身与 DDC',
        title: '清理冗余 Usage Flags，验证 DDC 缓存命中率与 MI 零重编特性',
        paragraphs: [
          '在 `M_Panel` 的 `Usage` 栏取消用不到的 `Skeletal Mesh`、`Niagara`、`Spline` 勾选（仅保留 12.2 实际用到的 `Instanced Static Meshes`），必要时关闭 `Automatically Set Usage in Editor` 防止手滑误勾，再次 Apply 并记录变体数暴跌幅度。',
          '点击 UE 5.8 编辑器右下角 **`Derived Data`** 状态菜单，记录当前的 `Total Cache Hit Rate`（Local / Zen 命中情况）；随后打开 `MI_Panel` 反复滑动 `RoughnessScale`，验证 DDC Key 不变、编译计数保持 `0`。',
        ],
        tryItPrompt: '勾选模拟器中的「① 清理冗余 Material Usage Flags」，核对变体数量收敛幅度，并在编辑器右下角检查 Derived Data 命中率。',
      },
      {
        stepNumber: 3,
        tag: 'experiment',
        shortLabel: 'RenderDoc 抓帧',
        title: '用 RenderDoc 抓帧查看 GBuffer 原值，完成 NaN 防护与数学瘦身验收',
        paragraphs: [
          '在 `Edit → Plugins` 中确认启用官方 **RenderDoc** 插件并重启编辑器。在副本材质 `M_Panel_DebugTest` 中故意接入一个 `Power(Roughness, 2.0)`（或零向量 `Normalize` 触发黑块 NaN），在关卡视口按下 **`Alt + F12`**（或点右上角 RenderDoc 图标）抓取一帧。',
          '在 RenderDoc 中打开抓帧档案：找到 `BasePass` 中绘制 `Panel` 的 Draw Call，查看 `GBufferA (WorldNormal)` 与 `SceneColor` 像素吸色值并点开 `Pixel History`。定位问题后，回到材质用 `Multiply(x, x)` 替换 `Power(x, 2)`、用 `SafeNormalize` / `Saturate` 封死除零，再在 `Platform Stats` 核对指令数下降。',
        ],
        tryItPrompt: '勾选模拟器中的「② RenderDoc 抓帧验证无 NaN 与数学瘦身」，在本地 RenderDoc 中完成一次真实 GBuffer 吸色与 Pixel History 查看。',
      },
      {
        stepNumber: 4,
        tag: 'ue5',
        shortLabel: 'PSO 预热验收',
        title: '核对 r.PSOPrecaching 与 Shared Shader Code，用 Unreal Insights 抓实机验证',
        paragraphs: [
          '打开 `Project Settings → Rendering`，确认已勾选 **`Share Material Shader Code`** 与 **`Shared Material Native Libraries`**，并确认 **`r.PSOPrecaching=1`** 开启（可在测试时额外加 `r.PSOPrecache.Validation=2` 配合控制台 `stat pso` 观察预编译队列）。',
          '以 Standalone / 打包版本启动 `L_PanelPerfTest`（附加命令行 `-trace=default,gpu,rhicommands`；若需严格复现首次进图，测试前清空显卡驱动着色器缓存），在 **Unreal Insights** 中检查 RHI 线程是否存在明显的 `CreateGraphicsPipelineState` 卡顿长条。',
        ],
        tryItPrompt: '勾选模拟器中的「③ 开启 r.PSOPrecaching=1」，观察首见 PSO 帧耗时峰值从 138ms 回落至 16ms 红线内。',
      },
      {
        stepNumber: 5,
        tag: 'pitfall',
        shortLabel: '还原开关并归档',
        title: '检查还原本地调试开关，输出最终工程验收单，圆满收官全套课程！',
        paragraphs: [
          '如果步骤 3 为了在 RenderDoc 看源码级 HLSL 而修改过本地 `ConsoleVariables.ini`（开启过 `r.Shaders.Optimize=0`、`r.Shaders.Symbols=1`、`r.DumpShaderDebugInfo=1`），**验收最后一步务必全部注释还原**，防止拖垮运行期指令数与塞满硬盘！',
          '执行 `Save All`，将四项量化数据（Usage 瘦身前后变体数、DDC 命中率、PSO 预热验证截图、RenderDoc 与 Platform Stats 指令对比）归档。🎉 至此，你已圆满打通 **《UE 5.8 材质与 Shader 工程全栈教程》全部 12 大模块**，从零基础光学常识一路成长为能独当一面的 UE 5.8 材质与渲染工程实战者！',
        ],
        tryItPrompt: '勾选「④ 还原本地 ConsoleVariables.ini」，确认上方四项工程上线核对全部亮绿 ✅！',
      },
    ],
    takeaways: [
      '养成通过 `HLSL Code`、`Platform Stats` 与 `Usage Flags` 定期审计母材质变体数的工程习惯',
      '通过编辑器右下角 `Derived Data` 监控 DDC 命中率，避免无意修改基础 `.ush` 引发全组重编',
      '熟练用 RenderDoc（`Alt + F12`）查 `GBuffer` 原值与 `Pixel History`，并在发版前用 `r.PSOPrecaching=1` + Unreal Insights 消灭 PSO 尖峰',
      '本地开启过 `r.Shaders.Optimize=0` / `Symbols=1` / `DumpShaderDebugInfo=1` 后，排错结束必须立刻还原',
    ],
    schematic: {
      title: 'UE 5.8 Shader 工程上线四关验收闭环（编译 → DDC → RenderDoc → PSO）',
      caption: '在真实 `M_Panel` 工程上串联第 11 章四大工具链，完成从变体瘦身到零卡顿发版的闭环验收。',
      nodes: [
        { id: 'u', title: '1. HLSL & Usage 审计', subtitle: '清冗余 Usage · 控 StaticSwitch', category: 'param', x: 16, y: 74, width: 184, outputs: [{ id: 'o', label: '精简 ShaderMap', color: '#38bdf8' }] },
        { id: 'd', title: '2. DDC 命中核验', subtitle: 'Derived Data 95%+ · MI 零重编', category: 'texture', x: 234, y: 74, width: 186, inputs: [{ id: 'i', label: '变体产物', color: '#38bdf8' }], outputs: [{ id: 'o', label: '字节码复用', color: '#10b981' }] },
        { id: 'r', title: '3. RenderDoc 抓帧单步', subtitle: 'Alt+F12 · 查 NaN & 数学瘦身', category: 'math', x: 454, y: 24, width: 192, inputs: [{ id: 'i', label: '单帧 Capture', color: '#10b981' }], outputs: [{ id: 'o', label: '无毒高能 Shader', color: '#a855f7' }] },
        { id: 'p', title: '4. PSO Precaching 实测', subtitle: 'r.PSOPrecaching=1 + Insights', category: 'pipeline', x: 454, y: 146, width: 192, inputs: [{ id: 'i', label: '清驱动缓存验机', color: '#10b981' }], outputs: [{ id: 'o', label: '零 150ms 尖峰', color: '#f59e0b' }] },
        { id: 'ok', title: '还原调试开关 · 准予发版', subtitle: 'Optimize=1 · Save All 归档', category: 'output', x: 686, y: 80, width: 186, inputs: [{ id: 'a', label: '画质/指令达标', color: '#a855f7' }, { id: 'b', label: '帧率丝滑达标', color: '#f59e0b' }] },
      ],
      edges: [
        { fromNode: 'u', fromPin: 'o', toNode: 'd', toPin: 'i', color: '#38bdf8' },
        { fromNode: 'd', fromPin: 'o', toNode: 'r', toPin: 'i', color: '#10b981' },
        { fromNode: 'd', fromPin: 'o', toNode: 'p', toPin: 'i', color: '#10b981' },
        { fromNode: 'r', fromPin: 'o', toNode: 'ok', toPin: 'a', color: '#a855f7' },
        { fromNode: 'p', fromPin: 'o', toNode: 'ok', toPin: 'b', color: '#f59e0b' },
      ],
    },
  }],
};
