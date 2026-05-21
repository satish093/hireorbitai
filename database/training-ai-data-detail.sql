-- =============================================================================
-- Training: full-LMS detail for the 5 data / AI courses (training-ai-data.sql)
-- =============================================================================
-- Completes Python for Data Science, Machine Learning Engineering, Generative
-- AI + LLM Application Engineering, Data Engineering Foundations, and Modern
-- SQL + Analytics Engineering to full-LMS depth: course overview / roadmap /
-- resources / capstone, per-lesson summary / exercises / key takeaways, and
-- per-lesson multiple-choice quizzes answerable from the lesson bodies that
-- already ship in training-ai-data.sql.
--
-- NON-DESTRUCTIVE + IDEMPOTENT (UPDATEs metadata only; quiz inserts guarded by
-- NOT EXISTS on (lesson_id, question)). Apply AFTER training-ai-data.sql and
-- the generated-content + versioning migrations.
-- =============================================================================

-- =============================================================================
-- 1) PYTHON FOR DATA SCIENCE
-- =============================================================================
update public.training_courses set
  overview = 'Python for Data Science is a hands-on tour of the Python data stack. You build the vectorized mindset with NumPy, manipulate tabular data with pandas, make charts that communicate, run a disciplined EDA on a real dataset, and train + evaluate a model with leakage-free scikit-learn pipelines — then package it so it still runs in six months. Aimed at engineers and STEM-OPT trainees moving into data roles.',
  target_audience = 'Engineers and STEM-OPT trainees starting in data analysis / data science.',
  roadmap = '[
    {"phase":"Arrays + tables","duration_label":"Week 1","focus_areas":["NumPy vectorization","pandas DataFrames"]},
    {"phase":"Explore + model","duration_label":"Week 2","focus_areas":["Visualization","EDA","scikit-learn pipelines"]},
    {"phase":"Ship","duration_label":"Week 3","focus_areas":["Reproducible projects"]}
  ]'::jsonb,
  resources = '[
    {"title":"NumPy documentation","url":"https://numpy.org/doc/stable/","type":"DOC"},
    {"title":"pandas documentation","url":"https://pandas.pydata.org/docs/","type":"DOC"},
    {"title":"scikit-learn user guide","url":"https://scikit-learn.org/stable/user_guide.html","type":"DOC"},
    {"title":"matplotlib","url":"https://matplotlib.org/stable/users/index.html","type":"DOC"},
    {"title":"seaborn","url":"https://seaborn.pydata.org/","type":"DOC"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Produce an EDA + modeling notebook on a provided dataset: describe the data, document cleaning decisions, include charts, then train and evaluate a leakage-free scikit-learn pipeline scored on a held-out test set.",
    "questions":[
      {"prompt":"Submit an EDA notebook with at least 3 documented cleaning decisions and 5 charts.","guidance":"Every cell answers a written question; every chart has a caption."},
      {"prompt":"Build a Pipeline (preprocess + model) and cross-validate it correctly.","guidance":"Fit on train only; report mean +/- std with the right metric."},
      {"prompt":"Score the final model on a held-out test set and discuss pitfalls.","guidance":"Avoid tuning on the test set; mind class imbalance."}
    ],
    "rubric":[
      {"criterion":"EDA quality + documentation","weight":30},
      {"criterion":"Leakage-free pipeline","weight":30},
      {"criterion":"Correct evaluation","weight":25},
      {"criterion":"Reproducibility","weight":15}
    ]
  }'::jsonb,
  quiz_passing_score = 70, quiz_max_attempts = 3, content_status = 'READY', review_status = 'PUBLISHED'
where title = 'Python for Data Science';

