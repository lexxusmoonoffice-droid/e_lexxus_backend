/**
 * Currency / FX rates.
 *
 * Phase 4 ships a static fallback table (sufficient to drive the
 * customer storefront's currency selector). Phase 11 swaps in a daily
 * cron + Redis cache hitting a real FX provider.
 *
 * Base = INR (matches our stored prices). Multiply an INR amount by
 * `rates[CCY]` to get the target-currency amount.
 */

const FALLBACK = {
  base: 'INR',
  rates: {
    INR: 1,
    USD: 0.012,
    EUR: 0.011,
    GBP: 0.0095,
    AUD: 0.018,
    CAD: 0.016,
    JPY: 1.84,
  },
  fetchedAt: null, // null signals "static fallback"
  static: true,
};

async function getRates() {
  // TODO Phase 11: try Redis cache → live API → fall through.
  return { ...FALLBACK, fetchedAt: new Date().toISOString() };
}

module.exports = { getRates };
