import type {
  DeskState,
  Handover,
  Issue,
  Limits,
  MetricKey,
  Reading,
  ReadingValues,
  Shift,
  SpeciesKey,
  Tank,
  UrgencyKey,
  WaterTask,
} from "./types";

export const STORAGE_KEY = "aqua-duty-desk-v1";

export const METRICS: {
  key: MetricKey;
  label: string;
  unit: string;
  step: string;
  hint: string;
}[] = [
  { key: "temp", label: "水温", unit: "℃", step: "0.1", hint: "超过品种上限即报警" },
  { key: "ph", label: "pH", unit: "", step: "0.01", hint: "高于 pH 上限即报警" },
  { key: "nh3", label: "氨氮", unit: "ppm", step: "0.01", hint: "对鱼剧毒，超限即紧急换水" },
  { key: "no3", label: "硝酸盐", unit: "ppm", step: "0.1", hint: "长期偏高需换水稀释" },
];

export const METRIC_LABEL: Record<MetricKey, string> = {
  temp: "水温",
  ph: "pH",
  nh3: "氨氮",
  no3: "硝酸盐",
};

export const SPECIES: Record<SpeciesKey, { label: string; limits: Limits }> = {
  freshwater: { label: "淡水观赏鱼", limits: { temp: 28, ph: 7.6, nh3: 0.2, no3: 40 } },
  planted: { label: "草缸 / 灯鱼", limits: { temp: 27, ph: 7.2, nh3: 0.2, no3: 30 } },
  cichlid: { label: "三湖慈鲷", limits: { temp: 28, ph: 8.4, nh3: 0.2, no3: 30 } },
  marine: { label: "海水鱼 / 珊瑚", limits: { temp: 27, ph: 8.5, nh3: 0.1, no3: 20 } },
};

export const URGENCY: Record<UrgencyKey, { label: string; rank: number; tone: string }> = {
  critical: { label: "紧急", rank: 0, tone: "danger" },
  high: { label: "优先", rank: 1, tone: "warn" },
  medium: { label: "常规处理", rank: 2, tone: "info" },
  routine: { label: "计划换水", rank: 3, tone: "muted" },
};

/** 当晚换水时段：一个鱼缸同一晚只占一个时段 */
export const SLOTS = ["20:00", "20:30", "21:00", "21:30", "22:00", "22:30"];

