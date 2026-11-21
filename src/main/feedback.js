// The "Report a problem" and "Send feedback" emails. Built here in the main
// process from fixed text, so the window can only choose which one to open,
// never the address or the link. No Electron imports, so the tests load it.

export const SUPPORT_EMAIL = "support@ravenburst.com";
export const FEEDBACK_KINDS = ["bug", "feedback"];

/**
 * @param {unknown} p
 * @returns {{kind: "bug"|"feedback"}}
 */
export function checkFeedbackPayload(p) {
  const kind = /** @type {any} */ (p)?.kind;
  if (!FEEDBACK_KINDS.includes(kind)) throw new Error("Unknown feedback type.");
  return { kind };
}

/**
 * @param {"bug"|"feedback"} kind
 * @param {{appName:string, version:string, os:string}} info
 * @returns {string} a mailto: link
 */
export function feedbackMailto(kind, info) {
  const footer = ["---", `${info.appName} ${info.version}`, info.os].join("\n");
  const subject = kind === "bug" ? `Problem report (${info.appName} ${info.version})` : `Feedback about ${info.appName}`;
  const body =
    kind === "bug"
      ? [
          "What happened?",
          "",
          "",
          "What did you expect to happen?",
          "",
          "",
          "Steps to make it happen again (if you know them):",
          "",
          "",
          "If it's about a file, you can attach it (a label PDF or a picture) so we can try it.",
          "",
          footer,
        ].join("\n")
      : ["", "", footer].join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
