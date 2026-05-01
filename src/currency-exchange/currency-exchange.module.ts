import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CurrencyExchangeService } from './currency-exchange.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        timeout: cfg.get<number>('EXCHANGE_TIMEOUT_MS', 5000),
      }),
    }),
  ],
  providers: [CurrencyExchangeService],
  exports: [CurrencyExchangeService],
})
export class CurrencyExchangeModule {}