update public.training_lessons tl set
  summary = v.summary, exercises = v.exercises::jsonb, key_takeaways = v.key_takeaways::jsonb, content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Think in vectorized array operations.',
     '[{"prompt":"Z-score normalize a matrix in one line and compute pairwise distances with broadcasting.","expected_outcome":"Vectorized NumPy with no Python loops.","hints":["(X - X.mean(0)) / X.std(0)","Broadcasting aligns from the trailing dimension"]}]',
     '["The whole data stack sits on NumPy ndarray","Broadcasting needs equal dims or a dim of 1","Slicing returns a view; .copy() a new buffer","Vectorize instead of looping"]'),
    (1, 'Manipulate tabular data with pandas.',
     '[{"prompt":"Load a CSV with dtypes/parse_dates, then groupby a column and aggregate two measures.","expected_outcome":"A split-apply-combine result; shape checked before/after a merge.","hints":["Use parquet for >100MB","Check df.shape around merges"]}]',
     '["The Index makes joins/reshape/alignment fast","Use parquet over CSV for large files","split-apply-combine subsumes most GROUP BY","Check shape to catch accidental fan-outs"]'),
    (2, 'Choose charts that communicate.',
     '[{"prompt":"Pick the right chart for distribution, relationship, category comparison, and trend.","expected_outcome":"Histogram, scatter, bar, line respectively, with labels.","hints":["Use bar, not pie, for categories","Work with the explicit ax"]}]',
     '["Match the chart to the question","Use bar (not pie) to compare categories","Always set axis labels and title","Avoid truncated y-axes and 3-D pies"]'),
    (3, 'Run a disciplined EDA.',
     '[{"prompt":"Run the EDA workflow on a dataset and write down 3 cleaning decisions and a next hypothesis.","expected_outcome":"A documented notebook with a train/test split before encoding.","hints":["Check for a feature correlated 1.0 with the label","Split before the next step"]}]',
     '["Start with info()/describe() and a missingness map","Check for target leakage (1.0 correlation)","Split train/test before encoding decisions","Treat the notebook as an audit trail"]'),
    (4, 'Build leakage-free pipelines and evaluate them.',
     '[{"prompt":"Build a ColumnTransformer + model Pipeline and cross-validate with the right splitter.","expected_outcome":"Mean +/- std reported with an appropriate metric.","hints":["StratifiedKFold for classification","Pass the pipeline into the search, not the bare model"]}]',
     '["Pipelines give fit-on-train/transform-on-test correctness","Report mean +/- std, not one number","Pick the metric for the task (ROC-AUC/F1/RMSE)","Never fit the scaler before splitting"]'),
    (5, 'Turn notebooks into reproducible projects.',
     '[{"prompt":"Restructure a notebook into the minimum reproducible project layout with a pinned requirements.txt.","expected_outcome":"A project that reinstalls and reruns from a clean virtualenv.","hints":["Restart kernel + run-all before committing","nbstripout for clean diffs"]}]',
     '["Notebooks rot; package for reproducibility","Pin major+minor versions in requirements.txt","Restart kernel + run-all before committing","Use nbstripout/jupytext for clean git diffs"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'Python for Data Science' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'What does most of the Python data stack sit on top of?', '["NumPy''s ndarray","A SQL database","A web server","Excel"]', 'NumPy''s ndarray', 'pandas, scikit-learn, and PyTorch are built on the NumPy ndarray.'),
  (0, 1, 'Broadcasting requires dimensions to be equal or what?', '["One of them is 1","Both prime","Both even","At least three"]', 'One of them is 1', 'Dimensions must match or one must be 1 (which is stretched).'),
  (0, 2, 'What does slicing a NumPy array return?', '["A view, not a copy","A copy always","A Python list","A DataFrame"]', 'A view, not a copy', 'Slicing returns a view; use .copy() for a new buffer.'),
  (1, 0, 'What is the pandas Index described as?', '["The secret weapon enabling fast joins/reshape/alignment","A row counter only","A SQL table","Decorative"]', 'The secret weapon enabling fast joins/reshape/alignment', 'The Index powers fast joins, reshapes, and time alignment.'),
  (1, 1, 'For files over 100MB, which format is recommended?', '["Parquet","CSV","Excel","Plain JSON"]', 'Parquet', 'Parquet is columnar and far more efficient than CSV at scale.'),
  (1, 2, 'Which pandas pattern subsumes most SQL GROUP BY queries?', '["split-apply-combine (groupby/agg)","melt only","pivot only","iloc"]', 'split-apply-combine (groupby/agg)', 'groupby/agg implements split-apply-combine.'),
  (2, 0, 'To compare categories, which chart is recommended?', '["Bar","3-D pie","Scatter","Line"]', 'Bar', 'Use bar charts for category comparisons, not pie.'),
  (2, 1, 'In matplotlib, what should you work with explicitly?', '["The ax from plt.subplots()","Global plt state","seaborn only","No labels"]', 'The ax from plt.subplots()', 'Use the explicit ax object, not global plt state.'),
  (2, 2, 'Which is a visualization anti-pattern?', '["Truncated y-axis on a bar chart","Axis labels","A line chart for trends","A histogram for a distribution"]', 'Truncated y-axis on a bar chart', 'A truncated y-axis misleads; avoid it (and 3-D pies).'),
  (3, 0, 'When should you do the train/test split in the EDA workflow?', '["Before encoding/cleaning decisions that could leak","After modeling","Never","Only at the very end"]', 'Before encoding/cleaning decisions that could leak', 'Split before steps that could leak information from test into train.'),
  (3, 1, 'What is a target-leakage check looking for?', '["A feature correlated 1.0 with the label","Missing values","Too many charts","Slow code"]', 'A feature correlated 1.0 with the label', 'A near-perfect correlation with the label signals leakage.'),
  (3, 2, 'How should you treat the EDA notebook?', '["As an audit trail where every cell answers a question","As throwaway scratch","As the final model","As a chat log"]', 'As an audit trail where every cell answers a question', 'Document the EDA so it is reproducible and reviewable.'),
  (4, 0, 'Why use a scikit-learn Pipeline?', '["Correct fit-on-train/transform-on-test (no leakage) in one object","Faster CPU","Prettier code only","To avoid scikit-learn"]', 'Correct fit-on-train/transform-on-test (no leakage) in one object', 'Pipelines bind preprocessing and model with correct semantics.'),
  (4, 1, 'What should you report from cross-validation?', '["Mean +/- std, not a single number","A single accuracy","Train accuracy only","Nothing"]', 'Mean +/- std, not a single number', 'Report the mean and spread across folds.'),
  (4, 2, 'Which is a leakage anti-pattern?', '["Fitting the scaler on the whole dataset before splitting","Using ColumnTransformer","Using StratifiedKFold","Using a Pipeline"]', 'Fitting the scaler on the whole dataset before splitting', 'Fitting on all data before the split leaks test information.'),
  (5, 0, 'What should you do before committing a notebook?', '["Restart kernel and run-all","Nothing","Delete outputs only","Add more cells"]', 'Restart kernel and run-all', 'Restart-and-run-all proves the notebook reproduces top to bottom.'),
  (5, 1, 'How should requirements.txt pin versions?', '["Pin major+minor (e.g. pandas==2.2.*)","Never pin","Pin patch only","Pin nothing"]', 'Pin major+minor (e.g. pandas==2.2.*)', 'Pin major+minor and verify in a clean virtualenv.'),
  (5, 2, 'Which tool strips notebook outputs from git diffs?', '["nbstripout","pip","black","pytest"]', 'nbstripout', 'nbstripout removes outputs so diffs stay clean.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'Python for Data Science'
  and not exists (select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question);

-- =============================================================================
-- 2) MACHINE LEARNING ENGINEERING
-- =============================================================================
update public.training_courses set
  overview = 'Machine Learning Engineering takes you from notebook to production. You frame the problem and pick the right metric, engineer features without leakage, track experiments with MLflow, serve a model behind FastAPI in Docker, monitor it for drift and decay, and roll out (and back) safely with shadow/canary/A-B patterns. The throughline is the engineering discipline that separates a Kaggle entry from a system on call.',
  target_audience = 'Engineers and STEM-OPT trainees deploying and operating ML in production.',
  roadmap = '[
    {"phase":"Frame + features","duration_label":"Week 1","focus_areas":["Problem framing + metrics","Leakage-free features"]},
    {"phase":"Track + serve","duration_label":"Week 2","focus_areas":["MLflow","FastAPI + Docker serving"]},
    {"phase":"Operate","duration_label":"Week 3","focus_areas":["Monitoring + drift","Deployment + rollback"]}
  ]'::jsonb,
  resources = '[
    {"title":"scikit-learn user guide","url":"https://scikit-learn.org/stable/user_guide.html","type":"DOC"},
    {"title":"MLflow documentation","url":"https://mlflow.org/docs/latest/index.html","type":"DOC"},
    {"title":"FastAPI","url":"https://fastapi.tiangolo.com/","type":"DOC"},
    {"title":"Rules of Machine Learning (Google)","url":"https://developers.google.com/machine-learning/guides/rules-of-ml","type":"ARTICLE"},
    {"title":"Evidently (drift monitoring)","url":"https://docs.evidentlyai.com/","type":"TOOL"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Train a model with an MLflow experiment log, then serve it as a dockerized FastAPI service with /predict and /health, and write the on-call run-book for the deployed model.",
    "questions":[
      {"prompt":"Train + evaluate a model and log params/metrics/artifacts to MLflow (with git SHA + dataset hash).","guidance":"Promote to staging before production."},
      {"prompt":"Serve it behind FastAPI + Docker with /predict and /health and request validation.","guidance":"Load the model once at startup; validate with pydantic."},
      {"prompt":"Write the monitoring plan and on-call run-book (drift, calibration, rollback).","guidance":"Define alert thresholds and a sub-1-minute rollback."}
    ],
    "rubric":[
      {"criterion":"Framing + metric choice","weight":20},
      {"criterion":"Experiment tracking","weight":20},
      {"criterion":"Serving correctness","weight":30},
      {"criterion":"Monitoring + rollback plan","weight":30}
    ]
  }'::jsonb,
  quiz_passing_score = 70, quiz_max_attempts = 3, content_status = 'READY', review_status = 'PUBLISHED'
