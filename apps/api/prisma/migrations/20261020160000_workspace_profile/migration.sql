-- What a company can say about itself in Settings -> Workspace (M7-42). All
-- optional, except the time zone, which starts as UTC like every date today.
ALTER TABLE "workspaces"
  ADD COLUMN "website" VARCHAR(200),
  ADD COLUMN "industry" VARCHAR(80),
  ADD COLUMN "contact_email" VARCHAR(255),
  ADD COLUMN "contact_phone" VARCHAR(30),
  ADD COLUMN "time_zone" VARCHAR(64) NOT NULL DEFAULT 'UTC';
