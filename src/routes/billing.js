const express = require('express');
const billingController = require('../controllers/billingController');
const authenticate = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validateBilling, validatePagination, validateId } = require('../middleware/validation');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get all bills
router.get('/', 
  validatePagination,
  authorize(['view_billing']), 
  billingController.getAllBills
);

// Get bill by ID
router.get('/:id', 
  validateId,
  authorize(['view_billing']), 
  billingController.getBillById
);

// Create new bill
router.post('/', 
  validateBilling,
  authorize(['create_billing']), 
  billingController.createBill
);

// Process payment
router.post('/:id/payment', 
  validateId,
  authorize(['process_payments']), 
  billingController.processPayment
);

// Get payment history
router.get('/payments/history', 
  validatePagination,
  authorize(['view_billing']), 
  billingController.getPaymentHistory
);

// Get billing statistics
router.get('/stats/overview', 
  authorize(['view_billing']), 
  billingController.getBillingStats
);

module.exports = router;
