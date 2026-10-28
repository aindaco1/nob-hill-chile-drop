import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e', fullyParallel:true, timeout:30000,
  use:{baseURL:'http://127.0.0.1:4173/nob-hill-chile-drop/',trace:'retain-on-failure'},
  webServer:{command:'node scripts/serve.mjs',url:'http://127.0.0.1:4173/nob-hill-chile-drop/',reuseExistingServer:!process.env.CI},
  projects:[{name:'chromium',use:{browserName:'chromium'}}],
  reporter:process.env.CI?[['github'],['html',{open:'never'}]]:[['list']]
});
