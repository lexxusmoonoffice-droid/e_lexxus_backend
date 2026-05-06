const { layout, escape, button } = require('./_layout');

module.exports = function verifyEmail({ appName, user, url }) {
  const body = `
    <p>Hi ${escape(user.name)},</p>
    <p>Welcome to ${escape(appName)}. Confirm your email to start downloading:</p>
    ${button('Verify your email', url)}
    <p style="font-size:14px;color:#555">
      This link expires in 24 hours. If you didn't sign up, you can ignore this email.
    </p>
  `;
  return {
    subject: `Verify your ${appName} account`,
    html: layout({ appName, title: 'Verify your email', body, preheader: 'Confirm your email to start downloading.' }),
  };
};
