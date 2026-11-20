import React, { useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Lightbulb } from 'lucide-react';
import { SchematicDiagram, SchematicNode } from '../../types/course';

const HEADER_COLORS: Record<SchematicNode['category'], [string, string]> = {
  input: ['#9f2d3e', '#761e2b'],     // UE Red (Input / Coordinates)
  texture: ['#1b7c86', '#13575f'],   // UE Teal (Texture Sample)
  math: ['#2c679c', '#1e4a73'],      // UE Blue (Math / Utility)
  param: ['#2c7a45', '#1d5730'],     // UE Green (Constant / Parameter)
  substrate: ['#7340b3', '#522985'], // UE 5.8 Purple (Substrate Slab BSDF)
  output: ['#9c6d1b', '#734e10'],    // UE Gold/Brown (Material Root Output)
  pipeline: ['#475569', '#334155'],  // Pipeline Stage
};

export const UE5SchematicView: React.FC<{ diagram: SchematicDiagram; isDark?: boolean }> = ({
  diagram,
  isDark = false,
}) => {
  const [zoom, setZoom] = useState(1);

  const nodeMap = new Map<string, SchematicNode>();
  diagram.nodes.forEach((n) => nodeMap.set(n.id, n));

  const splitNoteLines = (note: string, maxWidth: number): string[] => {
    // Estimate ~9.5px per CJK char, ~5.6px per ASCII char
    const charW = (ch: string) => (ch.charCodeAt(0) > 127 ? 9.6 : 5.8);
    const lines: string[] = [];
    let cur = '';
    let curW = 0;
    for (const ch of note) {
      const cw = charW(ch);
      if (cur && curW + cw > maxWidth) {
        lines.push(cur);
        cur = ch;
        curW = cw;
      } else {
        cur += ch;
        curW += cw;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  };

  const getPinPos = (nodeId: string, pinId: string, side: 'in' | 'out'): [number, number] => {
    const node = nodeMap.get(nodeId);
    if (!node) return [0, 0];
    const w = node.width ?? 190;
    const headH = node.subtitle ? 44 : 32;
    const list = side === 'in' ? node.inputs ?? [] : node.outputs ?? [];
    const idx = Math.max(0, list.findIndex((p) => p.id === pinId));
    const py = node.y + headH + 16 + idx * 23;
    const px = side === 'in' ? node.x : node.x + w;
    return [px, py];
  };

  const maxX = Math.max(820, ...diagram.nodes.map((n) => n.x + (n.width ?? 190) + 90));
  const maxY = Math.max(
    350,
    ...diagram.nodes.map((n) => {
      const w = n.width ?? 190;
      const rows = Math.max(n.inputs?.length ?? 0, n.outputs?.length ?? 0, 1);
      const headH = n.subtitle ? 44 : 32;
      const noteLines = n.note ? splitNoteLines(n.note, w - 20).length : 0;
      return n.y + headH + 22 + rows * 23 + (noteLines > 0 ? 18 + noteLines * 14 : 20);
    })
  );

  return (
    <div className="schematic-shell">
      <div className="schematic-toolbar">
        <div className="schematic-title-wrap">
          <span className="schematic-kicker">MATERIAL GRAPH</span>
          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {diagram.title}
          </span>
        </div>
        <div className="schematic-zoom-group">
          <button
            type="button"
            className="schematic-zoom-btn"
            onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.12).toFixed(2)))}
            title="缩小画布"
            aria-label="缩小画布"
          >
            <ZoomOut size={13.5} />
          </button>
          <span className="schematic-zoom-val">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="schematic-zoom-btn"
            onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.12).toFixed(2)))}
            title="放大画布"
            aria-label="放大画布"
          >
            <ZoomIn size={13.5} />
          </button>
          <button
            type="button"
            className="schematic-zoom-btn"
            onClick={() => setZoom(1)}
            title="重置 100% 缩放"
            aria-label="重置缩放"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      <div className="schematic-canvas-wrap">
        <svg
          width={maxX * zoom}
          height={maxY * zoom}
          viewBox={`0 0 ${maxX} ${maxY}`}
          style={{ display: 'block' }}
        >
          <defs>
            <filter id="ue-node-shadow" x="-12%" y="-12%" width="128%" height="132%">
              <feDropShadow
                dx="0"
                dy={isDark ? 6 : 4}
                stdDeviation={isDark ? 6 : 5}
                floodColor={isDark ? '#000000' : '#14120f'}
                floodOpacity={isDark ? 0.45 : 0.12}
              />
            </filter>
            {(Object.keys(HEADER_COLORS) as SchematicNode['category'][]).map((cat) => (
              <linearGradient key={cat} id={`ue-head-${cat}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={HEADER_COLORS[cat][0]} />
                <stop offset="100%" stopColor={HEADER_COLORS[cat][1]} />
              </linearGradient>
            ))}
          </defs>

          {/* Wires */}
          {diagram.edges.map((edge, idx) => {
            const [x1, y1] = getPinPos(edge.fromNode, edge.fromPin, 'out');
            const [x2, y2] = getPinPos(edge.toNode, edge.toPin, 'in');
            const dx = Math.max(46, Math.abs(x2 - x1) * 0.48);
            const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2 - 8;
            const strokeColor = edge.color ?? (isDark ? '#94a3b8' : '#64748b');
            return (
              <g key={idx}>
                <path
                  d={path}
                  fill="none"
                  stroke={isDark ? 'rgba(0,0,0,0.45)' : 'rgba(15,23,42,0.22)'}
                  strokeWidth={4.5}
                  strokeLinecap="round"
                />
                <path
                  d={path}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeDasharray={edge.dashed ? '6 4' : undefined}
                />
                {edge.label && (
                  <g>
                    <rect
                      x={mx - edge.label.length * 3.6 - 8}
                      y={my - 10}
                      width={edge.label.length * 7.2 + 16}
                      height={16}
                      rx={4}
                      fill={isDark ? '#161922' : '#ffffff'}
                      stroke={isDark ? 'rgba(255,255,255,0.12)' : 'rgba(23,22,20,0.16)'}
                      strokeWidth={0.8}
                    />
                    <text
                      x={mx}
                      y={my + 1.5}
                      fill={isDark ? '#e2e8f0' : '#1e293b'}
                      fontSize={9.5}
                      fontWeight={600}
                      textAnchor="middle"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {edge.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {diagram.nodes.map((node) => {
            const w = node.width ?? 190;
            const headH = node.subtitle ? 44 : 32;
            const rows = Math.max(node.inputs?.length ?? 0, node.outputs?.length ?? 0, 1);
            const noteLines = node.note ? splitNoteLines(node.note, w - 20) : [];
            const noteBlockH = noteLines.length > 0 ? 14 + noteLines.length * 14 : 8;
            const h = headH + 12 + rows * 23 + noteBlockH;
            return (
              <g key={node.id} transform={`translate(${node.x}, ${node.y})`} filter="url(#ue-node-shadow)">
                {/* Body */}
                <rect
                  x={0}
                  y={0}
                  width={w}
                  height={h}
                  rx={9}
                  fill={isDark ? '#1d2028' : '#ffffff'}
                  stroke={isDark ? 'rgba(255,255,255,0.16)' : 'rgba(23,22,20,0.16)'}
                  strokeWidth={1.1}
                />
                {/* Header */}
                <path
                  d={`M 0.5 9 Q 0.5 0.5 9 0.5 L ${w - 9} 0.5 Q ${w - 0.5} 0.5 ${w - 0.5} 9 L ${w - 0.5} ${headH} L 0.5 ${headH} Z`}
                  fill={`url(#ue-head-${node.category})`}
                />
                {/* Subtle Header Highlight */}
                <line
                  x1={8}
                  y1={1.2}
                  x2={w - 8}
                  y2={1.2}
                  stroke="rgba(255,255,255,0.22)"
                  strokeWidth={1}
                />
                <text
                  x={11}
                  y={19}
                  fill="#ffffff"
                  fontSize={11.5}
                  fontWeight={700}
                  fontFamily="Inter, Noto Sans SC, sans-serif"
                >
                  {node.title}
                </text>
                {node.subtitle && (
                  <text
                    x={11}
                    y={35}
                    fill="rgba(255,255,255,0.78)"
                    fontSize={9.6}
                    fontFamily="JetBrains Mono, Noto Sans SC, monospace"
                  >
                    {node.subtitle}
                  </text>
                )}

                {/* Inputs */}
                {(node.inputs ?? []).map((pin, idx) => {
                  const py = headH + 16 + idx * 23;
                  const pinColor = pin.color ?? (isDark ? '#cbd5e1' : '#64748b');
                  return (
                    <g key={pin.id}>
                      <circle
                        cx={0}
                        cy={py}
                        r={5}
                        fill={isDark ? '#111318' : '#ffffff'}
                        stroke={pinColor}
                        strokeWidth={2}
                      />
                      <circle cx={0} cy={py} r={2.2} fill={pinColor} />
                      <text
                        x={11}
                        y={py + 3.5}
                        fill={isDark ? '#cbd5e1' : '#334155'}
                        fontSize={10.5}
                        fontFamily="Inter, Noto Sans SC, sans-serif"
                      >
                        {pin.label}
                      </text>
                    </g>
                  );
                })}

                {/* Outputs */}
                {(node.outputs ?? []).map((pin, idx) => {
                  const py = headH + 16 + idx * 23;
                  const pinColor = pin.color ?? (isDark ? '#cbd5e1' : '#64748b');
                  return (
                    <g key={pin.id}>
                      <circle
                        cx={w}
                        cy={py}
                        r={5}
                        fill={isDark ? '#111318' : '#ffffff'}
                        stroke={pinColor}
                        strokeWidth={2}
                      />
                      <circle cx={w} cy={py} r={2.2} fill={pinColor} />
                      <text
                        x={w - 11}
                        y={py + 3.5}
                        fill={isDark ? '#e2e8f0' : '#1e293b'}
                        fontSize={10.5}
                        textAnchor="end"
                        fontFamily="Inter, Noto Sans SC, sans-serif"
                      >
                        {pin.label}
                      </text>
                    </g>
                  );
                })}

                {noteLines.length > 0 && (
                  <g>
                    <line
                      x1={10}
                      y1={h - noteBlockH + 2}
                      x2={w - 10}
                      y2={h - noteBlockH + 2}
                      stroke={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(23,22,20,0.1)'}
                      strokeWidth={1}
                    />
                    <text
                      x={w / 2}
                      y={h - noteBlockH + 16}
                      fill={isDark ? '#fcd34d' : '#92400e'}
                      fontSize={9.6}
                      textAnchor="middle"
                      fontFamily="Inter, Noto Sans SC, sans-serif"
                    >
                      {noteLines.map((ln, lIdx) => (
                        <tspan key={lIdx} x={w / 2} dy={lIdx === 0 ? 0 : 14}>
                          {ln}
                        </tspan>
                      ))}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="schematic-caption">
        <Lightbulb size={15} style={{ color: 'var(--brand-primary)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong style={{ color: 'var(--text-primary)' }}>连线逻辑速读：</strong>
          {diagram.caption}
        </div>
      </div>
    </div>
  );
};
