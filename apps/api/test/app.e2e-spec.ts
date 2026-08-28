import '../src/env';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('serves health without credentials', () => {
    return request(app.getHttpServer()).get('/api/health').expect(200);
  });

  it('rejects /api/me with no session cookie', () => {
    return request(app.getHttpServer()).get('/api/me').expect(401);
  });

  it('rejects the CEO-only roster with no session cookie', () => {
    return request(app.getHttpServer()).get('/api/users').expect(401);
  });

  afterEach(async () => {
    await app.close();
  });
});
