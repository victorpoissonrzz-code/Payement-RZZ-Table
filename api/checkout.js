const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

function getSiteUrl(req) {
  if (process.env.VERCEL_URL) return 'https://' + process.env.VERCEL_URL;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return proto + '://' + req.headers.host;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { lineItems, customerEmail, customerName, shippingAddress, promoDiscount } = req.body || {};
  if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0)
    return res.status(400).json({ error: 'Cart is empty' });

  const siteUrl = getSiteUrl(req);

  // Validate promo server-side
  const PROMO_CODES = { 'PLATED10': 0.10, 'WELCOME15': 0.15, 'ESSENTIEL20': 0.20 };
  const promoCode = (req.body.promoCode || '').toUpperCase();
  const promoRate = PROMO_CODES[promoCode] || 0;

  try {
    const stripeLineItems = lineItems.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: { name: item.name },
        unit_amount: item.amount,
      },
      quantity: item.quantity,
    }));

    let discounts = [];
    if (promoRate > 0) {
      const subtotal = lineItems.reduce((s, i) => s + i.amount * i.quantity, 0);
      const discountAmount = Math.round(subtotal * promoRate);
      const coupon = await stripe.coupons.create({
        amount_off: discountAmount,
        currency: 'usd',
        duration: 'once',
        name: 'Promo Plated ' + promoCode,
      });
      discounts = [{ coupon: coupon.id }];
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: stripeLineItems,
      customer_email: customerEmail || undefined,
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'GB', 'FR', 'DE', 'AU', 'JP'],
      },
      discounts: discounts.length ? discounts : undefined,
      metadata: {
        customer_name: customerName || '',
        shipping_line1: shippingAddress && shippingAddress.line1 || '',
        shipping_city: shippingAddress && shippingAddress.city || '',
        shipping_zip: shippingAddress && shippingAddress.postal_code || '',
        shipping_country: shippingAddress && shippingAddress.country || 'US',
      },
      success_url: siteUrl + '?payment=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: siteUrl + '?payment=cancel',
      custom_text: {
        submit: { message: 'Your order will be prepared and dispatched within 2 business days.' },
      },
      payment_method_types: ['card'],
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[Plated] Stripe error:', err.message);
    return res.status(500).json({ error: err.message || 'Stripe session creation failed' });
  }
};