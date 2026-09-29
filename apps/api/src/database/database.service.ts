import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { assertSafeTestDatabaseEnvironment } from './test-database-safety.js';

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super();
    assertSafeTestDatabaseEnvironment();
  }

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      await this.$connect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
