/**
 * 全局高清（HiDPI / Retina）画布适配。
 *
 * 问题：<canvas width=340> 的绘图缓冲区只有 340 个物理像素，在 devicePixelRatio = 1.5 / 2 的屏幕上
 * 会被浏览器放大显示，文字和线条发虚。
 *
 * 方案：在“页面上可见的画布”第一次调用 getContext('2d') 时：
 *  1. 把真实缓冲区放大到 逻辑尺寸 × dpr，并给 2D 上下文设置 dpr 缩放的基础变换；
 *  2. 在该画布实例上覆盖 width / height 属性，读写的仍是“逻辑尺寸”，
 *     因此所有现有绘制代码（使用 canvas.width / canvas.height 布局、鼠标坐标换算）无需改动；
 *  3. 修补 putImageData / getImageData / drawImage / setTransform 等不受变换影响或依赖像素尺寸的 API，
 *     让它们继续按逻辑坐标工作。
 *
 * 脱离文档的离屏画布（document.createElement('canvas') 用作中间缓冲）不受影响。
 */

interface HiDpiState {
  lw: number; // 逻辑宽
  lh: number; // 逻辑高
  pw: number; // 物理宽
  ph: number; // 物理高
  sx: number; // pw / lw
  sy: number; // ph / lh
  dpr: number;
  ctx: CanvasRenderingContext2D | null;
}

const states = new WeakMap<HTMLCanvasElement, HiDpiState>();

let installed = false;

