(function (global) {
  'use strict';

  if (global.__HMVC_INTERNAL__) throw new Error('HMVC internal runtime already initialized.');

  var Core = global.__HMVC_INTERNAL__ = {
    version: '1.5.0-lab',
    moduleDefinitions: Object.create(null)
  };

  Core.assert = function (condition, message) {
    if (!condition) throw new Error(message);
  };

  Core.isObject = function (value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  };

  Core.copy = function (value) {
    if (value === undefined) return undefined;
    if (global.structuredClone) {
      try { return global.structuredClone(value); } catch (_) {}
    }
    return JSON.parse(JSON.stringify(value));
  };
})(window);

(function (global) {
  'use strict';
  var Core = global.__HMVC_INTERNAL__;

  function toPath(path) {
    path = String(path || '/').trim();
    if (!path.startsWith('/')) path = '/' + path;
    path = path.replace(/\/{2,}/g, '/');
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return path;
  }

  function parseQuery(search) {
    var params = new URLSearchParams(search || '');
    var out = Object.create(null);
    params.forEach(function (value, key) { out[key] = value; });
    return out;
  }

  function compileRoute(pattern) {
    var normalized = toPath(pattern);
    if (normalized === '*') return { pattern: '*', names: [], regex: /^.*$/ };

    var names = [];
    var parts = normalized.split('/').filter(Boolean).map(function (part) {
      if (part.charAt(0) === ':') {
        names.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });

    return { pattern: normalized, names: names, regex: new RegExp('^/' + parts.join('/') + '$') };
  }

  function safeDecode(value) {
    try { return decodeURIComponent(value); }
    catch (_) { return String(value); }
  }

  function matchRoute(compiled, path) {
    if (compiled.pattern === '*') return {};
    var match = compiled.regex.exec(toPath(path));
    if (!match) return null;

    var params = Object.create(null);
    compiled.names.forEach(function (name, index) {
      params[name] = safeDecode(match[index + 1]);
    });
    return params;
  }

  Core.router = Object.freeze({
    toPath: toPath,
    parseQuery: parseQuery,
    compileRoute: compileRoute,
    matchRoute: matchRoute
  });
})(window);

(function (global) {
  'use strict';
  var Core = global.__HMVC_INTERNAL__;

  function createMemoryStorage() {
    var data = Object.create(null);
    return {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
      setItem: function (key, value) { data[key] = String(value); },
      removeItem: function (key) { delete data[key]; },
      key: function (index) { return Object.keys(data)[index] || null; },
      get length() { return Object.keys(data).length; }
    };
  }

  function selectStorage() {
    try {
      var testKey = '__hmvc_storage_test__';
      global.localStorage.setItem(testKey, '1');
      global.localStorage.removeItem(testKey);
      return global.localStorage;
    } catch (_) {
      return createMemoryStorage();
    }
  }

  Core.createStorage = function (prefix) {
    var backend = selectStorage();
    var base = String(prefix || 'hmvc-app') + ':';
    function key(name) { return base + name; }

    return Object.freeze({
      get: function (name, fallback) {
        var raw = backend.getItem(key(name));
        if (raw === null) return fallback;
        try { return JSON.parse(raw); } catch (_) { return fallback; }
      },
      set: function (name, value) {
        backend.setItem(key(name), JSON.stringify(value));
        return value;
      },
      remove: function (name) { backend.removeItem(key(name)); },
      clear: function () {
        var names = [];
        for (var i = 0; i < backend.length; i += 1) {
          var current = backend.key(i);
          if (current && current.indexOf(base) === 0) names.push(current);
        }
        names.forEach(function (name) { backend.removeItem(name); });
      }
    });
  };
})(window);

(function (global) {
  'use strict';
  var Core = global.__HMVC_INTERNAL__;

  Core.createStore = function (initialState) {
    var state = Core.copy(initialState || {});
    var subscribers = [];

    function notify(key, value) {
      subscribers.slice().forEach(function (fn) {
        try { fn(key, Core.copy(value), Core.copy(state)); }
        catch (error) { console.error(error); }
      });
    }

    return Object.freeze({
      get: function (key, fallback) {
        if (key === undefined) return Core.copy(state);
        return Object.prototype.hasOwnProperty.call(state, key) ? Core.copy(state[key]) : fallback;
      },
      set: function (key, value) {
        state[key] = Core.copy(value);
        notify(key, value);
        return value;
      },
      patch: function (values) {
        Core.assert(Core.isObject(values), 'HMVC.store.patch expects an object.');
        Object.keys(values).forEach(function (key) { state[key] = Core.copy(values[key]); });
        notify('*', values);
        return Core.copy(state);
      },
      remove: function (key) {
        delete state[key];
        notify(key, undefined);
      },
      subscribe: function (fn) {
        Core.assert(typeof fn === 'function', 'HMVC.store.subscribe expects a function.');
        subscribers.push(fn);
        return function () {
          subscribers = subscribers.filter(function (item) { return item !== fn; });
        };
      }
    });
  };
})(window);

(function (global) {
  'use strict';
  var Core = global.__HMVC_INTERNAL__;

  Core.createEventBus = function () {
    var handlers = Object.create(null);
    return Object.freeze({
      on: function (name, fn) {
        Core.assert(typeof fn === 'function', 'HMVC.on expects a function.');
        (handlers[name] || (handlers[name] = [])).push(fn);
        return function () {
          handlers[name] = (handlers[name] || []).filter(function (item) { return item !== fn; });
        };
      },
      emit: function (name, payload) {
        (handlers[name] || []).slice().forEach(function (fn) {
          try { fn(payload); } catch (error) { console.error(error); }
        });
      }
    });
  };

  Core.createSession = function (storage, eventBus) {
    var SESSION_KEY = 'session';
    return Object.freeze({
      get: function () { return storage.get(SESSION_KEY, null); },
      set: function (value) {
        storage.set(SESSION_KEY, value);
        eventBus.emit('session:change', Core.copy(value));
        return value;
      },
      clear: function () {
        storage.remove(SESSION_KEY);
        eventBus.emit('session:change', null);
      },
      exists: function () { return !!storage.get(SESSION_KEY, null); }
    });
  };
})(window);

(function (global) {
  'use strict';
  var Core = global.__HMVC_INTERNAL__;

  Core.createHttp = function (baseUrl, defaultTimeoutMs) {
    baseUrl = String(baseUrl || '').replace(/\/$/, '');
    defaultTimeoutMs = Number(defaultTimeoutMs);
    if (!Number.isFinite(defaultTimeoutMs) || defaultTimeoutMs < 0) defaultTimeoutMs = 30000;

    function httpError(message, code, status, data, cause) {
      var error = new Error(message || code || 'HTTP request failed');
      error.name = 'HMVCHttpError';
      error.code = code || 'HTTP_ERROR';
      if (status !== undefined && status !== null) error.status = status;
      if (data !== undefined) error.data = data;
      if (cause !== undefined) error.cause = cause;
      return error;
    }

    async function request(method, path, body, options) {
      options = options || {};
      Core.assert(typeof global.fetch === 'function', 'Fetch API is not available in this browser.');

      var headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
      var payload = body;
      var isFormData = !!global.FormData && body instanceof global.FormData;
      if (body !== undefined && body !== null && !isFormData) {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        if (headers['Content-Type'].indexOf('application/json') >= 0) payload = JSON.stringify(body);
      }

      var timeoutMs = options.timeoutMs === undefined ? defaultTimeoutMs : Number(options.timeoutMs);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) timeoutMs = defaultTimeoutMs;

      var externalSignal = options.signal || null;
      var controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
      var signal = controller ? controller.signal : externalSignal;
      var timedOut = false;
      var timer = 0;
      var abortForwarder = null;

      if (controller && externalSignal) {
        abortForwarder = function () {
          try { controller.abort(externalSignal.reason); } catch (_) { controller.abort(); }
        };
        if (externalSignal.aborted) abortForwarder();
        else externalSignal.addEventListener('abort', abortForwarder, { once: true });
      }

      if (controller && timeoutMs > 0) {
        timer = global.setTimeout(function () {
          timedOut = true;
          try { controller.abort(); } catch (_) {}
        }, timeoutMs);
      }

      try {
        var response = await global.fetch(baseUrl + path, {
          method: method,
          headers: headers,
          body: method === 'GET' || method === 'HEAD' ? undefined : payload,
          credentials: options.credentials || 'same-origin',
          signal: signal
        });

        if (response.status === 204 || response.status === 205) {
          if (!response.ok) throw httpError('HTTP ' + response.status, 'HTTP_ERROR', response.status, null);
          return null;
        }

        var contentType = response.headers.get('content-type') || '';
        var raw = await response.text();
        var data = raw || null;
        if (raw && /application\/(?:[^;]+\+)?json/i.test(contentType)) {
          try { data = JSON.parse(raw); }
          catch (parseError) {
            throw httpError('Invalid JSON response', 'INVALID_JSON', response.status, raw, parseError);
          }
        }

        if (!response.ok) {
          throw httpError(
            (data && data.message) || (data && data.title) || ('HTTP ' + response.status),
            'HTTP_ERROR', response.status, data
          );
        }
        return data;
      } catch (error) {
        if (error && error.name === 'HMVCHttpError') throw error;
        if (error && error.name === 'AbortError') {
          if (timedOut) throw httpError('Request timed out', 'TIMEOUT', null, null, error);
          throw httpError('Request aborted', 'ABORTED', null, null, error);
        }
        throw httpError(error && error.message ? error.message : 'Network request failed', 'NETWORK_ERROR', null, null, error);
      } finally {
        if (timer) global.clearTimeout(timer);
        if (externalSignal && abortForwarder) externalSignal.removeEventListener('abort', abortForwarder);
      }
    }

    return Object.freeze({
      request: request,
      get: function (path, options) { return request('GET', path, null, options); },
      post: function (path, body, options) { return request('POST', path, body, options); },
      put: function (path, body, options) { return request('PUT', path, body, options); },
      patch: function (path, body, options) { return request('PATCH', path, body, options); },
      delete: function (path, options) { return request('DELETE', path, null, options); }
    });
  };
})(window);

