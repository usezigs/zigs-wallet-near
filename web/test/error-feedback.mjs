import assert from "node:assert/strict";
import { errorFeedback } from "../error-feedback.js";

const secret = "https://rpc.invalid/private-key?token=secret";
for (const error of [Object.assign(Error(secret), { status: 429 }),
  Object.assign(Error(secret), { name: "TimeoutError" }),
  Object.assign(Error(secret), { name: "QuotaExceededError" }),
  Object.assign(Error(secret), { refused: false })]) {
  const result = errorFeedback(error);
  assert.ok(result.detail, "a known failure has a fixed diagnostic classification");
  assert.ok(!JSON.stringify(result).includes(secret),
    "classification does not copy payloads or credentials");
}
assert.match(errorFeedback(Object.assign(Error(secret), { refused: false })).message,
  /may still reach the network.*Check Activity/);
assert.match(errorFeedback(Object.assign(Error(secret), { refused: true })).message,
  /network refused/);
assert.match(errorFeedback(new TypeError("Failed to fetch")).message,
  /check the transaction status/i);
for (const message of ["This signature does not match the approved transaction.",
  "The payment no longer pays the checked wallet.",
    "Network-looking but unknown validation error."]) {
  assert.deepEqual(errorFeedback(Error(message)), { message, detail: "" },
    "domain refusals stay intact");
}
assert.equal(errorFeedback(new TypeError("Cannot read properties of undefined")).detail, "",
  "a programming error is not classified as a network failure");
console.log("error-feedback: known failures, uncertain submissions, "
  + "credential exclusion and validation preservation ok");
