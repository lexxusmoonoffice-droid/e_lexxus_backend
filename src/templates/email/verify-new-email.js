const { layout, escape, button } = require('./_layout');

/**
 * Sent to the *new* email address when a user requests an email change.
 * data: { appName, user, newEmail, url }
 */
module.exports = function verifyNewEmail({ appName, user, newEmail, url }) {
  const body = `
    <p>Hi ${escape(user.name)},</p>
    <p>We received a request to change your ${escape(appName)} account email address to
       <strong>${escape(newEmail)}</strong>.</p>
    <p>Click the button below to confirm this change. Your current email address will
       remain active until you do.</p>
    ${button('Confirm new email address', url)}
    <p style="font-size:14px;color:#555">
      This link expires in 24 hours. If you didn't request this change, you can
      safely ignore this email — your account email will not be changed.
    </p>
  `;
  return {
    subject: `Confirm your new ${appName} email address`,
    html: layout({
      appName,
      title: 'Confirm your new email',
      body,
      preheader: `Confirm your new email address for ${appName}.`,
    }),
  };
};
