import { sqliteTable, text, index, integer } from 'drizzle-orm/sqlite-core';
// One compare-and-swap aggregate makes approvals, sandbox effects and audit atomic.
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  state: text('state').notNull(),
});
export const agents = sqliteTable('agents', {id:text('id').primaryKey(),ownerId:text('owner_id').notNull(), name:text('name').notNull(), version:text('version').notNull(), description:text('description').notNull(), policy:text('policy').notNull(), createdAt:text('created_at').notNull()},t=>[index('idx_agents_owner_created').on(t.ownerId,t.createdAt)]);
export const runs = sqliteTable('runs', {id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),agentId:text('agent_id').notNull().references(()=>agents.id),createdAt:text('created_at').notNull(),report:text('report').notNull()},t=>[index('idx_runs_owner_created').on(t.ownerId,t.createdAt)]);
