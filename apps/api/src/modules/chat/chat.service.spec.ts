import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsService } from '../conversations/conversations.service';
import { ChatService } from './chat.service';
import {
  AllLlmKeysExhaustedError,
  NoLlmCredentialsConfiguredError,
} from './llm-key-manager';
import { LlmChatClient } from './llm-chat.client';

function assistantMessage(content: string) {
  return { role: 'assistant' as const, content };
}

describe('ChatService', () => {
  let service: ChatService;
  let llmChatClient: { buildMessages: jest.Mock; complete: jest.Mock };
  let conversationsService: {
    findByCallSid: jest.Mock;
    create: jest.Mock;
    appendTurn: jest.Mock;
    rate: jest.Mock;
  };

  beforeEach(async () => {
    llmChatClient = {
      buildMessages: jest.fn().mockReturnValue([]),
      complete: jest.fn(),
    };
    conversationsService = {
      findByCallSid: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'conv-new' }),
      appendTurn: jest.fn(),
      rate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: LlmChatClient, useValue: llmChatClient },
        { provide: ConversationsService, useValue: conversationsService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  it('generates a sessionId and persists the first turn of a fresh conversation', async () => {
    llmChatClient.complete.mockResolvedValue(
      assistantMessage('Hi! How can I help?'),
    );

    const result = await service.sendMessage({ message: 'Hello' });

    expect(result.reply).toBe('Hi! How can I help?');
    expect(result.sessionId).toBeTruthy();
    expect(conversationsService.create).toHaveBeenCalledWith({
      callSid: `chat-${result.sessionId}`,
    });
    expect(conversationsService.appendTurn).toHaveBeenCalledWith('conv-new', {
      transcript: [
        { role: 'user', text: 'Hello' },
        { role: 'model', text: 'Hi! How can I help?' },
      ],
    });
  });

  it('calls the model without tools', async () => {
    llmChatClient.complete.mockResolvedValue(assistantMessage('Hi!'));

    await service.sendMessage({ message: 'Hello' });

    expect(llmChatClient.complete).toHaveBeenCalledWith([]);
  });

  it('replies with a fallback message instead of an empty string when the model returns no text', async () => {
    llmChatClient.complete.mockResolvedValue(assistantMessage(''));

    const result = await service.sendMessage({ message: 'Hello' });

    expect(result.reply.length).toBeGreaterThan(0);
  });

  it('uses the caller-supplied transcript as history for a session the server has not seen', async () => {
    llmChatClient.complete.mockResolvedValue(assistantMessage('Got it.'));

    await service.sendMessage({
      sessionId: 'session-1',
      message: 'Do you deliver?',
      transcript: [{ role: 'user', text: 'Hi' }],
    });

    expect(conversationsService.findByCallSid).toHaveBeenCalledWith(
      'chat-session-1',
    );
    expect(llmChatClient.buildMessages).toHaveBeenCalledWith([
      { role: 'user', text: 'Hi' },
      { role: 'user', text: 'Do you deliver?' },
    ]);
    expect(conversationsService.create).toHaveBeenCalledWith({
      callSid: 'chat-session-1',
    });
  });

  it('appends to an existing conversation and ignores the caller-supplied transcript', async () => {
    conversationsService.findByCallSid.mockResolvedValue({
      id: 'conv-1',
      transcript: [
        { role: 'user', text: 'Hi' },
        { role: 'model', text: 'Hello!' },
      ],
    });
    llmChatClient.complete.mockResolvedValue(assistantMessage('Yes, we do.'));

    await service.sendMessage({
      sessionId: 'session-1',
      message: 'Do you deliver?',
      // A stale client-side transcript must be ignored once a row exists.
      transcript: [{ role: 'user', text: 'something else' }],
    });

    expect(conversationsService.create).not.toHaveBeenCalled();
    expect(llmChatClient.buildMessages).toHaveBeenCalledWith([
      { role: 'user', text: 'Hi' },
      { role: 'model', text: 'Hello!' },
      { role: 'user', text: 'Do you deliver?' },
    ]);
    expect(conversationsService.appendTurn).toHaveBeenCalledWith('conv-1', {
      transcript: [
        { role: 'user', text: 'Hi' },
        { role: 'model', text: 'Hello!' },
        { role: 'user', text: 'Do you deliver?' },
        { role: 'model', text: 'Yes, we do.' },
      ],
    });
  });

  it('builds the prompt from the conversation only (no knowledge)', async () => {
    llmChatClient.complete.mockResolvedValue(assistantMessage('Hi there!'));

    await service.sendMessage({ message: 'Hello' });

    expect(llmChatClient.buildMessages).toHaveBeenCalledWith([
      { role: 'user', text: 'Hello' },
    ]);
  });

  it('replies gracefully and persists nothing when the LLM call fails', async () => {
    llmChatClient.complete.mockRejectedValue(new Error('network error'));

    const result = await service.sendMessage({ message: 'Hello' });

    expect(result.reply).toMatch(/trouble processing/i);
    expect(conversationsService.create).not.toHaveBeenCalled();
    expect(conversationsService.appendTurn).not.toHaveBeenCalled();
  });

  it('replies with a reassuring message when every configured LLM key is exhausted', async () => {
    llmChatClient.complete.mockRejectedValue(new AllLlmKeysExhaustedError());

    const result = await service.sendMessage({ message: 'Hello' });

    expect(result.reply).toMatch(/give me a moment/i);
    expect(conversationsService.appendTurn).not.toHaveBeenCalled();
  });

  it('tells the visitor the assistant is not set up yet when no LLM credential is configured', async () => {
    llmChatClient.complete.mockRejectedValue(
      new NoLlmCredentialsConfiguredError(),
    );

    const result = await service.sendMessage({ message: 'Hello' });

    expect(result.reply).toMatch(/admin needs to add an api key/i);
    expect(conversationsService.appendTurn).not.toHaveBeenCalled();
  });

  describe('rateConversation', () => {
    it('rates the conversation matching the given sessionId', async () => {
      conversationsService.findByCallSid.mockResolvedValue({ id: 'conv-1' });

      await service.rateConversation('session-1', 5);

      expect(conversationsService.findByCallSid).toHaveBeenCalledWith(
        'chat-session-1',
      );
      expect(conversationsService.rate).toHaveBeenCalledWith('conv-1', 5);
    });

    it('throws NotFoundException when no conversation matches the sessionId', async () => {
      conversationsService.findByCallSid.mockResolvedValue(null);

      await expect(
        service.rateConversation('unknown-session', 4),
      ).rejects.toThrow(NotFoundException);
      expect(conversationsService.rate).not.toHaveBeenCalled();
    });
  });
});
