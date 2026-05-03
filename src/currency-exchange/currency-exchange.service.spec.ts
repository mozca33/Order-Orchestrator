import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { CurrencyExchangeService } from './currency-exchange.service';

const makeAxiosResponse = (data: unknown): AxiosResponse =>
  ({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as any,
  }) as AxiosResponse;

describe('CurrencyExchangeService', () => {
  let service: CurrencyExchangeService;
  const mockHttp = { get: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CurrencyExchangeService,
        { provide: HttpService, useValue: mockHttp },
      ],
    }).compile();

    service = module.get(CurrencyExchangeService);
    jest.clearAllMocks();
  });

  describe('fetchRate — AwesomeAPI (caminho principal)', () => {
    it('converte USD→BRL via AwesomeAPI', async () => {
      mockHttp.get.mockReturnValue(
        of(makeAxiosResponse({ USDBRL: { bid: '5.20' } })),
      );

      const result = await service.fetchRate('USD', 100);

      expect(result.base_currency).toBe('USD');
      expect(result.target_currency).toBe('BRL');
      expect(result.exchange_rate).toBe(5.2);
      expect(result.converted_total).toBe(520);
      expect(result.source).toBe('economia.awesomeapi.com.br');
    });

    it('converte BRL→USD quando moeda base é BRL', async () => {
      mockHttp.get.mockReturnValue(
        of(makeAxiosResponse({ BRLUSD: { bid: '0.19' } })),
      );

      const result = await service.fetchRate('BRL', 1000);

      expect(result.base_currency).toBe('BRL');
      expect(result.target_currency).toBe('USD');
      expect(result.exchange_rate).toBe(0.19);
      expect(result.converted_total).toBe(190);
    });

    it('converte EUR→BRL para moeda não-padrão', async () => {
      mockHttp.get.mockReturnValue(
        of(makeAxiosResponse({ EURBRL: { bid: '6.10' } })),
      );

      const result = await service.fetchRate('EUR', 100);

      expect(result.base_currency).toBe('EUR');
      expect(result.target_currency).toBe('BRL');
      expect(result.exchange_rate).toBe(6.1);
      expect(result.converted_total).toBe(610);
    });

    it('arredonda converted_total para 2 casas decimais', async () => {
      mockHttp.get.mockReturnValue(
        of(makeAxiosResponse({ USDBRL: { bid: '5.555' } })),
      );

      const result = await service.fetchRate('USD', 10);

      expect(result.converted_total).toBe(55.55);
    });

    it('lança erro quando o par não é encontrado na resposta', async () => {
      mockHttp.get.mockReturnValue(of(makeAxiosResponse({})));

      await expect(service.fetchRate('USD', 100)).rejects.toThrow(
        'não encontrado',
      );
    });
  });

  describe('fetchRate — fallback para Frankfurter', () => {
    it('usa Frankfurter quando AwesomeAPI falha', async () => {
      mockHttp.get
        .mockReturnValueOnce(throwError(() => new Error('network error')))
        .mockReturnValueOnce(of(makeAxiosResponse({ rates: { BRL: 5.1 } })));

      const result = await service.fetchRate('USD', 100);

      expect(result.exchange_rate).toBe(5.1);
      expect(result.source).toBe('api.frankfurter.app');
      expect(mockHttp.get).toHaveBeenCalledTimes(2);
    });

    it('lança erro quando ambas as APIs falham', async () => {
      mockHttp.get
        .mockReturnValueOnce(throwError(() => new Error('AwesomeAPI down')))
        .mockReturnValueOnce(throwError(() => new Error('Frankfurter down')));

      await expect(service.fetchRate('USD', 100)).rejects.toThrow(
        'Frankfurter down',
      );
    });

    it('lança erro quando Frankfurter não retorna o par', async () => {
      mockHttp.get
        .mockReturnValueOnce(throwError(() => new Error('AwesomeAPI down')))
        .mockReturnValueOnce(of(makeAxiosResponse({ rates: {} })));

      await expect(service.fetchRate('USD', 100)).rejects.toThrow(
        'não encontrado',
      );
    });
  });

  describe('cache de cotações', () => {
    it('não chama a API na segunda requisição para o mesmo par', async () => {
      mockHttp.get.mockReturnValue(
        of(makeAxiosResponse({ USDBRL: { bid: '5.20' } })),
      );

      await service.fetchRate('USD', 100);
      await service.fetchRate('USD', 200);

      expect(mockHttp.get).toHaveBeenCalledTimes(1);
    });

    it('recalcula converted_total para cada totalAmount mesmo com cache', async () => {
      mockHttp.get.mockReturnValue(
        of(makeAxiosResponse({ USDBRL: { bid: '5.00' } })),
      );

      const first = await service.fetchRate('USD', 100);
      const second = await service.fetchRate('USD', 200);

      expect(first.converted_total).toBe(500);
      expect(second.converted_total).toBe(1000);
    });

    it('pares diferentes não compartilham cache', async () => {
      mockHttp.get
        .mockReturnValueOnce(of(makeAxiosResponse({ USDBRL: { bid: '5.20' } })))
        .mockReturnValueOnce(
          of(makeAxiosResponse({ BRLUSD: { bid: '0.19' } })),
        );

      await service.fetchRate('USD', 100);
      await service.fetchRate('BRL', 100);

      expect(mockHttp.get).toHaveBeenCalledTimes(2);
    });
  });
});
