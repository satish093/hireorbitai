-- =============================================================================
-- Training: full-LMS detail for the 6 general courses (training-content.sql)
-- =============================================================================
-- Completes Spring Boot, React + TypeScript, AWS for Engineers, Interview Prep,
-- Communication Skills, and the OPT / STEM-OPT Compliance Playbook to full-LMS
-- depth: course overview / roadmap / resources / capstone, per-lesson summary /
-- exercises / key takeaways, and per-lesson multiple-choice quizzes answerable
-- from the lesson bodies that already ship in training-content.sql.
--
-- NON-DESTRUCTIVE + IDEMPOTENT (UPDATEs metadata only; quiz inserts guarded by
-- NOT EXISTS on (lesson_id, question)). Apply AFTER training-content.sql and
-- the generated-content + versioning migrations.
-- =============================================================================

-- =============================================================================
-- 1) SPRING BOOT FOUNDATIONS
-- =============================================================================
update public.training_courses set
  overview = 'Spring Boot Foundations takes you from an empty project to a secured, tested, containerized REST API. You will learn the auto-configuration model, build clean controllers with DTOs, return structured error envelopes, persist data with Spring Data JPA, add stateless JWT auth, and ship it in Docker with health checks. Aimed at engineers and STEM-OPT trainees who want production Spring Boot habits, not just hello-world.',
  target_audience = 'Backend / full-stack engineers and STEM-OPT trainees building Java REST services.',
  roadmap = '[
    {"phase":"Project + web layer","duration_label":"Days 1-2","focus_areas":["Auto-config and starters","REST controllers and DTOs","Validation and error handling"]},
    {"phase":"Data + security","duration_label":"Days 3-4","focus_areas":["Spring Data JPA","JWT auth"]},
    {"phase":"Ship it","duration_label":"Day 5","focus_areas":["Testing","Docker deploy and health checks"]}
  ]'::jsonb,
  resources = '[
    {"title":"Spring Boot Reference Documentation","url":"https://docs.spring.io/spring-boot/index.html","type":"DOC"},
    {"title":"Spring Data JPA Reference","url":"https://docs.spring.io/spring-data/jpa/reference/","type":"DOC"},
    {"title":"Spring Security Reference","url":"https://docs.spring.io/spring-security/reference/","type":"DOC"},
    {"title":"Testcontainers for Java","url":"https://java.testcontainers.org/","type":"TOOL"},
    {"title":"start.spring.io","url":"https://start.spring.io/","type":"TOOL"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Build a small Spring Boot REST service end to end: a CRUD resource with DTOs and validation, JPA persistence, JWT auth, a global exception handler, a couple of tests, and a Dockerfile with an actuator health check.",
    "questions":[
      {"prompt":"Implement the CRUD controller with DTOs, validation, and a global @RestControllerAdvice error envelope.","guidance":"Return 201 on create, 404 on missing, 400 on bad input."},
      {"prompt":"Add JWT auth so unauthenticated requests get 401 and forged tokens get 401 (not 500).","guidance":"Use a stateless SecurityFilterChain and BCryptPasswordEncoder."},
      {"prompt":"Containerize it and expose /actuator/health; prove the health check returns UP.","guidance":"docker build, docker run, curl the health endpoint."}
    ],
    "rubric":[
      {"criterion":"Clean REST + DTOs + validation","weight":30},
      {"criterion":"Error handling envelope","weight":20},
      {"criterion":"JWT auth correctness","weight":25},
      {"criterion":"Tests + Docker health","weight":25}
    ]
  }'::jsonb,
  quiz_passing_score = 70, quiz_max_attempts = 3, content_status = 'READY', review_status = 'PUBLISHED'
where title = 'Spring Boot Foundations';

