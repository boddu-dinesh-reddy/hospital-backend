const { getConnection } = require('../config/database');

const authorize = (requiredPermissions = []) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Get user permissions
      const connection = getConnection();
      const [permissions] = await connection.execute(`
        SELECT DISTINCT p.name as permission_name
        FROM users u
        JOIN roles r ON u.role_id = r.id
        JOIN role_permissions rp ON r.id = rp.role_id
        JOIN permissions p ON rp.permission_id = p.id
        WHERE u.id = ? AND u.is_active = 1
      `, [req.user.id]);

      const userPermissions = permissions.map(p => p.permission_name);

      // Check if user has required permissions
      const hasPermission = requiredPermissions.length === 0 || 
        requiredPermissions.every(perm => userPermissions.includes(perm));

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions',
          required: requiredPermissions,
          userPermissions
        });
      }

      req.userPermissions = userPermissions;
      next();
    } catch (error) {
      console.error('Authorization error:', error);
      return res.status(500).json({
        success: false,
        message: 'Authorization check failed'
      });
    }
  };
};

// Role-based shortcuts
const requireAdmin = authorize(['manage_all']);
const requireDoctor = authorize(['view_patients', 'manage_appointments']);
const requireNurse = authorize(['view_patients']);
const requireReceptionist = authorize(['manage_appointments']);

module.exports = {
  authorize,
  requireAdmin,
  requireDoctor,
  requireNurse,
  requireReceptionist
};
