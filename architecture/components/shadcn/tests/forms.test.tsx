import { it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/form-field";
import { FormDialog, FormSheet } from "@/components/forms/form-panel";
it("TC-ARCHPLAT-010 fields associate labels, hints and errors", () => {
  render(
    <FormField label="名称" description="最多 20 字" error="名称必填">
      <Input />
    </FormField>,
  );
  const input = screen.getByRole("textbox", { name: "名称" });
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAccessibleDescription("最多 20 字 名称必填");
});
for (const Panel of [FormDialog, FormSheet])
  it(`TC-ARCHPLAT-010 ${Panel.name} retains invalid/failed values and confirms dirty closure`, async () => {
    const user = userEvent.setup(),
      save = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error("网络失败"))
        .mockResolvedValue(undefined);
    function Demo() {
      const [open, setOpen] = useState(true),
        [value, setValue] = useState("");
      return (
        <Panel
          open={open}
          onOpenChange={setOpen}
          title="编辑记录"
          description="编辑名称"
          dirty={!!value}
          onSubmit={save}
        >
          <FormField label="名称">
            <Input value={value} onChange={(e) => setValue(e.target.value)} />
          </FormField>
        </Panel>
      );
    }
    render(<Demo />);
    await user.type(screen.getByRole("textbox", { name: "名称" }), "保留");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("网络失败")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "名称" })).toHaveValue("保留");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
it("TC-ARCHPLAT-010 pending form blocks duplicate submission and Escape; discard callback runs only after confirmation", async () => {
  const user = userEvent.setup(),
    discard = vi.fn();
  let resolve!: () => void;
  const save = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    ),
    close = vi.fn();
  const { rerender } = render(
    <FormDialog
      open
      onOpenChange={close}
      title="编辑"
      description="保存测试"
      dirty
      onSubmit={save}
      onDiscard={discard}
    >
      <FormField label="名称">
        <Input defaultValue="未保存" />
      </FormField>
    </FormDialog>,
  );
  await user.dblClick(screen.getByRole("button", { name: "保存" }));
  await user.keyboard("{Escape}");
  expect(save).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  resolve();
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  rerender(
    <FormDialog
      open
      onOpenChange={close}
      title="编辑"
      description="关闭测试"
      dirty
      onSubmit={save}
      onDiscard={discard}
    >
      <FormField label="名称">
        <Input defaultValue="未保存" />
      </FormField>
    </FormDialog>,
  );
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(discard).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(discard).toHaveBeenCalledTimes(1);
});
it("TC-ARCHPLAT-010 closing a controlled form restores focus to its external opener", async () => {
  const user = userEvent.setup();
  const { Button } = await import("@/components/ui/button");
  function Demo() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>打开编辑</Button>
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title="编辑"
          description="焦点测试"
          onSubmit={() => {}}
        >
          <FormField label="名称">
            <Input />
          </FormField>
        </FormDialog>
      </>
    );
  }
  render(<Demo />);
  const trigger = screen.getByRole("button", { name: "打开编辑" });
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(trigger).toHaveFocus());
});
