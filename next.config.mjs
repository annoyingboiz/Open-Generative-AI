/** @type {import('next').NextConfig} */
// Redesign package 01 (section 4.4): new addresses; every old one redirects.
const OLD_TABS = [
  ['create', 'studio'], ['director', 'storyboard'], ['library', 'work'], ['liked', 'work#liked'], ['cinema', 'studio'],
];
const nextConfig = {
  transpilePackages: ['studio'],
  poweredByHeader: false,
  experimental: { optimizePackageImports: ['@phosphor-icons/react'] },
  async redirects() {
    return [
      { source: '/studio', destination: '/library/studio', permanent: false },
      ...OLD_TABS.map(([from, to]) => ({ source: `/studio/${from}`, destination: `/library/${to}`, permanent: false })),
      { source: '/studio/:tab', destination: '/library/:tab', permanent: false },
      { source: '/library', destination: '/library/studio', permanent: false },
      ...OLD_TABS.map(([from, to]) => ({ source: `/p/:slug/${from}`, destination: `/p/:slug/${to}`, permanent: false })),
    ];
  },
};

export default nextConfig;
