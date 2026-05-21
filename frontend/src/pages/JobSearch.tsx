import { Layout } from '../components/Layout';
import { api } from '../services/api';
import { invalidate } from '../hooks/useInvalidate';
import toast from 'react-hot-toast';
import { SkeletonCard } from '../components/Skeleton';
import { Button } from '../components/Button';
import { resolveApplyUrl } from '../components/jobs/helpers';
import { JobCard } from '../components/jobs/JobCard';
import { EmptyState } from '../components/jobs/EmptyState';
import { MatchModeChip } from '../components/jobs/MatchModeChip';
import { AppliedSubTabs } from '../components/jobs/AppliedSubTabs';
import { AlertsToggle } from '../components/jobs/AlertsToggle';
import { SkillsPicker } from '../components/jobs/SkillsPicker';
import { SourceBreakdown } from '../components/jobs/SourceBreakdown';
import { RecruiterTargetingBar } from '../components/jobs/RecruiterTargetingBar';
import { JobSearchHero } from '../components/jobs/JobSearchHero';
import { JobTabsBar } from '../components/jobs/JobTabsBar';
import { JobFilterBar } from '../components/jobs/JobFilterBar';
import { JobDetailPane } from '../components/jobs/JobDetailPane';
import { JobModals } from '../components/jobs/JobModals';
import { useJobSearch } from '../components/jobs/useJobSearch';

