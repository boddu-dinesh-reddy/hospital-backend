const bcrypt = require('bcryptjs');
const { getConnection } = require('../config/database');

class User {
  constructor(data = {}) {
    this.id = data.id || null;
    this.username = data.username || '';
    this.email = data.email || '';
    this.password = data.password || '';
    this.firstName = data.first_name || data.firstName || '';
    this.lastName = data.last_name || data.lastName || '';
    this.phone = data.phone || null;
    this.roleId = data.role_id || data.roleId || null;
    this.roleName = data.role_name || data.roleName || null;
    this.isActive = data.is_active || data.isActive || true;
    this.lastLogin = data.last_login || data.lastLogin || null;
    this.createdAt = data.created_at || data.createdAt || null;
    this.updatedAt = data.updated_at || data.updatedAt || null;
  }

  // Hash password before saving
  async hashPassword() {
    if (this.password) {
      this.password = await bcrypt.hash(this.password, 12);
    }
  }

  // Compare password
  async comparePassword(plainPassword) {
    return await bcrypt.compare(plainPassword, this.password);
  }

  // Save user
  async save() {
    try {
      const connection = getConnection();
      
      if (this.id) {
        // Update existing user
        const [result] = await connection.execute(`
          UPDATE users SET 
            username = ?, email = ?, first_name = ?, last_name = ?, 
            phone = ?, role_id = ?, updated_at = NOW()
          WHERE id = ?
        `, [
          this.username, this.email, this.firstName, this.lastName,
          this.phone, this.roleId, this.id
        ]);
        
        return result.affectedRows > 0;
      } else {
        // Create new user
        await this.hashPassword();
        
        const [result] = await connection.execute(`
          INSERT INTO users (
            username, email, password, first_name, last_name, phone, role_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          this.username, this.email, this.password, this.firstName,
          this.lastName, this.phone, this.roleId
        ]);
        
        this.id = result.insertId;
        return this;
      }
    } catch (error) {
      console.error('Error saving user:', error);
      throw error;
    }
  }

  // Find user by ID
  static async findById(id) {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT u.*, r.name as role_name
        FROM users u 
        JOIN roles r ON u.role_id = r.id 
        WHERE u.id = ? AND u.is_active = 1
      `, [id]);
      
      return rows.length > 0 ? new User(rows[0]) : null;
    } catch (error) {
      console.error('Error finding user by ID:', error);
      throw error;
    }
  }

  // Find user by username
  static async findByUsername(username) {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT u.*, r.name as role_name
        FROM users u 
        JOIN roles r ON u.role_id = r.id 
        WHERE u.username = ? AND u.is_active = 1
      `, [username]);
      
      return rows.length > 0 ? new User(rows[0]) : null;
    } catch (error) {
      console.error('Error finding user by username:', error);
      throw error;
    }
  }

  // Find user by email
  static async findByEmail(email) {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT u.*, r.name as role_name
        FROM users u 
        JOIN roles r ON u.role_id = r.id 
        WHERE u.email = ? AND u.is_active = 1
      `, [email]);
      
      return rows.length > 0 ? new User(rows[0]) : null;
    } catch (error) {
      console.error('Error finding user by email:', error);
      throw error;
    }
  }

  // Find all users with pagination
  static async findAll(options = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        search = '',
        role = '',
        sortBy = 'created_at',
        sortOrder = 'DESC'
      } = options;
      
      const offset = (page - 1) * limit;
      const connection = getConnection();
      
      let whereClause = 'u.is_active = 1';
      let queryParams = [];
      
      if (search) {
        whereClause += ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.username LIKE ?)`;
        const searchTerm = `%${search}%`;
        queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
      }
      
      if (role) {
        whereClause += ` AND r.name = ?`;
        queryParams.push(role);
      }
      
      // Get total count
      const [countResult] = await connection.execute(
        `SELECT COUNT(*) as total FROM users u JOIN roles r ON u.role_id = r.id WHERE ${whereClause}`,
        queryParams
      );
      
      // Get users
      const [rows] = await connection.execute(`
        SELECT u.id, u.username, u.email, u.first_name, u.last_name, 
               u.phone, u.created_at, u.last_login, u.is_active,
               r.name as role_name, r.id as role_id
        FROM users u 
        JOIN roles r ON u.role_id = r.id
        WHERE ${whereClause}
        ORDER BY u.${sortBy} ${sortOrder}
        LIMIT ? OFFSET ?
      `, [...queryParams, limit, offset]);
      
      const users = rows.map(row => new User(row));
      
      return {
        users,
        total: countResult[0].total,
        page,
        limit,
        totalPages: Math.ceil(countResult[0].total / limit)
      };
    } catch (error) {
      console.error('Error finding all users:', error);
      throw error;
    }
  }

  // Check if username or email exists
  static async findByUsernameOrEmail(username, email) {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(
        'SELECT id FROM users WHERE username = ? OR email = ?',
        [username, email]
      );
      
      return rows.length > 0;
    } catch (error) {
      console.error('Error checking username or email:', error);
      throw error;
    }
  }

  // Get user permissions
  async getPermissions() {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT DISTINCT p.name as permission_name, p.description
        FROM users u
        JOIN roles r ON u.role_id = r.id
        JOIN role_permissions rp ON r.id = rp.role_id
        JOIN permissions p ON rp.permission_id = p.id
        WHERE u.id = ? AND u.is_active = 1
      `, [this.id]);
      
      return rows.map(row => row.permission_name);
    } catch (error) {
      console.error('Error getting user permissions:', error);
      throw error;
    }
  }

  // Update last login
  async updateLastLogin() {
    try {
      const connection = getConnection();
      await connection.execute(
        'UPDATE users SET last_login = NOW() WHERE id = ?',
        [this.id]
      );
      this.lastLogin = new Date();
    } catch (error) {
      console.error('Error updating last login:', error);
      throw error;
    }
  }

  // Deactivate user
  async deactivate() {
    try {
      const connection = getConnection();
      const [result] = await connection.execute(
        'UPDATE users SET is_active = 0, updated_at = NOW() WHERE id = ?',
        [this.id]
      );
      
      if (result.affectedRows > 0) {
        this.isActive = false;
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error deactivating user:', error);
      throw error;
    }
  }

  // Get user's staff info
  async getStaffInfo() {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT s.specialization, s.license_number, s.qualification, s.schedule
        FROM staff s
        WHERE s.user_id = ?
      `, [this.id]);
      
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting staff info:', error);
      throw error;
    }
  }

  // Get doctors only
  static async getDoctors() {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT u.id, u.first_name, u.last_name, u.email, u.phone,
               s.specialization, s.license_number,
               (SELECT COUNT(*) FROM appointments a WHERE a.doctor_id = u.id AND a.appointment_date >= CURDATE()) as upcoming_appointments
        FROM users u 
        JOIN roles r ON u.role_id = r.id
        LEFT JOIN staff s ON u.id = s.user_id
        WHERE r.name = 'Doctor' AND u.is_active = 1
        ORDER BY u.first_name, u.last_name
      `);
      
      return rows.map(row => new User(row));
    } catch (error) {
      console.error('Error getting doctors:', error);
      throw error;
    }
  }

  // Convert to JSON (exclude password)
  toJSON() {
    const json = { ...this };
    delete json.password;
    return json;
  }
}

module.exports = User;
