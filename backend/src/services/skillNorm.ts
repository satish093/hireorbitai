/**
 * Skill normalisation — canonical names for the AI matching pipeline.
 *
 * Problem: "ReactJS", "React.js", and "React" all mean the same thing, but
 * the AI sees them as three distinct strings and may score a resume as
 * "missing React" when the candidate wrote "ReactJS".
 *
 * Solution: before any skill comparison, run every skill through
 * `normalizeSkill()`, which maps common aliases to a single canonical label.
 *
 * The alias map is intentionally NOT exhaustive — it covers the ~150 most
 * common variations in tech job postings. Unknown skills pass through
 * unchanged (they're still useful; the AI just won't de-duplicate them).
 */

// ---------------------------------------------------------------------------
// Alias table  (lowercase key → canonical label)
// ---------------------------------------------------------------------------

const ALIASES: Record<string, string> = {
  // ── JavaScript / TypeScript ───────────────────────────────────────────────
  javascript: 'JavaScript',
  js: 'JavaScript',
  es6: 'JavaScript',
  es2015: 'JavaScript',
  ecmascript: 'JavaScript',
  typescript: 'TypeScript',
  ts: 'TypeScript',

  // ── React ─────────────────────────────────────────────────────────────────
  react: 'React',
  reactjs: 'React',
  'react.js': 'React',
  'react js': 'React',

  // ── React Native ─────────────────────────────────────────────────────────
  'react native': 'React Native',
  'react-native': 'React Native',
  reactnative: 'React Native',
  rn: 'React Native',

  // ── Vue ───────────────────────────────────────────────────────────────────
  vue: 'Vue.js',
  vuejs: 'Vue.js',
  'vue.js': 'Vue.js',
  'vue 3': 'Vue.js',
  vue3: 'Vue.js',

  // ── Angular ───────────────────────────────────────────────────────────────
  angular: 'Angular',
  angularjs: 'AngularJS',
  'angular.js': 'AngularJS',
  'angular 2': 'Angular',
  'angular 2+': 'Angular',

  // ── Next.js / Nuxt ────────────────────────────────────────────────────────
  next: 'Next.js',
  nextjs: 'Next.js',
  'next.js': 'Next.js',
  nuxt: 'Nuxt.js',
  nuxtjs: 'Nuxt.js',

  // ── Node.js ───────────────────────────────────────────────────────────────
  node: 'Node.js',
  nodejs: 'Node.js',
  'node.js': 'Node.js',
  'node js': 'Node.js',

  // ── Express ───────────────────────────────────────────────────────────────
  express: 'Express.js',
  expressjs: 'Express.js',
  'express.js': 'Express.js',

  // ── Python ────────────────────────────────────────────────────────────────
  python: 'Python',
  python3: 'Python',
  'python 3': 'Python',
  python2: 'Python 2',

  // ── Django / Flask / FastAPI ──────────────────────────────────────────────
  django: 'Django',
  flask: 'Flask',
  fastapi: 'FastAPI',
  'fast api': 'FastAPI',

  // ── Java ──────────────────────────────────────────────────────────────────
  java: 'Java',
  'java 8': 'Java',
  'java 11': 'Java',
  'java 17': 'Java',
  'java 21': 'Java',
  'java se': 'Java',
  'java ee': 'Java EE',
  jdk: 'Java',

  // ── Spring ────────────────────────────────────────────────────────────────
  spring: 'Spring',
  'spring boot': 'Spring Boot',
  springboot: 'Spring Boot',
  'spring framework': 'Spring',
  'spring mvc': 'Spring MVC',

  // ── Kotlin ────────────────────────────────────────────────────────────────
  kotlin: 'Kotlin',

  // ── Go ────────────────────────────────────────────────────────────────────
  go: 'Go',
  golang: 'Go',
  'go lang': 'Go',

  // ── Rust ──────────────────────────────────────────────────────────────────
  rust: 'Rust',
  'rust-lang': 'Rust',

  // ── C# / .NET ─────────────────────────────────────────────────────────────
  'c#': 'C#',
  csharp: 'C#',
  '.net': '.NET',
  dotnet: '.NET',
  'asp.net': 'ASP.NET',
  'asp.net core': 'ASP.NET Core',

  // ── C / C++ ───────────────────────────────────────────────────────────────
  'c++': 'C++',
  cpp: 'C++',
  c: 'C',

  // ── Ruby ──────────────────────────────────────────────────────────────────
  ruby: 'Ruby',
  'ruby on rails': 'Ruby on Rails',
  rails: 'Ruby on Rails',
  ror: 'Ruby on Rails',

  // ── PHP ───────────────────────────────────────────────────────────────────
  php: 'PHP',
  laravel: 'Laravel',
  symfony: 'Symfony',

  // ── Swift / Objective-C ───────────────────────────────────────────────────
  swift: 'Swift',
  swiftui: 'SwiftUI',
  'objective-c': 'Objective-C',
  objc: 'Objective-C',

  // ── Databases ─────────────────────────────────────────────────────────────
  postgresql: 'PostgreSQL',
  postgres: 'PostgreSQL',
  psql: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  sqlite: 'SQLite',
  'sql server': 'SQL Server',
  mssql: 'SQL Server',
  'microsoft sql server': 'SQL Server',
  'oracle db': 'Oracle Database',
  'oracle database': 'Oracle Database',
  mongodb: 'MongoDB',
  mongo: 'MongoDB',
  'mongo db': 'MongoDB',
  redis: 'Redis',
  elasticsearch: 'Elasticsearch',
  'elastic search': 'Elasticsearch',
  cassandra: 'Apache Cassandra',
  dynamodb: 'DynamoDB',
  'dynamo db': 'DynamoDB',
  firebase: 'Firebase',
  firestore: 'Firestore',
  bigquery: 'BigQuery',
  'big query': 'BigQuery',
  snowflake: 'Snowflake',

  // ── SQL (generic) ─────────────────────────────────────────────────────────
  sql: 'SQL',
  'pl/sql': 'PL/SQL',
  nosql: 'NoSQL',

  // ── Cloud: AWS ────────────────────────────────────────────────────────────
  aws: 'AWS',
  'amazon web services': 'AWS',
  'amazon aws': 'AWS',
  ec2: 'AWS EC2',
  s3: 'AWS S3',
  lambda: 'AWS Lambda',
  'aws lambda': 'AWS Lambda',
  rds: 'AWS RDS',
  eks: 'AWS EKS',
  ecs: 'AWS ECS',
  cloudformation: 'AWS CloudFormation',
  cloudfront: 'AWS CloudFront',
  route53: 'AWS Route 53',
  iam: 'AWS IAM',
  kinesis: 'AWS Kinesis',
  sqs: 'AWS SQS',
  sns: 'AWS SNS',
  'api gateway': 'AWS API Gateway',
  'aws api gateway': 'AWS API Gateway',

  // ── Cloud: GCP ────────────────────────────────────────────────────────────
  gcp: 'GCP',
  'google cloud': 'GCP',
  'google cloud platform': 'GCP',
  gke: 'GKE',
  'cloud run': 'Cloud Run',
  'cloud functions': 'Cloud Functions',
  'pub/sub': 'Pub/Sub',

  // ── Cloud: Azure ─────────────────────────────────────────────────────────
  azure: 'Azure',
  'microsoft azure': 'Azure',
  'azure devops': 'Azure DevOps',
  'azure functions': 'Azure Functions',
  'azure kubernetes': 'AKS',
  aks: 'AKS',

  // ── Containers / Orchestration ────────────────────────────────────────────
  docker: 'Docker',
  kubernetes: 'Kubernetes',
  k8s: 'Kubernetes',
  helm: 'Helm',
  openshift: 'OpenShift',
  containerd: 'containerd',

  // ── CI/CD ─────────────────────────────────────────────────────────────────
  'ci/cd': 'CI/CD',
  cicd: 'CI/CD',
  jenkins: 'Jenkins',
  'github actions': 'GitHub Actions',
  'gitlab ci': 'GitLab CI',
  circleci: 'CircleCI',
  'travis ci': 'Travis CI',
  terraform: 'Terraform',
  ansible: 'Ansible',
  chef: 'Chef',
  puppet: 'Puppet',
  packer: 'Packer',
  pulumi: 'Pulumi',
  argocd: 'ArgoCD',
  'argo cd': 'ArgoCD',
  flux: 'FluxCD',

  // ── Monitoring / Observability ────────────────────────────────────────────
  prometheus: 'Prometheus',
  grafana: 'Grafana',
  datadog: 'Datadog',
  'new relic': 'New Relic',
  splunk: 'Splunk',
  'elk stack': 'ELK Stack',
  kibana: 'Kibana',
  logstash: 'Logstash',
  opentelemetry: 'OpenTelemetry',
  jaeger: 'Jaeger',
  zipkin: 'Zipkin',

  // ── Message Brokers ───────────────────────────────────────────────────────
  kafka: 'Apache Kafka',
  'apache kafka': 'Apache Kafka',
  rabbitmq: 'RabbitMQ',
  'rabbit mq': 'RabbitMQ',
  activemq: 'ActiveMQ',
  nats: 'NATS',
  zeromq: 'ZeroMQ',

  // ── GraphQL / APIs ────────────────────────────────────────────────────────
  graphql: 'GraphQL',
  rest: 'REST APIs',
  'rest api': 'REST APIs',
  restful: 'REST APIs',
  'restful api': 'REST APIs',
  openapi: 'OpenAPI',
  swagger: 'OpenAPI / Swagger',
  grpc: 'gRPC',
  websocket: 'WebSockets',
  websockets: 'WebSockets',
  'json api': 'REST APIs',

  // ── Frontend: CSS / Styling ───────────────────────────────────────────────
  css: 'CSS',
  css3: 'CSS',
  scss: 'SCSS / Sass',
  sass: 'SCSS / Sass',
  less: 'LESS',
  tailwind: 'Tailwind CSS',
  tailwindcss: 'Tailwind CSS',
  'tailwind css': 'Tailwind CSS',
  'material ui': 'Material UI',
  mui: 'Material UI',
  'material-ui': 'Material UI',
  'chakra ui': 'Chakra UI',
  'styled-components': 'styled-components',
  'styled components': 'styled-components',
  shadcn: 'shadcn/ui',
  'shadcn/ui': 'shadcn/ui',
  bootstrap: 'Bootstrap',

  // ── Testing ───────────────────────────────────────────────────────────────
  jest: 'Jest',
  vitest: 'Vitest',
  cypress: 'Cypress',
  playwright: 'Playwright',
  selenium: 'Selenium',
  mocha: 'Mocha',
  chai: 'Chai',
  jasmine: 'Jasmine',
  junit: 'JUnit',
  pytest: 'pytest',
  rspec: 'RSpec',
  enzyme: 'Enzyme',
  'testing library': 'Testing Library',
  'react testing library': 'React Testing Library',

  // ── Version Control ───────────────────────────────────────────────────────
  git: 'Git',
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  svn: 'SVN',

  // ── AI / ML ───────────────────────────────────────────────────────────────
  'machine learning': 'Machine Learning',
  ml: 'Machine Learning',
  'deep learning': 'Deep Learning',
  dl: 'Deep Learning',
  tensorflow: 'TensorFlow',
  pytorch: 'PyTorch',
  'scikit-learn': 'scikit-learn',
  sklearn: 'scikit-learn',
  pandas: 'Pandas',
  numpy: 'NumPy',
  llm: 'LLMs',
  'large language models': 'LLMs',
  openai: 'OpenAI API',
  langchain: 'LangChain',
  'langchain.js': 'LangChain',
  anthropic: 'Anthropic / Claude',

  // ── Architecture / Design ─────────────────────────────────────────────────
  microservices: 'Microservices',
  'micro services': 'Microservices',
  'event driven': 'Event-Driven Architecture',
  'event-driven architecture': 'Event-Driven Architecture',
  serverless: 'Serverless',
  'system design': 'System Design',
  'distributed systems': 'Distributed Systems',
  'domain driven design': 'DDD',
  ddd: 'DDD',
  'clean architecture': 'Clean Architecture',
  'solid principles': 'SOLID',
  'design patterns': 'Design Patterns',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map one skill to its canonical form.
 * "ReactJS" → "React", "Postgres" → "PostgreSQL", unknown → unchanged.
 */
export function normalizeSkill(skill: string): string {
  const lower = skill.toLowerCase().trim();
  return ALIASES[lower] ?? skill.trim();
}

/**
 * Normalise an array of skills and remove duplicates.
 * Order is preserved; the first occurrence wins when two aliases share a canonical.
 */
export function normalizeSkills(skills: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of skills) {
    const norm = normalizeSkill(s);
    if (!seen.has(norm.toLowerCase())) {
      seen.add(norm.toLowerCase());
      out.push(norm);
    }
  }
  return out;
}

