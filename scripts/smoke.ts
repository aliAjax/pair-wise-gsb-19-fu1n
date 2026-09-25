import { createSeedState } from "../src/seed";
import {
  SLOTS,
  cancelWaterTask,
  completeWaterTask,
  handover,
  ingestReading,
  queueManualWater,
  rescheduleWaterTasks,
} from "../src/domain";
import type { AppState } from "../src/types";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

const T = 1_000_000_000_000;

console.log("1. 种子数据排程：一缸一时段，冲突待排并附原因");
{
  const s = createSeedState();
  const queued = s.waterTasks.filter((t) => t.status === "queued");
  const pending = s.waterTasks.filter((t) => t.status === "pending_schedule");
  const done = s.waterTasks.filter((t) => t.status === "done");

  assert("排上 4 个时段任务", queued.length === 4, `got ${queued.length}`);
  assert("4 个任务停在待排", pending.length === 4, `got ${pending.length}`);
  assert("历史完成单 1 个", done.length === 1);
  assert("每个时段至多一缸", new Set(queued.map((t) => t.slotId)).size === queued.length);
  assert("同缸不会排两个时段", new Set(queued.map((t) => t.tankId)).size === queued.length);
  const freeSlots = SLOTS.filter(
    (slot) => !queued.some((t) => t.slotId === slot.id)
  );
  assert("已完成单不占位（s1 被最紧急任务复用，仍空 3 个时段）",
    queued.some((t) => t.slotId === "s1") && freeSlots.length === 3,
    `free=${freeSlots.map((f) => f.id).join(",")}`);
  const slots = queued
    .sort((a, b) => a.urgency - b.urgency)
    .map((t) => t.slotId);
  const idx = slots.map((id) => SLOTS.findIndex((s2) => s2.id === id));
  assert("紧急度高者占更早时段", idx.every((v, i) => i === 0 || v <= idx[i - 1]), JSON.stringify(idx));
  const bPending = pending.find((t) => t.tankId === "tank-2");
  assert("海缸重复换水注明一缸一时段冲突", !!bPending && bPending.blockedReason!.includes("同一鱼缸"));
  const cPending = pending.filter((t) => t.tankId === "tank-3");
  assert("三湖缸另有 3 项待排", cPending.length === 3, `got ${cPending.length}`);
  assert("8 条 open 待处理项", s.issues.filter((i) => i.status === "open").length === 8);
  assert("三湖缸水温带 1 条补检记录", (() => {
    const i = s.issues.find((x) => x.tankId === "tank-3" && x.metric === "temp")!;
    return i.checks.length === 1 && i.checks[0].value === 27.9;
  })());
}

console.log("2. 录入读数：超限开单 vs 同缸同项只补检");
{
  let s = createSeedState();
  const openBefore = s.issues.filter((i) => i.status === "open").length;
  // 三湖缸水温再测一次超限 → 只补检查
  const r1 = ingestReading(s, "tank-3", { temp: 28.2 }, T + 1);
  s = r1.state;
  assert(
    "复测仅补检查记录，不开新单",
    s.issues.filter((i) => i.status === "open").length === openBefore &&
      s.issues.find((i) => i.tankId === "tank-3" && i.metric === "temp")!.checks.length === 2,
    r1.message
  );
  assert("换水任务数不增加", s.waterTasks.length === (createSeedState().waterTasks.length));

  // 草缸 pH 新超限 → 开新单 + 换水任务
  const tasksBefore = s.waterTasks.length;
  const r2 = ingestReading(s, "tank-1", { ph: 7.6 }, T + 2);
  s = r2.state;
  const newIssue = s.issues.find((i) => i.tankId === "tank-1" && i.metric === "ph" && i.status === "open");
  assert("新指标超限生成待处理项", !!newIssue, r2.message);
  assert("新待处理项关联换水任务", !!newIssue?.linkedWaterTaskId);
  assert("换水任务 +1", s.waterTasks.length === tasksBefore + 1);

  // 正常读数 → 不开单
  const r3 = ingestReading(s, "tank-4", { temp: 26.5, ph: 7.2, nh3: 0.01, no3: 10 }, T + 3);
  s = r3.state;
  assert("正常读数不开单", r3.message.includes("正常") && s.issues.filter((i) => i.tankId === "tank-4" && i.status === "open").length === 0);
}

