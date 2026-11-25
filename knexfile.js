require('dotenv').config();

module.exports = {
  client: 'pg',
  connection: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
  migrations: {
    directory: './migrations',
    extensions: ['js'],
  },
};