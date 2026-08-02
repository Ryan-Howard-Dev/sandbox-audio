import { describe, expect, it } from 'vitest';
import {
  groupByLicence,
  NATIVE_COMPONENTS,
  undeclaredPackages,
  unresolvedComponents,
  type AttributedPackage,
} from './attributions';

const pkg = (name: string, license: string): AttributedPackage => ({
  name,
  version: '1.0.0',
  license,
});

describe('groupByLicence', () => {
  it('puts the commonest licence first, so the shape of the answer is visible', () => {
    const groups = groupByLicence([
      pkg('a', 'MIT'),
      pkg('b', 'Apache-2.0'),
      pkg('c', 'MIT'),
      pkg('d', 'MIT'),
    ]);
    expect(groups.map((g) => g.license)).toEqual(['MIT', 'Apache-2.0']);
    expect(groups[0].packages).toHaveLength(3);
  });

  it('sorts alphabetically inside a group, so a name can be found', () => {
    const groups = groupByLicence([pkg('zebra', 'MIT'), pkg('alpha', 'MIT')]);
    expect(groups[0].packages.map((p) => p.name)).toEqual(['alpha', 'zebra']);
  });

  it('breaks a tie by licence name rather than leaving the order to chance', () => {
    const groups = groupByLicence([pkg('a', 'MIT'), pkg('b', 'ISC')]);
    expect(groups.map((g) => g.license)).toEqual(['ISC', 'MIT']);
  });

  it('treats a missing licence as UNKNOWN rather than dropping the package', () => {
    const groups = groupByLicence([pkg('a', '')]);
    expect(groups[0].license).toBe('UNKNOWN');
  });
});

describe('undeclaredPackages', () => {
  it('finds packages that declare nothing, which is its own problem', () => {
    const found = undeclaredPackages([pkg('a', 'MIT'), pkg('b', 'UNKNOWN'), pkg('c', '')]);
    expect(found.map((p) => p.name)).toEqual(['b', 'c']);
  });
});

describe('the native component list', () => {
  it('surfaces the entries whose licence is not actually settled', () => {
    const unresolved = unresolvedComponents();
    // The voice is the one that matters: its model card names no licence at all.
    expect(unresolved.map((c) => c.name)).toContain('Piper voice: en_GB-alan-medium');
    expect(unresolved.length).toBeGreaterThan(0);
  });

  it('explains every unverified entry rather than just flagging it', () => {
    for (const component of unresolvedComponents()) {
      expect(component.note, `${component.name} is unverified with no explanation`).toBeTruthy();
    }
  });

  it('records the Cast SDK as proprietary and confined to the Play build', () => {
    const cast = NATIVE_COMPONENTS.find((c) => c.name === 'Google Cast SDK');
    expect(cast?.license).toBe('Proprietary');
    expect(cast?.flavour).toBe('gplay');
  });

  it('gives every component somewhere to go and read the licence', () => {
    for (const component of NATIVE_COMPONENTS) {
      expect(component.url, `${component.name} has no URL`).toMatch(/^https?:\/\//);
      expect(component.role, `${component.name} has no role`).toBeTruthy();
    }
  });

  it('names the copyleft components, which are the ones with obligations attached', () => {
    const copyleft = NATIVE_COMPONENTS.filter((c) => /GPL/.test(c.license)).map((c) => c.name);
    expect(copyleft).toContain('espeak-ng');
    expect(copyleft).toContain('youtubedl-android');
  });
});
