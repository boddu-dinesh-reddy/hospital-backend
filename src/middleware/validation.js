const { body, param, query, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// User validation
const validateLogin = [
  body('username').notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidationErrors
];

const validateRegister = [
  body('username').isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('roleId').isInt({ min: 1 }).withMessage('Valid role ID is required'),
  handleValidationErrors
];

// Patient validation
const validatePatient = [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('dateOfBirth').isISO8601().withMessage('Valid date of birth is required'),
  body('gender').isIn(['Male', 'Female', 'Other']).withMessage('Valid gender is required'),
  body('phone').isMobilePhone().withMessage('Valid phone number is required'),
  body('email').optional().isEmail().withMessage('Valid email is required'),
  handleValidationErrors
];

// Appointment validation
const validateAppointment = [
  body('patientId').isInt({ min: 1 }).withMessage('Valid patient ID is required'),
  body('doctorId').isInt({ min: 1 }).withMessage('Valid doctor ID is required'),
  body('appointmentDate').isISO8601().withMessage('Valid appointment date is required'),
  body('appointmentTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid time format (HH:MM) is required'),
  body('type').isIn(['Consultation', 'Follow-up', 'Emergency', 'Routine Check']).withMessage('Valid appointment type is required'),
  handleValidationErrors
];

// Billing validation
const validateBilling = [
  body('patientId').isInt({ min: 1 }).withMessage('Valid patient ID is required'),
  body('amount').isFloat({ min: 0 }).withMessage('Valid amount is required'),
  body('description').notEmpty().withMessage('Description is required'),
  body('serviceType').isIn(['Consultation', 'Lab Test', 'Medication', 'Procedure', 'Room Charge']).withMessage('Valid service type is required'),
  handleValidationErrors
];

// Pagination validation
const validatePagination = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

// ID parameter validation
const validateId = [
  param('id').isInt({ min: 1 }).withMessage('Valid ID is required'),
  handleValidationErrors
];

module.exports = {
  validateLogin,
  validateRegister,
  validatePatient,
  validateAppointment,
  validateBilling,
  validatePagination,
  validateId,
  handleValidationErrors
};
