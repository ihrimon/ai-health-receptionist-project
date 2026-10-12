/**
 * Draft config a new workspace's chatbot starts with — the defaults in
 * docs/design/d4-chatbot-config.md §4. A plain object for now; M2-2 moves
 * the ChatbotConfig type and its validation schema to packages/shared.
 */
export function defaultChatbotConfig(companyName: string) {
  return {
    schemaVersion: 1,
    identity: {
      botName: 'Assistant',
      avatarUrl: null,
      welcomeMessage: 'Hi! 👋 How can I help you today?',
    },
    business: {
      name: companyName,
      description: '',
      websiteUrl: null,
      currency: 'USD',
      contact: {
        email: null,
        phone: null,
        whatsapp: null,
        address: null,
        hours: null,
      },
    },
    behavior: {
      tone: 'friendly',
      customToneNote: null,
      instructions: '',
      allowedTopics: [],
      avoidedTopics: [],
      questionsToAsk: [],
      fallbackMessage:
        "I'm not sure about that. Please contact our team and we'll help you out.",
      handoff: { type: 'none', value: null, label: null },
    },
    widget: {
      primaryColor: '#0F766E',
      position: 'right',
      launcherIcon: 'chat',
      launcherIconUrl: null,
      headerTitle: 'Assistant',
      quickReplies: ['What do you sell?', 'Delivery options', 'Return policy'],
      showBranding: true,
    },
  };
}
