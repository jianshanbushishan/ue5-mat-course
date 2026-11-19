import React, { useState, useEffect, useRef } from 'react';
import { Upload, Sparkles, Layers, Cpu } from 'lucide-react';
import { StageSlider, StageSegmented, StageToggle, FormattedText } from '../components/ui/StageWidgets';
import {
  clamp,
  norm3,
  srgbToLinear,
  linearToSrgb,
  shadePbrPixel,
  fbm,
  Vec3,
} from '../lib/graphics';

import { previewBlocks, textureBytes, type PreviewFormat } from '../lib/blockPreview';

type LabTab = 'pbr' | 'texture' | 'graph';

interface PbrPreset {
  name: string;
  hex: string;
  metallic: number;
  roughness: number;
  specular: number;
  aniso: number;
  clearCoat: number;
  sss: number;
  toon: number;
}

const PRESETS: PbrPreset[] = [
  { name: '🏆 24K 纯金', hex: '#ffd666', metallic: 1.0, roughness: 0.16, specular: 0.5, aniso: 0, clearCoat: 0, sss: 0, toon: 0 },
  { name: '🍳 拉丝紫铜', hex: '#f0946d', metallic: 1.0, roughness: 0.28, specular: 0.5, aniso: 0.78, clearCoat: 0, sss: 0, toon: 0 },
  { name: '🧱 红色乐高塑料', hex: '#d62828', metallic: 0.0, roughness: 0.2, specular: 0.5, aniso: 0, clearCoat: 0, sss: 0, toon: 0 },
  { name: '🚗 豪车双层清漆', hex: '#1d3557', metallic: 0.85, roughness: 0.42, specular: 0.5, aniso: 0, clearCoat: 1.0, sss: 0, toon: 0 },
  { name: '🧊 冰种温润翡翠', hex: '#2a9d6f', metallic: 0.0, roughness: 0.18, specular: 0.55, aniso: 0, clearCoat: 0.35, sss: 0.88, toon: 0 },
  { name: '🪨 干燥粗糙岩石', hex: '#7f7b74', metallic: 0.0, roughness: 0.84, specular: 0.45, aniso: 0, clearCoat: 0, sss: 0, toon: 0 },
  { name: '🎨 UE 5.8 卡通赛璐璐', hex: '#ff758f', metallic: 0.0, roughness: 0.32, specular: 0.5, aniso: 0, clearCoat: 0, sss: 0, toon: 3 },
];

