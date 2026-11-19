import React, { useState } from 'react';
import { CheckSquare, Square, RotateCcw, FileSpreadsheet } from 'lucide-react';

type SrgbStatus = 'on' | 'off' | 'hdr';

const TEXTURE_CONFIG_ROWS: {
  type: string;
  bit: string;
  srgbLabel: string;
  srgbStatus: SrgbStatus;
  comp: string;
  sampler: string;
  vram2k: string;
  note: string;
}[] = [
  {
    type: '漫反射颜色图 (Base Color / Diffuse)',
    bit: '8-bit PNG / TGA',
    srgbLabel: '必开 sRGB',
    srgbStatus: 'on',
    comp: 'Default (DXT1 / BC1)',
    sampler: 'Color',
    vram2k: '2.67 MiB (含 Mip)',
    note: '桌面 Default 带有效 Alpha 时可能从 BC1 切换到 BC3；在目标平台查看实际像素格式。',
  },
  {
    type: '法线贴图 (Tangent Normal Map)',
    bit: '8-bit / 16-bit',
    srgbLabel: '严禁开启',
    srgbStatus: 'off',
    comp: 'Normalmap (BC5)',
    sampler: 'Normal',
    vram2k: '5.33 MiB (含 Mip)',
    note: 'BC5 量化 XY 后重建正半球 Z。高光曲面推荐 16-bit 源图，用斜光验证是否需 Flip Green Channel。',
  },
  {
    type: 'ORM 三合一打包贴图 (R=AO, G=粗糙, B=金属)',
    bit: '8-bit PNG / TGA',
    srgbLabel: '严禁开启',
    srgbStatus: 'off',
    comp: 'Masks (no sRGB) [BC1]',
    sampler: 'Masks',
    vram2k: '2.67 MiB (含 Mip)',
    note: 'BC1 的绿色端点为 6 位，16 个纹素共享两端点，每个纹素各用一个索引；增加 Alpha 后按实际格式核算。',
  },
  {
    type: '未压缩单通道灰度（桌面 8-bit 示例）',
    bit: '8-bit 灰度',
    srgbLabel: '严禁开启',
    srgbStatus: 'off',
    comp: 'Grayscale (G8，线性)',
    sampler: 'Linear Grayscale',
    vram2k: '5.33 MiB (含 Mip)',
    note: 'G8 每个纹素保留 1 字节。高精度高度数据另行选择并验证目标格式。',
  },
  {
    type: '单通道压缩遮罩',
    bit: '8-bit 灰度',
    srgbLabel: '严禁开启',
    srgbStatus: 'off',
    comp: 'Alpha (BC4)',
    sampler: 'Alpha',
    vram2k: '2.67 MiB (含 Mip)',
    note: '每个 4×4 块使用一对端点及每纹素索引，平滑梯度会有量化误差。',
  },
  {
    type: '高画质角色皮肤 / 鲜艳贴花 / 界面图标',
    bit: '8-bit PNG / TGA',
    srgbLabel: '必开 sRGB',
    srgbStatus: 'on',
    comp: 'BC7 (DX11+) / UI2D',
    sampler: 'Color',
    vram2k: '5.33 MiB (BC7) / 16 MiB',
    note: 'BC7 每块 16 字节，支持 Alpha。锐利边缘质量与编码模式、块内颜色分布有关。',
  },
  {
    type: '环境天空球照明贴图 (HDRI Cubemap)',
    bit: '16/32-bit HDR/EXR',
    srgbLabel: '线性浮点',
    srgbStatus: 'hdr',
    comp: 'HDRCompressed (BC6H)',
    sampler: 'Linear Color',
    vram2k: '约 32 MiB（六面各 2K）',
    note: '真实记录 >1.0 的太阳能量，供 Lumen 与镜面环境反射使用。',
  },
];

