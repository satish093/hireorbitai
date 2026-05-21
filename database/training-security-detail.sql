-- =============================================================================
-- Training: full-LMS detail for the 4 security courses
-- =============================================================================
-- Completes the security courses seeded by training-security.sql and
-- training-cybersecurity.sql to full-LMS depth: course overview / roadmap /
-- resources / capstone, per-lesson summary / exercises / key takeaways, and
-- per-lesson multiple-choice quizzes. Every quiz question is answerable from
-- the lesson body that already ships in those files.
--
-- NON-DESTRUCTIVE + IDEMPOTENT:
--   * UPDATEs only metadata columns — never touches training_lessons.content/title.
--   * Quiz INSERTs are guarded by NOT EXISTS (lesson_id, question), so re-running
--     adds nothing.
--
-- Apply AFTER training-security.sql, training-cybersecurity.sql,
-- training-generated-content.sql, and training-versioning.sql.
-- =============================================================================

-- =============================================================================
-- 1) NETWORK SECURITY FOUNDATIONS
-- =============================================================================
update public.training_courses set
  overview = 'Network Security Foundations teaches defense-in-depth at the network layer for engineers and STEM-OPT trainees moving into security roles. You will work bottom-up through the stack — packets, firewalls, TLS, VPNs, intrusion detection, segmentation, and incident response — always from the defender''s seat. By the end you can read a packet capture, design least-privilege firewall rules, stand up modern VPNs, tune an IDS/IPS, segment a network into zones, and run the first hour of an incident with a written playbook.',
  target_audience = 'Engineers and STEM-OPT trainees entering network-defense / SOC roles in regulated industries.',
  roadmap = '[
    {"phase":"Fundamentals","duration_label":"Week 1","focus_areas":["TCP/IP and the OSI model","Reading packet captures"]},
    {"phase":"Perimeter + crypto","duration_label":"Week 2","focus_areas":["Least-privilege firewalls","TLS and the trust system","VPNs and remote access"]},
    {"phase":"Detect + respond","duration_label":"Week 3","focus_areas":["IDS/IPS and segmentation","Zero trust","Incident response"]}
  ]'::jsonb,
  resources = '[
    {"title":"NIST SP 800-61 Computer Security Incident Handling Guide","url":"https://csrc.nist.gov/pubs/sp/800/61/r2/final","type":"DOC"},
    {"title":"NIST SP 800-207 Zero Trust Architecture","url":"https://csrc.nist.gov/pubs/sp/800/207/final","type":"DOC"},
    {"title":"MITRE ATT&CK","url":"https://attack.mitre.org/","type":"TOOL"},
    {"title":"WireGuard","url":"https://www.wireguard.com/","type":"DOC"},
    {"title":"Suricata documentation","url":"https://docs.suricata.io/","type":"DOC"},
    {"title":"Wireshark User Guide","url":"https://www.wireshark.org/docs/","type":"DOC"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Design and document a defense-in-depth architecture for a 3-tier web application (web / app / database), then write an incident-response playbook for a suspected web-tier compromise.",
    "questions":[
      {"prompt":"Produce a network diagram with security zones and least-privilege firewall rules between each tier.","guidance":"Specify protocol, source, and destination for every allow rule; default-deny everything else."},
      {"prompt":"Document the TLS posture (versions, cert lifetime, HSTS, mTLS where used).","guidance":"State the minimum TLS version and renewal automation."},
      {"prompt":"Write a first-hour IR playbook for a web-tier compromise following NIST 800-61.","guidance":"Cover contain, eradicate, recover, and evidence capture order."}
    ],
    "rubric":[
      {"criterion":"Least-privilege segmentation","weight":30},
      {"criterion":"Crypto / TLS posture","weight":20},
      {"criterion":"Detection coverage","weight":20},
      {"criterion":"IR playbook completeness","weight":30}
    ]
  }'::jsonb,
  quiz_passing_score = 70,
  quiz_max_attempts = 3,
  content_status = 'READY',
  review_status = 'PUBLISHED'
where title = 'Network Security Foundations';

