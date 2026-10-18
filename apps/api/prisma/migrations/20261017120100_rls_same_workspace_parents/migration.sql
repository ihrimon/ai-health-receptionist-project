-- M7-1 (second half): a row may only point at a parent (chatbot, conversation,
-- FAQ, knowledge source) of its own workspace. The foreign keys can't say so
-- (no composite keys, lead's call 2026-10-13), and foreign-key checks
-- themselves skip row security, so the policies check it in WITH CHECK:
-- inside the policy the parent is looked up through ITS policy, which only
-- shows the current workspace's rows, so another workspace's parent isn't
-- found. The bypass skips the check, as it skips every policy.
--
-- chatbots.published_version_id is left out on purpose: chatbots and
-- chatbot_versions would then refer to each other's policies.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT t, string_agg(
             format(
               ' AND (%1$I IS NULL OR EXISTS (SELECT 1 FROM %2$I p WHERE p.id = %1$I AND p.workspace_id = %3$I.workspace_id))',
               c, parent, t),
             '' ORDER BY c) AS extra
    FROM (VALUES
      ('chatbot_versions',  'chatbot_id',      'chatbots'),
      ('faqs',              'chatbot_id',      'chatbots'),
      ('custom_answers',    'chatbot_id',      'chatbots'),
      ('knowledge_sources', 'chatbot_id',      'chatbots'),
      ('products',          'chatbot_id',      'chatbots'),
      ('conversations',     'chatbot_id',      'chatbots'),
      ('leads',             'chatbot_id',      'chatbots'),
      ('leads',             'conversation_id', 'conversations'),
      ('messages',          'conversation_id', 'conversations'),
      ('knowledge_chunks',  'chatbot_id',      'chatbots'),
      ('knowledge_chunks',  'faq_id',          'faqs'),
      ('knowledge_chunks',  'source_id',       'knowledge_sources')
    ) AS v(t, c, parent)
    GROUP BY t
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', r.t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %1$I
         USING ((SELECT app_rls_bypass()) OR workspace_id = (SELECT app_workspace_id()))
         WITH CHECK ((SELECT app_rls_bypass()) OR (workspace_id = (SELECT app_workspace_id())%2$s))',
      r.t, r.extra);
  END LOOP;
END $$;
