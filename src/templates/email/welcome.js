const { layout, escape, button } = require('./_layout');

module.exports = function welcome({ appName, user, frontendUrl }) {
  const body = `
    <p>Hi ${escape(user.name)},</p>
    <p>Your ${escape(appName)} account is ready. Browse thousands of
       production-ready 3D models, scenes, and textures.</p>
    ${button('Explore the store', frontendUrl)}
  `;
  return {
    subject: `Welcome to ${appName}`,
    html: layout({ appName, title: `Welcome to ${appName}`, body, preheader: 'Your account is ready.' }),
  };
};
