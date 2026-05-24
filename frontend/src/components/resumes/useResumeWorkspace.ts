import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { openExternal } from '../../utils/fileUrl';
import type { CenterMode, ResumeVersion, TailorSession } from './types';

/**
 * All data + actions for the resume tailoring workspace. Keeps Resumes.tsx a
 * thin layout shell: consultant selection, version list, the active
 * version/mode/session selection, and the upload / duplicate / download verbs.
 */
export function useResumeWorkspace() {
  const [consultants, setConsultants] = useState<any[]>([]);
  const [consultantId, setConsultantId] = useState('');
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [activeId, setActiveId] = useState('');
  const [mode, setMode] = useState<CenterMode>('profile');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/consultants')
      .then((r) => {
        if (cancelled) return;
        const list = r.data ?? [];
        setConsultants(list);
        if (list.length === 1) setConsultantId(list[0].id);
      })
      .catch(
        (e) => !cancelled && toast.error(e?.response?.data?.error ?? 'Failed to load consultants'),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadVersions = useCallback(
    async (selectId?: string) => {
      if (!consultantId) {
        setVersions([]);
        setActiveId('');
        return;
      }
      setLoading(true);
      try {
        const { data } = await api.get(`/resumes/consultant/${consultantId}`);
        const rows: ResumeVersion[] = data ?? [];
        setVersions(rows);
        setActiveId((prev) => {
          if (selectId && rows.some((r) => r.id === selectId)) return selectId;
          if (rows.some((r) => r.id === prev)) return prev;
          return rows.find((r) => r.is_current)?.id ?? rows[0]?.id ?? '';
        });
      } catch (e: any) {
        toast.error(e?.response?.data?.error ?? 'Failed to load resumes');
      } finally {
        setLoading(false);
      }
    },
    [consultantId],
  );

  useEffect(() => {
    setSessionId(null);
    setMode('profile');
    reloadVersions();
  }, [reloadVersions]);

  const active = useMemo(
    () => versions.find((v) => v.id === activeId) ?? null,
    [versions, activeId],
  );
  const currentVersion = versions.find((v) => v.is_current) ?? null;

  const selectVersion = useCallback((id: string) => {
    setActiveId(id);
    setSessionId(null);
    setMode('profile');
  }, []);

  const upload = useCallback(
    async (file: File) => {
      if (!consultantId) return toast.error('Pick a consultant first');
      if (uploading) return;
      setUploading(true);
      const form = new FormData();
      form.append('file', file);
      form.append('consultant_id', consultantId);
      try {
        const { data } = await api.post('/resumes/upload', form);
        toast.success('Uploaded');
        await reloadVersions(data?.id);
        setMode('profile');
      } catch (e: any) {
        toast.error(e?.response?.data?.error ?? 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [consultantId, uploading, reloadVersions],
  );

  const duplicate = useCallback(async () => {
    if (!active) return;
    try {
      const { data } = await api.get(`/resumes/${active.id}/body`);
      const body: string = data?.body ?? '';
      if (!body) return toast.error('This version has no text body to duplicate');
      const form = new FormData();
      form.append(
        'file',
        new File([body], `copy-of-${active.file_name || 'resume.md'}`, { type: 'text/markdown' }),
      );
      form.append('consultant_id', consultantId);
      form.append('text', body);
      const r = await api.post('/resumes/upload', form);
      toast.success('Duplicated');
      await reloadVersions(r.data?.id);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Duplicate failed');
    }
  }, [active, consultantId, reloadVersions]);

  const download = useCallback(async () => {
    if (!active) return;
    try {
      const { data } = await api.get(`/resumes/${active.id}/body`);
      if (data?.body) {
        const blob = new Blob([data.body], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = active.file_name || 'resume.md';
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      const { data: dl } = await api.get(`/resumes/${active.id}/download-url`);
      if (dl?.url) openExternal(dl.url);
      else toast.error('No download available');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Download failed');
    }
  }, [active]);

  const openSession = useCallback((id: string) => {
    setSessionId(id);
    setMode('diff');
  }, []);

  const onSessionCreated = useCallback((session: TailorSession) => {
    setSessionId(session.id);
    setMode('diff');
    setHistoryKey((k) => k + 1);
  }, []);

  const onApplied = useCallback(
    (newId: string) => {
      setSessionId(null);
      setMode('preview');
      setHistoryKey((k) => k + 1);
      reloadVersions(newId);
    },
    [reloadVersions],
  );

  const deleteVersion = useCallback(
    async (id: string) => {
      try {
        await api.delete(`/resumes/${id}`);
        await reloadVersions();
      } catch (e: any) {
        toast.error(e?.response?.data?.error ?? 'Delete failed');
      }
    },
    [reloadVersions],
  );

  return {
    consultants,
    consultantId,
    setConsultantId,
    versions,
    active,
    activeId,
    currentVersion,
    mode,
    setMode,
    sessionId,
    historyKey,
    loading,
    uploading,
    reloadVersions,
    selectVersion,
    upload,
    duplicate,
    download,
    openSession,
    onSessionCreated,
    onApplied,
    deleteVersion,
  };
}
