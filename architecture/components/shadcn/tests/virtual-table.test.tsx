import {it,expect,vi} from "vitest";
import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {VirtualDataTable} from "@/components/data-table/virtual-data-table";
it("TC-OSSKIT-005 virtual table reuses filtering, pagination and export state",async()=>{
 const user=userEvent.setup(),exported=vi.fn();render(<VirtualDataTable data={Array.from({length:1000},(_,i)=>({id:String(i),name:"Row "+i}))} columns={[{accessorKey:"name",header:"名称"}]} getRowId={r=>r.id} initialPageSize={1000} onExport={exported}/>);
 expect(screen.getByText(/共 1000 条/)).toBeVisible();expect(screen.getAllByRole("row").length).toBeLessThan(100);await user.type(screen.getByRole("textbox",{name:"搜索表格"}),"Row 999");expect(screen.getByText(/共 1 条/)).toBeVisible();await user.click(screen.getByRole("button",{name:"导出筛选结果"}));expect(exported).toHaveBeenCalledWith(expect.objectContaining({rows:[{id:"999",name:"Row 999"}]}));
});
