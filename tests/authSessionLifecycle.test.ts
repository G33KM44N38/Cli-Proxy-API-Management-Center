import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { configApi } from '@/services/api/config';
import { obfuscatedStorage } from '@/services/storage/secureStorage';
import { useAuthStore } from '@/stores/useAuthStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import type { Config } from '@/types';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const memory = new Map<string, string>();
const credentials = {
  apiBase: 'https://first.invalid/gateway',
  managementKey: 'fixture-first-only',
  rememberPassword: true,
};
const legacyKeys = ['apiBase', 'apiUrl', 'managementKey'];
let transport: ReturnType<typeof spyOn<typeof configApi, 'getConfig'>>;

function deferred() {
  let resolve!: (value: Config) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Config>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function readClientCredentials() {
  return apiClient.get('/fixture-only', {
    adapter: async (config) => ({
      data: { base: config.baseURL, authorization: config.headers.Authorization ?? null },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }),
  });
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: new URL('https://ui.invalid'), dispatchEvent: () => true },
  });
  useAuthStore.getState().logout();
  memory.clear();
  useAuthStore.setState({ rememberPassword: false });
  transport = spyOn(configApi, 'getConfig').mockResolvedValue({ debug: true });
});

afterEach(() => {
  transport.mockRestore();
  useAuthStore.getState().logout();
  memory.clear();
});

afterAll(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

describe('authentication session lifecycle with real stores and storage', () => {
  for (const obfuscated of [false, true]) {
    test(`migrates legacy credentials once, then logout cannot restore them (${obfuscated})`, async () => {
      for (const key of ['apiBase', 'apiUrl']) {
        obfuscatedStorage.setItem(key, credentials.apiBase, { obfuscate: obfuscated });
      }
      obfuscatedStorage.setItem('managementKey', credentials.managementKey, {
        obfuscate: obfuscated,
      });
      localStorage.setItem('isLoggedIn', 'true');

      expect(await useAuthStore.getState().restoreSession()).toBe(true);
      expect(useAuthStore.getState().managementKey).toBe('fixture-first-only');
      for (const key of legacyKeys) expect(localStorage.getItem(key)).toBe(null);

      useAuthStore.getState().logout();
      await useAuthStore.persist.rehydrate();
      expect(await useAuthStore.getState().restoreSession()).toBe(false);
      expect(useAuthStore.getState()).toMatchObject({
        isAuthenticated: false,
        managementKey: '',
        rememberPassword: false,
        connectionStatus: 'disconnected',
      });
      expect(await readClientCredentials()).toEqual({
        base: 'https://ui.invalid/v8/management',
        authorization: null,
      });
    });
  }

  test('logout removes legacy credentials even before migration', async () => {
    for (const key of legacyKeys) localStorage.setItem(key, 'fixture-legacy-only');
    useAuthStore.getState().logout();
    for (const key of legacyKeys) expect(localStorage.getItem(key)).toBe(null);
    expect(await readClientCredentials()).toEqual({ base: '', authorization: null });
  });

  test('remember=false never persists the key or revives stale legacy credentials', async () => {
    await useAuthStore.getState().login({ ...credentials, rememberPassword: false });
    expect(useAuthStore.getState().managementKey).toBe('fixture-first-only');
    const saved = obfuscatedStorage.getItem<{ state: Record<string, unknown> }>(STORAGE_KEY_AUTH);
    expect(saved?.state).toMatchObject({
      apiBase: 'https://first.invalid/gateway',
      rememberPassword: false,
    });
    expect(saved?.state).not.toHaveProperty('managementKey');
    expect(localStorage.getItem('isLoggedIn')).toBe(null);
    obfuscatedStorage.setItem('managementKey', 'fixture-stale-only');
    await useAuthStore.persist.rehydrate();
    // Simulate a fresh page, where the non-persisted in-memory key no longer exists.
    useAuthStore.setState({ managementKey: '', isAuthenticated: false });
    expect(await useAuthStore.getState().restoreSession()).toBe(false);
    expect(useAuthStore.getState()).toMatchObject({ managementKey: '', rememberPassword: false });
    expect(localStorage.getItem('managementKey')).toBe(null);
  });

  for (const fails of [false, true]) {
    test(`a deferred login cannot change logout state (${fails ? 'failure' : 'success'})`, async () => {
      const response = deferred();
      transport.mockReturnValueOnce(response.promise);
      const pending = useAuthStore.getState().login(credentials).catch((error: unknown) => error);
      useAuthStore.getState().logout();
      if (fails) response.reject(new Error('fixture failure'));
      else response.resolve({ debug: true });
      await pending;
      expect(useAuthStore.getState()).toMatchObject({
        isAuthenticated: false,
        managementKey: '',
        rememberPassword: false,
        connectionStatus: 'disconnected',
      });
      expect(useConfigStore.getState().config).toBe(null);
      expect(localStorage.getItem('isLoggedIn')).toBe(null);
      expect(await readClientCredentials()).toEqual({ base: '', authorization: null });
    });

    test(`the newest login wins over an older ${fails ? 'failure' : 'success'}`, async () => {
      const first = deferred();
      transport.mockReturnValueOnce(first.promise);
      const oldLogin = useAuthStore.getState().login(credentials).catch((error: unknown) => error);
      await useAuthStore.getState().login({
        apiBase: 'https://second.invalid',
        managementKey: 'fixture-second-only',
        rememberPassword: false,
      });
      if (fails) first.reject(new Error('fixture older failure'));
      else first.resolve({ debug: false });
      await oldLogin;
      expect(useAuthStore.getState()).toMatchObject({
        isAuthenticated: true,
        apiBase: 'https://second.invalid',
        managementKey: 'fixture-second-only',
        rememberPassword: false,
        connectionStatus: 'connected',
      });
      expect(useConfigStore.getState().config?.debug).toBe(true);
      expect(await readClientCredentials()).toEqual({
        base: 'https://second.invalid/v8/management',
        authorization: 'Bearer fixture-second-only',
      });
    });
  }

  test('failed current login clears credentials from the API client', async () => {
    transport.mockRejectedValueOnce(new Error('fixture failed login'));
    await expect(useAuthStore.getState().login(credentials)).rejects.toThrow('fixture failed login');
    expect(useAuthStore.getState().connectionStatus).toBe('error');
    expect(await readClientCredentials()).toEqual({ base: '', authorization: null });
  });
});
