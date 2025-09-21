const { getConnection } = require('../config/database');

class Patient {
  constructor(data = {}) {
    this.id = data.id || null;
    this.patientId = data.patient_id || data.patientId || null;
    this.firstName = data.first_name || data.firstName || '';
    this.lastName = data.last_name || data.lastName || '';
    this.dateOfBirth = data.date_of_birth || data.dateOfBirth || null;
    this.gender = data.gender || '';
    this.phone = data.phone || '';
    this.email = data.email || null;
    this.address = data.address || null;
    this.emergencyContact = data.emergency_contact || data.emergencyContact || null;
    this.emergencyPhone = data.emergency_phone || data.emergencyPhone || null;
    this.medicalHistory = data.medical_history || data.medicalHistory || null;
    this.allergies = data.allergies || null;
    this.bloodGroup = data.blood_group || data.bloodGroup || null;
    this.insuranceInfo = data.insurance_info || data.insuranceInfo || null;
    this.isActive = data.is_active || data.isActive || true;
    this.createdBy = data.created_by || data.createdBy || null;
    this.createdAt = data.created_at || data.createdAt || null;
    this.updatedAt = data.updated_at || data.updatedAt || null;
    this.deletedAt = data.deleted_at || data.deletedAt || null;
  }

  // Create a new patient
  async save() {
    try {
      const connection = getConnection();
      
      if (this.id) {
        // Update existing patient
        const [result] = await connection.execute(`
          UPDATE patients SET 
            first_name = ?, last_name = ?, date_of_birth = ?, gender = ?, 
            phone = ?, email = ?, address = ?, emergency_contact = ?, 
            emergency_phone = ?, medical_history = ?, allergies = ?, 
            blood_group = ?, insurance_info = ?, updated_at = NOW()
          WHERE id = ?
        `, [
          this.firstName, this.lastName, this.dateOfBirth, this.gender,
          this.phone, this.email, this.address, this.emergencyContact,
          this.emergencyPhone, this.medicalHistory, this.allergies,
          this.bloodGroup, JSON.stringify(this.insuranceInfo), this.id
        ]);
        
        return result.affectedRows > 0;
      } else {
        // Create new patient
        const [result] = await connection.execute(`
          INSERT INTO patients (
            patient_id, first_name, last_name, date_of_birth, gender, phone, email,
            address, emergency_contact, emergency_phone, medical_history,
            allergies, blood_group, insurance_info, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          this.patientId, this.firstName, this.lastName, this.dateOfBirth, this.gender,
          this.phone, this.email, this.address, this.emergencyContact,
          this.emergencyPhone, this.medicalHistory, this.allergies,
          this.bloodGroup, JSON.stringify(this.insuranceInfo), this.createdBy
        ]);
        
        this.id = result.insertId;
        return this;
      }
    } catch (error) {
      console.error('Error saving patient:', error);
      throw error;
    }
  }

  // Find patient by ID
  static async findById(id) {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT p.*, 
               TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) as age,
               u.first_name as created_by_first_name, u.last_name as created_by_last_name
        FROM patients p 
        LEFT JOIN users u ON p.created_by = u.id 
        WHERE p.id = ? AND p.is_active = 1
      `, [id]);
      
      return rows.length > 0 ? new Patient(rows[0]) : null;
    } catch (error) {
      console.error('Error finding patient by ID:', error);
      throw error;
    }
  }

  // Find patient by patient ID
  static async findByPatientId(patientId) {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT p.*, 
               TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) as age
        FROM patients p 
        WHERE p.patient_id = ? AND p.is_active = 1
      `, [patientId]);
      
      return rows.length > 0 ? new Patient(rows[0]) : null;
    } catch (error) {
      console.error('Error finding patient by patient ID:', error);
      throw error;
    }
  }

  // Find all patients with pagination
  static async findAll(options = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        search = '',
        sortBy = 'created_at',
        sortOrder = 'DESC'
      } = options;
      
      const offset = (page - 1) * limit;
      const connection = getConnection();
      
      let whereClause = 'p.is_active = 1';
      let queryParams = [];
      
      if (search) {
        whereClause += ` AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.email LIKE ? OR p.phone LIKE ?)`;
        const searchTerm = `%${search}%`;
        queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
      }
      
      // Get total count
      const [countResult] = await connection.execute(
        `SELECT COUNT(*) as total FROM patients p WHERE ${whereClause}`,
        queryParams
      );
      
      // Get patients
      const [rows] = await connection.execute(`
        SELECT p.*, 
               TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) as age,
               (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id) as appointment_count
        FROM patients p 
        WHERE ${whereClause}
        ORDER BY p.${sortBy} ${sortOrder}
        LIMIT ? OFFSET ?
      `, [...queryParams, limit, offset]);
      
      const patients = rows.map(row => new Patient(row));
      
      return {
        patients,
        total: countResult[0].total,
        page,
        limit,
        totalPages: Math.ceil(countResult[0].total / limit)
      };
    } catch (error) {
      console.error('Error finding all patients:', error);
      throw error;
    }
  }

  // Find by phone or email
  static async findByPhoneOrEmail(phone, email) {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(
        'SELECT * FROM patients WHERE (phone = ? OR (email IS NOT NULL AND email = ?)) AND is_active = 1',
        [phone, email]
      );
      
      return rows.length > 0 ? new Patient(rows[0]) : null;
    } catch (error) {
      console.error('Error finding patient by phone or email:', error);
      throw error;
    }
  }

  // Soft delete patient
  async delete() {
    try {
      const connection = getConnection();
      const [result] = await connection.execute(
        'UPDATE patients SET is_active = 0, deleted_at = NOW() WHERE id = ?',
        [this.id]
      );
      
      if (result.affectedRows > 0) {
        this.isActive = false;
        this.deletedAt = new Date();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error deleting patient:', error);
      throw error;
    }
  }

  // Get patient's medical history
  async getMedicalHistory() {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT 
          a.appointment_date,
          a.appointment_time,
          a.diagnosis,
          a.treatment,
          a.prescription,
          a.notes,
          u.first_name as doctor_first_name,
          u.last_name as doctor_last_name,
          s.specialization as doctor_specialization
        FROM appointments a
        JOIN users u ON a.doctor_id = u.id
        LEFT JOIN staff st ON u.id = st.user_id
        WHERE a.patient_id = ? AND a.status = 'Completed'
        ORDER BY a.appointment_date DESC, a.appointment_time DESC
      `, [this.id]);
      
      return rows;
    } catch (error) {
      console.error('Error getting medical history:', error);
      throw error;
    }
  }

  // Get patient's lab results
  async getLabResults() {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT * FROM lab_results 
        WHERE patient_id = ?
        ORDER BY test_date DESC
      `, [this.id]);
      
      return rows;
    } catch (error) {
      console.error('Error getting lab results:', error);
      throw error;
    }
  }

  // Get patient's appointments
  async getAppointments(status = null) {
    try {
      const connection = getConnection();
      
      let whereClause = 'a.patient_id = ?';
      let queryParams = [this.id];
      
      if (status) {
        whereClause += ' AND a.status = ?';
        queryParams.push(status);
      }
      
      const [rows] = await connection.execute(`
        SELECT a.*, 
               u.first_name as doctor_first_name, u.last_name as doctor_last_name,
               s.specialization as doctor_specialization
        FROM appointments a
        JOIN users u ON a.doctor_id = u.id
        LEFT JOIN staff s ON u.id = s.user_id
        WHERE ${whereClause}
        ORDER BY a.appointment_date DESC, a.appointment_time DESC
      `, queryParams);
      
      return rows;
    } catch (error) {
      console.error('Error getting appointments:', error);
      throw error;
    }
  }

  // Get patient's bills
  async getBills(status = null) {
    try {
      const connection = getConnection();
      
      let whereClause = 'b.patient_id = ?';
      let queryParams = [this.id];
      
      if (status) {
        whereClause += ' AND b.payment_status = ?';
        queryParams.push(status);
      }
      
      const [rows] = await connection.execute(`
        SELECT b.*, 
               u.first_name as created_by_first_name, u.last_name as created_by_last_name
        FROM billing b
        LEFT JOIN users u ON b.created_by = u.id
        WHERE ${whereClause}
        ORDER BY b.created_at DESC
      `, queryParams);
      
      return rows;
    } catch (error) {
      console.error('Error getting bills:', error);
      throw error;
    }
  }

  // Generate next patient ID
  static async generatePatientId() {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(
        'SELECT patient_id FROM patients ORDER BY id DESC LIMIT 1'
      );
      
      if (rows.length === 0) {
        return 'P0001';
      }
      
      const lastId = parseInt(rows[0].patient_id.substring(1));
      return 'P' + String(lastId + 1).padStart(4, '0');
    } catch (error) {
      console.error('Error generating patient ID:', error);
      throw error;
    }
  }

  // Convert to JSON for API responses
  toJSON() {
    const json = { ...this };
    
    // Parse insurance info if it's a string
    if (typeof json.insuranceInfo === 'string') {
      try {
        json.insuranceInfo = JSON.parse(json.insuranceInfo);
      } catch (e) {
        json.insuranceInfo = null;
      }
    }
    
    return json;
  }
}

module.exports = Patient;
