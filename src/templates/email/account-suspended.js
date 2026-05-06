const { layout, escape } = require('./_layout');

module.exports = function accountSuspended({ appName, user, supportEmail }) {
  const body = `
    <p>Hi ${escape(user.name)},</p>
    <p>Your ${escape(appName)} account has been suspended.</p>
    <p>If you think this is a mistake, reply to this email
       ${supportEmail ? `or contact <a href="mailto:${supportEmail}">${supportEmail}</a>` : ''}.
    </p>
  `;
  return {
    subject: `Your ${appName} account has been suspended`,
    html: layout({ appName, title: 'Account suspended', body }),
  };
};
