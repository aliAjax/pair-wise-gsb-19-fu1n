import type {
  AppState,
  IssueCheck,
  MetricKey,
  MetricValues,
  Reading,
  Tank,
  WaterChangeTask,
  WaterIssue,
} from "./types";

/* ------------------------------------------------------------------ */
/* 指标与品种上限                                                       */
/* ------------------------------------------------------------------ */

export const METRICS: Record<
  MetricKey,
  { label: string; unit: string; step: string; precision: number }
> = {
  temp: { label: "水温", unit: "℃", step: "0.1", precision: 1 },
  ph: { label: "pH", unit: "", step: "0.1", precision: 1 },
  nh3: { label: "氨氮", unit: "ppm", step: "0.01", precision: 2 },
  no3: { label: "硝酸盐", unit: "ppm", step: "1", precision: 0 },
};

export const METRIC_ORDER: MetricKey[] = ["temp", "ph", "nh3", "no3"];

export const SPECIES_PRESETS: Array<Omit<Tank, "id">> = [
  {
    name: "草缸 A",
    species: "水草 / 灯鱼",
    tag: "草缸",
    limits: { temp: 26, ph: 7.2, nh3: 0.02, no3: 25 },
  },
  {
    name: "海缸 B",
    species: "小丑鱼 / 珊瑚",
    tag: "海缸",
    limits: { temp: 26.5, ph: 8.3, nh3: 0.02, no3: 10 },
  },
  {
    name: "三湖缸 C",
    species: "慈鲷",
    tag: "三湖缸",
    limits: { temp: 27, ph: 8.4, nh3: 0.02, no3: 30 },
  },
  {
    name: "繁殖缸 D",
    species: "孔雀鱼",
    tag: "繁殖缸",
    limits: { temp: 27, ph: 7.4, nh3: 0.02, no3: 20 },
  },
  {
    name: "龙鱼缸 E",
    species: "亚洲龙鱼",
    tag: "大型鱼缸",
    limits: { temp: 29, ph: 7.6, nh3: 0.02, no3: 25 },
  },
];

/** 当晚换水时段，一缸只占一个时段 */
export const SLOTS: { id: string; label: string }[] = [
  { id: "s1", label: "20:00 - 20:30" },
  { id: "s2", label: "20:30 - 21:00" },
  { id: "s3", label: "21:00 - 21:30" },
  { id: "s4", label: "21:30 - 22:00" },
  { id: "s5", label: "22:00 - 22:30" },
  { id: "s6", label: "22:30 - 23:00" },
  { id: "s7", label: "23:00 - 23:30" },
];

