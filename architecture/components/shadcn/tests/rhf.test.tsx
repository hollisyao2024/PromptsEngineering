import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { FormDialog } from "@/components/forms/form-panel";
import { RHFField, submitForm } from "@/components/forms/react-hook-form";
it("TC-ARCHPLAT-010 RHF validation keeps panel open and only submits valid values", async () => {
  const user = userEvent.setup(),
    save = vi.fn();
  function Demo() {
    const form = useForm({ defaultValues: { name: "" } }),
      [open, setOpen] = useState(true);
    return (
      <FormDialog
        title="新增"
        description="填写名称"
        open={open}
        onOpenChange={setOpen}
        onSubmit={submitForm(form, save)}
      >
        <RHFField
          control={form.control}
          name="name"
          label="名称"
          rules={{ required: "名称必填" }}
          render={(field) => <Input {...field} />}
        />
      </FormDialog>
    );
  }
  render(<Demo />);
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByText("名称必填")).toBeVisible();
  expect(save).not.toHaveBeenCalled();
  await user.type(screen.getByRole("textbox", { name: "名称" }), "新记录");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(save).toHaveBeenCalledWith({ name: "新记录" });
});
it("TC-ARCHPLAT-010 Zod resolver transformations reach submit callbacks", async () => {
  const { z } = await import("zod");
  const { zodResolver } = await import("@hookform/resolvers/zod");
  const user = userEvent.setup(),
    save = vi.fn();
  const schema = z.object({ name: z.string().trim().min(1, "名称必填") });
  function Demo() {
    const form = useForm({
      defaultValues: { name: "" },
      resolver: zodResolver(schema),
    });
    return (
      <FormDialog
        title="新增"
        description="填写名称"
        open
        onOpenChange={() => {}}
        onSubmit={submitForm(form, save)}
      >
        <RHFField
          control={form.control}
          name="name"
          label="名称"
          render={(field) => <Input {...field} />}
        />
      </FormDialog>
    );
  }
  render(<Demo />);
  await user.type(screen.getByRole("textbox", { name: "名称" }), "  名称  ");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(save).toHaveBeenCalledWith({ name: "名称" });
});
