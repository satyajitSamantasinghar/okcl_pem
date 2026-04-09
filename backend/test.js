const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const token = jwt.sign({ userId: '65f9dbf3...', role: 'MD' }, process.env.JWT_SECRET || 'secret123', { expiresIn: '1h' });

axios.get('http://localhost:5000/api/md/monthly-plans?year=2026', {
  headers: { Authorization: `Bearer ${token}` }
})
.then(res => console.log('Items:', res.data.length))
.catch(err => console.log('ERROR:', err.response?.data || err.message));
