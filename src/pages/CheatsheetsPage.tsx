import React, { useState } from 'react';
import { CheckSquare, Square, RotateCcw } from 'lucide-react';

const TEXTURE_CONFIG_ROWS = [
  {
    type: '漫反射颜色图 (Base Color / Diffuse)',
    bit: '8-bit PNG / TGA',
    srgb: '✅ 必勾',
    comp: 'Default (DXT1 / BC1)',
    sampler: 'Color',
    vram2k: '2.67 MiB (含 Mip)',
    note: '桌面 Default 带有效 Alpha 时可能从 BC1 切换到 BC3；在目标平台查看实际像素格式。',
  },
  {
    type: '法线贴图 (Tangent Normal Map)',
    bit: '8-bit / 16-bit (高光曲面)',
    srgb: '❌ 严禁勾选',
    comp: 'Normalmap (BC5)',
    sampler: 'Normal',
    vram2k: '5.33 MiB (含 Mip)',
    note: 'BC5 量化 XY 后重建正半球 Z。用斜光验证 Y 方向是否需要 Flip Green Channel。',
  },
  {
    type: 'ORM 三合一打包贴图 (R=AO, G=粗糙, B=金属)',
    bit: '8-bit PNG / TGA',
    srgb: '❌ 严禁勾选',
    comp: 'Masks (no sRGB) [BC1]',
    sampler: 'Masks',
    vram2k: '2.67 MiB (含 Mip)',
    note: 'BC1 的绿色端点为 6 位，16 个纹素共享两端点，每个纹素各用一个索引；增加 Alpha 后按实际格式核算。',
  },
  {
    type: '未压缩单通道灰度（桌面 8-bit 示例）',
    bit: '8-bit 灰度',
    srgb: '❌ 严禁勾选',
    comp: 'Grayscale (G8，线性)',
    sampler: 'Linear Grayscale',
    vram2k: '5.33 MiB (含 Mip)',
    note: 'G8 每个纹素保留 1 字节。高精度高度数据另行选择并验证目标格式。',
  },
  {
    type: '单通道压缩遮罩',
    bit: '8-bit 灰度',
    srgb: '关闭',
    comp: 'Alpha (BC4)',
    sampler: 'Alpha',
    vram2k: '2.67 MiB (含 Mip)',
    note: '每个 4×4 块使用一对端点及每纹素索引，平滑梯度会有量化误差。',
  },
  {
    type: '高画质角色皮肤 / 鲜艳贴花 / 界面图标',
    bit: '8-bit PNG / TGA',
    srgb: '✅ 必勾',
    comp: 'BC7 (DX11+) 或 UserInterface2D',
    sampler: 'Color',
    vram2k: '5.33 MiB（BC7 全 mip）/ 16 MiB（RGBA8 单级）',
    note: 'BC7 每块 16 字节，支持 Alpha。锐利边缘质量与编码模式、块内颜色分布有关。',
  },
  {
    type: '环境天空球照明贴图 (HDRI Cubemap)',
    bit: '16/32-bit Float (.HDR / .EXR)',
    srgb: '❌ 线性浮点',
    comp: 'HDRCompressed (BC6H)',
    sampler: 'Linear Color',
    vram2k: '约 32 MiB（六面各 2K）',
    note: '真实记录 >1.0 的太阳能量，供 Lumen 与镜面环境反射使用',
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
    effect: '🌊 真实清澈水体',
    domainMode: 'Surface + Single Layer Water BSDF',
    coreNodes: '两路 Panner → 两次 Normal 采样 → 法线混合；WaterAlbedo / WaterExtinction 控介质，岸线遮罩 R 接 TopMaterialOpacity，白色表层形成岸沫',
    pitfall: 'Opaque 单层水用专用渲染通道，岸边白、深水黑；DepthFade 用于普通半透明雾片。',
  },
  {
    effect: '🍷 通透/磨砂水晶玻璃',
    domainMode: 'Surface + Translucent + Surface ForwardShading',
    coreNodes: '设置透射与 IOR，分别检查表面高光、背后物体偏移，以及接收面阴影。',
    pitfall: '彩色投影需要静态灯 + Lightmass，或 Path Tracer + Thin Translucent。Lumen 关卡可观察玻璃自身的反射与透射。',
  },
  {
    effect: '🌫️ 丁达尔光柱与翻涌毒雾',
    domainMode: 'Exponential Height Fog 启用 Volumetric Fog；另选 Local Fog Volume 或 Volume 材质',
    coreNodes: '局部均匀雾可放置 Local Fog Volume；带 3D 噪声的 Volume 材质可赋给 Niagara 雾粒子，设置半径、边界与消光。',
    pitfall: '低成本半透明烟雾卡片插地必连 DepthFade 抹平刀割硬切线',
  },
  {
    effect: '🌿 森林树叶与铁丝网镂空',
    domainMode: 'Surface + Masked + Two Sided Foliage / Slab MFP',
    coreNodes: '黑白镂空图连 Opacity Mask (阈值 0.333) + 背光透绿次表面散射 + 顶点微风 WPO',
    pitfall: '严禁整片森林用 Translucent 半透明，否则 Overdraw 爆红掉帧且排序穿帮',
  },
  {
    effect: '🔥 怪物烧蚀溶解与能量护盾',
    domainMode: '溶解用 Masked；护盾用 Translucent Additive',
    coreNodes: '溶解：Noise ≥ 进度输出 1，否则 0 → Opacity Mask；在保留侧用同一进度截取窄边 × 线性 HDR 发光；护盾：Fresnel + 反向 DepthFade',
    pitfall: '护盾穿墙自动亮圈靠的是 DepthFade 探测极近距离差',
  },
  {
    effect: '❄️ 滚石自动积雪与免 UV 墙体',
    domainMode: 'Surface + Opaque (Substrate Slab)',
    coreNodes: 'PixelNormalWS.B (世界朝天分量) → Clamp → Lerp 岩石与白雪；拉伸白盒用 WorldAlignedTexture',
    pitfall: '必须取世界空间法线 Z，取切线空间法线旋转石头时雪会跟着滚到肚子底下',
  },
  {
    effect: '玉石与车漆',
    domainMode: 'Surface / Substrate Slab 或 Vertical Layer',
    coreNodes: 'SSS MFP 按厘米输入，实验中的 10 mm 对应 1 cm；按散射模式提供厚度或薄表面设置。',
    pitfall: '固定光强比较正光和背光。清漆顶层需设置透射与层厚，保留底层反射。',
  },
  {
    effect: '实验性 Toon',
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

export const CheatsheetsPage: React.FC = () => {
  const [checked, setChecked] = useState<Record<number, boolean>>({});

  const doneCount = Object.values(checked).filter(Boolean).length;

  return (
    <main className="fullpage-scroll">
      <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div>
          <div className="breadcrumb-line">CHEATSHEETS & CHECKLIST · 案头实战速查手册</div>
          <h1 style={{ margin: '4px 0 6px', fontSize: 24, fontWeight: 800 }}>
            📋 UE 5.8 材质工程黄金速查表与上线自检单
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
            做项目时忘了压缩格式、快捷键或常见效果配方？打开这一页三秒钟对表即查。
          </p>
        </div>

        {/* Table 1 */}
        <section style={{ background: 'var(--bg-panel)', border: '1.5px solid var(--border-soft)', borderRadius: 14, padding: 18 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 800 }}>
            一、 UE 5.8 贴图导入黄金配置一表通（桌面 BC 路径，以 2048×2048 为基准）
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-strong)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>贴图用途类型</th>
                  <th style={{ padding: '8px 10px' }}>推荐源文件</th>
                  <th style={{ padding: '8px 10px' }}>sRGB 开关</th>
                  <th style={{ padding: '8px 10px' }}>UE 5.8 压缩设置 (底层格式)</th>
                  <th style={{ padding: '8px 10px' }}>2K 显存占用</th>
                  <th style={{ padding: '8px 10px' }}>核心避坑叮嘱</th>
                </tr>
              </thead>
              <tbody>
                {TEXTURE_CONFIG_ROWS.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: '9px 10px', fontWeight: 700 }}>{row.type}</td>
                    <td style={{ padding: '9px 10px', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{row.bit}</td>
                    <td style={{ padding: '9px 10px', fontWeight: 700 }}>{row.srgb}</td>
                    <td style={{ padding: '9px 10px', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{row.comp}</td>
                    <td style={{ padding: '9px 10px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{row.vram2k}</td>
                    <td style={{ padding: '9px 10px', color: 'var(--text-secondary)' }}>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Table 2 */}
        <section style={{ background: 'var(--bg-panel)', border: '1.5px solid var(--border-soft)', borderRadius: 14, padding: 18 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 800 }}>
            二、 材质编辑器左手黄金快捷键与 UE 5.8 核心节点速查
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(275px, 1fr))', gap: 10 }}>
            {SHORTCUT_NODES.map((item, idx) => (
              <div
                key={idx}
                style={{
                  background: 'var(--bg-card)',
                  border: '1.5px solid var(--border-soft)',
                  borderRadius: 10,
                  padding: '9px 11px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="inline-code-pill" style={{ margin: 0 }}>{item.node}</span>
                  <span className="kbd-chip" style={{ fontWeight: 700 }}>{item.key}</span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.desc}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="stage-controls-panel">
          <h2>实验结果怎样在引擎中复查</h2>
          <ul>
            <li>几何与法线：单面三角形由顶点绕序决定正反面。法线贴图 RGB 用 2 × RGB − 1 解码；中性法线指向切线空间 +Z。</li>
            <li>颜色与数据：sRGB 中灰 0.5 解码约为 0.214。粗糙度 0.5 应以线性 0.5 读取；比较时固定曝光、光源、清漆和其他参数。</li>
            <li>纹理过滤：Bilinear 在一级 mip 内插值，Trilinear 再混合相邻两级。正方形大纹理的全 mip 链约比基级多 1/3，移除这些级约节省全链的 1/4。</li>
            <li>照明：自定义 Lambert 可将世界空间的单位光向量作为参数。预览球的 Show Environment 控制背景，Use Sky Lighting 和 Sky Light Intensity 控制环境照明。F0 只描述正入射界面反射。</li>
            <li>缓存与 AO：用 primitive 的 WPO Disable Distance 检查远处的阴影缓存。Lumen 材质 AO 需要为它留出 GBuffer 空间，检查 Allow Static Lighting。</li>
            <li>性能：用 Platform Stats 报告编译后的指令和采样器，用 GPU 计时验证帧耗。2 的 N 次方只给出 N 个独立布尔参数的组合上限。</li>
          </ul>
        </section>

        {/* Table 3 */}
        <section style={{ background: 'var(--bg-panel)', border: '1.5px solid var(--border-soft)', borderRadius: 14, padding: 18 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 800 }}>
            三、 真实世界常见物质 PBR 物理校准参考值
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-strong)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>物质名称</th>
                  <th style={{ padding: '8px 10px' }}>外观参考色板 (sRGB Hex)</th>
                  <th style={{ padding: '8px 10px' }}>正入射 F0（线性，金属以 RGB 表示）</th>
                  <th style={{ padding: '8px 10px' }}>金属度 (Metallic)</th>
                  <th style={{ padding: '8px 10px' }}>日常粗糙度区间 (Roughness)</th>
                </tr>
              </thead>
              <tbody>
                {PBR_MATERIALS.map((m, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700 }}>{m.name}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        <span
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            background: m.hex,
                            border: '1.5px solid var(--border-strong)',
                            display: 'inline-block',
                          }}
                        />
                        {m.hex}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{m.f0}</td>
                    <td style={{ padding: '8px 10px' }}>{m.metal}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{m.rough}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Table 4 */}
        <section style={{ background: 'var(--bg-panel)', border: '1.5px solid var(--border-soft)', borderRadius: 14, padding: 18 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 800 }}>
            四、 水 / 玻璃 / 雾 / 植被等常见效果实现配方矩阵
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-strong)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>目标效果</th>
                  <th style={{ padding: '8px 10px' }}>材质域与混合/层板模式</th>
                  <th style={{ padding: '8px 10px' }}>节点与设置</th>
                  <th style={{ padding: '8px 10px' }}>头号防翻车要点</th>
                </tr>
              </thead>
              <tbody>
                {EFFECT_RECIPES.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: '9px 10px', fontWeight: 800, whiteSpace: 'nowrap' }}>{r.effect}</td>
                    <td style={{ padding: '9px 10px', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{r.domainMode}</td>
                    <td style={{ padding: '9px 10px' }}>{r.coreNodes}</td>
                    <td style={{ padding: '9px 10px', color: 'var(--text-secondary)' }}>{r.pitfall}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Interactive Checklist */}
        <section style={{ background: 'var(--bg-panel)', border: '2px solid var(--border-strong)', boxShadow: 'var(--shadow-brutal-lg)', borderRadius: 14, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>
                ✅ 生产级母材质提交前 10 项自检清单（已核对 {doneCount} / {CHECKLIST_ITEMS.length}）
              </h2>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                请在纹理资产、材质编辑器和关卡中逐项核对，再勾选对应项。
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {CHECKLIST_ITEMS.map((text, idx) => {
              const isOn = !!checked[idx];
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setChecked((c) => ({ ...c, [idx]: !c[idx] }))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    textAlign: 'left',
                    padding: '9px 12px',
                    borderRadius: 9,
                    border: '1.5px solid var(--border-soft)',
                    background: isOn ? 'var(--accent-sage)' : 'var(--bg-card)',
                    color: isOn ? 'var(--accent-sage-deep)' : 'var(--text-primary)',
                    fontSize: 13,
                    fontWeight: isOn ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {isOn ? <CheckSquare size={17} /> : <Square size={17} />}
                  <span>
                    {idx + 1}. {text}
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
