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

export function Resumes() {
  const w = useResumeWorkspace();
  const navigate = useNavigate();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const { active, versions, currentVersion, consultantId } = w;

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
            ? `${versions.length} version${versions.length === 1 ? '' : 's'}${
                currentVersion ? ` · current v${currentVersion.version}` : ''
              }`
            : 'Select a consultant to open their resume versions.'
        }
        action={
          <>
            {/* Two pairs so mobile shows 2 buttons per row, desktop stays flat. */}
            <div className="flex gap-2 w-full sm:w-auto sm:contents">
              <FileUpload
                label={w.uploading ? 'Uploading…' : '+ Upload'}
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                disabled={!w.consultantId}
                onFile={w.upload}
                className="flex-1 sm:flex-none"
              />
              <Button
                variant="outline"
                size="md"
                disabled={!active}
                onClick={w.duplicate}
                className="flex-1 sm:flex-none"
              >
                Duplicate
              </Button>
            </div>
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
          </>
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
              ? 'No consultant profiles exist. Invite a consultant from the Users page first.'
              : 'Select a consultant above to open their resume versions and the tailoring workspace.'
          }
          action={
            w.consultants.length === 0 ? (
              <Button variant="accent" size="md" onClick={() => navigate('/admin/users')}>
                Go to Users
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ResumeVersionStrip
            versions={versions}
            activeId={w.activeId}
            onSelect={w.selectVersion}
            onNew={() => setLauncherOpen(true)}
            onDelete={w.deleteVersion}
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
              onMakeCurrent={() => w.reloadVersions(w.activeId)}
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
