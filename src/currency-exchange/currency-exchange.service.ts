import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { ExchangeRateData } from '../orders/order.entity';

const AWESOME_API = 'https://economia.awesomeapi.com.br/json/last';
const FRANKFURTER_API = 'https://api.frankfurter.app/latest';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  result: ExchangeRateData;
  expiresAt: number;
}

@Injectable()
export class CurrencyExchangeService {
  private readonly logger = new Logger(CurrencyExchangeService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly http: HttpService) {}

  async fetchRate(
    currency: string,
    totalAmount: number,
  ): Promise<ExchangeRateData> {
    const target = currency === 'BRL' ? 'USD' : 'BRL';
    const cacheKey = `${currency}-${target}`;

    const cached = this.getCachedRate(cacheKey);
    if (cached) {
      this.logger.log(`Cache hit para ${cacheKey}`);
      return this.applyRate(cached, currency, target, totalAmount);
    }

    let baseResult: ExchangeRateData;
    try {
      baseResult = await this.fetchFromAwesomeApi(
        currency,
        target,
        totalAmount,
      );
    } catch (err) {
      this.logger.warn(
        `AwesomeAPI falhou (${(err as Error).message}), tentando Frankfurter...`,
      );
      baseResult = await this.fetchFromFrankfurter(
        currency,
        target,
        totalAmount,
      );
    }

    this.cache.set(cacheKey, {
      result: baseResult,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return baseResult;
  }

  private getCachedRate(key: string): ExchangeRateData | null {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  private convertTotal(amount: number, rate: number): number {
    return Math.round(amount * rate * 100) / 100;
  }

  private applyRate(
    cached: ExchangeRateData,
    currency: string,
    target: string,
    totalAmount: number,
  ): ExchangeRateData {
    return {
      ...cached,
      base_currency: currency,
      target_currency: target,
      converted_total: this.convertTotal(totalAmount, cached.exchange_rate),
    };
  }

  private async fetchFromAwesomeApi(
    currency: string,
    target: string,
    totalAmount: number,
  ): Promise<ExchangeRateData> {
    const pair = `${currency}-${target}`;
    const { data } = await firstValueFrom(
      this.http.get<Record<string, { bid: string }>>(`${AWESOME_API}/${pair}`),
    );

    const quote = data[pair.replace('-', '')];
    if (!quote) throw new Error(`Par ${pair} não encontrado na AwesomeAPI`);

    const rate = parseFloat(quote.bid);

    return {
      base_currency: currency,
      target_currency: target,
      exchange_rate: rate,
      converted_total: this.convertTotal(totalAmount, rate),
      source: 'economia.awesomeapi.com.br',
    };
  }

  private async fetchFromFrankfurter(
    currency: string,
    target: string,
    totalAmount: number,
  ): Promise<ExchangeRateData> {
    const { data } = await firstValueFrom(
      this.http.get<{ rates?: Record<string, number> }>(
        `${FRANKFURTER_API}?from=${currency}&to=${target}`,
      ),
    );

    const rate = data?.rates?.[target];
    if (!rate)
      throw new Error(
        `Par ${currency}/${target} não encontrado na Frankfurter`,
      );

    return {
      base_currency: currency,
      target_currency: target,
      exchange_rate: rate,
      converted_total: this.convertTotal(totalAmount, rate),
      source: 'api.frankfurter.app',
    };
  }
}
