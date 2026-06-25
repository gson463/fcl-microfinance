import React from 'react';
import { Helmet } from 'react-helmet';
import { FieldWalletTraceSampleContent } from '@/components/admin/FieldWalletTraceSampleContent';

/** Public demo — no login, dummy data only. */
export default function FieldWalletTraceDemoPage() {
  return (
    <>
      <Helmet>
        <title>Field wallet trace — sample (dummy data)</title>
      </Helmet>
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
          <header className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">Field wallet trace — sample</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Excel-style grid · Office Topup · Same day (bila &quot;formula&quot;)
            </p>
          </header>
          <FieldWalletTraceSampleContent showLoginHint />
        </div>
      </div>
    </>
  );
}
