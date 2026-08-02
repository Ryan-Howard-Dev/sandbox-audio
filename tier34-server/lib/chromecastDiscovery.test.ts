import { describe, expect, it } from 'vitest';
import type { Service } from 'bonjour-service';
import {
  CHROMECAST_DEFAULT_PORT,
  chromecastName,
  preferredAddress,
  serviceToDevice,
} from './chromecastDiscovery';

/** A minimal mDNS answer. Only the fields discovery actually reads are worth constructing. */
function answer(overrides: Partial<Service> = {}): Service {
  return {
    name: 'uuid-1234',
    addresses: ['192.168.1.50'],
    port: CHROMECAST_DEFAULT_PORT,
    txt: { fn: 'Kitchen speaker', md: 'Chromecast Audio' },
    ...overrides,
  } as Service;
}

describe('chromecastName', () => {
  it('prefers the name the owner gave the device', () => {
    expect(chromecastName({ fn: 'Kitchen speaker', md: 'Chromecast Audio' }, 'uuid')).toBe(
      'Kitchen speaker',
    );
  });

  it('falls back to the model, then to the service name', () => {
    expect(chromecastName({ md: 'Chromecast Audio' }, 'uuid')).toBe('Chromecast Audio');
    expect(chromecastName({}, 'uuid')).toBe('uuid');
    expect(chromecastName(undefined, 'uuid')).toBe('uuid');
  });

  it('reads TXT keys whatever their case, which is convention not guarantee', () => {
    expect(chromecastName({ FN: 'Lounge TV' }, 'uuid')).toBe('Lounge TV');
  });

  it('ignores a key that is present but blank', () => {
    expect(chromecastName({ fn: '   ', md: 'Nest Mini' }, 'uuid')).toBe('Nest Mini');
  });
});

describe('preferredAddress', () => {
  it('takes IPv4 over IPv6, which needs a scope id to dial', () => {
    expect(preferredAddress({ addresses: ['fe80::1', '192.168.1.50'] })).toBe('192.168.1.50');
  });

  it('falls back to the responding address when none was advertised', () => {
    expect(preferredAddress({ addresses: [], referer: { address: '10.0.0.4' } })).toBe('10.0.0.4');
  });

  it('returns null when there is nothing to dial', () => {
    expect(preferredAddress({ addresses: [] })).toBeNull();
  });
});

describe('serviceToDevice', () => {
  it('reads the advertised port, so speaker groups on a high port still work', () => {
    // A Google Home group picks a high port and changes it. Assuming 8009 casts fine to a single
    // speaker and fails silently to every group in the house.
    const found = serviceToDevice(answer({ port: 32065 }));
    expect(found?.port).toBe(32065);
    expect(found?.host).toBe('192.168.1.50');
  });

  it('falls back to 8009 only when the answer carries no usable port', () => {
    expect(serviceToDevice(answer({ port: 0 }))?.port).toBe(CHROMECAST_DEFAULT_PORT);
    expect(serviceToDevice(answer({ port: undefined as unknown as number }))?.port).toBe(
      CHROMECAST_DEFAULT_PORT,
    );
  });

  it('keys off the mDNS instance name, which survives a rename', () => {
    expect(serviceToDevice(answer())?.device.id).toBe('chromecast:uuid-1234');
  });

  it('drops a device with no address rather than offering one that cannot be dialled', () => {
    expect(serviceToDevice(answer({ addresses: [], referer: undefined }))).toBeNull();
  });

  it('produces the device shape the cast routes already use', () => {
    expect(serviceToDevice(answer())?.device).toEqual({
      id: 'chromecast:uuid-1234',
      name: 'Kitchen speaker',
      ip: '192.168.1.50',
      type: 'chromecast',
    });
  });
});
