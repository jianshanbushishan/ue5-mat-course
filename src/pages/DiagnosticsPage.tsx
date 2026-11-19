import React, { useState, useEffect, useRef } from 'react';
import { Wrench, ArrowUpRight, CheckCircle2, AlertTriangle, Search, Zap, Lightbulb, Stethoscope } from 'lucide-react';
import { DifficultyLevel } from '../types/course';
import { FormattedText } from '../components/ui/StageWidgets';
import { clamp, linearToSrgb, srgbToLinear, shadePbrPixel, norm3, fbm } from '../lib/graphics';

import { previewBlocks } from '../lib/blockPreview';

interface DiagnosticCase {
  id: string;
  number: string;
  difficulty: DifficultyLevel;
  title: string;
  symptom: string;
  wrongConfig: string;
  rootCause: string;
  fixPrescription: string;
  mnemonic: string;
  lessonId: string;
  lessonLabel: string;
  renderMode:
    | 'srgb_off_color'
    | 'srgb_on_roughness'
    | 'normal_green_flip'
    | 'decal_wrap_streak'
    | 'npot_no_mip'
    | 'bc1_normal_blocky'
    | 'ao_mul_basecolor'
    | 'fake_yellow_gold'
    | 'substrate_front_mat'
    | 'glass_no_forward'
    | 'water_hard_seam'
    | 'exceed_16_samplers';
}

