import {it,expect} from "vitest";
import {render,screen} from "@testing-library/react";
import {MetricChart} from "@/components/advanced/metric-chart";
import {ChartStyle} from "@/components/ui/chart";
it("TC-OSSKIT-005 chart includes a textual alternative and an empty state",()=>{
 const {rerender}=render(<MetricChart title="访客" data={[{label:"周一",value:12}]}/>);expect(screen.getByText("周一：12")).toBeInTheDocument();rerender(<MetricChart title="访客" data={[]}/>);expect(screen.getByText("暂无图表数据")).toBeVisible();
});
it("TC-OSSKIT-005 chart styles reject CSS/HTML injection",()=>{expect(()=>render(<ChartStyle id="safe" config={{value:{color:"red;}</style><script>"}}}/>)).toThrow("Invalid chart color");});
