import { test, expect } from '@playwright/test';

async function setup(page, stats = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (['error','assert'].includes(m.type())) errors.push(m.text()); });
  await page.addInitScript(({ stats }) => {
    localStorage.setItem('datamon-save-v1', JSON.stringify({ schemaVersion: 2, player: 'julien-hovan', defeated: [], questionStats: stats, seenCounter: 20, coffeeUses: 3 }));
  }, { stats });
  await page.goto('/');
  await page.waitForFunction(() => { try { return (0,eval)('officeMapCv') !== null; } catch { return false; } });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (0,eval)('state') === 'overworld');
  return errors;
}
async function protectedState(page) {
  return page.evaluate(() => {
    const ge=(0,eval), p=ge('player');
    return { hp:p.hp, pos:[p.x,p.y], defeated:[...ge('defeated')], progression:JSON.stringify(ge('_progression')), coffee:ge('coffeeUses'), library:JSON.stringify(ge('libraryProgress')), scores:JSON.stringify(ge('minigameScores')) };
  });
}

test('discover all canonical questions and actual colleague pools without recording views', async ({ page }) => {
  const errors = await setup(page);
  await page.getByRole('button', { name: 'Q · Question Hub', exact:true }).click();
  const hub = page.getByRole('dialog');
  await expect(hub.getByRole('heading', { name: 'No missed questions yet' })).toBeVisible();
  await hub.getByRole('button', { name: 'Show all questions' }).click();
  await expect(hub.getByText('120 of 120 questions', {exact:true})).toBeVisible();
  await expect(hub.locator('.hub-question')).toHaveCount(12);
  await hub.getByLabel('Topic', {exact:true}).selectOption('MCP');
  await expect(hub.getByText('24 of 120 questions', {exact:true})).toBeVisible();
  await hub.getByRole('button', {name:'Next page'}).click();
  await expect(hub.getByText('Page 2 of 2', {exact:true})).toBeVisible();
  await hub.getByLabel('Search questions or colleagues').fill('mcp-024');
  await expect(hub.locator('.hub-question')).toHaveCount(1);
  await hub.locator('.hub-question summary').first().click();
  await expect(hub.getByText(/no one exclusively owns this question/)).toBeVisible();
  const expected = await page.evaluate(() => (0,eval)('npcs').filter(n=>n.type==='MCP').map(n=>(0,eval)('displayName')(n.slug)));
  for (const name of expected) await expect(hub.getByRole('button', {name:'Find '+name,exact:true})).toBeVisible();
  await hub.getByLabel('Search questions or colleagues').fill(expected[0]);
  await expect(hub.getByText('24 of 120 questions', {exact:true})).toBeVisible();
  await hub.getByLabel('Search questions or colleagues').fill('mcp'); // typing M must not mute
  expect(await page.evaluate(() => (0,eval)('muted'))).toBe(false);
  await page.keyboard.press('Escape');
  await expect(hub).not.toBeVisible();
  await expect(page.locator('#game')).toBeFocused();
  expect(await page.evaluate(() => (0,eval)('seenCounter'))).toBe(20);
  expect(await page.evaluate(() => Object.keys((0,eval)('questionStats')))).toEqual([]);
  expect(errors).toEqual([]);
});

test('missed practice is exact-once, untimed, persistent, and never changes campaign or HP', async ({ page }) => {
  const errors = await setup(page, { 'agent-001':{seen:1,correct:0,wrong:1,lastSeen:1} });
  const before = await protectedState(page);
  await page.keyboard.press('q');
  const hub = page.getByRole('dialog');
  await expect(hub.getByText('1 of 120 questions', {exact:true})).toBeVisible();
  await hub.getByRole('button', {name:'Practice 1 question',exact:true}).click();
  await page.keyboard.press('ArrowDown'); // scroll, not world movement
  expect(await protectedState(page)).toEqual(before);
  await hub.getByRole('button', {name:'1. stop_reason of tool_use',exact:true}).focus();
  await page.keyboard.down('Enter');
  await page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true})));
  await expect(hub.getByRole('heading', {name:'Practice 1 of 1',exact:true})).toBeVisible();
  await page.keyboard.up('Enter');
  await expect(hub.getByRole('heading', {name:'Correct',exact:true})).toBeVisible();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('datamon-save-v1')));
  expect(persisted.questionStats['agent-001']).toEqual({seen:2,correct:1,wrong:1,lastSeen:21});
  expect(persisted.questionStats['AGENT:0']).toEqual(persisted.questionStats['agent-001']);
  await hub.getByRole('button', {name:'Finish practice'}).click();
  await expect(hub.getByText('1 of 1 correct', {exact:true})).toBeVisible();
  await hub.getByRole('button', {name:'Back to questions'}).click();
  await expect(hub.getByText('1 of 120 questions', {exact:true})).toBeVisible(); // history stays
  await hub.getByRole('button', {name:'Practice 1 question',exact:true}).click();
  await page.keyboard.press('Escape'); // abandoned reveal is not an incorrect answer
  expect(await protectedState(page)).toEqual(before);
  expect(await page.evaluate(() => (0,eval)('questionStats')['agent-001'])).toEqual({seen:3,correct:1,wrong:1,lastSeen:22});
  expect(await page.evaluate(() => (0,eval)('loadSave')().questionStats['agent-001'])).toEqual({seen:3,correct:1,wrong:1,lastSeen:22});
  expect(errors).toEqual([]);
});

