const mysql = require('mysql2/promise');

let pool;

const connectDatabase = async () => {
  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      acquireTimeout: 60000,
      timeout: 60000,
      reconnect: true
    });

    // Test connection
    await pool.execute('SELECT 1');
    console.log('Database connection pool created successfully');
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
};

const getConnection = () => {
  if (!pool) {
    throw new Error('Database pool not initialized');
  }
  return pool;
};

module.exports = {
  connectDatabase,
  getConnection
};