function hexToSrgb01(hex: string): Vec3 {
  const clean = hex.replace('#', '');
  const num = parseInt(clean.length === 6 ? clean : 'cccccc', 16);
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

// ============================================================================
// LAB 1: Full PBR & UE 5.8 Substrate Calibration Chamber
// ============================================================================
const PbrSubstrateLab: React.FC = () => {
  const [hex, setHex] = useState('#ffd666');
  const [metallic, setMetallic] = useState(1.0);
  const [roughness, setRoughness] = useState(0.16);
  const [specular, setSpecular] = useState(0.5);
  const [aniso, setAniso] = useState(0);
  const [clearCoat, setClearCoat] = useState(0);
  const [sss, setSss] = useState(0);
  const [toon, setToon] = useState(0);
  const [envMode, setEnvMode] = useState<'sunny' | 'studio' | 'cave' | 'black'>('sunny');
  const [lightAzimuth, setLightAzimuth] = useState(42);
  const [lightElev, setLightElev] = useState(38);
  const [bumpDetail, setBumpDetail] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const applyPreset = (p: PbrPreset) => {
    setHex(p.hex);
    setMetallic(p.metallic);
    setRoughness(p.roughness);
    setSpecular(p.specular);
    setAniso(p.aniso);
    setClearCoat(p.clearCoat);
    setSss(p.sss);
    setToon(p.toon);
  };

  const srgb = hexToSrgb01(hex);
  const baseLinear: Vec3 = [srgbToLinear(srgb[0]), srgbToLinear(srgb[1]), srgbToLinear(srgb[2])];
  const diffuseAlbedo: Vec3 = [
    baseLinear[0] * (1 - metallic),
    baseLinear[1] * (1 - metallic),
    baseLinear[2] * (1 - metallic),
  ];
  const dF0 = 0.08 * specular;
  const f0Vec: Vec3 = [
    dF0 * (1 - metallic) + baseLinear[0] * metallic,
    dF0 * (1 - metallic) + baseLinear[1] * metallic,
    dF0 * (1 - metallic) + baseLinear[2] * metallic,
  ];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const img = ctx.createImageData(w, h);
    const data = img.data;

    const az = (lightAzimuth * Math.PI) / 180;
    const el = (lightElev * Math.PI) / 180;
    const L = norm3([Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]);
    const V: Vec3 = [0, 0, 1];
    const aspect = w / h;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const u = px / w;
        const v = py / h;
        const sx = (u - 0.5) * 2 * aspect;
        const sy = (0.5 - v) * 2;
        const r2 = sx * sx + sy * sy;

        let r = 0.12;
        let g = 0.11;
        let b = 0.1;

        if (envMode === 'sunny') {
          r = 0.22 + (1 - v) * 0.25;
          g = 0.3 + (1 - v) * 0.32;
          b = 0.42 + (1 - v) * 0.42;
        } else if (envMode === 'studio') {
          const vig = 1 - Math.min(0.65, r2 * 0.28);
          r = 0.2 * vig;
          g = 0.21 * vig;
          b = 0.24 * vig;
        } else if (envMode === 'black') {
          r = 0.03;
          g = 0.03;
          b = 0.035;
        }

        if (r2 <= 0.74) {
          const sz = Math.sqrt(0.74 - r2);
          let nx = sx;
          let ny = sy;
          let nz = sz;
          if (bumpDetail) {
            const n1 = fbm(sx * 9 + 3, sy * 9 + 3, 3);
            const n2 = fbm(sx * 9 + 3.08, sy * 9 + 3, 3);
            const n3 = fbm(sx * 9 + 3, sy * 9 + 3.08, 3);
            nx += (n2 - n1) * 1.4;
            ny += (n3 - n1) * 1.4;
          }
          const N = norm3([nx, ny, nz]);
          const T = norm3([nz, 0, -nx]);

          // Cel-shading black outline
          if (toon >= 2 && r2 > 0.68) {
            r = 0.08;
            g = 0.06;
            b = 0.08;
          } else {
            [r, g, b] = shadePbrPixel({
              N,
              V,
              L,
              baseColorLinear: baseLinear,
              metallic,
              roughness,
              specularLevel: specular,
              envMode,
              anisotropy: aniso,
              tangent: T,
              clearCoat,
              clearCoatRoughness: 0.04,
              sssStrength: sss,
              sssColor: baseLinear,
              toonSteps: toon,
            });
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
  }, [hex, metallic, roughness, specular, aniso, clearCoat, sss, toon, envMode, lightAzimuth, lightElev, bumpDetail]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.15fr) minmax(320px, 1fr)', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="brutal-btn"
              style={{ padding: '5px 10px', fontSize: 12 }}
              onClick={() => applyPreset(p)}
            >
              {p.name}
            </button>
          ))}
        </div>

        <canvas
          ref={canvasRef}
          width={360}
          height={270}
          style={{
            width: '100%',
            borderRadius: 12,
            border: '2px solid var(--border-strong)',
            boxShadow: 'var(--shadow-brutal)',
          }}
        />

        {/* UE 5.8 Substrate Slab Live Readout */}
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1.5px solid var(--border-soft)',
            borderRadius: 11,
            padding: 12,
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 8 }}>
            <FormattedText text="🔮 UE 5.8 `Substrate Slab BSDF` 底层物理换算实时透视：" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: 'var(--bg-card)', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-soft)' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>漫反射反照率 (Diffuse Albedo)</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 3 }}>
                ({diffuseAlbedo[0].toFixed(2)}, {diffuseAlbedo[1].toFixed(2)}, {diffuseAlbedo[2].toFixed(2)})
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                {metallic === 1 ? '纯金属自由电子吞光，漫反射已归零！' : '非金属内部色素散射主导底色'}
              </div>
            </div>
            <div style={{ background: 'var(--bg-card)', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-soft)' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>0° 法向镜面反射率 (F0)</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 3 }}>
                ({f0Vec[0].toFixed(2)}, {f0Vec[1].toFixed(2)}, {f0Vec[2].toFixed(2)})
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                {metallic === 1 ? '金属给镜面高光染上自身颜色！' : '正入射反射率取决于 Specular 与 Metallic'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="stage-controls-panel" style={{ gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
            固有色 (Base Color)：
            <input
              type="color"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              style={{ width: 38, height: 28, border: '1.5px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer' }}
            />
            <code className="inline-code-pill">{hex.toUpperCase()}</code>
          </label>
          <StageToggle label="微表面法线起伏" checked={bumpDetail} onChange={setBumpDetail} />
        </div>

        <StageSegmented
          label="测试环境光照 (比较环境反射与直射光)"
          value={envMode}
          onChange={setEnvMode}
          options={[
            { value: 'sunny', label: '☀️ 正午晴空' },
            { value: 'studio', label: '💡 摄影棚柔光' },
            { value: 'cave', label: '🕯️ 幽暗山洞' },
            { value: 'black', label: '🌑 纯黑无环境光' },
          ]}
        />

        <div className="control-grid">
          <StageSlider label="金属度 (Metallic)" value={metallic} min={0} max={1} onChange={setMetallic} />
          <StageSlider label="粗糙度 (Roughness)" value={roughness} min={0.04} max={1} onChange={setRoughness} />
          <StageSlider label="旧版高光微调 (Specular)" value={specular} min={0} max={1} onChange={setSpecular} />
          <StageSlider label="拉丝各向异性 (Anisotropy)" value={aniso} min={0} max={0.95} onChange={setAniso} />
          <StageSlider label="顶层清漆叠层 (Clear Coat)" value={clearCoat} min={0} max={1} onChange={setClearCoat} />
          <StageSlider label="次表面散射示意强度" value={sss} min={0} max={1} onChange={setSss} />
          <StageSlider label="灯光水平旋转角" value={lightAzimuth} min={-160} max={160} step={1} unit="°" onChange={setLightAzimuth} />
          <StageSlider label="卡通色阶刀 (0=写实, ≥2=Toon)" value={toon} min={0} max={5} step={1} onChange={setToon} />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// LAB 2: Texture Pipeline, Channel Splitter, BC Block & VRAM Calculator
// ============================================================================
const TextureInspectorLab: React.FC = () => {
  const [sourcePreset, setSourcePreset] = useState<'orm' | 'normal' | 'flower' | 'custom'>('flower');
  const [customImg, setCustomImg] = useState<HTMLImageElement | null>(null);
  const [channel, setChannel] = useState<'RGBA' | 'R' | 'G' | 'B' | 'A'>('RGBA');
  const [bcMode, setBcMode] = useState<PreviewFormat>('BC1');
  const [srgbOn, setSrgbOn] = useState(true);
  const [mipsOn, setMipsOn] = useState(true);
  const [resSize, setResSize] = useState<'512' | '1024' | '2048' | '4096'>('2048');
  const [zoomBlock, setZoomBlock] = useState<[number, number]>([16, 16]);

  const [rebuildZ, setRebuildZ] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const uploadSequence = useRef(0);
  const uploaded = sourcePreset === 'custom' ? customImg : null;
  const width = uploaded?.naturalWidth ?? Number(resSize);
  const height = uploaded?.naturalHeight ?? Number(resSize);
  const previewWidth = Math.min(width, 128);
  const previewHeight = Math.min(height, 128);

  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const zoomCanvasRef = useRef<HTMLCanvasElement>(null);

  const handleFileUpload = (file: File | undefined) => {
    if (!file) return;
    const sequence = ++uploadSequence.current;
    setUploadError('');
    const fail = () => { if (sequence === uploadSequence.current) setUploadError('无法解码这张图片，请选择 PNG 或 JPEG。'); };
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = () => {
      const img = new Image();
      img.onerror = fail;
      img.onload = () => {
        if (sequence !== uploadSequence.current) return;
        setCustomImg(img);
        setSourcePreset('custom');
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const canvas = mainCanvasRef.current;
    const zCanvas = zoomCanvasRef.current;
    if (!canvas || !zCanvas) return;
    const ctx = canvas.getContext('2d');
    const zCtx = zCanvas.getContext('2d');
    if (!ctx || !zCtx) return;

    const w = previewWidth, h = previewHeight;
    const raw = new Float32Array(w * h * 4);

    if (sourcePreset === 'custom' && customImg) {
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d')!;
      octx.drawImage(customImg, 0, 0);
      const id = octx.getImageData(0, 0, w, h).data;
      for (let i = 0; i < w * h * 4; i++) raw[i] = id[i] / 255;
    } else {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const u = x / w;
          const v = y / h;
          const idx = (y * w + x) * 4;
          if (sourcePreset === 'flower') {
            const dx = u - 0.5;
            const dy = v - 0.5;
            const ang = Math.atan2(dy, dx);
            const rad = Math.hypot(dx, dy);
            const petal = 0.28 + 0.1 * Math.cos(ang * 6);
            if (rad < 0.09) {
              raw[idx] = 0.96;
              raw[idx + 1] = 0.82;
              raw[idx + 2] = 0.15;
              raw[idx + 3] = 1;
            } else if (rad < petal) {
              raw[idx] = 0.92;
              raw[idx + 1] = 0.14;
              raw[idx + 2] = 0.2;
              raw[idx + 3] = 1;
            } else {
              const leaf = 0.35 + 0.25 * fbm(u * 10, v * 10, 3);
              raw[idx] = 0.12;
              raw[idx + 1] = leaf + 0.28;
              raw[idx + 2] = 0.16;
              raw[idx + 3] = rad < 0.45 ? 1 : 0.25;
            }
          } else if (sourcePreset === 'normal') {
            const dx = (u - 0.5) * 2;
            const dy = (v - 0.5) * 2;
            const r = Math.hypot(dx, dy);
            const ring = Math.sin(r * 16) * Math.exp(-r * 1.8) * 0.65;
            const nx = clamp(-dx * ring * 1.4, -0.95, 0.95);
            const ny = clamp(-dy * ring * 1.4, -0.95, 0.95);
            const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
            raw[idx] = nx * 0.5 + 0.5;
            raw[idx + 1] = ny * 0.5 + 0.5;
            raw[idx + 2] = nz * 0.5 + 0.5;
            raw[idx + 3] = 1;
          } else {
            // ORM packed texture
            const ao = 1 - 0.65 * Math.exp(-Math.pow((u - 0.5) * 6, 2));
            const rough = clamp(0.25 + 0.6 * fbm(u * 8, v * 8, 3), 0, 1);
            const metal = u > 0.52 ? 1.0 : 0.0;
            raw[idx] = ao;
            raw[idx + 1] = rough;
            raw[idx + 2] = metal;
            raw[idx + 3] = 1;
          }
        }
      }
    }

    const comp = previewBlocks(raw, w, h, bcMode, rebuildZ);
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      let r = comp[i * 4];
      let g = comp[i * 4 + 1];
      let b = comp[i * 4 + 2];
      const a = comp[i * 4 + 3];

      if (!srgbOn) {
        // Viewing linear values raw without sRGB decode/encode mismatch simulation
        r = linearToSrgb(r);
        g = linearToSrgb(g);
        b = linearToSrgb(b);
      }

      if (channel === 'R') [r, g, b] = [r, r, r];
      else if (channel === 'G') [r, g, b] = [g, g, g];
      else if (channel === 'B') [r, g, b] = [b, b, b];
      else if (channel === 'A') [r, g, b] = [a, a, a];

      img.data[i * 4] = Math.round(clamp(r, 0, 1) * 255);
      img.data[i * 4 + 1] = Math.round(clamp(g, 0, 1) * 255);
      img.data[i * 4 + 2] = Math.round(clamp(b, 0, 1) * 255);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    const x = Math.min(zoomBlock[0], Math.ceil(w / 4) - 1) * 4;
    const y = Math.min(zoomBlock[1], Math.ceil(h / 4) - 1) * 4;
    const blockW = Math.min(4, w - x), blockH = Math.min(4, h - y);
    zCtx.imageSmoothingEnabled = false;
    zCtx.clearRect(0, 0, zCanvas.width, zCanvas.height);
    zCtx.drawImage(canvas, x, y, blockW, blockH, 0, 0, zCanvas.width, zCanvas.height);
    ctx.strokeStyle = '#ffeb3b';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, blockW - 1, blockH - 1);
  }, [sourcePreset, customImg, channel, bcMode, srgbOn, zoomBlock, previewWidth, previewHeight, rebuildZ]);

  const bpp = bcMode === 'RGBA8' ? 32 : bcMode === 'BC1' || bcMode === 'BC4' ? 4 : 8;
  const bytes = textureBytes(width, height, bcMode, mipsOn);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(290px, 1fr) minmax(320px, 1.15fr)', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5 }}>{uploaded ? '上传图左上区域的解码预览（最多 128×128）' : '128×128 程序样本'} · 点击选块</div>
            <canvas
              ref={mainCanvasRef}
              width={previewWidth}
              height={previewHeight}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ux = ((e.clientX - rect.left) / rect.width) * previewWidth / 4;
                const uy = ((e.clientY - rect.top) / rect.height) * previewHeight / 4;
                setZoomBlock([Math.floor(ux), Math.floor(uy)]);
              }}
              style={{
                width: '100%',
                aspectRatio: 'auto',
                imageRendering: 'pixelated',
                borderRadius: 10,
                border: '2px solid var(--border-strong)',
                cursor: 'crosshair',
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5 }}>选中块的解码预览</div>
            <canvas
              ref={zoomCanvasRef}
              width={192}
              height={192}
              style={{
                width: '100%',
                aspectRatio: '1 / 1',
                imageRendering: 'pixelated',
                borderRadius: 10,
                border: '2px solid var(--border-strong)',
              }}
            />
          </div>
        </div>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFileUpload(e.dataTransfer.files?.[0]);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '11px 14px',
            borderRadius: 10,
            border: '2px dashed var(--border-strong)',
            background: 'var(--bg-panel)',
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <Upload size={16} />
          上传 PNG / JPG，检查纹素并按原图尺寸估算纹理数据量
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => handleFileUpload(e.target.files?.[0])}
          />
        </label>
        {uploadError && <p role="alert">{uploadError}</p>}
        <p>每个 4×4 块独立选择端点和索引。BC1 演示不透明模式，BC4 与 BC5 分通道拟合，BC7 仅演示 mode 6。具体编码器可选用不同端点或模式。</p>
      </div>

      <div className="stage-controls-panel" style={{ gap: 12 }}>
        <StageSegmented
          label="测试贴图源"
          value={sourcePreset}
          onChange={preset => { setSourcePreset(preset); setSrgbOn(preset === 'flower' || preset === 'custom'); setRebuildZ(preset === 'normal'); }}
          options={[
            { value: 'flower', label: '🌺 红花配绿叶 (测BC1串色)' },
            { value: 'normal', label: '🟣 波纹法线图 (测BC5)' },
            { value: 'orm', label: '📦 ORM 三合一打包图' },
            ...(customImg ? [{ value: 'custom' as const, label: '🖼️ 本地上传图' }] : []),
          ]}
        />

        <StageSegmented
          label="单通道拆页检视 (验证 RGBA 四页灰度账本)"
          value={channel}
          onChange={setChannel}
          options={[
            { value: 'RGBA', label: '彩色合成' },
            { value: 'R', label: 'R 红页' },
            { value: 'G', label: 'G 绿页' },
            { value: 'B', label: 'B 蓝页' },
            { value: 'A', label: 'A 第四页' },
          ]}
        />

        <StageSegmented
          label="显卡块压缩格式 (观察左侧 4×4 显微镜色块变化)"
          value={bcMode}
          onChange={setBcMode}
          options={[
            { value: 'RGBA8', label: '无压缩 (32 bpp)' },
            { value: 'BC1', label: 'BC1 / Default (4 bpp)' },
            { value: 'BC4', label: 'BC4 单灰 (4 bpp)' },
            { value: 'BC5', label: 'BC5 法线 (8 bpp)' },
            { value: 'BC7', label: 'BC7 高清 (8 bpp)' },
          ]}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {!uploaded && <StageSegmented
            label="假设的 2D 纹理分辨率"
            value={resSize}
            onChange={setResSize}
            options={[
              { value: '512', label: '512²' },
              { value: '1024', label: '1024²' },
              { value: '2048', label: '2048²' },
              { value: '4096', label: '4096²' },
            ]}
          />}
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            {bcMode === 'BC5' && <StageToggle label="法线显示：从 XY 重建 Z" checked={rebuildZ} onChange={setRebuildZ} />}
            <StageToggle label="按 sRGB 颜色读取" checked={srgbOn} onChange={setSrgbOn} />
            <StageToggle label="计入完整 Mip 链" checked={mipsOn} onChange={setMipsOn} />
          </div>
        </div>

        <div
          style={{
            background: 'var(--accent-amber)',
            color: 'var(--accent-amber-deep)',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 10,
            padding: '10px 13px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700 }}>纹理数据估算（按块与 mip 取整，未计驱动对齐或流送驻留）</div>
            <div style={{ fontSize: 12 }}>
              {width}×{height} · {bcMode} ({bpp} bit/像素) {mipsOn ? '· 含套娃 Mipmap' : '· 无 Mipmap'}
            </div>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 800 }}>
            {bytes < 1048576 ? bytes.toLocaleString() + ' B' : (bytes / 1048576).toFixed(2) + ' MiB'}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// LAB 3: Mini UE 5.8 Material Node Graph Playground
