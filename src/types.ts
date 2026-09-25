export type MetricKey = "temp" | "ph" | "nh3" | "no3";

export type SpeciesKey = "freshwater" | "planted" | "cichlid" | "marine";

export type UrgencyKey = "critical" | "high" | "medium" | "routine";

export type IssueStatus = "open" | "closed";

export type TaskStatus = "queued" | "scheduled" | "done";

export interface Limits {
  temp: number;
  ph: number;
  nh3: number;
  no3: number;
}

export interface Tank {
  id: string;
  code: string;
  name: string;
  species: SpeciesKey;
  limits: Limits;
  createdAt: number;
}

export interface ReadingValues {
  temp?: number;
  ph?: number;
  nh3?: number;
  no3?: number;
}

export interface Reading extends ReadingValues {
  id: string;
  tankId: string;
  at: number;
  shiftId: string;
  clerk: string;
  note?: string;
}

export interface Issue {
  id: string;
  tankId: string;
  metric: MetricKey;
  limit: number;
  firstReadingId: string;
  checkReadingIds: string[];
  recheckReadingId?: string;
  status: IssueStatus;
  openedShiftId: string;
  ownerShiftId: string;
  closedShiftId?: string;
  createdAt: number;
  closedAt?: number;
  note?: string;
}

export interface WaterTask {
  id: string;
  tankId: string;
  issueId?: string;
  reason: string;
  urgency: UrgencyKey;
  status: TaskStatus;
  slot?: string;
  createdShiftId: string;
  ownerShiftId: string;
  createdAt: number;
  scheduledAt?: number;
  completedShiftId?: string;
  completedAt?: number;
}

export interface Shift {
  id: string;
  index: number;
  label: string;
  startAt: number;
  clerk: string;
  active: boolean;
}

export interface Handover {
  id: string;
  fromShiftId: string;
  toShiftId: string;
  fromClerk: string;
  toClerk: string;
  at: number;
  openIssueCount: number;
  pendingTaskCount: number;
  scheduledTaskCount: number;
}

export interface DeskState {
  tanks: Tank[];
  shifts: Shift[];
  readings: Reading[];
  issues: Issue[];
  tasks: WaterTask[];
  handovers: Handover[];
}
