/**
 * Registry of email templates. Each template module is a function
 *   (data) => { subject, html }
 *
 *   const { render } = require('./templates/email');
 *   const { subject, html } = render('verify-email', { appName, user, url });
 */

const registry = {
  'verify-email': require('./verify-email'),
  'password-reset': require('./password-reset'),
  welcome: require('./welcome'),
  'order-confirmation': require('./order-confirmation'),
  'download-link': require('./download-link'),
  refund: require('./refund'),
  'payment-failed': require('./payment-failed'),
  'account-suspended': require('./account-suspended'),
  'otp-login': require('./otp-login'),
};

function render(name, data) {
  const tmpl = registry[name];
  if (!tmpl) throw new Error(`Unknown email template: ${name}`);
  const { subject, html } = tmpl(data);
  return { subject, html };
}

function available() {
  return Object.keys(registry);
}

module.exports = { render, available };
