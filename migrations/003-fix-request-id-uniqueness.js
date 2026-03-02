'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS bonus_transactions_request_id_uq;
    `);

    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS bonus_transactions_user_request_uq;
    `);

    await queryInterface.addIndex(
      'bonus_transactions', ['user_id', 'request_id'],
      {
        name: 'bonus_transactions_user_request_uq',
        unique: true,
      }
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS bonus_transactions_user_request_uq;
    `);

    await queryInterface.addIndex(
      'bonus_transactions',
      ['request_id'],
      {
        name: 'bonus_transactions_request_id_uq',
        unique: true,
      }
    );
  },
};