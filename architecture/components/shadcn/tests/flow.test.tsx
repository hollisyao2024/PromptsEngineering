import {it,expect,vi} from "vitest";
import {render,screen} from "@testing-library/react";
import {FlowEditor} from "@/components/advanced/flow-editor";
it("TC-OSSKIT-005 flow read-only canvas exposes shadcn view controls",()=>{
 const changed=vi.fn();render(<FlowEditor nodes={[]} edges={[]} readOnly onChange={changed}/>);expect(screen.getByRole("region",{name:"流程画布"})).toBeVisible();expect(screen.getByRole("button",{name:"放大"})).toBeVisible();expect(screen.getByRole("button",{name:"适应画布"})).toBeVisible();expect(changed).not.toHaveBeenCalled();
});