update public.training_lessons tl set
  summary = v.summary,
  exercises = v.exercises::jsonb,
  key_takeaways = v.key_takeaways::jsonb,
  content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Map every threat and control to a layer of the network stack.',
     '[{"prompt":"Capture traffic to a website with Wireshark or tcpdump and identify the TCP 3-way handshake and the TLS ClientHello.","expected_outcome":"You can point to the SYN, SYN/ACK, ACK and the first TLS record in the capture.","hints":["Filter on tcp.flags.syn==1","Look for the ClientHello right after the handshake"]}]',
     '["Every attack and defense lives at a layer of the stack","TCP handshake is SYN then SYN/ACK then ACK","Wireshark and tcpdump capture and decode packets","Stateful firewalls track state at L4"]'),
    (1, 'Write least-privilege, default-deny firewall rules.',
     '[{"prompt":"Write a default-deny rule set for a web/app/db tier that allows only the necessary flows.","expected_outcome":"A rule list that specifies protocol, source, and destination for each allow and drops everything else.","hints":["Start with deny all","Allow 443 to web, web to app, app to db only"]}]',
     '["Default deny, then explicit allow","First match wins in iptables/nftables","Specify all five tuple fields per rule","AWS security groups are stateful and allow-only"]'),
    (2, 'Configure TLS and certificates the modern way.',
     '[{"prompt":"Inspect a site''s TLS configuration and record the version, cipher, and certificate expiry.","expected_outcome":"You identify whether TLS 1.3 is used, the cipher suite, and days until cert expiry.","hints":["Use openssl s_client or the browser cert viewer","Check for the HSTS header"]}]',
     '["TLS 1.3 minimum, 1.2 only for legacy","HSTS prevents downgrade attacks","Keep cert lifetime <= 90 days, auto-renewed","Self-signed certs in prod enable MitM"]'),
    (3, 'Pick the right VPN / remote-access pattern.',
     '[{"prompt":"Choose between WireGuard, IPsec, OpenVPN, and ZTNA for three scenarios (cloud mesh, vendor site-to-site, engineer laptop access) and justify each.","expected_outcome":"Each scenario is matched to the most appropriate technology with a one-line reason.","hints":["WireGuard for modern mesh/client","IPsec for heterogeneous site-to-site","ZTNA replaces client VPN"]}]',
     '["WireGuard is the modern default with per-peer keys","IPsec fits heterogeneous site-to-site","ZTNA replaces client VPN with per-request authz","Store private keys in an HSM or keychain"]'),
    (4, 'Deploy detection and apply zero-trust principles.',
     '[{"prompt":"Describe where you would place IDS/IPS sensors for north-south and east-west traffic and why you would start in detect-only.","expected_outcome":"Sensor placement at egress and tier-to-tier links, with a 30-day tuning period before going inline.","hints":["IDS detect-only first, then promote to IPS","Use TAP/SPAN or VPC traffic mirroring"]}]',
     '["IDS alerts (passive); IPS alerts and drops (inline)","Zeek is behavioral, not signature-based","Zero trust: never trust, always verify","NIST 800-207 codifies Zero Trust"]'),
    (5, 'Run the first hour of an incident.',
     '[{"prompt":"Write the ordered first-hour steps for a confirmed host compromise.","expected_outcome":"Contain first, capture memory and disk before reboot, rotate credentials, then eradicate and recover.","hints":["Snapshot memory and disk BEFORE rebooting","Rotate any creds the host could reach"]}]',
     '["Contain first, debug later","Capture memory and disk before reboot","NIST 800-61 defines the IR cycle","Post-mortems are blameless, timeline in UTC"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'Network Security Foundations' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l
join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'At which layer does a stateful firewall track connection state?', '["L4 Transport","L7 Application","L2 Data Link","L1 Physical"]', 'L4 Transport', 'Stateful firewalls track TCP connection state at the transport layer (L4).'),
  (0, 1, 'What is the correct TCP three-way handshake order?', '["SYN -> SYN/ACK -> ACK","ACK -> SYN -> SYN/ACK","SYN -> ACK -> SYN/ACK","SYN/ACK -> SYN -> ACK"]', 'SYN -> SYN/ACK -> ACK', 'The client sends SYN, the server replies SYN/ACK, the client finishes with ACK.'),
  (0, 2, 'Which tool captures and decodes packets for analysis?', '["Wireshark","dig","traceroute","netstat"]', 'Wireshark', 'Wireshark (and tcpdump) capture and decode packets; the others are DNS/path/socket tools.'),
  (1, 0, 'What should the default firewall policy be?', '["Default deny, explicit allow","Default allow, explicit deny","Allow all but log it","Deny only known-bad"]', 'Default deny, explicit allow', 'Least privilege means deny everything, then explicitly allow only what is needed.'),
  (1, 1, 'In iptables/nftables, which matching rule takes effect?', '["The first match","The last match","The most specific match","The lowest priority number"]', 'The first match', 'Order matters in iptables/nftables — the first matching rule wins.'),
  (1, 2, 'Which statement about AWS security groups is correct?', '["They are stateful and allow-only","They are stateless and allow/deny","They evaluate last-match","They deny by priority number"]', 'They are stateful and allow-only', 'AWS security groups are stateful and allow-only; NACLs are the stateless allow/deny layer.'),
  (2, 0, 'What is the recommended minimum TLS version?', '["TLS 1.3 (1.2 only for legacy)","TLS 1.0","SSL 3.0","TLS 1.1"]', 'TLS 1.3 (1.2 only for legacy)', 'Require TLS 1.3, allowing TLS 1.2 only for legacy clients.'),
  (2, 1, 'Which header makes browsers refuse protocol downgrades?', '["HSTS","CORS","CSP","X-Frame-Options"]', 'HSTS', 'HTTP Strict Transport Security tells browsers to refuse plaintext/downgraded connections.'),
  (2, 2, 'What is the recommended maximum certificate lifetime with auto-renewal?', '["90 days or less","1 year","5 years","Unlimited"]', '90 days or less', 'Keep certificate lifetime at 90 days or less, auto-renewed via ACME.'),
  (3, 0, 'Which VPN technology is described as the modern default with per-peer public keys?', '["WireGuard","IPsec","OpenVPN","PPTP"]', 'WireGuard', 'WireGuard uses per-peer public keys, no usernames, and a fast handshake.'),
  (3, 1, 'What replaces client VPN with per-request authorization and no network membership?', '["ZTNA (identity-aware proxy)","IPsec site-to-site","NAT traversal","Split tunneling"]', 'ZTNA (identity-aware proxy)', 'Zero Trust Network Access authorizes each request via an identity-aware proxy.'),
  (3, 2, 'Where should VPN private keys be stored?', '["In an HSM or platform keychain","In source control","In a shared wiki","In a plaintext .env in the repo"]', 'In an HSM or platform keychain', 'Private keys belong in an HSM or platform keychain, never in source control.'),
  (4, 0, 'What is the difference between IDS and IPS?', '["IDS alerts (passive); IPS alerts and drops (inline)","IDS drops; IPS only alerts","Both only alert","Both only drop"]', 'IDS alerts (passive); IPS alerts and drops (inline)', 'An IDS is passive and alerts; an IPS sits inline and can also drop traffic.'),
  (4, 1, 'Which tool is behavioral rather than signature-based?', '["Zeek","Snort signatures","Suricata signatures","iptables"]', 'Zeek', 'Zeek (formerly Bro) is behavioral; Snort and Suricata are primarily signature engines.'),
  (4, 2, 'Which NIST publication codifies Zero Trust Architecture?', '["NIST 800-207","NIST 800-61","NIST 800-53","PCI DSS"]', 'NIST 800-207', 'NIST SP 800-207 defines Zero Trust Architecture.'),
  (5, 0, 'What should you do first when a host is confirmed compromised?', '["Contain (isolate the host)","Reboot it immediately","Delete the malware","Email the whole company"]', 'Contain (isolate the host)', 'Contain first to stop spread; debugging and eradication come after.'),
  (5, 1, 'Which NIST publication defines the incident-response cycle?', '["NIST 800-61","NIST 800-207","ISO 27001","SOC 2"]', 'NIST 800-61', 'NIST SP 800-61 defines preparation, detection, containment, eradication, recovery, and post-incident.'),
  (5, 2, 'What should you capture BEFORE rebooting a compromised host?', '["Memory and disk images","Nothing","Only the hostname","Only the firewall rules"]', 'Memory and disk images', 'Snapshot memory and disk before reboot — rebooting destroys volatile evidence.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'Network Security Foundations'
  and not exists (
    select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question
  );

-- =============================================================================
-- 2) APPLICATION SECURITY + SECURE CODING
-- =============================================================================
update public.training_courses set
  overview = 'Application Security + Secure Coding is the engineering counterpart to network security: build software that resists attack. You will internalize the OWASP Top 10 as remediation patterns, validate input and encode output correctly, get authentication and authorization right with libraries instead of guesswork, handle secrets and dependencies safely, threat-model with STRIDE, and wire SAST / DAST / SCA into CI. By the end you can review a feature for the common vulnerability classes and add the right automated guardrails.',
  target_audience = 'Software engineers and STEM-OPT trainees responsible for secure-by-default application code.',
  roadmap = '[
    {"phase":"The vulnerability landscape","duration_label":"Week 1","focus_areas":["OWASP Top 10","Input validation and output encoding"]},
    {"phase":"Identity + supply chain","duration_label":"Week 2","focus_areas":["Authentication and authorization","Secrets and dependency hygiene"]},
    {"phase":"Design + automation","duration_label":"Week 3","focus_areas":["Threat modeling with STRIDE","Shift-left SAST/DAST/SCA in CI"]}
  ]'::jsonb,
  resources = '[
    {"title":"OWASP Top 10 (2021)","url":"https://owasp.org/Top10/","type":"DOC"},
    {"title":"OWASP Cheat Sheet Series","url":"https://cheatsheetseries.owasp.org/","type":"DOC"},
    {"title":"OWASP ASVS (Application Security Verification Standard)","url":"https://owasp.org/www-project-application-security-verification-standard/","type":"DOC"},
    {"title":"Semgrep","url":"https://semgrep.dev/","type":"TOOL"},
    {"title":"OWASP ZAP","url":"https://www.zaproxy.org/","type":"TOOL"},
    {"title":"SLSA supply-chain framework","url":"https://slsa.dev/","type":"DOC"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Perform a secure-code review of a small feature (yours or a provided sample) and harden it: map findings to the OWASP Top 10, fix at least one issue per category present, and add CI scanning.",
    "questions":[
      {"prompt":"List each finding mapped to its OWASP Top 10 category, with the safe pattern.","guidance":"For each: what it looks like in code, the fix, and the tool that catches it."},
      {"prompt":"Add input validation + output encoding and parameterized queries to the feature.","guidance":"Validate at the boundary with an allow-list; encode at each sink."},
      {"prompt":"Wire a SAST and an SCA scan into CI with a sane gate policy.","guidance":"Block High/Critical, ticket Medium, report Low."}
    ],
    "rubric":[
      {"criterion":"Correct OWASP mapping","weight":25},
      {"criterion":"Validation + encoding fixes","weight":30},
      {"criterion":"Auth/secret handling","weight":20},
      {"criterion":"CI scanning + gate policy","weight":25}
    ]
  }'::jsonb,
  quiz_passing_score = 70,
  quiz_max_attempts = 3,
  content_status = 'READY',
  review_status = 'PUBLISHED'
