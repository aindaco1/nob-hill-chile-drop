import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
const config = parse(readFileSync(new URL('./_config.yml', import.meta.url), 'utf8'));
const baseURL = `http://127.0.0.1:4173${config.baseurl || ''}/`;
export default defineConfig({
  testDir:'./tests/e2e', fullyParallel:true, timeout:30000,
  use:{baseURL,trace:'retain-on-failure'},
  webServer:{command:'node scripts/serve.mjs',url:baseURL,reuseExistingServer:!process.env.CI},
  projects:[{name:'chromium',use:{browserName:'chromium'}}],
  reporter:process.env.CI?[['github'],['html',{open:'never'}]]:[['list']]
});
