const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');

const LogSourceRegistry = require('../src/backend/log-source-registry');
const { SOURCES } = require('../src/shared/contracts');

function service() {
	const emitter = new EventEmitter();
	emitter.stopped = 0;
	emitter.trackingStopped = 0;
	emitter.disposed = 0;
	emitter.stop = () => { emitter.stopped++; };
	emitter.stopDeviceTracking = () => { emitter.trackingStopped++; };
	emitter.dispose = () => { emitter.disposed++; };
	return emitter;
}

test('returns services by normalized source with Android fallback', () => {
	const android = service();
	const ios = service();
	const debug = service();
	const registry = new LogSourceRegistry({ android, ios, debug });

	assert.equal(registry.service(SOURCES.ANDROID), android);
	assert.equal(registry.service(SOURCES.IOS), ios);
	assert.equal(registry.service(SOURCES.DEBUG), debug);
	assert.equal(registry.service('unknown'), android);
});

test('normalizes source from UI messages', () => {
	const registry = new LogSourceRegistry({ android: service(), ios: service(), debug: service() });

	assert.equal(registry.sourceFromMessage({ data: { source: SOURCES.IOS } }, SOURCES.ANDROID), SOURCES.IOS);
	assert.equal(registry.sourceFromMessage({ data: { source: 'bad' } }, SOURCES.DEBUG), SOURCES.DEBUG);
	assert.equal(registry.sourceFromMessage({}, SOURCES.IOS), SOURCES.IOS);
});

test('stops only inactive services', () => {
	const android = service();
	const ios = service();
	const debug = service();
	const registry = new LogSourceRegistry({ android, ios, debug });

	registry.stopInactive(SOURCES.IOS);

	assert.equal(android.stopped, 1);
	assert.equal(ios.stopped, 0);
	assert.equal(debug.stopped, 1);
});

test('subscribes source event channels to one handler', () => {
	const android = service();
	const ios = service();
	const debug = service();
	const events = [];
	new LogSourceRegistry({ android, ios, debug, onEvent: event => events.push(event) });

	android.emit('adbevent', { type: 'android.log' });
	ios.emit('iosevent', { type: 'ios.log' });
	debug.emit('debugevent', { type: 'debug.log' });

	assert.deepEqual(events.map(event => event.type), ['android.log', 'ios.log', 'debug.log']);
});
