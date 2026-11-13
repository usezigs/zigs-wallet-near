// Classify only established failure types. Unknown domain validation stays intact rather than
// inventing a cause or replacing a security refusal with a generic retry instruction.
const FEEDBACK = {
  rate: {
    message: "The service is receiving too many requests. Wait a minute, then retry this step. "
      + "Check any pending payment before submitting again.",
    detail: "Service response: rate limited (429).",
  },
  storage: {
    message: "This browser could not save more data. Keep this page open and save recovery "
      + "files before changing browser storage settings.",
    detail: "Browser storage: quota exceeded.",
  },
};
const NETWORK_MESSAGE = "The network operation did not finish. Check your connection. "
  + "If you were sending, check the transaction status before submitting again.";
const FETCH_FAILURE = /^(Failed to fetch|fetch failed|Load failed|Network request failed)$/i;
const errorFacts = (error) => ({
  message: typeof error?.message === "string" ? error.message : String(error),
  code: error?.code ?? error?.status, name: error?.name, refused: error?.refused,
});
function knownFailure({ code, name, message }) {
  if ([429, "rate-limited"].includes(code)) return FEEDBACK.rate;
  if (name === "QuotaExceededError") return FEEDBACK.storage;
  if (["TimeoutError", "NetworkError"].includes(name)
    || name === "TypeError" && FETCH_FAILURE.test(message)) return {
    message: NETWORK_MESSAGE,
    detail: name === "TimeoutError" ? "Network operation: timed out."
      : "Network operation: connection failed.",
  };
  return null;
}
function submissionFailure(refused) {
  return {
    message: refused
      ? "The network refused this transaction. Check its payment details before trying another "
        + "payment."
      : "The transaction submission did not finish. It may still reach the network. "
        + "Check Activity before proposing another payment.",
    detail: refused ? "Submission: refused by all contacted nodes." :
      "Submission: outcome unknown.",
  };
}
export function errorFeedback(error) {
  const facts = errorFacts(error);
  if (typeof facts.refused === "boolean") return submissionFailure(facts.refused);
  return { ...(knownFailure(facts) || { message: facts.message, detail: "" }) };
}
