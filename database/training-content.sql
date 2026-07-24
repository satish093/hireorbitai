-- HireOrbit AI — populate course descriptions + lesson content for the
-- training catalog. Pairs with database/training.sql.
--
-- This migration:
--   1) Enriches the 5 seeded courses with detailed descriptions + study plans.
--   2) Inserts a curated lesson set per course (only when the course currently
--      has zero lessons, so re-running is safe).
--   3) Adds a new "OPT / STEM-OPT Compliance Playbook" course built specifically
--      for consultants navigating their post-graduate work authorization.
--
-- Idempotent. Safe to re-run.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1) ENRICH EXISTING COURSE DESCRIPTIONS WITH AN EMBEDDED STUDY PLAN
-- ===========================================================================

update public.training_courses set description = $$
A production-grade Spring Boot starter for engineers ready to ship real REST services.

STUDY PLAN (estimated 6 hours):
- Week 1 (2h): Spring Boot mental model + REST controllers
- Week 2 (2h): Validation, exception handling, JPA basics
- Week 3 (1h): Security with Spring Security + JWT
- Week 4 (1h): Testing, profiles, Docker deploy

WHAT YOU'LL BUILD: a 4-endpoint Job API with auth, validation, persistence, and an integration test suite — the same shape as the HireOrbit AI backend.
$$, updated_at = now()
where title = 'Spring Boot Foundations';

update public.training_courses set description = $$
React + TypeScript fundamentals tightened for consultants joining mid-stream on existing codebases.

STUDY PLAN (estimated 5 hours):
- Module 1 (1h): Components, props, state with strict TypeScript
- Module 2 (1h): Hooks deep-dive (useState/useEffect/useMemo/useCallback)
- Module 3 (1h): Context, custom hooks, useReducer
- Module 4 (1h): Routing + forms (react-hook-form + Zod)
- Module 5 (1h): Data fetching + Testing Library

WHAT YOU'LL BUILD: a 3-page React app that mirrors the HireOrbit AI frontend — login, list view, detail page.
$$, updated_at = now()
where title = 'React + TypeScript Crash Course';

update public.training_courses set description = $$
The minimum AWS surface every engineer should be able to whiteboard on demand.

STUDY PLAN (estimated 8 hours):
- Day 1 (1.5h): IAM — users, roles, policies, the principle of least privilege
- Day 2 (1.5h): EC2 + Auto Scaling Groups + Load Balancers
- Day 3 (1h): S3 — bucket policies, lifecycle, presigned URLs
- Day 4 (1h): Lambda + API Gateway
- Day 5 (1h): RDS vs DynamoDB — pick the right one
- Day 6 (1h): CloudWatch + alarms
- Day 7 (1h): VPC + Security Groups + CDK basics

WHAT YOU'LL BUILD: a Lambda-backed REST API behind API Gateway, deployed via CDK, with logs/metrics/alarms wired in CloudWatch.
$$, updated_at = now()
where title = 'AWS for Engineers';

update public.training_courses set description = $$
Mid + senior system design interviews for engineers who can code but freeze at the whiteboard.

STUDY PLAN (estimated 10 hours):
- Phase 1 (2h): The 30-minute interview structure — FRAME (Functional, Requirements, API, Math, Edges)
- Phase 2 (2h): Capacity estimation + back-of-envelope math
- Phase 3 (2h): Data modeling — pick the storage that fits the access pattern
- Phase 4 (2h): Scale levers — caching, sharding, replication, queues
- Phase 5 (2h): Three full walkthroughs — Twitter feed, Uber, WhatsApp

WHAT YOU'LL BUILD: three written design docs + a recorded mock you can replay before a real interview.
$$, updated_at = now()
where title = 'Interview Prep: System Design';

update public.training_courses set description = $$
Day-one playbook for consultants: how to write status updates, run kickoff calls, and raise risks without burning trust.

STUDY PLAN (estimated 3 hours):
- Module 1 (45m): The weekly status update template
- Module 2 (45m): Client kickoff call — agenda + first impressions
- Module 3 (30m): Async writing — be skimmable
- Module 4 (30m): Difficult conversations — raise risks early
- Module 5 (30m): Manager / mentor 1:1 prep

OUTCOME: a personal communication kit (Notion or Google Doc) you reuse on every engagement.
$$, updated_at = now()
where title = 'Communication Skills for Consultants';

-- ===========================================================================
-- 2) ADD LESSONS — only when the course has none yet (idempotent).
-- ===========================================================================

