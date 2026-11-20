import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { isIsoDate, localDate } from '../common/dates';
import { Workout } from '../common/types';
import { ProfileService } from '../profile/profile.service';
import { REPOSITORY, Repository } from '../storage/repository';

export type SportKind = 'run' | 'walk' | 'bike' | 'strength' | 'swim' | 'hiit' | 'mind' | 'racket' | 'team' | 'combat' | 'other';

/** Normalised key: lower-case letters/digits only ("Functional Fitness" → "functionalfitness"). */
const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** WHOOP sport_name values and HealthKit HKWorkoutActivityType names → Arabic label + icon family. */
const SPORTS: Record<string, [string, SportKind]> = {
  running: ['جري', 'run'], run: ['جري', 'run'], trackandfield: ['ألعاب قوى', 'run'], treadmill: ['جري على السير', 'run'],
  walking: ['مشي', 'walk'], walk: ['مشي', 'walk'], hiking: ['هايكنج', 'walk'], hikingrucking: ['هايكنج', 'walk'], stairs: ['صعود الدرج', 'walk'], stairclimbing: ['صعود الدرج', 'walk'], stairmaster: ['ستيرماستر', 'walk'],
  cycling: ['دراجة', 'bike'], spin: ['سبين', 'bike'], spinning: ['سبين', 'bike'], mountainbiking: ['دراجة جبلية', 'bike'], handcycling: ['دراجة يدوية', 'bike'],
  weightlifting: ['رفع أثقال', 'strength'], powerlifting: ['باورليفتنج', 'strength'], traditionalstrengthtraining: ['تمارين قوة', 'strength'], functionalstrengthtraining: ['قوة وظيفية', 'strength'],
  functionalfitness: ['لياقة وظيفية', 'strength'], crossfit: ['كروس فت', 'strength'], strengthtrainer: ['تمارين قوة', 'strength'], coretraining: ['تمارين البطن', 'strength'], calisthenics: ['تمارين وزن الجسم', 'strength'],
  swimming: ['سباحة', 'swim'], swim: ['سباحة', 'swim'], waterpolo: ['كرة ماء', 'swim'], rowing: ['تجديف', 'swim'], paddleboarding: ['تجديف واقف', 'swim'], surfing: ['ركوب الأمواج', 'swim'], surfingsports: ['ركوب الأمواج', 'swim'],
  hiit: ['تمارين عالية الشدة HIIT', 'hiit'], highintensityintervaltraining: ['تمارين عالية الشدة HIIT', 'hiit'], mixedcardio: ['كارديو', 'hiit'], elliptical: ['جهاز الإليبتكال', 'hiit'], jumprope: ['نط الحبل', 'hiit'], dance: ['رقص', 'hiit'], cardiodance: ['رقص كارديو', 'hiit'], f45training: ['F45', 'hiit'], barry: ['باريز', 'hiit'], boxfitness: ['بوكس فتنس', 'hiit'], kickboxing: ['كيك بوكسينج', 'combat'],
  yoga: ['يوغا', 'mind'], pilates: ['بيلاتس', 'mind'], meditation: ['تأمل', 'mind'], stretching: ['إطالة', 'mind'], flexibility: ['إطالة', 'mind'], mindandbody: ['تمارين ذهن وجسم', 'mind'], cooldown: ['تهدئة', 'mind'], taichi: ['تاي تشي', 'mind'],
  tennis: ['تنس', 'racket'], padel: ['بادل', 'racket'], paddletennis: ['بادل', 'racket'], squash: ['سكواش', 'racket'], badminton: ['ريشة', 'racket'], tabletennis: ['تنس طاولة', 'racket'], pickleball: ['بيكلبول', 'racket'], golf: ['جولف', 'racket'],
  soccer: ['كرة قدم', 'team'], football: ['كرة قدم', 'team'], basketball: ['كرة سلة', 'team'], volleyball: ['كرة طائرة', 'team'], handball: ['كرة يد', 'team'], cricket: ['كريكت', 'team'], rugby: ['رجبي', 'team'], hockey: ['هوكي', 'team'], baseball: ['بيسبول', 'team'], softball: ['سوفتبول', 'team'],
  boxing: ['ملاكمة', 'combat'], martialarts: ['فنون قتالية', 'combat'], jiujitsu: ['جوجيتسو', 'combat'], wrestling: ['مصارعة', 'combat'], mma: ['فنون قتالية مختلطة', 'combat'], muaythai: ['مواي تاي', 'combat'],
  horsebackriding: ['ركوب الخيل', 'other'], equestriansports: ['ركوب الخيل', 'other'], climbing: ['تسلق', 'strength'], rockclimbing: ['تسلق', 'strength'], skiing: ['تزلج', 'other'], snowboarding: ['تزلج على الجليد', 'other'],
  activity: ['نشاط', 'other'], other: ['نشاط آخر', 'other'], sauna: ['ساونا', 'mind'], icebath: ['حمام ثلج', 'mind'],
};

