const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const logger = {
  info: (message, meta = {}) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message,
      meta
    };
    console.log(JSON.stringify(logEntry));
    fs.appendFileSync(path.join(logsDir, 'app.log'), JSON.stringify(logEntry) + '\n');
  },

  error: (message, error = null, meta = {}) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message,
      error: error ? {
        message: error.message,
        stack: error.stack
      } : null,
      meta
    };
    console.error(JSON.stringify(logEntry));
    fs.appendFileSync(path.join(logsDir, 'error.log'), JSON.stringify(logEntry) + '\n');
  },

  warn: (message, meta = {}) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      message,
      meta
    };
    console.warn(JSON.stringify(logEntry));
    fs.appendFileSync(path.join(logsDir, 'app.log'), JSON.stringify(logEntry) + '\n');
  }
};

module.exports = logger;
