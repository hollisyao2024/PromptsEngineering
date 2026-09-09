import {it,expect,vi} from "vitest";
import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {SortableList} from "@/components/advanced/sortable-list";
it("TC-OSSKIT-005 sorting is keyboard/button accessible and preserves stable IDs",async()=>{
 const changed=vi.fn(),user=userEvent.setup();render(<SortableList items={["a","b"]} getId={x=>x} renderItem={x=>x} onChange={changed}/>);expect(screen.getByRole("button",{name:"上移 a"})).toBeDisabled();await user.click(screen.getByRole("button",{name:"下移 a"}));expect(changed).toHaveBeenCalledWith(["b","a"]);
});
