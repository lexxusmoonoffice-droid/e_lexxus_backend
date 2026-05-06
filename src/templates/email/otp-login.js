const { layout, escape } = require('./_layout');

module.exports = function otpLogin({ appName, user, otp }) {
  const body = `
    <p>Hi ${escape(user.name)},</p>
    <p>Use the code below to sign in to your ${escape(appName)} account:</p>
    <div style="margin:28px 0;text-align:center">
      <span style="display:inline-block;font-size:36px;font-weight:700;letter-spacing:10px;padding:16px 32px;background:#f4f4f4;border-radius:8px;color:#111">${escape(otp)}</span>
    </div>
    <p style="font-size:14px;color:#555">This code expires in <strong>10 minutes</strong>. If you didn't request this, you can safely ignore this email.</p>
  `;
  return {
    subject: `${otp} — your ${appName} sign-in code`,
    html: layout({ appName, title: 'Your sign-in code', body, preheader: `Your one-time code is ${otp}` }),
  };
};
