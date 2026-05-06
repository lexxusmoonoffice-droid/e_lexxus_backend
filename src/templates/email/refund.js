const { layout, escape, rupees } = require('./_layout');

module.exports = function refund({ appName, user, order }) {
  const body = `
    <p>Hi ${escape(order.billing?.name || user.name)},</p>
    <p>Your refund of <strong>${rupees(order.total)}</strong> has been processed for
       order <code>${escape(String(order._id || order.id))}</code>.
       It may take 5–7 business days to appear on your statement.</p>
  `;
  return {
    subject: `Refund processed — ${appName}`,
    html: layout({ appName, title: 'Refund processed', body, preheader: 'Your refund is on its way.' }),
  };
};
