// netlify/functions/tenant-config.js
// Public endpoint — returns branding configuration for the current tenant.
// The frontend fetches this at startup to dynamise titles, logos, colors, etc.
const db = require('./_db');
const { resolveTenant } = require('./_tenants');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return db.methodNotAllowed();

  const tenant = resolveTenant(event);

  // Bare domain (clinitrack.co.uk) — no tenant, return landing flag
  if (!tenant) {
    return db.ok({ landing: true });
  }

  return db.ok({
    tenant: {
      slug: tenant.slug,
      name: tenant.name,
      brandColors: tenant.brandColors,
      pharmacistEmail: tenant.pharmacistEmail,
      logos: tenant.logos
    }
  });
};
