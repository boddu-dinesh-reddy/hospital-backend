const { getConnection } = require('../config/database');
const { sendEmail } = require('../services/emailService');
const { sendSMS } = require('../services/smsService');

class AppointmentController {
  // Get all appointments
  async getAllAppointments(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      const status = req.query.status || '';
      const doctorId = req.query.doctorId || '';
      const patientId = req.query.patientId || '';
      const date = req.query.date || '';

      const connection = getConnection();

      // Build where clause
      let whereClause = '1 = 1';
      let queryParams = [];

      if (status) {
        whereClause += ` AND a.status = ?`;
        queryParams.push(status);
      }

      if (doctorId) {
        whereClause += ` AND a.doctor_id = ?`;
        queryParams.push(doctorId);
      }

      if (patientId) {
        whereClause += ` AND a.patient_id = ?`;
        queryParams.push(patientId);
      }

      if (date) {
        whereClause += ` AND DATE(a.appointment_date) = ?`;
        queryParams.push(date);
      }

      // Get total count
      const [countResult] = await connection.execute(
        `SELECT COUNT(*) as total FROM appointments a WHERE ${whereClause}`,
        queryParams
      );
      const total = countResult[0].total;

      // Get appointments
      const [appointments] = await connection.execute(`
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
        ORDER BY a.appointment_date DESC, a.appointment_time DESC
        LIMIT ? OFFSET ?
      `, [...queryParams, limit, offset]);

      res.json({
        success: true,
        data: {
          appointments,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            itemsPerPage: limit
          }
        }
      });
    } catch (error) {
      console.error('Get appointments error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch appointments'
      });
    }
  }

  // Get appointment by ID
  async getAppointmentById(req, res) {
    try {
      const appointmentId = req.params.id;
      const connection = getConnection();

      const [appointments] = await connection.execute(`
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
      `, [appointmentId]);

      if (appointments.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Appointment not found'
        });
      }

      res.json({
        success: true,
        data: appointments[0]
      });
    } catch (error) {
      console.error('Get appointment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch appointment'
      });
    }
  }

  // Create new appointment
  async createAppointment(req, res) {
    try {
      const {
        patientId, doctorId, appointmentDate, appointmentTime,
        type, reason, notes
      } = req.body;

      const connection = getConnection();

      // Check if the time slot is available
      const [existingAppointments] = await connection.execute(
        'SELECT id FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status != "Cancelled"',
        [doctorId, appointmentDate, appointmentTime]
      );

      if (existingAppointments.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Time slot already booked'
        });
      }

      // Generate appointment number
      const [lastAppointment] = await connection.execute(
        'SELECT appointment_number FROM appointments ORDER BY id DESC LIMIT 1'
      );
      
      let nextAppointmentNumber = 'APT0001';
      if (lastAppointment.length > 0) {
        const lastNumber = parseInt(lastAppointment[0].appointment_number.substring(3));
        nextAppointmentNumber = 'APT' + String(lastNumber + 1).padStart(4, '0');
      }

      // Create appointment
      const [result] = await connection.execute(`
        INSERT INTO appointments (
          appointment_number, patient_id, doctor_id, appointment_date, appointment_time,
          type, reason, notes, status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', ?)
      `, [
        nextAppointmentNumber, patientId, doctorId, appointmentDate, appointmentTime,
        type, reason, notes, req.user.id
      ]);

      // Get created appointment with patient and doctor info
      const [appointments] = await connection.execute(`
        SELECT a.*, 
               p.first_name as patient_first_name, p.last_name as patient_last_name,
               p.phone as patient_phone, p.email as patient_email,
               d.first_name as doctor_first_name, d.last_name as doctor_last_name,
               s.specialization as doctor_specialization
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN users d ON a.doctor_id = d.id
        LEFT JOIN staff s ON d.id = s.user_id
        WHERE a.id = ?
      `, [result.insertId]);

      const appointment = appointments[0];

      // Send notifications
      try {
        // Email notification
        if (appointment.patient_email) {
          await sendEmail(
            appointment.patient_email,
            'Appointment Confirmation',
            `Dear ${appointment.patient_first_name} ${appointment.patient_last_name},\n\nYour appointment has been scheduled:\n\nAppointment Number: ${appointment.appointment_number}\nDoctor: Dr. ${appointment.doctor_first_name} ${appointment.doctor_last_name}\nSpecialization: ${appointment.doctor_specialization}\nDate: ${appointment.appointment_date}\nTime: ${appointment.appointment_time}\n\nThank you for choosing our hospital.`
          );
        }

        // SMS notification
        if (appointment.patient_phone) {
          await sendSMS(
            appointment.patient_phone,
            `Appointment confirmed for ${appointment.appointment_date} at ${appointment.appointment_time} with Dr. ${appointment.doctor_first_name} ${appointment.doctor_last_name}. Ref: ${appointment.appointment_number}`
          );
        }
      } catch (notificationError) {
        console.error('Notification error:', notificationError);
      }

      // Log audit
      await connection.execute(`
        INSERT INTO audit_logs (user_id, action, table_name, record_id, changes)
        VALUES (?, 'CREATE', 'appointments', ?, ?)
      `, [req.user.id, result.insertId, JSON.stringify({ created: appointment })]);

      res.status(201).json({
        success: true,
        message: 'Appointment created successfully',
        data: appointment
      });
    } catch (error) {
      console.error('Create appointment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create appointment'
      });
    }
  }

  // Update appointment
  async updateAppointment(req, res) {
    try {
      const appointmentId = req.params.id;
      const updateData = req.body;
      const connection = getConnection();

      // Get current appointment
      const [currentAppointments] = await connection.execute(`
        SELECT a.*, 
               p.first_name as patient_first_name, p.last_name as patient_last_name,
               p.phone as patient_phone, p.email as patient_email,
               d.first_name as doctor_first_name, d.last_name as doctor_last_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN users d ON a.doctor_id = d.id
        WHERE a.id = ?
      `, [appointmentId]);

      if (currentAppointments.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Appointment not found'
        });
      }

      const currentAppointment = currentAppointments[0];

      // Check for time slot conflict if date/time is being changed
      if (updateData.appointmentDate || updateData.appointmentTime) {
        const newDate = updateData.appointmentDate || currentAppointment.appointment_date;
        const newTime = updateData.appointmentTime || currentAppointment.appointment_time;
        const doctorId = updateData.doctorId || currentAppointment.doctor_id;

        const [conflicts] = await connection.execute(
          'SELECT id FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status != "Cancelled" AND id != ?',
          [doctorId, newDate, newTime, appointmentId]
        );

        if (conflicts.length > 0) {
          return res.status(409).json({
            success: false,
            message: 'Time slot already booked'
          });
        }
      }

      // Build update query
      const allowedFields = [
        'doctor_id', 'appointment_date', 'appointment_time', 'type', 'reason', 
        'notes', 'status', 'diagnosis', 'treatment', 'prescription'
      ];

      const updates = [];
      const values = [];

      Object.keys(updateData).forEach(key => {
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (allowedFields.includes(dbField)) {
          updates.push(`${dbField} = ?`);
          values.push(updateData[key]);
        }
      });

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid fields to update'
        });
      }

      updates.push('updated_at = NOW()');
      values.push(appointmentId);

      await connection.execute(
        `UPDATE appointments SET ${updates.join(', ')} WHERE id = ?`,
        values
      );

      // Get updated appointment
      const [updatedAppointments] = await connection.execute(`
        SELECT a.*, 
               p.first_name as patient_first_name, p.last_name as patient_last_name,
               p.phone as patient_phone, p.email as patient_email,
               d.first_name as doctor_first_name, d.last_name as doctor_last_name,
               s.specialization as doctor_specialization
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN users d ON a.doctor_id = d.id
        LEFT JOIN staff s ON d.id = s.user_id
        WHERE a.id = ?
      `, [appointmentId]);

      const updatedAppointment = updatedAppointments[0];

      // Send notifications for status changes or reschedules
      if (updateData.status || updateData.appointmentDate || updateData.appointmentTime) {
        try {
          let message = '';
          if (updateData.status === 'Cancelled') {
            message = `Your appointment (${updatedAppointment.appointment_number}) has been cancelled.`;
          } else if (updateData.appointmentDate || updateData.appointmentTime) {
            message = `Your appointment has been rescheduled to ${updatedAppointment.appointment_date} at ${updatedAppointment.appointment_time}. Ref: ${updatedAppointment.appointment_number}`;
          }

          if (message) {
            if (updatedAppointment.patient_email) {
              await sendEmail(
                updatedAppointment.patient_email,
                'Appointment Update',
                `Dear ${updatedAppointment.patient_first_name} ${updatedAppointment.patient_last_name},\n\n${message}\n\nThank you.`
              );
            }

            if (updatedAppointment.patient_phone) {
              await sendSMS(updatedAppointment.patient_phone, message);
            }
          }
        } catch (notificationError) {
          console.error('Notification error:', notificationError);
        }
      }

      // Log audit
      await connection.execute(`
        INSERT INTO audit_logs (user_id, action, table_name, record_id, changes)
        VALUES (?, 'UPDATE', 'appointments', ?, ?)
      `, [req.user.id, appointmentId, JSON.stringify({
        before: currentAppointment,
        after: updatedAppointment
      })]);

      res.json({
        success: true,
        message: 'Appointment updated successfully',
        data: updatedAppointment
      });
    } catch (error) {
      console.error('Update appointment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update appointment'
      });
    }
  }

  // Cancel appointment
  async cancelAppointment(req, res) {
    try {
      const appointmentId = req.params.id;
      const { reason } = req.body;
      
      const connection = getConnection();

      // Get appointment details
      const [appointments] = await connection.execute(`
        SELECT a.*, 
               p.first_name as patient_first_name, p.last_name as patient_last_name,
               p.phone as patient_phone, p.email as patient_email
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        WHERE a.id = ?
      `, [appointmentId]);

      if (appointments.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Appointment not found'
        });
      }

      const appointment = appointments[0];

      if (appointment.status === 'Cancelled') {
        return res.status(400).json({
          success: false,
          message: 'Appointment is already cancelled'
        });
      }

      // Update appointment status
      await connection.execute(
        'UPDATE appointments SET status = "Cancelled", cancellation_reason = ?, updated_at = NOW() WHERE id = ?',
        [reason, appointmentId]
      );

      // Send notifications
      try {
        const message = `Your appointment (${appointment.appointment_number}) has been cancelled. ${reason ? `Reason: ${reason}` : ''}`;
        
        if (appointment.patient_email) {
          await sendEmail(
            appointment.patient_email,
            'Appointment Cancelled',
            `Dear ${appointment.patient_first_name} ${appointment.patient_last_name},\n\n${message}\n\nWe apologize for any inconvenience.`
          );
        }

        if (appointment.patient_phone) {
          await sendSMS(appointment.patient_phone, message);
        }
      } catch (notificationError) {
        console.error('Notification error:', notificationError);
      }

      res.json({
        success: true,
        message: 'Appointment cancelled successfully'
      });
    } catch (error) {
      console.error('Cancel appointment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to cancel appointment'
      });
    }
  }

  // Get available time slots
  async getAvailableSlots(req, res) {
    try {
      const { doctorId, date } = req.query;
      
      if (!doctorId || !date) {
        return res.status(400).json({
          success: false,
          message: 'Doctor ID and date are required'
        });
      }

      const connection = getConnection();

      // Get doctor's schedule
      const [doctorInfo] = await connection.execute(
        'SELECT schedule FROM staff WHERE user_id = ?',
        [doctorId]
      );

      if (doctorInfo.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Doctor not found'
        });
      }

      // Get existing appointments
      const [bookedSlots] = await connection.execute(
        'SELECT appointment_time FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND status != "Cancelled"',
        [doctorId, date]
      );

      const bookedTimes = bookedSlots.map(slot => slot.appointment_time);

      // Parse doctor's schedule
      let schedule = {};
      if (doctorInfo[0].schedule) {
        try {
          schedule = JSON.parse(doctorInfo[0].schedule);
        } catch (e) {
          console.error('Error parsing schedule:', e);
        }
      }

      const dayOfWeek = new Date(date).toLocaleDateString('en', { weekday: 'long' });
      const daySchedule = schedule[dayOfWeek];

      if (!daySchedule || !daySchedule.working) {
        return res.json({
          success: true,
          data: {
            availableSlots: [],
            message: 'Doctor is not available on this day'
          }
        });
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
        const timeSlot = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
        
        if (!bookedTimes.includes(timeSlot)) {
          slots.push(timeSlot);
        }

        currentMinute += slotDuration;
        if (currentMinute >= 60) {
          currentHour += Math.floor(currentMinute / 60);
          currentMinute = currentMinute % 60;
        }
      }

      res.json({
        success: true,
        data: {
          date,
          doctorId,
          availableSlots: slots,
          workingHours: `${startTime} - ${endTime}`
        }
      });
    } catch (error) {
      console.error('Get available slots error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch available slots'
      });
    }
  }

  // Get daily schedule
  async getDailySchedule(req, res) {
    try {
      const date = req.query.date || new Date().toISOString().split('T')[0];
      const connection = getConnection();

      const [appointments] = await connection.execute(`
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

      res.json({
        success: true,
        data: {
          date,
          appointments,
          totalAppointments: appointments.length
        }
      });
    } catch (error) {
      console.error('Get daily schedule error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch daily schedule'
      });
    }
  }
}

module.exports = new AppointmentController();
