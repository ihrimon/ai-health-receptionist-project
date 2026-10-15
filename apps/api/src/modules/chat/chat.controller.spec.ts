import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { LlmKeyManager } from '../llm/llm-key-manager';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: { sendMessage: jest.Mock };
  let llmKeyManager: { getCurrentCredential: jest.Mock };

  beforeEach(async () => {
    chatService = { sendMessage: jest.fn() };
    llmKeyManager = { getCurrentCredential: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: chatService },
        { provide: LlmKeyManager, useValue: llmKeyManager },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  it('delegates to ChatService.sendMessage and returns its result', async () => {
    const dto = { message: 'Hi, I want to book a service' };
    const expected = {
      sessionId: 'abc-123',
      reply: 'Hi! What can I help you book today?',
      bookingCreated: false,
    };
    chatService.sendMessage.mockResolvedValue(expected);

    const result = await controller.sendMessage(dto);

    expect(chatService.sendMessage).toHaveBeenCalledWith(dto);
    expect(result).toBe(expected);
  });

  describe('activeCredential', () => {
    it("returns the current rotation credential's id", async () => {
      llmKeyManager.getCurrentCredential.mockResolvedValue({
        id: 'cred-1',
        provider: 'groq',
        apiKey: 'gsk_x',
        model: 'openai/gpt-oss-20b',
      });

      const result = await controller.activeCredential();

      expect(result).toEqual({ id: 'cred-1' });
    });

    it('returns a null id when no credential is configured', async () => {
      llmKeyManager.getCurrentCredential.mockResolvedValue(undefined);

      const result = await controller.activeCredential();

      expect(result).toEqual({ id: null });
    });
  });
});
