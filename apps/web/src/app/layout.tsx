import { type Metadata } from 'next';
import { type ReactNode } from 'react';

import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Dice Game',
  description: 'Two players, one page, and a server that owns every rule.',
};

export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang="en">
      <body className="antialiased">
        {/* First thing in the tab order, and visible the moment it is focused —
            a keyboard user should not have to walk two sign-in forms to reach
            the board. */}
        <a
          className="skip-link rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-white"
          href="#match"
        >
          Skip to the match
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
