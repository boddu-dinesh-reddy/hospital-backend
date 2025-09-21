const { getConnection } = require('../config/database');

class Appointment {
  constructor(data = {}) {
    this.id = data.id || null;
    this.appointmentNumber = data.appointment_number || data.appointmentNumber || null;
    this.patientId = data.patient_id || data.patientId || null;
    this.doctorId = data.doctor_id || data.doctorId || null;
    this.appointmentDate = data.appointment_date || data.appointmentDate || null;
    this.appointmentTime = data.appointment_time || data.appointmentTime || null;
    this.type = data.type || 'Consultation';
    this.status = data.status || 'Scheduled';
    this.reason = data.reason || null;
    this.diagnosis = data.diagnosis || null;
    this.treatment = data.treatment || null;
    this.prescription = data.prescription || null;
    this.notes = data.notes || null;
    this.cancellationReason = data.cancellation_reason || data.cancellationReason || null;
    this.createdBy = data.created_by || data.createdBy || null;
    this.createdAt = data.created_at || data.createdAt || null;
    this.updatedAt = data.updated_at || data.updatedAt || null;
    
    // Related data
    this.patientFirstName = data.patient_first_name || data.patientFirstName || null;
    this.patientLastName = data.patient_last_name || data.patientLastName || null;
    this.patientPhone = data.patient_phone || data.patientPhone || null;
    this.patientEmail = data.patient_email || data.patientEmail || null;
    this.doctorFirstName = data.doctor_first_name || data.doctorFirstName || null;
    this.doctorLastName = data.doctor_last_name || data.doctorLastName || null;
    this.doctorSpecialization = data.doctor_specialization || data.doctorSpecialization || null;
  }

