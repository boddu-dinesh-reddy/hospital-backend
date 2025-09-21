const { getConnection } = require('../config/database');

class PatientController {
  // Get all patients with pagination
  async getAllPatients(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      const search = req.query.search || '';

      const connection = getConnection();

      // Build search condition
      let whereClause = '1 = 1';
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
      const total = countResult[0].total;

      // Get patients with pagination
      const [patients] = await connection.execute(
        `SELECT p.*, 
         TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) as age,
         (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id) as appointment_count
         FROM patients p 
         WHERE ${whereClause}
         ORDER BY p.created_at DESC 
         LIMIT ? OFFSET ?`,
        [...queryParams, limit, offset]
      );

      res.json({
        success: true,
        data: {
          patients,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            itemsPerPage: limit
          }
        }
      });
    } catch (error) {
      console.error('Get patients error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch patients'
      });
    }
  }

  // Get patient by ID
  async getPatientById(req, res) {
    try {
      const patientId = req.params.id;
      const connection = getConnection();

      const [patients] = await connection.execute(`
        SELECT p.*,
        TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) as age,
        (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id) as appointment_count,
        (SELECT COUNT(*) FROM billing b WHERE b.patient_id = p.id AND b.payment_status = 'Pending') as pending_bills
        FROM patients p 
        WHERE p.id = ?
      `, [patientId]);

      if (patients.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Patient not found'
        });
      }

      // Get recent appointments
      const [appointments] = await connection.execute(`
        SELECT a.*, u.first_name as doctor_first_name, u.last_name as doctor_last_name
        FROM appointments a
        JOIN users u ON a.doctor_id = u.id
        WHERE a.patient_id = ?
        ORDER BY a.appointment_date DESC, a.appointment_time DESC
        LIMIT 5
      `, [patientId]);

      // Get lab results
      const [labResults] = await connection.execute(`
        SELECT * FROM lab_results 
        WHERE patient_id = ?
        ORDER BY test_date DESC
        LIMIT 5
      `, [patientId]);

      res.json({
        success: true,
        data: {
          patient: patients[0],
          recentAppointments: appointments,
          recentLabResults: labResults
        }
      });
    } catch (error) {
      console.error('Get patient error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch patient'
      });
    }
  }

  // Create new patient
  async createPatient(req, res) {
    try {
      const {
        firstName, lastName, dateOfBirth, gender, phone, email,
        address, emergencyContact, emergencyPhone, medicalHistory,
        allergies, bloodGroup, insuranceInfo
      } = req.body;

      const connection = getConnection();

      // Check if patient with same phone or email exists
      const [existing] = await connection.execute(
        'SELECT id FROM patients WHERE phone = ? OR (email IS NOT NULL AND email = ?)',
        [phone, email]
      );

      if (existing.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Patient with this phone number or email already exists'
        });
      }

      // Generate patient ID
      const [lastPatient] = await connection.execute(
        'SELECT patient_id FROM patients ORDER BY id DESC LIMIT 1'
      );
      
      let nextPatientId = 'P0001';
      if (lastPatient.length > 0) {
        const lastId = parseInt(lastPatient[0].patient_id.substring(1));
        nextPatientId = 'P' + String(lastId + 1).padStart(4, '0');
      }

      const [result] = await connection.execute(`
        INSERT INTO patients (
          patient_id, first_name, last_name, date_of_birth, gender, phone, email,
          address, emergency_contact, emergency_phone, medical_history,
          allergies, blood_group, insurance_info, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        nextPatientId, firstName, lastName, dateOfBirth, gender, phone, email,
        address, emergencyContact, emergencyPhone, medicalHistory,
        allergies, bloodGroup, JSON.stringify(insuranceInfo), req.user.id
      ]);

      // Get created patient
      const [patients] = await connection.execute(
        'SELECT * FROM patients WHERE id = ?',
        [result.insertId]
      );

      // Log audit
      await connection.execute(`
        INSERT INTO audit_logs (user_id, action, table_name, record_id, changes)
        VALUES (?, 'CREATE', 'patients', ?, ?)
      `, [req.user.id, result.insertId, JSON.stringify({ created: patients[0] })]);

      res.status(201).json({
        success: true,
        message: 'Patient created successfully',
        data: patients[0]
      });
    } catch (error) {
      console.error('Create patient error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create patient'
      });
    }
  }

  // Update patient
  async updatePatient(req, res) {
    try {
      const patientId = req.params.id;
      const updateData = req.body;
      const connection = getConnection();

      // Get current patient data
      const [currentPatients] = await connection.execute(
        'SELECT * FROM patients WHERE id = ?',
        [patientId]
      );

      if (currentPatients.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Patient not found'
        });
      }

      // Build update query dynamically
      const allowedFields = [
        'first_name', 'last_name', 'date_of_birth', 'gender', 'phone', 'email',
        'address', 'emergency_contact', 'emergency_phone', 'medical_history',
        'allergies', 'blood_group', 'insurance_info'
      ];

      const updates = [];
      const values = [];

      Object.keys(updateData).forEach(key => {
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (allowedFields.includes(dbField)) {
          updates.push(`${dbField} = ?`);
          if (key === 'insuranceInfo') {
            values.push(JSON.stringify(updateData[key]));
          } else {
            values.push(updateData[key]);
          }
        }
      });

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid fields to update'
        });
      }

      updates.push('updated_at = NOW()');
      values.push(patientId);

      await connection.execute(
        `UPDATE patients SET ${updates.join(', ')} WHERE id = ?`,
        values
      );

      // Get updated patient
      const [updatedPatients] = await connection.execute(
        'SELECT * FROM patients WHERE id = ?',
        [patientId]
      );

      // Log audit
      await connection.execute(`
        INSERT INTO audit_logs (user_id, action, table_name, record_id, changes)
        VALUES (?, 'UPDATE', 'patients', ?, ?)
      `, [req.user.id, patientId, JSON.stringify({
        before: currentPatients[0],
        after: updatedPatients[0]
      })]);

      res.json({
        success: true,
        message: 'Patient updated successfully',
        data: updatedPatients[0]
      });
    } catch (error) {
      console.error('Update patient error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update patient'
      });
    }
  }

  // Delete patient (soft delete)
  async deletePatient(req, res) {
    try {
      const patientId = req.params.id;
      const connection = getConnection();

      // Check if patient exists
      const [patients] = await connection.execute(
        'SELECT * FROM patients WHERE id = ?',
        [patientId]
      );

      if (patients.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Patient not found'
        });
      }

      // Check for active appointments
      const [activeAppointments] = await connection.execute(
        'SELECT COUNT(*) as count FROM appointments WHERE patient_id = ? AND appointment_date >= CURDATE()',
        [patientId]
      );

      if (activeAppointments[0].count > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete patient with active appointments'
        });
      }

      // Soft delete
      await connection.execute(
        'UPDATE patients SET is_active = 0, deleted_at = NOW() WHERE id = ?',
        [patientId]
      );

      // Log audit
      await connection.execute(`
        INSERT INTO audit_logs (user_id, action, table_name, record_id, changes)
        VALUES (?, 'DELETE', 'patients', ?, ?)
      `, [req.user.id, patientId, JSON.stringify({ deleted: patients[0] })]);

      res.json({
        success: true,
        message: 'Patient deleted successfully'
      });
    } catch (error) {
      console.error('Delete patient error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete patient'
      });
    }
  }

  // Get patient medical history
  async getPatientMedicalHistory(req, res) {
    try {
      const patientId = req.params.id;
      const connection = getConnection();

      // Get appointments with diagnoses and treatments
      const [history] = await connection.execute(`
        SELECT 
          a.appointment_date,
          a.appointment_time,
          a.diagnosis,
          a.treatment,
          a.notes,
          u.first_name as doctor_first_name,
          u.last_name as doctor_last_name,
          (SELECT GROUP_CONCAT(lr.test_name, ': ', lr.result SEPARATOR '; ')
           FROM lab_results lr 
           WHERE lr.patient_id = a.patient_id 
           AND DATE(lr.test_date) = DATE(a.appointment_date)
          ) as lab_results
        FROM appointments a
        JOIN users u ON a.doctor_id = u.id
        WHERE a.patient_id = ? AND a.status = 'Completed'
        ORDER BY a.appointment_date DESC, a.appointment_time DESC
      `, [patientId]);

      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      console.error('Get medical history error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch medical history'
      });
    }
  }
}

module.exports = new PatientController();
