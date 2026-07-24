import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { SelectInput } from '../components/SelectInput';
import { FileUpload } from '../components/FileUpload';
import { EmptyState } from '../components/EmptyState';
import { ResumeVersionStrip } from '../components/resumes/ResumeVersionStrip';
import { CenterPane } from '../components/resumes/CenterPane';
import { TailorLauncher } from '../components/resumes/TailorLauncher';
import { AiProgressCard } from '../components/AiProgressCard';
import { useResumeWorkspace } from '../components/resumes/useResumeWorkspace';
import { useAuth } from '../context/AuthContext';
import { ADMIN_TIER } from '../types';

export function Resumes() {
  const w = useResumeWorkspace();
  const navigate = useNavigate();
  const { profile } = useAuth();
  // Only admin tier can reach /admin/users; everyone else (recruiters, group
  // leads) provisions consultants through the invitation flow.
  const canManageUsers = !!profile && (ADMIN_TIER as readonly string[]).includes(profile.role);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const { active, versions, consultantId } = w;

  return (
    <Layout title="Resumes">
      <AiProgressCard
        open={w.uploading}
        title="Processing your resume"
        stages={['Uploading file…', 'Extracting text…', 'Scoring against ATS…', 'Parsing profile…']}
        note="Large PDFs can take up to a minute."
      />
      <PageHeader
        title="Resume workspace"
        description={
          consultantId
            ? `${versions.length} version${versions.length === 1 ? '' : 's'}`
            : 'Select a consultant to manage their resumes.'
        }
        action={
          <div className="flex gap-2 w-full sm:w-auto sm:contents">
            <Button
              variant="outline"
              size="md"
              disabled={!active}
              onClick={w.download}
              className="flex-1 sm:flex-none"
            >
              Download
            </Button>
            <Button
              variant="accent"
              size="md"
              disabled={!active}
              onClick={() => setLauncherOpen(true)}
              className="flex-1 sm:flex-none"
            >
              ✦ Tailor with AI
            </Button>
          </div>
        }
      />

      {w.consultants.length > 1 && (
        <div className="mb-4 max-w-xs">
          <SelectInput
            label="Consultant"
            placeholder="Select a consultant…"
            value={consultantId}
            onChange={(e) => w.setConsultantId(e.target.value)}
            options={w.consultants.map((c) => ({
              value: c.id,
              label: c.user?.full_name ?? c.user?.email,
            }))}
          />
        </div>
      )}

      {!consultantId ? (
        <EmptyState
          icon="🧑‍💼"
          title={w.consultants.length === 0 ? 'No consultants yet' : 'Pick a consultant'}
          description={
            w.consultants.length === 0
              ? canManageUsers
                ? 'No consultant profiles exist yet. Invite a consultant from the Users page first.'
                : 'No consultant profiles exist yet. Invite a consultant to get started.'
              : 'Select a consultant above to open their resumes.'
          }
          action={
            w.consultants.length === 0 ? (
              canManageUsers ? (
                <Button variant="accent" size="md" onClick={() => navigate('/admin/users')}>
                  Go to Users
                </Button>
              ) : (
                <Button variant="accent" size="md" onClick={() => navigate('/invitations')}>
                  Invite a consultant
                </Button>
              )
            ) : undefined
          }
        />
      ) : versions.length === 0 && !w.loading ? (
        /* ── No resumes yet — prominent upload zone ── */
        <div className="mt-6 flex flex-col items-center gap-5 py-16 border-2 border-dashed border-border rounded-2xl bg-surface">
          <span className="text-5xl select-none">📄</span>
          <div className="text-center">
            <p className="text-base font-semibold text-ink">No resumes uploaded yet</p>
            <p className="text-sm text-muted mt-1">Upload a PDF, JPG, or PNG to get started</p>
          </div>
          <FileUpload
            label={w.uploading ? 'Uploading…' : '+ Upload resume'}
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            disabled={w.uploading}
            onFile={w.upload}
          />
        </div>
      ) : (
        <>
          <ResumeVersionStrip
            versions={versions}
            activeId={w.activeId}
            onSelect={w.selectVersion}
            onDelete={w.deleteVersion}
            onUpload={w.upload}
            uploading={w.uploading}
          />

          <div className="mt-4">
            <CenterPane
              version={active}
              versions={versions}
              consultantId={consultantId}
              mode={w.mode}
              onMode={w.setMode}
              sessionId={w.sessionId}
              resumeId={w.activeId}
              onApplied={w.onApplied}
              onEdited={() => w.reloadVersions(w.activeId)}
            />
          </div>

          <TailorLauncher
            open={launcherOpen}
            resumeId={w.activeId}
            onClose={() => setLauncherOpen(false)}
            onCreated={(s) => {
              setLauncherOpen(false);
              w.onSessionCreated(s);
            }}
          />
        </>
      )}
    </Layout>
  );
}
