require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

const SUMUP_API_KEY = process.env.SUMUP_API_KEY || 'sup_sk_btkVjoMOqjRgBnJDe3HfRu6QY44IWUHi0';
const SUMUP_BASE_URL = 'https://api.sumup.com/v0.1';
const APP_URL = process.env.APP_URL || 'http://localhost:10000';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const pendingOrders = new Map();

async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'HTML'
    });
  } catch (error) {
    console.error('Telegram error:', error.message);
  }
}

app.get('/', (req, res) => {
  res.json({ 
    status: 'active',
    message: 'SumUp Card Gateway Running',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.post('/api/save-customer-data', async (req, res) => {
  try {
    const { checkoutId, customerData, cartData } = req.body;
    
    if (!checkoutId || !customerData) {
      return res.status(400).json({ status: 'error', message: 'Missing data' });
    }
    
    const checkoutResponse = await axios.get(`${SUMUP_BASE_URL}/checkouts/${checkoutId}`, {
      headers: {
        'Authorization': `Bearer ${SUMUP_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const checkout = checkoutResponse.data;
    
    let productsText = '';
    if (cartData && cartData.items) {
      productsText = '\n\n<b>🛒 Products:</b>\n';
      cartData.items.forEach(item => {
        const itemPrice = (item.line_price || (item.price * item.quantity)) / 100;
        productsText += `• ${item.quantity}x ${item.title} - €${itemPrice.toFixed(2)}\n`;
      });
    }
    
    const message = `
<b>✅ PAYMENT RECEIVED - SUMUP CARD</b>

<b>💰 Amount:</b> €${checkout.amount}
<b>👤 Customer:</b> ${customerData.firstName} ${customerData.lastName}
<b>📧 Email:</b> ${customerData.email}
<b>📍 Address:</b> ${customerData.address}, ${customerData.postalCode} ${customerData.city}
<b>🆔 Checkout ID:</b> ${checkoutId}${productsText}

<b>✓ Status:</b> Paid
    `.trim();
    
    await sendTelegramMessage(message);
    
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/api/check-payment/:checkoutId', async (req, res) => {
  const { checkoutId } = req.params;
  
  try {
    const response = await axios.get(`${SUMUP_BASE_URL}/checkouts/${checkoutId}`, {
      headers: {
        'Authorization': `Bearer ${SUMUP_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const checkout = response.data;
    let actualStatus = checkout.status;
    
    if (checkout.transactions && checkout.transactions.length > 0) {
      const successfulTxn = checkout.transactions.find(txn => txn.status === 'SUCCESSFUL');
      if (successfulTxn) {
        actualStatus = 'PAID';
      }
    }
    
    res.json({ status: actualStatus, checkout: checkout });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/checkout', async (req, res) => {
  const { amount, currency, order_id, return_url, cart_items } = req.body;
  
  if (!amount || !currency) {
    return res.status(400).send('Missing required parameters');
  }

  let cartData = null;
  if (cart_items) {
    try {
      cartData = typeof cart_items === 'string' ? JSON.parse(cart_items) : cart_items;
    } catch (e) {
      console.error('Error parsing cart_items:', e);
    }
  }

  const checkoutRef = order_id ? `order-${order_id}-${Date.now()}` : `order-${Date.now()}`;

  try {
    const checkoutData = {
      checkout_reference: checkoutRef,
      amount: parseFloat(amount),
      currency: currency.toUpperCase(),
      pay_to_email: 'Deninurio1998@gmail.com',
      description: `Order ${order_id || ''}`
    };

    console.log('Creating SumUp checkout:', checkoutData);

    const sumupResponse = await axios.post(
      `${SUMUP_BASE_URL}/checkouts`,
      checkoutData,
      {
        headers: {
          'Authorization': `Bearer ${SUMUP_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const checkout = sumupResponse.data;
    console.log('SumUp checkout created:', checkout.id);
    
    if (order_id) {
      pendingOrders.set(checkout.id, {
        order_id,
        amount,
        currency,
        return_url,
        cart_data: cartData,
        created_at: new Date()
      });
    }

    res.send(`
      <html>
        <head>
          <title>Pay - €${amount}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <script src="https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js"></script>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f5f5f5; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { text-align: center; color: #333; margin-bottom: 10px; font-size: 28px; }
            .amount { text-align: center; font-size: 48px; font-weight: bold; color: #000; margin: 20px 0; }
            .section { margin: 30px 0; padding: 20px 0; border-top: 1px solid #e0e0e0; }
            .section:first-child { border-top: none; padding-top: 0; }
            .section-title { font-size: 18px; font-weight: 600; color: #333; margin-bottom: 15px; }
            .form-group { margin-bottom: 15px; }
            label { display: block; font-size: 14px; color: #555; margin-bottom: 5px; font-weight: 500; }
            input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px; }
            input:focus { outline: none; border-color: #000; }
            .form-row { display: flex; gap: 15px; }
            .form-row .form-group { flex: 1; }
            #sumup-card { margin: 20px 0; }
            .error { background: #ffebee; color: #c62828; padding: 15px; border-radius: 5px; margin: 20px 0; display: none; }
            .loading { display: none; text-align: center; padding: 20px; color: #666; }
            .success-popup { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); z-index: 9999; text-align: center; display: none; min-width: 400px; }
            .success-popup.show { display: block; }
            .success-popup-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9998; display: none; }
            .success-popup-overlay.show { display: block; }
            .success-icon { font-size: 60px; color: #4CAF50; margin-bottom: 20px; }
            .success-title { font-size: 24px; font-weight: bold; color: #333; margin-bottom: 10px; }
            @media (max-width: 600px) { .container { padding: 20px; } .amount { font-size: 36px; } }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>💳 Pay with Card</h1>
            <div class="amount">€${amount}</div>
            
            <div id="error-message" class="error"></div>
            <div id="loading-message" class="loading">Processing payment...</div>
            
            <div id="success-popup-overlay" class="success-popup-overlay"></div>
            <div id="success-popup" class="success-popup">
              <div class="success-icon">✓</div>
              <div class="success-title">Payment Successful!</div>
            </div>
            
            <div class="section">
              <div class="section-title">Customer Information</div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="firstName">First Name *</label>
                  <input type="text" id="firstName" required>
                </div>
                <div class="form-group">
                  <label for="lastName">Last Name *</label>
                  <input type="text" id="lastName" required>
                </div>
              </div>
              
              <div class="form-group">
                <label for="email">Email Address *</label>
                <input type="email" id="email" required>
              </div>
              
              <div class="form-group">
                <label for="phone">Phone Number</label>
                <input type="tel" id="phone">
              </div>
            </div>

            <div class="section">
              <div class="section-title">Billing Address</div>
              
              <div class="form-group">
                <label for="address">Address *</label>
                <input type="text" id="address" required>
              </div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="postalCode">Eircode *</label>
                  <input type="text" id="postalCode" required>
                </div>
                <div class="form-group">
                  <label for="city">City *</label>
                  <input type="text" id="city" required>
                </div>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Payment Details</div>
              <div id="sumup-card"></div>
            </div>
          </div>

          <script>
            let customerData = {};
            const cartData = ${cartData ? JSON.stringify(cartData) : 'null'};
            const checkoutId = '${checkout.id}';
            let pollingInterval = null;

            function validateCustomerInfo() {
              const firstName = document.getElementById('firstName').value.trim();
              const lastName = document.getElementById('lastName').value.trim();
              const email = document.getElementById('email').value.trim();
              const address = document.getElementById('address').value.trim();
              const postalCode = document.getElementById('postalCode').value.trim();
              const city = document.getElementById('city').value.trim();
              
              if (!firstName || !lastName || !email || !address || !postalCode || !city) {
                return false;
              }
              
              customerData = {
                firstName,
                lastName,
                email,
                phone: document.getElementById('phone').value.trim(),
                address,
                postalCode,
                city
              };
              
              return true;
            }

            async function checkPaymentStatus() {
              try {
                const response = await fetch('/api/check-payment/' + checkoutId);
                const data = await response.json();
                
                if (data.status === 'PAID') {
                  if (pollingInterval) clearInterval(pollingInterval);
                  
                  document.getElementById('loading-message').style.display = 'block';
                  document.getElementById('loading-message').innerHTML = '✓ Payment successful!';
                  
                  await fetch('/api/save-customer-data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ checkoutId, customerData, cartData })
                  });
                  
                  document.getElementById('loading-message').style.display = 'none';
                  document.getElementById('success-popup-overlay').classList.add('show');
                  document.getElementById('success-popup').classList.add('show');
                  
                  setTimeout(() => {
                    window.location.href = '${return_url || APP_URL}';
                  }, 2000);
                } else if (data.status === 'FAILED') {
                  if (pollingInterval) clearInterval(pollingInterval);
                  document.getElementById('loading-message').style.display = 'none';
                  document.getElementById('error-message').style.display = 'block';
                  document.getElementById('error-message').innerHTML = '✗ Payment failed';
                }
              } catch (error) {
                console.error('Error:', error);
              }
            }

            function startPolling() {
              checkPaymentStatus();
              pollingInterval = setInterval(checkPaymentStatus, 2000);
              setTimeout(() => { if (pollingInterval) clearInterval(pollingInterval); }, 120000);
            }

            SumUpCard.mount({
              checkoutId: checkoutId,
              showSubmitButton: true,
              locale: 'en-IE',
              onResponse: function(type, body) {
                const errorDiv = document.getElementById('error-message');
                const loadingDiv = document.getElementById('loading-message');
                
                switch(type) {
                  case 'sent':
                    if (!validateCustomerInfo()) {
                      errorDiv.style.display = 'block';
                      errorDiv.innerHTML = '✗ Please fill in all required fields';
                      return;
                    }
                    loadingDiv.style.display = 'block';
                    loadingDiv.innerHTML = 'Processing payment...';
                    startPolling();
                    break;
                    
                  case 'auth-screen':
                    loadingDiv.style.display = 'block';
                    loadingDiv.innerHTML = 'Verifying... Please complete 3D Secure authentication.';
                    if (!pollingInterval) startPolling();
                    break;
                    
                  case 'success':
                    loadingDiv.style.display = 'block';
                    loadingDiv.innerHTML = 'Confirming payment...';
                    if (!pollingInterval) startPolling();
                    break;
                    
                  case 'error':
                    if (pollingInterval) clearInterval(pollingInterval);
                    loadingDiv.style.display = 'none';
                    errorDiv.style.display = 'block';
                    errorDiv.innerHTML = '✗ Payment failed: ' + (body.message || 'Please try again');
                    break;
                    
                  case 'invalid':
                    if (pollingInterval) clearInterval(pollingInterval);
                    loadingDiv.style.display = 'none';
                    errorDiv.style.display = 'block';
                    errorDiv.innerHTML = '✗ Invalid card details';
                    break;
                }
              }
            });
          </script>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send(`
      <html>
        <head><title>Payment Error</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>An error occurred</h1>
          <p>We couldn't start the payment. Please try again.</p>
          <p style="color: #666; font-size: 14px;">${error.message}</p>
        </body>
      </html>
    `);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
