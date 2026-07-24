-- HireOrbit AI — add Network Security + Application Security courses to
-- the Training catalog, with full I-983 STEM-OPT metadata and lessons.
--
-- New courses:
--   1. Network Security Foundations           (Network Security)
--   2. Application Security + Secure Coding   (Application Security)
--
-- Each course carries:
--   - learning_objectives, skills_taught, assessment_methods,
--     stem_relevance, weekly_hours  (I-983 Section 6 source)
--   - 6 ordered lessons with substantive content rendered by LessonBody
--
-- Idempotent. Safe to re-run.

-- ===========================================================================
-- 1. Network Security Foundations
-- ===========================================================================
insert into public.training_courses (
  title, description, category, difficulty, estimated_duration_hours,
  tags, status, learning_objectives, skills_taught, assessment_methods,
  stem_relevance, weekly_hours
)
select
  'Network Security Foundations',
  'Defense-in-depth at the network layer: TCP/IP, firewalls, VPNs, IDS/IPS, segmentation, zero-trust networking, and incident response. Engineering-led, defender-focused.',
  'Network Security', 'INTERMEDIATE', 36,
  array['network','security','firewall','vpn','ids','ips','zero-trust','tls','wireshark'],
  'ACTIVE',
  array[
    'Read a packet capture and identify the protocol, parties, and intent of a flow',
    'Design layered firewall rules using the principle of least privilege',
    'Configure a site-to-site and a client VPN with modern cryptography (WireGuard / IPsec)',
    'Deploy and tune an IDS/IPS (Suricata or Snort) to detect a known attack class',
    'Segment a network into security zones and enforce east-west controls',
    'Apply zero-trust principles to a real cloud workload (identity-based, not IP-based)',
    'Run the first-responder steps of an incident: contain, eradicate, recover, document'
  ],
  array[
    'TCP/IP','UDP','TLS 1.3','PKI / certificates','Firewalls (iptables / nftables / cloud SGs)',
    'WireGuard','IPsec','OpenVPN','Suricata','Snort','Zeek','Wireshark',
    'Network segmentation (VLANs / VPCs / subnets)','Zero Trust Architecture',
    'NIST CSF','MITRE ATT&CK','Incident response (NIST 800-61)','SOC 2 controls'
  ],
  array[
    'Quiz on TCP/IP + TLS handshake (≥80% passing)',
    'Lab: capture, decrypt, and analyze a TLS session in Wireshark; identify the cipher suite + SNI',
    'Capstone 1: design + document a defense-in-depth architecture for a 3-tier web app',
    'Capstone 2: write + execute an IR playbook against a tabletop scenario (supervisor-led)',
    'Supervisor review of the architecture diagram + assumptions'
  ],
  'Directly extends the networking + operating-systems + cryptography coursework from a Computer Science / Cybersecurity / Information Systems degree. Network defense is one of the highest-demand STEM-OPT roles in regulated industries (banking, healthcare, government services).',
  6
where not exists (
  select 1 from public.training_courses where title = 'Network Security Foundations'
);

insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, l.title, l.description, l.content, l.lesson_order, l.estimated_minutes
from public.training_courses c
join (values
  (0, 'TCP/IP and the OSI model in 90 minutes', '90 minutes', 'WHY THIS COMES FIRST
Every network attack and every network defense is a manipulation of a layer in the stack. If you cannot name the layer the threat lives at, you cannot defend it.

THE LAYERS (TOP DOWN)
- L7 Application: HTTP, DNS, SMTP — the bytes a service actually consumes
- L4 Transport: TCP (reliable, ordered) and UDP (best-effort)
- L3 Network: IP — routing across networks, the unit is a packet
- L2 Data Link: Ethernet — the unit is a frame, addressed by MAC
- L1 Physical: cable, RF, fiber

KEY HANDSHAKES
- TCP 3-way: SYN -> SYN/ACK -> ACK
- TLS 1.3: ClientHello -> ServerHello + cert + finished -> finished (1-RTT)
- DNS: question -> answer (typically UDP/53, but TCP/53 for large or DNSSEC)

WHY DEFENDERS CARE ABOUT EACH LAYER
- L7: web app firewalls, content inspection
- L4: stateful firewalls track connection state
- L3: routing controls, ACLs, network segmentation
- L2: VLAN hopping, ARP spoofing, MAC flooding
- L1: cable taps, RF eavesdropping

OBSERVABILITY TOOLS
- tcpdump / Wireshark — capture + decode
- ss / netstat — local socket inventory
- mtr / traceroute — path discovery
- dig / nslookup — DNS', 30),
  (1, 'Firewalls and least-privilege rule design', '90 minutes', 'STATELESS VS STATEFUL
- Stateless filter: each packet evaluated alone (iptables -t raw, network ACLs)
- Stateful: tracks connection state, return traffic auto-allowed (iptables, nftables, cloud security groups)
Default to stateful for everything except DDoS edge cases.

RULE-WRITING RULES
1. Default deny — explicit allow for what is needed
2. Order matters in iptables/nftables — first match wins
3. Specify all 5 of: protocol, source IP, source port, dest IP, dest port
4. Log what you drop (sampled) so you can see what you blocked
5. Comment every rule with a ticket or business reason

EXAMPLE: A REAL WEB-TIER POLICY (CONCEPTUAL)
- ALLOW tcp/443 from 0.0.0.0/0 to web SG
- ALLOW tcp/80  from 0.0.0.0/0 to web SG (redirects to 443)
- ALLOW tcp/8080 from web SG to app SG
- ALLOW tcp/5432 from app SG to db SG
- ALLOW egress tcp/443 from app SG to vendor-list
- DROP all else (logged)

CLOUD-NATIVE NUANCES
- AWS security groups are stateful + allow-only
- AWS NACLs are stateless + allow/deny
- Azure NSG is stateful + has priorities
- GCP firewall rules are stateful + tagged
Different defaults — never assume "the cloud has a default firewall."', 45),
  (2, 'TLS, certificates, and the trust system', '60 minutes', 'WHY TLS IS THE LOAD-BEARING WALL
TLS is the cryptographic protocol that turns a hostile network into a usable one. Browsers, APIs, DBs, message buses — everything talks TLS now. Misconfigure it and you have plaintext.

TLS 1.3 IN 5 STEPS
1. Client ClientHello with supported groups, ciphers, key shares
2. Server ServerHello with chosen cipher, its key share, certificate
3. Both sides derive the shared secret with ECDHE
4. Server sends Finished (handshake-MAC under the shared secret)
5. Client sends Finished — connection ready for app data

WHAT CAN GO WRONG
- Expired cert — outage
- Self-signed in production — clients ignore validation, MitM possible
- TLS 1.0 / 1.1 still enabled — known attacks (BEAST, POODLE)
- Weak ciphers — RC4, 3DES, CBC modes
- Missing SNI — the host header is plaintext

DOING IT RIGHT
- TLS 1.3 minimum, TLS 1.2 only for legacy
- ECDSA P-256 or RSA-2048 certs from a public CA (Let''s Encrypt is fine)
- HSTS header so browsers refuse downgrades
- mTLS for service-to-service inside your cluster

OPERATIONAL DISCIPLINE
- Cert lifetime ≤ 90 days, auto-renewed (Let''s Encrypt + cert-manager)
- Monitor cert expiry — page at T-14 days
- ACMEv2 for issuance, never click-to-renew', 30),
  (3, 'VPNs and modern remote access', '90 minutes', 'WHY VPN PATTERNS MATTER
Two patterns dominate: (1) site-to-site (one data center to another), (2) client (a laptop to the corp network). Modern stacks deprecate IP-based trust — pick the right tool for each.

WIREGUARD (THE MODERN DEFAULT)
- Minimal kernel module + small userspace
- Per-peer public key, no usernames
- Roaming-friendly, fast handshake
- Best fit for: mesh between cloud regions, client VPN for engineers

IPSEC (THE LEGACY DEFAULT)
- IKEv2 + ESP — broad vendor support, what hardware appliances speak
- Best fit for: site-to-site between heterogeneous vendors

OPENVPN
- Userspace, TCP or UDP — survives intermediate NAT/firewalls
- Best fit for: client VPNs where users are on hostile networks (cafes, hotels)

ZERO-TRUST NETWORK ACCESS (ZTNA) — replacing client VPN
- Identity-aware proxy (Cloudflare Access, BeyondCorp, Tailscale)
- Per-request authorization, no network membership at all
- Often the right answer for modern shops

KEY MANAGEMENT
- Rotate keys at least annually
- Revoke on offboarding
- Store private keys in HSM or platform keychain — never in source control', 45),
  (4, 'IDS/IPS, segmentation, and zero trust', '90 minutes', 'IDS vs IPS
- IDS: sees traffic, alerts (passive)
- IPS: sees traffic, alerts AND drops (inline)
Most teams start with IDS in detect-only for 30 days, tune false positives, then promote to IPS.

OPEN-SOURCE PICKS
- Suricata — multi-threaded, modern rule language, EVE JSON output
- Snort 3 — the OG, still strong, smaller community now
- Zeek (formerly Bro) — behavioral, not signature-based; the analyst''s favorite

WHERE TO PUT THEM
- North-south boundary: at the egress edge
- East-west: a TAP/SPAN port off each tier-to-tier link
- Cloud: VPC traffic mirroring -> sensor

SEGMENTATION
- Macro: separate VPCs / subscriptions per environment (dev / staging / prod)
- Micro: separate subnets per tier (web / app / db)
- Identity-based: pod-to-pod via service accounts, not IP allow-lists

ZERO TRUST PRINCIPLES
1. Never trust, always verify
2. Assume breach
3. Verify explicitly — every request, every time
4. Least-privilege access
5. Identity is the new perimeter
This is the architecture NIST 800-207 codifies.', 45),
  (5, 'Incident response: the first hour', '90 minutes', 'WHEN AN ALERT FIRES
Most damage in a breach happens between the first signal and the first action. Your job is to compress that gap.

THE NIST 800-61 CYCLE
1. Preparation — runbooks, contact list, comms templates, evidence buckets
2. Detection + Analysis — confirm the alert is real, scope it
3. Containment — short-term (isolate the host) + long-term (segmentation)
4. Eradication — remove the foothold, rotate creds, patch
5. Recovery — restore from clean backups, monitor for re-infection
6. Post-incident — written timeline, root cause, action items, NO BLAME

CONTAIN FIRST, DEBUG LATER
- Pull network from affected hosts (kernel-level firewall to localhost only)
- Snapshot disk + memory BEFORE rebooting
- Rotate any credentials the host had access to
- Inform comms / legal / leadership per your run-book

EVIDENCE
- Memory dump: LiME, AVML, or volatility plugins
- Disk image: dd / dc3dd to a write-blocked destination
- Logs: pull everything from the SIEM into a case bucket — assume the attacker will delete logs

WRITING THE POST-MORTEM
- Plain language, no jargon
- Timeline in UTC
- "What we knew at the time" — no hindsight blame
- Action items with owners + dates
This is what makes the next incident shorter.', 45)
) as l(lesson_order, title, description, content, estimated_minutes)
on c.title = 'Network Security Foundations'
where not exists (
  select 1 from public.training_lessons tl where tl.course_id = c.id and tl.lesson_order = l.lesson_order
);

-- ===========================================================================
-- 2. Application Security + Secure Coding
-- ===========================================================================
insert into public.training_courses (
  title, description, category, difficulty, estimated_duration_hours,
  tags, status, learning_objectives, skills_taught, assessment_methods,
  stem_relevance, weekly_hours
)
select
  'Application Security + Secure Coding',
  'Build software that resists attack. Covers the OWASP Top 10, secure-by-default frameworks, authentication / authorization, secrets handling, dependency hygiene, and shift-left testing in CI.',
  'Application Security', 'INTERMEDIATE', 32,
  array['appsec','owasp','sast','dast','sca','authn','authz','secrets'],
  'ACTIVE',
  array[
    'Identify and remediate each of the OWASP Top 10 vulnerability classes in a real codebase',
    'Implement modern authentication (OIDC / OAuth2) and authorization (RBAC / ABAC) correctly',
    'Validate and encode untrusted input at the right layer of the application',
    'Handle secrets without leaking them — in code, in CI, in logs, in containers',
    'Wire SAST, DAST, and SCA scanners into a CI pipeline with sensible failure gates',
    'Threat-model a feature with STRIDE before writing the code',
    'Write a security finding that an engineer will actually fix'
  ],
  array[
    'OWASP Top 10','Input validation','Output encoding','Parameterized queries',
    'CSRF tokens','Content Security Policy','OIDC / OAuth2','JWT pitfalls',
    'RBAC / ABAC','Secrets managers (AWS Secrets Manager / Vault)','TLS for clients',
    'SAST (Semgrep, CodeQL)','DAST (ZAP, Burp)','SCA (Dependabot, Snyk, OSV)',
    'Threat modeling (STRIDE)','SBOM','Supply-chain attestation (SLSA)'
  ],
  array[
    'Quiz on the OWASP Top 10 with code-level remediation',
    'Lab: find + fix 5 planted vulnerabilities in a sample app (SQLi, XSS, IDOR, SSRF, deserialization)',
    'Capstone: threat model + secure implementation of a small feature with the matching tests',
    'Supervisor review of one real PR with a SAST/SCA report attached'
  ],
  'Application security is the engineering counterpart to network security. Directly extends the software-engineering, databases, and operating-systems coursework from a CS / Cybersecurity / Information Systems degree, and is required on virtually every regulated-industry STEM-OPT engagement (banking, healthcare, gov contracting).',
  5
where not exists (
  select 1 from public.training_courses where title = 'Application Security + Secure Coding'
);

insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, l.title, l.description, l.content, l.lesson_order, l.estimated_minutes
from public.training_courses c
join (values
  (0, 'The OWASP Top 10 — the load-bearing list', '90 minutes', 'WHY THE OWASP TOP 10 STILL MATTERS
The OWASP Top 10 (updated every ~3 years) is the security backlog 80% of real codebases need to work through. Master the categories, not the trivia.

THE 2021 LIST
A01: Broken Access Control — IDOR, missing checks, privilege escalation
A02: Cryptographic Failures — plaintext storage, weak ciphers, exposed secrets
A03: Injection — SQLi, command injection, LDAP injection, OS injection
A04: Insecure Design — missing controls at the architecture layer
A05: Security Misconfiguration — default creds, verbose errors, open S3
A06: Vulnerable + Outdated Components — old libraries, unpatched bases
A07: Identification + Authentication Failures — weak passwords, JWT issues
A08: Software + Data Integrity Failures — unsigned updates, untrusted CDNs
A09: Security Logging + Monitoring Failures — silent breach
A10: Server-Side Request Forgery (SSRF) — server fetches attacker-controlled URLs

HOW DEFENDERS USE THE LIST
- Triage findings into a category — gives you a remediation pattern
- Map your test cases to the list — coverage discipline
- Educate developers — "this is an A03" beats "you have a SQLi"

DON''T MEMORIZE — INTERNALIZE
For each category, you should be able to answer: (a) what the vulnerability looks like in code, (b) what the safe pattern is, (c) which tooling catches it.', 45),
  (1, 'Input validation + output encoding', '90 minutes', 'TWO STEPS YOU CANNOT SKIP
- Input validation: at the boundary, reject anything that does not match the expected shape
- Output encoding: at the sink, encode for the destination context (HTML, SQL, shell)

INPUT VALIDATION DONE RIGHT
- Allow-list, not deny-list
- Validate type, length, range, format
- Reject ambiguous (no "if any of these patterns match")
- Validate ONCE at the boundary, trust internally

JS / TS EXAMPLE WITH ZOD
const Schema = z.object({
  email: z.string().email().max(254),
  age:   z.number().int().min(0).max(150),
});
const parsed = Schema.safeParse(req.body);
if (!parsed.success) return res.status(400).json(parsed.error);

OUTPUT ENCODING — CONTEXT IS EVERYTHING
- HTML body: htmlEscape (& -> &amp; < -> &lt; etc.)
- HTML attribute: attribute-encode (different rules)
- JavaScript context: JSON.stringify or a dedicated JS-encoder
- URL: encodeURIComponent
- SQL: parameterized queries — NEVER string-interpolate
- Shell: pass argv, never a string; or shlex.quote at minimum

ANTI-PATTERNS
- Black-listing characters
- Custom regex for emails / phones (always wrong)
- Sanitizing the input "to make it safe" — encode at the sink, not the source', 45),
  (2, 'Auth: identity, sessions, and tokens', '90 minutes', 'AUTHENTICATION VS AUTHORIZATION
- Authentication (authn): who are you
- Authorization (authz): are you allowed
These are different decisions, often handled by different systems. Keep them separated in code.

USE A LIBRARY, NOT YOUR HEAD
The 3 things you should never write yourself: password hashing, JWT validation, OAuth flows. Use a battle-tested library and call its happy path.

MODERN AUTHN PATTERNS
- OIDC + a managed identity provider (Auth0 / Okta / Cognito)
- Passkeys / WebAuthn for high-trust accounts
- Email-link or TOTP for low-friction reset
- Argon2id for any password you DO still store

JWT PITFALLS (THE REAL LIST)
- Algorithm confusion (alg=none, RS256 vs HS256 swap)
- Long-lived access tokens you cannot revoke — keep them <15 min
- Storing JWT in localStorage — XSS reads it; prefer httpOnly cookies
- Forgetting to verify the issuer + audience

AUTHZ MODELS
- RBAC: role -> permissions (good for ~7 roles)
- ABAC: rules over attributes (good when ownership matters)
- ReBAC: relationships (good for collaboration features)
Most apps need RBAC + a sprinkle of ABAC ("you can edit only your own profile").

EVERY ENDPOINT NEEDS BOTH
- isAuthenticated check
- isAuthorizedForThisResource check
Centralize both with a middleware — never decide authz inside a controller body.', 45),
  (3, 'Secrets and dependency hygiene', '60 minutes', 'WHERE SECRETS LIVE
A secret is anything that grants access to a resource: API keys, DB passwords, TLS private keys, signing keys, OAuth client secrets.

WHERE TO STORE THEM
- AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, HashiCorp Vault
- Pull at boot, cache in memory, never write to disk
- Reference them by name in code — never the value

WHERE TO NOT STORE THEM
- Source control (use git-secrets or trufflehog in CI)
- Environment files committed by accident (.env in gitignore is not enough — assume rotation if seen)
- Build logs — set secrets to "masked" in CI
- Docker images — multi-stage builds, no COPY .env

ROTATION
- All secrets must be rotatable without a deploy
- Database passwords: dual-credential pattern, rotate one at a time
- TLS keys: cert-manager + short-lived certs (ACME)

DEPENDENCIES
- SCA scan on every PR: Dependabot / Snyk / OSV / Trivy
- Pin to a lockfile (package-lock.json, poetry.lock, etc.)
- Audit-on-merge — block PRs that introduce a CVE >= HIGH
- Generate an SBOM on every release (CycloneDX or SPDX)

THE SUPPLY-CHAIN CHECKLIST (SLSA)
- L1: build provenance generated
- L2: build hosted, provenance signed
- L3: build isolated, non-falsifiable provenance
- L4: hermetic + reproducible builds
Most shops are at L2 — aim for L3 in regulated environments.', 30),
  (4, 'Threat modeling with STRIDE', '60 minutes', 'WHY THREAT MODEL BEFORE YOU BUILD
A bug found at the whiteboard costs nothing. The same bug found in prod costs an incident.

STRIDE — the 6 categories
- Spoofing: pretending to be someone else
- Tampering: modifying data in transit or at rest
- Repudiation: denying you took an action
- Information disclosure: leaking data
- Denial of service: making the system unusable
- Elevation of privilege: getting more rights than you should

THE 4-QUESTION FRAMEWORK
1. What are we building? (data flow diagram)
2. What can go wrong? (apply STRIDE to each component / flow)
3. What are we going to do about it? (mitigations)
4. Did we do a good job? (validation pass)

ONE-PAGE DELIVERABLE
- DFD with trust boundaries marked
- Threat table: component | STRIDE category | threat | mitigation | owner
- Risks accepted: explicit list, signed off by product owner

WHEN TO DO IT
- Before any feature that touches authz, payments, PII, or compliance scope
- At design review for any new external integration
- After a near-miss incident — what was unmodeled

ANTI-PATTERNS
- Skipping it because "we have a SAST tool"
- Threat-modeling alone — needs both security and engineering
- A threat model nobody re-reads — keep it in the repo next to the code', 30),
  (5, 'Shift-left: SAST, DAST, SCA in CI', '60 minutes', 'THE THREE SCANNERS
- SAST (static): analyzes source code without running it. Catches injection, weak crypto, hard-coded secrets. Examples: Semgrep, CodeQL, Bandit, SonarQube
- DAST (dynamic): hits a running app, fuzzes inputs. Catches things SAST misses (auth flows, runtime behavior). Examples: OWASP ZAP, Burp Suite Pro
- SCA (composition): looks at your dependencies for known CVEs. Examples: Dependabot, Snyk, OSV-Scanner, Trivy

GATE STRATEGY — DO NOT BLOCK EVERY PR
- High + Critical findings: block merge
- Medium: comment, allow merge, ticket created
- Low + Info: report only
False-positive triage is the #1 reason teams turn scanners off — invest in suppression discipline.

WIRING IT UP (GITHUB ACTIONS EXAMPLE)
- name: SAST
  uses: returntocorp/semgrep-action@v1
  with: { config: "auto" }
- name: SCA
  uses: aquasecurity/trivy-action@master
  with: { scan-type: fs, severity: "HIGH,CRITICAL" }

SUPPRESSING FINDINGS — THE DISCIPLINE
- Always link to a ticket
- Always include an expiry date
- Auto-reopen if the finding still exists at expiry
Without this, suppressions accumulate and the scanner becomes background noise.

METRICS THAT MATTER
- Mean time to remediate by severity
- % of PRs that pass first run
- # of suppressions older than 90 days', 30)
) as l(lesson_order, title, description, content, estimated_minutes)
on c.title = 'Application Security + Secure Coding'
where not exists (
  select 1 from public.training_lessons tl where tl.course_id = c.id and tl.lesson_order = l.lesson_order
);

-- ===========================================================================
-- Final touches
-- ===========================================================================
notify pgrst, 'reload schema';
