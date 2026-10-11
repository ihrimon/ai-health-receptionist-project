import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'call_sid' })
  callSid: string;

  @Column({ type: 'jsonb', nullable: true })
  transcript?: Record<string, unknown>[];

  @Column({ type: 'text', nullable: true })
  summary?: string;

  @Column({ type: 'int', nullable: true, comment: 'duration in seconds' })
  duration?: number;

  @Column({
    type: 'int',
    nullable: true,
    comment: '1-5 star rating the caller gave this conversation',
  })
  rating?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
