"use client";

import { useState } from "react";

import { ModuleIcon } from "@/components/ui/module-icon";

export type MaterialPickerItem = {
  id: string;
  name: string;
  category: "inspiration" | "history_content";
};

export function MaterialPicker({
  materials,
  defaultSelectedIds = [],
  onSelectionChange,
}: {
  materials: MaterialPickerItem[];
  defaultSelectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelectedIds));
  if (materials.length === 0) {
    return <div className="compact-empty">还没有素材</div>;
  }
  return (
    <section aria-label="素材选择">
      <div className="compact-section-label">已选 {selected.size} 项素材</div>
      <div className="compact-stack">
        {materials.map((material) => (
          <label className="material-picker__item" key={material.id}>
            <ModuleIcon name="materials" label={`素材：${material.name}`} />
            <input
              aria-label={`选择 ${material.name}`}
              checked={selected.has(material.id)}
              onChange={() => setSelected((current) => {
                const next = new Set(current);
                if (next.has(material.id)) next.delete(material.id);
                else next.add(material.id);
                onSelectionChange?.(
                  materials.filter((item) => next.has(item.id)).map((item) => item.id),
                );
                return next;
              })}
              type="checkbox"
            />
            <span>{material.name}</span>
            <small>{material.category === "inspiration" ? "灵感" : "历史内容"}</small>
          </label>
        ))}
      </div>
    </section>
  );
}
