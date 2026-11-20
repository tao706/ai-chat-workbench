import axios from "axios";
export class RequestFailure extends Error {
  constructor(public code:string,message:string,public retryable=true) {super(message);this.name="RequestFailure";}
}
export function failureMessage(cause:unknown):string {
  if(typeof navigator!=="undefined" && !navigator.onLine) return "网络已断开，请恢复联网后重试。";
  if(cause instanceof RequestFailure) return cause.message;
  if(axios.isAxiosError(cause)) {
    if(cause.code==="ECONNABORTED" || cause.code==="ETIMEDOUT") return "请求超时，请稍后重试。";
    const status=cause.response?.status;
    if(status===401 || status===403) return "请求未获授权，请检查服务访问配置。";
    if(status===429) return "请求过于频繁，请稍后重试。";
    if(status && status>=500) return "服务暂时不可用，请稍后重试。";
    if(!cause.response) return "无法连接服务，请检查网络及服务是否启动。";
    return String(cause.response.data?.error || "请求未成功，请检查输入后重试。");
  }
  if(cause instanceof TypeError) return "连接已中断或服务不可达，请检查网络后重试。";
  return cause instanceof Error ? cause.message : "操作失败，请稍后重试。";
}
