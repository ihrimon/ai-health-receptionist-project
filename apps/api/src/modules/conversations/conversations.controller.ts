import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { PlatformAdminOnly } from '../auth/platform-admin.guard';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';

// Interim, not yet workspace-scoped transcripts of every chat, so
// platform admins only until M3 replaces them.
@Controller('conversations')
@PlatformAdminOnly()
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  create(@Body() dto: CreateConversationDto) {
    return this.conversationsService.create(dto);
  }

  @Get()
  findAll() {
    return this.conversationsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.conversationsService.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.conversationsService.remove(id);
  }
}
