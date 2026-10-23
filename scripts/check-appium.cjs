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
    if (request.url === '/status') value = { ready: true, os: { name: 'iOS', version: '15.8.8' } };
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
    await client.drags(session.id, { x: 0, y: 100, width: 300, height: 400 }, 'down', [200, 150]);
    assert.equal(await client.screenshot(session.id), 'aGVsbG8=');
    await client.deleteSession(session.id);
    // IP devices attach to the WDA on the iPhone instead of forwarding ports over USB.
    await client.createSession('00008101-001D48683E88001E', 'net.cloudhms.booking.vinpearl', 8100, { webDriverAgentUrl: 'http://192.168.1.20:8100', platformVersion: '15.8.8' });
    const ipCapabilities = calls.filter((call) => call.url === '/session' && call.method === 'POST').at(-1).body.capabilities.alwaysMatch;
    assert.equal(ipCapabilities['appium:webDriverAgentUrl'], 'http://192.168.1.20:8100');
    assert.ok(!('appium:wdaLocalPort' in ipCapabilities) && !('appium:mjpegServerPort' in ipCapabilities), 'IP sessions forward no ports.');
    assert.ok(!('appium:bundleId' in ipCapabilities) && ipCapabilities['appium:noReset'] && ipCapabilities['appium:skipLogCapture'], 'IP sessions never touch the device link: no app check, reset or syslog.');
    assert.equal(ipCapabilities['appium:platformVersion'], '15.8.8', 'Without it the driver asks lockdown (USB) for the iOS version.');
    assert.ok(!('appium:platformVersion' in calls[1].body.capabilities.alwaysMatch));
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:bundleId'], 'net.cloudhms.booking.vinpearl');
    assert.deepEqual(await client.wdaStatus('127.0.0.1', port), { platformVersion: '15.8.8' });
    assert.equal(await client.wdaStatus('127.0.0.1', 1), null);
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:udid'], '00008101-001D48683E88001E');
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:xcodeOrgId'], 'TEAM123');
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:waitForIdleTimeout'], 1);
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:useNewWDA'], false);
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:mjpegServerPort'] - calls[1].body.capabilities.alwaysMatch['appium:wdaLocalPort'], 1000, 'Each device forwards its MJPEG stream to its own port.');
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:settings[animationCoolOffTimeout]'], 0);
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:reduceMotion'], true);
    assert.ok(calls.some((call) => call.body?.using === 'accessibility id' && call.body.value === 'Đăng nhập'), 'Text selectors use the faster accessibility id lookup.');
    assert.equal(new AppiumClient().waitForIdleTimeout, 0, 'Idle waits default to off.');
    assert.equal(calls[1].body.capabilities.alwaysMatch['appium:shouldTerminateApp'], false);
    assert.equal(calls.find((call) => call.url.endsWith('/activate_app')).body.bundleId, 'net.cloudhms.booking.vinpearl');
    assert.equal(calls.find((call) => call.url.endsWith('/value')).body.text, 'operator@example.test');
    assert.ok(calls.some((call) => call.url.endsWith('/clear')));
    assert.equal(calls.find((call) => call.body?.using === '-ios class chain').body.value, '**/XCUIElementTypeButton[1]');
    assert.equal(calls.find((call) => call.body?.using === 'xpath').body.value, "//XCUIElementTypeButton[@name='Xác nhận']");
    const gestures = calls.filter((call) => call.url.endsWith('/actions')).map((call) => call.body.actions);
    const drags = gestures.map((pointers) => pointers[0].actions);
    assert.ok(calls.some((call) => call.url.endsWith('/window/rect')), 'Scroll without a container drags inside the window.');
    // Window rect y=100 h=400, 2% margins: a 60% scroll down travels 240px from y=492, finishing the last 8px slowly.
    assert.deepEqual([drags[0][0].y, drags[0][2].y, drags[0][3].y], [492, 260, 252], 'Scrolling down drags upward and ends with a slow tail.');
    assert.equal(drags[0][2].duration, 240, 'Drags sweep at ~1px/ms: faster sweeps lose distance to the scroll view.');
    assert.ok(drags[0][3].duration >= 150, 'The slow tail lifts the finger at ~0 velocity so the list does not coast.');
    assert.deepEqual([drags[1][0].y, drags[1][3].y], [108, 308], 'Scrolling up drags the finger downward inside the container.');
    assert.deepEqual([drags[2][0].x, drags[2][0].y], [150, 300], 'tapCenter taps the element frame center.');
    assert.equal(gestures[3].length, 2, 'Multiple drags go out as separate pointers in one call.');
    assert.equal(gestures[3][1].actions[0].type, 'pause', 'The second pointer waits for the first drag to finish.');
    assert.ok(!calls.some((call) => call.body?.script === 'mobile: scroll'), 'mobile: scroll is too slow (4-8s per call).');
    assert.ok(calls.some((call) => call.method === 'DELETE' && call.url === '/session/mock-session'));
    console.log('appium client check ok: health, USB and IP sessions, selectors, input, screenshot and cleanup');
  } catch (error) { console.error(error); process.exitCode = 1; } finally { server.close(); }
});
