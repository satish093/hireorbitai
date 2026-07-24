-- HireOrbit AI — add AI / Data Science / Data Engineering courses to the
-- Training catalog, with full I-983 STEM-OPT metadata and lessons.
--
-- New courses (all DRAFT-safe to start; flipped to ACTIVE on insert):
--   1. Python for Data Science                  (Data Science)
--   2. Machine Learning Engineering              (Machine Learning)
--   3. Generative AI + LLM Application Engineering (AI)
--   4. Data Engineering Foundations              (Data Engineering)
--   5. Modern SQL + Analytics Engineering        (SQL / Data Engineering)
--
-- Each course carries:
--   - learning_objectives, skills_taught, assessment_methods,
--     stem_relevance, weekly_hours  (I-983 Section 6 source)
--   - 5–6 ordered lessons with substantive content rendered by LessonBody
--
-- Idempotent. Safe to re-run.

-- ===========================================================================
-- 1. Python for Data Science
-- ===========================================================================
insert into public.training_courses (
  title, description, category, difficulty, estimated_duration_hours,
  tags, status, learning_objectives, skills_taught, assessment_methods,
  stem_relevance, weekly_hours
)
select
  'Python for Data Science',
  'Hands-on introduction to the Python data stack. By the end you can load, clean, explore, visualize, and model tabular data with NumPy, pandas, matplotlib, and scikit-learn.',
  'Data Science', 'BEGINNER', 28,
  array['python','numpy','pandas','matplotlib','scikit-learn','jupyter'],
  'ACTIVE',
  array[
    'Manipulate vectorized numerical data with NumPy arrays and broadcasting',
    'Load, join, group, and reshape tabular data with pandas DataFrames',
    'Produce publication-quality charts with matplotlib and seaborn',
    'Perform exploratory data analysis (EDA) on a real dataset and write the findings',
    'Train, evaluate, and tune a classical ML model with scikit-learn pipelines',
    'Package an analysis as a reproducible Jupyter notebook with a requirements.txt'
  ],
  array[
    'Python 3','NumPy','pandas','matplotlib','seaborn','Jupyter','scikit-learn',
    'Train/test split','Cross-validation','Pipeline + ColumnTransformer','EDA','Data cleaning'
  ],
  array[
    'End-of-module multiple-choice quiz (≥80% passing)',
    'EDA notebook: students submit a notebook on a provided CSV with cleaning + EDA + 3 charts',
    'Modeling capstone: classification pipeline scored on a held-out test set',
    'Supervisor review of notebook readability + reproducibility'
  ],
  'Directly applies the statistics, linear algebra, and programming coursework from the student''s Data Science / Statistics / Applied Math / CS degree. Builds the core Python data fluency that every data science / ML / data-engineering role requires on day one.',
  6
where not exists (
  select 1 from public.training_courses where title = 'Python for Data Science'
);

insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, l.title, l.description, l.content, l.lesson_order, l.estimated_minutes
from public.training_courses c
join (values
  (0, 'NumPy + the vectorized mindset', '90 minutes', 'WHY VECTORIZE
Vectorization is the difference between a 30-minute Python loop and a 30-millisecond NumPy call. Almost every other library in the data stack — pandas, scikit-learn, PyTorch — sits on top of NumPy''s ndarray.

CORE OBJECTS
- ndarray: an n-dimensional, homogeneous-dtype array stored in a contiguous C buffer
- shape, dtype, strides: the three pieces of metadata that define how the buffer is interpreted
- views vs copies: slicing returns a view; .copy() returns a new buffer

BROADCASTING RULES
1. Align shapes from the trailing dimension
2. Either the dimensions are equal, or one of them is 1
3. The dimension of size 1 is "stretched" without allocating memory

PRACTICAL EXAMPLES
- z-score normalization in one line: (X - X.mean(axis=0)) / X.std(axis=0)
- pairwise distance with broadcasting: ((A[:, None] - B[None, :]) ** 2).sum(-1)

WHEN TO DROP TO PYTHON
- Per-row work that has unavoidable branches
- Calls into pure-Python libraries (regex, json)
Even then, use np.vectorize as a clear documentation of intent — not a speed optimization.', 30),
  (1, 'pandas: Series, DataFrames, and the index', '90 minutes', 'WHAT MAKES PANDAS DIFFERENT
A pandas DataFrame is a NumPy block of typed columns plus an Index. The Index is the secret weapon: it makes joins, reshapes, and time-series alignment fast.

LOADING DATA
- pd.read_csv / read_parquet / read_excel — always pass dtype= and parse_dates=
- For files >100MB, use parquet, not CSV

SELECTING ROWS / COLUMNS
- df["col"]            single column → Series
- df[["a","b"]]        multiple columns → DataFrame
- df.loc[label, "col"] label-based
- df.iloc[i, j]        positional

SPLIT-APPLY-COMBINE
- groupby("city").agg({"sales": "sum", "users": "nunique"})
- The "split-apply-combine" pattern subsumes 90% of SQL''s GROUP BY queries

JOINS
- merge(left, right, how="left", on="user_id") behaves like SQL LEFT JOIN
- Always check df.shape before and after — accidental fan-outs are the #1 bug

RESHAPING
- melt() = wide → long
- pivot_table() = long → wide
You will use both in nearly every project.', 30),
  (2, 'Visualization that actually communicates', '60 minutes', 'CHART CHOICE BY QUESTION
- Distribution of one variable → histogram or KDE
- Relationship of two variables → scatter
- Comparison of categories → bar (NOT pie)
- Trend over time → line
- Composition over time → stacked area
- 2-D distribution → hexbin or 2-D histogram

MATPLOTLIB FUNDAMENTALS
- fig, ax = plt.subplots() — always work with the explicit ax, never plt globals in a notebook you''ll re-run
- ax.set_xlabel / ax.set_ylabel / ax.set_title — every chart, every time
- fig.savefig(path, dpi=150, bbox_inches="tight") — for embedding in docs

SEABORN ON TOP
seaborn.histplot, seaborn.boxplot, seaborn.scatterplot — high-level wrappers that pick reasonable defaults. Use seaborn for fast exploration; drop to matplotlib for the publication version.

ANTI-PATTERNS TO AVOID
- 3-D pie charts
- Truncated y-axis on a bar chart
- More than 7 colors in one legend', 30),
  (3, 'Exploratory data analysis on a real dataset', '120 minutes', 'A DISCIPLINED EDA WORKFLOW
1. df.info() + df.describe() — types and ranges
2. Missingness map (sns.heatmap(df.isna()))
3. Univariate distribution of every numeric column
4. Univariate distribution of every categorical column
5. Pairwise relationships of the top 5 candidate features
6. Target leakage check: is anything correlated 1.0 with the label?
7. Train/test split BEFORE the next step
8. Encoding plan + cleaning plan written down

DOCUMENTATION
Treat the EDA notebook as the audit trail. Every cell answers a written question. Every chart has a caption.

CAPSTONE DATASET
You will be given a real dataset (e.g. Ames Housing or Kaggle Titanic). Produce a notebook that:
- describes the data
- documents at least 3 cleaning decisions and why
- includes at least 5 charts
- ends with a hypothesis you would test next', 45),
  (4, 'scikit-learn pipelines + cross-validation', '120 minutes', 'WHY PIPELINES
A Pipeline binds preprocessing + model into one estimator. That gives you:
- a single .fit() / .predict() interface
- correct fit-on-train, transform-on-test semantics (no leakage)
- one object to serialize with joblib

ANATOMY OF A GOOD PIPELINE
preprocess = ColumnTransformer([
  ("num", StandardScaler(), num_cols),
  ("cat", OneHotEncoder(handle_unknown="ignore"), cat_cols),
])
pipe = Pipeline([("prep", preprocess), ("model", LogisticRegression())])

EVALUATION
- Cross-validate with StratifiedKFold for classification, KFold for regression
- Report mean ± std, not a single number
- Use the right metric: ROC-AUC for ranking, F1 for imbalanced, RMSE for regression

HYPERPARAMETER SEARCH
- GridSearchCV for ≤2 hyperparameters
- RandomizedSearchCV for higher-dimensional search
- Always pass the pipeline (not the bare model) into the search

ANTI-PATTERNS
- Fitting the scaler on the whole dataset before splitting
- Tuning hyperparameters on the test set
- Reporting accuracy on a 95%-imbalanced dataset', 45),
  (5, 'Packaging the analysis: notebooks → projects', '60 minutes', 'WHY PACKAGE
Notebooks rot. Six months from now you will be asked to reproduce the chart in cell 47 — and the kernel is gone, the data file moved, and pandas had a breaking release.

THE MINIMUM REPRODUCIBLE PROJECT
project/
  data/                 — local cache (gitignored)
  notebooks/01_eda.ipynb
  notebooks/02_model.ipynb
  src/preprocess.py
  src/train.py
  requirements.txt
  README.md             — how to recreate every result

REQUIREMENTS.TXT
- Pin major + minor versions: pandas==2.2.*, scikit-learn==1.5.*
- Use a fresh virtualenv to verify it actually installs

NOTEBOOK HYGIENE
- Restart kernel + run-all before you commit
- nbstripout to strip outputs from git diffs
- jupytext to mirror .ipynb ↔ .py for code review', 30)
) as l(lesson_order, title, description, content, estimated_minutes)
on c.title = 'Python for Data Science'
where not exists (
  select 1 from public.training_lessons tl where tl.course_id = c.id and tl.lesson_order = l.lesson_order
);

-- ===========================================================================
-- 2. Machine Learning Engineering
-- ===========================================================================
insert into public.training_courses (
  title, description, category, difficulty, estimated_duration_hours,
  tags, status, learning_objectives, skills_taught, assessment_methods,
  stem_relevance, weekly_hours
)
select
  'Machine Learning Engineering',
  'From notebook to production. Learn how to train, evaluate, deploy, and monitor classical ML models — with the engineering discipline that separates a Kaggle entry from a system on call.',
  'Machine Learning', 'INTERMEDIATE', 40,
  array['ml','sklearn','mlflow','docker','fastapi','monitoring'],
  'ACTIVE',
  array[
    'Frame a business problem as a learning task and define the right evaluation metric',
    'Engineer features with a reproducible pipeline (no train/test leakage)',
    'Train + evaluate models with proper cross-validation and statistical significance',
    'Track experiments, parameters, metrics, and artifacts with MLflow',
    'Serve a trained model behind a FastAPI endpoint in a Docker container',
    'Monitor a live model for input drift, output drift, and stale features'
  ],
  array[
    'Problem framing','Feature engineering','Cross-validation','Hyperparameter tuning',
    'XGBoost / LightGBM','MLflow','Model serving (FastAPI + Docker)','Drift monitoring',
    'A/B testing for ML','Shadow deployment','Calibration','Threshold tuning'
  ],
  array[
    'Quiz on metric selection + evaluation pitfalls',
    'Capstone 1: trained model + MLflow experiment log + writeup',
    'Capstone 2: dockerized FastAPI service with /predict + /health endpoints',
    'Supervisor review of the run-book + on-call playbook for the deployed model'
  ],
  'Production ML is the bridge between the CS / Statistics / Data Science degree coursework and a real engineering role. This module covers the engineering responsibilities — testing, deployment, monitoring — that academic projects skip.',
  8
where not exists (
  select 1 from public.training_courses where title = 'Machine Learning Engineering'
);

insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, l.title, l.description, l.content, l.lesson_order, l.estimated_minutes
from public.training_courses c
join (values
  (0, 'Framing the problem + picking the metric', '60 minutes', 'BEFORE YOU TRAIN ANYTHING
The most common ML failure is solving the wrong problem. Spend the first day on the framing, not the model.

FRAMING CHECKLIST
- Who is the user, and what decision changes because of the model?
- What is the unit of prediction (one user / one transaction / one session)?
- What is the label, and who labels it?
- What is the cost of a false positive vs a false negative?
- Is there a non-ML baseline (a rule, an old report) — and what does it score?

METRIC SELECTION
- Balanced classification → accuracy or ROC-AUC
- Imbalanced classification → precision/recall, F1, or PR-AUC
- Ranking → NDCG, MAP, MRR
- Regression → RMSE (penalizes big misses) or MAE (robust)
- Probabilistic → log-loss + calibration plot

OFFLINE vs ONLINE
Pick one offline metric for model selection and one online metric for production impact. They are rarely the same. Reconcile them at deploy time.', 30),
  (1, 'Features without leakage', '90 minutes', 'TRAIN/TEST LEAKAGE IS THE #1 BUG
Any information about the future that is not available at prediction time will inflate offline scores and crater production performance.

COMMON LEAKS
- Standardizing using the whole dataset (fit on train only)
- Target encoding without out-of-fold computation
- Including a column that is derived from the label
- Time-series with a random split instead of a forward-only split

THE PIPELINE DISCIPLINE
preprocess = ColumnTransformer([...])
pipe = Pipeline([("prep", preprocess), ("model", XGBClassifier())])
cross_val_score(pipe, X_train, y_train, cv=StratifiedKFold(5))

FEATURE STORES
For team-scale projects, move beyond ad-hoc DataFrames into a feature store (Feast, Tecton, or a simple table + materialization job). The feature store guarantees the training-serving feature parity that prevents drift bugs.', 45),
  (2, 'Tracking experiments with MLflow', '60 minutes', 'WHY YOU NEED A TRACKER
Once you''ve trained 20 models, "which one was that 0.84 RMSE again?" becomes unanswerable. MLflow gives you a searchable record of every run.

MLflow concepts:
- Experiment: a named bucket of runs
- Run: one fit() invocation, with params + metrics + artifacts
- Model: a versioned artifact in a model registry

MINIMAL WORKFLOW
with mlflow.start_run():
  mlflow.log_params(params)
  pipe.fit(X_tr, y_tr)
  preds = pipe.predict(X_val)
  mlflow.log_metric("val_rmse", rmse(y_val, preds))
  mlflow.sklearn.log_model(pipe, "model")

GOLDEN RULES
- Log the git SHA on every run (mlflow.log_param("git_sha", sha))
- Log the dataset hash on every run
- Promote to "staging" before "production"', 30),
  (3, 'Serving a model behind FastAPI + Docker', '120 minutes', 'WHY A REAL SERVER, NOT A SCRIPT
The model needs a versioned, healthchecked, observable endpoint that the rest of the system can call.

MINIMAL FASTAPI APP
@app.post("/predict")
def predict(req: PredictRequest):
  features = transform(req)
  proba = MODEL.predict_proba(features)[0, 1]
  return {"score": float(proba), "model_version": MODEL_VERSION}

@app.get("/health")
def health():
  return {"ok": True, "model_version": MODEL_VERSION}

DOCKERIZE
FROM python:3.11-slim
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ /app
WORKDIR /app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]

PRODUCTION CHECKLIST
- Load the model once at startup; never per-request
- Validate request payload with pydantic
- Time + log every prediction (latency + score histogram)
- /health endpoint that fails when the model is not loaded', 45),
  (4, 'Monitoring: drift, calibration, and decay', '90 minutes', 'MODELS DECAY
The real world changes. Even a perfect model''s performance degrades. You need monitoring to know before the user does.

INPUT DRIFT
- Track feature distributions per day
- KS-test or PSI between today vs the training distribution
- Alert at PSI > 0.2

OUTPUT DRIFT
- Track the daily mean predicted score
- A 20% shift without a corresponding business reason is a red flag

LABEL DELAY
- For models where the label arrives later (e.g. churn), monitor the proxy that arrives sooner
- Backfill the true metric weekly and compare to your proxy

CALIBRATION
- Plot mean predicted probability vs actual rate by decile
- If a model says "80% likely" but actuals are 50%, the threshold-based decisions are wrong even if AUC is fine

WHAT TO PUT ON A DASHBOARD
- Daily request volume
- p50 / p95 / p99 latency
- Feature PSI heatmap
- Score-distribution timeline
- Live evaluation metric (when labels exist)', 45),
  (5, 'Deployment patterns + rollback', '60 minutes', 'SHADOW DEPLOYMENT
Run the new model alongside the old one in production, return only the old one''s answer to the user, and log both for offline comparison. Zero user risk.

CANARY ROLLOUT
Route 1% → 5% → 25% → 100% of traffic to the new model with an automated metric gate at each step. If business KPIs degrade, halt.

A/B TEST
Run an explicit experiment: 50/50 split, compute the lift on the user-facing metric, ship if and only if the lift is significant.

ROLLBACK PROCEDURE
- Keep the previous model''s container image tagged and warm
- The deployment system must be able to flip the routing in <1 minute
- Have a written run-book that any on-call engineer can follow at 3am', 30)
) as l(lesson_order, title, description, content, estimated_minutes)
on c.title = 'Machine Learning Engineering'
where not exists (
  select 1 from public.training_lessons tl where tl.course_id = c.id and tl.lesson_order = l.lesson_order
);

-- ===========================================================================
-- 3. Generative AI + LLM Application Engineering
-- ===========================================================================
insert into public.training_courses (
  title, description, category, difficulty, estimated_duration_hours,
  tags, status, learning_objectives, skills_taught, assessment_methods,
  stem_relevance, weekly_hours
)
select
  'Generative AI + LLM Application Engineering',
  'Build production LLM applications: from prompt engineering and RAG, to tool use, agents, evaluation, and cost / latency control. Engineering-led — not prompt-hacking.',
  'AI', 'INTERMEDIATE', 32,
  array['llm','rag','agents','anthropic','openai','tools','evaluation'],
  'ACTIVE',
  array[
    'Choose between zero-shot, few-shot, RAG, fine-tuning, and tool-use for a given problem',
    'Build a retrieval-augmented generation pipeline: chunk, embed, store, retrieve, ground',
    'Design and implement tool-use loops with safe function definitions',
    'Build a multi-turn agent with a budget, a stop condition, and a transcript',
    'Author offline + online evaluations (LLM-as-judge, golden datasets, regression suite)',
    'Control cost and latency with caching, batching, and the right model tier'
  ],
  array[
    'Prompt engineering','Few-shot examples','Function / tool calling',
    'Retrieval-augmented generation','Vector databases (pgvector / Pinecone)',
    'Embeddings','Chunking strategies','Agent loops','LLM evaluation',
    'Anthropic SDK','OpenAI SDK','Cost + latency optimization','Prompt caching'
  ],
  array[
    'Quiz on when to use RAG vs fine-tune vs prompt-only',
    'RAG capstone: ingest a doc set, build a /ask endpoint, ship eval results',
    'Agent capstone: a tool-using agent that completes a 3-step real task end-to-end',
    'Supervisor review of evaluation suite + cost / latency report'
  ],
  'LLM application engineering is the highest-leverage applied AI skill of the current cycle. It directly extends the NLP / CS / Information Systems coursework in the student''s degree and is one of the most-requested skills in current STEM-OPT engagements.',
  6
where not exists (
  select 1 from public.training_courses where title = 'Generative AI + LLM Application Engineering'
);

insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, l.title, l.description, l.content, l.lesson_order, l.estimated_minutes
from public.training_courses c
join (values
  (0, 'How to think about LLMs as components', '60 minutes', 'LLM = STATELESS, NONDETERMINISTIC, EXPENSIVE FUNCTION
Treat the LLM as a fast-but-flaky API call. Every design decision falls out of those three properties.

CAPABILITY LADDER
1. Prompt-only — cheapest, lowest control
2. Few-shot examples — slightly more control, more tokens
3. Tool use — model decides what tools to call
4. RAG — ground the model in fresh / private data
5. Agents — multi-step plans
6. Fine-tuning — last resort, when prompts cap out

CHOOSING A TIER
- "Summarize a doc" → prompt-only
- "Answer questions about our docs" → RAG
- "Find a flight and book it" → tool use
- "Triage a customer email and write the reply" → tool use + RAG
- "Output exactly this JSON schema 99% of the time" → structured outputs / fine-tune

KEY MENTAL MODELS
- Tokens are money. Cache, batch, and trim.
- Context window is finite. Compress before you stuff.
- The model lies confidently. Add a verifier.', 30),
  (1, 'Prompt engineering that holds up in production', '60 minutes', 'STRUCTURE BEATS CLEVERNESS
A production prompt looks more like a function signature than a paragraph.

THE 5 BLOCKS OF A PROMPT
1. Role / persona (one line)
2. Task (imperative, single sentence)
3. Inputs (clearly delimited with XML tags)
4. Constraints / format (bullet list)
5. Output schema (literal example)

XML DELIMITERS
Anthropic recommends XML tags because they are robust to user-supplied content collision.
<task>Summarize the document</task>
<document>{{user_text}}</document>
<format>Plain text, 3 bullets, <100 words.</format>

FEW-SHOT
3 examples is the sweet spot. More than 5 starts costing more than it gains.

ANTI-PATTERNS
- "Please respond as detailed as possible" — burns tokens with no quality lift
- Mixing system + user roles to "trick" the model — tomorrow''s safety update breaks it
- Unbounded user content inside the system prompt — prompt injection waiting to happen', 30),
  (2, 'Retrieval-augmented generation, end-to-end', '120 minutes', 'WHEN TO USE RAG
- Your data is private, fresh, or too large for the context window
- You need citations
- You need answers to update when the data updates (no re-train)

THE 6 STEPS
1. Ingest: pull docs from source-of-truth (Drive, Notion, S3)
2. Chunk: split into semantic pieces (typically 300–800 tokens)
3. Embed: send each chunk through an embedding model
4. Store: write (chunk, vector, metadata) into a vector DB
5. Retrieve: at query time, embed the question, get top-K chunks
6. Generate: pass {question, retrieved chunks} into the LLM with strict grounding instructions

CHUNKING
- By heading (best for structured docs)
- By sentence-window (best for legal / dense prose)
- Overlap chunks by 10–20% to avoid cutting context

VECTOR STORE
- pgvector if you''re already on Postgres (we are)
- Pinecone, Qdrant, Weaviate if you need scale + filters
- For ≤50k chunks, a plain numpy array of vectors is fine

GROUNDING THE PROMPT
"Answer using ONLY the provided context. If the context does not contain the answer, say so." — verified by an eval.', 45),
  (3, 'Tool use + structured outputs', '90 minutes', 'WHY TOOL USE
The model decides which function to call and with what arguments. You execute the function and return the result. Loop until done.

TOOL DEFINITION (Anthropic SDK)
tools = [{
  "name": "get_weather",
  "description": "Get the weather for a city",
  "input_schema": {
    "type": "object",
    "properties": {"city": {"type": "string"}},
    "required": ["city"]
  }
}]

THE LOOP
1. Send the user message + tools
2. Receive a response — either text or a tool_use block
3. If tool_use, execute the function, append a tool_result, loop
4. If text, return to the user

STRUCTURED OUTPUTS
client.messages.parse() with a Zod / pydantic schema gives you a typed, validated object back. Use this any time the downstream code needs reliable JSON.

SAFETY
- Treat every tool argument as untrusted user input
- Whitelist allowed tool names
- Cap the loop at a max-iteration count
- Log every tool call', 45),
  (4, 'Evaluation: the actual hard part', '90 minutes', 'WHY EVALS MATTER
Without eval, you can''t tell if a prompt change made the system better or worse. You will ship regressions.

THREE LEVELS OF EVAL
1. Unit-style: golden inputs → exact expected outputs (regex / equality)
2. LLM-as-judge: a stronger model grades the response against a rubric
3. Human review: a human spot-checks 10–20% of production traffic

BUILDING A GOLDEN SET
- 50 questions covering the realistic distribution of user asks
- Include hard cases: ambiguous, multi-step, out-of-scope
- Version-controlled JSON file

REGRESSION HARNESS
def run_eval(prompt_version):
  results = []
  for q in golden:
    answer = pipeline.run(q, prompt_version)
    judge = grade(q.expected_rubric, answer)
    results.append(judge)
  return mean(results)

ONLINE EVAL
- Thumbs-up / thumbs-down in the UI
- Latency + cost per request
- Tool-use success rate
- Refusal / hallucination rate (sampled)', 45),
  (5, 'Cost + latency control', '60 minutes', 'TOKEN ECONOMICS
Every prompt has a baseline cost. A 5K-token system prompt sent on every request will outweigh a 1K-token user prompt by 5x.

LEVERS
- Prompt caching: Anthropic caches stable prefixes. Put system + tools + examples first.
- Right-sized model: Haiku for classification + extraction, Sonnet for most agentic work, Opus for the hard step that justifies the cost
- Streaming: cuts perceived latency without changing total tokens
- Batching: for non-interactive workloads (eval, backfills), Batches API at 50% off

PROMPT CACHING (CRITICAL)
With Anthropic''s prompt caching:
- 90% discount on cached tokens
- TTL of 5 minutes by default
- Cache breaks on any byte change in the cached prefix
Put stable content first, volatile content last, and place a cache_control breakpoint between them.

LATENCY BUDGETS
- p50 target: <1s for chat
- p95 target: <3s for chat
- Use a faster model for the first turn, escalate only if needed

OBSERVABILITY
Log {request_id, model, input_tokens, output_tokens, cached_tokens, latency_ms} on every call.', 30)
) as l(lesson_order, title, description, content, estimated_minutes)
on c.title = 'Generative AI + LLM Application Engineering'
where not exists (
  select 1 from public.training_lessons tl where tl.course_id = c.id and tl.lesson_order = l.lesson_order
);

-- ===========================================================================
-- 4. Data Engineering Foundations
-- ===========================================================================
insert into public.training_courses (
  title, description, category, difficulty, estimated_duration_hours,
  tags, status, learning_objectives, skills_taught, assessment_methods,
  stem_relevance, weekly_hours
)
select
  'Data Engineering Foundations',
  'Build the pipelines that move data from source systems to a warehouse. Covers batch + streaming, schema design, Airflow orchestration, Spark/dbt transforms, and data quality.',
  'Data Engineering', 'INTERMEDIATE', 40,
  array['airflow','spark','dbt','snowflake','kafka','data-quality'],
  'ACTIVE',
  array[
    'Design a layered data warehouse (raw → staging → marts) with clear contracts',
    'Author an idempotent, restartable Airflow DAG that lands data into the warehouse',
    'Write a Spark job that processes a 10GB+ dataset on a small cluster',
    'Model star + snowflake schemas and decide between them by access pattern',
    'Build dbt models with tests, documentation, and CI on pull request',
    'Implement data-quality checks (Great Expectations / soda) with alerting',
    'Reason about batch vs streaming and pick the right one for a use case'
  ],
  array[
    'Apache Airflow','Apache Spark (PySpark)','dbt','SQL data modeling',
    'Snowflake / BigQuery / Redshift','Kafka basics','Avro / Parquet',
    'Data contracts','Idempotency','Backfilling','Great Expectations',
    'CDC (change data capture)'
  ],
  array[
    'Quiz on warehouse layering + idempotency',
    'Capstone 1: a full Airflow → Spark → warehouse pipeline ingesting a public dataset',
    'Capstone 2: a dbt project with documented marts + 10+ tests passing in CI',
    'Supervisor review of the data contract + on-call run-book'
  ],
  'Data engineering is the back-bone of every analytics, ML, and AI workload. Directly extends the database / distributed systems / software engineering coursework from a CS / Data Engineering / IS degree and is one of the highest-demand STEM-OPT roles.',
  8
where not exists (
  select 1 from public.training_courses where title = 'Data Engineering Foundations'
);

insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, l.title, l.description, l.content, l.lesson_order, l.estimated_minutes
from public.training_courses c
join (values
  (0, 'The warehouse layer model', '60 minutes', 'WHY LAYERS
A data warehouse has three layers because each layer answers a different question:

RAW (a.k.a. landing / bronze)
- A 1:1 copy of source data, append-only, with ingestion timestamp
- Never deleted, never reshaped — this is the audit trail
- Schema-on-read

STAGING (a.k.a. silver)
- Cleaned, typed, deduped
- One row per business entity / event
- Schema-on-write
- This is where you fix the "phone numbers come in 4 formats" problem

MARTS (a.k.a. gold)
- Business-question-shaped tables: f_orders, d_customers, etc.
- Dimensional model (star schema in 90% of cases)
- This is what analysts and BI tools read

WHY THIS MATTERS
- You can re-run the staging + marts layers from raw at any time
- Schema breaks in source data are contained to staging
- Analysts and engineers don''t fight over the same tables', 30),
  (1, 'Airflow DAGs that survive a restart', '90 minutes', 'IDEMPOTENCY IS A LAW
Every task must produce the same output whether it runs once or three times. If it doesn''t, you can''t backfill, you can''t retry, and you can''t recover.

PATTERN: WRITE-THEN-RENAME
1. Compute into a temp table / temp path
2. Atomically swap into place
This makes the task safely retryable.

PATTERN: DELETE-THEN-INSERT BY PARTITION
For partition-aware sinks:
DELETE FROM target WHERE dt = ''{{ds}}'';
INSERT INTO target SELECT ... WHERE dt = ''{{ds}}'';

DAG BEST PRACTICES
- Tasks should be ≤30 minutes each
- Never put business logic in operators — call into a library
- Tag every DAG with owner + on-call
- Set retries=2, retry_delay=300s
- Set sla on critical tasks

BACKFILLS
- Use catchup=False on new DAGs
- Use airflow dags backfill for explicit historical re-runs', 45),
  (2, 'Spark: shuffles, partitions, and skew', '90 minutes', 'SPARK MENTAL MODEL
A Spark job is a DAG of stages. A stage boundary is a shuffle. Shuffles are expensive. Most performance problems are shuffle problems.

THE 3 KILLER OPERATIONS
- groupBy → shuffle on the key
- join → shuffle on the join key (unless broadcast)
- repartition → explicit shuffle

PARTITIONING RULES OF THUMB
- Aim for ~128MB per partition
- Too few partitions → some executors idle
- Too many partitions → metadata + scheduler overhead

DATA SKEW
- One key with 90% of the rows → one executor does 90% of the work
- Mitigations: salting the key, broadcast join, isolate the skewed key

BROADCAST JOIN
For a join where one side is <10MB, broadcast() the small side. Eliminates the shuffle entirely.

FILE FORMATS
- Use Parquet, not CSV
- Use Snappy compression
- Partition output by the column you filter on most', 45),
  (3, 'Dimensional modeling for analytics', '90 minutes', 'STAR vs SNOWFLAKE
- Star: fact table + denormalized dimensions. Faster, simpler. Default choice.
- Snowflake: dimensions normalized further. Use only for very large, slowly-changing dimensions.

FACT TABLE
- One row per event / measurement
- Grain documented at the top of the model file
- Foreign keys to every relevant dimension
- Additive measures preferred (sums roll up cleanly)

DIMENSION TABLE
- One row per entity (customer, product)
- Use SCD-2 (Slowly Changing Dimension type 2) when you need history:
  - effective_from, effective_to, is_current
  - new row for every change

NAMING
- f_orders, f_sessions — fact
- d_customers, d_products — dimension
- date_key on every fact

GRAIN
The single most important question: "what does one row of this table mean?" Write it in the dbt model description.', 45),
  (4, 'dbt: SQL transforms with engineering discipline', '90 minutes', 'WHY dbt
dbt turns SQL into a project with version control, tests, docs, and CI. It is the standard for the transformation step.

PROJECT STRUCTURE
models/
  staging/    — one model per source table, lightly cleaned
  intermediate/ — joins between staging models
  marts/      — final business-ready models
tests/        — singular tests
seeds/        — small CSVs you want in the warehouse
macros/       — reusable SQL

KEY DBT FEATURES
- ref() and source() — automatic DAG construction
- {{ config(materialized="incremental") }} — for large tables
- schema.yml — declarative tests (not_null, unique, accepted_values, relationships)
- dbt docs generate / dbt docs serve — auto-generated data lineage

CI ON PULL REQUEST
- dbt build --select state:modified+ — runs only what changed
- Tests must pass before merge
- Comment the PR with the generated docs', 45),
  (5, 'Data quality + on-call', '60 minutes', 'A BROKEN PIPELINE IS A SLEEPLESS NIGHT
A bad day in data engineering looks like: silent column drop → analytics dashboard reads zero → CEO gets a wrong number → you find out from Slack at 9pm.

LAYER 1: SOURCE-CONTRACT TESTS
- not_null on every primary key
- unique on every primary key
- accepted_values on every enum
- relationships on every foreign key
Run on every load.

LAYER 2: STATISTICAL TESTS
- Row count today vs row count 7-day median
- Mean of numeric column vs 7-day median
- Tools: Great Expectations, soda-core

LAYER 3: BUSINESS-RULE TESTS
- "total revenue today must equal sum of orders today"
- "no order has shipped_at < placed_at"

ALERTING
- PagerDuty for SLA-critical pipelines (the ones the business reads in the morning)
- Slack-only for warm pipelines
- Every alert has a run-book link', 30)
) as l(lesson_order, title, description, content, estimated_minutes)
on c.title = 'Data Engineering Foundations'
where not exists (
  select 1 from public.training_lessons tl where tl.course_id = c.id and tl.lesson_order = l.lesson_order
);

-- ===========================================================================
-- 5. Modern SQL + Analytics Engineering
-- ===========================================================================
insert into public.training_courses (
  title, description, category, difficulty, estimated_duration_hours,
  tags, status, learning_objectives, skills_taught, assessment_methods,
  stem_relevance, weekly_hours
)
select
  'Modern SQL + Analytics Engineering',
  'Write production analytics SQL that is correct, fast, and maintainable. Covers window functions, CTEs, query plans, indexing strategy, and the analytics-engineer workflow.',
  'SQL', 'INTERMEDIATE', 24,
  array['sql','window-functions','query-planning','indexing','dbt','analytics'],
  'ACTIVE',
  array[
    'Use CTEs, window functions, and lateral joins to express analytics in a single readable query',
    'Read a query plan (EXPLAIN ANALYZE) and identify the slowest operation',
    'Choose the right index for a query (b-tree, partial, multi-column, covering)',
    'Reshape data with PIVOT / UNPIVOT and array / json operators',
    'Write SQL tests (not_null, unique, accepted_values, relationships)',
    'Model SCD-2 (slowly changing dimension type 2) for analytical history'
  ],
  array[
    'Advanced SQL','Window functions','CTEs','Lateral joins','EXPLAIN ANALYZE',
    'Indexing','PostgreSQL','BigQuery','Snowflake','dbt','SCD-2 modeling'
  ],
  array[
    'Quiz on window-function semantics',
    'Lab: rewrite a slow 4-table query — beat the baseline runtime by 5x',
    'Capstone: a small dbt project with 5 models + 10+ tests on a real dataset',
    'Supervisor review of one EXPLAIN ANALYZE walkthrough'
  ],
  'Advanced SQL is the universal language of analytics, data engineering, and back-end engineering. Directly extends the database systems coursework in the CS / IS / Data Engineering degree, and is the single most-requested skill on STEM-OPT engagements after the primary language.',
  4
where not exists (
  select 1 from public.training_courses where title = 'Modern SQL + Analytics Engineering'
);

insert into public.training_lessons (course_id, title, description, content, lesson_order, estimated_minutes)
select c.id, l.title, l.description, l.content, l.lesson_order, l.estimated_minutes
from public.training_courses c
join (values
  (0, 'Window functions: the analytics power tool', '90 minutes', 'WHY WINDOW FUNCTIONS
GROUP BY collapses rows. Window functions don''t — they compute over a window of rows while preserving the original row count. That makes them the right tool for rankings, running totals, moving averages, and lag/lead comparisons.

ANATOMY
fn(...) OVER (
  PARTITION BY col
  ORDER BY col
  ROWS BETWEEN n PRECEDING AND CURRENT ROW
)

KEY FUNCTIONS
- ROW_NUMBER() — assigns a unique rank
- RANK() / DENSE_RANK() — handles ties differently
- LAG(col) / LEAD(col) — previous / next row''s value
- SUM(col) OVER (PARTITION BY x ORDER BY t) — running total
- AVG(col) OVER (ORDER BY t ROWS 6 PRECEDING) — 7-day moving avg

PRACTICAL EXAMPLES
- "Each customer''s first 5 orders" → ROW_NUMBER() OVER (PARTITION BY customer ORDER BY placed_at)
- "% of total by category" → SUM(amt) OVER () in the denominator
- "Sessionize events" → SUM(new_session) OVER (PARTITION BY user ORDER BY t)', 45),
  (1, 'CTEs and readable query structure', '60 minutes', 'A WELL-STRUCTURED QUERY READS LIKE PROSE
Most production SQL queries become unreadable because they are written as one giant statement. CTEs (WITH clauses) fix that.

PATTERN: ONE CTE PER LOGICAL STEP
WITH active_users AS (...),
     monthly_orders AS (...),
     ranked AS (...)
SELECT * FROM ranked WHERE r = 1;

NAMING
- Name each CTE after what it produces, not how it computes
- One CTE = one bullet on the whiteboard

CTEs ARE FREE IN MODERN ENGINES
Postgres 12+, BigQuery, Snowflake, Redshift — the optimizer inlines CTEs. No materialization penalty.

RECURSIVE CTEs
Use sparingly — for hierarchies (org charts, threaded comments) and graph walks.
WITH RECURSIVE chain AS (
  SELECT id, parent_id FROM categories WHERE id = $1
  UNION ALL
  SELECT c.id, c.parent_id FROM categories c JOIN chain ON c.id = chain.parent_id
)
SELECT * FROM chain;', 30),
  (2, 'Reading a query plan', '90 minutes', 'WHY EXPLAIN MATTERS
The query that ran in 200ms on your laptop and 200 seconds in prod is almost always doing a different physical plan. EXPLAIN ANALYZE is how you find out.

EXPLAIN ANALYZE vs EXPLAIN
- EXPLAIN: estimated plan (cheap)
- EXPLAIN ANALYZE: actual plan + actual times (runs the query)

THE OPERATIONS YOU MUST KNOW
- Seq Scan: full table scan — usually bad on large tables
- Index Scan: uses an index — usually good
- Index Only Scan: serves the query from the index alone — best case
- Bitmap Index Scan: scans multiple indexes, OR-merges
- Nested Loop: good when one side is tiny
- Hash Join: good when one side fits in memory
- Merge Join: good when both sides are already sorted
- Sort: expensive on large inputs
- Materialize: spills a CTE to disk

WHAT TO LOOK FOR
- Rows estimate vs Rows actual differing by >100x → bad statistics, ANALYZE the table
- A Seq Scan on a table > 100k rows that has a filter → missing index
- A Sort with "disk" → work_mem too low, or query needs an index ordered by the sort key', 45),
  (3, 'Indexing strategy', '90 minutes', 'PICK INDEXES FROM QUERIES, NOT FROM SCHEMAS
Don''t guess. Look at the slowest queries (pg_stat_statements) and design indexes to make those queries fast.

INDEX TYPES
- B-tree: default, supports =, <, >, BETWEEN, ORDER BY
- Hash: only =, rarely worth it
- GIN: full-text + jsonb + array containment
- BRIN: huge, naturally-ordered tables (time-series)
- Partial: WHERE clause baked in: CREATE INDEX … WHERE status = ''ACTIVE''
- Covering (INCLUDE): index also stores extra columns so the query needs no heap fetch

MULTI-COLUMN INDEXES
- Order matters: (a, b) helps WHERE a=$ and WHERE a=$ AND b=$, but not WHERE b=$ alone
- Equality columns first, range columns last
- Most-selective column first

COST OF INDEXES
- Slow down INSERT / UPDATE / DELETE
- Bloat the WAL
- Take disk + buffer cache
Rule: never add an index without a measured query benefit.', 45),
  (4, 'JSON + arrays in SQL', '60 minutes', 'WHY USE THEM
Sometimes the natural data shape is a list or a nested document. JSON columns let you store it without forcing a separate table.

POSTGRES
- jsonb column type (binary; prefer over json)
- col->>''field''  → text
- col->''field''   → jsonb (chainable)
- @> containment: col @> ''{"status":"active"}''
- ?  key-exists, ?& all keys, ?| any keys
- jsonb_array_elements(col) → unnest an array into rows
- GIN index on the column for fast containment lookups

ARRAYS
- col integer[] — typed array
- col @> ARRAY[1,2] — containment
- unnest(col) — array → rows

WHEN NOT TO USE
- You need to query individual list elements heavily by index/value → normalize into a child table
- You need foreign-key integrity to the array elements → normalize', 30),
  (5, 'SCD-2 and analytics history', '60 minutes', 'WHY HISTORY
Customers change emails. Products change prices. A naive "current" table loses history; an SCD-2 model preserves it.

SCD-2 SHAPE
d_customers (
  customer_id,
  customer_sk          -- surrogate key, one per version
  ...attributes...,
  effective_from timestamptz,
  effective_to   timestamptz,
  is_current     boolean
)

LOOKUP RULES
- "What was the customer''s email on 2024-09-12?" → WHERE effective_from <= ''2024-09-12'' AND (effective_to > ''2024-09-12'' OR effective_to IS NULL)
- "Today''s view" → WHERE is_current

dbt MAKES THIS EASY
dbt''s snapshot feature handles SCD-2 mechanics. Define the source query + the unique key + the strategy, and dbt manages effective_from / effective_to.

JOIN PATTERN
fact_orders f LEFT JOIN d_customers c
  ON f.customer_id = c.customer_id
 AND f.placed_at >= c.effective_from
 AND (f.placed_at < c.effective_to OR c.effective_to IS NULL)', 30)
) as l(lesson_order, title, description, content, estimated_minutes)
on c.title = 'Modern SQL + Analytics Engineering'
where not exists (
  select 1 from public.training_lessons tl where tl.course_id = c.id and tl.lesson_order = l.lesson_order
);

-- ===========================================================================
-- Final touches
-- ===========================================================================
notify pgrst, 'reload schema';
