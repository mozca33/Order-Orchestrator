import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ValueTransformer,
} from 'typeorm';

const numericTransformer: ValueTransformer = {
  to: (v: number) => v,
  from: (v: string) => parseFloat(v),
};

export enum OrderStatus {
  RECEIVED = 'RECEIVED',
  PROCESSING = 'PROCESSING',
  ENRICHED = 'ENRICHED',
  FAILED_ENRICHMENT = 'FAILED_ENRICHMENT',
}

export interface ExchangeRateData {
  base_currency: string;
  target_currency: string;
  exchange_rate: number;
  converted_total: number;
  source: string;
}

@Index(['status', 'createdAt'])
@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'external_id' })
  externalId: string;

  @Index({ unique: true })
  @Column({ name: 'idempotency_key' })
  idempotencyKey: string;

  @Column({ type: 'jsonb' })
  customer: { email: string; name: string };

  @Column({ type: 'jsonb' })
  items: { sku: string; qty: number; unit_price: number }[];

  @Column()
  currency: string;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 4,
    name: 'total_amount',
    transformer: numericTransformer,
  })
  totalAmount: number;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.RECEIVED,
  })
  status: OrderStatus;

  @Column({ type: 'jsonb', nullable: true, name: 'exchange_data' })
  exchangeData: ExchangeRateData | null;

  @Column({ type: 'text', name: 'exchange_error', nullable: true })
  exchangeError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
