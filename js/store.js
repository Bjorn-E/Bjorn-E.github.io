// Data storage on a shared folder (network drive), using the browser's
// File System Access API. Every project and every task is its own JSON file,
// so several users can work at the same time. Saves are merged field by field
// against the version on disk; only real conflicts (same field changed by two
// people) are reported back to the user.
//
// Folder layout:
//   <data>/taskorganizer.json
//   <data>/users.json
//   <data>/projects/<KEY>/project.json
//   <data>/projects/<KEY>/tasks/<KEY>-<n>.json
//
// Everything that touches storage goes through this class, so it can later be
// swapped for a server or Microsoft 365 backend without changing the UI.
window.TO = window.TO || {};

(function () {
  var MARKER = 'taskorganizer.json';
  var META_FIELDS = { rev: 1, updatedAt: 1, updatedBy: 1 };
  // Lists of entries with an id. They are merged entry by entry and never
  // conflict; removing an entry sets removed: true instead of deleting it.
  var COLLECTIONS = ['log', 'links', 'docLinks', 'history'];

  function ConflictError(fields, theirs) {
    this.name = 'ConflictError';
    this.message = 'Someone else changed the same fields: ' + fields.join(', ');
    this.fields = fields;
    this.theirs = theirs;
  }
  ConflictError.prototype = Object.create(Error.prototype);

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function nowIso() { return new Date().toISOString(); }

  // Three-way merge: apply my changes (mine vs base) on top of theirs (cur).
  function merge(base, mine, cur, preferMine) {
    var out = clone(cur);
    var conflicts = [];
    var keys = {};
    [base, mine, cur].forEach(function (o) { Object.keys(o || {}).forEach(function (k) { keys[k] = 1; }); });
    Object.keys(keys).forEach(function (k) {
      if (META_FIELDS[k] || COLLECTIONS.indexOf(k) >= 0) return;
      var myChanged = !same(mine[k], base[k]);
      var theirChanged = !same(cur[k], base[k]);
      if (!myChanged) return;
      if (theirChanged && !same(mine[k], cur[k])) {
        conflicts.push(k);
        if (!preferMine) return;
      }
      out[k] = clone(mine[k]);
    });
    COLLECTIONS.forEach(function (k) {
      if (cur[k] || mine[k]) out[k] = unionById(cur[k], mine[k]);
    });
    return { doc: out, conflicts: conflicts };
  }

  // Keeps every entry from both lists, ordered by time. A removal on either
  // side wins.
  function unionById(a, b) {
    var byId = {};
    (a || []).concat(b || []).forEach(function (e) {
      var prev = byId[e.id];
      byId[e.id] = prev ? Object.assign({}, prev, e, { removed: !!(prev.removed || e.removed) }) : clone(e);
    });
    return Object.keys(byId).map(function (id) { return byId[id]; })
      .sort(function (x, y) { return x.at < y.at ? -1 : x.at > y.at ? 1 : 0; });
  }

  function Store(root, opts) {
    this.root = root;
    this.user = (opts && opts.user) || '';
    this.users = { rev: 0, users: [] };
    this.projects = {};   // key -> project
    this.tasks = {};      // id  -> task
    this.mtimes = {};     // path -> lastModified
    this.version = 0;     // goes up whenever data changes (for caches in the UI)
  }

  Store.ConflictError = ConflictError;
  Store.merge = merge;

  Store.prototype.dir = async function (parts, create) {
    var d = this.root;
    for (var i = 0; i < parts.length; i++) d = await d.getDirectoryHandle(parts[i], { create: !!create });
    return d;
  };

  Store.prototype.readJson = async function (dir, name, path) {
    var fh;
    try { fh = await dir.getFileHandle(name); }
    catch (e) { if (e.name === 'NotFoundError') return null; throw e; }
    var file = await fh.getFile();
    var text = await file.text();
    if (path) this.mtimes[path] = file.lastModified;
    try { return JSON.parse(text); }
    catch (e) { console.warn('Could not parse', path || name, e); return null; }
  };

  Store.prototype.writeJson = async function (dir, name, obj, path) {
    var fh = await dir.getFileHandle(name, { create: true });
    var w = await fh.createWritable();
    await w.write(JSON.stringify(obj, null, 2));
    await w.close();
    if (path) {
      var file = await fh.getFile();
      this.mtimes[path] = file.lastModified;
    }
  };

  async function entries(dir) {
    var list = [];
    for await (var pair of dir.entries()) list.push(pair);
    return list;
  }

  // Run async fn over items with limited parallelism (network drives are slow).
  async function pool(items, limit, fn) {
    var i = 0;
    async function worker() { while (i < items.length) { var item = items[i++]; await fn(item); } }
    var workers = [];
    for (var w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
    await Promise.all(workers);
  }

  // Returns 'ok' (data folder), 'empty' (can be initialised) or 'other'.
  Store.prototype.inspect = async function () {
    var marker = await this.readJson(this.root, MARKER);
    if (marker) return 'ok';
    var list = await entries(this.root);
    return list.length === 0 ? 'empty' : 'other';
  };

  Store.prototype.initialize = async function () {
    await this.writeJson(this.root, MARKER, {
      app: 'TaskAndWbsOrganizer', format: TO.config.dataFormat, createdAt: nowIso(), createdBy: this.user
    });
    if (!(await this.readJson(this.root, 'users.json'))) {
      await this.writeJson(this.root, 'users.json', { rev: 1, users: [] }, 'users.json');
    }
    await this.dir(['projects'], true);
  };

  Store.prototype.loadAll = async function () {
    this.projects = {};
    this.tasks = {};
    this.mtimes = {};
    await this.refresh();
  };

  // Re-reads only files that are new or changed since last time.
  // Returns true if anything changed.
  Store.prototype.refresh = async function () {
    var self = this;
    var changed = false;
    var seen = {};

    async function check(dir, name, path, apply) {
      seen[path] = 1;
      var fh = await dir.getFileHandle(name);
      var file = await fh.getFile();
      if (self.mtimes[path] === file.lastModified) return;
      var doc;
      try { doc = JSON.parse(await file.text()); }
      catch (e) { console.warn('Could not parse', path, e); return; }
      self.mtimes[path] = file.lastModified;
      apply(doc);
      changed = true;
    }

    await check(this.root, 'users.json', 'users.json', function (doc) { self.users = doc; })
      .catch(function (e) { if (e.name !== 'NotFoundError') throw e; });

    var projectsDir = await this.dir(['projects'], true);
    var projectDirs = (await entries(projectsDir)).filter(function (p) { return p[1].kind === 'directory'; });

    var taskJobs = [];
    await pool(projectDirs, 6, async function (p) {
      var key = p[0], pdir = p[1];
      try {
        await check(pdir, 'project.json', 'projects/' + key + '/project.json', function (doc) { self.projects[key] = doc; });
      } catch (e) { if (e.name !== 'NotFoundError') throw e; return; }
      var tdir;
      try { tdir = await pdir.getDirectoryHandle('tasks'); }
      catch (e) { if (e.name === 'NotFoundError') return; throw e; }
      (await entries(tdir)).forEach(function (t) {
        if (t[1].kind === 'file' && /\.json$/i.test(t[0])) taskJobs.push([tdir, t[0], key]);
      });
    });

    await pool(taskJobs, 8, async function (job) {
      var path = 'projects/' + job[2] + '/tasks/' + job[1];
      try {
        await check(job[0], job[1], path, function (doc) {
          // "Source reference" was merged into "Action point / external ID".
          if (!doc.externalRef && doc.sourceRef) doc.externalRef = doc.sourceRef;
          self.tasks[doc.id] = doc;
        });
      } catch (e) { if (e.name !== 'NotFoundError') throw e; }
    });

    // Drop anything that was removed from disk.
    Object.keys(this.mtimes).forEach(function (path) {
      if (seen[path]) return;
      delete self.mtimes[path];
      var m = path.match(/^projects\/([^/]+)\/(project\.json|tasks\/(.+)\.json)$/);
      if (!m) return;
      if (m[3]) delete self.tasks[m[3]]; else delete self.projects[m[1]];
      changed = true;
    });

    if (changed) this.version++;
    return changed;
  };

  // Generic save with merge. base = the version the user started editing
  // (null when creating). Returns the saved document.
  Store.prototype.saveDoc = async function (dirParts, name, mine, base, opts) {
    opts = opts || {};
    var dir = await this.dir(dirParts, true);
    var path = dirParts.concat(name).join('/');
    var cur = await this.readJson(dir, name);
    var out;
    if (!base) {
      if (cur) { var err = new Error('Already exists: ' + name); err.code = 'EXISTS'; throw err; }
      out = clone(mine);
      out.rev = 1;
    } else if (!cur || cur.rev === base.rev) {
      out = clone(mine);
      out.rev = (cur ? cur.rev : base.rev) + 1;
    } else {
      var r = merge(base, mine, cur, opts.force);
      if (r.conflicts.length && !opts.force) throw new ConflictError(r.conflicts, cur);
      out = r.doc;
      out.rev = cur.rev + 1;
    }
    out.updatedAt = nowIso();
    out.updatedBy = this.user;
    await this.writeJson(dir, name, out, path);
    return out;
  };

  Store.prototype.saveProject = async function (mine, base, opts) {
    var p = await this.saveDoc(['projects', mine.key], 'project.json', mine, base, opts);
    await this.dir(['projects', mine.key, 'tasks'], true);
    this.projects[p.key] = p;
    this.version++;
    return p;
  };

  Store.prototype.saveTask = async function (mine, base, opts) {
    var t = await this.saveDoc(['projects', mine.projectKey, 'tasks'], mine.id + '.json', mine, base, opts);
    this.tasks[t.id] = t;
    this.version++;
    return t;
  };

  // Gives the task the next free number in its project (e.g. ABC-14) and saves it.
  Store.prototype.createTask = async function (task) {
    var key = task.projectKey;
    var tdir = await this.dir(['projects', key, 'tasks'], true);
    var max = 0;
    (await entries(tdir)).forEach(function (e) {
      var m = e[0].match(/-(\d+)\.json$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    for (var attempt = 0; attempt < 20; attempt++) {
      var n = max + 1 + attempt;
      task.number = n;
      task.id = key + '-' + n;
      task.createdAt = task.createdAt || nowIso();
      task.createdBy = task.createdBy || this.user;
      try { return await this.saveTask(task, null); }
      catch (e) { if (e.code !== 'EXISTS') throw e; }
    }
    throw new Error('Could not find a free task number in ' + key);
  };

  // Several people at once (Excel import): re-read, replace or add each by
  // id, write back once.
  Store.prototype.upsertUsers = async function (changed) {
    var cur = (await this.readJson(this.root, 'users.json')) || { rev: 0, users: [] };
    var byId = {};
    cur.users.forEach(function (u) { byId[u.id] = u; });
    changed.forEach(function (u) { byId[u.id] = u; });
    var list = Object.keys(byId).map(function (id) { return byId[id]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    var out = { rev: (cur.rev || 0) + 1, users: list, updatedAt: nowIso(), updatedBy: this.user };
    await this.writeJson(this.root, 'users.json', out, 'users.json');
    this.users = out;
    this.version++;
    return out;
  };

  // Users list is small and shared: re-read, change one entry, write back.
  Store.prototype.upsertUser = async function (user) {
    var cur = (await this.readJson(this.root, 'users.json')) || { rev: 0, users: [] };
    var list = cur.users.filter(function (u) { return u.id !== user.id; });
    list.push(user);
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    var out = { rev: (cur.rev || 0) + 1, users: list, updatedAt: nowIso(), updatedBy: this.user };
    await this.writeJson(this.root, 'users.json', out, 'users.json');
    this.users = out;
    this.version++;
    return user;
  };

  TO.Store = Store;
})();
