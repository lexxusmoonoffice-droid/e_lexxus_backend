const { layout, escape, button } = require('./_layout');

module.exports = function passwordReset({ appName, user, url }) {
  const body = `
    <p>Hi ${escape(user.name)},</p>
    <p>You (or someone using your email) asked to reset your password.</p>
    ${button('Choose a new password', url)}
    <p style="font-size:14px;color:#555">
      This link expires in 1 hour. If you didn't ask, ignore this email — your password is unchanged.
    </p>
  `;
  return {
    subject: `Reset your ${appName} password`,
    html: layout({ appName, title: 'Reset your password', body, preheader: 'Choose a new password.' }),
  };
};
