import {it,expect,vi} from "vitest";
import {render,screen,waitFor} from "@testing-library/react";
import {RichTextEditor} from "@/components/advanced/rich-text-editor";
it("TC-OSSKIT-005 editor renders structured content and disables editing",async()=>{
 const changed=vi.fn();render(<RichTextEditor disabled value={{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"安全正文"}]}]}} onChange={changed}/>);
 await waitFor(()=>expect(screen.getByRole("textbox",{name:"正文"})).toHaveAttribute("contenteditable","false"));expect(screen.getByText("安全正文")).toBeVisible();expect(screen.getByRole("button",{name:"加粗"})).toBeDisabled();expect(changed).not.toHaveBeenCalled();
});
