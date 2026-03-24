// netlify/functions/_tenants.js
// Tenant registry — maps subdomains to configuration.
// To add a new tenant: add an entry here and set DATABASE_URL_<SLUG> in Netlify env vars.

const TENANTS = {
  medicana: {
    slug: 'medicana',
    dbEnvVar: 'DATABASE_URL',
    name: 'Medicana Winchester',
    brandColors: {
      light: '#5DCAA5',
      mid: '#0F6E56',
      dark: '#085041',
      deepest: '#04342C',
      pale: '#E1F5EE'
    },
    pharmacistEmail: 'Aasit.Badiani@Medicana.co.uk',
    logos: {
      login: 'assets/branding/logo-login.png',
      header: 'assets/branding/logo-header.png',
      hospital: 'assets/branding/hospital-logo.png',
      favicon: 'assets/branding/favicon.png'
    }
  }
};

const DEFAULT_TENANT = 'medicana';

/**
 * Extract tenant slug from the request's Host header.
 * Expected format: <slug>.clinitrack.co.uk
 * Falls back to DEFAULT_TENANT for localhost, Netlify preview URLs, etc.
 */
function resolveTenant(event) {
  const host = (event.headers.host || event.headers.Host || '').toLowerCase();

  // Match <slug>.clinitrack.co.uk
  const match = host.match(/^([a-z0-9-]+)\.clinitrack\.co\.uk$/);
  if (match) {
    const slug = match[1];
    if (TENANTS[slug]) return TENANTS[slug];
    return null; // unknown tenant
  }

  // Localhost, Netlify preview deploys, or direct .netlify.app access → default tenant
  return TENANTS[DEFAULT_TENANT];
}

module.exports = { TENANTS, DEFAULT_TENANT, resolveTenant };