const CASES: DiagnosticCase[] = [
  {
    id: 'diag-01',
    number: 'CASE 01',
    difficulty: '零基础',
    title: '粉笔灰惨白木箱：颜色贴图进引擎像蒙了一层白雾',
    symptom: '在修图软件里木纹颜色浓郁自然，导进 UE 5.8 连上材质后，整个木箱像晒褪色了二十年一样发白发灰，毫无质感。',
    wrongConfig: '木纹颜色贴图面板中误取消了 `sRGB` 勾选（按线性原值直接读取）。',
    rootCause: '这张木纹存成了 sRGB 颜色。关闭 sRGB 后，中间调被当作较大的线性值参与光照，再经显示编码，画面变亮。',
    fixPrescription: '双击打开木纹颜色贴图，在 `Texture` 栏勾选 `✓ sRGB`，材质内采样节点确保 `Sampler Type = Color`。',
    mnemonic: '按颜色文件的编码选择 sRGB。',
    lessonId: 'ue58-srgb-golden-rule',
    lessonLabel: '3.3 UE 5.8 贴图 sRGB 第一铁律',
    renderMode: 'srgb_off_color',
  },
  {
    id: 'diag-02',
    number: 'CASE 02',
    difficulty: '零基础',
    title: '暴雨泼油石板地：明明画了五成粗糙，进引擎亮如溜冰场',
    symptom: '美术画了一张中灰（`0.5`）粗糙度贴图想表现半哑光干水泥，进 UE 5.8 后地面反光刺眼，像刚泼了一层清漆。',
    wrongConfig: '粗糙度单通道图或 `ORM` 打包贴图保留了默认的 `✓ sRGB` 勾选。',
    rootCause: '粗糙度图存的是线性数据。误勾 sRGB 后，0.5 经标准 sRGB 解码约为 0.214，高光会收紧。',
    fixPrescription: '取消数据贴图的 `sRGB` 勾选（若是 ORM 贴图，直接将 `Compression Settings` 设为 `Masks (no sRGB)` 一键搞定）。',
    mnemonic: '用同一光照和清漆设置比较粗糙度。',
    lessonId: 'ue58-srgb-golden-rule',
    lessonLabel: '3.3 UE 5.8 贴图 sRGB 第一铁律',
    renderMode: 'srgb_on_roughness',
  },
  {
    id: 'diag-03',
    number: 'CASE 03',
    difficulty: '零基础',
    title: '颠倒的陨石坑：太阳从头顶照，弹坑上半截反而发亮像鼓包',
    symptom: '从网上下载或 Blender 导出的石板法线贴图放进场景，旋转灯光时阴影方向上下完全反了，凹坑看久了像往外凸的包。',
    wrongConfig: '将 OpenGL 标准（`Y+` 绿通道向上）法线贴图直接用于 DirectX 标准（`Y-` 绿通道向下）的 UE 5.8。',
    rootCause: '两大图形阵营对法线贴图绿色通道（上下竖轴 Y）的正方向规定相反，导致小牙签上下歪斜方向彻底颠倒。',
    fixPrescription: '无需回 PS 重导！直接在 UE 5.8 纹理编辑器中勾选 `✓ Flip Green Channel（翻转绿通道）` 保存即可。',
    mnemonic: '光照上下反、凹坑变鼓包，一秒勾选翻转绿通道！',
    lessonId: 'normal-map-bc5-z-rebuild',
    lessonLabel: '6.3 法线贴图全解密与绿通道翻转',
    renderMode: 'normal_green_flip',
  },
  {
    id: 'diag-04',
    number: 'CASE 04',
    difficulty: '零基础',
    title: '贯穿走廊的十字血迹：弹孔贴花四周拉出无限长条纹',
    symptom: '往墙上贴一个圆形弹孔或污渍贴花，如果缩放 UV 想把弹孔调小一点，墙面上要么铺满几十个弹孔，要么拉出横竖两条长彩带。',
    wrongConfig: '寻址模式留在了默认 `Wrap`（循环），或改了 `Clamp` 但贴图最外圈 1 像素画到了颜色没留空。',
    rootCause: '`Wrap` 会在越过 `0~1` 后无限循环平铺；`Clamp` 会把最边缘那 1 排纹素的颜色向无穷远处死死拉长延伸！',
    fixPrescription: '将贴花 X/Y 寻址设为 Clamp，并把外圈的 Alpha 或所用遮罩清零。保留邻近边缘色用于过滤，检查缩小时的 mip；只涂黑且 Alpha=1 会出现黑条。',
    mnemonic: 'Clamp 延伸边缘纹素，透明度由实际接入的通道决定。',
    lessonId: 'texel-uv-tiling-wrap-clamp',
    lessonLabel: '5.1 纹素采样与 Wrap/Clamp 寻址',
    renderMode: 'decal_wrap_streak',
  },
  {
    id: 'diag-05',
    number: 'CASE 05',
    difficulty: '进阶',
    title: '远景广场蚂蚁乱爬：高清地砖镜头一动满屏闪烁噪点',
    symptom: '美术直接截了一张 `3000 × 2000` 的超清细砖图铺在广场上，近看很清楚，可镜头一往远处拉就开始疯狂闪雪花噪点。',
    wrongConfig: '导入非二次幂贴图后沿用了默认 NoMipmaps。',
    rootCause: '远处一个屏幕像素覆盖许多纹素。仍在基级取样时，相机轻微移动就可能跨过多条砖缝。',
    fixPrescription: '在纹理资产中将 Mip Gen Settings 从 NoMipmaps 改为 SimpleAverage，保存后检查 mip 列表。普通流送需要二次幂尺寸；BC 压缩还需顶层宽高是 4 的倍数。',
    mnemonic: '分别核查 mip、流送、压缩对齐。',
    lessonId: 'mipmap-pyramid-moire',
    lessonLabel: '5.3 Mipmap 套娃缩略图与摩尔纹救星',
    renderMode: 'npot_no_mip',
  },
  {
    id: 'diag-06',
    number: 'CASE 06',
    difficulty: '进阶',
    title: '绿紫马赛克怪脸：角色细腻法线凑近看全是 4×4 方块锯齿',
    symptom: '高模烘焙出来的细腻皮肤法线导进引擎，凑近高光区一看全是绿紫色相间的 `4×4` 粗糙马赛克硬块。',
    wrongConfig: '导入时未被识别为法线，压缩设置留在了默认的 `Default (DXT1 / BC1)`。',
    rootCause: '`BC1` 强迫红绿蓝三个通道在 `4×4` 小格里共用同一对代表色，红（X方向）和绿（Y方向）互相串色打架，法线方向被严重污染！',
    fixPrescription: '将纹理设为 Normalmap、关闭 sRGB，在桌面 BC5 路径分别压缩 XY，采样时从解码的 XY 重建正半球 Z。斜光下复查压缩造成的角度误差。',
    mnemonic: '法线专用 BC5 双独立通道，告别绿紫串色马赛克！',
    lessonId: 'bc1-to-bc7-microscope',
    lessonLabel: '6.2 钻进 4×4 小方格看 BC1~BC7 伪影',
    renderMode: 'bc1_normal_blocky',
  },
  {
    id: 'diag-07',
    number: 'CASE 07',
    difficulty: '进阶',
    title: '手电筒照不亮的死黑墙角：暗缝像涂了洗不掉的黑油漆',
    symptom: '夜战关卡里玩家举起强光战术手电筒直照石雕凹缝，周围全照亮了，唯独凹缝里依然死黑一片，假得像画上去的黑线。',
    wrongConfig: '在材质连线里直接拿 `BaseColor × AO（环境光遮蔽贴图）` 送入漫反射颜色口。',
    rootCause: '`AO` 的物理意义仅仅是“四面八方的环境散射光进不去”，绝不该阻挡直射强光！乘死在固有色上就变成了永久吸光的黑油漆。',
    fixPrescription: '将 AO 单独连入 Ambient Occlusion。在 Lumen 项目里要使用材质 AO，关闭项目设置 Allow Static Lighting，按提示重启并让着色器重新编译。',
    mnemonic: 'AO 只挡环境光不挡手电筒，千万别乘死在颜色上！',
    lessonId: 'ambient-occlusion-deep-dive',
    lessonLabel: '7.4 环境光遮蔽（AO）全链路拆解',
    renderMode: 'ao_mul_basecolor',
  },
  {
    id: 'diag-08',
    number: 'CASE 08',
    difficulty: '进阶',
    title: '雾蒙蒙的假黄塑料：想调纯金雕像却怎么拉都不像金属',
    symptom: '把颜色调成金黄色，为了更亮还把 `Specular` 狂拉到 `1.0`，结果出来的像一块廉价的黄色塑料肥皂，毫无黄金厚重倒影。',
    wrongConfig: '`Metallic（金属度）` 忘在了默认的 `0`，误以为拉高 `Specular` 就能变金属。',
    rootCause: '传统金属度工作流中，非金属的 Specular 只调正入射 F0，默认 0.5 对应约 4%，拉到 1 对应约 8%。斜视时反射随角度变化。裸金属用 Base Color 指定有色镜面反射。',
    fixPrescription: '将 `Metallic` 设为 `1.0`，`Specular` 保持默认不用动，用较低的 `Roughness (0.1~0.25)` 并确保场景有环境天空光可反射。',
    mnemonic: '真金属靠 Metallic=1 清零漫反射并给镜面染色！',
    lessonId: 'metallic-workflow-three-laws',
    lessonLabel: '8.3 金属度工作流三大铁律',
    renderMode: 'fake_yellow_gold',
  },
  {
    id: 'diag-09',
    number: 'CASE 09',
    difficulty: '实战',
    title: '照着层板教程操作，新建材质为什么还显示 Base Color？',
    symptom: '新项目已启用 Substrate，新建材质却显示传统根节点；手动切到层板工作流后又没有连好 Front Material。',
    wrongConfig: '把项目的 Substrate 渲染设置当成了材质资产的节点布局。',
    rootCause: 'UE 5.8 的普通新材质可以沿用传统根节点输入，编译时转换。图中的故障模拟的是显式层板图缺少 BSDF 连接。',
    fixPrescription: '传统图可直接使用。要对照层板教程，先在材质副本上右键根节点选择 Convert to Substrate，再将 Slab 的 BSDF 输出接 Front Material。',
    mnemonic: '先识别根节点布局，再检查 BSDF 连接。',
    lessonId: 'ue58-substrate-slab-bridge',
    lessonLabel: '8.4 拥抱 UE 5.8 默认核心 Substrate',
    renderMode: 'substrate_front_mat',
  },
  {
    id: 'diag-10',
    number: 'CASE 10',
    difficulty: '实战',
    title: '灰塑料膜幽灵杯：半透明玻璃杯死气沉沉没有一丝反光高光',
    symptom: '新建半透明材质把不透明度降到 `0.2`，做出来的玻璃杯像一团半透明白雾，杯壁上完全看不到窗户和灯光的清亮反光。',
    wrongConfig: '混合模式设为 `Translucent` 后，左下角 `Translucency -> Lighting Mode` 留在了默认的低配体积无方向模式。',
    rootCause: 'Volumetric NonDirectional 不提供本例所需的表面高光。表面反射取决于所选半透明照明模式和场景灯光。',
    fixPrescription: '选 Surface ForwardShading，在有反射环境和直射灯的关卡检查玻璃高光。若要让地面接收彩窗阴影，使用静态灯配合 Lightmass，或在 Path Tracer 中使用 Thin Translucent。',
    mnemonic: '分别验证玻璃自身的表面高光与接收物上的彩影。',
    lessonId: 'effect-glass-refraction',
    lessonLabel: '10.2 清透玻璃与折射实现',
    renderMode: 'glass_no_forward',
  },
  {
    id: 'diag-11',
    number: 'CASE 11',
    difficulty: '实战',
    title: '单层水的白沫离开了岸边，雾片插地留下硬线',
    symptom: '水池平面与斜坡沙滩交界处、或者半透明云雾卡片插进地面处，留下一条像拿尺子比着切出来的生硬直线。',
    wrongConfig: '给单层水套用普通半透明的深度淡出，或将淡出因子直接当作泡沫覆盖率。',
    rootCause: '单层水使用专用通道。普通半透明 DepthFade 在交界为零，沿远离交界的方向增大。',
    fixPrescription: '单层水使用绘制的岸线遮罩（岸边白、深水黑），将 R 接水体 BSDF 的 TopMaterialOpacity，BaseColor 设白色，Roughness 从 0.1 开始。半透明雾片则将原 Opacity 接入 DepthFade，再用输出控制覆盖。',
    mnemonic: '水体用岸线遮罩布置白沫，半透明雾片用 DepthFade 淡出。',
    lessonId: 'effect-single-layer-water',
    lessonLabel: '10.1 单层水与岸线白沫',
    renderMode: 'water_hard_seam',
  },
  {
    id: 'diag-12',
    number: 'CASE 12',
    difficulty: '实战',
    title: '地形材质爆红罢工：`[SM5] Error: Exceeded 16 samplers`',
    symptom: '多层地形的目标 SM5 平台材质统计报告独立采样器超出预算，编译失败。',
    wrongConfig: '多张寻址与过滤要求相同的纹理在此平台使用了独立采样器。',
    rootCause: '纹理读取次数、纹理数与独立采样器槽位是三种统计。具体余量还取决于平台及引擎通道。',
    fixPrescription: '先看 Platform Stats。仅对允许相同过滤和重复寻址的采样选 Shared: Wrap；需要夹紧的纹理可在支持的平台使用 Shared: Clamp，自定义过滤继续使用资产设置。重新编译并查看实际槽位。',
    mnemonic: '按寻址、过滤和平台分组共享，读取次数单独看。',
    lessonId: 'shader-complexity-shared-wrap',
    lessonLabel: '9.4 材质体检与 Shared: Wrap 救星',
    renderMode: 'exceed_16_samplers',
  },
];

