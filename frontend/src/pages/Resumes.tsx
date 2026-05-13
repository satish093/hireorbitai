import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { FileUpload } from '../components/FileUpload';
import { SelectInput } from '../components/SelectInput';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { api } from '../services/api';
import toast from 'react-hot-toast';

export function Resumes() {
  const [consultants, setConsultants] = useState<any[]>([]);
  const [consultantId, setConsultantId] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/consultants')
      .then((r) => { if (!cancelled) setConsultants(r.data ?? []); })
      .catch((e) => { if (!cancelled) toast.error(e?.response?.data?.error ?? 'Failed to load consultants'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!consultantId) { setRows([]); return; }
    let cancelled = false;
    setLoading(true);
    api.get(`/resumes/consultant/${consultantId}`)
      .then((r) => { if (!cancelled) setRows(r.data ?? []); })
      .catch((e) => { if (!cancelled) toast.error(e?.response?.data?.error ?? 'Failed to load resumes'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [consultantId]);

  async function upload(file: File) {
    if (!consultantId) { toast.error('Pick a consultant first'); return; }
    if (uploading) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('consultant_id', consultantId);
    try {
      await api.post('/resumes/upload', form);
      toast.success('Uploaded');
      const { data } = await api.get(`/resumes/consultant/${consultantId}`);
      setRows(data ?? []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function download(id: string) {
    try {
      const { data } = await api.get(`/resumes/${id}/download-url`);
      if (!data?.url) { toast.error('No download URL'); return; }
      window.open(data.url, '_blank');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Download failed');
    }
  }

  async function setCurrent(id: string) {
    try {
      await api.post(`/resumes/${id}/set-current`);
      const { data } = await api.get(`/resumes/consultant/${consultantId}`);
      setRows(data ?? []);
      toast.success('Marked as current');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to set current');
    }
  }

  return (
    <Layout title="Resumes">
      <PageHeader
        title="Resumes"
        description="Upload, version, and score consultant resumes. The 'current' version is what gets submitted."
      />
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <SelectInput
            label="Consultant"
            placeholder="Select a consultant…"
            value={consultantId}
            onChange={(e) => setConsultantId(e.target.value)}
            options={consultants.map((c) => ({ value: c.id, label: c.user?.full_name ?? c.user?.email }))}
          />
        </div>
        <div>
          <FileUpload
            label={uploading ? 'Uploading…' : '+ Upload resume'}
            accept=".pdf,.doc,.docx"
            onFile={upload}
          />
        </div>
      </div>
      <DataTable
        loading={loading}
        empty={consultantId ? 'No resumes for this consultant yet.' : 'Select a consultant to view versions.'}
        columns={[
          { key: 'version', header: 'V', render: (r: any) =>
            <span className="text-[11px] font-mono bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">v{r.version}</span>
          },
          { key: 'file_name', header: 'File' },
          { key: 'ai_score', header: 'AI score', align: 'right', render: (r: any) => r.ai_score ?? '—' },
          { key: 'current', header: 'Current', render: (r: any) => r.is_current
            ? <span className="text-[11px] font-medium bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">Current</span>
            : <span className="text-slate-300 text-xs">—</span>
          },
          { key: 'date', header: 'Uploaded', render: (r: any) => r.created_at ? new Date(r.created_at).toLocaleDateString() : '—' },
          { key: 'actions', header: '', align: 'right', render: (r: any) => (
            <div className="flex items-center justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => download(r.id)}>Download</Button>
              {!r.is_current && <Button size="sm" variant="ghost" onClick={() => setCurrent(r.id)}>Set current</Button>}
            </div>
          )},
        ]}
        rows={rows}
      />
    </Layout>
  );
}
