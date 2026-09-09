import {it,expect,vi} from "vitest";
import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {IdentityPanel,type IdentityPort} from "@/components/advanced/identity-panel";
it("TC-OSSKIT-002 login and logout use the supplied identity port and clear passwords",async()=>{
 let signedIn=false;const user=userEvent.setup(),client:IdentityPort={session:async()=>signedIn?{user:{id:"1",name:"成员"}}:null,signIn:vi.fn(async()=>{signedIn=true;}),signOut:vi.fn(async()=>{signedIn=false;}),organizations:async()=>[],selectOrganization:vi.fn(async()=>{})};
 render(<IdentityPanel client={client}/>);await waitFor(()=>expect(screen.getByRole("button",{name:"登录"})).not.toBeDisabled());await user.type(screen.getByLabelText("登录邮箱"),"member@example.invalid");await user.type(screen.getByLabelText("登录密码"),"fixture-password");await user.click(screen.getByRole("button",{name:"登录"}));await waitFor(()=>expect(screen.getByText("当前用户：成员")).toBeVisible());await user.click(screen.getByRole("button",{name:"退出登录"}));await waitFor(()=>expect(screen.getByLabelText("登录密码")).toHaveValue(""));
});
