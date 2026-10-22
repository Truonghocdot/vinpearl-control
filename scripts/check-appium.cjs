const assert = require('node:assert/strict');
const http = require('node:http');
const { AppiumClient } = require('../dist-electron/src/main/appium-client.js');

const calls = [];
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    calls.push({ method: request.method, url: request.url, body: body ? JSON.parse(body) : undefined });
    let value = null;
    if (request.url === '/status') value = { ready: true };
    else if (request.url === '/session' && request.method === 'POST') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ value: { sessionId: 'mock-session', capabilities: {} } })); return; }
    else if (request.url === '/session/mock-session/element') value = { 'element-6066-11e4-a52e-4f735466cecf': 'element-1' };
    else if (request.url === '/session/mock-session/screenshot') value = 'aGVsbG8=';
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ value }));
  });
});

server.listen(0, '127.0.0.1', async () => {
  try {
    const port = server.address().port;
    const client = new AppiumClient({ port });
    assert.equal(await client.health(), true);
    const session = await client.createSession('00008101-001D48683E88001E', 'net.cloudhms.booking.vinpearl', 8100);
    assert.equal(session.id, 'mock-session');
    await client.launch(session);
    await client.click(session.id, { text: "Đăng nhập" });
    await client.input(session.id, { accessibilityId: 'email' }, 'operator@example.test');
    assert.equal(await client.screenshot(session.id), 'aGVsbG8=');
    await client.deleteSession(session.id);
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:udid'], '00008101-001D48683E88001E');
    assert.equal(calls.find((call) => call.url.endsWith('/activate_app')).body.bundleId, 'net.cloudhms.booking.vinpearl');
    assert.equal(calls.find((call) => call.url.endsWith('/value')).body.text, 'operator@example.test');
    assert.ok(calls.some((call) => call.method === 'DELETE' && call.url === '/session/mock-session'));
    console.log('appium client check ok: health, session, selectors, input, screenshot and cleanup');
  } catch (error) { console.error(error); process.exitCode = 1; } finally { server.close(); }
});