const SHORTCUT_NODES = [
  { key: '1 + 左键', node: 'Constant (1维标量)', desc: '输入单个标量（如粗糙度、金属度）' },
  { key: '2 + 左键', node: 'Constant2Vector', desc: '输入二维数组（常用于 UV 平铺缩放倍数）' },
  { key: '3 + 左键', node: 'Constant3Vector', desc: '输入 RGB 颜色或 XYZ 三维空间方向箭头' },
  { key: 'S + 左键', node: 'ScalarParameter', desc: '标量活口参数（供材质实例 MI 零编译实时滑块调节）' },
  { key: 'V + 左键', node: 'VectorParameter', desc: '颜色/四维活口参数（供材质实例实时换色）' },
  { key: 'T + 左键', node: 'TextureSample', desc: '检查采样器的寻址与过滤，按平台预算决定是否共享' },
  { key: 'U + 左键', node: 'TexCoord', desc: '获取模型剥平后的 0~1 橘子皮 UV 坐标' },
  { key: 'P + 左键', node: 'Panner', desc: '让 UV 随时间自动平移（水流、瀑布、流光必备）' },
  { key: 'A + 左键', node: 'Add (加法)', desc: '数值偏移或叠加发光亮度' },
  { key: 'M + 左键', node: 'Multiply (乘法)', desc: '调整强弱，或拿黑白遮罩把 0 的区域抠黑' },
  { key: 'O + 左键', node: 'OneMinus (1 - x)', desc: '黑白底片反转（好铁与铁锈位置瞬间对调）' },
  { key: 'L + 左键', node: 'LinearInterpolate (Lerp)', desc: '冷热水混水阀：Alpha=0 出 A，Alpha=1 出 B' },
  { key: 'UE 5.8 核心', node: 'Substrate Slab BSDF', desc: '新材质可用传统输入；需要显式层板时右键根节点 Convert to Substrate，Slab 输出接 Front Material' },
  { key: 'UE 5.8 桥接', node: 'Metalness-To-DiffuseAlbedo-F0', desc: '把传统 BaseColor+Metallic 一键翻译成 Substrate 层板输入' },
];

const VERIFY_NOTES = [
  { label: '几何与法线', body: '单面三角形由顶点绕序决定正反面。法线贴图 RGB 用 2 × RGB − 1 解码；中性法线指向切线空间 +Z。' },
  { label: '颜色与数据', body: 'sRGB 中灰 0.5 解码约为 0.214。粗糙度 0.5 应以线性 0.5 读取；比较时固定曝光、光源、清漆和其他参数。' },
  { label: '纹理过滤', body: 'Bilinear 在一级 mip 内插值，Trilinear 再混合相邻两级。正方形大纹理的全 mip 链约比基级多 1/3，移除这些级约节省全链的 1/4。' },
  { label: '照明环境', body: '自定义 Lambert 可将世界空间的单位光向量作为参数。预览球的 Show Environment 控制背景，Use Sky Lighting 和 Sky Light Intensity 控制环境照明。F0 只描述正入射界面反射。' },
  { label: '缓存与 AO', body: '用 primitive 的 WPO Disable Distance 检查远处的阴影缓存。Lumen 材质 AO 需要为它留出 GBuffer 空间，检查 Allow Static Lighting。' },
  { label: '性能统计', body: '用 Platform Stats 报告编译后的指令和采样器，用 GPU 计时验证帧耗。2 的 N 次方只给出 N 个独立布尔参数的组合上限。' },
];

const PBR_MATERIALS = [
  { name: '纯净水 (Water)', hex: '#142028', f0: '0.02 (2%)', metal: '0 (非金属)', rough: '0.01 ~ 0.05' },
  { name: '普通清玻璃 (Glass)', hex: '#E8F1F5', f0: '0.04 (4% · IOR 1.52)', metal: '0 (非金属)', rough: '0.01 ~ 0.08' },
  { name: '光滑红塑料 (Plastic)', hex: '#C82822', f0: '0.04 (4%)', metal: '0 (非金属)', rough: '0.15 ~ 0.35' },
  { name: '干燥混凝土 (Concrete)', hex: '#8B8984', f0: '0.04 (4%)', metal: '0 (非金属)', rough: '0.72 ~ 0.90' },
  { name: '木炭（漫反射率约 0.02）', hex: '#272727', f0: '约 0.04', metal: '0', rough: '0.80 ~ 0.92' },
  { name: '新雪（漫反射率约 0.81）', hex: '#E8E8E8', f0: '约 0.02', metal: '0', rough: '0.55 ~ 0.75' },
  { name: '黄金', hex: '#FFE39D', f0: '(1.000, 0.766, 0.336)', metal: '1', rough: '0.08 ~ 0.25' },
  { name: '银', hex: '#FCFAF5', f0: '(0.972, 0.960, 0.915)', metal: '1', rough: '0.05 ~ 0.20' },
  { name: '铜', hex: '#FACEC2', f0: '(0.955, 0.637, 0.538)', metal: '1', rough: '0.12 ~ 0.32' },
  { name: '铁', hex: '#C5C7C8', f0: '(0.560, 0.570, 0.580)', metal: '1（完全锈蚀处为 0）', rough: '0.35 ~ 0.65' },
];

