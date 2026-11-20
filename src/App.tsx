import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BookOpen,
  Stethoscope,
  FlaskConical,
  FileSpreadsheet,
  Search,
  Sun,
  Moon,
  ChevronRight,
  ChevronDown,
  Check,
  Clock,
  BarChart2,
  ListOrdered,
  RotateCcw,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  GitBranch,
  CheckCircle2,
  Circle,
  PanelLeftClose,
  PanelLeftOpen,
  Compass,
  Lightbulb,
  AlertTriangle,
  Layers,
  Sigma,
} from 'lucide-react';
import { ALL_MODULES, ALL_LESSONS } from './lessons';
import { KpiCard, StepTagType, LessonCallout } from './types/course';
import { FormattedText } from './components/ui/StageWidgets';
import { UE5SchematicView } from './components/ui/UE5SchematicView';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { ShaderLabPage } from './pages/ShaderLabPage';
import { CheatsheetsPage } from './pages/CheatsheetsPage';
import { SearchModal } from './components/SearchModal';

type AppMode = 'learn' | 'diagnostics' | 'lab' | 'cheatsheets';

const STEP_TAG_META: Record<StepTagType, { label: string; pillClass: string }> = {
  phenomenon: { label: '生活现象 · 提问', pillClass: 'amber' },
  background: { label: '背景知识 · 铺垫', pillClass: 'sky' },
  experiment: { label: '亲手体验 · 顿悟', pillClass: 'sage' },
  ue5: { label: '走进 UE 5.8 · 落地', pillClass: 'lavender' },
  pitfall: { label: '实战避坑 · 总结', pillClass: 'coral' },
};

const STORAGE_COMPLETED_KEY = 'ue58_mat_completed_lessons_v1';
const STORAGE_THEME_KEY = 'ue58_mat_theme_v1';
const STORAGE_VISITS_KEY = 'ue58_mat_visited_steps_v2';

function readRoute() {
  const [page, lessonId, step] = window.location.hash.replace(/^#\/?/, '').split('/');
  const lesson = ALL_LESSONS.find((l) => l.id === lessonId) ?? ALL_LESSONS[0];
  const mode: AppMode = page === 'diagnostics' || page === 'lab' || page === 'cheatsheets' ? page : 'learn';
  const number = Number(step);
  return { mode, lesson, step: Number.isInteger(number) && number >= 1 && number <= lesson.steps.length ? number - 1 : 0 };
}

function readVisits(): Record<string, number[]> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_VISITS_KEY) ?? '{}');
    return Object.fromEntries(
      ALL_LESSONS.map((lesson) => {
        const indices = saved?.[lesson.id];
        return [lesson.id, lesson.steps.map((_, i) => i).filter((i) => Array.isArray(indices) && indices.includes(i))];
      })
    );
  } catch {
    return {};
  }
}

const CalloutIcon: React.FC<{ tone: LessonCallout['tone'] }> = ({ tone }) => {
  switch (tone) {
    case 'warn':
      return <AlertTriangle size={14} />;
    case 'ue58':
      return <Layers size={14} />;
    case 'formula':
      return <Sigma size={14} />;
    default:
      return <Lightbulb size={14} />;
  }
};

