import type { Metadata } from 'next';
import { LegalList, LegalPage, LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'Terms of Service for dealership video inspections, repair reports, and SMS notifications.',
  robots: { index: true, follow: true },
};

export default function TermsOfServicePage() {
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="July 20, 2026"
      siblingHref="/privacy"
      siblingLabel="Privacy Policy →"
    >
      <p>
        These Terms of Service (“Terms”) explain how you may use our dealership service platform,
        including multipoint inspection videos, written repair reports, and text (SMS) notifications.
        By using our services or opening a shared inspection link, you agree to these Terms.
      </p>
      <p>
        If you have questions, please contact the service department at the dealership that served
        your vehicle.
      </p>

      <LegalSection title="1. Who we are">
        <p>
          This platform helps authorized dealerships document vehicle inspections, prepare clear
          repair explanations, and share that information with customers in a secure way.
        </p>
        <p>
          Your relationship for vehicle service remains with <strong>your dealership</strong>. We
          provide the technology they use to communicate findings with you.
        </p>
      </LegalSection>

      <LegalSection title="2. What the service provides">
        <p>Depending on what your dealership enables, you may receive:</p>
        <LegalList
          items={[
            'Video inspections — a walkthrough of your vehicle recorded by service staff',
            'Written reports — a plain-language summary of findings and recommended next steps',
            'Secure share links — a private web page to watch the video and read the report',
            'SMS notifications — a text message with a link to your inspection (when you opt in)',
          ]}
        />
        <p>
          Content is prepared for your review and discussion with the dealership. It does not
          replace a full technical diagnosis when additional testing is needed.
        </p>
      </LegalSection>

      <LegalSection title="3. Video sharing and reports">
        <LegalList
          items={[
            'Inspection videos and reports are created for your vehicle and visit.',
            'Links are intended for you and people you choose to share them with (for example, a co-owner).',
            'Please do not post private inspection links publicly or use them to harass others.',
            'Videos and reports may expire or be revoked by the dealership for security or operational reasons.',
            'Reports may use assisted drafting tools; your dealership remains responsible for the accuracy of what they send you.',
          ]}
        />
      </LegalSection>

      <LegalSection title="4. SMS notifications">
        <LegalList
          items={[
            'Texts are sent only when the dealership initiates a message related to your service (for example, “your inspection is ready”).',
            'Message frequency varies based on your service activity.',
            'Message and data rates may apply from your mobile carrier.',
            'You can opt out of SMS at any time by replying STOP (or as instructed in the message). Reply HELP for help.',
            'After opting out, you may still be contacted by the dealership through other channels (phone, email, or in person) about your vehicle.',
          ]}
        />
      </LegalSection>

      <LegalSection title="5. Acceptable use">
        <p>You agree not to:</p>
        <LegalList
          items={[
            'Attempt to access another customer’s inspections or accounts',
            'Interfere with or misuse the platform',
            'Use shared content in a misleading or unlawful way',
          ]}
        />
        <p>
          We and the dealership may suspend access to a link or feature if misuse is detected.
        </p>
      </LegalSection>

      <LegalSection title="6. No professional warranty advice beyond your dealership">
        <p>
          Platform content supports communication between you and your service team. It is{' '}
          <strong>not</strong> a substitute for official manufacturer warranty decisions, legal
          advice, or emergency roadside guidance.
        </p>
        <p>
          If you believe your vehicle is unsafe to drive, contact the dealership or appropriate
          emergency services immediately.
        </p>
      </LegalSection>

      <LegalSection title="7. Availability">
        <p>
          We aim for reliable access, but the service may be interrupted for maintenance, network
          issues, or factors outside our control. Your dealership can usually provide findings
          another way if a link is temporarily unavailable.
        </p>
      </LegalSection>

      <LegalSection title="8. Limitation of liability">
        <p>
          To the fullest extent allowed by law, we are not liable for indirect or consequential
          damages arising from use of the platform. Nothing in these Terms limits rights you have
          that cannot be waived under applicable law, or liability for fraud or willful misconduct.
        </p>
        <p>
          Your dealership’s own service policies, estimates, and repair agreements still apply to
          work performed on your vehicle.
        </p>
      </LegalSection>

      <LegalSection title="9. Changes">
        <p>
          We may update these Terms from time to time. The “Last updated” date at the top will
          change when we do. Continued use of shared links or the service after an update means you
          accept the revised Terms.
        </p>
      </LegalSection>

      <LegalSection title="10. Contact">
        <p>
          For questions about an inspection, estimate, or vehicle, contact the{' '}
          <strong>service department at the dealership</strong> that sent you the message or link.
        </p>
        <p>
          For questions about these Terms or the technology platform, ask your dealership to
          escalate to their platform administrator.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
