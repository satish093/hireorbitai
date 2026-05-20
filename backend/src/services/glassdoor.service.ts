import axios from 'axios';

/**
 * Glassdoor Real-Time API (RapidAPI). Currently exposes a single
 * interview-details fetcher — useful for the interview-prep view since the
 * response includes the question list and the interviewee's experience.
 *
 * Reuses RAPIDAPI_KEY (falls back to JSEARCH_API_KEY). Not part of the
 * jobIngestion pipeline — this is a read-only enrichment for the interviews
 * module.
 */

const HOST = process.env.GLASSDOOR_HOST ?? 'glassdoor-real-time.p.rapidapi.com';

function getKey(): string {
  const key = process.env.RAPIDAPI_KEY ?? process.env.JSEARCH_API_KEY;
  if (!key) throw new Error('RAPIDAPI_KEY (or JSEARCH_API_KEY) not set in backend/.env');
  return key;
}

/**
 * GET /companies/interview-details?interviewId=…
 * Returns the full interview write-up: company, role, difficulty, outcome,
 * questions asked, plus interviewee notes.
 */
export async function fetchGlassdoorInterview(interviewId: string): Promise<unknown> {
  const { data, status } = await axios.get(`https://${HOST}/companies/interview-details`, {
    params: { interviewId },
    headers: {
      'x-rapidapi-host': HOST,
      'x-rapidapi-key': getKey(),
      'Content-Type': 'application/json',
    },
    timeout: 20000,
    validateStatus: () => true,
  });
  if (status >= 400) {
    const msg = (data as any)?.message ?? `HTTP ${status}`;
    throw new Error(`Glassdoor: ${msg}`);
  }
  return data;
}
