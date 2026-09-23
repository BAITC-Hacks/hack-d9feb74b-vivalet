"use client";
import type { UnitMapping } from "@/lib/types";
const transformColors: Record<string, string> = {
  unchanged: "#17836c", renamed: "#2565b5", transformed: "#2565b5",
  split: "#7559b1", merged: "#7559b1", removed: "#ae6424", created: "#257895",
};
const transformLabels: Record<string, string> = {
  unchanged: "без изменений", renamed: "переим.", transformed: "преобразовано",
  split: "разделено", merged: "объединено", removed: "ликвидировано", created: "создано",
};
interface UnitNode { id: string; name: string; abbreviation?: string; functions: { id: string; originalText: string }[]; }
interface OrgChartProps { unitMappings: UnitMapping[]; beforeUnits: UnitNode[]; afterUnits: UnitNode[]; }
export function OrgChart({ unitMappings, beforeUnits, afterUnits }: OrgChartProps) {
  const orphanBefore = beforeUnits.filter((u) => !unitMappings.some((m) => m.beforeUnitIds.includes(u.id)));
  const orphanAfter = afterUnits.filter((u) => !unitMappings.some((m) => m.afterUnitIds.includes(u.id)));
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr", gap: 0, minWidth: 560, alignItems: "start" }}>
        <div style={{ padding: "0 8px 0 0" }}>
          <div className="table-head" style={{ display: "block", marginBottom: 12 }}>ДО реорганизации</div>
          {unitMappings.filter(m => m.beforeUnitIds.length > 0).map((m) => {
            const units = beforeUnits.filter((u) => m.beforeUnitIds.includes(u.id));
            return units.map((u) => (
              <div key={u.id} className="org-node" style={{ borderLeft: `3px solid ${transformColors[m.transformation] || "#b7c9df"}` }}>
                <div className="org-node-name">{u.name}</div>
                {u.abbreviation && <span className="org-abbrev">({u.abbreviation})</span>}
                <div className="org-fn-count">{u.functions.length} функц.</div>
              </div>
            ));
          })}
          {orphanBefore.map((u) => (
            <div key={u.id} className="org-node" style={{ borderLeft: "3px solid #b7c9df", opacity: 0.6 }}>
              <div className="org-node-name">{u.name}</div>
              <div className="org-fn-count">{u.functions.length} функц.</div>
            </div>
          ))}
        </div>
        <div style={{ paddingTop: 38 }}>
          {unitMappings.map((m, idx) => (
            <div key={`connector-${m.beforeUnitIds.join("-")}-${m.afterUnitIds.join("-")}-${idx}`} className="org-connector" style={{ color: transformColors[m.transformation] || "#b7c9df" }}>
              <svg width="100%" height="32" viewBox="0 0 120 32" preserveAspectRatio="none">
                <line x1="0" y1="16" x2="120" y2="16" stroke="currentColor" strokeWidth="1.5" strokeDasharray={m.transformation === "removed" ? "4 3" : m.transformation === "created" ? "4 3" : "none"} />
                <polygon points="112,11 120,16 112,21" fill="currentColor" />
              </svg>
              <div className="org-badge" style={{ background: `${transformColors[m.transformation]}18`, color: transformColors[m.transformation] }}>
                {transformLabels[m.transformation] || m.transformation}
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "0 0 0 8px" }}>
          <div className="table-head" style={{ display: "block", marginBottom: 12 }}>ПОСЛЕ реорганизации</div>
          {unitMappings.filter(m => m.afterUnitIds.length > 0).map((m) => {
            const units = afterUnits.filter((u) => m.afterUnitIds.includes(u.id));
            return units.map((u) => (
              <div key={u.id} className="org-node" style={{ borderLeft: `3px solid ${transformColors[m.transformation] || "#b7c9df"}` }}>
                <div className="org-node-name">{u.name}</div>
                {u.abbreviation && <span className="org-abbrev">({u.abbreviation})</span>}
                <div className="org-fn-count">{u.functions.length} функц.</div>
              </div>
            ));
          })}
          {unitMappings.filter(m => m.afterUnitIds.length === 0).map((m, idx) => (
            <div key={`removed-${m.beforeUnitIds.join("-")}-${idx}`} className="org-node" style={{ borderLeft: "3px solid #ae6424", opacity: 0.5 }}>
              <div className="org-node-name" style={{ color: "#ae6424" }}>— ликвидировано</div>
            </div>
          ))}
          {orphanAfter.map((u) => (
            <div key={u.id} className="org-node" style={{ borderLeft: "3px solid #257895" }}>
              <div className="org-node-name">{u.name}</div>
              <div className="org-abbrev">новое</div>
              <div className="org-fn-count">{u.functions.length} функц.</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}