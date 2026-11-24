import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'index.html must contain its application script');
assert.doesNotThrow(() => new vm.Script(script, { filename: 'index.html:inline-script' }), 'inline JavaScript must parse');

const requiredModes = ['market', 'portfolio', 'analyst', 'risk', 'cfo', 'quiz'];
for (const mode of requiredModes) {
  assert.ok(html.includes(`id="page-${mode}"`), `missing game mode: ${mode}`);
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, 'HTML ids must be unique');
assert.match(html, /class="skip-link"/, 'keyboard skip link should exist');
assert.match(html, /aria-live="polite"/, 'dynamic feedback should be announced');
assert.match(html, /prefers-reduced-motion/, 'reduced-motion preference should be respected');
assert.match(html, /aria-label="สัดส่วนลงทุนใน/, 'allocation inputs need accessible names');

assert.ok(script.includes('MAX_MARKET_HISTORY=240'), 'endless market chart history must be bounded');
assert.ok(script.includes('S.marketHistory.length>MAX_MARKET_HISTORY'), 'market history must be capped while advancing');
assert.ok(script.includes('function escapeHTML'), 'saved content must be escaped before HTML rendering');
assert.ok(script.includes('csvCell'), 'CSV export must defend against spreadsheet formulas');
assert.ok(script.includes('if(S.quizDone||S.quizAnswered)return'), 'quiz answers must not be rewarded repeatedly after a reload');
assert.ok(script.includes('quizRewarded') && script.includes('cfoRewarded') && script.includes('portfolioRewarded'), 'repeat attempts must not farm progression XP');
assert.ok(script.includes('function calculateVaR'), 'VaR calculation helper should exist');
assert.ok(script.includes('function simulateMonthlyMarket'), 'asset-level market simulation must exist');
assert.ok(script.includes('function applyMarketReturns'), 'monthly market returns must update individual holdings');
assert.ok(script.includes("porto-save-v4") && script.includes("porto-save-v3") && script.includes("porto-save-v2"), 'v4 save must preserve v3/v2 migration paths');
assert.ok(script.includes('S.holdings=addInvestmentToHoldings'), 'portfolio rebalancing must preserve monetary holdings');
assert.ok(!script.includes('const riskyExposure=i===0'), 'legacy single-return portfolio approximation must be removed');
assert.ok(script.includes('function blendAllocations'), 'actual invested weights should blend across rebalances');
assert.ok(script.includes('function cfoEquipmentCashImpact'), 'CFO equipment cash impacts should be explicit');
assert.ok(script.includes('function cfoWorkingCapitalCashImpact'), 'CFO working-capital cash impacts should be explicit');

const assets = [
  { ret: 9.5, risk: 22 },
  { ret: 10.5, risk: 19 },
  { ret: 3.2, risk: 5 },
  { ret: 5.0, risk: 14 },
];
const correlations = [
  [1, .72, -.12, .08],
  [.72, 1, -.18, .04],
  [-.12, -.18, 1, .16],
  [.08, .04, .16, 1],
];
const context = vm.createContext({ S: { alloc: [35, 25, 15, 10], marketStrategy: 2 }, assets, correlations });
const portfolioStart = script.indexOf('const strategyVolatilityProfiles=');
const portfolioEnd = script.indexOf('\nconst events=', portfolioStart);
assert.ok(portfolioStart >= 0 && portfolioEnd > portfolioStart, 'portfolio engine functions must be present');
new vm.Script(script.slice(portfolioStart, portfolioEnd)).runInContext(context);
const helpersStart = script.indexOf('function money(');
const helpersEnd = script.indexOf('function go(', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'risk and allocation helpers must be present');
new vm.Script(script.slice(helpersStart, helpersEnd)).runInContext(context);
const qsetStart = script.indexOf('const qset=[');
const qsetEnd = script.indexOf('function money(', qsetStart);
assert.ok(qsetStart >= 0 && qsetEnd > qsetStart, 'knowledge trial questions must be present');
new vm.Script(script.slice(qsetStart, qsetEnd)).runInContext(context);

const weights = [35 / 85, 25 / 85, 15 / 85, 10 / 85];
const expectedReturn = weights.reduce((sum, weight, i) => sum + weight * assets[i].ret, 0);
let expectedVariance = 0;
for (let i = 0; i < weights.length; i++) {
  for (let j = 0; j < weights.length; j++) {
    expectedVariance += weights[i] * weights[j] * (assets[i].risk / 100) * (assets[j].risk / 100) * correlations[i][j];
  }
}
const actualStats = vm.runInContext('portfolioStats()', context);
assert.ok(Math.abs(actualStats.return - expectedReturn) < 1e-10, 'portfolio expected return must be weighted correctly');
assert.ok(Math.abs(actualStats.risk - Math.sqrt(expectedVariance) * 100) < 1e-10, 'portfolio volatility must include covariance');

const expectedVaR = 1_000_000 * (0.10 / Math.sqrt(252)) * 1.645;
const actualVaR = vm.runInContext('calculateVaR(1000000, 10, 1.645)', context);
assert.ok(Math.abs(actualVaR - expectedVaR) < 1e-8, '1-day 95% parametric VaR must use annual volatility / sqrt(252)');

const blended = Array.from(vm.runInContext('blendAllocations([0.25,0.75,0,0],800,[0.75,0.25,0,0],200)', context));
assert.ok(Math.abs(blended[0] - 0.35) < 1e-10 && Math.abs(blended[1] - 0.65) < 1e-10, 'rebalance must blend actual holdings by invested value');

assert.deepEqual(
  Array.from(vm.runInContext('qset.map(q=>q.a)', context)),
  [0, 1, 2, 3, 0, 1, 2, 3],
  'quiz correct answers should be balanced across A/B/C/D',
);
assert.deepEqual(
  [0, 1, 2].map(i => vm.runInContext(`cfoEquipmentCashImpact(${i})`, context)),
  [-540_000, -1_800_000, -1_200_000],
  'CFO equipment choices must have distinct 90-day cash impacts',
);
assert.deepEqual(
  [0, 1, 2].map(i => vm.runInContext(`cfoBestChoice(${i})`, context)),
  [1, 0, 2],
  'CFO correct answer positions should not be identical in every case',
);
const correlated = Array.from(vm.runInContext('correlateNormals([1,0,0,0])', context));
assert.ok(
  correlated.every((value, i) => Math.abs(value - [1, .72, -.12, .08][i]) < 1e-10),
  'Cholesky transform must preserve the configured asset correlations',
);

const riskOn = vm.runInContext('portfolioStats([100,0,0,0],0).risk', context);
const defensive = vm.runInContext('portfolioStats([100,0,0,0],1).risk', context);
const balanced = vm.runInContext('portfolioStats([100,0,0,0],2).risk', context);
assert.ok(Math.abs(riskOn - 25.3) < 1e-10, 'Risk-on profile must raise equity volatility by its documented multiplier');
assert.ok(Math.abs(defensive - 16.5) < 1e-10, 'Defensive profile must lower equity volatility');
assert.ok(Math.abs(balanced - 22) < 1e-10, 'Balanced profile must preserve the asset volatility assumption');

const legacyHoldings = Array.from(vm.runInContext('holdingsFromAllocation(1000000,[35,25,15,10])', context));
const expectedLegacyHoldings = [35,25,15,10].map(weight => 1_000_000 * weight / 85);
assert.ok(
  legacyHoldings.every((value, i) => Math.abs(value - expectedLegacyHoldings[i]) < 1e-6),
  'v3 invested value and unnormalized allocation percentages must migrate into monetary holdings',
);
assert.ok(Math.abs(legacyHoldings.reduce((a,b)=>a+b,0)-1_000_000)<1e-6, 'v3 holdings migration must preserve the invested total');
const toppedUpHoldings = Array.from(vm.runInContext('addInvestmentToHoldings([350000,250000,150000,100000],200000,[0,0,1,0])', context));
assert.deepEqual(toppedUpHoldings, [350000,250000,350000,100000], 'new investment must add to existing asset values without replacing them');

const marketRiskOn = vm.runInContext("simulateMonthlyMarket('Rate shock',0,[1,-.5,.25,-.25],1,.002)", context);
const marketDefensive = vm.runInContext("simulateMonthlyMarket('Rate shock',1,[1,-.5,.25,-.25],1,.002)", context);
assert.ok(Math.abs(marketRiskOn.benchmarkReturn - marketDefensive.benchmarkReturn) < 1e-12, 'market benchmark return must not depend on the selected strategy');
assert.notDeepEqual(
  Array.from(marketRiskOn.assetReturns),
  Array.from(marketDefensive.assetReturns),
  'the strategy must change the risk sensitivity of actual holdings',
);

const applied = vm.runInContext('applyMarketReturns([600,400,0,0],[.10,-.05,0,0])', context);
assert.ok(Math.abs(applied.invested - 1040) < 1e-10, 'market return update must sum asset-level holding values');
assert.ok(Math.abs(applied.portfolioReturn - .04) < 1e-10, 'portfolio return must be weighted by actual holding values');
assert.ok(Math.abs(applied.weights[0] - 660 / 1040) < 1e-10, 'post-market allocation weights must be refreshed');

assert.deepEqual(
  [0, 1, 2].map(i => vm.runInContext(`cfoWorkingCapitalCashImpact(${i})`, context)),
  [-900_000, 150_000, -350_000],
  'CFO working-capital choices must have differentiated cash impacts',
);

console.log('PORTO smoke tests passed: syntax, six modes, accessibility, covariance, VaR, monetary holdings, asset-level market simulation, strategy risk profiles, balanced answers, CFO cash flows and anti-farming guards.');
