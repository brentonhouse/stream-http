global.location = {};
global.location.protocol = 'http';
global.XMLHttpRequest = function () {
	return Ti.Network.createHTTPClient();
};

const ClientRequest = require('./lib/request');
const response = require('./lib/response');
const extend = require('xtend');
const statusCodes = require('builtin-status-codes');
const url = require('url');

const http = exports;

http.request = function (uri, opts, cb) {

	if (typeof uri === 'string') {
		opts = extend(opts || {}, url.parse(uri));
	} else {
		cb = opts;
		opts = uri;
		uri = null;
	}

	// Normally, the page is loaded from http or https, so not specifying a protocol
	// will result in a (valid) protocol-relative url. However, this won't work if
	// the protocol is something else, like 'file:'
	const defaultProtocol = global.location.protocol.search(/^https?:$/) === -1 ? 'http:' : '';

	const protocol = opts.protocol || defaultProtocol;
	let host = opts.hostname || opts.host;
	const { port } = opts;
	const path = opts.path || '/';

	// Necessary for IPv6 addresses
	if (host && host.indexOf(':') !== -1) {
		host = `[${host}]`;
	}

	// This may be a relative url. The browser should always be able to interpret it correctly.
	opts.url = (host ? (`${protocol}//${host}`) : '') + (port ? `:${port}` : '') + path;
	opts.method = (opts.method || 'GET').toUpperCase();
	opts.headers = opts.headers || {};

	// Also valid opts.auth, opts.mode

	const req = new ClientRequest(opts);
	if (cb) {
		req.on('response', cb);
	}
	return req;
};

http.get = function get (opts, cb) {
	const req = http.request(opts, cb);
	req.end();
	return req;
};

http.ClientRequest = ClientRequest;
http.IncomingMessage = response.IncomingMessage;

http.Agent = function () {};
http.Agent.defaultMaxSockets = 4;

http.globalAgent = new http.Agent();

http.STATUS_CODES = statusCodes;

http.METHODS = [
	'CHECKOUT',
	'CONNECT',
	'COPY',
	'DELETE',
	'GET',
	'HEAD',
	'LOCK',
	'M-SEARCH',
	'MERGE',
	'MKACTIVITY',
	'MKCOL',
	'MOVE',
	'NOTIFY',
	'OPTIONS',
	'PATCH',
	'POST',
	'PROPFIND',
	'PROPPATCH',
	'PURGE',
	'PUT',
	'REPORT',
	'SEARCH',
	'SUBSCRIBE',
	'TRACE',
	'UNLOCK',
	'UNSUBSCRIBE',
];
