import test from "node:test";
import assert from "node:assert/strict";
import { describeModelError } from "../dist/model-errors.js";
test("model failures use safe categories without leaking provider details",()=>{
 for(const [error,code,retryable] of [[{status:401},"model_auth",false],[{status:403},"model_auth",false],[{status:402},"model_balance",false],[{status:429},"model_rate_limit",true],[{code:"ETIMEDOUT"},"model_timeout",true],[new Error("sensitive internal detail"),"model_unavailable",true]]) {
  const result=describeModelError(error); assert.equal(result.code,code);assert.equal(result.retryable,retryable);assert.ok(!result.message.includes("sensitive"));
 }
});
