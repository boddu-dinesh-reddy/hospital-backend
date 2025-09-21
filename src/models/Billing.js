const { getConnection } = require('../config/database');

class Billing {
  constructor(data = {}) {
    this.id = data.id || null;
    this.billNumber = data.bill_number || data.billNumber || null;
    this.patientId = data.patient_id || data.patientId || null;
    this.subtotal = data.subtotal || 0;
    this.discountAmount = data.discount_amount || data.discountAmount || 0;
    this.taxAmount = data.tax_amount || data.taxAmount || 0;
    this.totalAmount = data.total_amount || data.totalAmount || 0;
    this.paymentStatus = data.payment_status || data.paymentStatus || 'Pending';
    this.notes = data.notes || null;
    this.createdBy = data.created_by || data.createdBy || null;
    this.createdAt = data.created_at || data.createdAt || null;
    this.updatedAt = data.updated_at || data.updatedAt || null;
    
    // Related data
    this.patientFirstName = data.patient_first_name || data.patientFirstName || null;
    this.patientLastName = data.patient_last_name || data.patientLastName || null;
    this.patientPhone = data.patient_phone || data.patientPhone || null;
    this.patientEmail = data.patient_email || data.patientEmail || null;
    this.patientId_display = data.patient_id || data.patientId_display || null;
    this.createdByFirstName = data.created_by_first_name || data.createdByFirstName || null;
    this.createdByLastName = data.created_by_last_name || data.createdByLastName || null;
    
    // Items and payments
    this.items = data.items || [];
    this.payments = data.payments || [];
  }

