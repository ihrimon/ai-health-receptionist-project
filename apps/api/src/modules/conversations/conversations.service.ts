import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../../database/entities';
import { CreateConversationDto } from './dto/create-conversation.dto';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationsRepository: Repository<Conversation>,
  ) {}

  create(dto: CreateConversationDto): Promise<Conversation> {
    const conversation = this.conversationsRepository.create(dto);
    return this.conversationsRepository.save(conversation);
  }

  findAll(): Promise<Conversation[]> {
    return this.conversationsRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Conversation> {
    const conversation = await this.conversationsRepository.findOne({
      where: { id },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    return conversation;
  }

  findByCallSid(callSid: string): Promise<Conversation | null> {
    return this.conversationsRepository.findOne({ where: { callSid } });
  }

  async appendTurn(
    id: string,
    partial: Partial<Pick<Conversation, 'transcript' | 'summary'>>,
  ): Promise<Conversation> {
    const conversation = await this.findOne(id);
    Object.assign(conversation, partial);
    return this.conversationsRepository.save(conversation);
  }

  async rate(id: string, rating: number): Promise<Conversation> {
    const conversation = await this.findOne(id);
    conversation.rating = rating;
    return this.conversationsRepository.save(conversation);
  }

  async remove(id: string): Promise<void> {
    const conversation = await this.findOne(id);
    await this.conversationsRepository.remove(conversation);
  }
}
