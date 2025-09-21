const { getConnection } = require('../config/database');
const { sendEmail } = require('../services/emailService');

class BillingController {
  // Get all bills
  async getAllBills(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      const status = req.query.status || '';
      const patientId = req.query.patientId || '';

      const connection = getConnection();

      // Build where clause
      let whereClause = '1 = 1';
      let queryParams = [];

      if (status) {
        whereClause += ` AND b.payment_status = ?`;
        queryParams.push(status);
      }

      if (patientId) {
        whereClause += ` AND b.patient_id = ?`;
        queryParams.push(patientId);
      }

      // Get total count
      const [countResult] = await connection.execute(
        `SELECT COUNT(*) as total FROM billing b WHERE ${whereClause}`,
        queryParams
      );
      const total = countResult[0].total;

      // Get bills with patient info
      const [bills] = await connection.execute(`
        SELECT b.*, 
               p.first_name as patient_first_name, p.last_name as patient_last_name,
               p.phone as patient_phone, p.email as patient_email, p.patient_id,
               u.first_name as created_by_first_name, u.last_name as created_by_last_name
        FROM billing b
        JOIN patients p ON b.patient_id = p.id
        LEFT JOIN users u ON b.created_by = u.id
        WHERE ${whereClause}
        ORDER BY b.created_at DESC
        LIMIT ? OFFSET ?
      `, [...queryParams, limit, offset]);

      // Get bill items for each bill
      for (let bill of bills) {
        const [items] = await connection.execute(
          'SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id',
          [bill.id]
        );
        bill.items = items;
      }

      res.json({
        success: true,
        data: {
          bills,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            itemsPerPage: limit
          }
        }
      });
    } catch (error) {
      console.error('Get bills error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch bills'
      });
    }
  }

  // Get bill by ID
  async getBillById(req, res) {
    try {
      const billId = req.params.id;
      const connection = getConnection();

      const [bills] = await connection.execute(`
        SELECT b.*, 
               p.first_name as patient_first_name, p.last_name as patient_last_name,
               p.phone as patient_phone, p.email as patient_email, p.patient_id, p.address,
               u.first_name as created_by_first_name, u.last_name as created_by_last_name
        FROM billing b
        JOIN patients p ON b.patient_id = p.id
        LEFT JOIN users u ON b.created_by = u.id
        WHERE b.id = ?
      `, [billId]);

      if (bills.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Bill not found'
        });
      }

      const bill = bills[0];

      // Get bill items
      const [items] = await connection.execute(
        'SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id',
        [billId]
      );
      bill.items = items;

      // Get payments
      const [payments] = await connection.execute(`
        SELECT p.*, u.first_name as processed_by_first_name, u.last_name as processed_by_last_name
        FROM payments p
        LEFT JOIN users u ON p.processed_by = u.id
        WHERE p.bill_id = ?
        ORDER BY p.payment_date DESC
      `, [billId]);
      bill.payments = payments;

      res.json({
        success: true,
        data: bill
      });
    } catch (error) {
      console.error('Get bill error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch bill'
      });
    }
  }

  // Create new bill
  async createBill(req, res) {
    try {
      const { patientId, items, discount = 0, tax = 0, notes = '' } = req.body;
      
      if (!items || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one item is required'
        });
      }

      const connection = getConnection();

      // Calculate totals
      let subtotal = 0;
      items.forEach(item => {
        subtotal += parseFloat(item.unitPrice) * parseInt(item.quantity);
      });

      const discountAmount = parseFloat(discount) || 0;
      const taxAmount = (subtotal - discountAmount) * (parseFloat(tax) / 100);
      const totalAmount = subtotal - discountAmount + taxAmount;

      // Generate bill number
      const [lastBill] = await connection.execute(
        'SELECT bill_number FROM billing ORDER BY id DESC LIMIT 1'
      );
      
      let nextBillNumber = 'INV0001';
      if (lastBill.length > 0) {
        const lastNumber = parseInt(lastBill[0].bill_number.substring(3));
        nextBillNumber = 'INV' + String(lastNumber + 1).padStart(4, '0');
      }

      // Start transaction
      await connection.beginTransaction();

      try {
        // Create bill
        const [billResult] = await connection.execute(`
          INSERT INTO billing (
            bill_number, patient_id, subtotal, discount_amount, tax_amount, 
            total_amount, payment_status, notes, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?, ?)
        `, [
          nextBillNumber, patientId, subtotal, discountAmount, taxAmount,
          totalAmount, notes, req.user.id
        ]);

        const billId = billResult.insertId;

        // Create bill items
        for (let item of items) {
          await connection.execute(`
            INSERT INTO bill_items (
              bill_id, service_type, description, unit_price, quantity, total_price
            ) VALUES (?, ?, ?, ?, ?, ?)
          `, [
            billId, item.serviceType, item.description, item.unitPrice,
            item.quantity, parseFloat(item.unitPrice) * parseInt(item.quantity)
          ]);
        }

        await connection.commit();

        // Get created bill with patient info
        const [bills] = await connection.execute(`
          SELECT b.*, 
                 p.first_name as patient_first_name, p.last_name as patient_last_name,
                 p.phone as patient_phone, p.email as patient_email, p.patient_id
          FROM billing b
          JOIN patients p ON b.patient_id = p.id
          WHERE b.id = ?
        `, [billId]);

        const bill = bills[0];

        // Get bill items
        const [createdItems] = await connection.execute(
          'SELECT * FROM bill_items WHERE bill_id = ?',
          [billId]
        );
        bill.items = createdItems;

        // Send email notification
        try {
          if (bill.patient_email) {
            await sendEmail(
              bill.patient_email,
              'Invoice Generated',
              `Dear ${bill.patient_first_name} ${bill.patient_last_name},\n\nYour invoice ${bill.bill_number} has been generated.\n\nAmount Due: $${bill.total_amount}\n\nPlease visit our billing counter for payment.\n\nThank you.`
            );
          }
        } catch (emailError) {
          console.error('Email notification error:', emailError);
        }

        // Log audit
        await connection.execute(`
          INSERT INTO audit_logs (user_id, action, table_name, record_id, changes)
          VALUES (?, 'CREATE', 'billing', ?, ?)
        `, [req.user.id, billId, JSON.stringify({ created: bill })]);

        res.status(201).json({
          success: true,
          message: 'Bill created successfully',
          data: bill
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Create bill error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create bill'
      });
    }
  }

  // Process payment
  async processPayment(req, res) {
    try {
      const billId = req.params.id;
      const { paymentAmount, paymentMethod, transactionId = '', notes = '' } = req.body;

      const connection = getConnection();

      // Get bill details
      const [bills] = await connection.execute(`
        SELECT b.*, 
               p.first_name as patient_first_name, p.last_name as patient_last_name,
               p.email as patient_email
        FROM billing b
        JOIN patients p ON b.patient_id = p.id
        WHERE b.id = ?
      `, [billId]);

      if (bills.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Bill not found'
        });
      }

      const bill = bills[0];

      if (bill.payment_status === 'Paid') {
        return res.status(400).json({
          success: false,
          message: 'Bill is already paid'
        });
      }

      // Get total paid amount
      const [paymentsSum] = await connection.execute(
        'SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE bill_id = ?',
        [billId]
      );

      const totalPaid = parseFloat(paymentsSum[0].total_paid);
      const newTotalPaid = totalPaid + parseFloat(paymentAmount);
      const remainingAmount = bill.total_amount - newTotalPaid;

      // Start transaction
      await connection.beginTransaction();

      try {
        // Create payment record
        await connection.execute(`
          INSERT INTO payments (
            bill_id, amount, payment_method, transaction_id, notes, processed_by
          ) VALUES (?, ?, ?, ?, ?, ?)
        `, [billId, paymentAmount, paymentMethod, transactionId, notes, req.user.id]);

        // Update bill status
        let paymentStatus = 'Pending';
        if (remainingAmount <= 0) {
          paymentStatus = 'Paid';
        } else if (newTotalPaid > 0) {
          paymentStatus = 'Partially Paid';
        }

        await connection.execute(
          'UPDATE billing SET payment_status = ?, updated_at = NOW() WHERE id = ?',
          [paymentStatus, billId]
        );

        await connection.commit();

        // Send payment confirmation email
        try {
          if (bill.patient_email) {
            let message = `Dear ${bill.patient_first_name} ${bill.patient_last_name},\n\nPayment of $${paymentAmount} has been received for invoice ${bill.bill_number}.\n\n`;
            
            if (paymentStatus === 'Paid') {
              message += 'Your bill has been paid in full.\n\n';
            } else {
              message += `Remaining balance: $${remainingAmount.toFixed(2)}\n\n`;
            }
            
            message += 'Thank you for your payment.';

            await sendEmail(
              bill.patient_email,
              'Payment Confirmation',
              message
            );
          }
        } catch (emailError) {
          console.error('Email notification error:', emailError);
        }

        res.json({
          success: true,
          message: 'Payment processed successfully',
          data: {
            paymentAmount: parseFloat(paymentAmount),
            totalPaid: newTotalPaid,
            remainingAmount: Math.max(0, remainingAmount),
            paymentStatus
          }
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Process payment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process payment'
      });
    }
  }

  // Get payment history
  async getPaymentHistory(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      const patientId = req.query.patientId || '';

      const connection = getConnection();

      let whereClause = '1 = 1';
      let queryParams = [];

      if (patientId) {
        whereClause += ' AND b.patient_id = ?';
        queryParams.push(patientId);
      }

      // Get total count
      const [countResult] = await connection.execute(`
        SELECT COUNT(*) as total 
        FROM payments p
        JOIN billing b ON p.bill_id = b.id
        WHERE ${whereClause}
      `, queryParams);
      const total = countResult[0].total;

      // Get payments
      const [payments] = await connection.execute(`
        SELECT p.*, b.bill_number, b.total_amount as bill_total,
               pt.first_name as patient_first_name, pt.last_name as patient_last_name,
               u.first_name as processed_by_first_name, u.last_name as processed_by_last_name
        FROM payments p
        JOIN billing b ON p.bill_id = b.id
        JOIN patients pt ON b.patient_id = pt.id
        LEFT JOIN users u ON p.processed_by = u.id
        WHERE ${whereClause}
        ORDER BY p.payment_date DESC
        LIMIT ? OFFSET ?
      `, [...queryParams, limit, offset]);

      res.json({
        success: true,
        data: {
          payments,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            itemsPerPage: limit
          }
        }
      });
    } catch (error) {
      console.error('Get payment history error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch payment history'
      });
    }
  }

  // Get billing statistics
  async getBillingStats(req, res) {
    try {
      const connection = getConnection();

      // Total revenue
      const [revenueResult] = await connection.execute(`
        SELECT 
          COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN total_amount ELSE 0 END), 0) as total_revenue,
          COALESCE(SUM(CASE WHEN payment_status = 'Pending' THEN total_amount ELSE 0 END), 0) as pending_amount,
          COALESCE(SUM(CASE WHEN payment_status = 'Partially Paid' THEN total_amount ELSE 0 END), 0) as partially_paid_amount,
          COUNT(*) as total_bills
        FROM billing 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `);

      // Today's revenue
      const [todayResult] = await connection.execute(`
        SELECT 
          COALESCE(SUM(total_amount), 0) as today_revenue,
          COUNT(*) as today_bills
        FROM billing 
        WHERE DATE(created_at) = CURDATE() AND payment_status = 'Paid'
      `);

      // Monthly revenue
      const [monthlyResult] = await connection.execute(`
        SELECT 
          DATE_FORMAT(created_at, '%Y-%m') as month,
          SUM(total_amount) as revenue,
          COUNT(*) as bills_count
        FROM billing 
        WHERE payment_status = 'Paid' 
        AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
        ORDER BY month DESC
      `);

      res.json({
        success: true,
        data: {
          overview: revenueResult[0],
          today: todayResult[0],
          monthlyTrends: monthlyResult
        }
      });
    } catch (error) {
      console.error('Get billing stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch billing statistics'
      });
    }
  }
}

module.exports = new BillingController();
