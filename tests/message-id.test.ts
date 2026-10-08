import { describe, expect, it, vi } from 'vitest';
import { createClientMessageId } from '../src/client/message-id';

describe('createClientMessageId', () => {
  it('uses the native UUID implementation when available', () => {
    const randomUUID = vi.fn(() => 'native-uuid');
    const cryptoApi = {
      randomUUID,
      getRandomValues: vi.fn(),
    } as unknown as Crypto;

    expect(createClientMessageId(cryptoApi)).toBe('native-uuid');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('creates a version 4 UUID when randomUUID is unavailable', () => {
    const cryptoApi = {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0),
    } as unknown as Crypto;

    expect(createClientMessageId(cryptoApi)).toBe(
      '00000000-0000-4000-8000-000000000000',
    );
  });
});
