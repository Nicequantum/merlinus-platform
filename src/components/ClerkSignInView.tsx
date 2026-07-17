'use client';

import { SignIn } from '@clerk/nextjs';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DealershipBranding } from '@/components/DealershipBranding';
import { ApexLogoMark } from '@/components/apex/ApexLogoMark';

interface ClerkSignInViewProps {
  showLegacyLink?: boolean;
}

export function ClerkSignInView({ showLegacyLink = false }: ClerkSignInViewProps) {
  const searchParams = useSearchParams();
  const linkingAccount = searchParams.get('link_account') === '1';

  return (
    <div className="login-shell">
      <div className="login-panel">
        <div className="merlin-brand-hero login-brand">
          <ApexLogoMark size="lg" animated title="Apex" />
          <p className="merlin-wordmark">
            Merlinus
            <span className="merlin-wordmark-accent">Warranty Intelligence</span>
          </p>
          <div className="merlin-brand-divider" aria-hidden="true" />
          <DealershipBranding size="lg" />
        </div>

        {linkingAccount ? (
          <p className="login-footer mb-4">
            Sign in with the same email as your D7 account, then return to Settings to complete
            linking.
          </p>
        ) : null}

        <div className="clerk-sign-in-root benz-card-elevated benz-card-elevated-accent">
          <SignIn
            routing="path"
            path="/sign-in"
            signUpUrl={undefined}
            appearance={{
              variables: {
                colorPrimary: '#00adef',
                borderRadius: '14px',
              },
              elements: {
                rootBox: 'clerk-sign-in-box',
                card: 'clerk-sign-in-card',
                headerTitle: 'clerk-sign-in-title',
                headerSubtitle: 'clerk-sign-in-subtitle',
                formButtonPrimary: 'primary-btn clerk-sign-in-primary-btn',
                formFieldInput: 'benz-input',
                footerActionLink: 'clerk-sign-in-link',
              },
            }}
          />
        </div>

        {linkingAccount ? (
          <p className="login-footer">
            <Link href="/?link_account=1" className="login-alt-link">
              Return to app to complete linking
            </Link>
          </p>
        ) : showLegacyLink ? (
          <p className="login-footer">
            <Link href="/" className="login-alt-link">
              Sign in with D7 number instead
            </Link>
          </p>
        ) : (
          <p className="login-footer">Authorized dealership personnel only.</p>
        )}
      </div>
    </div>
  );
}