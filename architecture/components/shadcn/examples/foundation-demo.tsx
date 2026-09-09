"use client";
import { useCallback, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { FormDialog } from "@/components/forms/form-panel";
import { FormField } from "@/components/forms/form-field";
import { FormSection } from "@/components/forms/form-section";
import {
  SearchSelect,
  MultiSelect,
  type SelectOption,
} from "@/components/selectors/search-select";
import { AsyncCombobox } from "@/components/selectors/async-combobox";
import { DatePicker } from "@/components/selectors/date-picker";
import { Notifications, notify } from "@/components/feedback/notifications";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
type Row = {
  id: string;
  name: string;
  status: string;
  date: string;
  tags: string[];
  owner?: string;
};
const statuses = [
  { value: "active", label: "启用" },
  { value: "paused", label: "暂停" },
];
const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "名称" },
  {
    accessorKey: "status",
    header: "状态",
    meta: { filterVariant: "multi-select", filterOptions: statuses },
    cell: ({ getValue }) => (
      <Badge variant="secondary">
        {statuses.find((s) => s.value === getValue())?.label}
      </Badge>
    ),
  },
  {
    accessorKey: "date",
    header: "日期",
    meta: { filterVariant: "date-range" },
  },
];
const initial: Row[] = Array.from({ length: 24 }, (_, i) => ({
  id: String(i + 1),
  name: `示例记录 ${i + 1}`,
  status: i % 3 ? "active" : "paused",
  date: `2026-09-${String(i + 1).padStart(2, "0")}`,
  tags: [],
}));
const blank = (): Row => ({
  id: "",
  name: "",
  status: "active",
  date: "",
  tags: [],
});
const owners: SelectOption[] = [
  { value: "design", label: "设计团队" },
  { value: "engineering", label: "研发团队" },
];
export function App() {
  const [rows, setRows] = useState(initial),
    [editing, setEditing] = useState<Row>(),
    [draft, setDraft] = useState<Row>(blank),
    [error, setError] = useState(""),
    [failNext, setFailNext] = useState(false);
  const loadOwners = useCallback(
    async (search: string, { signal }: { signal: AbortSignal }) => {
      signal.throwIfAborted();
      return owners.filter((owner) => owner.label.includes(search));
    },
    [],
  );
  const open = (row: Row) => {
    setDraft({ ...row });
    setEditing({ ...row });
    setError("");
  };
  const save = async () => {
    if (!draft.name.trim() || !draft.date) {
      setError("请填写名称并选择日期");
      return false;
    }
    if (failNext) {
      setFailNext(false);
      throw new Error("演示保存失败，请重试；输入内容已保留");
    }
    setRows((current) =>
      draft.id
        ? current.map((row) => (row.id === draft.id ? draft : row))
        : [{ ...draft, id: crypto.randomUUID() }, ...current],
    );
    notify.success("记录已保存");
  };
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
      <Notifications />
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">公共组件示例</h1>
        <p className="text-sm text-muted-foreground">
          表格、表单、选择器和反馈共用一套组件。示例数据只保存在当前页面内存中。
        </p>
      </header>
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        onCreate={() => open(blank())}
        onEdit={open}
        onDelete={async (ids) => {
          setRows((current) => current.filter((row) => !ids.includes(row.id)));
          notify.success("记录已删除");
        }}
      />
      <FormDialog
        open={!!editing}
        onOpenChange={(value) => {
          if (!value) setEditing(undefined);
        }}
        title={draft.id ? "修改记录" : "新增记录"}
        description="填写名称、状态和日期后保存。"
        dirty={!!editing && JSON.stringify(draft) !== JSON.stringify(editing)}
        onSubmit={save}
      >
        <FormSection title="基本信息" columns={2}>
          <FormField label="名称" error={error}>
            <Input
              value={draft.name}
              onChange={(e) => {
                setDraft({ ...draft, name: e.target.value });
                setError("");
              }}
            />
          </FormField>
          <FormField label="状态">
            <SearchSelect
              label="状态"
              value={draft.status}
              onChange={(value) =>
                setDraft({ ...draft, status: value || "active" })
              }
              options={statuses}
              clearable={false}
            />
          </FormField>
          <FormField label="日期">
            <DatePicker
              label="记录日期"
              value={draft.date || undefined}
              onChange={(value) => setDraft({ ...draft, date: value || "" })}
            />
          </FormField>
          <FormField label="标签">
            <MultiSelect
              label="标签"
              value={draft.tags}
              onChange={(tags) => setDraft({ ...draft, tags })}
              options={[
                { value: "priority", label: "重点" },
                { value: "review", label: "待审核" },
              ]}
            />
          </FormField>
          <FormField label="负责人">
            <AsyncCombobox
              label="负责人"
              value={draft.owner}
              onChange={(owner) => setDraft({ ...draft, owner })}
              loadOptions={loadOwners}
              selectedOptions={owners}
            />
          </FormField>
        </FormSection>
        <FormField
          label="模拟下一次保存失败"
          description="用于体验提交失败后的重试。"
        >
          <Switch checked={failNext} onCheckedChange={setFailNext} />
        </FormField>
      </FormDialog>
    </main>
  );
}