export const SHIFT_CYCLE = ["早班", "晚班", "夜班"] as const;

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function fmtValue(key: MetricKey, value: number): string {
  return `${value.toFixed(METRICS[key].precision)}${METRICS[key].unit ? " " + METRICS[key].unit : ""}`;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function isOverLimit(tank: Tank, key: MetricKey, value: number): boolean {
  return value > tank.limits[key];
}

/** 紧急度：按超上限幅度换算 0-100+，权重向氨氮/硝酸盐倾斜 */
export function urgencyOf(key: MetricKey, value: number, limit: number): number {
  const over = (value - limit) / limit;
  const weights: Record<MetricKey, number> = {
    nh3: 1000,
    no3: 500,
    temp: 300,
    ph: 200,
  };
  return Math.round(over * weights[key]);
}

export function urgencyLabel(score: number): string {
  if (score >= 200) return "紧急";
  if (score >= 50) return "加急";
  return "常规";
}

/** 一次读数里所有超限指标 */
export function evaluateReading(tank: Tank, values: MetricValues) {
  return METRIC_ORDER.filter(
    (key) => values[key] !== undefined && isOverLimit(tank, key, values[key] as number)
  ).map((key) => ({
    metric: key,
    value: values[key] as number,
    limit: tank.limits[key],
    urgency: urgencyOf(key, values[key] as number, tank.limits[key]),
  }));
}

function openIssue(state: AppState, tankId: string, metric: MetricKey) {
  return state.issues.find(
    (i) => i.tankId === tankId && i.metric === metric && i.status === "open"
  );
}

function makeWaterTask(
  state: AppState,
  tankId: string,
  urgency: number,
  source: WaterChangeTask["source"],
  issueId: string | undefined,
  reason: string,
  at: number
): WaterChangeTask {
  return {
    id: uid("wt"),
    tankId,
    source,
    issueId,
    reason,
    percent: urgency >= 200 ? 50 : urgency >= 50 ? 30 : 20,
    urgency,
    createdAt: at,
    createdByShiftId: state.currentShiftId,
    ownedByShiftId: state.currentShiftId,
    status: "pending_schedule",
  };
}

/* ------------------------------------------------------------------ */
/* 录入读数：超限开待处理项并排队换水；同缸同项未处理完只补检查记录      */
/* ------------------------------------------------------------------ */

export interface IngestResult {
  state: AppState;
  message: string;
}

export function ingestReading(
  prev: AppState,
  tankId: string,
  values: MetricValues,
  at: number
): IngestResult {
  const tank = prev.tanks.find((t) => t.id === tankId);
  if (!tank) return { state: prev, message: "请选择鱼缸" };

  const reading: Reading = {
    id: uid("rd"),
    tankId,
    at,
    shiftId: prev.currentShiftId,
    values: { ...values },
  };

  const state: AppState = {
    ...prev,
    readings: [reading, ...prev.readings],
    issues: [...prev.issues],
    waterTasks: [...prev.waterTasks],
  };

  const breaches = evaluateReading(tank, values);
  const created: WaterIssue[] = [];
  const appendedMetrics: MetricKey[] = [];

  for (const b of breaches) {
    const existing = openIssue(state, tankId, b.metric);
    if (existing) {
      // 同缸同项还没处理完：只补一条检查记录，不重复开单、不重复排队
      const check: IssueCheck = { at, value: b.value, shiftId: state.currentShiftId };
      const idx = state.issues.findIndex((i) => i.id === existing.id);
      state.issues[idx] = { ...existing, checks: [...existing.checks, check] };
      appendedMetrics.push(b.metric);
      continue;
    }

    const issue: WaterIssue = {
      id: uid("iss"),
      tankId,
      metric: b.metric,
      value: b.value,
      limit: b.limit,
      openedAt: at,
      openedByShiftId: state.currentShiftId,
      ownedByShiftId: state.currentShiftId,
      status: "open",
      checks: [],
    };
    state.issues = [issue, ...state.issues];
    created.push(issue);

    const task = makeWaterTask(
      state,
      tankId,
      b.urgency,
      "auto",
      issue.id,
      `${METRICS[b.metric].label} ${fmtValue(b.metric, b.value)} 超品种上限 ${fmtValue(
        b.metric,
        b.limit
      )}，建议换水`,
      at
    );
    state.waterTasks = [task, ...state.waterTasks];
    state.issues = state.issues.map((i) =>
      i.id === issue.id ? { ...i, linkedWaterTaskId: task.id } : i
    );
  }

  const rescheduled = rescheduleWaterTasks(state);

  const parts: string[] = [];
  if (created.length) {
    parts.push(
      `生成待处理项 ${created.length} 条（${created
        .map((i) => `${tank.name}·${METRICS[i.metric].label}`)
        .join("、")}），已按紧急度排入换水队列`
    );
  }
  if (appendedMetrics.length) {
    parts.push(
      `同缸同项未处理完，${appendedMetrics
        .map((m) => METRICS[m].label)
        .join("、")} 仅补检查记录，不重复开单`
    );
  }
  if (!parts.length) parts.push(`${tank.name} 读数正常，已记录`);
  return { state: rescheduled, message: parts.join("；") };
}

/* ------------------------------------------------------------------ */
/* 换水排程：紧急度高者先占时段；一缸一时段；冲突停在待排并说明          */
/* ------------------------------------------------------------------ */

export function rescheduleWaterTasks(prev: AppState): AppState {
  // 每次都把全部活动任务按紧急度重排，避免新增高紧急任务后仍被低紧急任务
  // 占着更早时段；已完成 / 已撤销任务不参与
  const waiting = prev.waterTasks
    .filter((t) => t.status === "queued" || t.status === "pending_schedule")
    .sort((a, b) => b.urgency - a.urgency || a.createdAt - b.createdAt);

  const occupiedSlot = new Set<string>();
  const tankHasSlot = new Set<string>();
  const updates = new Map<string, WaterChangeTask>();

  for (const t of waiting) {
    if (tankHasSlot.has(t.tankId)) {
      updates.set(t.id, {
        ...t,
        status: "pending_schedule",
        slotId: undefined,
        blockedReason: "同一鱼缸当晚已占一个时段，等本缸换水完成或改约明晚",
      });
      continue;
    }
    const free = SLOTS.find((slot) => !occupiedSlot.has(slot.id));
    if (!free) {
      updates.set(t.id, {
        ...t,
        status: "pending_schedule",
        slotId: undefined,
        blockedReason: "当晚换水时段已满，需顺延明晚或加派人员",
      });
      continue;
    }
    occupiedSlot.add(free.id);
    tankHasSlot.add(t.tankId);
    updates.set(t.id, { ...t, status: "queued", slotId: free.id, blockedReason: undefined });
  }

  return {
    ...prev,
    waterTasks: prev.waterTasks.map((t) => updates.get(t.id) ?? t),
  };
}

/** 给某个未关联进行中换水任务的待处理项补排换水 */
export function queueWaterForIssue(prev: AppState, issueId: string, at: number): IngestResult {
  const issue = prev.issues.find((i) => i.id === issueId);
  if (!issue || issue.status !== "open") return { state: prev, message: "待处理项不存在" };
  const linked = issue.linkedWaterTaskId
    ? prev.waterTasks.find(
        (t) =>
          t.id === issue.linkedWaterTaskId &&
          (t.status === "queued" || t.status === "pending_schedule")
      )
    : undefined;
  if (linked) return { state: prev, message: "该待处理项已关联换水任务" };

  const tank = prev.tanks.find((t) => t.id === issue.tankId)!;
  const urgency = urgencyOf(issue.metric, issue.value, issue.limit);
  let state: AppState = { ...prev, issues: [...prev.issues], waterTasks: [...prev.waterTasks] };
  const task = makeWaterTask(
    state,
    tank.id,
    urgency,
    "manual",
    issue.id,
    `复测仍超限：${METRICS[issue.metric].label} ${fmtValue(issue.metric, issue.value)}，补排换水`,
    at
  );
  state.waterTasks = [task, ...state.waterTasks];
  state.issues = state.issues.map((i) =>
    i.id === issue.id ? { ...i, linkedWaterTaskId: task.id } : i
  );
  state = rescheduleWaterTasks(state);
  return {
    state,
    message:
      task.status === "queued"
        ? `${tank.name} 换水已排入 ${SLOTS.find((s) => s.id === task.slotId)?.label}`
        : `换水冲突，停在待排：${task.blockedReason}`,
  };
}

/** 手动登记一缸换水（不绑定待处理项） */
export function queueManualWater(
  prev: AppState,
  tankId: string,
  percent: number,
  at: number
): IngestResult {
  const tank = prev.tanks.find((t) => t.id === tankId);
  if (!tank) return { state: prev, message: "请选择鱼缸" };
  const state0: AppState = { ...prev, waterTasks: [...prev.waterTasks] };
  const task = makeWaterTask(
    state0,
    tankId,
    40,
    "manual",
    undefined,
    `手动登记换水 ${percent}%`,
    at
  );
  task.percent = percent;
  state0.waterTasks = [task, ...state0.waterTasks];
  const state = rescheduleWaterTasks(state0);
  return {
    state,
    message:
      task.status === "queued"
        ? `${tank.name} 换水已排入 ${SLOTS.find((s) => s.id === task.slotId)?.label}`
        : `换水冲突，停在待排：${task.blockedReason}`,
  };
}

/** 完成换水：占用释放，后续待排自动顺延补位；关联待处理项复测恢复 */
export function completeWaterTask(
  prev: AppState,
  taskId: string,
  at: number,
  note: string
): IngestResult {
  const task = prev.waterTasks.find((t) => t.id === taskId);
  if (!task) return { state: prev, message: "换水任务不存在" };
  const tank = prev.tanks.find((t) => t.id === task.tankId)!;

  let state: AppState = {
    ...prev,
    waterTasks: prev.waterTasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            status: "done",
            completedAt: at,
            slotId: t.slotId,
            completeNote: note || undefined,
            blockedReason: undefined,
          }
        : t
    ),
    issues: [...prev.issues],
  };

  if (task.issueId) {
    state.issues = state.issues.map((i): WaterIssue =>
      i.id === task.issueId && i.status === "open"
        ? {
            ...i,
            status: "resolved",
            resolvedAt: at,
            resolveNote: `换水 ${task.percent}% 后复测恢复正常`,
          }
        : i
    );
  }

  state = rescheduleWaterTasks(state);
  return { state, message: `${tank.name} 换水完成，时段已释放并自动顺延补位` };
}