let counter = 0;
export function uid(prefix = "id"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 7)}`;
}

export function currentShift(state: DeskState): Shift {
  return state.shifts.find((s) => s.active) ?? state.shifts[state.shifts.length - 1];
}

export function shiftById(state: DeskState, id: string): Shift | undefined {
  return state.shifts.find((s) => s.id === id);
}

export function tankById(state: DeskState, tankId: string): Tank | undefined {
  return state.tanks.find((t) => t.id === tankId);
}

export function readingById(state: DeskState, id: string): Reading | undefined {
  return state.readings.find((r) => r.id === id);
}

export function isOverLimit(tank: Tank, metric: MetricKey, value: number): boolean {
  return value > tank.limits[metric];
}

export function formatValue(metric: MetricKey, value: number): string {
  if (metric === "ph") return value.toFixed(2);
  if (metric === "temp") return value.toFixed(1);
  if (metric === "nh3") return value.toFixed(2);
  return value.toFixed(1);
}

/** 紧急程度：氨氮一律紧急；硝酸盐超限幅度分紧急/优先；其余常规处理 */
export function urgencyFor(tank: Tank, metric: MetricKey, value: number): UrgencyKey {
  const limit = tank.limits[metric];
  if (metric === "nh3") return "critical";
  if (metric === "no3") return value >= limit * 1.5 ? "critical" : "high";
  return "medium";
}

export interface SubmitReadingResult {
  state: DeskState;
  newReading: Reading;
  newIssues: Issue[];
  appendedIssueIds: string[];
  newTasks: WaterTask[];
  rechecks: Issue[];
}

/**
 * 登记一次检测：
 * - 超限且该缸该指标有未处理项 -> 只补一条检查记录，不重复生成待处理项
 * - 超限且无未处理项 -> 生成待处理项（氨氮/硝酸盐同时排入换水队列）
 * - 未超限 -> 若该缸该指标有未处理项，记为复测达标，待人工关闭
 */
export function submitReading(
  prev: DeskState,
  input: { tankId: string; values: ReadingValues; note?: string; at?: number }
): SubmitReadingResult {
  const tank = tankById(prev, input.tankId);
  if (!tank) throw new Error("鱼缸不存在");

  const entries = (Object.keys(input.values) as MetricKey[]).filter(
    (k) => typeof input.values[k] === "number" && !Number.isNaN(input.values[k] as number)
  );
  if (entries.length === 0) throw new Error("请至少填写一项检测数据");

  const shift = currentShift(prev);
  const reading: Reading = {
    id: uid("rd"),
    tankId: input.tankId,
    at: input.at ?? Date.now(),
    shiftId: shift.id,
    clerk: shift.clerk,
    note: input.note?.trim() || undefined,
    ...input.values,
  };

  const state: DeskState = {
    ...prev,
    readings: [...prev.readings, reading],
    issues: [...prev.issues],
    tasks: [...prev.tasks],
  };

  const newIssues: Issue[] = [];
  const appendedIssueIds: string[] = [];
  const newTasks: WaterTask[] = [];
  const rechecks: Issue[] = [];

  for (const metric of entries) {
    const value = reading[metric] as number;
    const open = state.issues.find(
      (it) => it.tankId === tank.id && it.metric === metric && it.status === "open"
    );

    if (isOverLimit(tank, metric, value)) {
      if (open) {
        // 同缸同项未处理完，再测超限只补检查记录
        state.issues = state.issues.map((it) =>
          it.id === open.id ? { ...it, checkReadingIds: [...it.checkReadingIds, reading.id] } : it
        );
        appendedIssueIds.push(open.id);
      } else {
        const urgency = urgencyFor(tank, metric, value);
        const issue: Issue = {
          id: uid("iss"),
          tankId: tank.id,
          metric,
          limit: tank.limits[metric],
          firstReadingId: reading.id,
          checkReadingIds: [],
          status: "open",
          openedShiftId: shift.id,
          ownerShiftId: shift.id,
          createdAt: reading.at,
        };
        state.issues = [...state.issues, issue];
        newIssues.push(issue);

        if (metric === "nh3" || metric === "no3") {
          // 同缸同时段只保留一条未完成换水任务，避免重复排期
          const existing = state.tasks.find(
            (t) => t.tankId === tank.id && t.status !== "done"
          );
          if (!existing) {
            const task: WaterTask = {
              id: uid("tsk"),
              tankId: tank.id,
              issueId: issue.id,
              reason: `${METRIC_LABEL[metric]}超限（${formatValue(metric, value)}ppm，上限 ${issue.limit}）`,
              urgency,
              status: "queued",
              createdShiftId: shift.id,
              ownerShiftId: shift.id,
              createdAt: reading.at,
            };
            state.tasks = [...state.tasks, task];
            newTasks.push(task);
          }
        }
      }
    } else if (open) {
      state.issues = state.issues.map((it) =>
        it.id === open.id ? { ...it, recheckReadingId: reading.id } : it
      );
      rechecks.push(state.issues.find((it) => it.id === open.id)!);
    }
  }

  return { state, newReading: reading, newIssues, appendedIssueIds, newTasks, rechecks };
}

export function issueCheckReadings(state: DeskState, issue: Issue): Reading[] {
  return [issue.firstReadingId, ...issue.checkReadingIds]
    .map((id) => readingById(state, id))
    .filter((r): r is Reading => Boolean(r));
}

/** 复测达标后人工关闭待处理项 */
export function closeIssue(prev: DeskState, issueId: string): DeskState {
  const issue = prev.issues.find((i) => i.id === issueId);
  if (!issue || issue.status !== "open") return prev;
  if (!issue.recheckReadingId) throw new Error("需要一次达标复测后才能关闭");
  const shift = currentShift(prev);
  return {
    ...prev,
    issues: prev.issues.map((i) =>
      i.id === issueId
        ? { ...i, status: "closed", closedShiftId: shift.id, closedAt: Date.now() }
        : i
    ),
  };
}

/** 为没有换水任务的氨氮/硝酸盐待处理项加排换水 */
export function enqueueTaskForIssue(prev: DeskState, issueId: string, urgency?: UrgencyKey): DeskState {
  const issue = prev.issues.find((i) => i.id === issueId);
  if (!issue) return prev;
  const tank = tankById(prev, issue.tankId);
  if (!tank) return prev;
  if (issue.metric !== "nh3" && issue.metric !== "no3") throw new Error("该项异常不靠换水处理");
  const existing = prev.tasks.find((t) => t.tankId === tank.id && t.status !== "done");
  if (existing) throw new Error("该缸今晚已有换水安排");
  const shift = currentShift(prev);
  const first = readingById(prev, issue.firstReadingId);
  const value = first?.[issue.metric];
  const task: WaterTask = {
    id: uid("tsk"),
    tankId: tank.id,
    issueId: issue.id,
    reason:
      value !== undefined
        ? `${METRIC_LABEL[issue.metric]}超限（${formatValue(issue.metric, value)}ppm，上限 ${issue.limit}）`
        : `${METRIC_LABEL[issue.metric]}超限换水`,
    urgency: urgency ?? issueUrgency(prev, issue),
    status: "queued",
    createdShiftId: shift.id,
    ownerShiftId: shift.id,
    createdAt: Date.now(),
  };
  return { ...prev, tasks: [...prev.tasks, task] };
}

/** 登记一条计划换水（常规） */
export function enqueueRoutineTask(prev: DeskState, tankId: string, reason: string): DeskState {
  const tank = tankById(prev, tankId);
  if (!tank) throw new Error("鱼缸不存在");
  const existing = prev.tasks.find((t) => t.tankId === tank.id && t.status !== "done");
  if (existing) throw new Error("该缸今晚已有换水安排");
  const shift = currentShift(prev);
  const task: WaterTask = {
    id: uid("tsk"),
    tankId: tank.id,
    reason: reason.trim() || "例行周换水",
    urgency: "routine",
    status: "queued",
    createdShiftId: shift.id,
    ownerShiftId: shift.id,
    createdAt: Date.now(),
  };
  return { ...prev, tasks: [...prev.tasks, task] };
}

export function removeQueuedTask(prev: DeskState, taskId: string): DeskState {
  const task = prev.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "queued") return prev;
  return { ...prev, tasks: prev.tasks.filter((t) => t.id !== taskId) };
}

export function issueUrgency(state: DeskState, issue: Issue): UrgencyKey {
  const tank = tankById(state, issue.tankId);
  const first = readingById(state, issue.firstReadingId);
  if (!tank || first?.[issue.metric] === undefined) return "medium";
  return urgencyFor(tank, issue.metric, first[issue.metric] as number);
}

/** 待排任务停在待排的原因说明 */
export function queueBlockReason(state: DeskState, task: WaterTask): string | null {
  if (task.status !== "queued") return null;
  const tank = tankById(state, task.tankId);
  if (!tank) return "鱼缸已删除";
  const blockingTankTask = state.tasks.find(
    (t) => t.tankId === task.tankId && t.id !== task.id && t.status === "scheduled"
  );
  if (blockingTankTask) {
    return `该缸已占用 ${blockingTankTask.slot}（一个鱼缸只占一个时段），本项停在待排`;
  }
  const openSlots = availableSlots(state);
  if (openSlots.length === 0) return "今晚时段已满，等待交班后排入下一班";
  return null;
}

export function availableSlots(state: DeskState): string[] {
  const taken = new Set(
    state.tasks.filter((t) => t.status === "scheduled" && t.slot).map((t) => t.slot as string)
  );
  return SLOTS.filter((s) => !taken.has(s));
}

/**
 * 按紧急程度自动排入当晚队列：
 * 紧急 > 优先 > 常规处理 > 计划换水，同级按登记先后；
 * 同缸已有安排或无空闲时段的项停在待排并给出原因。
 */
export function autoSchedule(prev: DeskState): { state: DeskState; scheduledCount: number } {
  const queued = prev.tasks
    .filter((t) => t.status === "queued")
    .sort((a, b) => URGENCY[a.urgency].rank - URGENCY[b.urgency].rank || a.createdAt - b.createdAt);

  let tasks = [...prev.tasks];
  const usedSlots = new Set(
    tasks.filter((t) => t.status === "scheduled" && t.slot).map((t) => t.slot as string)
  );
  const tanksScheduled = new Set(
    tasks.filter((t) => t.status === "scheduled").map((t) => t.tankId)
  );
  let scheduledCount = 0;

  for (const task of queued) {
    if (tanksScheduled.has(task.tankId)) continue; // 同缸不重复占位，停在待排
    const slot = SLOTS.find((s) => !usedSlots.has(s));
    if (!slot) continue; // 时段已满，停在待排
    usedSlots.add(slot);
    tanksScheduled.add(task.tankId);
    tasks = tasks.map((t) =>
      t.id === task.id ? { ...t, status: "scheduled", slot, scheduledAt: Date.now() } : t
    );
    scheduledCount += 1;
  }

  return { state: { ...prev, tasks }, scheduledCount };
}

/** 手动指定时段；冲突则拒绝并说明 */
export function assignSlot(prev: DeskState, taskId: string, slot: string): DeskState {
  const task = prev.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "queued") throw new Error("只有待排项可以选时段");
  const tankBusy = prev.tasks.find(
    (t) => t.tankId === task.tankId && t.id !== task.id && t.status === "scheduled"
  );
  if (tankBusy) throw new Error(`该缸已占用 ${tankBusy.slot}，一个鱼缸只占一个时段`);
  const slotTaken = prev.tasks.find((t) => t.status === "scheduled" && t.slot === slot);
  if (slotTaken) {
    const other = tankById(prev, slotTaken.tankId);
    throw new Error(`${slot} 已安排给 ${other?.name ?? "另一鱼缸"}，请选其他时段`);
  }
  return {
    ...prev,
    tasks: prev.tasks.map((t) =>
      t.id === taskId ? { ...t, status: "scheduled", slot, scheduledAt: Date.now() } : t
    ),
  };
}

export function clearSlot(prev: DeskState, taskId: string): DeskState {
  return {
    ...prev,
    tasks: prev.tasks.map((t) =>
      t.id === taskId && t.status === "scheduled"
        ? { ...t, status: "queued", slot: undefined, scheduledAt: undefined }
        : t
    ),
  };
}

export function completeTask(prev: DeskState, taskId: string): DeskState {
  const task = prev.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "scheduled") return prev;
  const shift = currentShift(prev);
  return {
    ...prev,
    tasks: prev.tasks.map((t) =>
      t.id === taskId
        ? { ...t, status: "done", completedShiftId: shift.id, completedAt: Date.now() }
        : t
    ),
  };
}

export interface HandoverResult {
  state: DeskState;
  handover: Handover;
}

/** 交班：未完成的待处理项和换水任务责任转到下一班 */
export function handoverShift(prev: DeskState, nextClerk: string): HandoverResult {
  const old = currentShift(prev);
  const now = Date.now();
  const index = prev.shifts.length;
  const label = index % 2 === 1 ? "早班" : "晚班";
  const next: Shift = {
    id: uid("shf"),
    index,
    label,
    startAt: now,
    clerk: nextClerk.trim() || "未署名店员",
    active: true,
  };

  const openIssues = prev.issues.filter((i) => i.status === "open");
  const pendingTasks = prev.tasks.filter((t) => t.status === "queued");
  const scheduledTasks = prev.tasks.filter((t) => t.status === "scheduled");

  const state: DeskState = {
    ...prev,
    shifts: [...prev.shifts.map((s) => ({ ...s, active: false })), next],
    issues: prev.issues.map((i) =>
      i.status === "open" ? { ...i, ownerShiftId: next.id } : i
    ),
    tasks: prev.tasks.map((t) =>
      t.status !== "done" ? { ...t, ownerShiftId: next.id } : t
    ),
    handovers: [
      ...prev.handovers,
      {
        id: uid("hov"),
        fromShiftId: old.id,
        toShiftId: next.id,
        fromClerk: old.clerk,
        toClerk: next.clerk,
        at: now,
        openIssueCount: openIssues.length,
        pendingTaskCount: pendingTasks.length,
        scheduledTaskCount: scheduledTasks.length,
      },
    ],
  };

  return { state, handover: state.handovers[state.handovers.length - 1] };
}

export function updateClerk(prev: DeskState, clerk: string): DeskState {
  const shift = currentShift(prev);
  return {
    ...prev,
    shifts: prev.shifts.map((s) => (s.id === shift.id ? { ...s, clerk: clerk.trim() || s.clerk } : s)),
  };
}

export function addTank(prev: DeskState, input: { name: string; species: SpeciesKey }): DeskState {
  const name = input.name.trim();
  if (!name) throw new Error("请填写鱼缸名称");
  if (prev.tanks.some((t) => t.name === name)) throw new Error("已存在同名鱼缸");
  const tank: Tank = {
    id: uid("tank"),
    code: `缸 ${prev.tanks.length + 1}`,
    name,
    species: input.species,
    limits: { ...SPECIES[input.species].limits },
    createdAt: Date.now(),
  };
  return { ...prev, tanks: [...prev.tanks, tank] };
}

export function openIssues(state: DeskState): Issue[] {
  return state.issues
    .filter((i) => i.status === "open")
    .sort(
      (a, b) =>
        URGENCY[issueUrgency(state, a)].rank - URGENCY[issueUrgency(state, b)].rank ||
        a.createdAt - b.createdAt
    );
}

export function latestMetric(
  state: DeskState,
  tankId: string,
  metric: MetricKey
): { value: number; at: number; over: boolean } | undefined {
  const tank = tankById(state, tankId);
  if (!tank) return undefined;
  for (let i = state.readings.length - 1; i >= 0; i--) {
    const r = state.readings[i];
    if (r.tankId !== tankId || r[metric] === undefined) continue;
    const value = r[metric] as number;
    return { value, at: r.at, over: isOverLimit(tank, metric, value) };
  }
  return undefined;
}

export function formatTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return sameDay ? hm : `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${hm}`;
}

export function shiftLabel(state: DeskState, shiftId: string): string {
  const shift = shiftById(state, shiftId);
  return shift ? `${shift.label}·${shift.clerk}` : "未知班次";
}
