const express = require('express');
const appointmentController = require('../controllers/appointmentController');
const authenticate = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validateAppointment, validatePagination, validateId } = require('../middleware/validation');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get all appointments
router.get('/', 
  validatePagination,
  authorize(['view_appointments']), 
  appointmentController.getAllAppointments
);

// Get appointment by ID
router.get('/:id', 
  validateId,
  authorize(['view_appointments']), 
  appointmentController.getAppointmentById
);

// Create new appointment
router.post('/', 
  validateAppointment,
  authorize(['create_appointments']), 
  appointmentController.createAppointment
);

// Update appointment
router.put('/:id', 
  validateId,
  authorize(['update_appointments']), 
  appointmentController.updateAppointment
);

// Cancel appointment
router.delete('/:id', 
  validateId,
  authorize(['delete_appointments']), 
  appointmentController.cancelAppointment
);

// Get available time slots
router.get('/slots/available', 
  authorize(['view_appointments']), 
  appointmentController.getAvailableSlots
);

// Get daily schedule
router.get('/schedule/daily', 
  authorize(['view_appointments']), 
  appointmentController.getDailySchedule
);

module.exports = router;
