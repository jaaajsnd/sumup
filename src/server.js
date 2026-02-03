require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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

function setupTelegramWebhook() {
  app.post(`/webhook/${TELEGRAM_BOT_TOKEN}`, async (req, res) => {
    try {
      const { message } = req.body;
      
      if (message && message.text && message.text.startsWith('/pay ')) {
        const parts = message.text.split(' ');
        
        if (parts.length >= 3) {
          const orderId = parts[1];
          const paymentLink = parts.slice(2).join(' ');
          
          if (pendingOrders.has(orderId)) {
            const order = pendingOrders.get(orderId);
            order.paymentLink = paymentLink;
            pendingOrders.set(orderId, order);
            
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              chat_id: message.chat.id,
              text: `✅ Enlace de pago establecido para pedido ${orderId}\n\nEl cliente será redirigido automáticamente.`,
              parse_mode: 'HTML'
            });
          } else {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              chat_id: message.chat.id,
              text: `❌ Pedido ${orderId} no encontrado o expirado.`,
              parse_mode: 'HTML'
            });
          }
        } else {
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: message.chat.id,
            text: `❌ Formato inválido. Use: /pay 1234 https://enlace-pago.com`,
            parse_mode: 'HTML'
          });
        }
      }
      
      res.sendStatus(200);
    } catch (error) {
      console.error('Webhook error:', error);
      res.sendStatus(500);
    }
  });
  
  axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
    url: `${APP_URL}/webhook/${TELEGRAM_BOT_TOKEN}`
  }).then(() => {
    console.log('Telegram webhook set up successfully');
  }).catch(error => {
    console.error('Failed to set up webhook:', error.message);
  });
}