/** 撤销换水（误登记）：关联待处理项恢复排队资格 */
export function cancelWaterTask(prev: AppState, taskId: string): IngestResult {
  const task = prev.waterTasks.find((t) => t.id === taskId);
  if (!task) return { state: prev, message: "换水任务不存在" };
  let state: AppState = {
    ...prev,
    waterTasks: prev.waterTasks.map((t) =>
      t.id === taskId
        ? { ...t, status: "cancelled", slotId: undefined, blockedReason: "已撤销登记" }
        : t
    ),
    issues: [...prev.issues],
  };
  if (task.issueId) {
    state.issues = state.issues.map((i) =>
      i.id === task.issueId ? { ...i, linkedWaterTaskId: undefined } : i
    );
  }
  state = rescheduleWaterTasks(state);
  return { state, message: "换水登记已撤销，队列已重新排程" };
}

/** 直接关闭待处理项（如手动处理完毕） */
export function resolveIssue(prev: AppState, issueId: string, at: number, note: string): IngestResult {
  const issue = prev.issues.find((i) => i.id === issueId);
  if (!issue) return { state: prev, message: "待处理项不存在" };
  const state = {
    ...prev,
    issues: prev.issues.map((i): WaterIssue =>
      i.id === issueId
        ? {
            ...i,
            status: "resolved",
            resolvedAt: at,
            resolveNote: note || "手动确认处理完成",
          }
        : i
    ),
  };
  return { state, message: "待处理项已标记完成" };
}

