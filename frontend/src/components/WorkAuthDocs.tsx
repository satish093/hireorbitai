import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import { Button } from './Button';
import { Modal } from './Modal';
import { Skeleton } from './Skeleton';

const DOC_TYPES = [
  { value: 'H1B', label: 'H-1B Approval Notice' },
  { value: 'EAD', label: 'EAD Card' },
  { value: 'I20', label: 'I-20' },
  { value: 'PASSPORT', label: 'Passport Copy' },
  { value: 'OFFER_LETTER', label: 'Offer Letter' },
  { value: 'I797', label: 'I-797' },
  { value: 'OTHER', label: 'Other' },
];

interface WorkAuthDoc {
  id: string;
  doc_type: string;
  label: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

interface Props {
  consultantId: string;
}

function expiryStatus(expiryDate: string | null): { label: string; className: string } | null {
  if (!expiryDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiryDate);
  exp.setHours(0, 0, 0, 0);
  const days = Math.round((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0)
    return { label: 'Expired', className: 'text-red-600 dark:text-red-400 font-semibold' };
  if (days <= 7)
    return { label: `${days}d left`, className: 'text-red-600 dark:text-red-400 font-semibold' };
  if (days <= 30)
    return { label: `${days}d left`, className: 'text-amber-600 dark:text-amber-400 font-medium' };
  if (days <= 60)
    return { label: `${days}d left`, className: 'text-yellow-600 dark:text-yellow-400' };
  return null;
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkAuthDocs({ consultantId }: Props) {
  const [docs, setDocs] = useState<WorkAuthDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);

  // Upload form state
  const [docType, setDocType] = useState('H1B');
  const [label, setLabel] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    setLoading(true);
    api
      .get(`/work-auth-docs/${consultantId}`)
      .then((r) => setDocs(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load documents'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (consultantId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultantId]);

  function resetForm() {
    setDocType('H1B');
    setLabel('');
    setIssueDate('');
    setExpiryDate('');
    setSelectedFile(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleUpload() {
    if (!selectedFile) {
      toast.error('Please select a file');
      return;
    }
    const form = new FormData();
    form.append('file', selectedFile);
    form.append('doc_type', docType);
    if (label) form.append('label', label);
    if (issueDate) form.append('issue_date', issueDate);
    if (expiryDate) form.append('expiry_date', expiryDate);

    setUploading(true);
    try {
      await api.post(`/work-auth-docs/${consultantId}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Document uploaded');
      setUploadOpen(false);
      resetForm();
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: WorkAuthDoc) {
    try {
      const { data } = await api.get(`/work-auth-docs/${consultantId}/${doc.id}/download`);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Download failed');
    }
  }

  async function handleDelete(doc: WorkAuthDoc) {
    if (!confirm(`Delete "${doc.file_name}"?`)) return;
    try {
      await api.delete(`/work-auth-docs/${consultantId}/${doc.id}`);
      toast.success('Document deleted');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Delete failed');
    }
  }

  const docTypeLabel = (type: string) => DOC_TYPES.find((d) => d.value === type)?.label ?? type;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink">Work Authorization Documents</h3>
        <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
          + Upload
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">No documents uploaded yet.</p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {docs.map((doc) => {
            const status = expiryStatus(doc.expiry_date);
            return (
              <div
                key={doc.id}
                className="flex items-center gap-3 px-4 py-3 bg-surface hover:bg-hover transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-ink truncate">
                      {docTypeLabel(doc.doc_type)}
                      {doc.label && <span className="text-muted font-normal"> — {doc.label}</span>}
                    </span>
                    {status && (
                      <span className={`text-xs ${status.className}`}>{status.label}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted flex-wrap">
                    <span className="truncate max-w-[200px]" title={doc.file_name}>
                      {doc.file_name}
                    </span>
                    <span>{formatBytes(doc.size_bytes)}</span>
                    {doc.issue_date && <span>Issued {formatDate(doc.issue_date)}</span>}
                    {doc.expiry_date && (
                      <span className={status ? status.className : ''}>
                        Expires {formatDate(doc.expiry_date)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => handleDownload(doc)}>
                    Download
                  </Button>
                  <Button variant="danger-ghost" size="sm" onClick={() => handleDelete(doc)}>
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
          resetForm();
        }}
        title="Upload Work Authorization Document"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                setUploadOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" size="md" loading={uploading} onClick={handleUpload}>
              Upload
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Document type</label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-bg text-sm px-3 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Label <span className="text-muted/60">(optional)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. EAD renewal 2025"
              maxLength={100}
              className="w-full h-9 rounded-lg border border-border bg-bg text-sm px-3 text-ink placeholder:text-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Issue date <span className="text-muted/60">(optional)</span>
              </label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-bg text-sm px-3 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Expiry date <span className="text-muted/60">(optional)</span>
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-bg text-sm px-3 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">File</label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="h-9 inline-flex items-center gap-1.5 bg-ink hover:opacity-90 text-bg text-sm font-medium px-3.5 rounded-lg shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Choose file
              </button>
              {selectedFile ? (
                <span
                  className="text-xs text-muted truncate max-w-[200px]"
                  title={selectedFile.name}
                >
                  {selectedFile.name}
                </span>
              ) : (
                <span className="text-xs text-muted/60">PDF, JPG, PNG — max 15 MB</span>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                className="hidden"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
