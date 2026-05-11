#!/usr/bin/env node
/**
 * Run after `react-scripts build` — rewrites build/service-worker.js so the
 * BUILD_ID is unique per deploy. Without this, Chrome treats the SW as
 * byte-identical, never re-runs install/activate, and caches stick forever.
 */
const fs = require('fs');
const path = require('path');

const SW = path.join(__dirname, '..', 'build', 'service-worker.js');
if (!fs.existsSync(SW)) {
  console.error('[stamp-sw] build/service-worker.js not found — did the build run?');
  process.exit(0); // don't fail the build, just no-op
}

// Prefer Vercel-provided git SHA, fall back to timestamp.
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.GITHUB_SHA?.slice(0, 12) ||
  `local-${Date.now()}`;

const original = fs.readFileSync(SW, 'utf8');
const stamped = original.replace(/__BUILD_ID__/g, buildId);
fs.writeFileSync(SW, stamped);
console.log(`[stamp-sw] stamped service-worker.js with BUILD_ID=${buildId}`);
