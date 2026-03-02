import request from 'supertest';
import { Op } from 'sequelize';
import { app } from '../src/server';
import { sequelize } from '../src/db';
import { BonusTransaction } from '../src/models/BonusTransaction';
import { User } from '../src/models/User';

const USER_ID = '11111111-1111-1111-1111-111111111111';

beforeAll(async () => {
  await sequelize.authenticate();
  await sequelize.query("SET TIME ZONE 'UTC';");
});

beforeEach(async () => {
  await BonusTransaction.destroy({ where: {} });

  await User.findOrCreate({
    where: { id: USER_ID },
    defaults: { id: USER_ID, name: 'Test User' },
  });
});

afterAll(async () => {
  await sequelize.close();
});

describe('Bonus logic', () => {
  test('duplicate request does not create second spend', async () => {
    const now = new Date();
    const futureDate = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const pastDate = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    await BonusTransaction.bulkCreate([
      {
        user_id: USER_ID,
        type: 'accrual',
        amount: 300,
        expires_at: futureDate,
      },
      {
        user_id: USER_ID,
        type: 'accrual',
        amount: 100,
        expires_at: pastDate,
      },
    ]);

    const first = await request(app)
      .post(`/users/${USER_ID}/spend`)
      .set('Idempotency-Key', 'dup-1')
      .send({ amount: 100 });

    expect(first.status).toBe(200);
    expect(first.body.duplicated).toBe(false);

    const second = await request(app)
      .post(`/users/${USER_ID}/spend`)
      .set('Idempotency-Key', 'dup-1')
      .send({ amount: 100 });

    expect(second.status).toBe(200);
    expect(second.body.duplicated).toBe(true);

    const count = await BonusTransaction.count({
      where: { user_id: USER_ID, type: 'spend' },
    });

    expect(count).toBe(1);
  });

  test('expired accrual is excluded from balance', async () => {
    const now = new Date();
    const futureDate = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const pastDate = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    await BonusTransaction.bulkCreate([
      {
        user_id: USER_ID,
        type: 'accrual',
        amount: 300,
        expires_at: futureDate,
      },
      {
        user_id: USER_ID,
        type: 'accrual',
        amount: 100,
        expires_at: pastDate,
      },
    ]);

    const res = await request(app)
      .post(`/users/${USER_ID}/spend`)
      .set('Idempotency-Key', 'expired-test')
      .send({ amount: 350 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Not enough bonus');
  });

  test('concurrent spends do not overspend balance', async () => {
    const now = new Date();
    const futureDate = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const pastDate = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    await BonusTransaction.bulkCreate([
      {
        user_id: USER_ID,
        type: 'accrual',
        amount: 300,
        expires_at: futureDate,
      },
      {
        user_id: USER_ID,
        type: 'accrual',
        amount: 100,
        expires_at: pastDate,
      },
    ]);

    const [r1, r2] = await Promise.allSettled([
      request(app)
        .post(`/users/${USER_ID}/spend`)
        .set('Idempotency-Key', 'con-1')
        .send({ amount: 200 }),

      request(app)
        .post(`/users/${USER_ID}/spend`)
        .set('Idempotency-Key', 'con-2')
        .send({ amount: 200 }),
    ]);

    const successCount = [r1, r2].filter(
      (r) => r.status === 'fulfilled' && (r as any).value.status === 200,
    ).length;

    expect(successCount).toBe(1);

    const spendCount = await BonusTransaction.count({
      where: {
        user_id: USER_ID,
        type: 'spend',
        request_id: { [Op.in]: ['con-1', 'con-2'] },
      },
    });

    expect(spendCount).toBe(1);
  });

  test('queue does not duplicate expired processing', async () => {
    const now = new Date();
    const futureDate = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const pastDate = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    await BonusTransaction.bulkCreate([
      {
        user_id: USER_ID,
        type: 'accrual',
        amount: 300,
        expires_at: futureDate,
      },
      {
        user_id: USER_ID,
        type: 'accrual',
        amount: 100,
        expires_at: pastDate,
      },
    ]);

    await request(app).post('/jobs/expire-accruals');
    await request(app).post('/jobs/expire-accruals');

    await new Promise((r) => setTimeout(r, 1000));

    const expiredSpendCount = await BonusTransaction.count({
      where: {
        user_id: USER_ID,
        request_id: { [Op.like]: 'expire:%' },
        type: 'spend',
      },
    });

    expect(expiredSpendCount).toBe(1);

    const expiredAccrual = await BonusTransaction.findOne({
      where: {
        user_id: USER_ID,
        type: 'accrual',
        amount: 100,
      },
    });

    expect(expiredAccrual).toBeTruthy();
  });
});