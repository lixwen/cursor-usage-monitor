#!/usr/bin/env node
/**
 * Test Team API
 * Usage: node test-team-api.js <WorkosCursorSessionToken>
 */

const https = require('https');

const tokenInput = process.argv[2];

if (!tokenInput) {
  console.log('Usage: node test-team-api.js <WorkosCursorSessionToken>');
  process.exit(1);
}

const decodedToken = decodeURIComponent(tokenInput);
console.log('='.repeat(60));
console.log('Team API Test');
console.log('='.repeat(60));

function makeRequest(url, method, body) {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const bodyStr = body ? JSON.stringify(body) : '';
    
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname,
      method: method,
      headers: {
        'Cookie': `WorkosCursorSessionToken=${encodeURIComponent(decodedToken)}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Origin': 'https://cursor.com',
        'Referer': 'https://cursor.com/cn/dashboard',
        ...(method === 'POST' && bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {})
      }
    };

    console.log(`\n🔍 ${method} ${url}`);
    if (body) console.log('   Body:', JSON.stringify(body));

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });

    req.on('error', (e) => resolve({ error: e.message }));
    
    if (method === 'POST' && bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

async function test() {
  // Step 1: Get teams
  console.log('\n📊 Step 1: Fetch Teams');
  console.log('-'.repeat(40));
  
  let result = await makeRequest('https://cursor.com/api/dashboard/teams', 'POST', {});
  console.log(`   Status: ${result.statusCode}`);
  
  if (result.error) {
    console.log(`   Error: ${result.error}`);
    return;
  }

  let teams = null;
  try {
    const data = JSON.parse(result.body);
    console.log('   Response:', JSON.stringify(data, null, 2));
    teams = data.teams;
  } catch (e) {
    console.log('   Raw response:', result.body.substring(0, 500));
    return;
  }

  if (!teams || teams.length === 0) {
    console.log('   No teams found!');
    return;
  }

  const team = teams[0];
  console.log(`\n   ✅ Found team: ${team.name} (ID: ${team.id})`);

  // Step 2: Get team spend
  console.log('\n📊 Step 2: Fetch Team Spend');
  console.log('-'.repeat(40));
  
  result = await makeRequest('https://cursor.com/api/dashboard/get-team-spend', 'POST', {
    teamId: team.id,
    page: 1,
    pageSize: 50,
    sortBy: 'name',
    sortDirection: 'asc'
  });
  
  console.log(`   Status: ${result.statusCode}`);
  
  if (result.error) {
    console.log(`   Error: ${result.error}`);
    return;
  }

  try {
    const data = JSON.parse(result.body);
    console.log('   Response:', JSON.stringify(data, null, 2).substring(0, 1500));
    console.log(`\n   ✅ maxUserSpendCents: ${data.maxUserSpendCents}`);
    console.log(`   💰 That's $${(data.maxUserSpendCents / 100).toFixed(2)}`);
  } catch (e) {
    console.log('   Raw response:', result.body.substring(0, 500));
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test Complete');
  console.log('='.repeat(60));
}

test();
