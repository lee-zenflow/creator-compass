"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { DRAFT_SUBMISSION_KEY, DraftStore, type DraftEntityType } from "@/lib/offline/draft-store";

type OfflineDraftFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  baseVersion: number;
  children: ReactNode;
  className?: string;
  databaseName?: string;
  draftId: string;
  entityId: string;
  entityType: DraftEntityType;
  id?: string;
};

function serializeForm(form: HTMLFormElement) {
  const content: Record<string, string | string[]> = {};
  const excluded = new Set(Array.from(form.elements)
    .filter((control): control is HTMLInputElement => control instanceof HTMLInputElement && ["hidden", "file", "password"].includes(control.type))
    .map((control) => control.name));
  for (const [name, value] of new FormData(form).entries()) {
    if (value instanceof File || !name || excluded.has(name) || ["password", "token"].some((word) => name.toLocaleLowerCase("en-US").includes(word))) continue;
    const previous = content[name];
    content[name] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return content;
}

function restoreForm(form: HTMLFormElement, content: Record<string, unknown>) {
  for (const [name, raw] of Object.entries(content)) {
    const values = Array.isArray(raw) ? raw.map(String) : [String(raw)];
    const controls = form.elements.namedItem(name);
    const list = controls instanceof RadioNodeList ? Array.from(controls) : controls ? [controls] : [];
    for (const control of list) {
      if (control instanceof HTMLInputElement && (control.type === "radio" || control.type === "checkbox")) control.checked = values.includes(control.value);
      else if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) control.value = values[0] ?? "";
    }
  }
}

export function OfflineDraftForm({ action, baseVersion, children, className, databaseName, draftId, entityId, entityType, id }: OfflineDraftFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const storeRef = useRef<DraftStore>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [status, setStatus] = useState<"idle" | "restored" | "saved">("idle");
  storeRef.current ??= new DraftStore(databaseName);

  useEffect(() => {
    let active = true;
    void storeRef.current!.get(draftId).then((draft) => {
      if (!active || !draft || !formRef.current) return;
      restoreForm(formRef.current, draft.content);
      setStatus("restored");
    });
    return () => { active = false; if (timerRef.current) clearTimeout(timerRef.current); };
  }, [draftId]);

  function saveDraft(event: FormEvent<HTMLFormElement>) {
    if (timerRef.current) clearTimeout(timerRef.current);
    const form = event.currentTarget;
    timerRef.current = setTimeout(() => {
      void storeRef.current!.put({
        id: draftId,
        entityType,
        entityId,
        baseVersion,
        content: serializeForm(form),
        updatedAt: new Date().toISOString(),
        state: "pending",
      }).then(() => setStatus("saved"));
    }, 250);
  }

  function markSubmitted() {
    sessionStorage.setItem(DRAFT_SUBMISSION_KEY, JSON.stringify({ draftId, fromPath: location.pathname }));
  }

  return <form action={action} className={className} id={id} onInput={saveDraft} onSubmit={markSubmitted} ref={formRef}>
    {children}
    <small className="offline-draft-status" aria-live="polite">{status === "restored" ? "已恢复本地草稿" : status === "saved" ? "草稿已保存在本机" : ""}</small>
  </form>;
}
