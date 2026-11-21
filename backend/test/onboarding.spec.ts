import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { dietLine } from '../src/agent/prompts';
import { applyDietStyle } from '../src/plan/plan.service';
import { ageOf, validateProfilePatch } from '../src/profile/profile.service';

describe('onboarding profile fields', () => {
  it('birthDate validates, sets birthYear, and gives an exact age', () => {
    const p = validateProfilePatch({ birthDate: '1979-01-01' } as any);
    expect(p).toMatchObject({ birthDate: '1979-01-01', birthYear: 1979 });
    expect(() => validateProfilePatch({ birthDate: '2999-01-01' } as any)).toThrow();
    expect(() => validateProfilePatch({ birthDate: '01/01/1979' } as any)).toThrow();
    const today = new Date('2026-11-21T12:00:00');
    expect(ageOf({ birthYear: 1979, birthDate: '1979-12-01' }, today)).toBe(46); // birthday not reached yet
    expect(ageOf({ birthYear: 1979, birthDate: '1979-01-01' }, today)).toBe(47);
    expect(ageOf({ birthYear: 1979, birthDate: null }, today)).toBe(47);
  });

  it('diet style, conditions and meals per day are validated', () => {
    expect(validateProfilePatch({ dietStyle: 'keto', conditions: ['diabetes', 'diabetes'], mealsPerDay: 3 } as any))
      .toMatchObject({ dietStyle: 'keto', conditions: ['diabetes'], mealsPerDay: 3 });
    expect(() => validateProfilePatch({ dietStyle: 'carnivore' } as any)).toThrow();
    expect(() => validateProfilePatch({ conditions: ['flu'] } as any)).toThrow();
    expect(() => validateProfilePatch({ mealsPerDay: 9 } as any)).toThrow();
  });

  it('keto / low-carb move energy from carbs to fat, keeping calories and protein', () => {
    const base = () => ({ targetKcal: 1800, proteinG: 130, carbsG: 190, fatG: 56 }) as any;
    const keto = base(); applyDietStyle(keto, 'keto');
    expect(keto.carbsG).toBe(30);
    expect(Math.abs(keto.proteinG * 4 + keto.carbsG * 4 + keto.fatG * 9 - 1800)).toBeLessThan(10);
    const low = base(); applyDietStyle(low, 'low_carb');
    expect(low.carbsG).toBe(113);
    const normal = base(); applyDietStyle(normal, 'vegan');
    expect(normal).toEqual(base());
  });

  it('the AI is told about eating style and conditions', () => {
    expect(dietLine('normal', [])).toBe('');
    const l = dietLine('vegan', ['hypertension', 'kidney']);
    expect(l).toContain('vegan');
    expect(l).toContain('sodium');
    expect(l).toContain('clinician');
  });
});
