import {
  type ConversationListQuery,
  conversationListQuerySchema,
} from '@brainstack/shared';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { WorkspaceRole } from '../../generated/prisma/client';
import { Roles } from '../../tenancy/workspace.guard';
import { ConversationInboxService } from './conversation-inbox.service';

const uuid = new ParseUUIDPipe({ version: '4' });

/** D-2 §2.6: the conversation inbox (M5-1, M5-2) and deleting a chat (M5-3). */
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly inbox: ConversationInboxService) {}

  @Get()
  @Roles(WorkspaceRole.VIEWER)
  list(
    @Query(new ZodBodyPipe(conversationListQuerySchema))
    query: ConversationListQuery,
  ) {
    return this.inbox.list(query);
  }

  @Get(':id')
  @Roles(WorkspaceRole.VIEWER)
  detail(@Param('id', uuid) id: string) {
    return this.inbox.detail(id);
  }

  /** Privacy (M5-3): the conversation and its messages are gone for good. */
  @Delete(':id')
  @Roles(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', uuid) id: string) {
    return this.inbox.remove(id);
  }
}