where title = 'Application Security + Secure Coding';

update public.training_lessons tl set
  summary = v.summary,
  exercises = v.exercises::jsonb,
  key_takeaways = v.key_takeaways::jsonb,
  content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Use the OWASP Top 10 as a remediation taxonomy.',
     '[{"prompt":"Take three recent bugs (or sample findings) and classify each into an OWASP Top 10 category.","expected_outcome":"Each finding has a category plus the matching safe pattern.","hints":["IDOR is A01","SQLi is A03"]}]',
     '["The Top 10 are remediation patterns, not trivia","A01 Broken Access Control covers IDOR","A03 is Injection (SQLi, command injection)","A10 is SSRF"]'),
    (1, 'Validate input at the boundary, encode at the sink.',
     '[{"prompt":"Add allow-list input validation (e.g. with a schema) and context-aware output encoding to one endpoint.","expected_outcome":"Invalid input is rejected at the boundary; output is encoded for its destination context.","hints":["Validate type, length, range, format","Use parameterized queries for SQL"]}]',
     '["Allow-list, do not deny-list","Validate once at the boundary","Encode at the sink for the destination context","Parameterized queries stop SQLi"]'),
    (2, 'Get authentication and authorization right with libraries.',
     '[{"prompt":"Add both an isAuthenticated and an isAuthorizedForThisResource check to an endpoint via middleware.","expected_outcome":"Every endpoint enforces authn and per-resource authz, centrally.","hints":["Never decide authz in the controller body","Keep access tokens short-lived"]}]',
     '["Authn is who you are; authz is what you can do","Never write password hashing/JWT/OAuth yourself","Keep access tokens under 15 minutes","Every endpoint needs authn AND authz"]'),
    (3, 'Keep secrets out of code and dependencies patched.',
     '[{"prompt":"Move a hard-coded secret into a secrets manager and add an SCA scan to CI.","expected_outcome":"Code references the secret by name; CI fails on a HIGH/CRITICAL dependency CVE.","hints":["Pull secrets at boot, cache in memory","Pin a lockfile"]}]',
     '["Store secrets in a vault, never in source control","Reference secrets by name, not value","SCA scans dependencies for known CVEs","Generate an SBOM on every release"]'),
    (4, 'Threat-model with STRIDE before you build.',
     '[{"prompt":"Run a STRIDE pass on a small feature and produce a one-page threat table.","expected_outcome":"A DFD with trust boundaries plus a table of component, STRIDE category, threat, mitigation, owner.","hints":["Six categories: S T R I D E","Mark trust boundaries on the DFD"]}]',
     '["STRIDE: Spoofing, Tampering, Repudiation, Info disclosure, DoS, Elevation","Threat model before authz/payments/PII features","Deliverable is a one-page threat table","Keep the model in the repo next to the code"]'),
    (5, 'Shift security left with SAST, DAST, and SCA in CI.',
     '[{"prompt":"Add a SAST and an SCA step to a CI pipeline with a documented gate policy.","expected_outcome":"CI blocks on High/Critical, tickets Medium, reports Low, with suppression discipline.","hints":["SAST = static, DAST = dynamic, SCA = dependencies","Suppressions need a ticket + expiry"]}]',
     '["SAST analyzes source without running it","DAST fuzzes a running app","SCA finds CVEs in dependencies","Block High/Critical; do not block every PR"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'Application Security + Secure Coding' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l
join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'Which OWASP 2021 category covers IDOR and missing authorization checks?', '["A01 Broken Access Control","A03 Injection","A07 Authentication Failures","A05 Security Misconfiguration"]', 'A01 Broken Access Control', 'IDOR, missing checks, and privilege escalation are A01 Broken Access Control.'),
  (0, 1, 'SQL injection falls under which OWASP category?', '["A03 Injection","A02 Cryptographic Failures","A10 SSRF","A06 Vulnerable Components"]', 'A03 Injection', 'SQLi, command, LDAP, and OS injection are all A03 Injection.'),
  (0, 2, 'What does A10 (SSRF) describe?', '["The server fetches an attacker-controlled URL","Client-side script injection","Weak password storage","Outdated libraries"]', 'The server fetches an attacker-controlled URL', 'Server-Side Request Forgery makes the server fetch a URL the attacker controls.'),
  (1, 0, 'Which input-validation approach is recommended?', '["Allow-list","Deny-list","Sanitize at the source","Custom email regex"]', 'Allow-list', 'Validate against an allow-list of expected shapes; deny-lists and source sanitization fail.'),
  (1, 1, 'How should you prevent SQL injection at the sink?', '["Parameterized queries","String interpolation with escaping","Black-listing quotes","Input sanitization only"]', 'Parameterized queries', 'Parameterized queries keep data out of the SQL command; never interpolate strings.'),
  (1, 2, 'Where should output encoding happen?', '["At the sink, for the destination context","At the source","In the database only","Nowhere if input is validated"]', 'At the sink, for the destination context', 'Encode at the sink for the specific context (HTML, JS, URL, SQL, shell).'),
  (2, 0, 'What is the difference between authentication and authorization?', '["Authn is who you are; authz is what you can do","Authn is permissions; authz is identity","They are the same decision","Authz always happens first"]', 'Authn is who you are; authz is what you can do', 'Authentication establishes identity; authorization decides what that identity may do.'),
  (2, 1, 'What is the recommended maximum lifetime for a JWT access token?', '["Under 15 minutes","24 hours","30 days","It should never expire"]', 'Under 15 minutes', 'Keep access tokens short-lived (<15 min) because they are hard to revoke.'),
  (2, 2, 'Which password hashing algorithm is recommended?', '["Argon2id","MD5","SHA-1","Plain SHA-256"]', 'Argon2id', 'Argon2id is a modern memory-hard password hash; MD5/SHA-1/plain SHA-256 are unsuitable.'),
  (3, 0, 'Where should application secrets be stored?', '["A secrets manager or vault","In source control","Baked into the Docker image","In CI build logs"]', 'A secrets manager or vault', 'Use a managed secrets store; pull at boot and reference by name, never commit values.'),
  (3, 1, 'What does SCA (software composition analysis) check?', '["Dependencies for known CVEs","Source-code style","Running-app behavior","Network traffic"]', 'Dependencies for known CVEs', 'SCA scans your dependencies against known-vulnerability databases.'),
  (3, 2, 'What is an SBOM?', '["A software bill of materials","A backup of secrets","A build server","A scanning rule"]', 'A software bill of materials', 'An SBOM lists the components in a release (CycloneDX or SPDX).'),
  (4, 0, 'In STRIDE, what does the E stand for?', '["Elevation of privilege","Encryption","Exfiltration","Enumeration"]', 'Elevation of privilege', 'STRIDE: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege.'),
  (4, 1, 'Which STRIDE category covers modifying data in transit or at rest?', '["Tampering","Spoofing","Repudiation","Denial of service"]', 'Tampering', 'Tampering is unauthorized modification of data in transit or at rest.'),
  (4, 2, 'When should you threat-model?', '["Before features touching authz, payments, PII, or compliance","Only after an incident","Only at release","Never, if you have a SAST tool"]', 'Before features touching authz, payments, PII, or compliance', 'Threat-model at design time for sensitive features — a whiteboard bug is free to fix.'),
  (5, 0, 'Which scanner analyzes source code without running it?', '["SAST","DAST","SCA","WAF"]', 'SAST', 'SAST is static analysis of source code; DAST runs the app, SCA checks dependencies.'),
  (5, 1, 'Which scanner hits a running app and fuzzes inputs?', '["DAST","SAST","SCA","SBOM"]', 'DAST', 'DAST (dynamic analysis) exercises a running application.'),
  (5, 2, 'What is a sane CI gate policy for findings?', '["Block High/Critical, ticket Medium, report Low","Block every finding","Block nothing","Block only Low"]', 'Block High/Critical, ticket Medium, report Low', 'Block merges on High/Critical, ticket Medium, report Low — blocking everything makes teams disable scanners.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'Application Security + Secure Coding'
  and not exists (
    select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question
  );

-- =============================================================================
-- 3) CYBERSECURITY FUNDAMENTALS + SOC OPERATIONS
-- =============================================================================
update public.training_courses set
  overview = 'Cybersecurity Fundamentals + SOC Operations is the breadth course every security engineer needs. You will ground your decisions in the CIA triad and a realistic threat-actor model, speak MITRE ATT&CK fluently, understand the SIEM log pipeline, write detections that survive contact with attackers, run proactive threat hunts, secure identity at scale with SSO + MFA + least privilege, and read the major compliance frameworks well enough to produce evidence on demand.',
  target_audience = 'Aspiring SOC analysts, detection engineers, and STEM-OPT trainees entering blue-team roles.',
  roadmap = '[
    {"phase":"Principles + adversary","duration_label":"Week 1","focus_areas":["CIA triad and threat actors","MITRE ATT&CK and the Pyramid of Pain"]},
    {"phase":"Detect","duration_label":"Week 2","focus_areas":["SIEM and the log pipeline","Detection engineering","Threat hunting"]},
    {"phase":"Identity + compliance","duration_label":"Week 3","focus_areas":["IAM, MFA, least privilege","Compliance frameworks"]}
  ]'::jsonb,
  resources = '[
    {"title":"MITRE ATT&CK","url":"https://attack.mitre.org/","type":"TOOL"},
    {"title":"The Pyramid of Pain (David Bianco)","url":"https://detect-respond.blogspot.com/2013/03/the-pyramid-of-pain.html","type":"ARTICLE"},
    {"title":"Sigma detection rules","url":"https://github.com/SigmaHQ/sigma","type":"TOOL"},
    {"title":"NIST SP 800-61 Incident Handling","url":"https://csrc.nist.gov/pubs/sp/800/61/r2/final","type":"DOC"},
    {"title":"SOC 2 (AICPA Trust Services Criteria)","url":"https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2","type":"DOC"},
    {"title":"CIS Controls","url":"https://www.cisecurity.org/controls","type":"DOC"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Build a small detection-engineering deliverable: pick an ATT&CK technique, write a detection for it, and document the run-book and a hunt hypothesis.",
    "questions":[
      {"prompt":"Choose an ATT&CK technique and write a Sigma (or SIEM-native) detection for it.","guidance":"State the data source and why the detection is resilient to trivial bypass."},
      {"prompt":"Write the run-book the on-call analyst follows when this alert fires.","guidance":"Include what it means, 3-5 triage commands, escalation, and how to mark benign."},
      {"prompt":"Write one proactive hunt hypothesis and the query you would run.","guidance":"Restrict to a sane time window and classify the expected hits."}
    ],
    "rubric":[
      {"criterion":"ATT&CK mapping","weight":20},
      {"criterion":"Detection quality + resilience","weight":35},
      {"criterion":"Run-book completeness","weight":25},
      {"criterion":"Hunt hypothesis","weight":20}
    ]
  }'::jsonb,
  quiz_passing_score = 70,
  quiz_max_attempts = 3,
  content_status = 'READY',
  review_status = 'PUBLISHED'