export function installHiDpiCanvas() {
  if (installed || typeof window === 'undefined' || typeof HTMLCanvasElement === 'undefined') return;
  installed = true;

  const proto = HTMLCanvasElement.prototype;
  const wDesc = Object.getOwnPropertyDescriptor(proto, 'width');
  const hDesc = Object.getOwnPropertyDescriptor(proto, 'height');
  if (!wDesc?.get || !wDesc.set || !hDesc?.get || !hDesc.set) return;
  const nativeW = { get: wDesc.get, set: wDesc.set };
  const nativeH = { get: hDesc.get, set: hDesc.set };

  const ctxProto = CanvasRenderingContext2D.prototype;
  const nativeGetContext = proto.getContext;
  type AnyFn = (this: CanvasRenderingContext2D, ...args: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const nativeSetTransform = ctxProto.setTransform as AnyFn;
  const nativePutImageData = ctxProto.putImageData as AnyFn;
  const nativeGetImageData = ctxProto.getImageData as AnyFn;
  const nativeDrawImage = ctxProto.drawImage as (...args: unknown[]) => void;

  // 复用的离屏缓冲（脱离文档，不会被本模块高清化）
  const scratch = document.createElement('canvas');
  const scratchCtx = scratch.getContext('2d')!;

  const currentDpr = () => Math.min(3, Math.max(1, window.devicePixelRatio || 1));

  const applyBase = (st: HiDpiState) => {
    if (st.ctx) nativeSetTransform.call(st.ctx, st.sx, 0, 0, st.sy, 0, 0);
  };

  const applySize = (canvas: HTMLCanvasElement, st: HiDpiState) => {
    st.dpr = currentDpr();
    st.pw = Math.max(1, Math.round(st.lw * st.dpr));
    st.ph = Math.max(1, Math.round(st.lh * st.dpr));
    st.sx = st.lw > 0 ? st.pw / st.lw : 1;
    st.sy = st.lh > 0 ? st.ph / st.lh : 1;
    nativeW.set.call(canvas, st.pw);
    nativeH.set.call(canvas, st.ph);
    applyBase(st);
  };

  // 外部（例如 React 更新 width 属性）直接改了缓冲区，或屏幕 dpr 变化时重新同步
  const sync = (canvas: HTMLCanvasElement, st: HiDpiState) => {
    const nw = nativeW.get.call(canvas) as number;
    const nh = nativeH.get.call(canvas) as number;
    if (nw !== st.pw || nh !== st.ph) {
      st.lw = nw;
      st.lh = nh;
      applySize(canvas, st);
    } else if (st.dpr !== currentDpr()) {
      applySize(canvas, st);
    }
  };

  const patchContext = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, st: HiDpiState) => {
    const c = ctx as CanvasRenderingContext2D & Record<string, unknown>;

    c.setTransform = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      let a: number, b: number, cc: number, d: number, e: number, f: number;
      if (args.length >= 6) {
        [a, b, cc, d, e, f] = args as number[];
      } else {
        const m = (args[0] ?? {}) as DOMMatrix2DInit;
        a = m.a ?? m.m11 ?? 1;
        b = m.b ?? m.m12 ?? 0;
        cc = m.c ?? m.m21 ?? 0;
        d = m.d ?? m.m22 ?? 1;
        e = m.e ?? m.m41 ?? 0;
        f = m.f ?? m.m42 ?? 0;
      }
      nativeSetTransform.call(this, a * st.sx, b * st.sy, cc * st.sx, d * st.sy, e * st.sx, f * st.sy);
    } as CanvasRenderingContext2D['setTransform'];

    c.resetTransform = function (this: CanvasRenderingContext2D) {
      nativeSetTransform.call(this, st.sx, 0, 0, st.sy, 0, 0);
    };

    c.putImageData = function (
      this: CanvasRenderingContext2D,
      img: ImageData,
      dx: number,
      dy: number,
      dirtyX?: number,
      dirtyY?: number,
      dirtyW?: number,
      dirtyH?: number
    ) {
      if (scratch.width !== img.width) scratch.width = img.width;
      if (scratch.height !== img.height) scratch.height = img.height;
      nativePutImageData.call(scratchCtx, img, 0, 0);
      let rx = 0;
      let ry = 0;
      let rw = img.width;
      let rh = img.height;
      if (dirtyX !== undefined && dirtyY !== undefined && dirtyW !== undefined && dirtyH !== undefined) {
        rx = dirtyX;
        ry = dirtyY;
        rw = dirtyW;
        rh = dirtyH;
      }
      this.save();
      nativeSetTransform.call(this, st.sx, 0, 0, st.sy, 0, 0);
      this.globalAlpha = 1;
      this.globalCompositeOperation = 'source-over';
      this.shadowColor = 'transparent';
      this.filter = 'none';
      this.imageSmoothingEnabled = canvas.style.imageRendering !== 'pixelated';
      // putImageData 是“替换像素”，先清空目标区域再绘制以保持一致
      this.clearRect(dx + rx, dy + ry, rw, rh);
      nativeDrawImage.call(this, scratch, rx, ry, rw, rh, dx + rx, dy + ry, rw, rh);
      this.restore();
    } as CanvasRenderingContext2D['putImageData'];

    c.getImageData = function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
      if (scratch.width !== w) scratch.width = w;
      if (scratch.height !== h) scratch.height = h;
      scratchCtx.clearRect(0, 0, w, h);
      scratchCtx.imageSmoothingEnabled = true;
      nativeDrawImage.call(scratchCtx, canvas, x * st.sx, y * st.sy, w * st.sx, h * st.sy, 0, 0, w, h);
      return nativeGetImageData.call(scratchCtx, 0, 0, w, h);
    } as CanvasRenderingContext2D['getImageData'];

    states.set(canvas, st);
    void ctx;
  };

  // drawImage：源是高清画布时，把逻辑坐标的源矩形换算成物理像素
  ctxProto.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
    const src = args[0];
    const sst = src instanceof HTMLCanvasElement ? states.get(src) : undefined;
    if (!sst) return nativeDrawImage.apply(this, args);
    const n = args.length;
    if (n === 3) {
      return nativeDrawImage.call(this, src, 0, 0, sst.pw, sst.ph, args[1], args[2], sst.lw, sst.lh);
    }
    if (n === 5) {
      return nativeDrawImage.call(this, src, 0, 0, sst.pw, sst.ph, args[1], args[2], args[3], args[4]);
    }
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = args as number[];
    return nativeDrawImage.call(this, src, sx * sst.sx, sy * sst.sy, sw * sst.sx, sh * sst.sy, dx, dy, dw, dh);
  } as CanvasRenderingContext2D['drawImage'];

  proto.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
    const ctx = (nativeGetContext as (t: string, o?: unknown) => RenderingContext | null).call(this, type, options);
    if (type !== '2d' || !ctx) return ctx;

    const existing = states.get(this);
    if (existing) {
      sync(this, existing);
      return ctx;
    }
    // 只处理已挂到页面上的画布；离屏中间缓冲保持原样
    if (!this.isConnected) return ctx;

    const canvas = this;
    const st: HiDpiState = {
      lw: nativeW.get.call(canvas) as number,
      lh: nativeH.get.call(canvas) as number,
      pw: 0,
      ph: 0,
      sx: 1,
      sy: 1,
      dpr: 1,
      ctx: ctx as CanvasRenderingContext2D,
    };

    // 没有显式 CSS 尺寸的画布，锁定其显示尺寸为逻辑尺寸，避免放大缓冲区后布局变大
    if (!canvas.style.width && !canvas.style.height) {
      canvas.style.width = `${st.lw}px`;
    }

    Object.defineProperty(canvas, 'width', {
      configurable: true,
      get: () => st.lw,
      set: (v: number) => {
        st.lw = Math.max(0, Math.floor(Number(v)) || 0);
        applySize(canvas, st);
      },
    });
    Object.defineProperty(canvas, 'height', {
      configurable: true,
      get: () => st.lh,
      set: (v: number) => {
        st.lh = Math.max(0, Math.floor(Number(v)) || 0);
        applySize(canvas, st);
      },
    });

    patchContext(canvas, ctx as CanvasRenderingContext2D, st);
    applySize(canvas, st);
    return ctx;
  } as typeof proto.getContext;
}
