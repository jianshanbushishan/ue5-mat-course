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
  { key: 'UE 5.8 桥接', node: 'Substrate Metalness-To-DiffuseAlbedo-F0', desc: '把传统 BaseColor+Metallic 一键翻译成 Substrate 层板输入' },
  { key: '实例化零破批', node: 'PerInstanceRandom / PerInstanceCustomData', desc: 'ISM/HISM 共享 1 次 Draw Call 时，分别提供每实例 0~1 随机数与蓝图自定义浮点槽位' },
  { key: '单组件保合批', node: 'Custom Primitive Data (CPD)', desc: '勾选参数的 Use Custom Primitive Data，运行时零 MID 改参，彻底保住自动合批' },
  { key: '画质分级', node: 'QualitySwitch', desc: '按 Low / Medium / High / Epic 画质档位自动裁剪高耗节点分支' },
  { key: '远景淡出', node: 'CameraDepthFade / PerInstanceFadeAmount', desc: '按镜头距离或实例化剔除距离平滑淡出细节法线、WPO 或网格消隐' },
];

const VERIFY_NOTES = [
  { label: '几何与法线', body: '单面三角形由顶点绕序决定正反面。法线贴图 RGB 用 2 × RGB − 1 解码；中性法线指向切线空间 +Z。' },
  { label: '颜色与数据', body: 'sRGB 中灰 0.5 解码约为 0.214。粗糙度 0.5 应以线性 0.5 读取；比较时固定曝光、光源、清漆和其他参数。' },
  { label: '纹理过滤', body: 'Bilinear 在一级 mip 内插值，Trilinear 再混合相邻两级。正方形大纹理的全 mip 链约比基级多 1/3，移除这些级约节省全链的 1/4。' },
  { label: '照明环境', body: '自定义 Lambert 可将世界空间的单位光向量作为参数。预览球的 Show Environment 控制背景，Use Sky Lighting 和 Sky Light Intensity 控制环境照明。F0 只描述正入射界面反射。' },
  { label: '缓存与 AO', body: '用 primitive 的 WPO Disable Distance 检查远处的阴影缓存。Lumen 材质 AO 需要为它留出 GBuffer 空间，检查 Allow Static Lighting。' },
  { label: '性能统计', body: '用 Platform Stats 报告编译后的指令和采样器，用 GPU 计时验证帧耗。2 的 N 次方只给出 N 个独立布尔参数的组合上限。' },
  { label: '瓶颈与 Draw Call', body: '先在固定机位关锁帧运行 stat unit 锁定 Game / Draw / GPU 短板，再用 stat scenerendering 查 Mesh draw calls，用 ProfileGPU (Ctrl+Shift+,) 拆解各 Pass 毫秒。' },
  { label: 'LOD 与 Quad 检视', body: '用 Lit → Level of Detail Coloration → Mesh LODs 检查 Screen Size 切级节奏，用 Quad Overdraw 抓出远景微三角形白块。' },
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
    domainMode: '溶解用 Masked；护盾用 Additive（或 Translucent）',
    coreNodes: '溶解：Noise ≥ 进度输出 1，否则 0 → Opacity Mask（勾选 Two Sided）；保留侧截取窄边 × 线性 HDR 发光；护盾：Fresnel + 反向 DepthFade',
    pitfall: '护盾穿墙自动亮圈靠的是 DepthFade 探测极近距离差；护盾与溶解通常需勾选 Two Sided 避免背面消失。',
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
    coreNodes: 'SSS MFP 按厘米输入（10 mm = 1 cm）；车漆顶层清漆 Slab 设黑底色 + F0=0.04 + 低粗糙度 + 较大 SSS MFP（确保光线穿透到底层金属漆）。',
    pitfall: '固定光强比较正光和背光。清漆顶层若忘设 SSS MFP（默认 0），在 UE 5.8 中会变成不透明纯黑壳遮死底层金属漆。',
  },
  {
    effect: '实验性 Toon 风格化',
    domainMode: 'Substrate NPR / Blendable GBuffer',
    coreNodes: '启用 Substrate，项目 GBuffer Format 选 Blendable，按提示重启；创建 Toon Profile 并在 Toon BSDF 详情中指定，BaseColor 驱动表面色。',
    pitfall: '明暗色阶由 Profile 控制，节点以 BSDF 输出连 Front Material。',
  },
];

