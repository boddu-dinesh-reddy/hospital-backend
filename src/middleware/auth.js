const { verifyAccessToken } = require('../config/jwt');
const { getConnection } = require('../config/database');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }

    const token = authHeader.substring(7);
    const decoded = verifyAccessToken(token);
    
    // Get user from database
    const connection = getConnection();
    const [users] = await connection.execute(
      'SELECT u.*, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ? AND u.is_active = 1',
      [decoded.userId]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token - user not found'
      });
    }

    req.user = {
      id: users[0].id,
      username: users[0].username,
      email: users[0].email,
      role: users[0].role_name,
      roleId: users[0].role_id,
      firstName: users[0].first_name,
      lastName: users[0].last_name
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

module.exports = authenticate;
