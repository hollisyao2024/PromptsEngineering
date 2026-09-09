import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DatePicker,
  DateRangePicker,
} from "@/components/selectors/date-picker";
import {
  parseDateValue,
  formatDateValue,
  validDateRange,
} from "@/components/selectors/date-value";
it("TC-ARCHPLAT-012 calendar strings preserve local date and reject impossible/out of order ranges", () => {
  for (const date of ["2024-02-29", "2026-01-01", "2026-12-31"])
    expect(formatDateValue(parseDateValue(date)!)).toBe(date);
  for (const date of [
    "2025-02-29",
    "2026-02-31",
    "2026-13-01",
    "2026-01-01T00:00:00Z",
    "",
  ])
    expect(parseDateValue(date)).toBeUndefined();
  expect(validDateRange({ from: "2026-09-10", to: "2026-09-09" })).toBe(false);
  expect(
    validDateRange({ from: "2026-09-09", to: "2026-09-10" }, "2026-09-10"),
  ).toBe(false);
});
it("TC-ARCHPLAT-012 date range rejects incomplete/reversed/out-of-bound input, applies preset and clears", async () => {
  const user = userEvent.setup(),
    change = vi.fn();
  render(
    <DateRangePicker
      label="日期范围"
      onChange={change}
      min="2026-09-01"
      max="2026-09-30"
      presets={[
        { label: "本周", value: { from: "2026-09-07", to: "2026-09-13" } },
      ]}
    />,
  );
  await user.click(screen.getByRole("button", { name: "日期范围" }));
  await user.type(
    screen.getByRole("textbox", { name: "开始日期" }),
    "2026-09-20",
  );
  await user.type(
    screen.getByRole("textbox", { name: "结束日期" }),
    "2026-09-10",
  );
  await user.click(screen.getByRole("button", { name: "应用日期" }));
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "本周" }));
  expect(change).toHaveBeenCalledWith({ from: "2026-09-07", to: "2026-09-13" });
  await user.click(screen.getByRole("button", { name: "日期范围" }));
  await user.click(screen.getByRole("button", { name: "清除日期" }));
  expect(change).toHaveBeenLastCalledWith(undefined);
});
it("TC-ARCHPLAT-012 single date uses valid manual input", async () => {
  const user = userEvent.setup(),
    change = vi.fn();
  render(<DatePicker label="发布日期" onChange={change} />);
  await user.click(screen.getByRole("button", { name: "发布日期" }));
  await user.type(
    screen.getByRole("textbox", { name: "日期（YYYY-MM-DD）" }),
    "2026-02-31",
  );
  await user.click(screen.getByRole("button", { name: "应用日期" }));
  expect(change).not.toHaveBeenCalled();
  await user.clear(screen.getByRole("textbox", { name: "日期（YYYY-MM-DD）" }));
  await user.type(
    screen.getByRole("textbox", { name: "日期（YYYY-MM-DD）" }),
    "2026-09-09",
  );
  await user.click(screen.getByRole("button", { name: "应用日期" }));
  expect(change).toHaveBeenCalledWith("2026-09-09");
});
