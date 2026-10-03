// ============================================
// M-PESA CONFIGURATION
// ============================================

const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE || '174379';

const MPESA_PASSKEY =
  process.env.MPESA_PASSKEY ||
  'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';

const MPESA_CALLBACK_URL =
  process.env.MPESA_CALLBACK_URL ||
  'https://reymass-tech-suite.onrender.com/api/mpesa/callback';


// ============================================
// GET M-PESA ACCESS TOKEN
// ============================================

async function getMpesaToken() {

  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error(
      'M-Pesa Consumer Key or Consumer Secret is missing from .env'
    );
  }

  const auth = Buffer
    .from(`${consumerKey}:${consumerSecret}`)
    .toString('base64');

  try {

    const response = await axios.get(
      'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${auth}`
        }
      }
    );

    console.log('M-Pesa OAuth Token Generated Successfully');

    if (!response.data || !response.data.access_token) {
      throw new Error('No access token returned by Safaricom');
    }

    return response.data.access_token;

  } catch (error) {

    console.error(
      'M-Pesa OAuth Error:',
      error.response?.data || error.message
    );

    throw error;
  }
}


// ============================================
// KENYA TIMESTAMP
// Format: YYYYMMDDHHmmss
// ============================================

function getMpesaTimestamp() {

  const now = new Date();

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = formatter.formatToParts(now);

  const values = {};

  parts.forEach(part => {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  });

  return (
    values.year +
    values.month +
    values.day +
    values.hour +
    values.minute +
    values.second
  );
}


// ============================================
// FORMAT KENYAN PHONE NUMBER
// ============================================

function formatKenyanPhone(phone) {

  if (!phone) {
    throw new Error('Phone number is required');
  }

  let number = String(phone)
    .trim()
    .replace(/\s+/g, '')
    .replace(/-/g, '');

  // 0712345678 -> 254712345678
  if (/^0\d{9}$/.test(number)) {
    number = '254' + number.substring(1);
  }

  // 712345678 -> 254712345678
  else if (/^7\d{8}$/.test(number)) {
    number = '254' + number;
  }

  // +254712345678 -> 254712345678
  else if (/^\+2547\d{8}$/.test(number)) {
    number = number.substring(1);
  }

  // Already 254712345678
  else if (/^2547\d{8}$/.test(number)) {
    // Do nothing
  }

  else {
    throw new Error(
      'Invalid Kenyan phone number. Use 0712345678 or 254712345678.'
    );
  }

  return number;
}


// ============================================
// STK PUSH
// ============================================

app.post('/api/mpesa/stkpush-unified', async (req, res) => {

  try {

    const {
      phoneNumber,
      amount,
      invoiceId,
      subsidiaryCode
    } = req.body;


    // -------------------------------
    // Validate amount
    // -------------------------------

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment amount'
      });
    }

    const finalAmount = Math.round(numericAmount);


    // -------------------------------
    // Format phone
    // -------------------------------

    const formattedPhone = formatKenyanPhone(phoneNumber);


    // -------------------------------
    // Generate timestamp
    // -------------------------------

    const timestamp = getMpesaTimestamp();


    // -------------------------------
    // Generate password
    // -------------------------------

    const password = Buffer
      .from(
        `${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`
      )
      .toString('base64');


    // -------------------------------
    // Account reference
    // -------------------------------

    const accountReference =
      `${(subsidiaryCode || 'TECH').toUpperCase()}-INV-${invoiceId || '001'}`;


    // -------------------------------
    // STK Payload
    // -------------------------------

    const payload = {

      BusinessShortCode: MPESA_SHORTCODE,

      Password: password,

      Timestamp: timestamp,

      TransactionType: 'CustomerPayBillOnline',

      Amount: finalAmount,

      PartyA: formattedPhone,

      PartyB: MPESA_SHORTCODE,

      PhoneNumber: formattedPhone,

      CallBackURL: MPESA_CALLBACK_URL,

      AccountReference: accountReference,

      TransactionDesc:
        `Reymass ${subsidiaryCode || 'TECH'} Payment`
    };


    console.log('--------------------------------');
    console.log('M-PESA STK PUSH');
    console.log('Phone:', formattedPhone);
    console.log('Amount:', finalAmount);
    console.log('Timestamp:', timestamp);
    console.log('Account:', accountReference);
    console.log('Callback:', MPESA_CALLBACK_URL);
    console.log('--------------------------------');


    // -------------------------------
    // Get OAuth Token
    // -------------------------------

    const token = await getMpesaToken();


    // -------------------------------
    // Send STK Push
    // -------------------------------

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',

      payload,

      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );


    console.log(
      'STK Push Response:',
      JSON.stringify(response.data, null, 2)
    );


    return res.json({

      success: true,

      data: response.data,

      accountReference

    });


  } catch (error) {

    console.error(
      'STK Push Error:',
      error.response?.data || error.message
    );


    return res.status(500).json({

      success: false,

      error: error.response?.data || error.message

    });

  }

});


// ============================================
// M-PESA CALLBACK
// ============================================

app.post('/api/mpesa/callback', (req, res) => {

  console.log('================================');
  console.log('M-PESA CALLBACK RECEIVED');
  console.log('================================');

  console.log(
    JSON.stringify(req.body, null, 2)
  );


  // Always acknowledge Safaricom
  res.json({
    ResultCode: 0,
    ResultDesc: 'Accepted'
  });

});