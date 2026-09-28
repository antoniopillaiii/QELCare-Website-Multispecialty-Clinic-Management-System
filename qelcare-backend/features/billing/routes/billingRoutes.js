// ============================================================
// FILE: qelcare-backend/features/billing/routes/billingRoutes.js
// ============================================================
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/billingController');
const { authenticate, authorize } = require('../../../shared/middleware/tokenMiddleware');
const { requireIdParam } = require('../../../shared/utils/requestValidation');

router.use(authenticate);

// Bills (amounts, OR numbers, cashier, line items) are for billing staff only.
router.get('/dashboard',                  authorize(['Admin','Cashier']), ctrl.getDashboard);
router.get('/',                           authorize(['Admin','Cashier']), ctrl.getAll);
router.post('/',                          authorize(['Admin','Cashier']), ctrl.create);
router.get('/appointment/:appointmentId', authorize(['Admin','Cashier']), requireIdParam('appointmentId', 'appointment'), ctrl.getByAppointment);
router.get('/:id',                        authorize(['Admin','Cashier']), requireIdParam('id', 'billing'), ctrl.getById);
router.patch('/:id/void',                 authorize(['Admin','Cashier']), requireIdParam('id', 'billing'), ctrl.voidBill);

module.exports = router;
