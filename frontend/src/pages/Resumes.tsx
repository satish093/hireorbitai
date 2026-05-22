import { useState } from 'react';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { SelectInput } from '../components/SelectInput';
import { FileUpload } from '../components/FileUpload';
import { EmptyState } from '../components/EmptyState';
import { ResumeVersionStrip } from '../components/resumes/ResumeVersionStrip';
import { TailorHistory } from '../components/resumes/TailorHistory';
import { CenterPane } from '../components/resumes/CenterPane';
import { AtsBreakdownRail } from '../components/resumes/AtsBreakdownRail';
import { TailorLauncher } from '../components/resumes/TailorLauncher';
import { useResumeWorkspace } from '../components/resumes/useResumeWorkspace';

export function Resumes() {
  const w = useResumeWorkspace();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const { active, versions, currentVersion, consultantId } = w;

  return (
    <Layout title="Resumes">
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
            <FileUpload
              label={w.uploading ? 'Uploading…' : '+ Upload'}
              accept=".pdf,.doc,.docx"
              onFile={w.upload}
            />
            <Button variant="outline" size="md" disabled={!active} onClick={w.duplicate}>
              Duplicate
            </Button>
            <Button variant="outline" size="md" disabled={!active} onClick={w.download}>
              Download
            </Button>
            <Button
              variant="accent"
              size="md"
              disabled={!active}
              onClick={() => setLauncherOpen(true)}
            >
              ✦ Tailor with AI
            </Button>
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
          title="Pick a consultant"
          description="Select a consultant above to open their resume versions and the tailoring workspace."
        />
      ) : (
        <>
          <ResumeVersionStrip
            versions={versions}
            activeId={w.activeId}
            onSelect={w.selectVersion}
            onNew={() => setLauncherOpen(true)}
          />

          <div className="mt-4 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
            <TailorHistory
              resumeId={w.activeId}
              refreshKey={w.historyKey}
              activeSessionId={w.sessionId}
              onOpenSession={w.openSession}
              onNewSession={() => setLauncherOpen(true)}
            />
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
            <AtsBreakdownRail
              resumeId={w.activeId}
              versions={versions}
              againstJobId={active?.tailored_for_job_id}
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
