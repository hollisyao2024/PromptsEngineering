import {it,expect,vi} from "vitest";
import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {FileUpload,type UploadPort} from "@/components/advanced/file-upload";
it("TC-OSSKIT-004 uploads a session, reports completion and removes the chosen file",async()=>{
 const user=userEvent.setup(),result={id:"fixture",name:"hello.txt",size:5,contentType:"text/plain",state:"ready",createdAt:"now",updatedAt:"now"};
 const client:UploadPort={createUpload:vi.fn(async()=>({file:{...result,state:"pending"},expiresAt:"later",transport:{kind:"proxy",method:"PUT",path:"/uploads/fixture/content"}})),upload:vi.fn(async(_s,_f,o)=>{o?.onProgress?.(1);}),complete:vi.fn(async()=>result),cancel:vi.fn(async()=>{})},done=vi.fn();
 render(<FileUpload client={client} onUploaded={done}/>);await user.upload(screen.getByLabelText("选择上传文件"),new File(["hello"],"hello.txt",{type:"text/plain"}));await user.click(screen.getByRole("button",{name:"上传文件"}));await waitFor(()=>expect(done).toHaveBeenCalledWith(result));expect(screen.getByText("已完成")).toBeVisible();expect(client.cancel).not.toHaveBeenCalled();await user.click(screen.getByRole("button",{name:"移除"}));expect(screen.queryByText("hello.txt")).toBeNull();
});
