import { useState } from 'react';
import { Layout } from '../components/Layout';
import { FormInput } from '../components/FormInput';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { api } from '../services/api';
import toast from 'react-hot-toast';

export function AIEmail() {
  const [form, setForm] = useState({
    consultantName: '',
    consultantSkills: '',
    consultantExperienceYears: '' as number | '',
    jobTitle: '',
    jobDescription: '',
    vendorName: '',
    recruiterName: '',
  });
  const [out, setOut] = useState<{ subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (!form.consultantName || !form.jobTitle) {
      toast.error('Consultant name and job title are required');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/ai/vendor-email', {
        ...form,
        consultantSkills: form.consultantSkills.split(',').map((s) => s.trim()).filter(Boolean),
        consultantExperienceYears: Number(form.consultantExperienceYears) || 0,
      });
      setOut(data);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function copyBody() {
    if (!out) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${out.subject}\n\n${out.body}`);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Copy failed');
    }
  }

  return (
    <Layout title="AI Vendor Email">
      <PageHeader
        title="AI vendor email generator"
        description="Draft a polished consultant submission email. Fill in the basics — Claude writes the rest."
      />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Composer */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-3 h-fit">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Recruiter / Vendor</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormInput label="Your name" value={form.recruiterName} onChange={(e) => setForm({ ...form, recruiterName: e.target.value })} />
            <FormInput label="Vendor name" value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} />
          </div>

          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mt-3 mb-1">Consultant</div>
          <FormInput label="Consultant name *" value={form.consultantName} onChange={(e) => setForm({ ...form, consultantName: e.target.value })} />
          <FormInput
            label="Skills"
            hint="Comma-separated, e.g. Java, Spring Boot, AWS"
            value={form.consultantSkills}
            onChange={(e) => setForm({ ...form, consultantSkills: e.target.value })}
          />
          <FormInput
            label="Years of experience"
            type="number" min={0} step="0.5"
            value={form.consultantExperienceYears}
            onChange={(e) => {
              const v = e.target.value;
              setForm({ ...form, consultantExperienceYears: v === '' ? '' : Number(v) });
            }}
          />

          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mt-3 mb-1">Role</div>
          <FormInput label="Job title *" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1.5">Job description</span>
            <textarea
              placeholder="Paste the JD here"
              value={form.jobDescription}
              onChange={(e) => setForm({ ...form, jobDescription: e.target.value })}
              className="w-full rounded-lg border border-slate-300 hover:border-slate-400 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              rows={6}
            />
          </label>

          <div className="pt-2 flex items-center gap-2">
            <Button onClick={generate} loading={busy}>{busy ? 'Generating' : 'Generate email'}</Button>
            {out && <Button variant="secondary" onClick={() => setOut(null)}>Reset</Button>}
          </div>
        </div>

        {/* Output */}
        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-xl p-5 min-h-[400px] flex flex-col">
          {out ? (
            <>
              <div className="flex items-start justify-between gap-3 mb-3 pb-3 border-b border-slate-100">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Subject</div>
                  <div className="text-base font-medium text-slate-900 mt-0.5">{out.subject}</div>
                </div>
                <Button size="sm" variant="secondary" onClick={copyBody}>Copy</Button>
              </div>
              <pre className="whitespace-pre-wrap break-words text-sm text-slate-800 font-sans leading-relaxed flex-1">{out.body}</pre>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400">
              <div className="text-5xl mb-2 opacity-40">✉️</div>
              <p className="text-sm">Fill in the form and click <span className="font-medium text-slate-600">Generate email</span>.</p>
              <p className="text-xs mt-1 text-slate-400">The draft appears here, ready to copy.</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
