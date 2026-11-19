import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, BookOpen, X, CornerDownLeft } from 'lucide-react';
import { ModuleDefinition } from '../types/course';

interface SearchHit {
  lessonId: string;
  stepIndex: number;
  moduleLabel: string;
  lessonNumber: string;
  lessonTitle: string;
  stepTitle: string;
  snippet: string;
}

const QUICK_TAGS = ['sRGB', '法线', 'BC5', 'Substrate', 'Mipmap', '水', '玻璃', 'DepthFade'];

export const SearchModal: React.FC<{
  open: boolean;
  modules: ModuleDefinition[];
  onClose: () => void;
  onSelect: (lessonId: string, stepIndex: number) => void;
}> = ({ open, modules, onClose, onSelect }) => {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list: SearchHit[] = [];

    for (const mod of modules) {
      for (const lesson of mod.lessons) {
        if (!q) {
          if (list.length < 10) {
            list.push({
              lessonId: lesson.id,
              stepIndex: 0,
              moduleLabel: `${mod.number} ${mod.title}`,
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
          list.push({
            lessonId: lesson.id,
            stepIndex: 0,
            moduleLabel: `${mod.number} ${mod.title}`,
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
              list.push({
                lessonId: lesson.id,
                stepIndex: idx,
                moduleLabel: `${mod.number} ${mod.title}`,
                lessonNumber: lesson.number,
                lessonTitle: lesson.title,
                stepTitle: `Step ${idx + 1} · ${st.title}`,
                snippet: st.paragraphs[0]?.slice(0, 86) + '…',
              });
              break;
            }
          }
        }
        if (list.length >= 16) break;
      }
      if (list.length >= 16) break;
    }
    return list;
  }, [query, modules]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (hits.length > 0 ? (i + 1) % hits.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (hits.length > 0 ? (i - 1 + hits.length) % hits.length : 0));
    } else if (e.key === 'Enter' && hits[activeIdx]) {
      e.preventDefault();
      onSelect(hits[activeIdx].lessonId, hits[activeIdx].stepIndex);
      onClose();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="search-modal"
        role="dialog"
        aria-modal="true"
        aria-label="搜索课程概念与 UE5.8 节点"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="search-input-bar">
          <Search size={17} style={{ color: 'var(--brand-primary)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            className="search-input-field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索材质概念、UE 5.8 节点或问题关键字..."
          />
          <button
            type="button"
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            onClick={onClose}
            aria-label="关闭搜索"
          >
            <X size={15} />
          </button>
        </div>

        <div className="search-quick-tags">
          <span>热门检索：</span>
          {QUICK_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              className="search-tag-btn"
              onClick={() => {
                setQuery(tag);
                inputRef.current?.focus();
              }}
            >
              {tag}
            </button>
          ))}
        </div>

        <div className="search-results-list">
          {hits.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              没有找到匹配「{query}」的章节，试试点击上方热门标签快速定位
            </div>
          ) : (
            hits.map((h, i) => {
              const isSelected = i === activeIdx;
              return (
                <button
                  key={`${h.lessonId}-${h.stepIndex}-${i}`}
                  type="button"
                  className={`search-hit-btn ${isSelected ? 'active' : ''}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => {
                    onSelect(h.lessonId, h.stepIndex);
                    onClose();
                  }}
                >
                  <BookOpen
                    size={15}
                    style={{
                      marginTop: 3,
                      flexShrink: 0,
                      color: isSelected ? 'var(--brand-primary)' : 'var(--text-muted)',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h.lessonNumber} {h.lessonTitle}
                      </span>
                      <span className="meta-pill neutral" style={{ fontSize: 10, padding: '1px 7px', flexShrink: 0 }}>
                        {h.moduleLabel}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--brand-primary-deep)', marginTop: 2 }}>
                      {h.stepTitle}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: 'var(--text-muted)',
                        marginTop: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h.snippet}
                    </div>
                  </div>
                  {isSelected && (
                    <CornerDownLeft size={14} style={{ color: 'var(--brand-primary)', marginTop: 4, flexShrink: 0 }} />
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="search-footer">
          <span>
            <span className="kbd-chip">↑</span> <span className="kbd-chip">↓</span> 选择 ·{' '}
            <span className="kbd-chip">Enter</span> 跳转 · <span className="kbd-chip">Esc</span> 关闭
          </span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{hits.length} 条结果</span>
        </div>
      </div>
    </div>
  );
};