const PERF_TOOLS_MATRIX = [
  {
    category: '10 秒定瓶颈 (一级)',
    tool: 'stat unit / stat unitgraph',
    focus: 'Game / Draw / GPU / Frame (ms)',
    action: '按 Frame ≈ max(Game, Draw, GPU) 找木桶最短板；目标 60 FPS ≤ 16.67 ms。',
  },
  {
    category: '查派工单 (一级)',
    tool: 'stat scenerendering',
    focus: 'Mesh draw calls / Primitives',
    action: 'Draw 线程偏高时优先核查；通过合槽、HISM/Nanite、CPD 与剔除压降提交数。',
  },
  {
    category: '抓重材质/过绘制 (二级)',
    tool: 'Shader Complexity (Alt+8)',
    focus: '绿→黄→红→粉白热力色阶',
    action: '树叶改 Masked 收紧叶卡、限制多层半透明、合并贴图通道降采样次数。',
  },
  {
    category: '抓微三角形 (二级)',
    tool: 'Quad Overdraw & Mesh LODs',
    focus: '2×2 像素块废算白块 / 白红绿蓝 LOD 级',
    action: '远景发白说明缺 LOD 或 Screen Size 过晚；补多级 LOD 并在远景合槽去 WPO。',
  },
  {
    category: 'UE 5.8 层板体检 (二级)',
    tool: 'Substrate → Material Classification',
    focus: '单层板快道 vs 多层板慢道',
    action: '多层地形/污渍先混贴图数据再进单个 Slab；仅真实双层介质才叠多层板。',
  },
  {
    category: '毫秒级通道手术刀 (三级)',
    tool: 'ProfileGPU (Ctrl+Shift+,) / Insights',
    focus: 'BasePass / Shadow(VSM) / Translucency / Lumen',
    action: '哪个 Pass 毫秒最肥就治哪个通道；Shadow 肥查 WPO Disable Distance 与阴影投射。',
  },
];

const INSTANCING_LOD_MATRIX = [
  {
    tech: 'Auto-Instancing (自动合批)',
    scene: '少量散落同款静态网格',
    pros: '同 Mesh+同 Material 自动合批 Draw Call',
    watchout: '海量独立 Actor 仍拖垮 CPU 管理；循环建 MID 会直接破批。',
  },
  {
    tech: 'ISM (Instanced Static Mesh)',
    scene: '集中同屏显示的小物件集群（砖块/螺钉）',
    pros: '1 个组件极低 CPU + 1 次 Draw Call',
    watchout: '非 Nanite 下共用整体包围盒，不支持逐实例独立切 LOD。',
  },
  {
    tech: 'HISM (Hierarchical ISM)',
    scene: '大范围森林植被、草甸与散布场景',
    pros: '支持逐簇视锥裁剪 + 平滑独立切 LOD',
    watchout: '配合 PerInstanceRandom / PerInstanceCustomData 实现零破批差异化。',
  },
  {
    tech: 'HLOD (Hierarchical LOD)',
    scene: '开放世界远景整片街区/建筑群',
    pros: '数十栋建筑远景合并为 1 代理网格 = 1 Draw Call',
    watchout: '需提前离线构建 HLOD，注意过渡 Screen Size 与烘焙贴图色差。',
  },
  {
    tech: 'UE 5.8 Nanite (虚拟微多边形)',
    scene: '高模不透明/镂空建筑、雕塑、岩石与植被',
    pros: 'GPU 端连续 Cluster 切级，免手工 LOD 且大幅压缩几何 Draw Call',
    watchout: '半透明与部分特效仍走传统管线；过多不同母材质/开关变体会增 Shading Bins 开销。',
  },
];

