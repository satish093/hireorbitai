-- TalentBridge AI — extra job sources (Remotive, Arbeitnow + more Greenhouse companies)
-- Idempotent: safe to re-run.

insert into public.source_companies (source, slug, display_name) values
  -- Public feeds (no slug)
  ('remotive',   null, 'Remotive (remote tech)'),
  ('arbeitnow',  null, 'Arbeitnow (EU tech)'),

  -- Additional Greenhouse-hosted companies known to publish public boards.
  ('greenhouse', 'coinbase',       'Coinbase'),
  ('greenhouse', 'dropbox',        'Dropbox'),
  ('greenhouse', 'segment',        'Segment / Twilio'),
  ('greenhouse', 'robinhood',      'Robinhood'),
  ('greenhouse', 'asana',          'Asana'),
  ('greenhouse', 'instacart',      'Instacart'),
  ('greenhouse', 'datadog',        'Datadog'),
  ('greenhouse', 'twilio',         'Twilio'),
  ('greenhouse', 'square',         'Square / Block'),
  ('greenhouse', 'atlassian',      'Atlassian'),
  ('greenhouse', 'mongodb',        'MongoDB'),
  ('greenhouse', 'klaviyo',        'Klaviyo'),
  ('greenhouse', 'etsy',           'Etsy'),
  ('greenhouse', 'reddit',         'Reddit'),
  ('greenhouse', 'vercel',         'Vercel'),
  ('greenhouse', 'hubspot',        'HubSpot'),
  ('greenhouse', 'cloudflare',     'Cloudflare'),
  ('greenhouse', 'roblox',         'Roblox'),
  ('greenhouse', 'snap',           'Snap'),
  ('greenhouse', 'pinterest',      'Pinterest')
on conflict (source, slug) do nothing;
