/**
 * DEV-ONLY Super-Admin test panel.
 *
 * Edit test integration configs (API keys, SMTP, scraper, experimental flags)
 * stored in the development database via /dev/integrations. Never ships to
 * production: reached only through the `import.meta.env.DEV`-gated route in
 * App.tsx, and the backend API is 404 + SUPER_ADMIN-gated.
 *
 * Each config namespace is edited as JSON so new test surfaces can be added
 * without changing this UI.
 */

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { api } from '../services/api';

const NAMESPACES: { key: string; label: string; hint: string }[] = [
  { key: 'ai_keys', label: 'AI API keys', hint: '{ "openai": "", "anthropic": "", "gemini": "" }' },
  {
    key: 'smtp',
    label: 'SMTP',
    hint: '{ "host": "", "port": 587, "user": "", "pass": "", "from": "" }',
  },
  {
    key: 'scraper',
    label: 'Scraper / job sources',
    hint: '{ "rapidApiKey": "", "jsearchKey": "", "sources": [] }',
  },
  { key: 'integrations', label: 'Third-party integrations', hint: '{ }' },
  { key: 'experimental', label: 'Experimental settings', hint: '{ }' },
];

export function DevPanel() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Record<string, unknown>>('/dev/integrations')
      .then(({ data }) => {
        const next: Record<string, string> = {};
        for (const ns of NAMESPACES) {
          next[ns.key] = JSON.stringify(data?.[ns.key] ?? {}, null, 2);
        }
        setValues(next);
      })
      .catch(() => toast.error('Failed to load dev settings'))
      .finally(() => setLoading(false));
  }, []);

  async function save(key: string) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(values[key] || '{}');
    } catch {
      toast.error(`${key}: invalid JSON`);
      return;
    }
    setSavingKey(key);
    try {
      await api.put('/dev/integrations', { key, value: parsed });
      toast.success(`Saved ${key}`);
    } catch {
      toast.error(`Failed to save ${key}`);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Layout title="Dev Test Panel">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <strong>Development only.</strong> These test configs live in the dev database and never
          affect production. The whole panel is absent from production builds.
        </div>

        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          NAMESPACES.map((ns) => (
            <div key={ns.key} className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">{ns.label}</h2>
                <Button
                  size="sm"
                  variant="accent"
                  loading={savingKey === ns.key}
                  onClick={() => save(ns.key)}
                >
                  Save
                </Button>
              </div>
              <p className="mb-2 text-[11px] text-muted">{ns.hint}</p>
              <textarea
                value={values[ns.key] ?? '{}'}
                onChange={(e) => setValues((v) => ({ ...v, [ns.key]: e.target.value }))}
                spellCheck={false}
                rows={6}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              />
            </div>
          ))
        )}
      </div>
    </Layout>
  );
}