update public.training_lessons tl set
  summary = v.summary, exercises = v.exercises::jsonb, key_takeaways = v.key_takeaways::jsonb, content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Understand auto-configuration and starters.',
     '[{"prompt":"Generate a Spring Boot project with web, data-jpa, and security starters and run it.","expected_outcome":"A Tomcat-backed server on :8080 with no manually pinned dependency versions.","hints":["Use start.spring.io or spring init","Change server.port in application.yml"]}]',
     '["@SpringBootApplication bundles three annotations","Starters bring curated dependencies and defaults","Config precedence: CLI > env > yml > properties","Auto-config uses conditional beans"]'),
    (1, 'Build clean REST controllers with DTOs.',
     '[{"prompt":"Write a JobDto and a validated CreateJobRequest; confirm a missing title returns 400.","expected_outcome":"A clean 400 error body when validation fails; 201 on create.","hints":["Use @NotBlank/@Size","POST returns 201 + Location"]}]',
     '["POST returns 201 Created","404 for a missing resource on GET by id","Use DTOs to hide entity fields you must not expose","DTOs help when API and schema evolve separately"]'),
    (2, 'Return structured error envelopes, not stack traces.',
     '[{"prompt":"Add a @RestControllerAdvice that maps validation, not-found, and generic errors to one envelope shape.","expected_outcome":"400/404/500 all return the same structured error shape.","hints":["Handle MethodArgumentNotValidException","Log full stack only on 500"]}]',
     '["@RestControllerAdvice centralizes error handling","Never leak stack traces to clients","Bad payload maps to 400","Keep one error envelope shape across handlers"]'),
    (3, 'Persist and query with Spring Data JPA.',
     '[{"prompt":"Write a repository method returning all jobs with at least one application and inspect the generated SQL.","expected_outcome":"A derived or JPQL query with the SQL visible via show-sql.","hints":["spring.jpa.show-sql=true","Use JOIN FETCH or @EntityGraph for lazy associations"]}]',
     '["Derived query methods come from method names","Default fetch is LAZY for associations","Fix LazyInitializationException with JOIN FETCH or @EntityGraph","Drop to native SQL only when needed"]'),
    (4, 'Add stateless JWT authentication.',
     '[{"prompt":"Add JWT auth and verify a no-token request returns 401 and a forged token returns 401.","expected_outcome":"401 for missing/forged tokens, never 500.","hints":["Stateless session policy","Bearer token in the Authorization header"]}]',
     '["Client sends Authorization: Bearer <jwt>","Use SecurityFilterChain, not the deprecated adapter","BCryptPasswordEncoder for password hashing","Forged/missing tokens return 401"]'),
    (5, 'Test and containerize the service.',
     '[{"prompt":"Write one @WebMvcTest and one Testcontainers-backed test, then build and run the Docker image.","expected_outcome":"Tests pass; the container serves /actuator/health as UP.","hints":["@DataJpaTest rolls back per test","Point the orchestrator at /actuator/health"]}]',
     '["@WebMvcTest for controller slices","Testcontainers runs a real Postgres in Docker","Expose /actuator/health for orchestration","@DataJpaTest rolls back each test"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'Spring Boot Foundations' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'What does @SpringBootApplication combine?', '["@Configuration + @EnableAutoConfiguration + @ComponentScan","@Controller + @Service + @Repository","@Entity + @Table + @Id","@Bean + @Autowired + @Value"]', '@Configuration + @EnableAutoConfiguration + @ComponentScan', 'It is a convenience annotation combining those three.'),
  (0, 1, 'What do Spring Boot starters provide?', '["A curated set of dependencies with sensible defaults","A database engine","A frontend framework","A CI pipeline"]', 'A curated set of dependencies with sensible defaults', 'Starters bundle dependencies and auto-configuration so you do not pin versions by hand.'),
  (0, 2, 'What is the externalized config precedence (highest first)?', '["Command line > env var > application.yml > application.properties","application.properties first","Environment variables are lowest","Random order"]', 'Command line > env var > application.yml > application.properties', 'Command-line args win, then env vars, then yml, then properties.'),
  (1, 0, 'Which status should POST /jobs return on success?', '["201 Created","200 OK","204 No Content","400 Bad Request"]', '201 Created', 'A successful create returns 201 with a Location header.'),
  (1, 1, 'When are DTOs worth introducing?', '["When the entity has fields you must never expose","Always, for every entity","Never","Only for GET endpoints"]', 'When the entity has fields you must never expose', 'DTOs hide sensitive fields and decouple the API contract from the schema.'),
  (1, 2, 'What should GET /jobs/{id} return for a missing id?', '["404 Not Found","200 OK","500 Internal Server Error","204 No Content"]', '404 Not Found', 'A missing resource maps to 404.'),
  (2, 0, 'Which annotation defines a global exception handler?', '["@RestControllerAdvice","@RestController","@Service","@Entity"]', '@RestControllerAdvice', '@RestControllerAdvice centralizes exception handling across controllers.'),
  (2, 1, 'What should your API return instead of a stack trace?', '["A structured error envelope","The raw exception text","An empty 200","A redirect"]', 'A structured error envelope', 'Return a consistent structured error body, logging the full stack server-side.'),
  (2, 2, 'A bad request payload should map to which status?', '["400","404","201","500"]', '400', 'Validation failures are client errors and map to 400.'),
  (3, 0, 'What powers findByCompanyAndPostedAtAfter?', '["Derived query method naming","Hand-written JDBC","A stored procedure","A native scan"]', 'Derived query method naming', 'Spring Data derives the query from the method name.'),
  (3, 1, 'What is the default fetch type for associations?', '["LAZY","EAGER","NONE","BATCH"]', 'LAZY', '@OneToMany/@ManyToOne default to LAZY fetching.'),
  (3, 2, 'How should you fix a LazyInitializationException cleanly?', '["JOIN FETCH or @EntityGraph","Always switch to EAGER","Disable JPA","Catch and ignore it"]', 'JOIN FETCH or @EntityGraph', 'Prefer JOIN FETCH or @EntityGraph over forcing EAGER everywhere.'),
  (4, 0, 'How does the client send the JWT after login?', '["Authorization: Bearer <jwt> header","As a URL query parameter","In a cookie named password","In the request path"]', 'Authorization: Bearer <jwt> header', 'The client sends the token in the Authorization header on each request.'),
  (4, 1, 'Which password encoder bean is recommended?', '["BCryptPasswordEncoder","NoOpPasswordEncoder","MD5 hashing","Plaintext"]', 'BCryptPasswordEncoder', 'BCrypt is the recommended adaptive password hash.'),
  (4, 2, 'A request with a forged token should return what?', '["401 Unauthorized","500 Internal Server Error","200 OK","A stack trace"]', '401 Unauthorized', 'Invalid/forged tokens are rejected with 401, never a 500.'),
  (5, 0, 'Which annotation gives a controller slice test?', '["@WebMvcTest","@DataJpaTest","@SpringBootTest","@Entity"]', '@WebMvcTest', '@WebMvcTest loads only the web layer for fast controller tests.'),
  (5, 1, 'What does Testcontainers provide for tests?', '["A real Postgres in Docker","A mock database only","A frontend","A load balancer"]', 'A real Postgres in Docker', 'Testcontainers spins up real dependencies in Docker for full-stack tests.'),
  (5, 2, 'Which endpoint should the orchestrator health-check?', '["/actuator/health","/login","/","/internal/secret"]', '/actuator/health', 'The actuator health endpoint reports service readiness.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'Spring Boot Foundations'
  and not exists (select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question);

-- =============================================================================
-- 2) REACT + TYPESCRIPT CRASH COURSE
-- =============================================================================
update public.training_courses set
  overview = 'React + TypeScript Crash Course builds the habits behind reliable typed front-ends: strictly-typed components and state, a correct mental model for hooks, context and custom hooks for shared state, routing and validated forms, and data fetching with trustworthy tests. By the end you can build a typed CRUD feature with inline validation and tests, with no use of any.',
  target_audience = 'Front-end / full-stack engineers and STEM-OPT trainees building typed React apps.',
  roadmap = '[
    {"phase":"Typed components + hooks","duration_label":"Days 1-2","focus_areas":["Typed props and state","Hooks mental model"]},
    {"phase":"State + routing","duration_label":"Day 3","focus_areas":["Context and custom hooks","Routing and forms"]},
    {"phase":"Data + tests","duration_label":"Day 4","focus_areas":["Data fetching","React Testing Library"]}
  ]'::jsonb,
  resources = '[
    {"title":"React Documentation","url":"https://react.dev/","type":"DOC"},
    {"title":"TypeScript Handbook","url":"https://www.typescriptlang.org/docs/handbook/intro.html","type":"DOC"},
    {"title":"TanStack Query (React Query)","url":"https://tanstack.com/query/latest","type":"DOC"},
    {"title":"React Hook Form","url":"https://react-hook-form.com/","type":"DOC"},
    {"title":"Testing Library","url":"https://testing-library.com/docs/react-testing-library/intro/","type":"DOC"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Build a small typed CRUD feature in React + TypeScript: a list and a create form with Zod validation, data fetching with caching, and tests covering a happy path and a validation-error path. No use of any.",
    "questions":[
      {"prompt":"Build the typed components and a validated form (react-hook-form + Zod) with inline error messages.","guidance":"Disable submit while in-flight; navigate on success."},
      {"prompt":"Fetch and cache data, and invalidate the cache after a mutation.","guidance":"Use React Query keys and invalidateQueries."},
      {"prompt":"Write one happy-path and one validation-error test with React Testing Library.","guidance":"No snapshot tests."}
    ],
    "rubric":[
      {"criterion":"Strict typing (no any)","weight":25},
      {"criterion":"Form + validation UX","weight":30},
      {"criterion":"Data fetching + cache invalidation","weight":20},
      {"criterion":"Tests","weight":25}
    ]
  }'::jsonb,
  quiz_passing_score = 70, quiz_max_attempts = 3, content_status = 'READY', review_status = 'PUBLISHED'
where title = 'React + TypeScript Crash Course';

