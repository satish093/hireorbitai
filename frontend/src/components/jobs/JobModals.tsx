import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { ApplyInterceptModal } from '../ApplyInterceptModal';
import { CustomizeResumeWizard } from '../CustomizeResumeWizard';
import { DuplicateSubmissionModal } from '../DuplicateSubmissionModal';
import { ApplyConfirmModal } from './ApplyConfirmModal';
import { SourcesDrawer } from './SourcesDrawer';
import { resolveApplyUrl } from './helpers';
import type { ApplyTarget, JobRow, TabKey } from './types';

export interface JobModalsProps {
  isRecruiterMode: boolean;
  tab: TabKey;
  target: ApplyTarget | null;
  myConsultantId: string | null;
  myResumeId: string | null;
  skills: string[];
  sourcesOpen: boolean;
  setSourcesOpen: (v: boolean) => void;
  interceptFor: JobRow | null;
  setInterceptFor: (v: JobRow | null) => void;
  customizeFor: JobRow | null;
  setCustomizeFor: (v: JobRow | null) => void;
  confirmFor: { job: JobRow; resumeId: string | null } | null;
  setConfirmFor: (v: { job: JobRow; resumeId: string | null } | null) => void;
  dupWarning: {
    job: JobRow;
    consultantName: string;
    status: string;
    submittedAt: string | null;
  } | null;
  setDupWarning: (
    v: { job: JobRow; consultantName: string; status: string; submittedAt: string | null } | null,
  ) => void;
  load: (currentTab?: TabKey) => void;
  handlePlainApply: (job: JobRow) => void;
  proceedToApply: (job: JobRow, consultantId?: string | null) => void;
  recordApplication: (p: {
    job: JobRow;
    method: 'CUSTOMIZED' | 'ORIGINAL';
    resumeId: string | null;
    tailoredResumeId: string | null;
    matchScore: number | null;
    atsScore: number | null;
  }) => void;
}

export function JobModals(props: JobModalsProps) {
  const {
    isRecruiterMode,
    tab,
    target,
    myConsultantId,
    myResumeId,
    skills,
    sourcesOpen,
    setSourcesOpen,
    interceptFor,
    setInterceptFor,
    customizeFor,
    setCustomizeFor,
    confirmFor,
    setConfirmFor,
    dupWarning,
    setDupWarning,
    load,
    handlePlainApply,
    proceedToApply,
    recordApplication,
  } = props;
  const navigate = useNavigate();

  return (
    <>
      {sourcesOpen && (
        <SourcesDrawer onClose={() => setSourcesOpen(false)} onAfterSync={() => load(tab)} />
      )}
      {interceptFor && (
        <ApplyInterceptModal
          job={interceptFor}
          mySkills={isRecruiterMode ? (target?.skills ?? []) : skills}
          applyUrl={resolveApplyUrl(interceptFor)}
          onClose={() => setInterceptFor(null)}
          onCustomize={() => {
            const j = interceptFor;
            setInterceptFor(null);
            // Determine the customize context for either mode.
            const ctxConsultantId = isRecruiterMode ? target?.consultantId : myConsultantId;
            const ctxResumeId = isRecruiterMode ? target?.resumeId : myResumeId;
            if (ctxConsultantId && ctxResumeId) {
              setCustomizeFor(j);
            } else if (isRecruiterMode) {
              toast.error('Pick a consultant and resume first');
            } else if (!myResumeId) {
              // Consultant has no resume yet — fall back to read-only insight
              // so they can at least see the match analysis + paste resume text.
              toast('Upload a resume first to use Fix My Resume', { icon: 'ℹ️' });
              navigate(`/jobs/${j.id}`);
            } else {
              navigate(`/jobs/${j.id}`);
            }
          }}
          // Both modes go through the "Did you apply?" confirmation now.
          onApplyAnyway={() => handlePlainApply(interceptFor)}
        />
      )}
      {customizeFor &&
        (() => {
          const ctxConsultantId = isRecruiterMode ? target?.consultantId : myConsultantId;
          const ctxResumeId = isRecruiterMode ? target?.resumeId : myResumeId;
          const ctxSkills = isRecruiterMode ? (target?.skills ?? []) : skills;
          if (!ctxConsultantId || !ctxResumeId) return null;
          return (
            <CustomizeResumeWizard
              job={customizeFor}
              consultantId={ctxConsultantId}
              sourceResumeId={ctxResumeId}
              mySkills={ctxSkills}
              onClose={() => setCustomizeFor(null)}
              onApplied={(r) => {
                const job = customizeFor;
                setCustomizeFor(null);
                recordApplication({
                  job,
                  method: 'CUSTOMIZED',
                  resumeId: ctxResumeId,
                  tailoredResumeId: r.tailoredResumeId,
                  matchScore: r.matchScore,
                  atsScore: r.atsScore,
                });
              }}
            />
          );
        })()}
      {dupWarning && (
        <DuplicateSubmissionModal
          consultantName={dupWarning.consultantName}
          jobTitle={dupWarning.job.title}
          status={dupWarning.status}
          submittedAt={dupWarning.submittedAt}
          onCancel={() => setDupWarning(null)}
          onConfirm={() => {
            const job = dupWarning.job;
            const cid = isRecruiterMode ? target?.consultantId : myConsultantId;
            setDupWarning(null);
            proceedToApply(job, cid);
          }}
        />
      )}
      {confirmFor && (
        <ApplyConfirmModal
          job={confirmFor.job}
          onClose={() => setConfirmFor(null)}
          onConfirm={async (yes) => {
            const { job, resumeId } = confirmFor;
            setConfirmFor(null);
            const consultantId = isRecruiterMode ? target?.consultantId : myConsultantId;
            if (!yes) {
              // Log the funnel-exit even when no application is created so we can
              // see "viewed but did not apply" in reports later.
              try {
                await api.post('/applications/none/events', {
                  kind: 'apply_declined',
                  job_id: job.id,
                  consultant_id: consultantId ?? null,
                  payload: { reason: 'user_said_no' },
                });
              } catch {
                /* non-fatal */
              }
              return;
            }
            recordApplication({
              job,
              method: 'ORIGINAL',
              resumeId,
              tailoredResumeId: null,
              matchScore: typeof job.match_score === 'number' ? job.match_score : null,
              atsScore: null,
            });
          }}
        />
      )}
    </>
  );
}