test('bounded five-question sessions show explanations and offer only session misses for retry', async ({ page }) => {
  await setup(page);
  await page.keyboard.press('q'); const hub=page.getByRole('dialog');
  await hub.getByRole('button',{name:'Show all questions'}).click();
  await hub.getByRole('button',{name:'Practice 5 questions'}).click();
  for (let i=0;i<5;i++) {
    await hub.locator('.hub-choices button').first().click();
    await expect(hub.locator('.hub-feedback p')).not.toBeEmpty();
    await hub.getByRole('button',{name:i===4?'Finish practice':'Next question',exact:true}).click();
  }
  await expect(hub.getByText('1 of 5 correct',{exact:true})).toBeVisible();
  await hub.getByRole('button',{name:'Retry 4 missed in this session'}).click();
  await expect(hub.getByRole('heading',{name:'Practice 1 of 4'})).toBeVisible();
  expect(await page.evaluate(() => (0,eval)('seenCounter'))).toBe(26);
});

test('map routes lead to real interactions and the hub works inside the Library', async ({ page }) => {
  const errors = await setup(page);
  await page.keyboard.press('q'); const hub=page.getByRole('dialog');
  await hub.getByRole('button',{name:'Map & colleagues',exact:true}).click();
  await expect(hub.locator('.hub-map-grid > section')).toHaveCount(6);
  await hub.getByRole('button',{name:'Directions to The Library',exact:true}).click();
  await expect(hub).not.toBeVisible();
  const route = await page.evaluate(() => (0,eval)('walkingRoute')());
  expect(route.length).toBeGreaterThan(1);
  for (let i=1; i<route.length; i++) {
    const a=route[i-1],b=route[i], key=b.x>a.x?'ArrowRight':b.x<a.x?'ArrowLeft':b.y>a.y?'ArrowDown':'ArrowUp';
    await page.keyboard.press(key);
    await page.waitForFunction(({x,y}) => {const p=(0,eval)('player');return !p.moving&&p.x===x&&p.y===y;}, b);
  }
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => (0,eval)('currentMap')==='library');
  await page.keyboard.press('q');
  await hub.getByRole('button',{name:'Map & colleagues',exact:true}).click();
  await expect(hub.getByRole('button',{name:'Directions to Office return'})).toBeVisible();
  await expect(hub.getByRole('button',{name:'Directions to Matching Pairs'})).toBeVisible();
  await hub.getByRole('button',{name:'Directions to Matching Pairs'}).click();
  expect(await page.evaluate(() => (0,eval)('walkingRoute')().length)).toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (0,eval)('navigationTarget'))).toBeNull();
  expect(errors).toEqual([]);
});

test('console topic selection opens questions and closing preserves the console', async ({page}) => {
  await setup(page);
  await page.evaluate(() => (0,eval)('openCertificationConsole')());
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  const hub=page.getByRole('dialog');
  await expect(hub.getByLabel('Topic',{exact:true})).toHaveValue('MCP');
  await expect(hub.getByText('24 of 120 questions',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (0,eval)('certConsoleOpen'))).toBe(true);
});

test('small screens wrap full choices, trap focus, and expose touch controls', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  const errors=await setup(page);
  await page.getByRole('button',{name:'Q · Question Hub',exact:true}).click();
  const hub=page.getByRole('dialog');
  await hub.getByRole('button',{name:'Show all questions'}).click();
  await hub.getByLabel('Search questions or colleagues').fill('agent-003');
  await hub.getByRole('button',{name:'Practice 1 question',exact:true}).click();
  await hub.locator('.hub-choices button').nth(1).click();
  await expect(hub.locator('.hub-feedback p')).toBeVisible();
  expect(await hub.evaluate(d => d.scrollWidth <= d.clientWidth && d.querySelector('.hub-content').scrollWidth <= d.querySelector('.hub-content').clientWidth)).toBe(true);
  await page.screenshot({path:'/tmp/datamon-hub-mobile.png'});
  for(let i=0;i<12;i++) { await page.keyboard.press('Tab'); expect(await hub.evaluate(d=>d.contains(document.activeElement))).toBe(true); }
  await hub.getByRole('button',{name:'Close · Esc'}).click();
  await expect(page.locator('#game')).toBeFocused();
  expect(errors).toEqual([]);
});

