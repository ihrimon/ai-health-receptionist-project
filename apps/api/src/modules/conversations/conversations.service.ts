import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Conversation, Prisma } from '../../generated/prisma/client';
import { CreateConversationDto } from './dto/create-conversation.dto';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateConversationDto): Promise<Conversation> {
    return this.prisma.conversation.create({
      data: {
        ...dto,
        transcript: dto.transcript as Prisma.InputJsonValue | undefined,
      },
    });
  }

  findAll(): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<Conversation> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    return conversation;
  }

  findByCallSid(callSid: string): Promise<Conversation | null> {
    return this.prisma.conversation.findFirst({ where: { callSid } });
  }

  async appendTurn(
    id: string,
    partial: {
      transcript?: Record<string, unknown>[];
      summary?: string;
    },
  ): Promise<Conversation> {
    await this.findOne(id);
    return this.prisma.conversation.update({
      where: { id },
      data: {
        ...partial,
        transcript: partial.transcript as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async rate(id: string, rating: number): Promise<Conversation> {
    await this.findOne(id);
    return this.prisma.conversation.update({
      where: { id },
      data: { rating },
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.conversation.delete({ where: { id } });
  }
}
