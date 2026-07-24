#!/usr/bin/env node
// Run directly on the VPS:
//   node --import tsx --env-file=backend/.env scripts/backfill-courses.mjs
//
// Enriches ALL courses (not just ones missing overview) with AI-generated
// overview, roadmap, resources, capstone, and completion criteria.

import { backfillCourses, enrichCourse } from '../backend/src/services/training.service.js';
import * as repo from '../backend/src/repositories/training.repository.js';

const { data: courses } = await repo.courses.list({});
if (!courses?.length) {
  console.log('No courses found.');
  process.exit(0);
}

console.log(`Found ${courses.length} courses. Starting enrichment…\n`);

for (const c of courses) {
  process.stdout.write(`  Enriching "${c.title}" … `);
  try {
    const { degraded } = await enrichCourse(c.id);
    console.log(degraded ? '⚠ degraded (AI unavailable, stub saved)' : '✓ done');
  } catch (err) {
    console.log(`✗ failed: ${err?.message ?? err}`);
  }
}

console.log('\nEnrichment complete.');
process.exit(0);
