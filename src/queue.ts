import { Queue, Worker, JobsOptions } from 'bullmq';
import { Op, UniqueConstraintError } from 'sequelize';
import { sequelize } from './db';
import { BonusTransaction } from './models/BonusTransaction';

const isTest = process.env.NODE_ENV === 'test';

const connection = {
  host: process.env.REDIS_HOST || 'redis',
  port: Number(process.env.REDIS_PORT || 6379),
};

export const bonusQueue = isTest
  ? null
  : new Queue('bonusQueue', { connection });

let expireAccrualsWorker: Worker | null = null;

export async function expireAccrualsHandler(): Promise<void> {
  const now = new Date();

  await sequelize.transaction(async (t) => {
    const expiredAccruals = await BonusTransaction.findAll({
      where: {
        type: 'accrual',
        expires_at: { [Op.lt]: now },
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    for (const accrual of expiredAccruals) {
      const requestId = `expire:${accrual.id}`;

      const existing = await BonusTransaction.findOne({
        where: {
          user_id: accrual.user_id,
          request_id: requestId,
          type: 'spend',
        },
        transaction: t,
      });

      if (existing) {
        continue;
      }

      try {
        await BonusTransaction.create(
          {
            user_id: accrual.user_id,
            type: 'spend',
            amount: accrual.amount,
            request_id: requestId,
          },
          { transaction: t },
        );
      } catch (err) {
        if (err instanceof UniqueConstraintError) {
          continue;
        }
        throw err;
      }
    }
  });
}

export function startExpireAccrualsWorker(): Worker | null {
  if (isTest) {
    return null;
  }

  if (expireAccrualsWorker) {
    return expireAccrualsWorker;
  }

  expireAccrualsWorker = new Worker(
    'bonusQueue',
    async (job) => {
      if (job.name === 'expireAccruals') {
        await expireAccrualsHandler();
      }
    },
    {
      connection,
    },
  );

  expireAccrualsWorker.on('failed', (job, err) => {
    console.error(`[worker] failed, jobId=${job?.id}`, err);
  });

  return expireAccrualsWorker;
}

export async function enqueueExpireAccruals(): Promise<void> {
  if (!bonusQueue) {
    await expireAccrualsHandler();
    return;
  }

  const jobOptions: JobsOptions = {
    jobId: 'expire-accruals',
    attempts: 3,
    backoff: {
      type: 'fixed',
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  };

  await bonusQueue.add('expireAccruals', {}, jobOptions);
}