-- ---------- Spring Boot Foundations ----------
insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, t.title, t.description, t.content, t.lesson_order, t.estimated_minutes
  from public.training_courses c
  join (values
    (0, 25, 'Why Spring Boot? Auto-config + starters',
     'The mental model behind Spring Boot and why "starters" make REST APIs 1-day projects.',
     'OBJECTIVE
Understand Spring Boot''s auto-configuration model and the role of starter dependencies.

KEY CONCEPTS
- @SpringBootApplication = @Configuration + @EnableAutoConfiguration + @ComponentScan
- "Starters" (spring-boot-starter-web, -data-jpa, -security) bring a curated set of dependencies + sensible defaults
- application.yml drives configuration via @ConfigurationProperties
- Externalized config: command line > env var > application.yml > application.properties

HANDS-ON
1. Run `spring init --dependencies=web,data-jpa,security demo` (or use start.spring.io).
2. Open the generated pom.xml — note that you didn''t pin a single version.
3. Run `./mvnw spring-boot:run`. You now have a Tomcat-backed server on :8080.
4. Add `server.port=9090` to application.yml and restart — note how config flows.

CHECKPOINT
Can you explain in 60 seconds what auto-configuration is doing under the hood? If not, re-read the Spring Boot reference doc section on conditional beans.'),
    (1, 30, 'REST controllers + DTO patterns',
     'Mapping HTTP to clean handler methods. Request bodies, path variables, response shaping.',
     'OBJECTIVE
Build a CRUD controller. Understand when to introduce DTOs vs returning entities.

REST CONTRACT
- GET    /jobs       → 200 OK + JSON array
- GET    /jobs/{id}  → 200 OK + JSON object (404 if missing)
- POST   /jobs       → 201 Created + Location header
- PATCH  /jobs/{id}  → 200 OK with the updated row
- DELETE /jobs/{id}  → 204 No Content

CODE SKETCH
@RestController
@RequestMapping("/jobs")
class JobController {
  @GetMapping public List<JobDto> list() { ... }
  @PostMapping public ResponseEntity<JobDto> create(@RequestBody @Valid CreateJobRequest req) { ... }
}

DTOs ARE WORTH IT WHEN
- The entity has fields you must never expose (passwords, internal flags)
- The API contract evolves on a different cadence than the schema
- You need to combine multiple entities in one response

CHECKPOINT
Write a JobDto with only id/title/company/postedAt. Write CreateJobRequest with bean validation annotations (@NotBlank, @Size). Run a Postman call and confirm a missing title returns 400 with a clean error body.'),
    (2, 25, 'Validation + global exception handling',
     'Use @Valid + a @ControllerAdvice to return clean 4xx/5xx error envelopes.',
     'OBJECTIVE
Stop your API leaking stack traces. Return a structured error envelope on every failure.

ERROR ENVELOPE
{ "error": "Validation failed", "details": { "title": ["must not be blank"] }, "trace_id": "abc-123" }

GLOBAL HANDLER
@RestControllerAdvice
class ApiExceptionHandler {
  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException e) { ... }
  @ExceptionHandler(EntityNotFoundException.class)
  ResponseEntity<ApiError> handleNotFound() { ... }
  @ExceptionHandler(Exception.class)
  ResponseEntity<ApiError> handleAnything(Exception e) { /* 500, log full stack */ }
}

CHECKPOINT
Trigger each handler from Postman — bad payload (400), missing id (404), divide by zero (500). Confirm the response shape is identical across all three.'),
    (3, 35, 'Spring Data JPA — Repository pattern',
     'Mapping JPA entities, derived query methods, JPQL, and when to break out to native SQL.',
     'OBJECTIVE
Persist + query entities without writing JDBC.

REPOSITORY
public interface JobRepository extends JpaRepository<Job, UUID> {
  List<Job> findByCompanyAndPostedAtAfter(String company, Instant since);
  @Query("select j from Job j where j.title like %:q% or j.description like %:q%")
  List<Job> search(@Param("q") String q);
}

NAMING RULES
- findBy<Field>            equals
- findBy<Field>Containing  like %...%
- findBy<Field>In(List<>)  in (...)
- orderBy<Field>Desc       order by ... desc

LAZY VS EAGER
Default is LAZY on @OneToMany / @ManyToOne. If you hit LazyInitializationException, either:
- Annotate the query with @EntityGraph
- Or use a JOIN FETCH in JPQL
- Or change to fetch = FetchType.EAGER (usually wrong — read JOIN FETCH instead)

CHECKPOINT
Build a Job + Application entity. Write a repository method that returns "all jobs with at least one application." Confirm the generated SQL via spring.jpa.show-sql=true.'),
    (4, 40, 'Spring Security + JWT',
     'Stateless auth with JSON Web Tokens.',
     'OBJECTIVE
Add JWT-based auth to a Spring Boot service.

FLOW
1. Client POSTs /auth/login with {email, password}
2. Server validates against the users table, signs a JWT
3. Client sends Authorization: Bearer <jwt> on every subsequent request
4. A filter extracts/verifies the token and populates SecurityContext

KEY BEANS
- SecurityFilterChain (replaces deprecated WebSecurityConfigurerAdapter)
- JwtAuthenticationFilter (extends OncePerRequestFilter)
- PasswordEncoder bean (BCryptPasswordEncoder)

@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
  return http
    .csrf().disable()
    .sessionManagement(s -> s.sessionCreationPolicy(STATELESS))
    .authorizeHttpRequests(a -> a
      .requestMatchers("/auth/**").permitAll()
      .anyRequest().authenticated())
    .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
    .build();
}

CHECKPOINT
Confirm that a request without a token returns 401 and a request with a forged token returns 401 — not 500.'),
    (5, 30, 'Testing + Docker deploy',
     '@SpringBootTest, Testcontainers, then a Docker build.',
     'TESTS
- @WebMvcTest for slice tests on controllers
- @DataJpaTest for repository tests (rolls back per test)
- @SpringBootTest + Testcontainers for full-stack tests against a real Postgres in Docker

DOCKERFILE
FROM eclipse-temurin:21-jre
COPY target/app.jar /app.jar
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app.jar"]

HEALTH CHECK
Add the actuator starter, expose /actuator/health, and point your container orchestrator at it.

CHECKPOINT
`docker build -t demo .` → `docker run -p 8080:8080 demo` → curl localhost:8080/actuator/health returns {"status":"UP"}.')
  ) as t(lesson_order, estimated_minutes, title, description, content) on true
 where c.title = 'Spring Boot Foundations'
   and not exists (select 1 from public.training_lessons l where l.course_id = c.id);

-- ---------- React + TypeScript Crash Course ----------
insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, t.title, t.description, t.content, t.lesson_order, t.estimated_minutes
  from public.training_courses c
  join (values
    (0, 25, 'Components, props, state — typed',
     'Function components with strictly-typed props and state hooks.',
     'TYPING PROPS
type Props = { title: string; onConfirm: (id: string) => void; children?: React.ReactNode };
function ConfirmCard({ title, onConfirm, children }: Props) { ... }

TYPING STATE
const [count, setCount] = useState<number>(0);
const [user, setUser] = useState<User | null>(null);

KEYS THAT TRIP PEOPLE
- Always provide a stable `key` when mapping arrays
- React.FC is mostly unnecessary in 2024+ — typed props are cleaner
- Avoid `any` — when you''re stuck, use `unknown` and narrow

CHECKPOINT
Build a Counter component with typed +/− buttons and a typed reset. No `any`.'),
    (1, 30, 'Hooks deep-dive',
     'useState, useEffect, useMemo, useCallback. When each one earns its keep.',
     'useEffect MENTAL MODEL
"Synchronize the DOM/external system with React state." Not "run after render."

DEPS ARRAY
- []                       → run once on mount
- [a, b]                   → run when a or b changes
- (no deps array)          → run after every render (almost always a bug)

USEMEMO + USECALLBACK ARE PROFILING TOOLS
Only reach for them after a profiler trace shows wasted re-renders.

CHECKPOINT
Build a TodoList. Add a derived "remaining" count. First do it with a plain const, then with useMemo — note when React DevTools shows the difference (it usually doesn''t for small lists).'),
    (2, 25, 'Context + custom hooks',
     'Sharing state without prop-drilling.',
     'CONTEXT
const AuthContext = createContext<AuthCtx | null>(null);
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

WHEN TO REACH FOR CONTEXT
- Auth, theme, feature flags, current user — read everywhere, write rarely
- Avoid putting fast-changing values (typing input, mouse position) in context

CUSTOM HOOK PATTERN
function useDebounced<T>(value: T, delay: number): T { ... }

CHECKPOINT
Write useLocalStorage<T>(key, fallback) — read on mount, write on change, sync across tabs.'),
    (3, 30, 'Routing + forms',
     'React Router v6 + react-hook-form + Zod for solid client-side forms.',
     'ROUTER
<Routes>
  <Route path="/" element={<Home />} />
  <Route path="/jobs/:id" element={<JobDetail />} />
</Routes>

FORMS
const schema = z.object({ title: z.string().min(1), salary: z.number().positive() });
const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(schema) });

CHECKPOINT
Build a job-application form: validation messages render inline, submit disables while in-flight, success navigates to the detail page.'),
    (4, 30, 'Data fetching + testing',
     'Fetch with React Query (or plain fetch) and write trustworthy tests.',
     'REACT QUERY
const { data, isLoading, error } = useQuery({ queryKey: ["jobs"], queryFn: () => api.get("/jobs") });

CACHING WINS
- Automatic deduping
- Stale-while-revalidate
- Easy refetch on window focus
- queryClient.invalidateQueries on mutation

TESTING (Vitest + RTL)
test("shows error on failed submit", async () => {
  render(<JobForm />);
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
});

CHECKPOINT
Cover one happy path and one validation-error path with React Testing Library. No snapshot tests.')
  ) as t(lesson_order, estimated_minutes, title, description, content) on true
 where c.title = 'React + TypeScript Crash Course'
   and not exists (select 1 from public.training_lessons l where l.course_id = c.id);

-- ---------- AWS for Engineers ----------
insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, t.title, t.description, t.content, t.lesson_order, t.estimated_minutes
  from public.training_courses c
  join (values
    (0, 30, 'IAM — the principle of least privilege',
     'Users, groups, roles, policies, and the AWS-managed vs customer-managed distinction.',
     'CORE OBJECTS
- User: a human or app with credentials (long-lived; avoid for code)
- Role: a temporary identity assumed by a service or another account
- Policy: a JSON document granting/denying actions on resources

GOLDEN RULES
- Never embed AWS keys in code or env files. Use IAM Roles + instance profiles.
- Start with "Deny" via no policy. Add specific Allows.
- Use IAM Access Analyzer monthly.

POLICY ANATOMY
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject"],
    "Resource": "arn:aws:s3:::my-bucket/uploads/*"
  }]
}

CHECKPOINT
Write a role that lets a Lambda read/write one specific S3 prefix and nothing else. Validate via Access Analyzer.'),
    (1, 30, 'EC2 + Auto Scaling + Load Balancers',
     'When EC2 is still the right answer + the modern ASG pattern.',
     'EC2 STILL WINS WHEN
- You need a long-running stateful process
- You''re lift-and-shifting an existing VM
- You need GPU/local SSD

ASG PATTERN
Launch Template → Auto Scaling Group → Target Tracking on CPU 50%
ALB sits in front, health-checks /health, routes to the ASG

HEALTH CHECK GOTCHA
Make /health cheap and isolated. Hitting DB on every check melts the DB during incident-recovery.

CHECKPOINT
Provision a 2-node ASG behind an ALB via CDK. Push code, watch the new instances drain old ones.'),
    (2, 25, 'S3 deep dive',
     'Bucket policies, lifecycle, presigned URLs, eventing.',
     'COMMON MISTAKE
"My bucket is private" but the object ACL is public-read. Use Block Public Access at the account level.

PRESIGNED URLS
- Upload directly from browser → S3 without the bytes touching your server
- Time-limit them (60s for upload, 5min for download)
- Set Content-Type + x-amz-meta-* on generation

LIFECYCLE
Move uploads/* to STANDARD_IA after 30 days, GLACIER after 90, delete after 1 year.

CHECKPOINT
Generate a presigned PUT URL in Lambda. Have curl upload a file. Confirm via S3 console.'),
    (3, 30, 'Lambda + API Gateway',
     'When serverless fits + the cold-start mitigation playbook.',
     'COLD STARTS
- Provisioned Concurrency keeps N warm instances
- Smaller package = faster cold start (favor esbuild over webpack)
- Outside the handler: only put SDK clients, not DB connections

RIGHT-SIZE MEMORY
More memory = more vCPU (linear). For CPU-bound tasks, 1769 MB often costs the same total dollars as 256 MB but finishes 7x faster.

API GATEWAY
HTTP API (v2) > REST API (v1) — cheaper, faster, JWT-native unless you specifically need WAF or custom domains v1-only features.

CHECKPOINT
Deploy a Lambda behind HTTP API. Time the first request, then the 10th. Mitigate the gap with provisioned concurrency.'),
    (4, 25, 'RDS vs DynamoDB',
     'Pick the right storage. Stop the "DynamoDB everywhere" cargo cult.',
     'PICK RDS WHEN
- You need joins
- You need transactions across multiple rows
- Your team knows SQL and team velocity matters more than scale

PICK DYNAMODB WHEN
- Access pattern is single-item by primary key
- Throughput is unpredictable / spiky
- You need single-digit ms reads at any scale

THE TRAP
DynamoDB punishes you for scanning. If you find yourself doing FilterExpression often, you picked the wrong table design.

CHECKPOINT
Sketch the data model for the HireOrbit AI "applications" table in both. Which one matches the access pattern in the existing codebase?'),
    (5, 20, 'CloudWatch — logs + metrics + alarms',
     'Observability without rolling Prometheus.',
     'LOGS
- Lambda/EC2 auto-publish to /aws/lambda/<name>
- Use structured JSON logs and CloudWatch Logs Insights
- fields @timestamp, level, msg, traceId | filter level = "ERROR" | sort @timestamp desc

METRICS
- AWS auto-publishes: CPU, error rate, p99 latency
- Embedded Metric Format lets your app emit custom metrics in log lines

ALARMS
- "errors > 1% over 5 minutes" → SNS → PagerDuty
- "p95 latency > 500ms for 10 min" → SNS → Slack

CHECKPOINT
Wire an alarm on Lambda Errors. Trigger it by deploying a broken build. Receive the alert, fix, watch it close.')
  ) as t(lesson_order, estimated_minutes, title, description, content) on true
 where c.title = 'AWS for Engineers'
   and not exists (select 1 from public.training_lessons l where l.course_id = c.id);

-- ---------- Interview Prep: System Design ----------
insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, t.title, t.description, t.content, t.lesson_order, t.estimated_minutes
  from public.training_courses c
  join (values
    (0, 20, 'The 30-minute interview — FRAME',
     'How to spend each minute of a system design interview.',
     'TIME BUDGET (30 min)
- 0–5 min   Functional requirements + constraints
- 5–10 min  API surface + simple capacity math
- 10–18 min High-level diagram + data model
- 18–25 min Deep dive on 1–2 components (whichever the interviewer probes)
- 25–30 min Trade-offs + what you''d improve with more time

FRAME CHECKLIST
F — Functional requirements (3–5 user stories)
R — Resource estimates (QPS, storage, bandwidth)
A — API contract (3–6 endpoints)
M — Model the data (1–3 tables, key access patterns)
E — Edge cases + scaling

CHECKPOINT
Time yourself answering "design a URL shortener" using this exact structure. Did you hit 25 minutes naturally?'),
    (1, 30, 'Estimations + capacity planning',
     'The math the interviewer is silently checking.',
     'SHORTCUTS TO MEMORIZE
- 1 KB request × 1k QPS = 1 MB/s = ~86 GB/day
- 1 ms latency = ~one disk seek or one cross-DC network hop
- 1 modern server = ~10k QPS for simple endpoints, ~1k for DB-heavy
- 1 TB SSD ≈ $100/month on AWS, 1 TB RAM ≈ $5k/month

CASE STUDY
"100M DAU writing 2 tweets/day, each 280 chars + metadata = ~500 bytes."
→ 200M writes/day = ~2.3k QPS sustained, ~10k QPS peak
→ Storage: 100 GB/day raw, 36 TB/year (before indexes/replicas — multiply by 3)

CHECKPOINT
Estimate the storage and write throughput for an Instagram-style photo service. Defend your numbers.'),
    (2, 30, 'Data modeling decisions',
     'SQL vs NoSQL is the wrong question. Access pattern is the question.',
     'PROCESS
1. Write the 3–5 queries your app will run
2. Pick a primary key that makes the hottest query an O(1) read
3. Add indexes only for the next-hottest queries
4. If you''re scanning, your model is wrong

EXAMPLE — "design a Twitter feed"
- Fan-out on write: write the tweet to followers'' timelines at post time (high write cost, cheap read)
- Fan-out on read: read at scroll time (cheap write, slow read for whales)
- Hybrid: fan-out on write for normal users, fan-out on read for celebrities (>1M followers)

CHECKPOINT
Pick fan-out strategy for a chat app where the median user has 10 friends and the 99th percentile has 1k. Defend.'),
    (3, 30, 'Scale levers — cache + shard + queue',
     'Three techniques you''ll use in 95% of designs.',
     'CACHING
- Look-aside (cache-aside) is the default
- Write-through when stale reads are unacceptable
- TTL > 0 even for "permanent" data — caches lie

SHARDING
- Range sharding: easy ordered queries, hot spots a risk
- Hash sharding: balanced load, range queries become scatter-gather
- Consistent hashing: rebalance cost when adding nodes is O(K/N) instead of O(K)

QUEUES
- Use a queue any time you cross a system boundary that can be slow or unreliable
- Kafka if you need replay or fan-out, SQS if you need simplicity
- Don''t make API responses depend on queue processing — return 202 Accepted

CHECKPOINT
Re-design Instagram''s photo upload to use a queue. Where exactly does it sit? What happens on processing failure?'),
    (4, 40, 'Walk-through: design Twitter / Uber / WhatsApp',
     'Three full sample answers, one per interview style.',
     'You read these. You don''t memorize them. The point is to see the rhythm.

DESIGN TWITTER
- Functional: post tweet, follow user, read timeline
- API: POST /tweets, POST /follow/{id}, GET /timeline
- Data model: tweets table (PK = tweet_id), follows table, materialized timeline cache per user
- Trade-off: fan-out on write costs more storage but lets timeline reads be O(1) Redis hits

DESIGN UBER
- Functional: request ride, match driver, ETA, payment
- Geo: quad-tree index on driver locations; refresh every 4s
- Critical path: match latency < 2s; use approximate nearest neighbor

DESIGN WHATSAPP
- Functional: 1:1 chat, group chat, delivery receipts, presence
- Connection model: persistent WebSocket per user; sharded by user_id
- Storage: messages keyed by (conversation_id, sent_at); aggressive 30-day retention on free tier

CHECKPOINT
After reading, do all three again from memory in 25 minutes each.')
  ) as t(lesson_order, estimated_minutes, title, description, content) on true
 where c.title = 'Interview Prep: System Design'
   and not exists (select 1 from public.training_lessons l where l.course_id = c.id);

-- ---------- Communication Skills for Consultants ----------
insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, t.title, t.description, t.content, t.lesson_order, t.estimated_minutes
  from public.training_courses c
  join (values
    (0, 15, 'The weekly status update template',
     'A 4-bullet email that earns trust without burning your Friday.',
     'TEMPLATE
Subject: [Client] Week of [Mon Date]

✓ Shipped this week:
   - <bullet 1>
   - <bullet 2>

→ On deck next week:
   - <bullet 1>
   - <bullet 2>

⚠ Blockers / risks:
   - <bullet — what you need from them, and by when>

📊 Metric of the week:
   <one number that proves momentum>

RULES
- Send Friday afternoon, every Friday, even if nothing shipped (say so).
- Lead with what shipped, not what you tried.
- "Risks" forces you to surface them — your client should never be surprised in a steering meeting.'),
    (1, 20, 'Client kickoff playbook',
     'The first 30 minutes that set the tone for the whole engagement.',
     'AGENDA (30 min)
- 5 min  Introductions
- 10 min Their goals — listen, take notes, restate
- 10 min Your proposed plan — phase 1 deliverables
- 5 min  Cadence — weekly status, biweekly demo, slack vs email

NEVER
- Don''t over-promise on day 1
- Don''t bring up rate negotiations
- Don''t use jargon they haven''t used first

ALWAYS
- Send the meeting notes within 4 hours, with action items + owners + dates
- Repeat back their goals in your own words — confirms you heard them'),
    (2, 15, 'Async writing — be skimmable',
     'You''re writing for an exec who reads in 20 seconds.',
     'SKIMMABLE STRUCTURE
- One-sentence TL;DR at the top, bolded
- 3–5 bullets next
- Detail / explanation last (most readers won''t reach it)

INVERTED PYRAMID
TL;DR → Recommendation → Why → Caveats → Alternatives considered

BAD: "I''ve been thinking about our migration approach and wanted to discuss the trade-offs…"
GOOD: "**Recommend: move auth migration to next sprint.** The 2-day risk of a parallel rollout is higher than the value of shipping this week."'),
    (3, 20, 'Difficult conversations — raising risks',
     'How to tell a client something they don''t want to hear without losing the engagement.',
     'STRUCTURE
1. Lead with shared goal:  "We want this to ship on time."
2. State the data:         "Current pace, that ship date slips by 2 weeks."
3. Offer 2 options:        "We can cut scope X or add resources Y."
4. Ask for a decision:     "Which would you like me to plan for?"

NEVER
- "I can''t" — say "the constraint is" instead
- "It''s not my fault" — even if it isn''t
- Bring a problem without 2 options'),
    (4, 15, '1:1 prep — get value from your manager',
     'Treat the 1:1 as your meeting, not theirs.',
     'AGENDA YOU BRING (5 bullets)
1. One win since last week
2. One risk / decision needed
3. One ask for help / unblock
4. One question about strategy or career
5. One feedback item for them

THE 30-60-90 LIST
At kickoff (any engagement, any role): write what you''ll have done in 30/60/90 days. Share it with your manager. Update every 1:1. It defends against scope drift better than any process.')
  ) as t(lesson_order, estimated_minutes, title, description, content) on true
 where c.title = 'Communication Skills for Consultants'
   and not exists (select 1 from public.training_lessons l where l.course_id = c.id);

-- ===========================================================================
-- 3) NEW COURSE — "OPT / STEM-OPT Compliance Playbook"
-- ===========================================================================
insert into public.training_courses (
  title, description, category, difficulty,
  estimated_duration_hours, tags, status
) values (
  'OPT / STEM-OPT Compliance Playbook',
$$The complete reference for F-1 consultants on OPT or STEM-OPT — eligibility, SEVIS reporting, the I-983 training plan, unemployment limits, travel rules, and the H-1B cap-gap.

THIS IS A REFERENCE PLAYBOOK, NOT LEGAL ADVICE. For case-specific questions consult your DSO (Designated School Official) and a qualified immigration attorney.

STUDY PLAN (estimated 6 hours):
- Module 1 (60m): OPT 101 — eligibility, the EAD card, the 90-day clock
- Module 2 (45m): SEVIS reporting — what to report and within how many days
- Module 3 (45m): Unemployment limits — 90 days OPT, 150 days STEM
- Module 4 (60m): The STEM extension — prerequisites + the I-983 training plan
- Module 5 (45m): Self-evaluations + recordkeeping
- Module 6 (45m): H-1B transition — cap-gap + change of status
- Module 7 (30m): Travel + reentry while on OPT
- Module 8 (30m): Audit-readiness checklist

OUTCOME: A personal compliance checklist you maintain monthly. Zero surprises at the I-983 12-month or final evaluation. Zero unintentional unemployment-day overruns.$$,
  'Immigration', 'INTERMEDIATE', 6,
  array['opt','stem-opt','f1','immigration','i-983','sevis'],
  'ACTIVE'
)
on conflict do nothing;

-- Lessons for the OPT course (idempotent — only inserts when none exist).
insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, t.title, t.description, t.content, t.lesson_order, t.estimated_minutes
  from public.training_courses c
  join (values
    (0, 30, 'OPT 101 — eligibility, EAD, the 90-day clock',
     'Who qualifies, what document you''re actually carrying, and when the unemployment clock starts.',
     'WHAT OPT IS
Optional Practical Training — temporary work authorization for F-1 students related to their major. 12 months total per degree level (so you can get a fresh 12 months after a Master''s if your Bachelor''s was also F-1 OPT).

THREE KINDS
- Pre-completion: while still in school. Eats into the 12-month total.
- Post-completion: after you graduate. The default everyone talks about.
- 24-month STEM extension: covered in Module 4.

YOUR ACTUAL AUTHORIZATION
The Employment Authorization Document (EAD card, Form I-766). Your start date and end date are printed on it. You may not legally work for pay before the start date — not one day.

THE 90-DAY UNEMPLOYMENT CLOCK
The day after your EAD start date, the clock starts. You may not accrue more than 90 cumulative days of unemployment during your initial OPT period. Hit 91 days and your F-1 status is automatically terminated (no notice required).

CHECKPOINT
What''s your EAD start and end date? Have you logged them in a calendar with a 90-day budget tracker?'),
    (1, 30, 'SEVIS reporting — the 10-day rule',
     'Every change must be reported to your DSO within 10 days. Here''s the full list.',
     'WHAT TO REPORT WITHIN 10 DAYS
- Legal name change
- US residential address change
- Employer name + address change
- Supervisor name + email change
- Start or end of employment
- Loss of employment
- Change to a different OPT category (e.g. transitioning to STEM)
- Change in hours (drop below 20/week → may count as unemployment depending on type)
- Any updates to the I-983 (for STEM-OPT students)

HOW
- SEVP Portal (https://sevp.ice.gov/opt) for OPT students — most updates push directly
- OR email your DSO with the change + supporting docs

GOTCHA
Updating only on LinkedIn is not reporting. Your DSO must enter it into SEVIS.

CHECKPOINT
Log into the SEVP Portal right now. Is your current employer + address + supervisor accurate?'),
    (2, 30, 'Unemployment limits',
     '90 days on OPT. 150 days total (OPT + STEM). Here''s how it''s counted.',
     'COUNT INCLUDES
- Every day with no qualifying employment, post-EAD-start
- Weekends and holidays count toward unemployment if the surrounding period qualifies
- The clock pauses during authorized travel outside the US if you re-enter to resume work

QUALIFYING EMPLOYMENT
- Paid employment (≥ 20 hours/week) related to your degree
- Multiple part-time jobs adding to 20+ hours/week, related
- Paid internships or research positions
- Self-employment (with legal business + active engagement)
- Volunteer / unpaid work IS allowed and counts as employment if related to your degree — keep a written role description and supervisor letter

NOT QUALIFYING
- Side gigs unrelated to your degree
- Roles where you''re paid but the work isn''t related (the relationship to the degree must be defensible)

CHECKPOINT
Track your unemployment days in a spreadsheet. Two columns: date, status (EMPLOYED / UNEMPLOYED). Sum the UNEMPLOYED days monthly.'),
    (3, 60, 'STEM extension — prerequisites + the I-983',
     '24-month extension for STEM degrees. Every box you must check.',
     'ELIGIBILITY (all must be true)
- Your most recent degree on F-1 is a DHS-listed STEM degree (CIP code matters)
- Your employer is enrolled in E-Verify (no exceptions)
- You''re currently on a valid post-completion OPT period
- You apply before your current OPT expires (start 90 days before EAD end date)

THE I-983 TRAINING PLAN
The single document that sets up the entire 24-month period. Sections:
1. Student info
2. Employer info + E-Verify number
3. Training objectives — list 4–6 specific skills you''ll develop
4. How training will help reach your career goals
5. Performance evaluations cadence (annual + final)
6. Hours per week + compensation
7. Oversight + supervisor info
8. Signatures (student, supervisor, official with employer-signing authority)

COMMON I-983 MISTAKES
- Generic training objectives ("learn engineering") — DHS wants specific tech/methodologies
- Forgetting to update the I-983 when role/supervisor changes (10-day rule)
- Signing as employee + supervisor (must be a different person with signing authority)

CHECKPOINT
Pull up a blank I-983 (uscis.gov). Could you fill it out right now without your employer''s help? If not, that''s what to ask in your next 1:1.'),
    (4, 45, 'Self-evaluations — 12-month and final',
     'The two evaluations that determine whether your STEM extension stays intact.',
     '12-MONTH EVALUATION
- Due exactly 12 months after STEM-OPT start date
- Student fills out the top half describing progress on the I-983 objectives
- Supervisor fills out the bottom half + signs
- Student submits to their DSO within 10 days of completion

FINAL EVALUATION
- Due at the end of the STEM-OPT period (24 months after start)
- Same structure

WHAT TO WRITE
Map each I-983 objective to specific deliverables. "Develop production AWS skills" becomes "shipped 3 services to AWS Lambda, integrated CloudWatch alarms, reduced p95 latency 40% on the payments API."

WHAT NOT TO WRITE
- "I have learned a lot." — meaningless, fails audit signal
- "Worked on various projects." — too vague

CHECKPOINT
Open a doc today. Title it "STEM-OPT working file." Every week, drop 3 bullets on what you shipped + which I-983 objective it maps to. At month 12 you copy/paste.'),
    (5, 45, 'Transition to H-1B — cap-gap + change of status',
     'How OPT bridges to H-1B without a gap in work authorization.',
     'CAP-GAP — THE GIFT
If your employer files an H-1B cap petition while you''re on OPT/STEM-OPT, AND it''s a Change of Status (COS), AND it''s timely-filed, your OPT auto-extends until Sept 30 (the H-1B effective start date) even if your EAD expired earlier.

REQUIREMENTS
- Petition filed (and selected in the lottery) before your EAD expires
- Change of Status, not Consular Processing
- Petition still pending or approved on Oct 1

WHAT YOU GET
- Continuous work authorization through Sept 30
- A "cap-gap" I-20 from your DSO — request it immediately after selection
- You may NOT travel internationally during the cap-gap (re-entry breaks COS)

WHAT IF YOU''RE NOT SELECTED
- Continue on OPT/STEM-OPT until your EAD expires
- Common bridges: O-1, L-1, return to school, second STEM degree

CHECKPOINT
Know which fiscal year you''re first eligible for in the H-1B cap. (Registration usually opens early March, lottery results late March.) Discuss with your employer 4 months before that window.'),
    (6, 30, 'Travel + reentry while on OPT',
     'When it''s safe to travel and what to carry.',
     'CARRY ON EVERY INTERNATIONAL RETURN
- Valid passport (6+ months past return date)
- Valid F-1 visa stamp
- I-20 endorsed by your DSO for travel in the last 6 months
- Valid EAD card
- Job offer letter on company letterhead, dated within 30 days
- Recent pay stubs (3 months)

DON''T TRAVEL IF
- You don''t have a job yet (CBP can refuse reentry)
- Your H-1B petition is pending in Change of Status (re-entry breaks COS)
- Your visa stamp has expired AND you''re from a country with long renewal queues

DURING CAP-GAP
Don''t leave the US between Apr 1 and Oct 1 if your H-1B was selected — re-entry forces consular processing.

CHECKPOINT
Take a photo of every document above. Store in a folder you can pull up from your phone at a CBP desk.'),
    (7, 30, 'Audit-readiness checklist',
     'What to keep, where, and for how long.',
     'KEEP THESE FOREVER (or 3 years past F-1 termination, whichever is later)
- All I-20s (every endorsement)
- EAD card (original + photocopy)
- I-983 + every amended version
- All evaluations (12-month + final)
- Offer letters for every employment period
- Pay stubs (sample monthly stubs are fine, you don''t need every one)
- W-2s + tax returns

WHERE
Google Drive folder, encrypted. Plus one external backup. Not just email.

MONTHLY 10-MINUTE REVIEW
1. Has my employer/supervisor/role/address/hours changed? → SEVIS update if yes
2. Add this month to my unemployment tracker
3. Drop 3 bullets into my STEM working file
4. Confirm next eval date is on the calendar

YEARLY 30-MINUTE REVIEW
1. Print + sign 12-month or final evaluation
2. Update DSO with anything stale
3. Reconfirm H-1B cap eligibility / strategy

CHECKPOINT
Block 10 minutes on the first of every month. Title it "OPT compliance." Stop reading. Block it now.')
  ) as t(lesson_order, estimated_minutes, title, description, content) on true
 where c.title = 'OPT / STEM-OPT Compliance Playbook'
   and not exists (select 1 from public.training_lessons l where l.course_id = c.id);

-- ===========================================================================
-- Done. PostgREST schema cache reload.
-- ===========================================================================
notify pgrst, 'reload schema';