where title = 'Machine Learning Engineering';

update public.training_lessons tl set
  summary = v.summary, exercises = v.exercises::jsonb, key_takeaways = v.key_takeaways::jsonb, content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Frame the problem and pick the metric first.',
     '[{"prompt":"For a churn use case, write the framing checklist and pick offline + online metrics.","expected_outcome":"A unit of prediction, label source, FP/FN costs, baseline, and chosen metrics.","hints":["Imbalanced -> PR-AUC/F1","Compare to a non-ML baseline"]}]',
     '["The top failure is solving the wrong problem","Pick the metric for the task and balance","Have a non-ML baseline to beat","Reconcile offline vs online metrics at deploy"]'),
    (1, 'Engineer features without leakage.',
     '[{"prompt":"Convert a leaky preprocessing step into a Pipeline + ColumnTransformer cross-validated correctly.","expected_outcome":"No fit-on-all-data; time-series uses a forward-only split.","hints":["Fit the scaler on train only","Out-of-fold target encoding"]}]',
     '["Leakage is the #1 ML bug","Fit preprocessing on train only","Use forward-only splits for time series","Feature stores give train/serve parity"]'),
    (2, 'Track experiments with MLflow.',
     '[{"prompt":"Wrap a training run in mlflow.start_run() logging params, metrics, model, git SHA, and dataset hash.","expected_outcome":"A searchable run with a registered model.","hints":["log the git SHA every run","promote staging before production"]}]',
     '["A Run is one fit() with params/metrics/artifacts","Log git SHA + dataset hash every run","The registry versions models with stages","Without tracking, runs become unreproducible"]'),
    (3, 'Serve a model behind FastAPI + Docker.',
     '[{"prompt":"Build a FastAPI app with /predict and /health, validate input with pydantic, and dockerize it.","expected_outcome":"A container serving predictions with a real health check.","hints":["Load the model once at startup","/health fails when the model is not loaded"]}]',
     '["Load the model once at startup, not per request","Validate payloads with pydantic","/health should fail when the model is missing","Log latency + score on every prediction"]'),
    (4, 'Monitor for drift, calibration, and decay.',
     '[{"prompt":"Define the dashboard + alerts for input drift (PSI), output drift, and calibration.","expected_outcome":"Thresholds (e.g. PSI > 0.2) and a calibration-by-decile plot.","hints":["Track feature distributions daily","Watch the mean predicted score"]}]',
     '["Models decay as the world changes","Alert on input drift (PSI > 0.2)","Calibration matters even if AUC is fine","Monitor a proxy when labels arrive late"]'),
    (5, 'Deploy and roll back safely.',
     '[{"prompt":"Write the rollout + rollback plan using shadow, canary, and A/B with metric gates.","expected_outcome":"A staged rollout and a sub-1-minute rollback run-book.","hints":["Shadow = serve old, log both","Keep the previous image warm"]}]',
     '["Shadow deployment carries zero user risk","Canary rolls out with metric gates","A/B ships only on a significant lift","Rollback must flip routing in under a minute"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'Machine Learning Engineering' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'What is the most common ML failure?', '["Solving the wrong problem","Slow training","Too much data","Models that are too small"]', 'Solving the wrong problem', 'Most ML failures are framing failures, not modeling failures.'),
  (0, 1, 'For an imbalanced classification, which metric is appropriate?', '["Precision/recall, F1, or PR-AUC","Plain accuracy","RMSE","NDCG"]', 'Precision/recall, F1, or PR-AUC', 'Accuracy misleads on imbalance; use precision/recall/F1/PR-AUC.'),
  (0, 2, 'Why establish a non-ML baseline?', '["To know what the model must beat","To skip ML","For decoration","No reason"]', 'To know what the model must beat', 'A rule/old-report baseline sets the bar to beat.'),
  (1, 0, 'What is the number-one ML bug?', '["Train/test leakage","Slow code","Small batch size","Too many features"]', 'Train/test leakage', 'Future information leaking into training inflates offline scores.'),
  (1, 1, 'How should you fit a feature scaler?', '["On the training data only","On the whole dataset","Never","On the test set"]', 'On the training data only', 'Fit transforms on train only to avoid leakage.'),
  (1, 2, 'For time-series, which split is correct?', '["A forward-only split","A random split","No split","A reverse split"]', 'A forward-only split', 'Time-series must split forward in time, not randomly.'),
  (2, 0, 'What is an MLflow Run?', '["One fit() invocation with params, metrics, and artifacts","A database","A web server","The model registry"]', 'One fit() invocation with params, metrics, and artifacts', 'A Run records a single training invocation.'),
  (2, 1, 'What should you log on every run?', '["The git SHA and dataset hash","Nothing","Only accuracy","The entire dataset"]', 'The git SHA and dataset hash', 'Logging code + data identity makes runs reproducible.'),
  (2, 2, 'What does the model registry add?', '["Versioned model artifacts with stages (staging/production)","Faster training","Only a UI","Encryption"]', 'Versioned model artifacts with stages (staging/production)', 'The registry versions and stages models.'),
  (3, 0, 'When should you load the model in a serving app?', '["Once at startup","On every request","Never","Only on shutdown"]', 'Once at startup', 'Load once at startup; loading per request is slow.'),
  (3, 1, 'What should the /health endpoint do?', '["Fail when the model is not loaded","Always return 200","Return the model weights","Train the model"]', 'Fail when the model is not loaded', 'Health should reflect whether the model is ready.'),
  (3, 2, 'How should you validate the request payload?', '["With pydantic","Trust it blindly","Regex only","Not at all"]', 'With pydantic', 'Validate request bodies with pydantic models.'),
  (4, 0, 'What does input-drift monitoring track?', '["Feature distributions vs the training distribution","CPU usage","Disk space","Only latency"]', 'Feature distributions vs the training distribution', 'Compare today''s feature distributions to training (PSI/KS).'),
  (4, 1, 'A common PSI alert threshold is what?', '["PSI > 0.2","PSI > 100","PSI < 0","Never alert"]', 'PSI > 0.2', 'PSI above ~0.2 indicates meaningful drift.'),
  (4, 2, 'Why monitor calibration?', '["Threshold decisions can be wrong even if AUC is fine","To save money","It is optional","For speed"]', 'Threshold decisions can be wrong even if AUC is fine', 'Miscalibrated probabilities break threshold-based decisions.'),
  (5, 0, 'What is a shadow deployment?', '["Run the new model alongside the old, serve the old, log both","Delete the old model","Switch 100% immediately","Run an A/B test"]', 'Run the new model alongside the old, serve the old, log both', 'Shadow runs the new model with zero user risk.'),
  (5, 1, 'What does a canary rollout do?', '["Routes 1% to 5% to 25% to 100% with metric gates","Sends all traffic at once","Sends no traffic","Routes randomly"]', 'Routes 1% to 5% to 25% to 100% with metric gates', 'Canary increases traffic gradually behind gates.'),
  (5, 2, 'What must the rollback procedure allow?', '["Flipping routing back in under a minute","A week of downtime","Retraining first","Nothing"]', 'Flipping routing back in under a minute', 'Keep the previous image warm for fast rollback.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'Machine Learning Engineering'
  and not exists (select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question);

-- =============================================================================
-- 3) GENERATIVE AI + LLM APPLICATION ENGINEERING
-- =============================================================================
update public.training_courses set
  overview = 'Generative AI + LLM Application Engineering teaches you to build reliable apps on top of large language models. You learn to treat the LLM as a stateless, nondeterministic, expensive function; write production prompts; build retrieval-augmented generation end to end; use tools and structured outputs; evaluate rigorously; and control cost and latency with caching, batching, and the right model tier.',
  target_audience = 'Engineers and STEM-OPT trainees building LLM-powered application features.',
  roadmap = '[
    {"phase":"Foundations + prompting","duration_label":"Week 1","focus_areas":["LLMs as components","Production prompting"]},
    {"phase":"Grounding + tools","duration_label":"Week 2","focus_areas":["RAG end-to-end","Tool use + structured outputs"]},
    {"phase":"Quality + cost","duration_label":"Week 3","focus_areas":["Evaluation","Cost + latency control"]}
  ]'::jsonb,
  resources = '[
    {"title":"Anthropic documentation","url":"https://docs.anthropic.com/","type":"DOC"},
    {"title":"Anthropic prompt engineering guide","url":"https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview","type":"DOC"},
    {"title":"Prompt caching (Anthropic)","url":"https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching","type":"DOC"},
    {"title":"pgvector","url":"https://github.com/pgvector/pgvector","type":"TOOL"},
    {"title":"Tool use (Anthropic)","url":"https://docs.anthropic.com/en/docs/build-with-claude/tool-use","type":"DOC"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Build a RAG or tool-using feature end to end: ingest a document set (or define safe tools), expose an /ask or task endpoint, and ship evaluation + a cost/latency report.",
    "questions":[
      {"prompt":"Implement the RAG pipeline (ingest, chunk, embed, store, retrieve, generate) with strict grounding, or a capped tool-use loop.","guidance":"Ground answers only in retrieved context; cap and log tool calls."},
      {"prompt":"Build an evaluation: a golden set with hard cases + an LLM-as-judge or exact-match harness.","guidance":"Version-control the golden set; report a score per prompt version."},
      {"prompt":"Produce a cost + latency report and apply at least two levers (caching, model tier, batching).","guidance":"Log input/output/cached tokens and latency per call."}
    ],
    "rubric":[
      {"criterion":"Pipeline correctness + grounding","weight":35},
      {"criterion":"Evaluation rigor","weight":30},
      {"criterion":"Cost + latency control","weight":20},
      {"criterion":"Safety (tool/input handling)","weight":15}
    ]
  }'::jsonb,
  quiz_passing_score = 70, quiz_max_attempts = 3, content_status = 'READY', review_status = 'PUBLISHED'
