-- Where the time of each answer went (AnswerTimings, M7-40). Nullable: messages
-- saved before this have none, and visitor messages never get one.
ALTER TABLE "messages" ADD COLUMN "timings" JSONB;
