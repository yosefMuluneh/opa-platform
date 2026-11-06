
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { type AuthenticatedUser } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './auth.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

const SESSION_COOKIE_NAME = 'opa_session';

@Controller('auth')
@ApiTags('authentication')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  private getCookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict' as const,
      path: '/',
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Authenticate a user' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(
      dto.email,
      dto.password,
      request.ip,
      request.get('user-agent') ?? undefined,
    );

    response.cookie(
      SESSION_COOKIE_NAME,
      result.token,
      {
        ...this.getCookieOptions(),
        maxAge: result.expiresAt.getTime() - Date.now(),
      },
    );

    return {
      user: result.user,
      expiresAt: result.expiresAt,
    };
  }

  @Get('me')
  @ApiCookieAuth(SESSION_COOKIE_NAME)
  @ApiOperation({ summary: 'Get the current authenticated user' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return { user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth(SESSION_COOKIE_NAME)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(
      user.sessionId,
      user.id,
      request.ip,
      request.get('user-agent') ?? undefined,
    );

    response.clearCookie(
      SESSION_COOKIE_NAME,
      this.getCookieOptions(),
    );
  }

}
