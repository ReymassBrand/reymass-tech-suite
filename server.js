require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Database
const db = new sqlite3.Database('./reymass_brand.db', (err) => {
  if (err) console.error('Database connection error:', err.message);
  else console.log('Connected to REYMASS Brand Database.');
});

// Create Transactions Table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checkout_request_id TEXT UNIQUE,
      merchant_request_id TEXT,
      phone_number TEXT NOT NULL,
      amount REAL NOT NULL,
      account_reference TEXT NOT NULL,
      subsidiary_code TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      mpesa_receipt_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// M-Pesa OAuth Helper
async function getMpesaToken() {
  const consumerKey = (process.env.MPESA_CONSUMER_KEY || 'c3RFOGp4WUpwU09hQU5kUG1LTVU6YWFiQU5G').trim();
  const consumerSecret = (process.env.MPESA_CONSUMER_SECRET || 'SandboxSecret').trim();
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  try {
    const response = await axios.get(
      'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
      { headers: { Authorization: `Basic ${auth}` } }
    );
    return response.data.access_token;
  } catch (error) {
    console.error('M-Pesa Token Error:', error.response ? error.response.data : error.message);
    throw new Error('Failed to acquire M-Pesa access token');
  }
}

// Health Route
app.get('/api/health', (req, res) => {
  res.json({ status: 'Online', brand: 'REYMASS BRAND', timestamp: new Date() });
});

// Multi-Subsidiary STK Push
app.post('/api/mpesa/stkpush', async (req, res) => {
  try {
    const { phoneNumber, amount, invoiceId, subsidiaryCode } = req.body;

    if (!phoneNumber || !amount) {
      return res.status(400).json({ success: false, error: 'Phone number and amount are required.' });
    }

    let formattedPhone = phoneNumber.toString().trim().replace(/^(0|\+?254)/, '254');
    if (!formattedPhone.startsWith('254')) formattedPhone = `254${formattedPhone}`;

    const shortCode = process.env.MPESA_SHORTCODE || '174379';
    const passkey = process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
    
    const date = new Date();
    const timestamp = 
      date.getFullYear().toString() +
      String(date.getMonth() + 1).padStart(2, '0') +
      String(date.getDate()).padStart(2, '0') +
      String(date.getHours()).padStart(2, '0') +
      String(date.getMinutes()).padStart(2, '0') +
      String(date.getSeconds()).padStart(2, '0');

    const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');
    const code = (subsidiaryCode || 'TECH').toUpperCase();
    const accountReference = `${code}-INV-${invoiceId || '001'}`;

    const token = await getMpesaToken();

    const payload = {
      BusinessShortCode: shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(Number(amount)),
      PartyA: formattedPhone,
      PartyB: shortCode,
      PhoneNumber: formattedPhone,
      CallBackURL: process.env.MPESA_CALLBACK_URL || 'https://reymass-tech-suite.onrender.com/api/mpesa/callback',
      AccountReference: accountReference,
      TransactionDesc: `REYMASS ${code} Payment`
    };

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const { CheckoutRequestID, MerchantRequestID } = response.data;

    db.run(
      `INSERT INTO transactions (checkout_request_id, merchant_request_id, phone_number, amount, account_reference, subsidiary_code, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [CheckoutRequestID, MerchantRequestID, formattedPhone, amount, accountReference, code, 'PENDING']
    );

    res.json({
      success: true,
      message: 'STK Push initialized',
      checkoutRequestId: CheckoutRequestID,
      accountReference
    });

  } catch (error) {
    const errDetails = error.response ? error.response.data : error.message;
    console.error('STK Push Error:', errDetails);
    res.status(500).json({ success: false, error: errDetails });
  }
});

// M-Pesa Callback Webhook
app.post('/api/mpesa/callback', (req, res) => {
  try {
    const callbackData = req.body.Body.stkCallback;
    const checkoutRequestId = callbackData.CheckoutRequestID;

    if (callbackData.ResultCode === 0) {
      let mpesaReceiptNumber = '';
      callbackData.CallbackMetadata.Item.forEach(item => {
        if (item.Name === 'MpesaReceiptNumber') mpesaReceiptNumber = item.Value;
      });

      db.run(
        `UPDATE transactions SET status = 'COMPLETED', mpesa_receipt_number = ? WHERE checkout_request_id = ?`,
        [mpesaReceiptNumber, checkoutRequestId]
      );
    } else {
      db.run(`UPDATE transactions SET status = 'FAILED' WHERE checkout_request_id = ?`, [checkoutRequestId]);
    }
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

// Fetch Transactions
app.get('/api/transactions', (req, res) => {
  db.all(`SELECT * FROM transactions ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, count: rows.length, data: rows });
  });
});

app.listen(PORT, () => {
  console.log(`REYMASS Brand Server Running on Port ${PORT}`);
});