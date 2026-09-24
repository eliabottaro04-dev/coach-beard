// Shared dataset loader - prefers public/ (Vercel) then data/ (local dev)
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Get the path to dataset.json, preferring public/ for Vercel deployment
 */
export function getDatasetPath(): string {
  const publicPath = join(process.cwd(), 'public', 'dataset.json');
  if (existsSync(publicPath)) {
    return publicPath;
  }
  return join(process.cwd(), 'data', 'dataset.json');
}

/**
 * Get the path to abbinamenti.json, preferring public/ (Vercel) then data/ (local dev)
 */
export function getAbbinamentiPath(): string {
  const publicPath = join(process.cwd(), 'public', 'abbinamenti.json');
  if (existsSync(publicPath)) {
    return publicPath;
  }
  return join(process.cwd(), 'data', 'abbinamenti.json');
}

/**
 * Load dataset.json from the resolved path
 */
export function loadDataset() {
  const path = getDatasetPath();
  if (!existsSync(path)) {
    throw new Error('dataset.json non trovato. Esegui npm run build:dataset.');
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Load abbinamenti.json from the resolved path
 */
export function loadAbbinamenti() {
  const path = getAbbinamentiPath();
  if (!existsSync(path)) {
    throw new Error('abbinamenti.json non trovato. Esegui npm run build:abbinamenti.');
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}