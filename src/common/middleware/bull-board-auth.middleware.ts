import { Injectable, NestMiddleware } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class BullBoardAuthMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const secret = process.env.QUEUE_DASHBOARD_SECRET;

    // If no secret is configured, block access entirely in production
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        res.status(403).json({
          error:
            'Queue dashboard disabled in production without QUEUE_DASHBOARD_SECRET',
        });
        return;
      }
      return next();
    }

    const token = (req.headers['x-dashboard-secret'] ?? req.query['secret']) as
      | string
      | undefined;
    const authorized =
      typeof token === 'string' &&
      token.length === secret.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(secret));

    if (!authorized) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  }
}