update public.training_lessons tl set
  summary = v.summary, exercises = v.exercises::jsonb, key_takeaways = v.key_takeaways::jsonb, content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Type components, props, and state strictly.',
     '[{"prompt":"Build a Counter with typed +/- and reset, using no any.","expected_outcome":"A typed component with explicit prop and state types.","hints":["Type props with a type/interface","useState<number>(0)"]}]',
     '["Type props with a type or interface","Provide a stable key when mapping arrays","Prefer unknown over any, then narrow","React.FC is usually unnecessary"]'),
    (1, 'Build a correct mental model for hooks.',
     '[{"prompt":"Build a TodoList with a derived remaining count, first as a const then with useMemo.","expected_outcome":"You can explain when useMemo actually changes behavior.","hints":["[] runs once on mount","No deps array usually means a bug"]}]',
     '["useEffect synchronizes with external systems","[] runs once on mount; [a,b] on change","No deps array runs every render (usually a bug)","useMemo/useCallback are profiling tools"]'),
    (2, 'Share state with context and custom hooks.',
     '[{"prompt":"Write useLocalStorage<T>(key, fallback) that reads on mount, writes on change, and syncs across tabs.","expected_outcome":"A reusable typed hook backed by localStorage.","hints":["Throw if useAuth is used outside its provider","Avoid fast-changing values in context"]}]',
     '["Context shares state without prop-drilling","Use context for read-everywhere, write-rarely values","Avoid fast-changing values in context","useAuth should throw outside its provider"]'),
    (3, 'Wire routing and validated forms.',
     '[{"prompt":"Build a job-application form with inline validation, in-flight submit disabling, and navigation on success.","expected_outcome":"A working form using react-hook-form + Zod.","hints":["Use zodResolver","Disable submit while in-flight"]}]',
     '["React Router v6 maps paths to elements","react-hook-form + Zod give typed validation","zodResolver connects a schema to the form","Disable submit while in-flight"]'),
    (4, 'Fetch data and test it.',
     '[{"prompt":"Cover one happy path and one validation-error path with React Testing Library.","expected_outcome":"Two trustworthy tests, no snapshots.","hints":["invalidateQueries after a mutation","Query by role/text, not test ids where possible"]}]',
     '["React Query dedupes and revalidates","invalidateQueries refreshes after a mutation","Test happy + error paths with RTL","Avoid snapshot tests"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'React + TypeScript Crash Course' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'How should you type React component props in TypeScript?', '["With a type or interface for props","With any","With runtime PropTypes only","No typing is needed"]', 'With a type or interface for props', 'Define an explicit props type/interface; typed props are cleaner than React.FC.'),
  (0, 1, 'What must you provide when rendering a list with map?', '["A stable key","The array index always","Nothing","A ref"]', 'A stable key', 'React needs a stable key per item to reconcile lists correctly.'),
  (0, 2, 'When stuck on a type, what is preferred over any?', '["unknown, then narrow","any","object","never"]', 'unknown, then narrow', 'Use unknown and narrow it; avoid any.'),
  (1, 0, 'What does an empty deps array [] mean in useEffect?', '["Run once on mount","Run after every render","Never run","Run only on unmount"]', 'Run once on mount', 'An empty deps array runs the effect a single time on mount.'),
  (1, 1, 'How are useMemo and useCallback best described?', '["Profiling/optimization tools used after measuring","Always required for correctness","State hooks","Routing tools"]', 'Profiling/optimization tools used after measuring', 'Reach for them only after a profiler shows wasted re-renders.'),
  (1, 2, 'Omitting the deps array entirely usually means what?', '["A bug (the effect runs after every render)","Best practice","It runs once","It disables the effect"]', 'A bug (the effect runs after every render)', 'No deps array runs after every render, which is almost always unintended.'),
  (2, 0, 'What problem does Context solve?', '["Sharing state without prop-drilling","Routing","Styling","HTTP caching"]', 'Sharing state without prop-drilling', 'Context provides values to a subtree without passing props down every level.'),
  (2, 1, 'Which values should you avoid putting in Context?', '["Fast-changing values like typing input or mouse position","Auth","Theme","Feature flags"]', 'Fast-changing values like typing input or mouse position', 'Fast-changing values in context cause excessive re-renders.'),
  (2, 2, 'What should useAuth do if used outside its provider?', '["Throw an error","Return null silently","Return undefined","Reload the page"]', 'Throw an error', 'Throwing surfaces the misuse immediately instead of failing subtly.'),
  (3, 0, 'Which stack is used for typed client-side forms here?', '["react-hook-form + Zod","Redux + Saga","jQuery","Backbone"]', 'react-hook-form + Zod', 'The course uses react-hook-form with Zod validation.'),
  (3, 1, 'What does zodResolver connect?', '["A Zod schema to react-hook-form validation","Routing to forms","State to context","Tests to components"]', 'A Zod schema to react-hook-form validation', 'zodResolver lets react-hook-form validate against a Zod schema.'),
  (3, 2, 'While a form submit is in-flight, the submit button should?', '["Be disabled","Stay enabled","Disappear","Reload the page"]', 'Be disabled', 'Disable submit during the request to prevent double submits.'),
  (4, 0, 'What does React Query give you out of the box?', '["Deduping, stale-while-revalidate, refetch on focus","CSS-in-JS","Routing","Authentication"]', 'Deduping, stale-while-revalidate, refetch on focus', 'React Query handles caching, deduping, and revalidation.'),
  (4, 1, 'How do you refresh cached data after a mutation?', '["queryClient.invalidateQueries","Reload the whole page","Clear localStorage","Do nothing"]', 'queryClient.invalidateQueries', 'Invalidating the relevant query keys triggers a refetch.'),
  (4, 2, 'Which testing approach does the course recommend?', '["React Testing Library covering happy + error paths","Snapshot tests only","No tests","Manual clicking only"]', 'React Testing Library covering happy + error paths', 'RTL tests behavior; the course advises against snapshot-only tests.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'React + TypeScript Crash Course'
  and not exists (select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question);

-- =============================================================================
-- 3) AWS FOR ENGINEERS
-- =============================================================================
update public.training_courses set
  overview = 'AWS for Engineers is a pragmatic tour of the services you actually reach for: IAM least privilege, EC2 + Auto Scaling behind a load balancer, S3 with presigned URLs and lifecycle, Lambda + API Gateway with cold-start mitigation, choosing RDS vs DynamoDB by access pattern, and CloudWatch logs/metrics/alarms. The throughline is least privilege, right-sizing, and observability.',
  target_audience = 'Engineers and STEM-OPT trainees deploying and operating workloads on AWS.',
  roadmap = '[
    {"phase":"Identity + compute","duration_label":"Days 1-2","focus_areas":["IAM least privilege","EC2 / ASG / ALB"]},
    {"phase":"Storage + serverless","duration_label":"Days 3-4","focus_areas":["S3","Lambda + API Gateway","RDS vs DynamoDB"]},
    {"phase":"Observability","duration_label":"Day 5","focus_areas":["CloudWatch logs, metrics, alarms"]}
  ]'::jsonb,
  resources = '[
    {"title":"AWS IAM best practices","url":"https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html","type":"DOC"},
    {"title":"AWS Well-Architected Framework","url":"https://aws.amazon.com/architecture/well-architected/","type":"DOC"},
    {"title":"Amazon S3 presigned URLs","url":"https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html","type":"DOC"},
    {"title":"AWS Lambda best practices","url":"https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html","type":"DOC"},
    {"title":"CloudWatch Logs Insights","url":"https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/AnalyzingLogData.html","type":"DOC"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Design (and ideally deploy) a small, least-privilege, observable service on AWS: a Lambda behind HTTP API that reads/writes one S3 prefix, with a scoped IAM role, a CloudWatch alarm, and a justified RDS-vs-DynamoDB choice.",
    "questions":[
      {"prompt":"Write the least-privilege IAM role for the workload and validate it with Access Analyzer.","guidance":"Grant only the specific actions on the specific resource prefix."},
      {"prompt":"Choose RDS or DynamoDB for the data and justify the choice from the access pattern.","guidance":"State the queries; pick the store that makes the hot query cheap."},
      {"prompt":"Add a CloudWatch alarm on errors and prove it fires and recovers.","guidance":"Route the alarm to SNS; trigger it with a broken deploy."}
    ],
    "rubric":[
      {"criterion":"Least-privilege IAM","weight":30},
      {"criterion":"Right service choices","weight":25},
      {"criterion":"Cost / right-sizing awareness","weight":15},
      {"criterion":"Observability + alarms","weight":30}
    ]
  }'::jsonb,
  quiz_passing_score = 70, quiz_max_attempts = 3, content_status = 'READY', review_status = 'PUBLISHED'
where title = 'AWS for Engineers';

