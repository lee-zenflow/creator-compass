import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { AdminTable } from "./admin-table";

describe("AdminTable", () => {
  test("renders semantic columns and real rows", () => {
    render(
      <AdminTable
        ariaLabel="知识来源"
        columns={[
          { key: "name", label: "来源" },
          { key: "status", label: "状态" },
        ]}
        rows={[{ id: "source-1", name: "官方规则", status: "待审核" }]}
        rowKey={(row) => row.id}
      />,
    );

    expect(screen.getByRole("table", { name: "知识来源" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "来源" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "官方规则" })).toBeInTheDocument();
  });

  test("renders a composed empty state instead of fake rows", () => {
    render(
      <AdminTable
        ariaLabel="知识来源"
        columns={[{ key: "name", label: "来源" }]}
        rows={[] as Array<{ id: string; name: string }>}
        rowKey={(row) => row.id}
        empty="还没有知识来源"
      />,
    );

    expect(screen.getByText("还没有知识来源")).toBeInTheDocument();
    expect(screen.queryAllByRole("row")).toHaveLength(1);
  });
});