console.log("3. 完成换水：自动关闭关联待处理项并顺延补位");
{
  let s = createSeedState();
  const queuedC = s.waterTasks.find((t) => t.status === "queued" && t.tankId === "tank-3")!;
  const cWaiting = s.waterTasks.filter(
    (t) => t.status === "pending_schedule" && t.tankId === "tank-3"
  );
  const r = completeWaterTask(s, queuedC.id, T + 10, "换水完成 26.8℃");
  s = r.state;
  assert("任务标记 done", s.waterTasks.find((t) => t.id === queuedC.id)!.status === "done");
  assert(
    "关联待处理项自动复测恢复",
    s.issues.find((i) => i.id === queuedC.issueId)!.status === "resolved"
  );
  const promoted = s.waterTasks.find(
    (t) => t.tankId === "tank-3" && t.status === "queued" && t.id !== queuedC.id
  );
  assert("同缸待排项顺延补位", !!promoted, JSON.stringify(s.waterTasks.filter(t => t.tankId==='tank-3').map(t=>t.status)));
  if (promoted) {
    // 更早的空时段会优先让给更高紧急度的其它缸；同缸补位任务拿到自己能占的最早槽
    const minFree = SLOTS.findIndex((slot) =>
      !s.waterTasks.some((t) => t.status === "queued" && t.slotId === slot.id && t.id !== promoted.id)
    );
    assert("补位任务占用当前可用的最早空时段", SLOTS.findIndex((x) => x.id === promoted.slotId) === minFree);
  }
  assert("其余同缸低优任务仍待排",
    s.waterTasks.filter((t) => t.tankId === "tank-3" && t.status === "pending_schedule").length === cWaiting.length - 1);
}

console.log("4. 时段全部占满 → 待排原因变为时段已满");
{
  let s: AppState = createSeedState();
  // 完成三湖缸占用以加速？不——直接用手动任务把 3 个空闲时段全占给尚未排队的缸：
  // 当前排队：B(s1/2), A, E, C 占 4 个时段。空闲 3 个。缸 D 还没有任务。
  s = queueManualWater(s, "tank-4", 30, T + 1).state;
  s = queueManualWater(s, "tank-4", 40, T + 2).state; // 同缸立刻冲突
  assert("同缸手动任务也遵守一缸一时段",
    s.waterTasks.filter((t) => t.source === "manual" && t.tankId === "tank-4").some((t) => t.status === "pending_schedule"));
  // D 已占 1 个时段 → 还空 2 个。加两个临时虚拟缸占满空位
  const x1 = { ...s.tanks[0], id: "tank-x1", name: "临时缸X1" };
  const x2 = { ...s.tanks[0], id: "tank-x2", name: "临时缸X2" };
  s = { ...s, tanks: [...s.tanks, x1, x2] };
  s = queueManualWater(s, x1.id, 20, T + 10).state;
  s = queueManualWater(s, x2.id, 20, T + 11).state;
  const noFree = !SLOTS.some((slot) =>
    !s.waterTasks.some((t) => t.status === "queued" && t.slotId === slot.id)
  );
  assert("7 个时段全部占满", noFree);
  if (noFree) {
    const x3 = { ...s.tanks[0], id: "tank-x3", name: "临时缸X3" };
    s = { ...s, tanks: [...s.tanks, x3] };
    const r = queueManualWater(s, x3.id, 25, T + 20);
    s = r.state;
    assert("全满时新任务待排且注明时段已满",
      s.waterTasks.some((t) => t.status === "pending_schedule" && t.blockedReason?.includes("时段已满")),
      JSON.stringify(s.waterTasks.map((t) => [t.status, t.blockedReason])));
  }
}

console.log("5. 撤销换水：释放时段、关联项恢复排队资格并重排");
{
  let s = createSeedState();
  const queuedA = s.waterTasks.find((t) => t.status === "queued" && t.tankId === "tank-1")!;
  s = cancelWaterTask(s, queuedA.id).state;
  assert("任务已撤销", s.waterTasks.find((t) => t.id === queuedA.id)!.status === "cancelled");
  assert("关联 issue 解除链接", !s.issues.find((i) => i.id === queuedA.issueId)!.linkedWaterTaskId);
}

console.log("6. 交班：未完成责任整体转移，已完成不动");
{
  let s = createSeedState();
  const beforeOpen = s.issues.filter((i) => i.status === "open").length;
  const beforeActive = s.waterTasks.filter((t) => ["queued", "pending_schedule"].includes(t.status));
  const r = handover(s, T + 100);
  s = r.state;
  assert("当前班次变为夜班", s.shifts.find((x) => x.id === s.currentShiftId)!.label === "夜班");
  assert(
    "open 待处理项责任转到夜班",
    s.issues.filter((i) => i.status === "open").every((i) => i.ownedByShiftId === s.currentShiftId)
  );
  assert(
    "进行中换水任务责任转到夜班",
    s.waterTasks
      .filter((t) => ["queued", "pending_schedule"].includes(t.status))
      .every((t) => t.ownedByShiftId === s.currentShiftId)
  );
  assert("排程结果不受交班影响", s.waterTasks.filter((t) => t.status === "queued").length === beforeActive.filter((t) => t.status === "queued").length);
  assert("已完成单责任留在早班",
    s.waterTasks.find((t) => t.status === "done")!.ownedByShiftId === "sh-morning");
  assert("交接链 +1 且计数正确", s.handovers[0].issueCount === beforeOpen);

  // 再交班回到早班（循环）
  s = handover(s, T + 200).state;
  assert("班次按 早→晚→夜→早 循环", s.shifts.find((x) => x.id === s.currentShiftId)!.label === "早班");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
