import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LoadTestConfig } from '../../../config/load-test';
import { FakeLlmAdapter } from './fake-llm.adapter';
import { LlmProvider } from '../../../generated/prisma/client';
import { AnthropicAdapter } from './anthropic.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter';
import { OpenAiSdkAdapter } from './openai-sdk.adapter';
import type { LlmProviderAdapter } from './provider-adapter.types';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
// Both aggregators are OpenAI-compatible gateways to 100+ third-party
// models, including ":free"-suffixed free-tier ones — see
// the LlmProvider enum's doc comment in prisma/schema.prisma. Use OpenAiSdkAdapter
// (the real `openai` package) for these, NOT OpenAiCompatibleAdapter
// (`groq-sdk`) — see openai-sdk.adapter.ts's doc comment for why
// `groq-sdk` silently breaks against any host that isn't Groq itself.
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const UNOROUTER_BASE_URL = 'https://api.unorouter.com/v1';

/** One adapter instance per provider, reused across requests — they're stateless (apiKey is passed per-call, not held). */
@Injectable()
export class ProviderRegistry {
  private readonly adapters: Record<LlmProvider, LlmProviderAdapter> = {
    [LlmProvider.groq]: new OpenAiCompatibleAdapter(),
    [LlmProvider.openai]: new OpenAiSdkAdapter(OPENAI_BASE_URL),
    [LlmProvider.anthropic]: new AnthropicAdapter(),
    [LlmProvider.gemini]: new GeminiAdapter(),
    [LlmProvider.openrouter]: new OpenAiSdkAdapter(OPENROUTER_BASE_URL),
    [LlmProvider.unorouter]: new OpenAiSdkAdapter(UNOROUTER_BASE_URL),
  };

  /** Set only in load-test mode (M7-5); stands in for every provider. */
  private readonly fake?: LlmProviderAdapter;

  constructor(@Optional() config?: ConfigService) {
    const loadTest = config?.get<LoadTestConfig>('loadTest');
    if (loadTest?.enabled) {
      this.fake = new FakeLlmAdapter({
        firstTokenMs: loadTest.fakeFirstTokenMs,
        tokenMs: loadTest.fakeTokenMs,
        tokens: loadTest.fakeTokens,
      });
    }
  }

  get(provider: LlmProvider): LlmProviderAdapter {
    return this.fake ?? this.adapters[provider];
  }
}