const SHADER_PIPELINE_MATRIX = [
  {
    stage: '材质编译 & 变体审计',
    cmd: 'Window → HLSL Code / stat shadercompiling',
    focus: 'Usage Flags × Pass × 2^StaticSwitch 变体数',
    tip: '取消未用 Skeletal/Niagara/Spline Usage，禁用意外自动勾选，用 UBA 农场提速。',
  },
  {
    stage: '中间表示 (IR) 生态对照',
    cmd: 'DX12→DXIL · Vulkan→SPIR-V · Metal→AIR',
    focus: '前端常量折叠/DCE → 标准字节码 → 驱动译 ISA',
    tip: '引擎打包只编到字节码 IR，真正硬件 ISA（SASS/RDNA）由玩家显卡驱动生成。',
  },
  {
    stage: 'DDC 派生缓存架构',
    cmd: '右下角 Derived Data / Zen Storage / Cloud DDC',
    focus: 'Total Cache Hit Rate ≥ 95% · DDC Key 哈希',
    tip: '源资产进 Git/P4，派生数据进 DDC；改动 Common.ush 前先由夜间 CI 预热。',
  },
  {
    stage: 'PSO 异步预热与治卡',
    cmd: 'r.PSOPrecaching=1 / r.PSOPrecache.Validation=2 / stat pso',
    focus: 'Insights 查 RHI 线程 CreateGraphicsPipelineState',
    tip: '清本机显卡驱动缓存后跑实机验收；过场动画可叠加 Bundled .spc 双保险。',
  },
  {
    stage: 'Shader 源码级调试与抓帧',
    cmd: 'RenderDoc (Alt+F12) / r.Shaders.Symbols=1 / Optimize=0',
    focus: 'GBuffer 原值 · Pixel History · NaN 毒像素单步',
    tip: '用 SafeNormalize 与 max(x,1e-4) 防 NaN；排错完毕务必还原 Optimize=1！',
  },
  {
    stage: 'Warp 分支与 VGPR 硬件优化',
    cmd: 'AMD RGP / NVIDIA Nsight Graphics',
    focus: '32/64 线程锁步发散 · VGPR 占用率 (Occupancy)',
    tip: '短算术用 Lerp、静态用 Static Switch；x*x 替 pow(x,2)、善用 Half 精度减寄存器。',
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
  '小摆件与高频重复资产已将材质槽精简至 1~2 槽，小碎物取消不必要 Cast Shadow 并配置合理的剔除距离。',
  '海量同类物件已用 HISM / ISM / Nanite 组织，批量差异化改参采用 PerInstanceRandom / CustomData / CPD，未循环批量建 MID。',
  '非 Nanite 网格已配置按 Screen Size 切换的多级 LOD，远景 LOD 已简化材质槽并关闭 WPO（且设好 WPO Disable Distance），Quad Overdraw 无异常白块。',
  '已在固定机位、解除锁帧下实测记录 stat unit（Game / Draw / GPU）、Mesh draw calls 与 ProfileGPU，确认无木桶短板超标。',
  '已清理母材质中未使用的 Material Usage Flags（如误勾的 Skeletal / Niagara / Spline），控制 ShaderMap 变体数量。',
  '团队已验证 Zen / Shared DDC 命中率正常（≥95%），未将 Saved / Intermediate / Local DDC 误提交进版本库。',
  '发版工程已启用 Share Material Shader Code 与 r.PSOPrecaching=1，并在清空驱动缓存后经 Unreal Insights 验收无明显 PSO 卡顿尖峰。',
  '已用 RenderDoc / SafeNormalize 排查潜在 NaN 毒像素与高频动态 If 分支发散，且本地排错后已还原 r.Shaders.Optimize=1 并关闭调试符号导出。',
];

const SECTION_ANCHORS = [
  { id: 'sheet-textures', label: '01 贴图导入配置' },
  { id: 'sheet-shortcuts', label: '02 快捷键与核心节点' },
  { id: 'sheet-verify', label: '03 引擎复查指南' },
  { id: 'sheet-pbr', label: '04 PBR 物理参考值' },
  { id: 'sheet-recipes', label: '05 效果实现配方' },
  { id: 'sheet-perf', label: '06 性能、实例化与 LOD 决策' },
  { id: 'sheet-shader-pipe', label: '07 编译、IR、DDC、PSO 与调试' },
  { id: 'sheet-checklist', label: '08 上线 18 项自检单' },
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
                  <th>采样器类型 (Sampler)</th>
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
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, whiteSpace: 'nowrap', color: 'var(--brand-primary)', fontWeight: 600 }}>
                      {row.sampler}
                    </td>
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

        {/* Section 06: Performance, Instancing & LOD Matrix */}
        <section id="sheet-perf" className="sheet-section">
          <h2 className="sheet-section-title">
            <span className="sheet-section-num">06</span>
            UE 5.8 性能诊断命令、GPU 实例化与 LOD 选型决策矩阵
          </h2>
          <div className="sheet-table-wrap" style={{ marginBottom: 14 }}>
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>体检层级</th>
                  <th>命令 / 视口路径</th>
                  <th>核心关注指标</th>
                  <th>对症优化方向</th>
                </tr>
              </thead>
              <tbody>
                {PERF_TOOLS_MATRIX.map((row, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{row.category}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--brand-primary)', fontWeight: 600 }}>{row.tool}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{row.focus}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sheet-table-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>合批 / 细节技术</th>
                  <th>最佳适用场景</th>
                  <th>核心性能收益</th>
                  <th>边界与避坑叮嘱</th>
                </tr>
              </thead>
              <tbody>
                {INSTANCING_LOD_MATRIX.map((row, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{row.tech}</td>
                    <td>{row.scene}</td>
                    <td style={{ color: 'var(--accent-sage-deep)', fontWeight: 600 }}>{row.pros}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{row.watchout}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 07: Shader Compilation, IR, DDC, PSO & Hardware Debug/Opt Matrix */}
        <section id="sheet-shader-pipe" className="sheet-section">
          <h2 className="sheet-section-title">
            <span className="sheet-section-num">07</span>
            Shader 编译、中间表示（IR）、DDC、PSO 与底层调试优化速查矩阵
          </h2>
          <div className="sheet-table-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>工程环节</th>
                  <th>核心命令 / 格式 / 工具</th>
                  <th>重点关注指标</th>
                  <th>生产级实战口诀</th>
                </tr>
              </thead>
              <tbody>
                {SHADER_PIPELINE_MATRIX.map((row, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{row.stage}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--brand-primary)', fontWeight: 600 }}>{row.cmd}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{row.focus}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{row.tip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 08: Interactive Pre-Flight Checklist */}
        <section id="sheet-checklist" className="sheet-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="sheet-section-title" style={{ marginBottom: 4 }}>
                <span className="sheet-section-num">08</span>
                生产级母材质、渲染性能与 Shader/PSO 提交前 {CHECKLIST_ITEMS.length} 项自检清单
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
