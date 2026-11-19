import React, { useState, useEffect, useRef } from 'react';
import { Search, BookOpen, X } from 'lucide-react';
import { ModuleDefinition } from '../types/course';

interface SearchHit {
  lessonId: string;
  stepIndex: number;
  lessonNumber: string;
  lessonTitle: string;
  stepTitle: string;
  snippet: string;
}

export const SearchModal: React.FC<{
  open: boolean;
  modules: ModuleDefinition[];
  onClose: () => void;
  onSelect: (lessonId: string, stepIndex: number) => void;
}> = ({ open, modules, onClose, onSelect }) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const hits: SearchHit[] = [];

  for (const mod of modules) {
    for (const lesson of mod.lessons) {
      if (!q) {
        if (hits.length < 10) {
          hits.push({
            lessonId: lesson.id,
            stepIndex: 0,
            lessonNumber: lesson.number,
            lessonTitle: lesson.title,
            stepTitle: lesson.steps[0]?.title ?? '',
            snippet: lesson.subtitle,
          });
        }
        continue;
      }
      const inLesson =
        lesson.title.toLowerCase().includes(q) ||
        lesson.subtitle.toLowerCase().includes(q) ||
        lesson.number.includes(q);

      if (inLesson) {
        hits.push({
          lessonId: lesson.id,
          stepIndex: 0,
          lessonNumber: lesson.number,
          lessonTitle: lesson.title,
          stepTitle: '进入本节起始步',
          snippet: lesson.subtitle,
        });
      } else {
        for (let idx = 0; idx < lesson.steps.length; idx++) {
          const st = lesson.steps[idx];
          const joined = `${st.title} ${st.paragraphs.join(' ')}`.toLowerCase();
          if (joined.includes(q)) {
            hits.push({
              lessonId: lesson.id,
              stepIndex: idx,
              lessonNumber: lesson.number,
              lessonTitle: lesson.title,
              stepTitle: `Step ${idx + 1}: ${st.title}`,
              snippet: st.paragraphs[0]?.slice(0, 82) + '...',
            });
            break;
          }
        }
      }
      if (hits.length >= 16) break;
    }
    if (hits.length >= 16) break;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderBottom: '1.5px solid var(--border-soft)',
          }}
        >
          <Search size={18} style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索材质概念、UE 5.8 节点（如 sRGB、法线、BC5、Lerp、Substrate、水、玻璃、雾、DepthFade）..."
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 14,
            }}
          />
          <button
            type="button"
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4 }}
          >
            <X size={17} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {hits.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              没有找到匹配「{query}」的章节，试试搜 `sRGB`、`法线`、`Mipmap`、`水`、`玻璃` 或 `Substrate`
            </div>
          ) : (
            hits.map((h, i) => (
              <button
                key={`${h.lessonId}-${h.stepIndex}-${i}`}
                type="button"
                onClick={() => {
                  onSelect(h.lessonId, h.stepIndex);
                  onClose();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '9px 12px',
                  borderRadius: 9,
                  border: '1px solid var(--border-soft)',
                  background: 'var(--bg-card)',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <BookOpen size={16} style={{ marginTop: 3, flexShrink: 0, color: 'var(--accent-sage-deep)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>
                    {h.lessonNumber} {h.lessonTitle}
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {h.stepTitle}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                    {h.snippet}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
