/**
 * Tailwind CSS v4 is a PostCSS plugin and nothing else — there is no
 * `tailwind.config.js`. The design tokens live in `src/app/globals.css` under
 * `@theme`, which is where v4 expects them.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
