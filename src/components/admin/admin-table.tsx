import type { ReactNode } from "react";

export type AdminColumn<Row> = {
  key: string;
  label: string;
  render?: (row: Row) => ReactNode;
};

export function AdminTable<Row extends object>({
  ariaLabel,
  columns,
  rows,
  rowKey,
  empty = "暂无数据",
}: {
  ariaLabel: string;
  columns: Array<AdminColumn<Row>>;
  rows: Row[];
  rowKey: (row: Row) => string;
  empty?: string;
}) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table" aria-label={ariaLabel}>
        <thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key}>{column.render ? column.render(row) : ((row as Record<string, unknown>)[column.key] as ReactNode)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <div className="admin-empty"><strong>{empty}</strong><small>新数据会在完成入库后出现在这里。</small></div> : null}
    </div>
  );
}
