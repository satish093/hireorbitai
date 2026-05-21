/**
 * Footer banner shown on every Training surface that produces compliance
 * artifacts (dashboard, my-training, reports, course detail).
 *
 * The exact wording is mandated by the STEM OPT compliance spec — do not
 * change it without product + legal sign-off. We render it as a muted
 * notice so it sits unobtrusively at the bottom of the page.
 */
export function StemOptDisclaimer() {
  return (
    <div className="mt-8 border border-border bg-hover rounded-xl px-4 py-3 text-xs text-muted">
      <span className="font-semibold text-ink">Disclaimer:</span> This training record is intended
      to support internal training documentation. Please consult immigration counsel for official
      STEM OPT compliance requirements.
    </div>
  );
}
