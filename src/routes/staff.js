const express = require('express');
const staffController = require('../controllers/staffController');
const authenticate = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validatePagination, validateId } = require('../middleware/validation');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get all staff
router.get('/', 
  validatePagination,
  authorize(['view_staff']), 
  staffController.getAllStaff
);

// Get staff by ID
router.get('/:id', 
  validateId,
  authorize(['view_staff']), 
  staffController.getStaffById
);

// Create new staff
router.post('/', 
  authorize(['create_staff']), 
  staffController.createStaff
);

// Update staff
router.put('/:id', 
  validateId,
  authorize(['update_staff']), 
  staffController.updateStaff
);

// Get all doctors
router.get('/doctors/list', 
  authorize(['view_appointments']), 
  staffController.getDoctors
);

// Get doctor's schedule
router.get('/:id/schedule', 
  validateId,
  authorize(['view_appointments']), 
  staffController.getDoctorSchedule
);

module.exports = router;