const EFFECT_RECIPES = [
  {
    effect: '真实清澈水体',
    domainMode: 'Surface + Single Layer Water BSDF',
    coreNodes: '两路 Panner → 两次 Normal 采样 → 法线混合；WaterAlbedo / WaterExtinction 控介质，岸线遮罩 R 接 TopMaterialOpacity，白色表层形成岸沫',
    pitfall: 'Opaque 单层水用专用渲染通道，岸边白、深水黑；DepthFade 用于普通半透明雾片。',
  },
  {
    effect: '通透/磨砂水晶玻璃',
    domainMode: 'Surface + Translucent + Surface ForwardShading',
    coreNodes: '设置透射与 IOR，分别检查表面高光、背后物体偏移，以及接收面阴影。',
    pitfall: '彩色投影需要静态灯 + Lightmass，或 Path Tracer + Thin Translucent。Lumen 关卡可观察玻璃自身的反射与透射。',
  },
  {
    effect: '丁达尔光柱与翻涌毒雾',
    domainMode: 'Exponential Height Fog (Volumetric Fog) / Volume 材质',
    coreNodes: '局部均匀雾可放置 Local Fog Volume；带 3D 噪声的 Volume 材质可赋给 Niagara 雾粒子，设置半径、边界与消光。',
    pitfall: '低成本半透明烟雾卡片插地必连 DepthFade 抹平刀割硬切线。',
  },
  {
    effect: '森林树叶与铁丝网镂空',
    domainMode: 'Surface + Masked + Two Sided Foliage / Slab MFP',
    coreNodes: '黑白镂空图连 Opacity Mask (阈值 0.333) + 背光透绿次表面散射 + 顶点微风 WPO',
    pitfall: '严禁整片森林用 Translucent 半透明，否则 Overdraw 爆红掉帧且排序穿帮。',
  },
  {
    effect: '怪物烧蚀溶解与能量护盾',
    domainMode: '溶解用 Masked；护盾用 Translucent Additive',
    coreNodes: '溶解：Noise ≥ 进度输出 1，否则 0 → Opacity Mask；保留侧截取窄边 × 线性 HDR 发光；护盾：Fresnel + 反向 DepthFade',
    pitfall: '护盾穿墙自动亮圈靠的是 DepthFade 探测极近距离差。',
  },
  {
    effect: '滚石自动积雪与免 UV 墙体',
    domainMode: 'Surface + Opaque (Substrate Slab)',
    coreNodes: 'PixelNormalWS.B (世界朝天分量) → Clamp → Lerp 岩石与白雪；拉伸白盒用 WorldAlignedTexture',
    pitfall: '必须取世界空间法线 Z，取切线空间法线旋转石头时雪会跟着滚到肚子底下。',
  },
  {
    effect: '玉石与双层车漆',
    domainMode: 'Surface / Substrate Slab 或 Vertical Layer',
    coreNodes: 'SSS MFP 按厘米输入，实验中的 10 mm 对应 1 cm；按散射模式提供厚度或薄表面设置。',
    pitfall: '固定光强比较正光和背光。清漆顶层需设置透射与层厚，保留底层反射。',
  },
  {
    effect: '实验性 Toon 风格化',
    domainMode: 'Substrate NPR / Blendable GBuffer',
    coreNodes: '启用 Substrate，项目 GBuffer Format 选 Blendable，按提示重启；创建 Toon Profile 并在 Toon BSDF 详情中指定，BaseColor 驱动表面色。',
    pitfall: '明暗色阶由 Profile 控制，节点以 BSDF 输出连 Front Material。',
  },
];

