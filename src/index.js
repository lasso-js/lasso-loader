var resourceLoader = require('./resource-loader');
var EventEmitter = require('events').EventEmitter;

var timeout = 3000;
var pending = {};
var completed = {};
var failed = {};
var emitter = new EventEmitter();

function start(resourceType, url) {

    if (!pending[url]) {
        pending[url] = true;

        var callback;

        var timeoutId = setTimeout(function() {
            callback('Timeout after ' + timeout + 'ms');
        }, timeout);

        callback = function(err) {
            if (!pending[url]) {
                // Callback was already invoked... most likely due
                // to a timeout
                return;
            }

            clearTimeout(timeoutId);

            delete pending[url];

            if (err) {
                failed[url] = err;
            } else {
                completed[url] = true;
            }

            emitter.emit(url, err, url);
        };

        resourceLoader[resourceType](url, callback);
    }
}

function load(resources, callback) {
    var errorMessages = [];
    var pendingCount = 0;
    var allProcessed = false;

    function done() {
        if (errorMessages.length) {
            callback('Failed: ' + errorMessages.join(', '));
        } else {
            callback();
        }
    }

    function listener(err, url) {
        if (err) {
            errorMessages.push(url + ' (' + err + ')');
        }

        // It's possible that the `listener` can be invoked before
        // `process(...)` functions return which can cause `done()`
        // to be called twice. We only invoke `done()` if we
        // both of the `process(...)` functions have returned.
        // See https://github.com/lasso-js/lasso-loader/issues/1
        if ((--pendingCount === 0) && allProcessed) {
            done();
        }
    }

    function process(resourceType) {
        var resourcesForType = resources[resourceType];
        if (resourcesForType) {
            for (var i=0, len=resourcesForType.length; i<len; i++) {
                var url = resourcesForType[i];
                if (failed[url]) {
                    errorMessages.push(url + ' (' + failed[url] + ')');
                } else if (!completed[url]) {
                    pendingCount++;
                    emitter.once(url, listener);
                    start(resourceType, url);
                }
            }
        }
    }

    process('css');
    process('js');

    // Set flag to indicate that we finished processing all of the css and js
    // and we're waiting to be notified when they complete.
    allProcessed = true;

    if (pendingCount === 0) {
        done();
    }
}

function async(asyncId, callback) {
    var loaderMeta = window.$lassoLoaderMeta;
    var resources = loaderMeta ? loaderMeta[asyncId] : null;
    if (!resources) {
        throw new Error('Loader metadata missing for "' + asyncId + '"');
    }

    var job;
    var modulesRuntime = require.runtime;
    if (modulesRuntime) {
        // Create a pending job in the module runtime system which will
        // prevent any "require-run" modules from running if they are
        // configured to wait until ready.
        // When all pending jobs are completed, the "require-run" modules
        // that have been queued up will be ran.
        job = modulesRuntime.pending();
    }

    load(resources, function(err, result) {
        // Trigger "ready" event in raptor modules runtime to trigger running
        // require-run modules that were loaded asynchronously
        if (job) {
            // let the module system know that we are done with pending job
            // of loading modules
            job.done(err);
        }

        callback(err, result);
    });
}

exports.setTimeout = function(_timeout) {
    timeout = _timeout;
};

exports.load = load;
exports.async = async;