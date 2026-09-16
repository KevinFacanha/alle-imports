import { Injectable } from '@nestjs/common';

export interface HealthResponse {
  service: 'ale-intelligence-api';
  status: 'ok';
}

@Injectable()
export class HealthService {
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'ale-intelligence-api',
    };
  }
}
