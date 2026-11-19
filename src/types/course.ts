import React from 'react';

export type StepTagType =
  | 'phenomenon'   // 生活现象 · 提问
  | 'background'   // 背景知识 · 铺垫
  | 'experiment'   // 亲手体验 · 顿悟
  | 'ue5'          // 走进 UE 5.8 · 落地
  | 'pitfall';     // 实战避坑 · 总结

export type DifficultyLevel = '零基础' | '进阶' | '实战';

export interface KpiCard {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
}

export interface SchematicPin {
  id: string;
  label: string;
  color?: string; // e.g. '#ef4444' (R), '#22c55e' (G), '#3b82f6' (B), '#e5e7eb' (RGB/Float), '#a855f7' (Substrate)
}

export interface SchematicNode {
  id: string;
  title: string;
  subtitle?: string;
  category: 'input' | 'texture' | 'math' | 'param' | 'substrate' | 'output' | 'pipeline';
  x: number;
  y: number;
  width?: number;
  inputs?: SchematicPin[];
  outputs?: SchematicPin[];
  previewColor?: string;
  note?: string;
}

export interface SchematicEdge {
  fromNode: string;
  fromPin: string;
  toNode: string;
  toPin: string;
  color?: string;
  label?: string;
  dashed?: boolean;
}

export interface SchematicDiagram {
  title: string;
  caption: string;
  nodes: SchematicNode[];
  edges: SchematicEdge[];
}

export interface LessonCallout {
  tone: 'tip' | 'warn' | 'ue58' | 'formula';
  title: string;
  body: string;
}

export interface LessonStep {
  stepNumber: number;
  shortLabel: string;
  tag: StepTagType;
  title: string;
  paragraphs: string[];
  tryItPrompt: string;
  callout?: LessonCallout;
}

export interface LessonStageProps {
  stepIndex: number; // 0..steps.length-1
  onKpiUpdate: (kpis: KpiCard[]) => void;
  resetSignal: number;
  isDark: boolean;
}

export interface LessonDefinition {
  id: string;
  moduleId: string;
  number: string;
  title: string;
  subtitle: string;
  duration: string;
  difficulty: DifficultyLevel;
  steps: LessonStep[];
  takeaways: string[];
  schematic: SchematicDiagram;
  StageComponent: React.ComponentType<LessonStageProps>;
}

export interface ModuleDefinition {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  lessons: LessonDefinition[];
}
