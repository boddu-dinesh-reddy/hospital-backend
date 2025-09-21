const bcrypt = require('bcryptjs');
const { getConnection } = require('../config/database');

class StaffController {
  // Get all staff members
  async getAllStaff(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      const search = req.query.search || '';
      const role = req.query.role || '';

      const connection = getConnection();

      // Build where clause
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
      const [countResult] = await connection.execute(`
        SELECT COUNT(*) as total 
        FROM users u 
        JOIN roles r ON u.role_id = r.id 
        WHERE ${whereClause}
      `, queryParams);
      
      const total = countResult[0].total;

      // Get staff with pagination
      const [staff] = await connection.execute(`
        SELECT u.id, u.username, u.email, u.first_name, u.last_name, 
               u.phone, u.created_at, u.last_login, u.is_active,
               r.name as role_name, r.id as role_id,
               s.specialization, s.license_number, s.schedule
        FROM users u 
        JOIN roles r ON u.role_id = r.id
        LEFT JOIN staff s ON u.id = s.user_id
        WHERE ${whereClause}
        ORDER BY u.created_at DESC 
        LIMIT ? OFFSET ?
      `, [...queryParams, limit, offset]);

      res.json({
        success: true,
        data: {
          staff,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            itemsPerPage: limit
          }
        }
      });
    } catch (error) {
      console.error('Get staff error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch staff'
      });
    }
  }

  // Get staff member by ID
  async getStaffById(req, res) {
    try {
      const staffId = req.params.id;
      const connection = getConnection();

      const [staff] = await connection.execute(`
        SELECT u.id, u.username, u.email, u.first_name, u.last_name, 
               u.phone, u.created_at, u.last_login, u.is_active,
               r.name as role_name, r.id as role_id,
               s.specialization, s.license_number, s.schedule, s.qualification
        FROM users u 
        JOIN roles r ON u.role_id = r.id
        LEFT JOIN staff s ON u.id = s.user_id
        WHERE u.id = ? AND u.is_active = 1
      `, [staffId]);

      if (staff.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Staff member not found'
        });
      }

      // Get recent appointments for doctors
      let recentAppointments = [];
      if (staff[0].role_name === 'Doctor') {
        const [appointments] = await connection.execute(`
          SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name
          FROM appointments a
          JOIN patients p ON a.patient_id = p.id
          WHERE a.doctor_id = ?
          ORDER BY a.appointment_date DESC, a.appointment_time DESC
          LIMIT 5
        `, [staffId]);
        recentAppointments = appointments;
      }

      res.json({
        success: true,
        data: {
          staff: staff[0],
          recentAppointments
        }
      });
    } catch (error) {
      console.error('Get staff by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch staff member'
      });
    }
  }

  // Create new staff member
  async createStaff(req, res) {
    try {
      const {
        username, email, password, firstName, lastName, phone, roleId,
        specialization, licenseNumber, qualification, schedule
      } = req.body;

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

      // Start transaction
      await connection.beginTransaction();

      try {
        // Create user
        const [userResult] = await connection.execute(`
          INSERT INTO users (username, email, password, first_name, last_name, phone, role_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [username, email, hashedPassword, firstName, lastName, phone, roleId]);

        const userId = userResult.insertId;

        // Create staff record
        await connection.execute(`
          INSERT INTO staff (user_id, specialization, license_number, qualification, schedule)
          VALUES (?, ?, ?, ?, ?)
        `, [userId, specialization, licenseNumber, qualification, JSON.stringify(schedule)]);

        // Commit transaction
        await connection.commit();

        // Get created staff with role
        const [staff] = await connection.execute(`
          SELECT u.id, u.username, u.email, u.first_name, u.last_name, 
                 u.phone, r.name as role_name,
                 s.specialization, s.license_number, s.qualification
          FROM users u 
          JOIN roles r ON u.role_id = r.id
          JOIN staff s ON u.id = s.user_id
          WHERE u.id = ?
        `, [userId]);

        // Log audit
        await connection.execute(`
          INSERT INTO audit_logs (user_id, action, table_name, record_id, changes)
          VALUES (?, 'CREATE', 'users', ?, ?)
        `, [req.user.id, userId, JSON.stringify({ created: staff[0] })]);

        res.status(201).json({
          success: true,
          message: 'Staff member created successfully',
          data: staff[0]
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Create staff error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create staff member'
      });
    }
  }

  // Update staff member
  async updateStaff(req, res) {
    try {
      const staffId = req.params.id;
      const updateData = req.body;
      const connection = getConnection();

      // Get current staff data
      const [currentStaff] = await connection.execute(`
        SELECT u.*, s.specialization, s.license_number, s.qualification, s.schedule
        FROM users u 
        LEFT JOIN staff s ON u.id = s.user_id
        WHERE u.id = ? AND u.is_active = 1
      `, [staffId]);

      if (currentStaff.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Staff member not found'
        });
      }

      await connection.beginTransaction();

      try {
        // Update user table
        const userFields = ['firstName', 'lastName', 'email', 'phone'];
        const userUpdates = [];
        const userValues = [];

        userFields.forEach(field => {
          if (updateData[field] !== undefined) {
            const dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
            userUpdates.push(`${dbField} = ?`);
            userValues.push(updateData[field]);
          }
        });

        if (userUpdates.length > 0) {
          userUpdates.push('updated_at = NOW()');
          userValues.push(staffId);
          
          await connection.execute(
            `UPDATE users SET ${userUpdates.join(', ')} WHERE id = ?`,
            userValues
          );
        }

        // Update staff table
        const staffFields = ['specialization', 'licenseNumber', 'qualification', 'schedule'];
        const staffUpdates = [];
        const staffValues = [];

        staffFields.forEach(field => {
          if (updateData[field] !== undefined) {
            const dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
            staffUpdates.push(`${dbField} = ?`);
            if (field === 'schedule') {
              staffValues.push(JSON.stringify(updateData[field]));
            } else {
              staffValues.push(updateData[field]);
            }
          }
        });

        if (staffUpdates.length > 0) {
          staffValues.push(staffId);
          
          await connection.execute(
            `UPDATE staff SET ${staffUpdates.join(', ')} WHERE user_id = ?`,
            staffValues
          );
        }

        await connection.commit();

        // Get updated staff
        const [updatedStaff] = await connection.execute(`
          SELECT u.id, u.username, u.email, u.first_name, u.last_name, 
                 u.phone, r.name as role_name,
                 s.specialization, s.license_number, s.qualification
          FROM users u 
          JOIN roles r ON u.role_id = r.id
          LEFT JOIN staff s ON u.id = s.user_id
          WHERE u.id = ?
        `, [staffId]);

        // Log audit
        await connection.execute(`
          INSERT INTO audit_logs (user_id, action, table_name, record_id, changes)
          VALUES (?, 'UPDATE', 'users', ?, ?)
        `, [req.user.id, staffId, JSON.stringify({
          before: currentStaff[0],
          after: updatedStaff[0]
        })]);

        res.json({
          success: true,
          message: 'Staff member updated successfully',
          data: updatedStaff[0]
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Update staff error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update staff member'
      });
    }
  }

  // Get all doctors
  async getDoctors(req, res) {
    try {
      const connection = getConnection();

      const [doctors] = await connection.execute(`
        SELECT u.id, u.first_name, u.last_name, u.email, u.phone,
               s.specialization, s.license_number,
               (SELECT COUNT(*) FROM appointments a WHERE a.doctor_id = u.id AND a.appointment_date >= CURDATE()) as upcoming_appointments
        FROM users u 
        JOIN roles r ON u.role_id = r.id
        JOIN staff s ON u.id = s.user_id
        WHERE r.name = 'Doctor' AND u.is_active = 1
        ORDER BY u.first_name, u.last_name
      `);

      res.json({
        success: true,
        data: doctors
      });
    } catch (error) {
      console.error('Get doctors error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch doctors'
      });
    }
  }

  // Get doctor's schedule
  async getDoctorSchedule(req, res) {
    try {
      const doctorId = req.params.id;
      const date = req.query.date || new Date().toISOString().split('T')[0];
      
      const connection = getConnection();

      // Get doctor's appointments for the day
      const [appointments] = await connection.execute(`
        SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        WHERE a.doctor_id = ? AND DATE(a.appointment_date) = ?
        ORDER BY a.appointment_time
      `, [doctorId, date]);

      // Get doctor's working schedule
      const [doctorInfo] = await connection.execute(`
        SELECT s.schedule FROM staff s WHERE s.user_id = ?
      `, [doctorId]);

      let schedule = {};
      if (doctorInfo.length > 0 && doctorInfo[0].schedule) {
        try {
          schedule = JSON.parse(doctorInfo[0].schedule);
        } catch (e) {
          console.error('Error parsing schedule:', e);
        }
      }

      res.json({
        success: true,
        data: {
          date,
          appointments,
          workingHours: schedule[new Date(date).toLocaleDateString('en', { weekday: 'long' })] || null
        }
      });
    } catch (error) {
      console.error('Get doctor schedule error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch doctor schedule'
      });
    }
  }
}

module.exports = new StaffController();
