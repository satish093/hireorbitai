/**
 * Fixed catalog of common job-application questions used by the LinkedIn
 * Application Copilot. There is no API that lets us read the live fields on
 * LinkedIn's actual Easy Apply form (see linkedin.service.ts), so this catalog
 * — not page inspection — is what "detecting" a question means here: a known
 * question set answered from the consultant's saved profile/answers, with
 * anything unresolved surfaced to the user rather than guessed.
 *
 * `key` is stable and hashed (sha256) to key `application_answers` rows, so
 * editing `text` later never orphans a saved answer. `profileField`, when
 * present, names a column on `public.consultants` that can prefill the answer
 * — only set where the mapping is unambiguous; never invent one.
 */

export type ApplicationQuestionInputType = 'boolean' | 'text' | 'number' | 'select';

export interface ApplicationQuestionDef {
  key: string;
  text: string;
  inputType: ApplicationQuestionInputType;
  /** Column on public.consultants that can prefill this answer, if any. */
  profileField?:
    | 'visa_status'
    | 'total_experience_years'
    | 'relocation'
    | 'remote_only'
    | 'expected_rate';
  /** Answer options, for inputType 'select'. */
  options?: string[];
  required: boolean;
}

export const APPLICATION_QUESTION_CATALOG: ApplicationQuestionDef[] = [
  {
    key: 'work_authorization',
    text: 'Are you authorized to work in the United States?',
    inputType: 'boolean',
    profileField: 'visa_status',
    required: true,
  },
  {
    key: 'sponsorship_required',
    text: 'Will you now or in the future require sponsorship for employment visa status?',
    inputType: 'boolean',
    required: true,
  },
  {
    key: 'years_of_experience',
    text: 'How many years of relevant experience do you have?',
    inputType: 'number',
    profileField: 'total_experience_years',
    required: true,
  },
  {
    key: 'notice_period',
    text: 'What is your current notice period?',
    inputType: 'text',
    required: false,
  },
  {
    key: 'salary_expectation',
    text: 'What are your salary expectations?',
    inputType: 'text',
    profileField: 'expected_rate',
    required: false,
  },
  {
    key: 'relocation',
    text: 'Are you willing to relocate for this position?',
    inputType: 'boolean',
    profileField: 'relocation',
    required: false,
  },
  {
    key: 'remote_preference',
    text: 'Are you open to remote-only work?',
    inputType: 'boolean',
    profileField: 'remote_only',
    required: false,
  },
];

export function findApplicationQuestion(key: string): ApplicationQuestionDef | undefined {
  return APPLICATION_QUESTION_CATALOG.find((q) => q.key === key);
}
