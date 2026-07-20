import type { Metadata } from 'next';
import { LegalList, LegalPage, LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'Privacy Policy for dealership video inspections, repair reports, SMS notifications, and data handling.',
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lastUpdated="July 20, 2026"
      siblingHref="/terms"
      siblingLabel="← Terms of Service"
    >
      <p>
        We respect your privacy. This Privacy Policy explains what information is used when
        dealerships share multipoint inspection videos, written reports, and SMS notifications with
        you—and how that information is protected.
      </p>

      <LegalSection title="1. Overview">
        <p>
          Your dealership uses this platform to document service work and communicate with
          customers. We process information <strong>on behalf of the dealership</strong> so they can
          serve you. The dealership is typically the organization that decides why your data is used
          for service communication.
        </p>
      </LegalSection>

      <LegalSection title="2. Information we handle">
        <p>Depending on the services used, this may include:</p>
        <LegalList
          items={[
            'Vehicle information — year, model, VIN (when provided), mileage notes',
            'Service content — inspection video, technician notes, written report, checklist findings',
            'Contact details — mobile number (for SMS), name (when provided)',
            'Link activity — when a secure share link is opened (to protect access and measure delivery)',
            'Technical data — basic device/browser signals needed to display the page securely',
          ]}
        />
        <p>
          We do <strong>not</strong> sell your personal information.
        </p>
      </LegalSection>

      <LegalSection title="3. How information is used">
        <p>Information is used to:</p>
        <LegalList
          items={[
            'Create and store your inspection video and report',
            'Generate a secure customer viewing page',
            'Send SMS notifications with a link to your report (when requested by the dealership)',
            'Keep the service secure, reliable, and audit-ready for the dealership',
            'Improve clarity of customer-facing reports',
          ]}
        />
        <p>
          Automated tools may help draft plain-language reports from technician notes or inspection
          context. Final customer communication remains under the dealership’s control.
        </p>
      </LegalSection>

      <LegalSection title="4. Video inspections and share links">
        <LegalList
          items={[
            'Videos and reports are stored securely and delivered through private links, not public search results.',
            'Links may expire after a set time or be revoked by the dealership.',
            'Anyone with the link (and passcode, if set) can view the content—treat the link like a private message.',
            'Please do not forward inspection links if you do not want others to see vehicle details.',
          ]}
        />
      </LegalSection>

      <LegalSection title="5. SMS messages">
        <p>When your dealership sends an inspection text:</p>
        <LegalList
          items={[
            'Your mobile number is used only to deliver that message and related service follow-up you request.',
            'The message typically includes a link to your video and written report, and may include a short preview of findings.',
            'Carriers may process the message as part of normal SMS delivery.',
            'Opt out: reply STOP. Help: reply HELP.',
            'Opting out of SMS does not delete your inspection record at the dealership; it stops further SMS from this channel as supported by the provider.',
          ]}
        />
      </LegalSection>

      <LegalSection title="6. How we protect information">
        <p>We use industry-standard safeguards, which may include:</p>
        <LegalList
          items={[
            'Encryption of sensitive fields and secure transport (HTTPS)',
            'Access controls so dealership staff only see data for their rooftop',
            'Private object storage for inspection media',
            'Time-limited share tokens for customer links',
          ]}
        />
        <p>
          No method of transmission or storage is 100% secure, but we design the platform with
          dealership-grade care in mind.
        </p>
      </LegalSection>

      <LegalSection title="7. Sharing of information">
        <p>We may share information only as needed to operate the service, for example:</p>
        <LegalList
          items={[
            'Your dealership — staff serving your vehicle',
            'Infrastructure providers — hosting, storage, messaging (e.g. SMS delivery), under contractual protections',
            'Legal requirements — if required by law or to protect rights and safety',
          ]}
        />
        <p>
          We do not share your inspection content with unrelated third parties for their marketing.
        </p>
      </LegalSection>

      <LegalSection title="8. Retention">
        <LegalList
          items={[
            'Inspection videos, reports, and related records are retained according to dealership policy and operational needs.',
            'Share links may stop working when they expire or are revoked, even if the dealership still holds the underlying record.',
            'SMS logs may keep limited delivery metadata (such as last digits of a phone number and send status) for support and compliance.',
          ]}
        />
      </LegalSection>

      <LegalSection title="9. Your choices">
        <p>You may:</p>
        <LegalList
          items={[
            'Ask your dealership for a copy of, or correction to, information they hold about your visit',
            'Request that a share link be revoked',
            'Opt out of SMS as described above',
            'Contact the dealership with privacy questions about your service records',
          ]}
        />
        <p>
          Because the dealership directs customer service communications, the fastest path for
          access or deletion requests is usually their service or privacy contact.
        </p>
      </LegalSection>

      <LegalSection title="10. Children">
        <p>
          This service is intended for vehicle service customers and is not directed at children
          under 13. We do not knowingly collect information from children for inspection sharing.
        </p>
      </LegalSection>

      <LegalSection title="11. Changes to this policy">
        <p>
          We may update this Privacy Policy periodically. The “Last updated” date will change when
          we do. Material changes will be reflected on this page.
        </p>
      </LegalSection>

      <LegalSection title="12. Contact">
        <p>
          For privacy questions about your vehicle service or inspection, contact the{' '}
          <strong>dealership that sent your message or link</strong>.
        </p>
        <p>
          For platform-level privacy questions, ask the dealership to escalate to their platform
          administrator.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
