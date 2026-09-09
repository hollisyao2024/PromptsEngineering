import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { FormDialog, FormSheet } from "@/components/forms/form-panel";
import {
  DatePicker,
  DateRangePicker,
} from "@/components/selectors/date-picker";
import type { DateRangeValue } from "@/components/selectors/date-value";
for (const Panel of [FormDialog, FormSheet])
  it(`TC-ARCHPLAT-012 nested dates in ${Panel.name} preserve the form until explicit submit`, async () => {
    const user = userEvent.setup(),
      close = vi.fn(),
      save = vi.fn();
    function Demo() {
      const [date, setDate] = useState<string>(),
        [range, setRange] = useState<DateRangeValue>();
      return (
        <Panel
          title="编辑"
          description="选择日期"
          open
          onOpenChange={close}
          dirty
          onSubmit={() => save(date, range)}
        >
          <DatePicker label="发布日期" value={date} onChange={setDate} />
          <DateRangePicker label="生效范围" value={range} onChange={setRange} />
        </Panel>
      );
    }
    render(<Demo />);
    await user.click(screen.getByRole("button", { name: "发布日期" }));
    await user.type(
      screen.getByRole("textbox", { name: "日期（YYYY-MM-DD）" }),
      "2026-09-10",
    );
    await user.click(screen.getByRole("button", { name: "应用日期" }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "发布日期" })).toHaveTextContent(
      "2026-09-10",
    );
    await user.click(screen.getByRole("button", { name: "生效范围" }));
    await user.type(
      screen.getByRole("textbox", { name: "开始日期" }),
      "2026-09-10",
    );
    await user.type(
      screen.getByRole("textbox", { name: "结束日期" }),
      "2026-09-12",
    );
    await user.click(screen.getByRole("button", { name: "应用日期" }));
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(save).toHaveBeenCalledWith("2026-09-10", {
      from: "2026-09-10",
      to: "2026-09-12",
    });
  });