update public.training_lessons tl set
  summary = v.summary, exercises = v.exercises::jsonb, key_takeaways = v.key_takeaways::jsonb, content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Apply least privilege with IAM roles, not keys.',
     '[{"prompt":"Write a role that lets a Lambda read/write one specific S3 prefix and nothing else; validate with Access Analyzer.","expected_outcome":"A scoped policy with one resource ARN prefix.","hints":["Start from deny (no policy), add Allows","Never embed keys in code"]}]',
     '["Roles are temporary identities assumed by services","Never embed AWS keys in code or env files","Start from deny, add specific Allows","Use IAM Access Analyzer regularly"]'),
    (1, 'Scale compute with ASG behind an ALB.',
     '[{"prompt":"Provision a 2-node ASG behind an ALB and watch new instances drain old ones on deploy.","expected_outcome":"A target-tracking ASG with an ALB health check.","hints":["Keep /health cheap and isolated","Target-track on CPU"]}]',
     '["EC2 fits long-running/stateful/GPU workloads","ASG + ALB + target tracking is the pattern","Keep /health cheap and isolated","Expensive health checks melt the DB in recovery"]'),
    (2, 'Use S3 safely with presigned URLs and lifecycle.',
     '[{"prompt":"Generate a presigned PUT URL from Lambda and upload a file with curl.","expected_outcome":"A time-limited upload that never touches your server.","hints":["Enable Block Public Access at the account level","Time-limit the URL"]}]',
     '["Block Public Access at the account level","Presigned URLs upload direct to S3","Time-limit presigned URLs","Use lifecycle rules to tier/expire objects"]'),
    (3, 'Run Lambda + API Gateway and tame cold starts.',
     '[{"prompt":"Deploy a Lambda behind HTTP API; measure the first vs the tenth request, then add provisioned concurrency.","expected_outcome":"A measurable reduction in cold-start latency.","hints":["Smaller package = faster cold start","More memory = more vCPU"]}]',
     '["Provisioned Concurrency keeps instances warm","More Lambda memory means more vCPU (linear)","HTTP API (v2) is cheaper/faster than REST API (v1)","Put SDK clients outside the handler"]'),
    (4, 'Choose RDS vs DynamoDB by access pattern.',
     '[{"prompt":"Model the applications table for both RDS and DynamoDB; pick the one matching the access pattern.","expected_outcome":"A justified choice tied to the queries the app runs.","hints":["RDS for joins/transactions","DynamoDB for single-item key access at scale"]}]',
     '["RDS for joins and multi-row transactions","DynamoDB for single-item key access at scale","DynamoDB punishes scanning/FilterExpression","Access pattern drives the choice"]'),
    (5, 'Observe with CloudWatch logs, metrics, alarms.',
     '[{"prompt":"Wire an alarm on Lambda Errors, trigger it with a broken build, then fix it and watch it close.","expected_outcome":"An alarm that fires to SNS and recovers.","hints":["Use structured JSON logs","Embedded Metric Format for custom metrics"]}]',
     '["Use structured JSON logs + Logs Insights","Alarms route via SNS to PagerDuty/Slack","Embedded Metric Format emits custom metrics","AWS auto-publishes CPU, errors, p99"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'AWS for Engineers' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'How should application code authenticate to AWS?', '["IAM roles + instance profiles (no embedded keys)","Hard-coded access keys","Root credentials","A shared password"]', 'IAM roles + instance profiles (no embedded keys)', 'Use roles and instance profiles; never embed long-lived keys in code.'),
  (0, 1, 'What is an IAM Role?', '["A temporary identity assumed by a service or account","A permanent human user","An S3 bucket","A VPC"]', 'A temporary identity assumed by a service or account', 'Roles provide temporary credentials assumed by services or other accounts.'),
  (0, 2, 'How should you start an IAM policy?', '["Deny by default, then add specific Allows","Allow all, then deny some","Grant admin and trim later","Randomly"]', 'Deny by default, then add specific Allows', 'Least privilege means default deny with targeted Allows.'),
  (1, 0, 'When does EC2 still win over serverless?', '["Long-running stateful processes, GPU, or lift-and-shift","Always","Never","Only static sites"]', 'Long-running stateful processes, GPU, or lift-and-shift', 'EC2 fits long-running/stateful/GPU and migration scenarios.'),
  (1, 1, 'What is the modern Auto Scaling pattern described?', '["Target tracking on CPU behind an ALB","Manual scaling only","A single fixed instance","Scale by time of day only"]', 'Target tracking on CPU behind an ALB', 'A launch template feeds an ASG with target tracking behind an ALB.'),
  (1, 2, 'Why must the /health check be cheap and isolated?', '["Hitting the DB on every check melts it during recovery","To look professional","It must always hit the DB","No real reason"]', 'Hitting the DB on every check melts it during recovery', 'Expensive health checks amplify load during incident recovery.'),
  (2, 0, 'How do you prevent accidental public S3 objects?', '["Block Public Access at the account level","Trust object ACLs","Make the bucket public","Disable encryption"]', 'Block Public Access at the account level', 'Account-level Block Public Access stops public ACL/policy mistakes.'),
  (2, 1, 'What do presigned URLs enable?', '["Direct browser upload/download without bytes touching your server","Public buckets","Free storage","Faster EC2"]', 'Direct browser upload/download without bytes touching your server', 'Presigned URLs let clients talk to S3 directly, time-limited.'),
  (2, 2, 'What should you always set on a presigned URL?', '["A time limit","A public-read ACL","Unlimited lifetime","Nothing"]', 'A time limit', 'Presigned URLs should expire (e.g. 60s upload, 5min download).'),
  (3, 0, 'What keeps Lambda instances warm to cut cold starts?', '["Provisioned Concurrency","More memory alone","A bigger deployment package","A cron job"]', 'Provisioned Concurrency', 'Provisioned Concurrency keeps N instances warm.'),
  (3, 1, 'What happens to vCPU as you add Lambda memory?', '["It increases linearly","It decreases","It stays fixed at 1","It is unrelated"]', 'It increases linearly', 'Lambda vCPU scales linearly with configured memory.'),
  (3, 2, 'Which API Gateway type is cheaper and faster for most cases?', '["HTTP API (v2)","REST API (v1)","WebSocket API","None of these"]', 'HTTP API (v2)', 'HTTP API (v2) is cheaper and faster unless you need v1-only features.'),
  (4, 0, 'Pick RDS when you need what?', '["Joins and multi-row transactions","Single-item key access at huge scale","To avoid SQL","Spiky key-value throughput"]', 'Joins and multi-row transactions', 'RDS fits relational joins and transactions.'),
  (4, 1, 'What does DynamoDB punish you for?', '["Scanning / frequent FilterExpression","Single-key reads","Writes","Using indexes"]', 'Scanning / frequent FilterExpression', 'Frequent scans/filters signal a wrong table design.'),
  (4, 2, 'What should drive the SQL-vs-NoSQL decision?', '["The access pattern","Team preference for hype","Cost alone","The vendor logo"]', 'The access pattern', 'Choose the store that makes your hottest query cheap.'),
  (5, 0, 'What log format is recommended for query-ability?', '["Structured JSON logs","Freeform text","Binary","CSV only"]', 'Structured JSON logs', 'Structured JSON works with CloudWatch Logs Insights.'),
  (5, 1, 'Where does an errors alarm typically route?', '["SNS, then PagerDuty/Slack","Directly to a file","Nowhere","Only email to one person"]', 'SNS, then PagerDuty/Slack', 'Alarms publish to SNS which fans out to paging/chat.'),
  (5, 2, 'What lets your app emit custom metrics via log lines?', '["Embedded Metric Format","Prometheus only","A cron job","S3 events"]', 'Embedded Metric Format', 'EMF lets apps emit custom metrics embedded in log entries.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'AWS for Engineers'
  and not exists (select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question);

-- =============================================================================
-- 4) INTERVIEW PREP: SYSTEM DESIGN
-- =============================================================================
update public.training_courses set
  overview = 'Interview Prep: System Design gives you a repeatable structure for the 30-minute design interview: the FRAME checklist, back-of-envelope capacity math, access-pattern-first data modeling, the three scale levers (cache, shard, queue), and worked walk-throughs of Twitter, Uber, and WhatsApp. The goal is rhythm and trade-off articulation, not memorized answers.',
  target_audience = 'Engineers and STEM-OPT trainees preparing for system-design interviews.',
  roadmap = '[
    {"phase":"Structure + math","duration_label":"Days 1-2","focus_areas":["The FRAME method","Estimations and capacity planning"]},
    {"phase":"Modeling + scaling","duration_label":"Day 3","focus_areas":["Access-pattern data modeling","Cache, shard, queue"]},
    {"phase":"Practice","duration_label":"Day 4","focus_areas":["Worked walk-throughs (Twitter / Uber / WhatsApp)"]}
  ]'::jsonb,
  resources = '[
    {"title":"System Design Primer","url":"https://github.com/donnemartin/system-design-primer","type":"DOC"},
    {"title":"AWS Well-Architected Framework","url":"https://aws.amazon.com/architecture/well-architected/","type":"DOC"},
    {"title":"Latency numbers every programmer should know","url":"https://gist.github.com/jboner/2841832","type":"ARTICLE"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Produce a timed, written system-design answer for a prompt you have not rehearsed (e.g. a photo-sharing service), using the FRAME structure within ~25 minutes.",
    "questions":[
      {"prompt":"Write the functional requirements, an API surface, and back-of-envelope capacity math.","guidance":"Show the QPS and storage math; multiply raw storage by ~3."},
      {"prompt":"Give a data model driven by the access pattern and choose a fan-out strategy with justification.","guidance":"State the hot query and make it cheap."},
      {"prompt":"Apply at least two scale levers (cache/shard/queue) and state the trade-offs.","guidance":"Explain where each lever sits and what it costs."}
    ],
    "rubric":[
      {"criterion":"FRAME structure + time budget","weight":25},
      {"criterion":"Capacity math","weight":25},
      {"criterion":"Access-pattern data model","weight":25},
      {"criterion":"Scaling trade-offs","weight":25}
    ]
  }'::jsonb,
  quiz_passing_score = 70, quiz_max_attempts = 3, content_status = 'READY', review_status = 'PUBLISHED'
