import {
  audit,
  verifyAudit,
  Fault,
  requireRole,
  allRoles,
  ensureOrgDefaults,
  type Org,
} from "./domain.ts";

export class OrgStore {
  private db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }
  async list(userId: string) {
    const result = await this.db
      .prepare(
        "SELECT id, json_extract(state,'$.name') AS name FROM organizations WHERE EXISTS (SELECT 1 FROM json_each(organizations.state,'$.members') m WHERE json_extract(m.value,'$.userId')=?) LIMIT 50",
      )
      .bind(userId)
      .all();
    return result.results as { id: string; name: string }[];
  }
  async load(id: string) {
    const row = await this.db
      .prepare("SELECT state,revision FROM organizations WHERE id=?")
      .bind(id)
      .first<{ state: string; revision: number }>();
    if (!row) throw new Fault(404, "Organization not found.");
    return { org: JSON.parse(row.state) as Org, revision: row.revision };
  }
  async read(id: string, userId: string) {
    const value = await this.load(id);
    requireRole(value.org, userId, allRoles);
    return value;
  }
  async create(org: Org, actor: string) {
    await audit(org, actor, "organization.created", org.id);
    await this.db
      .prepare("INSERT INTO organizations(id,revision,state) VALUES(?,0,?)")
      .bind(org.id, JSON.stringify(org))
      .run();
  }
  // The entire state transition, audit entry, approval consumption and tool effect
  // commit together. A conflicting writer is retried against the latest state.
  async mutate<T>(
    id: string,
    actor: string,
    event: string,
    subject: string,
    change: (org: Org) => T | Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { org, revision } = await this.load(id);
      if (!(await verifyAudit(org)).valid)
        throw new Fault(
          409,
          "Audit integrity check failed. Export and investigate before making changes.",
        );
      ensureOrgDefaults(org);
      const result = await change(org);
      await audit(org, actor, event, subject);
      const encoded = JSON.stringify(org);
      if (new TextEncoder().encode(encoded).length > 900_000)
        throw new Fault(
          409,
          "Organization storage limit reached. Export this organization and create another lab.",
        );
      const saved = await this.db
        .prepare(
          "UPDATE organizations SET state=?,revision=revision+1 WHERE id=? AND revision=?",
        )
        .bind(encoded, id, revision)
        .run();
      if (saved.meta.changes === 1) return result;
    }
    throw new Fault(409, "Concurrent change detected. Refresh and retry.");
  }
}
