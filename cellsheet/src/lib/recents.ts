const KEY = 'cellsheet:recents';
const MAX = 8;

export interface Recent {
  url: string;
  loadedAt: number;
}

export function getRecents(): Recent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Recent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addRecent(url: string): void {
  const existing = getRecents().filter((r) => r.url !== url);
  const next = [{ url, loadedAt: Date.now() }, ...existing].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private-mode errors
  }
}
