import { SPECIES_PRESETS, rescheduleWaterTasks, uid } from "./domain";
import type {
  AppState,
  MetricValues,
  Reading,
  Shift,
  WaterChangeTask,
  WaterIssue,
} from "./types";

export function createSeedState(): AppState {
  const now = Date.now();
  const min = (n: number) => n * 60_000;

  // 班次：今早班 → 3 小时前交给晚班（当前班次）
  const morning: Shift = {
    id: "sh-morning",
    label: "早班",
    startedAt: now - min(60 * 11),
  };
  const evening: Shift = {
    id: "sh-evening",
    label: "晚班",
    startedAt: now - min(180),
  };

  const tanks = SPECIES_PRESETS.map((p, i) => ({ ...p, id: `tank-${i + 1}` }));
  const tankId = (name: string) => tanks.find((t) => t.name === name)!.id;

  const readings: Reading[] = [];
  const addReading = (
    tank: string,
    minsAgo: number,
    values: MetricValues,
    shiftId = evening.id
  ) => {
    readings.unshift({
      id: uid("rd"),
      tankId: tankId(tank),
      at: now - min(minsAgo),
      shiftId,
      values,
    });
  };

  // 早班旧读数：孔雀缸水温曾超限
  addReading("繁殖缸 D", 420, { temp: 27.9, ph: 7.1, nh3: 0.01, no3: 12 }, morning.id);
  addReading("草缸 A", 200, { temp: 25.4, ph: 7.0, nh3: 0.01, no3: 16 });

  // 晚班巡检
  addReading("龙鱼缸 E", 170, { temp: 29.6, ph: 7.4, nh3: 0.01, no3: 18 });
  addReading("海缸 B", 150, { temp: 26.2, ph: 8.1, nh3: 0.01, no3: 15 });
  addReading("繁殖缸 D", 140, { temp: 26.6, ph: 7.2, nh3: 0.01, no3: 12 });
  addReading("草缸 A", 60, { temp: 25.6, ph: 7.0, nh3: 0.02, no3: 38 });
  addReading("海缸 B", 35, { temp: 26.3, ph: 8.2, nh3: 0.05, no3: 16 });
  // 最近两次三湖缸：20 分钟前仅水温超限；8 分钟前水温复测仍超限（补检查），
  // pH、氨氮、硝酸盐新超限
  addReading("三湖缸 C", 20, { temp: 27.6, ph: 8.4, nh3: 0.02, no3: 22 });
  addReading("三湖缸 C", 8, { temp: 27.9, ph: 8.6, nh3: 0.04, no3: 45 });

  const issues: WaterIssue[] = [];
  const tasks: WaterChangeTask[] = [];

  const addIssue = (
    tank: string,
    minsAgo: number,
    metric: WaterIssue["metric"],
    value: number,
    checks: Array<{ minsAgo: number; value: number }> = [],
    extra: Partial<WaterIssue> = {}
  ): WaterIssue => {
    const t = tanks.find((x) => x.name === tank)!;
    const issue: WaterIssue = {
      id: uid("iss"),
      tankId: t.id,
      metric,
      value,
      limit: t.limits[metric],
      openedAt: now - min(minsAgo),
      openedByShiftId: evening.id,
      ownedByShiftId: evening.id,
      status: "open",
      checks: checks.map((c) => ({
        at: now - min(c.minsAgo),
        value: c.value,
        shiftId: evening.id,
      })),
      ...extra,
    };
    issues.push(issue);
    return issue;
  };

  const linkTask = (issue: WaterIssue, task: WaterChangeTask) => {
    issue.linkedWaterTaskId = task.id;
  };

  const addTask = (
    tank: string,
    minsAgo: number,
    urgency: number,
    percent: number,
    reason: string,
    extra: Partial<WaterChangeTask> = {}
  ): WaterChangeTask => {
    const task: WaterChangeTask = {
      id: uid("wt"),
      tankId: tankId(tank),
      source: "auto",
      reason,
      percent,
      urgency,
      createdAt: now - min(minsAgo),
      createdByShiftId: evening.id,
      ownedByShiftId: evening.id,
      status: "pending_schedule",
      ...extra,
    };
    tasks.push(task);
    return task;
  };

  // 历史已完成：早班孔雀缸水温（20:00 时段已换水恢复）
  const dTemp = addIssue("繁殖缸 D", 420, "temp", 27.9, [], {
    openedByShiftId: morning.id,
    ownedByShiftId: morning.id,
    status: "resolved",
    resolvedAt: now - min(400),
    resolveNote: "换水 30% 后复测恢复正常",
  });
  const dTask = addTask("繁殖缸 D", 420, 90, 30, "水温 27.9 ℃ 超品种上限 27 ℃，建议换水", {
    issueId: dTemp.id,
    createdByShiftId: morning.id,
    ownedByShiftId: morning.id,
    status: "done",
    slotId: "s1",
    completedAt: now - min(400),
    completeNote: "20:00 时段换水完成，水温回落 26.6 ℃",
  });
  linkTask(dTemp, dTask);

  // 晚班待处理项与换水任务（初始都待排，随后统一排程）
  const eTemp = addIssue("龙鱼缸 E", 170, "temp", 29.6);
  linkTask(eTemp, addTask("龙鱼缸 E", 170, 60, 30, "水温 29.6 ℃ 超品种上限 29 ℃，建议换水", { issueId: eTemp.id }));

  const bNo3 = addIssue("海缸 B", 150, "no3", 15);
  linkTask(bNo3, addTask("海缸 B", 150, 250, 50, "硝酸盐 15 ppm 超品种上限 10 ppm，建议换水", { issueId: bNo3.id }));

  const aNo3 = addIssue("草缸 A", 60, "no3", 38);
  linkTask(aNo3, addTask("草缸 A", 60, 260, 50, "硝酸盐 38 ppm 超品种上限 25 ppm，建议换水", { issueId: aNo3.id }));

  const bNh3 = addIssue("海缸 B", 35, "nh3", 0.05);
  linkTask(bNh3, addTask("海缸 B", 35, 1500, 50, "氨氮 0.05 ppm 超品种上限 0.02 ppm，紧急换水", { issueId: bNh3.id }));

  // 三湖缸：水温先超限，8 分钟前复测仍超限 → 只补检查记录；pH / 氨氮 / 硝酸盐新开单
  const cTemp = addIssue("三湖缸 C", 20, "temp", 27.6, [{ minsAgo: 8, value: 27.9 }]);
  linkTask(cTemp, addTask("三湖缸 C", 20, 60, 30, "水温 27.6 ℃ 超品种上限 27 ℃，建议换水", { issueId: cTemp.id }));

  const cPh = addIssue("三湖缸 C", 8, "ph", 8.6);
  linkTask(cPh, addTask("三湖缸 C", 8, 50, 30, "pH 8.6 超品种上限 8.4，建议换水", { issueId: cPh.id }));

  const cNh3 = addIssue("三湖缸 C", 8, "nh3", 0.04);
  linkTask(cNh3, addTask("三湖缸 C", 8, 1000, 50, "氨氮 0.04 ppm 超品种上限 0.02 ppm，紧急换水", { issueId: cNh3.id }));

  const cNo3 = addIssue("三湖缸 C", 8, "no3", 45);
  linkTask(cNo3, addTask("三湖缸 C", 8, 250, 50, "硝酸盐 45 ppm 超品种上限 30 ppm，建议换水", { issueId: cNo3.id }));

  let state: AppState = {
    version: 1,
    tanks,
    shifts: [morning, evening],
    currentShiftId: evening.id,
    readings,
    issues,
    waterTasks: tasks,
    handovers: [
      {
        id: uid("hd"),
        at: evening.startedAt,
        fromShiftId: morning.id,
        toShiftId: evening.id,
        issueCount: 0,
        taskCount: 1,
      },
    ],
  };

  // 统一按紧急度排程：一缸占一个时段，冲突的停在待排并附原因
  state = rescheduleWaterTasks(state);
  return state;
}