where title = 'Generative AI + LLM Application Engineering';

update public.training_lessons tl set
  summary = v.summary, exercises = v.exercises::jsonb, key_takeaways = v.key_takeaways::jsonb, content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Treat the LLM as a flaky, expensive function.',
     '[{"prompt":"Map four tasks to the right capability tier (prompt-only, RAG, tool use, structured output).","expected_outcome":"Each task matched to the cheapest sufficient tier.","hints":["Summarize -> prompt-only","Answer over private docs -> RAG"]}]',
     '["Treat the LLM as stateless, nondeterministic, expensive","Climb the capability ladder only as needed","Tokens are money; cache/batch/trim","The model lies confidently; add a verifier"]'),
    (1, 'Write prompts that hold up in production.',
     '[{"prompt":"Rewrite a paragraph prompt into the 5-block structure with XML-delimited inputs.","expected_outcome":"Role, task, delimited inputs, constraints, output schema.","hints":["3 few-shot examples is the sweet spot","Use XML tags to avoid content collision"]}]',
     '["A production prompt reads like a function signature","XML tags resist user-content collision","About 3 few-shot examples is the sweet spot","Avoid unbounded user content in the system prompt"]'),
    (2, 'Build retrieval-augmented generation end to end.',
     '[{"prompt":"Implement the 6-step RAG flow over a small doc set with strict grounding.","expected_outcome":"An /ask endpoint that answers only from retrieved chunks or says it cannot.","hints":["Chunk to 300-800 tokens with overlap","pgvector works on Postgres"]}]',
     '["Use RAG for private/fresh/large data needing citations","Chunk to ~300-800 tokens with 10-20% overlap","pgvector fits a Postgres stack","Ground answers only in retrieved context"]'),
    (3, 'Use tools and structured outputs safely.',
     '[{"prompt":"Define a tool with a JSON schema and implement a capped tool-use loop.","expected_outcome":"A loop that executes tools, returns results, and stops at a max iteration.","hints":["messages.parse() returns a typed object","Treat tool args as untrusted"]}]',
     '["The model decides which tool to call; you execute it","Loop until text, capping max iterations","messages.parse() returns typed, validated output","Treat every tool argument as untrusted"]'),
    (4, 'Evaluate rigorously.',
     '[{"prompt":"Build a 50-question golden set and a regression harness scoring a prompt version.","expected_outcome":"A repeatable score per prompt version, including hard cases.","hints":["LLM-as-judge grades against a rubric","Include ambiguous and out-of-scope cases"]}]',
     '["Without eval you ship regressions","Three levels: unit, LLM-as-judge, human review","A golden set covers hard, realistic cases","Track online signals: thumbs, latency, refusals"]'),
    (5, 'Control cost and latency.',
     '[{"prompt":"Reorder a prompt for caching and pick model tiers for three steps.","expected_outcome":"Stable prefix first with a cache breakpoint; right-sized models per step.","hints":["Caching gives ~90% off cached tokens","Haiku for extraction, Sonnet for agentic work"]}]',
     '["Prompt caching gives ~90% off cached tokens","Put stable content first, volatile last","Right-size the model per step","Log tokens + latency on every call"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'Generative AI + LLM Application Engineering' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'How should you treat an LLM in system design?', '["A stateless, nondeterministic, expensive function","A deterministic database","A local cache","A compiler"]', 'A stateless, nondeterministic, expensive function', 'Every design choice follows from those three properties.'),
  (0, 1, 'Which task fits prompt-only (the cheapest tier)?', '["Summarize a document","Answer questions over private docs","Find and book a flight","Output exact JSON 99% of the time"]', 'Summarize a document', 'Summarization needs no retrieval or tools.'),
  (0, 2, 'Because the model lies confidently, you should do what?', '["Add a verifier","Trust the output","Remove evaluations","Always increase tokens"]', 'Add a verifier', 'Add verification because outputs can be confidently wrong.'),
  (1, 0, 'A production prompt looks more like what?', '["A function signature than a paragraph","A novel","A tweet","Random text"]', 'A function signature than a paragraph', 'Structure (role/task/inputs/constraints/schema) beats prose.'),
  (1, 1, 'Why does Anthropic recommend XML tags in prompts?', '["They are robust to user-content collision","They are shorter","They are faster","HTTP requires them"]', 'They are robust to user-content collision', 'XML delimiters separate instructions from user content safely.'),
  (1, 2, 'How many few-shot examples is the sweet spot?', '["About 3","About 50","Zero","100"]', 'About 3', 'Around 3 examples balances quality and token cost.'),
  (2, 0, 'When should you use RAG?', '["For private/fresh/large data that needs citations","Always","Never","Only for math"]', 'For private/fresh/large data that needs citations', 'RAG grounds answers in private or fresh data.'),
  (2, 1, 'What is the typical RAG chunk size?', '["300-800 tokens","1 token","100k tokens","1 character"]', '300-800 tokens', 'Chunks of ~300-800 tokens with overlap work well.'),
  (2, 2, 'What grounding instruction is verified by an eval?', '["Answer using ONLY the provided context","Answer from memory","Make something up","Ignore the documents"]', 'Answer using ONLY the provided context', 'Strict grounding plus a say-so fallback is verified by eval.'),
  (3, 0, 'In a tool-use loop, who decides which function to call?', '["The model","The end user","The database","A random process"]', 'The model', 'The model chooses the tool and arguments; you execute it.'),
  (3, 1, 'What does messages.parse() with a schema give you?', '["A typed, validated object","Raw text","An image","Nothing"]', 'A typed, validated object', 'Structured outputs return validated, typed data.'),
  (3, 2, 'Which is a tool-use safety practice?', '["Cap the loop at a max iteration count","Trust all arguments","Allow unlimited iterations","Skip logging"]', 'Cap the loop at a max iteration count', 'Cap iterations, whitelist tools, and treat args as untrusted.'),
  (4, 0, 'Without evaluation, what happens?', '["You ship regressions unknowingly","You always improve","You save money","You go faster"]', 'You ship regressions unknowingly', 'Eval is how you know a change helped or hurt.'),
  (4, 1, 'What is LLM-as-judge?', '["A stronger model grades responses against a rubric","Only a human reviewer","A regex matcher","A database trigger"]', 'A stronger model grades responses against a rubric', 'A capable model scores outputs against a rubric.'),
  (4, 2, 'A good golden set includes what?', '["Hard cases: ambiguous, multi-step, out-of-scope","Only easy questions","No questions","A single question"]', 'Hard cases: ambiguous, multi-step, out-of-scope', 'Cover the realistic distribution including hard cases.'),
  (5, 0, 'Anthropic prompt caching gives roughly what discount on cached tokens?', '["About 90%","0%","About 10%","100%"]', 'About 90%', 'Cached tokens are discounted ~90%.'),
  (5, 1, 'Where should you place stable content for caching?', '["First, with volatile content last","Last","Randomly","It does not matter"]', 'First, with volatile content last', 'Stable prefix first so the cache hits; put a breakpoint before volatile content.'),
  (5, 2, 'Which model tier fits classification/extraction?', '["Haiku","Opus","Always the largest","None"]', 'Haiku', 'Use the cheapest sufficient tier; Haiku for extraction/classification.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'Generative AI + LLM Application Engineering'
  and not exists (select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question);

-- =============================================================================
-- 4) DATA ENGINEERING FOUNDATIONS
-- =============================================================================
update public.training_courses set
  overview = 'Data Engineering Foundations covers the back-bone of every analytics, ML, and AI workload. You learn the warehouse layer model, write idempotent Airflow DAGs that survive a restart, reason about Spark shuffles and skew, build dimensional models, transform with dbt discipline, and run data-quality tests with an on-call mindset.',
  target_audience = 'Engineers and STEM-OPT trainees building data pipelines and warehouses.',
  roadmap = '[
    {"phase":"Storage + orchestration","duration_label":"Week 1","focus_areas":["Warehouse layers","Idempotent Airflow DAGs"]},
    {"phase":"Compute + modeling","duration_label":"Week 2","focus_areas":["Spark performance","Dimensional modeling","dbt"]},
    {"phase":"Reliability","duration_label":"Week 3","focus_areas":["Data quality + on-call"]}
  ]'::jsonb,
  resources = '[
    {"title":"Apache Airflow documentation","url":"https://airflow.apache.org/docs/","type":"DOC"},
    {"title":"Apache Spark documentation","url":"https://spark.apache.org/docs/latest/","type":"DOC"},
    {"title":"dbt documentation","url":"https://docs.getdbt.com/","type":"DOC"},
    {"title":"The Kimball dimensional modeling techniques","url":"https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/","type":"ARTICLE"},
    {"title":"Great Expectations","url":"https://docs.greatexpectations.io/","type":"TOOL"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Design a small warehouse + pipeline: define raw/staging/marts layers, an idempotent ingestion task, a star-schema mart, and a data-contract test suite, plus an on-call run-book.",
    "questions":[
      {"prompt":"Define the three warehouse layers and an idempotent load (write-then-rename or delete-then-insert by partition).","guidance":"Raw is append-only; staging is cleaned; marts are business-shaped."},
      {"prompt":"Build a star-schema mart with a documented grain and SCD-2 where history is needed.","guidance":"State what one fact row means; name f_/d_ tables."},
      {"prompt":"Write the data-contract tests (source-contract, statistical, business-rule) and the alerting plan.","guidance":"Every alert links a run-book."}
    ],
    "rubric":[
      {"criterion":"Layered design","weight":25},
      {"criterion":"Idempotency","weight":25},
      {"criterion":"Dimensional model","weight":25},
      {"criterion":"Data quality + on-call","weight":25}
    ]
  }'::jsonb,
  quiz_passing_score = 70, quiz_max_attempts = 3, content_status = 'READY', review_status = 'PUBLISHED'
