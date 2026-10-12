import { Controller, Get } from '@nestjs/common';
import { Public } from '../modules/auth/auth-context';

@Public()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'brainstack-ai-receptionist-api',
      timestamp: new Date().toISOString(),
    };
  }
}
