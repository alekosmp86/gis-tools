const SINGLETON_KEY = "__gisToolsCargarPadronesLocks";

interface LockHolder {
  [SINGLETON_KEY]?: Set<string>;
}

const heldKeys = (): Set<string> => {
  const holder = globalThis as typeof globalThis & LockHolder;
  holder[SINGLETON_KEY] ??= new Set<string>();
  return holder[SINGLETON_KEY];
};

export function acquireLock(key: string): (() => void) | null {
  const keys = heldKeys();
  if (keys.has(key)) return null;
  keys.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    keys.delete(key);
  };
}
