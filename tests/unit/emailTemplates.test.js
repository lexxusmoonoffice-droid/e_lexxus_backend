const { render, available } = require('../../src/templates/email');

const sampleUser = { name: 'Alex Novak', email: 'alex@x.com' };
const sampleOrder = {
  _id: '6591c0ffee00000000000001',
  total: 9500,
  downloadToken: 'tok-abc',
  items: [{ title: 'Sofa Harlem', qty: 1, priceAtPurchase: 9500 }],
  billing: { name: 'Alex', email: 'alex@x.com', country: 'IN' },
};

describe('email templates', () => {
  it('lists all registered templates', () => {
    expect(available().sort()).toEqual(
      [
        'account-suspended',
        'download-link',
        'order-confirmation',
        'password-reset',
        'payment-failed',
        'refund',
        'verify-email',
        'welcome',
      ].sort(),
    );
  });

  it('verify-email renders subject + html with the url', () => {
    const { subject, html } = render('verify-email', {
      appName: 'Lexxus',
      user: sampleUser,
      url: 'https://lexxus.com/verify?token=xyz',
    });
    expect(subject).toMatch(/Verify/);
    expect(html).toContain('Alex Novak');
    expect(html).toContain('https://lexxus.com/verify?token=xyz');
  });

  it('password-reset includes 1 hour expiry language', () => {
    const { html } = render('password-reset', {
      appName: 'Lexxus',
      user: sampleUser,
      url: 'https://lexxus.com/reset?t=abc',
    });
    expect(html).toMatch(/1 hour/);
  });

  it('order-confirmation includes total + downloadUrl + items', () => {
    const { subject, html } = render('order-confirmation', {
      appName: 'Lexxus',
      user: sampleUser,
      order: sampleOrder,
      downloadUrl: 'https://x/dl',
      orderUrl: 'https://x/o',
    });
    expect(subject).toMatch(/Order.*confirmed/i);
    expect(html).toContain('Sofa Harlem');
    expect(html).toContain('9,500');
    expect(html).toContain('https://x/dl');
  });

  it('download-link shows ttl + limit', () => {
    const { html } = render('download-link', {
      appName: 'Lexxus',
      user: sampleUser,
      order: sampleOrder,
      url: 'https://x/dl',
      ttlDays: 30,
      limit: 5,
    });
    expect(html).toMatch(/30 days/);
    expect(html).toMatch(/5 downloads/);
  });

  it('refund shows the refund amount', () => {
    const { html } = render('refund', {
      appName: 'Lexxus',
      user: sampleUser,
      order: sampleOrder,
    });
    expect(html).toContain('9,500');
  });

  it('payment-failed optionally renders retry button', () => {
    const { html } = render('payment-failed', {
      appName: 'Lexxus',
      user: sampleUser,
      order: sampleOrder,
      retryUrl: 'https://x/checkout',
    });
    expect(html).toContain('https://x/checkout');
  });

  it('account-suspended includes support email', () => {
    const { html } = render('account-suspended', {
      appName: 'Lexxus',
      user: sampleUser,
      supportEmail: 'help@lexxus.com',
    });
    expect(html).toContain('help@lexxus.com');
  });

  it('welcome includes frontend url button', () => {
    const { html } = render('welcome', {
      appName: 'Lexxus',
      user: sampleUser,
      frontendUrl: 'https://lexxus.com',
    });
    expect(html).toContain('https://lexxus.com');
  });

  it('unknown template throws', () => {
    expect(() => render('nope', {})).toThrow(/Unknown email template/);
  });

  it('html-escapes user-controlled strings', () => {
    const { html } = render('welcome', {
      appName: 'Lexxus',
      user: { name: '<script>alert(1)</script>' },
      frontendUrl: 'https://lexxus.com',
    });
    expect(html).not.toMatch(/<script>alert/);
    expect(html).toContain('&lt;script&gt;');
  });
});
