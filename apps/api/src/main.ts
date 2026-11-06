import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  configureApp(app);

  const config = app.get(ConfigService);

  await app.listen(
    config.get<number>('API_PORT') ?? 4000,
    '0.0.0.0',
  );
}

bootstrap();