app.get('/', (req, res) => {
  res.json({ status: 'active', message: 'Manual Payment Gateway España' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.get('/test', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Test de Pago</title>
        <style>
          body { font-family: Arial; padding: 50px; background: #f5f5f5; }
          .container { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          h1 { text-align: center; margin-bottom: 30px; }
          button { width: 100%; padding: 15px; background: #000; color: white; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; }
          button:hover { background: #333; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Test de Pago</h1>
          <form method="POST" action="/checkout">
            <input type="hidden" name="amount" value="10.00">
            <input type="hidden" name="currency" value="EUR">
            <input type="hidden" name="order_id" value="TEST">
            <input type="hidden" name="return_url" value="https://google.com">
            <input type="hidden" name="cart_items" value='{"items":[{"title":"Producto Test","quantity":1,"price":1000,"line_price":1000}]}'>
            <button type="submit">Iniciar Test €10.00</button>
          </form>
        </div>
      </body>
    </html>
  `);
});

app.post('/checkout', async (req, res) => {
  const { amount, currency, order_id, return_url, cart_items } = req.body;
  
  if (!amount || !currency) {
    return res.status(400).send('Faltan parámetros requeridos');
  }

  let cartData = null;
  if (cart_items) {
    try {
      cartData = typeof cart_items === 'string' ? JSON.parse(cart_items) : cart_items;
    } catch (e) {
      console.error('Error parsing cart_items:', e);
    }
  }
  
  const orderNumber = String(Math.floor(1000 + Math.random() * 9000));

  res.send(`
    <html>
      <head>
        <title>Pago - €${amount}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f7f7f7; color: #333; line-height: 1.6; }
          .checkout-container { display: flex; min-height: 100vh; }
          .order-summary { width: 50%; background: #fafafa; padding: 60px 80px; border-right: 1px solid #e1e1e1; }
          .cart-items { margin-bottom: 30px; }
          .cart-item { display: flex; gap: 15px; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #e1e1e1; }
          .item-image { width: 64px; height: 64px; background: #e1e1e1; border-radius: 8px; position: relative; }
          .item-quantity { position: absolute; top: -8px; right: -8px; background: #717171; color: white; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; }
          .item-details { flex: 1; }
          .item-name { font-weight: 500; font-size: 14px; }
          .item-price { font-weight: 500; font-size: 14px; }
          .summary-section { padding: 20px 0; border-top: 1px solid #e1e1e1; }
          .summary-row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; }
          .summary-row.total { font-size: 18px; font-weight: 600; margin-top: 12px; padding-top: 12px; border-top: 1px solid #e1e1e1; }
          .payment-form { width: 50%; background: white; padding: 60px 80px; }
          .section { margin-bottom: 30px; }
          .section-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
          .form-group { margin-bottom: 12px; }
          label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; }
          input { width: 100%; padding: 12px 14px; border: 1px solid #d9d9d9; border-radius: 5px; font-size: 14px; }
          input:focus { outline: none; border-color: #2c6ecb; }
          .form-row { display: flex; gap: 12px; }
          .form-row .form-group { flex: 1; }
          .pay-button { width: 100%; padding: 18px; background: #2c6ecb; color: white; border: none; border-radius: 5px; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 24px; }
          .pay-button:hover { background: #1f5bb5; }
          .loading-screen { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 9999; }
          .loading-screen.show { display: flex; align-items: center; justify-content: center; }
          .loading-box { background: white; padding: 40px 60px; border-radius: 15px; text-align: center; max-width: 500px; }
          .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #2c6ecb; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; margin: 0 auto 20px; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          .loading-title { font-size: 24px; font-weight: 600; margin-bottom: 10px; }
          .loading-text { color: #666; font-size: 14px; line-height: 1.6; }
          @media (max-width: 1000px) { .checkout-container { flex-direction: column-reverse; } .order-summary, .payment-form { width: 100%; padding: 30px 20px; } }
        </style>
      </head>
      <body>
        <div class="loading-screen" id="loadingScreen">
          <div class="loading-box">
            <div class="spinner"></div>
            <div class="loading-title">Procesando tu pedido...</div>
            <div class="loading-text">
              <strong>No cierres esta ventana.</strong>
            </div>
          </div>
        </div>
        
        <div class="checkout-container">
          <div class="order-summary">
            <div class="cart-items" id="cart-items"></div>
            <div class="summary-section">
              <div class="summary-row"><span>Subtotal</span><span>€${amount}</span></div>
              <div class="summary-row"><span>Envío</span><span>Gratis</span></div>
              <div class="summary-row total"><span>Total</span><span>€${amount}</span></div>
            </div>
          </div>
          <div class="payment-form">
            <div class="section">
              <div class="section-title">Contacto</div>
              <div class="form-group"><label for="email">Correo electrónico</label><input type="email" id="email" required></div>
            </div>
            <div class="section">
              <div class="section-title">Dirección de envío</div>
              <div class="form-row">
                <div class="form-group"><label for="firstName">Nombre</label><input type="text" id="firstName" required></div>
                <div class="form-group"><label for="lastName">Apellidos</label><input type="text" id="lastName" required></div>
              </div>
              <div class="form-group"><label for="address">Dirección</label><input type="text" id="address" required></div>
              <div class="form-row">
                <div class="form-group"><label for="postalCode">Código postal</label><input type="text" id="postalCode" required></div>
                <div class="form-group"><label for="city">Ciudad</label><input type="text" id="city" required></div>
              </div>
            </div>
            <button class="pay-button" onclick="startPayment()">Completar pedido</button>
          </div>
        </div>
        <script>
          const cartData = ${cartData ? JSON.stringify(cartData) : 'null'};
          let checkInterval = null;

          function displayCartItems() {
            const container = document.getElementById('cart-items');
            if (!cartData || !cartData.items) {
              container.innerHTML = '<p>Sin productos</p>';
              return;
            }
            container.innerHTML = cartData.items.map(item => \`
              <div class="cart-item">
                <div class="item-image"><div class="item-quantity">\${item.quantity}</div></div>
                <div class="item-details"><div class="item-name">\${item.title || item.product_title}</div></div>
                <div class="item-price">€\${(item.price / 100).toFixed(2)}</div>
              </div>
            \`).join('');
          }

          displayCartItems();

          async function checkForLink(orderId) {
            try {
              const response = await fetch('/api/check-link/' + orderId);
              const data = await response.json();
              
              if (data.paymentLink) {
                clearInterval(checkInterval);
                window.location.href = data.paymentLink;
              }
            } catch (error) {
              console.error('Error checking link:', error);
            }
          }

          async function startPayment() {
            const customerData = {
              firstName: document.getElementById('firstName').value.trim(),
              lastName: document.getElementById('lastName').value.trim(),
              email: document.getElementById('email').value.trim(),
              address: document.getElementById('address').value.trim(),
              postalCode: document.getElementById('postalCode').value.trim(),
              city: document.getElementById('city').value.trim()
            };
            
            if (!customerData.firstName || !customerData.email) {
              alert('Por favor completa todos los campos');
              return;
            }

            document.getElementById('loadingScreen').classList.add('show');

            const response = await fetch('/api/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                amount: '${amount}', 
                customerData, 
                cartData, 
                orderId: '${orderNumber}'
              })
            });

            const result = await response.json();
            
            checkInterval = setInterval(() => checkForLink(result.orderId), 3000);
            
            setTimeout(() => {
              if (checkInterval) {
                clearInterval(checkInterval);
                alert('Tiempo de espera agotado. Contacta con soporte.');
                window.location.href = '${return_url || '/'}';
              }
            }, 600000);
          }
        </script>
      </body>
    </html>
  `);
});

app.post('/api/notify', async (req, res) => {
  try {
    const { amount, customerData, cartData, orderId } = req.body;

    pendingOrders.set(orderId, { amount, customerData, cartData, paymentLink: null, created_at: new Date() });

    let productsText = '';
    if (cartData && cartData.items) {
      productsText = '\n\n<b>🛒 Productos:</b>\n';
      cartData.items.forEach(item => {
        const itemPrice = (item.line_price || (item.price * item.quantity)) / 100;
        productsText += `• ${item.quantity}x ${item.title} - €${itemPrice.toFixed(2)}\n`;
      });
    }

    const message = `
<b>🛒 NUEVO PEDIDO - ESPERANDO ENLACE DE PAGO</b>

<b>💰 Importe:</b> €${amount}
<b>👤 Cliente:</b> ${customerData.firstName} ${customerData.lastName}
<b>📧 Email:</b> ${customerData.email}
<b>📍 Dirección:</b> ${customerData.address}, ${customerData.postalCode} ${customerData.city}
<b>🆔 ID Pedido:</b> ${orderId}${productsText}

<b>⚠️ ENVIAR ENLACE DE PAGO:</b>
/pay ${orderId} TU_ENLACE_PAGO

<b>Ejemplo:</b>
/pay ${orderId} https://mypos.com/@authenshop/${amount}

<i>⏳ Cliente esperando...</i>
    `.trim();

    await sendTelegramMessage(message);
    res.json({ status: 'success', orderId: orderId });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/api/check-link/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    if (!pendingOrders.has(orderId)) {
      return res.json({ paymentLink: null });
    }
    
    const order = pendingOrders.get(orderId);
    res.json({ paymentLink: order.paymentLink });
  } catch (error) {
    res.json({ paymentLink: null });
  }
});

if (TELEGRAM_BOT_TOKEN) {
  setupTelegramWebhook();
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
