-- "Verify installation" (FR-3.5, M4-14): when and where the widget page was
-- first loaded inside one of the chatbot's allowed sites.
ALTER TABLE "chatbots" ADD COLUMN     "install_verified_at" TIMESTAMPTZ,
ADD COLUMN     "install_verified_host" VARCHAR(260);