// ============================================================================
const MiniNodeGraphLab: React.FC = () => {
  const [uvTiling, setUvTiling] = useState(3.0);
  const [panSpeed, setPanSpeed] = useState(0.6);
  const [lerpBias, setLerpBias] = useState(0.5);
  const [invertMask, setInvertMask] = useState(false);
  const [fresnelBoost, setFresnelBoost] = useState(1.8);
  const [emissivePower, setEmissivePower] = useState(1.6);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const render = (now: number) => {
      const t = (now - t0) / 1000;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          const img = ctx.createImageData(w, h);
          const data = img.data;
          const L = norm3([0.4, 0.6, 0.7]);
          const V: Vec3 = [0, 0, 1];

          for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
              const sx = ((px / w) - 0.5) * 2 * (w / h);
              const sy = (0.5 - py / h) * 2;
              const r2 = sx * sx + sy * sy;
              let r = 0.09;
              let g = 0.09;
              let b = 0.11;

              if (r2 <= 0.76) {
                const sz = Math.sqrt(0.76 - r2);
                const N = norm3([sx, sy, sz]);
                const u = (Math.atan2(sx, sz) / Math.PI) * 0.5 + 0.5;
                const v = Math.acos(clamp(sy / Math.sqrt(0.76), -1, 1)) / Math.PI;

                const pu = u * uvTiling + t * panSpeed * 0.35;
                const pv = v * uvTiling - t * panSpeed * 0.2;
                let mask = clamp(fbm(pu * 3, pv * 3, 3) + (lerpBias - 0.5), 0, 1);
                if (invertMask) mask = 1 - mask;

                const colA: Vec3 = [0.06, 0.14, 0.28];
                const colB: Vec3 = [0.92, 0.42, 0.08];
                const base: Vec3 = [
                  colA[0] + (colB[0] - colA[0]) * mask,
                  colA[1] + (colB[1] - colA[1]) * mask,
                  colA[2] + (colB[2] - colA[2]) * mask,
                ];

                const fres = Math.pow(1 - Math.max(0, N[2]), 3.2) * fresnelBoost;
                const pulse = (0.75 + 0.25 * Math.sin(t * 3.2)) * emissivePower;
                [r, g, b] = shadePbrPixel({
                  N, V, L, baseColorLinear: base, metallic: 0.35,
                  roughness: 0.25 + (1 - mask) * 0.45,
                  emissiveLinear: [(mask * 0.28 + fres * 0.22) * pulse,
                    (mask * 0.12 + fres * 0.58) * pulse, fres * 0.95 * pulse],
                });
              }

              const idx = (py * w + px) * 4;
              data[idx] = Math.round(r * 255);
              data[idx + 1] = Math.round(g * 255);
              data[idx + 2] = Math.round(b * 255);
              data[idx + 3] = 255;
            }
          }
          ctx.putImageData(img, 0, 0);
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [uvTiling, panSpeed, lerpBias, invertMask, fresnelBoost, emissivePower]);



  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(270px, 0.95fr) minmax(340px, 1.25fr)', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <canvas
          ref={canvasRef}
          width={240}
          height={200}
          style={{
            width: '100%',
            borderRadius: 12,
            border: '2px solid var(--border-strong)',
            boxShadow: 'var(--shadow-brutal)',
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderRadius: 9,
            background: 'var(--bg-panel)',
            border: '1.5px solid var(--border-soft)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
          }}
        >
          <span>程序噪声 · 3 个频率层</span>
          <span style={{ color: '#3b8d24', fontWeight: 700 }}>UE 编译开销请查看 Platform Stats</span>
        </div>
      </div>

      <div className="stage-controls-panel" style={{ gap: 12 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
          当前连线链路：<code className="inline-code-pill">TexCoord × {uvTiling.toFixed(1)}</code> →{' '}
          <code className="inline-code-pill">Panner ({panSpeed.toFixed(1)})</code> →{' '}
          <code className="inline-code-pill">噪波遮罩 {invertMask ? '→ OneMinus' : ''}</code> →{' '}
          <code className="inline-code-pill">Lerp 混色 + Fresnel 边缘辉光</code> →{' '}
          <code className="inline-code-pill">Substrate Slab → Front Material</code>
        </div>

        <div className="control-grid">
          <StageSlider label="UV 缩放平铺 (TexCoord × N)" value={uvTiling} min={1} max={8} step={0.5} onChange={setUvTiling} />
          <StageSlider label="UV 流动速度 (Panner Speed)" value={panSpeed} min={0} max={2.5} onChange={setPanSpeed} />
          <StageSlider label="混水阀权重偏移 (Lerp Alpha)" value={lerpBias} min={0} max={1} onChange={setLerpBias} />
          <StageSlider label="菲涅尔边缘光强度 (Fresnel)" value={fresnelBoost} min={0} max={3.5} onChange={setFresnelBoost} />
          <StageSlider label="HDR 自发光倍率 (Emissive)" value={emissivePower} min={0} max={3.5} onChange={setEmissivePower} />
          <div style={{ marginTop: 14 }}>
            <StageToggle label="OneMinus (1-x 反转)" checked={invertMask} onChange={setInvertMask} />
          </div>
        </div>
      </div>
    </div>
  );
};