where title = 'Data Engineering Foundations';

update public.training_lessons tl set
  summary = v.summary, exercises = v.exercises::jsonb, key_takeaways = v.key_takeaways::jsonb, content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Layer the warehouse: raw, staging, marts.',
     '[{"prompt":"Sketch the three layers for a small source and what each one guarantees.","expected_outcome":"Raw append-only, staging cleaned/typed, marts business-shaped.","hints":["Raw is the audit trail","Marts are what analysts read"]}]',
     '["Raw is a 1:1 append-only audit trail","Staging is cleaned, typed, deduped","Marts are dimensional, business-shaped tables","You can rebuild staging+marts from raw"]'),
    (1, 'Write idempotent Airflow DAGs.',
     '[{"prompt":"Convert a non-idempotent task into write-then-rename or delete-then-insert by partition.","expected_outcome":"A safely retryable, backfillable task.","hints":["Atomic swap into place","Set retries=2 with a delay"]}]',
     '["Idempotency is a law: same output on re-run","Write-then-rename makes tasks retryable","Keep tasks under ~30 minutes","Tag DAGs with owner + on-call"]'),
    (2, 'Tune Spark shuffles, partitions, and skew.',
     '[{"prompt":"Diagnose a slow join and apply a broadcast join or salting to fix skew.","expected_outcome":"A plan with fewer/cheaper shuffles.","hints":["~128MB per partition","Broadcast a <10MB side"]}]',
     '["A stage boundary is a shuffle; shuffles are costly","Aim for ~128MB per partition","Skew = one key does most of the work","Broadcast a small side to remove the shuffle"]'),
    (3, 'Model dimensions for analytics.',
     '[{"prompt":"Design a fact table and an SCD-2 dimension with a documented grain.","expected_outcome":"f_/d_ tables, additive measures, effective_from/to + is_current.","hints":["Star schema is the default","Write the grain in the model description"]}]',
     '["Star schema is the default analytics model","A fact row is one event/measurement","Use SCD-2 for dimension history","The grain is the most important question"]'),
    (4, 'Transform with dbt discipline.',
     '[{"prompt":"Structure a dbt project (staging/intermediate/marts) with ref()/source() and schema tests.","expected_outcome":"A DAG-built project with declarative tests and docs.","hints":["state:modified+ runs only what changed","schema.yml holds not_null/unique"]}]',
     '["dbt adds version control, tests, docs, CI","ref()/source() build the DAG automatically","schema.yml holds declarative tests","Run only modified models in CI"]'),
    (5, 'Build data-quality layers and on-call.',
     '[{"prompt":"Write the three layers of tests (source-contract, statistical, business-rule) for a pipeline.","expected_outcome":"Tests at each layer plus an alerting plan with run-book links.","hints":["not_null/unique on PKs","Row count vs 7-day median"]}]',
     '["Layer 1: source-contract tests (not_null/unique)","Layer 2: statistical tests vs 7-day median","Layer 3: business-rule tests","Every alert links a run-book"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'Data Engineering Foundations' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'What is the RAW (bronze) warehouse layer?', '["A 1:1 append-only copy of source data (the audit trail)","The business marts","Cleaned and typed data","Pre-aggregated reports"]', 'A 1:1 append-only copy of source data (the audit trail)', 'Raw is an append-only copy, never reshaped.'),
  (0, 1, 'Which layer do analysts and BI tools read?', '["Marts (gold)","Raw","Landing","None"]', 'Marts (gold)', 'Marts are the business-question-shaped tables analysts read.'),
  (0, 2, 'Why use layers at all?', '["You can re-run staging+marts from raw anytime","To use more storage","For appearance","No reason"]', 'You can re-run staging+marts from raw anytime', 'Layering makes the pipeline rebuildable and contains schema breaks.'),
  (1, 0, 'Why must every Airflow task be idempotent?', '["So you can backfill, retry, and recover","To run faster","To use less RAM","No reason"]', 'So you can backfill, retry, and recover', 'Idempotency enables safe retries and backfills.'),
  (1, 1, 'What is the write-then-rename pattern for?', '["Safe retryability via an atomic swap","Speed only","Logging","Compression"]', 'Safe retryability via an atomic swap', 'Compute into temp, then atomically swap into place.'),
  (1, 2, 'What is a recommended DAG retry setting?', '["retries=2 with a retry delay","No retries","Infinite retries","Retry only on success"]', 'retries=2 with a retry delay', 'Set a small number of retries with a delay.'),
  (2, 0, 'In Spark, a stage boundary is what?', '["A shuffle","Always a join","A cache","A file write"]', 'A shuffle', 'Stage boundaries are shuffles, which are expensive.'),
  (2, 1, 'What is the rule of thumb for partition size?', '["About 128MB per partition","About 1KB","About 10GB","One row"]', 'About 128MB per partition', 'Aim for ~128MB partitions to balance overhead and parallelism.'),
  (2, 2, 'How do you remove the shuffle for a join with a tiny side?', '["Broadcast the small side","Repartition more","Add executors","Switch to CSV"]', 'Broadcast the small side', 'Broadcasting a <10MB side eliminates the shuffle.'),
  (3, 0, 'What is the default analytics data model?', '["Star schema","Snowflake schema","Fully normalized 3NF","Key-value"]', 'Star schema', 'Star schema (fact + denormalized dimensions) is the default.'),
  (3, 1, 'What does a fact table contain?', '["One row per event/measurement with FKs to dimensions","One row per customer","Only free text","Only aggregates"]', 'One row per event/measurement with FKs to dimensions', 'Facts hold measurements at a documented grain.'),
  (3, 2, 'What is the single most important question about a table?', '["The grain (what one row means)","Its color","Its name length","Its index count"]', 'The grain (what one row means)', 'Define the grain before anything else.'),
  (4, 0, 'What does dbt add to SQL transforms?', '["Version control, tests, docs, and CI","A database engine","A BI dashboard","Only a scheduler"]', 'Version control, tests, docs, and CI', 'dbt turns SQL into an engineered project.'),
  (4, 1, 'What do ref() and source() build automatically?', '["The DAG / lineage","Indexes","Dashboards","Backups"]', 'The DAG / lineage', 'ref()/source() construct the dependency DAG and lineage.'),
  (4, 2, 'Where are dbt declarative tests defined?', '["schema.yml (not_null, unique, ...)","In Python files","In Airflow","Nowhere"]', 'schema.yml (not_null, unique, ...)', 'schema.yml holds not_null/unique/accepted_values/relationships.'),
  (5, 0, 'Which is a Layer-1 source-contract test?', '["not_null / unique on the primary key","Row count vs 7-day median","Revenue equals sum of orders","Latency"]', 'not_null / unique on the primary key', 'Source-contract tests assert keys and enums on every load.'),
  (5, 1, 'Which is a Layer-2 statistical test?', '["Row count today vs the 7-day median","not_null on a key","Foreign-key relationships","accepted_values"]', 'Row count today vs the 7-day median', 'Statistical tests compare today to a recent baseline.'),
  (5, 2, 'What should every data-quality alert include?', '["A run-book link","Nothing","A meme","The full table"]', 'A run-book link', 'Every alert links a run-book so on-call can act.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'Data Engineering Foundations'
  and not exists (select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question);

-- =============================================================================
-- 5) MODERN SQL + ANALYTICS ENGINEERING
-- =============================================================================
update public.training_courses set
  overview = 'Modern SQL + Analytics Engineering teaches you to write production analytics SQL that is correct, fast, and maintainable. You master window functions, structure queries with CTEs, read query plans with EXPLAIN ANALYZE, choose the right index, work with JSON and arrays, and model analytical history with SCD-2.',
  target_audience = 'Analytics, data, and back-end engineers and STEM-OPT trainees writing production SQL.',
  roadmap = '[
    {"phase":"Expressive SQL","duration_label":"Week 1","focus_areas":["Window functions","CTEs"]},
    {"phase":"Performance","duration_label":"Week 2","focus_areas":["Reading query plans","Indexing strategy"]},
    {"phase":"Shapes + history","duration_label":"Week 3","focus_areas":["JSON + arrays","SCD-2"]}
  ]'::jsonb,
  resources = '[
    {"title":"PostgreSQL: Window Functions","url":"https://www.postgresql.org/docs/current/tutorial-window.html","type":"DOC"},
    {"title":"PostgreSQL: Using EXPLAIN","url":"https://www.postgresql.org/docs/current/using-explain.html","type":"DOC"},
    {"title":"PostgreSQL: Indexes","url":"https://www.postgresql.org/docs/current/indexes.html","type":"DOC"},
    {"title":"Use The Index, Luke","url":"https://use-the-index-luke.com/","type":"ARTICLE"},
    {"title":"dbt documentation","url":"https://docs.getdbt.com/","type":"DOC"}
  ]'::jsonb,
  capstone = '{
    "assessment_type":"PRACTICAL_ASSIGNMENT",
    "instructions":"Build a small dbt project (5 models + 10+ tests) on a real dataset, and include one EXPLAIN ANALYZE walkthrough where you beat a slow baseline query.",
    "questions":[
      {"prompt":"Write 5 dbt models (staging to marts) using CTEs and window functions where appropriate.","guidance":"One CTE per logical step; name CTEs after what they produce."},
      {"prompt":"Add 10+ tests (not_null, unique, accepted_values, relationships).","guidance":"Tests must pass in CI."},
      {"prompt":"Take a slow query, read its plan, add the right index, and show the speedup.","guidance":"Use EXPLAIN ANALYZE before and after."}
    ],
    "rubric":[
      {"criterion":"Readable, correct SQL","weight":30},
      {"criterion":"Tests","weight":25},
      {"criterion":"Plan reading + indexing","weight":30},
      {"criterion":"History/SCD-2 where needed","weight":15}
    ]
  }'::jsonb,
  quiz_passing_score = 70, quiz_max_attempts = 3, content_status = 'READY', review_status = 'PUBLISHED'
