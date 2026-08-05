const { DEFAULT_SOURCE, SOURCES, normalizeSource } = require('../protocol/shared/contracts');

class LogSourceRegistry {
	#services;

	constructor({ android, ios, debug, onEvent } = {}) {
		this.#services = new Map([
			[SOURCES.ANDROID, android],
			[SOURCES.IOS, ios],
			[SOURCES.DEBUG, debug],
		]);

		if (onEvent) {
			android?.on?.('adbevent', onEvent);
			ios?.on?.('iosevent', onEvent);
			debug?.on?.('debugevent', onEvent);
		}
	}

	service(source = DEFAULT_SOURCE) {
		return this.#services.get(normalizeSource(source)) || this.#services.get(DEFAULT_SOURCE);
	}

	sourceFromMessage(message, fallback = DEFAULT_SOURCE) {
		return normalizeSource(message?.data?.source, fallback);
	}

	stopInactive(source) {
		const activeSource = normalizeSource(source);
		for (const [candidate, service] of this.#services.entries()) {
			if (candidate !== activeSource) service?.stop?.();
		}
	}

	stopAll() {
		for (const service of this.#services.values()) {
			service?.stop?.();
		}
	}

	stopDeviceTracking() {
		for (const service of this.#services.values()) {
			service?.stopDeviceTracking?.();
		}
	}

	dispose() {
		for (const service of this.#services.values()) {
			service?.dispose?.();
		}
	}
}

module.exports = LogSourceRegistry;
