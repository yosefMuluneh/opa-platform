import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { createOriginValidationMiddleware } from './common/middleware/origin-validation.middleware';

export function configureApp(app: INestApplication): void {
  app.use(cookieParser());

  const config = app.get(ConfigService);

  const webOrigin = config.get<string>('WEB_ORIGIN');
  const adminOrigin = config.get<string>('ADMIN_ORIGIN');
  const apiOrigin = config.get<string>('API_ORIGIN');

  const allowedOrigins = [
    webOrigin,
    adminOrigin,
    apiOrigin,
  ].filter((origin): origin is string => Boolean(origin));

  app.use(createOriginValidationMiddleware(allowedOrigins));

  app.setGlobalPrefix('api/v1');

  app.use(helmet());

  app.enableCors({
    origin: [webOrigin, adminOrigin].filter(Boolean),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swagger = new DocumentBuilder()
    .setTitle('OPA Platform API')
    .setVersion('1.0')
    .addCookieAuth('opa_session')
    .build();

  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swagger),
  );
}