export function JobSearch() {
  const {
    isManager,
    isConsultant,
    isRecruiterMode,
    navigate,
    tab,
    setTab,
    rows,
    setRows,
    loading,
    syncing,
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
    skills,
    skillsLoaded,
    target,
    setTarget,
    myConsultantId,
    myResumeId,
    q,
    setQ,
    sourceFilter,
    setSourceFilter,
    appliedSub,
    setAppliedSub,
    matchMode,
    page,
    totalPages,
    totalRows,
    loadMoreRef,
    sort,
    setSort,
    searchRef,
    saveSkills,
    syncNow,
    enrichNow,
    load,
    handleApplyClick,
    proceedToApply,
    handlePlainApply,
    recordApplication,
    toggleLike,
    openJob,
    patchFilters,
    resetFilters,
    visible,
    selectedJob,
    filterState,
    counts,
  } = useJobSearch();

  const staffActions = isManager ? (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setSourcesOpen(true)}
        title="Manage live job sources"
      >
        Sources
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={enrichNow}
        disabled={syncing}
        title="Run AI to extract requirements, seniority, work model, etc."
      >
        ✦ Enrich
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={syncNow}
        disabled={syncing}
        loading={syncing}
        title="Pull fresh jobs from all sources"
      >
        {syncing ? 'Working…' : 'Sync now'}
      </Button>
    </>
  ) : null;

  return (
    <Layout title="Jobs" crumbs={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Jobs' }]}>
      <div className="space-y-4">
        <JobSearchHero
          totalRows={totalRows}
          query={q}
          onQueryChange={setQ}
          onSubmitQuery={() => load()}
          searchRef={searchRef}
          rightSlot={staffActions}
        />

        {isRecruiterMode && tab === 'recommended' && (
          <RecruiterTargetingBar value={target} onChange={setTarget} />
        )}
        {isConsultant && skillsLoaded && tab === 'recommended' && (
          <SkillsPicker skills={skills} onChange={saveSkills} onRecompute={() => load()} />
        )}
        {isConsultant && tab === 'recommended' && <AlertsToggle />}

        <JobTabsBar tab={tab} counts={counts} onTab={setTab} sort={sort} onSort={setSort} />

        {tab === 'recommended' && (
          <JobFilterBar
            value={filterState}
            onChange={patchFilters}
            onApply={() => load()}
            onReset={resetFilters}
          />
        )}

        {!loading && tab === 'recommended' && matchMode && matchMode !== 'resume+skills' && (
          <MatchModeChip mode={matchMode} isRecruiterMode={isRecruiterMode} />
        )}
        {!loading && rows.length > 0 && tab === 'recommended' && (
          <SourceBreakdown
            rows={rows}
            active={sourceFilter}
            onClick={(s) => setSourceFilter(s === sourceFilter ? '' : s)}
          />
        )}
        {tab === 'applied' && (
          <AppliedSubTabs rows={rows} active={appliedSub} onChange={setAppliedSub} />
        )}

        {/* Master-detail: list column (left) + sticky detail pane (right, xl+). */}
        <div className="flex gap-5 items-start">
          <div className="w-full xl:w-[440px] xl:shrink-0 space-y-3">
            {loading ? (
              <div className="space-y-3" aria-label="Loading jobs">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonCard key={i} lines={3} />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <EmptyState tab={tab} onSync={isManager ? syncNow : undefined} />
            ) : (
              <>
                {tab === 'recommended' && totalRows > 0 && (
                  <div className="text-xs text-muted px-1">
                    Showing {visible.length} of {totalRows.toLocaleString()} jobs
                  </div>
                )}
                {visible.map((j) => (
                  <JobCard
                    key={j.id}
                    job={j}
                    selected={selectedJob?.id === j.id}
                    onSelect={() => openJob(j)}
                    onToggleLike={() => toggleLike(j)}
                    onApply={() => handleApplyClick(j)}
                    onChangeStatus={
                      j.application_id
                        ? async (next) => {
                            const appId = j.application_id;
                            if (!appId) return;
                            setRows((rs) =>
                              rs.map((r) =>
                                r.id === j.id ? { ...r, application_status: next } : r,
                              ),
                            );
                            try {
                              await api.patch(`/applications/${appId}`, { status: next });
                              invalidate('applications');
                            } catch (e: any) {
                              toast.error(e?.response?.data?.error ?? 'Failed to update status');
                              load(tab);
                            }
                          }
                        : undefined
                    }
                  />
                ))}
                {tab === 'recommended' && page < totalPages && (
                  <div ref={loadMoreRef} className="py-6 text-center text-xs text-muted">
                    {loading ? 'Loading more…' : 'Scroll for more'}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="hidden xl:block flex-1 min-w-0">
            <div className="sticky top-4 h-[calc(100dvh-7rem)] overflow-hidden rounded-xl border border-border">
              {selectedJob ? (
                <JobDetailPane
                  job={selectedJob}
                  isConsultant={isConsultant}
                  isRecruiterMode={isRecruiterMode}
                  selectedConsultantId={
                    isRecruiterMode ? (target?.consultantId ?? null) : myConsultantId
                  }
                  applyUrl={resolveApplyUrl(selectedJob)}
                  onSave={() => toggleLike(selectedJob)}
                  onPitch={() => navigate(`/ai-email?job=${selectedJob.id}`)}
                  onApply={() => handleApplyClick(selectedJob)}
                  onViewApplication={() => navigate('/applications')}
                  onSeeBench={() => navigate('/consultants')}
                />
              ) : (
                <div className="grid h-full place-items-center bg-bg-elev text-sm text-muted">
                  Select a job to see details
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <JobModals
        isRecruiterMode={isRecruiterMode}
        tab={tab}
        target={target}
        myConsultantId={myConsultantId}
        myResumeId={myResumeId}
        skills={skills}
        sourcesOpen={sourcesOpen}
        setSourcesOpen={setSourcesOpen}
        interceptFor={interceptFor}
        setInterceptFor={setInterceptFor}
        customizeFor={customizeFor}
        setCustomizeFor={setCustomizeFor}
        confirmFor={confirmFor}
        setConfirmFor={setConfirmFor}
        dupWarning={dupWarning}
        setDupWarning={setDupWarning}
        load={load}
        handlePlainApply={handlePlainApply}
        proceedToApply={proceedToApply}
        recordApplication={recordApplication}
      />
    </Layout>
  );
}