const CHECKLIST_ITEMS = [
  '按文件编码设置颜色图的 sRGB；ORM、法线、高度按线性数据读取。',
  '需要常规流送的纹理使用二次幂尺寸；非二次幂图另查 Mip Gen Settings，计划做 BC 压缩时顶层宽高按 4 对齐。',
  '零散黑白遮罩已合并打包为 ORM 贴图（记录通道约定，按实际打包格式评估质量和显存）。',
  '法线贴图压缩格式确认为 Normalmap (BC5)，且在斜光下检查过凹凸朝向无 OpenGL 绿通道颠倒。',
  'AO（环境光遮蔽）已正确接入专用 AO 接口，未直接乘死在 BaseColor 上导致手电筒照不亮暗缝。',
  '树叶、铁丝网、破布与烧蚀溶解一律采用 Masked 镂空而非昂贵的 Translucent 半透明。',
  '分别核对非金属的漫反射率和裸金属的线性 RGB；腐蚀、积尘等混合区域的中间金属度有依据。',
  '经常调整的颜色、粗糙度、UV 平铺与贴图已提升为 Parameter 参数，日常资产全部使用 MI 材质实例零编译派生。',
  '母材质中 Static Switch（静态开关）数量严格克制，核对实际使用的静态参数组合与目标平台编译统计。',
  '在 Platform Stats 检查目标平台的采样器与纹理读取次数；仅对寻址和过滤要求相容的纹理使用 Shared: Wrap / Clamp。',
];

const SECTION_ANCHORS = [
  { id: 'sheet-textures', label: '01 贴图导入配置' },
  { id: 'sheet-shortcuts', label: '02 快捷键与核心节点' },
  { id: 'sheet-verify', label: '03 引擎复查指南' },
  { id: 'sheet-pbr', label: '04 PBR 物理参考值' },
  { id: 'sheet-recipes', label: '05 效果实现配方' },
  { id: 'sheet-checklist', label: '06 上线 10 项自检单' },
];