where title = 'Modern SQL + Analytics Engineering';

update public.training_lessons tl set
  summary = v.summary, exercises = v.exercises::jsonb, key_takeaways = v.key_takeaways::jsonb, content_status = 'READY'
from public.training_courses c,
  (values
    (0, 'Use window functions for rankings and running totals.',
     '[{"prompt":"Write a query for each customer''s first 5 orders and a 7-day moving average.","expected_outcome":"ROW_NUMBER() and a windowed AVG with the right frame.","hints":["PARTITION BY customer ORDER BY placed_at","ROWS 6 PRECEDING for a 7-day window"]}]',
     '["Window functions preserve the row count","ROW_NUMBER/RANK/LAG/LEAD are the workhorses","SUM() OVER (...) gives running totals","Use frames (ROWS BETWEEN ...) for moving windows"]'),
    (1, 'Structure queries with CTEs.',
     '[{"prompt":"Refactor a giant query into one CTE per logical step and a final SELECT.","expected_outcome":"A readable WITH chain named after what each step produces.","hints":["CTEs are inlined in modern engines","Use RECURSIVE only for hierarchies"]}]',
     '["One CTE per logical step improves readability","Name CTEs after what they produce","Modern engines inline CTEs (no penalty)","Use recursive CTEs for hierarchies/graphs"]'),
    (2, 'Read query plans with EXPLAIN ANALYZE.',
     '[{"prompt":"Run EXPLAIN ANALYZE on a slow query and identify the most expensive operation.","expected_outcome":"You spot a Seq Scan or a Sort-to-disk and a fix.","hints":["Estimate vs actual off by 100x -> ANALYZE","Seq Scan on a filtered large table -> index"]}]',
     '["EXPLAIN ANALYZE shows actual plan + times","Seq Scan on a large filtered table suggests a missing index","Index-only scans are the best case","Estimate vs actual off by 100x means stale stats"]'),
    (3, 'Choose indexes from the slowest queries.',
     '[{"prompt":"Design a multi-column index for a real query and justify the column order.","expected_outcome":"Equality columns first, range last, most-selective first.","hints":["(a,b) does not help WHERE b alone","Indexes slow down writes"]}]',
     '["Pick indexes from queries, not schemas","Multi-column order matters (a,b helps a, not b alone)","Equality first, range last, selective first","Indexes cost write speed + disk"]'),
    (4, 'Work with JSON and arrays in SQL.',
     '[{"prompt":"Query a jsonb column with ->>, @>, and jsonb_array_elements, and add a GIN index.","expected_outcome":"Containment lookups backed by a GIN index.","hints":["Prefer jsonb over json","Normalize when querying elements heavily"]}]',
     '["Prefer jsonb (binary) over json","@> does containment; ->> extracts text","GIN indexes speed jsonb/array containment","Normalize when you query elements heavily"]'),
    (5, 'Model analytical history with SCD-2.',
     '[{"prompt":"Write the as-of join to find the customer attribute valid at a past timestamp.","expected_outcome":"A join using effective_from/effective_to (or is_current).","hints":["dbt snapshots manage SCD-2","is_current for today''s view"]}]',
     '["SCD-2 preserves history with versioned rows","effective_from/effective_to/is_current mark versions","As-of joins use the effective range","dbt snapshots manage SCD-2 mechanics"]')
  ) as v(lesson_order, summary, exercises, key_takeaways)
