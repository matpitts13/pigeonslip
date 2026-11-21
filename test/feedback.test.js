import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL, checkFeedbackPayload, feedbackMailto } from "../src/main/feedback.js";

const info = { appName: "App", version: "1.2.3", os: "Windows 10.0.26200 (x64), Electron 45.4.1" };
const decode = (link) => {
  const u = new URL(link);
  return { to: u.pathname, subject: u.searchParams.get("subject"), body: u.searchParams.get("body") };
};

describe("feedbackMailto", () => {
  it("pre-fills a problem report with the app and system details", () => {
    const m = decode(feedbackMailto("bug", info));
    expect(m.to).toBe(SUPPORT_EMAIL);
    expect(m.subject).toBe("Problem report (App 1.2.3)");
    expect(m.body).toContain("What happened?");
    expect(m.body).toContain("What did you expect to happen?");
    expect(m.body).toContain("App 1.2.3\nWindows 10.0.26200 (x64), Electron 45.4.1");
  });

  it("keeps plain feedback short", () => {
    const m = decode(feedbackMailto("feedback", info));
    expect(m.subject).toBe("Feedback about App");
    expect(m.body).not.toContain("What happened?");
    expect(m.body).toContain("App 1.2.3");
  });

  it("always goes to the support address", () => {
    expect(feedbackMailto("bug", { ...info, appName: "x&to=evil@example.com" }).startsWith(`mailto:${SUPPORT_EMAIL}?subject=`)).toBe(true);
    expect(decode(feedbackMailto("bug", { ...info, appName: "x&to=evil@example.com" })).to).toBe(SUPPORT_EMAIL);
  });
});

describe("checkFeedbackPayload", () => {
  it("accepts only the two kinds", () => {
    expect(checkFeedbackPayload({ kind: "bug" }).kind).toBe("bug");
    expect(checkFeedbackPayload({ kind: "feedback" }).kind).toBe("feedback");
    expect(() => checkFeedbackPayload({ kind: "mailto:x@y.z" })).toThrow();
    expect(() => checkFeedbackPayload(null)).toThrow();
  });
});