where title = 'Interview Prep: System Design';

update public.training_lessons tl set
  summary = v.summary, exercises = v.exercises::jsonb, key_takeaways = v.key_takeaways::jsonb, content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Run the interview with the FRAME structure.',
     '[{"prompt":"Time yourself answering design a URL shortener using the FRAME structure.","expected_outcome":"You naturally land near the 25-minute mark with trade-offs covered.","hints":["Spend 0-5 min on requirements","End with trade-offs"]}]',
     '["FRAME: Functional, Resource estimates, API, Model, Edge cases","Budget the 30 minutes deliberately","Spend the first 5 minutes on requirements","Close with trade-offs and improvements"]'),
    (1, 'Do the capacity math the interviewer checks.',
     '[{"prompt":"Estimate storage and write throughput for an Instagram-style photo service and defend the numbers.","expected_outcome":"QPS and storage estimates with assumptions stated.","hints":["1 KB at 1k QPS is ~1 MB/s","Multiply raw storage by ~3"]}]',
     '["1 KB request at 1k QPS is ~1 MB/s (~86 GB/day)","Multiply raw storage by ~3 for indexes/replicas","Peak QPS exceeds sustained QPS","The interviewer is checking the math"]'),
    (2, 'Model data from the access pattern.',
     '[{"prompt":"Pick a fan-out strategy for a chat app (median 10 friends, p99 1k) and defend it.","expected_outcome":"A justified hybrid or single strategy tied to the read/write costs.","hints":["Write the queries first","If you are scanning, the model is wrong"]}]',
     '["Access pattern, not SQL-vs-NoSQL, is the question","Make the hottest query an O(1) read","Fan-out on write: costly writes, cheap reads","Scanning means the model is wrong"]'),
    (3, 'Reach for cache, shard, and queue.',
     '[{"prompt":"Redesign a photo upload to use a queue: where does it sit and what happens on failure?","expected_outcome":"A queue at the right boundary with a failure path and a 202 response.","hints":["Cache-aside is the default","Consistent hashing reduces rebalance cost"]}]',
     '["Look-aside caching is the default","Consistent hashing rebalances at O(K/N)","Use a queue across slow/unreliable boundaries","Return 202 Accepted; do not block on the queue"]'),
    (4, 'Internalize the rhythm from worked designs.',
     '[{"prompt":"Re-do Twitter, Uber, and WhatsApp from memory in ~25 minutes each.","expected_outcome":"Three answers that hit requirements, API, model, and trade-offs.","hints":["Twitter: fan-out on write for O(1) reads","WhatsApp: persistent WebSocket per user"]}]',
     '["Twitter fan-out on write gives O(1) timeline reads","Uber uses a geo/quad-tree index on driver locations","WhatsApp uses a persistent WebSocket per user","Read designs for rhythm, do not memorize"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'Interview Prep: System Design' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'In the FRAME checklist, what does F stand for?', '["Functional requirements","Fast","Format","Fan-out"]', 'Functional requirements', 'F is functional requirements (3-5 user stories).'),
  (0, 1, 'Roughly how much of a 30-minute interview is requirements + constraints?', '["The first 0-5 minutes","About 25 minutes","Zero","The whole interview"]', 'The first 0-5 minutes', 'Spend the first ~5 minutes on functional requirements and constraints.'),
  (0, 2, 'What should the final 5 minutes cover?', '["Trade-offs and what to improve","More diagrams","Live coding","Nothing"]', 'Trade-offs and what to improve', 'Close with trade-offs and what you would improve with more time.'),
  (1, 0, 'A 1 KB request at 1k QPS is roughly how much throughput?', '["~1 MB/s (~86 GB/day)","~1 GB/s","~1 KB/day","Negligible"]', '~1 MB/s (~86 GB/day)', '1 KB times 1k QPS is about 1 MB/s, roughly 86 GB/day.'),
  (1, 1, 'When estimating storage, multiply raw by ~3 to account for what?', '["Indexes and replicas","Taxes","Caching","Compression"]', 'Indexes and replicas', 'Indexes and replicas roughly triple raw storage.'),
  (1, 2, 'Why do the estimations matter in the interview?', '["The interviewer is silently checking the math","They do not matter","To waste time","Only at FAANG"]', 'The interviewer is silently checking the math', 'Capacity math signals whether you can reason about scale.'),
  (2, 0, 'What is the right first question for data modeling?', '["The access pattern (queries you will run)","SQL or NoSQL","Which cloud provider","Which language"]', 'The access pattern (queries you will run)', 'Model from the queries; the access pattern decides the store.'),
  (2, 1, 'If you find yourself scanning, what does it mean?', '["Your data model is wrong","You are efficient","You need more RAM","Nothing"]', 'Your data model is wrong', 'Frequent scanning indicates a poor key/model choice.'),
  (2, 2, 'Fan-out on write trades what?', '["Higher write cost for cheap reads","Cheap writes for slow reads","Nothing","Storage for latency only"]', 'Higher write cost for cheap reads', 'Fan-out on write precomputes timelines: costly writes, cheap reads.'),
  (3, 0, 'What is the default caching pattern?', '["Look-aside (cache-aside)","Write-through always","No TTL ever","Write-behind only"]', 'Look-aside (cache-aside)', 'Cache-aside is the default; write-through when stale reads are unacceptable.'),
  (3, 1, 'Consistent hashing reduces rebalance cost to what?', '["O(K/N)","O(K)","O(N^2)","O(1) always"]', 'O(K/N)', 'Consistent hashing moves only K/N keys when adding a node.'),
  (3, 2, 'When crossing a slow or unreliable boundary, you should use what?', '["A queue","A tight synchronous call","A global lock","A bigger server"]', 'A queue', 'Queues decouple slow/unreliable boundaries; return 202 Accepted.'),
  (4, 0, 'For a Twitter timeline, fan-out on write gives what?', '["O(1) timeline reads at higher storage cost","Slow reads","No storage need","Cheap everything"]', 'O(1) timeline reads at higher storage cost', 'Precomputed timelines make reads O(1) but cost storage.'),
  (4, 1, 'Uber matching uses what kind of index on driver locations?', '["A geo / quad-tree index","A B-tree on names","No index","A hash on user_id"]', 'A geo / quad-tree index', 'A quad-tree (geo index) supports nearest-driver queries.'),
  (4, 2, 'WhatsApp connection model uses what?', '["A persistent WebSocket per user","Polling every hour","Email delivery","FTP"]', 'A persistent WebSocket per user', 'A persistent WebSocket per user, sharded by user_id.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'Interview Prep: System Design'
  and not exists (select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question);

-- =============================================================================
-- 5) COMMUNICATION SKILLS FOR CONSULTANTS
-- =============================================================================
update public.training_courses set
  overview = 'Communication Skills for Consultants is a short, practical course on the writing and meetings that build client trust: a weekly status template, a kickoff playbook, skimmable async writing, raising risks without losing the engagement, and running a 1:1 that works for you. The output is a reusable communication kit you apply on every engagement.',
  target_audience = 'Consultants and STEM-OPT trainees who work directly with clients and managers.',
  roadmap = '[
    {"phase":"Cadence + kickoff","duration_label":"Day 1","focus_areas":["Weekly status template","Client kickoff playbook"]},
    {"phase":"Writing + hard talks","duration_label":"Day 2","focus_areas":["Skimmable async writing","Raising risks"]},
    {"phase":"Manage up","duration_label":"Day 3","focus_areas":["1:1 prep and the 30-60-90 list"]}
  ]'::jsonb,
  resources = '[
    {"title":"The Pyramid Principle (Barbara Minto) overview","url":"https://en.wikipedia.org/wiki/The_Minto_Pyramid_Principle","type":"ARTICLE"},
    {"title":"Amazon 6-pager / narrative writing culture","url":"https://www.aboutamazon.com/news/company-news/an-insiders-account-of-amazons-leadership-principles","type":"ARTICLE"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Assemble a personal communication kit you will reuse on every engagement: a filled-in weekly status template, a kickoff agenda, a skimmable recommendation memo, and your 30-60-90 list.",
    "questions":[
      {"prompt":"Write a real weekly status update using the four-section template.","guidance":"Lead with what shipped; include a blocker and a metric."},
      {"prompt":"Draft a skimmable recommendation using the inverted pyramid.","guidance":"Bold one-sentence TL;DR, then bullets, then detail."},
      {"prompt":"Write your 30-60-90 list for a hypothetical engagement.","guidance":"Concrete, dated deliverables you would share with your manager."}
    ],
    "rubric":[
      {"criterion":"Status update clarity","weight":30},
      {"criterion":"Skimmable structure","weight":30},
      {"criterion":"Risk framing","weight":20},
      {"criterion":"30-60-90 specificity","weight":20}
    ]
  }'::jsonb,
  quiz_passing_score = 70, quiz_max_attempts = 3, content_status = 'READY', review_status = 'PUBLISHED'
