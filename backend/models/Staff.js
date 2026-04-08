const mongoose = require('mongoose');

const StaffSchema = new mongoose.Schema({
  name: String,
  role: { type: String, enum: ['chef','waiter','admin'], default: 'waiter' },
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Staff', StaffSchema);