(function (global) {
  'use strict';
  var Core = global.__HMVC_INTERNAL__;

  function appendChild(parent, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (item) { appendChild(parent, item); });
      return;
    }
    if (child instanceof global.Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }

  function h(tag, attrs) {
    var element = document.createElement(tag);
    attrs = attrs || {};

    Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;

      if (key === 'class' || key === 'className') element.className = value;
      else if (key === 'text') element.textContent = value;
      else if (key === 'dataset' && Core.isObject(value)) {
        Object.keys(value).forEach(function (dataKey) { element.dataset[dataKey] = String(value[dataKey]); });
      } else if (key === 'checked' || key === 'disabled' || key === 'hidden' || key === 'required') {
        element[key] = !!value;
      } else if (key in element && key !== 'form') {
        try { element[key] = value; } catch (_) { element.setAttribute(key, String(value)); }
      } else {
        element.setAttribute(key, String(value));
      }
    });

    for (var i = 2; i < arguments.length; i += 1) appendChild(element, arguments[i]);
    return element;
  }

  function fragment() {
    var node = document.createDocumentFragment();
    for (var i = 0; i < arguments.length; i += 1) appendChild(node, arguments[i]);
    return node;
  }

  function formValues(form) {
    var out = Object.create(null);
    if (!form) return out;
    new global.FormData(form).forEach(function (value, key) { out[key] = value; });
    return out;
  }

  Core.renderer = Object.freeze({
    appendChild: appendChild,
    h: h,
    fragment: fragment,
    formValues: formValues
  });
})(window);