where title = 'Communication Skills for Consultants';

update public.training_lessons tl set
  summary = v.summary, exercises = v.exercises::jsonb, key_takeaways = v.key_takeaways::jsonb, content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Send a trust-building weekly status update.',
     '[{"prompt":"Write this week''s status email using the shipped / on-deck / blockers / metric template.","expected_outcome":"A four-section email led by what shipped, with one metric.","hints":["Send every Friday","Lead with shipped, not attempted"]}]',
     '["Send the status every Friday afternoon","Lead with what shipped","A risks section prevents steering-meeting surprises","Include one metric that proves momentum"]'),
    (1, 'Run a kickoff that sets the tone.',
     '[{"prompt":"Draft a 30-minute kickoff agenda and the follow-up notes you would send within 4 hours.","expected_outcome":"An agenda plus notes with action items, owners, and dates.","hints":["Do not over-promise on day 1","Restate their goals in your words"]}]',
     '["Send kickoff notes within 4 hours","Do not over-promise or discuss rates on day 1","Restate the client goals in your own words","Set the communication cadence early"]'),
    (2, 'Write skimmable async messages.',
     '[{"prompt":"Rewrite a rambling update into the inverted-pyramid structure with a bold TL;DR.","expected_outcome":"A one-sentence TL;DR, then bullets, then detail.","hints":["Exec reads in ~20 seconds","Recommendation before rationale"]}]',
     '["You are writing for an exec who reads in ~20 seconds","Bold one-sentence TL;DR at the top","Inverted pyramid: TL;DR, recommendation, why, caveats","Most readers never reach the detail"]'),
    (3, 'Raise risks without losing the engagement.',
     '[{"prompt":"Script a risk conversation using shared goal, data, two options, ask-for-decision.","expected_outcome":"A four-step script that ends in a decision request.","hints":["Say the constraint is, not I cannot","Never bring a problem without two options"]}]',
     '["Lead with the shared goal","State the data, then offer two options","Ask for a decision","Never bring a problem without two options"]'),
    (4, 'Get value from your 1:1 and manage scope.',
     '[{"prompt":"Write your five-bullet 1:1 agenda and a 30-60-90 list for your current engagement.","expected_outcome":"A learner-owned agenda plus dated 30/60/90 deliverables.","hints":["The 1:1 is your meeting","Update the 30-60-90 every 1:1"]}]',
     '["Treat the 1:1 as your meeting; bring the agenda","Bring a win, a risk, an ask, a question, feedback","The 30-60-90 list defends against scope drift","Update it every 1:1"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'Communication Skills for Consultants' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'When should the weekly status email be sent?', '["Friday afternoon, every week","Only when something shipped","Once a month","Never"]', 'Friday afternoon, every week', 'Send it every Friday, even if nothing shipped (say so).'),
  (0, 1, 'What should you lead the status update with?', '["What shipped","What you attempted","Excuses","Rate negotiations"]', 'What shipped', 'Lead with shipped work, not what you tried.'),
  (0, 2, 'Why include a risks/blockers section?', '["So the client is never surprised in a steering meeting","To complain","To pad the email","No reason"]', 'So the client is never surprised in a steering meeting', 'Surfacing risks early prevents surprises later.'),
  (1, 0, 'Within how long should you send kickoff notes?', '["Within 4 hours","Within a week","Never","Within 30 days"]', 'Within 4 hours', 'Send notes with action items, owners, and dates within 4 hours.'),
  (1, 1, 'What should you NOT do on day 1?', '["Over-promise or bring up rate negotiations","Listen to their goals","Restate goals","Set a cadence"]', 'Over-promise or bring up rate negotiations', 'Avoid over-promising and rate talk in the kickoff.'),
  (1, 2, 'After hearing their goals, you should do what?', '["Restate them in your own words","Ignore them","Quietly change them","Email them next week"]', 'Restate them in your own words', 'Restating confirms you heard the goals correctly.'),
  (2, 0, 'What goes at the top of a skimmable message?', '["A one-sentence bolded TL;DR","The detailed explanation","Alternatives considered","Nothing"]', 'A one-sentence bolded TL;DR', 'Lead with a bold one-sentence TL;DR.'),
  (2, 1, 'What is the inverted-pyramid order?', '["TL;DR, recommendation, why, caveats, alternatives","Why first, then TL;DR","Alternatives first","Random"]', 'TL;DR, recommendation, why, caveats, alternatives', 'Most important first; detail last.'),
  (2, 2, 'Who are you writing the async update for?', '["An exec who reads in about 20 seconds","A compiler","Only yourself","A search engine"]', 'An exec who reads in about 20 seconds', 'Write for a busy reader who skims.'),
  (3, 0, 'How should you open a risk conversation?', '["Lead with the shared goal","Assign blame","Say I cannot","Avoid it"]', 'Lead with the shared goal', 'Start from the shared goal, then the data.'),
  (3, 1, 'You should never bring a problem without what?', '["Two options","An apology","A lawyer","A deadline"]', 'Two options', 'Always bring at least two options and ask for a decision.'),
  (3, 2, 'Instead of saying I cannot, what should you say?', '["The constraint is","It is not my fault","Maybe later","Nothing"]', 'The constraint is', 'Frame limits as constraints, not refusals.'),
  (4, 0, 'Whose meeting is the 1:1?', '["Yours; you bring the agenda","Your manager''s only","HR''s","Nobody''s"]', 'Yours; you bring the agenda', 'Treat the 1:1 as your meeting and drive it.'),
  (4, 1, 'What does the 30-60-90 list defend against?', '["Scope drift","Layoffs","Taxes","Bugs"]', 'Scope drift', 'A shared 30-60-90 list keeps scope honest.'),
  (4, 2, 'Which is one of the five 1:1 agenda bullets?', '["One ask for help or to unblock","Your salary demand","Office gossip","The weather"]', 'One ask for help or to unblock', 'The agenda includes a win, a risk, an ask, a question, and feedback.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'Communication Skills for Consultants'
  and not exists (select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question);

-- =============================================================================
-- 6) OPT / STEM-OPT COMPLIANCE PLAYBOOK
-- =============================================================================
update public.training_courses set
  overview = 'The OPT / STEM-OPT Compliance Playbook is a working reference for F-1 consultants: OPT eligibility and the EAD, the 90-day unemployment clock, SEVIS reporting, the STEM extension and the I-983, self-evaluations, the H-1B cap-gap, travel rules, and audit-readiness. This is a reference playbook, not legal advice — for case-specific questions consult your DSO and a qualified immigration attorney. The output is a personal monthly compliance checklist.',
  target_audience = 'F-1 students/consultants on OPT or STEM-OPT and the managers who supervise them.',
  roadmap = '[
    {"phase":"OPT basics","duration_label":"Week 1","focus_areas":["Eligibility, EAD, 90-day clock","SEVIS reporting","Unemployment limits"]},
    {"phase":"STEM extension","duration_label":"Week 2","focus_areas":["I-983 prerequisites","Self-evaluations"]},
    {"phase":"Transition + audit","duration_label":"Week 3","focus_areas":["H-1B cap-gap","Travel and reentry","Audit-readiness"]}
  ]'::jsonb,
  resources = '[
    {"title":"USCIS Optional Practical Training","url":"https://www.uscis.gov/working-in-the-united-states/students-and-exchange-visitors/optional-practical-training-opt-for-f-1-students","type":"DOC"},
    {"title":"Form I-983 (Study Plan for STEM OPT)","url":"https://studyinthestates.dhs.gov/stem-opt-hub/additional-resources/form-i-983-overview","type":"DOC"},
    {"title":"SEVP Portal","url":"https://sevp.ice.gov/opt","type":"TOOL"},
    {"title":"Study in the States — STEM OPT Hub","url":"https://studyinthestates.dhs.gov/stem-opt-hub","type":"DOC"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Build your personal OPT/STEM-OPT compliance system: an unemployment-day tracker, a SEVIS-change checklist, an I-983 working file, and a monthly review block on your calendar.",
    "questions":[
      {"prompt":"Create the unemployment-day tracker and record your EAD start/end dates and 90/150-day budgets.","guidance":"Two columns: date and status (EMPLOYED/UNEMPLOYED); sum monthly."},
      {"prompt":"List the SEVIS-reportable changes and confirm your current record is accurate.","guidance":"Employer, supervisor, address, hours, I-983 updates within 10 days."},
      {"prompt":"Start an I-983 working file mapping weekly deliverables to your training objectives.","guidance":"Concrete deliverables, not I have learned a lot."}
    ],
    "rubric":[
      {"criterion":"Unemployment tracking","weight":30},
      {"criterion":"SEVIS reporting accuracy","weight":25},
      {"criterion":"I-983 / evaluation readiness","weight":25},
      {"criterion":"Recordkeeping + monthly review","weight":20}
    ]
  }'::jsonb,
  quiz_passing_score = 70, quiz_max_attempts = 3, content_status = 'READY', review_status = 'PUBLISHED'
