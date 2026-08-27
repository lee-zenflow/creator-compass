import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";

type StatusRowProps = {
  state: "processing" | "empty" | "error" | "success";
  title: string;
  detail?: string;
};

export function StatusRow({ state, title, detail }: StatusRowProps) {
  const Icon =
    state === "error"
      ? CircleAlert
      : state === "success"
        ? CircleCheck
        : LoaderCircle;

  return (
    <div
      className="status-row"
      role={state === "error" ? "alert" : "status"}
      data-state={state}
    >
      <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
      <span>
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </div>
  );
}
