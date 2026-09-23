// Helper condiviso per le API routes dell'asta.

import { getDb, getDbType } from './db-factory';
import { getDataset } from './agent-tools';
import { replayEffective, loadManagerNames } from './events';

export type AuctionState = Awaited<ReturnType<typeof replayEffective>>;

export async function getAuctionState() {
  const db = await getDb();
  const ds = getDataset();
  const managerNames = await loadManagerNames(db);
  const snap = await replayEffective(db, ds, managerNames);
  return snap;
}

export function getDatasetSync() {
  return getDataset();
}

export { getDb, getDbType };