where title = 'OPT / STEM-OPT Compliance Playbook';

update public.training_lessons tl set
  summary = v.summary, exercises = v.exercises::jsonb, key_takeaways = v.key_takeaways::jsonb, content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Know your EAD dates and the 90-day clock.',
     '[{"prompt":"Log your EAD start and end dates in a calendar with a 90-day unemployment budget tracker.","expected_outcome":"A tracker showing days used vs the 90-day limit.","hints":["You cannot work before the EAD start date","The clock starts the day after EAD start"]}]',
     '["OPT is 12 months per degree level","Your EAD (Form I-766) is the work authorization","Do not work before the EAD start date","90 cumulative unemployment days on initial OPT"]'),
    (1, 'Report every change to your DSO within 10 days.',
     '[{"prompt":"Log into the SEVP Portal and confirm your employer, address, and supervisor are accurate.","expected_outcome":"A verified, current SEVIS record.","hints":["Updating LinkedIn is not reporting","Report within 10 days"]}]',
     '["Report changes within 10 days","Reporting means your DSO enters it into SEVIS","Report employer/supervisor/address/hours changes","STEM students report I-983 updates"]'),
    (2, 'Track unemployment days carefully.',
     '[{"prompt":"Build a spreadsheet with date and status (EMPLOYED/UNEMPLOYED) and sum unemployed days monthly.","expected_outcome":"A running unemployment-day total against your limit.","hints":["150 days total across OPT + STEM","Qualifying work must relate to your degree"]}]',
     '["150 cumulative unemployment days across OPT + STEM","Qualifying employment must relate to your degree","Volunteer/unpaid related work can count with documentation","Weekends count if the surrounding period qualifies"]'),
    (3, 'Meet the STEM prerequisites and the I-983.',
     '[{"prompt":"Pull a blank I-983 and draft specific training objectives (4-6 skills/methodologies).","expected_outcome":"Specific, defensible objectives, not generic statements.","hints":["Employer must be in E-Verify","Different person signs as supervisor vs employee"]}]',
     '["Employer must be enrolled in E-Verify","The I-983 sets up the 24-month STEM period","Training objectives must be specific","Update the I-983 on role/supervisor changes"]'),
    (4, 'Write strong 12-month and final evaluations.',
     '[{"prompt":"Start a STEM-OPT working file and drop 3 weekly bullets mapped to I-983 objectives.","expected_outcome":"A running file you can paste into the evaluation at month 12.","hints":["Due 12 months after start","Submit to DSO within 10 days"]}]',
     '["The 12-month evaluation is due 12 months after start","Submit to your DSO within 10 days","Map each objective to specific deliverables","Avoid vague phrases like I learned a lot"]'),
    (5, 'Bridge to H-1B with cap-gap.',
     '[{"prompt":"Identify the first fiscal year you are H-1B-cap eligible and the registration window.","expected_outcome":"A dated plan discussed with your employer ~4 months ahead.","hints":["Cap-gap needs a Change of Status","Do not travel during cap-gap"]}]',
     '["Cap-gap auto-extends OPT to Sept 30 with a timely COS filing","It must be a Change of Status, not Consular Processing","Request a cap-gap I-20 after selection","Do not travel internationally during cap-gap"]'),
    (6, 'Travel and reenter safely.',
     '[{"prompt":"Photograph every reentry document and store it in a phone-accessible folder.","expected_outcome":"A travel folder with passport, visa, endorsed I-20, EAD, offer letter, pay stubs.","hints":["I-20 travel endorsement within 6 months","Carry a job offer letter dated within 30 days"]}]',
     '["Carry an I-20 endorsed for travel within 6 months","Carry a job offer letter dated within 30 days","Do not travel without a job or during a pending COS","Re-entry during cap-gap forces consular processing"]'),
    (7, 'Stay audit-ready every month.',
     '[{"prompt":"Block 10 minutes on the first of every month titled OPT compliance and run the checklist.","expected_outcome":"A recurring review covering changes, unemployment, working file, and eval dates.","hints":["Keep records 3 years past F-1 termination","Store encrypted with a backup"]}]',
     '["Keep I-20s/EAD/I-983/evals 3 years past termination","Store encrypted with an external backup","Do a 10-minute monthly review","Sign the 12-month/final evaluation on schedule"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'OPT / STEM-OPT Compliance Playbook' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'How many months of OPT are available per degree level?', '["12 months","24 months","6 months","36 months"]', '12 months', 'OPT provides 12 months per degree level (plus the STEM extension).'),
  (0, 1, 'What is your actual work authorization document?', '["The EAD card (Form I-766)","The I-20","The passport","The visa stamp"]', 'The EAD card (Form I-766)', 'The EAD (I-766) authorizes employment with printed start/end dates.'),
  (0, 2, 'How many cumulative unemployment days are allowed on initial OPT?', '["90 days","150 days","30 days","Unlimited"]', '90 days', 'Initial OPT allows up to 90 cumulative days of unemployment.'),
  (1, 0, 'Within how many days must changes be reported to your DSO?', '["10 days","30 days","90 days","1 day"]', '10 days', 'SEVIS-reportable changes must be reported within 10 days.'),
  (1, 1, 'What actually counts as reporting a change?', '["Your DSO entering it into SEVIS","Updating LinkedIn","Telling a coworker","Doing nothing"]', 'Your DSO entering it into SEVIS', 'The change must reach SEVIS via your DSO or the SEVP Portal.'),
  (1, 2, 'Which of these must be reported?', '["Employer, supervisor, or address change","Only a legal name change","Nothing for STEM students","Personal hobbies"]', 'Employer, supervisor, or address change', 'Employer/supervisor/address/hours changes are all reportable.'),
  (2, 0, 'What is the total unemployment limit across OPT + STEM?', '["150 days","90 days","240 days","Unlimited"]', '150 days', 'The combined OPT + STEM unemployment limit is 150 days.'),
  (2, 1, 'Must qualifying employment relate to your degree?', '["Yes, it must be related","No","Only for paid roles","Only for STEM"]', 'Yes, it must be related', 'Qualifying employment must be related to the degree.'),
  (2, 2, 'Does volunteer or unpaid work count as employment?', '["Yes, if related to your degree and documented","Never","Only if paid","Only abroad"]', 'Yes, if related to your degree and documented', 'Unpaid related work counts with a role description and supervisor letter.'),
  (3, 0, 'What employer enrollment is required for the STEM extension?', '["E-Verify","SOC 2","ISO 27001","None"]', 'E-Verify', 'The employer must be enrolled in E-Verify, with no exceptions.'),
  (3, 1, 'Which document sets up the 24-month STEM period?', '["The I-983 training plan","The I-20","The EAD","The W-2"]', 'The I-983 training plan', 'The I-983 defines objectives, oversight, and evaluations.'),
  (3, 2, 'What is a common I-983 mistake?', '["Generic training objectives","Too much specific detail","Signing the form","Listing real skills"]', 'Generic training objectives', 'DHS wants specific skills/methodologies, not vague goals.'),
  (4, 0, 'When is the first STEM evaluation due?', '["12 months after the start date","6 months after","24 months after","Monthly"]', '12 months after the start date', 'The 12-month self-evaluation is due 12 months after the STEM-OPT start.'),
  (4, 1, 'Within how many days must you submit a completed evaluation to your DSO?', '["10 days","30 days","90 days","1 day"]', '10 days', 'Submit the completed evaluation within 10 days.'),
  (4, 2, 'What should an evaluation map objectives to?', '["Specific deliverables","Vague statements","Nothing","Your salary"]', 'Specific deliverables', 'Map each I-983 objective to concrete deliverables.'),
  (5, 0, 'What does the H-1B cap-gap do?', '["Auto-extends OPT to Sept 30 with a timely COS H-1B filing","Grants a green card","Extends F-1 forever","Nothing"]', 'Auto-extends OPT to Sept 30 with a timely COS H-1B filing', 'Cap-gap bridges work authorization to the H-1B start date.'),
  (5, 1, 'Cap-gap requires which kind of petition?', '["Change of Status (not Consular Processing)","Consular Processing","Any petition","An O-1"]', 'Change of Status (not Consular Processing)', 'Cap-gap requires a timely-filed Change of Status petition.'),
  (5, 2, 'During cap-gap you may NOT do what?', '["Travel internationally","Work","Get paid","Report to your DSO"]', 'Travel internationally', 'International travel during cap-gap forces consular processing.'),
  (6, 0, 'Which document must be endorsed for travel within the last 6 months?', '["The I-20 (travel endorsement)","The W-2","A pay stub","The diploma"]', 'The I-20 (travel endorsement)', 'Carry an I-20 with a travel endorsement under 6 months old.'),
  (6, 1, 'When should you NOT travel?', '["When you have no job or an H-1B COS is pending","Travel is always safe","Only in summer","It is never an issue"]', 'When you have no job or an H-1B COS is pending', 'No job or a pending COS makes reentry risky.'),
  (6, 2, 'What dated document should you carry on reentry?', '["A job offer letter dated within 30 days","A 5-year-old letter","Nothing","Only a diploma"]', 'A job offer letter dated within 30 days', 'Carry a recent offer letter plus pay stubs on reentry.'),
  (7, 0, 'How long should you keep I-20s, EAD, and I-983 records?', '["Forever, or 3 years past F-1 termination","One month","Until graduation","Never"]', 'Forever, or 3 years past F-1 termination', 'Retain key records at least 3 years past F-1 termination.'),
  (7, 1, 'What monthly cadence does the playbook recommend?', '["A 10-minute monthly compliance review","Yearly only","Never","Daily"]', 'A 10-minute monthly compliance review', 'A 10-minute monthly review keeps you audit-ready.'),
  (7, 2, 'Where should you store compliance records?', '["Encrypted Drive plus an external backup","Only in email","On paper only","Nowhere"]', 'Encrypted Drive plus an external backup', 'Store encrypted with a separate backup, not just email.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'OPT / STEM-OPT Compliance Playbook'
  and not exists (select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question);

NOTIFY pgrst, 'reload schema';
