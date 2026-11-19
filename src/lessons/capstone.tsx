import React, { useEffect, useState } from 'react';
import { StageSegmented, StageSlider } from '../components/ui/StageWidgets';
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

export const capstone: ModuleDefinition = {
  id: '11', number: '11', title: '综合练习与关卡验收', subtitle: '做一块有漆面和裸金属的检验板',
  lessons: [{
    id: 'panel-project-acceptance', moduleId: '11', number: '11.1', title: '从空工程到关卡验收 —— 漆面与金属检验板',
    subtitle: '用同一套可下载贴图完成导入、材质、实例、关卡打光和平台统计，并保存可重开的关卡。',
    duration: '30–45 分钟', difficulty: '实战', StageComponent: PanelPractice,
    steps: [
      { stepNumber: 1, tag: 'phenomenon', shortLabel: '建工程', title: '搭一个能比较材质的场景',
        paragraphs: ['用 UE 5.8.1 新建 Games → Blank 蓝图桌面项目。打开 File → New Level → Basic，在默认光源、天空和地面都可见时，将关卡另存到 /Game/PanelPractice/L_PanelCheck。', '在 Place Actors 中拖入 Cube，命名 Panel，使其高于地面。将视口切为 Lit，面朝立方体一侧观察。后续对照保持同一个观察方向和曝光。'],
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
  }],
};