  // Save appointment
  async save() {
    try {
      const connection = getConnection();
      
      if (this.id) {
        // Update existing appointment
        const [result] = await connection.execute(`
          UPDATE appointments SET 
            patient_id = ?, doctor_id = ?, appointment_date = ?, appointment_time = ?,
            type = ?, status = ?, reason = ?, diagnosis = ?, treatment = ?,
            prescription = ?, notes = ?, cancellation_reason = ?, updated_at = NOW()
          WHERE id = ?
        `, [
          this.patientId, this.doctorId, this.appointmentDate, this.appointmentTime,
          this.type, this.status, this.reason, this.diagnosis, this.treatment,
          this.prescription, this.notes, this.cancellationReason, this.id
        ]);
        
        return result.affectedRows > 0;
      } else {
        // Create new appointment
        if (!this.appointmentNumber) {
          this.appointmentNumber = await Appointment.generateAppointmentNumber();
        }
        
        const [result] = await connection.execute(`
          INSERT INTO appointments (
            appointment_number, patient_id, doctor_id, appointment_date, appointment_time,
            type, status, reason, notes, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          this.appointmentNumber, this.patientId, this.doctorId, this.appointmentDate,
          this.appointmentTime, this.type, this.status, this.reason, this.notes, this.createdBy
        ]);
        
        this.id = result.insertId;
        return this;
      }
    } catch (error) {
      console.error('Error saving appointment:', error);
      throw error;
    }
  }

  // Find appointment by ID
  static async findById(id) {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT a.*, 
               p.first_name as patient_first_name, p.last_name as patient_last_name,
               p.phone as patient_phone, p.email as patient_email, p.date_of_birth,
               p.medical_history, p.allergies, p.blood_group,
               d.first_name as doctor_first_name, d.last_name as doctor_last_name,
               s.specialization as doctor_specialization
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN users d ON a.doctor_id = d.id
        LEFT JOIN staff s ON d.id = s.user_id
        WHERE a.id = ?
      `, [id]);
      
      return rows.length > 0 ? new Appointment(rows[0]) : null;
    } catch (error) {
      console.error('Error finding appointment by ID:', error);
      throw error;
    }
  }

  // Find all appointments with pagination
  static async findAll(options = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        status = '',
        doctorId = '',
        patientId = '',
        date = '',
        sortBy = 'appointment_date',
        sortOrder = 'DESC'
      } = options;
      
      const offset = (page - 1) * limit;
      const connection = getConnection();
      
      let whereClause = '1 = 1';
      let queryParams = [];
      
      if (status) {
        whereClause += ' AND a.status = ?';
        queryParams.push(status);
      }
      
      if (doctorId) {
        whereClause += ' AND a.doctor_id = ?';
        queryParams.push(doctorId);
      }
      
      if (patientId) {
        whereClause += ' AND a.patient_id = ?';
        queryParams.push(patientId);
      }
      
      if (date) {
        whereClause += ' AND DATE(a.appointment_date) = ?';
        queryParams.push(date);
      }
      
      // Get total count
      const [countResult] = await connection.execute(
        `SELECT COUNT(*) as total FROM appointments a WHERE ${whereClause}`,
        queryParams
      );
      
      // Get appointments
      const [rows] = await connection.execute(`
        SELECT a.*, 
               p.first_name as patient_first_name, p.last_name as patient_last_name,
               p.phone as patient_phone, p.email as patient_email,
               d.first_name as doctor_first_name, d.last_name as doctor_last_name,
               s.specialization as doctor_specialization
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN users d ON a.doctor_id = d.id
        LEFT JOIN staff s ON d.id = s.user_id
        WHERE ${whereClause}
        ORDER BY a.${sortBy} ${sortOrder}, a.appointment_time ${sortOrder}
        LIMIT ? OFFSET ?
      `, [...queryParams, limit, offset]);
      
      const appointments = rows.map(row => new Appointment(row));
      
      return {
        appointments,
        total: countResult[0].total,
        page,
        limit,
        totalPages: Math.ceil(countResult[0].total / limit)
      };
    } catch (error) {
      console.error('Error finding all appointments:', error);
      throw error;
    }
  }

  // Check if time slot is available
  static async isTimeSlotAvailable(doctorId, appointmentDate, appointmentTime, excludeAppointmentId = null) {
    try {
      const connection = getConnection();
      
      let whereClause = 'doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status != "Cancelled"';
      let queryParams = [doctorId, appointmentDate, appointmentTime];
      
      if (excludeAppointmentId) {
        whereClause += ' AND id != ?';
        queryParams.push(excludeAppointmentId);
      }
      
      const [rows] = await connection.execute(
        `SELECT id FROM appointments WHERE ${whereClause}`,
        queryParams
      );
      
      return rows.length === 0;
    } catch (error) {
      console.error('Error checking time slot availability:', error);
      throw error;
    }
  }

  // Get available time slots for a doctor on a specific date
  static async getAvailableSlots(doctorId, date) {
    try {
      const connection = getConnection();
      
      // Get doctor's working hours
      const [doctorInfo] = await connection.execute(
        'SELECT schedule FROM staff WHERE user_id = ?',
        [doctorId]
      );
      
      if (doctorInfo.length === 0) {
        return [];
      }
      
      // Get booked slots
      const [bookedSlots] = await connection.execute(
        'SELECT appointment_time FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND status != "Cancelled"',
        [doctorId, date]
      );
      
      const bookedTimes = bookedSlots.map(slot => slot.appointment_time);
      
      // Parse schedule and generate available slots
      let schedule = {};
      if (doctorInfo[0].schedule) {
        try {
          schedule = JSON.parse(doctorInfo[0].schedule);
        } catch (e) {
          console.error('Error parsing doctor schedule:', e);
          return [];
        }
      }
      
      const dayOfWeek = new Date(date).toLocaleDateString('en', { weekday: 'long' });
      const daySchedule = schedule[dayOfWeek];
      
      if (!daySchedule || !daySchedule.working) {
        return [];
      }
      
      // Generate time slots
      const slots = [];
      const startTime = daySchedule.start || '09:00';
      const endTime = daySchedule.end || '17:00';
      const slotDuration = 30; // minutes
      
      const [startHour, startMinute] = startTime.split(':').map(Number);
      const [endHour, endMinute] = endTime.split(':').map(Number);
      
      let currentHour = startHour;
      let currentMinute = startMinute;
      
      while (currentHour < endHour || (currentHour === endHour && currentMinute < endMinute)) {
        const timeSlot = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}:00`;
        
        if (!bookedTimes.includes(timeSlot)) {
          slots.push(timeSlot);
        }
        
        currentMinute += slotDuration;
        if (currentMinute >= 60) {
          currentHour += Math.floor(currentMinute / 60);
          currentMinute = currentMinute % 60;
        }
      }
      
      return slots;
    } catch (error) {
      console.error('Error getting available slots:', error);
      throw error;
    }
  }

  // Get daily schedule
  static async getDailySchedule(date) {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT a.*, 
               p.first_name as patient_first_name, p.last_name as patient_last_name,
               p.phone as patient_phone,
               d.first_name as doctor_first_name, d.last_name as doctor_last_name,
               s.specialization as doctor_specialization
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN users d ON a.doctor_id = d.id
        LEFT JOIN staff s ON d.id = s.user_id
        WHERE DATE(a.appointment_date) = ? AND a.status != 'Cancelled'
        ORDER BY a.appointment_time
      `, [date]);
      
      return rows.map(row => new Appointment(row));
    } catch (error) {
      console.error('Error getting daily schedule:', error);
      throw error;
    }
  }

  // Cancel appointment
  async cancel(reason = '') {
    try {
      this.status = 'Cancelled';
      this.cancellationReason = reason;
      return await this.save();
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      throw error;
    }
  }

  // Complete appointment
  async complete(diagnosis = '', treatment = '', prescription = '') {
    try {
      this.status = 'Completed';
      this.diagnosis = diagnosis;
      this.treatment = treatment;
      this.prescription = prescription;
      return await this.save();
    } catch (error) {
      console.error('Error completing appointment:', error);
      throw error;
    }
  }

  // Generate appointment number
  static async generateAppointmentNumber() {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(
        'SELECT appointment_number FROM appointments ORDER BY id DESC LIMIT 1'
      );
      
      if (rows.length === 0) {
        return 'APT0001';
      }
      
      const lastNumber = parseInt(rows[0].appointment_number.substring(3));
      return 'APT' + String(lastNumber + 1).padStart(4, '0');
    } catch (error) {
      console.error('Error generating appointment number:', error);
      throw error;
    }
  }

  // Get upcoming appointments for a doctor
  static async getUpcomingForDoctor(doctorId, limit = 10) {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT a.*, 
               p.first_name as patient_first_name, p.last_name as patient_last_name,
               p.phone as patient_phone
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        WHERE a.doctor_id = ? AND a.appointment_date >= CURDATE() AND a.status = 'Scheduled'
        ORDER BY a.appointment_date, a.appointment_time
        LIMIT ?
      `, [doctorId, limit]);
      
      return rows.map(row => new Appointment(row));
    } catch (error) {
      console.error('Error getting upcoming appointments for doctor:', error);
      throw error;
    }
  }

  // Get upcoming appointments for a patient
  static async getUpcomingForPatient(patientId, limit = 10) {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT a.*, 
               d.first_name as doctor_first_name, d.last_name as doctor_last_name,
               s.specialization as doctor_specialization
        FROM appointments a
        JOIN users d ON a.doctor_id = d.id
        LEFT JOIN staff s ON d.id = s.user_id
        WHERE a.patient_id = ? AND a.appointment_date >= CURDATE() AND a.status = 'Scheduled'
        ORDER BY a.appointment_date, a.appointment_time
        LIMIT ?
      `, [patientId, limit]);
      
      return rows.map(row => new Appointment(row));
    } catch (error) {
      console.error('Error getting upcoming appointments for patient:', error);
      throw error;
    }
  }
}

module.exports = Appointment;