where title = 'Cybersecurity Fundamentals + SOC Operations';

update public.training_lessons tl set
  summary = v.summary,
  exercises = v.exercises::jsonb,
  key_takeaways = v.key_takeaways::jsonb,
  content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Ground every control in CIA and a realistic threat model.',
     '[{"prompt":"For three systems (bank ledger, stock feed, medical records) name the CIA property that matters most and why.","expected_outcome":"Integrity, availability, and confidentiality respectively, each justified.","hints":["A bank cares about integrity first","Medical records care about confidentiality"]}]',
     '["CIA: Confidentiality, Integrity, Availability","Auditability is the fourth property","Tune controls to realistic threat actors","Security mindset: assume breach, least privilege"]'),
    (1, 'Speak MITRE ATT&CK and defend up the Pyramid of Pain.',
     '[{"prompt":"Map a known attack (e.g. ransomware) to two or three ATT&CK tactics and techniques.","expected_outcome":"Tactics with specific technique IDs (e.g. T1486 for ransomware impact).","hints":["Impact tactic includes Data Encrypted for Impact","Use the ATT&CK matrix"]}]',
     '["ATT&CK maps techniques to tactics","TTPs are hardest for attackers to change","Defend high on the Pyramid of Pain","Hash-based AV is the weakest rung"]'),
    (2, 'Understand the SIEM log pipeline and normalization.',
     '[{"prompt":"List the non-negotiable log sources a SIEM should ingest for a cloud SaaS shop.","expected_outcome":"Auth, authz changes, endpoint process execution, egress, cloud API calls, web/WAF, app audit events.","hints":["Normalize to a common schema (ECS/OCSF)","Hot retention >= 30 days"]}]',
     '["A SIEM is pipeline + query + detection engine","Normalize to a common schema or you cannot correlate","Hot retention 30 days minimum","Do not ingest by raw volume"]'),
    (3, 'Write detections that survive contact with attackers.',
     '[{"prompt":"Write a Sigma rule for one suspicious behavior and note its data source and a possible bypass.","expected_outcome":"A Sigma rule plus a sentence on resilience to trivial evasion.","hints":["A detection is a testable hypothesis","Link a run-book"]}]',
     '["A detection is a testable hypothesis","Good detections are correct, resilient, performant, maintained","Sigma is portable across SIEMs","Every detection needs a run-book"]'),
    (4, 'Hunt proactively and document every hunt.',
     '[{"prompt":"Write a hunt hypothesis and the query window you would use.","expected_outcome":"A specific hypothesis (e.g. service account interactive login) and a bounded query.","hints":["Mature SOCs spend ~20% on hunting","Every hunt produces a report"]}]',
     '["Hunting forms a hypothesis with no alert","Mature SOCs spend ~20% time hunting","Follow the hunt loop","Every hunt produces a hunt report"]'),
    (5, 'Make identity the perimeter with SSO, MFA, and least privilege.',
     '[{"prompt":"Design the access model for a mid-size company: SSO, MFA factors, and JIT elevation.","expected_outcome":"SSO for all apps, WebAuthn/hardware keys for admins, JIT time-boxed elevation.","hints":["SMS MFA is weakest","Require WebAuthn for admin accounts"]}]',
     '["Identity is the new perimeter","Hardware keys / WebAuthn are phishing-resistant","Least privilege with JIT elevation","SSO fixes offboarding and orphan accounts"]'),
    (6, 'Read the compliance frameworks well enough to produce evidence.',
     '[{"prompt":"List the evidence an auditor will ask for and where it lives in your systems.","expected_outcome":"Access reviews, change management, incident logs, vuln SLAs, vendor reviews, encryption, backups.","hints":["SOC 2 is the common B2B ask","Automate evidence pulls"]}]',
     '["SOC 2 is the default B2B SaaS ask","PCI DSS applies if you touch card data","HIPAA needs a BAA per PHI vendor","Wire evidence from real systems, not screenshots"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'Cybersecurity Fundamentals + SOC Operations' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l
join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'Per the lesson, which CIA property does a medical record care about MOST?', '["Confidentiality","Integrity","Availability","Auditability"]', 'Confidentiality', 'A medical record cares about confidentiality first.'),
  (0, 1, 'Per the lesson, which property does a bank care about first?', '["Integrity","Confidentiality","Availability","Anonymity"]', 'Integrity', 'A bank cares about integrity of the ledger first.'),
  (0, 2, 'Which is one of the four security-mindset habits?', '["Assume breach","Trust the network","Grant broad access by default","Skip input verification"]', 'Assume breach', 'The habits are assume breach, defense in depth, least privilege, and verify do not trust.'),
  (1, 0, 'What is MITRE ATT&CK?', '["A catalog of real-world attacker techniques mapped to tactics","A firewall product","A SIEM vendor","An encryption standard"]', 'A catalog of real-world attacker techniques mapped to tactics', 'ATT&CK is a public catalog of techniques organized by the tactics they serve.'),
  (1, 1, 'On the Pyramid of Pain, which is hardest for an attacker to change?', '["TTPs","Hash values","IP addresses","Domain names"]', 'TTPs', 'TTPs (the ATT&CK techniques) are hardest to change; hashes and IPs are trivial.'),
  (1, 2, 'Which of these is an ATT&CK tactic?', '["Lateral Movement","Parameterization","Tokenization","Normalization"]', 'Lateral Movement', 'Lateral Movement is one of the 14 ATT&CK tactics.'),
  (2, 0, 'What three components make up a SIEM?', '["Log pipeline, query interface, detection engine","Firewall, VPN, IDS","SAST, DAST, SCA","IAM, MFA, SSO"]', 'Log pipeline, query interface, detection engine', 'A SIEM stacks a log pipeline, a query interface, and a detection engine.'),
  (2, 1, 'Why normalize logs to a common schema?', '["So analysts can correlate across sources","Only to save disk space","To encrypt the logs","To reduce latency only"]', 'So analysts can correlate across sources', 'Without normalization, analysts cannot correlate and detections cannot generalize.'),
  (2, 2, 'What is the recommended minimum hot (queryable) retention?', '["30 days","1 day","7 years","1 hour"]', '30 days', 'Keep at least 30 days hot; warm 90 days; cold 1 year or more.'),
  (3, 0, 'A detection is best described as what?', '["A testable hypothesis","A firewall rule","A backup job","A compliance control"]', 'A testable hypothesis', 'A detection encodes the hypothesis: if I see X, an attacker is doing Y.'),
  (3, 1, 'What is Sigma?', '["A portable detection language (YAML that compiles to SPL/KQL/EQL)","A SIEM vendor","An IAM tool","A cloud provider"]', 'A portable detection language (YAML that compiles to SPL/KQL/EQL)', 'Sigma rules are YAML detections portable across SIEMs.'),
  (3, 2, 'What must every detection link to?', '["A run-book","A firewall","A VPN","An SBOM"]', 'A run-book', 'Each detection must link to a run-book so the on-call analyst knows how to triage it.'),
  (4, 0, 'What distinguishes threat hunting from responding?', '["Hunting forms a hypothesis and searches with no alert","Hunting only waits for alerts","They are identical","Responding is the proactive one"]', 'Hunting forms a hypothesis and searches with no alert', 'Hunting is proactive: form a hypothesis and query the data even with no alert.'),
  (4, 1, 'What does every hunt produce?', '["A hunt report","A new firewall rule","A patch","A backup"]', 'A hunt report', 'Every hunt produces a report so knowledge compounds.'),
  (4, 2, 'Roughly how much analyst time do mature SOCs spend hunting?', '["About 20%","0%","About 80%","100%"]', 'About 20%', 'Mature SOCs spend roughly 20% of analyst time on proactive hunting.'),
  (5, 0, 'Which MFA factor is phishing-resistant?', '["Hardware key / WebAuthn / Passkeys","SMS code","TOTP app","Push notification"]', 'Hardware key / WebAuthn / Passkeys', 'Hardware keys / WebAuthn / passkeys are phishing-resistant; SMS is the weakest.'),
  (5, 1, 'What is described as the new security perimeter?', '["Identity","The network firewall","The VPN concentrator","The data center"]', 'Identity', 'With cloud and remote work, identity is the new perimeter.'),
  (5, 2, 'What is JIT (just-in-time) elevation?', '["Time-bound privilege granted on demand with approval","Standing admin access","A backup method","A logging tier"]', 'Time-bound privilege granted on demand with approval', 'JIT elevation grants admin rights temporarily through an approval workflow.'),
  (6, 0, 'What is SOC 2?', '["An AICPA report attesting to trust criteria","An EU privacy law","A credit-card standard","A federal cloud program"]', 'An AICPA report attesting to trust criteria', 'SOC 2 is an AICPA report on the trust services criteria; the default B2B ask.'),
  (6, 1, 'Which framework applies if you handle credit-card data?', '["PCI DSS","HIPAA","GDPR","FedRAMP"]', 'PCI DSS', 'PCI DSS is required when you touch cardholder data.'),
  (6, 2, 'HIPAA requires what with every vendor that touches PHI?', '["A BAA (Business Associate Agreement)","A SOC 2 report","A DPIA","An SBOM"]', 'A BAA (Business Associate Agreement)', 'HIPAA requires a Business Associate Agreement with every vendor that handles PHI.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'Cybersecurity Fundamentals + SOC Operations'
  and not exists (
    select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question
  );

-- =============================================================================
-- 4) CLOUD SECURITY + COMPLIANCE
-- =============================================================================
update public.training_courses set
  overview = 'Cloud Security + Compliance covers defending cloud workloads end to end. You will learn exactly where the shared-responsibility line sits per service, run IAM at organization scale with federation and guardrails, manage posture against benchmarks, get encryption and key custody right, stand up cloud-native detection, and wire compliance evidence directly from real infrastructure so audits are a query, not a screenshot hunt. It pairs naturally with the AWS for Engineers course in this catalog.',
  target_audience = 'Cloud and platform engineers and STEM-OPT trainees securing AWS / Azure / GCP workloads.',
  roadmap = '[
    {"phase":"Ownership + identity","duration_label":"Week 1","focus_areas":["Shared-responsibility model","IAM at org scale"]},
    {"phase":"Posture + crypto","duration_label":"Week 2","focus_areas":["Posture management and guardrails","Encryption and KMS"]},
    {"phase":"Detect + prove","duration_label":"Week 3","focus_areas":["Cloud-native detection","Wiring compliance evidence"]}
  ]'::jsonb,
  resources = '[
    {"title":"AWS Well-Architected Security Pillar","url":"https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html","type":"DOC"},
    {"title":"CIS Benchmarks","url":"https://www.cisecurity.org/cis-benchmarks","type":"DOC"},
    {"title":"NIST SP 800-53","url":"https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final","type":"DOC"},
    {"title":"AWS KMS developer guide","url":"https://docs.aws.amazon.com/kms/latest/developerguide/overview.html","type":"DOC"},
    {"title":"Microsoft Cloud Security Benchmark","url":"https://learn.microsoft.com/en-us/security/benchmark/azure/","type":"DOC"},
    {"title":"SOC 2 Trust Services Criteria","url":"https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2","type":"DOC"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Produce a cloud-security baseline for a single account/subscription: an IAM + guardrail design, a posture/benchmark gap list, an encryption/KMS plan, and the logging + evidence wiring for SOC 2.",
    "questions":[
      {"prompt":"Design org-scale IAM: federation, no long-lived keys, and the guardrails (SCP/Org Policy) you would enforce.","guidance":"State which actions are blocked org-wide and how humans/workloads/CI authenticate."},
      {"prompt":"List the top posture gaps against a CIS benchmark and the encryption/KMS key-custody model you would choose.","guidance":"Justify customer-managed keys vs provider-managed for the workload."},
      {"prompt":"Describe the logging + evidence wiring that answers SOC 2 questions from real systems.","guidance":"Centralize logs to a write-only account; map evidence to controls."}
    ],
    "rubric":[
      {"criterion":"IAM + guardrails","weight":30},
      {"criterion":"Posture + benchmark coverage","weight":20},
      {"criterion":"Encryption / key custody","weight":20},
      {"criterion":"Detection + evidence wiring","weight":30}
    ]
  }'::jsonb,
  quiz_passing_score = 70,
  quiz_max_attempts = 3,
  content_status = 'READY',
  review_status = 'PUBLISHED'
