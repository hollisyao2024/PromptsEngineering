import {it,expect,vi} from "vitest";
import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {JobStatus} from "@/components/feedback/job-status";
it("TC-OSSKIT-003 status exposes valid cancel/retry actions without treating active work as cancelled",async()=>{
 const cancel=vi.fn(async()=>{}),retry=vi.fn(async()=>{}),user=userEvent.setup();const {rerender}=render(<JobStatus job={{id:"job",state:"waiting"}} onCancel={cancel} onRetry={retry}/>);await user.click(screen.getByRole("button",{name:"取消任务"}));expect(cancel).toHaveBeenCalledOnce();rerender(<JobStatus job={{id:"job",state:"active",progress:30}} onCancel={cancel} onRetry={retry}/>);expect(screen.queryByRole("button")).toBeNull();rerender(<JobStatus job={{id:"job",state:"failed"}} onCancel={cancel} onRetry={retry}/>);await user.click(screen.getByRole("button",{name:"重试任务"}));expect(retry).toHaveBeenCalledOnce();
});
