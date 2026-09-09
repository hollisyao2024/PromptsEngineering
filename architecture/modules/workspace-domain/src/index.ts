// Project-owned public domain values; persistence models stay in database packages.
export const taskStatuses=['todo','doing','done'] as const;
export type TaskStatus=typeof taskStatuses[number];
export const taskStatusLabels:Record<TaskStatus,string>={todo:'待处理',doing:'进行中',done:'已完成'};