  // Save billing record
  async save() {
    try {
      const connection = getConnection();
      
      if (this.id) {
        // Update existing bill
        const [result] = await connection.execute(`
          UPDATE billing SET 
            subtotal = ?, discount_amount = ?, tax_amount = ?, total_amount = ?,
            payment_status = ?, notes = ?, updated_at = NOW()
          WHERE id = ?
        `, [
          this.subtotal, this.discountAmount, this.taxAmount, this.totalAmount,
          this.paymentStatus, this.notes, this.id
        ]);
        
        return result.affectedRows > 0;
      } else {
        // Create new bill
        if (!this.billNumber) {
          this.billNumber = await Billing.generateBillNumber();
        }
        
        const [result] = await connection.execute(`
          INSERT INTO billing (
            bill_number, patient_id, subtotal, discount_amount, tax_amount,
            total_amount, payment_status, notes, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          this.billNumber, this.patientId, this.subtotal, this.discountAmount,
          this.taxAmount, this.totalAmount, this.paymentStatus, this.notes, this.createdBy
        ]);
        
        this.id = result.insertId;
        return this;
      }
    } catch (error) {
      console.error('Error saving billing record:', error);
      throw error;
    }
  }

  // Find billing record by ID
  static async findById(id) {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT b.*, 
               p.first_name as patient_first_name, p.last_name as patient_last_name,
               p.phone as patient_phone, p.email as patient_email, p.patient_id as patient_id_display, p.address,
               u.first_name as created_by_first_name, u.last_name as created_by_last_name
        FROM billing b
        JOIN patients p ON b.patient_id = p.id
        LEFT JOIN users u ON b.created_by = u.id
        WHERE b.id = ?
      `, [id]);
      
      if (rows.length === 0) return null;
      
      const billing = new Billing(rows[0]);
      
      // Get bill items
      const [items] = await connection.execute(
        'SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id',
        [id]
      );
      billing.items = items;
      
      // Get payments
      const [payments] = await connection.execute(`
        SELECT p.*, u.first_name as processed_by_first_name, u.last_name as processed_by_last_name
        FROM payments p
        LEFT JOIN users u ON p.processed_by = u.id
        WHERE p.bill_id = ?
        ORDER BY p.payment_date DESC
      `, [id]);
      billing.payments = payments;
      
      return billing;
    } catch (error) {
      console.error('Error finding billing record by ID:', error);
      throw error;
    }
  }

  // Find all billing records with pagination
  static async findAll(options = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        status = '',
        patientId = '',
        sortBy = 'created_at',
        sortOrder = 'DESC'
      } = options;
      
      const offset = (page - 1) * limit;
      const connection = getConnection();
      
      let whereClause = '1 = 1';
      let queryParams = [];
      
      if (status) {
        whereClause += ' AND b.payment_status = ?';
        queryParams.push(status);
      }
      
      if (patientId) {
        whereClause += ' AND b.patient_id = ?';
        queryParams.push(patientId);
      }
      
      // Get total count
      const [countResult] = await connection.execute(
        `SELECT COUNT(*) as total FROM billing b WHERE ${whereClause}`,
        queryParams
      );
      
      // Get billing records
      const [rows] = await connection.execute(`
        SELECT b.*, 
               p.first_name as patient_first_name, p.last_name as patient_last_name,
               p.phone as patient_phone, p.email as patient_email, p.patient_id as patient_id_display,
               u.first_name as created_by_first_name, u.last_name as created_by_last_name
        FROM billing b
        JOIN patients p ON b.patient_id = p.id
        LEFT JOIN users u ON b.created_by = u.id
        WHERE ${whereClause}
        ORDER BY b.${sortBy} ${sortOrder}
        LIMIT ? OFFSET ?
      `, [...queryParams, limit, offset]);
      
      // Get items for each bill
      const billingRecords = [];
      for (let row of rows) {
        const billing = new Billing(row);
        const [items] = await connection.execute(
          'SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id',
          [billing.id]
        );
        billing.items = items;
        billingRecords.push(billing);
      }
      
      return {
        bills: billingRecords,
        total: countResult[0].total,
        page,
        limit,
        totalPages: Math.ceil(countResult[0].total / limit)
      };
    } catch (error) {
      console.error('Error finding all billing records:', error);
      throw error;
    }
  }

  // Add item to bill
  async addItem(serviceType, description, unitPrice, quantity) {
    try {
      const connection = getConnection();
      
      if (!this.id) {
        throw new Error('Bill must be saved before adding items');
      }
      
      const totalPrice = parseFloat(unitPrice) * parseInt(quantity);
      
      const [result] = await connection.execute(`
        INSERT INTO bill_items (
          bill_id, service_type, description, unit_price, quantity, total_price
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [this.id, serviceType, description, unitPrice, quantity, totalPrice]);
      
      // Recalculate bill totals
      await this.recalculateTotals();
      
      return result.insertId;
    } catch (error) {
      console.error('Error adding item to bill:', error);
      throw error;
    }
  }

  // Remove item from bill
  async removeItem(itemId) {
    try {
      const connection = getConnection();
      
      const [result] = await connection.execute(
        'DELETE FROM bill_items WHERE id = ? AND bill_id = ?',
        [itemId, this.id]
      );
      
      if (result.affectedRows > 0) {
        await this.recalculateTotals();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error removing item from bill:', error);
      throw error;
    }
  }

  // Recalculate bill totals
  async recalculateTotals() {
    try {
      const connection = getConnection();
      
      const [result] = await connection.execute(
        'SELECT SUM(total_price) as subtotal FROM bill_items WHERE bill_id = ?',
        [this.id]
      );
      
      this.subtotal = parseFloat(result[0].subtotal) || 0;
      this.totalAmount = this.subtotal - this.discountAmount + this.taxAmount;
      
      await connection.execute(
        'UPDATE billing SET subtotal = ?, total_amount = ?, updated_at = NOW() WHERE id = ?',
        [this.subtotal, this.totalAmount, this.id]
      );
    } catch (error) {
      console.error('Error recalculating totals:', error);
      throw error;
    }
  }

  // Process payment
  async processPayment(amount, paymentMethod, transactionId = '', notes = '', processedBy = null) {
    try {
      const connection = getConnection();
      
      // Add payment record
      const [result] = await connection.execute(`
        INSERT INTO payments (
          bill_id, amount, payment_method, transaction_id, notes, processed_by
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [this.id, amount, paymentMethod, transactionId, notes, processedBy]);
      
      // Get total paid amount
      const [paymentsSum] = await connection.execute(
        'SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE bill_id = ?',
        [this.id]
      );
      
      const totalPaid = parseFloat(paymentsSum[0].total_paid);
      const remainingAmount = this.totalAmount - totalPaid;
      
      // Update payment status
      let paymentStatus = 'Pending';
      if (remainingAmount <= 0) {
        paymentStatus = 'Paid';
      } else if (totalPaid > 0) {
        paymentStatus = 'Partially Paid';
      }
      
      this.paymentStatus = paymentStatus;
      await connection.execute(
        'UPDATE billing SET payment_status = ?, updated_at = NOW() WHERE id = ?',
        [paymentStatus, this.id]
      );
      
      return {
        paymentId: result.insertId,
        totalPaid,
        remainingAmount: Math.max(0, remainingAmount),
        paymentStatus
      };
    } catch (error) {
      console.error('Error processing payment:', error);
      throw error;
    }
  }

  // Get payment history
  async getPayments() {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT p.*, u.first_name as processed_by_first_name, u.last_name as processed_by_last_name
        FROM payments p
        LEFT JOIN users u ON p.processed_by = u.id
        WHERE p.bill_id = ?
        ORDER BY p.payment_date DESC
      `, [this.id]);
      
      return rows;
    } catch (error) {
      console.error('Error getting payments:', error);
      throw error;
    }
  }

  // Get total paid amount
  async getTotalPaid() {
    try {
      const connection = getConnection();
      const [result] = await connection.execute(
        'SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE bill_id = ?',
        [this.id]
      );
      
      return parseFloat(result[0].total_paid);
    } catch (error) {
      console.error('Error getting total paid:', error);
      throw error;
    }
  }

  // Get remaining amount
  async getRemainingAmount() {
    try {
      const totalPaid = await this.getTotalPaid();
      return Math.max(0, this.totalAmount - totalPaid);
    } catch (error) {
      console.error('Error getting remaining amount:', error);
      throw error;
    }
  }

  // Generate bill number
  static async generateBillNumber() {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(
        'SELECT bill_number FROM billing ORDER BY id DESC LIMIT 1'
      );
      
      if (rows.length === 0) {
        return 'INV0001';
      }
      
      const lastNumber = parseInt(rows[0].bill_number.substring(3));
      return 'INV' + String(lastNumber + 1).padStart(4, '0');
    } catch (error) {
      console.error('Error generating bill number:', error);
      throw error;
    }
  }

  // Get billing statistics
  static async getBillingStats(days = 30) {
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
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      `, [days]);
      
      // Today's revenue
      const [todayResult] = await connection.execute(`
        SELECT 
          COALESCE(SUM(total_amount), 0) as today_revenue,
          COUNT(*) as today_bills
        FROM billing 
        WHERE DATE(created_at) = CURDATE() AND payment_status = 'Paid'
      `);
      
      // Monthly revenue trend
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
      
      return {
        overview: revenueResult[0],
        today: todayResult[0],
        monthlyTrends: monthlyResult
      };
    } catch (error) {
      console.error('Error getting billing stats:', error);
      throw error;
    }
  }

  // Get pending bills for a patient
  static async getPendingForPatient(patientId) {
    try {
      const connection = getConnection();
      const [rows] = await connection.execute(`
        SELECT b.*, 
               p.first_name as patient_first_name, p.last_name as patient_last_name
        FROM billing b
        JOIN patients p ON b.patient_id = p.id
        WHERE b.patient_id = ? AND b.payment_status IN ('Pending', 'Partially Paid')
        ORDER BY b.created_at DESC
      `, [patientId]);
      
      return rows.map(row => new Billing(row));
    } catch (error) {
      console.error('Error getting pending bills for patient:', error);
      throw error;
    }
  }
}

module.exports = Billing;
