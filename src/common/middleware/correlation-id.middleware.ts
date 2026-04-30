import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export const CORRELATION_ID_HEADER = 'x-request-id';

// Only alphanumeric chars and hyphens, max 128 chars — prevents log injection
const SAFE_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/;

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[CORRELATION_ID_HEADER] as string | undefined;
    const id =
      incoming && SAFE_ID_PATTERN.test(incoming) ? incoming : randomUUID();

    req.headers[CORRELATION_ID_HEADER] = id;
    res.setHeader(CORRELATION_ID_HEADER, id);
    next();
  }
}
