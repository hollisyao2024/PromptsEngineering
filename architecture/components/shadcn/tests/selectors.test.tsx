import { it, expect, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  SearchSelect,
  MultiSelect,
  type SelectOption,
} from "@/components/selectors/search-select";
import { AsyncCombobox } from "@/components/selectors/async-combobox";
const options = [
  { value: "a", label: "苹果" },
  { value: "b", label: "香蕉" },
  { value: "c", label: "禁用", disabled: true },
];
it("TC-ARCHPLAT-011 local search, disabled choices, controlled multi selection and clear", async () => {
  const user = userEvent.setup();
  function Demo() {
    const [value, setValue] = useState<string[]>([]);
    return (
      <MultiSelect
        label="水果"
        value={value}
        onChange={setValue}
        options={options}
      />
    );
  }
  render(<Demo />);
  await user.click(screen.getByRole("combobox", { name: "水果" }));
  await user.click(screen.getByRole("option", { name: "禁用" }));
  expect(screen.getByRole("combobox", { name: "水果" })).toHaveTextContent(
    "请选择",
  );
  await user.click(screen.getByRole("option", { name: "苹果" }));
  await user.click(screen.getByRole("option", { name: "香蕉" }));
  await user.type(screen.getByPlaceholderText("搜索选项…"), "不存在");
  expect(screen.getByText("没有匹配选项")).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("combobox", { name: "水果" })).toHaveTextContent(
    "苹果、香蕉",
  );
  await user.click(screen.getByRole("button", { name: "清除水果" }));
  expect(screen.getByRole("combobox", { name: "水果" })).toHaveTextContent(
    "请选择",
  );
});
it("TC-ARCHPLAT-011 empty optional props and keyboard single selection", async () => {
  const user = userEvent.setup(),
    change = vi.fn();
  const { rerender } = render(
    <SearchSelect label="水果" options={[]} onChange={change} />,
  );
  await user.click(screen.getByRole("combobox", { name: "水果" }));
  expect(screen.getByText("没有匹配选项")).toBeVisible();
  await user.keyboard("{Escape}");
  rerender(<SearchSelect label="水果" options={options} onChange={change} />);
  await user.click(screen.getByRole("combobox", { name: "水果" }));
  await user.keyboard("{ArrowDown}{Enter}");
  expect(change).toHaveBeenCalled();
});
it("TC-ARCHPLAT-011 stale requests cannot replace new options and failures are retryable", async () => {
  const user = userEvent.setup(),
    requests: {
      q: string;
      resolve: (v: SelectOption[]) => void;
      reject: (e: Error) => void;
      signal: AbortSignal;
    }[] = [];
  const load = vi.fn(
    (q: string, { signal }: { signal: AbortSignal }) =>
      new Promise<SelectOption[]>((resolve, reject) =>
        requests.push({ q, resolve, reject, signal }),
      ),
  );
  render(
    <AsyncCombobox
      label="远程水果"
      value="saved"
      selectedOptions={[{ value: "saved", label: "已选值" }]}
      onChange={() => {}}
      loadOptions={load}
    />,
  );
  await user.click(screen.getByRole("combobox", { name: "远程水果" }));
  await user.type(screen.getByPlaceholderText("搜索选项…"), "new");
  await waitFor(() => expect(requests.at(-1)?.q).toBe("new"));
  await act(async () =>
    requests.at(-1)!.resolve([{ value: "new", label: "最新结果" }]),
  );
  expect(await screen.findByRole("option", { name: "最新结果" })).toBeVisible();
  await act(async () =>
    requests[0].resolve([{ value: "old", label: "旧结果" }]),
  );
  expect(screen.queryByRole("option", { name: "旧结果" })).toBeNull();
  expect(requests[0].signal.aborted).toBe(true);
  expect(screen.getByRole("combobox", { name: "远程水果" })).toHaveTextContent(
    "已选值",
  );
  await user.type(screen.getByPlaceholderText("搜索选项…"), "x");
  await act(async () => requests.at(-1)!.reject(new Error("连接失败")));
  expect(await screen.findByText("连接失败")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "重试" }));
  await act(async () => requests.at(-1)!.resolve([]));
  expect(await screen.findByText("没有匹配选项")).toBeVisible();
});
