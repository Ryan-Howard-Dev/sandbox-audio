import { beforeEach, vi } from 'vitest';

function createMockStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

const local = createMockStorage();
const session = createMockStorage();

vi.stubGlobal('localStorage', local);
vi.stubGlobal('sessionStorage', session);

beforeEach(() => {
  local.clear();
  session.clear();
});
