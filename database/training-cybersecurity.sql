-- HireOrbit AI — add broader Cybersecurity courses to round out the
-- security track. Pairs with training-security.sql (Network + AppSec).
--
-- New courses:
--   1. Cybersecurity Fundamentals + SOC Operations   (Cybersecurity)
--   2. Cloud Security + Compliance                    (Cloud Security)
--
-- Each course carries full I-983 STEM-OPT metadata + 6 lessons.
-- Idempotent. Safe to re-run.

-- ===========================================================================
-- 1. Cybersecurity Fundamentals + SOC Operations
-- ===========================================================================
insert into public.training_courses (
  title, description, category, difficulty, estimated_duration_hours,
  tags, status, learning_objectives, skills_taught, assessment_methods,
  stem_relevance, weekly_hours
)
select
  'Cybersecurity Fundamentals + SOC Operations',
  'The breadth course every security engineer needs: CIA triad, threat actors, the cyber kill chain, MITRE ATT&CK, SIEM + detection engineering, threat hunting, identity + access, and an honest tour of the major compliance frameworks.',
  'Cybersecurity', 'INTERMEDIATE', 36,
  array['cybersecurity','soc','siem','mitre','attack','iam','blue-team','threat-hunting'],
  'ACTIVE',
  array[
    'Reason about a system in CIA terms (confidentiality, integrity, availability) and pick controls accordingly',
    'Map an observed attacker behavior to a MITRE ATT&CK technique and pivot to a defensive control',
    'Design a SIEM log pipeline that an analyst can actually query — schema, normalization, retention',
    'Write a detection rule that fires on a real malicious pattern with a low false-positive rate',
    'Run a threat hunt from a hypothesis to a hunt report and a new detection',
    'Build identity + access controls (SSO, MFA, just-in-time, PAM) that scale past 100 users',
    'Read a SOC 2 / ISO 27001 / PCI report and tell whether it actually covers your scope'
  ],
  array[
    'CIA triad','AAA (authn / authz / audit)','Threat actors + motivations',
    'Cyber kill chain','MITRE ATT&CK','SIEM (Splunk / Elastic / Datadog)',
    'Sigma rules','KQL / SPL','Threat hunting','Detection engineering',
    'NIST CSF','SOC 2','ISO 27001','PCI DSS','HIPAA','GDPR',
    'IAM','SSO','MFA','SAML / OIDC','PAM (CyberArk / BeyondTrust)',
    'Incident response (NIST 800-61)','Tabletop exercises'
  ],
  array[
    'Quiz on the CIA triad + MITRE ATT&CK tactic mapping (≥80% passing)',
    'Lab: author 3 detection rules (Sigma) against a real log set; measure true-positive rate',
    'Hunt exercise: receive a hypothesis, return a hunt report + one promoted detection',
    'Capstone: design + document a SOC tier-1 + tier-2 runbook for a sample environment',
    'Supervisor review of one real incident review (post-mortem) the student wrote'
  ],
  'Cybersecurity engineering is the operational counterpart to network + application security. Extends the CS / Cybersecurity / Information Systems coursework and is in active demand on virtually every regulated-industry STEM-OPT engagement — banking, healthcare, government services, and SaaS shops chasing SOC 2.',
  6
where not exists (
  select 1 from public.training_courses where title = 'Cybersecurity Fundamentals + SOC Operations'
);

insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, l.title, l.description, l.content, l.lesson_order, l.estimated_minutes
from public.training_courses c
join (values
  (0, 'CIA, threats, and the security mindset', '60 minutes', 'WHY START WITH PRINCIPLES
Every security control you will ever evaluate trades against one of three goals.

THE CIA TRIAD
- Confidentiality: only authorized parties can read the data
- Integrity: data has not been modified without authorization
- Availability: the system is reachable when needed
Pick the control that protects the property the business actually cares about. A bank cares about integrity first; a stock-feed cares about availability first; a medical record cares about confidentiality first.

THE A-COMPANION: AUDITABILITY
Without an audit trail you cannot answer "who did what, when" — and you cannot satisfy any compliance auditor. Treat auditability as a 4th property.

THREAT ACTORS — KNOW WHO YOU ARE DEFENDING AGAINST
- Opportunistic: scans, commodity malware. Volume, low skill.
- Organized criminal: ransomware, BEC, financial fraud.
- Insider: malicious or negligent employee with legitimate access.
- Hacktivist: defacement, leaks, targeted disruption.
- Nation-state: long-term, well-resourced, supply-chain capable.
Your control set should be tuned to the actors realistic for your business — most shops over-invest in nation-state defense and under-invest in BEC + ransomware.

THE SECURITY MINDSET — 4 HABITS
1. Assume breach. Design as if the attacker is already inside.
2. Defense in depth. No single control should be load-bearing.
3. Least privilege. Default to no access, grant the minimum.
4. Verify, do not trust. Especially identity, especially inputs.', 30),
  (1, 'MITRE ATT&CK and the modern detection mindset', '90 minutes', 'WHY ATT&CK IS THE LINGUA FRANCA
MITRE ATT&CK is a public catalog of real-world attacker techniques, mapped against the tactics they serve. It gives blue teams a common vocabulary and a coverage scorecard.

THE 14 TACTICS (LEFT TO RIGHT, ROUGHLY THE ATTACK FLOW)
Reconnaissance, Resource Development, Initial Access, Execution, Persistence, Privilege Escalation, Defense Evasion, Credential Access, Discovery, Lateral Movement, Collection, Command and Control, Exfiltration, Impact.

UNDER EACH TACTIC: TECHNIQUES + SUB-TECHNIQUES
- T1078 Valid Accounts (Credential Access)
- T1059 Command and Scripting Interpreter (Execution)
- T1486 Data Encrypted for Impact (Impact = ransomware)
Each technique entry includes detection ideas + data sources.

HOW DEFENDERS USE ATT&CK
- Coverage matrix: which techniques can you detect, which can you not
- Threat modeling: which techniques are the adversaries you face most likely to use
- Tuning: when a detection fires, map it to its technique so you know what step the attacker is on

THE PYRAMID OF PAIN
From easiest to hardest to change (for the attacker):
- Hash values  → trivial to change
- IP addresses → easy to rotate
- Domain names → some friction
- Network / host artifacts → meaningful pain
- Tools         → significant pain
- TTPs (the ATT&CK techniques) → require re-tooling
The higher you defend up this pyramid, the more durable your detections. Hash-based AV is the bottom rung.', 45),
  (2, 'SIEMs and the log pipeline', '90 minutes', 'WHAT A SIEM ACTUALLY IS
A SIEM (Security Information + Event Management) is three things stacked:
1. A log pipeline (collection + normalization + storage)
2. A query interface (KQL, SPL, EQL, Lucene — flavored per vendor)
3. A detection engine (run rules on incoming events, fire alerts)
Splunk, Elastic, Sentinel, Datadog SIEM, Chronicle all ship the same loop.

WHAT TO LOG (THE NON-NEGOTIABLES)
- Authentication: logins, MFA challenges, failures
- Authorization: privilege changes, role grants
- Process execution on endpoints (EDR)
- Network connections at egress
- Cloud API calls (CloudTrail / Activity Log / Audit Log)
- Web access logs (WAF + reverse proxy)
- Application-level audit events

LOG SCHEMA — DO NOT SKIP NORMALIZATION
Pick a common schema (ECS, OCSF, or vendor-specific) and translate every source into it. Without this:
- Analysts cannot correlate
- Detections cannot generalize across data sources
- New sources cost 10x more to onboard

RETENTION
- Hot (queryable): 30 days minimum
- Warm: 90 days
- Cold (auditable): 1 year minimum, 7 years for regulated data
The cheapest mistake is short retention — by the time you find the breach, the evidence is gone.

ANTI-PATTERNS
- "We will figure out the schema later" — you will not
- Ingesting everything by volume — costs explode, signal does not improve
- Building detections that depend on a specific source — break on every onboarding', 45),
  (3, 'Detection engineering: writing rules that work', '90 minutes', 'A DETECTION IS A HYPOTHESIS
"If I see X, an attacker is doing Y." Detections must be testable, measurable, and revisable.

THE 4 PROPERTIES OF A GOOD DETECTION
1. Correct: fires on the bad, ignores the good
2. Resilient: the attacker cannot trivially rename a binary to bypass it
3. Performant: runs within the SIEM time budget
4. Maintained: has an owner, a test set, a tuning history

THE FOUR-PHASE LIFECYCLE
1. Hypothesize — pick a TTP from ATT&CK
2. Test — run the rule against historical data, count hits + classify them
3. Promote — push to production with severity + run-book
4. Tune — review false positives weekly, refine

SIGMA — THE PORTABLE DETECTION LANGUAGE
Sigma rules are YAML that compile to SPL / KQL / EQL / SQL. Lets you share detections across SIEMs.
title: Suspicious PowerShell EncodedCommand
logsource: { product: windows, category: process_creation }
detection:
  selection:
    Image|endswith: powershell.exe
    CommandLine|contains:
      - -enc
      - -EncodedCommand
  condition: selection
level: high

THE RUN-BOOK MATTERS MORE THAN THE RULE
Every detection MUST link to a run-book that tells the on-call analyst:
- What this alert means
- The 3-5 commands to triage it
- Who to escalate to and when
- How to mark it benign + retune', 45),
  (4, 'Threat hunting and the analyst workflow', '60 minutes', 'HUNTING VS RESPONDING
- Responding: alert fires, analyst investigates
- Hunting: analyst forms a hypothesis, queries the data, looks for badness even with no alert
Mature SOCs spend ~20% of analyst time on proactive hunting.

THE HUNT LOOP
1. Hypothesis — "an attacker would chain X + Y to evade Z"
2. Data check — do we even log the events needed
3. Query — write the query, restrict to a sane time window
4. Triage — classify each hit (benign, suspicious, malicious)
5. Outcome — either nothing found, finding remediated, or a new detection promoted

GOOD HUNTING HYPOTHESES
- "Did anything authenticate from outside our normal countries this week?"
- "Did any service account log into an interactive session?"
- "Did any process write to /tmp and then make an outbound network connection within 60s?"

DOCUMENTATION
Every hunt — yes, every one — produces a hunt report:
- Hypothesis
- Data queried + time window
- Findings classification
- Detection promoted (if any)
- Gaps surfaced (if any)
Hunt reports compound into institutional knowledge — without them every hunter starts from zero.', 30),
  (5, 'IAM, MFA, and least privilege at scale', '90 minutes', 'IDENTITY IS THE PERIMETER NOW
With workloads in cloud, SaaS, and remote endpoints, the network perimeter is gone. The new perimeter is identity. Verify it on every request.

SSO (SINGLE SIGN-ON)
- Federate every app to one identity provider (Okta, Entra ID, Google Workspace)
- SAML for legacy enterprise apps, OIDC for modern apps
- A single account lifecycle: hire = provision, leave = deprovision everywhere
- Without SSO, offboarding takes weeks and creates orphan accounts

MFA — NOT ALL FACTORS ARE EQUAL
Strength order (worst to best):
- SMS code (susceptible to SIM swap)
- TOTP app (Google Authenticator, Authy)
- Push-based (Duo, Okta Verify) — vulnerable to MFA fatigue / push bombing
- Hardware key / WebAuthn / Passkeys — phishing resistant
Require WebAuthn or hardware keys for admin / break-glass accounts.

LEAST PRIVILEGE — THE OPERATIONAL DISCIPLINE
- Default to no access. Grant minimum required.
- Role-based, not user-based — easier to audit.
- Time-bound elevation (JIT) for admin actions — not standing access.
- Quarterly access review — managers re-attest who needs what.

PRIVILEGED ACCESS MANAGEMENT (PAM)
- Vault credentials, never share
- Session recording for admin sessions
- Just-in-time elevation via a workflow with approval
- No engineer ever knows the root password
CyberArk, BeyondTrust, HashiCorp Vault, Teleport — all cover this space.

WHY THIS PAYS OFF
The single highest-leverage security investment a mid-size company can make is "every login is SSO + WebAuthn, every admin action is JIT + recorded." It defeats >80% of the BEC + ransomware attacks that actually hit shops.', 45),
  (6, 'Compliance frameworks: what each one actually requires', '60 minutes', 'WHY COMPLIANCE MATTERS TO ENGINEERS
Compliance is the contract between your company and its regulator (or its customers). As an engineer you will be asked to produce evidence — logs, configs, screenshots, policies. The faster you can do that, the cheaper the audit.

THE FRAMEWORKS IN ONE PASS
- SOC 2 (Service Organization Control 2): an AICPA report attesting to your trust criteria (security, availability, processing integrity, confidentiality, privacy). The default ask from any B2B SaaS customer.
- ISO 27001: international standard for an Information Security Management System (ISMS). More process-heavy than SOC 2, certifies the management system not the controls.
- PCI DSS: required if you touch credit card data. Scope reduction (tokenization, hosted iframes) is the single biggest cost lever.
- HIPAA: U.S. healthcare PHI. Covered entities + business associates. Requires a BAA with every vendor that touches PHI.
- GDPR: EU personal data. Lawful basis, data minimization, subject rights (access, erasure), DPIA for high-risk processing.
- FedRAMP: U.S. federal cloud workloads. The most expensive of the bunch; usually only if you sell to federal agencies.

EVIDENCE YOU WILL BE ASKED FOR
- Access reviews (who has access to prod)
- Change management (PR approval, CI gates)
- Incident logs (MTTR, post-mortems)
- Vulnerability management (SLA on remediation)
- Vendor risk reviews (SOC 2 of every critical vendor)
- Background checks (for personnel with access)
- Encryption (at rest + in transit)
- Backup + DR test logs

THE ENGINEER''S CHECKLIST
- Centralize the evidence in a compliance platform (Drata, Vanta, Secureframe) wired to your real systems
- Automate the evidence pulls — manual screenshots rot
- Treat the audit as a system test of your controls; failures are bugs, not paperwork', 30)
) as l(lesson_order, title, description, content, estimated_minutes)
on c.title = 'Cybersecurity Fundamentals + SOC Operations'
where not exists (
  select 1 from public.training_lessons tl where tl.course_id = c.id and tl.lesson_order = l.lesson_order
);

-- ===========================================================================
-- 2. Cloud Security + Compliance
-- ===========================================================================
insert into public.training_courses (
  title, description, category, difficulty, estimated_duration_hours,
  tags, status, learning_objectives, skills_taught, assessment_methods,
  stem_relevance, weekly_hours
)
select
  'Cloud Security + Compliance',
  'Defending cloud workloads end-to-end: shared responsibility, cloud IAM at scale, posture management, encryption + KMS, cloud-native detection, and wiring SOC 2 / ISO 27001 / HIPAA evidence from your real infrastructure.',
  'Cloud Security', 'INTERMEDIATE', 32,
  array['cloud','aws','azure','gcp','iam','kms','cspm','soc2','hipaa','guardduty'],
  'ACTIVE',
  array[
    'Apply the cloud shared-responsibility model to a real workload and identify the gaps you own',
    'Design IAM in a multi-account / multi-subscription cloud org — SCPs, OUs, federation, JIT',
    'Stand up cloud posture management (CSPM) with sensible guardrails and drift detection',
    'Implement encryption at rest + in transit with a managed KMS, including key rotation + audit',
    'Wire cloud-native detection (CloudTrail + GuardDuty / Defender / SCC + Security Hub) into a SIEM',
    'Generate the evidence a SOC 2 / ISO 27001 / HIPAA auditor needs from infrastructure-as-code',
    'Run a cloud breach tabletop — assume an IAM credential leaked into a public GitHub repo'
  ],
  array[
    'AWS Organizations / Azure Mgmt Groups / GCP Folders','SCPs / Azure Policy / Org Policies',
    'IAM Identity Center (SSO) + federation','IAM Roles / Workload Identity',
    'AWS Config / Azure Policy / SCC','GuardDuty / Defender for Cloud / SCC',
    'CloudTrail / Activity Log / Cloud Audit Logs','Security Hub / Sentinel / Chronicle',
    'KMS / Key Vault / Cloud KMS','Secrets Manager / Key Vault Secrets / Secret Manager',
    'CSPM (Wiz, Prisma, native)','Terraform / Pulumi','Drata / Vanta / Secureframe',
    'SOC 2','ISO 27001','HIPAA','PCI DSS','FedRAMP'
  ],
  array[
    'Quiz on shared-responsibility + IAM trust-policy edge cases',
    'Lab: write a Service Control Policy that blocks a real attacker pattern (egress to unapproved regions)',
    'Capstone 1: design a 3-account AWS org with break-glass + JIT admin, documented',
    'Capstone 2: produce the access-review + change-management evidence pack for a mock SOC 2 audit',
    'Supervisor review of one Terraform module against a CIS benchmark'
  ],
  'Cloud security is one of the highest-paying, fastest-growing STEM-OPT specializations. Directly extends the operating-systems + networking + cryptography coursework from a CS / Cybersecurity / Cloud Computing degree, and pairs naturally with the AWS for Engineers course already in this catalog.',
  6
where not exists (
  select 1 from public.training_courses where title = 'Cloud Security + Compliance'
);

insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, l.title, l.description, l.content, l.lesson_order, l.estimated_minutes
from public.training_courses c
join (values
  (0, 'The shared-responsibility model in practice', '60 minutes', 'WHO OWNS WHAT
- The cloud provider owns: physical security, hypervisor, the service itself
- You own: identity, configuration, data, application code
Sounds obvious. In practice the line shifts per service.

THE LINE PER SERVICE TYPE
- IaaS (EC2, VMs): you own the OS and everything above
- PaaS (Lambda, App Service): you own the code + config + identity
- SaaS (S3, DynamoDB, Cosmos DB): you own only configuration + identity + data
The default S3 misconfig of the last decade was treating S3 as "the cloud takes care of it" — you own the bucket policy.

WHAT THIS MEANS OPERATIONALLY
- You always own IAM. No cloud provider can ship an authz decision for your app.
- You always own data classification. The provider does not know that THIS bucket has PHI.
- You always own logging. CloudTrail / Activity Log / Audit Log is YOUR audit trail; turn it on and ship it.
- Encryption-at-rest defaults are great, but key custody is yours.

THE 5 MOST COMMON OWNERSHIP MISCONCEPTIONS
1. "The cloud is encrypted" — yes at the disk; what about the bucket policy?
2. "Backups are automatic" — yes for the service, not for your data lifecycle
3. "DDoS is handled" — at the edge, but app-layer is your WAF
4. "Patches are managed" — for the hypervisor; you own the AMI + Lambda runtime
5. "We have a SOC 2" — the provider has one, you still need yours', 30),
  (1, 'IAM at cloud org scale', '90 minutes', 'THE THREE LEVELS OF CLOUD IAM
1. Identity (who you are): a user, a role, a workload, a federated identity
2. Permissions (what you can do): policies attached to identities + resources
3. Boundaries (the rails): SCPs / Azure Policy / Org Policies that bound any allow

ORG STRUCTURE
- Separate accounts (AWS) / subscriptions (Azure) / projects (GCP) by blast radius
- Group them with OUs / Management Groups / Folders by team or environment
- Per-account billing is a fine side-benefit, but the security benefit is hard isolation

POLICY LAYERS (FROM TOP DOWN, ALL MUST ALLOW)
- SCP / Org Policy: the org-wide rails. "No one can ever disable CloudTrail."
- Identity policy: what this role can do
- Resource policy: what the resource permits
- Permission boundary: a cap on the identity policy
- Session policy: a further cap at session time
An action is allowed only if every layer allows it.

FEDERATE — NEVER USE LONG-LIVED ACCESS KEYS
- Humans: SSO (AWS IAM Identity Center / Entra ID / Workforce Identity)
- Workloads: instance profiles, workload identity, federated tokens
- CI: OIDC federation (GitHub Actions, GitLab CI to AWS / Azure / GCP)
The leaked AWS keys on GitHub story is preventable in 2026 — turn off long-lived keys.

JIT ELEVATION
- Standing admin access is a footgun
- Elevate via a workflow with approval (AWS IAM Identity Center permission sets, Entra PIM)
- Time-box to ≤4 hours, log every assumption', 45),
  (2, 'Posture management + guardrails', '60 minutes', 'WHAT IS CSPM
Cloud Security Posture Management = continuous evaluation of your cloud configuration against a benchmark, with auto-remediation where safe.

THE BENCHMARKS
- CIS AWS / Azure / GCP — the community standard
- AWS Well-Architected Security Pillar
- Microsoft Cloud Security Benchmark
- NIST SP 800-53
Pick one as your primary, map the rest to it.

NATIVE TOOLS
- AWS: Config + Security Hub + Inspector + Macie
- Azure: Defender for Cloud (Microsoft Cloud Security Benchmark)
- GCP: Security Command Center (CIS + GCP benchmarks)
Free tier is usable; paid tier gets you cross-account visibility + auto-remediation.

THIRD-PARTY TOOLS
- Wiz, Prisma Cloud, Orca, Lacework — agentless, prettier UI, cross-cloud
- Worth it when you have 2+ clouds or 50+ accounts

GUARDRAILS — THE PREVENTIVE LAYER
- SCP: "No one can launch resources outside our approved regions"
- Service Control: "No one can disable CloudTrail or VPC Flow Logs"
- Org Policies: "All Cloud Storage buckets must enforce uniform bucket-level access"
Combine guardrails (block bad) with posture (detect bad that got through).

DRIFT DETECTION
- Tag every resource with owner + purpose + cost center
- Alert when a resource is created without tags
- Alert when a resource is modified out-of-band (not via IaC)
Drift is the precursor to misconfig — catch it early.', 30),
  (3, 'Encryption + KMS done right', '90 minutes', 'WHY KMS MATTERS
Encryption-at-rest is table stakes. Key custody is the real game. Whoever holds the keys can decrypt the data — and the auditors will ask who that is.

THE 3 KEY-CUSTODY MODELS
1. Provider-managed keys: cloud generates + rotates. Easiest. The provider can theoretically access; mitigated by their audit boundary.
2. Customer-managed keys (KMS): you create + own the key, the cloud uses it via API. You can disable / rotate / audit.
3. Customer-supplied / HSM keys (CloudHSM, Dedicated HSM): keys never leave your HSM. Highest control, highest ops cost.
For most regulated workloads, customer-managed keys (KMS) is the sweet spot.

KEY HYGIENE
- Per-environment keys (prod ≠ staging ≠ dev)
- Annual rotation at minimum (KMS rotation is automatic + transparent)
- Key policies: SEPARATE the role that uses the key from the role that admins the key
- CloudTrail every key usage — encrypt + decrypt are auditable events

ENVELOPE ENCRYPTION
- Cloud services rarely encrypt large objects with the KMS key directly
- KMS generates a data-encryption key (DEK), encrypts the object with the DEK
- DEK is then encrypted with the customer master key (CMK) and stored alongside the object
- To read: KMS decrypts the DEK with the CMK, app uses the DEK to decrypt the object
This pattern is everywhere: S3 SSE-KMS, EBS, RDS, Secrets Manager.

IN TRANSIT
- TLS 1.3 for everything user-facing
- mTLS for service-to-service inside the mesh
- VPC endpoints / Private Link so traffic to cloud services never touches the public internet
- Never disable TLS verification "for testing" — it always ships to prod

KEY DELETION IS PERMANENT
- KMS deletion has a 7-30 day waiting window for a reason
- Deleting a key = the data it encrypted is now permanently lost
- Build alerts on key deletion + key disable', 45),
  (4, 'Cloud-native detection', '90 minutes', 'THE BIG THREE LOG SOURCES (PER CLOUD)
- AWS: CloudTrail (API calls), VPC Flow Logs (network), GuardDuty (managed detection)
- Azure: Activity Log (control plane), NSG Flow Logs (network), Defender for Cloud (managed detection)
- GCP: Cloud Audit Logs, VPC Flow Logs, Security Command Center
Turn all three on. Across all accounts. With centralized aggregation. Day one.

MANAGED DETECTION
- GuardDuty / Defender / SCC ship with built-in detections — credential exfil, crypto-mining, anomalous S3 access, IAM enumeration
- Free to enable on most tiers, pay for volume
- These give you a strong baseline; tune to your environment

CENTRALIZATION
- One log archive account per cloud (write-only, retention-locked)
- Ship to your SIEM (Splunk, Elastic, Sentinel, Chronicle, Datadog SIEM)
- Use the cloud-native correlation hubs (Security Hub, Sentinel) for cross-source views
Without centralization an attacker can disable logs in a single account and you would never know.

DETECTIONS YOU MUST HAVE
- Root / Global Admin login (should be zero in normal ops)
- IAM user created with console access (everyone should be SSO)
- Long-lived access keys generated (should be rare or banned)
- Disabling logging or KMS keys
- Cross-account assume-role to a previously-unseen account
- Egress to a known-bad destination (GuardDuty + threat intel feed)

INCIDENT-READY EVIDENCE
- Logs must be tamper-evident — write to a separate account, lock retention
- Snapshots: store EBS / managed-disk snapshots in a read-only forensic account
- IAM forensics: AWS Identity and Access Analyzer, Azure PIM logs, GCP Policy Analyzer', 45),
  (5, 'Wiring compliance evidence from real infrastructure', '90 minutes', 'WHY ENGINEERS OWN COMPLIANCE EVIDENCE
The auditor will ask: prove that every prod change was reviewed. Prove that every prod user had MFA. Prove that backups were tested. The cheapest way to answer is to wire the evidence directly from your real systems — not screenshots.

THE TRUST PLATFORMS
- Drata, Vanta, Secureframe, Thoropass — wire to your cloud, IdP, ticketing, code repo
- They pull evidence continuously, map it to SOC 2 / ISO 27001 / HIPAA / PCI controls
- Auditors accept the export

WHAT TO WIRE FOR SOC 2 (THE COMMON BASELINE)
- IdP (Okta / Entra ID): user lifecycle, MFA enforcement, access reviews
- Code repo (GitHub / GitLab): PR approval, branch protection, merge protection
- Cloud (AWS / Azure / GCP): IAM users, MFA, logging enabled, encryption configured
- HRIS (Workday / Rippling / Gusto): hire + terminate events, background-check status
- Ticketing (Jira / Linear): change records, incident records
- EDR / MDM: endpoint inventory + posture

CHANGE MANAGEMENT THE AUDITOR WILL ACCEPT
- Every prod change is a PR
- Every PR has at least one approver who is not the author
- The PR links to a ticket
- CI must pass before merge
- Merge to main triggers a tracked deploy
This entire chain is auditable from the code repo + CI system; no screenshots needed.

HIPAA SPECIFICS
- BAA with every vendor that touches PHI
- Encrypted at rest + in transit (you control the keys)
- Access logs retained for 6 years
- Workforce training annually
- Risk analysis documented + updated

ISO 27001 SPECIFICS
- Statement of Applicability (SoA) — which Annex A controls apply, why
- ISMS — the management system that runs your security program
- Internal audit + management review on a cycle
ISO is more process; SOC 2 is more controls. Most B2B SaaS does SOC 2 first and ISO when European customers ask.

THE GOLDEN RULE
If you cannot answer an audit question from a query against your real systems, that is a security gap — not an audit gap.', 45)
) as l(lesson_order, title, description, content, estimated_minutes)
on c.title = 'Cloud Security + Compliance'
where not exists (
  select 1 from public.training_lessons tl where tl.course_id = c.id and tl.lesson_order = l.lesson_order
);

-- ===========================================================================
-- Final touches
-- ===========================================================================
notify pgrst, 'reload schema';