where title = 'Cloud Security + Compliance';

update public.training_lessons tl set
  summary = v.summary,
  exercises = v.exercises::jsonb,
  key_takeaways = v.key_takeaways::jsonb,
  content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Know exactly where the shared-responsibility line sits per service.',
     '[{"prompt":"For IaaS, PaaS, and SaaS, list what you own versus what the provider owns.","expected_outcome":"IaaS: OS and up; PaaS: code/config/identity; SaaS: config/identity/data.","hints":["You always own IAM and data classification","S3 bucket policy is yours"]}]',
     '["You always own IAM, data classification, and logging","The line shifts per service type","Key custody is yours even with default encryption","The classic S3 leak was a customer bucket-policy issue"]'),
    (1, 'Run IAM at organization scale with federation and guardrails.',
     '[{"prompt":"Design how humans, workloads, and CI authenticate to the cloud without long-lived keys.","expected_outcome":"SSO for humans, instance/workload identity for workloads, OIDC federation for CI.","hints":["Every policy layer must allow","Turn off long-lived access keys"]}]',
     '["Every policy layer must allow for an action to succeed","Federate; never use long-lived access keys","CI should use OIDC federation","SCPs/Org Policies are the org-wide guardrails"]'),
    (2, 'Manage posture against a benchmark and enforce guardrails.',
     '[{"prompt":"Pick a primary benchmark and list three guardrails you would enforce org-wide.","expected_outcome":"A chosen benchmark (e.g. CIS) plus preventive guardrails like no disabling CloudTrail.","hints":["Guardrails prevent; posture detects","Tag every resource"]}]',
     '["CSPM continuously checks config against a benchmark","CIS Benchmarks are the community standard","Guardrails prevent; posture detects what got through","Catch drift early with tagging + alerts"]'),
    (3, 'Get encryption and key custody right.',
     '[{"prompt":"Choose a key-custody model for a regulated workload and explain envelope encryption.","expected_outcome":"Customer-managed KMS keys, with a DEK encrypting the object and the CMK encrypting the DEK.","hints":["Separate key-use from key-admin roles","Key deletion is permanent"]}]',
     '["Customer-managed KMS keys are the regulated sweet spot","Envelope encryption: DEK encrypts data, CMK encrypts the DEK","Separate key-use from key-admin roles","Key deletion is permanent (with a waiting window)"]'),
    (4, 'Stand up cloud-native detection across accounts.',
     '[{"prompt":"List the big-three log sources for your cloud and the must-have detections.","expected_outcome":"API/audit log, network flow logs, managed detection; alerts on root login, new IAM users, disabled logging.","hints":["Centralize to a write-only account","Turn it on across all accounts day one"]}]',
     '["CloudTrail/Audit Log records API calls","Centralize logs to a write-only, retention-locked account","Managed detection (GuardDuty/Defender/SCC) gives a baseline","Alert on root login and disabled logging"]'),
    (5, 'Wire compliance evidence directly from real systems.',
     '[{"prompt":"Describe the auditable change-management chain from PR to deploy.","expected_outcome":"Every prod change is a PR with a non-author approver, a linked ticket, passing CI, and a tracked deploy.","hints":["No screenshots — wire from real systems","Trust platforms map evidence to controls"]}]',
     '["Wire evidence from real systems, not screenshots","Change management: PR + non-author approver + ticket + CI","Trust platforms map evidence to SOC 2/ISO/HIPAA","If you cannot query the answer, it is a security gap"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'Cloud Security + Compliance' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l
join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'Under the shared-responsibility model, what do you ALWAYS own?', '["IAM, data classification, and logging","The hypervisor","Physical security","The managed service internals"]', 'IAM, data classification, and logging', 'The customer always owns identity, data classification, and turning on/shipping logs.'),
  (0, 1, 'For a SaaS service like S3, what do you own?', '["Configuration, identity, and data","The operating system","The hypervisor","Physical data-center security"]', 'Configuration, identity, and data', 'For SaaS you own only configuration, identity, and data — including the bucket policy.'),
  (0, 2, 'The classic S3 data-exposure problem came from misunderstanding what?', '["That the bucket policy is the customer responsibility","Disk encryption","Provider patching","Edge DDoS protection"]', 'That the bucket policy is the customer responsibility', 'Treating S3 as fully provider-managed ignores that the bucket policy is yours.'),
  (1, 0, 'For an action to be allowed across cloud policy layers, how many layers must allow it?', '["Every layer","Any one layer","Only the identity policy","Only the SCP"]', 'Every layer', 'An action is allowed only if SCP, identity, resource, permission boundary, and session policy all allow it.'),
  (1, 1, 'How should CI authenticate to the cloud?', '["OIDC federation","Long-lived access keys","A shared password","Root credentials"]', 'OIDC federation', 'CI should use OIDC federation rather than long-lived static keys.'),
  (1, 2, 'What does an SCP / Org Policy provide?', '["Org-wide guardrails that bound any allow","A single user permission set","Encryption keys","Network routing"]', 'Org-wide guardrails that bound any allow', 'SCPs/Org Policies set org-wide rails, e.g. no one can disable CloudTrail.'),
  (2, 0, 'What is CSPM?', '["Continuous evaluation of cloud config against a benchmark","A VPN service","A SIEM","An identity provider"]', 'Continuous evaluation of cloud config against a benchmark', 'Cloud Security Posture Management continuously checks configuration against a benchmark.'),
  (2, 1, 'Which is a common cloud configuration benchmark?', '["CIS Benchmarks","OWASP Top 10","NIST 800-61","STRIDE"]', 'CIS Benchmarks', 'CIS Benchmarks are the community standard for cloud configuration.'),
  (2, 2, 'What is the difference between guardrails and posture management?', '["Guardrails prevent (block bad); posture detects what got through","They are identical","Posture prevents; guardrails detect","Both only alert"]', 'Guardrails prevent (block bad); posture detects what got through', 'Guardrails are preventive; posture management detects misconfig that slipped past.'),
  (3, 0, 'For most regulated workloads, which key-custody model is the sweet spot?', '["Customer-managed keys (KMS)","Provider-managed keys","No encryption","Customer-supplied HSM only"]', 'Customer-managed keys (KMS)', 'Customer-managed KMS keys balance control (disable/rotate/audit) and operational cost.'),
  (3, 1, 'What is envelope encryption?', '["A data key encrypts the object; the master key encrypts the data key","Double TLS","Hashing the key","Disabling encryption for speed"]', 'A data key encrypts the object; the master key encrypts the data key', 'A DEK encrypts the object; the CMK encrypts the DEK and is stored alongside it.'),
  (3, 2, 'In KMS key policies, what should be separated?', '["The role that uses the key from the role that administers it","Only prod and dev keys","Encryption and TLS","Nothing needs separating"]', 'The role that uses the key from the role that administers it', 'Separate key-use from key-administration roles for least privilege.'),
  (4, 0, 'Which AWS service records API calls for the audit trail?', '["CloudTrail","VPC Flow Logs","GuardDuty","Macie"]', 'CloudTrail', 'CloudTrail records API/control-plane calls; Flow Logs are network, GuardDuty is detection.'),
  (4, 1, 'Why centralize logs to a write-only, retention-locked account?', '["So an attacker cannot disable logs in one account undetected","To save cost only","To speed up queries only","To avoid encryption"]', 'So an attacker cannot disable logs in one account undetected', 'Centralized, tamper-evident logging prevents an attacker from quietly disabling logs.'),
  (4, 2, 'Which is a detection you must have?', '["Root / Global Admin login","Successful health checks","Normal user logins","Cache hits"]', 'Root / Global Admin login', 'Root/Global Admin logins should be near-zero in normal ops and must alert.'),
  (5, 0, 'What is the cheapest way to answer audit questions?', '["Wire evidence directly from real systems","Take manual screenshots","Keep email threads","Maintain spreadsheets"]', 'Wire evidence directly from real systems', 'Wiring evidence from real systems beats manual screenshots that rot.'),
  (5, 1, 'What change-management chain will an auditor accept?', '["Every prod change is a PR with a non-author approver, linked ticket, and passing CI","Direct pushes to main","Verbal approval","Screenshots of diffs"]', 'Every prod change is a PR with a non-author approver, linked ticket, and passing CI', 'This chain is auditable straight from the repo and CI with no screenshots.'),
  (5, 2, 'The golden rule: if you cannot answer an audit question from a query against real systems, it is what?', '["A security gap","An audit gap","Acceptable","A false positive"]', 'A security gap', 'An unanswerable audit question reflects a real security gap, not paperwork.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'Cloud Security + Compliance'
  and not exists (
    select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question
  );

NOTIFY pgrst, 'reload schema';