const CasePreviewCanvas: React.FC<{ mode: DiagnosticCase['renderMode']; fixed: boolean }> = ({
  mode,
  fixed,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const img = ctx.createImageData(w, h);
    const data = img.data;

    const L = norm3([0.45, 0.65, 0.62]);
    const V: [number, number, number] = [0, 0, 1];

    let compressedNormals: Float32Array | undefined;
    if (mode === 'bc1_normal_blocky') {
      const source = new Float32Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const u = x / w, v = y / h;
          const nx = 0.46 * Math.sin(u * 51 + v * 19);
          const ny = 0.52 * Math.cos(v * 47 - u * 33);
          const nz = Math.sqrt(1 - nx * nx - ny * ny);
          source.set([(1 + nx) / 2, (1 + ny) / 2, (1 + nz) / 2, 1], (y * w + x) * 4);
        }
      }
      compressedNormals = previewBlocks(source, w, h, fixed ? 'BC5' : 'BC1', true);
    }

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const u = px / w;
        const v = py / h;
        let r = 0.14;
        let g = 0.13;
        let b = 0.12;

        if (mode === 'decal_wrap_streak') {
          // Brick wall + bullet decal
          const brick = 0.42 + 0.12 * fbm(u * 14, v * 14, 2);
          r = brick * 0.78;
          g = brick * 0.64;
          b = brick * 0.54;
          const du = (u - 0.5) * 3.2 + 0.5;
          const dv = (v - 0.5) * 3.2 + 0.5;
          let su = du;
          let sv = dv;
          if (!fixed) {
            // Clamp with dirty border pixel causing cross streaks!
            su = clamp(du, 0, 1);
            sv = clamp(dv, 0, 1);
            const dist = Math.hypot(su - 0.5, sv - 0.5);
            const borderHit = su <= 0.02 || su >= 0.98 || sv <= 0.02 || sv >= 0.98;
            const edgeStreak = borderHit && (Math.abs(du - 0.5) < 0.22 || Math.abs(dv - 0.5) < 0.22);
            if (dist < 0.34 || edgeStreak) {
              r = 0.72;
              g = 0.12;
              b = 0.1;
            }
          } else {
            if (du >= 0.03 && du <= 0.97 && dv >= 0.03 && dv <= 0.97) {
              const dist = Math.hypot(du - 0.5, dv - 0.5);
              if (dist < 0.34) {
                const k = clamp((0.34 - dist) * 5, 0, 1);
                r = r * (1 - k) + 0.72 * k;
                g = g * (1 - k) + 0.12 * k;
                b = b * (1 - k) + 0.1 * k;
              }
            }
          }
        } else if (mode === 'npot_no_mip') {
          if (v < 0.35) {
            r = 0.58;
            g = 0.72;
            b = 0.9;
          } else {
            const depth = 1 / Math.max(0.04, v - 0.33);
            const tx = (u - 0.5) * depth * 18;
            const ty = depth * 12;
            // Box-filter this same checker pattern over its screen-pixel footprint.
            const footprintX = depth * 18 / w;
            const footprintY = Math.max(0.001, depth * depth * 12 / h);
            const integral = (t: number) => {
              const period = t - 2 * Math.floor(t / 2);
              return period <= 1 ? period : 2 - period;
            };
            const average = (t: number, width: number) =>
              (integral(t + width / 2) - integral(t - width / 2)) / width;
            const signal = fixed ? average(tx, footprintX) * average(ty, footprintY)
              : ((Math.floor(tx) + Math.floor(ty)) & 1) ? -1 : 1;
            const val = 0.55 + 0.26 * signal;
            r = val * 0.95; g = val * 0.86; b = val * 0.76;
          }
        } else if (mode === 'water_hard_seam') {
          const groundY = 0.32 + u * 0.52;
          const waterY = 0.56;
          if (v > groundY) {
            r = 0.76;
            g = 0.68;
            b = 0.52;
          } else {
            r = 0.68;
            g = 0.8;
            b = 0.94;
          }
          if (v >= waterY && v <= groundY) {
            const shoreMask = 1 - clamp((groundY - waterY) / 0.08, 0, 1);
            if (!fixed) {
              r = r * 0.35 + 0.12 * 0.65;
              g = g * 0.35 + 0.48 * 0.65;
              b = b * 0.35 + 0.88 * 0.65;
              if (Math.abs(groundY - waterY) < 0.025) {
                r = 0.05;
                g = 0.25;
                b = 0.75;
              }
            } else {
              // A painted shoreline mask varies from white at the shore to black offshore.
              r = 0.06 + shoreMask * 0.74;
              g = 0.44 + shoreMask * 0.41;
              b = 0.65 + shoreMask * 0.24;
            }
          }
        } else if (mode === 'exceed_16_samplers' || mode === 'substrate_front_mat') {
          if (!fixed) {
            // Default gray world grid / error checkerboard
            const chk = ((Math.floor(px / 14) + Math.floor(py / 14)) & 1) ? 0.32 : 0.18;
            r = mode === 'exceed_16_samplers' ? chk + 0.22 : chk;
            g = chk;
            b = mode === 'substrate_front_mat' ? chk + 0.18 : chk;
          } else {
            const nx = (u - 0.5) * 2.5;
            const ny = (0.5 - v) * 1.9;
            const r2 = nx * nx + ny * ny;
            if (r2 < 0.72) {
              const nz = Math.sqrt(0.72 - r2);
              const N = norm3([nx, ny, nz]);
              const grass = fbm(u * 8, v * 8, 3);
              const col = shadePbrPixel({
                N,
                V,
                L,
                baseColorLinear: mode === 'exceed_16_samplers'
                  ? [0.12 + grass * 0.18, 0.36 + grass * 0.15, 0.09]
                  : [0.78, 0.38, 0.14],
                metallic: mode === 'substrate_front_mat' ? 0.92 : 0.0,
                roughness: mode === 'substrate_front_mat' ? 0.22 : 0.68,
              });
              [r, g, b] = col;
            }
          }
        } else {
          // 3D Sphere / Crater preview
          const aspect = w / h;
          const sx = (u - 0.5) * 2 * aspect;
          const sy = (0.5 - v) * 2;
          const r2 = sx * sx + sy * sy;
          if (r2 <= 0.78) {
            const sz = Math.sqrt(0.78 - r2);
            let N = norm3([sx, sy, sz]);

            if (mode === 'srgb_off_color') {
              const grain = 0.45 + 0.22 * Math.sin(sx * 16 + fbm(sx * 5, sy * 5, 2) * 4);
              const srgbWood: [number, number, number] = [grain * 0.85, grain * 0.52, grain * 0.28];
              const baseLinear: [number, number, number] = fixed
                ? [srgbToLinear(srgbWood[0]), srgbToLinear(srgbWood[1]), srgbToLinear(srgbWood[2])]
                : srgbWood; // Forgot sRGB -> treated as linear directly, then encoded again at output!
              [r, g, b] = shadePbrPixel({ N, V, L, baseColorLinear: baseLinear, metallic: 0, roughness: 0.62 });
            } else if (mode === 'srgb_on_roughness') {
              const intendedRough = 0.5;
              const actualRough = fixed ? intendedRough : srgbToLinear(intendedRough); // ~0.25 shiny!
              [r, g, b] = shadePbrPixel({
                N,
                V,
                L: norm3([0.25, 0.55, 0.8]),
                baseColorLinear: [0.22, 0.22, 0.24],
                metallic: 0,
                roughness: actualRough,
              });
            } else if (mode === 'normal_green_flip') {
              const d = Math.hypot(sx, sy);
              const craterSlope = d < 0.46 ? Math.sin((d / 0.46) * Math.PI) * 0.75 : 0;
              const dirX = d > 1e-4 ? (sx / d) * craterSlope : 0;
              const dirY = d > 1e-4 ? (sy / d) * craterSlope * (fixed ? 1 : -1) : 0;
              N = norm3([-dirX, -dirY, 1]);
              [r, g, b] = shadePbrPixel({
                N,
                V,
                L: norm3([0.0, 0.78, 0.62]),
                baseColorLinear: [0.35, 0.33, 0.3],
                metallic: 0,
                roughness: 0.55,
              });
            } else if (mode === 'bc1_normal_blocky' && compressedNormals) {
              const index = (py * w + px) * 4;
              N = norm3([2 * compressedNormals[index] - 1, 2 * compressedNormals[index + 1] - 1, 2 * compressedNormals[index + 2] - 1]);
              [r, g, b] = shadePbrPixel({
                N,
                V,
                L,
                baseColorLinear: [0.58, 0.36, 0.28],
                metallic: 0.1,
                roughness: 0.32,
              });
            } else if (mode === 'ao_mul_basecolor') {
              const groove = Math.exp(-Math.pow(sx * 5.5, 2));
              const ao = 1 - groove * 0.88;
              const flashlight = Math.exp(-(sx * sx + sy * sy) * 6.5) * 3.4;
              const base: [number, number, number] = [0.52, 0.46, 0.38];
              if (!fixed) {
                // AO baked into BaseColor -> even strong direct flashlight stays pitch black in groove!
                const lit = (base[0] * ao) * (0.18 + flashlight);
                r = linearToSrgb(clamp(lit, 0, 1));
                g = linearToSrgb(clamp(lit * 0.92, 0, 1));
                b = linearToSrgb(clamp(lit * 0.82, 0, 1));
              } else {
                // AO only dims ambient 0.18, direct flashlight illuminates the groove cleanly!
                const lit = base[0] * (0.18 * ao + flashlight);
                r = linearToSrgb(clamp(lit, 0, 1));
                g = linearToSrgb(clamp(lit * 0.92, 0, 1));
                b = linearToSrgb(clamp(lit * 0.82, 0, 1));
              }
            } else if (mode === 'fake_yellow_gold') {
              [r, g, b] = shadePbrPixel({
                N,
                V,
                L,
                baseColorLinear: [0.94, 0.68, 0.16],
                metallic: fixed ? 1.0 : 0.0,
                roughness: 0.2,
                specularLevel: 1.0,
              });
            } else if (mode === 'glass_no_forward') {
              const bgStripe = ((Math.floor(u * 12) + Math.floor(v * 8)) & 1) ? [0.85, 0.42, 0.28] : [0.24, 0.58, 0.78];
              if (!fixed) {
                // Flat milky film without specular or fresnel
                r = bgStripe[0] * 0.65 + 0.26;
                g = bgStripe[1] * 0.65 + 0.27;
                b = bgStripe[2] * 0.65 + 0.28;
              } else {
                const fresnel = 0.06 + 0.94 * Math.pow(1 - Math.max(0, dot3Local(N, V)), 4);
                const refractU = clamp(u - N[0] * 0.12, 0, 1);
                const refractV = clamp(v + N[1] * 0.12, 0, 1);
                const rBg = ((Math.floor(refractU * 12) + Math.floor(refractV * 8)) & 1)
                  ? [0.85, 0.42, 0.28]
                  : [0.24, 0.58, 0.78];
                const spec = shadePbrPixel({
                  N,
                  V,
                  L,
                  baseColorLinear: [0.95, 0.98, 1.0],
                  metallic: 1,
                  roughness: 0.06,
                });
                const mix = clamp(fresnel * 0.85, 0.08, 0.95);
                r = clamp(rBg[0] * (1 - mix) + spec[0] * mix, 0, 1);
                g = clamp(rBg[1] * (1 - mix) + spec[1] * mix, 0, 1);
                b = clamp(rBg[2] * (1 - mix) + spec[2] * mix, 0, 1);
              }
            }
          } else if (mode === 'glass_no_forward') {
            const bgStripe = ((Math.floor(u * 12) + Math.floor(v * 8)) & 1) ? [0.85, 0.42, 0.28] : [0.24, 0.58, 0.78];
            [r, g, b] = bgStripe as [number, number, number];
          }
        }

        const idx = (py * w + px) * 4;
        data[idx] = Math.round(clamp(r, 0, 1) * 255);
        data[idx + 1] = Math.round(clamp(g, 0, 1) * 255);
        data[idx + 2] = Math.round(clamp(b, 0, 1) * 255);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [mode, fixed]);

  return (
    <div className="diag-canvas-wrap">
      <canvas
        ref={canvasRef}
        width={220}
        height={132}
        style={{
          width: '100%',
          height: 142,
          objectFit: 'cover',
          display: 'block',
        }}
      />
      <span className={`diag-status-badge ${fixed ? 'fixed' : 'fault'}`}>
        {fixed ? 'FIXED · 正确配置' : 'FAULT · 翻车现象'}
      </span>
      {mode === 'exceed_16_samplers' && !fixed && (
        <div
          style={{
            position: 'absolute',
            inset: 8,
            background: 'rgba(120, 18, 18, 0.88)',
            color: '#fee2e2',
            borderRadius: 7,
            padding: '8px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <strong>[SM5] Error: Exceeded 16 samplers!</strong>
          <span>Samplers used: 18 / 16 max</span>
        </div>
      )}
      {mode === 'substrate_front_mat' && !fixed && (
        <div
          style={{
            position: 'absolute',
            inset: 8,
            background: 'rgba(42, 27, 78, 0.88)',
            color: '#ede9fe',
            borderRadius: 7,
            padding: '8px 10px',
            fontSize: 11.5,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <strong>Front Material 未连接层板节点</strong>
          <span>需接入 Substrate Slab BSDF</span>
        </div>
      )}
    </div>
  );
};

function dot3Local(a: [number, number, number], b: [number, number, number]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export const DiagnosticsPage: React.FC<{
  onJumpToLesson: (lessonId: string) => void;
}> = ({ onJumpToLesson }) => {
  const [filter, setFilter] = useState<'全部' | DifficultyLevel>('全部');
  const [fixedMap, setFixedMap] = useState<Record<string, boolean>>({});

  const filtered = CASES.filter((c) => filter === '全部' || c.difficulty === filter);

  return (
    <main className="fullpage-scroll">
      <div className="page-container">
        <div className="page-hero">
          <div>
            <div className="page-hero-kicker">DIAGNOSTICS CLINIC · 零门槛视觉故障图鉴</div>
            <h1 className="page-hero-title">
              <Stethoscope size={22} style={{ color: 'var(--brand-primary)' }} />
              UE 5.8 材质翻车现场排错诊所
              <span className="meta-pill neutral" style={{ fontSize: 12 }}>
                {CASES.length} 大高频案例
              </span>
            </h1>
            <p className="page-hero-desc">
              不设考试锁卡，直接切换每张卡片上的「故障现象 ↔ 一键修复」，一眼记住常见踩坑现象背后的光学与渲染管线真凶。
            </p>
          </div>

          <div className="segmented-group">
            {(['全部', '零基础', '进阶', '实战'] as const).map((lv) => (
              <button
                key={lv}
                type="button"
                className={`segmented-opt ${filter === lv ? 'active' : ''}`}
                onClick={() => setFilter(lv)}
              >
                {lv} {lv === '全部' ? `(${CASES.length})` : ''}
              </button>
            ))}
          </div>
        </div>

        <div className="diag-grid">
          {filtered.map((item) => {
            const isFixed = !!fixedMap[item.id];
            return (
              <article key={item.id} className="diag-card">
                <div className="diag-card-top">
                  <span className="diag-case-num">{item.number}</span>
                  <span
                    className={`meta-pill ${
                      item.difficulty === '零基础'
                        ? 'sage'
                        : item.difficulty === '进阶'
                        ? 'amber'
                        : 'lavender'
                    }`}
                  >
                    {item.difficulty}
                  </span>
                </div>

                <h3 className="diag-title">
                  <FormattedText text={item.title} />
                </h3>

                <CasePreviewCanvas mode={item.renderMode} fixed={isFixed} />

                <div className="diag-switch" role="radiogroup" aria-label="故障与修复对照">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!isFixed}
                    className={`diag-switch-btn fault ${!isFixed ? 'active' : ''}`}
                    onClick={() => setFixedMap((m) => ({ ...m, [item.id]: false }))}
                  >
                    <AlertTriangle size={13.5} /> 看翻车现象
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isFixed}
                    className={`diag-switch-btn fixed ${isFixed ? 'active' : ''}`}
                    onClick={() => setFixedMap((m) => ({ ...m, [item.id]: true }))}
                  >
                    <CheckCircle2 size={13.5} /> 一键修复预览
                  </button>
                </div>

                <div className="diag-details">
                  <div>
                    <span className="diag-field-label">
                      <Search size={12.5} style={{ color: 'var(--text-muted)' }} /> 症状描述：
                    </span>
                    <FormattedText text={item.symptom} />
                  </div>
                  <div>
                    <span className="diag-field-label">
                      <Zap size={12.5} style={{ color: '#d97706' }} /> 根本原因：
                    </span>
                    <FormattedText text={item.rootCause} />
                  </div>
                  <div className="diag-prescription">
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700, marginRight: 4 }}>
                      <Wrench size={12} style={{ color: 'var(--brand-primary)' }} />
                      UE 5.8 修复处方：
                    </div>
                    <FormattedText text={item.fixPrescription} />
                  </div>
                </div>

                <div className="diag-footer">
                  <span className="diag-mnemonic">
                    <Lightbulb size={12.5} style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.mnemonic}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="diag-jump-btn"
                    onClick={() => onJumpToLesson(item.lessonId)}
                    title={item.lessonLabel}
                  >
                    精读章节 <ArrowUpRight size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
};