/* ------------------------------------------------------------------ */
/* 交班：未完成责任整体转到下一班                                       */
/* ------------------------------------------------------------------ */

export function nextShiftLabel(currentLabel: string): string {
  const idx = SHIFT_CYCLE.indexOf(currentLabel as (typeof SHIFT_CYCLE)[number]);
  return SHIFT_CYCLE[(idx + 1) % SHIFT_CYCLE.length];
}

export function handover(prev: AppState, at: number): { state: AppState; message: string } {
  const current = prev.shifts.find((s) => s.id === prev.currentShiftId)!;
  const label = nextShiftLabel(current.label);
  const newShift = { id: uid("sh"), label, startedAt: at };

  const openCount = prev.issues.filter((i) => i.status === "open").length;
  const taskCount = prev.waterTasks.filter(
    (t) => t.status === "queued" || t.status === "pending_schedule"
  ).length;

  const entry = {
    id: uid("hd"),
    at,
    fromShiftId: current.id,
    toShiftId: newShift.id,
    issueCount: openCount,
    taskCount,
  };

  const state: AppState = {
    ...prev,
    shifts: [...prev.shifts, newShift],
    currentShiftId: newShift.id,
    issues: prev.issues.map((i) =>
      i.status === "open" ? { ...i, ownedByShiftId: newShift.id } : i
    ),
    waterTasks: prev.waterTasks.map((t) =>
      t.status === "queued" || t.status === "pending_schedule"
        ? { ...t, ownedByShiftId: newShift.id }
        : t
    ),
    handovers: [entry, ...prev.handovers],
  };

  return {
    state,
    message: `已交班给${label}：${openCount} 条待处理项、${taskCount} 个换水任务责任转移`,
  };
}
