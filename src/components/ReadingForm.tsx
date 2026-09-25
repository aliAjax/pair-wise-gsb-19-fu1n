import { useState } from "react";
import type { DeskState, MetricKey, ReadingValues } from "../types";
import { METRICS, SPECIES, formatValue } from "../model";

interface Props {
  state: DeskState;
  tankId: string;
  onSelectTank: (id: string) => void;
  onSubmit: (tankId: string, values: ReadingValues, note: string) => void;
}

export function ReadingForm({ state, tankId, onSelectTank, onSubmit }: Props) {
  const tank = state.tanks.find((t) => t.id === tankId) ?? state.tanks[0];
  const [values, setValues] = useState<Record<MetricKey, string>>({
    temp: "",
    ph: "",
    nh3: "",
    no3: "",
  });
  const [note, setNote] = useState("");

  if (!tank) return null;

  const setValue = (key: MetricKey, raw: string) => {
    if (raw === "") {
      setValues((v) => ({ ...v, [key]: "" }));
      return;
    }
    const num = Number(raw);
    if (!Number.isNaN(num)) setValues((v) => ({ ...v, [key]: raw }));
  };

  const handleTankChange = (id: string) => {
    onSelectTank(id);
  };

  const handleSubmit = () => {
    const parsed: ReadingValues = {};
    (Object.keys(values) as MetricKey[]).forEach((key) => {
      const raw = values[key];
      if (raw !== "") {
        const num = Number(raw);
        if (!Number.isNaN(num)) parsed[key] = num;
      }
    });
    onSubmit(tank.id, parsed, note);
    setValues({ temp: "", ph: "", nh3: "", no3: "" });
    setNote("");
  };

  const previewOver = (key: MetricKey): boolean | null => {
    const raw = values[key];
    if (raw === "") return null;
    const num = Number(raw);
    if (Number.isNaN(num)) return null;
    return num > tank.limits[key];
  };

  return (
    <section className="panel entry-panel">
      <div className="section-title">
        <div>
          <h3>登记检测读数</h3>
          <p>水温 / pH / 氨氮 / 硝酸盐，超过品种上限自动生成待处理项</p>
        </div>
      </div>

      <div className="entry-row">
        <label className="tank-pick">
          <span>检测鱼缸</span>
          <select value={tank.id} onChange={(e) => handleTankChange(e.target.value)}>
            {state.tanks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}（{SPECIES[t.species].label}）
              </option>
            ))}
          </select>
        </label>
        <div className="limit-strip">
          {METRICS.map((m) => (
            <div key={m.key} className="limit-chip">
              <span>{m.label} 上限</span>
              <strong>
                {formatValue(m.key, tank.limits[m.key])}
                {m.unit ? ` ${m.unit}` : ""}
              </strong>
            </div>
          ))}
        </div>
      </div>

      <div className="metric-inputs">
        {METRICS.map((m) => {
          const over = previewOver(m.key);
          return (
            <label key={m.key} className={over === true ? "over" : over === false ? "safe" : ""}>
              <span>
                {m.label}
                {m.unit ? ` (${m.unit})` : ""}
              </span>
              <input
                inputMode="decimal"
                step={m.step}
                placeholder={`上限 ${formatValue(m.key, tank.limits[m.key])}`}
                value={values[m.key]}
                onChange={(e) => setValue(m.key, e.target.value)}
              />
              <small>{over === true ? "超过上限，将生成待处理项" : m.hint}</small>
            </label>
          );
        })}
      </div>

      <div className="entry-foot">
        <label className="note-input">
          <span>备注（选填）</span>
          <input
            placeholder="如：停止投喂、灯具散热异常…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button className="primary-action" onClick={handleSubmit}>
          提交读数
        </button>
      </div>
    </section>
  );
}
