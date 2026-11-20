import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeEstimate } from '../common/nutrition-math';
import { EMPTY_NUTRIENTS, KnownMeal, NutritionEstimate, SourceRef } from '../common/types';
import { buildSystemPrompt, buildUserText, SUBMIT_TOOL_NAME, SUBMIT_TOOL_SCHEMA } from './prompts';

export const ANTHROPIC_CLIENT = Symbol('ANTHROPIC_CLIENT');

/** Minimal surface of the SDK we use — makes the agent trivially mockable in tests. */
export interface MessagesClient {
  messages: { create(params: any): Promise<any> };
}

export interface AnalyzeInput {
  image: Buffer;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  mealName?: string | null;
  restaurant?: string | null;
  portion?: string | null;
  note?: string | null;
  city?: string | null;
  country?: string | null;
  known: KnownMeal[];
}

export interface AnalyzeResult {
  estimate: NutritionEstimate;
  searchesUsed: number;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

const MAX_TURNS = 8;

@Injectable()
export class NutritionAgentService {
  private readonly log = new Logger(NutritionAgentService.name);
  private readonly model: string;
  private readonly maxSearches: number;
  private readonly defaultCountry: string;
  private readonly defaultCity: string | null;

  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly client: MessagesClient,
    config: ConfigService,
  ) {
    this.model = config.get<string>('CLAUDE_MODEL') ?? 'claude-sonnet-5-5';
    this.maxSearches = Number(config.get('WEB_SEARCH_MAX_USES') ?? 6);
    this.defaultCountry = config.get<string>('DEFAULT_COUNTRY') ?? 'AE';
    this.defaultCity = config.get<string>('DEFAULT_CITY') ?? null;
  }

  async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    const country = input.country ?? this.defaultCountry;
    const city = input.city ?? this.defaultCity;
    const system = buildSystemPrompt({ country, city, today: new Date().toISOString().slice(0, 10) });

    const tools: any[] = [
      {
        type: 'web_search_20260318',
        name: 'web_search',
        max_uses: this.maxSearches,
        user_location: { type: 'approximate', country, ...(city ? { city } : {}) },
      },
      {
        type: 'web_fetch_20260318',
        name: 'web_fetch',
        max_uses: 3,
      },
      {
        name: SUBMIT_TOOL_NAME,
        description:
          'Submit the final nutrition analysis for the photographed meal. Call exactly once, after any research is done.',
        input_schema: SUBMIT_TOOL_SCHEMA,
      },
    ];

    const messages: any[] = [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: input.mediaType, data: input.image.toString('base64') },
          },
          { type: 'text', text: buildUserText(input) },
        ],
      },
    ];

    const found = new Map<string, SourceRef>();
    let searches = 0;
    const usage = { input_tokens: 0, output_tokens: 0 };
    let forceSubmit = false;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const resp = await this.client.messages.create({
        model: this.model,
        max_tokens: 8000,
        system,
        tools,
        messages,
        ...(forceSubmit ? { tool_choice: { type: 'tool', name: SUBMIT_TOOL_NAME } } : {}),
      });
      usage.input_tokens += resp.usage?.input_tokens ?? 0;
      usage.output_tokens += resp.usage?.output_tokens ?? 0;

      for (const block of resp.content ?? []) {
        if (block.type === 'server_tool_use' && block.name === 'web_search') searches++;
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) {
            if (r?.url && !found.has(r.url)) found.set(r.url, { title: r.title ?? r.url, url: r.url });
          }
        }
      }

      const submit = (resp.content ?? []).find(
        (b: any) => b.type === 'tool_use' && b.name === SUBMIT_TOOL_NAME,
      );
      if (submit) {
        const raw = submit.input as NutritionEstimate;
        // Keep only cited URLs the search actually returned (or model-cited official pages if search was skipped).
        const cited = (raw.sources ?? []).filter((s) => found.size === 0 || found.has(s.url));
        // totals are always recomputed from items inside normalizeEstimate
        const estimate = normalizeEstimate({ ...raw, sources: cited, totals: raw.totals ?? { ...EMPTY_NUTRIENTS } });
        if (estimate.source === 'restaurant_published' && estimate.sources.length === 0) {
          estimate.warnings.push('Published source could not be verified — treat as estimate.');
          estimate.confidence = Math.min(estimate.confidence, 0.6);
        }
        return { estimate, searchesUsed: searches, model: this.model, usage };
      }

      if (resp.stop_reason === 'refusal') throw new Error('The model declined to analyse this image.');

      messages.push({ role: 'assistant', content: resp.content });
      if (resp.stop_reason !== 'pause_turn') {
        // Model finished talking without submitting — ask it to submit now.
        messages.push({
          role: 'user',
          content: `Now call ${SUBMIT_TOOL_NAME} with your best result (estimate if research was inconclusive).`,
        });
        forceSubmit = true;
      }
      this.log.debug(`turn ${turn} stop_reason=${resp.stop_reason}`);
    }
    throw new Error('Agent did not produce a result within the turn limit.');
  }
}

export function anthropicFactory(config: ConfigService): MessagesClient {
  return new Anthropic({ apiKey: config.get<string>('ANTHROPIC_API_KEY') }) as unknown as MessagesClient;
}
