import type { DeskState, Issue, Reading, Shift, Tank, WaterTask } from "./types";
import { SPECIES } from "./model";

/**
 * 演示数据：早班已完成一次异常处理并交班；
 * 晚班接班后已有几组演示读数，部分超限生成待处理项和换水队列。
 */
export function buildSeedState(now: number = Date.now()): DeskState {
  const mins = (n: number) => now - n * 60_000;

  const dayShift: Shift = {
    id: "shf_day",
    index: 0,
    label: "早班",
    startAt: mins(11 * 60),
    clerk: "小林",
    active: false,
  };
  const nightShift: Shift = {
    id: "shf_night",
    index: 1,
    label: "晚班",
    startAt: mins(150),
    clerk: "小周",
    active: true,
  };

  const tanks: Tank[] = [
    {
      id: "tank_a",
      code: "缸 1",
      name: "草缸A",
      species: "planted",
      limits: { ...SPECIES.planted.limits },
      createdAt: mins(60 * 24 * 14),
    },
    {
      id: "tank_b",
      code: "缸 2",
      name: "海缸B",
      species: "marine",
      limits: { ...SPECIES.marine.limits },
      createdAt: mins(60 * 24 * 14),
    },
    {
      id: "tank_c",
      code: "缸 3",
      name: "三湖缸C",
      species: "cichlid",
      limits: { ...SPECIES.cichlid.limits },
      createdAt: mins(60 * 24 * 10),
    },
    {
      id: "tank_d",
      code: "缸 4",
      name: "繁殖缸D",
      species: "freshwater",
      limits: { ...SPECIES.freshwater.limits },
      createdAt: mins(60 * 24 * 6),
    },
  ];

  const readings: Reading[] = [
    // —— 早班：草缸A 氨氮异常，复测达标后关闭 ——
    {
      id: "rd_day_1",
      tankId: "tank_a",
      at: mins(8 * 60),
      shiftId: dayShift.id,
      clerk: dayShift.clerk,
      nh3: 0.35,
      note: "喂食过量后异味明显",
    },
    {
      id: "rd_day_2",
      tankId: "tank_a",
      at: mins(6 * 60 + 20),
      shiftId: dayShift.id,
      clerk: dayShift.clerk,
      nh3: 0.12,
      note: "换水后复测",
    },
    // —— 晚班交接前的几组演示读数 ——
    {
      id: "rd_n_1",
      tankId: "tank_b",
      at: mins(120),
      shiftId: nightShift.id,
      clerk: nightShift.clerk,
      temp: 26.2,
      ph: 8.2,
      nh3: 0.02,
      no3: 32.6,
      note: "盐度正常，NO₃ 偏高",
    },
    {
      id: "rd_n_2",
      tankId: "tank_d",
      at: mins(95),
      shiftId: nightShift.id,
      clerk: nightShift.clerk,
      temp: 27.4,
      ph: 7.1,
      nh3: 0.38,
      no3: 64,
      note: "母鱼浮头，停止投喂",
    },
    {
      id: "rd_n_3",
      tankId: "tank_a",
      at: mins(70),
      shiftId: nightShift.id,
      clerk: nightShift.clerk,
      temp: 25.6,
      ph: 6.9,
      nh3: 0.1,
      no3: 44,
    },
    {
      id: "rd_n_4",
      tankId: "tank_c",
      at: mins(45),
      shiftId: nightShift.id,
      clerk: nightShift.clerk,
      temp: 29.4,
      ph: 8.2,
      nh3: 0.05,
      no3: 18,
      note: "灯具散热异常，缸温升高",
    },
    {
      id: "rd_n_5",
      tankId: "tank_d",
      at: mins(20),
      shiftId: nightShift.id,
      clerk: nightShift.clerk,
      nh3: 0.41,
      note: "同缸氨氮复测仍超限，只补检查记录",
    },
  ];

  const dayIssue: Issue = {
    id: "iss_day_nh3_a",
    tankId: "tank_a",
    metric: "nh3",
    limit: SPECIES.planted.limits.nh3,
    firstReadingId: "rd_day_1",
    checkReadingIds: [],
    recheckReadingId: "rd_day_2",
    status: "closed",
    openedShiftId: dayShift.id,
    ownerShiftId: dayShift.id,
    closedShiftId: dayShift.id,
    createdAt: mins(8 * 60),
    closedAt: mins(6 * 60),
    note: "换水 1/3 后达标，已完成",
  };

  const openIssues: Issue[] = [
    {
      id: "iss_n_nh3_d",
      tankId: "tank_d",
      metric: "nh3",
      limit: SPECIES.freshwater.limits.nh3,
      firstReadingId: "rd_n_2",
      checkReadingIds: ["rd_n_5"],
      status: "open",
      openedShiftId: nightShift.id,
      ownerShiftId: nightShift.id,
      createdAt: mins(95),
    },
    {
      id: "iss_n_no3_d",
      tankId: "tank_d",
      metric: "no3",
      limit: SPECIES.freshwater.limits.no3,
      firstReadingId: "rd_n_2",
      checkReadingIds: [],
      status: "open",
      openedShiftId: nightShift.id,
      ownerShiftId: nightShift.id,
      createdAt: mins(95),
    },
    {
      id: "iss_n_no3_b",
      tankId: "tank_b",
      metric: "no3",
      limit: SPECIES.marine.limits.no3,
      firstReadingId: "rd_n_1",
      checkReadingIds: [],
      status: "open",
      openedShiftId: nightShift.id,
      ownerShiftId: nightShift.id,
      createdAt: mins(120),
    },
    {
      id: "iss_n_no3_a",
      tankId: "tank_a",
      metric: "no3",
      limit: SPECIES.planted.limits.no3,
      firstReadingId: "rd_n_3",
      checkReadingIds: [],
      status: "open",
      openedShiftId: nightShift.id,
      ownerShiftId: nightShift.id,
      createdAt: mins(70),
    },
    {
      id: "iss_n_temp_c",
      tankId: "tank_c",
      metric: "temp",
      limit: SPECIES.cichlid.limits.temp,
      firstReadingId: "rd_n_4",
      checkReadingIds: [],
      status: "open",
      openedShiftId: nightShift.id,
      ownerShiftId: nightShift.id,
      createdAt: mins(45),
    },
  ];

  // —— 早班留下的周换水计划，交接时转入晚班 ——
  const carriedTask: WaterTask = {
    id: "tsk_carry_d",
    tankId: "tank_d",
    reason: "繁殖缸周换水（早班计划，未执行）",
    urgency: "routine",
    status: "queued",
    createdShiftId: dayShift.id,
    ownerShiftId: nightShift.id,
    createdAt: mins(10 * 60),
  };

  const tasks: WaterTask[] = [
    {
      id: "tsk_n_nh3_d",
      tankId: "tank_d",
      issueId: "iss_n_nh3_d",
      reason: "氨氮超限（0.38ppm，上限 0.2）",
      urgency: "critical",
      status: "scheduled",
      slot: "20:00",
      createdShiftId: nightShift.id,
      ownerShiftId: nightShift.id,
      createdAt: mins(95),
      scheduledAt: mins(88),
    },
    {
      id: "tsk_n_no3_b",
      tankId: "tank_b",
      issueId: "iss_n_no3_b",
      reason: "硝酸盐超限（32.6ppm，上限 20）",
      urgency: "high",
      status: "scheduled",
      slot: "20:30",
      createdShiftId: nightShift.id,
      ownerShiftId: nightShift.id,
      createdAt: mins(120),
      scheduledAt: mins(84),
    },
    {
      id: "tsk_n_no3_a",
      tankId: "tank_a",
      issueId: "iss_n_no3_a",
      reason: "硝酸盐超限（44.0ppm，上限 30）",
      urgency: "high",
      status: "queued",
      createdShiftId: nightShift.id,
      ownerShiftId: nightShift.id,
      createdAt: mins(70),
    },
    carriedTask,
  ];

  return {
    tanks,
    shifts: [dayShift, nightShift],
    readings,
    issues: [dayIssue, ...openIssues],
    tasks,
    handovers: [
      {
        id: "hov_seed",
        fromShiftId: dayShift.id,
        toShiftId: nightShift.id,
        fromClerk: "小林",
        toClerk: "小周",
        at: mins(150),
        openIssueCount: 0,
        pendingTaskCount: 1,
        scheduledTaskCount: 0,
      },
    ],
  };
}