where tl.course_id = c.id and c.title = 'Modern SQL + Analytics Engineering' and tl.lesson_order = v.lesson_order;

insert into public.training_quizzes (course_id, lesson_id, question, options, correct_answer, explanation, points, question_order)
select l.course_id, l.id, q.question, q.options::jsonb, q.correct_answer, q.explanation, 1, q.question_order
from public.training_lessons l join public.training_courses c on c.id = l.course_id
join (values
  (0, 0, 'How do window functions differ from GROUP BY?', '["They preserve the original row count","They collapse rows","They delete rows","They are always slower"]', 'They preserve the original row count', 'Window functions compute over a window without collapsing rows.'),
  (0, 1, 'Which function returns the previous row''s value?', '["LAG()","SUM()","COUNT()","ROW_NUMBER()"]', 'LAG()', 'LAG() reads the prior row; LEAD() reads the next.'),
  (0, 2, 'How do you get each customer''s first 5 orders?', '["ROW_NUMBER() OVER (PARTITION BY customer ORDER BY placed_at)","GROUP BY customer","SELECT DISTINCT","LIMIT 5 only"]', 'ROW_NUMBER() OVER (PARTITION BY customer ORDER BY placed_at)', 'Rank within each customer, then filter to rank <= 5.'),
  (1, 0, 'What do CTEs (WITH clauses) primarily improve?', '["Readability — one CTE per logical step","Raw speed always","Security","Storage"]', 'Readability — one CTE per logical step', 'CTEs let a query read like a sequence of steps.'),
  (1, 1, 'In modern engines, how are CTEs handled?', '["Inlined by the optimizer (no materialization penalty)","Always materialized to disk","Forbidden","Always slow"]', 'Inlined by the optimizer (no materialization penalty)', 'Postgres 12+/BigQuery/Snowflake inline CTEs.'),
  (1, 2, 'Recursive CTEs are best used for what?', '["Hierarchies and graph walks","Every query","Sorting","Index creation"]', 'Hierarchies and graph walks', 'Use recursion sparingly for hierarchies and graphs.'),
  (2, 0, 'What does EXPLAIN ANALYZE give you over EXPLAIN?', '["The actual plan plus actual times (it runs the query)","The estimated plan only","Nothing","The schema"]', 'The actual plan plus actual times (it runs the query)', 'EXPLAIN ANALYZE executes and reports real timings.'),
  (2, 1, 'A Seq Scan on a large filtered table usually means what?', '["A missing index","Great performance","An index-only scan","A join"]', 'A missing index', 'A filtered sequential scan on a big table suggests a missing index.'),
  (2, 2, 'If the rows estimate vs actual differ by more than 100x, you should do what?', '["ANALYZE the table (stale statistics)","Add RAM","Drop the table","Ignore it"]', 'ANALYZE the table (stale statistics)', 'A large estimate/actual gap means statistics are stale.'),
  (3, 0, 'How should you choose indexes?', '["From the slowest queries, not the schema","By guessing","One per column","Never index"]', 'From the slowest queries, not the schema', 'Design indexes from measured slow queries.'),
  (3, 1, 'A multi-column index on (a, b) helps which query?', '["WHERE a=$ (and a AND b), but not b alone","WHERE b alone","Neither","Only ORDER BY b"]', 'WHERE a=$ (and a AND b), but not b alone', 'Leftmost-prefix rule: (a,b) helps a and a+b, not b alone.'),
  (3, 2, 'What is a cost of adding indexes?', '["They slow down INSERT/UPDATE/DELETE","They speed up writes","They free disk space","They have no cost"]', 'They slow down INSERT/UPDATE/DELETE', 'Indexes add write overhead and consume disk/cache.'),
  (4, 0, 'Which Postgres JSON type is preferred?', '["jsonb (binary)","json (text)","xml","blob"]', 'jsonb (binary)', 'jsonb is binary and indexable; prefer it over json.'),
  (4, 1, 'What does the @> operator do on jsonb?', '["A containment check","String concatenation","Addition","Key deletion"]', 'A containment check', '@> tests whether the left contains the right.'),
  (4, 2, 'When should you NOT use a JSON/array column?', '["When you query elements heavily by value or need FK integrity","Never normalize","For all data","For small documents"]', 'When you query elements heavily by value or need FK integrity', 'Normalize into a child table when you query/relate elements heavily.'),
  (5, 0, 'What does an SCD-2 dimension preserve?', '["History (versions over time)","Only the current value","Nothing","Indexes"]', 'History (versions over time)', 'SCD-2 keeps a row per version to preserve history.'),
  (5, 1, 'Which columns mark an SCD-2 row?', '["effective_from, effective_to, is_current","created_at only","id only","none"]', 'effective_from, effective_to, is_current', 'These columns delimit each version and flag the current one.'),
  (5, 2, 'What handles SCD-2 mechanics for you?', '["dbt snapshots","Airflow only","Spark","No tool exists"]', 'dbt snapshots', 'dbt snapshots manage effective_from/effective_to automatically.')
) as q(lesson_order, question_order, question, options, correct_answer, explanation)
  on q.lesson_order = l.lesson_order
where c.title = 'Modern SQL + Analytics Engineering'
  and not exists (select 1 from public.training_quizzes tq where tq.lesson_id = l.id and tq.question = q.question);

NOTIFY pgrst, 'reload schema';
