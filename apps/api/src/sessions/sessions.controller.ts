import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/session.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthSession } from '../auth/auth.js';
import { SessionsService } from './sessions.service.js';
import type {
  Language,
  SessionVisibility,
} from '../generated/prisma/enums.js';

const LANGUAGES = ['EN', 'FR'];
const VISIBILITIES = ['PRIVATE', 'PUBLIC'];

/**
 * Validation is hand-rolled to match the style already in rtc.controller.ts.
 * Once a third endpoint needs it, class-validator plus a global ValidationPipe
 * is the right move — it is a new dependency and a main.ts change, so not here.
 */
@Controller('api/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  /**
   * Only a TUTOR may open a session. The creator becomes its TUTOR participant;
   * the student is resolved server-side from an email, so a client cannot name
   * a user id it should not know.
   */
  @Roles('TUTOR')
  @Post()
  async create(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthSession['user'],
  ) {
    const studentEmail = str(body.studentEmail);
    if (!studentEmail) throw new BadRequestException('studentEmail is required');

    const language = str(body.language);
    if (language && !LANGUAGES.includes(language)) {
      throw new BadRequestException('language must be EN or FR');
    }

    const visibility = str(body.visibility);
    if (visibility && !VISIBILITIES.includes(visibility)) {
      throw new BadRequestException('visibility must be PRIVATE or PUBLIC');
    }

    const scheduledForRaw = str(body.scheduledFor);
    let scheduledFor: Date | undefined;
    if (scheduledForRaw) {
      scheduledFor = new Date(scheduledForRaw);
      if (Number.isNaN(scheduledFor.getTime())) {
        throw new BadRequestException('scheduledFor must be an ISO date');
      }
    }

    return this.sessions.create(user.id, {
      studentEmail,
      title: str(body.title),
      scheduledFor,
      language: language as Language | undefined,
      visibility: visibility as SessionVisibility | undefined,
    });
  }

  @Get()
  async list(@CurrentUser() user: AuthSession['user']) {
    return this.sessions.listForUser(user.id);
  }

  @Get(':id')
  async get(
    @Param('id') id: string,
    @CurrentUser() user: AuthSession['user'],
  ) {
    return this.sessions.getForUser(id, user.id);
  }

  @Post(':id/invite')
  async invite(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthSession['user'],
  ) {
    const email = str(body.email);
    if (!email) throw new BadRequestException('email is required');
    return this.sessions.invite(id, user.id, email);
  }
}

/** Narrows an unknown body field to a non-empty trimmed string, or undefined. */
function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
