import { describe, expect, test } from 'bun:test';
import {
  computeApiUrl,
  detectApiBaseFromLocation,
  normalizeApiBase,
} from '../src/utils/connection';
import { resolvePluginAssetURL } from '../src/features/plugins/pluginResources';

describe('v8-only management connections', () => {
  test.each([
    ['localhost:8317', 'http://localhost:8317'],
    ['127.0.0.1:8317', 'http://127.0.0.1:8317'],
    ['127.2.3.4:8317', 'http://127.2.3.4:8317'],
    ['[::1]:8317', 'http://[::1]:8317'],
    ['http://[0:0:0:0:0:0:0:1]:8317', 'http://[0:0:0:0:0:0:0:1]:8317'],
    ['proxy.example:8317/gateway', 'https://proxy.example:8317/gateway'],
    ['http://proxy.example:8317/gateway', 'https://proxy.example:8317/gateway'],
    ['http://192.168.1.2:8317', 'https://192.168.1.2:8317'],
    ['http://[2001:db8::1]:8317', 'https://[2001:db8::1]:8317'],
    ['http://localhost.evil.invalid', 'https://localhost.evil.invalid'],
    ['http://127.0.0.1.evil.invalid', 'https://127.0.0.1.evil.invalid'],
    ['http://localhost@proxy.example', 'https://localhost@proxy.example'],
    ['https://localhost:8317', 'https://localhost:8317'],
    [' https://proxy.example/ ', 'https://proxy.example'],
    ['https://proxy.example/v8/management/', 'https://proxy.example'],
    ['https://proxy.example/gateway/v8/management///', 'https://proxy.example/gateway'],
  ])('normalizes %s without changing the deployment prefix', (input, expected) => {
    expect(normalizeApiBase(input)).toBe(expected);
    expect(computeApiUrl(input)).toBe(`${expected}/v8/management`);
  });

  test('does not create a URL for empty input', () => {
    expect(computeApiUrl('  ')).toBe('');
  });

  test.each([
    ['http://proxy.example:8317', 'https://proxy.example:8317'],
    ['http://127.0.0.1:8317', 'http://127.0.0.1:8317'],
    ['http://[::1]:8317', 'http://[::1]:8317'],
  ])('detects a safe login address from %s', (location, expected) => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    try {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { location: new URL(location) },
      });
      expect(detectApiBaseFromLocation()).toBe(expected);
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });

  test('does not silently adapt a legacy management URL', () => {
    expect(normalizeApiBase('https://proxy.example/v0/management')).toBe(
      'https://proxy.example/v0/management'
    );
  });

  test('preserves backend-declared plugin resource and custom extension paths', () => {
    for (const path of ['/v0/resource/plugins/example/index.html', '/v0/management/example']) {
      expect(resolvePluginAssetURL(path, 'https://proxy.example/v8/management')).toBe(
        `https://proxy.example${path}`
      );
    }
  });
});
