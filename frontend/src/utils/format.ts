import type { CallRecord } from "../types";
export const formatTime = (date: string) =>
  new Date(date).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export const readableStatus = (value: CallRecord["status"]) =>
  ({ completed: "成功", cancelled: "已取消", failed: "失败" })[value];
