import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { PrismaService } from './prisma/prisma.service.js';

describe('AppController', () => {
  const buildWith = async (queryRaw: jest.Mock): Promise<AppController> => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: PrismaService, useValue: { db: { $queryRaw: queryRaw } } },
      ],
    }).compile();
    return module.get<AppController>(AppController);
  };

  it('reports ok when the database answers', async () => {
    const controller = await buildWith(jest.fn().mockResolvedValue([{ '?column?': 1 }]));
    await expect(controller.health()).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('reports degraded instead of throwing when the database is unreachable', async () => {
    const controller = await buildWith(jest.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(controller.health()).resolves.toEqual({
      status: 'degraded',
      database: 'down',
    });
  });
});
