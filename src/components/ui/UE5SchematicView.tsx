import React, { useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { SchematicDiagram, SchematicNode } from '../../types/course';

const HEADER_COLORS: Record<SchematicNode['category'], string> = {
  input: '#8b2635',     // UE Red (Input / Coordinates)
  texture: '#1f6f78',   // UE Teal (Texture Sample)
  math: '#2d5d8b',      // UE Blue (Math / Utility)
  param: '#2f6e3b',     // UE Green (Constant / Parameter)
  substrate: '#6d3b9e', // UE 5.8 Purple (Substrate Slab BSDF)
  output: '#8f6518',    // UE Gold/Brown (Material Root Output)
  pipeline: '#475569',  // Pipeline Stage
};

export const UE5SchematicView: React.FC<{ diagram: SchematicDiagram }> = ({ diagram }) => {
  const [zoom, setZoom] = useState(1);

  const nodeMap = new Map<string, SchematicNode>();
  diagram.nodes.forEach((n) => nodeMap.set(n.id, n));

  const getPinPos = (nodeId: string, pinId: string, side: 'in' | 'out'): [number, number] => {
    const node = nodeMap.get(nodeId);
    if (!node) return [0, 0];
    const w = node.width ?? 186;
    const headH = node.subtitle ? 42 : 30;
    const list = side === 'in' ? node.inputs ?? [] : node.outputs ?? [];
    const idx = Math.max(0, list.findIndex((p) => p.id === pinId));
    const py = node.y + headH + 14 + idx * 22;
    const px = side === 'in' ? node.x : node.x + w;
    return [px, py];
  };

  const maxX = Math.max(820, ...diagram.nodes.map((n) => n.x + (n.width ?? 186) + 90));
  const maxY = Math.max(340, ...diagram.nodes.map((n) => {
    const rows = Math.max(n.inputs?.length ?? 0, n.outputs?.length ?? 0, 1);
    const headH = n.subtitle ? 42 : 30;
    return n.y + headH + 18 + rows * 22 + (n.note ? 30 : 18);
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderRadius: 9,
          background: '#1c1d21',
          color: '#e5e7eb',
          border: '1.5px solid #374151',
          fontSize: 12,
        }}
      >
        <div>
          <strong style={{ color: '#c4dfb2' }}>UE 5.8 节点与管线对照图：</strong>
          <span>{diagram.title}</span>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.12).toFixed(2)))}
            style={{ background: '#2d3038', color: '#fff', border: '1px solid #4b5563', borderRadius: 6, padding: '3px 7px', cursor: 'pointer' }}
            title="放大"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.12).toFixed(2)))}
            style={{ background: '#2d3038', color: '#fff', border: '1px solid #4b5563', borderRadius: 6, padding: '3px 7px', cursor: 'pointer' }}
            title="缩小"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            style={{ background: '#2d3038', color: '#fff', border: '1px solid #4b5563', borderRadius: 6, padding: '3px 7px', cursor: 'pointer' }}
            title="重置缩放"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 290,
          borderRadius: 11,
          border: '1.5px solid #2b2d35',
          background: '#16171b',
          backgroundImage:
            'radial-gradient(#2c2f3a 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '18px 18px, 90px 90px, 90px 90px',
          overflow: 'auto',
          position: 'relative',
        }}
      >
        <svg
          width={maxX * zoom}
          height={maxY * zoom}
          viewBox={`0 0 ${maxX} ${maxY}`}
          style={{ display: 'block' }}
        >
          {/* Wires */}
          {diagram.edges.map((edge, idx) => {
            const [x1, y1] = getPinPos(edge.fromNode, edge.fromPin, 'out');
            const [x2, y2] = getPinPos(edge.toNode, edge.toPin, 'in');
            const dx = Math.max(44, Math.abs(x2 - x1) * 0.48);
            const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2 - 7;
            return (
              <g key={idx}>
                <path
                  d={path}
                  fill="none"
                  stroke={edge.color ?? '#d1d5db'}
                  strokeWidth={2.4}
                  strokeDasharray={edge.dashed ? '6 4' : undefined}
                />
                {edge.label && (
                  <text
                    x={mx}
                    y={my}
                    fill="#cbd5e1"
                    fontSize={10}
                    textAnchor="middle"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {diagram.nodes.map((node) => {
            const w = node.width ?? 186;
            const headH = node.subtitle ? 42 : 30;
            const rows = Math.max(node.inputs?.length ?? 0, node.outputs?.length ?? 0, 1);
            const h = headH + 8 + rows * 22 + (node.note ? 24 : 8);
            const headColor = HEADER_COLORS[node.category];
            return (
              <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                <rect
                  x={0}
                  y={0}
                  width={w}
                  height={h}
                  rx={8}
                  fill="#23252c"
                  stroke="#525866"
                  strokeWidth={1.4}
                />
                <path
                  d={`M 0 8 Q 0 0 8 0 L ${w - 8} 0 Q ${w} 0 ${w} 8 L ${w} ${headH} L 0 ${headH} Z`}
                  fill={headColor}
                />
                <text
                  x={10}
                  y={17}
                  fill="#ffffff"
                  fontSize={11.5}
                  fontWeight={700}
                  fontFamily="Noto Sans SC, sans-serif"
                >
                  {node.title}
                </text>
                {node.subtitle && (
                  <text
                    x={10}
                    y={33}
                    fill="rgba(255,255,255,0.8)"
                    fontSize={9.8}
                    fontFamily="JetBrains Mono, Noto Sans SC, monospace"
                  >
                    {node.subtitle}
                  </text>
                )}

                {/* Inputs */}
                {(node.inputs ?? []).map((pin, idx) => {
                  const py = headH + 14 + idx * 22;
                  return (
                    <g key={pin.id}>
                      <circle
                        cx={0}
                        cy={py}
                        r={4.8}
                        fill={pin.color ?? '#e5e7eb'}
                        stroke="#111827"
                        strokeWidth={1.3}
                      />
                      <text x={10} y={py + 4} fill="#d1d5db" fontSize={10.5}>
                        {pin.label}
                      </text>
                    </g>
                  );
                })}

                {/* Outputs */}
                {(node.outputs ?? []).map((pin, idx) => {
                  const py = headH + 14 + idx * 22;
                  return (
                    <g key={pin.id}>
                      <circle
                        cx={w}
                        cy={py}
                        r={4.8}
                        fill={pin.color ?? '#e5e7eb'}
                        stroke="#111827"
                        strokeWidth={1.3}
                      />
                      <text x={w - 10} y={py + 4} fill="#e5e7eb" fontSize={10.5} textAnchor="end">
                        {pin.label}
                      </text>
                    </g>
                  );
                })}

                {node.note && (
                  <text
                    x={w / 2}
                    y={h - 7}
                    fill="#fbbf24"
                    fontSize={9.8}
                    textAnchor="middle"
                  >
                    {node.note}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div
        style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          padding: '6px 10px',
          borderRadius: 8,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-soft)',
        }}
      >
        💡 <strong>连线逻辑速读：</strong> {diagram.caption}
      </div>
    </div>
  );
};
