import { cases, defaultPolicy, evaluateAction } from "../lib/security.ts";
export default class ReferenceProvider {
  id() {
    return "agentgate-reference";
  }
  async callApi(prompt: string) {
    const test = cases.find((c) => c.id === prompt.trim());
    if (!test) return { error: "Unknown reference case" };
    return {
      output: evaluateAction(defaultPolicy, test.action).decision,
      metadata: { mode: "reference", caseId: test.id },
    };
  }
}
