import { useState } from "react";
import type { DeskState, SpeciesKey } from "../types";
import { SPECIES, currentShift, formatTime } from "../model";

export function ShiftBar({
  state,
  onUpdateClerk,
  onHandover,
  onAddTank,
  onReset,
}: {
  state: DeskState;
  onUpdateClerk: (clerk: string) => void;
  onHandover: (nextClerk: string) => void;
  onAddTank: (name: string, species: SpeciesKey) => void;
  onReset: () => void;
}) {
  const shift = currentShift(state);
  const [editingClerk, setEditingClerk] = useState(false);
  const [clerkDraft, setClerkDraft] = useState(shift.clerk);
  const [handingOver, setHandingOver] = useState(false);
  const [nextClerk, setNextClerk] = useState("");
  const [addingTank, setAddingTank] = useState(false);
  const [tankName, setTankName] = useState("");
  const [species, setSpecies] = useState<SpeciesKey>("freshwater");

  const openCount = state.issues.filter((i) => i.status === "open").length;
  const queuedCount = state.tasks.filter((t) => t.status === "queued").length;
  const scheduledCount = state.tasks.filter((t) => t.status === "scheduled").length;
  const doneCount = state.tasks.filter((t) => t.status === "done").length;
  const closedCount = state.issues.filter((i) => i.status === "closed").length;
  const lastHandover = state.handovers[state.handovers.length - 1];
  const nextLabel = state.shifts.length % 2 === 1 ? "早班" : "晚班";

  return (
    <section className="panel shift-bar">
      <div className="shift-main">
        <div className="shift-id">
          <span className="shift-label">{shift.label}值班中</span>
          {!editingClerk ? (
            <button className="clerk-name" onClick={() => { setClerkDraft(shift.clerk); setEditingClerk(true); }}>
              责任人：{shift.clerk} ✎
            </button>
          ) : (
            <span className="clerk-edit">
              <input
                value={clerkDraft}
                autoFocus
                onChange={(e) => setClerkDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onUpdateClerk(clerkDraft);
                    setEditingClerk(false);
                  }
                }}
              />
              <button
                className="small-btn primary"
                onClick={() => {
                  onUpdateClerk(clerkDraft);
                  setEditingClerk(false);
                }}
              >
                确定
              </button>
            </span>
          )}
          <span className="shift-since">上岗 {formatTime(shift.startAt)}</span>
        </div>

        <div className="stat-pills">
          <span className="stat"><b>{openCount}</b> 待处理</span>
          <span className="stat warn"><b>{queuedCount}</b> 换水待排</span>
          <span className="stat info"><b>{scheduledCount}</b> 已排期</span>
          <span className="stat ok"><b>{doneCount + closedCount}</b> 已完成</span>
        </div>
      </div>

      <div className="shift-actions">
        {!handingOver ? (
          <>
            <button className="small-btn outline" onClick={() => setAddingTank((v) => !v)}>
              新增鱼缸
            </button>
            <button className="primary-action handover-btn" onClick={() => setHandingOver(true)}>
              交班给下一班
            </button>
            <button className="small-btn ghost" onClick={onReset} title="清空本地数据并恢复演示">
              重置演示
            </button>
          </>
        ) : (
          <div className="handover-box">
            <p>
              将交班给 <strong>{nextLabel}</strong>。未关闭的 {openCount} 项待处理、
              {queuedCount} 项待排和 {scheduledCount} 项已排换水会转到下一班责任。
            </p>
            <input
              placeholder={`下一班${nextLabel}责任人姓名`}
              value={nextClerk}
              autoFocus
              onChange={(e) => setNextClerk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nextClerk.trim()) {
                  onHandover(nextClerk);
                  setNextClerk("");
                  setHandingOver(false);
                }
              }}
            />
            <div className="handover-btns">
              <button
                className="primary-action"
                disabled={!nextClerk.trim()}
                onClick={() => {
                  onHandover(nextClerk);
                  setNextClerk("");
                  setHandingOver(false);
                }}
              >
                确认交班
              </button>
              <button className="small-btn outline" onClick={() => setHandingOver(false)}>
                取消
              </button>
            </div>
          </div>
        )}
        {addingTank && !handingOver && (
          <div className="add-tank-box">
            <input
              placeholder="鱼缸名称，如：孔雀鱼幼鱼缸"
              value={tankName}
              autoFocus
              onChange={(e) => setTankName(e.target.value)}
            />
            <select value={species} onChange={(e) => setSpecies(e.target.value as SpeciesKey)}>
              {(Object.keys(SPECIES) as SpeciesKey[]).map((key) => (
                <option key={key} value={key}>
                  {SPECIES[key].label}
                </option>
              ))}
            </select>
            <button
              className="small-btn primary"
              onClick={() => {
                onAddTank(tankName, species);
                setTankName("");
                setAddingTank(false);
              }}
            >
              登记
            </button>
          </div>
        )}
      </div>

      {lastHandover && (
        <p className="last-handover">
          上次交班：{formatTime(lastHandover.at)} {lastHandover.fromClerk}（
          {state.shifts.find((s) => s.id === lastHandover.fromShiftId)?.label}） →{" "}
          {lastHandover.toClerk}（{state.shifts.find((s) => s.id === lastHandover.toShiftId)?.label}
          ），移交待处理 {lastHandover.openIssueCount}、待排 {lastHandover.pendingTaskCount}、已排{" "}
          {lastHandover.scheduledTaskCount}
        </p>
      )}
    </section>
  );
}