export const CheatsheetsPage: React.FC = () => {
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const doneCount = Object.values(checked).filter(Boolean).length;
  const donePct = Math.round((doneCount / CHECKLIST_ITEMS.length) * 100);

  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main className="fullpage-scroll">
      <div className="page-container">
        <div className="page-hero">
          <div>
            <div className="page-hero-kicker">CHEATSHEETS &amp; CHECKLIST · 案头实战速查手册</div>
            <h1 className="page-hero-title">
              <FileSpreadsheet size={22} style={{ color: 'var(--brand-primary)' }} />
              UE 5.8 材质工程速查表与上线自检单
            </h1>
            <p className="page-hero-desc">
              做项目时忘了压缩格式、左手快捷键、PBR 校准值或常见效果配方？点击下方快捷目录三秒钟直达对表。
            </p>
          </div>
          <nav className="anchor-nav" aria-label="速查章节导航">
            {SECTION_ANCHORS.map((sec) => (
              <button key={sec.id} type="button" className="anchor-pill" onClick={() => jumpTo(sec.id)}>
                {sec.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Section 01: Texture Config */}
        <section id="sheet-textures" className="sheet-section">
          <h2 className="sheet-section-title">
            <span className="sheet-section-num">01</span>
            UE 5.8 贴图导入黄金配置一表通（桌面 BC 路径 · 以 2048×2048 为基准）
          </h2>
          <div className="sheet-table-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>贴图用途类型</th>
                  <th>推荐源文件</th>
                  <th>sRGB 开关</th>
                  <th>UE 5.8 压缩设置</th>
                  <th>2K 显存占用</th>
                  <th>核心避坑叮嘱</th>
                </tr>
              </thead>
              <tbody>
                {TEXTURE_CONFIG_ROWS.map((row, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{row.type}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, whiteSpace: 'nowrap' }}>{row.bit}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span
                        className={`meta-pill ${
                          row.srgbStatus === 'on' ? 'sage' : row.srgbStatus === 'off' ? 'coral' : 'lavender'
                        }`}
                      >
                        {row.srgbLabel}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, whiteSpace: 'nowrap' }}>{row.comp}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 11.5, whiteSpace: 'nowrap' }}>
                      {row.vram2k}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 02: Shortcuts & Nodes */}
        <section id="sheet-shortcuts" className="sheet-section">
          <h2 className="sheet-section-title">
            <span className="sheet-section-num">02</span>
            材质编辑器左手黄金快捷键与 UE 5.8 核心节点速查
          </h2>
          <div className="shortcut-grid">
            {SHORTCUT_NODES.map((item, idx) => (
              <div key={idx} className="shortcut-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span className="inline-code-pill" style={{ margin: 0 }}>
                    {item.node}
                  </span>
                  <span className="kbd-chip" style={{ whiteSpace: 'nowrap' }}>
                    {item.key}
                  </span>
                </div>
                <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{item.desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Section 03: Engine Verification */}
        <section id="sheet-verify" className="sheet-section">
          <h2 className="sheet-section-title">
            <span className="sheet-section-num">03</span>
            实验结果怎样在 UE 5.8 引擎中复查
          </h2>
          <ul className="verify-list">
            {VERIFY_NOTES.map((item, idx) => (
              <li key={idx} className="verify-item">
                <strong>{item.label}：</strong>
                {item.body}
              </li>
            ))}
          </ul>
        </section>

        {/* Section 04: PBR Physical Reference */}
        <section id="sheet-pbr" className="sheet-section">
          <h2 className="sheet-section-title">
            <span className="sheet-section-num">04</span>
            真实世界常见物质 PBR 物理校准参考值
          </h2>
          <div className="sheet-table-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>物质名称</th>
                  <th>外观参考色板 (sRGB Hex)</th>
                  <th>正入射 F0（线性，金属以 RGB 表示）</th>
                  <th>金属度 (Metallic)</th>
                  <th>日常粗糙度区间</th>
                </tr>
              </thead>
              <tbody>
                {PBR_MATERIALS.map((m, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{m.name}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        <span
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 5,
                            background: m.hex,
                            border: '1px solid var(--border-strong)',
                            display: 'inline-block',
                            boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.28)',
                          }}
                        />
                        {m.hex}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{m.f0}</td>
                    <td>{m.metal}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{m.rough}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 05: Effect Recipes */}
        <section id="sheet-recipes" className="sheet-section">
          <h2 className="sheet-section-title">
            <span className="sheet-section-num">05</span>
            水 / 玻璃 / 雾 / 植被等常见效果实现配方矩阵
          </h2>
          <div className="sheet-table-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>目标效果</th>
                  <th>材质域与混合/层板模式</th>
                  <th>核心节点与设置</th>
                  <th>头号防翻车要点</th>
                </tr>
              </thead>
              <tbody>
                {EFFECT_RECIPES.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{r.effect}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{r.domainMode}</td>
                    <td>{r.coreNodes}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{r.pitfall}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 06: Interactive Pre-Flight Checklist */}
        <section id="sheet-checklist" className="sheet-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="sheet-section-title" style={{ marginBottom: 4 }}>
                <span className="sheet-section-num">06</span>
                生产级母材质提交前 10 项自检清单
                <span className={`meta-pill ${doneCount === CHECKLIST_ITEMS.length ? 'sage' : 'neutral'}`}>
                  {doneCount} / {CHECKLIST_ITEMS.length} · {donePct}%
                </span>
              </h2>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                请在纹理资产、材质编辑器与关卡中逐项核对，再勾选对应项。
              </span>
            </div>
            <button
              type="button"
              className="brutal-btn"
              onClick={() => setChecked({})}
              style={{ fontSize: 12, padding: '6px 11px' }}
            >
              <RotateCcw size={13} /> 清空勾选
            </button>
          </div>

          <div className="progress-bar-track" style={{ marginTop: 0, marginBottom: 14 }}>
            <div className="progress-bar-fill" style={{ width: `${donePct}%` }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {CHECKLIST_ITEMS.map((text, idx) => {
              const isOn = !!checked[idx];
              return (
                <button
                  key={idx}
                  type="button"
                  className={`checklist-btn ${isOn ? 'checked' : ''}`}
                  onClick={() => setChecked((c) => ({ ...c, [idx]: !c[idx] }))}
                >
                  {isOn ? (
                    <CheckSquare size={17} style={{ flexShrink: 0 }} />
                  ) : (
                    <Square size={17} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                  )}
                  <span>
                    <strong style={{ fontFamily: 'var(--font-mono)', marginRight: 6 }}>
                      {String(idx + 1).padStart(2, '0')}.
                    </strong>
                    {text}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
};
