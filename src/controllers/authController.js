const bcrypt = require('bcryptjs');
const { getConnection } = require('../config/database');
const { generateAccessToken, generateRefreshToken } = require('../config/jwt');

class AuthController {
  // User registration
  async register(req, res) {
    try {
      const { username, email, password, firstName, lastName, roleId } = req.body;
      const connection = getConnection();

      // Check if user already exists
      const [existingUsers] = await connection.execute(
        'SELECT id FROM users WHERE username = ? OR email = ?',
        [username, email]
      );

      if (existingUsers.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Username or email already exists'
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Insert new user
      const [result] = await connection.execute(
        'INSERT INTO users (username, email, password, first_name, last_name, role_id) VALUES (?, ?, ?, ?, ?, ?)',
        [username, email, hashedPassword, firstName, lastName, roleId]
      );

      // Get user with role
      const [users] = await connection.execute(`
        SELECT u.id, u.username, u.email, u.first_name, u.last_name, r.name as role_name
        FROM users u 
        JOIN roles r ON u.role_id = r.id 
        WHERE u.id = ?
      `, [result.insertId]);

      const user = users[0];

      // Generate tokens
      const accessToken = generateAccessToken({
        userId: user.id,
        username: user.username,
        role: user.role_name
      });

      const refreshToken = generateRefreshToken({
        userId: user.id
      });

      // Store refresh token
      await connection.execute(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
        [user.id, refreshToken]
      );

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role_name
          },
          accessToken,
          refreshToken
        }
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        message: 'Registration failed',
        error: error.message
      });
    }
  }

  // User login
  async login(req, res) {
    try {
      const { username, password } = req.body;
      const connection = getConnection();

      // Get user with role
      const [users] = await connection.execute(`
        SELECT u.*, r.name as role_name
        FROM users u 
        JOIN roles r ON u.role_id = r.id 
        WHERE u.username = ? AND u.is_active = 1
      `, [username]);

      if (users.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      const user = users[0];

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      // Generate tokens
      const accessToken = generateAccessToken({
        userId: user.id,
        username: user.username,
        role: user.role_name
      });

      const refreshToken = generateRefreshToken({
        userId: user.id
      });

      // Store refresh token
      await connection.execute(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
        [user.id, refreshToken]
      );

      // Update last login
      await connection.execute(
        'UPDATE users SET last_login = NOW() WHERE id = ?',
        [user.id]
      );

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role_name
          },
          accessToken,
          refreshToken
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Login failed',
        error: error.message
      });
    }
  }

  // Refresh token
  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          message: 'Refresh token is required'
        });
      }

      const connection = getConnection();

      // Verify refresh token exists and not expired
      const [tokens] = await connection.execute(`
        SELECT rt.*, u.username, r.name as role_name
        FROM refresh_tokens rt
        JOIN users u ON rt.user_id = u.id
        JOIN roles r ON u.role_id = r.id
        WHERE rt.token = ? AND rt.expires_at > NOW() AND u.is_active = 1
      `, [refreshToken]);

      if (tokens.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired refresh token'
        });
      }

      const tokenData = tokens[0];

      // Generate new access token
      const accessToken = generateAccessToken({
        userId: tokenData.user_id,
        username: tokenData.username,
        role: tokenData.role_name
      });

      res.json({
        success: true,
        data: { accessToken }
      });
    } catch (error) {
      console.error('Token refresh error:', error);
      res.status(500).json({
        success: false,
        message: 'Token refresh failed'
      });
    }
  }

  // Logout
  async logout(req, res) {
    try {
      const { refreshToken } = req.body;
      
      if (refreshToken) {
        const connection = getConnection();
        await connection.execute(
          'DELETE FROM refresh_tokens WHERE token = ?',
          [refreshToken]
        );
      }

      res.json({
        success: true,
        message: 'Logout successful'
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Logout failed'
      });
    }
  }

  // Get current user profile
  async getProfile(req, res) {
    try {
      const connection = getConnection();
      const [users] = await connection.execute(`
        SELECT u.id, u.username, u.email, u.first_name, u.last_name, 
               r.name as role_name, u.created_at, u.last_login
        FROM users u 
        JOIN roles r ON u.role_id = r.id 
        WHERE u.id = ?
      `, [req.user.id]);

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const user = users[0];
      res.json({
        success: true,
        data: {
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role_name,
          createdAt: user.created_at,
          lastLogin: user.last_login
        }
      });
    } catch (error) {
      console.error('Profile fetch error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch profile'
      });
    }
  }
}

module.exports = new AuthController();