export const App: React.FC = () => {
  const [initial] = useState(readRoute);
  const [mode, setMode] = useState<AppMode>(initial.mode);
  const [lessonId, setLessonId] = useState(initial.lesson.id);
  const [stepIndex, setStepIndex] = useState(initial.step);
  const [expandedModuleId, setExpandedModuleId] = useState(initial.lesson.moduleId);
  const [stageView, setStageView] = useState<'interactive' | 'schematic'>('interactive');
  const [resetSignal, setResetSignal] = useState<number>(0);
  const [kpis, setKpis] = useState<KpiCard[]>([]);
  const [visitedSteps, setVisitedSteps] = useState(readVisits);
  const [progressOpen, setProgressOpen] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

  const [isDark, setIsDark] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_THEME_KEY) === 'dark';
  });

  const [legacyMarks, setLegacyMarks] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_COMPLETED_KEY) ?? '{}') ?? {};
    } catch {
      return {};
    }
  });

  const completedLessons = useMemo(
    () => Object.fromEntries(ALL_LESSONS.map((l) => [l.id, visitedSteps[l.id]?.length === l.steps.length])),
    [visitedSteps]
  );

  // Theme attribute sync
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem(STORAGE_THEME_KEY, isDark ? 'dark' : 'light');
  }, [isDark]);

  // Hash listener
  useEffect(() => {
    const syncFromHash = () => {
      const route = readRoute();
      setMode(route.mode);
      if (route.mode === 'learn') {
        setLessonId(route.lesson.id);
        setExpandedModuleId(route.lesson.moduleId);
        setStepIndex(route.step);
      }
    };
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  // Update URL hash cleanly
  useEffect(() => {
    const nextHash = mode === 'learn' ? `#/learn/${lessonId}/${stepIndex + 1}` : `#/${mode}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
    }
  }, [mode, lessonId, stepIndex]);

  const currentLessonIndex = useMemo(
    () => Math.max(0, ALL_LESSONS.findIndex((l) => l.id === lessonId)),
    [lessonId]
  );
  const currentLesson = ALL_LESSONS[currentLessonIndex] ?? ALL_LESSONS[0];
  const currentModule = useMemo(
    () => ALL_MODULES.find((m) => m.id === currentLesson?.moduleId) ?? ALL_MODULES[0],
    [currentLesson]
  );
  const lessonIndexInModule = useMemo(
    () => Math.max(0, currentModule.lessons.findIndex((l) => l.id === currentLesson.id)),
    [currentModule, currentLesson]
  );

  const safeStepIndex = Math.min(stepIndex, (currentLesson?.steps.length ?? 1) - 1);
  const currentStep = currentLesson?.steps[safeStepIndex];

  // Track step visits & completion
  useEffect(() => {
    if (mode !== 'learn') return;
    setVisitedSteps((prev) => {
      const seen = prev[currentLesson.id] ?? [];
      return seen.includes(safeStepIndex) ? prev : { ...prev, [currentLesson.id]: [...seen, safeStepIndex] };
    });
  }, [mode, currentLesson, safeStepIndex]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_VISITS_KEY, JSON.stringify(visitedSteps));
    } catch {
      /* storage unavailable */
    }
  }, [visitedSteps]);

  const handleKpiUpdate = useCallback((nextKpis: KpiCard[]) => {
    setKpis((prev) => {
      if (
        prev.length === nextKpis.length &&
        prev.every(
          (p, i) => p.label === nextKpis[i].label && p.value === nextKpis[i].value && p.tone === nextKpis[i].tone
        )
      ) {
        return prev;
      }
      return nextKpis;
    });
  }, []);

  const navigateToLesson = useCallback((targetLessonId: string, targetStep = 0) => {
    const found = ALL_LESSONS.find((l) => l.id === targetLessonId);
    if (!found) return;
    setMode('learn');
    setLessonId(found.id);
    setStepIndex(targetStep);
    setExpandedModuleId(found.moduleId);
    setStageView('interactive');
    setKpis([]);
  }, []);

  const goPrev = useCallback(() => {
    if (safeStepIndex > 0) {
      setStepIndex(safeStepIndex - 1);
    } else if (currentLessonIndex > 0) {
      const prevLesson = ALL_LESSONS[currentLessonIndex - 1];
      navigateToLesson(prevLesson.id, prevLesson.steps.length - 1);
    }
  }, [safeStepIndex, currentLessonIndex, navigateToLesson]);

  const goNext = useCallback(() => {
    if (!currentLesson) return;
    if (safeStepIndex < currentLesson.steps.length - 1) {
      setStepIndex(safeStepIndex + 1);
    } else if (currentLessonIndex < ALL_LESSONS.length - 1) {
      const nextLesson = ALL_LESSONS[currentLessonIndex + 1];
      navigateToLesson(nextLesson.id, 0);
    } else {
      setMode('diagnostics');
    }
  }, [currentLesson, safeStepIndex, currentLessonIndex, navigateToLesson]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
        return;
      }
      if (searchOpen) {
        if (e.key === 'Escape') setSearchOpen(false);
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (mode === 'learn') {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          goNext();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          goPrev();
        } else if (e.key.toLowerCase() === 'v') {
          e.preventDefault();
          setStageView((v) => (v === 'interactive' ? 'schematic' : 'interactive'));
        } else if (e.key.toLowerCase() === 'r') {
          e.preventDefault();
          setResetSignal((n) => n + 1);
        } else if (e.key === '[') {
          e.preventDefault();
          setSidebarCollapsed((c) => !c);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, searchOpen, goNext, goPrev]);

  const completedCount = Object.values(completedLessons).filter(Boolean).length;
  const totalLessonsCount = ALL_LESSONS.length;
  const progressPct = Math.round((completedCount / Math.max(1, totalLessonsCount)) * 100);
  const StageComp = currentLesson?.StageComponent;
  const tagMeta = currentStep ? STEP_TAG_META[currentStep.tag] : STEP_TAG_META.phenomenon;
  const visitsForCurrent = visitedSteps[currentLesson.id] ?? [];
  const stepperProgressPct =
    currentLesson.steps.length > 1 ? (safeStepIndex / (currentLesson.steps.length - 1)) * 100 : 100;

  return (
    <div className="app-shell">
      {/* Top Navbar */}
      <header className="top-header">
        <div className="header-left">
          {mode === 'learn' && (
            <button
              type="button"
              className={`icon-btn ${sidebarCollapsed ? 'is-active' : ''}`}
              onClick={() => setSidebarCollapsed((c) => !c)}
              title={sidebarCollapsed ? '展开课程目录 (快捷键 [)' : '收起目录进入专注模式 (快捷键 [)'}
              aria-label="切换课程目录"
            >
              {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
          )}
          <div
            className="brand-group"
            onClick={() => navigateToLesson(ALL_LESSONS[0].id, 0)}
            title="返回第一节课"
          >
            <div className="brand-mark" aria-hidden>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.9" />
                <circle cx="9.2" cy="9.2" r="2.6" fill="#5eead4" />
                <path
                  d="M15.8 7.5C17.4 9.2 18 11.8 17.2 14.3C16.3 16.9 13.7 18.6 10.9 18.3"
                  stroke="rgba(255,255,255,0.55)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <span className="brand-title">UE5 材质工坊</span>
            <span className="version-pill">UE 5.8 · Substrate</span>
          </div>
        </div>

        <nav className="mode-tabs" aria-label="主导航">
          <button
            type="button"
            className={`mode-tab ${mode === 'learn' ? 'active' : ''}`}
            onClick={() => setMode('learn')}
          >
            <BookOpen size={14} /> 课程图解
          </button>
          <button
            type="button"
            className={`mode-tab ${mode === 'diagnostics' ? 'active' : ''}`}
            onClick={() => setMode('diagnostics')}
          >
            <Stethoscope size={14} /> 实战排错
          </button>
          <button
            type="button"
            className={`mode-tab ${mode === 'lab' ? 'active' : ''}`}
            onClick={() => setMode('lab')}
          >
            <FlaskConical size={14} /> 材质实验室
          </button>
          <button
            type="button"
            className={`mode-tab ${mode === 'cheatsheets' ? 'active' : ''}`}
            onClick={() => setMode('cheatsheets')}
          >
            <FileSpreadsheet size={14} /> 速查手册
          </button>
        </nav>

        <div className="header-tools">
          <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Search size={13.5} /> 搜索概念、节点与案例...
            </span>
            <span className="kbd-chip">Ctrl K</span>
          </button>

          <button
            type="button"
            className="icon-btn"
            onClick={() => setIsDark((d) => !d)}
            title={isDark ? '切换画室浅色纸感主题' : '切换光学暗房深色主题'}
            aria-label="切换明暗主题"
          >
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      {/* Main Content by Mode */}
      {mode === 'diagnostics' && <DiagnosticsPage onJumpToLesson={(id) => navigateToLesson(id, 0)} />}
      {mode === 'lab' && <ShaderLabPage />}
      {mode === 'cheatsheets' && <CheatsheetsPage />}

      {mode === 'learn' && currentLesson && currentStep && (
        <div className={`learn-workbench ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          {/* LEFT COLUMN: Collapsible Curriculum Accordion + Progress Drawer */}
          {!sidebarCollapsed && (
            <aside className="sidebar-col">
              <div className="sidebar-card">
                <div className="sidebar-header">
                  <span>课程体系</span>
                  <span className="sidebar-count-pill">{totalLessonsCount} 节</span>
                </div>

                <div className="chapter-scroll">
                  {ALL_MODULES.map((mod) => {
                    const isOpen = expandedModuleId === mod.id;
                    const modDone = mod.lessons.filter((l) => completedLessons[l.id]).length;
                    const modAllDone = modDone === mod.lessons.length;
                    return (
                      <div key={mod.id} className="module-group">
                        <button
                          type="button"
                          className={`module-header-btn ${isOpen ? 'is-open' : ''}`}
                          onClick={() => setExpandedModuleId(isOpen ? '' : mod.id)}
                        >
                          <span className="module-header-main">
                            {isOpen ? <ChevronDown size={13.5} /> : <ChevronRight size={13.5} />}
                            <span className="module-num">{mod.number}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {mod.title}
                            </span>
                          </span>
                          <span className={`module-count ${modAllDone ? 'done' : ''}`}>
                            {modDone}/{mod.lessons.length}
                          </span>
                        </button>

                        {isOpen && (
                          <div className="lesson-list">
                            {mod.lessons.map((les) => {
                              const isActive = les.id === currentLesson.id;
                              const isDone = !!completedLessons[les.id];
                              return (
                                <button
                                  key={les.id}
                                  type="button"
                                  className={`lesson-nav-btn ${isActive ? 'active' : ''}`}
                                  onClick={() => navigateToLesson(les.id, 0)}
                                >
                                  <span className={`lesson-status-dot ${isDone ? 'done' : ''}`}>
                                    {isDone ? (
                                      <Check size={12.5} strokeWidth={2.8} />
                                    ) : (
                                      <Circle size={6} fill="currentColor" strokeWidth={0} />
                                    )}
                                  </span>
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {les.number} {les.title.split('——')[0].trim()}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {legacyMarks[currentLesson.id] && !completedLessons[currentLesson.id] && (
                <div className="legacy-notice">旧版曾标记本课完成；本版按实际阅读的五个步骤自动统计。</div>
              )}

              {/* Bottom Progress Drawer */}
              <div className="progress-drawer">
                <button type="button" className="progress-head" onClick={() => setProgressOpen((p) => !p)}>
                  <span style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>PROGRESS · 学习进度</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                    {completedCount}/{totalLessonsCount} · {progressPct}% {progressOpen ? '▾' : '▴'}
                  </span>
                </button>
                <div className="progress-bar-track">
                  <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
                </div>

                {progressOpen && (
                  <div className="progress-breakdown">
                    {ALL_MODULES.map((m) => {
                      const cnt = m.lessons.filter((l) => completedLessons[l.id]).length;
                      const allDone = cnt === m.lessons.length;
                      return (
                        <div key={m.id} className={`progress-mod-row ${allDone ? 'done' : ''}`}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            {allDone ? (
                              <CheckCircle2 size={13} style={{ color: 'var(--accent-sage-deep)', flexShrink: 0 }} />
                            ) : (
                              <Circle size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            )}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.number}. {m.title}
                            </span>
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, flexShrink: 0 }}>
                            {cnt}/{m.lessons.length}
                          </span>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="progress-reset-btn"
                      onClick={() => {
                        setLegacyMarks({});
                        localStorage.removeItem(STORAGE_COMPLETED_KEY);
                        setVisitedSteps({});
                      }}
                    >
                      清空学习进度记录
                    </button>
                  </div>
                )}
              </div>
            </aside>
          )}

          {/* CENTER COLUMN: Editorial Hero + Interactive Stage + Connected Stepper */}
          <main className="center-col">
            <div className="lesson-hero">
              <div className="lesson-hero-top">
                <div className="breadcrumb-line">
                  {currentModule.number}. {currentModule.title} &nbsp;/&nbsp; 第 {lessonIndexInModule + 1} 节（共{' '}
                  {currentModule.lessons.length} 节）
                </div>
                <div className="meta-pills">
                  <span className="meta-pill neutral">
                    <Clock size={11} /> {currentLesson.duration}
                  </span>
                  <span className="meta-pill sage">
                    <BarChart2 size={11} /> {currentLesson.difficulty}
                  </span>
                  <span className="meta-pill lavender">
                    <ListOrdered size={11} /> {currentLesson.steps.length} 步渐进
                  </span>
                </div>
              </div>
              <h1 className="lesson-h1">
                <FormattedText text={currentLesson.title} />
              </h1>
              <p className="lesson-subtitle">{currentLesson.subtitle}</p>
            </div>

            <div className="stage-card">
              {/* Row 1: View Switcher + Reset */}
              <div className="stage-header-bar">
                <div className="view-switcher">
                  <button
                    type="button"
                    className={`view-btn ${stageView === 'interactive' ? 'active' : ''}`}
                    onClick={() => setStageView('interactive')}
                  >
                    <Sparkles size={13} /> 动手体验台
                  </button>
                  <button
                    type="button"
                    className={`view-btn ${stageView === 'schematic' ? 'active' : ''}`}
                    onClick={() => setStageView('schematic')}
                  >
                    <GitBranch size={13} /> UE5.8 节点/原理图
                  </button>
                </div>

                <div className="stage-header-actions">
                  <button
                    type="button"
                    className="stage-reset-btn"
                    onClick={() => setResetSignal((s) => s + 1)}
                    title="重置当前实验参数 (快捷键 R)"
                  >
                    <RotateCcw size={12.5} /> 重置实验
                  </button>
                </div>
              </div>

              {/* Row 2: Sleek Single-Line Telemetry Strip */}
              <div className="kpi-strip">
                {kpis.length > 0 ? (
                  kpis.map((k, idx) => (
                    <div key={idx} className={`kpi-chip ${k.tone ?? 'neutral'}`} title={k.sub ?? k.label}>
                      <span className="kpi-label-wrap">
                        <span className="kpi-dot" aria-hidden />
                        <span className="kpi-label">{k.label}</span>
                      </span>
                      <span className="kpi-value">{k.value}</span>
                    </div>
                  ))
                ) : (
                  <div className="kpi-chip accent">
                    <span className="kpi-label-wrap">
                      <span className="kpi-dot" aria-hidden />
                      <span className="kpi-label">交互实验台状态</span>
                    </span>
                    <span className="kpi-value">实时响应就绪</span>
                  </div>
                )}
              </div>

              <div className="stage-body">
                <div hidden={stageView !== 'interactive'}>
                  <StageComp
                    key={currentLesson.id}
                    stepIndex={safeStepIndex}
                    onKpiUpdate={handleKpiUpdate}
                    resetSignal={resetSignal}
                    isDark={isDark}
                  />
                </div>
                {stageView === 'schematic' && (
                  <UE5SchematicView diagram={currentLesson.schematic} isDark={isDark} />
                )}
              </div>
            </div>

            {/* Bottom Connected Stepper */}
            <div className="stepper-card">
              <div className="stepper-head">
                <span>LESSON PATH · 本节五步阶梯</span>
                <span>
                  STEP {safeStepIndex + 1} / {currentLesson.steps.length}
                </span>
              </div>
              <div className="stepper-track-wrap">
                <div className="stepper-rail-bg" aria-hidden>
                  <div className="stepper-rail-fill" style={{ width: `${stepperProgressPct}%` }} />
                </div>
                <div className="stepper-track">
                  {currentLesson.steps.map((st, idx) => {
                    const isActive = idx === safeStepIndex;
                    const isVisited = visitsForCurrent.includes(idx);
                    return (
                      <button
                        key={st.stepNumber}
                        type="button"
                        className={`step-node-btn ${isActive ? 'active' : ''} ${isVisited ? 'visited' : ''}`}
                        onClick={() => setStepIndex(idx)}
                      >
                        <span className="step-circle">
                          {isVisited && !isActive ? <Check size={12} strokeWidth={2.8} /> : st.stepNumber}
                        </span>
                        <span className="step-short-label">{st.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </main>

          {/* RIGHT COLUMN: Editorial Narrative + Takeaways */}
          <aside className="right-col">
            <div className="narrative-card">
              <div className="step-badge-row">
                <span className="step-counter">
                  STEP 0{safeStepIndex + 1} / 0{currentLesson.steps.length}
                </span>
                <span className={`meta-pill ${tagMeta.pillClass}`}>{tagMeta.label}</span>
              </div>

              <h2 className="step-h2">
                <FormattedText text={currentStep.title} />
              </h2>

              <div className="prose-block">
                {currentStep.paragraphs.map((p, idx) => (
                  <p key={idx} className="prose-p">
                    <FormattedText text={p} />
                  </p>
                ))}
              </div>

              <div className="try-it-box">
                <Compass size={16} className="try-it-icon" />
                <div>
                  <strong>动手试试：</strong>
                  <FormattedText text={currentStep.tryItPrompt} />
                </div>
              </div>

              {currentStep.callout && (
                <div className={`callout-box ${currentStep.callout.tone}`}>
                  <div className="callout-title">
                    <CalloutIcon tone={currentStep.callout.tone} />
                    <span>{currentStep.callout.title}</span>
                  </div>
                  <div>
                    <FormattedText text={currentStep.callout.body} />
                  </div>
                </div>
              )}

              <div className="nav-btn-row">
                <button
                  type="button"
                  className="brutal-btn"
                  onClick={goPrev}
                  disabled={currentLessonIndex === 0 && safeStepIndex === 0}
                >
                  <ArrowLeft size={14} /> 上一步
                </button>

                <button type="button" className="brutal-btn primary" onClick={goNext}>
                  {safeStepIndex < currentLesson.steps.length - 1 ? (
                    <>
                      下一步：{currentLesson.steps[safeStepIndex + 1].shortLabel} <ArrowRight size={14} />
                    </>
                  ) : currentLessonIndex < ALL_LESSONS.length - 1 ? (
                    <>
                      下一节：{ALL_LESSONS[currentLessonIndex + 1].number}{' '}
                      {ALL_LESSONS[currentLessonIndex + 1].title.split('——')[0].trim()} <ArrowRight size={14} />
                    </>
                  ) : (
                    <>
                      进入实战排错诊所 <ArrowRight size={14} />
                    </>
                  )}
                </button>
              </div>

              <div className="shortcut-hint">
                <span>
                  <span className="kbd-chip">←</span> <span className="kbd-chip">→</span> 切步
                </span>
                <span>
                  <span className="kbd-chip">V</span> 节点图
                </span>
                <span>
                  <span className="kbd-chip">R</span> 重置
                </span>
                <span>
                  <span className="kbd-chip">[</span> 目录
                </span>
              </div>
            </div>

            {/* Takeaways Checklist */}
            <div className="takeaway-card">
              <div className="takeaway-header">
                <span className="takeaway-title">KEY TAKEAWAYS · 本节你将掌握</span>
                <span className={`meta-pill ${completedLessons[currentLesson.id] ? 'sage' : 'neutral'}`}>
                  {completedLessons[currentLesson.id] ? '已解锁' : `${visitsForCurrent.length}/${currentLesson.steps.length} 步`}
                </span>
              </div>
              {currentLesson.takeaways.map((item, idx) => {
                const unlocked = completedLessons[currentLesson.id];
                return (
                  <div key={idx} className={`takeaway-item ${unlocked ? 'done' : ''}`}>
                    {unlocked ? (
                      <CheckCircle2 size={15} style={{ color: 'var(--accent-sage-deep)', flexShrink: 0, marginTop: 3 }} />
                    ) : (
                      <Circle size={15} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 3 }} />
                    )}
                    <span>
                      <FormattedText text={item} />
                    </span>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      )}

      <SearchModal
        open={searchOpen}
        modules={ALL_MODULES}
        onClose={() => setSearchOpen(false)}
        onSelect={(id, stIdx) => navigateToLesson(id, stIdx)}
      />
    </div>
  );
};
