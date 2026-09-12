import { readFileSync } from "node:fs";
import { verifyAudit, type Org } from "../lib/platform/domain.ts";
const path = process.argv[2];
if (!path)
  throw Error(
    "Usage: node --experimental-strip-types scripts/verify-audit.ts <organization.json> [checkpoint.json]",
  );
const org = JSON.parse(readFileSync(path, "utf8")) as Org;
const result = await verifyAudit(org);
let checkpointValid = true;
if (process.argv[3]) {
  const checkpoint = JSON.parse(readFileSync(process.argv[3], "utf8")) as {
    orgId: string;
    checked: number;
    head: string;
  };
  checkpointValid =
    checkpoint.orgId === org.id &&
    org.audit[checkpoint.checked - 1]?.hash === checkpoint.head;
}
console.log(JSON.stringify({ ...result, checkpointValid }, null, 2));
if (!result.valid || !checkpointValid) process.exitCode = 1;
