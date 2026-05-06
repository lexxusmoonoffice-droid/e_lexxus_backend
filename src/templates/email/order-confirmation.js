const { layout, escape, rupees, button } = require('./_layout');

function rows(items) {
  return items
    .map((i) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee">
          ${escape(i.title || i.product?.title || i.bundle?.name || 'Item')}
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">
          ${i.qty} × ${rupees(i.priceAtPurchase)}
        </td>
      </tr>`)
    .join('');
}

module.exports = function orderConfirmation({ appName, user, order, downloadUrl, orderUrl }) {
  const body = `
    <p>Hi ${escape(order.billing?.name || user.name)},</p>
    <p>Thanks for your purchase. Your order is confirmed.</p>
    <table role="presentation" width="100%" style="border-collapse:collapse;margin:16px 0">
      ${rows(order.items || [])}
      <tr>
        <td style="padding:12px 0;font-weight:700">Total</td>
        <td style="padding:12px 0;text-align:right;font-weight:700">${rupees(order.total)}</td>
      </tr>
    </table>
    ${button('Download your files', downloadUrl)}
    <p style="font-size:12px;color:#888">
      Order ID: <code>${escape(String(order._id || order.id))}</code>
      &middot; <a href="${orderUrl}">view order</a>
    </p>
  `;
  return {
    subject: `Order ${String(order._id || order.id).slice(-8).toUpperCase()} confirmed — ${appName}`,
    html: layout({ appName, title: 'Order confirmed', body, preheader: 'Thanks for your purchase.' }),
  };
};