test('directory walking targets are reachable for all 37 roster choices and all three maps', async ({page}) => {
  await setup(page);
  const audit=await page.evaluate(() => {
    const ge=(0,eval), p=ge('player'), route=window.DatamonWorldLayout.routeToInteraction;
    const failures=[]; let officeChecks=0, roomChecks=0;
    for(const slug of ge('ROSTER')) {
      p.slug=slug; p.x=p.fx=18; p.y=p.fy=16;
      ge('_npcDomains = {}'); ge('placeNPCs')();
      const targets=ge('npcs').concat(ge('hubSnapshot')().destinations);
      for(const target of targets) { officeChecks++; if(!route(p,target,36,24,ge('walkable'))) failures.push(slug+':'+(target.slug||target.label)); }
    }
    for(const mapName of ['library','battleRoom']) {
      ge(`currentMap = '${mapName}'`); ge(`map = ${mapName==='library'?'LIBRARY_MAP':'BATTLE_ROOM_MAP'}`);
      ge(mapName==='library'?'npcs = []':'npcs = buildBattleRoomNPCs(player.slug)');
      p.x=p.fx=18; p.y=p.fy=22;
      for(const target of ge('npcs').concat(ge('hubSnapshot')().destinations)) { roomChecks++; if(!route(p,target,36,24,ge('walkable'))) failures.push(mapName+':'+(target.slug||target.label)); }
    }
    return {officeChecks,roomChecks,failures};
  });
  expect(audit).toEqual({officeChecks:1480,roomChecks:43,failures:[]});
});

test('future-version saves stay protected during hub practice and gameplay layers cannot open it', async ({page}) => {
  await setup(page);
  await page.evaluate(() => { const ge=(0,eval); localStorage.setItem('datamon-save-v1','{"schemaVersion":999,"player":"julien-hovan","future":"keep"}'); ge('_writeProtectedSave = true'); });
  const raw=await page.evaluate(()=>localStorage.getItem('datamon-save-v1'));
  await page.keyboard.press('q'); const hub=page.getByRole('dialog');
  await expect(hub.getByText(/changes cannot be saved/)).toBeVisible();
  await hub.getByRole('button',{name:'Show all questions'}).click();
  await hub.getByRole('button',{name:'Practice 5 questions'}).click();
  await hub.locator('.hub-choices button').first().click();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>localStorage.getItem('datamon-save-v1'))).toBe(raw);
  const opened=await page.evaluate(()=> {
    const ge=(0,eval); const values=[];
    for(const state of ['battle','dialogue','transition','minigame','victory','title']) { ge(`state = '${state}'`); values.push(window.DatamonQuestionHub.open()); }
    ge('state = "overworld"'); return values;
  });
  expect(opened).toEqual([false,false,false,false,false,false]);
});

test('Timed Recall records canonical answers for hub recovery without inventing timeout misses', async ({page}) => {
  const errors=await setup(page);
  await page.evaluate(async () => {const ge=(0,eval);ge('enterLibrary')();await ge('libraryLoadPromise');});
  await page.waitForFunction(()=>(0,eval)('currentMap')==='library');
  const result=await page.evaluate(()=>{
    const ge=(0,eval), before=ge('seenCounter'); ge('launchMinigame')('timed','recall','Timed Recall'); ge('initMinigame')();
    const mg=ge('currentMinigame'),item=mg.queue[0];
    ge('timedAnswer')((item.answerIdx+1)%4); ge('timedAnswer')((item.answerIdx+1)%4);
    const answer=JSON.parse(JSON.stringify(ge('questionStats')));
    ge('advanceTimed')(); const revealed=JSON.parse(JSON.stringify(ge('questionStats')));
    mg.timerEnd=0;ge('updateMinigame')();ge('updateMinigame')();
    const after=JSON.parse(JSON.stringify(ge('questionStats')));
    ge('exitMinigame')(mg.score);
    return {before,seenCounter:ge('seenCounter'),answer,revealed,after};
  });
  expect(result.seenCounter).toBe(result.before+2);
  const canonical=Object.entries(result.answer).filter(([key])=>!key.includes(':'));
  expect(canonical).toHaveLength(1); expect(canonical[0][1]).toMatchObject({seen:1,correct:0,wrong:1});
  expect(result.after).toEqual(result.revealed); // whole-session expiry is not a submitted answer
  await page.keyboard.press('q');const hub=page.getByRole('dialog');
  await expect(hub.getByText('1 of 120 questions',{exact:true})).toBeVisible();
  await expect(hub.locator('.hub-question summary')).toContainText(canonical[0][0]);
  expect(errors).toEqual([]);
});
