const express = require('express');
const patientController = require('../controllers/patientController');
const authenticate = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validatePatient, validatePagination, validateId } = require('../middleware/validation');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get all patients
router.get('/', 
  validatePagination,
  authorize(['view_patients']), 
  patientController.getAllPatients
);

// Get patient by ID
router.get('/:id', 
  validateId,
  authorize(['view_patients']), 
  patientController.getPatientById
);

// Create new patient
router.post('/', 
  validatePatient,
  authorize(['create_patients']), 
  patientController.createPatient
);

// Update patient
router.put('/:id', 
  validateId,
  authorize(['update_patients']), 
  patientController.updatePatient
);

// Delete patient
router.delete('/:id', 
  validateId,
  authorize(['delete_patients']), 
  patientController.deletePatient
);

// Get patient medical history
router.get('/:id/history', 
  validateId,
  authorize(['view_patients']), 
  patientController.getPatientMedicalHistory
);

module.exports = router;
