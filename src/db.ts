import { Sequelize } from 'sequelize';

import { initBonusTransactionModel, BonusTransaction } from './models/BonusTransaction';
import { initUserModel, User } from './models/User';

const isTest = process.env.NODE_ENV === 'test';

const DB_HOST = isTest ? 'localhost' : process.env.DB_HOST || 'postgres';
const DB_PORT = isTest ? 55432 : Number(process.env.DB_PORT || 5432);
const DB_NAME = process.env.DB_NAME || 'appdb';
const DB_USER = process.env.DB_USER || 'app';
const DB_PASSWORD = process.env.DB_PASSWORD || 'app';

export const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  port: DB_PORT,
  dialect: 'postgres',
  logging: false,
  timezone: '+00:00',   
});

initUserModel(sequelize);
initBonusTransactionModel(sequelize);

User.hasMany(BonusTransaction, {
  foreignKey: 'user_id',
  as: 'bonusTransactions',
});

BonusTransaction.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});