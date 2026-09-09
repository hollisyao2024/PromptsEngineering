import { it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { AsyncActionButton } from "@/components/feedback/async-action-button";
it("TC-ARCHPLAT-013 confirmation blocks duplicate/escape, keeps errors and closes after retry", async () => {
  const user = userEvent.setup();
  let reject!: (e: Error) => void;
  const action = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    )
    .mockResolvedValue(undefined);
  function Demo() {
    const [open, setOpen] = useState(true);
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="删除记录"
        description="此操作会删除选中记录"
        onConfirm={action}
        confirmLabel="确认删除"
      />
    );
  }
  render(<Demo />);
  await user.dblClick(screen.getByRole("button", { name: "确认删除" }));
  expect(action).toHaveBeenCalledTimes(1);
  await user.keyboard("{Escape}");
  expect(screen.getByRole("alertdialog")).toBeVisible();
  reject(new Error("稍后再试"));
  await screen.findByText("稍后再试");
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(action).toHaveBeenCalledTimes(2);
});
it("TC-ARCHPLAT-013 action button has pending feedback and recovers from rejection", async () => {
  const user = userEvent.setup(),
    action = vi
      .fn()
      .mockRejectedValueOnce(new Error("保存失败"))
      .mockResolvedValue(undefined);
  render(<AsyncActionButton onAction={action}>保存</AsyncActionButton>);
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(action).toHaveBeenCalledTimes(2);
});
