import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { MembershipModule } from './modules/membership/membership.module';
import { ContentModule } from './modules/content/content.module';
import { EventsModule } from './modules/events/events.module';
import { ContactModule } from './modules/contact/contact.module';
import { MediaModule } from './modules/media/media.module';
import { AuditModule } from './modules/audit/audit.module';
@Module({imports:[ConfigModule.forRoot({isGlobal:true, envFilePath:'../../.env'}),PrismaModule,HealthModule,AuthModule,MembershipModule,ContentModule,EventsModule,ContactModule,MediaModule,AuditModule]})
export class AppModule {}
