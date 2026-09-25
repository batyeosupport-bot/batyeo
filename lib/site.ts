/** Public address of the site: canonical links, sitemap and social previews all point here. Set NEXT_PUBLIC_SITE_URL once a custom domain is live. */
export const SITE_URL=(process.env.NEXT_PUBLIC_SITE_URL||'https://batyeo.vercel.app').replace(/\/+$/,'');
