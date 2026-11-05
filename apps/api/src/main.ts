import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
async function bootstrap() {
 const app = await NestFactory.create(AppModule);
 const config = app.get(ConfigService);
 app.setGlobalPrefix('api/v1');
 app.use(helmet());
 app.enableCors({origin:[config.get('WEB_ORIGIN'),config.get('ADMIN_ORIGIN')].filter(Boolean),credentials:true});
 app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
 const swagger = new DocumentBuilder().setTitle('OPA Platform API').setVersion('1.0').addCookieAuth('opa_session').build();
 SwaggerModule.setup('docs',app,SwaggerModule.createDocument(app,swagger));
 await app.listen(config.get<number>('API_PORT') ?? 4000,'0.0.0.0');
}
bootstrap();