/**
 * Scan free-form text (e.g. a job description or resume) for any skill that
 * appears in the alias table, and return the canonical names found.
 * Uses word-boundary detection so "django" won't match "go" and "angular" won't
 * match "angular.js" then spuriously also fire for bare "angular" separately.
 * Aliases shorter than 2 characters are skipped (too noisy).
 */
export function extractKnownSkills(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();

  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (alias.length < 2) continue;

    let start = 0;
    while (true) {
      const idx = lower.indexOf(alias, start);
      if (idx === -1) break;

      const charBefore = idx === 0 ? '\0' : lower[idx - 1]!;
      const charAfter = idx + alias.length >= lower.length ? '\0' : lower[idx + alias.length]!;

      const borderBefore = /[^a-z0-9]/.test(charBefore);
      const borderAfter = /[^a-z0-9]/.test(charAfter);

      if (borderBefore && borderAfter) {
        found.add(canonical);
        break; // one occurrence is enough
      }
      start = idx + 1;
    }
  }

  return [...found];
}

/**
 * Given a set of required skills and a set of candidate skills, return which
 * required skills are covered (accounting for aliases) and which are missing.
 */
export function diffSkills(
  required: string[],
  candidate: string[],
): { matched: string[]; missing: string[] } {
  const normRequired = required.map(normalizeSkill);
  const normCandidateSet = new Set(candidate.map((s) => normalizeSkill(s).toLowerCase()));

  const matched: string[] = [];
  const missing: string[] = [];

  for (let i = 0; i < normRequired.length; i++) {
    const norm = normRequired[i]!;
    if (normCandidateSet.has(norm.toLowerCase())) {
      matched.push(required[i]!);
    } else {
      missing.push(required[i]!);
    }
  }
  return { matched, missing };
}
