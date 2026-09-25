export type MetricKey = "temp" | "ph" | "nh3" | "no3";

export type MetricValues = Partial<Record<MetricKey, number>>;

export interface Tank {
  id: string;
  name: string;
  species: string;
  tag: string;
  /** 各品种的指标上限，读数大于上限即超限 */
  limits: Record<MetricKey, number>;
}

export interface Reading {
  id: string;
  tankId: string;
  at: number;
  shiftId: string;
  values: MetricValues;
  note?: string;
}

export interface IssueCheck {
  at: number;
  value: number;
  shiftId: string;
}

/** 超限生成的待处理项 */
export interface WaterIssue {
  id: string;
  tankId: string;
  metric: MetricKey;
  value: number;
  limit: number;
  openedAt: number;
  openedByShiftId: string;
  /** 当前负责班次，交班后转到下一班 */
  ownedByShiftId: string;
  status: "open" | "resolved";
  checks: IssueCheck[];
  linkedWaterTaskId?: string;
  resolvedAt?: number;
  resolveNote?: string;
}

export type WaterTaskStatus = "queued" | "pending_schedule" | "done" | "cancelled";

/** 换水任务：按紧急度排进当晚时段，冲突时停在待排 */
export interface WaterChangeTask {
  id: string;
  tankId: string;
  source: "auto" | "manual";
  issueId?: string;
  reason: string;
  percent: number;
  urgency: number;
  createdAt: number;
  createdByShiftId: string;
  ownedByShiftId: string;
  status: WaterTaskStatus;
  slotId?: string;
  blockedReason?: string;
  completedAt?: number;
  completeNote?: string;
}

export interface Shift {
  id: string;
  label: string;
  startedAt: number;
}

export interface HandoverEntry {
  id: string;
  at: number;
  fromShiftId: string;
  toShiftId: string;
  issueCount: number;
  taskCount: number;
}

export interface AppState {
  version: 1;
  tanks: Tank[];
  shifts: Shift[];
  currentShiftId: string;
  readings: Reading[];
  issues: WaterIssue[];
  waterTasks: WaterChangeTask[];
  handovers: HandoverEntry[];
}

export type FilterTab = "all" | "pending" | "water" | "done";