(function (global) {
  'use strict';
  var Core = global.__HMVCCoreSource || global.__HMVC_INTERNAL__;
  var router = Core.router;

  function App(config) {
    config = config || {};
    this.config = Object.freeze(Object.assign({
      mount: '#app',
      routeParam: 'route',
      defaultRoute: '/',
      storagePrefix: 'hmvc-app',
      apiBaseUrl: '',
      httpTimeoutMs: 30000,
      locationAdapter: null
    }, config));

    this.root = null;
    this.routes = [];
    this.guards = Object.create(null);
    this.modules = Object.create(null);
    this.current = null;
    this.started = false;
    this._navigationSeq = 0;
    this.location = this.config.locationAdapter || null;

    this.events = Core.createEventBus();
    this.storage = Core.createStorage(this.config.storagePrefix);
    this.store = Core.createStore(this.config.initialState || {});
    this.session = Core.createSession(this.storage, this.events);
    this.http = Core.createHttp(this.config.apiBaseUrl, this.config.httpTimeoutMs);

    this._boundClick = this._handleClick.bind(this);
    this._boundSubmit = this._handleSubmit.bind(this);
    this._boundPopstate = this._handlePopstate.bind(this);
  }

  App.prototype.on = function (name, fn) { return this.events.on(name, fn); };
  App.prototype.emit = function (name, payload) { return this.events.emit(name, payload); };

  App.prototype.route = function (path, config) {
    Core.assert(config && config.module && config.action, 'HMVC.route requires module and action.');
    this.routes.push({ path: path, compiled: router.compileRoute(path), config: Object.freeze(Object.assign({}, config)) });
    return this;
  };

  App.prototype.guard = function (name, fn) {
    Core.assert(typeof fn === 'function', 'HMVC.guard expects a function.');
    this.guards[name] = fn;
    return this;
  };

  App.prototype.module = function (name) {
    if (this.modules[name]) return this.modules[name];
    var definition = Core.moduleDefinitions[name];
    Core.assert(definition, 'HMVC module not registered: ' + name);
    var instance = typeof definition.create === 'function' ? definition.create(this._baseContext()) : definition;
    Core.assert(instance && instance.controller, 'HMVC module must expose controller: ' + name);
    this.modules[name] = instance;
    return instance;
  };

  App.prototype._baseContext = function () {
    var app = this;
    return Object.freeze({
      app: app,
      store: app.store,
      storage: app.storage,
      session: app.session,
      http: app.http,
      ui: global.HMVC.ui,
      navigate: function (path, options) { return app.navigate(path, options); },
      refresh: function () { return app.refresh(); },
      on: function (name, fn) { return app.on(name, fn); },
      emit: function (name, payload) { return app.emit(name, payload); }
    });
  };

  App.prototype._currentPathFromLocation = function () {
    if (this.location && typeof this.location.read === 'function') {
      return router.toPath(this.location.read() || this.config.defaultRoute);
    }
    var params = new URLSearchParams(global.location.search || '');
    return router.toPath(params.get(this.config.routeParam) || this.storage.get('__hmvc_route', this.config.defaultRoute));
  };

  App.prototype._writeLocation = function (path, replace) {
    path = router.toPath(path);
    if (this.location && typeof this.location.write === 'function') {
      try { return this.location.write(path, !!replace) !== false; }
      catch (_) { return false; }
    }
    var url = new URL(global.location.href);
    url.searchParams.set(this.config.routeParam, path);
    try {
      if (replace) global.history.replaceState({ hmvcRoute: path }, '', url.href);
      else global.history.pushState({ hmvcRoute: path }, '', url.href);
      return true;
    } catch (_) {
      return false;
    }
  };

  App.prototype._findRoute = function (path) {
    var fallback = null;
    for (var i = 0; i < this.routes.length; i += 1) {
      var item = this.routes[i];
      if (item.path === '*') { fallback = item; continue; }
      var params = router.matchRoute(item.compiled, path);
      if (params !== null) return { route: item, params: params };
    }
    return fallback ? { route: fallback, params: {} } : null;
  };

  App.prototype._runGuards = async function (routeMatch, context) {
    var names = routeMatch.route.config.guards || [];
    for (var i = 0; i < names.length; i += 1) {
      var guard = this.guards[names[i]];
      Core.assert(guard, 'Unknown route guard: ' + names[i]);
      var result = await guard(context);
      if (result === false) return { allowed: false };
      if (Core.isObject(result) && result.redirect) return { allowed: false, redirect: result.redirect };
    }
    return { allowed: true };
  };

  App.prototype._renderError = function (error) {
    console.error(error);
    var h = Core.renderer.h;
    var box = h('section', { class: 'hmvc-error', role: 'alert' },
      h('h2', { text: 'Application error' }),
      h('p', { text: error && error.message ? error.message : String(error) })
    );
    this.render(box);
    this.emit('error', error);
  };

  App.prototype.render = function (content) {
    Core.assert(this.root, 'HMVC app has not started.');
    this.root.replaceChildren();
    Core.renderer.appendChild(this.root, content);
    return content;
  };

  App.prototype._renderPath = async function (path, options) {
    options = options || {};
    path = router.toPath(path);
    var token = options.token || ++this._navigationSeq;
    var app = this;
    function isCurrent() { return token === app._navigationSeq && app.started; }

    try {
      var match = this._findRoute(path);
      if (!match) throw new Error('Route not found: ' + path);

      var config = match.route.config;
      var query = router.parseQuery(global.location.search);
      query[this.config.routeParam] = path;
      var context = Object.assign({}, this._baseContext(), {
        path: path,
        params: match.params,
        query: query,
        route: config,
        navigationToken: token
      });

      var guardResult = await this._runGuards(match, context);
      if (!isCurrent()) return { status: 'stale', path: path };
      if (!guardResult.allowed) {
        if (guardResult.redirect && router.toPath(guardResult.redirect) !== path) {
          return this.navigate(guardResult.redirect, { replace: true });
        }
        if (typeof options.onDenied === 'function') options.onDenied(path);
        return { status: 'denied', path: path };
      }

      if (typeof options.commit === 'function') options.commit(path);
      if (!isCurrent()) return { status: 'stale', path: path };

      var module = this.module(config.module);
      var action = module.controller[config.action];
      Core.assert(typeof action === 'function', 'Controller action not found: ' + config.module + '.' + config.action);
      this.emit('route:before', { path: path, route: config, params: match.params });
      var output = await action.call(module.controller, context);
      if (!isCurrent()) return { status: 'stale', path: path };

      // Stable route paint contract: application shell/layout consumers get the
      // target route synchronously immediately before the DOM commit. This keeps
      // the next screen from being painted for one frame with the previous
      // screen's layout (for example auth -> app).
      this.emit('route:render', { path: path, route: config, params: match.params });
      if (!isCurrent()) return { status: 'stale', path: path };

      if (output !== undefined) this.render(output);
      this.current = { path: path, route: config, params: match.params };
      if (this.root) this.root.dataset.currentRoute = path;
      this.emit('route:after', Core.copy(this.current));
      return { status: 'rendered', path: path };
    } catch (error) {
      if (!isCurrent()) return { status: 'stale', path: path };
      this._renderError(error);
      return { status: 'error', path: path, error: error };
    }
  };

  App.prototype.navigate = async function (path, options) {
    options = options || {};
    path = router.toPath(path);
    var app = this;
    var token = ++this._navigationSeq;

    return this._renderPath(path, {
      token: token,
      commit: function (allowedPath) {
        if (token !== app._navigationSeq) return;
        app.storage.set('__hmvc_route', allowedPath);
        app._writeLocation(allowedPath, !!options.replace);
      },
      onDenied: function () {
        var fallback = app.current && app.current.path ? app.current.path : app.config.defaultRoute;
        app.storage.set('__hmvc_route', fallback);
        app._writeLocation(fallback, true);
      }
    });
  };

  App.prototype.refresh = function () {
    var path = this.current ? this.current.path : this._currentPathFromLocation();
    return this._renderPath(path, { token: ++this._navigationSeq });
  };

  App.prototype._actionContext = function (element, event) {
    var form = element.tagName === 'FORM' ? element : element.closest('form');
    return Object.assign({}, this._baseContext(), {
      event: event,
      element: element,
      form: form,
      values: Core.renderer.formValues(form),
      data: Object.assign({}, element.dataset),
      current: this.current
    });
  };

  App.prototype._dispatchAction = async function (actionName, element, event) {
    var parts = String(actionName || '').split('.');
    Core.assert(parts.length === 2, 'Action must use module.action format: ' + actionName);
    var module = this.module(parts[0]);
    var action = module.controller[parts[1]];
    Core.assert(typeof action === 'function', 'Action not found: ' + actionName);

    try {
      this.emit('action:before', { action: actionName });
      var result = await action.call(module.controller, this._actionContext(element, event));
      this.emit('action:after', { action: actionName, result: result });
      return result;
    } catch (error) {
      this._renderError(error);
    }
  };

  App.prototype._handleClick = function (event) {
    if (!this.started) return;
    var routeElement = event.target.closest('[data-route]');
    if (routeElement) {
      event.preventDefault();
      this.navigate(routeElement.dataset.route);
      return;
    }
    var actionElement = event.target.closest('[data-action]');
    if (actionElement && actionElement.tagName !== 'FORM') {
      event.preventDefault();
      this._dispatchAction(actionElement.dataset.action, actionElement, event);
    }
  };

  App.prototype._handleSubmit = function (event) {
    if (!this.started) return;
    var form = event.target.closest('form[data-action]');
    if (!form) return;
    event.preventDefault();
    this._dispatchAction(form.dataset.action, form, event);
  };

  App.prototype._handlePopstate = function () {
    var app = this;
    var path = this._currentPathFromLocation();
    var token = ++this._navigationSeq;
    this._renderPath(path, {
      token: token,
      commit: function (allowedPath) {
        if (token === app._navigationSeq) app.storage.set('__hmvc_route', allowedPath);
      },
      onDenied: function () {
        var fallback = app.current && app.current.path ? app.current.path : app.config.defaultRoute;
        app.storage.set('__hmvc_route', fallback);
        app._writeLocation(fallback, true);
      }
    });
  };

  App.prototype.start = function () {
    Core.assert(!this.started, 'HMVC app already started.');
    this.root = typeof this.config.mount === 'string' ? document.querySelector(this.config.mount) : this.config.mount;
    Core.assert(this.root, 'HMVC mount not found: ' + this.config.mount);

    this.started = true;
    document.addEventListener('click', this._boundClick);
    document.addEventListener('submit', this._boundSubmit);
    global.addEventListener('popstate', this._boundPopstate);
    this.emit('app:start', { version: Core.version });

    var app = this;
    var path = this._currentPathFromLocation();
    var token = ++this._navigationSeq;
    return this._renderPath(path, {
      token: token,
      commit: function (allowedPath) {
        if (token === app._navigationSeq) app.storage.set('__hmvc_route', allowedPath);
      },
      onDenied: function () {
        app.storage.set('__hmvc_route', app.config.defaultRoute);
        app._writeLocation(app.config.defaultRoute, true);
      }
    }).then(function (result) {
      if (result && result.status === 'denied' && path !== router.toPath(app.config.defaultRoute)) {
        return app.navigate(app.config.defaultRoute, { replace: true });
      }
      return result;
    });
  };

  App.prototype.destroy = function () {
    document.removeEventListener('click', this._boundClick);
    document.removeEventListener('submit', this._boundSubmit);
    global.removeEventListener('popstate', this._boundPopstate);
    this.started = false;
    this.emit('app:destroy');
  };

  Core.App = App;
})(window);

(function (global) {
  'use strict';
  var Core = global.__HMVC_INTERNAL__;

  var HMVC = {
    version: Core.version,
    create: function (config) { return new Core.App(config); },
    module: function (name, definition) {
      Core.assert(/^[A-Za-z][A-Za-z0-9_-]*$/.test(name), 'Invalid HMVC module name: ' + name);
      Core.assert(definition && (typeof definition.create === 'function' || definition.controller), 'HMVC.module requires a module definition.');
      if (Core.moduleDefinitions[name]) throw new Error('HMVC module already registered: ' + name);
      Core.moduleDefinitions[name] = definition;
      return HMVC;
    },
    ui: Object.freeze({
      h: Core.renderer.h,
      fragment: Core.renderer.fragment,
      formValues: Core.renderer.formValues
    }),
    tools: Object.freeze({ toPath: Core.router.toPath })
  };

  Object.freeze(HMVC);
  global.HMVC = HMVC;
  try { delete global.__HMVC_INTERNAL__; } catch (_) {}
})(window);
