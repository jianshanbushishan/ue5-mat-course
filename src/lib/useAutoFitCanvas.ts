import { RefObject, useEffect, useRef, useState } from 'react';

/**
 * 让 <canvas> 的绘图缓冲区始终与其 CSS 显示框保持同一宽高比，避免页面变宽时被拉伸变形。
 *
 * 规则：以 JSX 里写的 width/height 作为“设计尺寸”。
 * - 显示框比设计更宽：保持设计高度，把缓冲区宽度加宽（画面左右自然延展，内容不变形）。
 * - 显示框比设计更窄：保持设计宽度，把缓冲区高度加高（内容等比缩小，不被压扁）。
 *
 * 绘制代码只要使用 canvas.width / canvas.height 做相对布局即可自动适配。
 * 返回值是一个递增的版本号，请把它加入绘制 useEffect 的依赖数组中，尺寸变化后会触发重绘。
 */
export function useAutoFitCanvas(ref: RefObject<HTMLCanvasElement | null>): number {
  const [version, setVersion] = useState(0);
  const observed = useRef<{ el: HTMLCanvasElement; ro: ResizeObserver } | null>(null);

  // 每次渲染检查一次：画布被条件渲染/替换时重新挂载观察器。
  useEffect(() => {
    const el = ref.current;
    if (observed.current?.el === el) return;
    observed.current?.ro.disconnect();
    observed.current = null;
    if (!el) return;

    const designW = Number(el.dataset.designW) || el.width;
    const designH = Number(el.dataset.designH) || el.height;
    el.dataset.designW = String(designW);
    el.dataset.designH = String(designH);

    const fit = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw < 2 || ch < 2) return;
      let w = designW;
      let h = designH;
      if (cw / ch >= designW / designH) {
        w = Math.round((cw * designH) / ch);
      } else {
        h = Math.round((designW * ch) / cw);
      }
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
        setVersion((v) => v + 1);
      }
    };

    const ro = new ResizeObserver(fit);
    ro.observe(el);
    observed.current = { el, ro };
    fit();
  });

  useEffect(
    () => () => {
      observed.current?.ro.disconnect();
      observed.current = null;
    },
    []
  );

  return version;
}