export function sportInfo(sport: string): { ar: string; kind: SportKind } {
  const hit = SPORTS[norm(sport)];
  if (hit) return { ar: hit[0], kind: hit[1] };
  // unknown: humanise the raw name ("functional-fitness" → "functional fitness")
  return { ar: String(sport ?? 'نشاط').replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'), kind: 'other' };
}

export interface WorkoutInput {
  externalId: string;
  sport: string;
  start: string;
  end: string;
  kcal?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  distanceM?: number | null;
}

const PRIORITY: Workout['source'][] = ['whoop', 'apple_health', 'health_connect', 'manual'];

/**
 * The same session is often recorded by two devices. When two workouts from different sources
 * overlap by more than half of the shorter one, keep only one (preferred source first).
 */
export function dedupeWorkouts(list: Workout[], preferred: string | null): Workout[] {
  const order = preferred && PRIORITY.includes(preferred as any) ? [preferred, ...PRIORITY.filter((p) => p !== preferred)] : PRIORITY;
  const rank = (w: Workout) => order.indexOf(w.source);
  const sorted = [...list].sort((a, b) => rank(a) - rank(b));
  const kept: Workout[] = [];
  for (const w of sorted) {
    const s = Date.parse(w.start), e = Date.parse(w.end);
    const dup = kept.some((k) => {
      if (k.source === w.source) return false;
      const ov = Math.min(e, Date.parse(k.end)) - Math.max(s, Date.parse(k.start));
      return ov > 0.5 * Math.min(e - s, Date.parse(k.end) - Date.parse(k.start));
    });
    if (!dup) kept.push(w);
  }
  return kept.sort((a, b) => a.start.localeCompare(b.start));
}

@Injectable()
export class WorkoutsService {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly profiles: ProfileService,
  ) {}

  /** Apple Health (iOS app), Health Connect, or manual entries. */
  async ingest(userId: string, source: Workout['source'], items: WorkoutInput[]) {
    if (!['apple_health', 'health_connect', 'manual'].includes(source)) throw new BadRequestException('invalid source');
    if (!Array.isArray(items) || !items.length) throw new BadRequestException('workouts[] required');
    if (items.length > 200) throw new BadRequestException('max 200 workouts per request');
    const tz = (await this.profiles.get(userId)).timezone;
    let saved = 0;
    for (const i of items) {
      const s = new Date(i.start), e = new Date(i.end);
      if (!i.externalId || !i.sport || Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) {
        throw new BadRequestException('each workout needs externalId, sport, start < end');
      }
      const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));
      await this.repo.upsertWorkout({
        userId,
        id: `${source}:${String(i.externalId).slice(0, 80)}`,
        source,
        sport: String(i.sport).slice(0, 60),
        start: s.toISOString(),
        end: e.toISOString(),
        date: localDate(s, tz),
        durationMin: Math.round((e.getTime() - s.getTime()) / 6000) / 10,
        kcal: num(i.kcal) == null ? null : Math.round(num(i.kcal)!),
        strain: null,
        avgHr: num(i.avgHr),
        maxHr: num(i.maxHr),
        distanceM: num(i.distanceM),
        zonesMin: null,
        updatedAt: new Date().toISOString(),
      });
      saved++;
    }
    return { saved };
  }

  async forDay(userId: string, date: string) {
    if (!isIsoDate(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    const profile = await this.profiles.get(userId);
    const list = dedupeWorkouts(await this.repo.listWorkouts(userId, date, date), profile.preferredEnergySource);
    const items = list.map((w) => ({ ...w, ...sportInfo(w.sport), sportAr: sportInfo(w.sport).ar }));
    return {
      date,
      workouts: items.map(({ ar, ...w }) => w),
      totalMin: Math.round(items.reduce((a, w) => a + w.durationMin, 0)),
      totalKcal: Math.round(items.reduce((a, w) => a + (w.kcal ?? 0), 0)),
      maxStrain: items.reduce<number | null>((a, w) => (w.strain != null && (a == null || w.strain > a) ? w.strain : a), null),
    };
  }

  async remove(userId: string, id: string) {
    if (!id.startsWith('manual:')) throw new BadRequestException('only manual workouts can be deleted here');
    await this.repo.deleteWorkout(userId, id);
    return { deleted: true };
  }
}
