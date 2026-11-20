import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Mobile web app (no build step) served at /app
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/app', index: 'index.html' });
  app.enableCors();
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`NutriSnap API on :${port} (auth=${process.env.AUTH_MODE ?? 'dev'}, db=${process.env.DATABASE_URL ? 'postgres' : 'memory'})`);
}
bootstrap();
