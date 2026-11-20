export function describeModelError(cause:unknown) {
 const error=cause as {status?:number;code?:string;name?:string};
 const status=Number(error?.status);
 if(status===401 || status===403) return {code:"model_auth",message:"模型服务鉴权失败，请检查模型密钥和访问权限。",retryable:false};
 if(status===402) return {code:"model_balance",message:"模型服务额度不足，请检查账户余额。",retryable:false};
 if(status===429) return {code:"model_rate_limit",message:"模型请求频率或额度受限，请稍后重试。",retryable:true};
 if(error?.name?.includes("Timeout") || error?.code==="ETIMEDOUT") return {code:"model_timeout",message:"模型响应超时，请稍后重试。",retryable:true};
 return {code:"model_unavailable",message:"模型服务暂时不可用或连接中断，请稍后重试。",retryable:true};
}
