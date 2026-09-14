import { cases } from "../lib/security.ts";
const config = {
  description:
    "AgentGate: deterministic policy boundary regression (no model calls)",
  prompts: ["{{caseId}}"],
  providers: ["file://reference-provider.ts"],
  tests: cases.map((c) => ({
    description: c.title,
    vars: { caseId: c.id },
    assert: [{ type: "equals", value: c.expected }],
  })),
};
export default config;
