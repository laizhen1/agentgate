import { env } from 'cloudflare:workers';
import type { Agent, Run } from './security';
export function database(): D1Database {
  const db=(env as unknown as {DB?:D1Database}).DB;
  if(!db) throw new Error('Database binding unavailable');
  return db;
}
export function decodeAgent(row: Record<string,unknown>): Agent {
  return {id:String(row.id),name:String(row.name),version:String(row.version),description:String(row.description),policy:JSON.parse(String(row.policy)),createdAt:String(row.created_at)};
}
export async function getState(ownerId:string) {
  const db=database();
  const [agents,runs]=await Promise.all([db.prepare('SELECT * FROM agents WHERE owner_id=? ORDER BY created_at DESC LIMIT 100').bind(ownerId).all(),db.prepare('SELECT report FROM runs WHERE owner_id=? ORDER BY created_at DESC LIMIT 50').bind(ownerId).all()]);
  return {agents:agents.results.map(decodeAgent),runs:runs.results.map(r=>JSON.parse(String(r.report)) as Run)};
}