export const ShaderLabPage: React.FC = () => {
  const [tab, setTab] = useState<LabTab>('pbr');

  return (
    <main className="fullpage-scroll">
      <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="breadcrumb-line">INTERACTIVE SHADER LAB · 跨章节综合自由沙盒</div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 24, fontWeight: 800 }}>
              🧪 UE 5.8 材质综合实验室
            </h1>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
              把全书学到的光学参数、纹理压缩账本与材质节点放在一起自由混搭实验。
            </p>
          </div>

          <div className="segmented-group">
            <button
              type="button"
              className={`segmented-opt ${tab === 'pbr' ? 'active' : ''}`}
              onClick={() => setTab('pbr')}
            >
              <Sparkles size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              ① PBR / Substrate 校准舱
            </button>
            <button
              type="button"
              className={`segmented-opt ${tab === 'texture' ? 'active' : ''}`}
              onClick={() => setTab('texture')}
            >
              <Layers size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              ② 纹理压缩与显存透视仪
            </button>
            <button
              type="button"
              className={`segmented-opt ${tab === 'graph' ? 'active' : ''}`}
              onClick={() => setTab('graph')}
            >
              <Cpu size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              ③ 迷你节点连线游乐场
            </button>
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-soft)',
            borderRadius: 16,
            padding: 20,
          }}
        >
          {tab === 'pbr' && <PbrSubstrateLab />}
          {tab === 'texture' && <TextureInspectorLab />}
          {tab === 'graph' && <MiniNodeGraphLab />}
        </div>
      </div>
    </main>
  );
};
