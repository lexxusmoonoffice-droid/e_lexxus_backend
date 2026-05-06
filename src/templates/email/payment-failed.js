const { layout, escape, button } = require('./_layout');

module.exports = function paymentFailed({ appName, user, order, retryUrl }) {
  const body = `
    <p>Hi ${escape(order.billing?.name || user.name)},</p>
    <p>Unfortunately your payment could not be processed for order
       <code>${escape(String(order._id || order.id))}</code>.
       Your card was not charged.</p>
    ${retryUrl ? button('Retry payment', retryUrl) : ''}
  `;
  return {
    subject: `Payment failed for order ${String(order._id || order.id).slice(-8).toUpperCase()}`,
    html: layout({ appName, title: 'Payment failed', body, preheader: 'Your card was not charged.' }),
  };
};
