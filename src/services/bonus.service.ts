import { sequelize } from '../db';
import { BonusTransaction } from '../models/BonusTransaction';
import { QueryTypes, Transaction } from 'sequelize';

export class BonusService {
  static async spendBonus(
    userId: string,
    amount: number,
    requestId: string,
  ) {
    return sequelize.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
      async (t) => {
        const existing = await BonusTransaction.findOne({
          where: {
            user_id: userId,
            request_id: requestId,
            type: 'spend',
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (existing) {
          return { duplicated: true };
        }

        await sequelize.query(
          `
          SELECT id
          FROM bonus_transactions
          WHERE user_id = :userId
          FOR UPDATE
          `,
          {
            replacements: { userId },
            type: QueryTypes.SELECT,
            transaction: t,
          },
        );

        const accrualRow = await sequelize.query<{ sum: string }>(
          `
          SELECT COALESCE(SUM(amount), 0) as sum
          FROM bonus_transactions
          WHERE user_id = :userId
            AND type = 'accrual'
            AND (expires_at IS NULL OR expires_at > NOW())
          `,
          {
            replacements: { userId },
            type: QueryTypes.SELECT,
            plain: true,
            transaction: t,
          },
        );

        const spendRow = await sequelize.query<{ sum: string }>(
          `
          SELECT COALESCE(SUM(amount), 0) as sum
          FROM bonus_transactions
          WHERE user_id = :userId
            AND type = 'spend'
          `,
          {
            replacements: { userId },
            type: QueryTypes.SELECT,
            plain: true,
            transaction: t,
          },
        );

        const totalAccruals = Number(accrualRow?.sum ?? 0);
        const totalSpends = Number(spendRow?.sum ?? 0);
        const balance = totalAccruals - totalSpends;

        if (balance < amount) {
          throw new Error('Not enough bonus');
        }

        await BonusTransaction.create(
          {
            user_id: userId,
            type: 'spend',
            amount,
            request_id: requestId,
          },
          { transaction: t },
        );

        return { duplicated: false };
      },
    );
  }

  static async processExpiredBonuses() {
    return sequelize.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
      async (t) => {
        const expiredAccruals = await sequelize.query(
          `
          SELECT id, user_id, amount
          FROM bonus_transactions
          WHERE type = 'accrual'
            AND expires_at <= NOW()
          FOR UPDATE
          `,
          {
            type: QueryTypes.SELECT,
            transaction: t,
          },
        ) as { id: string; user_id: string; amount: number }[];

        let created = 0;

        for (const accrual of expiredAccruals) {
          const expireRequestId = `expire:${accrual.id}`;

          const existing = await BonusTransaction.findOne({
            where: {
              request_id: expireRequestId,
              type: 'spend',
            },
            transaction: t,
            lock: t.LOCK.UPDATE,
          });

          if (!existing) {
            await BonusTransaction.create(
              {
                user_id: accrual.user_id,
                type: 'spend',
                amount: accrual.amount,
                request_id: expireRequestId,
              },
              { transaction: t },
            );
            created++;
          }
        }

        return { processed: created };
      },
    );
  }
}