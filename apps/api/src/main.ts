import './env.js'; // must be first — populates process.env before anything reads it
import { requireEnvList } from './env.js';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module.js';
import { auth } from './auth/auth.js';

async function bootstrap() {
  // Better Auth consumes the raw request stream, so Nest's body parser has to
  // stay off until after the auth handler is mounted.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.enableCors({
    origin: requireEnvList('WEB_ORIGIN'),
    credentials: true, // session cookie must travel on cross-origin fetches
  });

  app.use('/api/auth', toNodeHandler(auth));
  app.use(express.json());

  app.enableShutdownHooks();

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}

void bootstrap();
