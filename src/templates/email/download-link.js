const { layout, escape, button } = require('./_layout');

module.exports = function downloadLink({ appName, user, order, url, ttlDays, limit }) {
  const body = `
    <p>Hi ${escape(order.billing?.name || user.name)},</p>
    <p>Your purchase is ready to download:</p>
    ${button('Open your downloads', url)}
    <p style="font-size:14px;color:#555">
      The link is valid for ${ttlDays} days, with a limit of ${limit} downloads.
    </p>
  `;
  return {
    subject: `Your downloads are ready — ${appName}`,
    html: layout({ appName, title: 'Your downloads are ready', body, preheader: 'Ready to download.' }),
  };
};
