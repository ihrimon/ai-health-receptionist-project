# @brainstack/ai

Placeholder package for LLM prompts and conversation logic (Phase 4
implementation target).

`prompts/booking-conversation.md` is the canonical booking conversation
script — written in Phase 1, and reused as-is (read directly off disk at
runtime, not imported as TypeScript) by the chat implementation in
`apps/api/src/modules/chat`. The actual orchestration code (Groq/Claude
client, tool definitions, chat service) lives in `apps/api` for now, not
here — same reasoning as `@brainstack/workflow` and `@brainstack/voice`:
no `@brainstack/*` workspace package has a proven consumer yet, and
`apps/api`'s `tsc` build isn't set up to safely resolve a symlinked
workspace package's `.ts` source (no configured `rootDir`). Extracting into
this package is worth doing once the conversation engine needs to be
shared between `apps/api` and a future standalone voice worker (Phase 2/3
territory) — at that point, move the client wrapper, tool definitions, and
chat orchestration here.

## Knowledge base

The single-tenant demo FAQ (`knowledge/faq.md` and the `knowledge:ingest`
script) was retired in M2 (2026-10-14). Each workspace now adds its own
FAQs, policies and documents in the dashboard; indexing and search live in
`apps/api/src/modules/knowledge/` (local embeddings via
`@xenova/transformers`, pgvector).
