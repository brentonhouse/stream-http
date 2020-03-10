const capability = require('./capability');
const { inherits } = require('util');
const stream = require('readable-stream');

const rStates = exports.readyStates = {
	UNSENT:           0,
	OPENED:           1,
	HEADERS_RECEIVED: 2,
	LOADING:          3,
	DONE:             4,
};

const IncomingMessage = exports.IncomingMessage = function (xhr, response, mode, fetchTimer) {
	const self = this;
	stream.Readable.call(self);

	self._mode = mode;
	self.headers = {};
	self.rawHeaders = [];
	self.trailers = {};
	self.rawTrailers = [];

	// Fake the 'close' event, but only once 'end' fires
	self.on('end', () => {
		// The nextTick is necessary to prevent the 'request' module from causing an infinite loop
		process.nextTick(() => {
			self.emit('close');
		});
	});

	if (mode === 'fetch') {
		self._fetchResponse = response;

		self.url = response.url;
		self.statusCode = response.status;
		self.statusMessage = response.statusText;

		response.headers.forEach((header, key) => {
			self.headers[key.toLowerCase()] = header;
			self.rawHeaders.push(key, header);
		});

		if (capability.writableStream) {
			const writable = new WritableStream({
				write: function (chunk) {
					return new Promise(((resolve, reject) => {
						if (self._destroyed) {
							reject();
						} else if (self.push(Buffer.from(chunk))) {
							resolve();
						} else {
							self._resumeFetch = resolve;
						}
					}));
				},
				close: function () {
					global.clearTimeout(fetchTimer);
					if (!self._destroyed) { self.push(null); }
				},
				abort: function (err) {
					if (!self._destroyed) { self.emit('error', err); }
				},
			});

			try {
				response.body.pipeTo(writable).catch(err => {
					global.clearTimeout(fetchTimer);
					if (!self._destroyed) { self.emit('error', err); }
				});
				return;
			} catch (e) {} // pipeTo method isn't defined. Can't find a better way to feature test this
		}
		// fallback for when writableStream or pipeTo aren't available
		const reader = response.body.getReader();
		function read () {
			reader.read().then(result => {
				if (self._destroyed) { return; }
				if (result.done) {
					global.clearTimeout(fetchTimer);
					self.push(null);
					return;
				}
				self.push(Buffer.from(result.value));
				read();
			}).catch(err => {
				global.clearTimeout(fetchTimer);
				if (!self._destroyed) { self.emit('error', err); }
			});
		}
		read();
	} else {
		self._xhr = xhr;
		self._pos = 0;

		self.url = xhr.responseURL;
		self.statusCode = xhr.status;
		self.statusMessage = xhr.statusText;
		// const headers = xhr.getAllResponseHeaders().split(/\r?\n/);
		const headers = xhr.allResponseHeaders.split(/\r?\n/);
		headers.forEach(header => {
			const matches = header.match(/^([^:]+):\s*(.*)/);
			if (matches) {
				const key = matches[1].toLowerCase();
				if (key === 'set-cookie') {
					if (self.headers[key] === undefined) {
						self.headers[key] = [];
					}
					self.headers[key].push(matches[2]);
				} else if (self.headers[key] !== undefined) {
					self.headers[key] += `, ${matches[2]}`;
				} else {
					self.headers[key] = matches[2];
				}
				self.rawHeaders.push(matches[1], matches[2]);
			}
		});

		self._charset = 'x-user-defined';
		if (!capability.overrideMimeType) {
			const mimeType = self.rawHeaders['mime-type'];
			if (mimeType) {
				const charsetMatch = mimeType.match(/;\s*charset=([^;])(;|$)/);
				if (charsetMatch) {
					self._charset = charsetMatch[1].toLowerCase();
				}
			}
			if (!self._charset) { self._charset = 'utf-8'; } // best guess
		}
	}
};

inherits(IncomingMessage, stream.Readable);

IncomingMessage.prototype._read = function () {
	const self = this;

	const resolve = self._resumeFetch;
	if (resolve) {
		self._resumeFetch = null;
		resolve();
	}
};

IncomingMessage.prototype._onXHRProgress = function () {
	const self = this;

	const xhr = self._xhr;

	let response = null;
	console.debug(`self._mode: ${JSON.stringify(self._mode, null, 2)}`);
	switch (self._mode) {
		case 'text':
			response = xhr.responseText;
			if (response.length > self._pos) {
				const newData = response.substr(self._pos);
				if (self._charset === 'x-user-defined') {
					const buffer = Buffer.alloc(newData.length);
					for (let i = 0; i < newData.length; i++) { buffer[i] = newData.charCodeAt(i) & 0xff; }

					self.push(buffer);
				} else {
					self.push(newData, self._charset);
				}
				self._pos = response.length;
			}
			break;
		case 'arraybuffer':
			if (xhr.readyState !== rStates.DONE || !xhr.response) { break; }
			response = xhr.response;
			self.push(Buffer.from(new Uint8Array(response)));
			break;
		case 'moz-chunked-arraybuffer': // take whole
			response = xhr.response;
			if (xhr.readyState !== rStates.LOADING || !response) { break; }
			self.push(Buffer.from(new Uint8Array(response)));
			break;
		case 'ms-stream':
			response = xhr.response;
			if (xhr.readyState !== rStates.LOADING) { break; }
			var reader = new global.MSStreamReader();
			reader.onprogress = function () {
				if (reader.result.byteLength > self._pos) {
					self.push(Buffer.from(new Uint8Array(reader.result.slice(self._pos))));
					self._pos = reader.result.byteLength;
				}
			};
			reader.onload = function () {
				self.push(null);
			};
			// reader.onerror = ??? // TODO: this
			reader.readAsArrayBuffer(response);
			break;
	}

	// The ms-stream case handles end separately in reader.onload()
	if (self._xhr.readyState === rStates.DONE && self._mode !== 'ms-stream') {
		self.push(null);
	}
};
