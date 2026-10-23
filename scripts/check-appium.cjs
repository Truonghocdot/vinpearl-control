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
    else if (request.url === '/session/mock-session/element/element-1/text') value = '2';
    else if (request.url === '/session/mock-session/screenshot') value = 'aGVsbG8=';
    else if (request.url === '/session/mock-session/elements') value = [{ 'element-6066-11e4-a52e-4f735466cecf': 'element-2' }];
    else if (request.url.endsWith('/rect')) value = { x: 0, y: 100, width: 300, height: 400 };
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ value }));
  });
});

server.listen(0, '127.0.0.1', async () => {
  try {
    const port = server.address().port;
    const client = new AppiumClient({ port, xcodeOrgId: 'TEAM123', waitForIdleTimeout: 1, maxTypingFrequency: 60 });
    assert.equal(await client.health(), true);
    const session = await client.createSession('00008101-001D48683E88001E', 'net.cloudhms.booking.vinpearl', 8100);
    assert.equal(session.id, 'mock-session');
    await client.launch(session);
    await client.click(session.id, { text: "Đăng nhập" });
    await client.input(session.id, { accessibilityId: 'email' }, 'operator@example.test');
    await client.clear(session.id, { accessibilityId: 'email' });
    await client.find(session.id, { classChain: '**/XCUIElementTypeButton[1]' });
    await client.find(session.id, { xpath: "//XCUIElementTypeButton[@name='Xác nhận']" });
    assert.equal(await client.text(session.id, { predicate: "name == '2'" }), '2');
    await client.scroll(session.id, 'down');
    const [header] = await client.findAll(session.id, { predicate: "name BEGINSWITH 'Tháng '" });
    await client.scroll(session.id, 'up', header, 0.5);
    await client.tapCenter(session.id, header);
    assert.equal(await client.screenshot(session.id), 'aGVsbG8=');
    await client.deleteSession(session.id);
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:udid'], '00008101-001D48683E88001E');
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:xcodeOrgId'], 'TEAM123');
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:waitForIdleTimeout'], 1);
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:useNewWDA'], false);
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:settings[animationCoolOffTimeout]'], 0);
    assert.equal(new AppiumClient().waitForIdleTimeout, 0, 'Idle waits default to off.');
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:shouldTerminateApp'], false);
    assert.equal(calls.find((call) => call.url.endsWith('/activate_app')).body.bundleId, 'net.cloudhms.booking.vinpearl');
    assert.equal(calls.find((call) => call.url.endsWith('/value')).body.text, 'operator@example.test');
    assert.ok(calls.some((call) => call.url.endsWith('/clear')));
    assert.equal(calls.find((call) => call.body?.using === '-ios class chain').body.value, '**/XCUIElementTypeButton[1]');
    assert.equal(calls.find((call) => call.body?.using === 'xpath').body.value, "//XCUIElementTypeButton[@name='Xác nhận']");
    const drags = calls.filter((call) => call.url.endsWith('/actions')).map((call) => call.body.actions[0].actions);
    assert.ok(calls.some((call) => call.url.endsWith('/window/rect')), 'Scroll without a container drags inside the window.');
    assert.deepEqual([drags[0][0].y, drags[0][2].y], [420, 180], 'Scrolling down drags the finger upward within the middle 60%.');
    assert.deepEqual([drags[1][0].y, drags[1][2].y], [200, 400], 'Scrolling up drags the finger downward inside the container.');
    assert.equal(drags[1][3].type, 'pause', 'Drags hold before lifting to limit momentum.');
    assert.deepEqual([drags[2][0].x, drags[2][0].y], [150, 300], 'tapCenter taps the element frame center.');
    assert.ok(!calls.some((call) => call.body?.script === 'mobile: scroll'), 'mobile: scroll is too slow (4-8s per call).');
    assert.ok(calls.some((call) => call.method === 'DELETE' && call.url === '/session/mock-session'));
    console.log('appium client check ok: health, session, selectors, input, screenshot and cleanup');
  } catch (error) { console.error(error); process.exitCode = 1; } finally { server.close(); }
});
